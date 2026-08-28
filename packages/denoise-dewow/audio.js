// atom manifest — wraps the wow & flutter correction kernel per @audio/compile
// CONTRACT. dewow() needs the entire signal before it can produce any output at
// all: the speed curve comes from tracking spectral partials (or a reference
// tone, or pitch) across the *whole* clip, then the whole clip is resampled
// against that curve — exactly the "reads future samples" case `streaming: false`
// is for (see denoise-declick/audio.js, the closest sibling: same whole-buffer
// shape, no FIFO). Host buffers the whole input and calls process once with
// frames = totalFrames. `keepLength` is forced true here regardless of the
// kernel's own default (which already defaults true) — a processor's output
// length must be a pure function of the input length unless it declares `frames`,
// and dewow's whole point is correcting pitch drift without changing duration.
//
// refFreq only matters in mode:'reference'; its default (50, mains-hum
// convention) mirrors denoise-dehum's `freq` default so switching to that mode
// with no override doesn't need a second edit.

import dewow_ from './dewow.js'

export const dewow = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const opts = {
			fs: ctx.sampleRate,
			mode: params.mode,
			refFreq: params.refFreq[0],
			smooth: params.smooth[0],
			maxDeviation: params.maxDeviation[0],
			wow: params.wow,
			flutter: params.flutter,
			keepLength: true,
		}
		const corrected = dewow_(inp, opts) // inp is already Float32Array[] — the whole-clip, all-channels shape dewow() wants
		for (let c = 0; c < inp.length; c++) out[c].set(corrected[c])
	}
}
dewow.channels = 'any'
dewow.streaming = false
dewow.tail = 0
dewow.params = {
	mode:         { type: 'enum', values: ['partial', 'reference', 'pitch'], default: 'partial' },
	refFreq:      { type: 'number', min: 20, max: 20000, default: 50, unit: 'Hz' },
	smooth:       { type: 'number', min: 0.001, max: 5, default: 0.05, unit: 's' },
	maxDeviation: { type: 'number', min: 0, max: 0.5, default: 0.05 },
	wow:          { type: 'bool', default: true },
	flutter:      { type: 'bool', default: true },
}
