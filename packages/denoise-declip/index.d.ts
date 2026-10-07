/** Hard clipping undone: each side's rail found (flat, or spread into a band by lossy coding), every clipped sample rebuilt by an AR (Janssen) and two sparse (A-SPADE, 93 and 186 ms) consistent rebuilds, blended by weights cross-validated per region. */
export interface DeclipOptions {
  /** sample rate, Hz; default 44100 */
  fs?: number
  /** a symmetric rail, ± this; omitted or 0: each side's rail found from the sound (none: returned untouched) */
  clipLevel?: number
  /** AR order of the AR rebuild; default 256 */
  order?: number
}

/** Each side's rail, or null: the sound's extreme on that side, when the samples at it are a point mass in runs. */
export function rails(data: Float32Array | Float64Array): { hi: number | null, lo: number | null }

/** Each side's band, or null: a rail lossy coding spread, its mode `r` and spread `s` (the RMS of the samples over it). */
export function bands(data: Float32Array | Float64Array): { hi: { r: number, s: number } | null, lo: { r: number, s: number } | null }

/** Returns a repaired copy. */
export default function declip(data: Float32Array, options?: DeclipOptions): Float32Array
