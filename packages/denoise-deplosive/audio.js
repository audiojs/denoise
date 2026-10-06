// atom manifest: wraps the LF-burst remover per @audio/compile CONTRACT. deplosive.js's stream returns each block
// whole, `latency(fs)` samples late (its linear-phase low band reads that far ahead); the latency is declared, so the
// host aligns the output. triggerRatio, attenuation, attack and release are read on every block, so they stay live;
// crossover sets the stream's filters and low band at construction (restart).

import { stream, latency } from './deplosive.js'

export const deplosive = (ctx) => {
	const streams = [], opts = []
	for (let c = 0, N = ctx.maxChannels ?? 8; c < N; c++) {
		let o = { fs: ctx.sampleRate, crossover: ctx.params.crossover[0] }
		opts.push(o); streams.push(stream(o))
	}
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) {
			const o = opts[c]
			o.triggerRatio = params.triggerRatio[0]
			o.attenuation = params.attenuation[0]
			o.attack = params.attack[0]
			o.release = params.release[0]
			out[c].set(streams[c].write(inp[c]))
		}
	}
}
deplosive.channels = 'any'
deplosive.latency = ({ sampleRate }) => latency(sampleRate)
deplosive.tail = 0
deplosive.params = {
	triggerRatio: { type: 'number', min: 0.25, max: 20, default: 1 },           // LF over the voice band a pop must exceed
	attenuation:  { type: 'number', min: -60, max: 0, default: -40, unit: 'dB' },
	attack:       { type: 'number', min: 0.0001, max: 0.2, default: 0.0005, unit: 's' },
	release:      { type: 'number', min: 0.005, max: 1, default: 0.03, unit: 's' },
	crossover:    { type: 'number', min: 50, max: 300, default: 120, unit: 'Hz', flags: ['restart'] },
}
