/** Wiener / MMSE-LSA denoiser with decision-directed SNR. */
export interface WienerOptions {
  /** gain rule, default 'mmse-lsa' */
  rule?: 'wiener' | 'mmse-lsa'
  /** decision-directed smoothing (alias alphaDD), per 8 ms of frame step (rescaled to the actual step), default 0.98 */
  alpha?: number
  /** decision-directed smoothing per 8 ms of frame step (rescaled to the actual step), default 0.98 */
  alphaDD?: number
  /** a-priori SNR floor, linear, default 10^-1.5 (−15 dB) */
  xiMin?: number
  /** noise PSD; omit for minimum statistics (Martin 2001, 1.5 s window) */
  profile?: Float64Array
  /** minimum statistics options (see @audio/noise-estimate `minStats`); `partials: false` lets it learn held notes as noise */
  estimator?: Record<string, number | boolean | object>
  /** leading noise-only frames to average for the profile */
  noiseFrames?: number
  /** noise profile segment start (samples) */
  profileFrom?: number
  /** noise profile segment end (samples) */
  profileTo?: number
  /** STFT frame, default `frame(fs)`: the power of two nearest 32 ms */
  frameSize?: number
  /** OLA hop, default frameSize/4 */
  hopSize?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process a whole buffer. Returns a new Float32Array of the same length. */
export default function wiener(data: Float32Array | Float64Array, options?: WienerOptions): Float32Array
/** Streaming form: returns a writer — call with chunks, call with no argument to flush. */
export default function wiener(options?: WienerOptions): (chunk?: Float32Array) => Float32Array
/** The default frame at a rate: the power of two nearest 32 ms (512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48). */
export function frame(fs: number): number
/** The gain as an @audio/stft frame process, for a host that runs its own frames (Hann, hop frameSize/4). It keeps state
 *  across frames: one per channel. */
export function processor(options?: WienerOptions): (mag: Float64Array, phase: Float64Array) => { mag: Float64Array, phase: Float64Array }
