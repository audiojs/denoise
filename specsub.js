// Spectral subtraction (Boll 1979) with Berouti over-subtraction + spectral floor.
//
//   |Ŝ(k)|² = max( |Y(k)|² − α(γ)·N̂(k),  β·N̂(k) )
//
// `α` is over-subtraction factor (>1 reduces residual noise but adds musical noise),
// `β` is the floor that masks musical-noise tones with a controlled ambient bed.
// Phase is taken from the noisy signal — perceptually transparent for SNR > 5 dB.
//
// Noise PSD: provide a manual `profile` (Float64Array) OR let the function track it
// via Minimum Statistics over the input.
//
// Batch:   specsub(data, { profile })  → Float32Array
// Stream:  let write = specsub({ profile }); write(chunk1); write(chunk2); write()

import { stftBatch, stftStream } from './stft.js'
import { writer } from './util.js'
import { minStats, noiseProfile } from './noise.js'

export default function specsub(dataOrOpts, opts) {
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

function makeProcess(opts) {
  let alpha = opts.alpha ?? 2.0                    // over-subtraction
  let beta = opts.beta ?? 0.02                     // spectral floor
  let auto = !opts.profile
  let N = opts.frameSize || 2048
  let hop = opts.hopSize || (N >> 2)
  let half = N >> 1
  let est = auto ? minStats(half, opts.estimator || {}) : null
  let profile = opts.profile

  return function (mag, phase, state) {
    if (auto) { est.update(mag); profile = est.psd }
    if (!profile) return { mag, phase }            // first frame, nothing yet
    for (let k = 0; k <= half; k++) {
      let p = mag[k] * mag[k]
      let n = profile[k]
      let cleaned = p - alpha * n
      let floor = beta * p
      mag[k] = Math.sqrt(Math.max(cleaned, floor))
    }
    return { mag, phase }
  }
}
