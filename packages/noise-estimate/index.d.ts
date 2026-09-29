/** Noise power-spectral-density estimators feeding the statistical denoisers (Wiener, OM-LSA, MMSE). */

export interface NoiseProfileOptions {
  /** STFT frame, default 2048 */
  frameSize?: number
  /** OLA hop, default frameSize/4 */
  hopSize?: number
  /** segment start (samples), default 0 */
  from?: number
  /** segment end (samples), default min(data.length, from + frameSize·8) */
  to?: number
}

/** One-shot batch profile: average |X|² over a quiet segment. Returns Float64Array(frameSize/2+1). */
export function noiseProfile(data: Float32Array | Float64Array, opts?: NoiseProfileOptions): Float64Array

export interface MinStatsOptions {
  /** window frames, default 96 (1.1 s at hop 512, 44.1 kHz) */
  D?: number
  /** PSD smoothing, default 0.7 */
  alpha?: number
  /** bias compensation, default B_min(D, alpha) (Martin 2001 eq. 17): 3.44 for the defaults; a full window's mean caps the estimate */
  bias?: number
}

export interface Estimator {
  /** current noise PSD, Float64Array(half+1) */
  psd: Float64Array
  /** the bias compensation in use */
  bias: number
  /** one STFT magnitude frame; frames of digital silence are skipped */
  update(mag: Float64Array): void
}

/** Minimum Statistics (Martin 2001) — stateful online noise PSD tracker. */
export function minStats(half: number, opts?: MinStatsOptions): Estimator

export interface ImcraOptions {
  /** sample rate: with `hop`, rescales the 8 ms-frame constants of Table I to the actual frame step */
  fs?: number
  /** frame step, samples */
  hop?: number
  /** α_s, smoothing of the local energy, default 0.9 (per 8 ms) */
  alpha?: number
  /** α_d, noise averaging, default 0.85 (per 8 ms) */
  alphaD?: number
  /** bias compensation of the averaged noise, default 1.47 */
  beta?: number
  /** bias of the minimum, default 1.66 */
  bMin?: number
  /** first-iteration threshold on |Y|² over the minimum, default 4.6 */
  gamma0?: number
  /** a priori speech absence threshold, default 3 */
  gamma1?: number
  /** threshold on the local energy over the minimum, default 1.67 */
  zeta0?: number
  /** frequency smoothing half width, bins, default 1 */
  w?: number
  /** subwindows of the minimum search, default 8 */
  U?: number
  /** frames per subwindow, default 15 at 8 ms (≈0.12 s at any step) */
  V?: number
  /** decision-directed weight of the a priori SNR, default 0.92 */
  alphaDD?: number
  /** a priori SNR floor, linear, default 10^-2.5 (−25 dB) */
  xiMin?: number
}

export interface ImcraEstimator {
  /** noise PSD after this frame's update, Float64Array(half+1) */
  psd: Float64Array
  /** a priori SNR on the updated estimate */
  xi: Float64Array
  /** a priori SNR on the previous estimate (what p used) */
  xi0: Float64Array
  /** a posteriori SNR |Y|²/λ */
  gamma: Float64Array
  /** γξ/(1+ξ) */
  v: Float64Array
  /** LSA gain under speech presence, G_H1 */
  gain: Float64Array
  /** speech presence probability */
  p: Float64Array
  /** frames processed (digital silence not counted) */
  frames: number
  /** `sppOverride` (number or per-bin array) replaces the speech presence probability. */
  update(mag: Float64Array, sppOverride?: number | ArrayLike<number>): ImcraEstimator
}

/** Improved Minima Controlled Recursive Averaging (Cohen 2003) — speech-presence-gated noise PSD tracker. */
export function imcra(half: number, opts?: ImcraOptions): ImcraEstimator

export interface KnownOptions {
  /** decision-directed weight of the a priori SNR, default 0.92 */
  alphaDD?: number
  /** a priori SNR floor, linear, default 10^-2.5 (−25 dB) */
  xiMin?: number
}
/** A known noise PSD (e.g. `noiseProfile` of a noise-only stretch), held: imcra's per-frame SNR outputs on it, `p` 0. */
export function known(profile: ArrayLike<number>, opts?: KnownOptions): ImcraEstimator
