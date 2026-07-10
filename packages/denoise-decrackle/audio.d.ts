// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'decrackle' */
export interface DecrackleOptions {
  /** 4..200 (default 50) */
  "order"?: Auto
  /** 256..8192 (default 2048) */
  "windowSize"?: Auto
  /** 64..4096 (default 1024) */
  "hopSize"?: Auto
  /** 1..20 (default 2.5) */
  "threshold"?: Auto
  /** 0..16 (default 1) */
  "guard"?: Auto
  /** 1..512 (default 12) */
  "maxBurst"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const decrackle: {
  (ctx: Ctx): Process
  channels: "any"
  streaming: false
  tail: 0
  params: {
    /** 4..200 (default 50) */
    "order": { type: "number", default: 50 }
    /** 256..8192 (default 2048) */
    "windowSize": { type: "number", default: 2048 }
    /** 64..4096 (default 1024) */
    "hopSize": { type: "number", default: 1024 }
    /** 1..20 (default 2.5) */
    "threshold": { type: "number", default: 2.5 }
    /** 0..16 (default 1) */
    "guard": { type: "number", default: 1 }
    /** 1..512 (default 12) */
    "maxBurst": { type: "number", default: 12 }
  }
}
