// Spectral repair (iZotope RX class): rebuild damaged time × frequency regions from their
// surroundings. Four tiers; `method: 'auto'` routes each region by length and content, on
// thresholds measured in the README:
//   'ar'          gap-wise Janssen: AR(N/2) fitted to 2N of context either side with the gap
//                 zeroed, least-squares fill (lpc arBridge), refit on the filled segment, refill
//                 (Janssen, Veldhuis & Vries 1986; gap-wise, Mokrý & Rajmic 2025)
//   'sinusoidal'  partials tracked either side (sinusoidal-track), measured at the frames touching
//                 the gap, matched by frequency and bridged with cubic phase (McAulay & Quatieri
//                 1986), over the context's residual floor log-interpolated across the gap and
//                 shaped from white noise (Serra & Smith 1990)
//   'similarity'  the passage within `window` s whose half-second contexts best match the gap's
//                 (dB-spectrogram distance, Perraudin et al. 2018), aligned to the sample by
//                 correlation, transplanted
//   'spectral'    log-magnitude interpolation between the clean frames either side, each frame's
//                 phase advanced from the nearer side (phase vocoder), so both edges line up
// Each fill but AR's is first brought to the program's level and spectrum at both edges (match), then
// joins it by a crossfade over the good audio at each edge, as short as the seams allow (XF).
// Band-limited regions take only their band from the joined fill, frame by frame.
// Samples beyond the crossfades, or beyond the frames overlapping a band-limited region, are
// returned untouched.

import { fft } from 'fourier-transform'
import { stftBatch, hannWindow } from '@audio/stft'
import { arFit, arBridge } from '@audio/lpc'
import track from '@audio/sinusoidal-track'

const PI2 = 2 * Math.PI
const princ = x => x - PI2 * Math.round(x / PI2)
const clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x

// 'auto' routing, measured (README "Measured"): AR up to AR_MAX s, the sinusoidal bridge beyond, unless
// a similarity transplant correlates with the gap's surroundings, once aligned, by R_LONG, or by R_SHORT
// up to AR_MAX (r = 0.995 is a match to 20 dB SNR, −10·log10(1 − r²): only a near-exact repeat beats AR
// there). Band-limited regions route alike.
const AR_MAX = 0.03, R_SHORT = 0.995, R_LONG = 0.4
// Crossfade at each edge, s: the shortest after which the seams show no more onsets (mel onset
// strength, as librosa's) or clicks (bursts of the AR residual) than the original has around them,
// on speech and music (README "Seams"). 2 ms ends the clicks; once match() has brought the fill to the
// program's level and spectrum at the edges, 5 ms ends the bridge's onsets too (15 ms without it). AR's
// least-squares fill is continuous with its context and needs none. What shows past 5 ms is the content
// itself: a transplant joins in 5 ms only when it repeats the program (aligned r ≥ R_REPEAT), a looser
// match keeps the frame-long transition of Perraudin et al.; spectral keeps 30 ms. GAIN: the most, dB,
// match() lifts or cuts a band at an edge.
const XF = { ar: 0, sinusoidal: 0.005, similarity: 0.005, spectral: 0.03 }, R_REPEAT = 0.9, GAIN = 12
const METHODS = ['auto', 'ar', 'sinusoidal', 'similarity', 'spectral']

function options(opts) {
	if (!opts.regions?.length) throw new RangeError('repair: opts.regions is required')
	let fs = opts.fs ?? 44100, N = opts.frameSize ?? 2048
	return { fs, N, hop: opts.hopSize ?? (N >> 2), method: opts.method ?? 'auto', window: opts.window ?? 10 }
}

// region → samples [a, b) within the data, band [f0, f1] Hz, full-band flag
function span(r, o, n) {
	if (!Number.isFinite(r.at) || !(r.duration >= 0)) throw new RangeError('repair: a region needs `at` and `duration` in seconds')
	let a = clamp(Math.round(r.at * o.fs), 0, n), b = clamp(Math.round((r.at + r.duration) * o.fs), a, n)
	let f0 = r.from ?? 0, f1 = r.to ?? o.fs / 2
	return { a, b, f0, f1, full: f0 <= 0 && f1 >= o.fs / 2 }
}

/**
 * Resolve each region's method ('auto' → a tier) and, for 'similarity', its `source` (seconds: where
 * the transplanted passage starts). Pass the result back as `regions` to repair several channels alike.
 */
export function plan(data, opts = {}) {
	let o = options(opts)
	return opts.regions.map(r => ({ ...r, ...resolve(data, r, o) }))
}

function resolve(x, r, o) {
	let method = r.method ?? o.method
	if (!METHODS.includes(method)) throw new RangeError(`repair: unknown method '${method}'`)
	if (method === 'similarity' && r.source != null) return { method, source: r.source }
	let { a, b } = span(r, o, x.length), D = (b - a) / o.fs
	if (method === 'similarity' || method === 'auto') {
		let m = similar(x, a, b, o)
		if (m && (method === 'similarity' || m.r >= (D <= AR_MAX ? R_SHORT : R_LONG))) return { method: 'similarity', source: (a + m.d) / o.fs }
		if (method === 'similarity') return { method: 'sinusoidal' }   // no passage to copy within the window
	}
	if (method !== 'auto') return { method }
	return { method: D <= AR_MAX ? 'ar' : 'sinusoidal' }
}

/**
 * @param {Float32Array} data — mono PCM
 * @param {object} opts — {
 *   regions: [{ at, duration, from = 0, to = fs/2, method?, source? }]: seconds / Hz, required
 *   method = 'auto' | 'ar' | 'sinusoidal' | 'similarity' | 'spectral', window = 10 (s, similarity search),
 *   frameSize = 2048, hopSize = frameSize/4, fs = 44100
 * }
 * @returns {Float32Array} repaired copy
 */
export default function repair(data, opts = {}) {
	let o = options(opts), out = Float32Array.from(data), n = out.length
	for (let r of opts.regions) {
		let { a, b, f0, f1, full } = span(r, o, n)
		if (b <= a) continue
		let { method, source } = resolve(out, r, o)
		let X = Math.min(Math.round(XF[method] * o.fs), a, n - b), fill
		if (method === 'ar') fill = arFill(out, a, b, o)
		else if (method === 'sinusoidal') fill = sineFill(out, a, b, o)
		else if (method === 'spectral') fill = specFill(out, a, b, o)
		else {
			let d = Math.round(source * o.fs) - a
			if (a + d < 0 || b + d > n || (d < b - a && d > a - b)) throw new RangeError('repair: similarity source must be a clean passage as long as the region')
			if (corr(out, a, b, d, o.N) < R_REPEAT) X = o.N
			X = Math.max(0, Math.min(X, a, n - b, a + d, n - b - d, Math.abs(d) - (b - a)))
			// the passage with its surroundings a frame either side, where they are clean: match() reads them beside the edges
			fill = Float32Array.from(out)
			for (let i = Math.max(0, a - o.N, -d); i < Math.min(n, b + o.N, n - d); i++) if ((i >= a && i < b) || i + d < a || i + d >= b) fill[i] = out[i + d]
		}
		if (method !== 'ar') fill = match(out, fill, a, b, o)
		let y = full ? out : Float32Array.from(out)
		splice(y, fill, a, b, X)
		if (!full) bandSplice(out, y, a, b, f0, f1, o)
	}
	return out
}

// x ← fill over [a, b), crossfaded with x over the X samples either side, in place: the fill's gain w
// rises as sin², the program's g solves g² + w² + 2ρgw = 1 for the two signals' correlation ρ there,
// so the power holds whether the fill continues the program (ρ = 1: equal gain) or only resembles it
// (ρ = 0: equal power) (Fink, Holters & Zölzer, DAFx 2016)
function splice(x, fill, a, b, X) {
	let n0 = Math.max(0, a - X), n1 = Math.min(x.length, b + X), rL = rho(x, fill, n0, a), rR = rho(x, fill, b, n1)
	for (let n = n0; n < n1; n++) {
		if (n >= a && n < b) { x[n] = fill[n]; continue }
		let w = n < a ? Math.sin(Math.PI / 2 * (n - a + X + 0.5) / X) ** 2 : Math.cos(Math.PI / 2 * (n - b + 0.5) / X) ** 2, r = n < a ? rL : rR
		x[n] = (Math.sqrt(1 - w * w * (1 - r * r)) - r * w) * x[n] + w * fill[n]
	}
}
const rho = (x, y, p, q) => { let s = 0, u = 0, v = 0; for (let n = p; n < q; n++) s += x[n] * y[n], u += x[n] * x[n], v += y[n] * y[n]; return clamp(s / Math.sqrt(u * v + 1e-30), 0, 1) }

// The fill meets the program at both edges in level and spectrum before it joins: per 1/3-octave band, the program's
// power over the N/4 + N/16 samples of good audio beside an edge (15 ms at 44.1 kHz: two N/4 frames, N/16 apart) against
// the fill's there gives that edge's gain (within ±GAIN dB), and the gain runs log-linearly from the left edge's to the
// right's across the gap, on the fill's STFT. A transplant from a quieter or darker passage, a bridge measured a frame
// from the edge, a spectral fill short of power: each arrives at the program's level, and the crossfade has only the
// waveform left to join. AR's fill is the program itself outside the gap, so it has nothing to match.
function match(x, fill, a, b, { fs, N, hop }) {
	let M = N >> 2, win = hannWindow(M), E = bands(M, fs), lim = GAIN / 20 * Math.LN10
	let gain = side => {   // ln amplitude per band
		let px = new Float64Array(E.length - 1), pf = new Float64Array(E.length - 1)
		for (let i = 0; i < 2; i++) { let s = side < 0 ? a - M - i * (M >> 2) : b + i * (M >> 2); bandPower(x, s, win, E, px); bandPower(fill, s, win, E, pf) }
		return Float64Array.from(px, (p, q) => p > 0 && pf[q] > 0 ? clamp(0.5 * Math.log(p / pf[q]), -lim, lim) : 0)
	}
	// per bin of the N-point frame: linear between band centres
	let cen = E.slice(0, -1).map((e, q) => (e + E[q + 1] - 1) / 2 * fs / M), perBin = g => Float64Array.from({ length: (N >> 1) + 1 }, (_, k) => {
		let f = k * fs / N, q = 0
		while (q + 1 < cen.length && cen[q + 1] <= f) q++
		return q + 1 < cen.length && f > cen[q] ? g[q] + (g[q + 1] - g[q]) * (f - cen[q]) / (cen[q + 1] - cen[q]) : g[q]
	})
	let gL = perBin(gain(-1)), gR = perBin(gain(1)), s0 = Math.max(0, a - 2 * N), s1 = Math.min(x.length, b + 2 * N)
	let y = stftBatch(fill.subarray(s0, s1), (mag, phase, state, ctx) => {
		let u = clamp((s0 + ctx.pos + N / 2 - a) / Math.max(1, b - a), 0, 1)
		for (let k = 0; k < mag.length; k++) mag[k] *= Math.exp((1 - u) * gL[k] + u * gR[k])
		return { mag, phase }
	}, { frameSize: N, hopSize: hop, fs })
	let out = Float32Array.from(fill)
	for (let n = Math.max(s0, a - N); n < Math.min(s1, b + N); n++) out[n] = y[n - s0]
	return out
}

// 1/3-octave bands of an M-point spectrum as bin edges, the first from DC to 2 bins
function bands(M, fs) {
	let E = [0], f0 = fs / M
	for (let f = 2 * f0; f < fs / 2; f *= 2 ** (1 / 3)) if (Math.round(f / f0) > E.at(-1)) E.push(Math.round(f / f0))
	return [...E, (M >> 1) + 1]
}
function bandPower(x, s, win, E, acc) {
	let M = win.length, f = new Float64Array(M)
	for (let i = 0; i < M; i++) f[i] = (x[s + i] || 0) * win[i]
	let [re, im] = fft(f)
	for (let q = 0; q + 1 < E.length; q++) for (let k = E[q]; k < E[q + 1]; k++) acc[q] += re[k] * re[k] + im[k] * im[k]
}

// band-limited: STFT frames overlapping [a, b) take bins [f0, f1] from the fill, in place
function bandSplice(x, fill, a, b, f0, f1, { fs, N, hop }) {
	let k0 = Math.max(0, Math.floor(f0 * N / fs)), k1 = Math.min(N >> 1, Math.ceil(f1 * N / fs))
	let s0 = Math.max(0, a - 2 * N), s1 = Math.min(x.length, b + 2 * N), win = hannWindow(N), f = new Float64Array(N), i = 0
	let y = stftBatch(x.subarray(s0, s1), (mag, phase, state, ctx) => {
		let pos = s0 + (ctx.pos ?? i++ * hop)
		if (pos < b && pos + N > a) {
			// the fill's same frame, mirrored before s0 as the stft mirrors the segment
			for (let j = 0, t = pos; j < N; j++, t++) f[j] = (fill[t < s0 ? 2 * s0 - t : t] || 0) * win[j]
			let [re, im] = fft(f)
			for (let k = k0; k <= k1; k++) { mag[k] = Math.hypot(re[k], im[k]); phase[k] = Math.atan2(im[k], re[k]) }
		}
		return { mag, phase }
	}, { frameSize: N, hopSize: hop, fs })
	for (let n = Math.max(s0, a - N + 1); n < Math.min(s1, b + N - 1); n++) x[n] = y[n - s0]
}

// ---- ar: gap-wise Janssen. Order N/2 on 2N of context either side (Mokrý & Rajmic 2025 use 2048 on
// 4096 at 44.1 kHz; half the order measured equal here at half the cost), two passes: the refit on
// the filled segment gains, further passes stall or slowly lose (README "Measured")
function arFill(x, a, b, { N }) {
	let s0 = Math.max(0, a - 2 * N), s1 = Math.min(x.length, b + 2 * N), fill = Float32Array.from(x)
	let seg = Float64Array.from(x.subarray(s0, s1)), g0 = a - s0, g1 = b - s0
	let p = Math.min(N >> 1, seg.length - (g1 - g0) - 1)
	seg.fill(0, g0, g1)
	for (let it = 0; it < 2 && p > 0; it++) {
		let { a: coef, e } = arFit(seg, p)
		if (!(e > 0) || !coef.every(Number.isFinite)) break
		arBridge(seg, g0, g1, coef)
	}
	for (let n = a; n < b; n++) fill[n] = seg[n - s0]
	return fill
}

// ---- sinusoidal bridge
// zero-phase spectrum of x[s, s + N): the phase at a bin is the phase at the frame center
function zspec(x, s, N) {
	let win = hannWindow(N), f = new Float64Array(N), h = N >> 1
	for (let i = 0; i < N; i++) f[(i + h) % N] = (x[s + i] || 0) * win[i]
	let [re, im] = fft(f)
	return { re: Float64Array.from(re), im: Float64Array.from(im) }
}
const logmag = (S, k) => Math.log(Math.hypot(S.re[k], S.im[k]) + 1e-30)

// The partials alive at the frame touching the gap (dir −1: frame [s, s + N) ends at the gap; +1:
// starts at it), measured at its center c: frequency from the phase advance between the inner
// frames, extrapolated along its slope (vibrato); amplitude and phase from a joint Hann-weighted
// least-squares fit, the harmonic + noise model's estimator (Stylianou 2001), free of scalloping and
// mutual leakage. The residual floor: each inner frame minus its own fit, ±3 bins around partials
// bridged over (FM sidebands are not noise), power-averaged, smoothed over ±4 bins.
function edge(x, s, dir, { fs, N, hop }) {
	let c = s + N / 2, c0 = dir < 0 ? s - N : s
	let ctx = x.subarray(clamp(c0, 0, x.length), clamp(c0 + 2 * N, 0, x.length))
	if (ctx.length < N + 2 * hop) return { peaks: [], psd: null, c }
	let model = track(ctx, { fs, frameSize: N, hop }), last = model.frames - 1
	let S = [0, 1, 2].map(j => zspec(x, s + j * dir * hop, N)), bin = PI2 / N, ws = []
	for (let p of model.partials) {
		if (dir < 0 ? p.start + p.freqs.length - 1 !== last : p.start !== 0) continue
		let k = Math.round((dir < 0 ? p.freqs.at(-1) : p.freqs[0]) * N / fs)
		if (k < 2 || k > (N >> 1) - 2) continue
		let km = k
		for (let j = k - 1; j <= k + 1; j++) if (logmag(S[0], j) > logmag(S[0], km)) km = j
		let l = logmag(S[0], km - 1), m = logmag(S[0], km), r = logmag(S[0], km + 1)
		let d = 0.5 * (l - r) / (l - 2 * m + r || 1e-12), w = bin * (km + (Math.abs(d) < 1 ? d : 0))
		let ph = S.map(Q => Math.atan2(Q.im[km], Q.re[km]))
		let adv = j => w + princ((dir > 0 ? ph[j + 1] - ph[j] : ph[j] - ph[j + 1]) - w * hop) / hop   // forward in time
		let w01 = adv(0), w12 = adv(1), dw = 0
		if (Math.abs(w01 - w) < bin) {
			w = w01
			if (Math.abs(w12 - w01) < bin) dw = w12 - w01, w += clamp(-dw / 2, -bin / 2, bin / 2)
		}
		if (ws.every(v => Math.abs(v.w - w) > bin)) ws.push({ w, dw })
	}
	let fits = [0, 1, 2].map(j => fit(x, s + j * dir * hop, N, ws.map(v => v.w + j * v.dw)))
	let half = N >> 1, psd = new Float64Array(half + 1), mask = new Uint8Array(half + 1), win = hannWindow(N), f = new Float64Array(N)
	for (let v of ws) { let kc = Math.round(v.w / bin); for (let k = Math.max(0, kc - 3); k <= Math.min(half, kc + 3); k++) mask[k] = 1 }
	fits.forEach(({ y }, j) => {
		let sj = s + j * dir * hop
		for (let i = 0; i < N; i++) f[i] = ((x[sj + i] || 0) - y[i]) * win[i]
		let [re, im] = fft(f)
		for (let k = 0; k <= half; k++) psd[k] += (re[k] * re[k] + im[k] * im[k]) / 3
	})
	for (let k = 0, lo = -1; k <= half + 1; k++) {   // bridge masked bins log-linearly
		if (k <= half && mask[k]) continue
		if (k - lo > 1) {
			let pl = Math.log((lo >= 0 ? psd[lo] : psd[Math.min(k, half)]) + 1e-30), pr = k <= half ? Math.log(psd[k] + 1e-30) : pl
			for (let j = lo + 1; j < k; j++) psd[j] = Math.exp(pl + (pr - pl) * (j - lo) / (k - lo))
		}
		lo = k
	}
	let sm = new Float64Array(half + 1)
	for (let k = 0; k <= half; k++) {
		let acc = 0, n = 0
		for (let j = Math.max(0, k - 4); j <= Math.min(half, k + 4); j++) acc += psd[j], n++
		sm[k] = acc / n
	}
	return { peaks: fits[0].peaks, psd: sm, c }
}

// joint Hann-weighted least squares of cos/sin pairs at frequencies ws over x[s, s + N), time from
// the frame center → peaks [{ w, amp, ph }] (x ≈ Σ amp·cos(w(n − c) + ph)) and the fitted frame y
function fit(x, s, N, ws) {
	let K = ws.length, M = 2 * K, y = new Float64Array(N)
	if (!K) return { peaks: [], y }
	let win = hannWindow(N), c = s + N / 2, G = new Float64Array(M * M), h = new Float64Array(M), u = new Float64Array(M)
	for (let i = 0; i < N; i++) {
		let t = s + i - c, wi = win[i], xi = (x[s + i] || 0) * wi
		for (let k = 0; k < K; k++) u[2 * k] = Math.cos(ws[k] * t), u[2 * k + 1] = -Math.sin(ws[k] * t)
		for (let p = 0; p < M; p++) { let up = u[p] * wi; h[p] += u[p] * xi; for (let q = p; q < M; q++) G[p * M + q] += up * u[q] }
	}
	let tr = 0
	for (let p = 0; p < M; p++) tr += G[p * M + p]
	for (let p = 0; p < M; p++) { G[p * M + p] += 1e-9 * tr / M; for (let q = 0; q < p; q++) G[p * M + q] = G[q * M + p] }
	let z = cholesky(G, h, M), peaks = []
	for (let k = 0; k < K; k++) {
		let re = z[2 * k], im = z[2 * k + 1]
		peaks.push({ w: ws[k], amp: Math.hypot(re, im), ph: Math.atan2(im, re) })
		for (let i = 0; i < N; i++) { let t = s + i - c; y[i] += re * Math.cos(ws[k] * t) - im * Math.sin(ws[k] * t) }
	}
	return { peaks, y }
}

function cholesky(A, b, n) {
	let L = new Float64Array(n * n), y = new Float64Array(n)
	for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
		let s = A[i * n + j]
		for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k]
		L[i * n + j] = i === j ? Math.sqrt(Math.max(s, 1e-300)) : s / L[j * n + j]
	}
	for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i] }
	for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * y[k]; y[i] = s / L[i * n + i] }
	return y
}

// Partials either side matched by nearest frequency within a semitone (greedy by distance: MQ
// matching over one long step; ±50-cent vibrato needs the whole semitone), each pair on cubic phase
// between the two frame centers (MQ 1986 eqs. 34–38: endpoint phases and frequencies kept, 2πM for
// the smoothest trajectory), amplitude linear; an unmatched partial fades across. The noise: white,
// shaped frame by frame by the floor log-interpolated from the left residual to the right.
function sineFill(x, a, b, o) {
	let { N, hop, fs } = o, L = edge(x, a - N, -1, o), R = edge(x, b, 1, o)
	let cL = L.c, T = R.c - cL, s0 = Math.max(0, a - N), s1 = Math.min(x.length, b + N)
	let acc = new Float64Array(s1 - s0), fill = Float32Array.from(x)
	let add = (A0, A1, th) => { for (let n = s0; n < s1; n++) { let t = n - cL; acc[n - s0] += (A0 + (A1 - A0) * clamp(t / T, 0, 1)) * Math.cos(th(t)) } }
	let pairs = []
	for (let i = 0; i < L.peaks.length; i++) for (let j = 0; j < R.peaks.length; j++) {
		let d = Math.abs(1200 * Math.log2(R.peaks[j].w / L.peaks[i].w))
		if (d <= 100) pairs.push([d, i, j])
	}
	pairs.sort((p, q) => p[0] - q[0])
	let mL = new Int32Array(L.peaks.length).fill(-1), mR = new Int32Array(R.peaks.length).fill(-1)
	for (let [, i, j] of pairs) if (mL[i] < 0 && mR[j] < 0) mL[i] = j, mR[j] = i
	L.peaks.forEach((l, i) => {
		if (mL[i] < 0) return add(l.amp, 0, t => l.ph + l.w * t)
		let r = R.peaks[mL[i]], M = Math.round(((l.ph + l.w * T - r.ph) + (r.w - l.w) * T / 2) / PI2)
		let e = r.ph + PI2 * M - l.ph - l.w * T, al = 3 * e / (T * T) - (r.w - l.w) / T, be = -2 * e / (T * T * T) + (r.w - l.w) / (T * T)
		add(l.amp, r.amp, t => t <= 0 ? l.ph + l.w * t : t >= T ? r.ph + PI2 * M + r.w * (t - T) : l.ph + t * (l.w + t * (al + t * be)))
	})
	R.peaks.forEach((r, j) => { if (mR[j] < 0) add(0, r.amp, t => r.ph + r.w * (t - T)) })
	let pL = L.psd ?? R.psd, pR = R.psd ?? L.psd
	if (pL) {
		let pad = N, len = s1 - s0 + 2 * pad, rnd = lcg(a), wn = new Float32Array(len), w2 = 0, i = 0
		for (let v of hannWindow(N)) w2 += v * v
		for (let j = 0; j < len; j++) { let u = rnd() || 1e-12; wn[j] = Math.sqrt(-2 * Math.log(u)) * Math.cos(PI2 * rnd()) }
		let lL = Float64Array.from(pL, v => Math.log(v / w2 + 1e-30)), lR = Float64Array.from(pR, v => Math.log(v / w2 + 1e-30))
		let nz = stftBatch(wn, (mag, phase, state, ctx) => {
			let u = clamp((s0 - pad + (ctx.pos ?? i++ * hop) + N / 2 - cL) / T, 0, 1)
			for (let k = 0; k < mag.length; k++) mag[k] *= Math.exp(0.5 * ((1 - u) * lL[k] + u * lR[k]))
			return { mag, phase }
		}, { frameSize: N, hopSize: hop, fs })
		for (let j = 0; j < s1 - s0; j++) acc[j] += nz[j + pad]
	}
	for (let j = 0; j < s1 - s0; j++) fill[s0 + j] = acc[j]
	return fill
}

const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }

// ---- similarity: features are dB spectra up to 6 kHz, clipped 50 dB under the peak (Perraudin et
// al. 2018, F1), on two frame grids anchored at the gap's edges. A shift d compares 0.5 s of context
// each side (their similarity-kernel length, ~40 frames) and keeps the copied span, crossfades
// included, clear of the gap and within `window` s of it. The nearest shift is aligned to the sample
// by the highest normalized correlation r over both transition zones within ±hop/2 (their §V-B);
// r also says whether the transplant will join seamlessly (the 'auto' gate).
function similar(x, a, b, { fs, N, hop, window }) {
	let D = b - a, X = N, W = Math.round(window * fs), Lc = Math.round(0.5 * fs)
	let lo = Math.max(0, a - W), hi = Math.min(x.length, b + W)
	let kmax = Math.floor(W / hop), nL = Math.max(1, Math.floor((Lc - N) / hop) + 1)
	let ok = d => (d >= D + X || d <= -(D + X)) && a - X + d >= lo && b + X + d <= hi
	let startsA = [], startsB = []
	for (let k = -kmax - nL; k <= kmax; k++) startsA.push(a - N + k * hop)
	for (let k = -kmax; k <= kmax + nL; k++) startsB.push(b + k * hop)
	let usable = s => s >= lo && s + N <= hi && !(s < b && s + N > a)
	let FA = features(x, startsA, usable, N, fs), FB = features(x, startsB, usable, N, fs)
	let dist = (u, v) => { let s = 0; for (let k = 0; k < u.length; k++) { let e = u[k] - v[k]; s += e * e } return s / u.length }
	let best = Infinity, d0 = null
	for (let k = -kmax; k <= kmax; k++) {
		if (!ok(k * hop)) continue
		let s = 0, c = 0
		for (let j = 0; j < nL; j++) {
			let u = FA[kmax + nL - j], v = FA[kmax + nL - j + k], p = FB[kmax + j], q = FB[kmax + j + k]
			if (u && v) s += dist(u, v), c++
			if (p && q) s += dist(p, q), c++
		}
		if (c >= nL && s / c < best) best = s / c, d0 = k * hop
	}
	if (d0 == null) return null
	let top = -Infinity, dBest = d0
	for (let d = d0 - (hop >> 1); d <= d0 + (hop >> 1); d++) {
		if (!ok(d)) continue
		let r = corr(x, a, b, d, X)
		if (r > top) top = r, dBest = d
	}
	return { d: dBest, r: top }
}

// normalized correlation of x with x shifted by d over the X samples either side of [a, b)
function corr(x, a, b, d, X) {
	let sxy = 0, sxx = 0, syy = 0
	for (let [p, q] of [[a - X, a], [b, b + X]]) for (let n = p; n < q; n++) { let u = x[n] || 0, v = x[n + d] || 0; sxy += u * v; sxx += u * u; syy += v * v }
	return sxy / Math.sqrt(sxx * syy + 1e-30)
}

function features(x, starts, usable, N, fs) {
	let win = hannWindow(N), f = new Float64Array(N), K = Math.min(N >> 1, Math.round(6000 * N / fs)), top = -Infinity
	let F = starts.map(s => {
		if (!usable(s)) return null
		for (let i = 0; i < N; i++) f[i] = x[s + i] * win[i]
		let [re, im] = fft(f), v = new Float32Array(K)
		for (let k = 0; k < K; k++) { v[k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-20); if (v[k] > top) top = v[k] }
		return v
	})
	for (let v of F) if (v) for (let k = 0; k < v.length; k++) v[k] = Math.max(0, (v[k] - top + 50) / 50)
	return F
}

// ---- spectral: the original method, on a local span. The frames between the last clean one before
// the gap (pre) and the first after it (post) take the log-interpolated magnitude; each frame's phase
// runs from the nearer of the two at its instantaneous frequencies there (from the frame beyond it),
// so the frames touching either edge line up with the program's
function specFill(x, a, b, { fs, N, hop }) {
	let s0 = Math.max(0, a - 3 * N), s1 = Math.min(x.length, b + 3 * N), seg = x.subarray(s0, s1), fill = Float32Array.from(x)
	let half = N >> 1, win = hannWindow(N)
	let fPre = Math.max(0, Math.floor((a - s0 - N) / hop)), fPost = Math.ceil((b - s0) / hop)
	let pre = frame(seg, fPre * hop, win), prePre = frame(seg, Math.max(0, fPre - 1) * hop, win)
	let post = fPost * hop + N <= seg.length ? frame(seg, fPost * hop, win) : pre
	let back = (fPost + 1) * hop + N <= seg.length, postPost = back ? frame(seg, (fPost + 1) * hop, win) : null
	let advL = new Float64Array(half + 1), advR = new Float64Array(half + 1)
	for (let k = 0; k <= half; k++) {
		let expected = PI2 * hop * k / N
		advL[k] = expected + (fPre > 0 ? princ(pre.phase[k] - prePre.phase[k] - expected) : 0)
		if (back) advR[k] = expected + princ(postPost.phase[k] - post.phase[k] - expected)
	}
	let c = 0
	let y = stftBatch(seg, (mag, phase, state, ctx) => {
		let i = (ctx.pos ?? c++ * hop) / hop                     // the frame's index on the hop grid from seg's start
		if (i <= fPre || i >= fPost) return { mag, phase }
		let t = (i - fPre) / (fPost - fPre), left = !back || i - fPre <= fPost - i
		for (let k = 0; k <= half; k++) {
			mag[k] = Math.exp((1 - t) * Math.log(pre.mag[k] + 1e-12) + t * Math.log(post.mag[k] + 1e-12))
			phase[k] = left ? pre.phase[k] + (i - fPre) * advL[k] : post.phase[k] - (fPost - i) * advR[k]
		}
		return { mag, phase }
	}, { frameSize: N, hopSize: hop, fs })
	for (let n = (fPre + 1) * hop; n < Math.min(seg.length, (fPost - 1) * hop + N); n++) fill[s0 + n] = y[n]
	return fill
}

function frame(data, pos, win) {
	let N = win.length, half = N >> 1, f = new Float64Array(N)
	for (let i = 0; i < N; i++) f[i] = (data[pos + i] || 0) * win[i]
	let [re, im] = fft(f), mag = new Float64Array(half + 1), phase = new Float64Array(half + 1)
	for (let k = 0; k <= half; k++) { mag[k] = Math.hypot(re[k], im[k]); phase[k] = Math.atan2(im[k], re[k]) }
	return { mag, phase }
}
