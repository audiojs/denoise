// De-reverb: weighted prediction error (WPE), recursive, one channel.
// Nakatani, Yoshioka, Kinoshita, Miyoshi & Juang, "Speech dereverberation based on variance-normalized delayed linear
// prediction", IEEE TASLP 18(7), 2010; its recursive least-squares form: Yoshioka & Nakatani, "Generalization of
// multi-channel linear prediction methods for blind MIMO impulse response shortening", IEEE TASLP 20(10), 2012, and
// Caroselli, Shafran, Narayanan & Rose, "Adaptive multichannel dereverberation for automatic speech recognition",
// Interspeech 2017.
//
// In each STFT bin, the late reverberation of frame t is what the frames D … D+K−1 before it predict:
//   d(t) = y(t) − gᴴ ȳ(t),   ȳ(t) = [y(t−D), …, y(t−D−K+1)]ᵀ
// g minimizes Σₛ αᵗ⁻ˢ |d(s)|² / λ(s): the speech a zero-mean Gaussian whose variance λ follows the observation's
// power, so the prediction takes what the room adds, not the speech's own correlation. Recursive least squares:
//   u = P ȳ,  k = u / (α λ + ȳᴴ u),  g ← g + k d*,  P ← (P − k uᴴ) / α
// The delay (D·hop ≈ 30 ms) keeps the direct sound and early reflections; 110 ms of prediction takes the late tail,
// whatever its decay time: no T60 to estimate, no gain floor, no musical noise (a linear filter per bin). Frame t
// leaves through the filter of frame t + L, L·hop ≈ 0.25 s later: a take's first words get what the next quarter
// second teaches, at L·hop of latency. The constants were chosen on VoiceBank speech in MIT IR Survey rooms (training
// speakers and even-numbered rooms; scripts/speech.mjs).

import { stftBatch, stftStream } from '@audio/stft'

const DELAY = 0.03, ORDER = 0.11, MEMORY = 1.06, LOOKAHEAD = 0.25   // s; MEMORY: the forgetting's time constant
const DELTA = 10                                                     // P starts at I / δ: the prior g = 0 weighs about as much as 10 frames

// The analysis frame: the power of two nearest 40 ms (512 at 16 kHz, 1024 at 22.05, 2048 at 44.1 and 48), hop a
// quarter: the 110 ms of prediction stays within 9 to 14 frames, whose square the cost grows with
export const frame = fs => 2 ** Math.round(Math.log2(0.04 * fs))

// frame, hop, and the prediction's delay D, taps K, look-ahead L (frames) and forgetting α an option set resolves to
// (the manifest, stream and batch forms agree)
export function framing(opts = {}) {
  let fs = opts.fs || 44100, N = opts.frameSize || frame(fs), hop = opts.hopSize || N >> 2, dt = hop / fs
  return {
    ...opts, fs, frameSize: N, hopSize: hop,
    D: Math.max(1, Math.round(DELAY / dt)), K: Math.max(1, Math.round(ORDER / dt)),
    L: Math.max(0, Math.round((opts.lookahead ?? LOOKAHEAD) / dt)), alpha: Math.exp(-dt / MEMORY)
  }
}

export default function dereverb(dataOrOpts, opts) {
  if (dataOrOpts instanceof Float32Array || dataOrOpts instanceof Float64Array) {
    let o = framing(opts), lag = o.L * o.hopSize, x = dataOrOpts
    // L·hop of silence after the input lets its last frames leave; the output, L·hop late, is shifted back
    if (lag) { let p = new Float32Array(x.length + lag); p.set(x); x = p }
    let y = stftBatch(x, wpe(o), o)
    return lag ? y.slice(lag) : y
  }
  let o = framing(dataOrOpts), s = stftStream(wpe(o), o), skip = o.L * o.hopSize
  let drop = y => { let n = Math.min(skip, y.length); skip -= n; return n ? y.subarray(n) : y }
  // as the batch: the first L·hop samples out are the look-ahead's, and L·hop of silence closes the stream
  return chunk => {
    if (chunk) return drop(s.write(chunk))
    let a = drop(s.write(new Float32Array(o.L * o.hopSize))), b = drop(s.flush()), out = new Float32Array(a.length + b.length)
    out.set(a); out.set(b, a.length)
    return out
  }
}

// The STFT process: frame t updates the filters, frame t − L leaves through them
function wpe({ frameSize: N, D, K, L, alpha }) {
  let F = (N >> 1) + 1, M = L + D + K                     // the ring keeps the last M frames
  let yr = new Float64Array(M * F), yi = new Float64Array(M * F)
  let gr = new Float64Array(F * K), gi = new Float64Array(F * K)
  let Pr = new Float64Array(F * K * K), Pi = new Float64Array(F * K * K)
  for (let f = 0; f < F; f++) for (let i = 0; i < K; i++) Pr[f * K * K + i * K + i] = 1 / DELTA
  let br = new Float64Array(K), bi = new Float64Array(K), ur = new Float64Array(K), ui = new Float64Array(K)
  let sr = new Int32Array(K), so = new Int32Array(K), t = 0, top = 0
  let slot = n => ((n % M) + M) % M

  return (mag, phase) => {
    let c = slot(t) * F, s = t - L, cs = slot(s) * F
    for (let f = 0; f < F; f++) {
      let p = mag[f] * mag[f]
      yr[c + f] = mag[f] * Math.cos(phase[f]); yi[c + f] = mag[f] * Math.sin(phase[f])
      if (p > top) top = p
    }
    // λ's floor, 100 dB under the loudest bin so far: a spectral null would otherwise weigh without bound
    let floor = top * 1e-10 + 1e-30
    for (let i = 0; i < K; i++) { sr[i] = slot(t - D - i) * F; so[i] = slot(s - D - i) * F }

    for (let f = 0; f < F; f++) {
      let g = f * K, q = f * K * K
      // frame s through the filter as it stands: y(s) − gᴴ ȳ(s)
      let or = 0, oi = 0
      if (s >= 0) {
        or = yr[cs + f]; oi = yi[cs + f]
        for (let i = 0; i < K; i++) {
          let xr = yr[so[i] + f], xi = yi[so[i] + f]
          or -= gr[g + i] * xr + gi[g + i] * xi; oi -= gr[g + i] * xi - gi[g + i] * xr
        }
      }
      mag[f] = Math.sqrt(or * or + oi * oi); phase[f] = Math.atan2(oi, or)

      // frame t into the filter
      let e = 0
      for (let i = 0; i < K; i++) { br[i] = yr[sr[i] + f]; bi[i] = yi[sr[i] + f]; e += br[i] * br[i] + bi[i] * bi[i] }
      if (e <= floor * K) continue                        // no signal to learn from: neither learn nor forget
      let dr = yr[c + f], di = yi[c + f]
      for (let i = 0; i < K; i++) { dr -= gr[g + i] * br[i] + gi[g + i] * bi[i]; di -= gr[g + i] * bi[i] - gi[g + i] * br[i] }
      let lam = Math.max(yr[c + f] * yr[c + f] + yi[c + f] * yi[c + f], floor), den = alpha * lam
      for (let i = 0; i < K; i++) {
        let vr = 0, vi = 0, r = q + i * K
        for (let j = 0; j < K; j++) { vr += Pr[r + j] * br[j] - Pi[r + j] * bi[j]; vi += Pr[r + j] * bi[j] + Pi[r + j] * br[j] }
        ur[i] = vr; ui[i] = vi; den += br[i] * vr + bi[i] * vi       // Re(ȳᴴ u)
      }
      let w = 1 / den
      for (let i = 0; i < K; i++) {
        gr[g + i] += (ur[i] * dr + ui[i] * di) * w; gi[g + i] += (ui[i] * dr - ur[i] * di) * w   // g += u d* / den
        for (let j = i, r = q + i * K; j < K; j++) {                 // P ← (P − u uᴴ / den) / α, Hermitian: j ≥ i, mirrored
          let a = (Pr[r + j] - (ur[i] * ur[j] + ui[i] * ui[j]) * w) / alpha, b = (Pi[r + j] - (ui[i] * ur[j] - ur[i] * ui[j]) * w) / alpha
          Pr[r + j] = Pr[q + j * K + i] = a; Pi[r + j] = b; Pi[q + j * K + i] = -b
        }
      }
    }
    t++
    return { mag, phase }
  }
}
