// De-plosive. A close-mic 'p' or 'b' blows a pressure pulse into the capsule: a thump under `crossover` that rises
// out of nothing and has no period, where a voice's or an instrument's low end repeats at its pitch.
//
// Detection, on 3 ms envelopes of the band under 80 Hz (LF) and the band over 120 Hz (high: a voice's fundamental and
// up), 4th-order Butterworth each: a pop begins when the LF envelope jumps over 3× its own 30 ms average while standing
// over `triggerRatio` × the high band, and holds while the LF stays over that and aperiodic: its periodicity (below)
// under ½. The high band is floored at half its peak over the last seconds: in a pause the room's own rumble, over a
// silent high band, is no pop, and a pop reaches the voice's own level. Nothing begins in the first 30 ms, before the
// average means anything.
//
// Removal: the pop is the sound's own part under `crossover`, taken away, out = x − w·LP(x). LP is linear-phase: a
// pulse through a causal (minimum-phase) filter leaves the filter's response to its edges behind (with the pops' spans
// known, a duck to a causal 2nd-order high-pass at 100 Hz takes a median 12 dB of their error to the clean speech, the
// linear-phase low band at 120 Hz 21). LP runs at ~2 kHz: three box sums of D samples decimate (linear phase, nulls at
// the multiples of the low rate), a Kaiser-windowed sinc of 2M + 1 taps low-passes, linear interpolation returns
// (Crochiere & Rabiner, Multirate DSP, 1983). Its half-length is the look-ahead: the output is `latency(fs)` samples
// (~14 ms) late, and the duck w, held that long past each pop, ramps in before the pop reaches the output. With no pop
// w is 0 and the output is the input, sample for sample, that late.

import { lowpass, highpass, step } from '@audio/biquad'

const RISE = 3                                     // LF envelope over its 30 ms average that begins a pop
const LOW = 80, HIGH = 120                          // Hz, the detection bands' edges
const ONSET = 0.25                                 // a pop's onset: where its LF envelope was under this × at detection
const LEAD = 0.004                                 // s the duck leads that onset by
const WARM = 0.03                                  // s with no pop begun: the 30 ms average's own
const FLOOR = 0.5                                  // high-band floor, × its peak (−6 dB)
const PEAK = 2                                     // s, the peak's decay
const SMOOTH = 0.02                                // s a periodic reading takes to count; an aperiodic one counts at once
const HOP = 0.005                                  // s between periodicity readings
const TAU = 0.04                                   // s, the autocorrelation's memory
const LOOK = 0.0125                                // s, the low-pass's half-length: the look-ahead
const BETA = 5                                     // Kaiser window: sidelobes ~ −37 dB

const dec = fs => 2 * Math.round(fs / 4000) + 1    // odd, so the box sums delay by whole samples
/** The output's delay, samples: the box sums' 3(D − 1)/2, the low-pass's M low-rate samples and the interpolation's one */
export const latency = fs => { let D = dec(fs); return 3 * (D - 1) / 2 + (Math.round(LOOK * fs / D) + 1) * D }

/** Batch: `data` in place, aligned; or, options alone, a stream: write(chunk) returns as many samples, `latency(fs)`
 *  late; write() returns the last `latency(fs)` */
export default function deplosive(data, opts) {
  if (!ArrayBuffer.isView(data)) { let s = stream(data); return chunk => chunk ? s.write(chunk) : s.flush() }
  let s = stream(opts), n = data.length, L = s.latency, a = s.write(data), b = s.flush()
  for (let i = 0; i < n; i++) data[i] = i + L < n ? a[i + L] : b[i + L - n]
  return data
}

export function stream(opts = {}) {
  let fs = opts.fs || 44100, crossover = Math.min(opts.crossover ?? 120, 0.2 * fs / dec(fs))
  let lpC = [lowpass(LOW, 0.5412, fs), lowpass(LOW, 1.3066, fs)], hpC = [highpass(HIGH, 0.5412, fs), highpass(HIGH, 1.3066, fs)]
  let lpS = [[0, 0], [0, 0]], hpS = [[0, 0], [0, 0]]
  let env = [0, 0, 0, 0], ac = autocorr(fs), r = 0, hop = 0, on = false, w = 0, warm = Math.round(WARM * fs)
  let low = lowband(fs, crossover), L = low.delay, line = new Float64Array(L), li = 0
  let marks = new Uint8Array(L), hist = new Float64Array(L), lead = Math.round(LEAD * fs), was = false
  let aDet = Math.exp(-1 / (0.003 * fs)), aSlow = Math.exp(-1 / (0.03 * fs)), aPk = Math.exp(-1 / (PEAK * fs))
  let H = Math.round(HOP * fs), aP = Math.exp(-HOP / SMOOTH)

  let aA, aR, depth, tR
  const read = () => {
    tR = opts.triggerRatio ?? 1; depth = 1 - Math.pow(10, (opts.attenuation ?? -40) / 20)
    aA = Math.exp(-1 / ((opts.attack ?? 0.0005) * fs)); aR = Math.exp(-1 / ((opts.release ?? 0.03) * fs))
  }
  function tick(x) {
    // detection, on the input as it arrives
    let lf = step(lpC[1], lpS[1], step(lpC[0], lpS[0], x)), hf = step(hpC[1], hpS[1], step(hpC[0], hpS[0], x))
    feed(ac, lf)
    if (++hop >= H) { hop = 0; let q = periodicity(ac); r = q < r ? q : aP * r + (1 - aP) * q }
    env[0] = aDet * env[0] + (1 - aDet) * Math.abs(lf)
    env[1] = aDet * env[1] + (1 - aDet) * Math.abs(hf)
    env[2] = aSlow * env[2] + (1 - aSlow) * Math.abs(lf)
    env[3] = Math.max(env[1], aPk * env[3])
    on = env[0] > tR * Math.max(env[1], FLOOR * env[3], 1e-9) && r < 0.5 && (on || env[0] > RISE * env[2] && !warm)
    if (warm) warm--
    // the duck, on the output, `L` behind: on over what the input it carries marks as a pop. A pop begins where its LF
    // rose from under a quarter of what set it off, found back in the look-ahead, LEAD before that (the LF band's own
    // delay): not before, where the linear-phase band holds the pop's mirror image, not its sound
    let mk = marks[li]
    marks[li] = on ? 1 : 0; hist[li] = env[0]
    if (on && !was) {
      let j = li, k = 0, th = ONSET * env[0]
      while (k < L - 1 && hist[j] > th) { j = j ? j - 1 : L - 1; k++ }
      for (let q = Math.min(L - 1, k + lead); q > 0; q--) { marks[j] = 1; j = j ? j - 1 : L - 1 }
    }
    was = on
    let target = mk, a = target > w ? aA : aR
    w = a * w + (1 - a) * target
    if (!target && w < 1e-6) w = 0
    let p = low.step(x), y = line[li]
    line[li] = x; li = li + 1 === L ? 0 : li + 1
    return w ? y - depth * w * p : y
  }
  return {
    latency: L,
    write(chunk) { read(); let out = new Float32Array(chunk.length); for (let i = 0; i < chunk.length; i++) out[i] = tick(chunk[i]); return out },
    flush() { read(); let out = new Float32Array(L); for (let i = 0; i < L; i++) out[i] = tick(0); return out }
  }
}

// The part under `fc`, linear-phase, `delay` samples late: three box sums of D (odd) decimate to fs/D (~2 kHz), a
// Kaiser-windowed sinc of 2M + 1 taps low-passes there, linear interpolation returns
function lowband(fs, fc) {
  let D = dec(fs), rate = fs / D, M = Math.round(LOOK * rate), h = new Float64Array(2 * M + 1), s = 0
  for (let k = -M; k <= M; k++) {
    let c = k ? Math.sin(2 * Math.PI * fc / rate * k) / (Math.PI * k) : 2 * fc / rate
    h[k + M] = c * i0(BETA * Math.sqrt(1 - (k / M) ** 2)); s += h[k + M]
  }
  for (let k = 0; k < h.length; k++) h[k] /= s                       // unit gain at DC
  let box = [new Float64Array(D), new Float64Array(D), new Float64Array(D)], sum = [0, 0, 0], bi = 0
  let u = new Float64Array(2 * M + 1), ui = 0, ph = 0, v0 = 0, v1 = 0
  return {
    delay: 3 * (D - 1) / 2 + (M + 1) * D,
    step(x) {
      for (let j = 0; j < 3; j++) { sum[j] += x - box[j][bi]; box[j][bi] = x; x = sum[j] / D }
      if (++bi === D) bi = 0
      if (ph === 0) {
        u[ui] = x; ui = ui + 1 === u.length ? 0 : ui + 1
        let acc = 0
        for (let k = 0, j = ui; k < u.length; k++, j = j + 1 === u.length ? 0 : j + 1) acc += h[k] * u[j]
        v0 = v1; v1 = acc
      }
      let y = v0 + (v1 - v0) * ph / D
      if (++ph === D) ph = 0
      return y
    }
  }
}
const i0 = x => { let s = 1, t = 1; for (let k = 1; k < 32; k++) { t *= (x / 2 / k) ** 2; s += t } return s }

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
