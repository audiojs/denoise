// atom manifest: wraps the LF-burst remover per @audio/compile CONTRACT. deplosive.js's `block` runs each block through
// its stream, `latency(fs)` samples late (its linear-phase low band reads that far ahead); the latency is declared, so
// the host aligns the output. Each channel's memory is the kernel's `state`, typed arrays made here, so process
// allocates nothing. triggerRatio, attenuation, attack and release are read on every block; crossover too: it sets only
// the low band's taps, redesigned in place when it changes (their count, and so the latency, does not depend on it).

import { state, tune, block, latency } from './deplosive.js'

export const deplosive = (ctx) => {
	const fs = ctx.sampleRate, chans = []
	for (let c = 0, N = ctx.maxChannels ?? 8; c < N; c++) chans.push(state(fs, ctx.params.crossover[0]))
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const tR = params.triggerRatio[0], depth = 1 - Math.pow(10, params.attenuation[0] / 20)
		const aA = Math.exp(-1 / (params.attack[0] * fs)), aR = Math.exp(-1 / (params.release[0] * fs))
		for (let c = 0; c < inp.length; c++) {
			const s = chans[c], v = s.v
			v[0] = tR; v[1] = depth; v[2] = aA; v[3] = aR
			tune(s, params.crossover[0])
			block(s, inp[c], out[c])
		}
	}
}
deplosive.channels = 'any'
deplosive.latency = ({ sampleRate }) => latency(sampleRate)
// a duck holding as the input stops takes away the low band, linear-phase, whose response spans twice its delay: the
// output goes on `latency` samples past the latency (with no duck it is the input, delayed, and ends there)
deplosive.tail = ({ sampleRate }) => latency(sampleRate) / sampleRate
deplosive.params = {
	triggerRatio: { type: 'number', min: 0.25, max: 20, default: 1 },           // LF over the voice band a pop must exceed
	attenuation:  { type: 'number', min: -60, max: 0, default: -40, unit: 'dB' },
	attack:       { type: 'number', min: 0.0001, max: 0.2, default: 0.0005, unit: 's' },
	release:      { type: 'number', min: 0.005, max: 1, default: 0.03, unit: 's' },
	crossover:    { type: 'number', min: 50, max: 300, default: 120, unit: 'Hz' },
}
