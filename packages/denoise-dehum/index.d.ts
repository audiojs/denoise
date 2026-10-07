/** Mains hum and buzz removal: the mains phase tracked, each harmonic estimated along it as a slowly varying sinusoid and subtracted; no hum, no change. */
export interface DehumOptions {
  /** fundamental (Hz); omitted or 0: the 50 or 60 Hz series, whichever is found. Given: that series, its exact frequency tracked */
  freq?: number
  /** remove h = 1..harmonics as told; omitted or 0: every harmonic to 1 kHz and each line above it that stands out, to 8 kHz */
  harmonics?: number
  /** with `freq`: measure its exact frequency within ±drift Hz instead of ±0.4 %, default false */
  adaptive?: boolean
  /** search range for `adaptive` (Hz), default 0.5 */
  drift?: number
  /** the hum held through the take (a buzz under an instrument, no edit): each line one phasor, the mains phase refined against them; default false */
  steady?: boolean
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
