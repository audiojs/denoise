/** Plosive (p/b thump) LF ducking with exact-complement split. */
export interface DeplosiveOptions {
  /** LF/high ratio that opens the duck, default 4 */
  triggerRatio?: number
  /** LF cut when triggered (dB), default -18 */
  attenuation?: number
  /** LF/high split (Hz), default 200 */
  crossover?: number
  /** duck attack (s), default 0.005 */
  attack?: number
  /** duck release (s), default 0.08 */
  release?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process in place; returns the same buffer. Pass the same options object across calls to persist state. */
export default function deplosive(data: Float32Array, options?: DeplosiveOptions): Float32Array
