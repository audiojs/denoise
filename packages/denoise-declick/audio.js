// atom manifest — wraps the AR-residual click repair kernel per @audio/compile
// CONTRACT. declick.js is genuinely non-causal, not merely lookahead-delayed: each
// overlapping analysis window fits an AR model on samples both before AND after any
// click it repairs (the "central region" logic explicitly needs windowSize/2 of
// trailing context beyond a click to interpolate it), and it exposes a single
// whole-array call (`declick(data, params)`) with no incremental/streaming variant —
// this is exactly the "AR reconstruction over the file" case the CONTRACT's `streaming:
// false` field is for. Declared streaming: false; the host buffers the whole input and
// calls process once with frames = totalFrames, matching the kernel's own batch shape.

import declick_ from './declick.js'

export const declick = (ctx) => {
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
		for (let c = 0; c < inp.length; c++) out[c].set(declick_(inp[c], opts))
	}
}
declick.channels = 'any'
declick.streaming = false
declick.tail = 0
declick.params = {
	order:      { type: 'number', min: 4, max: 200, default: 60 },     // AR order
	windowSize: { type: 'number', min: 256, max: 8192, default: 1024 },
	hopSize:    { type: 'number', min: 64, max: 4096, default: 512 },
	threshold:  { type: 'number', min: 1, max: 20, default: 4 },       // multiples of residual sigma
	guard:      { type: 'number', min: 0, max: 16, default: 2 },       // samples to widen each click region
	maxBurst:   { type: 'number', min: 1, max: 512, default: 64 },     // skip mega-bursts (likely real transients)
}
