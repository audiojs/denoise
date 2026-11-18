/** Spectral de-wind: under `cutoff`, each STFT bin weighed against a wind spectrum read from the frame (the floor
 *  between the harmonics), while aperiodic low end outweighs the mid band; the sound passes untouched otherwise. */
export interface DewindOptions {
  /** top of the band wind is taken from (Hz), default 8000; read every frame, so it can change while streaming */
  cutoff?: number
  /** the most a bin is turned down (dB, ≤ 0), default -20; 0 takes nothing; read every frame */
  attenuation?: number
  /** sample rate, default 44100 */
  fs?: number
  /** the stream form: the longest chunk a write takes without growing the stream's memory, default frameSize */
  maxChunk?: number
  /** STFT frame, default `frame(fs)`: the power of two nearest 85 ms */
  frameSize?: number
  /** OLA hop, default frameSize/4 */
  hopSize?: number
}

/** The stream form's writer: write(chunk) → the samples now final, write() → the rest. write(chunk, out, length) and
 *  write(null, out) put them into `out` from its start, as many as it holds (the rest waits for the next call), and
 *  return how many: with `maxChunk` the longest chunk, nothing is allocated a call. `length`: the samples taken from the
 *  chunk's start. */
export interface Writer {
  (chunk?: Float32Array): Float32Array
  (chunk: Float32Array | null | undefined, out: Float32Array, length?: number): number
}

/** Batch: takes the wind out of `data` in place and returns the same buffer. */
export default function dewind<T extends Float32Array | Float64Array>(data: T, options?: DewindOptions): T
/** Stream: write(chunk) returns the samples done so far, frameSize − 1 behind the input; write() returns the rest. */
export default function dewind(options?: DewindOptions): Writer

/** The STFT frame at a rate: the power of two nearest 85 ms (4096 at 44.1 and 48 kHz). */
export function frame(fs: number): number

/** The part taken away, as a frame process for a host running @audio/stft's framing: (mag, phase) → { mag, phase };
 *  the output is the input less its overlap-add. One per channel. The object returned, and its `mag`, are the process's
 *  own, the same every frame: nothing is allocated a frame. */
export function processor(options?: DewindOptions): (mag: Float64Array, phase: Float64Array) => { mag: Float64Array, phase: Float64Array }
