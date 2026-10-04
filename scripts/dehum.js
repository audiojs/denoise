// Measure @audio/denoise-dehum on mains hum added to speech, narration and music. Run: `node scripts/dehum.js [path to
// a dehum.js]` (a few minutes). Prints the README's "Measured" table: per material and hum, how far the hum goes down
// and how much of the program is lost (SDR of what became of the program against it: whole band, and per band where
// the band holds at least 1 % of the program's energy), then the hum alone, then what dehum changes in the clean
// material.
//
// dehum adapts to its input, so the two are told apart by phase inversion (Hagerman & Olofsson, Acta Acustica 90(2),
// 2004): y₊ = dehum(x + h), y₋ = dehum(x − h); (y₊ + y₋)/2 is what became of the program, (y₊ − y₋)/2 of the hum.
//
// Hum: 12 harmonics of f0 at 1/h (−6 dB per octave), random phases, each harmonic's level drifting ±10 % over ~10 s;
// f0 0.05 Hz off nominal and wandering as the grid's frequency does (ENF: a smooth random walk, ~4 s time constant,
// peaks about ±0.02 or ±0.05 Hz), scaled to 20 or 30 dB under the program's RMS.
// Material, from ~/.cache/audiojs/data: speech, 10 clean VoiceBank+DEMAND test utterances back to back (vbdemand/
// clean_testset_wav, every 80th; Valentini-Botinhao 2017, CC BY 4.0); narration, 40 s of a Spoken Wikipedia reading
// (spoken/, see scripts/speech.mjs); music, 30 s each of "Vibe Ace", Brahms' Hungarian Dance No. 5 and "Dance of the
// Sugar Plum Fairy", and the 6 s trumpet loop (repair/, see scripts/repair.js).

import { readFileSync, readdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { fft } from 'fourier-transform'

const dehum = (await import(process.argv[2] ? new URL(process.argv[2], `file://${process.cwd()}/`) : '@audio/denoise-dehum')).default
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
function hum(n, fs, f0, dev, seed) {
  let r = lcg(seed), f = slow(n, fs, r, 4), y = new Float64Array(n), ph = 0
  let lv = Array.from({ length: 12 }, () => slow(n, fs, r, 10)), th = lv.map(() => 2 * Math.PI * r())
  for (let i = 0; i < n; i++) {
    ph += 2 * Math.PI * (f0 + dev / 2 * f[i]) / fs
    for (let h = 1; h <= 12 && h * f0 < fs / 2; h++) y[i] += (1 + 0.1 * lv[h - 1][i]) / h * Math.cos(h * ph + th[h - 1])
  }
  return y
}

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

// hum down and program SDR (whole band, per band) for one material and hum; null when dehum found no hum in either mix
function run(x, fs, f0, lvl, dev, seed) {
  let h = hum(x.length, fs, f0, dev, seed), g = Math.sqrt(energy(x) / energy(h)) * 10 ** (lvl / 20)
  let xp = Float32Array.from(x, (v, i) => v + g * h[i]), xm = Float32Array.from(x, (v, i) => v - g * h[i])
  let yp = dehum(xp.slice(), { fs }), ym = dehum(xm.slice(), { fs })
  if (yp.every((v, i) => v === xp[i]) && ym.every((v, i) => v === xm[i])) return null
  let prog = Float64Array.from(x, (_, i) => (yp[i] + ym[i]) / 2), left = Float64Array.from(x, (_, i) => (yp[i] - ym[i]) / 2)
  return [10 * Math.log10(g * g * energy(h) / energy(left)), ...sdr(x, prog, fs)]
}
const cell = r => r ? `${f1(r[0])} / ${f1(r[1])}` : 'no hum found'

console.log('50 Hz hum 20 dB under the program, wandering ±0.02 Hz\n')
console.log('| material | hum down, dB | program SDR, dB | <100 Hz | 100–300 | 300–1k | 1–4k | >4k |\n|---|---:|---:|---:|---:|---:|---:|---:|')
material.forEach(([name, x, fs], m) => {
  let r = run(x, fs, 50.05, -20, 0.02, 7 + m)
  console.log(r ? `| ${name} | ${r.map(f1).join(' | ')} |` : `| ${name} | no hum found | | | | | | |`)
})
console.log('\nhum down / program SDR, dB\n\n| material | 60 Hz | 50 Hz, ±0.05 Hz | 50 Hz, 30 dB under |\n|---|---|---|---|')
material.forEach(([name, x, fs], m) => console.log(`| ${name} | ${[[59.95, -20, 0.02], [50.05, -20, 0.05], [50.05, -30, 0.02]].map(([f0, lvl, dev]) => cell(run(x, fs, f0, lvl, dev, 7 + m))).join(' | ')} |`))
for (let f0 of [50.05, 59.95]) {
  let fs = 48000, h = Float32Array.from(hum(30 * fs, fs, f0, 0.02, 3), v => v * 0.01), y = dehum(h.slice(), { fs })
  console.log(`${f0 < 55 ? '\n' : ''}Hum alone, ${f0} Hz ±0.02 Hz, 30 s: ${(10 * Math.log10(energy(h) / energy(y))).toFixed(1)} dB down`)
}
console.log('\nThe clean material through it: samples changed\n')
for (let [name, x, fs] of material) {
  let y = dehum(x.slice(), { fs }), c = 0
  for (let i = 0; i < x.length; i++) if (y[i] !== x[i]) c++
  console.log(`- ${name}: ${c}`)
}
