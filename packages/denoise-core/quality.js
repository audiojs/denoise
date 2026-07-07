// Objective quality metrics for denoise evaluation.
//   - snr: global signal-to-noise ratio (dB) given clean reference
//   - segSnr: segmental SNR — frame-averaged, perceptually closer than global
//   - lsd: log-spectral distance (dB) — spectral colouration regression
//   - nrr: noise reduction ratio (dB) — how much energy was removed below threshold
//   - speechAttenuation: how much speech energy was removed (dB) — speech-distortion proxy
//
// All metrics expect equal-length Float32Array inputs; trim/align caller-side.

import { fft } from 'fourier-transform'
import { hannWindow, lin2db } from './util.js'

// Global SNR (dB). Clean = reference, denoised = output. SNR = 10·log10(∑clean² / ∑(clean-out)²)
export function snr(clean, denoised) {
  let n = Math.min(clean.length, denoised.length)
  let s = 0, e = 0
  for (let i = 0; i < n; i++) {
    let c = clean[i], d = c - denoised[i]
    s += c * c
    e += d * d
  }
  return e > 0 ? 10 * Math.log10(s / e) : Infinity
}

// Segmental SNR — average per-frame SNR clamped to [-10, 35] dB (PESQ-style).
// Drops silent frames (energy < floor) so silence doesn't bias the mean.
export function segSnr(clean, denoised, opts = {}) {
  let N = opts.frameSize || 512
  let hop = opts.hopSize || (N >> 1)
  let floor = opts.floor ?? 1e-5
  let n = Math.min(clean.length, denoised.length)
  let sum = 0, frames = 0
  for (let pos = 0; pos + N <= n; pos += hop) {
    let s = 0, e = 0
    for (let i = 0; i < N; i++) {
      let c = clean[pos + i], d = c - denoised[pos + i]
      s += c * c
      e += d * d
    }
    if (s < floor * N) continue
    let snr = 10 * Math.log10(s / Math.max(e, 1e-30))
    sum += Math.max(-10, Math.min(35, snr))
    frames++
  }
  return frames ? sum / frames : 0
}

// Log-spectral distance (dB), frame-averaged. Lower is better (~1 dB transparent).
export function lsd(a, b, opts = {}) {
  let N = opts.frameSize || 1024
  let hop = opts.hopSize || (N >> 1)
  let floor = opts.floor ?? 1e-5
  let win = hannWindow(N)
  let half = N >> 1
  let mx = new Float64Array(half + 1), my = new Float64Array(half + 1)
  let n = Math.min(a.length, b.length)
  let sum = 0, frames = 0
  for (let pos = 0; pos + N <= n; pos += hop) {
    let ex = magFrame(a, pos, win, N, half, mx)
    let ey = magFrame(b, pos, win, N, half, my)
    if (ex < floor && ey < floor) continue
    let peak = 0
    for (let k = 0; k <= half; k++) {
      if (mx[k] > peak) peak = mx[k]
      if (my[k] > peak) peak = my[k]
    }
    let mfloor = peak * 1e-3 + 1e-12
    let acc = 0
    for (let k = 0; k <= half; k++) {
      let d = 20 * Math.log10((mx[k] + mfloor) / (my[k] + mfloor))
      acc += d * d
    }
    sum += Math.sqrt(acc / (half + 1))
    frames++
  }
  return frames ? sum / frames : 0
}

let _scratch = new Map()
function magFrame(data, pos, win, N, half, magOut) {
  let f = _scratch.get(N)
  if (!f) { f = new Float64Array(N); _scratch.set(N, f) }
  let e = 0
  for (let i = 0; i < N; i++) {
    let v = (data[pos + i] || 0) * win[i]
    f[i] = v
    e += v * v
  }
  let [re, im] = fft(f)
  for (let k = 0; k <= half; k++) magOut[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
  return e
}

// Noise reduction ratio (dB): drop in noise-floor RMS after processing.
// Caller selects a quiet segment by index. Positive = suppression worked.
export function nrr(noisy, denoised, from = 0, to) {
  to = to ?? Math.min(noisy.length, denoised.length)
  let nIn = 0, nOut = 0, len = to - from
  for (let i = from; i < to; i++) { nIn += noisy[i] * noisy[i]; nOut += denoised[i] * denoised[i] }
  let inDb = lin2db(Math.sqrt(nIn / len))
  let outDb = lin2db(Math.sqrt(nOut / len))
  return inDb - outDb
}

// Speech attenuation (dB): drop in clean-signal-active RMS — should be near 0.
// Pass a clean-segment index range so we measure speech retention.
export function speechAttenuation(clean, denoised, from = 0, to) {
  to = to ?? Math.min(clean.length, denoised.length)
  let cIn = 0, cOut = 0, len = to - from
  for (let i = from; i < to; i++) {
    cIn += clean[i] * clean[i]
    cOut += denoised[i] * denoised[i]
  }
  return lin2db(Math.sqrt(cIn / len)) - lin2db(Math.sqrt(cOut / len))
}
