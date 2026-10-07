// Measure @audio/denoise-dehum on mains hum and buzz added to speech, narration and music. Run: `node scripts/dehum.js
// [path to a dehum.js] [path to another]` (several minutes per build): with two, each cell reads "first → second".
// Prints the README's "Measured" tables: per material and hum, how far the hum goes down and how much of the program
// is lost (SDR of what became of the program against it), an edited take, level steps, the hum alone, and what dehum
// changes in the clean material.
//
// dehum adapts to its input, so the two are told apart by phase inversion (Hagerman & Olofsson, Acta Acustica 90(2),
// 2004): y₊ = dehum(x + h), y₋ = dehum(x − h); (y₊ + y₋)/2 is what became of the program, (y₊ − y₋)/2 of the hum.
//
// Hum: f0 0.05 Hz off nominal and wandering as the grid's frequency does (ENF: a smooth random walk, ~4 s time constant,
// peaks about ±dev), each harmonic's level drifting ±10 % over ~10 s, random phases, scaled to 20 or 30 dB under the
// program's RMS. Mains: 12 harmonics at 1/h (−6 dB per octave). Buzz: odd-heavy to 8 kHz, odd h at h^−½, even at
// 0.3·h^−½, a first-order rolloff at 3 kHz (the rectifier and ground-loop buzz of unbalanced interconnects: Whitlock,
// Jensen AN-004, 1995).
// Material, from ~/.cache/audiojs/data: speech, 10 clean VoiceBank+DEMAND test utterances back to back (vbdemand/
// clean_testset_wav, every 80th; Valentini-Botinhao 2017, CC BY 4.0); narration, 40 s of a Spoken Wikipedia reading
// (spoken/, see scripts/speech.mjs); music, 30 s each of "Vibe Ace", Brahms' Hungarian Dance No. 5 and "Dance of the
// Sugar Plum Fairy", and the 5 s trumpet loop (repair/, see scripts/repair.js).

import { readFileSync, readdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { fft } from 'fourier-transform'

const builds = process.argv.length > 2 ? process.argv.slice(2) : ['@audio/denoise-dehum']
const fns = await Promise.all(builds.map(async p => (await import(p.startsWith('@') ? p : new URL(p, `file://${process.cwd()}/`))).default))
const D = `${homedir()}/.cache/audiojs/data`
const f32 = p => new Float32Array(readFileSync(p).buffer.slice(0))
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
const gauss = r => { let u = r() || 1e-12; return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()) }
// 16-bit PCM WAV, mono
function wav(file) {
  let b = readFileSync(file), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), o = 12
  while (o < b.length) {
    let id = b.toString('ascii', o, o + 4), len = dv.getUint32(o + 4, true)
    if (id === 'data') return Float32Array.from({ length: len / 2 }, (_, i) => dv.getInt16(o + 8 + 2 * i, true) / 32768)
    o += 8 + len + (len & 1)
  }
}
const energy = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s }

// ---- material
const material = []
if (existsSync(`${D}/vbdemand/clean_testset_wav`)) {
  let parts = readdirSync(`${D}/vbdemand/clean_testset_wav`).filter(f => f.endsWith('.wav')).sort().filter((_, i) => i % 80 === 0).slice(0, 10).map(f => wav(`${D}/vbdemand/clean_testset_wav/${f}`))
  let x = new Float32Array(parts.reduce((s, p) => s + p.length, 0)), o = 0
  for (let p of parts) x.set(p, o), o += p.length
  material.push(['speech', x, 48000])
}
if (existsSync(`${D}/spoken/2014-Abbot_Augustus_Low.f32`)) material.push(['narration', f32(`${D}/spoken/2014-Abbot_Augustus_Low.f32`).subarray(0, 40 * 48000), 48000])
for (let [k, s] of [['vibeace', 5], ['brahms', 5], ['nutcracker', 5], ['trumpet', 0]])
  if (existsSync(`${D}/repair/${k}.f32`)) material.push([k, f32(`${D}/repair/${k}.f32`).subarray(s * 44100, (s + 30) * 44100), 44100])

// ---- hum
// a smooth random process at 100 Hz (white noise through two one-pole lowpasses, time constant tc s), unit variance
function slow(n, fs, r, tc) {
  let m = Math.ceil(n / fs * 100) + 2, a = Math.exp(-1 / (tc * 100)), u = 0, v = 0, s = new Float64Array(m), e = 0
  for (let i = -2000; i < m; i++) { u = a * u + (1 - a) * gauss(r); v = a * v + (1 - a) * u; if (i >= 0) s[i] = v, e += v * v }
  let g = Math.sqrt(m / e), out = new Float64Array(n)
  for (let i = 0; i < n; i++) { let t = i / fs * 100, j = Math.floor(t); out[i] = g * (s[j] + (t - j) * (s[j + 1] - s[j])) }
  return out
}
// the harmonics by recursion, e^(jhφ) = e^(jφ)^h
function hum(n, fs, f0, dev, seed, buzz = false) {
  let r = lcg(seed), f = slow(n, fs, r, 4), y = new Float64Array(n), ph = 0, amp = []
  for (let h = 1; buzz ? h * f0 <= Math.min(8000, fs / 2 - 1000) : h <= 12; h++) amp.push(buzz ? (h % 2 ? 1 : 0.3) / Math.sqrt(h) / Math.hypot(1, h * f0 / 3000) : 1 / h)
  let H = amp.length, lv = amp.map(() => slow(n, fs, r, 10)), th = amp.map(() => 2 * Math.PI * r()), cr = th.map(Math.cos), ci = th.map(Math.sin)
  for (let i = 0; i < n; i++) {
    ph += 2 * Math.PI * (f0 + dev / 2 * f[i]) / fs
    let zr = Math.cos(ph), zi = Math.sin(ph), wr = zr, wi = zi, s = 0
    for (let k = 0; k < H; k++) { s += amp[k] * (1 + 0.1 * lv[k][i]) * (wr * cr[k] - wi * ci[k]); let t = wr * zr - wi * zi; wi = wr * zi + wi * zr; wr = t }
    y[i] = s
  }
  return y
}
const scaled = (x, h, lvl) => { let g = Math.sqrt(energy(x) / energy(h)) * 10 ** (lvl / 20); return h.map(v => v * g) }

// ---- metrics
// SDR of y against x in dB: whole band and per band (one transform over the signal)
const EDGES = [0, 100, 300, 1000, 4000, 24000]
function sdr(x, y, fs) {
  let N = 2 ** Math.ceil(Math.log2(x.length)), a = new Float64Array(N), b = new Float64Array(N), out = [10 * Math.log10(energy(x) / energy(Float64Array.from(x, (v, i) => y[i] - v)))]
  a.set(x); for (let i = 0; i < x.length; i++) b[i] = y[i] - x[i]
  let [ar, ai] = fft(a).map(v => Float64Array.from(v)), [br, bi] = fft(b)   // the transform reuses its buffers
  for (let j = 0; j + 1 < EDGES.length; j++) {
    let s = 0, e = 0
    for (let k = Math.floor(EDGES[j] * N / fs); k < Math.min(N / 2, EDGES[j + 1] * N / fs); k++) s += ar[k] ** 2 + ai[k] ** 2, e += br[k] ** 2 + bi[k] ** 2
    out.push(s > 0.01 * energy(x) * N / 2 ? 10 * Math.log10(s / e) : NaN)       // a band with under 1 % of the program: –
  }
  return out
}
const f1 = v => v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(1) : '–'
const both = (rs, fmt) => rs.map(fmt).join(' → ')

// hum down and program SDR (whole band, per band) for one material and hum h; null when dehum found no hum in either
function run(dehum, x, fs, h) {
  let xp = Float32Array.from(x, (v, i) => v + h[i]), xm = Float32Array.from(x, (v, i) => v - h[i])
  let yp = dehum(xp.slice(), { fs }), ym = dehum(xm.slice(), { fs })
  if (yp.every((v, i) => v === xp[i]) && ym.every((v, i) => v === xm[i])) return null
  let prog = Float64Array.from(x, (_, i) => (yp[i] + ym[i]) / 2), left = Float64Array.from(x, (_, i) => (yp[i] - ym[i]) / 2)
  return [10 * Math.log10(energy(h) / energy(left)), ...sdr(x, prog, fs)]
}
const cell = r => r ? `${f1(r[0])} / ${f1(r[1])}` : 'no hum found'

console.log('50 Hz hum 20 dB under the program, wandering ±0.02 Hz; program SDR per band where the band holds 1 % of the program\n')
console.log('| material | hum down, dB | program SDR, dB | <100 Hz | 100–300 | 300–1k | 1–4k | >4k |\n|---|---:|---:|---:|---:|---:|---:|---:|')
material.forEach(([name, x, fs], m) => {
  let h = scaled(x, hum(x.length, fs, 50.05, 0.02, 7 + m), -20), rs = fns.map(d => run(d, x, fs, h))
  console.log(`| ${name} | ${[0, 1, 2, 3, 4, 5, 6].map(j => both(rs, r => r ? f1(r[j]) : 'no hum found')).join(' | ')} |`)
})
const COLS = [['60 Hz', 59.95, -20, 0.02], ['50 Hz, ±0.05 Hz', 50.05, -20, 0.05], ['50 Hz, 30 dB under', 50.05, -30, 0.02], ['60 Hz buzz to 8 kHz', 59.95, -20, 0.05, true], ['50 Hz buzz, ±0.2 Hz', 50.05, -20, 0.2, true]]
console.log(`\nhum down / program SDR, dB\n\n| material | ${COLS.map(c => c[0]).join(' | ')} |\n|---|${COLS.map(() => '---').join('|')}|`)
material.forEach(([name, x, fs], m) => console.log(`| ${name} | ${COLS.map(([, f0, lvl, dev, buzz]) => { let h = scaled(x, hum(x.length, fs, f0, dev, 7 + m, buzz), lvl); return both(fns.map(d => run(d, x, fs, h)), cell) }).join(' | ')} |`))

for (let [f0, buzz] of [[50.05, false], [59.95, false], [59.95, true]]) {
  let fs = 48000, h = Float32Array.from(hum(30 * fs, fs, f0, 0.02, 3, buzz), v => v * 0.01)
  console.log(`${f0 < 55 ? '\n' : ''}${buzz ? 'Buzz to 8 kHz' : 'Hum'} alone, ${f0} Hz ±0.02 Hz, 30 s: ${both(fns, d => (10 * Math.log10(energy(h) / energy(d(h.slice(), { fs })))).toFixed(1))} dB down`)
}

// An edited take: eight stretches cut out, from a pause to a pause (speech: the quietest 50 ms within 0.5 s of each
// spot) or anywhere (music); the hum ran on while they were, so its phase jumps at each cut. Level steps: the hum's
// level stepping four times among off, −10, −5, 0 and +5 dB (10 ms ramps). Hum down within 1 s of a cut or step and
// elsewhere, and the program SDR, by phase inversion as above
function changed(dehum, x0, fs, pauses, steps) {
  let r = lcg(3), quiet = t => {
    if (!pauses) return Math.round(t * fs)
    let best = 0, bv = Infinity
    for (let i = Math.round((t - 0.5) * fs); i < (t + 0.5) * fs; i += fs / 100) { let e = energy(x0, i, i + fs / 20); if (e < bv) bv = e, best = i + fs / 40 }
    return best
  }
  let h0 = hum(x0.length, fs, 50.05, 0.02, 5), g = Math.sqrt(energy(x0) / energy(h0)) * 0.1, x, h, near, n
  if (steps) {
    n = x0.length; x = x0; h = h0.map(v => v * g); near = new Uint8Array(n)
    let t = [0], lv = [0], ramp = Math.round(0.01 * fs), gain = l => 10 ** (l / 20)
    for (let k = 0; k < 4; k++) t.push(Math.round((k + 0.6 + 0.6 * r()) * n / 4.6)), lv.push([-Infinity, -10, -5, 0, 5][Math.floor(r() * 5)])
    for (let i = 0, k = 0; i < n; i++) {
      while (k + 1 < t.length && i >= t[k + 1]) k++
      let v = gain(lv[k]), u = i - t[k]
      if (k > 0 && u < ramp) { let w = 0.5 - 0.5 * Math.cos(Math.PI * u / ramp); v = (1 - w) * gain(lv[k - 1]) + w * v }
      h[i] *= v
    }
    for (let k = 1; k < t.length; k++) near.fill(1, Math.max(0, t[k] - fs), Math.min(n, t[k] + fs))
  } else {
    let keep = [], at = 0, T = x0.length / fs / 60
    for (let k = 0; k < 8; k++) {
      let t = (4 + k * 6.5 + r() * 2) * T, c = quiet(t), e = pauses ? quiet(t + 1.2 + 0.8 * r()) : c + Math.round((0.1 + 0.4 * r()) * fs)
      keep.push([at, c]); at = Math.max(e, c + fs / 20)
    }
    keep.push([at, x0.length])
    n = keep.reduce((s, [a, b]) => s + b - a, 0); x = new Float32Array(n); h = new Float64Array(n); near = new Uint8Array(n)
    let o = 0
    for (let [a, b] of keep) { x.set(x0.subarray(a, b), o); for (let i = a; i < b; i++) h[o + i - a] = g * h0[i]; o += b - a; if (b < x0.length) near.fill(1, Math.max(0, o - fs), Math.min(n, o + fs)) }
  }
  let yp = dehum(Float32Array.from(x, (v, i) => v + h[i]), { fs }), ym = dehum(Float32Array.from(x, (v, i) => v - h[i]), { fs }), e = [0, 0, 0, 0], pe = 0
  for (let i = 0; i < n; i++) { e[near[i]] += h[i] ** 2; e[2 + near[i]] += ((yp[i] - ym[i]) / 2) ** 2; pe += ((yp[i] + ym[i]) / 2 - x[i]) ** 2 }
  return [10 * Math.log10(e[1] / e[3]), 10 * Math.log10(e[0] / e[2]), 10 * Math.log10(energy(x) / pe)]
}
for (let steps of [false, true]) {
  console.log(steps ? '\nLevel steps, 50 Hz hum 20 dB under, ±0.02 Hz: hum down within 1 s of a step / elsewhere, program SDR, dB\n' : '\nAn edited take, eight cuts, 50 Hz hum 20 dB under, ±0.02 Hz: hum down within 1 s of a cut / elsewhere, program SDR, dB\n')
  console.log(`| material | within 1 s | elsewhere | program SDR |\n|---|---:|---:|---:|`)
  for (let [name, x, fs] of material.filter(([name]) => name !== 'vibeace' && name !== 'trumpet')) {
    let rs = fns.map(d => changed(d, x, fs, name === 'speech' || name === 'narration', steps))
    console.log(`| ${name} | ${[0, 1, 2].map(j => both(rs, r => r[2] > 100 ? 'no hum found' : f1(r[j]))).join(' | ')} |`)
  }
}

console.log('\nThe clean material through it: samples changed\n')
for (let [name, x, fs] of material) console.log(`- ${name}: ${both(fns, d => { let y = d(x.slice(), { fs }), c = 0; for (let i = 0; i < x.length; i++) if (y[i] !== x[i]) c++; return c })}`)
