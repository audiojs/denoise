// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'deecho' */
export interface DeechoOptions {
  /** 0..4 s (default 0) */
  "delay"?: Auto
  /** -0.95..1.9 (default 0) */
  "gain"?: Auto
  /** 0..0.95 (default 0) */
  "feedback"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const deecho: {
  (ctx: Ctx): Process
  channels: "any"
  streaming: false
  tail: 0
  params: {
    /** 0..4 s (default 0) */
    "delay": { type: "number", default: 0 }
    /** -0.95..1.9 (default 0) */
    "gain": { type: "number", default: 0 }
    /** 0..0.95 (default 0) */
    "feedback": { type: "number", default: 0 }
  }
}

