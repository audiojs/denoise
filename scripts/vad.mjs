// The node side of scripts/vad.py: desilence (shorten, defaults) and debreath (defaults) over mono f32 files.
//   node scripts/vad.mjs FS LIST.json OUT.json [DESILENCE_JS DEBREATH_JS]
// LIST: the input paths. OUT: per file, the spans desilence keeps (s) and debreath's gain per 10 ms frame (dB). The
// kernels are the workspace's packages unless other paths are given: another version, to measure the change.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

let [fs, list, out, ds, db] = process.argv.slice(2)
fs = +fs
let load = (p, name) => import(p ? pathToFileURL(p).href : name).then(m => m.default)
let desilence = await load(ds, '@audio/denoise-desilence'), debreath = await load(db, '@audio/denoise-debreath')
let n = fs / 100
let res = JSON.parse(readFileSync(list)).map(p => {
  let b = readFileSync(p), x = Float32Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2))
  let kept = desilence(x, { fs }).segments
  let y = debreath(x.slice(), { fs }), m = Math.floor(x.length / n), gain = []
  for (let k = 0; k < m; k++) {
    let a = 1e-20, c = 1e-20
    for (let i = k * n; i < (k + 1) * n; i++) { a += x[i] * x[i]; c += y[i] * y[i] }
    gain.push(Math.round(1000 * Math.log10(c / a)) / 100)
  }
  return { kept, gain }
})
writeFileSync(out, JSON.stringify(res))
