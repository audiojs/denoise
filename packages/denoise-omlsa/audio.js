// atom manifest — wraps the OM-LSA kernel per @audio/compile CONTRACT.
// Same streaming shape as denoise-spectral/denoise-wiener: omlsa.js's opts-only call
// returns a writer(stftStream(...)) function. Unlike specsub/wiener, omlsa never takes
// a manual noise profile at all — IMCRA (Cohen 2003) is always-on and fully online, so
// there is no scalarization question here, only live-vs-restart. alphaDD/qPrior/gMin/
// xiFloor are baked into the per-frame gain closure once at construction (makeProcess
// reads opts.* once, not per call), so all carry flags:['restart']. xiFloor mirrors
// denoise-wiener's dB-exposed floor (xiMin = 10**(xiFloor/10)). qPrior 0 (the default)
// leaves the a priori speech absence to the kernel's estimate (Cohen & Berdugo 2001 §4);
// a value above 0 fixes it (at 0.9 and over, no bin counts as speech). alphaDD is per 8 ms
// of frame step (Table 1's time base), rescaled to the step, so it means the same at any rate.
//
// Same primed FIFO as denoise-spectral (see its audio.js header): a constant frame − 1
// delay under any block size. The frame follows the rate (omlsa.js `frame`: the power of
// two nearest 32 ms), so the latency is declared per rate.

import omlsa_, { frame } from './omlsa.js'

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

export const omlsa = (ctx) => {
	const chans = [], N = frame(ctx.sampleRate)
	for (let c = 0, C = ctx.maxChannels ?? 8; c < C; c++) {
		chans.push({
			write: omlsa_({
				alphaDD: ctx.params.alphaDD[0],
				xiMin: 10 ** (ctx.params.xiFloor[0] / 10),
				qPrior: ctx.params.qPrior[0],
				gMin: ctx.params.gMin[0],
				threshold: ctx.params.threshold[0],
				frameSize: N, hopSize: N >> 2, fs: ctx.sampleRate
			}),
			fifo: makeFifo(N - 1)
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
omlsa.latency = ({ sampleRate }) => frame(sampleRate) - 1
omlsa.tail = 0
omlsa.params = {
	alphaDD: { type: 'number', min: 0.8, max: 0.999, default: 0.97, flags: ['restart'] },   // per 8 ms of frame step
	qPrior:  { type: 'number', min: 0, max: 0.95, default: 0, flags: ['restart'] },       // a-priori speech absence; 0: estimated
	gMin:    { type: 'number', min: -40, max: 0, default: -15, unit: 'dB', flags: ['restart'] },
	xiFloor: { type: 'number', min: -30, max: 0, default: -25, unit: 'dB', flags: ['restart'] },
	threshold: { type: 'number', min: -10, max: 20, default: 0, unit: 'dB', flags: ['restart'] },   // the noise read this much louder
}
