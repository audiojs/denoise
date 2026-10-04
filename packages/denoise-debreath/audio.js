// atom manifest — wraps the VAD-driven breath attenuator per @audio/compile CONTRACT. debreath.js decides on the
// whole clip: @audio/vad's noise floor at each frame is the minimum over 1.5 s centred on it (0.75 s ahead), its speech
// level the mean over every voiced frame of the input, and the gain is zero-phase (it rises `attack` s before speech
// starts). A small realtime block would see neither the frames ahead nor the clip's speech level. Declared
// streaming: false: the host hands it the whole input in one block.

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
}
