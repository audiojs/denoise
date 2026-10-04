// De-plosive. A close-mic 'p' or 'b' blows a pressure pulse into the capsule: a thump under `crossover` that rises
// out of nothing and has no period, where a voice's or an instrument's low end repeats at its pitch.
//
// Detection, on 3 ms envelopes of the band under `crossover` (LF) and the band over it (high): a duck begins when the
// LF envelope jumps over 3× its own 30 ms average while standing over `triggerRatio` × the high band, and holds while
// the LF stays over that and aperiodic: its periodicity (below) under ½. The high band is floored at a tenth of its
// peak over the last seconds: in a pause the room's own rumble, over a silent high band, is no pop.
//
// The duck crossfades toward the high-passed sound, out = x − (1 − g)·(x − HP(x)): at g = 1 the input comes back
// sample for sample, below it the response is g + (1 − g)·HP(f), never over 0 dB.

import { process as biquad, highpass, lowpass } from '@audio/biquad'

const RISE = 3                                     // LF envelope over its 30 ms average that begins a duck
const FLOOR = 0.1                                  // high-band floor, × its peak (−20 dB)
const PEAK = 2                                     // s, the peak's decay
const SMOOTH = 0.02                                // s a periodic reading takes to count; an aperiodic one counts at once
const HOP = 0.005                                  // s between periodicity readings
const TAU = 0.04                                   // s, the autocorrelation's memory

export default function deplosive(data, params = {}) {
  let fs = params.fs || 44100
  let triggerRatio = params.triggerRatio ?? 4
  let attenuation = params.attenuation ?? -18      // dB cut on LF band when triggered
  let attack = params.attack ?? 0.002
  let release = params.release ?? 0.03
  let crossover = params.crossover ?? 200

  if (!params._init) {
    params._init = true
    params._lpC = lowpass(crossover, 0.707, fs)   // detection
    params._hpC = highpass(crossover, 0.707, fs)  // detection, and what the duck crossfades to
    params._lpS = [0, 0]
    params._hpS = [0, 0]
    params._env = [0, 0, 0, 0]                     // LF, high band (3 ms), LF (30 ms), high-band peak
    params._ac = autocorr(fs)
    params._r = 0                                  // periodicity
    params._hop = 0
    params._on = false
    params._gain = 1
  }

  let aA = Math.exp(-1 / (attack * fs))
  let aR = Math.exp(-1 / (release * fs))
  let cutLin = Math.pow(10, attenuation / 20)

  let lfBuf = Float32Array.from(data), hpBuf = Float32Array.from(data)
  biquad(lfBuf, params._lpC, params._lpS)
  biquad(hpBuf, params._hpC, params._hpS)

  let aDet = Math.exp(-1 / (0.003 * fs)), aSlow = Math.exp(-1 / (0.03 * fs)), aPk = Math.exp(-1 / (PEAK * fs))
  let hop = Math.round(HOP * fs), aP = Math.exp(-HOP / SMOOTH)
  let env = params._env, ac = params._ac, gain = params._gain, on = params._on

  for (let i = 0; i < data.length; i++) {
    let lf = lfBuf[i], hp = hpBuf[i]
    feed(ac, lf)
    if (++params._hop >= hop) { params._hop = 0; let r = periodicity(ac); params._r = r < params._r ? r : aP * params._r + (1 - aP) * r }
    env[0] = aDet * env[0] + (1 - aDet) * Math.abs(lf)
    env[1] = aDet * env[1] + (1 - aDet) * Math.abs(hp)
    env[2] = aSlow * env[2] + (1 - aSlow) * Math.abs(lf)
    env[3] = Math.max(env[1], aPk * env[3])
    on = env[0] > triggerRatio * Math.max(env[1], FLOOR * env[3], 1e-9) && params._r < 0.5 && (on || env[0] > RISE * env[2])
    let target = on ? cutLin : 1
    let a = target < gain ? aA : aR
    gain = a * gain + (1 - a) * target
    data[i] -= (1 - gain) * (data[i] - hp)        // == data[i] when gain == 1
  }
  params._gain = gain
  params._on = on
  return data
}

// The low band's autocorrelation at ~2 kHz, exponentially weighted: s[t] = Σ λ^k·x[n−k]·x[n−k−t] for lags up to
// 25 ms, e[n] = s[0] at n. A 40 ms memory reads as steadily as an 80 ms window, and sooner.
function autocorr(fs) {
  let dec = Math.max(1, Math.round(fs / 2000)), rate = fs / dec, hi = Math.round(rate / 40)
  return { dec, lo: Math.round(rate / 400), hi, lam: Math.exp(-1 / (TAU * rate)), x: new Float64Array(128), e: new Float64Array(128), s: new Float64Array(hi + 1), n: 0, sum: 0, k: 0 }
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
// only a periodic sound comes back at its period. A harmonic H in noise N reads H / (H + N) (Boersma 1993).
function periodicity(a) {
  let { s, e, n, lo, hi } = a, best = 0, dipped = false
  if (!(s[0] > 1e-20)) return 0
  for (let t = 1; t <= hi; t++) {
    let c = s[t] / Math.sqrt(s[0] * e[(n - 1 - t) & 127] + 1e-30)
    if (c < 0) dipped = true
    else if (dipped && t >= lo && c > best) best = c
  }
  return best
}
