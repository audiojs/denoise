/** VAD-driven attenuation of what lies between phrases: breaths, mouth noise, the room. */
export interface DebreathOptions {
  /** attenuation between phrases (dB), default -12 */
  range?: number
  /** gain rise before speech starts (s), default 0.005 */
  attack?: number
  /** gain fall after speech ends (s), default 0.1 */
  release?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process the whole clip in place; returns the same buffer. */
export default function debreath(data: Float32Array, options?: DebreathOptions): Float32Array
