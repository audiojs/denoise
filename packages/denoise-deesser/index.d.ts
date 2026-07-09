/** Dynamic peaking-EQ de-esser on a HP sidechain. */
export interface DeesserOptions {
  /** sibilance centre (Hz), default 6000 */
  freq?: number
  /** engagement level (dBFS), default -30 */
  threshold?: number
  /** compression ratio, default 4 */
  ratio?: number
  /** cut engage time (s), default 0.001 */
  attack?: number
  /** cut recovery time (s), default 0.05 */
  release?: number
  /** peaking EQ Q, default 1.4 */
  Q?: number
  /** coefficient update interval (samples), default 64 */
  block?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process in place; returns the same buffer. Pass the same options object across calls to persist state. */
export default function deesser(data: Float32Array, options?: DeesserOptions): Float32Array
