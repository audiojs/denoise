// Measure @audio/denoise-repair's tiers and 'auto' on dropouts and band-limited damage.
// Run: `node scripts/repair.js [ms…]` (tens of minutes: AR is O(m²) in the gap length; gap lengths in ms
// limit the dropout tables, e.g. `5 20`, and skip the others). Prints the README's "Measured" tables:
// mean SNR over the lost samples (the audio-inpainting convention, Adler et al. 2012) / log-spectral
// distance over the STFT frames overlapping them (@audio/quality lsd, 1024/256); then "Seams": the good
// audio each tier rewrites around a gap and what its joins add there. `node scripts/repair.js seams
// [path to a repair.js]` prints that table alone, for the given kernel (an earlier version's) if any.
//
// Material: audio-lena (speech, devDependency); a sine, a C-major chord, a vibrato tone and a repeating
// song, generated here; and when present in ~/.cache/audiojs/data/repair/ as 44.1 kHz mono float32
// (<name>.f32, decoded from github.com/librosa/data): Kevin MacLeod "Vibe Ace" (vibeace) and "Dance of
// the Sugar Plum Fairy" (nutcracker), CC BY 3.0; Brahms Hungarian Dance No. 5, US Army Strings (brahms),
// public domain; Mihai Sorohan, trumpet loop (trumpet), CC BY 3.0.

import repair, { plan } from '@audio/denoise-repair'
import { arFit } from '@audio/lpc'
import { lsd as qlsd } from '@audio/quality'
import raw from 'audio-lena/raw'
import { fft, ifft } from 'fourier-transform'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'

const fs = 44100
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
const gauss = r => { let u = r() || 1e-12; return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()) }

// ---- material
const sine = n => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / fs))
function chord(n) {   // C4 E4 G4, harmonics 1..6 at 1/k
  let d = new Float64Array(n)
  for (let f0 of [261.63, 329.63, 392]) for (let k = 1; k <= 6; k++) for (let i = 0; i < n; i++) d[i] += Math.sin(2 * Math.PI * f0 * k * i / fs + 0.37 * k * f0 % (2 * Math.PI)) / k
  let m = d.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  return Float32Array.from(d, v => 0.5 * v / m)
}
function vibrato(n) {   // 440 Hz, ±50 cents at 5.5 Hz: a singer's vibrato (Sundberg 1987), harmonics 1..5 at 1/k
  let d = new Float32Array(n), ph = 0
  for (let i = 0; i < n; i++) {
    ph += 2 * Math.PI * 440 * 2 ** (0.5 / 12 * Math.sin(2 * Math.PI * 5.5 * i / fs)) / fs
    let s = 0; for (let k = 1; k <= 5; k++) s += Math.sin(k * ph) / k
    d[i] = 0.3 * s
  }
  return d
}
// 120 BPM 4/4 (2 s bars), C–Am–F–G: kick, snare, 8th hi-hats (fresh noise each hit), 8th bass, a 4-harmonic
// triad pad, and a 4-bar pentatonic melody played twice: every passage recurs 8 s away
function song(n, seed = 3) {
  let r = lcg(seed), d = new Float64Array(n), beat = fs / 2, bar = 4 * beat, hz = s => 130.81 * 2 ** (s / 12)
  let chords = [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]], pent = [0, 2, 4, 7, 9, 12, 14, 16]
  let mel = Array.from({ length: 32 }, () => pent[Math.floor(r() * pent.length)])
  let add = (at, len, f) => { for (let i = 0; i < len && at + i < n; i++) d[at + i] += f(i / fs) }
  for (let b = 0; b * bar < n; b++) {
    let c = chords[b % 4], t0 = b * bar
    for (let s of c) for (let k = 1; k <= 4; k++) add(t0, bar, t => 0.05 / k * Math.sin(2 * Math.PI * hz(s + 12) * k * t) * Math.min(1, t / 0.02, (2 - t) / 0.05))
    for (let q = 0; q < 4; q++) {
      if (q % 2 === 0) add(t0 + q * beat, 0.3 * fs, t => 0.5 * Math.sin(2 * Math.PI * (45 * t + 1.8 * (1 - Math.exp(-t / 0.03)))) * Math.exp(-t / 0.12))
      else { let nr = lcg(Math.floor(r() * 1e9)); add(t0 + q * beat, 0.2 * fs, t => (0.25 * (nr() * 2 - 1) + 0.2 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t / 0.05)) }
    }
    for (let e = 0; e < 8; e++) {
      let te = t0 + e * beat / 2, nr = lcg(Math.floor(r() * 1e9)), prev = 0, fb = hz(c[0] - 12), fm = hz(mel[(b % 4) * 8 + e] + 24)
      add(te, 0.05 * fs, t => { let w = nr() * 2 - 1, y = w - prev; prev = w; return 0.06 * y * Math.exp(-t / 0.015) })
      add(te, beat / 2, t => 0.12 * (2 * (fb * t % 1) - 1) * Math.min(1, t / 0.005) * Math.exp(-t / 0.4))
      add(te, beat / 2, t => 0.12 * (Math.sin(2 * Math.PI * fm * t) + 0.3 * Math.sin(4 * Math.PI * fm * t)) * Math.min(1, t / 0.01) * Math.exp(-t / 0.3))
    }
  }
  let m = d.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  return Float32Array.from(d, v => 0.7 * v / m)
}
const cache = name => `${homedir()}/.cache/audiojs/data/repair/${name}.f32`
const track = name => existsSync(cache(name)) ? new Float32Array(readFileSync(cache(name)).buffer.slice(0)) : null

// groups: [signals, gaps per signal, edge margin (s)]; real tracks keep 11 s off their ends (the full ±10 s search)
const groups = {
  speech: [[new Float32Array(raw)], 8, 0.5],
  music: [['vibeace', 'nutcracker', 'brahms'].map(track).filter(Boolean), 4, 11],
  trumpet: [[track('trumpet')].filter(Boolean), 4, 0.3],
  sine: [[sine(24 * fs)], 3, 3], chord: [[chord(24 * fs)], 3, 3], vibrato: [[vibrato(24 * fs)], 3, 3], song: [[song(32 * fs)], 6, 6],
}
function positions(x, count, seed, margin) {
  let r = lcg(seed), out = [], m = Math.round(Math.min(margin * fs, x.length / 2 - 2 * fs))
  for (let tries = 0; out.length < count && tries < 1000; tries++) {
    let a = Math.floor(m + r() * (x.length - 2 * m - 1.1 * fs)), e = 0
    for (let i = a; i < a + 0.3 * fs; i++) e += x[i] * x[i]
    if (Math.sqrt(e / (0.3 * fs)) > 0.01) out.push(a)   // skip silence
  }
  return out
}

const snr = (x, y, a, b) => { let s = 0, e = 0; for (let i = a; i < b; i++) { s += x[i] ** 2; e += (x[i] - y[i]) ** 2 } return Math.min(60, 10 * Math.log10(s / Math.max(e, 1e-30))) }
const lsd = (x, y, a, b) => qlsd(x.subarray(a - 768, b + 768), y.subarray(a - 768, b + 768), { frameSize: 1024, hopSize: 256 })
const METHODS = ['ar', 'sinusoidal', 'similarity', 'spectral', 'auto']

function table(title, rows, cols) {
  console.log(`\n### ${title}\n\n| gap | ${cols.join(' | ')} |\n|---|${cols.map(() => '---:').join('|')}|`)
  for (let [gap, cells] of rows) console.log(`| ${gap} | ${cells.join(' | ')} |`)
}

// ---- dropouts: the gap zeroed, every method, auto's pick counted
let SEAMS = process.argv[2] === 'seams', ARGS = process.argv.slice(2).map(Number).filter(v => v > 0), GAPS = ARGS.length ? ARGS : [5, 20, 50, 70, 100, 300, 1000]
for (let [name, [xs, per, margin]] of SEAMS ? [] : Object.entries(groups)) {
  if (!xs.length) { console.log(`\n(${name}: not in ~/.cache/audiojs/data/repair, skipped)`); continue }
  let rows = []
  for (let ms of GAPS) {
    let acc = Object.fromEntries(METHODS.map(m => [m, [0, 0, 0]])), picks = {}
    xs.forEach((x, xi) => {
      for (let a of positions(x, per, 11 + xi, margin)) {
        let b = a + Math.round(ms / 1000 * fs), d = Float32Array.from(x).fill(0, a, b), regions = [{ at: a / fs, duration: (b - a) / fs }]
        let pick = plan(d, { fs, regions })[0].method
        picks[pick] = (picks[pick] ?? 0) + 1
        for (let m of METHODS) {
          let y = repair(d, { fs, regions, method: m }), q = acc[m]
          q[0] += snr(x, y, a, b); q[1] += lsd(x, y, a, b); q[2]++
        }
      }
    })
    rows.push([`${ms} ms`, [...METHODS.map(m => `${(acc[m][0] / acc[m][2]).toFixed(1)} / ${(acc[m][1] / acc[m][2]).toFixed(2)}`), Object.entries(picks).map(([m, k]) => `${m} ${k}`).join(', ')]])
  }
  table(`${name}: SNR / LSD (dB)`, rows, [...METHODS, 'auto picked'])
}

// ---- band-limited damage over clean program; the region names the damaged band
function cough(x, a, b, seed) {   // white noise masked to 300–3000 Hz, √sine envelope, twice the local RMS
  let r = lcg(seed), n = b - a, L = 1
  while (L < n) L <<= 1
  let [re, im] = fft(Float64Array.from({ length: L }, () => gauss(r))), R = Float64Array.from(re), I = Float64Array.from(im)
  for (let k = 0; k <= L / 2; k++) if (k * fs / L < 300 || k * fs / L > 3000) R[k] = I[k] = 0
  let w = ifft(R, I), ex = 0, ew = 0, d = Float32Array.from(x)
  for (let i = 0; i < n; i++) { ex += x[a + i] ** 2; ew += w[i] ** 2 }
  for (let i = 0; i < n; i++) d[a + i] += 2 * Math.sqrt(ex / ew) * w[i] * Math.sin(Math.PI * (i + 0.5) / n) ** 0.5
  return [d, 300, 3000]
}
function ring(x, a, b) {   // UK ring: 400 + 450 Hz, harmonics 1..3
  let d = Float32Array.from(x)
  for (let i = a; i < b; i++) { let t = (i - a) / fs; for (let k = 1; k <= 3; k++) d[i] += 0.1 / k * (Math.sin(2 * Math.PI * 400 * k * t) + Math.sin(2 * Math.PI * 450 * k * t)) }
  return [d, 350, 1400]
}
for (let [dmg, gen] of ARGS.length || SEAMS ? [] : [['cough, 300–3000 Hz', cough], ['phone ring, 350–1400 Hz', ring]]) {
  let rows = []
  for (let ms of [100, 300, 1000]) {
    let acc = Object.fromEntries([...METHODS, 'none'].map(m => [m, [0, 0, 0]]))
    for (let name of ['speech', 'music', 'trumpet', 'song']) {
      let [xs, , margin] = groups[name]
      xs.forEach((x, xi) => {
        for (let [k, a] of positions(x, 2, 5 + xi, margin).entries()) {
          let b = a + Math.round(ms / 1000 * fs), [d, from, to] = gen(x, a, b, 17 + k), regions = [{ at: a / fs, duration: (b - a) / fs, from, to }]
          for (let m of [...METHODS, 'none']) {
            let y = m === 'none' ? d : repair(d, { fs, regions, method: m }), q = acc[m]
            q[0] += snr(x, y, a, b); q[1] += lsd(x, y, a, b); q[2]++
          }
        }
      })
    }
    rows.push([`${ms} ms`, [...METHODS, 'none'].map(m => `${(acc[m][0] / acc[m][2]).toFixed(1)} / ${(acc[m][1] / acc[m][2]).toFixed(2)}`)])
  }
  table(`${dmg} (speech, music, trumpet, song): SNR / LSD (dB)`, rows, [...METHODS, 'unrepaired'])
}

// ---- seams: the good audio each tier rewrites around a dropout, and what its joins add there. At each edge, over 8 ms
// of good audio and 1 ms into the fill: the strongest onset (librosa's onset_strength: 40 mel bands, 30 Hz – 16 kHz, dB
// floored 80 dB under the window's peak, mean rise from the frame before; 512/64) and the strongest 1 ms of the AR(32)
// residual, where a click stands out (Vaseghi & Rayner 1990; fitted on the original's 100 ms of good audio beside the
// edge). "New onsets": the share of edges where the output's onset there tops every onset the original has within
// ±150 ms (after the slash, the original's own share: its edge against the rest of the window); "clicks": the mean
// excess of the output's residual burst over the original's at the same place, dB; "level at the edges": the output's
// power over the 10 ms of fill beside each edge against the original's there, pooled over the edges, dB (a fill short
// of the program's level reads below 0).
const kernel = SEAMS && process.argv[3] ? (await import(new URL(process.argv[3], `file://${process.cwd()}/`))).default : repair
const db = v => 10 * Math.log10(v)
const MEL = (F => {
  let mel = f => 2595 * Math.log10(1 + f / 700), hz = m => 700 * (10 ** (m / 2595) - 1), m0 = mel(30), m1 = mel(16000)
  let e = Array.from({ length: 42 }, (_, i) => hz(m0 + (m1 - m0) * i / 41))
  return Array.from({ length: 40 }, (_, j) => {
    let w = Float64Array.from({ length: F / 2 + 1 }, (_, k) => { let f = k * fs / F; return Math.max(0, Math.min((f - e[j]) / (e[j + 1] - e[j]), (e[j + 2] - f) / (e[j + 2] - e[j + 1]))) })
    if (w.every(v => !v)) w[Math.round(e[j + 1] * F / fs)] = 1   // a band narrower than a bin takes its nearest
    return w
  })
})(512)
function onsets(x, p0, p1) {
  let win = Float64Array.from({ length: 512 }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / 512)), f = new Float64Array(512), S = [], c = []
  for (let p = p0; p + 512 <= p1; p += 64) {
    for (let i = 0; i < 512; i++) f[i] = (x[p + i] || 0) * win[i]
    let [re, im] = fft(f)
    S.push(MEL.map(w => { let s = 0; for (let k = 0; k <= 256; k++) s += w[k] * (re[k] * re[k] + im[k] * im[k]); return db(s + 1e-30) })); c.push(p + 256)
  }
  return { S, c }
}
const rise = (S, lo) => S.map((v, n) => n ? v.reduce((s, q, k) => s + Math.max(0, Math.max(q, lo) - Math.max(S[n - 1][k], lo)), 0) / v.length : -Infinity)
function burst(x, A, p0, p1) {   // 1 ms mean power of the AR residual, dB, hop 0.25 ms
  let M = Math.round(0.001 * fs), e = new Float64Array(p1 - p0), out = [], c = []
  for (let n = p0; n < p1; n++) { let r = 0; for (let k = 0; k < A.length; k++) r += A[k] * (x[n - k] || 0); e[n - p0] = r * r }
  for (let p = 0; p + M <= e.length; p += M >> 2) { let s = 0; for (let i = p; i < p + M; i++) s += e[i]; out.push(db(s / M + 1e-20)); c.push(p0 + p + M / 2) }
  return { v: out, c }
}
function edge(x, y, s, side) {
  let W = Math.round(0.15 * fs), z0 = s - Math.round((side < 0 ? 0.008 : 0.001) * fs), z1 = s + Math.round((side < 0 ? 0.001 : 0.008) * fs)
  let peak = (v, c, inside) => v.reduce((m, q, i) => (c[i] >= z0 && c[i] < z1) === inside ? Math.max(m, q) : m, -Infinity)
  let ox = onsets(x, s - W, s + W), oy = onsets(y, s - W, s + W), lo = Math.max(...ox.S.flat()) - 80, rx = rise(ox.S, lo), ry = rise(oy.S, lo)
  let g0 = side < 0 ? s - Math.round(0.11 * fs) : s + Math.round(0.01 * fs), A = arFit(Float64Array.from(x.subarray(g0, g0 + Math.round(0.1 * fs))), 32).a
  let bx = burst(x, A, s - W, s + W), by = burst(y, A, s - W, s + W), top = peak(rx, ox.c, false)
  return { onset: peak(ry, oy.c, true) > top, own: peak(rx, ox.c, true) > top, click: peak(by.v, by.c, true) - peak(bx.v, bx.c, true) }
}
if (SEAMS || !ARGS.length) {
  // per length: 16 gaps in speech, 6 in each recording, placed afresh for each length
  const SG = [20, 50, 100, 300, 1000], { speech: [sp], music: [mu], trumpet: [tr] } = groups
  const kinds = { speech: [[sp, 16, 0.5]], music: [[mu, 6, 11], [tr, 6, 0.3]] }
  for (let [kind, sets] of Object.entries(kinds)) {
    let acc = {}
    for (let [xs, per, margin] of sets) xs.forEach((x, xi) => {
      for (let ms of SG) for (let a of positions(x, per, 11 + xi + ms, margin)) {
        let b = a + Math.round(ms / 1000 * fs), d = Float32Array.from(x).fill(0, a, b), regions = [{ at: a / fs, duration: (b - a) / fs }]
        for (let m of METHODS) {
          if (m === 'ar' && ms > 100) continue   // O(m²): AR on long gaps is in the tables above
          let y = kernel(d, { fs, regions, method: m }), q = acc[m] ??= { gaps: 0, n: 0, s: 0, e: 0, edges: 0, onset: 0, own: 0, click: 0, snr: 0, lsd: 0, px: 0, py: 0 }
          for (let i = 0; i < x.length; i++) if ((i < a || i >= b) && y[i] !== d[i]) q.n++, q.s += x[i] ** 2, q.e += (x[i] - y[i]) ** 2
          for (let [s, side] of [[a, -1], [b, 1]]) { let r = edge(x, y, s, side); q.edges++; q.onset += r.onset; q.own += r.own; q.click += r.click }
          for (let i of [a, b - Math.round(0.01 * fs)]) for (let j = i; j < i + Math.round(0.01 * fs); j++) q.px += x[j] ** 2, q.py += y[j] ** 2
          q.gaps++; q.snr += snr(x, y, a, b); q.lsd += lsd(x, y, a, b)
        }
      }
    })
    console.log(`\n### Seams, ${kind}: gaps of ${SG.join(', ')} ms\n\n| tier | good audio rewritten | its SNR | new onsets | clicks | level at the edges | gap SNR / LSD |\n|---|---:|---:|---:|---:|---:|---:|`)
    for (let [m, q] of Object.entries(acc)) console.log(`| ${m}${m === 'ar' ? ' (≤ 100 ms)' : ''} | ${(q.n / q.gaps / fs * 1000).toFixed(0)} ms | ${q.e ? db(q.s / q.e).toFixed(1) + ' dB' : '–'} | ${(100 * q.onset / q.edges).toFixed(0)}% / ${(100 * q.own / q.edges).toFixed(0)}% | ${(q.click / q.edges).toFixed(1)} dB | ${db(q.py / q.px).toFixed(1)} dB | ${(q.snr / q.gaps).toFixed(1)} / ${(q.lsd / q.gaps).toFixed(2)} |`)
  }
}
