/** Guitar de-noise: a guitar's string squeaks taken down (on by default), a pick's harsh attack softened and the amp's
 *  hiss, hum and buzz taken down (each on when given a level). Where a part finds nothing, the take is left sample for
 *  sample (the amp part, once on, reworks the whole take). */
export interface DesqueakOptions {
  /** the most a squeak goes down (dB, ≤ 0), default -30; 0 leaves squeaks */
  squeak?: number
  /** the most a pick's attack goes down (dB, ≤ 0), default 0: off; -9 restores attacks made 6–12 dB harsher */
  pick?: number
  /** the pick's attack taken down, from 2 ms before its click (s), default 0.01 */
  attack?: number
  /** how far the amp's hiss, hum and buzz go down (dB, ≤ 0), default 0: off; -20 typical */
  amp?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process the whole take in place; returns the same buffer. */
export default function desqueak<T extends Float32Array | Float64Array>(data: T, options?: DesqueakOptions): T

/** The squeak part's analysis frame at a rate: the power of two nearest 23 ms (1024 at 44.1 and 48 kHz). */
export function frame(fs: number): number
