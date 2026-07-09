/** Mains hum removal via cascaded high-Q notches. */
export interface DehumOptions {
  /** fundamental (Hz), default 50 */
  freq?: number
  /** number of notches, default 4 */
  harmonics?: number
  /** notch sharpness, default 30 */
  Q?: number
  /** Goertzel tracking of mains drift, default false */
  adaptive?: boolean
  /** tracking range (Hz), default 0.5 */
  drift?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process in place; returns the same buffer. Pass the same options object across calls to persist state. */
export default function dehum(data: Float32Array, options?: DehumOptions): Float32Array
