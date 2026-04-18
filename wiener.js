// Wiener filter / MMSE-LSA denoise with decision-directed a-priori SNR.
//
// Two gain rules selectable via { rule: 'wiener' | 'mmse-lsa' }:
//
//   wiener:    G(k) = ξ / (1 + ξ)
//   mmse-lsa:  G(k) = ξ/(1+ξ) · exp(½ · ∫_{ν}^{∞} (e^{-t}/t) dt)   (Ephraim-Malah 1985)
//
// where ξ = a-priori SNR (decision-directed; Ephraim-Malah 1984), ν = ξ·γ/(1+ξ),
// γ = posterior SNR. mmse-lsa is the recommended default — transparent on speech.
//
// Noise PSD source: explicit `profile` from quiet segment, or auto via Minimum Statistics.

import { stftBatch, stftStream } from './stft.js'
import { writer } from './util.js'
import { minStats, noiseProfile } from './noise.js'

export default function wiener(dataOrOpts, opts) {
  if (dataOrOpts instanceof Float32Array || dataOrOpts instanceof Float64Array) {
    return run(dataOrOpts, opts || {})
  }
  return writer(stftStream(makeProcess(dataOrOpts || {}), {
    frameSize: dataOrOpts?.frameSize || 2048,
    hopSize: dataOrOpts?.hopSize || 512,
    fs: dataOrOpts?.fs || 44100
  }))
}

function run(data, opts) {
  let N = opts.frameSize || 2048
  let hop = opts.hopSize || (N >> 2)
  let profile = opts.profile
  if (!profile) {
    let from = opts.profileFrom ?? 0
    let to = opts.profileTo ?? Math.min(data.length, from + N * 4)
    profile = noiseProfile(data, { from, to, frameSize: N, hopSize: hop })
  }
  return stftBatch(data, makeProcess({ ...opts, profile }), { frameSize: N, hopSize: hop, fs: opts.fs })
}

// Approximate exponential integral E1(ν) for ν > 0 (Abramowitz 5.1.53/5.1.56).
function exp1(v) {
  if (v <= 0) return 30
  if (v < 1) {
    let a = [-.57721566, .99999193, -.24991055, .05519968, -.00976004, .00107857]
    let s = 0
    for (let i = a.length - 1; i >= 0; i--) s = s * v + a[i]
    return s - Math.log(v)
  }
  let a = [.2677737343, 8.6347608925, 18.0590169730, 8.5733287401]
  let b = [3.9584969228, 21.0996530827, 25.6329561486, 9.5733223454]
  let num = a[0] + v * (a[1] + v * (a[2] + v * (a[3] + v)))
  let den = b[0] + v * (b[1] + v * (b[2] + v * (b[3] + v)))
  return Math.exp(-v) / v * num / den
}

function makeProcess(opts) {
  let rule = opts.rule || 'mmse-lsa'
  let alphaDD = opts.alphaDD ?? 0.98
  let xiMin = opts.xiMin ?? 0.0316                 // -15 dB
  let auto = !opts.profile
  let N = opts.frameSize || 2048
  let hop = opts.hopSize || (N >> 2)
  let half = N >> 1
  let est = auto ? minStats(half, opts.estimator || {}) : null
  let profile = opts.profile

  return function (mag, phase, state) {
    if (auto) { est.update(mag); profile = est.psd }
    if (!profile) return { mag, phase }

    if (!state.gPrev) {
      state.gPrev = new Float64Array(half + 1)
      state.mPrev = new Float64Array(half + 1)
      state.gPrev.fill(1)
    }
    let gPrev = state.gPrev, mPrev = state.mPrev

    for (let k = 0; k <= half; k++) {
      let n = Math.max(profile[k], 1e-30)
      let yk2 = mag[k] * mag[k]
      let gamma = yk2 / n
      let priorPow = (gPrev[k] * mPrev[k]) * (gPrev[k] * mPrev[k]) / n
      let xi = Math.max(xiMin, alphaDD * priorPow + (1 - alphaDD) * Math.max(gamma - 1, 0))

      let G
      if (rule === 'wiener') {
        G = xi / (1 + xi)
      } else {
        let nu = xi * gamma / (1 + xi)
        G = (xi / (1 + xi)) * Math.exp(0.5 * exp1(nu))
      }
      gPrev[k] = G
      mPrev[k] = mag[k]
      mag[k] = G * mag[k]
    }
    return { mag, phase }
  }
}
