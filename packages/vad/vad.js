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
const VOICING = 0.45                 // normalized autocorrelation that counts as voiced (Praat's voicing threshold)
const TONE = 0.8                     // so periodic a frame is a tone: the noise floor does not learn it (AMR's VAD)
const MARGIN = 30                    // dB under the voiced frames' mean power that still counts as speech
const VOWEL = 0.03                   // s of voicing within ±50 ms that make a vowel
const REACH = 0.3                    // s from a vowel that a consonant, a cluster, a decay may lie
const CLOSURE = 0.15                 // s: a stop's closure lasts up to this; gaps this short inside speech are speech

// Returns { active, voiced: Uint8Array(frames), times: Float32Array(frames) of frame-start s, hop, frameSize }.
//
// A frame is speech when it holds voicing, or sound over the noise floor near voicing:
//   1. noise floor λ_k: minimum statistics (Martin 2001, @audio/noise-estimate) over FLOOR s centred on the frame, so
//      a level that moves through the recording is followed, and a recording that starts on speech is not misread.
//      A frame so periodic it is a tone (TONE) is kept out of it, as AMR's VAD keeps tones out of its background
//      estimate (3GPP TS 26.094): a note or a vowel held longer than the window is not the room
//   2. sound present: Sohn's likelihood ratio, the mean over the band of log Λ_k = γ_k ξ_k/(1+ξ_k) − log(1+ξ_k)
//      (Sohn, Kim & Sung 1999 eq. 3-4), γ = |Y|²/λ, ξ decision-directed (Ephraim & Malah 1984), over ETA
//   3. voiced: present, and the normalized autocorrelation r(τ)/r_w(τ) (Boersma 1993 eq. 9) of the frame's Wiener
//      estimate ξ/(1+ξ)·|Y| peaks at VOICING or more over the pitch lags. On the estimate, not the frame: a hum in
//      the floor is not voicing
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
  let { present, level, per } = frameStats(data, { fs, N, hop, frames, k0, K, v0: bin(VBAND[0]), v1, t0, t1 })

  for (let f = 0; f < frames; f++) voiced[f] = present[f] && per[f] >= VOICING ? 1 : 0
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

// Per frame: present (likelihood ratio over ETA), level (band power), per (voicing: the normalized autocorrelation
// peak). The noise floor is read FLOOR/2 s late, so it spans FLOOR s centred on the frame decided; tones stay out of it.
function frameStats(data, { fs, N, hop, frames, k0, K, v0, v1, t0, t1 }) {
  let present = new Uint8Array(frames), level = new Float64Array(frames), per = new Float32Array(frames), tone = new Uint8Array(frames)
  let lag = Math.max(1, Math.round(FLOOR * fs / hop) >> 1), R = lag + 1
  let est = minStats(K - 1, { D: 2 * lag })
  let ring = Array.from({ length: R }, () => new Float64Array(K)), mag = new Float64Array(K)
  // the autocorrelation of the voicing band needs no more bins than the band: an inverse transform of M ≥ 2·v1 points
  // gives it exactly, at every N/M-th lag
  let M = 2 ** Math.ceil(Math.log2(2 * v1)), d = N / M, u0 = Math.max(1, Math.floor(t0 / d)), u1 = Math.min((M >> 1) - 1, Math.ceil(t1 / d))
  let win = hannWindow(N), x = new Float64Array(N), re = new Float64Array((M >> 1) + 1), im = new Float64Array((M >> 1) + 1)
  let rw = new Float64Array(u1 + 2)                         // the window's own autocorrelation, circular as the frames'
  for (let t = 0; t <= u1 + 1; t++) { let s = 0; for (let i = 0; i < N; i++) s += win[i] * win[(i + t * d) % N]; rw[t] = s }
  for (let t = u1 + 1; t >= 0; t--) rw[t] /= rw[0]
  // decision-directed ξ: α 0.98 per 10 ms (Ephraim & Malah 1984), floored at -15 dB as ddSnr below
  let alpha = 0.98 ** (hop / fs / 0.01), xiMin = 0.0316, prev = new Float64Array(K).fill(1), g2 = new Float64Array(K)

  // the normalized autocorrelation peak over the pitch lags of the band power w(k)·p_k (Boersma 1993 eq. 9)
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
  const feed = p => { for (let k = 0; k < K; k++) mag[k] = Math.sqrt(p[k]); est.update(mag) }
  // the window centred on each frame: the first `lag` frames that are no tone go in before the first decision
  let primed = false
  const prime = (a0, a1) => {
    for (let j = a0; j <= a1; j++) if (!tone[j]) { feed(ring[j % R]); primed = true }
  }
  const decide = (f, p) => {
    let lam = est.psd, s = 0, e = 0
    for (let k = 0; k < K; k++) {
      let g = Math.min(p[k] / Math.max(lam[k], 1e-30), 1000)              // γ, capped at 30 dB as VOICEBOX's vadsohn
      let xi = Math.max(alpha * prev[k] + (1 - alpha) * Math.max(g - 1, 0), xiMin), G = xi / (1 + xi)
      s += g * G - Math.log(1 + xi); e += p[k]
      prev[k] = G * G * g; g2[k] = G * G
    }
    present[f] = s / K > ETA ? 1 : 0
    level[f] = e
    per[f] = periodicity(p, g2)
  }

  for (let i = 0; i < frames; i++) {
    for (let j = 0, pos = i * hop; j < N; j++) x[j] = data[pos + j] * win[j]
    let [xr, xi] = fft(x), b = ring[i % R]
    for (let k = 0; k < K; k++) b[k] = xr[k + k0] * xr[k + k0] + xi[k + k0] * xi[k + k0]
    tone[i] = periodicity(b) >= TONE ? 1 : 0
    if (i < lag) continue
    if (!primed) prime(i - lag, i)
    else if (!tone[i]) feed(b)
    decide(i - lag, ring[(i - lag) % R])
  }
  if (frames < R) { prime(0, frames - 1); for (let f = 0; f < frames; f++) decide(f, ring[f]) }
  else for (let f = frames - lag; f < frames; f++) decide(f, ring[f % R])
  return { present, level, per }
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
