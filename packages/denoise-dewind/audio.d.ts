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
  /** 20..300 Hz (default 60) */
  "cutoffMin"?: Auto
  /** 50..500 Hz (default 250) */
  "cutoffMax"?: Auto
  /** 1..4 (default 2) */
  "order"?: Auto
  /** 0.3..3 (default 0.707) */
  "Q"?: Auto
  /** 0.005..1 s (default 0.05) */
  "attack"?: Auto
  /** 0.01..2 s (default 0.4) */
  "release"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const dewind: {
  (ctx: Ctx): Process
  channels: "any"
  tail: 0
  params: {
    /** 20..300 Hz (default 60) */
    "cutoffMin": { type: "number", default: 60 }
    /** 50..500 Hz (default 250) */
    "cutoffMax": { type: "number", default: 250 }
    /** 1..4 (default 2) [restart] */
    "order": { type: "number", default: 2 }
    /** 0.3..3 (default 0.707) */
    "Q": { type: "number", default: 0.707 }
    /** 0.005..1 s (default 0.05) */
    "attack": { type: "number", default: 0.05 }
    /** 0.01..2 s (default 0.4) */
    "release": { type: "number", default: 0.4 }
  }
}
