// De-reverb — late-reverb spectral subtraction (Lebart, Boucher & Denbigh 2001).
//
// Models the late-reverberation tail as exponentially-decaying noise whose power at
// frame n is the decayed superposition of earlier frames' power:
//   |R̂(k)|² = Σ_{m≥P} exp(-2·δ·m·hop) · |Y_{n-m}(k)|²      (P = predelay, in frames)
//
// where δ = 3·ln(10)/T60 gives a 60 dB energy decay over T60. The sum is accumulated
// recursively (rev ← e^{-2δ·hop}·rev + e^{-2δ·P·hop}·|Y_{n-P}|²). Subtract à la Berouti:
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
  let delta = 3 * Math.log(10) / t60               // 1/s — 60 dB energy decay over T60
  let predelayFrames = Math.max(1, Math.round(predelay / hopSec))
  let dStep = Math.exp(-2 * delta * hopSec)         // per-hop energy decay
  let dPre = Math.exp(-2 * delta * predelayFrames * hopSec)

  return function (mag, phase, state) {
    if (!state.history) {
      state.history = []                            // ring of recent power spectra
      state.rev = new Float64Array(half + 1)        // recursive late-reverb power sum
    }
    let hist = state.history, rev = state.rev
    let pwr = new Float64Array(half + 1)
    for (let k = 0; k <= half; k++) pwr[k] = mag[k] * mag[k]
    hist.push(pwr)
    if (hist.length > predelayFrames + 1) hist.shift()

    if (hist.length <= predelayFrames) return { mag, phase }
    let past = hist[0]                              // frame predelayFrames hops ago

    for (let k = 0; k <= half; k++) {
      // rev accumulates Σ_{m≥P} e^{-2δ·m·hop}·|Y_{n-m}|² — the decaying reverb tail
      rev[k] = dStep * rev[k] + dPre * past[k]
      let p = pwr[k]
      let cleaned = p - alpha * rev[k]
      mag[k] = Math.sqrt(Math.max(cleaned, beta * p))
    }
    return { mag, phase }
  }
}
