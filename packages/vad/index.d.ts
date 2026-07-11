/** Voice Activity Detection + Speech Presence Probability. */

export interface VadOptions {
  /** STFT frame, default 1024 */
  frameSize?: number
  /** OLA hop, default frameSize/2 */
  hopSize?: number
  /** sample rate, default 44100 */
  fs?: number
  /** dB above floor to count as active, default 6 */
  snrTh?: number
  /** spectral-flatness ceiling for "tonal", default 0.4 */
  flatTh?: number
  /** frames in the min-tracker window, default 64 */
  window?: number
  /** dB added to the percentile floor, default 5 */
  bias?: number
}

export interface VadResult {
  /** 1 where speech is present, per frame */
  active: Uint8Array
  /** frame-start time (s), per frame */
  times: Float32Array
  hop: number
  frameSize: number
}

/** Frame-level speech/non-speech decision from energy + spectral flatness. */
export function vad(data: Float32Array | Float64Array, opts?: VadOptions): VadResult

export interface SppOptions {
  /** a-priori SNR floor, default 0.0316 (-15 dB) */
  xiMin?: number
}

/** Per-bin speech-presence probability from a-priori SNR: p = ξ/(1+ξ). */
export function spp(mag: Float64Array, noisePsd: Float64Array, opts?: SppOptions): Float64Array

/** Decision-directed a-priori SNR (Ephraim-Malah 1984), recursively smoothed by `alpha` (default 0.98). */
export function ddSnr(mag: Float64Array, noisePsd: Float64Array, prevGain: Float64Array, prevMag: Float64Array, alpha?: number): Float64Array
