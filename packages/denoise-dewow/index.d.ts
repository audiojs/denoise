/** Wow & flutter correction — pitch-drift removal for tape/vinyl/cassette transfers. */
export interface DewowOptions {
  /** sample rate, default 44100 */
  fs?: number
  /** speed-curve estimator, default 'partial' */
  mode?: 'partial' | 'reference' | 'pitch'
  /** known tone/hum frequency (Hz) — required for mode 'reference' */
  refFreq?: number
  /** STFT frame, default 4096 */
  frameSize?: number
  /** STFT hop, default 512 */
  hopSize?: number
  /** zero-phase smoothing time constant (s) separating wow from flutter, default 0.05 */
  smooth?: number
  /** correct the <~6 Hz (low-passed) component, default true */
  wow?: boolean
  /** correct the residual (post low-pass) component, default true */
  flutter?: boolean
  /** clamp the corrected speed ratio to [1-x, 1+x], default 0.05 */
  maxDeviation?: number
  /** shortest partial kept, in seconds — mode 'partial' only, default 0.5 */
  minTrack?: number
  /** lowest f0 considered — mode 'pitch' only, default 50 */
  minFreq?: number
  /** highest f0 considered — mode 'pitch' only, default 2000 */
  maxFreq?: number
  /** output length equals input length, default true */
  keepLength?: boolean
}

/** One accepted partial track — mode 'partial' only. */
export interface DewowTrack {
  /** start frame index */
  start: number
  /** end frame index (inclusive) */
  end: number
  /** median frequency (Hz) over the track's span */
  freq: number
  /** track length, in frames */
  length: number
}

export interface DewowAnalysis {
  /** per-hop speed ratio, 1.0 = nominal (gap-filled, zero-phase smoothed) */
  speed: Float32Array
  /** per-hop timestamps (s) */
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
  /** fraction of hops with a usable speed estimate, 0..1 */
  confidence: number
  /** accepted partial tracks — mode 'partial' only */
  tracks?: DewowTrack[]
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
