// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

import type { TimeSegment } from './index.d.ts'

/** Stat plugin 'silence' — whole-signal analysis, registers as a.stat('silence') */
export declare const silence: {
  stat: 'silence'
  compute(channels: Float32Array[], opts: { sampleRate: number, [k: string]: unknown }): { speech: TimeSegment[], silence: TimeSegment[] }
}
