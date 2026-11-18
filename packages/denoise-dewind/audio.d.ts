// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'dewind' */
export interface DewindOptions {
  /** 200..16000 Hz (default 8000) */
  "cutoff"?: Auto
  /** -40..0 dB (default -20) */
  "attenuation"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const dewind: {
  (ctx: Ctx): Process
  channels: "any"
  latency: (at: { sampleRate: number, params: Live, buffers: {} }) => number
  tail: (at: { sampleRate: number, params: Live, buffers: {} }) => number
  params: {
    /** 200..16000 Hz (default 8000) */
    "cutoff": { type: "number", default: 8000 }
    /** -40..0 dB (default -20) */
    "attenuation": { type: "number", default: -20 }
  }
}
