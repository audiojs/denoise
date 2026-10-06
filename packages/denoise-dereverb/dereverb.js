// De-reverb: the late reverberation off a voice, one channel, the whole take at once.
//
// 1. Weighted prediction error, WPE: Nakatani, Yoshioka, Kinoshita, Miyoshi & Juang, "Speech dereverberation based on
//    variance-normalized delayed linear prediction", IEEE TASLP 18(7), 2010. In each STFT bin the late reverberation
//    of frame t is what the frames D … D+K−1 before it predict:
//      d(t) = y(t) − gᴴ ȳ(t),   ȳ(t) = [y(t−D), …, y(t−D−K+1)]ᵀ
//    g minimizes Σₜ |d(t)|² / λ(t) over the take, the voice a zero-mean Gaussian of variance λ: g = R⁻¹ r with
//    R = Σ ȳȳᴴ/λ, r = Σ ȳ y*/λ, λ = |y|², then |d|² of the previous fit (eq. 13–15; ITER fits). The room is one for
//    the whole take and the voice is not: fitted over all of it, g learns the room, while a voice's own correlation,
//    which changes with every vowel, averages out. D is the frame over the hop, the first frame before t that shares
//    no sample with it (43 ms at 48 kHz): the prediction never reads the frame it predicts.
// 2. One channel cannot invert a room: the prediction cancels a dB or two of the tail (Yoshioka & Nakatani, IEEE TASLP
//    20(10), 2012). The rest is taken in power, as Lebart, Boucher & Denbigh (Acta Acustica 87(3), 2001) and Habets
//    (in Naylor & Gaubitch, Speech Dereverberation, 2010) model the late reverberation: from the power of the frames
//    before, which a diffuse tail carries on in power (Polack 1993):
//      λᵣ(t) = s · Σₖ wₖ |y(t−D−k)|²,   wₖ = |gₖ|² / Σⱼ |gⱼ|²
//    The taps give the shape, how each frame before weighs in, the room's decay as WPE measured it in that bin. The
//    scale s is read off the take: in a cell that holds the tail alone, |y|² over its expected power is exponential
//    with mean 1 (a diffuse tail is complex Gaussian), and a tenth of such cells fall under −ln 0.9 = 0.105 of it; a
//    voice's cells lie above. So s, per octave band, is the 10th percentile of |y(t)|² / Σₖ wₖ|y(t−D−k)|² over the
//    band's cells, over 0.105 (on the training takes the late power sat 8.4–8.8 dB over that percentile in the bands
//    under 2 kHz; 1/0.105 is 9.8 dB). 0.3 scaled the taps' own power, |gₖ|², by a constant: fitted on 3 s they
//    predicted about all of the late power, on 30 s a quarter, as a fit's variance does. The percentile reads short
//    and long takes alike: within 0.6 dB of each other, each within about 1 dB (s.d.) of the late power its room left.
//    No band's s exceeds the 0.5–4 kHz bands' by more than CAP: a held note, or a voice's low harmonics, reads as a
//    longer room in its band (sung straight tones read about 10 dB over their mid bands under 500 Hz), while the
//    training rooms' late power sat about 1 dB over their mid bands' there.
// 3. A gain takes λᵣ from what WPE left, as Kinoshita, Delcroix, Nakatani & Miyoshi (IEEE TASLP 17(4), 2009) take a
//    linear prediction's late reverberation off in power: Ephraim & Malah's log-spectral amplitude (IEEE TASSP 33(2),
//    1985, eq. 20), the a priori ratio decision-directed (IEEE TASSP 32(6), 1984, eq. 51), floored at GMIN. No bin
//    leaves louder than it came.
// Two checks on the whole take come first; either returns it as it came, bit for bit:
//   dry: no room lets a sound fall faster than its tail. The 2nd percentile of the same ratio over the 0.5–4 kHz bands
//     is the take's fastest fall: −43 dB on dry VoiceBank takes (median), −27 dB in the MIT rooms; under DRY nothing
//     is taken (90 % of the dry training takes, 18 % of the reverberant ones, those where it would have gained PESQ
//     0.07 on average, against 0.3 lost on a dry take).
//   pauses: the scale stands on a voice's pauses. Scheirer & Slaney's low-energy-frame share (ICASSP 1997), the share
//     of frames under half the take's mean power over 0.5–4 kHz, is 0.53–0.86 for speech in the training rooms
//     (lena's dense reading 0.50–0.54), 0.45–0.48 for three of the four music pieces (Vibe Ace 0.62), 0.03–0.67 for
//     MUSDB18 previews (median 0.33). Under PAUSES nothing is taken: a held note's sustain reads as a room's.
// The constants were chosen on VoiceBank training speakers in MIT IR Survey rooms the test set does not use
// (scripts/dereverb.py).

import { stftBatch } from '@audio/stft'

const ORDER = 0.11, ITER = 3                   // 110 ms of past predict a frame; fits, Nakatani's 3
const Q = 0.1, C = -1 / Math.log(0.9)          // the scale's percentile; a diffuse tail's mean over it
const QDRY = 0.02, DRY = -37.5                 // the fastest-fall percentile; under it (dB), a dry take
const PAUSES = 0.5, CAP = 2                    // low-energy-frame share under which the take has no pauses; dB
const GATE = 0.01                              // cells whose past is under 1 % of the band's mean power carry no tail
const EDGES = [0, 250, 500, 1000, 2000, 4000], MID = [2, 5]   // octave bands, Hz; 0.5–4 kHz
const HLO = -150, HSTEP = 0.1, HN = 2000       // the ratio's histogram, dB: −150 to +50 in 0.1 dB
const GMIN = 0.2, ADD = 0.85, XIMIN = 1e-3     // the gain's floor, −14 dB; decision-directed memory per 8 ms frame
                                               // (rescaled to the hop); ξ's floor
const REF_DT = 128 / 16000

// The analysis frame: the power of two nearest 40 ms (512 at 16 kHz, 1024 at 22.05, 2048 at 44.1 and 48), hop a
// quarter: the 110 ms of prediction stays within 9 to 14 frames
export const frame = fs => 2 ** Math.round(Math.log2(0.04 * fs))

// frame, hop, and the prediction's delay D and taps K (frames) an option set resolves to
export function framing(opts = {}) {
  let fs = opts.fs || 44100, N = opts.frameSize || frame(fs), hop = opts.hopSize || N >> 2, dt = hop / fs
  return { ...opts, fs, frameSize: N, hopSize: hop, D: Math.max(1, Math.round(N / hop)), K: Math.max(1, Math.round(ORDER / dt)) }
}

// ITER passes fit g, one reads the take's late scale; a last one takes the reverberation off, unless the take is dry
// or has no pauses
export default function dereverb(data, opts = {}) {
  if (!ArrayBuffer.isView(data)) throw new TypeError('dereverb(data, opts): the fit needs the whole take (there is no stream form since 0.3)')
  let o = framing(opts), w = room(o)
  if (!data.length) return new Float32Array(0)
  for (let i = 0; i < ITER; i++) { stftBatch(data, w.fit(i), o); w.solve() }
  stftBatch(data, w.read(), o)
  let s = w.scale()
  return s ? stftBatch(data, w.take(C * (opts.strength ?? 1), s), o) : Float32Array.from(data)
}

// The per-bin fit and its use. Each pass runs the frames through a ring of the last D + K; fit(i) sums R and r,
// solve() turns them into g and the shape w, read() histograms the ratio per band, scale() turns the histograms into
// s per bin (null: leave the take), take(β, s) is the output pass.
function room({ frameSize: N, hopSize: hop, fs, D, K }) {
  let F = (N >> 1) + 1, M = D + K, KK = K * K, NB = EDGES.length
  let yr = new Float64Array(M * F), yi = new Float64Array(M * F), ix = new Int32Array(K)
  let gr = new Float64Array(F * K), gi = new Float64Array(F * K), wk = new Float64Array(F * K)
  let Rr = new Float64Array(F * KK), Ri = new Float64Array(F * KK), rr = new Float64Array(F * K), ri = new Float64Array(F * K)
  let br = new Float64Array(K), bi = new Float64Array(K), dr = 0, di = 0, t = 0, top = 0, first = true
  let band = Int32Array.from({ length: F }, (_, f) => EDGES.findLastIndex(e => e <= f * fs / N))
  let psum = new Float64Array(NB), cells = new Float64Array(NB), hist = new Float64Array(NB * HN), mid = []

  // frame t into the ring; ix: the slots of y(t−D) … y(t−D−K+1), zero before the take; the first pass finds the
  // loudest bin and each band's mean power
  function push(mag, phase) {
    if (t === 0) { yr.fill(0); yi.fill(0) }
    let c = (t % M) * F
    for (let f = 0; f < F; f++) {
      yr[c + f] = mag[f] * Math.cos(phase[f]); yi[c + f] = mag[f] * Math.sin(phase[f])
      if (first) { let p = mag[f] * mag[f]; if (p > top) top = p; psum[band[f]] += p; cells[band[f]]++ }
    }
    for (let i = 0; i < K; i++) ix[i] = ((t - D - i) % M + M) % M * F
    return c
  }
  // ȳ of bin f into br, bi; d = y − gᴴȳ into dr, di
  function predict(c, f) {
    let g = f * K; dr = yr[c + f]; di = yi[c + f]
    for (let i = 0; i < K; i++) {
      let xr = br[i] = yr[ix[i] + f], xi = bi[i] = yi[ix[i] + f]
      dr -= gr[g + i] * xr + gi[g + i] * xi; di -= gr[g + i] * xi - gi[g + i] * xr
    }
  }
  // Σₖ wₖ |y(t−D−k)|² in bin f, after predict
  function past(f) {
    let g = f * K, u = 0
    for (let i = 0; i < K; i++) u += wk[g + i] * (br[i] * br[i] + bi[i] * bi[i])
    return u
  }
  // the value under which a fraction q of band b's cells lie, as a power ratio; 0 when it has 20 cells or fewer
  function quantile(b, q) {
    let h = b * HN, n = 0, cum = 0
    for (let k = 0; k < HN; k++) n += hist[h + k]
    if (n <= 20) return 0
    for (let k = 0; k < HN; k++) if ((cum += hist[h + k]) >= q * n) return 10 ** ((HLO + (k + 0.5) * HSTEP) / 10)
  }
  let gmean = v => Math.exp(v.reduce((a, x) => a + Math.log(Math.max(x, 1e-30)), 0) / v.length)

  return {
    fit: i => {
      t = 0; first = i === 0
      if (first) { gr.fill(0); gi.fill(0) }
      Rr.fill(0); Ri.fill(0); rr.fill(0); ri.fill(0)
      return (mag, phase) => {
        let c = push(mag, phase), floor = top * 1e-10 + 1e-30     // λ's floor, 100 dB under the loudest bin (so far)
        for (let f = 0; f < F; f++) {
          let ur = yr[c + f], ui = yi[c + f]
          // a bin cut to digital silence (an edit, a gate) holds no room; weighed at the floor, it would teach g that
          // the past predicts nothing
          if (ur * ur + ui * ui <= floor) continue
          predict(c, f)
          let w = 1 / Math.max(dr * dr + di * di, floor), q = f * KK, g = f * K
          for (let a = 0; a < K; a++) {
            let ar = br[a] * w, ai = bi[a] * w
            rr[g + a] += ar * ur + ai * ui; ri[g + a] += ai * ur - ar * ui              // ȳ y* / λ
            for (let b = a, p = q + a * K; b < K; b++) {                              // ȳ ȳᴴ / λ, upper triangle
              Rr[p + b] += ar * br[b] + ai * bi[b]; Ri[p + b] += ai * br[b] - ar * bi[b]
            }
          }
        }
        t++
        return { mag, phase }
      }
    },
    solve: () => {
      for (let f = 0; f < F; f++) {
        cholesky(Rr, Ri, rr, ri, gr, gi, f, K)
        let g = f * K, e = 0
        for (let i = 0; i < K; i++) e += wk[g + i] = gr[g + i] * gr[g + i] + gi[g + i] * gi[g + i]
        for (let i = 0; i < K; i++) wk[g + i] = e > 0 ? wk[g + i] / e : 0
      }
    },
    // 10 log10 |y|²/Σ wₖ|y(t−D−k)|² of each cell that sounds and has a past (over GATE of its band's mean power),
    // per band; the 0.5–4 kHz power of each frame
    read: () => {
      t = 0; first = false; hist.fill(0); mid.length = 0
      let floor = top * 1e-10 + 1e-30, mean = psum.map((p, b) => cells[b] ? p / cells[b] : 0)
      return (mag, phase) => {
        let c = push(mag, phase), e = 0
        for (let f = 0; f < F; f++) {
          let p = mag[f] * mag[f], b = band[f]
          if (b >= MID[0] && b < MID[1]) e += p
          if (p <= floor) continue
          predict(c, f)
          let u = past(f)
          if (!(u > GATE * mean[b])) continue
          let k = Math.floor((10 * Math.log10(p / u) - HLO) / HSTEP)
          hist[b * HN + Math.min(HN - 1, Math.max(0, k))]++
        }
        mid.push(e); t++
        return { mag, phase }
      }
    },
    scale: () => {
      let s = EDGES.map((_, b) => quantile(b, Q)), m = gmean(s.slice(...MID)), fall = gmean(EDGES.slice(...MID).map((_, i) => quantile(MID[0] + i, QDRY)))
      // the low-energy-frame share among frames within 60 dB of the loudest
      let top = mid.reduce((a, e) => Math.max(a, e), 0), on = mid.filter(e => e > top * 1e-6), avg = on.reduce((a, e) => a + e, 0) / on.length
      let low = on.length ? on.filter(e => e < 0.5 * avg).length / on.length : 1
      if (10 * Math.log10(Math.max(fall, 1e-30)) < DRY || low < PAUSES) return null
      // per bin, interpolated over log frequency between the bands' centres (the lowest taken from 125 Hz up)
      let cen = EDGES.map((e, b) => Math.log2(Math.sqrt(Math.max(e, 125) * (EDGES[b + 1] ?? fs / 2)))), cap = m * 10 ** (CAP / 10)
      s = s.map(v => Math.min(v, cap))
      return Float64Array.from({ length: F }, (_, f) => {
        let x = Math.log2(Math.max(f * fs / N, 1)), b = cen.findLastIndex(c => c <= x)
        return b < 0 ? s[0] : b === NB - 1 ? s[b] : s[b] + (s[b + 1] - s[b]) * (x - cen[b]) / (cen[b + 1] - cen[b])
      })
    },
    take: (beta, s) => {
      t = 0; first = false
      let a = ADD ** (hop / fs / REF_DT), eta = new Float64Array(F)       // Â²(t−1)/λᵣ(t−1), decision-directed memory
      return (mag, phase) => {
        let c = push(mag, phase)
        for (let f = 0; f < F; f++) {
          predict(c, f)
          let lr = beta * s[f] * past(f), d2 = dr * dr + di * di, G = 1
          if (lr > 0) {
            let gm = d2 / lr, xi = Math.max(a * eta[f] + (1 - a) * Math.max(gm - 1, 0), XIMIN)
            G = Math.min(1, Math.max(GMIN, xi / (1 + xi) * Math.exp(0.5 * e1(gm * xi / (1 + xi)))))
            eta[f] = G * G * gm
          }
          mag[f] = Math.min(G * Math.sqrt(d2), mag[f]); phase[f] = Math.atan2(di, dr)
        }
        t++
        return { mag, phase }
      }
    }
  }
}

// g = R⁻¹ r in bin f by Cholesky, R = L Lᴴ (Hermitian positive definite, its upper triangle stored), loaded by 10⁻⁶
// of its mean diagonal so a near-singular bin stays solvable; a bin that never sounded keeps g = 0
function cholesky(Rr, Ri, rr, ri, gr, gi, f, K) {
  let q = f * K * K, g = f * K, tr = 0
  for (let a = 0; a < K; a++) tr += Rr[q + a * K + a]
  if (!(tr > 0)) { gr.fill(0, g, g + K); gi.fill(0, g, g + K); return }
  let Lr = new Float64Array(K * K), Li = new Float64Array(K * K), load = tr / K * 1e-6
  for (let j = 0; j < K; j++) {
    let s = Rr[q + j * K + j] + load
    for (let k = 0; k < j; k++) s -= Lr[j * K + k] ** 2 + Li[j * K + k] ** 2
    let d = Math.sqrt(Math.max(s, load)); Lr[j * K + j] = d
    for (let i = j + 1; i < K; i++) {                          // L[i][j] = (R[i][j] − Σₖ L[i][k] L[j][k]*) / L[j][j], R[i][j] = R[j][i]*
      let sr = Rr[q + j * K + i], si = -Ri[q + j * K + i]
      for (let k = 0; k < j; k++) {
        sr -= Lr[i * K + k] * Lr[j * K + k] + Li[i * K + k] * Li[j * K + k]
        si -= Li[i * K + k] * Lr[j * K + k] - Lr[i * K + k] * Li[j * K + k]
      }
      Lr[i * K + j] = sr / d; Li[i * K + j] = si / d
    }
  }
  let zr = new Float64Array(K), zi = new Float64Array(K)
  for (let i = 0; i < K; i++) {                                // L z = r
    let sr = rr[g + i], si = ri[g + i]
    for (let k = 0; k < i; k++) { sr -= Lr[i * K + k] * zr[k] - Li[i * K + k] * zi[k]; si -= Lr[i * K + k] * zi[k] + Li[i * K + k] * zr[k] }
    zr[i] = sr / Lr[i * K + i]; zi[i] = si / Lr[i * K + i]
  }
  for (let i = K - 1; i >= 0; i--) {                           // Lᴴ g = z
    let sr = zr[i], si = zi[i]
    for (let k = i + 1; k < K; k++) { sr -= Lr[k * K + i] * gr[g + k] + Li[k * K + i] * gi[g + k]; si -= Lr[k * K + i] * gi[g + k] - Li[k * K + i] * gr[g + k] }
    gr[g + i] = sr / Lr[i * K + i]; gi[g + i] = si / Lr[i * K + i]
  }
}

// E1(v) for v > 0: Abramowitz & Stegun 5.1.53 (v < 1) and 5.1.56 (v ≥ 1), as @audio/noise-estimate computes it
function e1(v) {
  if (v <= 0) return 30
  if (v < 1) return ((((0.00107857 * v - 0.00976004) * v + 0.05519968) * v - 0.24991055) * v + 0.99999193) * v - 0.57721566 - Math.log(v)
  return Math.exp(-v) / v * (0.2677737343 + v * (8.6347608925 + v * (18.0590169730 + v * (8.5733287401 + v)))) /
    (3.9584969228 + v * (21.0996530827 + v * (25.6329561486 + v * (9.5733223454 + v))))
}
