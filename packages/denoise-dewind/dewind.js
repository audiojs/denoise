// De-wind. Wind is turbulence at the microphone: noise under a few hundred Hz with no period, in gusts (Nelke & Vary,
// IWAENC 2014), where a voice's or an instrument's low end is a row of harmonics. A time-domain high-pass can only take
// everything under its cutoff, the voice's low harmonics with the wind; here each STFT bin under `cutoff` is weighed
// against a wind spectrum read from the frame itself, so the harmonics stay and the wind between and under them goes.
//
// The wind spectrum, per frame (Hann, the power of two nearest 85 ms, so a 100 Hz voice's harmonics stand 8 bins apart
// with valleys between them; a quarter-frame hop):
//   P̄      the periodogram averaged with the last frame's
//   floor  P̄'s morphological opening (erosion, then dilation) over 5 bins: what is left once every peak narrower than
//          5 bins is cut, and a stationary sinusoid under a Hann window is 4 bins wide, so the harmonics go and the
//          broad wind stays (the inverse harmonic mask of Nelke, Naylor & Vary, ICASSP 2015, without a pitch track); ×
//          1.64, the opening's mean on Gaussian noise (measured), so it reads a noise at its power. Under 20 Hz, where
//          no harmonic lies, P̄ itself
//   cap    in a voice's valleys, onsets and unvoiced sounds the floor is the voice. Wind keeps its shape across the
//          band while it gusts (its level and slope follow the wind speed, Mirabilii et al., IWAENC 2022), so over
//          100 Hz the floor is held to 4 × a·S: a the floor's energy at 20–100 Hz this frame, S the least floor/a seen
//          at each bin over the last 1.5 s (minimum statistics, Martin 2001, on the level-normalized floor): where no
//          voice was
// The gain, OM-LSA's form (Cohen & Berdugo 2001): G = G_H1^p · G_min^(1−p), G_H1 the Wiener gain on the
// decision-directed a priori SNR (Ephraim & Malah 1984, α 0.9 per frame) floored at G_min = `attenuation`, p the speech
// presence probability at a fixed a priori SNR of 15 dB (Gerkmann & Hendriks 2012) with an a priori absence of 0.2 on a
// harmonic, 0.9 elsewhere: a harmonic is a local peak of P̄ standing 6 dB over the wind, its 5 bins. So a harmonic
// keeps what of it stands over the wind, and the wind's own random peaks, which a Wiener gain lets through as musical
// noise, go.
//
// Wind is there when the low band, 20–300 Hz, is aperiodic and outweighs the 300–2000 Hz band, floored 20 dB under its
// peak over the last seconds (a room's quiet rumble in a pause is no wind next to a voice), in three frames in a row:
// three hops, so a gap of 150 ms between words shows it. Aperiodic: the low band's normalized autocorrelation, taken
// through the frame's own spectrum over the window's (Boersma 1993), peaks under ½ at 2.5–25 ms (a harmonic H in noise
// N reads H / (H + N)); a bass line, a kick drum's body or a voice's low end repeats. Its energy counts as 1 − r. Once
// found, wind is held 1 s, through the words, whose low end hides it; the gain comes in within a frame and goes out
// over 0.2 s. With no wind the removal is zero: the output is the input, sample for sample, N − 1 samples later.

import { stftBatch, stftStream } from '@audio/stft'
import { ifft } from 'fourier-transform'

const writer = s => chunk => chunk ? s.write(chunk) : s.flush()

// the power of two nearest 85 ms: 4096 at 44.1 and 48 kHz, 2048 at 22.05 and 32, 1024 at 16
export const frame = fs => 2 ** Math.round(Math.log2(0.085 * fs))

const H = 2                                        // the opening's half-width, bins: 5 bins
const BIAS = 1.64                                  // E[P] / E[opening(P̄)] on white Gaussian noise
const SUB = 20, LEVEL = 100, LOW = 300, MID = 2000 // Hz: subsonic, the level band's top, the low band's, the mid band's
const CAP = 4, SPAN = 1.5, SUBS = 6, AR = 0.7      // shape cap: × the shape, its memory (s) in sub-windows, smoothing
const ADD = 0.9, XI_MIN = 1e-3                     // decision-directed α per frame, a priori SNR floor (−30 dB)
const XI_H1 = 10 ** 1.5, PEAK = 4                  // SPP's a priori SNR (15 dB), a harmonic's standing over the wind
const Q_PEAK = 0.2, Q_ELSE = 0.9                   // a priori speech absence on a harmonic, elsewhere
const R_MAX = 0.5, FLOOR = 0.01, DECAY = 2         // periodic above; the mid band's floor × its peak, which decays (s)
const ARM = 3, HOLD = 1, UP = 0.02, DOWN = 0.2     // frames in a row; s held, in, out

function framing(opts) {
  let fs = opts.fs || 44100, N = opts.frameSize || frame(fs)
  return { ...opts, fs, frameSize: N, hopSize: opts.hopSize || N >> 2 }
}

/** Batch: takes the wind out of `data` in place and returns it. Stream: `dewind(opts)` returns write(chunk) → the
 *  samples done so far (N − 1 behind), write() → the rest. */
export default function dewind(dataOrOpts, opts) {
  if (dataOrOpts instanceof Float32Array || dataOrOpts instanceof Float64Array) {
    let data = dataOrOpts, o = framing(opts || {}), r = stftBatch(data, removal(o), o)
    for (let i = 0; i < data.length; i++) data[i] -= r[i]
    return data
  }
  let live = dataOrOpts || {}
  return writer(stream(framing(live), live))
}

/** The part taken away, as a frame process (mag, phase) → { mag, phase }, for a host running @audio/stft's framing
 *  (`frameSize`, `hopSize` a quarter of it); the output is the input less its overlap-add. One per channel. */
export const processor = opts => removal(framing(opts || {}))

// output = input − removal, the input held until its removal is done; `cutoff`, `attenuation` read from `live` per frame
function stream(o, live) {
  let s = stftStream(removal(o, live), o), buf = new Float32Array(o.frameSize * 2), len = 0
  let take = r => {
    let y = new Float32Array(r.length)
    for (let i = 0; i < r.length; i++) y[i] = buf[i] - r[i]
    buf.copyWithin(0, r.length, len); len -= r.length
    return y
  }
  return {
    write(chunk) {
      if (len + chunk.length > buf.length) { let b = new Float32Array(2 * (len + chunk.length)); b.set(buf.subarray(0, len)); buf = b }
      buf.set(chunk, len); len += chunk.length
      return take(s.write(chunk))
    },
    flush: () => take(s.flush())
  }
}

function removal(o, live = o) {
  let fs = o.fs, N = o.frameSize, hop = o.hopSize, half = N >> 1, K = half + 1, bin = fs / N
  let k20 = Math.min(half, Math.ceil(SUB / bin)), kA = Math.round(LEVEL / bin), kL = Math.min(half, Math.round(LOW / bin)), kM = Math.min(half, Math.round(MID / bin))
  let Pb = new Float64Array(K), fl = new Float64Array(K), lam = new Float64Array(K), e = new Float64Array(K)
  let q = new Float64Array(K), Gp = new Float64Array(K).fill(1), gp = new Float64Array(K), out = new Float64Array(K)
  let rb = new Float64Array(K), cur = new Float64Array(K).fill(Infinity), subs = [], V = Math.max(1, Math.round(SPAN * fs / hop / SUBS)), t = 0
  let ar = new Float64Array(K), ai = new Float64Array(K), tLo = Math.round(0.0025 * fs), tHi = Math.min(half - 1, Math.round(0.025 * fs)), rw = winAc(N, tHi)
  let aPk = Math.exp(-hop / (DECAY * fs)), up = Math.exp(-hop / (UP * fs)), down = Math.exp(-hop / (DOWN * fs)), hold = Math.round(HOLD * fs / hop)
  let peak = 0, run = 0, left = 0, w = 0

  return (mag, phase) => {
    let kHi = Math.min(half, Math.round((live.cutoff ?? 1500) / bin)), n = Math.min(K, kHi + H + 1)
    let gMin = 10 ** (Math.min(0, live.attenuation ?? -20) / 20)
    for (let k = 0; k < K; k++) { let p = mag[k] * mag[k]; Pb[k] = t ? (Pb[k] + p) / 2 : p }

    // the wind spectrum
    for (let k = 0; k < k20; k++) lam[k] = Pb[k]
    opening(Pb, k20, n, e, fl)
    let a = 0
    for (let k = k20; k < n; k++) lam[k] = BIAS * fl[k]
    for (let k = k20; k <= kA && k < n; k++) a += lam[k]
    if (a > 0) {
      for (let k = kA + 1; k < n; k++) { let r = lam[k] / a; rb[k] = t ? AR * rb[k] + (1 - AR) * r : r; if (rb[k] < cur[k]) cur[k] = rb[k] }
      for (let k = kA + 1; k < n; k++) { let m = cur[k]; for (let u of subs) if (u[k] < m) m = u[k]; if (CAP * a * m < lam[k]) lam[k] = CAP * a * m }
    }
    if (++t % V === 0) { subs.push(Float64Array.from(cur)); if (subs.length > SUBS) subs.shift(); cur.fill(Infinity) }

    // is it wind: the low band aperiodic and over the mid band, for ARM frames in a row; then held
    let El = 0, Em = 0
    for (let k = k20; k <= kL; k++) El += mag[k] * mag[k]
    for (let k = kL + 1; k <= kM; k++) Em += mag[k] * mag[k]
    peak = Math.max(Em, aPk * peak)
    let r = periodicity(mag, k20, kL, ar, ai, rw, tLo, tHi)
    run = r < R_MAX && (1 - r) * El > Math.max(Em, FLOOR * peak) ? run + 1 : 0
    if (run >= ARM) left = hold
    else if (left > 0) left--
    let T = left > 0 ? 1 : 0, c = T > w ? up : down
    w = c * w + (1 - c) * T
    if (!T && w < 1e-3) w = 0

    // the gain
    q.fill(Q_ELSE, 0, kHi + 1)
    for (let k = 1; k < kHi; k++) if (Pb[k] > Pb[k - 1] && Pb[k] >= Pb[k + 1] && Pb[k] > PEAK * lam[k])
      for (let j = Math.max(0, k - H), J = Math.min(kHi, k + H); j <= J; j++) q[j] = Q_PEAK
    out.fill(0)
    for (let k = 0; k <= kHi; k++) {
      let g = lam[k] > 0 ? mag[k] * mag[k] / lam[k] : 1e6
      let xi = Math.max(ADD * Gp[k] * Gp[k] * gp[k] + (1 - ADD) * Math.max(g - 1, 0), XI_MIN)
      let G = Math.min(1, Math.max(xi / (1 + xi), gMin))
      Gp[k] = G; gp[k] = g
      let p = 1 / (1 + q[k] / (1 - q[k]) * (1 + XI_H1) * Math.exp(-g * XI_H1 / (1 + XI_H1)))
      if (w) out[k] = w * (1 - G ** p * gMin ** (1 - p)) * mag[k]
    }
    return { mag: out, phase }
  }
}

// erosion then dilation over 2H + 1 bins of P[lo..n): every peak narrower than that cut, broader shapes kept
function opening(P, lo, n, e, d) {
  for (let k = lo; k < n; k++) { let m = Infinity; for (let j = Math.max(lo, k - H), J = Math.min(n - 1, k + H); j <= J; j++) if (P[j] < m) m = P[j]; e[k] = m }
  for (let k = lo; k < n; k++) { let m = 0; for (let j = Math.max(lo, k - H), J = Math.min(n - 1, k + H); j <= J; j++) if (e[j] > m) m = e[j]; d[k] = m }
}

// the band's normalized autocorrelation from the frame's power spectrum over the window's, its peak at lags tLo..tHi past
// the first lag where it turns negative: a smooth noise stays correlated at short lags, only a periodic sound comes back
function periodicity(mag, lo, hi, ar, ai, rw, tLo, tHi) {
  ar.fill(0); ai.fill(0)
  for (let k = lo; k <= hi; k++) ar[k] = mag[k] * mag[k]
  let c = ifft(ar, ai), c0 = c[0], best = 0, dipped = false
  if (!(c0 > 1e-30)) return 0
  for (let t = 1; t <= tHi; t++) {
    let v = c[t] / c0 / rw[t]
    if (v < 0) dipped = true
    else if (dipped && t >= tLo && v > best) best = v
  }
  return Math.min(1, best)
}

// the Hann window's circular autocorrelation, normalized: what a white noise's would read
let acs = new Map()
function winAc(N, tHi) {
  let key = N * 65536 + tHi
  if (acs.has(key)) return acs.get(key)
  let w = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)), r = new Float64Array(tHi + 1)
  for (let t = 0; t <= tHi; t++) { let s = 0; for (let i = 0; i < N; i++) s += w[i] * w[(i + t) % N]; r[t] = s }
  for (let t = tHi; t >= 0; t--) r[t] /= r[0]
  acs.set(key, r)
  return r
}
