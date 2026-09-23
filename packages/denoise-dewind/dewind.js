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
    params._coefs = Array(order).fill(highpass(cutoffMin, Q, fs))
    params._lfDc = [0, 0]
    params._mfDc = [0, 0]
    params._acc = [0, 0, 0]                        // LF energy, MF energy, samples measured
  }

  let lfLp = lowpassNum(200, fs)
  let mfBp = bandpassNum(300, 2000, fs)
  // Measurement-filter states persist across calls so the LF/MF ratio is continuous
  // at chunk boundaries in streaming mode (fresh [0,0] each call would re-ring).
  let lfState = params._lfDc, mfState = params._mfDc, acc = params._acc

  let aA = Math.exp(-blockSize / (attack * fs))
  let aR = Math.exp(-blockSize / (release * fs))
  let n = data.length
  let pos = 0

  // Analysis blocks run on the stream's own clock: a block begun in one call finishes in
  // the next, and each block's cutoff filters the block after it. Output is the same
  // under any chunking, and the attack/release ballistics hold at any host block size.
  while (pos < n) {
    let end = Math.min(n, pos + blockSize - acc[2])
    for (let i = pos; i < end; i++) {
      let lf = lfLp(data[i], lfState), mf = mfBp(data[i], mfState)
      acc[0] += lf * lf
      acc[1] += mf * mf
    }
    acc[2] += end - pos
    cascade(data.subarray(pos, end), params._coefs, params._state)
    pos = end
    if (acc[2] < blockSize) break

    let ratio = acc[0] / Math.max(acc[1], 1e-12)
    acc[0] = acc[1] = acc[2] = 0
    // map ratio → cutoff: clamped at cutoffMin for ratio ≲1.7, reaching cutoffMax near ratio≈19
    let target = cutoffMin + (cutoffMax - cutoffMin) * Math.min(1, Math.max(0, (Math.log(ratio + 1) - 1) / 2))
    let prev = params._fc
    let aRate = target > prev ? aA : aR
    params._fc = aRate * prev + (1 - aRate) * target
    params._coefs = Array(order).fill(highpass(params._fc, Q, fs))
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
