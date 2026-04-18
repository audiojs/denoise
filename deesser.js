// De-esser — dynamic peaking EQ centred on the sibilance band.
//
// Detection runs on a HP-filtered side-chain (above `freq`); when the envelope
// exceeds threshold, a peaking EQ at `freq` with negative gain is engaged on
// the audio path. EQ gain follows the envelope continuously — recomputed every
// `block` samples for smoothness without per-sample coef cost.
//
// Standard for voice post-production. Unlike a static shelf, the cut only engages
// on loud 's' / 'sh' events, so dark consonants aren't thinned.

import { biquad, highpassCoefs, peakingCoefs, db2lin, lin2db } from './util.js'

export default function deesser(data, params = {}) {
  let fs = params.fs || 44100
  let freq = params.freq ?? 6000
  let threshold = params.threshold ?? -30
  let ratio = params.ratio ?? 4
  let attack = params.attack ?? 0.001
  let release = params.release ?? 0.05
  let Q = params.Q ?? 1.4                          // peaking EQ Q (narrower than 0.707)
  let block = params.block ?? 64                   // coef update interval

  if (!params._init) {
    params._init = true
    params._scC = highpassCoefs(freq, 0.707, fs)
    params._scS = [0, 0]
    params._eqS = [0, 0]
    params._env = 0
    params._eqGainDb = 0
  }

  let aA = Math.exp(-1 / (attack * fs))
  let aR = Math.exp(-1 / (release * fs))
  let aBlk = Math.exp(-block / (release * fs))      // EQ-gain smoothing across blocks
  let thLin = db2lin(threshold)

  // Sidechain: HP copy for detection
  let sc = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) sc[i] = data[i]
  biquad(sc, params._scC.b0, params._scC.b1, params._scC.b2, params._scC.a1, params._scC.a2, params._scS)

  let env = params._env
  let eqDb = params._eqGainDb

  for (let pos = 0; pos < data.length; pos += block) {
    let end = Math.min(data.length, pos + block)
    // update envelope across block, take peak
    let peakEnv = env
    for (let i = pos; i < end; i++) {
      let x = Math.abs(sc[i])
      env = x > env ? aA * env + (1 - aA) * x : aR * env + (1 - aR) * x
      if (env > peakEnv) peakEnv = env
    }
    let target = 0
    if (peakEnv > thLin) {
      let over = lin2db(peakEnv / thLin)
      target = -over * (1 - 1 / ratio)              // negative dB cut
    }
    eqDb = target < eqDb ? aBlk * eqDb + (1 - aBlk) * target : aR * eqDb + (1 - aR) * target

    let coef = peakingCoefs(freq, Q, eqDb, fs)
    let blk = data.subarray(pos, end)
    biquad(blk, coef.b0, coef.b1, coef.b2, coef.a1, coef.a2, params._eqS)
  }
  params._env = env
  params._eqGainDb = eqDb
  return data
}
