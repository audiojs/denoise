// Generated from the audio.js manifest (params metadata is the source of truth).
// Regenerate: node tools/dts.js in @audio/plugin. Do not edit by hand.

/** Automatable number — scalar, `t => value` fn, or breakpoint curve {t, v} */
type Auto = number | ((t: number) => number) | { t: number[], v: number[] }
/** Per-block param values as delivered by hosts (numbers arrive as 1-length Float32Array) */
type Live = Record<string, Float32Array | string | boolean>
type Transport = Readonly<{ playing: boolean, bpm: number, beat: number, barStart: number, timeSig: [number, number] }>
/** What a host hands a processor it builds: the contract's Context (CONTRACT.d.ts, 1.0) */
type Ctx = { readonly sampleRate: number, readonly maxBlockSize: number, readonly maxChannels: number, readonly layouts?: { readonly inputs: readonly (string | undefined)[], readonly outputs: readonly (string | undefined)[] }, readonly params: Live, readonly buffers: Readonly<Record<string, Float32Array[] | undefined>>, readonly events?: readonly { time: number, kind: 'on' | 'off', midi: number, velocity: number, id: number }[], emit(name: string, value: number): void, readonly transport: Transport }
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
  latency: (at: { sampleRate: number, params: Live, buffers?: {}, transport: Transport }) => number
  tail: (at: { sampleRate: number, params: Live, buffers?: {}, transport: Transport }) => number
  params: {
    /** 0.25..20 (default 1) */
    "triggerRatio": { type: "number", min: 0.25, max: 20, default: 1 }
    /** -60..0 dB (default -40) */
    "attenuation": { type: "number", min: -60, max: 0, default: -40, unit: "dB" }
    /** 0.0001..0.2 s (default 0.0005) */
    "attack": { type: "number", min: 0.0001, max: 0.2, default: 0.0005, unit: "s" }
    /** 0.005..1 s (default 0.03) */
    "release": { type: "number", min: 0.005, max: 1, default: 0.03, unit: "s" }
    /** 50..300 Hz (default 120) */
    "crossover": { type: "number", min: 50, max: 300, default: 120, unit: "Hz" }
  }
}
