// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'wiener' */
export interface WienerOptions {
  /** default "mmse-lsa" */
  "rule"?: "wiener" | "mmse-lsa"
  /** 0.8..0.999 (default 0.98) */
  "alphaDD"?: Auto
  /** -30..0 dB (default -15) */
  "xiFloor"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const wiener: {
  (ctx: Ctx): Process
  channels: "any"
  latency: 3072
  tail: 0
  params: {
    /** default "mmse-lsa" [restart] */
    "rule": { type: "enum", values: ["wiener","mmse-lsa"], default: "mmse-lsa" }
    /** 0.8..0.999 (default 0.98) [restart] */
    "alphaDD": { type: "number", default: 0.98 }
    /** -30..0 dB (default -15) [restart] */
    "xiFloor": { type: "number", default: -15 }
  }
}
