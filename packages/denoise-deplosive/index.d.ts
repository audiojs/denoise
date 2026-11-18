/** Plosive (p/b thump) removal: a sudden, aperiodic burst under `crossover`, taken away by a linear-phase low band;
 *  untouched otherwise. */
export interface DeplosiveOptions {
  /** LF (under 80 Hz) over the voice band (over 120 Hz) a pop must exceed, default 1; live */
  triggerRatio?: number
  /** how far the band under `crossover` goes down in a pop (dB), default -40; live */
  attenuation?: number
  /** the band a pop is taken from (Hz), default 120; live */
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

/** The stream's memory, made once, in typed arrays (`block` allocates nothing): `L` its delay in samples, `v` what a
 *  block reads, [triggerRatio, depth = 1 − 10^(attenuation/20), attack's and release's one-pole coefficients], set by the
 *  caller; the rest is the stream's own. */
export interface DeplosiveState { fs: number; L: number; v: Float64Array }
export function state(fs: number, crossover?: number): DeplosiveState
/** The low band's edge (Hz): its taps redesigned in place when it changes, their count (so the latency) kept. */
export function tune(state: DeplosiveState, crossover: number): void
/** One block: `x` through the stream into `y` (they may be the same memory), `latency(fs)` late; allocates nothing. */
export function block(state: DeplosiveState, x: ArrayLike<number>, y: Float32Array | Float64Array): void
