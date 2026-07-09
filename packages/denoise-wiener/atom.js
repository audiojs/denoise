// atom manifest — wraps the Wiener/MMSE-LSA kernel per @audio/atom CONTRACT.
// Same streaming shape as denoise-spectral: wiener.js's opts-only call returns a
// writer(stftStream(...)) function that auto-tracks noise PSD online via Minimum
// Statistics (no manual `profile` passed — the Float64Array profile argument can't be
// a contract param, and minStats is the kernel's own auto-profiling default). rule/
// alphaDD/xiFloor are baked into the per-frame gain closure once at construction
// (makeProcess reads opts.* once, not per call), so all three carry flags:['restart'].
// xiFloor is exposed in dB (xiMin is a linear power-ratio floor internally, xiMin =
// 10**(xiFloor/10) — matches the kernel's own default of 0.0316 == -15dB exactly).
//
// Same FIFO-absorbed variable-length write() + fixed extra delay as denoise-spectral —
// see that package's atom.js header for how the 3072-sample figure (frameSize
// 2048 / hopSize 512, both fixed here) was measured.

import wiener_ from './wiener.js'

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

export const wiener = (ctx) => {
	const chans = []
	for (let c = 0, N = ctx.maxChannels ?? 8; c < N; c++) {
		chans.push({
			write: wiener_({
				rule: ctx.params.rule, alphaDD: ctx.params.alphaDD[0],
				xiMin: 10 ** (ctx.params.xiFloor[0] / 10),
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
wiener.channels = 'any'
wiener.latency = LATENCY
wiener.tail = 0
wiener.params = {
	rule:    { type: 'enum', values: ['wiener', 'mmse-lsa'], default: 'mmse-lsa', flags: ['restart'] },
	alphaDD: { type: 'number', min: 0.8, max: 0.999, default: 0.98, flags: ['restart'] },
	xiFloor: { type: 'number', min: -30, max: 0, default: -15, unit: 'dB', flags: ['restart'] },
}
