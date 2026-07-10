// atom manifest — wraps the look-ahead hysteresis gate kernel per @audio/compile
// CONTRACT. gate.js is a per-sample causal state machine that persists its envelope/
// hold/lookahead-delay-line state directly on the object it's called with (`params._env`,
// `_gain`, `_hold`, `_lab`, `_labPos`) — same style as denoise-dehum's state-per-channel
// object, just with the mutable fields owned by the kernel itself instead of a separate
// `state` object. threshold/closeThreshold/attack/release/hold/range are read fresh every
// call, so they stay live; lookahead resizes the internal delay line whenever it changes
// (`lab.length !== laSamples`), which the kernel already handles gracefully (auto-reinit,
// no crash) — kept live here too, but flagged restart because the host's plugin-delay-
// compensation offset (declared `latency`) is computed once at construction and won't
// follow a live lookahead change until the host reinstantiates.

import gate_ from './gate.js'

export const gate = (ctx) => {
	const state = []
	for (let c = 0, N = ctx.maxChannels ?? 8; c < N; c++) state.push({ fs: ctx.sampleRate })
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) {
			const st = state[c]
			st.threshold = params.threshold[0]
			st.closeThreshold = params.closeThreshold[0]
			st.attack = params.attack[0]
			st.release = params.release[0]
			st.hold = params.hold[0]
			st.range = params.range[0]
			st.lookahead = params.lookahead[0]
			out[c].set(inp[c])
			gate_(out[c], st)  // in-place, state carries across blocks
		}
	}
}
gate.channels = 'any'
gate.latency = (ctx) => Math.round(ctx.params.lookahead[0] * ctx.sampleRate)
gate.tail = 0
gate.params = {
	threshold:      { type: 'number', min: -80, max: 0, default: -40, unit: 'dB' },
	closeThreshold: { type: 'number', min: -90, max: 0, default: -46, unit: 'dB' },
	attack:         { type: 'number', min: 0.0001, max: 0.5, default: 0.001, unit: 's' },
	release:        { type: 'number', min: 0.001, max: 2, default: 0.05, unit: 's' },
	hold:           { type: 'number', min: 0, max: 1, default: 0.01, unit: 's' },
	range:          { type: 'number', min: -96, max: 0, default: -80, unit: 'dB' },
	lookahead:      { type: 'number', min: 0, max: 0.05, default: 0.005, unit: 's', flags: ['restart'] },
}
