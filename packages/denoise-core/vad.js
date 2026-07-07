// Voice Activity Detection + Speech Presence Probability.
//   - vad: hard 0/1 decision per frame from energy + spectral flatness + ZCR
//   - spp: soft probability per bin from a-priori SNR (drives OM-LSA, IMCRA)
//
// Use vad() for gating decisions (debreath, gate); spp() for spectral denoise gain.

import { stftAnalyse } from './stft.js'
import { lin2db } from './util.js'

// Returns { active: Uint8Array(frames), times: Float32Array(frames) of frame-start sec }.
// Active iff energy is N dB above the rolling noise floor AND spectral flatness < flatTh.
//
// Floor estimation: minimum of energy over a sliding D-frame window with bias
// correction — Martin-style minimum tracking. This avoids the "speech eats its own
// floor" failure mode of plain exponential smoothing.
//
// flatTh ≈ 0.4 — speech is tonal (low flatness), noise is flat (high flatness).
export function vad(data, opts = {}) {
  let N = opts.frameSize || 1024
  let hop = opts.hopSize || (N >> 1)
  let fs = opts.fs || 44100
  let snrTh = opts.snrTh ?? 6                  // dB above floor
  let flatTh = opts.flatTh ?? 0.4              // spectral flatness threshold
  let D = opts.window || 64                    // frames in min-tracker window
  let bias = opts.bias ?? 5                    // dB — added to min to estimate true floor

  let frames = Math.max(0, Math.floor((data.length - N) / hop) + 1)
  let active = new Uint8Array(frames)
  let times = new Float32Array(frames)
  let energies = new Float64Array(frames)
  let flats = new Float64Array(frames)
  let i = 0

  stftAnalyse(data, (mag, _phase, pos) => {
    let half = mag.length - 1, e = 0
    let logSum = 0, linSum = 0, nz = 0
    for (let k = 1; k <= half; k++) {
      let p = mag[k] * mag[k]
      e += p
      if (p > 1e-30) { logSum += Math.log(p); nz++ }
      linSum += p
    }
    let geom = nz ? Math.exp(logSum / nz) : 0
    let arith = linSum / Math.max(half, 1)
    flats[i] = arith > 1e-30 ? geom / arith : 1
    energies[i] = lin2db(Math.sqrt(e / N))
    times[i] = pos / fs
    i++
  }, { frameSize: N, hopSize: hop })

  // Global noise floor = 10th-percentile energy + bias. Robust on signals where
  // any short window may be entirely speech.
  let sorted = Float64Array.from(energies).sort()
  let floor = sorted[Math.floor(sorted.length * 0.1)] + bias

  for (let j = 0; j < frames; j++) {
    active[j] = (energies[j] - floor > snrTh && flats[j] < flatTh) ? 1 : 0
  }
  return { active, times, hop, frameSize: N }
}

// Per-bin Speech Presence Probability from a-priori SNR ξ:
//   p = ξ / (1 + ξ)   (Bayesian formulation under Gaussian model, q-prior = 0.5)
// Bind to a noise PSD source (e.g. minStats.psd or imcra.psd) and an a-priori SNR estimate.
export function spp(mag, noisePsd, opts = {}) {
  let xiMin = opts.xiMin ?? 0.0316             // -15 dB floor
  let half = mag.length - 1
  let p = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) {
    let post = (mag[k] * mag[k]) / Math.max(noisePsd[k], 1e-30) - 1
    let xi = Math.max(xiMin, post)
    p[k] = xi / (1 + xi)
  }
  return p
}

// Decision-Directed a-priori SNR (Ephraim-Malah 1984), recursive smoothing.
//   ξ̂[k] = α · |X̂_prev[k]|² / N̂[k]  +  (1-α) · max(γ-1, 0)
// γ = posterior SNR = |Y[k]|² / N̂[k]. Used by Wiener, MMSE, OM-LSA gain rules.
export function ddSnr(mag, noisePsd, prevGain, prevMag, alpha = 0.98) {
  let half = mag.length - 1
  let xi = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) {
    let n = Math.max(noisePsd[k], 1e-30)
    let post = (mag[k] * mag[k]) / n
    let g = prevGain[k] * prevMag[k]
    let prev = (g * g) / n
    xi[k] = Math.max(0.0316, alpha * prev + (1 - alpha) * Math.max(post - 1, 0))
  }
  return xi
}
