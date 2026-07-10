// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'declip' */
export interface DeclipOptions {
  /** 0..1 (default 0) */
  "clipLevel"?: Auto
  /** 10..300 (default 100) */
  "order"?: Auto
  /** 10..2000 (default 400) */
  "context"?: Auto
  /** 1..500 (default 50) */
  "maxRun"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const declip: {
  (ctx: Ctx): Process
  channels: "any"
  streaming: false
  tail: 0
  params: {
    /** 0..1 (default 0) */
    "clipLevel": { type: "number", default: 0 }
    /** 10..300 (default 100) */
    "order": { type: "number", default: 100 }
    /** 10..2000 (default 400) */
    "context": { type: "number", default: 400 }
    /** 1..500 (default 50) */
    "maxRun": { type: "number", default: 50 }
  }
}
