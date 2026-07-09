/** Berouti spectral subtraction with adaptive over-subtraction. */
export interface SpecsubOptions {
  /** fixed over-subtraction; omit for adaptive Berouti α(γ) */
  alpha?: number
  /** spectral floor (fraction of noisy spectrum), default 0.02 */
  beta?: number
  /** noise PSD from a quiet segment; omit for minimum statistics */
  profile?: Float64Array
  /** leading noise-only frames for the PSD bootstrap */
  noiseFrames?: number
  /** noise profile segment start (samples) */
  profileFrom?: number
  /** noise profile segment end (samples) */
  profileTo?: number
  /** STFT frame, default 2048 */
  frameSize?: number
  /** OLA hop, default frameSize/4 */
  hopSize?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process a whole buffer. Returns a new Float32Array of the same length. */
export default function specsub(data: Float32Array | Float64Array, options?: SpecsubOptions): Float32Array
/** Streaming form: returns a writer — call with chunks, call with no argument to flush. */
export default function specsub(options?: SpecsubOptions): (chunk?: Float32Array) => Float32Array
