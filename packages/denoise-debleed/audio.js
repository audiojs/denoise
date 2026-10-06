// atom manifest: wraps the de-bleed kernel per @audio/compile CONTRACT §channels: the mic on bus 0, the bleeding
// source's own track (the reference) on bus 1, the mic out. The op runs the kernel's batch call: the path learned over
// the whole take, then removed in a second pass from where the first ended, so a static path is cancelled from the
// first sample and a track that never bled is left alone. It needs the whole clip: streaming: false, as dereverb; the
// host hands both buses in one block (its `key` option, as the ducker's: an audio instance or channel data,
// rate-reconciled). Each mic channel's canceller hears every reference channel (both mics of a pair hear a stereo
// source). With no reference (bus 1 undefined, or silent) the sound passes untouched, sample for sample. The kernel's
// stream, which learns as it goes and cancels only where the evidence has proved a path, stays the programmatic API.

import debleed_ from './debleed.js'

export const debleed = (ctx) => (inputs, outputs, params) => {
	const inp = inputs[0], key = inputs[1], out = outputs[0]
	if (!inp || !inp.length) return
	const opts = { fs: ctx.sampleRate, attenuation: params.attenuation[0], span: params.span[0] }
	for (let c = 0; c < inp.length; c++) {
		out[c].set(inp[c])
		if (key?.length) debleed_(out[c], key, opts)
	}
}
debleed.channels = { inputs: [2, 2], outputs: [2] }
debleed.streaming = false
debleed.tail = 0
debleed.params = {
	attenuation: { type: 'number', min: -40, max: 0, default: -20, unit: 'dB' },  // the most the residual is turned down
	span:        { type: 'number', min: 0.05, max: 1, default: 0.3, unit: 's' },  // the path the filter learns
}
