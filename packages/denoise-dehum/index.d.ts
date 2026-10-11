/** Mains hum, buzz and steady tone removal: the mains phase tracked, each harmonic estimated along it as a slowly varying sinusoid and subtracted, then each steady tone off the series (a whine, a test tone) found and subtracted alike; nothing found, no change. */
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
  /** steady tones off the mains series: true (default) those tones() finds; an array: those frequencies (Hz), as told; false: none (0.6) */
  tones?: boolean | number[]
  /** sample rate, default 44100 */
  fs?: number
}

/** Mains hum found in a signal: its fundamental (Hz) and the harmonics whose lines stand out. */
export interface Hum {
  f0: number
  harmonics: number[]
}

/** A steady tone found in a signal: held through the program's pauses and under it, its phase turning as one line's. */
export interface Tone {
  /** Hz */
  freq: number
  /** its power in the program's pauses, dB re the signal's */
  level: number
  /** share of the pauses holding it (6 dB over its bins' floor) */
  held: number
  /** share of all frames whose bins hold a quarter of its power in the pauses */
  kept: number
  /** its level's spread over the pauses, 90th over 10th percentile, dB */
  am: number
  /** mean resultant length of its phasor's turns between consecutive pauses (1: one line) */
  coherence: number
  /** the turns' spread as a frequency, cents */
  cents: number
}

/** Process the whole signal in place; returns the same buffer. Measuring needs ≥ 1 s: shorter, it passes through unless `freq` is given. */
export default function dehum<T extends Float32Array | Float64Array>(data: T, options?: DehumOptions): T
/** Measure mains hum near the candidate fundamentals (default 50 and 60 Hz); null when there is none or the signal is under 1 s. */
export function measure(data: Float32Array | Float64Array, fs: number, candidates?: number[], tol?: number): Hum | null
/** Steady tones in a signal (a whine, a test tone), the harmonics of a mains series at `hum` Hz left out; [] when there are none, the program never pauses, the lines found are off one harmonic series (a held chord), or the signal is under 1 s. */
export function tones(data: Float32Array | Float64Array, fs: number, hum?: number): Tone[]
