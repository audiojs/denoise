// atom manifest — wraps the dehum kernel per @audio/compile CONTRACT.
// dehum measures the hum over the whole signal and fits each harmonic over a second either side (without hum it
// leaves the audio untouched), so it needs the whole clip: streaming: false, as declick and dewow; the host buffers the
// input and calls process once. Each channel is measured on its own.
// freq 0 finds the mains series (50 or 60 Hz, its frequency tracked); harmonics 0 removes every harmonic to 1 kHz and
// each line above it that stands out, to 8 kHz.

import dehum_ from './dehum.js'

export const dehum = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) {
			out[c].set(inp[c])
			dehum_(out[c], {
				fs: ctx.sampleRate, freq: params.freq[0], harmonics: Math.round(params.harmonics[0]), adaptive: params.adaptive
			})
		}
	}
}
dehum.channels = 'any'
dehum.streaming = false
dehum.tail = 0
dehum.params = {
	freq:      { type: 'number', min: 0, max: 400, default: 0, unit: 'Hz' },   // 0: measured, 50 or 60 Hz series
	harmonics: { type: 'number', min: 0, max: 40, default: 0 },                  // 0: to 1 kHz and the lines above, to 8 kHz
	adaptive:  { type: 'bool', default: false },                                 // with freq: search it within ±0.5 Hz
}
