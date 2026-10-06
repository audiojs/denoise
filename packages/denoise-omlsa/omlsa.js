// OM-LSA: Optimally Modified Log-Spectral Amplitude estimator with IMCRA noise estimation.
// Cohen & Berdugo, "Speech enhancement for non-stationary noise environments", Signal Processing 81, 2001;
// Cohen, "Noise spectrum estimation in adverse environments: IMCRA", IEEE TSAP 11(5), 2003.
//
//   G = max(G_H1, G_min)^p · G_min^(1−p)                                         (16), G_H1 floored at G_min
//   G_H1 = ξ/(1+ξ) · exp(½ E1(v)), v = γξ/(1+ξ)       LSA gain when speech is present (15)
//   p = [1 + q/(1−q) · (1+ξ) · exp(−v)]⁻¹             speech presence probability  (9)
//   ξ = α G_H1²(l−1) γ(l−1) + (1−α) max(γ−1, 0)       a priori SNR on G_H1, not G   (18)
//   q = 1 − P_local · P_global · P_frame               a priori speech absence, from ξ_c recursively averaged
//                                                      over time (23) and over neighbouring bins (24)-(28)
//   ξ_c: the a priori SNR smoothed in the cepstrum (Breithaupt, Gerkmann & Martin, ICASSP 2008), see `cepstral`
//
// The noise spectrum λ_d and ξ, γ, G_H1 come from @audio/noise-estimate's imcra, a program's held partials kept out of
// λ_d (its `partials`: a held note, a sustained vowel, a chord are not learned as noise). Constants: Table 1 of the 2001
// paper, with Cohen's omlsa.m for what the paper leaves open (P_min 0.005, the frame term's bookkeeping, 50 Hz–10 kHz
// for the frame average). Time constants, the decision-directed α among them, are quoted per 8 ms frame (512 samples,
// 128 hop at 16 kHz) and rescaled to the actual frame step as a^(Δt/8 ms) (omlsa.m raises them to the reciprocal
// power, which at 48 kHz lengthens them 1.8×); the global window keeps its width in Hz (15 bins of 31.25 Hz). Not taken
// from omlsa.m: its zeroing of the lowest three bins (a high-pass is the caller's) and its tonal refinements (a floor
// shaped by the neighbouring noise, which measured lower PESQ and SIG on VoiceBank training speech, and a tonal P_local
// reset: dehum's job).
//
// (16) as written dips below G_min wherever G_H1 is under it (to −18 dB at G_min −12): G_H1 is floored at G_min, so a
// bin where speech may be present goes no further down than one where it is absent, and G_min is the floor.
//
// α sets how fast ξ follows a word's start after a pause, and how much gain a noise peak gets. It was 0.98 per frame,
// whatever the frame: 0.985 per 8 ms at 48 kHz, 0.972 at 44.1, and a word's second and third frames after a pause lost
// 10 and 5 dB (Spoken Wikipedia narrations, pink noise 10 dB under). Now per 8 ms, the lowest value that leaves steady
// white and pink noise without musical noise: 0.97 tracked (log kurtosis ratio 0.00 at G_min −15 and −25 dB; 0.96: 1.16
// and 0.49 at −25, 0.95: 0.28 and 0.82 at −15, the paper's 0.92: 0.99 and 1.81), 0.95 on a known noise (omlsa.m's;
// 0.92: 0.19 and 0.42). On 168 VoiceBank+DEMAND training utterances, tracked: STOI 0.826 → 0.832, PESQ 1.83 → 1.82;
// those two frames lose 6 and 1 dB. omlsa.m's gate (p = 0 where q ≥ 0.9) stays: the paper's q ≤ q_max = 0.95 in its
// place (Table 1, after eq. 28) kept a word's second frame after a pause 3 dB better but left musical noise on steady
// noise (0.24 and 0.46 at α 0.97; on a known noise 0.17 and 0.39, more after music stops); gating at q_max instead
// changed nothing measurable.
//
// q from the decision-directed ξ (omlsa.m's; `qFrom: 'dd'`) lags a word's start after a pause by a frame or more, and
// takes a short burst of noise the tracker cannot follow for speech: ξ rises with any rising bin. From ξ_c, smoothed in
// the cepstrum: its envelope follows at once, and a lone spectral peak, not speech's structure, is smoothed away. On
// 168 VoiceBank+DEMAND training utterances, tracked: PESQ 1.823 → 1.825, STOI 0.832 → 0.834, DNSMOS SIG 3.15 → 3.16,
// BAK 3.00 → 3.04, OVRL 2.525 → 2.543, musical noise (log kurtosis ratio in pauses) 0.82 → 0.80; 40 ms tone bursts in
// steady noise pass at −6.5 dB, were −2.6; a word's first and second frame after a pause in narrations under pink
// noise lose 11.5 and 2.9 dB, were 15 and 6.2. ξ_c alone as the gain's ξ lost voiced speech where the pitch glides
// (harmonics past the pitch's own quefrency are smoothed) and costs SIG 0.04; the gain keeps the decision-directed ξ.
// The high quefrencies are smoothed at 0.9 per 16 ms, between the 2008 paper's 0.97 and the 2012 one's 0.85: the least
// that leaves steady white and pink noise on a learned noise free of musical noise (0.85: 0.22 on pink), which kept
// those narrations' second frame 3.3 dB better than 0.97 for musical noise 0.80 rather than 0.75 on VoiceBank.
//
// A known noise (`profile`, or a noise-only stretch named by `noiseFrames`/`profileFrom`/`profileTo`) is held instead
// of tracked (noise-estimate's `known`), and p reads the observation, not ξ: γ averaged over 105.5 Hz and over 543 Hz of
// the frame, at fixed priors (Gerkmann, Breithaupt & Martin, IEEE TASLP 16(5), 2008; see `presence`), gated by q ≥ 0.9
// as ever. Read in each bin alone (at ξ_H1 15 dB, Gerkmann & Hendriks 2012, until 0.4), speech 0–5 dB over the noise
// lost 7.8 dB on the training speech (the MMSE Wiener gain keeps 3.9). On the 168 training utterances, the noise learned
// from each one's lead-in, G_min −12 dB: PESQ 1.861 → 1.867, STOI 0.835, SIG 3.19, BAK 3.05 → 3.08, OVRL 2.564 → 2.572,
// musical noise 0.53 → 0.46; speech 0–5 dB over the noise kept −7.8 → −5.1 dB, a word's second frame after a pause in
// the narrations −4.9 → −2.1; the noise taken in pauses 9.7 → 10.1 dB, in all frames 7.0 → 6.6 (what lies under the
// speech now kept); steady noise alone goes exactly G_min down (log kurtosis ratio 0.00), and in the half second after
// music stops the noise left is closer to the noise (0.11 → 0.05 at G_min −12 dB, 1.00 → 0.61 at −20). Ungated, the
// presence averaged over the paper's 64 ms left musical noise on steady pink noise (0.37). Tracking the noise from the print (Gerkmann &
// Hendriks 2012's MMSE tracker started on it, as RX's "adaptive" mode) lost OVRL 0.04 and left musical noise (0.40 on
// pink): the print is held.

import { stftBatch, stftStream } from '@audio/stft'
import { imcra, known, noiseProfile } from '@audio/noise-estimate'
import { fft, ifft } from 'fourier-transform'

// Wrap { write, flush } into a single callable (inlined convention).
const writer = s => chunk => chunk ? s.write(chunk) : s.flush()

const db2lin = db => Math.pow(10, db / 20)
const REF_DT = 128 / 16000

// The analysis frame: the power of two nearest 32 ms, the 2001 paper's (Table 1: 512 samples at 16 kHz), as omlsa.m
// picks it at other rates: 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48. The hop is a quarter frame (Table 1's
// 75 % overlap).
export const frame = fs => 2 ** Math.round(Math.log2(0.032 * fs))

// frame, hop and rate an option set resolves to (the manifest, stream and batch forms agree)
function framing(opts) {
  let fs = opts.fs || 44100, N = opts.frameSize || frame(fs)
  return { ...opts, fs, frameSize: N, hopSize: opts.hopSize || N >> 2 }
}

export default function omlsa(dataOrOpts, opts) {
  if (dataOrOpts instanceof Float32Array || dataOrOpts instanceof Float64Array) {
    let o = framing(opts || {}), N = o.frameSize, hop = o.hopSize
    // a noise-only stretch the caller names gives the profile (as wiener's and specsub's batch forms)
    if (!o.profile && (o.noiseFrames != null || o.profileFrom != null || o.profileTo != null)) {
      let from = o.profileFrom ?? 0, nf = o.noiseFrames, data = dataOrOpts
      let to = o.profileTo ?? (nf != null ? Math.min(data.length, from + N + Math.max(0, nf - 1) * hop) : Math.min(data.length, from + N * 4))
      o.profile = noiseProfile(data, { from, to, frameSize: N, hopSize: hop })
    }
    return stftBatch(dataOrOpts, makeProcess(o), o)
  }
  let o = framing(dataOrOpts || {})
  return writer(stftStream(makeProcess(o), o))
}

/** The gain as a frame process, (mag, phase) → { mag, phase }, for a host that runs its own STFT (@audio/stft's
 *  framing: Hann, `hopSize` a quarter of `frameSize`). One per channel: it keeps state across frames. */
export const processor = opts => makeProcess(framing(opts || {}))

// The a priori SNR by selective cepstro-temporal smoothing (Breithaupt, Gerkmann & Martin, ICASSP 2008), for the
// speech absence q: the speech power's maximum-likelihood estimate λ max(γ − 1, ξ_ml,min) (3), its cepstrum (4), each
// quefrency smoothed over time (5), hardly where speech lives (the envelope's low quefrencies, the pitch's peak), much
// where a lone noise peak lives (the rest), back to the spectrum with the log bias corrected, over λ (12), (13). Table
// 1's constants are per 16 ms of frame step (512 frames, 256 hop at 16 kHz), rescaled as a^(Δt/16 ms); quefrencies keep
// their length in seconds. Under 1.25 ms (q < 20 at 16 kHz) the smoothing is Gerkmann & Hendriks's (ICASSP 2012: 0
// under q 3, then 0.2), where the 2008 paper's 0.5 and 0.7 lag a word's onset as the decision-directed ξ does. The pitch,
// 70–300 Hz: the peak of the cepstrum convolved with a fs/2000-tap Hamming window (8), voiced where it reaches Λ_thr 0.2
// and the spectrum tilts down (c₁ > 0) (10); its ±2 bins (at 16 kHz) smoothed at α_pitch 0.2, relaxing back by β 0.96 (6), (7).
const KAPPA = 0.5 * 0.5772156649, XI_ML_MIN = 10 ** (-27 / 10)
function cepstral(N, fs, hop, xiMin) {
  let K = N / 2 + 1, H = N / 2, r = hop / fs / 0.016, qs = q => Math.round(q * fs / 16000)
  let q1 = qs(3), q2 = qs(20), aPitch = 0.2 ** r, beta = 0.96 ** r
  let aConst = Float64Array.from({ length: H + 1 }, (_, q) => q < q1 ? 0 : (q < q2 ? 0.2 : 0.9) ** r)
  let qLo = Math.floor(fs / 300), qHi = Math.min(H, Math.floor(fs / 70)), dq = Math.max(1, qs(2))
  let tH = Math.max(2, Math.round(fs / 2000)), c0 = tH >> 1
  let wH = Float64Array.from({ length: tH }, (_, i) => 0.54 - 0.46 * Math.cos(2 * Math.PI * i / tH))
  let alpha = Float64Array.from(aConst), cs = new Float64Array(H + 1), ext = new Float64Array(N), zero = new Float64Array(K)
  let L = new Float64Array(K), c = new Float64Array(N), xi = new Float64Array(K), first = true
  return function update(mag, lam) {
    for (let k = 0; k < K; k++) { let l = Math.max(lam[k], 1e-30); L[k] = Math.log(l * Math.max(mag[k] * mag[k] / l - 1, XI_ML_MIN)) }
    c.set(ifft(L, zero.fill(0)))                    // c[q], even in q
    let best = -Infinity, qp = -1
    for (let q = qLo; q <= qHi; q++) {
      let s = 0
      for (let i = 0; i < tH; i++) { let j = q + i - c0; if (j >= 0 && j <= H) s += wH[i] * c[j] }
      if (s > best) { best = s; qp = q }
    }
    let voiced = best >= 0.2 && c[1] > 0
    for (let q = 0; q <= H; q++) {
      let a = alpha[q] = voiced && Math.abs(q - qp) <= dq ? aPitch : beta * alpha[q] + (1 - beta) * aConst[q]
      cs[q] = first ? c[q] : a * cs[q] + (1 - a) * c[q]
    }
    first = false
    for (let q = 0; q <= H; q++) ext[q] = cs[q]
    for (let q = 1; q < H; q++) ext[N - q] = cs[q]
    let [re] = fft(ext)
    for (let k = 0; k < K; k++) xi[k] = Math.max(Math.exp(KAPPA + re[k]) / Math.max(lam[k], 1e-30), xiMin)
    return xi
  }
}

// Speech presence on a held noise, from the observation averaged over neighbouring bins, at fixed priors (Gerkmann,
// Breithaupt & Martin, IEEE TASLP 16(5), 2008): γ averaged over 2Δk+1 bins is χ² with r degrees of freedom over r, and
// (1+ξ) times that under speech, so P = [1 + (1+ξ_fix)^(r/2) exp(−(r/2) γ̄ ξ_fix/(1+ξ_fix))]⁻¹ at q 0.5, over 105.5 Hz
// (local) and 543 Hz (global) (16), P = P_local · P_global (14). r = 2N c_dof from the Hann window's correlation across
// bins, ξ_fix the a priori SNR that minimizes P_false + P_miss over ξ from 0.1 to 32 (13) (with their 64 ms of frames as
// well this gives their Table I: 15 bins at 16 kHz, r 10.8 for their 10.2, ξ_fix 7.6 dB for their 8). Over the frame
// alone, not their 64 ms: the frames before kept presence on after a sound stops, and the decision-directed gain still
// high there let noise through in patches (musical noise in the half second after music stops on a learned noise 0.45
// at G_min −12 dB, 1.77 at −20; now 0.05 and 0.61). At 48 kHz: 5 bins, r 5.7, ξ_fix 9.4 dB; 23 bins, r 24, 5.1 dB.
// Computed once per framing.
function lgamma(z) {                                // Lanczos (Numerical Recipes' gammln)
  let c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = z, t = z + 5.5, s = 1.000000000190015
  t -= (z + 0.5) * Math.log(t)
  for (let j = 0; j < 6; j++) s += c[j] / ++y
  return -t + Math.log(2.5066282746310005 * s / z)
}
function gammp(a, x) {                              // the regularized lower incomplete gamma P(a, x) (Numerical Recipes)
  if (x <= 0) return 0
  let g = Math.exp(-x + a * Math.log(x) - lgamma(a))
  if (x < a + 1) { let ap = a, d = 1 / a, s = d; for (let n = 0; n < 500 && Math.abs(d) > Math.abs(s) * 1e-12; n++) s += d *= x / ++ap; return s * g }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d
  for (let i = 1; i < 500; i++) {
    let an = -i * (i - a); b += 2
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d; h *= d * c
    if (Math.abs(d * c - 1) < 1e-12) break
  }
  return 1 - g * h
}
const priors = new Map()
function prior(N, fs, F) {
  let key = `${N}:${fs}:${F}`
  if (priors.has(key)) return priors.get(key)
  let bw = fs / N, dk = Math.max(0, Math.round((F - 1.44 * bw) / bw / 2))   // (16), the Hann window's 3 dB width 1.44 bins
  let w2 = Float64Array.from({ length: N }, (_, n) => (0.5 - 0.5 * Math.cos(2 * Math.PI * n / N)) ** 2), e = w2.reduce((a, v) => a + v, 0)
  let rk = d => { let re = 0, im = 0; for (let n = 0; n < N; n++) { re += w2[n] * Math.cos(2 * Math.PI * d * n / N); im += w2[n] * Math.sin(2 * Math.PI * d * n / N) } return Math.hypot(re, im) / e }
  let RK = Array.from({ length: 2 * dk + 1 }, (_, i) => rk(i)), s = 0
  for (let a = -dk; a <= dk; a++) for (let b = -dk; b <= dk; b++) s += RK[Math.abs(a - b)] ** 2
  let M = 2 * dk + 1, r = 2 * M * M / s, best = Infinity, xi = 1
  for (let db = -5; db <= 25; db += 0.1) {
    let x = 10 ** (db / 10), T = (1 + x) / x * Math.log1p(x), err = 1 - gammp(r / 2, r * T / 2)    // P_false
    for (let i = 0; i < 400; i++) err += gammp(r / 2, r * T / (1 + 0.1 + i * 31.9 / 399) / 2) / 400   // P_miss, ξ 0.1..32
    if (err < best) { best = err; xi = x }
  }
  let p = { dk, c1: r / 2 * Math.log1p(xi), c2: r / 2 * xi / (1 + xi) }
  priors.set(key, p)
  return p
}
function presence(N, fs) {
  let K = N / 2 + 1, sets = [prior(N, fs, 105.5), prior(N, fs, 543)], cum = new Float64Array(K + 1), P = new Float64Array(K)
  return function update(gamma) {
    for (let k = 0; k < K; k++) cum[k + 1] = cum[k] + gamma[k]
    P.fill(1)
    for (let { dk, c1, c2 } of sets) for (let k = 0; k < K; k++) {
      let a = Math.max(0, k - dk), b = Math.min(K - 1, k + dk), g = (cum[b + 1] - cum[a]) / (b - a + 1)
      P[k] *= 1 / (1 + Math.exp(Math.min(c1 - c2 * g, 700)))
    }
    return P
  }
}

// normalized Hann of 2w+1 points without zero ends (MATLAB hanning), the 2001 paper's h_local, h_global
function hanning(w) {
  let h = new Float64Array(2 * w + 1), s = 0
  for (let i = 0; i < h.length; i++) s += h[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / (h.length + 1))
  for (let i = 0; i < h.length; i++) h[i] /= s
  return h
}

function makeProcess(opts) {
  let N = opts.frameSize, half = N >> 1, K = half + 1, hop = opts.hopSize, fs = opts.fs
  let held = !!opts.profile                         // a known noise: held, not tracked
  // defaults chosen on VoiceBank+DEMAND training speech (scripts/speech.mjs, scripts/broadband.mjs): G_min −15 dB, and
  // α per 8 ms (noise-estimate rescales it to the frame step) 0.97 tracked, 0.95 on a known noise (see the header)
  let alphaDD = opts.alphaDD ?? opts.alpha ?? (held ? 0.95 : 0.97) // `alpha` = documented alias
  let xiMin = opts.xiMin ?? 10 ** (-25 / 10)
  let gMin = db2lin(opts.gMinDb ?? opts.gMin ?? -15) // `gMinDb` = documented name
  let qFixed = opts.qPrior || null                  // a fixed a priori speech absence; omitted (or 0): estimated
  if (held && opts.profile.length !== K) throw new RangeError(`omlsa: profile has ${opts.profile.length} bins, a ${N} frame has ${K}`)
  let est = held ? known(opts.profile, { fs, hop, alphaDD, xiMin }) : imcra(half, { fs, hop, alphaDD, xiMin, partials: true, ...opts.estimator })
  // q from the cepstro-temporally smoothed a priori SNR, or (qFrom 'dd') from the decision-directed one, as the paper
  let snr = opts.qFrom === 'dd' ? null : cepstral(N, fs, hop, xiMin)
  let spp = held ? presence(N, fs) : null

  // a priori speech absence (2001 §4): ζ = β ζ + (1−β) ξ (23), β = 0.7 per 8 ms frame
  let bz = 0.7 ** (hop / fs / REF_DT)
  let pMin = 0.005, lo = -10, hi = -5, peakLo = 0, peakHi = 10       // ζ_min, ζ_max, ζ_p min, ζ_p max (dB)
  let hl = hanning(1), hg = hanning(Math.max(1, Math.round(15 * 31.25 / (fs / N))))
  let kl = Math.round(50 / fs * N), ku = Math.min(Math.round(10000 / fs * N), half)
  let k2 = Math.round(500 / fs * N), k3 = Math.round(3500 / fs * N)
  let zeta = new Float64Array(K), q = new Float64Array(K), pl = new Float64Array(K), zf = 0, zPeak = 0

  let P = z => {                                    // (25) on dB values, floored at P_min
    let d = z > 0 ? 10 * Math.log10(z) : -100
    return d <= lo ? pMin : d >= hi ? 1 : pMin + (d - lo) / (hi - lo) * (1 - pMin)
  }
  let avg = (h, k) => {                             // (24): Σ h(i) ζ(k−i), zero past the edges
    let w = h.length >> 1, s = 0
    for (let i = -w; i <= w; i++) { let j = k - i; if (j >= 0 && j < K) s += h[i + w] * zeta[j] }
    return s
  }

  function absence(xi) {
    if (qFixed != null) return q.fill(qFixed)
    for (let k = 0; k < K; k++) zeta[k] = bz * zeta[k] + (1 - bz) * xi[k]
    let prev = zf; zf = 0
    for (let k = kl; k <= ku; k++) zf += zeta[k]
    zf /= ku - kl + 1                               // (26)
    let d = zf > 0 ? 10 * Math.log10(zf) : -100, pf
    if (d <= lo) pf = pMin                          // (27), Fig. 3: speech assumed while ζ_frame rises,
    else if (zf >= prev) { zPeak = Math.min(Math.max(d, peakLo), peakHi); pf = 1 }   // then let go as it falls
    else pf = d >= zPeak + hi ? 1 : d <= zPeak + lo ? pMin : pMin + (d - zPeak - lo) / (hi - lo) * (1 - pMin)
    // omlsa.m: where speech is unlikely below 4 kHz as a whole, 500 Hz–3.5 kHz is taken as absent
    let m = 0
    for (let k = 0; k < K; k++) { pl[k] = P(avg(hl, k)); if (k >= 2 && k <= k2 + k3 - 2) m += pl[k] }
    if (m / (k2 + k3 - 3) < 0.25) for (let k = k2; k <= k3; k++) pl[k] = pMin
    for (let k = 0; k < K; k++) q[k] = 1 - pl[k] * P(avg(hg, k)) * pf                   // (28)
    return q
  }

  return function (mag, phase) {
    let n = est.frames
    est.update(mag)
    if (est.frames === n) return { mag, phase }     // digital silence: nothing learned, nothing to attenuate
    let xi = est.xi, v = est.v, gH1 = est.gain
    // the a priori SNR for q: smoothed in the cepstrum on this frame's noise estimate, or this frame's decision-directed
    // one on the previous estimate (omlsa.m)
    absence(snr ? snr(mag, est.psd) : est.xi0)
    let P = spp && spp(est.gamma)
    for (let k = 0; k <= half; k++) {
      // (9); omlsa.m takes speech as absent where q ≥ 0.9: a noise bin that happens to peak keeps G_min, no musical tone.
      // A held noise: the observation averaged over neighbouring bins, at fixed priors (Gerkmann et al. 2008)
      let qk = q[k], p = qk >= 0.9 ? 0 : held ? P[k] : 1 / (1 + qk / (1 - qk) * (1 + xi[k]) * Math.exp(-v[k]))
      mag[k] *= Math.pow(Math.max(gH1[k], gMin), p) * Math.pow(gMin, 1 - p)              // (16), G_H1 floored at G_min
    }
    return { mag, phase }
  }
}
