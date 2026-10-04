/** Mains hum removal: the harmonics of the measured mains frequency, each estimated as a slowly varying sinusoid and subtracted; no hum, no change. */
export interface DehumOptions {
  /** fundamental (Hz); omitted or 0: measured, the 50 or 60 Hz series. Given: its exact frequency measured within ±0.4 % */
  freq?: number
  /** remove h = 1..harmonics; omitted or 0: every harmonic up to 1 kHz */
  harmonics?: number
  /** with `freq`: measure its exact frequency within ±drift Hz instead of ±0.4 %, default false */
  adaptive?: boolean
  /** search range for `adaptive` (Hz), default 0.5 */
  drift?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Mains hum found in a signal: its fundamental (Hz) and the harmonics whose lines stand out. */
export interface Hum {
  f0: number
  harmonics: number[]
}

/** Process the whole signal in place; returns the same buffer. Measuring needs ≥ 1 s: shorter, it passes through unless `freq` is given. */
export default function dehum<T extends Float32Array | Float64Array>(data: T, options?: DehumOptions): T
/** Measure mains hum near the candidate fundamentals (default 50 and 60 Hz); null when there is none or the signal is under 1 s. */
export function measure(data: Float32Array | Float64Array, fs: number, candidates?: number[], tol?: number): Hum | null
