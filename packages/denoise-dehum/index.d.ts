/** Mains hum removal: notches at the harmonics of the measured mains frequency that stand out; no hum, no change. */
export interface DehumOptions {
  /** fundamental (Hz); omitted or 0: measured, the 50 or 60 Hz series. Given: its exact frequency measured within ±0.4 % */
  freq?: number
  /** notch h = 1..harmonics whatever is there; omitted or 0: the harmonics up to 1 kHz that stand out */
  harmonics?: number
  /** notch sharpness, default 30 */
  Q?: number
  /** with `freq`: measure its exact frequency within ±drift Hz instead of ±0.4 %, default false */
  adaptive?: boolean
  /** search range for `adaptive` (Hz), default 0.5 */
  drift?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Mains hum found in a signal: its fundamental (Hz) and the harmonics that stand out. */
export interface Hum {
  f0: number
  harmonics: number[]
}

/** Process in place; returns the same buffer. The first call measures the hum (needs ≥ 1 s of signal); pass the same options object across calls to keep the plan and filter state. */
export default function dehum(data: Float32Array, options?: DehumOptions): Float32Array
/** Measure mains hum near the candidate fundamentals (default 50 and 60 Hz); null when there is none or the signal is under 1 s. */
export function measure(data: Float32Array | Float64Array, fs: number, candidates?: number[], tol?: number): Hum | null
