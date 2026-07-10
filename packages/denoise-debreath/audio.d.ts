// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'debreath' */
export interface DebreathOptions {
  /** -60..0 dB (default -12) */
  "range"?: Auto
  /** 0.0005..0.5 s (default 0.005) */
  "attack"?: Auto
  /** 0.001..2 s (default 0.1) */
  "release"?: Auto
  /** 0..20 dB (default 4) */
  "snrTh"?: Auto
  /** 0.05..1 (default 0.5) */
  "flatTh"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const debreath: {
  (ctx: Ctx): Process
  channels: "any"
  streaming: false
  tail: 0
  params: {
    /** -60..0 dB (default -12) */
    "range": { type: "number", default: -12 }
    /** 0.0005..0.5 s (default 0.005) */
    "attack": { type: "number", default: 0.005 }
    /** 0.001..2 s (default 0.1) */
    "release": { type: "number", default: 0.1 }
    /** 0..20 dB (default 4) */
    "snrTh": { type: "number", default: 4 }
    /** 0.05..1 (default 0.5) */
    "flatTh": { type: "number", default: 0.5 }
  }
}
