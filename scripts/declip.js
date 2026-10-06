// Measure @audio/denoise-declip on clipped speech and music, and on the same sound unclipped. Run:
// `node scripts/declip.js [path to a declip.js] [--spade]` (about two hours; FFmpeg's adeclip, run when ffmpeg is on the
// PATH, a few minutes of it; the A-SPADE reference, `--spade`, as many more). Prints the README's "Measured" tables:
//   1. SDR after declip, dB, by the input SDR the clipping leaves (the clip level set by bisection so the clipped sound
//      is 1…20 dB from the original: the convention of Záviška, Rajmic, Ozerov & Rencker 2021, "A survey and an
//      extensive evaluation of popular audio declipping methods", IEEE JSTSP 15(1)); each sound peak-normalized, clipped
//      at ±level, declipped with its rails found by the kernel itself; the same with FFmpeg's adeclip at its defaults,
//      and A-SPADE; each with the seconds it took per second of sound.
//   2. The survey's own test: its ten SQAM excerpts, clipped by its clip_sdr.m to 1…20 dB, ΔSDR over the clipped
//      samples, the mean of the ten beside the means the survey publishes for its leading methods.
//   3. VoiceBank+DEMAND's clean test set, every 20th utterance (42), clipped to 3, 10 and 20 dB: mean SDR after.
//   4. SDR before → after on clipped variants, the rails found by the kernel: asymmetric, one side only, clipped then
//      turned down, 16-bit, 16-bit dithered, a 16-bit converter overdriven (rails at 32767 and −32768).
//   5. Samples changed in the unclipped sound: as it is, peak-normalized to 1, 16-bit, and through a lookahead limiter
//      4× over its ceiling (a mastered sound that touches its ceiling often, never flat).
// Material, 6 s each: audio-lena (speech, devDependency) and, when present in ~/.cache/audiojs/data/repair/ (see
// scripts/repair.js), "Vibe Ace", Brahms' Hungarian Dance No. 5 and the trumpet loop. The SQAM excerpts: Sounds/*.wav
// of github.com/rajmic/declipping2020_codes, in ~/.cache/audiojs/data/declip-sqam/. VoiceBank+DEMAND (Valentini-Botinhao
// et al. 2016): clean_testset_wav/ in ~/.cache/audiojs/data/vbdemand/ (see scripts/speech.mjs). Parts whose data is
// absent are skipped.
// A-SPADE (Kitić, Bertin & Gribonval 2015) is the survey's reference sparse declipper, run as its code runs it (below).

import raw from 'audio-lena/raw'
import { fft, ifft } from 'fourier-transform'
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { spawnSync } from 'child_process'
import { homedir, tmpdir } from 'os'

const args = process.argv.slice(2), spade = args.includes('--spade'), path = args.find(a => !a.startsWith('--'))
const { default: declip } = await import(path ? new URL(path, `file://${process.cwd()}/`) : '@audio/denoise-declip')
const fs = 44100, N = 6 * fs, data = `${homedir()}/.cache/audiojs/data`
const cache = name => `${data}/repair/${name}.f32`
const track = (name, from) => existsSync(cache(name)) ? new Float32Array(readFileSync(cache(name)).buffer.slice(0)).slice(from * fs, from * fs + N) : null
const material = Object.entries({ speech: new Float32Array(raw).slice(0, N), vibeace: track('vibeace', 5), brahms: track('brahms', 5), trumpet: track('trumpet', 0) }).filter(([, x]) => x)

const peak = x => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const scale = (x, k) => Float32Array.from(x, v => v * k)
const clip = (x, hi, lo = -hi) => Float32Array.from(x, v => Math.min(hi, Math.max(lo, v)))
const sdr = (x, y, m) => { let s = 0, e = 0; for (let i = 0; i < x.length; i++) if (!m || m[i]) s += x[i] ** 2, e += (x[i] - y[i]) ** 2; return 10 * Math.log10(s / e) }
// the clip level leaving the clipped sound db from the original (clip_sdr.m: fzero over (eps, 0.99·max|x|); bisection here)
const level = (x, db) => { let a = 0, b = 0.99 * peak(x); for (let i = 0; i < 50; i++) { let m = (a + b) / 2; if (sdr(x, clip(x, m)) < db) a = m; else b = m } return Math.fround((a + b) / 2) }
const q16 = x => Float32Array.from(x, v => Math.max(-32768, Math.min(32767, Math.round(v * 32768))) / 32768)
const lcg = seed => { let s = seed; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
const dither16 = (x, r = lcg(1)) => Float32Array.from(x, v => Math.max(-32768, Math.min(32767, Math.round(v * 32768 + r() - r()))) / 32768)
const changed = (x, y) => x.reduce((c, v, i) => c + (v !== y[i]), 0)
const mean = a => a.reduce((s, v) => s + v, 0) / a.length
// 16-bit PCM mono wav → Float32Array
function wav(file) {
  let b = readFileSync(file), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), o = 12
  while (o < b.length) {
    let id = b.toString('ascii', o, o + 4), sz = dv.getUint32(o + 4, true)
    if (id === 'data') return Float32Array.from({ length: sz >> 1 }, (_, i) => dv.getInt16(o + 8 + 2 * i, true) / 32768)
    o += 8 + sz + (sz & 1)
  }
}

// a lookahead limiter: gain the moving average over 5 ms of the minimum over the next 5 ms of ceiling/|x|, released
// over 100 ms; no sample's gain exceeds its own ceiling/|x|, so a peak touches the ceiling and its neighbours follow it
function limit(x, c = 0.98) {
  let L = Math.round(0.005 * fs), rel = Math.exp(-1 / (0.1 * fs)), n = x.length, M = new Float64Array(n), y = new Float32Array(n), q = []
  for (let i = n - 1; i >= 0; i--) {
    let need = Math.min(1, c / Math.max(Math.abs(x[i]), 1e-12))
    while (q.length && q[q.length - 1][1] >= need) q.pop()
    q.push([i, need]); while (q[0][0] > i + L - 1) q.shift()
    M[i] = q[0][1]
  }
  for (let i = 1; i < n; i++) M[i] = Math.min(M[i], 1 - (1 - M[i - 1]) * rel)
  for (let i = 0, s = 0; i < n; i++) { s += M[i]; if (i >= L) s -= M[i - L]; y[i] = x[i] * s / Math.min(i + 1, L) }
  return y
}

const hasFF = !spawnSync('ffmpeg', ['-version']).error
function adeclip(y, rate = fs) {
  let dir = mkdtempSync(`${tmpdir()}/declip-`), i = `${dir}/in.f32`, o = `${dir}/out.f32`
  writeFileSync(i, Buffer.from(y.buffer, y.byteOffset, y.byteLength))
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', i, '-af', 'adeclip', '-f', 'f32le', o])
  let z = new Float32Array(readFileSync(o).buffer.slice(0)), out = new Float32Array(y.length)
  out.set(z.subarray(0, y.length)); rmSync(dir, { recursive: true })
  return out
}

// A-SPADE as the survey's code runs it (github.com/rajmic/declipping2020_codes, Methods/SPADE): blocks of 8192 at
// hop 2048, each under a peak-1 Hann window, the canonical dual window to add them back; the analysis operator a DFT of
// redundancy 2 (unitary); the k largest conjugate pairs kept, k growing by 1 every 2 iterations (s = 1, r = 2, as its
// SQAM runs), until the residual is under ε = 0.1 or every pair is kept; the iterate of least residual returned
function aspade(y, hi) {
  let w = 8192, a = w / 4, N = 2 * w, H = N / 2 + 1, nrm = Math.sqrt(N), n = y.length, L = Math.ceil(n / a) * a + 3 * a
  let yp = new Float64Array(L), out = new Float64Array(L), gs = new Float64Array(L), at = j => i => (j * a + i - w / 2 + L) % L
  let g = Float64Array.from({ length: w }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / w))
  let buf = new Float64Array(N), zr = new Float64Array(H), zi = new Float64Array(H), ur = new Float64Array(H), ui = new Float64Array(H)
  let br = new Float64Array(H), bi = new Float64Array(H), mag = new Float64Array(H), srt = new Float64Array(H), b = new Float64Array(w), x = new Float64Array(w), rec = new Float64Array(w)
  let A = () => { buf.fill(0); buf.set(x); let [R, I] = fft(buf); for (let k = 0; k < H; k++) zr[k] = R[k] / nrm, zi[k] = I[k] / nrm }
  yp.set(y)
  for (let j = 0; j < L / a; j++) for (let i = 0, t = at(j); i < w; i++) gs[t(i)] += g[i] * g[i]
  for (let j = 0; j < L / a; j++) {
    let t = at(j), cut = new Int8Array(w), any = false
    for (let i = 0; i < w; i++) { let v = yp[t(i)]; b[i] = v * g[i]; cut[i] = v >= hi ? 1 : v <= -hi ? -1 : 0; any ||= cut[i] !== 0 }
    x.set(b); rec.set(b)
    if (any) {
      ur.fill(0); ui.fill(0); A()
      for (let it = 1, k = 1, best = Infinity; ; it++) {
        for (let j = 0; j < H; j++) br[j] = zr[j] + ur[j], bi[j] = zi[j] + ui[j], mag[j] = Math.hypot(br[j], bi[j]) / (j ? 1 : 2)
        srt.set(mag); srt.sort()
        let th = k < H ? srt[H - k] : 0, obj = 0
        for (let j = 0; j < H; j++) { if (mag[j] < th) br[j] = bi[j] = 0; obj += (j && j < H - 1 ? 2 : 1) * ((zr[j] - br[j]) ** 2 + (zi[j] - bi[j]) ** 2) }
        if (Math.sqrt(obj) <= best) best = Math.sqrt(obj), rec.set(x)
        if (best <= 0.1 || k >= H) break
        for (let j = 0; j < H; j++) ur[j] -= br[j], ui[j] -= bi[j], br[j] = -ur[j], bi[j] = -ui[j]
        let v = ifft(br, bi)
        for (let i = 0; i < w; i++) x[i] = cut[i] > 0 ? Math.max(b[i], v[i] * nrm) : cut[i] < 0 ? Math.min(b[i], v[i] * nrm) : b[i]
        A()
        for (let j = 0; j < H; j++) ur[j] += zr[j], ui[j] += zi[j]
        if ((it + 1) % 2 === 0) k++
      }
    }
    for (let i = 0; i < w; i++) out[t(i)] += rec[i] * g[i] / gs[t(i)]
  }
  return Float32Array.from(y, (v, i) => out[i])
}

const targets = [1, 3, 7, 10, 15, 20], methods = [['declip', y => declip(y, { fs })]]
if (hasFF) methods.push(['FFmpeg adeclip', y => adeclip(y)])
if (spade) methods.push(['A-SPADE', (y, hi) => aspade(y, hi)])
for (let [name, run] of methods) {
  console.log(`\n${name}: SDR after, dB\n\n| input SDR | ${targets.map(t => `${t} dB`).join(' | ')} | seconds per second |\n|---|${targets.map(() => '---:').join('|')}|---:|`)
  for (let [k, x0] of material) {
    let x = scale(x0, 1 / peak(x0)), cells = [], t0 = performance.now()
    for (let t of targets) { let hi = level(x, t); cells.push(sdr(x, run(clip(x, hi), hi)).toFixed(1)) }
    console.log(`| ${k} | ${cells.join(' | ')} | ${((performance.now() - t0) / 1000 / (targets.length * N / fs)).toFixed(2)} |`)
  }
}

// the survey's means over its ten excerpts (Numerical_results/dSDR_clipped_declippingResults.mat), 1…20 dB
const survey = {
  'SS PEW (social sparsity, persistent empirical Wiener)': [12.17, 15.03, 16.61, 17.66, 19.01, 21.17, 22.21],
  'A-SPADE': [11.88, 13.88, 15.06, 15.98, 17.28, 19.43, 20.27],
  'S-SPADE': [11.38, 13.71, 15.04, 15.62, 17.11, 19.28, 19.91],
  'ℓ1, parabola-weighted (CP)': [9.95, 13.03, 14.77, 15.96, 17.44, 19.63, 21.00],
  'NMF': [5.10, 12.21, 14.27, 16.22, 18.00, 20.57, 21.96],
  'Janssen (AR)': [-0.95, -1.28, 0.62, 3.52, 7.87, 17.01, 19.57]
}
const sq = `${data}/declip-sqam`, inputs = [1, 3, 5, 7, 10, 15, 20]
if (existsSync(sq)) {
  let files = readdirSync(sq).filter(f => f.endsWith('.wav')).sort(), d = inputs.map(() => []), dt = 0, secs = 0
  for (let f of files) {
    let x = wav(`${sq}/${f}`)
    for (let [j, t] of inputs.entries()) {
      let hi = level(x, t), y = clip(x, hi), m = Uint8Array.from(y, v => Math.abs(v) >= hi), t0 = performance.now(), z = declip(y, { fs })
      dt += performance.now() - t0, secs += x.length / fs
      d[j].push(sdr(x, z, m) - sdr(x, y, m))
    }
  }
  console.log(`\nThe survey's SQAM excerpts (${files.length}): mean ΔSDR over the clipped samples, dB\n\n| input SDR | ${inputs.map(t => `${t} dB`).join(' | ')} | mean |\n|---|${inputs.map(() => '---:').join('|')}|---:|`)
  let row = (k, v) => console.log(`| ${k} | ${v.map(u => u.toFixed(1)).join(' | ')} | ${mean(v).toFixed(1)} |`)
  row('declip', d.map(mean))
  for (let [k, v] of Object.entries(survey)) row(k, v)
  console.log(`\ndeclip: ${(dt / 1000 / secs).toFixed(1)} s per second of sound, over all seven levels`)
}

const vb = `${data}/vbdemand/clean_testset_wav`
if (existsSync(vb)) {
  let files = readdirSync(vb).filter(f => f.endsWith('.wav')).sort().filter((_, i) => i % 20 === 0), cells = []
  for (let t of [3, 10, 20]) {
    let a = [], b = []
    for (let f of files) { let x0 = wav(`${vb}/${f}`), x = scale(x0, 1 / peak(x0)), hi = level(x, t), y = clip(x, hi); a.push(sdr(x, declip(y, { fs: 48000 }))); if (hasFF) b.push(sdr(x, adeclip(y, 48000))) }
    cells.push(`${t} dB → ${mean(a).toFixed(1)}${hasFF ? ` (adeclip ${mean(b).toFixed(1)})` : ''}`)
  }
  console.log(`\nVoiceBank+DEMAND's clean test set, ${files.length} utterances clipped: mean SDR after, dB: ${cells.join(', ')}`)
}

console.log('\nClipped at the 20 dB level, then: rails found → SDR, dB\n')
for (let [k, x0] of material) {
  let x = scale(x0, 1 / peak(x0)), hi = level(x, 20), lo = level(x, 10), cells = []
  for (let [v, ref, y] of [
    ['asymmetric (20 / 10 dB levels)', x, clip(x, hi, -lo)], ['one side', x, clip(x, hi, -2)],
    ['then ×0.4', scale(x, 0.4), scale(clip(x, hi), 0.4)], ['16-bit', x, q16(clip(x, hi))], ['16-bit dithered', x, dither16(clip(x, hi))],
    ['16-bit converter 2.5 dB over', scale(x, 1.33), q16(scale(x, 1.33))]
  ]) cells.push(`${v} ${sdr(ref, y).toFixed(1)} → ${sdr(ref, declip(y, { fs })).toFixed(1)}`)
  console.log(`- ${k}: ${cells.join('; ')}`)
}

console.log('\nThe unclipped sound through it: samples changed\n')
for (let [k, x0] of material) {
  let x = scale(x0, 1 / peak(x0)), cells = []
  for (let [v, y] of [['as it is', x0], ['peak 1', x], ['16-bit', q16(x)], ['limited 12 dB', limit(scale(x, 4))]]) cells.push(`${v} ${changed(y, declip(y, { fs }))}`)
  console.log(`- ${k}: ${cells.join(', ')}`)
}
