// atom manifest — wraps the spectral de-wind kernel per @audio/compile CONTRACT.
// Same streaming shape as denoise-omlsa: dewind.js's opts-only call returns a writer around
// stftStream, here output = input − removal with the input held until its removal is done, so
// with no wind the input comes back sample for sample. cutoff and attenuation are read by the
// frame process on every frame from the options object, so they stay live (a change applies from
// the next frame, no restart). The primed FIFO (see denoise-spectral's audio.js) makes the delay
// a constant frame − 1 under any block size; the frame follows the rate (dewind.js `frame`: the
// power of two nearest 85 ms), so the latency is declared per rate.
//
// The stream (`maxChunk`), each channel's array for a write's samples and the FIFO are made in the factory for blocks of
// up to maxBlockSize, and a write puts its samples into that array (write(chunk, out), @audio/stft ≥ 2.1): process
// allocates nothing.

import dewind_, { frame } from './dewind.js'

// The FIFO holds at most the frame − 1 it is primed with and a block, made for that; a block over maxBlockSize grows it
function makeFifo(L, B) { return { buf: new Float32Array(L + B), len: L } }   // primed with zeros
// the n samples a write put into src
function fifoPush(f, src, n) {
	if (f.len + n > f.buf.length) { let nb = new Float32Array(2 * (f.len + n)); nb.set(f.buf.subarray(0, f.len)); f.buf = nb }
	for (let i = 0; i < n; i++) f.buf[f.len + i] = src[i]
	f.len += n
}
// what a write makes final, at most the block and a hop less one (@audio/stft's bound): an array for it per channel, made
// for maxBlockSize, grown by a longer block (sized short, the rest would wait and the latency shift)
function room(ch, n, hop) { if (n + hop - 1 > ch.tmp.length) ch.tmp = new Float32Array(n + hop - 1) }
// a loop, where out.set(f.buf.subarray(...)) made a view a call
function fifoPull(f, out) {
	let n = out.length, m = Math.min(n, f.len), buf = f.buf
	for (let i = 0; i < m; i++) out[i] = buf[i]
	if (m < n) out.fill(0, m)
	buf.copyWithin(0, m, f.len); f.len -= m
}

export const dewind = (ctx) => {
	const chans = [], N = frame(ctx.sampleRate), hop = N >> 2, B = ctx.maxBlockSize
	for (let c = 0, C = ctx.maxChannels ?? 8; c < C; c++) {
		let opts = { fs: ctx.sampleRate, cutoff: ctx.params?.cutoff?.[0], attenuation: ctx.params?.attenuation?.[0], maxChunk: B }
		chans.push({ opts, write: dewind_(opts), fifo: makeFifo(N - 1, B), tmp: new Float32Array(B + hop - 1) })
	}
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) {
			const ch = chans[c]
			ch.opts.cutoff = params.cutoff[0]
			ch.opts.attenuation = params.attenuation[0]
			room(ch, inp[c].length, hop)
			fifoPush(ch.fifo, ch.tmp, ch.write(inp[c], ch.tmp))
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
