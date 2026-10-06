// atom manifest: wraps the de-clip kernel per @audio/compile CONTRACT. declip.js finds the rails over the whole
// sound (each sign's extreme, taken when the samples there are a point mass in runs), rebuilds every clipped sample
// twice (sparse, from 93 ms blocks; AR, from 186 ms windows) and blends the two by a weight read over ±1 s; it exposes a
// single whole-array call (`declip(data, params)`) with no streaming variant: the "reconstruction over the file" case
// the CONTRACT's `streaming: false` field is for.
//
// clipLevel: 0 lets the kernel find each side's rail itself (none found: the sound comes back untouched); a nonzero
// value is a symmetric rail, passed straight through.

import declip_ from './declip.js'

export const declip = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const opts = { fs: ctx.sampleRate, clipLevel: params.clipLevel[0], order: Math.round(params.order[0]) }
		for (let c = 0; c < inp.length; c++) out[c].set(declip_(inp[c], opts))
	}
}
declip.channels = 'any'
declip.streaming = false
declip.tail = 0
declip.params = {
	clipLevel: { type: 'number', min: 0, max: 1, default: 0 },       // 0 = found from the sound, per side
	order:     { type: 'number', min: 16, max: 512, default: 256 },  // AR order of the AR rebuild
}
