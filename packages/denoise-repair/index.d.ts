/** 'auto' routes each region by length and content; the others force a tier. */
export type RepairMethod = 'auto' | 'ar' | 'sinusoidal' | 'similarity' | 'spectral'

export interface RepairRegion {
  /** region start (seconds) */
  at: number
  /** region length (seconds) */
  duration: number
  /** band lower edge (Hz), default 0 */
  from?: number
  /** band upper edge (Hz), default fs/2 */
  to?: number
  /** this region's method, overrides options.method */
  method?: RepairMethod
  /** 'similarity': start (seconds) of the passage copied into the region; searched when omitted */
  source?: number
}

export interface RepairOptions {
  /** time×frequency regions to rebuild, required */
  regions: RepairRegion[]
  /** default 'auto': 'similarity' when a passage within `window` joins seamlessly (aligned correlation ≥ 0.4; ≥ 0.995 up to 50 ms), else 'ar' up to 70 ms and 'sinusoidal' beyond; band-limited regions alike */
  method?: RepairMethod
  /** similarity search: seconds either side of a region, default 10 */
  window?: number
  /** STFT frame, default 2048 */
  frameSize?: number
  /** OLA hop, default frameSize/4 */
  hopSize?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Each region with its method resolved and, for 'similarity', its source: pass back as `regions` to repair several channels alike. */
export function plan(data: Float32Array, options: RepairOptions): (RepairRegion & { method: Exclude<RepairMethod, 'auto'> })[]

/** Rebuild each region from its surroundings. Returns a new Float32Array; samples the repair does not reach are copied untouched. */
export default function repair(data: Float32Array, options: RepairOptions): Float32Array
