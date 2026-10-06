// Measure @audio/denoise-debleed on bleed made from real recordings. Run: `node scripts/debleed.js [tune|test]
// [static|moving]` (default: test, both; about 20 minutes a half on one core; SYSTEMS=debleed,stream runs those
// alone). Prints the README's tables; writes the speech outputs for `python scripts/debleed.py`, which scores them
// (PESQ, STOI).
//
// The bleed: a wanted sound w and another source r, each at one active level (RMS over 50 ms frames within 30 dB of
// the loudest), the mic hearing y = w + g·(h ∗ r) + its own noise (−65 dB), where h is a room response from the MIT
// IR Survey (Traer & McDermott, PNAS 2016; even-numbered responses for tuning, odd for the test), its lead-in cut to
// 1 ms before the direct sound, unit energy, delayed 1–30 ms; g = −30, −18 or −6 dB. The op gets r as its own track
// recorded it: another gain (±6 dB), a ±3 dB tilt around 1 kHz, its own noise (−50 dB). `static`: that path held;
// `moving`: the source sways (the delay ±0.5 ms over 6–10 s), the gain drifts ±1.5 dB over 8–12 s, and the room
// changes, 30 % of a second response crossfaded in over the take. Material, 14 s each, three of each per bleed level:
//   cohost  a voice in the mic, another speaker's voice bleeding (VoiceBank, Valentini-Botinhao 2017, CC BY 4.0: the
//           training subset's speakers for tuning, p232 and p257 of the test set for the test; a Spoken Wikipedia
//           narration, CC BY-SA, for every second wanted voice)
//   click   a click track into a voice mic (1.5 kHz, 2.2 kHz on the downbeat, 5 ms decay, 90–140 BPM)
//   drums   MUSDB18 drums into the vocal mic (Rafii et al. 2017, the 7 s previews, two back to back: train / test)
//   other   MUSDB18's "other" stem (guitars, keys) into the vocal mic
//
// Systems, each run on (y, r) and on (w − bleed, −r): by phase inversion (Hagerman & Olofsson, Acta Acustica 2004)
// ŵ = (y₊ + y₋)/2 is the wanted sound as the op left it and b̂ = (y₊ − y₋)/2 the bleed it left:
//   debleed         the batch call (two passes); `stream`: the streaming call, one pass, learning as it goes
//   subtract        the reference time-aligned (GCC-PHAT, the delay of Clifford & Reiss, DAFx 2011) at the
//                   least-squares gain, subtracted
//   ref-wiener      a Wiener gain against the reference's power through |H|² read from the whole take's cross- and
//                   auto-spectra and a 0.5 s decay (the form of Kokkinis, Reiss & Mourjopoulos, IEEE TASLP 20(3),
//                   2012), floored at −20 dB, 2048-point frames
//   speex, webrtc   when SPEEX and WEBRTC name commands that take `mic.f32 ref.f32 out.f32 rate` (float32 mono):
//                   Speex's MDF echo canceller with its residual-echo suppressor (speexdsp 1.2.1, 20 ms frames,
//                   0.3 s tail), WebRTC's AEC3 (LiveKit's AudioProcessingModule); their own delay removed by the
//                   lag of the output's peak correlation with the mic
// Measures: bleed removed, 10·log10(Σb² / Σb̂²); the wanted sound kept, SI-SDR of ŵ against w (Le Roux et al.,
// ICASSP 2019) per band; musical noise, the log kurtosis ratio ln(kurt(b̂)/kurt(b)) of the power spectral values in
// frames where the bleed sounds (Uemura et al., IWAENC 2008; 0 for a gain that scales, > 0 for isolated peaks); and
// the wanted sound alone, its reference present but never heard by the mic: the error the op adds (dB).

import debleed from '@audio/denoise-debleed'
import { fft, ifft } from 'fourier-transform'
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const DATA = path.join(os.homedir(), '.cache', 'audiojs', 'data'), CACHE = path.join(DATA, 'debleed')
const [half = 'test', only] = process.argv.slice(2).filter(a => !a.includes('/'))
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
const f32 = p => { let b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
const db = x => 10 * Math.log10(x)
function wav(file) {
  let b = readFileSync(file), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), o = 12
  while (o < b.length) {
    let id = b.toString('ascii', o, o + 4), len = dv.getUint32(o + 4, true)
    if (id === 'data') return Float32Array.from({ length: len / 2 }, (_, i) => dv.getInt16(o + 8 + 2 * i, true) / 32768)
    o += 8 + len + (len & 1)
  }
}
const ffmpeg = (args, out) => { if (!existsSync(out)) { mkdirSync(path.dirname(out), { recursive: true }); spawnSync('ffmpeg', ['-v', 'error', '-y', ...args, '-f', 'f32le', out]) } return f32(out) }

// ---- signal helpers
function active(x, fs) {
  let L = Math.round(0.05 * fs), p = []
  for (let i = 0; i + L <= x.length; i += L) { let s = 0; for (let j = i; j < i + L; j++) s += x[j] * x[j]; p.push(s / L) }
  let mx = Math.max(...p), a = p.filter(v => v > mx * 1e-3)
  return Math.sqrt(a.reduce((s, v) => s + v, 0) / a.length)
}
const scaled = (x, k) => x.map(v => v * k)
function conv(x, h) {   // overlap-add through the real FFT
  let n = 1; while (n < 2 * h.length) n <<= 1
  let B = n - h.length + 1, y = new Float64Array(x.length + n), t = new Float64Array(n)
  t.set(h); let [hr, hi] = fft(t).map(v => Float64Array.from(v))
  for (let a = 0; a < x.length; a += B) {
    t.fill(0); t.set(x.subarray(a, Math.min(x.length, a + B)))
    let [re, im] = fft(t), zr = new Float64Array(n / 2 + 1), zi = new Float64Array(n / 2 + 1)
    for (let k = 0; k <= n / 2; k++) { zr[k] = re[k] * hr[k] - im[k] * hi[k]; zi[k] = re[k] * hi[k] + im[k] * hr[k] }
    let o = ifft(zr, zi); for (let i = 0; i < n; i++) y[a + i] += o[i]
  }
  return Float32Array.from(y.subarray(0, x.length))
}
function vdelay(x, d) {   // x(t − d(t)), Catmull-Rom
  let at = i => i >= 0 && i < x.length ? x[i] : 0
  return Float32Array.from(x, (_, i) => { let t = i - d(i), k = Math.floor(t), f = t - k, p0 = at(k - 1), p1 = at(k), p2 = at(k + 1), p3 = at(k + 2)
    return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0))) })
}
function tilt(x, t, fs) {   // ±t/2 dB either side of 1 kHz, one-pole split
  let a = Math.exp(-2 * Math.PI * 1000 / fs), lo = 0, gl = 10 ** (-t / 40), gh = 10 ** (t / 40)
  return x.map(v => { lo = (1 - a) * v + a * lo; return gl * lo + gh * (v - lo) })
}
const noise = (n, r, k) => Float32Array.from({ length: n }, () => k * 2 * (r() + r() + r() - 1.5))

// ---- sources
const IRS = () => readdirSync(path.join(DATA, 'mit-ir', 'Audio')).filter(f => f.endsWith('.wav')).sort()
function ir(i, fs) {
  let f = IRS()[i], h = ffmpeg(['-i', path.join(DATA, 'mit-ir', 'Audio', f), '-ac', '1', '-ar', String(fs)], path.join(CACHE, 'ir', `${i}-${fs}.f32`)), pk = 0
  for (let k = 0; k < h.length; k++) if (Math.abs(h[k]) > Math.abs(h[pk])) pk = k
  h = h.slice(Math.max(0, pk - Math.round(fs / 1000)))
  let e = Math.sqrt(h.reduce((s, v) => s + v * v, 0)); return scaled(h, 1 / e)
}
const vbDir = () => half === 'tune' ? path.join(DATA, 'vbdemand-train', 'clean') : path.join(DATA, 'vbdemand', 'clean_testset_wav')
const speakers = () => { let s = {}; for (let f of readdirSync(vbDir()).filter(f => f.endsWith('.wav')).sort()) (s[f.split('_')[0]] ??= []).push(f); return s }
function talk(spk, dur, r, gap, skip) {   // a speaker's utterances in turn, each followed by a gap, at 48 kHz
  let files = speakers()[spk], n = Math.round(dur * 48000), y = new Float32Array(n), at = Math.round(r() * gap[1] * 48000)
  for (let i = skip; at < n; i++) {
    let x = wav(path.join(vbDir(), files[i % files.length]))
    y.set(x.subarray(0, Math.min(x.length, n - at)), at); at += x.length + Math.round((gap[0] + r() * (gap[1] - gap[0])) * 48000)
  }
  return y
}
function narration(i, from, dur) {
  let dir = path.join(DATA, half === 'tune' ? 'spoken-train' : 'spoken'), f = readdirSync(dir).filter(f => f.endsWith('.f32')).sort()
  return f32(path.join(dir, f[i % f.length])).slice(from * 48000, (from + dur) * 48000)
}
const MUS = { drums: 1, other: 3, vocals: 4 }
function stem(i, kind) {   // MUSDB18 preview i of the half, one stem, mono 44.1 kHz
  let dir = path.join(DATA, 'musdb', half === 'tune' ? 'train' : 'test'), f = readdirSync(dir).filter(f => f.endsWith('.stem.mp4')).sort()[i]
  return ffmpeg(['-i', path.join(dir, f), '-map', `0:${MUS[kind]}`, '-ac', '1', '-ar', '44100'], path.join(CACHE, 'musdb', `${half}-${i}-${kind}.f32`))
}
function clicks(dur, fs, r) {
  let T = 60 / (90 + r() * 50) * fs, n = Math.round(dur * fs), y = new Float32Array(n)
  for (let b = 0, t = Math.round(r() * T); t < n; b++, t = Math.round(b * T)) {
    let f = b % 4 ? 1500 : 2200
    for (let j = 0; j < 0.03 * fs && t + j < n; j++) y[t + j] += 0.5 * Math.exp(-j / (0.005 * fs)) * Math.sin(2 * Math.PI * f * j / fs)
  }
  return y
}

// ---- the bleed: wanted w and source r at one active level; the mic's take, the reference as recorded
function bleed({ w, r, fs, gain, delay, irA, irB, seed }, moving) {
  let R = lcg(seed), n = Math.min(w.length, r.length)
  w = scaled(w.subarray(0, n), 0.05 / active(w.subarray(0, n), fs)); r = scaled(r.subarray(0, n), 0.05 / active(r.subarray(0, n), fs))
  let per = (6 + 4 * R()) * fs, ph = R() * 2 * Math.PI, d0 = delay * fs / 1000, sway = moving ? 0.0005 * fs : 0
  let rd = vdelay(r, i => d0 + sway * Math.sin(2 * Math.PI * i / per + ph)), bA = conv(rd, ir(irA, fs)), bB = moving ? conv(rd, ir(irB, fs)) : null
  let g0 = 10 ** (gain / 20), gper = (8 + 4 * R()) * fs, b = new Float32Array(n)
  for (let i = 0; i < n; i++) b[i] = moving ? g0 * 10 ** (1.5 * Math.sin(2 * Math.PI * i / gper) / 20) * (bA[i] + 0.3 * i / n * (bB[i] - bA[i])) : g0 * bA[i]
  let nm = noise(n, R, 0.05 * 10 ** (-65 / 20)), t = w.map((v, i) => v + nm[i])
  let gr = 10 ** ((R() * 2 - 1) * 6 / 20), rr = tilt(r, (R() * 2 - 1) * 3, fs), nr = noise(n, R, 0.05 * 10 ** (-50 / 20))
  return { t, b, x: rr.map((v, i) => gr * v + nr[i]), fs }
}

function items() {
  let out = [], R = lcg(half === 'tune' ? 11 : 23), spk = Object.keys(speakers()), nIR = IRS().length
  let irPick = () => Math.floor(R() * nIR / 2) * 2 + (half === 'tune' ? 0 : 1)
  let at = () => ({ delay: 1 + R() * 29, irA: irPick(), irB: irPick(), seed: Math.floor(R() * 1e9) })
  for (let k = 0; k < 3; k++) for (let gain of [-30, -18, -6]) {
    let a = spk[(2 * k) % spk.length], b = spk[(2 * k + 1) % spk.length]
    let wS = k % 2 ? narration(k, 5, 14) : talk(a, 14, R, [0.2, 1.2], k * 5), rS = talk(b, 14, R, [0.3, 2.5], k * 7)
    out.push({ name: 'cohost', gain, speech: true, k, src: { w: wS, r: rS, fs: 48000, gain, ...at() } })
    let wC = k % 2 ? talk(b, 14, R, [0.2, 1.2], k * 3) : narration(k + 3, 20, 14), rC = clicks(14, 48000, R)
    out.push({ name: 'click', gain, speech: true, k, src: { w: wC, r: rC, fs: 48000, gain, ...at() } })
    for (let kind of ['drums', 'other']) {
      let i = (2 * k + (kind === 'other')) * 2, cat = s => { let x = stem(i, s), y = stem(i + 1, s), z = new Float32Array(x.length + y.length); z.set(x); z.set(y, x.length); return z }
      out.push({ name: kind, gain, speech: false, k, src: { w: cat('vocals'), r: cat(kind), fs: 44100, gain, ...at() } })
    }
  }
  return out
}

// ---- systems: (mic, reference, rate) → output aligned with the mic
function gccphat(y, x, maxD) {
  let N = 1; while (N < 2 * maxD + 8192) N <<= 1
  let K = N / 2 + 1, Sr = new Float64Array(K), Si = new Float64Array(K), t = new Float64Array(N)
  for (let a = 0; a + N <= y.length; a += N / 2) {
    t.set(x.subarray(a, a + N)); let [xr, xi] = fft(t).map(v => Float64Array.from(v)); t.set(y.subarray(a, a + N)); let [yr, yi] = fft(t)
    for (let k = 0; k < K; k++) { Sr[k] += yr[k] * xr[k] + yi[k] * xi[k]; Si[k] += yi[k] * xr[k] - yr[k] * xi[k] }
  }
  for (let k = 0; k < K; k++) { let m = Math.hypot(Sr[k], Si[k]) || 1; Sr[k] /= m; Si[k] /= m }
  let c = ifft(Sr, Si), best = 0
  for (let d = 0; d <= maxD; d++) if (c[d] > c[best]) best = d
  return best
}
function stft(x, N, fn) {   // sqrt-Hann, hop N/4; fn(frame, spectrum[, spectra of more signals]) → gains
  let hop = N / 4, K = N / 2 + 1, w = Float64Array.from({ length: N }, (_, n) => Math.sin(Math.PI * (n + 0.5) / N)), y = new Float64Array(x[0].length), t = new Float64Array(N)
  for (let f = 0, a = -N; a < x[0].length; f++, a += hop) {
    let S = x.map(s => { for (let n = 0; n < N; n++) { let i = a + n; t[n] = i >= 0 && i < s.length ? s[i] * w[n] : 0 } return fft(t).map(v => Float64Array.from(v)) })
    let g = fn(f, S), [re, im] = S[0]
    for (let k = 0; k < K; k++) { re[k] *= g[k]; im[k] *= g[k] }
    let o = ifft(re, im); for (let n = 0; n < N; n++) { let i = a + n; if (i >= 0 && i < y.length) y[i] += o[n] * w[n] / 2 }
  }
  return Float32Array.from(y)
}
const p2 = ([re, im], k) => re[k] * re[k] + im[k] * im[k]
function external(cmd, m, x, fs) {
  let dir = path.join(CACHE, 'tmp', String(process.pid)); mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'm.f32'), m); writeFileSync(path.join(dir, 'x.f32'), x)
  let r = spawnSync('sh', ['-c', `${cmd} "$0" "$1" "$2" ${fs}`, path.join(dir, 'm.f32'), path.join(dir, 'x.f32'), path.join(dir, 'o.f32')])
  if (r.status) throw new Error(r.stderr.toString())
  let y = f32(path.join(dir, 'o.f32')), best = -Infinity, lag = 0
  for (let L = 0; L <= 2048; L++) { let c = 0; for (let i = 0; i + L < y.length && i < 400000; i += 3) c += y[i + L] * m[i]; if (c > best) best = c, lag = L }
  let z = new Float32Array(m.length); z.set(y.subarray(lag, lag + m.length)); return z
}
const SYSTEMS = {
  debleed: (m, x, fs) => debleed(m.slice(), x, { fs }),
  stream: (m, x, fs) => { let w = debleed({ fs }), a = w(m, x), b = w(), y = new Float32Array(m.length); y.set(a); y.set(b, a.length); return y },
  subtract: (m, x, fs) => {
    let D = gccphat(m, x, Math.round(0.05 * fs)), num = 0, den = 0
    for (let i = D; i < m.length; i++) num += m[i] * x[i - D], den += x[i - D] ** 2
    let g = den > 0 ? num / den : 0; return m.map((v, i) => i >= D ? v - g * x[i - D] : v)
  },
  'ref-wiener': (m, x, fs) => {
    let N = 2048, K = N / 2 + 1, rho = 10 ** (-6 * N / 4 / fs / 0.5), Sr = new Float64Array(K), Si = new Float64Array(K), Sxx = new Float64Array(K)
    stft([m, x], N, (f, [Y, X]) => { for (let k = 0; k < K; k++) { Sr[k] += Y[0][k] * X[0][k] + Y[1][k] * X[1][k]; Si[k] += Y[1][k] * X[0][k] - Y[0][k] * X[1][k]; Sxx[k] += p2(X, k) } return new Float64Array(K).fill(1) })
    let H2 = Sr.map((v, k) => Sxx[k] > 0 ? (v * v + Si[k] * Si[k]) / Sxx[k] ** 2 : 0), Z = new Float64Array(K), Gp = new Float64Array(K).fill(1), Pp = new Float64Array(K)
    return stft([m, x], N, (f, [Y, X]) => Float64Array.from({ length: K }, (_, k) => {
      Z[k] = rho * Z[k] + (1 - rho) * p2(X, k)
      let lam = H2[k] * Z[k], y2 = p2(Y, k); if (!(lam > 0)) return 1
      let xi = Math.max(0.98 * Gp[k] ** 2 * Pp[k] / lam + 0.02 * Math.max(y2 / lam - 1, 0), 1e-3), g = Math.max(xi / (1 + xi), 0.1)
      Gp[k] = g; Pp[k] = y2; return g
    }))
  },
  ...(process.env.SPEEX && { speex: (m, x, fs) => external(process.env.SPEEX, m, x, fs) }),
  ...(process.env.WEBRTC && { webrtc: (m, x, fs) => external(process.env.WEBRTC, m, x, fs) }),
}

// ---- measures
const BANDS = [[0, 300], [300, 1000], [1000, 3000], [3000, 8000], [8000, 24000]]
function band(x, fs, lo, hi) {   // x through an ideal band-pass, by FFT of the whole signal
  let N = 1; while (N < x.length) N <<= 1
  let t = new Float64Array(N); t.set(x); let [re, im] = fft(t).map(v => Float64Array.from(v))
  for (let k = 0; k <= N / 2; k++) { let f = k * fs / N; if (f < lo || f >= hi) re[k] = im[k] = 0 }
  return Float64Array.from(ifft(re, im).subarray(0, x.length))
}
function sisdr(ref, est) {
  let a = 0, rr = 0; for (let i = 0; i < ref.length; i++) a += est[i] * ref[i], rr += ref[i] * ref[i]
  if (!(rr > 0)) return NaN
  let s = 0, e = 0, k = a / rr; for (let i = 0; i < ref.length; i++) { let v = k * ref[i]; s += v * v; e += (est[i] - v) ** 2 }
  return db(s / e)
}
function kurtosis(b, r, fs) {   // ln(kurt(residual)/kurt(bleed)) of 1024-point power spectra, frames within 30 dB of the bleed's loudest
  let N = 1024, frames = (x) => { let o = []; for (let a = 0; a + N <= x.length; a += N / 4) { let t = Float64Array.from({ length: N }, (_, n) => x[a + n] * Math.sin(Math.PI * (n + 0.5) / N) ** 2); let [re, im] = fft(t); o.push(Float64Array.from({ length: N / 2 - 4 }, (_, k) => re[k + 3] ** 2 + im[k + 3] ** 2)) } return o }
  let B = frames(b), Rr = frames(r), e = B.map(f => f.reduce((s, v) => s + v, 0)), mx = Math.max(...e), sel = e.map(v => v > mx * 1e-3)
  let k = F => { let s1 = 0, s2 = 0, n = 0; F.forEach((f, j) => { if (!sel[j]) return; for (let v of f) s1 += v, s2 += v * v, n++ }); return (s2 / n) / (s1 / n) ** 2 }
  return Math.log(k(Rr) / k(B))
}

// ---- run
const conds = only ? [only] : ['static', 'moving'], OUT = path.join(CACHE, 'out', half), RUN = process.env.SYSTEMS?.split(',')
const avg = a => a.reduce((s, v) => s + v, 0) / a.length, fmt = v => (v >= 0 ? ' ' : '') + v.toFixed(1)
// SI-SDRs pooled: their distortion-to-signal ratios averaged, back in dB (∞: every take untouched)
const pool = a => { let m = avg(a.map(v => 10 ** (-v / 10))); return m > 0 ? (-db(m)).toFixed(1) : '∞' }
for (let cond of conds) {
  let rows = {}
  for (let it of items()) {
    let { t, b, x, fs } = bleed(it.src, cond === 'moving'), id = `${it.name}${it.gain}-${it.k}`
    let mp = t.map((v, i) => v + b[i]), mm = t.map((v, i) => v - b[i]), xn = x.map(v => -v)
    if (it.speech) { mkdirSync(path.join(OUT, cond, 'clean'), { recursive: true }); writeFileSync(path.join(OUT, cond, 'clean', id + '.f32'), t); mkdirSync(path.join(OUT, cond, 'input'), { recursive: true }); writeFileSync(path.join(OUT, cond, 'input', id + '.f32'), mp) }
    for (let [sys, run] of Object.entries(SYSTEMS).filter(([s]) => !RUN || RUN.includes(s))) {
      let yp = run(mp, x, fs), ym = run(mm, xn, fs), w = yp.map((v, i) => (v + ym[i]) / 2), r = yp.map((v, i) => (v - ym[i]) / 2)
      let eb = 0, er = 0; for (let i = 0; i < b.length; i++) eb += b[i] ** 2, er += r[i] ** 2
      let row = { removed: db(eb / er), kept: sisdr(t, w), bands: BANDS.map(([lo, hi]) => sisdr(band(t, fs, lo, hi), band(w, fs, lo, hi))), kurt: kurtosis(b, r, fs) }
      ;((rows[sys] ??= {})[it.name] ??= {})[it.gain] ??= []
      rows[sys][it.name][it.gain].push(row)
      if (it.speech) { let d = path.join(OUT, cond, sys); mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, id + '.f32'), yp) }
    }
    process.stderr.write('.')
  }
  console.log(`\n${half}, ${cond} path: bleed removed (dB) at a bleed of −30 / −18 / −6 dB; the wanted sound's SI-SDR after it, all and per band (dB, the takes' distortion pooled; ∞: untouched); musical noise (ln kurtosis ratio)\n`)
  console.log('| | cohost | click | drums | other | wanted SI-SDR | <300 | 0.3–1k | 1–3k | 3–8k | >8k | kurtosis |\n|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|')
  for (let sys in rows) {
    let cells = ['cohost', 'click', 'drums', 'other'].map(n => [-30, -18, -6].map(g => fmt(avg(rows[sys][n][g].map(r => r.removed)))).join(' / '))
    let all = Object.values(rows[sys]).flatMap(o => Object.values(o).flat())
    console.log(`| ${sys} | ${cells.join(' | ')} | ${pool(all.map(r => r.kept))} | ${BANDS.map((_, j) => pool(all.map(r => r.bands[j]).filter(v => !Number.isNaN(v)))).join(' | ')} | ${avg(all.map(r => r.kurt)).toFixed(2)} |`)
  }
}

// the wanted sound alone, the reference present but never heard; and no reference at all
console.log('\nThe wanted sound alone, its reference present but never reaching the mic: the error added (dB), and with a silent reference\n')
for (let sys of ['debleed', 'stream'].filter(s => !RUN || RUN.includes(s))) {
  let e = [], exact = 0, n = 0
  for (let it of items().filter(i => i.gain === -18)) {
    let { t, x, fs } = bleed(it.src, false), y = SYSTEMS[sys](t, x, fs), s = 0, d = 0
    for (let i = 0; i < t.length; i++) s += t[i] ** 2, d += (y[i] - t[i]) ** 2
    e.push(db(d / s))
    let z = SYSTEMS[sys](t, new Float32Array(t.length), fs); n++; if (z.every((v, i) => v === t[i])) exact++
  }
  console.log(`- ${sys}: ${avg(e).toFixed(1)} dB on average, ${Math.max(...e).toFixed(1)} at most; a silent reference: ${exact} of ${n} takes bit for bit`)
}
