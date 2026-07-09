/** Wiener / MMSE-LSA denoiser with decision-directed SNR. */
export interface WienerOptions {
  /** gain rule, default 'mmse-lsa' */
  rule?: 'wiener' | 'mmse-lsa'
  /** decision-directed smoothing (alias alphaDD), default 0.98 */
  alpha?: number
  /** decision-directed smoothing, default 0.98 */
  alphaDD?: number
  /** a-priori SNR floor, default 0.0316 */
  xiMin?: number
  /** noise PSD; omit for minimum statistics */
  profile?: Float64Array
  /** leading noise-only frames for the PSD bootstrap */
  noiseFrames?: number
  /** STFT frame, default 2048 */
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
