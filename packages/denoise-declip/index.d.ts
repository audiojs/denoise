/** Clipping undone: each side's rail found (flat, or spread into a band by lossy coding), or soft saturation's curve fitted blind; every clipped sample rebuilt by an AR (Janssen) and two sparse (A-SPADE, 93 and 186 ms) consistent rebuilds, blended by weights cross-validated per region. */
export interface DeclipOptions {
  /** sample rate, Hz; default 44100 */
  fs?: number
  /** a symmetric rail, ± this; omitted or 0: each side's rail (or band, or saturation curve) found from the sound (none: returned untouched) */
  clipLevel?: number
  /** AR order of the AR rebuild; default 256 */
  order?: number
}

/** Each side's rail, or null: the sound's extreme on that side, when the samples at it are a point mass in runs. */
export function rails(data: Float32Array | Float64Array): { hi: number | null, lo: number | null }

/** Each side's band, or null: a rail lossy coding spread, its mode `r` and spread `s` (the RMS of the samples over it). */
export function bands(data: Float32Array | Float64Array): { hi: { r: number, s: number } | null, lo: { r: number, s: number } | null }

/** A memoryless saturation fitted by maximum likelihood under a local AR prior, or null: its curve, knee `k`, each side's ceiling (`lo` negative), and the nats a sample it gains over the sound as it is. */
export function saturation(data: Float32Array | Float64Array, fs?: number): { curve: 'tanh' | 'alg', k: number, hi: number, lo: number, gain: number } | null

/** The curves `saturation` fits, each of unit slope at 0: writes the inverse at x into o[0] and the log of its slope into o[1]. */
export const CURVES: Record<'tanh' | 'alg', (x: number, c: number, k: number, o: Float64Array) => Float64Array>

/** Returns a repaired copy. */
export default function declip(data: Float32Array, options?: DeclipOptions): Float32Array
