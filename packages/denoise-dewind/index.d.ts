/** Spectral de-wind: under `cutoff`, each STFT bin weighed against a wind spectrum read from the frame (the floor
 *  between the harmonics), while aperiodic low end outweighs the mid band; the sound passes untouched otherwise. */
export interface DewindOptions {
  /** top of the band wind is taken from (Hz), default 1500; read every frame, so it can change while streaming */
  cutoff?: number
  /** the most a bin is turned down (dB, ≤ 0), default -20; 0 takes nothing; read every frame */
  attenuation?: number
  /** sample rate, default 44100 */
  fs?: number
  /** STFT frame, default `frame(fs)`: the power of two nearest 85 ms */
  frameSize?: number
  /** OLA hop, default frameSize/4 */
  hopSize?: number
}

/** Batch: takes the wind out of `data` in place and returns the same buffer. */
export default function dewind<T extends Float32Array | Float64Array>(data: T, options?: DewindOptions): T
/** Stream: write(chunk) returns the samples done so far, frameSize − 1 behind the input; write() returns the rest. */
export default function dewind(options?: DewindOptions): (chunk?: Float32Array) => Float32Array

/** The STFT frame at a rate: the power of two nearest 85 ms (4096 at 44.1 and 48 kHz). */
export function frame(fs: number): number

/** The part taken away, as a frame process for a host running @audio/stft's framing: (mag, phase) → { mag, phase };
 *  the output is the input less its overlap-add. One per channel. */
export function processor(options?: DewindOptions): (mag: Float64Array, phase: Float64Array) => { mag: Float64Array, phase: Float64Array }
