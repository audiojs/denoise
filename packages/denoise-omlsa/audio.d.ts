// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'omlsa' */
export interface OmlsaOptions {
  /** 0.8..0.999 (default 0.92) */
  "alphaDD"?: Auto
  /** 0.05..0.95 (default 0.3) */
  "qPrior"?: Auto
  /** -40..0 dB (default -20) */
  "gMin"?: Auto
  /** -30..0 dB (default -15) */
  "xiFloor"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const omlsa: {
  (ctx: Ctx): Process
  channels: "any"
  latency: 3072
  tail: 0
  params: {
    /** 0.8..0.999 (default 0.92) [restart] */
    "alphaDD": { type: "number", default: 0.92 }
    /** 0.05..0.95 (default 0.3) [restart] */
    "qPrior": { type: "number", default: 0.3 }
    /** -40..0 dB (default -20) [restart] */
    "gMin": { type: "number", default: -20 }
    /** -30..0 dB (default -15) [restart] */
    "xiFloor": { type: "number", default: -15 }
  }
}
