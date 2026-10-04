/** Adaptive high-pass that comes in while wind (aperiodic low end) blows; the sound passes untouched otherwise. */
export interface DewindOptions {
  /** cutoff in light wind (Hz), default 60 */
  cutoffMin?: number
  /** cutoff in strong wind (Hz), default 250 */
  cutoffMax?: number
  /** Butterworth sections (12 dB/oct each), default 2 */
  order?: number
  /** time to come in (s), default 0.05 */
  attack?: number
  /** time to go back out after the wind (s), default 0.4 */
  release?: number
  /** re-estimation interval (samples), default 5 ms */
  blockSize?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process in place; returns the same buffer. Pass the same options object across calls to persist state. */
export default function dewind(data: Float32Array, options?: DewindOptions): Float32Array
