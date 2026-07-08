// audio-module manifest — wraps the spectral-subtraction kernel per @audio/module CONTRACT.
// specsub.js exposes a streaming API (opts-only call returns a writer(stftStream(...))
// function) that auto-tracks the noise PSD online via Minimum Statistics whenever no
// manual `profile` is supplied — that auto path is what this manifest uses (a Float64Array
// profile can't be a contract param anyway, and minStats is exactly the "auto-profiling
// default" the kernel already supports). alpha/beta are baked into the kernel's per-frame
// gain closure at construction (makeProcess reads opts.alpha/opts.beta once, not per call),
// so both carry flags:['restart'].
//
// stftStream.write(chunk) returns a variable-length burst (STFT hop/frame bookkeeping is
// not 1:1 with input chunking) — a per-channel FIFO absorbs that into the fixed
// equal-frames-in/out shape §process requires, at a fixed extra delay. That delay was
// measured directly (feed white noise through fs=44100/frameSize=2048/hopSize=512 at
// alpha=0,beta=1 — an exact passthrough since cleaned=p-0 and floor=1*p leave mag
// unchanged — then cross-correlate output against input): 3072 samples, confirmed to
// floating-point-exact residual (8e-16) and independently by input/output sample-count
// bookkeeping. 3072 = 1.5x frameSize = 6x hopSize.

import specsub_ from './specsub.js'

const FRAME = 2048, HOP = 512
const LATENCY = 3072

function makeFifo() { return { buf: new Float32Array(1 << 14), len: 0 } }
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
