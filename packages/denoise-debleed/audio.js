// atom manifest: wraps the de-bleed kernel per @audio/compile CONTRACT §channels: the mic on bus 0, the bleeding
// source's own track (the reference) on bus 1, the mic out. The audio host feeds bus 1 as it feeds the ducker's key
// (its `key` option: an audio instance or channel data, rendered per block, rate-reconciled); each mic channel's
// canceller hears every reference channel (both mics of a pair hear a stereo source). With no reference (bus 1
// undefined, or silent) the sound passes untouched, sample for sample. debleed.js's stream returns the samples done,
// up to 2B − 1 behind (B = block(rate), 512 at 44.1 and 48 kHz); a primed FIFO (see denoise-spectral's audio.js)
// makes that a constant 2B − 1, the declared latency. `attenuation` is read every block, `span` sizes the filter
// (restart). The stream learns the path's level as it goes; the batch call's two passes need the whole take.

import debleed_, { block } from './debleed.js'

function makeFifo(L) { return { buf: new Float32Array(1 << 14), len: L } }   // primed with zeros
function fifoPush(f, chunk) {
	if (!chunk.length) return
	let need = f.len + chunk.length
	if (need > f.buf.length) {
		let nb = new Float32Array(Math.max(need * 2, f.buf.length * 2))
		nb.set(f.buf.subarray(0, f.len)); f.buf = nb
	}
	f.buf.set(chunk, f.len); f.len += chunk.length
}
function fifoPull(f, out) {
	let n = out.length
	if (f.len >= n) { out.set(f.buf.subarray(0, n)); f.buf.copyWithin(0, n, f.len); f.len -= n }
	else { out.set(f.buf.subarray(0, f.len)); out.fill(0, f.len); f.len = 0 }
}

export const debleed = (ctx) => {
	const chans = [], L = 2 * block(ctx.sampleRate) - 1
	for (let c = 0, C = ctx.maxChannels ?? 8; c < C; c++) {
		let opts = { fs: ctx.sampleRate, attenuation: ctx.params?.attenuation?.[0], span: ctx.params?.span?.[0] }
		chans.push({ opts, write: debleed_(opts), fifo: makeFifo(L) })
	}
	return (inputs, outputs, params) => {
		const inp = inputs[0], key = inputs[1], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) {
			const ch = chans[c]
			ch.opts.attenuation = params.attenuation[0]
			fifoPush(ch.fifo, ch.write(inp[c], key?.length ? key : null))
			fifoPull(ch.fifo, out[c])
		}
	}
}
debleed.channels = { inputs: [2, 2], outputs: [2] }
debleed.latency = ({ sampleRate }) => 2 * block(sampleRate) - 1
debleed.tail = 0
debleed.params = {
	attenuation: { type: 'number', min: -40, max: 0, default: -20, unit: 'dB' },                    // the most the residual is turned down
	span:        { type: 'number', min: 0.05, max: 1, default: 0.3, unit: 's', flags: ['restart'] },  // the path the filter learns
}
