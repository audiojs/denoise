// atom manifest — wraps the crackle repair kernel per @audio/compile CONTRACT. decrackle.js is genuinely non-causal,
// not merely lookahead-delayed: each sample is judged against its least-squares interpolation from both sides and the
// errors' median level over ±12 ms, the search runs again on the rebuilt sound until no new impulse stands out, and
// it exposes a single whole-array call (`decrackle(data, params)`) with no incremental/streaming variant: the "AR
// reconstruction over the file" case the CONTRACT's `streaming: false` field is for. Declared streaming: false; the
// host buffers the whole input and calls process once with frames = totalFrames, matching the kernel's batch shape.

import decrackle_ from './decrackle.js'

export const decrackle = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const opts = { fs: ctx.sampleRate, threshold: params.threshold[0], order: Math.round(params.order[0]) }
		for (let c = 0; c < inp.length; c++) out[c].set(decrackle_(inp[c], opts))
	}
}
decrackle.channels = 'any'
decrackle.streaming = false
decrackle.tail = 0
decrackle.params = {
	threshold: { type: 'number', min: 2, max: 20, default: 4 },  // multiples of each error's local scale
	order:     { type: 'number', min: 8, max: 100, default: 32 }, // AR order of the detection
}
