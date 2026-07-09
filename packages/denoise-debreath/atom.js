// atom manifest — wraps the VAD-driven breath attenuator per @audio/atom
// CONTRACT. debreath.js computes its VAD decision from a GLOBAL statistic — a 10th-
// percentile energy floor over every frame of the ENTIRE input (vad.js: "Global noise
// floor ... Robust on signals where any short window may be entirely speech") — and its
// gain-smoothing loop resets `gain = 1` at the top of every call, with no persisted
// cross-call state (unlike denoise-deplosive/denoise-dewind, which stash `params._*`
// fields precisely so repeated small-block calls stay continuous). Calling this kernel
// per small realtime block would both recompute a percentile over a fragment too short
// to be representative AND reset the attack/release envelope to 1 at every block
// boundary, breaking the smoothing the algorithm is built around — a "needs the whole
// signal" case by the same logic as noise-profiling-from-the-full-buffer, just for a
// VAD floor instead of a PSD. Declared streaming: false.

import debreath_ from './debreath.js'

export const debreath = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const opts = {
			fs: ctx.sampleRate,
			range: params.range[0],
			attack: params.attack[0],
			release: params.release[0],
			snrTh: params.snrTh[0],
			flatTh: params.flatTh[0],
		}
		// debreath_ mutates its argument in place (data[i] *= gain) — copy into out
		// first (matches the leveler exemplar) so the input buffer is never touched.
		for (let c = 0; c < inp.length; c++) { out[c].set(inp[c]); debreath_(out[c], opts) }
	}
}
debreath.channels = 'any'
debreath.streaming = false
debreath.tail = 0
debreath.params = {
	range:   { type: 'number', min: -60, max: 0, default: -12, unit: 'dB' },
	attack:  { type: 'number', min: 0.0005, max: 0.5, default: 0.005, unit: 's' },
	release: { type: 'number', min: 0.001, max: 2, default: 0.1, unit: 's' },
	snrTh:   { type: 'number', min: 0, max: 20, default: 4, unit: 'dB' },
	flatTh:  { type: 'number', min: 0.05, max: 1, default: 0.5 },
}
