/** Content-aware auto-selector — classifies the dominant noise type and dispatches to the matching method. */
export type DenoiseMethod = 'dehum' | 'declick' | 'dewind' | 'deesser' | 'dereverb' | 'omlsa' | 'wiener'

export interface ClassifyScores {
  /** hit count (0-3) of mains harmonics with ≥50× line/off-line ratio */
  hum: number
  /** 50 or 60 */
  humFreq: number
  /** peak excess kurtosis of AR residual across scanned windows */
  click: number
  /** low/mid band power ratio */
  lf: number
  /** high/mid (sibilance) band power ratio */
  hi: number
  /** CV of the frame-energy floor — low = stationary noise bed */
  stationarity: number
}

export interface Plan {
  method: DenoiseMethod
  /** empty when `force` skipped classification */
  scores: ClassifyScores | Record<string, never>
  /** present only when classification ran */
  humFreq?: number
}

export interface DenoiseOptions {
  /** sample rate (Hz), default 44100 */
  fs?: number
  /** skip classification, force a method */
  force?: DenoiseMethod
  /** return { out, plan } instead of just the cleaned buffer */
  returnPlan?: boolean
  /** additional per-method params, passed through to the dispatched method */
  [param: string]: unknown
}

export interface DenoiseResult {
  out: Float32Array
  plan: Plan
}

/** Classify the dominant noise type and clean it with the matching method. */
export default function denoise(data: Float32Array, params?: DenoiseOptions & { returnPlan?: false }): Float32Array
export default function denoise(data: Float32Array, params: DenoiseOptions & { returnPlan: true }): DenoiseResult

/** Run the classification sweep only (no cleaning). */
export function classify(data: Float32Array, fs?: number): Plan

export interface DeesserOptions {
  /** sample rate (Hz), default 44100 */
  fs?: number
  /** center frequency (Hz), default 6000 */
  freq?: number
  /** notch Q, default 1.4 */
  Q?: number
  /** dB, default -30 */
  threshold?: number
  /** default 4 */
  ratio?: number
  /** seconds, default 0.001 */
  attack?: number
  /** seconds, default 0.05 */
  release?: number
  block?: number
}

/** De-esser adapter over @audio/dynamics-deesser (band mode). Processes in place; returns the same buffer. */
export function deesser(data: Float32Array, params?: DeesserOptions): Float32Array
