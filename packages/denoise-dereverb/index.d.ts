/** Late-reverb suppression with DD-smoothed Wiener gain. */
export interface DereverbOptions {
  /** assumed reverberation time (s), default 0.5 */
  t60?: number
  /** direct-sound passthrough (s), default 0.04 */
  predelay?: number
  /** reverb-PSD over-estimation, default 1.5 */
  alpha?: number
  /** decision-directed SIR smoothing, default 0.98 */
  alphaDD?: number
  /** gain floor for reverb-dominated bins, default 0.05 */
  gMin?: number
  /** STFT frame, default 2048 */
  frameSize?: number
  /** OLA hop, default frameSize/4 */
  hopSize?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process a whole buffer. Returns a new Float32Array of the same length. */
export default function dereverb(data: Float32Array | Float64Array, options?: DereverbOptions): Float32Array
/** Streaming form: returns a writer — call with chunks, call with no argument to flush. */
export default function dereverb(options?: DereverbOptions): (chunk?: Float32Array) => Float32Array
