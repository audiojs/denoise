// Measure @audio/denoise-decrackle on crackle added to speech, music and song, next to FFmpeg's `adeclick` at its
// defaults when ffmpeg is on the PATH. Run: `node scripts/decrackle.js [threshold] [path to a decrackle.js]` (a few
// minutes; the threshold decrackle is given, its default if none; an earlier version's kernel if a path).
// Prints the README's "Measured" table: per density and size of crackle, the SDR of the input and of each output to
// the clean sound (10·log10 Σ clean² / Σ (out − clean)², dB), the mean over the material; each material's own row
// after it; then what each changes in the clean sound (the share of samples moved, the error to the sound) and the
// time it takes.
//
// Crackle (as a worn record's): impulses at Poisson times, 50, 200 or 1000 a second; half of them 1–3 samples off,
// half ticks ringing at 2–8 kHz and decaying in 0.03–0.15 ms; each peaking at A/5–A × the clean sound's RMS
// (log-uniform, either sign), A = 0.5, 2 or 8. 6 s of each material.
// Material: audio-lena (speech, devDependency); when present in ~/.cache/audiojs/data/: 8 VoiceBank+DEMAND clean test
// utterances (vbdemand/clean_testset_wav, 48 kHz; Valentini-Botinhao 2017, CC BY 4.0), "Vibe Ace", Brahms' Hungarian
// Dance No. 5 and the trumpet loop (repair/, 44.1 kHz, see scripts/repair.js), and a sung vibrato from VocalSet
// (vocalset/FULL/male1/excerpts/vibrato/m1_caro_vibrato.wav, 44.1 kHz; Wilkins et al. 2018, CC BY 4.0).

import raw from 'audio-lena/raw'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { spawnSync } from 'child_process'

const args = process.argv.slice(2), threshold = +args.find(a => !isNaN(a)) || undefined, path = args.find(a => isNaN(a))
const kernel = (await import(path ? new URL(path, `file://${process.cwd()}/`) : '@audio/denoise-decrackle')).default
const decrackle = (x, o) => kernel(x, { ...o, threshold })
const data = `${homedir()}/.cache/audiojs/data`
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
const db = v => 10 * Math.log10(v)
const rms = x => { let s = 0; for (let v of x) s += v * v; return Math.sqrt(s / x.length) }

// 16-bit PCM mono WAV
function wav(path) {
  let b = readFileSync(path), o = 12, fs = 0
  while (b.toString('ascii', o, o + 4) !== 'data') { if (b.toString('ascii', o, o + 4) === 'fmt ') fs = b.readUInt32LE(o + 12); o += 8 + b.readUInt32LE(o + 4) }
  let n = b.readUInt32LE(o + 4) / 2, x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(o + 8 + 2 * i) / 32768
  return { x, fs }
}
const f32 = (name, from, to) => { let p = `${data}/repair/${name}.f32`; return existsSync(p) && { x: new Float32Array(readFileSync(p).buffer.slice(0)).subarray(from * 44100, to * 44100), fs: 44100 } }
function voicebank() {
  let dir = `${data}/vbdemand/clean_testset_wav`
  if (!existsSync(dir)) return null
  let parts = readdirSync(dir).filter(f => f.endsWith('.wav')).sort().filter((_, i) => i % 97 === 0).slice(0, 8).map(f => wav(`${dir}/${f}`).x)
  let x = new Float32Array(parts.reduce((s, p) => s + p.length, 0)), o = 0
  for (let p of parts) x.set(p, o), o += p.length
  return { x, fs: 48000 }
}
const sung = () => { let p = `${data}/vocalset/FULL/male1/excerpts/vibrato/m1_caro_vibrato.wav`; return existsSync(p) && wav(p) }
const material = Object.entries({
  speech: { x: new Float32Array(raw), fs: 44100 }, voicebank: voicebank(), vibeace: f32('vibeace', 5, 15), brahms: f32('brahms', 5, 15),
  trumpet: f32('trumpet', 0, 6), sung: sung()
}).filter(([, m]) => m).map(([name, { x, fs }]) => [name, x.subarray(0, 6 * fs), fs])

function crackle(clean, fs, rate, A, seed) {
  let r = lcg(seed), x = clean.slice(), g = rms(clean)
  for (let at = 0; ; ) {
    at += Math.max(1, Math.round(-Math.log(r() || 1e-9) / rate * fs))
    if (at > clean.length - 64) break
    let amp = g * A * Math.exp(Math.log(1 / 5) * r()) * (r() < 0.5 ? -1 : 1), h
    if (r() < 0.5) h = Array.from({ length: 1 + Math.floor(r() * 3) }, () => 1 - r() * 0.3)
    else { let f = 2000 + r() * 6000, t = (0.03 + r() * 0.12) * fs / 1000; h = Array.from({ length: Math.ceil(5 * t) }, (_, n) => Math.exp(-n / t) * Math.cos(2 * Math.PI * f * n / fs)) }
    for (let j = 0; j < h.length; j++) x[at + j] += amp * h[j]
  }
  return x
}
const sdr = (clean, y) => { let s = 0, e = 0; for (let i = 0; i < clean.length; i++) s += clean[i] ** 2, e += (y[i] - clean[i]) ** 2; return db(s / e) }
const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0
function adeclick(x, fs) {
  let r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', fs, '-ac', '1', '-i', 'pipe:0', '-af', 'adeclick', '-f', 'f32le', 'pipe:1'], { input: Buffer.from(x.buffer, x.byteOffset, x.byteLength), maxBuffer: 1 << 30 })
  let y = new Float32Array(x.length)
  y.set(new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length)).subarray(0, x.length))
  return y
}

const rates = [50, 200, 1000], sizes = [['small', 0.5, '0.1–0.5×'], ['medium', 2, '0.4–2×'], ['loud', 8, '1.6–8×']]
const mean = a => a.reduce((s, v) => s + v, 0) / a.length
let rows = {}, t = 0, secs = 0
for (let [size, A] of sizes) for (let rate of rates) material.forEach(([name, clean, fs], m) => {
  let x = crackle(clean, fs, rate, A, 31 * rate + 7 * m + A), t0 = performance.now(), y = decrackle(x.slice(), { fs })
  t += performance.now() - t0, secs += clean.length / fs
  ;((rows[size] ??= {})[rate] ??= []).push([name, sdr(clean, x), sdr(clean, y), ffmpeg ? sdr(clean, adeclick(x, fs)) : NaN])
})
const cell = r => `${mean(r.map(c => c[1])).toFixed(1)} → ${mean(r.map(c => c[2])).toFixed(1)}${ffmpeg ? ' · ' + mean(r.map(c => c[3])).toFixed(1) : ''}`
console.log(`\nSDR to the clean sound, dB: input → decrackle${ffmpeg ? ' · adeclick' : ''}, mean of ${material.map(m => m[0]).join(', ')}\n`)
console.log(`| crackle, peaks × RMS | ${rates.map(r => `${r}/s`).join(' | ')} |\n|---|${rates.map(() => '---:').join('|')}|`)
for (let [size, , range] of sizes) console.log(`| ${size} (${range}) | ${rates.map(r => cell(rows[size][r])).join(' | ')} |`)
console.log('\neach material')
for (let [size] of sizes) for (let rate of rates) console.log(`  ${size} ${rate}/s: ${rows[size][rate].map(c => `${c[0]} ${c[1].toFixed(1)} → ${c[2].toFixed(1)}${ffmpeg ? ' · ' + c[3].toFixed(1) : ''}`).join(', ')}`)

console.log(`\nThe clean sound through it: samples changed, error to the sound${ffmpeg ? ' (adeclick after ·)' : ''}\n`)
const moved = (x, y) => { let c = 0, e = 0, s = 0; for (let i = 0; i < x.length; i++) { if (y[i] !== x[i]) c++; e += (y[i] - x[i]) ** 2; s += x[i] ** 2 } return `${(100 * c / x.length).toFixed(2)}%${c ? ', ' + db(e / s).toFixed(1) + ' dB' : ''}` }
for (let [name, clean, fs] of material) console.log(`- ${name}: ${moved(clean, decrackle(clean.slice(), { fs }))}${ffmpeg ? ' · ' + moved(clean, adeclick(clean, fs)) : ''}`)
console.log(`\n${(t / 1000 / secs * 10).toFixed(2)} s per 10 s of crackled sound`)
