/** Clipped-run restoration via AR-LS interpolation. */
export interface DeclipOptions {
  /** AR model order, default 100 */
  order?: number
  /** clip rail; auto-detected from histogram when omitted */
  clipLevel?: number
  /** clean context per side (samples), default order*4 */
  context?: number
  /** longest restored run (samples), default order/2 */
  maxRun?: number
}

/** Process in place; returns the same buffer. Pass the same options object across calls to persist state. */
export default function declip(data: Float32Array, options?: DeclipOptions): Float32Array
