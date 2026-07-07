// De-plosive — detect short low-frequency bursts ('p', 'b' attacks on close mics)
// and locally attenuate the LF band only.
//
// Detection: ratio of LF (<200 Hz) energy to mid (300-2000 Hz) energy in a sliding
// window. A spike above `triggerRatio` opens a duck on the LF band for `attack` ms,
// then releases over `release` ms. Mid/high content passes unchanged — voice
// timbre preserved.

import { biquad, highpassCoefs, lowpassCoefs } from '@audio/denoise-core'

export default function deplosive(data, params = {}) {
  let fs = params.fs || 44100
  let triggerRatio = params.triggerRatio ?? 4
  let attenuation = params.attenuation ?? -18      // dB cut on LF band when triggered
  let attack = params.attack ?? 0.005
  let release = params.release ?? 0.08
  let crossover = params.crossover ?? 200

  if (!params._init) {
    params._init = true
    params._lpC = lowpassCoefs(crossover, 0.707, fs)
    params._hpC = highpassCoefs(crossover, 0.707, fs)
    params._lpS = [0, 0]
    params._hpS = [0, 0]
    params._lfDetS = [0, 0]
    params._mfDetS = [0, 0]
    params._gain = 1
  }

  let aA = Math.exp(-1 / (attack * fs))
  let aR = Math.exp(-1 / (release * fs))
  let cutLin = Math.pow(10, attenuation / 20)

  let lfBuf = new Float32Array(data.length)
  let hfBuf = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) { lfBuf[i] = data[i]; hfBuf[i] = data[i] }
  biquad(lfBuf, params._lpC.b0, params._lpC.b1, params._lpC.b2, params._lpC.a1, params._lpC.a2, params._lpS)
  biquad(hfBuf, params._hpC.b0, params._hpC.b1, params._hpC.b2, params._hpC.a1, params._hpC.a2, params._hpS)

  // detection: 1-pole envelopes on LF and MF
  let aDet = Math.exp(-1 / (0.003 * fs))
  let lfEnv = params._lfDetS[0], mfEnv = params._mfDetS[0]
  let gain = params._gain

  for (let i = 0; i < data.length; i++) {
    let lfA = Math.abs(lfBuf[i]), mfA = Math.abs(hfBuf[i])
    lfEnv = aDet * lfEnv + (1 - aDet) * lfA
    mfEnv = aDet * mfEnv + (1 - aDet) * mfA
    let ratio = lfEnv / Math.max(mfEnv, 1e-9)
    let target = ratio > triggerRatio ? cutLin : 1
    let aRate = target < gain ? aA : aR
    gain = aRate * gain + (1 - aRate) * target
    data[i] = lfBuf[i] * gain + hfBuf[i]
  }
  params._lfDetS[0] = lfEnv
  params._mfDetS[0] = mfEnv
  params._gain = gain
  return data
}
