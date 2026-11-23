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

/** Chainable-host options for 'omlsa' */
export interface OmlsaOptions {
  /** 0.8..0.999 (default 0.97) */
  "alphaDD"?: Auto
  /** 0..0.95 (default 0) */
  "qPrior"?: Auto
  /** -40..0 dB (default -15) */
  "gMin"?: Auto
  /** -30..0 dB (default -25) */
  "xiFloor"?: Auto
  /** -10..20 dB (default 0) */
  "threshold"?: Auto
  at?: number | string
  duration?: number | string
}

export declare const omlsa: {
  (ctx: Ctx): Process
  channels: "any"
  latency: (at: { sampleRate: number, params: Live, buffers?: {}, transport: Transport }) => number
  tail: (at: { sampleRate: number, params: Live, buffers?: {}, transport: Transport }) => number
  params: {
    /** 0.8..0.999 (default 0.97) */
    "alphaDD": { type: "number", min: 0.8, max: 0.999, default: 0.97 }
    /** 0..0.95 (default 0) */
    "qPrior": { type: "number", min: 0, max: 0.95, default: 0 }
    /** -40..0 dB (default -15) */
    "gMin": { type: "number", min: -40, max: 0, default: -15, unit: "dB" }
    /** -30..0 dB (default -25) */
    "xiFloor": { type: "number", min: -30, max: 0, default: -25, unit: "dB" }
    /** -10..20 dB (default 0) */
    "threshold": { type: "number", min: -10, max: 20, default: 0, unit: "dB" }
  }
}
