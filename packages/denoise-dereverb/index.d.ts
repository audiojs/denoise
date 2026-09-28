/** Weighted prediction error (WPE) dereverberation, recursive, one channel (Nakatani et al. 2010; Yoshioka & Nakatani 2012). */
export interface DereverbOptions {
  /** how far ahead of each frame its filter has learned (s), default 0.25; the writer's latency grows by it, 0: the frame's alone */
  lookahead?: number
  /** STFT frame, default `frame(fs)`: the power of two nearest 40 ms */
  frameSize?: number
  /** OLA hop, default frameSize/4 */
  hopSize?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process a whole buffer. Returns a new Float32Array of the same length. */
export default function dereverb(data: Float32Array | Float64Array, options?: DereverbOptions): Float32Array
/** Streaming form: returns a writer; call it with chunks, then with no argument to flush. Its output equals the batch. */
export default function dereverb(options?: DereverbOptions): (chunk?: Float32Array) => Float32Array
/** The default frame at a rate: the power of two nearest 40 ms (512 at 16 kHz, 1024 at 22.05, 2048 at 44.1 and 48). */
export function frame(fs: number): number
