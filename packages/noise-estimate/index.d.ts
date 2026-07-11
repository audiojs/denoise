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
  /** window frames, default 96 (≈1.5s @ hop=N/4, 44.1k, N=2048) */
  D?: number
  /** PSD smoothing, default 0.7 */
  alpha?: number
  /** bias compensation, default 1.5 */
  bias?: number
}

export interface Estimator {
  /** current noise PSD, Float64Array(half+1) */
  psd: Float64Array
  update(mag: Float64Array): void
}

/** Minimum Statistics (Martin 2001) — stateful online noise PSD tracker. */
export function minStats(half: number, opts?: MinStatsOptions): Estimator

export interface ImcraOptions {
  /** default 0.92 */
  alpha?: number
  /** default 0.85 */
  alphaD?: number
  /** default 1.47 */
  beta?: number
  /** frames between minimum-tracker resets, default 80 */
  resetEvery?: number
}

export interface ImcraEstimator {
  /** current noise PSD, Float64Array(half+1) */
  psd: Float64Array
  /** `sppOverride` bypasses the internal speech-presence estimate. */
  update(mag: Float64Array, sppOverride?: number): void
}

/** Improved Minima Controlled Recursive Averaging (Cohen 2003) — speech-presence-gated noise PSD tracker. */
export function imcra(half: number, opts?: ImcraOptions): ImcraEstimator
