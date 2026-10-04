/** Voice Activity Detection + Speech Presence Probability. */

export interface VadOptions {
  /** STFT frame, default the power of two over 3 periods of 75 Hz (2048 at 44.1 and 48 kHz) */
  frameSize?: number
  /** hop between frames, default frameSize/4 */
  hopSize?: number
  /** sample rate, default 44100 */
  fs?: number
}

export interface VadResult {
  /** 1 where speech is: voicing, and the sound over the noise floor next to it, per frame */
  active: Uint8Array
  /** 1 where the frame is voiced, per frame */
  voiced: Uint8Array
  /** frame-start time (s), per frame */
  times: Float32Array
  hop: number
  frameSize: number
}

/** Frame-level speech decision: Sohn's likelihood ratio over a minimum-statistics noise floor, anchored on voicing. */
export function vad(data: Float32Array | Float64Array, opts?: VadOptions): VadResult

export interface SppOptions {
  /** a-priori SNR floor, default 0.0316 (-15 dB) */
  xiMin?: number
}

/** Per-bin speech-presence probability from a-priori SNR: p = ξ/(1+ξ). */
export function spp(mag: Float64Array, noisePsd: Float64Array, opts?: SppOptions): Float64Array

/** Decision-directed a-priori SNR (Ephraim-Malah 1984), recursively smoothed by `alpha` (default 0.98). */
export function ddSnr(mag: Float64Array, noisePsd: Float64Array, prevGain: Float64Array, prevMag: Float64Array, alpha?: number): Float64Array
