/** Content-aware auto-selector — finds the defect a recording carries, if any, and dispatches to the matching method. */
export type DenoiseMethod = 'none' | 'dehum' | 'declick' | 'dewind' | 'deesser' | 'dereverb' | 'omlsa' | 'wiener'

export interface ClassifyScores {
  /** mains harmonics dehum's measurement finds (0: no hum) */
  hum: number
  /** their fundamental, Hz (0: no hum) */
  humFreq: number
  /** their A-weighted level re the program, dB; dehum from −50 */
  humLevel: number
  /** isolated impulses per second standing 32σ out of the AR(30) error; declick above `CLICK_RATE` */
  click: number
  /** 5–9 kHz over 0.2–2 kHz power; deesser above 8 */
  hi: number
  /** share of 0.15 s blocks with loud, aperiodic low end 6 dB over the mid band; dewind above 0.1 */
  wind: number
  /** program over noise bed, dB (Infinity: no bed); a reducer under `BED_SNR` */
  snr: number
  /** the bed shows in steady bands (wiener), else in the pauses alone (omlsa) */
  steady: boolean
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

/** Find the defect and clean it with the matching method; with none evidenced, a copy of the input. */
export default function denoise(data: Float32Array, params?: DenoiseOptions & { returnPlan?: false }): Float32Array
export default function denoise(data: Float32Array, params: DenoiseOptions & { returnPlan: true }): DenoiseResult

/** Run the classification only (no cleaning). */
export function classify(data: Float32Array, fs?: number): Plan

/** Impulses per second above which classify() routes to declick. */
export const CLICK_RATE: number

/** Program over noise bed, dB, under which classify() routes to a reducer. */
export const BED_SNR: number

export interface DeesserOptions {
  /** sample rate (Hz), default 44100 */
  fs?: number
  /** center frequency (Hz), default 6000 */
  fc?: number
  /** @deprecated former name of `fc` */
  freq?: number
  /** notch Q, default 1.4 */
  Q?: number
  /** dB of the sibilance band over the voice body, the kernel's default (0 in @audio/dynamics-deesser 0.3) */
  threshold?: number
  /** deepest cut, dB, the kernel's default (−6) */
  range?: number
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
