/** OM-LSA with IMCRA noise tracking. */
export interface OmlsaOptions {
  /** floor for non-speech bins (dB, alias gMin), default -20 */
  gMinDb?: number
  /** floor for non-speech bins (dB), default -20 */
  gMin?: number
  /** decision-directed smoothing (alias alphaDD), default 0.92 */
  alpha?: number
  /** decision-directed smoothing, default 0.92 */
  alphaDD?: number
  /** a-priori SNR floor, default 0.0316 */
  xiMin?: number
  /** a-priori speech absence, default 0.3 */
  qPrior?: number
  /** STFT frame, default 2048 */
  frameSize?: number
  /** OLA hop, default frameSize/4 */
  hopSize?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process a whole buffer. Returns a new Float32Array of the same length. */
export default function omlsa(data: Float32Array | Float64Array, options?: OmlsaOptions): Float32Array
/** Streaming form: returns a writer — call with chunks, call with no argument to flush. */
export default function omlsa(options?: OmlsaOptions): (chunk?: Float32Array) => Float32Array
