/** VAD-driven attenuation of non-speech (breath) regions. */
export interface DebreathOptions {
  /** attenuation on non-speech (dB), default -12 */
  range?: number
  /** gain attack (s), default 0.005 */
  attack?: number
  /** gain release (s), default 0.1 */
  release?: number
  /** VAD energy threshold above floor (dB), default 4 */
  snrTh?: number
  /** VAD spectral flatness threshold, default 0.5 */
  flatTh?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process in place; returns the same buffer. Pass the same options object across calls to persist state. */
export default function debreath(data: Float32Array, options?: DebreathOptions): Float32Array
