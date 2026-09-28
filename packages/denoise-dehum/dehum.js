// Mains hum removal: a cascade of biquad notches (RBJ cookbook) at the harmonics of the mains frequency.
//
// Notches cost speech wherever there is no hum to remove: a voice's harmonics sweep through them, and each notch
// rings on what it takes out (four at 50–200 Hz, Q 30, take clean VoiceBank speech from PESQ 4.64 to 3.2). So dehum
// first measures the hum (`measure` below) and notches only the harmonics that stand out, at the frequency measured;
// without hum the audio comes back untouched.
//
//   freq       fundamental, Hz; omitted (or 0): measured, the 50 or 60 Hz series. Given: that series, its exact
//              frequency measured within ±0.4 % (mains tolerance), or within ±drift Hz (default 0.5) when adaptive.
//   harmonics  notch h = 1..harmonics, present or not; omitted (or 0): the harmonics up to 1 kHz that stand out.
//   Q          notch sharpness, default 30.
//
// Returns the same buffer, filtered in place. The measurement needs a second of signal in the first call; a shorter
// first call can't measure: without `freq` it passes audio through, with `freq` it notches h = 1..(harmonics || 4)
// as told. Pass the same params object across calls: the plan and the filter state carry over.

import { cascade, notch, lowpass } from '@audio/biquad'

export default function dehum(data, params = {}) {
  let fs = params.fs || 44100
  let Q = params.Q ?? 30
  let sig = `${params.freq}|${params.harmonics}|${Q}|${fs}|${params.adaptive}|${params.drift}`
  if (params._sig !== sig) {
    let hs = plan(data, fs, params)
    params._coefs = hs.map(f => notch(f, Q, fs))
    params._state = params._coefs.map(() => [0, 0])
    params._freqs = hs
    params._sig = sig
  }
  if (params._coefs.length) cascade(data, params._coefs, params._state)
  return data
}

// the notch frequencies for this signal and these params
function plan(data, fs, params) {
  let freq = params.freq || 0, harmonics = params.harmonics || 0, short = data.length < MIN * fs
  let m = short ? null : measure(data, fs, freq ? [freq] : [50, 60], freq && params.adaptive ? (params.drift ?? 0.5) / freq : 0.004)
  let f0 = m?.f0 ?? freq, hs = []
  if (!f0) return hs
  if (harmonics || short) for (let h = 1; h <= (harmonics || 4) && h * f0 < fs / 2; h++) hs.push(h * f0)   // as told
  else if (m) for (let h of m.harmonics) hs.push(h * f0)
  return hs
}

// Measure mains hum near the candidate fundamentals: null when the signal is shorter than MIN seconds or no series
// stands out, else { f0, harmonics } with the harmonics (up to 1 kHz) whose lines stand out.
// Mains hum is a sum of sinusoids that hold their frequency for minutes, speech holds none for long: one Fourier
// transform over the whole signal (its first 2^18 samples at ~3 kHz, 80–90 s) gathers each hum line into a peak 1/T
// wide while speech spreads.
// The signal is first brought to ~3 kHz (8th-order Butterworth at 1.1 kHz, every M-th sample) so the transform stays
// small. A line stands out by its peak over the median power of the ±8 Hz around it, its own main lobe left out.
const MIN = 1
export function measure(data, fs, candidates = [50, 60], tol = 0.004) {
  if (data.length < MIN * fs) return null
  let M = Math.max(1, Math.floor(fs / 3000)), fd = fs / M
  let x = Float32Array.from(data)
  if (M > 1) {
    cascade(x, [0.5098, 0.6013, 0.9, 2.5629].map(q => lowpass(1100, q, fs)))   // Butterworth pole pairs, order 8
    let y = new Float32Array(Math.floor(x.length / M))
    for (let i = 0; i < y.length; i++) y[i] = x[i * M]
    x = y
  }
  let L = Math.min(x.length, 1 << 18), N = 2 ** Math.ceil(Math.log2(2 * L)), bin = fd / N
  let re = new Float64Array(N), im = new Float64Array(N)
  for (let i = 0; i < L; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / L))
  fft(re, im)
  let K = Math.min(N >> 1, Math.ceil(1100 / bin)), P = new Float64Array(K)
  for (let k = 0; k < K; k++) P[k] = re[k] * re[k] + im[k] * im[k]
  let lobe = 2 * fd / L                             // Hann main lobe half width, Hz
  // the strongest peak between two frequencies, its power over the median of ±8 Hz around it (its lobe left out, dB)
  // and its frequency, interpolated on the log power; no local maximum, no line
  let line = (h, f, lo, hi) => {
    let k0 = Math.max(1, Math.floor(lo / bin)), k1 = Math.min(K - 2, Math.ceil(hi / bin)), k = k0
    for (let i = k0; i <= k1; i++) if (P[i] > P[k]) k = i
    if (P[k] < P[k - 1] || P[k] < P[k + 1]) return { h, snr: -Infinity, p: h * f, power: 0 }
    let near = []
    for (let i = Math.round((h * f - 8) / bin); i <= Math.round((h * f + 8) / bin); i++)
      if (i > 0 && i < K && Math.abs(i - k) * bin > 2 * lobe) near.push(P[i])
    near.sort((u, v) => u - v)
    let a = Math.log(P[k - 1] || 1e-300), b = Math.log(P[k]), c = Math.log(P[k + 1] || 1e-300)
    let d = a - 2 * b + c ? 0.5 * (a - c) / (a - 2 * b + c) : 0
    return { h, snr: 10 * Math.log10(P[k] / Math.max(near[near.length >> 1], 1e-300)), p: (k + Math.max(-0.5, Math.min(0.5, d))) * bin, power: P[k] }
  }
  let fit = ls => { let num = 0, den = 0; for (let l of ls) { num += l.h * l.p; den += l.h * l.h } return num / den }
  // Hum is there when the fundamental stands out by 20 dB or two of the first six harmonics by 15 dB, each searched
  // within the mains tolerance. Over noise alone, the largest of M independent exponential powers sits
  // (ln M + 0.58)/ln 2 times their median: 8–10 dB for the 35–210 independent bins of a 90 s search. On 103 clean
  // and 103 noisy VoiceBank utterances these thresholds find no hum; with hum 20 dB under the speech, 97 %.
  let best = null
  for (let f of candidates) {
    let first = []
    for (let h = 1; h <= 6 && h * f < fd / 2 - 10; h++) first.push(line(h, f, h * f * (1 - tol), h * f * (1 + tol)))
    let strong = first.filter(l => l.snr >= 15)
    if (!(first[0]?.snr >= 20 || strong.length >= 2)) continue
    if (!strong.length) strong = [first[0]]
    let power = strong.reduce((s, l) => s + l.power, 0)
    if (!best || power > best.power) best = { f, strong, power }
  }
  if (!best) return null
  // f0 from the strong lines, then each harmonic up to 1 kHz searched right at h·f0 (±3 bins, ±0.05 % for drift):
  // it is hum when it stands out by 13 dB; the fit is redone over all of them
  let f0 = fit(best.strong), on = []
  for (let h = 1; h * f0 <= 1000 && h * f0 < fd / 2 - 10; h++) {
    let w = Math.max(3 * bin, 0.0005 * h * f0), l = line(h, f0, h * f0 - w, h * f0 + w)
    if (l.snr >= 13 || best.strong.some(s => s.h === h)) on.push(l)
  }
  return { f0: fit(on), harmonics: on.map(l => l.h) }
}

// in-place radix-2 complex FFT (the measurement's only transform)
function fft(re, im) {
  let n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    let ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < len >> 1; j++) {
        let a = i + j, b = a + (len >> 1)
        let tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
        let t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}
