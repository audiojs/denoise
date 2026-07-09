// Spectral repair (iZotope RX class) — replace time×frequency holes by interpolating
// the spectrogram across each region: log-magnitude interpolated between the last clean
// frame before and first clean frame after, phase advanced coherently from the leading
// context (phase-vocoder style). Full-band regions repair dropouts/gaps; band-limited
// regions repair chirps/beeps/holes without touching surrounding content.

import { fft } from 'fourier-transform'
import { stftBatch, hannWindow } from '@audio/stft'

// analyze one frame's half-spectrum at pos (mag + phase copies)
function analyze (data, pos, win, half) {
	let N = win.length
	let f = new Float64Array(N)
	for (let i = 0; i < N; i++) f[i] = (data[pos + i] || 0) * win[i]
	let [re, im] = fft(f)
	let mag = new Float64Array(half + 1), phase = new Float64Array(half + 1)
	for (let k = 0; k <= half; k++) {
		mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
		phase[k] = Math.atan2(im[k], re[k])
	}
	return { mag, phase }
}

/**
 * @param {Float32Array} data — mono PCM
 * @param {object} opts — {
 *   regions: [{ at, duration, from = 0, to = fs/2 }] — seconds / Hz, required
 *   frameSize = 2048, hopSize = 512, fs = 44100
 * }
 * @returns {Float32Array} repaired copy
 */
export default function repair (data, opts = {}) {
	let regions = opts.regions
	if (!regions?.length) throw new RangeError('repair: opts.regions is required')
	let N = opts.frameSize ?? 2048
	let hop = opts.hopSize ?? (N >> 2)
	let fs = opts.fs ?? 44100
	let half = N >> 1
	let win = hannWindow(N)
	let binHz = fs / N

	// per region: frame span touching the gap + clean context frames fully outside it
	let regs = regions.map(r => {
		let a = Math.round(r.at * fs), b = Math.round((r.at + r.duration) * fs)
		let fPre = Math.max(0, Math.floor((a - N) / hop))        // last frame fully before
		let fPost = Math.ceil(b / hop)                           // first frame fully after
		let pre = analyze(data, fPre * hop, win, half)
		let prePre = analyze(data, Math.max(0, fPre - 1) * hop, win, half)
		let post = fPost * hop + N <= data.length ? analyze(data, fPost * hop, win, half) : pre
		// measured per-hop phase advance (phase vocoder): handles off-bin tones exactly
		let adv = new Float64Array(half + 1)
		for (let k = 0; k <= half; k++) {
			let expected = 2 * Math.PI * hop * k / N
			let d = pre.phase[k] - prePre.phase[k] - expected
			d -= 2 * Math.PI * Math.round(d / (2 * Math.PI))
			adv[k] = expected + (fPre > 0 ? d : 0)
		}
		return {
			f0: fPre + 1, f1: fPost - 1, pre, post, adv,
			b0: Math.max(0, Math.round((r.from ?? 0) / binHz)),
			b1: Math.min(half, Math.round((r.to ?? fs / 2) / binHz)),
		}
	})

	let idx = -1
	return stftBatch(data, (mag, phase, state) => {
		idx++
		for (let r of regs) {
			if (idx < r.f0 || idx > r.f1) continue
			let t = (idx - r.f0 + 1) / (r.f1 - r.f0 + 2)           // interp position in the hole
			for (let k = r.b0; k <= r.b1; k++) {
				// log-magnitude interpolation between clean context frames
				mag[k] = Math.exp((1 - t) * Math.log(r.pre.mag[k] + 1e-12) + t * Math.log(r.post.mag[k] + 1e-12))
				// coherent phase: pre-context phase advanced by the measured per-hop rotation
				phase[k] = r.pre.phase[k] + (idx - r.f0 + 1) * r.adv[k]
			}
		}
		return { mag, phase }
	}, { frameSize: N, hopSize: hop, fs })
}
