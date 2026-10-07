// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number: scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'desqueak' */
export interface DesqueakOptions {
  /** -40..0 dB (default -30) */
  "squeak"?: Auto
  /** -24..0 dB (default 0) */
  "pick"?: Auto
  /** -40..0 dB (default 0) */
  "amp"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const desqueak: {
  (ctx: Ctx): Process
  channels: "any"
  streaming: false
  tail: 0
  params: {
    /** -40..0 dB (default -30) */
    "squeak": { type: "number", default: -30 }
    /** -24..0 dB (default 0) */
    "pick": { type: "number", default: 0 }
    /** -40..0 dB (default 0) */
    "amp": { type: "number", default: 0 }
  }
}
