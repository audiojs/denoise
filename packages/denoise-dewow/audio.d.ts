// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'dewow' */
export interface DewowOptions {
  /** default "partial" */
  "mode"?: "partial" | "reference" | "pitch"
  /** 20..20000 Hz (default 50) */
  "refFreq"?: Auto
  /** 0.001..5 s (default 0.05) */
  "smooth"?: Auto
  /** 0..0.5 (default 0.05) */
  "maxDeviation"?: Auto
  /** default true */
  "wow"?: boolean
  /** default true */
  "flutter"?: boolean
  at?: number | string
  duration?: number | string
}

export declare const dewow: {
  (ctx: Ctx): Process
  channels: "any"
  streaming: false
  tail: 0
  params: {
    /** default "partial" */
    "mode": { type: "enum", values: ["partial","reference","pitch"], default: "partial" }
    /** 20..20000 Hz (default 50) */
    "refFreq": { type: "number", default: 50 }
    /** 0.001..5 s (default 0.05) */
    "smooth": { type: "number", default: 0.05 }
    /** 0..0.5 (default 0.05) */
    "maxDeviation": { type: "number", default: 0.05 }
    /** default true */
    "wow": { type: "bool", default: true }
    /** default true */
    "flutter": { type: "bool", default: true }
  }
}
