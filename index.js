// @audio/denoise — noise reduction & restoration umbrella re-exporting every @audio/denoise-* atom.
// For smaller bundles, depend directly on the individual atom.

import gate_ from '@audio/dynamics-gate'

export { default as dehum } from '@audio/denoise-dehum'
export { default as specsub } from '@audio/denoise-spectral'
export { default as wiener } from '@audio/denoise-wiener'
export { default as omlsa } from '@audio/denoise-omlsa'
export { default as declick } from '@audio/denoise-declick'
export { default as decrackle } from '@audio/denoise-decrackle'
export { default as declip } from '@audio/denoise-declip'
export { default as dewind } from '@audio/denoise-dewind'
export { default as deplosive } from '@audio/denoise-deplosive'
export { default as debreath } from '@audio/denoise-debreath'
export { default as dereverb } from '@audio/denoise-dereverb'
export { default as denoise, classify, deesser } from '@audio/denoise-detect'
export { default as repair } from '@audio/denoise-repair'

export { snr, segSnr, lsd, nrr, speechAttenuation } from '@audio/quality'
export { vad, spp, ddSnr } from '@audio/vad'
export { noiseProfile, minStats, imcra } from '@audio/noise-estimate'
export { stftBatch, stftStream, stftAnalyse } from '@audio/stft'

// gate — @audio/dynamics-gate behind this family's seconds-based, in-place API
// (2026-07 near-dupe merge: the hysteresis + look-ahead gate lives in dynamics-gate).
// Batch shape — for chunked streaming use the dynamics streams. deesser's matching
// adapter lives in @audio/denoise-detect (re-exported above) — classify() needs it
// internally, so the umbrella imports rather than duplicates it.
export const gate = (data, params = {}) => {
  let th = params.threshold ?? -40
  data.set(gate_(data, {
    sampleRate: params.fs || 44100,
    threshold: th,
    closeThreshold: params.closeThreshold ?? th - 6,
    attack: (params.attack ?? 0.001) * 1000,
    release: (params.release ?? 0.05) * 1000,
    hold: (params.hold ?? 0.01) * 1000,
    range: params.range ?? -80,
    lookahead: (params.lookahead ?? 0.005) * 1000,
  }))
  return data
}
