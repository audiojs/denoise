// Voice Activity Detection + Speech Presence Probability.
//   - vad: per-frame speech decision: sound over a tracked noise floor, anchored on voicing
//   - spp: soft probability per bin from a-priori SNR (drives OM-LSA, IMCRA)
//
// Use vad() for gating and editing decisions (debreath, desilence); spp() for spectral denoise gain.

import { minStats } from '@audio/noise-estimate'
import { hannWindow } from '@audio/stft'
import { fft, ifft } from 'fourier-transform'

const F0 = [75, 600]                 // pitch floor and ceiling, Hz: Praat's defaults (Boersma 1993)
const BAND = [60, 8000]              // where speech is looked for, Hz
const VBAND = [60, 4000]             // where voicing is, Hz: higher harmonics lose their period to jitter
const FLOOR = 1.5                    // s, the minimum-statistics window (Martin 2001)
const ETA = 0.1                      // likelihood-ratio threshold: under 0.1 % of frames of stationary noise pass it
const VOICING = 0.4                  // autocorrelation of the frame over its floor that is voiced (Praat's 0.45 lost more)
const FLAT = 0.25                    // and over its envelope: noise peaks there at 0.23, voiced speech at 0.43-0.54
const ENVELOPE = 300                 // Hz either side: wider than a voice's harmonics lie apart, narrower than its formants
const TONE = 0.8                     // so periodic a frame is a tone: the noise floor does not learn it (AMR's VAD)
const MARGIN = 30                    // dB under the voiced frames' mean power that still counts as speech
const VOWEL = 0.03                   // s of voicing within ±50 ms that make a vowel
const REACH = 0.3                    // s from a vowel that a consonant, a cluster, a decay may lie
const CLOSURE = 0.15                 // s: a stop's closure lasts up to this; gaps this short inside speech are speech

// Returns { active, voiced: Uint8Array(frames), times: Float32Array(frames) of frame-start s, hop, frameSize }.
//
// A frame is speech when it holds voicing, or sound over the noise floor near voicing:
//   1. noise floor λ_k: minimum statistics (Martin 2001, @audio/noise-estimate) over the FLOOR s before the frame
//      and over the FLOOR s after it, the larger of the two. A level that steps up or down (a fan switched on, the
//      room after a cut) reads low on one side only; where only one side is whole (the first and last FLOOR s) it
//      alone counts. A frame so periodic it is a tone (TONE) is kept out of it, as AMR's VAD keeps tones out of its
//      background estimate (3GPP TS 26.094): a note or a vowel held longer than the window is not the room
//   2. sound present: Sohn's likelihood ratio, the mean over the band of log Λ_k = γ_k ξ_k/(1+ξ_k) − log(1+ξ_k)
//      (Sohn, Kim & Sung 1999 eq. 3-4), γ = |Y|²/λ, ξ decision-directed (Ephraim & Malah 1984), over ETA
//   3. voiced: present, and periodic twice over: the normalized autocorrelation r(τ)/r_w(τ) (Boersma 1993 eq. 9),
//      peaked over the pitch lags, of the frame whitened by its floor, γ_k (VOICING), and of the frame whitened by its
//      own envelope, its power averaged over ±ENVELOPE (FLAT). Whitened, a noise's colour, a hum or an engine in the
//      floor carries no period. Unwhitened it does: over the six VoiceBank+DEMAND training noises that are no crowd
//      (car, kitchen, metro, station, traffic, speech-shaped), the raw frame's autocorrelation peaks at 0.40 (median), the
//      Wiener estimate ξ/(1+ξ)·|Y| (2.0.0's) at 0.80, a few random bins left standing, a sparse spectrum; whitened by
//      the floor 0.22, by the envelope 0.23. The envelope keeps it where the floor read low (a level step at an edge
//      of the input leaves the noise's tilt in γ); it is narrower than a vowel's or a breath's formants lie apart, so
//      their resonances, about 1 kHz apart, are no period either
//   4. level: nothing MARGIN dB under the voiced frames' mean power is speech: the weakest phoneme lies some 28 dB
//      under the strongest (Fletcher 1953); quieter is a breath, a click, the room
//   5. speech: vowels (VOWEL s of voicing), grown outward through present sound up to REACH from the vowel, across
//      gaps up to CLOSURE. A breath, a cough, a door between phrases holds no voicing and is not speech
//
// The frame holds 3 periods of the pitch floor (Boersma 1993): the power of two over 3·fs/75, 2048 at 44.1 and 48 kHz,
// 1024 at 16 kHz; the hop a quarter of it.
export function vad(data, opts = {}) {
  let fs = opts.fs || 44100
  let N = opts.frameSize || 2 ** Math.ceil(Math.log2(3 * fs / F0[0]))
  let hop = opts.hopSize || (N >> 2)
  let half = N >> 1
  let frames = Math.max(0, Math.floor((data.length - N) / hop) + 1)
  let active = new Uint8Array(frames), voiced = new Uint8Array(frames), times = new Float32Array(frames)
  for (let i = 0; i < frames; i++) times[i] = i * hop / fs
  let res = { active, voiced, times, hop, frameSize: N }
  if (!frames) return res

  let bin = f => Math.min(half, Math.max(1, Math.round(f * N / fs)))
  let k0 = bin(BAND[0]), K = bin(BAND[1]) - k0 + 1, v1 = Math.min(bin(VBAND[1]), k0 + K - 1)
  let t0 = Math.max(2, Math.floor(fs / F0[1])), t1 = Math.min(half - 1, Math.ceil(fs / F0[0]))
  let { present, level, per, flat } = frameStats(data, { fs, N, hop, frames, k0, K, v0: bin(VBAND[0]), v1, t0, t1 })

  for (let f = 0; f < frames; f++) voiced[f] = present[f] && per[f] >= VOICING && flat[f] >= FLAT ? 1 : 0
  let s = 0, n = 0
  for (let f = 0; f < frames; f++) if (voiced[f]) { s += level[f]; n++ }
  let quiet = n ? s / n * 10 ** (-MARGIN / 10) : Infinity
  for (let f = 0; f < frames; f++) if (level[f] < quiet) present[f] = voiced[f] = 0

  let sec = t => Math.round(t * fs / hop), w = sec(0.05), need = Math.max(1, sec(VOWEL))
  let vowel = new Uint8Array(frames)
  for (let f = 0; f < frames; f++) if (voiced[f]) {
    let c = 0
    for (let j = Math.max(0, f - w); j <= Math.min(frames - 1, f + w); j++) c += voiced[j]
    vowel[f] = c >= need ? 1 : 0
  }
  grow(active, vowel, present, sec(REACH), sec(CLOSURE))
  return res
}

// Per frame: present (likelihood ratio over ETA), level (band power), per (periodicity over the floor) and flat
// (periodicity over the frame's own envelope). Frame f is decided once the FLOOR s after it are in.
function frameStats(data, { fs, N, hop, frames, k0, K, v0, v1, t0, t1 }) {
  let present = new Uint8Array(frames), level = new Float64Array(frames), per = new Float32Array(frames)
  let flat = new Float32Array(frames)
  let D = Math.max(2, Math.round(FLOOR * fs / hop)), est = minStats(K - 1, { D })
  let ring = Array.from({ length: D }, () => new Float64Array(K)), past = Array.from({ length: D }, () => new Float64Array(K))
  let mag = new Float64Array(K), lam = new Float64Array(K), w = new Float64Array(K), env = new Float64Array(K + 1)
  // the autocorrelation of the voicing band needs no more bins than the band: an inverse transform of M ≥ 2·v1 points
  // gives it exactly, at every N/M-th lag
  let M = 2 ** Math.ceil(Math.log2(2 * v1)), d = N / M, u0 = Math.max(1, Math.floor(t0 / d)), u1 = Math.min((M >> 1) - 1, Math.ceil(t1 / d))
  let win = hannWindow(N), x = new Float64Array(N), re = new Float64Array((M >> 1) + 1), im = new Float64Array((M >> 1) + 1)
  let rw = new Float64Array(u1 + 2)                         // the window's own autocorrelation, circular as the frames'
  for (let t = 0; t <= u1 + 1; t++) { let s = 0; for (let i = 0; i < N; i++) s += win[i] * win[(i + t * d) % N]; rw[t] = s }
  for (let t = u1 + 1; t >= 0; t--) rw[t] /= rw[0]
  // decision-directed ξ: α 0.98 per 10 ms (Ephraim & Malah 1984), floored at -15 dB as ddSnr below
  let alpha = 0.98 ** (hop / fs / 0.01), xiMin = 0.0316, prev = new Float64Array(K).fill(1), hw = Math.round(ENVELOPE * N / fs)

  // the normalized autocorrelation peak over the pitch lags of the band power p_k·w_k (Boersma 1993 eq. 9)
  const periodicity = (p, w) => {
    re.fill(0); im.fill(0)
    for (let k = v0; k <= v1; k++) re[k] = (w ? w[k - k0] : 1) * p[k - k0]
    let r = ifft(re, im), best = 0
    if (r[0] > 0) for (let t = u0; t <= u1; t++) {
      if (r[t] < r[t - 1] || r[t] < r[t + 1]) continue
      let a = r[t - 1] - 2 * r[t] + r[t + 1], peak = a < 0 ? r[t] - (r[t + 1] - r[t - 1]) ** 2 / (8 * a) : r[t]   // parabolic, between the lags
      best = Math.max(best, peak / r[0] / rw[t])
    }
    return best
  }
  // 1 / the frame's envelope: its power averaged over ±ENVELOPE
  const envelope = p => {
    for (let k = 0; k < K; k++) env[k + 1] = env[k] + p[k]
    for (let k = 0; k < K; k++) { let a = Math.max(0, k - hw), b = Math.min(K, k + hw + 1), e = env[b] - env[a]; w[k] = e > 0 ? (b - a) / e : 0 }
    return w
  }
  const decide = (f, p, before, after) => {
    for (let k = 0; k < K; k++) lam[k] = Math.max(before ? before[k] : 0, after ? after[k] : 0)
    let s = 0, e = 0
    for (let k = 0; k < K; k++) {
      let l = Math.max(lam[k], 1e-30), g = Math.min(p[k] / l, 1000)    // γ, capped at 30 dB as VOICEBOX's vadsohn
      let xi = Math.max(alpha * prev[k] + (1 - alpha) * Math.max(g - 1, 0), xiMin), G = xi / (1 + xi)
      s += g * G - Math.log(1 + xi); e += p[k]
      prev[k] = G * G * g; w[k] = 1 / l
    }
    present[f] = s / K > ETA ? 1 : 0
    level[f] = e
    per[f] = periodicity(p, w)
  }

  for (let i = 0; i < frames; i++) {
    for (let j = 0, pos = i * hop; j < N; j++) x[j] = data[pos + j] * win[j]
    let [xr, xi] = fft(x), b = ring[i % D]
    for (let k = 0; k < K; k++) b[k] = xr[k + k0] * xr[k + k0] + xi[k + k0] * xi[k + k0]
    flat[i] = periodicity(b, envelope(b))
    if (periodicity(b) < TONE) { for (let k = 0; k < K; k++) mag[k] = Math.sqrt(b[k]); est.update(mag) }
    past[i % D].set(est.psd)                                     // the floor over the D frames up to i
    let f = i - D + 1                                            // est.psd now: the floor over the D frames from f
    if (f >= 0) decide(f, ring[f % D], f >= D - 1 ? past[f % D] : null, est.psd)
  }
  // the last D - 1 frames have no whole window after them: the one before, or the whole input where that is short too
  for (let f = Math.max(0, frames - D + 1); f < frames; f++) decide(f, ring[f % D], f >= D - 1 ? past[f % D] : null, f >= D - 1 ? null : est.psd)
  return { present, level, per, flat }
}

// Speech from the vowels outward, both ways: present frames up to `reach` frames from the vowel, across gaps of up to
// `gap` frames (a stop's closure). A breath that a pause parts from the phrase is not reached; one that runs into it is
function grow(active, vowel, present, reach, gap) {
  let n = active.length
  for (let back = 0; back < 2; back++) for (let k = 0, v = -1e9, r = -1e9; k < n; k++) {
    let f = back ? n - 1 - k : k
    if (vowel[f]) { active[f] = 1; v = r = k }
    else if (present[f] && k - v <= reach && k - r - 1 <= gap) { active[f] = 1; r = k }
  }
  for (let f = 0, last = -1; f < n; f++) if (active[f]) { if (last >= 0 && f - last - 1 <= gap) active.fill(1, last + 1, f); last = f }
}

// Per-bin Speech Presence Probability from a-priori SNR ξ:
//   p = ξ / (1 + ξ)   (Bayesian formulation under Gaussian model, q-prior = 0.5)
// Bind to a noise PSD source (e.g. minStats.psd or imcra.psd) and an a-priori SNR estimate.
export function spp(mag, noisePsd, opts = {}) {
  let xiMin = opts.xiMin ?? 0.0316             // -15 dB floor
  let half = mag.length - 1
  let p = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) {
    let post = (mag[k] * mag[k]) / Math.max(noisePsd[k], 1e-30) - 1
    let xi = Math.max(xiMin, post)
    p[k] = xi / (1 + xi)
  }
  return p
}

// Decision-Directed a-priori SNR (Ephraim-Malah 1984), recursive smoothing.
//   ξ̂[k] = α · |X̂_prev[k]|² / N̂[k]  +  (1-α) · max(γ-1, 0)
// γ = posterior SNR = |Y[k]|² / N̂[k]. Used by Wiener, MMSE, OM-LSA gain rules.
export function ddSnr(mag, noisePsd, prevGain, prevMag, alpha = 0.98) {
  let half = mag.length - 1
  let xi = new Float64Array(half + 1)
  for (let k = 0; k <= half; k++) {
    let n = Math.max(noisePsd[k], 1e-30)
    let post = (mag[k] * mag[k]) / n
    let g = prevGain[k] * prevMag[k]
    let prev = (g * g) / n
    xi[k] = Math.max(0.0316, alpha * prev + (1 - alpha) * Math.max(post - 1, 0))
  }
  return xi
}
