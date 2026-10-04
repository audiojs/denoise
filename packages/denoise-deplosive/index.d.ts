/** Plosive (p/b thump) LF ducking: a sudden, aperiodic LF burst over the high band; untouched otherwise. */
export interface DeplosiveOptions {
  /** LF over high-band envelope a pop must exceed, default 4 */
  triggerRatio?: number
  /** LF cut when triggered (dB), default -18 */
  attenuation?: number
  /** LF/high split (Hz), default 200 */
  crossover?: number
  /** duck attack (s), default 0.002 */
  attack?: number
  /** duck release (s), default 0.03 */
  release?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process in place; returns the same buffer. Pass the same options object across calls to persist state. */
export default function deplosive(data: Float32Array, options?: DeplosiveOptions): Float32Array
