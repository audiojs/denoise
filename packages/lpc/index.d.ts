/** Linear predictive coding — autoregressive modelling, prediction, extrapolation, gap fill. */

/** Biased autocorrelation R[0..p]. */
export function autocorr(x: Float32Array | Float64Array, p: number): Float64Array

export interface ArModel {
  /** AR(p) coefficients, a[0] === 1 */
  a: Float64Array
  /** residual variance */
  e: number
}

/** Levinson-Durbin: solve the Toeplitz Yule-Walker equations for AR(p) coefficients. */
export function levinson(R: Float64Array, p: number): ArModel

/** LPC analysis of order `p` over window `x`. `levinson(autocorr(x, p), p)`. */
export function arFit(x: Float32Array | Float64Array, p: number): ArModel

/** Conventional alias for `arFit`. */
export const lpc: typeof arFit

/** One-step AR(p) prediction from a history buffer: x̂[n] = -∑ a[k]·x[n-k]. */
export function arPredict(a: Float64Array, hist: Float32Array | Float64Array): number

/** Project `m` samples forward from `context` under model `a` (de-clip projection). */
export function arExtrapolate(context: Float32Array | Float64Array, a: Float64Array, m: number): Float64Array

/** Least-squares fill of missing indices `gap` (sorted) inside `x`, in place, under model `a`. Returns `x`. */
export function arInterpolate<T extends Float32Array | Float64Array>(x: T, gap: number[], a: Float64Array): T
