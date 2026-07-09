// De-reverb — late-reverb spectral subtraction (Lebart, Boucher & Denbigh 2001).
//
// Models late-reverberation tail as decaying noise:
//   |R(k)|² ≈ exp(-2·δ·t_60·hop) · |Y_prev(k)|²
//
// where δ = 6·ln(10)/T60 is the decay rate. Subtract from current frame magnitude
// like Berouti spectral subtraction:
//
//   |Ŝ(k)|² = max(|Y(k)|² − α·|R̂(k)|², β·|Y(k)|²)
//
// Single-channel — works for moderate RT60 (0.3-1s) on speech. Heavy reverb
// requires multi-channel WPE (Tier 2).

import { stftBatch, stftStream } from '@audio/stft'

// Wrap { write, flush } into a single callable (inlined convention).
const writer = s => chunk => chunk ? s.write(chunk) : s.flush()


export default function dereverb(dataOrOpts, opts) {
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

function makeProcess(opts) {
  let t60 = opts.t60 ?? 0.5                        // assumed late-reverb decay time, s
  let alpha = opts.alpha ?? 1.5
  let beta = opts.beta ?? 0.05
  let predelay = opts.predelay ?? 0.04             // s — direct-sound pass-through
  let N = opts.frameSize || 2048
  let hop = opts.hopSize || (N >> 2)
  let fs = opts.fs || 44100
  let half = N >> 1

  let hopSec = hop / fs
  let delta = 6 * Math.log(10) / t60               // 1/s
  let predelayFrames = Math.max(1, Math.round(predelay / hopSec))

  return function (mag, phase, state) {
    if (!state.history) {
      state.history = []                            // ring of recent power spectra
    }
    let hist = state.history
    let pwr = new Float64Array(half + 1)
    for (let k = 0; k <= half; k++) pwr[k] = mag[k] * mag[k]
    hist.push(pwr)
    if (hist.length > predelayFrames + 4) hist.shift()

    if (hist.length <= predelayFrames) return { mag, phase }
    let past = hist[hist.length - 1 - predelayFrames]
    let decay = Math.exp(-2 * delta * predelayFrames * hopSec)

    for (let k = 0; k <= half; k++) {
      let p = pwr[k]
      let r = decay * past[k]
      let cleaned = p - alpha * r
      let floor = beta * p
      mag[k] = Math.sqrt(Math.max(cleaned, floor))
    }
    return { mag, phase }
  }
}
