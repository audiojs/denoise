// audio-module manifest — wraps the OM-LSA kernel per @audio/module CONTRACT.
// Same streaming shape as denoise-spectral/denoise-wiener: omlsa.js's opts-only call
// returns a writer(stftStream(...)) function. Unlike specsub/wiener, omlsa never takes
// a manual noise profile at all — IMCRA (Cohen 2003) is always-on and fully online, so
// there is no scalarization question here, only live-vs-restart. alphaDD/qPrior/gMin/
// xiFloor are baked into the per-frame gain closure once at construction (makeProcess
// reads opts.* once, not per call), so all carry flags:['restart']. xiFloor mirrors
// denoise-wiener's dB-exposed floor (xiMin = 10**(xiFloor/10)); qPrior is clamped away
// from 0/1 (the kernel divides by 1-qPrior).
//
// Same FIFO-absorbed variable-length write() + fixed extra delay as denoise-spectral —
// see that package's audio-module.js header for how the 3072-sample figure (frameSize
// 2048 / hopSize 512, both fixed here) was measured.

import omlsa_ from './omlsa.js'

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

export const omlsa = (ctx) => {
	const chans = []
	for (let c = 0, N = ctx.maxChannels ?? 8; c < N; c++) {
		chans.push({
			write: omlsa_({
				alphaDD: ctx.params.alphaDD[0],
				xiMin: 10 ** (ctx.params.xiFloor[0] / 10),
				qPrior: ctx.params.qPrior[0],
				gMin: ctx.params.gMin[0],
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
omlsa.channels = 'any'
omlsa.latency = LATENCY
omlsa.tail = 0
omlsa.params = {
	alphaDD: { type: 'number', min: 0.8, max: 0.999, default: 0.92, flags: ['restart'] },
	qPrior:  { type: 'number', min: 0.05, max: 0.95, default: 0.3, flags: ['restart'] },  // a-priori speech absence
	gMin:    { type: 'number', min: -40, max: 0, default: -20, unit: 'dB', flags: ['restart'] },
	xiFloor: { type: 'number', min: -30, max: 0, default: -15, unit: 'dB', flags: ['restart'] },
}
