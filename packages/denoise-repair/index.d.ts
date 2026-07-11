export interface RepairRegion {
  /** region start (seconds) */
  at: number
  /** region length (seconds) */
  duration: number
  /** band lower edge (Hz), default 0 */
  from?: number
  /** band upper edge (Hz), default fs/2 */
  to?: number
}

export interface RepairOptions {
  /** time×frequency holes to repair — required */
  regions: RepairRegion[]
  /** STFT frame, default 2048 */
  frameSize?: number
  /** OLA hop, default frameSize/4 */
  hopSize?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Spectral repair: interpolate log-magnitude and advance phase coherently across each region. Returns a new Float32Array. */
export default function repair(data: Float32Array, options: RepairOptions): Float32Array
