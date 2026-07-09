/** Adaptive high-pass for wind buffeting / handling thumps. */
export interface DewindOptions {
  /** minimum cutoff (Hz), default 60 */
  cutoffMin?: number
  /** maximum cutoff (Hz), default 250 */
  cutoffMax?: number
  /** HP sections (12 dB/oct each), default 2 */
  order?: number
  /** section Q, default 0.707 */
  Q?: number
  /** cutoff opening time (s), default 0.05 */
  attack?: number
  /** cutoff closing time (s), default 0.4 */
  release?: number
  /** coefficient update interval (samples), default 1024 */
  blockSize?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process in place; returns the same buffer. Pass the same options object across calls to persist state. */
export default function dewind(data: Float32Array, options?: DewindOptions): Float32Array
