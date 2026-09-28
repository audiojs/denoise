// Spectral subtraction (Boll 1979) with over-subtraction and a spectral floor (Berouti, Schwartz & Makhoul 1979).
//
//   |Ŝ(k)|² = |Y(k)|² − α·N̂(k)   where that stays above β·N̂(k), else β·N̂(k)
//   α = 4 − 3/20 · SNR over −5..20 dB (SNR of the frame: noisy power over noise power, dB), 4.75 below, 1 above
//
// Over-subtraction (α > 1) removes the noise's peaks that plain subtraction leaves as musical tones; the floor,
// a fraction β of the noise estimate, fills the valleys it digs with a steady bed that masks what is left. Phase is
// the noisy signal's.
//
// Noise PSD: a manual `profile` (Float64Array), a noise-only stretch named by `noiseFrames`/`profileFrom`/`profileTo`,
// or else tracked by Minimum Statistics (Martin 2001) over a 1.5 s window.
//
// Batch:   specsub(data, { profile })  → Float32Array
// Stream:  let write = specsub({ profile }); write(chunk1); write(chunk2); write()

import { stftBatch, stftStream } from '@audio/stft'
import { minStats, noiseProfile } from '@audio/noise-estimate'

// Wrap { write, flush } into a single callable (inlined convention).
const writer = s => chunk => chunk ? s.write(chunk) : s.flush()

// The analysis frame: the power of two nearest 32 ms, the frame of the minimum statistics it tracks noise with
// (Martin 2001, as VOICEBOX's v_estnoisem frames it: 16 ms steps, two per frame): 512 at 16 and 22.05 kHz, 1024 at
// 44.1, 2048 at 48. The hop is a quarter frame.
export const frame = fs => 2 ** Math.round(Math.log2(0.032 * fs))

// frame, hop and rate an option set resolves to (the manifest, stream and batch forms agree)
function framing(opts) {
  let fs = opts.fs || 44100, N = opts.frameSize || frame(fs)
  return { ...opts, fs, frameSize: N, hopSize: opts.hopSize || N >> 2 }
}

export default function specsub(dataOrOpts, opts) {
  if (dataOrOpts instanceof Float32Array || dataOrOpts instanceof Float64Array) {
    return run(dataOrOpts, framing(opts || {}))
  }
  let o = framing(dataOrOpts || {})
  return writer(stftStream(makeProcess(o), o))
}

function run(data, opts) {
  let N = opts.frameSize, hop = opts.hopSize
  let profile = opts.profile
  // a noise-only stretch the caller names gives the profile; otherwise the noise is tracked, as the stream does
  if (!profile && (opts.noiseFrames != null || opts.profileFrom != null || opts.profileTo != null)) {
    let from = opts.profileFrom ?? 0
    let nf = opts.noiseFrames                                 // # leading noise-only frames
    let to = opts.profileTo ?? (nf != null
      ? Math.min(data.length, from + N + Math.max(0, nf - 1) * hop)
      : Math.min(data.length, from + N * 4))
    profile = noiseProfile(data, { from, to, frameSize: N, hopSize: hop })
  }
  return stftBatch(data, makeProcess({ ...opts, profile }), opts)
}

function makeProcess(opts) {
  let alphaFixed = opts.alpha || null              // a fixed over-subtraction; omitted (or 0): Berouti's α(SNR)
  let beta = opts.beta ?? 0.05                     // spectral floor, a fraction of the noise estimate
  let auto = !opts.profile
  let N = opts.frameSize, hop = opts.hopSize, fs = opts.fs
  let half = N >> 1
  let est = auto ? minStats(half, { D: Math.round(1.5 * fs / hop), ...opts.estimator }) : null   // Martin's 1.5 s
  let profile = opts.profile

  return function (mag, phase) {
    if (!mag.some(Boolean)) return { mag, phase }            // digital silence: nothing to learn or attenuate
    if (auto) { est.update(mag); profile = est.psd }

    // Berouti α(SNR): over-subtract hardest at low SNR (4.75 at −5 dB), easing to 1 at 20 dB
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
      mag[k] = Math.sqrt(cleaned > beta * n ? cleaned : beta * n)
    }
    return { mag, phase }
  }
}
