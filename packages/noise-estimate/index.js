// Noise PSD estimators feeding the statistical denoisers (Wiener, OM-LSA, MMSE).
//   - noiseProfile: average |X|² over a user-chosen quiet segment (manual baseline)
//   - minStats: Martin (2001) — track minima of smoothed |X|² in sliding window
//   - imcra: Cohen (2003) — Improved MCRA, two-iteration smoothing + speech-presence-driven
//   - known: a noiseProfile held, with imcra's per-frame SNR outputs (OM-LSA on a learned noise)
//   - partials: a tracker's estimate kept off a program's partials (held notes, sustained vowels, chords)
//
// All estimators are stateful: pass the same params object across frames in stream mode.

import { stftAnalyse } from '@audio/stft'

// One-shot batch profile from a quiet segment of `data`. Returns Float64Array(N/2+1).
export function noiseProfile(data, opts = {}) {
  let N = opts.frameSize || 2048
  let hop = opts.hopSize || (N >> 2)
  let half = N >> 1
  let from = Math.max(0, opts.from ?? 0)
  let to = Math.min(data.length, opts.to ?? Math.min(data.length, from + N * 8))
  let seg = data.subarray(from, to)
  let psd = new Float64Array(half + 1)
  let count = 0
  stftAnalyse(seg, mag => {
    for (let k = 0; k <= half; k++) psd[k] += mag[k] * mag[k]
    count++
  }, { frameSize: N, hopSize: hop })
  let scale = count ? 1 / count : 0
  for (let k = 0; k <= half; k++) psd[k] *= scale
  return psd
}

// Minimum Statistics (Martin 2001) — frame-by-frame online updater.
// Keeps a rolling D-frame minimum of the smoothed PSD per bin, times the bias compensation B_min that makes the
// minimum estimate E{|N|²} rather than its lower tail; once the window holds D frames, never above their mean.
//
// B_min is E{P}/E{P_min} for Gaussian noise, a periodogram swinging over 2 degrees of freedom. A steady line (a whine,
// a pilot tone, a carrier) hardly swings: its minimum is its mean, and B_min puts it that much over (6.5 dB in
// wiener's 1.5 s window at 44.1 kHz; the LSA gain's floor passes √(ξ_min λ), so the line came through 6 dB louder).
// The noise holds no more power than the bin it is in: the window's mean caps the estimate. Where the bin swings as
// noise or speech does, the mean lies over P_min·B_min and the minimum governs. The cap waits for a full window: over
// fewer frames B_min(D) exceeds the Gaussian bias of that window, the mean would undercut it in every bin, and the
// estimate would become the running mean, speech and all. Its cost on Gaussian noise: the mean estimate up to 0.4 dB
// lower (0.35 at the defaults), where P_min·B_min spreads over the mean. Martin's per-bin B_min from the variance of
// P (2001 §IV-B) put Gaussian noise 2-4 dB under with this fixed α (the variance, smoothed over ~2 frames of a
// 3-frame smoother, runs low). With his time-varying optimal α as well (eqs. 7-11: α_max 0.96, α_c, β = min(α², 0.8),
// B_c = 1 + 2.12 √Q̄⁻¹; α floored at 0.3 per 16 ms, else it ran away downward) the estimate under a narration's speech
// came down (+3.3 → +0.6 dB at 300 Hz–1 kHz, pink noise 20 dB under the voice), but steady pink noise alone read
// 1.7 dB under, and wiener lost PESQ (1.79 → 1.73 on VoiceBank+DEMAND training speech), BAK and OVRL, its noise
// reduction falling from 5.0 to 3.8 dB: speech kept by underestimating the noise, not by estimating it better.
//
// Usage:
//   let est = minStats(half, { D: 96 })
//   stftAnalyse(data, m => est.update(m))
//   let psd = est.psd  // current noise PSD
//
// D = 96 frames ≈ 1.1 s at hop 512, 44.1 kHz. `partials` (true, or `partials`'s options; with `fs` and `hop`) passes
// the estimate through `partials`, so a held note is not learned as noise.
export function minStats(half, opts = {}) {
  let D = opts.D || 96
  let alpha = opts.alpha ?? 0.7              // smoothing on PSD
  let bias = opts.bias ?? biasMin(D, alpha)
  let bins = half + 1
  let smoothed = new Float64Array(bins)
  let psd = new Float64Array(bins)
  let guard = guarded(bins, opts), y2 = guard && new Float64Array(bins)
  // The D-frame minimum per bin, by monotonic deque: each bin keeps the frames that can still be its minimum,
  // values rising from head to tail (O(1) amortized per bin per frame, not a rescan of D frames)
  let val = new Float64Array(bins * D), at = new Int32Array(bins * D)
  let head = new Int32Array(bins), size = new Int32Array(bins), frame = 0
  // the last D smoothed values per bin (a ring) and their sum, for the window's mean
  let win = new Float64Array(bins * D), sum = new Float64Array(bins)
  // the smoother's memory, 1/(1−α) frames: before it fills, P is the mean of the frames so far, the estimate
  let settle = Math.ceil(1 / (1 - alpha))

  return {
    psd,
    bias,
    partials: guard,
    update(mag) {
      let silent = true
      for (let k = 0; k <= half; k++) if (mag[k]) { silent = false; break }
      if (silent) return                         // digital silence holds no noise to learn: a zero would stay D frames
      let i = frame % D
      for (let k = 0, o = 0; k <= half; k++, o += D) {
        let pk = mag[k] * mag[k]
        // the smoother starts on the mean of the frames so far, not on 0 (a warm-up from 0 would be the window's minimum
        // for D frames), and its values enter the minimum once its memory is full: one periodogram swings over 2
        // degrees of freedom, not the 2(1+α)/(1−α) B_min is for, and 1 % of bins would start 20 dB low and stay the
        // minimum for D frames (2.6 % of bins 10 dB under white noise over the first 1.5 s; 0.09 % now)
        let a = Math.min(alpha, frame / (frame + 1))
        let v = smoothed[k] = a * smoothed[k] + (1 - a) * pk
        if (frame < settle) { sum[k] += v - win[o + i]; win[o + i] = v; psd[k] = v; continue }
        let h = head[k], n = size[k], t
        if (n && at[o + h] <= frame - D) { if (++h === D) h = 0; n-- }    // oldest left the window
        while (n && val[o + ((t = h + n - 1) >= D ? t - D : t)] >= v) n--  // newer and no larger: they can't be minima
        t = h + n >= D ? h + n - D : h + n
        val[o + t] = v; at[o + t] = frame; n++
        head[k] = h; size[k] = n
        sum[k] += v - win[o + i]; win[o + i] = v
        if (i === D - 1) { let s = 0; for (let j = o; j < o + D; j++) s += win[j]; sum[k] = s }  // once a window: no drift
        psd[k] = frame < D - 1 ? val[o + h] * bias : Math.min(val[o + h] * bias, sum[k] / D)
      }
      if (guard) { for (let k = 0; k <= half; k++) y2[k] = mag[k] * mag[k]; guard.update(y2, psd) }
      frame++
    }
  }
}

// B_min(D, Q_eq): the mean of the smoothed periodogram over the mean of its D-frame minimum, Martin 2001 eq. (17):
// 1 + 2(D−1)(1 − M(D)) / (Q_eq − 2M(D)). A periodogram of Gaussian noise has 2 degrees of freedom; smoothing it by
// α gives Q_eq = 2(1+α)/(1−α) (variance (1−α)/(1+α) of the periodogram's). M(D): Martin 2006 Table 5, interpolated
// in 1/√D as VOICEBOX's v_estnoisem.m does. 3.44 for the defaults (D 96, α 0.7): on white Gaussian noise through the
// family's 2048/512 Hann frames the estimate's mean is then 0.2 dB under the noise power; the 1.5 used before,
// Martin 1994's factor for α = 0.95, left it 3.8 dB under.
const MD = [[1, 0], [2, 0.26], [5, 0.48], [8, 0.58], [10, 0.61], [15, 0.668], [20, 0.705], [30, 0.762], [40, 0.8],
  [60, 0.841], [80, 0.865], [120, 0.89], [140, 0.9], [160, 0.91], [180, 0.92], [220, 0.93], [260, 0.935], [300, 0.94]]
function biasMin(D, alpha) {
  let i = MD.findIndex(r => D <= r[0]), m
  if (i < 0) m = MD[MD.length - 1][1]
  else if (D === MD[i][0] || i === 0) m = MD[i][1]
  else {
    let [dj, mj] = MD[i - 1], [di, mi] = MD[i], qj = Math.sqrt(dj), qi = Math.sqrt(di), q = Math.sqrt(D)
    m = mi + (qi * qj / q - qj) * (mj - mi) / (qi - qj)
  }
  let qeq = 2 * (1 + alpha) / (1 - alpha)
  return 1 + 2 * (D - 1) * (1 - m) / (qeq - 2 * m)
}

// IMCRA: Improved Minima Controlled Recursive Averaging (Cohen, IEEE TSAP 11(5), 2003). Equation numbers are the
// paper's; where it leaves a detail open (initialisation, subwindow bookkeeping) this follows Cohen's own omlsa.m
// (israelcohen.com/software), which it reproduces on identical frames (test.js fixture).
//
//   S_f = b ∗ |Y|² over 2w+1 bins (14);  S = α_s S + (1 − α_s) S_f (15);  S_min: minimum of S over U subwindows of V frames
//   first iteration, rough speech absence I = [|Y|² < γ0 B_min S_min] · [S < ζ0 B_min S_min] (18)-(21)
//   second iteration: S̃_f = b ∗ (I |Y|²) / b ∗ I (26), S̃ = α_s S̃ + (1 − α_s) S̃_f (27), its minimum S̃_min
//   γ̃_min = |Y|²/(B_min S̃_min), ζ̃ = S/(B_min S̃_min) (28) → a priori speech absence q̂ (29) → p (7)
//   λ̄_d ← α̃_d λ̄_d + (1 − α̃_d)|Y|², α̃_d = α_d + (1 − α_d) p (10), (11);  λ̂_d = β λ̄_d (12)
//
// p needs the a priori SNR: decision-directed on the LSA gain under speech presence, ξ = α G_H1²(l−1) γ(l−1) +
// (1 − α) max(γ − 1, 0) (32), (33) (Cohen & Berdugo 2001 eq. 18). The estimator keeps it and exposes, per frame, on the
// updated noise: `xi`, `gamma` (a posteriori SNR), `v` = γξ/(1+ξ), `gain` (G_H1) and `p`, which OM-LSA's gain uses.
//
// Table I's constants hold for 8 ms frames (16 kHz, 128 hop): smoothing constants, the decision-directed α among them,
// scale as a^(Δt / 8 ms) and V as 15 · 8 ms / Δt with the actual frame step Δt = hop / fs, so time constants and the
// ~1 s minimum window keep their length in seconds at any rate. Without `fs` and `hop` the constants apply per frame,
// as tabulated. (α per frame made the a priori SNR's memory 1.8× longer at 48 kHz than at 44.1 kHz.)
const REF_DT = 128 / 16000

// E1(v) for v > 0: Abramowitz & Stegun 5.1.53 (v < 1, |ε| < 2e-7) and 5.1.56 (v ≥ 1, |ε| < 2e-8 relative)
function e1(v) {
  if (v <= 0) return 30
  if (v < 1) return ((((0.00107857 * v - 0.00976004) * v + 0.05519968) * v - 0.24991055) * v + 0.99999193) * v - 0.57721566 - Math.log(v)
  return Math.exp(-v) / v * (0.2677737343 + v * (8.6347608925 + v * (18.0590169730 + v * (8.5733287401 + v)))) /
    (3.9584969228 + v * (21.0996530827 + v * (25.6329561486 + v * (9.5733223454 + v))))
}

// Decision-directed a priori SNR and the LSA gain under speech presence against the noise estimate s.psd:
// ξ = max(α G_H1²(l−1) γ(l−1) + (1 − α) max(γ − 1, 0), ξ_min) (Cohen & Berdugo 2001 eq. 18), γ and v = γξ/(1+ξ);
// `next` computes G_H1 = ξ/(1+ξ) exp(½ E1(v)) (15) and keeps G_H1²γ for the next frame's ξ
function lsa(s, next) {
  let { y2, psd, eta2, xi, gamma, v, gain, aDD, xiMin } = s
  for (let k = 0; k < y2.length; k++) {
    let g = y2[k] / Math.max(psd[k], 1e-30), x = Math.max(aDD * eta2[k] + (1 - aDD) * Math.max(g - 1, 0), xiMin)
    gamma[k] = g; xi[k] = x; v[k] = g * x / (1 + x)
    if (next) { gain[k] = x / (1 + x) * Math.exp(0.5 * e1(v[k])); eta2[k] = gain[k] * gain[k] * g }
  }
}

// A known noise: a profile learned where the noise plays alone (noiseProfile), held rather than tracked. Per frame the
// outputs imcra gives, on it (ξ, γ, v, G_H1), so a gain written for imcra runs on a learned noise unchanged. `xi0` is
// `xi` (a held noise does not move within the frame); nothing estimates speech presence, `p` stays 0. `alphaDD` is
// quoted per 8 ms frame and, given `fs` and `hop`, rescaled to the frame step as imcra's.
export function known(profile, opts = {}) {
  let K = profile.length, psd = Float64Array.from(profile), y2 = new Float64Array(K), eta2 = new Float64Array(K).fill(1)
  let xi = new Float64Array(K), gamma = new Float64Array(K), v = new Float64Array(K), gain = new Float64Array(K)
  let r = opts.fs && opts.hop ? opts.hop / opts.fs / REF_DT : 1
  let s = { y2, psd, eta2, xi, gamma, v, gain, aDD: (opts.alphaDD ?? 0.92) ** r, xiMin: opts.xiMin ?? 10 ** (-25 / 10) }
  let est = { psd, xi, xi0: xi, gamma, v, gain, p: new Float64Array(K), frames: 0, update }
  function update(mag) {
    let silent = true
    for (let k = 0; k < K; k++) { y2[k] = mag[k] * mag[k]; if (y2[k]) silent = false }
    if (silent) return est                        // digital silence: skipped, as imcra skips it
    lsa(s, true)
    est.frames++
    return est
  }
  return est
}

export function imcra(half, opts = {}) {
  let K = half + 1
  let r = opts.fs && opts.hop ? opts.hop / opts.fs / REF_DT : 1
  let as = (opts.alpha ?? 0.9) ** r              // α_s, (15)
  let ad = (opts.alphaD ?? 0.85) ** r            // α_d, (11)
  let beta = opts.beta ?? 1.47                   // (12)
  let bMin = opts.bMin ?? 1.66                   // minimum's bias, (18)
  let g0 = opts.gamma0 ?? 4.6, g1 = opts.gamma1 ?? 3, z0 = opts.zeta0 ?? 1.67   // (21), (29)
  let U = opts.U ?? 8, V = opts.V ?? Math.max(1, Math.round(15 / r))
  let aDD = (opts.alphaDD ?? 0.92) ** r, xiMin = opts.xiMin ?? 10 ** (-25 / 10)
  let w = opts.w ?? 1, b = new Float64Array(2 * w + 1), bs = 0
  for (let i = 0; i < b.length; i++) bs += b[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / (b.length + 1))   // MATLAB hanning(2w+1)
  for (let i = 0; i < b.length; i++) b[i] /= bs

  let psd = new Float64Array(K), lav = new Float64Array(K), y2 = new Float64Array(K), eta2 = new Float64Array(K)
  let S = new Float64Array(K), St = new Float64Array(K), Smin = new Float64Array(K), Smint = new Float64Array(K)
  let SMact = new Float64Array(K), SMactt = new Float64Array(K), SW = new Float64Array(U * K), SWt = new Float64Array(U * K)
  let I = new Float64Array(K), sf = new Float64Array(K)
  let xi = new Float64Array(K), gamma = new Float64Array(K), v = new Float64Array(K), gain = new Float64Array(K), p = new Float64Array(K)
  let xi0 = new Float64Array(K)
  let n = 0, ri = 0
  let guard = guarded(K, opts)
  let est = { psd, xi, xi0, gamma, v, gain, p, partials: guard, frames: 0, update }

  // b ∗ x at bin k, zero past the edges (MATLAB conv, central part)
  function smooth(x, k) {
    let s = 0
    for (let i = -w; i <= w; i++) { let j = k - i; if (j >= 0 && j < K) s += b[i + w] * x[j] }
    return s
  }

  // decision-directed a priori SNR and G_H1 on the current noise estimate; `next` stores G_H1²γ for the next frame
  let s = { y2, psd, eta2, xi, gamma, v, gain, aDD, xiMin }
  const snr = next => lsa(s, next)

  function update(mag, sppOverride) {
    let silent = true
    for (let k = 0; k < K; k++) { y2[k] = mag[k] * mag[k]; if (y2[k]) silent = false }
    if (silent) return est                        // digital silence: nothing to learn (omlsa.m skips zero frames too)
    let first = n === 0
    if (first) { psd.set(y2); eta2.fill(1) }
    snr(false)                                    // ξ, v on the previous estimate, for this frame's p
    xi0.set(xi)

    for (let k = 0; k < K; k++) sf[k] = smooth(y2, k)
    if (first) { S.set(sf); St.set(sf); lav.set(y2) }
    else for (let k = 0; k < K; k++) S[k] = as * S[k] + (1 - as) * sf[k]
    let init = n < V - 1
    for (let k = 0; k < K; k++) {
      if (init) Smin[k] = SMact[k] = S[k]
      else { if (S[k] < Smin[k]) Smin[k] = S[k]; if (S[k] < SMact[k]) SMact[k] = S[k] }
      I[k] = y2[k] < g0 * bMin * Smin[k] && S[k] < z0 * bMin * Smin[k] ? 1 : 0
    }
    for (let k = 0; k < K; k++) {
      let c = smooth(I, k), s = St[k]
      if (c) { s = 0; for (let i = -w; i <= w; i++) { let j = k - i; if (j >= 0 && j < K) s += b[i + w] * I[j] * y2[j] } s /= c }
      sf[k] = s
    }
    for (let k = 0; k < K; k++) {
      if (init) St[k] = Smint[k] = SMactt[k] = S[k]
      else {
        St[k] = as * St[k] + (1 - as) * sf[k]
        if (St[k] < Smint[k]) Smint[k] = St[k]
        if (St[k] < SMactt[k]) SMactt[k] = St[k]
      }
      let m = Math.max(Smint[k], 1e-30), gm = y2[k] / bMin / m, zt = S[k] / bMin / m, pk
      if (sppOverride !== undefined) pk = typeof sppOverride === 'number' ? sppOverride : sppOverride[k]
      else if (gm >= g1 || zt >= z0) pk = 1
      else if (gm > 1) { let q = (g1 - gm) / (g1 - 1); pk = 1 / (1 + q / (1 - q) * (1 + xi[k]) * Math.exp(-v[k])) }
      else pk = 0
      p[k] = pk
      let a = ad + (1 - ad) * pk
      lav[k] = a * lav[k] + (1 - a) * y2[k]
    }
    if (++n % V === 0) {                          // a subwindow ends: store its minimum, the window's is the least of U
      if (n === V) for (let u = 0; u < U; u++) { SW.set(S, u * K); SWt.set(St, u * K) }
      else {
        SW.set(SMact, ri * K); SWt.set(SMactt, ri * K); ri = (ri + 1) % U
        for (let k = 0; k < K; k++) {
          let m = Infinity, mt = Infinity
          for (let u = 0, o = k; u < U; u++, o += K) { if (SW[o] < m) m = SW[o]; if (SWt[o] < mt) mt = SWt[o] }
          Smin[k] = m; Smint[k] = mt
        }
        SMact.set(S); SMactt.set(St)
      }
    }
    for (let k = 0; k < K; k++) psd[k] = beta * lav[k]
    if (guard) guard.update(y2, psd)
    snr(true)                                     // on the updated estimate: this frame's gain, the next frame's ξ
    est.frames = n
    return est
  }
  return est
}

// A program's partials kept out of a tracked noise. Minimum statistics and IMCRA take whatever holds a bin for about a
// second as noise: a held note, a sustained vowel, a chord's partials were learned, and the gain took them down (clean
// music through tracked omlsa: 9.9 % of its time-frequency energy cut by more than 3 dB, wiener 14.5 %; VocalSet's
// long tones 8.8 % and 36 %; @audio/denoise's scripts/broadband.mjs). `update(y2, psd)` reads, each frame, where a
// partial stands and there holds `psd`, the tracker's estimate, at what the bin held before the partial came:
//   P   |Y|² smoothed over 30 ms (minimum statistics' α 0.7 per 10.7 ms frame)
//   F   P's morphological opening across frequency, the least over ±4 bins and then the largest of that over ±4: a peak
//       narrower than 9 bins is taken off, the floor between partials stays, slopes and all (the inverse harmonic
//       mask of Nelke, Naylor & Vary, ICASSP 2015, as dewind reads its wind)
//   a peak: P over 6 F (7.8 dB; Gaussian noise peaks so in 0.6 % of its bins a frame, never for 0.3 s), within ±1 bin
//       (vibrato, a glide), for 0.3 s running, and 10 dB over the bin's noise memory: a partial that came over a
//       quieter bin. Flagged with its Hann main lobe, ±2 bins. A voice's harmonics hardly hold a bin 0.3 s, and the
//       trackers' own speech presence keeps them; held from 54 ms on, the noise rising under them was held down too
//       (VoiceBank+DEMAND training speech PESQ −0.015), and without the 10 dB a noise's own peaks were held
//   a flagged bin stays flagged while the tracker reads it over 4 times (6 dB) its memory: the tracker holds what the
//       partial left for its own window after the partial ends, so a note's decay keeps its bin's noise
//   memory  the tracker's estimate averaged over the bin's free frames (neither peaked nor flagged), per eighth of `T`
//       60 s, the least of the last eight that have any; where flagged, the noise is no more than it
// A line steady from the take's start (hum, a fan's whine, an engine) has no free frame and no memory: it is noise, as
// ever. One that starts mid-take is held as a partial until its bin has had no free frame for `T`, then it is learned;
// so is a note held longer. A note sounding from the take's first frame is learned as the noise until its bin is once
// free of it: nothing tells it from a line there. The tracker's state is untouched: only the estimate it gives is.
// `flag`: the bins held this frame; `lines`: the bins with no free frame in the window, peaked for `T`/8 running or
// more (a line, or a note sounding since the take began). `dt`: the frame step in seconds.
export function partials(K, opts = {}) {
  let dt = opts.dt ?? 512 / 44100, T = opts.T ?? 60, U = 8, V = Math.max(1, Math.round(T / U / dt))
  let a = Math.exp(-dt / 0.03), need = Math.max(1, Math.round(0.3 / dt)), W = 4, TH = 6, RISE = 10, KAPPA = 4
  let P = new Float64Array(K), E = new Float64Array(K), F = new Float64Array(K), pk = new Uint8Array(K)
  let run = new Int32Array(K), flag = new Uint8Array(K), lines = new Uint8Array(K), mem = new Float64Array(K).fill(Infinity)
  let sum = new Float64Array(K), cnt = new Int32Array(K), SW = new Float64Array(U * K).fill(Infinity), n = 0, ri = 0
  function update(y2, psd) {
    for (let k = 0; k < K; k++) P[k] = n ? a * P[k] + (1 - a) * y2[k] : y2[k]
    for (let k = 0; k < K; k++) { let m = Infinity; for (let j = Math.max(0, k - W), e = Math.min(K - 1, k + W); j <= e; j++) if (P[j] < m) m = P[j]; E[k] = m }
    for (let k = 0; k < K; k++) { let m = 0; for (let j = Math.max(0, k - W), e = Math.min(K - 1, k + W); j <= e; j++) if (E[j] > m) m = E[j]; F[k] = m }
    for (let k = 0; k < K; k++) E[k] = P[k] > TH * F[k] ? 1 : 0
    for (let k = 0; k < K; k++) {
      run[k] = E[k] || k > 0 && E[k - 1] || k < K - 1 && E[k + 1] ? run[k] + 1 : 0
      pk[k] = run[k] >= need && P[k] > RISE * mem[k] ? 1 : 0
    }
    for (let k = 0; k < K; k++) {
      let t = 0
      for (let j = Math.max(0, k - 2), e = Math.min(K - 1, k + 2); j <= e; j++) t |= pk[j]
      flag[k] = t || flag[k] && psd[k] > KAPPA * mem[k] ? 1 : 0
      if (!flag[k] && !run[k]) { sum[k] += psd[k]; cnt[k]++ }
      let m = cnt[k] ? sum[k] / cnt[k] : Infinity
      for (let j = k; j < U * K; j += K) if (SW[j] < m) m = SW[j]
      mem[k] = m
      lines[k] = m === Infinity && run[k] >= V ? 1 : 0
      if (flag[k] && m < psd[k]) psd[k] = m
    }
    if (++n % V === 0) {                          // a subwindow ends: its free frames' mean joins the last eight
      for (let k = 0; k < K; k++) SW[ri * K + k] = cnt[k] ? sum[k] / cnt[k] : Infinity
      ri = (ri + 1) % U; sum.fill(0); cnt.fill(0)
    }
    return psd
  }
  return { flag, lines, mem, update }
}

// a tracker's guard from its options: `partials` true or an options object, the frame step from `fs` and `hop`
function guarded(K, o) {
  if (!o.partials) return null
  return partials(K, { dt: o.fs && o.hop ? o.hop / o.fs : undefined, ...(typeof o.partials === 'object' ? o.partials : {}) })
}
