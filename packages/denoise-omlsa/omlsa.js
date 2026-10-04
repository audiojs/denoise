// OM-LSA: Optimally Modified Log-Spectral Amplitude estimator with IMCRA noise estimation.
// Cohen & Berdugo, "Speech enhancement for non-stationary noise environments", Signal Processing 81, 2001;
// Cohen, "Noise spectrum estimation in adverse environments: IMCRA", IEEE TSAP 11(5), 2003.
//
//   G = max(G_H1, G_min)^p · G_min^(1−p)                                         (16), G_H1 floored at G_min
//   G_H1 = ξ/(1+ξ) · exp(½ E1(v)), v = γξ/(1+ξ)       LSA gain when speech is present (15)
//   p = [1 + q/(1−q) · (1+ξ) · exp(−v)]⁻¹             speech presence probability  (9)
//   ξ = α G_H1²(l−1) γ(l−1) + (1−α) max(γ−1, 0)       a priori SNR on G_H1, not G   (18)
//   q = 1 − P_local · P_global · P_frame               a priori speech absence, from ξ recursively averaged
//                                                      over time (23) and over neighbouring bins (24)-(28)
//
// The noise spectrum λ_d and ξ, γ, G_H1 come from @audio/noise-estimate's imcra. Constants: Table 1 of the 2001
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
// A known noise (`profile`, or a noise-only stretch named by `noiseFrames`/`profileFrom`/`profileTo`) is held instead
// of tracked (noise-estimate's `known`), and p reads the observation alone: (9) with ξ the fixed a priori SNR of speech
// ξ_H1 = 15 dB and q 0.5 (Gerkmann & Hendriks, IEEE TASLP 20(4), 2012), gated by the estimated q ≥ 0.9 as ever. The
// decision-directed ξ lags a word's onset by a frame or more; with the noise known, γ alone tells speech from noise.
// On the 168 training utterances, the noise learned from each one's lead-in, G_min −12 dB: PESQ 1.86, STOI 0.835, SIG
// 3.19 (α 0.98 per frame: 1.88, 0.826, 3.14; the second and third frames after a pause in the narrations lose 5 and
// 0.6 dB, were 8 and 4); steady noise under speech and music (hiss, hum, buzz, a fan, room tone, tones) stays free of
// musical noise down to G_min −20 dB (log kurtosis ratio 0.00), but for the half second after music stops: 0.11 at
// −12 dB, 1.00 at −20 (scripts/broadband.mjs; 0.12 and 1.02 before).

import { stftBatch, stftStream } from '@audio/stft'
import { imcra, known, noiseProfile } from '@audio/noise-estimate'

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

// Gerkmann & Hendriks 2012: the a priori SNR of speech when present, 15 dB; p = [1 + (1+ξ_H1) exp(−γ ξ_H1/(1+ξ_H1))]⁻¹
const XI_H1 = 10 ** (15 / 10), V_H1 = XI_H1 / (1 + XI_H1)

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
  let est = held ? known(opts.profile, { fs, hop, alphaDD, xiMin }) : imcra(half, { fs, hop, alphaDD, xiMin, ...opts.estimator })

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

  function absence() {
    if (qFixed != null) return q.fill(qFixed)
    let xi = est.xi0                                // this frame's a priori SNR on the previous noise (omlsa.m)
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
    let xi = est.xi, v = est.v, gH1 = est.gain, g = est.gamma
    absence()
    for (let k = 0; k <= half; k++) {
      // (9); omlsa.m takes speech as absent where q ≥ 0.9: a noise bin that happens to peak keeps G_min, no musical tone.
      // A held noise: (9) at ξ_H1 and q 0.5 (Gerkmann & Hendriks 2012)
      let qk = q[k], p = qk >= 0.9 ? 0 : held ? 1 / (1 + (1 + XI_H1) * Math.exp(-g[k] * V_H1))
        : 1 / (1 + qk / (1 - qk) * (1 + xi[k]) * Math.exp(-v[k]))
      mag[k] *= Math.pow(Math.max(gH1[k], gMin), p) * Math.pow(gMin, 1 - p)              // (16), G_H1 floored at G_min
    }
    return { mag, phase }
  }
}
