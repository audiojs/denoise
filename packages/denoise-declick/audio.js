// atom manifest — wraps the click repair kernel per @audio/compile CONTRACT. declick.js is genuinely non-causal,
// not merely lookahead-delayed: each click is judged against the prediction error 12 ms either side of it and
// rebuilt from 46 ms of sound either side, and it exposes a single whole-array call (`declick(data, params)`) with
// no incremental/streaming variant: the "AR reconstruction over the file" case the CONTRACT's `streaming: false`
// field is for. Declared streaming: false; the host buffers the whole input and calls process once with
// frames = totalFrames, matching the kernel's own batch shape.

import declick_ from './declick.js'

export const declick = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const opts = { fs: ctx.sampleRate, threshold: params.threshold[0], order: Math.round(params.order[0]), longest: params.longest[0] }
		for (let c = 0; c < inp.length; c++) out[c].set(declick_(inp[c], opts))
	}
}
declick.channels = 'any'
declick.streaming = false
declick.tail = 0
declick.params = {
	threshold: { type: 'number', min: 2, max: 30, default: 8 },               // multiples of the prediction error's local scale
	longest:   { type: 'number', min: 0.5, max: 20, default: 6, unit: 'ms' }, // longer: real sound, left alone
	order:     { type: 'number', min: 8, max: 100, default: 32 },              // AR order of the detection
}
