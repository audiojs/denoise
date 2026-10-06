/** De-bleed: the bleed of a source whose own track you have (`ref`: a click track, a guitar amp's mic, the co-host's
 *  mic) taken out of a microphone that heard it: a Kalman filter cancels it through the room path it learns, a Wiener
 *  gain takes the residual it predicts. With no reference energy the sound passes untouched. */
export interface DebleedOptions {
  /** the most the residual is turned down (dB, ≤ 0), default -20; 0 cancels only; read every block, so it can change
   *  while streaming */
  attenuation?: number
  /** seconds of room path the filter learns (the delay and the early room), default 0.3; the tail past it is
   *  suppressed as a decay */
  span?: number
  /** sample rate, default 44100 */
  fs?: number
  /** the filter's block, default `block(fs)`: the power of two nearest 10.7 ms */
  blockSize?: number
}

/** A reference: one channel, or several (a stereo source) heard together. */
export type DebleedReference = Float32Array | Float64Array | (Float32Array | Float64Array)[]

/** Batch: takes the bleed of `ref` out of `data` in place and returns the same buffer. Two passes: the path learned
 *  over the whole take, then the removal from where it ended. */
export default function debleed<T extends Float32Array | Float64Array>(data: T, ref: DebleedReference, options?: DebleedOptions): T
/** Stream: write(chunk, refChunk) returns the samples done so far (up to 2·blockSize − 1 behind the input), write()
 *  returns the rest. It cancels a band only once the evidence proves the path there, and passes it
 *  untouched until then: it takes less than the batch call (most of all of a talker under a louder voice), and a source
 *  that never reached the mic leaves the sound as it was. */
export default function debleed(options?: DebleedOptions): (chunk?: Float32Array, ref?: DebleedReference | null) => Float32Array

/** The filter's block at a rate: the power of two nearest 10.7 ms (512 at 44.1 and 48 kHz). */
export function block(fs: number): number
