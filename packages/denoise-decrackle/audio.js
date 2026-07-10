// atom manifest — wraps the AR-residual crackle repair kernel per @audio/compile
// CONTRACT. Same AR-window shape as declick.js (see denoise-declick/audio.js):
// each window's repair region depends on trailing context beyond the burst, and the
// kernel exposes only a single whole-array call (`decrackle(data, params)`), no
// streaming variant — declared streaming: false.

import decrackle_ from './decrackle.js'

export const decrackle = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const opts = {
			order: Math.round(params.order[0]),
			windowSize: Math.round(params.windowSize[0]),
			hopSize: Math.round(params.hopSize[0]),
			threshold: params.threshold[0],
			guard: Math.round(params.guard[0]),
			maxBurst: Math.round(params.maxBurst[0]),
		}
		for (let c = 0; c < inp.length; c++) out[c].set(decrackle_(inp[c], opts))
	}
}
decrackle.channels = 'any'
decrackle.streaming = false
decrackle.tail = 0
decrackle.params = {
	order:      { type: 'number', min: 4, max: 200, default: 50 },     // AR order
	windowSize: { type: 'number', min: 256, max: 8192, default: 2048 },
	hopSize:    { type: 'number', min: 64, max: 4096, default: 1024 },
	threshold:  { type: 'number', min: 1, max: 20, default: 2.5 },     // multiples of residual MAD
	guard:      { type: 'number', min: 0, max: 16, default: 1 },       // samples to widen each burst region
	maxBurst:   { type: 'number', min: 1, max: 512, default: 12 },     // skip mega-bursts (likely real transients)
}
