/** Hard clipping undone: each side's rail found, every clipped sample rebuilt by consistent least-squares AR interpolation. */
export interface DeclipOptions {
  /** sample rate, Hz; default 44100 */
  fs?: number
  /** a symmetric rail, ± this; omitted or 0: each side's rail found from the sound (none: returned untouched) */
  clipLevel?: number
  /** AR order of the rebuild; default 256 */
  order?: number
}

/** Each side's rail, or null: the sound's extreme on that side, when the samples at it are a point mass in runs. */
export function rails(data: Float32Array | Float64Array): { hi: number | null, lo: number | null }

/** Returns a repaired copy. */
export default function declip(data: Float32Array, options?: DeclipOptions): Float32Array
