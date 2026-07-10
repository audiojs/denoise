// atom manifest — wraps the adaptive-cutoff de-wind kernel per @audio/compile
// CONTRACT. dewind.js persists its filter cascade + cutoff tracker state directly on the
// object it's called with (`params._state`, `_fc`, `_coefs`, `_lfDc`, `_mfDc`) — same
// state-per-channel style as denoise-dehum. cutoffMin/cutoffMax/Q/attack/release are read
// fresh every call, so they stay live (the one-pole cutoff tracker smooths toward whatever
// target they produce — no discontinuity from changing them). order is the one exception:
// the kernel only rebuilds the filter cascade + state array when `params._state.length
// !== order` — kept live here (so a change still gracefully re-initializes rather than
// being silently ignored, unlike denoise-deplosive's crossover) but flagged restart since
// the cascade reset is an audible discontinuity, not smooth automation. blockSize (cutoff
// re-estimation granularity) stays at the kernel's default — an implementation constant,
// not a musically-relevant control. No lookahead/buffering here, so no declared latency.

import dewind_ from './dewind.js'

export const dewind = (ctx) => {
	const state = []
	for (let c = 0, N = ctx.maxChannels ?? 8; c < N; c++) state.push({ fs: ctx.sampleRate })
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) {
			const st = state[c]
			st.cutoffMin = params.cutoffMin[0]
			st.cutoffMax = params.cutoffMax[0]
			st.order = params.order[0]
			st.Q = params.Q[0]
			st.attack = params.attack[0]
			st.release = params.release[0]
			out[c].set(inp[c])
			dewind_(out[c], st)  // in-place, state carries across blocks
		}
	}
}
dewind.channels = 'any'
dewind.tail = 0
dewind.params = {
	cutoffMin: { type: 'number', min: 20, max: 300, default: 60, unit: 'Hz' },
	cutoffMax: { type: 'number', min: 50, max: 500, default: 250, unit: 'Hz' },
	order:     { type: 'number', min: 1, max: 4, default: 2, flags: ['restart'] },  // biquad sections (12dB/oct each)
	Q:         { type: 'number', min: 0.3, max: 3, default: 0.707 },
	attack:    { type: 'number', min: 0.005, max: 1, default: 0.05, unit: 's' },
	release:   { type: 'number', min: 0.01, max: 2, default: 0.4, unit: 's' },
}
