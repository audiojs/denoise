/** Dense crackle: impulses that stand out of the AR prediction error and of the two-sided interpolation error, rebuilt a window at a time by exact least-squares AR interpolation, searched again on the rebuilt sound until none is new; an event the sound's own excitation explains as well is left as recorded. */
export interface DecrackleOptions {
  /** sample rate, Hz; default 44100 */
  fs?: number
  /** how far over each error's local scale an impulse stands, multiples; default 4 */
  threshold?: number
  /** AR order of the detection; default 32 */
  order?: number
}

/** Returns a repaired copy. */
export default function decrackle(data: Float32Array, options?: DecrackleOptions): Float32Array
