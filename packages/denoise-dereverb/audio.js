// atom manifest: wraps the recursive WPE kernel per @audio/compile CONTRACT. Same streaming shape as
// denoise-spectral: dereverb.js's opts-only call returns a writer over stftStream, whose output equals the batch
// (the look-ahead's delay dropped at the start, run out at the end). The prediction adapts to the room by itself:
// nothing to set but how far it looks ahead, which sizes the kernel's ring and the latency, so it carries
// flags:['restart'].
//
// Same primed FIFO as denoise-spectral (see its audio.js header): a constant delay under any block size, here the
// STFT's frame − 1 plus the look-ahead, L·hop, declared per rate and look-ahead.

import dereverb_, { framing } from './dereverb.js'

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

export const dereverb = (ctx) => {
	const chans = [], opts = { fs: ctx.sampleRate, lookahead: ctx.params.lookahead[0] }, L = dereverb.latency(ctx)
	for (let c = 0, C = ctx.maxChannels ?? 8; c < C; c++) chans.push({ write: dereverb_(opts), fifo: makeFifo(L) })
	return (inputs, outputs) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) {
			const ch = chans[c]
			fifoPush(ch.fifo, ch.write(inp[c]))
			fifoPull(ch.fifo, out[c])
		}
	}
}
dereverb.channels = 'any'
dereverb.latency = ({ sampleRate, params }) => {
	let o = framing({ fs: sampleRate, lookahead: params.lookahead[0] })
	return o.frameSize - 1 + o.L * o.hopSize
}
dereverb.tail = 0
dereverb.params = {
	lookahead: { type: 'number', min: 0, max: 1, default: 0.25, unit: 's', flags: ['restart'] },   // 0: the frame's latency alone
}
