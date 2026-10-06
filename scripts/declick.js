// Measure @audio/denoise-declick on clicks added to speech and music, next to FFmpeg's `adeclick` at its defaults when
// ffmpeg is on the PATH. Run: `node scripts/declick.js [path to a declick.js]` (a few minutes). Prints the README's
// "Measured" table: per kind and size of click, how much of its error is gone (median dB, from 1 ms before the click
// to 20 ms after it, so a repair's own ringing counts: 10·log10 of the error before over the error after), the share
// gone by 10 dB or more, and adeclick's median after ·; then what each changes in the clean sound, and the same with
// each click's surroundings given as `regions` (adeclick has none).
//
// Clicks, one every 0.25–0.45 s, each peaking at k × the RMS of the clean sound within ±10 ms (k = 2, 5, 15):
//   tick    an impulse ringing at 2–8 kHz, decaying in 0.05–0.3 ms (vinyl, a dust particle)
//   pop     a damped sine at 300–1500 Hz, decaying in 0.3–1 ms (a scratch)
//   glitch  1–8 samples off (a digital error, a bad splice)
//   spike   a jump decaying over 1–3 samples, cut off after 4–8 (interference, a digital click)
//   mouth   1–3 ms of differenced noise under a Hann window (lips and tongue on a voice track)
// and dropouts: 0.02–1 ms of the sound gone to zero (a buffer underrun), where its RMS is over −40 dB.
// Material: audio-lena (speech, 10 s), and when present in ~/.cache/audiojs/data/repair/ (see scripts/repair.js):
// "Vibe Ace", Brahms' Hungarian Dance No. 5, the trumpet loop.

import raw from 'audio-lena/raw'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { spawnSync } from 'child_process'

const declick = (await import(process.argv[2] ? new URL(process.argv[2], `file://${process.cwd()}/`) : '@audio/denoise-declick')).default
const fs = 44100
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
const cache = name => `${homedir()}/.cache/audiojs/data/repair/${name}.f32`
const track = (name, from, to) => existsSync(cache(name)) ? new Float32Array(readFileSync(cache(name)).buffer.slice(0)).subarray(from * fs, to * fs) : null
const material = Object.entries({
  speech: new Float32Array(raw).subarray(0, fs * 10), vibeace: track('vibeace', 5, 15), brahms: track('brahms', 5, 15), trumpet: track('trumpet', 0, 6)
}).filter(([, x]) => x)

const kinds = {
  tick: r => { let f = 2000 + r() * 6000, t = (0.05 + r() * 0.25) * fs / 1000; return Array.from({ length: Math.ceil(5 * t) }, (_, n) => Math.exp(-n / t) * Math.cos(2 * Math.PI * f * n / fs)) },
  pop: r => { let f = 300 + r() * 1200, t = (0.3 + r() * 0.7) * fs / 1000; return Array.from({ length: Math.ceil(5 * t) }, (_, n) => Math.exp(-n / t) * Math.sin(2 * Math.PI * f * n / fs + 0.3)) },
  glitch: r => { let v = r() * 2 - 1; return Array.from({ length: 1 + Math.floor(r() * 8) }, () => v + (r() - 0.5) * 0.3) },
  spike: r => { let t = 1 + r() * 2; return Array.from({ length: 4 + Math.floor(r() * 5) }, (_, n) => Math.exp(-n / t)) },
  mouth: r => { let L = Math.round((1 + r() * 2) * fs / 1000), q = 0; return Array.from({ length: L }, (_, n) => { let w = r() * 2 - 1, y = w - q; q = w; return y * Math.sin(Math.PI * n / L) ** 2 }) }
}
const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)) }
const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0
function adeclick(x) {
  let r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', fs, '-ac', '1', '-i', 'pipe:0', '-af', 'adeclick', '-f', 'f32le', 'pipe:1'], { input: Buffer.from(x.buffer, x.byteOffset, x.byteLength), maxBuffer: 1 << 30 })
  let y = new Float32Array(x.length)
  y.set(new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length)).subarray(0, x.length))
  return y
}
const changed = (x, y) => { let e = 0, s = 0, c = 0; for (let i = 0; i < x.length; i++) { e += (y[i] - x[i]) ** 2; s += x[i] ** 2; if (y[i] !== x[i]) c++ } return [c, e ? 10 * Math.log10(e / s) : -Infinity] }

// the clicked sound, and each click's span
function clicked(clean, kind, k, seed) {
  let r = lcg(seed), x = clean.slice(), spans = []
  for (let at = Math.round(0.3 * fs); at < clean.length - 0.3 * fs; at += Math.round(fs * (0.25 + r() * 0.2))) {
    if (kind === 'dropout') {
      let L = Math.max(1, Math.round((0.02 + r() * 0.98) * fs / 1000))
      if (rms(clean, at - fs / 100, at + fs / 100) >= 0.01) x.fill(0, at, at + L), spans.push([at, at + L])
      continue
    }
    let level = rms(clean, at - fs / 100, at + fs / 100), h = kinds[kind](r), pk = Math.max(...h.map(Math.abs)), sign = r() < 0.5 ? -1 : 1
    if (level < 1e-3) continue
    for (let j = 0; j < h.length; j++) x[at + j] += sign * k * level * h[j] / pk
    spans.push([at, at + h.length])
  }
  return { x, spans }
}
// each click's surroundings as a region, 3–20 ms either side, as one would select it
const around = (spans, r) => spans.map(([a, b]) => { let l = Math.round((3 + r() * 17) * fs / 1000), h = Math.round((3 + r() * 17) * fs / 1000); return { at: (a - l) / fs, duration: (b - a + l + h) / fs } })

for (let mode of ['all', 'regions']) {
  console.log(`\n${mode === 'all' ? 'declick(data, { fs })' : 'declick(data, { fs, regions })'}\n\n| click | 2× | 5× | 15× |\n|---|---:|---:|---:|`)
  for (let kind of [...Object.keys(kinds), 'dropout']) {
    let cells = [], ff = ffmpeg && mode === 'all'
    for (let k of kind === 'dropout' ? [1] : [2, 5, 15]) {
      let gone = [], ref = []
      material.forEach(([, clean], m) => {
        let { x, spans } = clicked(clean, kind, k, 7 * k + 13 * m + kind.length), r = lcg(m + 1)
        let y = declick(x.slice(), mode === 'all' ? { fs } : { fs, regions: around(spans, r) }), z = ff && adeclick(x)
        for (let [a, b] of spans) {
          let before = 0, after = 0, other = 0
          for (let i = a - 44; i < b + 882; i++) before += (x[i] - clean[i]) ** 2, after += (y[i] - clean[i]) ** 2, other += ff ? (z[i] - clean[i]) ** 2 : 0
          gone.push(10 * Math.log10(before / (after || 1e-20))), ref.push(10 * Math.log10(before / (other || 1e-20)))
        }
      })
      let med = v => v.sort((p, q) => p - q)[v.length >> 1].toFixed(1)
      cells.push(`${med(gone)} dB · ${Math.round(100 * gone.filter(v => v >= 10).length / gone.length)}%${ff ? ' · ' + med(ref) : ''}`)
    }
    console.log(`| ${kind} | ${cells.join(' | ')} |`)
  }
  console.log('\nThe clean sound through it: samples changed, error to the sound\n')
  for (let [name, clean] of material) {
    let r = lcg(9), regions = mode === 'all' ? undefined : Array.from({ length: Math.floor(clean.length / fs / 0.4) - 1 }, (_, i) => ({ at: 0.3 + i * 0.4, duration: (3 + r() * 40) / 1000 }))
    let [c, db] = changed(clean, declick(clean.slice(), { fs, regions })), [c2, db2] = ffmpeg && mode === 'all' ? changed(clean, adeclick(clean)) : []
    console.log(`- ${name}: ${c} samples, ${c ? db.toFixed(1) + ' dB' : 'none'}${c2 != null ? ` · adeclick ${c2} samples, ${db2.toFixed(1)} dB` : ''}`)
  }
}
