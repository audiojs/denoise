// atom manifest: wraps the breath remover per @audio/compile CONTRACT. debreath.js decides on the whole clip: @audio/vad's
// noise floor at each frame is the minimum over 1.5 s centred on it (0.75 s ahead), a breath is told by its run's length,
// level against the clip's room and speech, and the pauses either side of it. A small realtime block would see none
// of these. Declared streaming: false: the host hands it the whole input in one block.

import debreath_ from './debreath.js'

export const debreath = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const opts = {
			fs: ctx.sampleRate,
			range: params.range[0],
			room: params.room[0],
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
	range:   { type: 'number', min: -60, max: 0, default: -12, unit: 'dB' },        // how far a breath goes down
	room:    { type: 'number', min: -60, max: 0, default: 0, unit: 'dB' },          // how far what is neither speech nor breath goes
	attack:  { type: 'number', min: 0.0005, max: 0.5, default: 0.005, unit: 's' },
	release: { type: 'number', min: 0.001, max: 2, default: 0.01, unit: 's' },
}
