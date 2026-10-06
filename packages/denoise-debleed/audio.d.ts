// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'debleed' */
export interface DebleedOptions {
  /** -40..0 dB (default -20) */
  "attenuation"?: Auto
  /** 0.05..1 s (default 0.3) */
  "span"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const debleed: {
  (ctx: Ctx): Process
  channels: {"inputs":[2,2],"outputs":[2]}
  latency: (ctx: { sampleRate: number, params: Live }) => number
  tail: 0
  params: {
    /** -40..0 dB (default -20) */
    "attenuation": { type: "number", default: -20 }
    /** 0.05..1 s (default 0.3) [restart] */
    "span": { type: "number", default: 0.3 }
  }
}
