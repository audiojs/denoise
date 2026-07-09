/** AR-residual click detection + AR-LS interpolation. */
export interface DeclickOptions {
  /** AR model order, default 60 */
  order?: number
  /** analysis window (samples), default 1024 */
  windowSize?: number
  /** window hop (samples), default 512 */
  hopSize?: number
  /** residual sigma-multiple, default 4 */
  threshold?: number
  /** samples widened around each click, default 2 */
  guard?: number
  /** longest repaired run (samples), default 64 */
  maxBurst?: number
}

/** Process in place; returns the same buffer. Pass the same options object across calls to persist state. */
export default function declick(data: Float32Array, options?: DeclickOptions): Float32Array
