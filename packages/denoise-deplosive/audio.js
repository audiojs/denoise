// atom manifest — wraps the LF-burst ducker kernel per @audio/compile CONTRACT.
// deplosive.js persists its filter/envelope state directly on the object it's called
// with (`params._lpC`, `_hpC`, `_lpS`, `_hpS`, `_lfDetS`, `_mfDetS`, `_gain`) — same
// state-per-channel style as denoise-dehum. triggerRatio/attenuation/attack/release are
// read fresh every call, so they stay live. crossover is the one exception: the kernel
// only ever reads it inside a ONE-TIME `if (!params._init)` guard (a boolean flag, not a
// value comparison — unlike denoise-dewind's length-checked reinit), so it
// has zero effect after the first call. Seeded once from the initial ctx snapshot and
// never refreshed live (refreshing it would just be a silently-ignored write); flagged
// restart since a real change requires a new instance.

import deplosive_ from './deplosive.js'

export const deplosive = (ctx) => {
	const state = []
	for (let c = 0, N = ctx.maxChannels ?? 8; c < N; c++) state.push({ fs: ctx.sampleRate, crossover: ctx.params.crossover[0] })
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) {
			const st = state[c]
			st.triggerRatio = params.triggerRatio[0]
			st.attenuation = params.attenuation[0]
			st.attack = params.attack[0]
			st.release = params.release[0]
			out[c].set(inp[c])
			deplosive_(out[c], st)  // in-place, state carries across blocks
		}
	}
}
deplosive.channels = 'any'
deplosive.tail = 0
deplosive.params = {
	triggerRatio: { type: 'number', min: 1, max: 20, default: 4 },        // LF/mid energy ratio that opens the duck
	attenuation:  { type: 'number', min: -40, max: 0, default: -18, unit: 'dB' },
	attack:       { type: 'number', min: 0.001, max: 0.2, default: 0.005, unit: 's' },
	release:      { type: 'number', min: 0.005, max: 1, default: 0.08, unit: 's' },
	crossover:    { type: 'number', min: 50, max: 500, default: 200, unit: 'Hz', flags: ['restart'] },
}
