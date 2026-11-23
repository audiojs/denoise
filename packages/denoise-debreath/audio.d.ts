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

/** Chainable-host options for 'debreath' */
export interface DebreathOptions {
  /** -60..0 dB (default -12) */
  "range"?: Auto
  /** -60..0 dB (default 0) */
  "room"?: Auto
  /** 0.0005..0.5 s (default 0.005) */
  "attack"?: Auto
  /** 0.001..2 s (default 0.01) */
  "release"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const debreath: {
  (ctx: Ctx): Process
  channels: "any"
  streaming: false
  tail: 0
  params: {
    /** -60..0 dB (default -12) */
    "range": { type: "number", min: -60, max: 0, default: -12, unit: "dB" }
    /** -60..0 dB (default 0) */
    "room": { type: "number", min: -60, max: 0, default: 0, unit: "dB" }
    /** 0.0005..0.5 s (default 0.005) */
    "attack": { type: "number", min: 0.0005, max: 0.5, default: 0.005, unit: "s" }
    /** 0.001..2 s (default 0.01) */
    "release": { type: "number", min: 0.001, max: 2, default: 0.01, unit: "s" }
  }
}
