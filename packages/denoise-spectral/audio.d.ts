// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'specsub' */
export interface SpecsubOptions {
  /** 1..6 (default 2) */
  "alpha"?: Auto
  /** 0..0.5 (default 0.02) */
  "beta"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const specsub: {
  (ctx: Ctx): Process
  channels: "any"
  latency: 3072
  tail: 0
  params: {
    /** 1..6 (default 2) [restart] */
    "alpha": { type: "number", default: 2 }
    /** 0..0.5 (default 0.02) [restart] */
    "beta": { type: "number", default: 0.02 }
  }
}
