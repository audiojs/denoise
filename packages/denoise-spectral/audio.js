// atom manifest — wraps the spectral-subtraction kernel per @audio/compile CONTRACT.
// specsub.js exposes a streaming API (opts-only call returns a writer(stftStream(...))
// function) that auto-tracks the noise PSD online via Minimum Statistics whenever no
// manual `profile` is supplied — that auto path is what this manifest uses (a Float64Array
// profile can't be a contract param anyway, and minStats is exactly the "auto-profiling
// default" the kernel already supports). alpha/beta are baked into the kernel's per-frame
// gain closure at construction (makeProcess reads opts.alpha/opts.beta once, not per call),
// so both carry flags:['restart'].
//
// stftStream.write(chunk) returns a variable-length burst: a sample leaves once no later
// frame covers it, at most FRAME − 1 samples after it arrived (@audio/stft ≥ 1.0.7), with
// output sample j aligned to input sample j. A per-channel FIFO primed with FRAME − 1 zeros
// turns the bursts into the equal-frames-in/out shape §process requires: it never runs dry,
// so the delay is exactly FRAME − 1 under any block size (pinned in test.js).

import specsub_ from './specsub.js'

const FRAME = 2048, HOP = 512
const LATENCY = FRAME - 1

function makeFifo() { return { buf: new Float32Array(1 << 14), len: LATENCY } }   // primed with zeros
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

export const specsub = (ctx) => {
	const chans = []
	for (let c = 0, N = ctx.maxChannels ?? 8; c < N; c++) {
		chans.push({
			write: specsub_({
				alpha: ctx.params.alpha[0], beta: ctx.params.beta[0],
				frameSize: FRAME, hopSize: HOP, fs: ctx.sampleRate
			}),
			fifo: makeFifo()
		})
	}
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
specsub.channels = 'any'
specsub.latency = LATENCY
specsub.tail = 0
specsub.params = {
	alpha: { type: 'number', min: 1, max: 6, default: 2.0, flags: ['restart'] },       // over-subtraction
	beta:  { type: 'number', min: 0, max: 0.5, default: 0.02, unit: '', flags: ['restart'] }, // spectral floor
}
