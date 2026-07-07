// OM-LSA — Optimally Modified Log-Spectral Amplitude (Cohen 2002), with IMCRA noise.
//
//   G_OMLSA = G_LSA^p · G_min^(1-p)
//
// where p = speech presence probability per bin, G_LSA = MMSE-LSA gain (Ephraim-Malah
// 1985), G_min is a fixed lower-gain (default −20 dB) used during noise-only frames.
// SPP is derived from the smoothed PSD vs. its tracked minimum (IMCRA).
//
// Best-in-class for non-stationary noise (babble, traffic, HVAC swells) — adapts the
// noise PSD continuously without freezing during voiced regions.

import { stftBatch, stftStream } from '@audio/denoise-core'
import { writer, db2lin } from '@audio/denoise-core'
import { imcra } from '@audio/denoise-core'

export default function omlsa(dataOrOpts, opts) {
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
  return stftBatch(data, makeProcess(opts), { frameSize: N, hopSize: hop, fs: opts.fs })
}

// E1(ν) for ν > 0
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
  let alphaDD = opts.alphaDD ?? 0.92
  let xiMin = opts.xiMin ?? 0.0316
  let qPrior = opts.qPrior ?? 0.3                  // a-priori speech absence
  let gMin = db2lin(opts.gMin ?? -20)
  let N = opts.frameSize || 2048
  let half = N >> 1
  let est = imcra(half, opts.estimator || {})

  return function (mag, phase, state) {
    est.update(mag)
    let psd = est.psd
    if (!psd[0] && !psd[half]) return { mag, phase }

    if (!state.gPrev) {
      state.gPrev = new Float64Array(half + 1).fill(1)
      state.mPrev = new Float64Array(half + 1)
    }
    let gPrev = state.gPrev, mPrev = state.mPrev

    for (let k = 0; k <= half; k++) {
      let n = Math.max(psd[k], 1e-30)
      let yk2 = mag[k] * mag[k]
      let gamma = yk2 / n
      let priorPow = (gPrev[k] * mPrev[k]) * (gPrev[k] * mPrev[k]) / n
      let xi = Math.max(xiMin, alphaDD * priorPow + (1 - alphaDD) * Math.max(gamma - 1, 0))

      let nu = xi * gamma / (1 + xi)
      let gLsa = (xi / (1 + xi)) * Math.exp(0.5 * exp1(nu))

      // Posterior speech presence:  p = 1 / (1 + (q/(1-q))·(1+ξ)·exp(-ν))
      let p = 1 / (1 + (qPrior / (1 - qPrior)) * (1 + xi) * Math.exp(-nu))
      let G = Math.pow(gLsa, p) * Math.pow(gMin, 1 - p)

      gPrev[k] = G
      mPrev[k] = mag[k]
      mag[k] = G * mag[k]
    }
    return { mag, phase }
  }
}
