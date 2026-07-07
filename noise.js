// Noise PSD estimators feeding the statistical denoisers (Wiener, OM-LSA, MMSE).
//   - profile: average |X|² over a user-chosen quiet segment (manual baseline)
//   - minimumStatistics: Martin (2001) — track minima of smoothed |X|² in sliding window
//   - imcra: Cohen (2003) — Improved MCRA, two-iteration smoothing + speech-presence-driven
//
// All estimators are stateful: pass the same params object across frames in stream mode.

import { stftAnalyse } from './stft.js'

// One-shot batch profile from a quiet segment of `data`. Returns Float64Array(N/2+1).
export function noiseProfile(data, opts = {}) {
  let N = opts.frameSize || 2048
  let hop = opts.hopSize || (N >> 2)
  let half = N >> 1
  let from = Math.max(0, opts.from ?? 0)
  let to = Math.min(data.length, opts.to ?? Math.min(data.length, from + N * 8))
  let seg = data.subarray(from, to)
  let psd = new Float64Array(half + 1)
  let count = 0
  stftAnalyse(seg, mag => {
    for (let k = 0; k <= half; k++) psd[k] += mag[k] * mag[k]
    count++
  }, { frameSize: N, hopSize: hop })
  let scale = count ? 1 / count : 0
  for (let k = 0; k <= half; k++) psd[k] *= scale
  return psd
}

// Minimum Statistics (Martin 2001) — frame-by-frame online updater.
// Keeps a rolling D-frame minimum of smoothed PSD per bin; multiplies by a bias
// compensation factor so the minimum tracks E{|N|²} rather than the lower-tail.
//
// Usage:
//   let est = minStats(half, { D: 96 })
//   stftAnalyse(data, m => est.update(m))
//   let psd = est.psd  // current noise PSD
//
// D ≈ 1.5 s of frames at hop = N/4 ≈ 96 frames @ 44.1k / N=2048.
export function minStats(half, opts = {}) {
  let D = opts.D || 96
  let alpha = opts.alpha ?? 0.7              // smoothing on PSD
  let bias = opts.bias ?? 1.5                 // empirical comp from Martin §VII
  let smoothed = new Float64Array(half + 1)
  let psd = new Float64Array(half + 1)
  let buf = []                                 // ring of recent smoothed frames

  return {
    psd,
    update(mag) {
      let p = new Float64Array(half + 1)
      for (let k = 0; k <= half; k++) {
        let pk = mag[k] * mag[k]
        smoothed[k] = alpha * smoothed[k] + (1 - alpha) * pk
        p[k] = smoothed[k]
      }
      buf.push(p)
      if (buf.length > D) buf.shift()
      for (let k = 0; k <= half; k++) {
        let mn = Infinity
        for (let i = 0; i < buf.length; i++) if (buf[i][k] < mn) mn = buf[i][k]
        psd[k] = mn * bias
      }
    }
  }
}

// IMCRA — Improved Minima Controlled Recursive Averaging (Cohen 2003).
// Drives noise PSD via speech-presence probability (SPP) so it stops updating
// during voiced regions. SPP itself is supplied by the caller (see vad.js spp())
// or computed internally from the smoothed-to-min PSD ratio.
export function imcra(half, opts = {}) {
  let alpha = opts.alpha ?? 0.92
  let alphaD = opts.alphaD ?? 0.85
  let beta = opts.beta ?? 1.47
  let psd = new Float64Array(half + 1)
  let psdInit = false
  let smoothed = new Float64Array(half + 1)
  let mins = new Float64Array(half + 1)
  let prevMins = new Float64Array(half + 1)
  let frameCount = 0
  let resetEvery = opts.resetEvery || 80      // ≈ 0.9 s @ 44.1k, hop=512

  return {
    psd,
    update(mag, sppOverride) {
      let init = !psdInit
      for (let k = 0; k <= half; k++) {
        let pk = mag[k] * mag[k]
        smoothed[k] = init ? pk : alpha * smoothed[k] + (1 - alpha) * pk
        if (init || smoothed[k] < mins[k]) mins[k] = smoothed[k]
        if (!init && smoothed[k] < prevMins[k]) prevMins[k] = smoothed[k]
      }
      frameCount++
      if (frameCount >= resetEvery) {
        for (let k = 0; k <= half; k++) {
          let mn = Math.min(mins[k], prevMins[k])
          prevMins[k] = mins[k]
          mins[k] = smoothed[k]
          // bias-compensated minimum tracker
          if (init) psd[k] = mn * beta
        }
        frameCount = 0
        psdInit = true
      }

      if (!psdInit) return

      for (let k = 0; k <= half; k++) {
        let mn = Math.min(mins[k], prevMins[k]) * beta
        // SPP from local SNR vs minimum: high if smoothed >> minimum.
        let snr = smoothed[k] / Math.max(mn, 1e-30)
        let p = sppOverride !== undefined ? sppOverride : 1 / (1 + Math.exp(-3 * (snr - 5)))
        let alphaTilde = alphaD + (1 - alphaD) * p
        let pk = mag[k] * mag[k]
        psd[k] = alphaTilde * psd[k] + (1 - alphaTilde) * pk
      }
    }
  }
}
