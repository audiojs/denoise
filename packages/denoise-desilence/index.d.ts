/** VAD-driven silence handling for speech recordings: remove, shorten, split, trim. */
export interface DesilenceOptions {
  /** sample rate, default 44100 */
  fs?: number
  /** 'shorten' (Smart Speed, default) | 'remove' | 'trim' */
  mode?: 'shorten' | 'remove' | 'trim'
  /** pause shorter than this is never touched (s), default 0.5 */
  minSilence?: number
  /** shorten-mode target pause length (s), default 0.25 */
  maxSilence?: number
  /** remove-mode silence kept around speech (s), default 0.1 */
  pad?: number
  /** dB override for the VAD's own adaptive floor; null uses vad()'s energy+flatness decision, default null */
  threshold?: number | null
  /** equal-power crossfade at every cut (s), default 0.01 */
  fade?: number
  /** STFT frame forwarded to vad(), default 1024 */
  frameSize?: number
  /** STFT hop forwarded to vad(), default frameSize/2 */
  hopSize?: number
  /** speech gaps shorter than this are merged into one speech segment (s), default 0.15 */
  merge?: number
}

export interface TimeSegment { start: number, end: number }
export interface MapPoint { from: number, to: number }

export interface DesilenceResult {
  /** same shape as input, new arrays */
  data: Float32Array | Float32Array[]
  /** kept regions after cutting, input seconds */
  segments: TimeSegment[]
  /** seconds cut */
  removed: number
  /** input→output time breakpoints; use `project()` to look up a point */
  map: MapPoint[]
}

/** Cut/shorten/trim silence between and around speech. Mono Float32Array, or Float32Array[]
 * channels (analysis runs on the mono mix; the same cuts apply to every channel). */
export default function desilence(data: Float32Array | Float32Array[], opts?: DesilenceOptions): DesilenceResult

export interface SegmentsResult {
  speech: TimeSegment[]
  silence: TimeSegment[]
}

/** Analysis only — speech/silence time segments (input seconds), no editing. */
export function segments(data: Float32Array | Float32Array[], opts?: DesilenceOptions): SegmentsResult

/** One clip per speech segment, padded by `opts.pad` seconds and edge-faded ("split by silence"). */
export function split(data: Float32Array, opts?: DesilenceOptions): Float32Array[]
export function split(data: Float32Array[], opts?: DesilenceOptions): Float32Array[][]

/** Project an input-seconds time through a `desilence()` map to its output-seconds position. */
export function project(map: MapPoint[], t: number): number
