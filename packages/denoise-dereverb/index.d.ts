/** Late reverberation off a voice, one channel, the whole take at once: weighted prediction error (WPE, Nakatani et al. 2010) fitted over the take, then the late power the frames before carry (shaped by its taps, scaled by the take's own decays) taken by a log-spectral-amplitude gain. A dry take, or one with no pauses (music), comes back as it came. */
export interface DereverbOptions {
  /** scale of the late-reverberation estimate, default 1 (as the take's own decays read it); 0: the linear prediction alone, 2: twice the estimate (more of the tail, more of the voice) */
  strength?: number
  /** STFT frame, default `frame(fs)`: the power of two nearest 40 ms */
  frameSize?: number
  /** OLA hop, default frameSize/4 */
  hopSize?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process a whole take (the fit needs all of it). Returns a new Float32Array of the same length: the input's samples, bit for bit, when it is dry or has no pauses. */
export default function dereverb(data: Float32Array | Float64Array, options?: DereverbOptions): Float32Array
/** The default frame at a rate: the power of two nearest 40 ms (512 at 16 kHz, 1024 at 22.05, 2048 at 44.1 and 48). */
export function frame(fs: number): number
