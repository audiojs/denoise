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

/** Chainable-host options for 'dewow' */
export interface DewowOptions {
  /** default "partial" */
  "mode"?: "partial" | "reference" | "pitch"
  /** 0..20000 Hz (default 0) */
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
    /** 0..20000 Hz (default 0) */
    "refFreq": { type: "number", min: 0, max: 20000, default: 0, unit: "Hz" }
    /** 0.001..5 s (default 0.05) */
    "smooth": { type: "number", min: 0.001, max: 5, default: 0.05, unit: "s" }
    /** 0..0.5 (default 0.05) */
    "maxDeviation": { type: "number", min: 0, max: 0.5, default: 0.05 }
    /** default true */
    "wow": { type: "bool", default: true }
    /** default true */
    "flutter": { type: "bool", default: true }
  }
}
