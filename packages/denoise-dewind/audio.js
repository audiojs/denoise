// atom manifest — wraps the spectral de-wind kernel per @audio/compile CONTRACT.
// Same streaming shape as denoise-omlsa: dewind.js's opts-only call returns a writer around
// stftStream, here output = input − removal with the input held until its removal is done, so
// with no wind the input comes back sample for sample. cutoff and attenuation are read by the
// frame process on every frame from the options object, so they stay live (a change applies from
// the next frame, no restart). The primed FIFO (see denoise-spectral's audio.js) makes the delay
// a constant frame − 1 under any block size; the frame follows the rate (dewind.js `frame`: the
// power of two nearest 85 ms), so the latency is declared per rate.

import dewind_, { frame } from './dewind.js'

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
// a loop, where out.set(f.buf.subarray(...)) made a view a call
function fifoPull(f, out) {
	let n = out.length, m = Math.min(n, f.len), buf = f.buf
	for (let i = 0; i < m; i++) out[i] = buf[i]
	if (m < n) out.fill(0, m)
	buf.copyWithin(0, m, f.len); f.len -= m
}

export const dewind = (ctx) => {
	const chans = [], N = frame(ctx.sampleRate)
	for (let c = 0, C = ctx.maxChannels ?? 8; c < C; c++) {
		let opts = { fs: ctx.sampleRate, cutoff: ctx.params?.cutoff?.[0], attenuation: ctx.params?.attenuation?.[0] }
		chans.push({ opts, write: dewind_(opts), fifo: makeFifo(N - 1) })
	}
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) {
			const ch = chans[c]
			ch.opts.cutoff = params.cutoff[0]
			ch.opts.attenuation = params.attenuation[0]
			fifoPush(ch.fifo, ch.write(inp[c]))
			fifoPull(ch.fifo, out[c])
		}
	}
}
dewind.channels = 'any'
dewind.latency = ({ sampleRate }) => frame(sampleRate) - 1
// a frame that read the input's last sample spreads its removal over all its N samples, and the frames after read
// silence and give silence: the output ends N − 1 samples past the latency
dewind.tail = ({ sampleRate }) => (frame(sampleRate) - 1) / sampleRate
dewind.params = {
	cutoff:      { type: 'number', min: 200, max: 16000, default: 8000, unit: 'Hz' },  // the band wind is taken from
	attenuation: { type: 'number', min: -40, max: 0, default: -20, unit: 'dB' },      // the most a bin is turned down
}
