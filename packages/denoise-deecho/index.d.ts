/** One echo: a copy of the sound `delay` s later at `gain` of it, each further copy `feedback` of the one before (0: one copy). */
export interface Echo {
  /** seconds */
  delay: number
  /** the first copy's gain to the sound; negative for an inverted copy */
  gain: number
  /** each further copy's gain to the one before; 0 for one copy */
  feedback: number
}

export interface DeechoOptions {
  /** sample rate, default 44100 */
  fs?: number
  /** the echo's delay, s: its gain and feedback are measured there, unless `gain` is given too */
  delay?: number
  /** the first copy's gain to the sound: with `delay`, nothing is measured; alone, the delay is found */
  gain?: number
  /** with `gain`: each further copy's gain to the one before, default 0 (one copy) */
  feedback?: number
  /** the echoes, as `estimate` gives them: nothing is measured */
  echoes?: Echo[]
  /** the shortest delay searched, s, default 0.001 */
  min?: number
  /** the longest delay searched, s, default 1 (and a quarter of the take at most) */
  max?: number
  /** the most echoes found, default 3 */
  taps?: number
}

/**
 * The take with its echoes undone (found by its cepstrum, or as given), each echo's own delay lines run on what comes
 * out and taken off it; a take with no echo found comes back sample for sample. Returns a new Float32Array of the same
 * length.
 */
declare function deecho(data: ArrayLike<number>, options?: DeechoOptions): Float32Array
/** The stream form, its echoes given: write(chunk) returns the chunk undone (nothing is held back); write() returns nothing. */
declare function deecho(options: DeechoOptions): (chunk?: ArrayLike<number>) => Float32Array
export default deecho

/** The echoes in a take, strongest first; [] for none. With `delay` and `gain` given, those. */
export function estimate(data: ArrayLike<number>, options?: DeechoOptions): Echo[]
