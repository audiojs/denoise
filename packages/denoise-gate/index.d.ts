/** Look-ahead noise gate with hysteresis. */
export interface GateOptions {
  /** open threshold (dBFS), default -40 */
  threshold?: number
  /** close threshold (dBFS), default threshold - 6 */
  closeThreshold?: number
  /** attack time (s), default 0.001 */
  attack?: number
  /** release time (s), default 0.05 */
  release?: number
  /** hold time after signal drops (s), default 0.01 */
  hold?: number
  /** closed-state attenuation (dB), default -80 */
  range?: number
  /** detection lead (s), default 0.005 */
  lookahead?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process in place; returns the same buffer. Pass the same options object across calls to persist state. */
export default function gate(data: Float32Array, options?: GateOptions): Float32Array
