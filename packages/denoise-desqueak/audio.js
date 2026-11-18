// atom manifest: wraps the guitar de-noiser per @audio/compile CONTRACT. desqueak.js decides on the whole clip: a squeak
// is told by what the 200 ms either side of it hold, a note's start by what rings 50 ms after it, the amp's noise by the
// take's quietest frames. A small realtime block would see none of these. Declared streaming: false: the host hands it
// the whole input in one block. Each channel is read and repaired on its own; nothing found, nothing changed.

import desqueak_, { reach } from './desqueak.js'

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
// Each part edits on frames, so past a take that ends mid-sound the output moves for up to the largest of the parts'
// reaches (desqueak.js reach: 46 ms at 44.1 kHz with amp on, 16 ms with squeaks taken). A host renders that tail by
// padding the input with silence; the take's statistics are read up to its last sample off zero, so the padding enters
// none of them and the take comes back as it would alone.
desqueak.tail = ({ sampleRate: fs, params }) => reach(fs, { squeak: params.squeak[0], pick: params.pick[0], amp: params.amp[0] }) / fs
desqueak.params = {
	squeak: { type: 'number', min: -40, max: 0, default: -30, unit: 'dB' },   // the most a squeak goes down; 0 leaves squeaks
	pick:   { type: 'number', min: -24, max: 0, default: 0, unit: 'dB' },     // the most a pick's attack goes down; 0 off
	amp:    { type: 'number', min: -40, max: 0, default: 0, unit: 'dB' },     // how far the amp's hiss and buzz go down; 0 off
}
