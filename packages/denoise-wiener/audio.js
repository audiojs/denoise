// atom manifest — wraps the Wiener/MMSE-LSA kernel per @audio/compile CONTRACT.
// Same streaming shape as denoise-spectral: wiener.js's opts-only call returns a
// writer(stftStream(...)) function that auto-tracks noise PSD online via Minimum
// Statistics (no manual `profile` passed — the Float64Array profile argument can't be
// a contract param, and minStats is the kernel's own auto-profiling default). rule/
// alphaDD/xiFloor are read by the kernel's frame process on every frame from the options
// object, which this manifest updates each block, so all three are live (a change applies
// from the next frame). xiFloor is exposed in dB (xiMin is a linear power-ratio floor
// internally, xiMin = 10**(xiFloor/10) — matches the kernel's own default of 0.0316 ==
// -15dB exactly). alphaDD is per 8 ms of frame step (Ephraim & Malah 1984's), rescaled to
// the step: the same at any rate.
//
// Same primed FIFO as denoise-spectral (see its audio.js header): a constant frame − 1
// delay under any block size.
//
// The stream (`maxChunk`), each channel's array for a write's samples and the FIFO are made in the factory for blocks of
// up to maxBlockSize, and a write puts its samples into that array (write(chunk, out), @audio/stft ≥ 2.1): process
// allocates nothing.

import wiener_, { frame } from './wiener.js'

// the frame follows the rate (wiener.js `frame`: the power of two nearest 32 ms), so the latency is declared per rate
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

export const wiener = (ctx) => {
	const chans = [], N = frame(ctx.sampleRate), hop = N >> 2, B = ctx.maxBlockSize
	for (let c = 0, C = ctx.maxChannels ?? 8; c < C; c++) {
		const opts = { rule: ctx.params.rule, alphaDD: ctx.params.alphaDD[0], xiMin: 10 ** (ctx.params.xiFloor[0] / 10), frameSize: N, hopSize: hop, fs: ctx.sampleRate, maxChunk: B }
		chans.push({ opts, write: wiener_(opts), fifo: makeFifo(N - 1, B), tmp: new Float32Array(B + hop - 1) })
	}
	// xiMin from xiFloor (dB) when xiFloor changes
	const floor = Float64Array.of(ctx.params.xiFloor[0], 10 ** (ctx.params.xiFloor[0] / 10))
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		if (params.xiFloor[0] !== floor[0]) { floor[0] = params.xiFloor[0]; floor[1] = 10 ** (floor[0] / 10) }
		for (let c = 0; c < inp.length; c++) {
			const ch = chans[c]
			ch.opts.rule = params.rule
			ch.opts.alphaDD = params.alphaDD[0]
			ch.opts.xiMin = floor[1]
			room(ch, inp[c].length, hop)
			fifoPush(ch.fifo, ch.tmp, ch.write(inp[c], ch.tmp))
			fifoPull(ch.fifo, out[c])
		}
	}
}
wiener.channels = 'any'
wiener.latency = ({ sampleRate }) => frame(sampleRate) - 1
// a frame that read the input's last sample spreads its gain over all its N samples, and the frames after read silence
// and give silence: the output ends N − 1 samples past the latency
wiener.tail = ({ sampleRate }) => (frame(sampleRate) - 1) / sampleRate
wiener.params = {
	rule:    { type: 'enum', values: ['wiener', 'mmse-lsa'], default: 'mmse-lsa' },
	alphaDD: { type: 'number', min: 0.8, max: 0.999, default: 0.98 },
	xiFloor: { type: 'number', min: -30, max: 0, default: -15, unit: 'dB' },
}
