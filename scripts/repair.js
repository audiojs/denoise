// Measure @audio/denoise-repair's tiers and 'auto' on dropouts and band-limited damage.
// Run: `node scripts/repair.js [ms…]` (tens of minutes: AR is O(m²) in the gap length; gap lengths in ms
// limit the dropout tables, e.g. `5 20`, and skip the band-limited ones). Prints the README's
// "Measured" tables: mean SNR over the lost samples (the audio-inpainting convention, Adler et al.
// 2012) / log-spectral distance over the STFT frames overlapping them (@audio/quality lsd, 1024/256).
//
// Material: audio-lena (speech, devDependency); a sine, a C-major chord, a vibrato tone and a repeating
// song, generated here; and when present in ~/.cache/audiojs/data/repair/ as 44.1 kHz mono float32
// (<name>.f32, decoded from github.com/librosa/data): Kevin MacLeod "Vibe Ace" (vibeace) and "Dance of
// the Sugar Plum Fairy" (nutcracker), CC BY 3.0; Brahms Hungarian Dance No. 5, US Army Strings (brahms),
// public domain; Mihai Sorohan, trumpet loop (trumpet), CC BY 3.0.

import repair, { plan } from '@audio/denoise-repair'
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
let ARGS = process.argv.slice(2).map(Number).filter(v => v > 0), GAPS = ARGS.length ? ARGS : [5, 20, 50, 70, 100, 300, 1000]
for (let [name, [xs, per, margin]] of Object.entries(groups)) {
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
for (let [dmg, gen] of ARGS.length ? [] : [['cough, 300–3000 Hz', cough], ['phone ring, 350–1400 Hz', ring]]) {
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
