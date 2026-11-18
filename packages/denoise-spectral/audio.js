// atom manifest — wraps the spectral-subtraction kernel per @audio/compile CONTRACT.
// specsub.js exposes a streaming API (opts-only call returns a writer(stftStream(...))
// function) that auto-tracks the noise PSD online via Minimum Statistics whenever no
// manual `profile` is supplied — that auto path is what this manifest uses (a Float64Array
// profile can't be a contract param anyway, and minStats is exactly the "auto-profiling
// default" the kernel already supports). alpha/beta are read by the kernel's frame process on
// every frame from the options object, which this manifest updates each block, so both are
// live (a change applies from the next frame).
//
// stftStream.write(chunk) returns a variable-length burst: a sample leaves once no later
// frame covers it, at most frame − 1 samples after it arrived (@audio/stft ≥ 1.0.7), with
// output sample j aligned to input sample j. A per-channel FIFO primed with frame − 1 zeros
// turns the bursts into the equal-frames-in/out shape §process requires: it never runs dry,
// so the delay is exactly frame − 1 under any block size (pinned in test.js).
//
// The stream (`maxChunk`), each channel's array for a write's samples and the FIFO are made in the factory for blocks of
// up to maxBlockSize, and a write puts its samples into that array (write(chunk, out), @audio/stft ≥ 2.1): process
// allocates nothing.

import specsub_, { frame } from './specsub.js'

// the frame follows the rate (specsub.js `frame`: the power of two nearest 32 ms), so the latency is declared per rate
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

export const specsub = (ctx) => {
	const chans = [], N = frame(ctx.sampleRate), hop = N >> 2, B = ctx.maxBlockSize
	for (let c = 0, C = ctx.maxChannels ?? 8; c < C; c++) {
		const opts = { alpha: ctx.params.alpha[0], beta: ctx.params.beta[0], frameSize: N, hopSize: hop, fs: ctx.sampleRate, maxChunk: B }   // alpha 0: Berouti's α(SNR)
		chans.push({ opts, write: specsub_(opts), fifo: makeFifo(N - 1, B), tmp: new Float32Array(B + hop - 1) })
	}
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		for (let c = 0; c < inp.length; c++) {
			const ch = chans[c]
			ch.opts.alpha = params.alpha[0]
			ch.opts.beta = params.beta[0]
			room(ch, inp[c].length, hop)
			fifoPush(ch.fifo, ch.tmp, ch.write(inp[c], ch.tmp))
			fifoPull(ch.fifo, out[c])
		}
	}
}
specsub.channels = 'any'
specsub.latency = ({ sampleRate }) => frame(sampleRate) - 1
// a frame that read the input's last sample spreads its gain over all its N samples, and the frames after read silence
// and give silence: the output ends N − 1 samples past the latency
specsub.tail = ({ sampleRate }) => (frame(sampleRate) - 1) / sampleRate
specsub.params = {
	alpha: { type: 'number', min: 0, max: 6, default: 0 },         // over-subtraction; 0: α(SNR), 4.75..1
	beta:  { type: 'number', min: 0, max: 0.5, default: 0.05 },    // spectral floor, × noise
}
