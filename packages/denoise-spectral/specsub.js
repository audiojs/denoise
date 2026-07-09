// Spectral subtraction (Boll 1979) with Berouti over-subtraction + spectral floor.
//
//   |Ŝ(k)|² = max( |Y(k)|² − α(γ)·N̂(k),  β·|Y(k)|² )
//
// `α` is over-subtraction factor (>1 reduces residual noise but adds musical noise),
// `β` is Berouti's spectral floor — a fraction of the *noisy* spectrum that fills
// spectral valleys with a controlled bed, masking musical-noise tones.
// Phase is taken from the noisy signal — perceptually transparent for SNR > 5 dB.
//
// Noise PSD: provide a manual `profile` (Float64Array) OR let the function track it
// via Minimum Statistics over the input.
//
// Batch:   specsub(data, { profile })  → Float32Array
// Stream:  let write = specsub({ profile }); write(chunk1); write(chunk2); write()

import { stftBatch, stftStream } from '@audio/stft'
import { minStats, noiseProfile } from '@audio/noise-estimate'

// Wrap { write, flush } into a single callable (inlined convention).
const writer = s => chunk => chunk ? s.write(chunk) : s.flush()


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
    let nf = opts.noiseFrames                                 // # leading noise-only frames
    let to = opts.profileTo ?? (nf != null
      ? Math.min(data.length, from + N + Math.max(0, nf - 1) * hop)
      : Math.min(data.length, from + N * 4))
    profile = noiseProfile(data, { from, to, frameSize: N, hopSize: hop })
  }
  return stftBatch(data, makeProcess({ ...opts, profile }), { frameSize: N, hopSize: hop, fs: opts.fs })
}

function makeProcess(opts) {
  let alphaFixed = opts.alpha                      // if set, forces a fixed over-subtraction
  let beta = opts.beta ?? 0.02                     // spectral floor (fraction of noisy spectrum)
  let auto = !opts.profile
  let N = opts.frameSize || 2048
  let hop = opts.hopSize || (N >> 2)
  let half = N >> 1
  let est = auto ? minStats(half, opts.estimator || {}) : null
  let profile = opts.profile

  return function (mag, phase, state) {
    if (auto) { est.update(mag); profile = est.psd }
    if (!profile) return { mag, phase }            // first frame, nothing yet

    // Berouti α(γ) (Loizou, Speech Enhancement, Eq. 5.6): over-subtract hardest at
    // low segmental SNR (α→4.75 below −5 dB), easing to α = 1 at 20 dB — aggressive
    // where it helps, transparent where it hurts. `alpha` option overrides with a fixed factor.
    let alpha = alphaFixed
    if (alpha == null) {
      let sigP = 0, noiP = 0
      for (let k = 0; k <= half; k++) { sigP += mag[k] * mag[k]; noiP += profile[k] }
      let snrDb = 10 * Math.log10(sigP / Math.max(noiP, 1e-30))
      alpha = Math.max(1, Math.min(4.75, 4 - 0.15 * snrDb))
    }

    for (let k = 0; k <= half; k++) {
      let p = mag[k] * mag[k]
      let n = profile[k]
      let cleaned = p - alpha * n
      mag[k] = Math.sqrt(Math.max(cleaned, beta * p))   // Berouti floor β·|Y(k)|²
    }
    return { mag, phase }
  }
}
