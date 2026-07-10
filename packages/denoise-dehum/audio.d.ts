// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'dehum' */
export interface DehumOptions {
  /** 20..400 Hz (default 50) */
  "freq"?: Auto
  /** 1..16 (default 4) */
  "harmonics"?: Auto
  /** 1..200 (default 30) */
  "Q"?: Auto
  /** default false */
  "adaptive"?: boolean
  at?: number | string
  duration?: number | string
}

export declare const dehum: {
  (ctx: Ctx): Process
  channels: "any"
  params: {
    /** 20..400 Hz (default 50) */
    "freq": { type: "number", default: 50 }
    /** 1..16 (default 4) */
    "harmonics": { type: "number", default: 4 }
    /** 1..200 (default 30) */
    "Q": { type: "number", default: 30 }
    /** default false */
    "adaptive": { type: "bool", default: false }
  }
}
