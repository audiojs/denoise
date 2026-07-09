/** Dense-crackle repair via MAD-thresholded AR residual. */
export interface DecrackleOptions {
  /** AR model order, default 50 */
  order?: number
  /** analysis window (samples), default 2048 */
  windowSize?: number
  /** window hop (samples), default 1024 */
  hopSize?: number
  /** MAD multiple, default 2.5 */
  threshold?: number
  /** samples widened around each event, default 1 */
  guard?: number
  /** longest repaired run (samples), default 12 */
  maxBurst?: number
}

/** Process in place; returns the same buffer. Pass the same options object across calls to persist state. */
export default function decrackle(data: Float32Array, options?: DecrackleOptions): Float32Array
