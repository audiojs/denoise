// atom manifest: wraps the guitar de-noiser per @audio/compile CONTRACT. desqueak.js decides on the whole clip: a squeak
// is told by what the 200 ms either side of it hold, a note's start by what rings 50 ms after it, the amp's noise by the
// take's quietest frames. A small realtime block would see none of these. Declared streaming: false: the host hands it
// the whole input in one block. Each channel is read and repaired on its own; nothing found, nothing changed.

import desqueak_ from './desqueak.js'

export const desqueak = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const opts = { fs: ctx.sampleRate, squeak: params.squeak[0], pick: params.pick[0], amp: params.amp[0] }
		// desqueak_ repairs its argument in place: copy into out first, so the input buffer is never touched
		for (let c = 0; c < inp.length; c++) { out[c].set(inp[c]); desqueak_(out[c], opts) }
	}
}
desqueak.channels = 'any'
desqueak.streaming = false
desqueak.tail = 0
desqueak.params = {
	squeak: { type: 'number', min: -40, max: 0, default: -30, unit: 'dB' },   // the most a squeak goes down; 0 leaves squeaks
	pick:   { type: 'number', min: -24, max: 0, default: 0, unit: 'dB' },     // the most a pick's attack goes down; 0 off
	amp:    { type: 'number', min: -40, max: 0, default: 0, unit: 'dB' },     // how far the amp's hiss and buzz go down; 0 off
}
