/** Berouti spectral subtraction with adaptive over-subtraction. */
export interface SpecsubOptions {
  /** fixed over-subtraction; omitted or 0: Berouti's α(SNR), 4.75 at −5 dB to 1 at 20 dB */
  alpha?: number
  /** spectral floor, a fraction of the noise estimate (Berouti 1979), default 0.05 */
  beta?: number
  /** noise PSD; omit for minimum statistics (Martin 2001, 1.5 s window) */
  profile?: Float64Array
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
export default function specsub(data: Float32Array | Float64Array, options?: SpecsubOptions): Float32Array
/** Streaming form: returns a writer — call with chunks, call with no argument to flush. */
export default function specsub(options?: SpecsubOptions): (chunk?: Float32Array) => Float32Array
/** The default frame at a rate: the power of two nearest 32 ms (512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48). */
export function frame(fs: number): number
