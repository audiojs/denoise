/** OM-LSA (Cohen & Berdugo 2001) with IMCRA noise tracking (Cohen 2003), or a noise learned where it plays alone. */
export interface OmlsaOptions {
  /** what noise-only bins keep, dB (alias gMin), default -15: the floor, no bin goes lower */
  gMinDb?: number
  /** what noise-only bins keep, dB, default -15: the floor, no bin goes lower */
  gMin?: number
  /** decision-directed smoothing (alias alphaDD), per 8 ms of frame step (rescaled to the actual step); default 0.97,
   *  0.95 with a `profile` */
  alpha?: number
  /** decision-directed smoothing per 8 ms of frame step (rescaled to the actual step); default 0.97, 0.95 with a `profile` */
  alphaDD?: number
  /** a-priori SNR floor, linear, default 10^-2.5 (−25 dB) */
  xiMin?: number
  /** a fixed a-priori speech absence; omitted or 0: estimated from ξ's spread (Cohen & Berdugo 2001 §4) */
  qPrior?: number
  /** the a priori SNR the speech absence is estimated from: 'cts' (default), smoothed in the cepstrum (Breithaupt,
   *  Gerkmann & Martin 2008); 'dd', the decision-directed one, as the paper and Cohen's omlsa.m */
  qFrom?: 'cts' | 'dd'
  /** STFT frame, default `frame(fs, held)`: tracking, the power of two nearest 32 ms; on a held noise, the power of two at
   *  or above 32 ms (a `profile` of K bins without one: its own, 2(K − 1)) */
  frameSize?: number
  /** OLA hop, default frameSize/4 */
  hopSize?: number
  /** sample rate, default 44100 */
  fs?: number
  /** IMCRA options (see @audio/noise-estimate `imcra`); `partials: false` lets the tracker learn held notes as noise, as before 0.5 */
  estimator?: Record<string, number | boolean | object>
  /** dB the noise is read louder (RX's Threshold): a held profile raised by it, the tracked estimate's bias factor β
   *  multiplied by it; more of what is quiet counts as noise. Default 0 */
  threshold?: number
  /** a known noise PSD, `frameSize/2+1` bins (noise-estimate's `noiseProfile` of a noise-only stretch): held, not tracked;
   *  speech presence then read from γ averaged over neighbouring bins, at fixed priors (Gerkmann, Breithaupt
   *  & Martin 2008) */
  profile?: ArrayLike<number>
  /** batch: the first noise-only frames, to learn the profile from */
  noiseFrames?: number
  /** batch: start of a noise-only stretch to learn the profile from (samples) */
  profileFrom?: number
  /** batch: its end (samples) */
  profileTo?: number
}

/** Process a whole buffer. Returns a new Float32Array of the same length. */
export default function omlsa(data: Float32Array | Float64Array, options?: OmlsaOptions): Float32Array
/** Streaming form: returns a writer — call with chunks, call with no argument to flush. */
export default function omlsa(options?: OmlsaOptions): (chunk?: Float32Array) => Float32Array
/** The default frame at a rate. Tracking: the power of two nearest 32 ms (512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at
 *  48). `held` (a known noise): the power of two at or above 32 ms (512 at 16 kHz, 1024 at 22.05, 2048 at 44.1 and 48). */
export function frame(fs: number, held?: boolean): number
/** The gain as an @audio/stft frame process, for a host that runs its own frames (Hann, hop frameSize/4). It keeps state
 *  across frames: one per channel. */
export function processor(options?: OmlsaOptions): (mag: Float64Array, phase: Float64Array) => { mag: Float64Array, phase: Float64Array }
