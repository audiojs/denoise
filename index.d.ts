export { default as dehum } from '@audio/denoise-dehum'
export { default as specsub } from '@audio/denoise-spectral'
export { default as wiener } from '@audio/denoise-wiener'
export { default as omlsa } from '@audio/denoise-omlsa'
export { default as declick } from '@audio/denoise-declick'
export { default as decrackle } from '@audio/denoise-decrackle'
export { default as declip } from '@audio/denoise-declip'
export { default as dewind } from '@audio/denoise-dewind'
export { default as deplosive } from '@audio/denoise-deplosive'
export { default as debreath } from '@audio/denoise-debreath'
export { default as dereverb } from '@audio/denoise-dereverb'
export { default as denoise, classify, deesser } from '@audio/denoise-detect'
export { default as repair } from '@audio/denoise-repair'
export { default as desilence, segments as silenceSegments, split as splitSilence } from '@audio/denoise-desilence'
export { default as dewow, analyze as wowFlutter } from '@audio/denoise-dewow'
export { snr, segSnr, lsd, nrr, speechAttenuation } from '@audio/quality'
export { vad, spp, ddSnr } from '@audio/vad'
export { noiseProfile, minStats, imcra } from '@audio/noise-estimate'
export { stftBatch, stftStream, stftAnalyse } from '@audio/stft'

export interface GateOptions {
  fs?: number
  /** Threshold and range are in dB; times are in seconds. */
  threshold?: number
  closeThreshold?: number
  attack?: number
  release?: number
  hold?: number
  range?: number
  lookahead?: number
}
/** Whole-buffer, in-place adapter; use @audio/dynamics-gate for streaming. */
export function gate<T extends Float32Array | Float64Array>(data: T, params?: GateOptions): T
export type { DebreathOptions } from '@audio/denoise-debreath'
export type { DeclickOptions } from '@audio/denoise-declick'
export type { DeclipOptions } from '@audio/denoise-declip'
export type { DecrackleOptions } from '@audio/denoise-decrackle'
export type { DehumOptions } from '@audio/denoise-dehum'
export type { DeplosiveOptions } from '@audio/denoise-deplosive'
export type { DereverbOptions } from '@audio/denoise-dereverb'
export type { DesilenceOptions, TimeSegment, MapPoint, DesilenceResult, SegmentsResult } from '@audio/denoise-desilence'
export type { DenoiseMethod, ClassifyScores, Plan, DenoiseOptions, DenoiseResult, DeesserOptions } from '@audio/denoise-detect'
export type { DewindOptions } from '@audio/denoise-dewind'
export type { DewowOptions, DewowTrack, DewowAnalysis } from '@audio/denoise-dewow'
export type { OmlsaOptions } from '@audio/denoise-omlsa'
export type { RepairRegion, RepairOptions } from '@audio/denoise-repair'
export type { SpecsubOptions } from '@audio/denoise-spectral'
export type { WienerOptions } from '@audio/denoise-wiener'
export type { NoiseProfileOptions, MinStatsOptions, Estimator, ImcraOptions, ImcraEstimator } from '@audio/noise-estimate'
export type { SegSnrOptions, LsdOptions, SpectralSimOptions, ModulationDepthOptions } from '@audio/quality'
export type { VadOptions, VadResult, SppOptions } from '@audio/vad'
