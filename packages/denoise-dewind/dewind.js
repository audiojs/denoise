// De-wind. Wind is turbulence at the microphone: its energy lies under a few hundred Hz and it has no period (Nelke &
// Vary, IWAENC 2014), where a voice's or an instrument's low end repeats at its pitch. So the energy under 200 Hz is
// weighed by how aperiodic it is, 1 − r (r its periodicity, below: a harmonic H in noise N reads H / (H + N), Boersma
// 1993, so 1 − r of the band is noise), against the 300–2000 Hz band, floored at a hundredth of that band's peak over
// the last seconds: the room's own rumble in a pause, over a silent mid band, is no wind. Every 5 ms that ratio ρ sets
// the cutoff, cutoffMin + (cutoffMax − cutoffMin)·clamp((ln(1 + ρ) − 1) / 2): from ρ = e − 1 up, cutoffMax by ρ ≈ 19.
//
// The high-pass (Butterworth, −3 dB at the cutoff, `order` sections of 12 dB/oct) crossfades in over `attack` once
// ρ > 1, the low band's noise outweighing the mid band, with the low end aperiodic for 30 ms: wind blows on, a drum hit
// or a note's onset is over sooner. It goes back out over `release`, or within 5 ms once the low end turns periodic (a
// voice or a note began). Out, the input comes back sample for sample.

import { cascade, highpass } from '@audio/biquad'

const FLOOR = 0.01                                 // mid-band floor, × its peak (−20 dB)
const PEAK = 2                                     // s, the peak's decay
const HOLD = 0.03                                  // s the low end stays aperiodic before it is taken for wind
const QUICK = 0.005                                // s, the release once the low end turns periodic
const TAU = 0.04                                   // s, the autocorrelation's memory

export default function dewind(data, params = {}) {
  let fs = params.fs || 44100
  let cutoffMin = params.cutoffMin ?? 60
  let cutoffMax = params.cutoffMax ?? 250
  let order = params.order ?? 2                    // sections, 12 dB/oct each
  let attack = params.attack ?? 0.05               // s, how fast it comes in
  let release = params.release ?? 0.4              // s, how slowly it goes
  let blockSize = Math.max(1, params.blockSize ?? Math.round(0.005 * fs))   // re-estimated every N samples

  if (!params._state || params._state.length !== order) {
    params._state = Array.from({ length: order }, () => [0, 0])
    params._fc = cutoffMin
    params._coefs = butterworth(cutoffMin, order, fs)
    params._lfDc = [0, 0]
    params._mfDc = [0, 0]
    params._acc = [0, 0, 0]                        // LF energy, MF energy, samples measured
    params._ac = autocorr(fs)
    params._peak = 0                               // MF energy's recent peak
    params._aper = 0                               // samples the low end has stayed aperiodic
    params._quick = false                          // the low end is periodic: go quickly
    params._w = 0                                  // the filter's share, and its target
    params._wT = 0
  }

  let lfLp = lowpassNum(200, fs)
  let mfBp = bandpassNum(300, 2000, fs)
  // Measurement-filter states persist across calls so the LF/MF ratio is continuous
  // at chunk boundaries in streaming mode (fresh [0,0] each call would re-ring).
  let lfState = params._lfDc, mfState = params._mfDc, acc = params._acc, ac = params._ac

  let aA = Math.exp(-blockSize / (attack * fs)), aR = Math.exp(-blockSize / (release * fs)), aQ = Math.exp(-blockSize / (QUICK * fs))
  let wA = Math.exp(-1 / (attack * fs)), wR = Math.exp(-1 / (release * fs)), wQ = Math.exp(-1 / (QUICK * fs))
  let aPk = Math.exp(-blockSize / (PEAK * fs))
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
      feed(ac, lf)
    }
    acc[2] += end - pos
    mix(data.subarray(pos, end), params, wA, params._quick ? wQ : wR)
    pos = end
    if (acc[2] < blockSize) break

    let r = periodicity(ac)
    params._peak = Math.max(acc[1], aPk * params._peak)
    let ratio = (1 - r) * acc[0] / Math.max(acc[1], FLOOR * params._peak, 1e-12)
    acc[0] = acc[1] = acc[2] = 0
    let m = Math.min(1, Math.max(0, (Math.log(ratio + 1) - 1) / 2))
    params._quick = r >= 0.5
    params._aper = params._quick ? 0 : params._aper + blockSize
    params._wT = ratio > 1 && params._aper >= HOLD * fs ? 1 : 0
    let target = cutoffMin + (cutoffMax - cutoffMin) * m
    let prev = params._fc
    let aRate = target > prev ? aA : params._quick ? aQ : aR
    params._fc = aRate * prev + (1 - aRate) * target
    params._coefs = butterworth(params._fc, order, fs)
  }
  return data
}

// The high-pass, crossfaded in by its share w: at w = 0 the input passes sample for sample. The filter runs throughout,
// so it comes in without a start-up transient.
function mix(y, p, up, down) {
  if (!(p._wet?.length >= y.length)) p._wet = new Float64Array(y.length)
  let wet = p._wet.subarray(0, y.length), w = p._w, T = p._wT
  wet.set(y)
  cascade(wet, p._coefs, p._state)
  if (!w && !T) return
  for (let i = 0; i < y.length; i++) {
    let a = T > w ? up : down
    w = a * w + (1 - a) * T
    if (!T && w < 1e-6) w = 0                      // out: exactly
    y[i] += w * (wet[i] - y[i])
  }
  p._w = w
}

// `order` sections of a Butterworth high-pass of order 2·order: Q = 1 / (2 sin((2k − 1)π / (4·order)))
function butterworth(fc, order, fs) {
  return Array.from({ length: order }, (_, k) => highpass(fc, 1 / (2 * Math.sin((2 * k + 1) * Math.PI / (4 * order))), fs))
}

// The low band's autocorrelation at ~2 kHz, exponentially weighted: s[t] = Σ λ^k·x[n−k]·x[n−k−t] for lags up to
// 25 ms, e[n] = s[0] at n. A 40 ms memory reads as steadily as an 80 ms window, and sooner.
function autocorr(fs) {
  let dec = Math.max(1, Math.round(fs / 2000)), rate = fs / dec, hi = Math.round(rate / 40)
  return { dec, lo: Math.round(rate / 400), hi, full: hi + Math.round(TAU * rate), lam: Math.exp(-1 / (TAU * rate)), x: new Float64Array(128), e: new Float64Array(128), s: new Float64Array(hi + 1), n: 0, sum: 0, k: 0 }
}
function feed(a, v) {
  a.sum += v
  if (++a.k < a.dec) return
  let x = a.x, s = a.s, n = a.n++, u = a.sum / a.dec
  a.sum = a.k = 0
  x[n & 127] = u
  for (let t = 0; t <= a.hi; t++) s[t] = a.lam * s[t] + u * x[(n - t) & 127]
  a.e[n & 127] = s[0]
}
// Periodicity: the normalized cross-correlation (Talkin 1995), s[t] / √(s[0]·e[n−t]), at lags of 2.5–25 ms (pitches
// of 400–40 Hz), its peak past the first lag where it turns negative. A smooth pulse stays correlated at short lags;
// only a periodic sound comes back at its period. Until the longest lag and the memory have filled, no reading: the
// low end counts as periodic, and nothing is taken for wind on no evidence.
function periodicity(a) {
  let { s, e, n, lo, hi } = a, best = 0, dipped = false
  if (n < a.full) return 1
  if (!(s[0] > 1e-20)) return 0
  for (let t = 1; t <= hi; t++) {
    let c = s[t] / Math.sqrt(s[0] * e[(n - 1 - t) & 127] + 1e-30)
    if (c < 0) dipped = true
    else if (dipped && t >= lo && c > best) best = c
  }
  return best
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
