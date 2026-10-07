/** De-breath: the breaths between phrases taken down (unvoiced runs of a breath's length, under the speech, over the
 *  room, with a pause either side), on the band over 300 Hz and never under the room; the room and the speech stay. */
export interface DebreathOptions {
  /** how far a breath goes down (dB), default -12 */
  range?: number
  /** how far what is neither speech nor breath goes down (dB), default 0: the room stays */
  room?: number
  /** the cut's ramp in (s), default 0.005; with room, the gain's rise before speech */
  attack?: number
  /** the cut's ramp out (s), default 0.01; with room, the gain's fall after speech */
  release?: number
  /** sample rate, default 44100 */
  fs?: number
}

/** Process the whole clip in place; returns the same buffer. */
export default function debreath(data: Float32Array, options?: DebreathOptions): Float32Array
