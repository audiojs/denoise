/** Clicks found as outliers of the AR prediction error, each rebuilt by least-squares AR interpolation. */
export interface DeclickOptions {
  /** sample rate, Hz; default 44100 */
  fs?: number
  /** how far over the prediction error's local scale a click stands, multiples; default 8 */
  threshold?: number
  /** longest click rebuilt, ms (longer is taken for real sound); default 6 */
  longest?: number
  /** AR order of the detection; default 32 */
  order?: number
  /** where the clicks are, seconds: they are looked for only there, none there taken for a pulse or too long */
  regions?: { at: number, duration: number }[]
}

/** Returns a repaired copy. */
export default function declick(data: Float32Array, options?: DeclickOptions): Float32Array
