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
  /** 0.25..20 (default 1) */
  "triggerRatio"?: Auto
  /** -60..0 dB (default -40) */
  "attenuation"?: Auto
  /** 0.0001..0.2 s (default 0.0005) */
  "attack"?: Auto
  /** 0.005..1 s (default 0.03) */
  "release"?: Auto
  /** 50..300 Hz (default 120) */
  "crossover"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const deplosive: {
  (ctx: Ctx): Process
  channels: "any"
  latency: (ctx: { sampleRate: number, params: Live }) => number
  tail: 0
  params: {
    /** 0.25..20 (default 1) */
    "triggerRatio": { type: "number", default: 1 }
    /** -60..0 dB (default -40) */
    "attenuation": { type: "number", default: -40 }
    /** 0.0001..0.2 s (default 0.0005) */
    "attack": { type: "number", default: 0.0005 }
    /** 0.005..1 s (default 0.03) */
    "release": { type: "number", default: 0.03 }
    /** 50..300 Hz (default 120) [restart] */
    "crossover": { type: "number", default: 120 }
  }
}
