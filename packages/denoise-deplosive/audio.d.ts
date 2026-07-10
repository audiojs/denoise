// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/compile. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Ctx = { sampleRate: number, maxBlockSize: number, maxChannels: number, currentTime: number, duration?: number, events?: readonly any[], emit?: (name: string, ...args: any[]) => void, [k: string]: unknown }
type Process = (inputs: Float32Array[][], outputs: Float32Array[][], params: Live) => void

/** Chainable-host options for 'deplosive' */
export interface DeplosiveOptions {
  /** 1..20 (default 4) */
  "triggerRatio"?: Auto
  /** -40..0 dB (default -18) */
  "attenuation"?: Auto
  /** 0.001..0.2 s (default 0.005) */
  "attack"?: Auto
  /** 0.005..1 s (default 0.08) */
  "release"?: Auto
  /** 50..500 Hz (default 200) */
  "crossover"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const deplosive: {
  (ctx: Ctx): Process
  channels: "any"
  tail: 0
  params: {
    /** 1..20 (default 4) */
    "triggerRatio": { type: "number", default: 4 }
    /** -40..0 dB (default -18) */
    "attenuation": { type: "number", default: -18 }
    /** 0.001..0.2 s (default 0.005) */
    "attack": { type: "number", default: 0.005 }
    /** 0.005..1 s (default 0.08) */
    "release": { type: "number", default: 0.08 }
    /** 50..500 Hz (default 200) [restart] */
    "crossover": { type: "number", default: 200 }
  }
}
