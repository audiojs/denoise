// De-plosive — detect short low-frequency bursts ('p', 'b' attacks on close mics)
// and locally attenuate the LF band only.
//
// Detection: ratio of LF (<crossover) energy to the complementary high-band energy
// in a sliding window. A spike above `triggerRatio` opens a duck on the LF band for
// `attack` ms, then releases over `release` ms. The high band is the exact complement
// of the LF band (HF = x − LF), so with gain = 1 the output equals the input sample
// for sample — high content passes untouched, no crossover coloration.

import { process as biquad, lowpass, highpass } from '@audio/biquad'

export default function deplosive(data, params = {}) {
  let fs = params.fs || 44100
  let triggerRatio = params.triggerRatio ?? 4
  let attenuation = params.attenuation ?? -18      // dB cut on LF band when triggered
  let attack = params.attack ?? 0.005
  let release = params.release ?? 0.08
  let crossover = params.crossover ?? 200

  if (!params._init) {
    params._init = true
    params._lpC = lowpass(crossover, 0.707, fs)
    params._hpC = highpass(crossover, 0.707, fs)   // detection sidechain only
    params._lpS = [0, 0]
    params._hpS = [0, 0]
    params._lfDetS = [0, 0]
    params._mfDetS = [0, 0]
    params._gain = 1
  }

  let aA = Math.exp(-1 / (attack * fs))
  let aR = Math.exp(-1 / (release * fs))
  let cutLin = Math.pow(10, attenuation / 20)

  // Low-passed copy drives the OUTPUT; the high band is the sample-exact complement
  // x − lf (so gain = 1 reproduces the input). A separate high-pass drives DETECTION
  // only — the complement carries the LF's phase residual, which would blunt the
  // LF/high ratio and make real plosives under-trigger.
  let lfBuf = new Float32Array(data.length)
  let hpBuf = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) { lfBuf[i] = data[i]; hpBuf[i] = data[i] }
  biquad(lfBuf, params._lpC, params._lpS)
  biquad(hpBuf, params._hpC, params._hpS)

  // detection: 1-pole envelopes on LF vs. the high-passed side-chain
  let aDet = Math.exp(-1 / (0.003 * fs))
  let lfEnv = params._lfDetS[0], mfEnv = params._mfDetS[0]
  let gain = params._gain

  for (let i = 0; i < data.length; i++) {
    let lf = lfBuf[i], hf = data[i] - lf
    lfEnv = aDet * lfEnv + (1 - aDet) * Math.abs(lf)
    mfEnv = aDet * mfEnv + (1 - aDet) * Math.abs(hpBuf[i])
    let ratio = lfEnv / Math.max(mfEnv, 1e-9)
    let target = ratio > triggerRatio ? cutLin : 1
    let aRate = target < gain ? aA : aR
    gain = aRate * gain + (1 - aRate) * target
    data[i] = lf * gain + hf                        // == data[i] when gain == 1
  }
  params._lfDetS[0] = lfEnv
  params._mfDetS[0] = mfEnv
  params._gain = gain
  return data
}
