// Wiener filter / MMSE-LSA denoise with decision-directed a-priori SNR.
//
// Two gain rules selectable via { rule: 'wiener' | 'mmse-lsa' }:
//
//   wiener:    G(k) = ξ / (1 + ξ)                                             (Scalart & Filho 1996)
//   mmse-lsa:  G(k) = ξ/(1+ξ) · exp(½ · ∫_{ν}^{∞} (e^{-t}/t) dt)              (Ephraim & Malah 1985, eq. 20)
//
// where ξ = a-priori SNR, decision-directed: ξ = α Â²(l−1)/λ(l−1) + (1−α) max(γ−1, 0) (Ephraim & Malah 1984, eq. 51),
// ν = ξ·γ/(1+ξ), γ = |Y|²/λ the posterior SNR. mmse-lsa is the default: less musical noise than Wiener's gain.
//
// α = 0.98 is Ephraim & Malah's for their 8 ms frame step (§VI: 256 samples at 8 kHz, a new frame every 64), rescaled to
// the actual step Δt as α^(Δt/8 ms), so the a priori SNR's memory holds in seconds: taken per frame, it ran 1.8× longer
// at 48 kHz (10.7 ms steps) than at 44.1 kHz (5.8 ms). ξ_min stays −15 dB: −25 dB, Cohen's and Loizou's floor, left
// more musical noise (log kurtosis ratio on steady white and pink noise 0.98 and 1.49, against 0.53 and 1.01) and cost
// PESQ and SIG on VoiceBank+DEMAND training speech; the floor is what holds the noise's peaks down (Cappé 1994).
//
// Noise PSD: a manual `profile`, a noise-only stretch named by `noiseFrames`/`profileFrom`/`profileTo`, or else
// tracked by Minimum Statistics (Martin 2001) over a 1.5 s window, batch and stream alike.

import { stftBatch, stftStream } from '@audio/stft'
import { minStats, noiseProfile } from '@audio/noise-estimate'

// Wrap { write, flush } into a single callable (inlined convention).
const writer = s => chunk => chunk ? s.write(chunk) : s.flush()
const REF_DT = 64 / 8000                           // Ephraim & Malah's frame step, 8 ms

// The analysis frame: the power of two nearest 32 ms, Ephraim & Malah 1984's (§VI: 256 samples at 8 kHz, each frame
// overlapping the last by 192, so a quarter-frame hop as here): 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48.
export const frame = fs => 2 ** Math.round(Math.log2(0.032 * fs))

// frame, hop and rate an option set resolves to (the manifest, stream and batch forms agree)
function framing(opts) {
  let fs = opts.fs || 44100, N = opts.frameSize || frame(fs)
  return { ...opts, fs, frameSize: N, hopSize: opts.hopSize || N >> 2 }
}

export default function wiener(dataOrOpts, opts) {
  if (dataOrOpts instanceof Float32Array || dataOrOpts instanceof Float64Array) {
    return run(dataOrOpts, framing(opts || {}))
  }
  let o = framing(dataOrOpts || {})
  return writer(stftStream(makeProcess(o), o))
}

/** The gain as a frame process, (mag, phase) → { mag, phase }, for a host that runs its own STFT (@audio/stft's
 *  framing: Hann, `hopSize` a quarter of `frameSize`). One per channel: it keeps state across frames. */
export const processor = opts => makeProcess(framing(opts || {}))

function run(data, opts) {
  let N = opts.frameSize, hop = opts.hopSize
  let profile = opts.profile
  // a noise-only stretch the caller names gives the profile; otherwise the noise is tracked, as the stream does
  if (!profile && (opts.noiseFrames != null || opts.profileFrom != null || opts.profileTo != null)) {
    let from = opts.profileFrom ?? 0
    let nf = opts.noiseFrames                                 // # leading noise-only frames
    let to = opts.profileTo ?? (nf != null
      ? Math.min(data.length, from + N + Math.max(0, nf - 1) * hop)
      : Math.min(data.length, from + N * 4))
    profile = noiseProfile(data, { from, to, frameSize: N, hopSize: hop })
  }
  return stftBatch(data, makeProcess({ ...opts, profile }), opts)
}

// Approximate exponential integral E1(ν) for ν > 0 (Abramowitz 5.1.53/5.1.56).
function exp1(v) {
  if (v <= 0) return 30
  if (v < 1) {
    let a = [-.57721566, .99999193, -.24991055, .05519968, -.00976004, .00107857]
    let s = 0
    for (let i = a.length - 1; i >= 0; i--) s = s * v + a[i]
    return s - Math.log(v)
  }
  let a = [.2677737343, 8.6347608925, 18.0590169730, 8.5733287401]
  let b = [3.9584969228, 21.0996530827, 25.6329561486, 9.5733223454]
  let num = a[0] + v * (a[1] + v * (a[2] + v * (a[3] + v)))
  let den = b[0] + v * (b[1] + v * (b[2] + v * (b[3] + v)))
  return Math.exp(-v) / v * num / den
}

function makeProcess(opts) {
  let rule = opts.rule || 'mmse-lsa'
  let N = opts.frameSize, hop = opts.hopSize, fs = opts.fs
  let alphaDD = (opts.alphaDD ?? opts.alpha ?? 0.98) ** (hop / fs / REF_DT)   // per 8 ms; `alpha` = documented alias
  let xiMin = opts.xiMin ?? 10 ** (-15 / 10)       // −15 dB, as the manifest's xiFloor
  let auto = !opts.profile
  let half = N >> 1
  let est = auto ? minStats(half, { D: Math.round(1.5 * fs / hop), ...opts.estimator }) : null   // Martin's 1.5 s
  let profile = opts.profile
  // Â²(l−1)/λ(l−1), the decision-directed memory: 1 before the first frame (Cohen's omlsa.m, Loizou's logmmse.m)
  let eta2 = new Float64Array(half + 1).fill(1)

  return function (mag, phase) {
    if (!mag.some(Boolean)) return { mag, phase }            // digital silence: nothing to learn or attenuate
    if (auto) { est.update(mag); profile = est.psd }

    for (let k = 0; k <= half; k++) {
      let n = Math.max(profile[k], 1e-30)
      let gamma = mag[k] * mag[k] / n
      // Ephraim & Malah 1984 eq. (51): ξ = α Â²(l−1)/λ(l−1) + (1−α) max(γ−1, 0)
      let xi = Math.max(xiMin, alphaDD * eta2[k] + (1 - alphaDD) * Math.max(gamma - 1, 0))
      let G = rule === 'wiener' ? xi / (1 + xi) : xi / (1 + xi) * Math.exp(0.5 * exp1(xi * gamma / (1 + xi)))
      eta2[k] = G * G * gamma
      mag[k] *= G
    }
    return { mag, phase }
  }
}
