// atom manifest — wraps the dehum kernel per @audio/compile CONTRACT.
// Kernel keeps biquad state + tracker phase on a persistent params object per
// channel; it rebuilds notch coefficients itself when freq/harmonics/Q change,
// so all params are live.

import dehum_ from './dehum.js'

export const dehum = (ctx) => {
	const state = []
	for (let c = 0, N = ctx.maxChannels ?? 8; c < N; c++) state.push({ fs: ctx.sampleRate })
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) {
			const st = state[c]
			st.freq = params.freq[0]
			st.harmonics = params.harmonics[0]
			st.Q = params.q[0]
			st.adaptive = params.adaptive
			out[c].set(inp[c])
			dehum_(out[c], st)  // in-place, state carries across blocks
		}
	}
}
dehum.channels = 'any'
dehum.params = {
	freq:      { type: 'number', min: 20, max: 400, default: 50, unit: 'Hz' },
	harmonics: { type: 'number', min: 1, max: 16, default: 4 },
	q:         { type: 'number', min: 1, max: 200, default: 30 },
	adaptive:  { type: 'bool', default: false },
}
