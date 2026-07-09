// De-wind / de-rumble — adaptive high-pass that opens wider when low-frequency
// energy spikes (wind blast, handling thump). Cutoff drifts between
// `cutoffMin` (steady-state) and `cutoffMax` (active wind), driven by the ratio
// of LF (<200 Hz) to mid-band (300-2000 Hz) energy.
//
// One-pole tracker on the cutoff makes movement smooth — no audible swept-EQ
// pumping. For sustained outdoor recording, set `cutoffMin: 120`.

import { cascade, highpass } from '@audio/biquad'

export default function dewind(data, params = {}) {
  let fs = params.fs || 44100
  let cutoffMin = params.cutoffMin ?? 60
  let cutoffMax = params.cutoffMax ?? 250
  let order = params.order ?? 2                    // each = 12 dB/oct
  let Q = params.Q ?? 0.707
  let attack = params.attack ?? 0.05               // s — how fast cutoff opens
  let release = params.release ?? 0.4              // s — how slowly it closes
  let blockSize = params.blockSize ?? 1024         // recompute cutoff every N samples

  if (!params._state || params._state.length !== order) {
    params._state = Array.from({ length: order }, () => [0, 0])
    params._fc = cutoffMin
    params._coefs = []
    params._lfDc = [0, 0]
    params._mfDc = [0, 0]
  }

  let lfHp = highpass(40, 0.707, fs)          // gate band: anything > 40 Hz
  let lfLp = lowpassNum(200, fs)
  let mfBp = bandpassNum(300, 2000, fs)
  let lfState = [0, 0], mfState = [0, 0]

  let aA = Math.exp(-blockSize / (attack * fs))
  let aR = Math.exp(-blockSize / (release * fs))
  let n = data.length
  let pos = 0

  while (pos < n) {
    let end = Math.min(n, pos + blockSize)
    // measure LF and MF energy of the block (cheap one-pole bandpass on a copy)
    let lfE = 0, mfE = 0, len = end - pos
    for (let i = pos; i < end; i++) {
      let x = data[i]
      let lf = lfLp(x, lfState)
      let mf = mfBp(x, mfState)
      lfE += lf * lf
      mfE += mf * mf
    }
    lfE /= len; mfE /= len
    let ratio = lfE / Math.max(mfE, 1e-12)
    // ratio: 0–1 calm, > 5 windy
    let target = cutoffMin + (cutoffMax - cutoffMin) * Math.min(1, Math.max(0, (Math.log(ratio + 1) - 1) / 2))
    let prev = params._fc
    let aRate = target > prev ? aA : aR
    let fc = aRate * prev + (1 - aRate) * target
    params._fc = fc

    // rebuild HP cascade for this block
    let coef = highpass(fc, Q, fs)
    let coefs = []
    for (let i = 0; i < order; i++) coefs.push(coef)
    params._coefs = coefs

    let blk = data.subarray(pos, end)
    cascade(blk, params._coefs, params._state)
    pos = end
  }
  return data
}

// One-pole low-pass (single sample, in-place state).
function lowpassNum(fc, fs) {
  let a = Math.exp(-2 * Math.PI * fc / fs)
  return (x, s) => {
    let y = (1 - a) * x + a * s[0]
    s[0] = y
    return y
  }
}

// Band-pass = HP(fLo) followed by LP(fHi) one-poles.
function bandpassNum(fLo, fHi, fs) {
  let aL = Math.exp(-2 * Math.PI * fLo / fs)
  let aH = Math.exp(-2 * Math.PI * fHi / fs)
  return (x, s) => {
    s[0] = aL * s[0] + (1 - aL) * x                // LP
    let hp = x - s[0]                              // HP residual
    s[1] = aH * s[1] + (1 - aH) * hp               // LP again — net BP
    return s[1]
  }
}
