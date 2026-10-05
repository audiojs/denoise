// De-reverb: the late reverberation off a voice, one channel, the whole take at once.
//
// 1. Weighted prediction error, WPE: Nakatani, Yoshioka, Kinoshita, Miyoshi & Juang, "Speech dereverberation based on
//    variance-normalized delayed linear prediction", IEEE TASLP 18(7), 2010. In each STFT bin the late reverberation
//    of frame t is what the frames D … D+K−1 before it predict:
//      d(t) = y(t) − gᴴ ȳ(t),   ȳ(t) = [y(t−D), …, y(t−D−K+1)]ᵀ
//    g minimizes Σₜ |d(t)|² / λ(t) over the take, the voice a zero-mean Gaussian of variance λ: g = R⁻¹ r with
//    R = Σ ȳȳᴴ/λ, r = Σ ȳ y*/λ, λ = |y|², then |d|² of the previous fit (eq. 13–15; ITER fits). The room is one for
//    the whole take and the voice is not: fitted over all of it, g learns the room, while a voice's own correlation,
//    which changes with every vowel, averages out (fitted over a second, as a recursive filter does, g learns some
//    of the voice too and takes it).
// 2. One channel cannot invert a room: the prediction cancels a fraction of the tail (Yoshioka & Nakatani, IEEE TASLP
//    20(10), 2012). But its taps measure the room, and the power the past sends into frame t,
//      λᵣ(t) = β Σₖ |gₖ|² |y(t−D−k)|²
//    (E|gᴴȳ|² without the frames' cross terms: a diffuse tail adds in power, Polack 1993), is the late reverberation's
//    spectral variance, which Lebart, Boucher & Denbigh (Acta Acustica 87(3), 2001) and Habets (in Naylor & Gaubitch,
//    Speech Dereverberation, 2010) model from a decay time and a direct-to-reverberant ratio: the taps hold both, no
//    decay time is estimated, and on a dry voice they are near zero. As Kinoshita, Delcroix, Nakatani & Miyoshi (IEEE
//    TASLP 17(4), 2009) take a linear prediction's late reverberation off in power, a gain takes it from what WPE
//    left: Ephraim & Malah's log-spectral amplitude (IEEE TASSP 33(2), 1985, eq. 20), the a priori ratio
//    decision-directed (IEEE TASSP 32(6), 1984, eq. 51), floored at GMIN. β is `strength` times BETA: the taps
//    predict part of the late power, on a half-minute take about a quarter of it.
// Each bin leaves no louder than it came: a prediction that adds power (a voice's own correlation, learned as room)
// adds an echo of the voice, not anything a room left out.
// The constants were chosen on VoiceBank training speakers in MIT IR Survey rooms the test set does not use
// (scripts/dereverb.py).

import { stftBatch } from '@audio/stft'

const DELAY = 0.05, ORDER = 0.11, ITER = 3     // s, s: the late part starts 50 ms after the direct sound; 110 ms of
                                               // past predict it; fits, Nakatani's 3
const BETA = 4, GMIN = 0.2                     // the estimate's scale at strength 1; the gain's floor, −14 dB
const ADD = 0.92, XIMIN = 1e-3                 // decision-directed memory per 8 ms frame (rescaled to the hop); ξ's floor
// Below TILT, β falls 3 dB an octave: a voice's low harmonics hold their phase longest, and the taps learn some of
// them as room (on the training takes they predicted 4 to 7 dB more of the late power at 63–125 Hz, relative to
// 0.5–2 kHz, and 1 to 4 dB more at 125–250 Hz)
const TILT = 500
const REF_DT = 128 / 16000

// The analysis frame: the power of two nearest 40 ms (512 at 16 kHz, 1024 at 22.05, 2048 at 44.1 and 48), hop a
// quarter: the 110 ms of prediction stays within 9 to 14 frames
export const frame = fs => 2 ** Math.round(Math.log2(0.04 * fs))

// frame, hop, and the prediction's delay D and taps K (frames) an option set resolves to
export function framing(opts = {}) {
  let fs = opts.fs || 44100, N = opts.frameSize || frame(fs), hop = opts.hopSize || N >> 2, dt = hop / fs
  return { ...opts, fs, frameSize: N, hopSize: hop, D: Math.max(1, Math.round(DELAY / dt)), K: Math.max(1, Math.round(ORDER / dt)) }
}

// ITER passes fit g, a last one takes the reverberation off
export default function dereverb(data, opts = {}) {
  if (!ArrayBuffer.isView(data)) throw new TypeError('dereverb(data, opts): the fit needs the whole take (there is no stream form since 0.3)')
  let o = framing(opts), w = room(o)
  if (!data.length) return new Float32Array(0)
  for (let i = 0; i < ITER; i++) { stftBatch(data, w.fit(i), o); w.solve() }
  return stftBatch(data, w.take(BETA * (opts.strength ?? 1)), o)
}

// The per-bin fit and its use. Each pass runs the frames through a ring of the last D + K; fit(i) sums R and r,
// solve() turns them into g, take(β) is the output pass.
function room({ frameSize: N, hopSize: hop, fs, D, K }) {
  let F = (N >> 1) + 1, M = D + K, KK = K * K
  let yr = new Float64Array(M * F), yi = new Float64Array(M * F), ix = new Int32Array(K)
  let gr = new Float64Array(F * K), gi = new Float64Array(F * K)
  let Rr = new Float64Array(F * KK), Ri = new Float64Array(F * KK), rr = new Float64Array(F * K), ri = new Float64Array(F * K)
  let br = new Float64Array(K), bi = new Float64Array(K), dr = 0, di = 0, t = 0, top = 0, first = true

  // frame t into the ring; ix: the slots of y(t−D) … y(t−D−K+1), zero before the take; the first pass finds the
  // loudest bin
  function push(mag, phase) {
    if (t === 0) { yr.fill(0); yi.fill(0) }
    let c = (t % M) * F
    for (let f = 0; f < F; f++) {
      yr[c + f] = mag[f] * Math.cos(phase[f]); yi[c + f] = mag[f] * Math.sin(phase[f])
      if (first && mag[f] * mag[f] > top) top = mag[f] * mag[f]
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
    solve: () => { for (let f = 0; f < F; f++) cholesky(Rr, Ri, rr, ri, gr, gi, f, K) },
    take: beta => {
      t = 0; first = false
      let a = ADD ** (hop / fs / REF_DT), eta = new Float64Array(F)       // Â²(t−1)/λᵣ(t−1), decision-directed memory
      return (mag, phase) => {
        let c = push(mag, phase)
        for (let f = 0; f < F; f++) {
          predict(c, f)
          let g = f * K, lr = 0, d2 = dr * dr + di * di, G = 1, bf = beta * Math.min(1, f * fs / N / TILT)
          for (let i = 0; i < K; i++) lr += (gr[g + i] * gr[g + i] + gi[g + i] * gi[g + i]) * (br[i] * br[i] + bi[i] * bi[i])
          if (lr > 0 && bf > 0) {
            let gm = d2 / (bf * lr), xi = Math.max(a * eta[f] + (1 - a) * Math.max(gm - 1, 0), XIMIN)
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
