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

import { lowpass, highpass } from '@audio/biquad'

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
  let fs = opts.fs || 44100, st = state(fs, opts.crossover ?? 120), L = st.L
  const read = () => {
    let v = st.v
    v[0] = opts.triggerRatio ?? 1; v[1] = 1 - Math.pow(10, (opts.attenuation ?? -40) / 20)
    v[2] = Math.exp(-1 / ((opts.attack ?? 0.0005) * fs)); v[3] = Math.exp(-1 / ((opts.release ?? 0.03) * fs))
    tune(st, opts.crossover ?? 120)
  }
  return {
    latency: L,
    write(chunk) { read(); let out = new Float32Array(chunk.length); block(st, chunk, out); return out },
    flush() { read(); let out = new Float32Array(L); block(st, out, out); return out }
  }
}

/**
 * The stream's memory, made once: every number it keeps between samples is in a typed array (a number written to a
 * closure variable or an object's field is a new object in V8), so `block` allocates nothing. `v` holds what a block
 * reads, [triggerRatio, depth = 1 − 10^(attenuation/20), attack's and release's one-pole coefficients], set by the
 * caller; `tune(state, crossover)` sets the low band's edge (its taps redesigned in place when it changes).
 */
export function state(fs, crossover = 120) {
  let D = dec(fs), rate = fs / D, M = Math.round(LOOK * rate), lp = [lowpass(LOW, 0.5412, fs), lowpass(LOW, 1.3066, fs)], hp = [highpass(HIGH, 0.5412, fs), highpass(HIGH, 1.3066, fs)]
  let bq = new Float64Array(20)                    // b0 b1 b2 a1 a2 of the two low-pass sections, then the two high-pass
  ;[...lp, ...hp].forEach((c, k) => bq.set([c.b0, c.b1, c.b2, c.a1, c.a2], 5 * k))
  let ad = Math.max(1, Math.round(fs / 2000)), arate = fs / ad, hi = Math.round(arate / 40), L = 3 * (D - 1) / 2 + (M + 1) * D
  let s = {
    fs, D, M, L, H: Math.round(HOP * fs), lead: Math.round(LEAD * fs), ad, lo: Math.round(arate / 400), hi,
    bq, z: new Float64Array(8),                     // the four sections' transposed direct-form memories
    // doubles: env (4), r, w, the autocorrelation's running sum, the low band's two outputs v0 v1, its three box sums,
    // and the constants aDet, aSlow, aPk, aP, lam (the autocorrelation's decay), the crossover the taps were made for
    f: Float64Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, Math.exp(-1 / (0.003 * fs)), Math.exp(-1 / (0.03 * fs)), Math.exp(-1 / (PEAK * fs)), Math.exp(-HOP / SMOOTH), Math.exp(-1 / (TAU * arate)), NaN),
    // whole numbers: hop count, warm-up left, on, was, line index, box index, tap index, phase, autocorrelation's k, n
    k: Int32Array.of(0, Math.round(WARM * fs), 0, 0, 0, 0, 0, 0, 0, 0),
    line: new Float64Array(L), marks: new Uint8Array(L), hist: new Float64Array(L),
    box: new Float64Array(3 * D), h: new Float64Array(2 * M + 1), u: new Float64Array(2 * M + 1),
    ax: new Float64Array(128), ae: new Float64Array(128), as: new Float64Array(hi + 1),
    v: new Float64Array(4), q: new Float64Array(1)    // what a block reads; periodicity's result
  }
  tune(s, crossover)
  return s
}

// The part under `fc` as a linear-phase low-pass at ~2 kHz: a Kaiser-windowed sinc of 2M + 1 taps, unit gain at DC,
// designed into the state's taps when the edge changes (the edge held under a fifth of that rate)
export function tune(s, crossover) {
  let fc = Math.min(crossover, 0.2 * s.fs / s.D)
  if (fc === s.f[17]) return
  s.f[17] = fc
  let rate = s.fs / s.D, M = s.M, h = s.h, sum = 0
  for (let k = -M; k <= M; k++) {
    let c = k ? Math.sin(2 * Math.PI * fc / rate * k) / (Math.PI * k) : 2 * fc / rate
    h[k + M] = c * i0(BETA * Math.sqrt(1 - (k / M) ** 2)); sum += h[k + M]
  }
  for (let k = 0; k < h.length; k++) h[k] /= sum
}

/** One block: x through the stream into y (they may be the same memory), `latency` late; allocates nothing */
export function block(s, x, y) {
  let { bq, z, f, k: K, line, marks, hist, box, h, u, ax, ae, as: ac, v, D, L, H, lead, ad, hi } = s
  let tR = v[0], depth = v[1], aA = v[2], aR = v[3], aDet = f[12], aSlow = f[13], aPk = f[14], aP = f[15], lam = f[16]
  let e0 = f[0], e1 = f[1], e2 = f[2], e3 = f[3], r = f[4], w = f[5], asum = f[6], v0 = f[7], v1 = f[8]
  let hop = K[0], warm = K[1], on = K[2], was = K[3], li = K[4], bi = K[5], ui = K[6], ph = K[7], ak = K[8], an = K[9], U = u.length
  for (let i = 0, n = x.length; i < n; i++) {
    let x0 = x[i]
    // detection, on the input as it arrives: 4th-order Butterworth low-pass at LOW and high-pass at HIGH, two sections
    // each (@audio/biquad's transposed direct form II, written out)
    let t = bq[0] * x0 + z[0]; z[0] = bq[1] * x0 - bq[3] * t + z[1]; z[1] = bq[2] * x0 - bq[4] * t
    let lf = bq[5] * t + z[2]; z[2] = bq[6] * t - bq[8] * lf + z[3]; z[3] = bq[7] * t - bq[9] * lf
    t = bq[10] * x0 + z[4]; z[4] = bq[11] * x0 - bq[13] * t + z[5]; z[5] = bq[12] * x0 - bq[14] * t
    let hf = bq[15] * t + z[6]; z[6] = bq[16] * t - bq[18] * hf + z[7]; z[7] = bq[17] * t - bq[19] * hf
    // the low band's autocorrelation at ~2 kHz (see the note above periodicity)
    asum += lf
    if (++ak >= ad) {
      let m = an++, q = asum / ad
      asum = 0; ak = 0
      ax[m & 127] = q
      for (let j = 0; j <= hi; j++) ac[j] = lam * ac[j] + q * ax[(m - j) & 127]
      ae[m & 127] = ac[0]
    }
    if (++hop >= H) { hop = 0; periodicity(s, an); let q = s.q[0]; r = q < r ? q : aP * r + (1 - aP) * q }
    e0 = aDet * e0 + (1 - aDet) * Math.abs(lf)
    e1 = aDet * e1 + (1 - aDet) * Math.abs(hf)
    e2 = aSlow * e2 + (1 - aSlow) * Math.abs(lf)
    e3 = Math.max(e1, aPk * e3)
    on = e0 > tR * Math.max(e1, FLOOR * e3, 1e-9) && r < 0.5 && (on || e0 > RISE * e2 && !warm) ? 1 : 0
    if (warm) warm--
    // the duck, on the output, `L` behind: on over what the input it carries marks as a pop. A pop begins where its LF
    // rose from under a quarter of what set it off, found back in the look-ahead, LEAD before that (the LF band's own
    // delay): not before, where the linear-phase band holds the pop's mirror image, not its sound
    let mk = marks[li]
    marks[li] = on; hist[li] = e0
    if (on && !was) {
      let j = li, c = 0, th = ONSET * e0
      while (c < L - 1 && hist[j] > th) { j = j ? j - 1 : L - 1; c++ }
      for (let q = Math.min(L - 1, c + lead); q > 0; q--) { marks[j] = 1; j = j ? j - 1 : L - 1 }
    }
    was = on
    let a = mk > w ? aA : aR
    w = a * w + (1 - a) * mk
    if (!mk && w < 1e-6) w = 0
    // the part under the crossover, linear-phase, `L` late (see tune and the header): three box sums decimate, the taps
    // low-pass at the low rate, linear interpolation returns
    let p = x0
    for (let j = 0; j < 3; j++) { let o = j * D + bi; f[9 + j] += p - box[o]; box[o] = p; p = f[9 + j] / D }
    if (++bi === D) bi = 0
    if (ph === 0) {
      u[ui] = p; ui = ui + 1 === U ? 0 : ui + 1
      let acc = 0
      for (let c = 0, j = ui; c < U; c++, j = j + 1 === U ? 0 : j + 1) acc += h[c] * u[j]
      v0 = v1; v1 = acc
    }
    p = v0 + (v1 - v0) * ph / D
    if (++ph === D) ph = 0
    let yl = line[li]
    line[li] = x0; li = li + 1 === L ? 0 : li + 1
    y[i] = w ? yl - depth * w * p : yl
  }
  f[0] = e0; f[1] = e1; f[2] = e2; f[3] = e3; f[4] = r; f[5] = w; f[6] = asum; f[7] = v0; f[8] = v1
  K[0] = hop; K[1] = warm; K[2] = on; K[3] = was; K[4] = li; K[5] = bi; K[6] = ui; K[7] = ph; K[8] = ak; K[9] = an
}
const i0 = x => { let s = 1, t = 1; for (let k = 1; k < 32; k++) { t *= (x / 2 / k) ** 2; s += t } return s }

// The low band's autocorrelation at ~2 kHz, exponentially weighted (in `block`): s[t] = Σ λ^k·x[n−k]·x[n−k−t] for lags
// up to 25 ms, e[n] = s[0] at n. A 40 ms memory reads as steadily as an 80 ms window, and sooner.
// Periodicity: the normalized cross-correlation (Talkin 1995), s[t] / √(s[0]·e[n−t]), at lags of 2.5–25 ms (pitches
// of 400–40 Hz), its peak past the first lag where it turns negative, into s.q[0]. A smooth pulse stays correlated at
// short lags; only a periodic sound comes back at its period. A harmonic H in noise N reads H / (H + N) (Boersma 1993).
function periodicity(st, n) {
  let s = st.as, e = st.ae, lo = st.lo, hi = st.hi, best = 0, dipped = false
  if (s[0] > 1e-20) for (let t = 1; t <= hi; t++) {
    let c = s[t] / Math.sqrt(s[0] * e[(n - 1 - t) & 127] + 1e-30)
    if (c < 0) dipped = true
    else if (dipped && t >= lo && c > best) best = c
  }
  st.q[0] = best
}
