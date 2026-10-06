/** Plosive (p/b thump) removal: a sudden, aperiodic burst under `crossover`, taken away by a linear-phase low band;
 *  untouched otherwise. */
export interface DeplosiveOptions {
  /** LF (under 80 Hz) over the voice band (over 120 Hz) a pop must exceed, default 1; live */
  triggerRatio?: number
  /** how far the band under `crossover` goes down in a pop (dB), default -40; live */
  attenuation?: number
  /** the band a pop is taken from (Hz), default 120 */
  crossover?: number
  /** duck attack (s), default 0.0005; live */
  attack?: number
  /** duck release (s), default 0.03; live */
  release?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Batch: the pops out of `data` in place, aligned; returns the same buffer. */
export default function deplosive<T extends Float32Array | Float64Array>(data: T, options?: DeplosiveOptions): T
/** Stream: write(chunk) returns as many samples, `latency(fs)` behind the input; write() returns the last `latency(fs)`. */
export default function deplosive(options?: DeplosiveOptions): (chunk?: Float32Array) => Float32Array

/** The same stream as an object: `write` and `flush` as above, `latency` its delay in samples. */
export function stream(options?: DeplosiveOptions): { latency: number, write(chunk: ArrayLike<number>): Float32Array, flush(): Float32Array }

/** The output's delay at a rate, samples (~14 ms): the linear-phase low band's look-ahead. */
export function latency(fs: number): number
