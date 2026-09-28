// atom manifest — wraps the dehum kernel per @audio/compile CONTRACT.
// dehum measures the hum over the whole signal before it notches anything (without hum it leaves the audio
// untouched: notches where there is no hum only cost speech), so it needs the whole clip: streaming: false, as
// declick and dewow; the host buffers the input and calls process once. Each channel is measured on its own.
// freq 0 measures the mains series (50 or 60 Hz, at its exact frequency); harmonics 0 notches those that stand out.

import dehum_ from './dehum.js'

export const dehum = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) {
			out[c].set(inp[c])
			dehum_(out[c], {
				fs: ctx.sampleRate, freq: params.freq[0], harmonics: Math.round(params.harmonics[0]),
				Q: params.Q[0], adaptive: params.adaptive
			})
		}
	}
}
dehum.channels = 'any'
dehum.streaming = false
dehum.tail = 0
dehum.params = {
	freq:      { type: 'number', min: 0, max: 400, default: 0, unit: 'Hz' },   // 0: measured, 50 or 60 Hz series
	harmonics: { type: 'number', min: 0, max: 40, default: 0 },                  // 0: the harmonics that stand out
	Q:         { type: 'number', min: 1, max: 200, default: 30 },
	adaptive:  { type: 'bool', default: false },                                 // with freq: refine it by measurement
}
