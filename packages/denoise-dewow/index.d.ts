/** Wow & flutter correction — pitch-drift removal for tape/vinyl/cassette transfers. */
export interface DewowOptions {
  /** sample rate, default 44100 */
  fs?: number
  /** speed-curve estimator, default 'partial' */
  mode?: 'partial' | 'reference' | 'pitch'
  /** known tone/hum frequency (Hz) for mode 'reference'; omitted or 0: one is looked for (a pilot above 5 kHz, else 50/60 Hz hum) */
  refFreq?: number
  /** STFT frame, default ≈ 0.19 s (8192 at 44.1–48 kHz) — mode 'partial' reads each partial's frequency over it (wow, not flutter) */
  frameSize?: number
  /** STFT hop, default frameSize/16 */
  hopSize?: number
  /** zero-phase smoothing time constant (s) separating wow from flutter, default 0.05 */
  smooth?: number
  /** correct the <~6 Hz (low-passed) component, default true */
  wow?: boolean
  /** correct the residual (post low-pass) component, default true */
  flutter?: boolean
  /** clamp the corrected speed ratio to [1-x, 1+x], default 0.05 */
  maxDeviation?: number
  /** shortest steady piece of a partial kept, in seconds — mode 'partial' only, default 0.2 */
  minTrack?: number
  /** lowest frequency searched (Hz): partials in mode 'partial', f0 in mode 'pitch', default 50 */
  minFreq?: number
  /** highest frequency searched (Hz): partials in mode 'partial', f0 in mode 'pitch', default 2000 */
  maxFreq?: number
  /** output length equals input length, default true */
  keepLength?: boolean
}

/** One steady piece of a partial — mode 'partial' only. */
export interface DewowTrack {
  /** start frame index */
  start: number
  /** end frame index (inclusive) */
  end: number
  /** median frequency (Hz) over the piece */
  freq: number
  /** piece length, in frames */
  length: number
}

/** A disc's wow found and applied: a sinusoid at a turntable's rotation rate (or its 2nd, 3rd harmonic) — mode 'partial' only. */
export interface DewowLine {
  /** the window it was fitted over, s */
  start: number
  end: number
  /** its frequency, Hz */
  freq: number
  /** the same, in turns per minute (33⅓, 45, 78, 16⅔ or a harmonic, within 4 %) */
  rpm: number
  /** its peak speed deviation, % */
  depth: number
}

export interface DewowAnalysis {
  /** per-hop speed ratio, 1.0 = nominal; returns to 1 where nothing is evidence */
  speed: Float32Array
  /** per-hop timestamps (s), each at its analysis frame's centre */
  times: Float32Array
  /** STFT hop size used */
  hop: number
  /** sample rate used */
  fs: number
  /** unweighted RMS wow deviation, % (see README — not IEC 60386/DIN 45507 weighted) */
  wow: number
  /** unweighted RMS flutter deviation, % */
  flutter: number
  /** unweighted peak wow deviation, % */
  wowPeak: number
  /** unweighted peak flutter deviation, % */
  flutterPeak: number
  /** fraction of hops the curve stands on (a window with a disc's line found, the reference tone read, voiced pitch), 0..1 */
  confidence: number
  /** the steady pieces of partials tracked — mode 'partial' only */
  tracks?: DewowTrack[]
  /** the disc's lines applied — mode 'partial' only */
  lines?: DewowLine[]
  /** the tone read (Hz): mode 'reference', or a pilot mode 'partial' found; null where none was found */
  reference?: number | null
}

/**
 * Recovers the speed curve without correcting the audio — the "wow & flutter
 * meter". `data` is a mono Float32Array or an array of channels (mixed to mono
 * for analysis).
 */
export function analyze(data: Float32Array | Float32Array[], options?: DewowOptions): DewowAnalysis

/**
 * Corrects wow & flutter by variable-rate resampling against the estimated speed
 * curve. `data` is a mono Float32Array or an array of channels (one shared curve
 * from the mono mix, applied per channel so multi-channel stays sample-aligned).
 * Returns the same shape as `data` — new arrays.
 */
export default function dewow(data: Float32Array, options?: DewowOptions): Float32Array
export default function dewow(data: Float32Array[], options?: DewowOptions): Float32Array[]
