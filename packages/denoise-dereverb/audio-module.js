// audio-module manifest — wraps the late-reverb spectral-subtraction kernel per
// @audio/module CONTRACT. Same streaming shape as denoise-spectral: dereverb.js's
// opts-only call returns a writer(stftStream(...)) function. There is no noise-profile
// argument at all here — the late-reverb tail model is driven entirely by t60 (assumed
// decay time) plus a rolling history of recent frame power, both online/causal by
// construction — so nothing to auto-profile or skip. t60/alpha/beta/predelay are baked
// into the per-frame closure once at construction (makeProcess reads opts.* once, not
// per call — predelay in particular sizes state.history's ring length), so all four
// carry flags:['restart'].
//
// Same FIFO-absorbed variable-length write() + fixed extra delay as denoise-spectral —
// see that package's audio-module.js header for how the 3072-sample figure (frameSize
// 2048 / hopSize 512, both fixed here) was measured.

import dereverb_ from './dereverb.js'

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

export const dereverb = (ctx) => {
	const chans = []
	for (let c = 0, N = ctx.maxChannels ?? 8; c < N; c++) {
		chans.push({
			write: dereverb_({
				t60: ctx.params.t60[0], alpha: ctx.params.alpha[0],
				beta: ctx.params.beta[0], predelay: ctx.params.predelay[0],
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
dereverb.channels = 'any'
dereverb.latency = LATENCY
dereverb.tail = 0
dereverb.params = {
	t60:      { type: 'number', min: 0.1, max: 3, default: 0.5, unit: 's', flags: ['restart'] },
	alpha:    { type: 'number', min: 0, max: 4, default: 1.5, flags: ['restart'] },
	beta:     { type: 'number', min: 0, max: 0.5, default: 0.05, flags: ['restart'] },
	predelay: { type: 'number', min: 0, max: 0.5, default: 0.04, unit: 's', flags: ['restart'] },
}
