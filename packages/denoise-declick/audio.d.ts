// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'declick' */
export interface DeclickOptions {
  /** 2..30 (default 8) */
  "threshold"?: Auto
  /** 0.5..20 ms (default 6) */
  "longest"?: Auto
  /** 8..100 (default 32) */
  "order"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const declick: {
  (ctx: Ctx): Process
  channels: "any"
  streaming: false
  tail: 0
  params: {
    /** 2..30 (default 8) */
    "threshold": { type: "number", default: 8 }
    /** 0.5..20 ms (default 6) */
    "longest": { type: "number", default: 6 }
    /** 8..100 (default 32) */
    "order": { type: "number", default: 32 }
  }
}
