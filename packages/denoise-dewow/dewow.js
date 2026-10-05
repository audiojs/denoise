// Wow & flutter correction — pitch-drift removal for tape/vinyl/cassette transfers
// (the classical, non-ML counterpart of Celemony Capstan).
//
// A speed change of the medium scales every frequency in the recording by one ratio at one instant. A performer's
// pitch movement (vibrato, a scoop, a glide, a melody, intonation) moves one source: one note and its harmonics.
// That difference is what the estimator relies on; where the signal cannot show it, nothing is corrected.
//
// 1. Speed curve, one value per STFT hop, at the analysis frame's centre (nominal = 1):
//    'partial'   — Godsill & Rayner, Digital Audio Restoration, 1998, ch. 8: log-frequency tracks f_ni = f0_i + p_n +
//                  v_ni (eq. 8.9, 8.33), the log speed p_n common to all, under a smoothness prior (eq. 8.23, 8.31).
//                  Their centres f0_i are free, and errors then add up along the chain of overlapping tracks: a slope
//                  shared by the notes struck together (strings falling in pitch as they decay) walks the curve off.
//                  Music reuses its pitches, so here a partial's centre is tied to its pitch class — every partial
//                  at that pitch anywhere in the recording, give or take its own error — and each class measures
//                  the speed at every instant it sounds. Harmonics of one note count as one source, and a hop is
//                  evidence only where two independent sources agree (Tukey's biweight). Of that curve only what a
//                  second, independent test confirms is applied: disc wow, a sinusoid at a turntable's rotation rate,
//                  fitted to the partials and kept where its amplitude stands far above its own noise. Any other
//                  movement of the curve is left: on real music it is the notes' own (a voice's harmonics, which the
//                  grouping does not always join, agree with each other). Tracks: STFT peaks, McAulay & Quatieri 1986
//                  linking, phase-vocoder instantaneous frequency over a 0.19 s frame, cut where a partial glides. A
//                  pilot tone, where there is one, is read instead ('reference').
//    'reference' — phase-vocoder IF of one steady tone (mains hum, a pilot or calibration tone), given or found: a
//                  source known not to move, so evidence on its own; the method of choice where such a tone is present.
//                  Czyżewski et al., "Wow detection and compensation employing spectral processing of audio",
//                  AES 117th Convention, 2004; "DSP techniques for determining 'wow' distortion", JAES, 2007.
//    'pitch'     — @audio/pitch-pyin f0 relative to its own zero-phase smoothed trend: monophonic material, and it
//                  takes the performer's own pitch movement for speed (opt-in).
// 2. Where nothing is evidence the curve stays at 1: no evidence, no correction; a clip with none comes back
//    bit-exact. The curve splits into wow (zero-phase one-pole low-pass at `smooth`) and flutter (the residual).
// 3. Correction: variable-rate resampling. Integrate 1/speed into a warped read position and read the source with
//    a 16-zero-crossing windowed sinc (@audio/resample-sinc), narrowing the anti-alias cutoff when the local read
//    rate exceeds 1×. Multi-channel: one curve from the mono mix, applied to every channel so they stay aligned.
//
// Refs: Howarth & Wolfe, "Correction of Wow and Flutter Effects in Analogue Tape Transfers", AES 117th/118th
// Convention 2004/2005. Nichols, "The Digital Restoration of Wow and Flutter Distorted Gramophone Recordings", 1999.

import { stftAnalyse } from '@audio/stft'
import { sincRead } from '@audio/resample-sinc'
import pyin from '@audio/pitch-pyin'
import { bandpass, cascade } from '@audio/biquad'

const PI2 = Math.PI * 2, CENT = 1200 / Math.LN2

// frame ≈ 0.19 s (8192 at 44.1–48 kHz), hop a sixteenth of it: see trackPartials
const frameFor = fs => 2 ** Math.max(9, Math.round(Math.log2(0.186 * fs)))

function normalizeOpts(opts) {
	let fs = opts.fs || 44100, frameSize = opts.frameSize || frameFor(fs)
	return {
		fs,
		mode: opts.mode || 'partial',
		refFreq: opts.refFreq || 0,
		frameSize,
		hopSize: opts.hopSize || frameSize >> 4,
		smooth: opts.smooth ?? 0.05,
		wow: opts.wow ?? true,
		flutter: opts.flutter ?? true,
		maxDeviation: opts.maxDeviation ?? 0.05,
		minTrack: opts.minTrack ?? 0.2,
		keepLength: opts.keepLength ?? true,
		minFreq: opts.minFreq ?? 50,
		maxFreq: opts.maxFreq ?? 2000,
	}
}

// data: Float32Array (mono) or Float32Array[] (channels). Returns the mono mix
// (new array if mixing was needed) plus the channel list and whether the input
// was multi-channel, so callers can shape their output the same way.
function normalizeChannels(data) {
	let channels = Array.isArray(data) ? data : [data]
	let mono
	if (channels.length === 1) mono = channels[0]
	else {
		let n = 0
		for (let c of channels) if (c.length > n) n = c.length
		mono = new Float32Array(n)
		for (let c of channels) for (let i = 0; i < c.length; i++) mono[i] += c[i] / channels.length
	}
	return { channels, mono, multi: Array.isArray(data) }
}

function wrapPhase(p) { return p - Math.floor(p / PI2 + 0.5) * PI2 }  // floor(x + 0.5) rounds like Math.round here, several times faster in V8 (hot: per bin per frame)

// a seeded uniform generator (LCG, Numerical Recipes constants): every random choice below is reproducible
const lcg = seed => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296

// ---- mode 'partial': steady pieces of partials ----

// STFT peak-picking + McAulay-Quatieri nearest-frequency linking within [minFreq, maxFreq]. Frequency: the phase-
// vocoder IF at the peak bin over the frame, 0.19 s: long enough to keep neighbouring partials of dense music apart
// and to average a string's or a voice's fine jitter; wow up to 3 Hz is read at ≥ 0.8 of its depth, flutter is
// averaged away (a tone in 'reference' mode resolves it). A peak is linked within ±LINK per hop; a track is cut
// where it moves faster than JUMP, 350 cents/s (4 cents per 11.6 ms hop): disc wow of 2 % moves a partial at most
// 2π·f_r·2 % — 120 cents/s at 33⅓ rpm, 280 at 78 — a ±50-cent vibrato at 5.5 Hz 1700, a glide or a slip onto a
// neighbour more (at 260 cents/s, 78 rpm wow of 2 % came out of the tuning music 35 % corrected; at 350, 50 %). What
// remains are steady pieces of notes; a piece shorter than minTrack (0.2 s) is dropped: speech moving through a long
// frame leaves short pseudo-steady pieces of its harmonics, which pass for independent sources (at 0.1 s, audio-lena
// under 0.3 % tape wow took a false 0.47 % line at 0.58 Hz and came out 1.3 → 6.0 cents).
const LINK = 0.01, JUMP = 350 / CENT, SETTLE = 2, SINUS_TOL = 0.25, TRACK_FLOOR = 3.1622776601683795e-3 // 10^(-50/20)

function trackPartials(mono, o) {
	let { fs, frameSize: N, hopSize: hop } = o
	let half = N >> 1, jump = JUMP * hop / fs
	let k0 = Math.max(2, Math.floor(o.minFreq * N / fs)), k1 = Math.min(half - 2, Math.ceil(o.maxFreq * N / fs))
	let prev = new Float64Array(half + 1), live = [], done = [], t = 0

	stftAnalyse(mono, (mag, phase) => {
		let maxMag = 0
		for (let k = 0; k <= half; k++) if (mag[k] > maxMag) maxMag = mag[k]
		// −50 dB re the frame's loudest bin: long stable tracks matter more than recall of weak peaks
		let floor = maxMag * TRACK_FLOOR, peaks = []
		if (maxMag > 0 && t > 0) {
			// A Hann window's first sidelobe is only 31.5 dB down, so a plain local-max scan takes sidelobes for
			// partials: candidates ranked by amplitude, the loudest accepted first, anything within its main lobe
			// (4 bins) rejected
			let cands = []
			for (let k = k0; k < k1; k++) if (mag[k] > floor && mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) cands.push(k)
			cands.sort((a, b) => mag[b] - mag[a])
			let accepted = []
			for (let k of cands) {
				if (accepted.some(a => Math.abs(k - a) < 4)) continue
				accepted.push(k)
				// A sinusoid's IF (phase advance over the hop) sits where its magnitude peaks (log-parabolic
				// interpolation, within ~0.05 bin for a Hann window); a noise peak's phase advance is arbitrary,
				// ±hop/2 bins around it. Kept only where the two agree within SINUS_TOL bins
				let ifb = q => q + wrapPhase(phase[q] - prev[q] - PI2 * hop * q / N) * N / (PI2 * hop), bin = ifb(k)
				let a = Math.log(mag[k - 1] + 1e-30), b = Math.log(mag[k]), c = Math.log(mag[k + 1] + 1e-30), den = a - 2 * b + c
				if (Math.abs(bin - k - (den < 0 ? 0.5 * (a - c) / den : 0)) < SINUS_TOL) peaks.push({ freq: bin * fs / N, amp: mag[k] })
			}
		}
		prev.set(phase)
		let claimed = new Uint8Array(peaks.length)
		for (let tr of live) {
			let last = tr.freq[tr.freq.length - 1], bj = -1, be = LINK
			for (let j = 0; j < peaks.length; j++) {
				if (claimed[j]) continue
				let e = Math.abs(peaks[j].freq / last - 1)
				if (e < be) { be = e; bj = j }
			}
			if (bj >= 0) { claimed[bj] = 1; tr.freq.push(peaks[bj].freq); tr.amp.push(peaks[bj].amp) }
			else tr.dead = true
		}
		for (let tr of live) if (tr.dead) done.push(tr)
		live = live.filter(tr => !tr.dead)
		for (let j = 0; j < peaks.length; j++) if (!claimed[j]) live.push({ start: t, freq: [peaks[j].freq], amp: [peaks[j].amp] })
		t++
	}, { frameSize: N, hopSize: hop, fs })
	done.push(...live)

	// a track's first SETTLE hops are dropped (an onset just put energy in its bin, the frame straddles it); the rest
	// is cut into steady pieces
	let pieces = []
	for (let tr of done) {
		let L = tr.freq.length, s = Math.min(L, SETTLE)
		for (let j = s + 1; j <= L; j++) if (j === L || Math.abs(Math.log(tr.freq[j] / tr.freq[j - 1])) > jump) {
			pieces.push({ start: tr.start + s, freq: Float64Array.from(tr.freq.slice(s, j), Math.log), amp: Float64Array.from(tr.amp.slice(s, j)) })
			s = j
		}
	}
	let minFrames = Math.max(3, Math.round(o.minTrack * fs / hop)), maxAmp = 0
	for (let p of pieces) { let m = 0; for (let a of p.amp) m += a; p.meanAmp = m / p.amp.length; if (p.meanAmp > maxAmp) maxAmp = p.meanAmp }
	let kept = pieces.filter(p => p.freq.length >= minFrames && p.meanAmp >= maxAmp * TRACK_FLOOR)
	for (let p of kept) p.end = p.start + p.freq.length - 1
	return { tracks: kept, nFrames: t }
}

// ---- sources: a note and its harmonics ----

// Harmonics of one note share its pitch movement exactly (a periodic source's partials are integer multiples of one
// f0 at every instant), so together they are one witness to the speed, not many. Two pieces are taken for one source
// when, over their overlap, the median ratio of their frequencies is h/k within HARM_TOL: k ≤ 2 and h ≤ 20k (a
// voice's harmonics within maxFreq), or 4/3, 5/3. HARM_TOL: measured on harmonics of a ±50-cent vibrato voice,
// synthetic and VocalSet, whose IF over a moving frame is biased by up to 0.2 %. 4/3 and 5/3: where a voice's lowest
// harmonics are cut (vibrato, an onset) its 3rd, 4th and 5th relate only so — without them a sung long tone came
// apart into "independent" sources that agreed, and under 2 % wow took a false line (24.5 → 28.2 cents); every h/3
// up to 20 merged a steady chord's upper harmonics by chance (19/3 of C4 is G♯4's 4th within 0.3 %) and lost its
// evidence. Independent notes an octave, a fifth or a fourth apart pass too: merging them costs evidence, never adds
// false.
const HARM_TOL = 0.003, HARM_K = 3, HARM_H = 20

function harmonicPairs(tracks) {
	let adj = tracks.map(() => []), order = tracks.map((_, i) => i).sort((a, b) => tracks[a].start - tracks[b].start)
	for (let x = 0; x < order.length; x++) {
		let i = order[x], a = tracks[i]
		for (let y = x + 1; y < order.length && tracks[order[y]].start <= a.end; y++) {
			let j = order[y], b = tracks[j], s = b.start, e = Math.min(a.end, b.end), r = []
			for (let n = s; n <= e; n++) r.push(Math.abs(a.freq[n - a.start] - b.freq[n - b.start]))
			r.sort((u, v) => u - v)
			let ratio = Math.exp(r[r.length >> 1])
			for (let k = 1; k <= HARM_K; k++) {
				let h = Math.round(ratio * k)
				if (h > k && h <= (k < 3 ? HARM_H * k : 2 * k - 1) && Math.abs(Math.log(ratio * k / h)) < HARM_TOL) { adj[i].push(j); adj[j].push(i); break }
			}
		}
	}
	return adj
}

// per hop: the pieces sounding and the source each belongs to (connected components of the harmonic relation there);
// over the clip: harmonic groups (components over all time), the units the noise draws below split by
function sources(tracks, nFrames) {
	let adj = harmonicPairs(tracks), active = Array.from({ length: nFrames }, () => [])
	tracks.forEach((tr, i) => { for (let n = tr.start; n <= tr.end; n++) active[n].push(i) })
	let root = new Int32Array(tracks.length), find = i => { while (root[i] !== i) i = root[i] = root[root[i]]; return i }
	let comp = active.map(act => {
		for (let i of act) root[i] = i
		let on = new Set(act)
		for (let i of act) for (let j of adj[i]) if (on.has(j)) root[find(i)] = find(j)
		let ids = new Map()
		return Int32Array.from(act, i => { let r = find(i); if (!ids.has(r)) ids.set(r, ids.size); return ids.get(r) })
	})
	let group = new Int32Array(tracks.length).fill(-1), G = 0
	for (let i = 0; i < tracks.length; i++) {
		if (group[i] >= 0) continue
		let st = [i]; group[i] = G
		while (st.length) { let a = st.pop(); for (let j of adj[a]) if (group[j] < 0) { group[j] = G; st.push(j) } }
		G++
	}
	return { active, comp, group, G }
}

// ---- the speed under tied pitch classes ----

// Per hop, each source's residual (its pieces' amplitude-weighted mean) gets a biweight at the scale c (Tukey); a
// source's weight goes to its pieces by amplitude. A hop's weights are scaled by what survives losing any one source,
// less EV0: zero unless two independent sources agree (two count once each is past biweight 0.3, |r| < 0.67c).
const EV0 = 0.3
function weigh(tracks, active, comp, res, c, w) {
	for (let n = 0; n < active.length; n++) {
		let act = active[n], cp = comp[n]
		if (!act.length) continue
		let K = 0
		for (let k of cp) if (k + 1 > K) K = k + 1
		let rs = new Float64Array(K), as = new Float64Array(K), u = new Float64Array(K), U = 0, M = 0
		for (let m = 0; m < act.length; m++) { let tr = tracks[act[m]], j = n - tr.start, a = tr.amp[j]; rs[cp[m]] += a * res(act[m], j, n); as[cp[m]] += a }
		for (let k = 0; k < K; k++) { let q = rs[k] / as[k] / c; u[k] = q * q < 1 ? (1 - q * q) ** 2 : 0; U += u[k]; if (u[k] > M) M = u[k] }
		let g = U > 0 ? Math.max(0, U - M - EV0) / U : 0
		for (let m = 0; m < act.length; m++) { let i = act[m], tr = tracks[i], j = n - tr.start; w[i][j] = g * u[cp[m]] * tr.amp[j] / as[cp[m]] }
	}
}

// MAP speed under the tied model (Godsill & Rayner eq. 8.33 with the centres tied, eq. 8.23, 8.31 the prior):
//   Σ_i Σ_j w_ij (y_ij − c_k(i) − δ_i − p_j)² + κ Σ_i δ_i² + α Σ_n (Δ²p_n)² + β Σ_n p_n²
// y the pieces' log frequencies, c_k their classes' log pitch, δ_i a piece's own offset from it. δ is eliminated
// piece by piece in closed form; [p, c] by conjugate gradients, preconditioned by the pentadiagonal p-block and the
// diagonal c-block. With every piece its own class and κ large it is G&R's model, centres free.
function solve(tracks, w, cl, K, n, kappa, alpha, beta) {
	let N = n + K, W = tracks.map((_, i) => { let s = 0; for (let v of w[i]) s += v; return s })
	let P0 = new Float64Array(n).fill(beta), d1 = new Float64Array(n), d2 = new Float64Array(n), dc = new Float64Array(K).fill(1e-12), b = new Float64Array(N)
	for (let k = 0; k + 2 < n; k++) { P0[k] += alpha; P0[k + 1] += 4 * alpha; P0[k + 2] += alpha; d1[k] -= 2 * alpha; d1[k + 1] -= 2 * alpha; d2[k] += alpha }
	let d0 = P0.slice()
	tracks.forEach((tr, i) => {
		if (!(W[i] > 0)) return
		let sh = 1 / (W[i] + kappa), wi = w[i], sy = 0
		for (let j = 0; j < wi.length; j++) sy += wi[j] * tr.freq[j]
		for (let j = 0; j < wi.length; j++) { let g = wi[j] * (tr.freq[j] - sy * sh); b[tr.start + j] += g; b[n + cl[i]] += g; d0[tr.start + j] += wi[j] * (1 - wi[j] * sh) }
		dc[cl[i]] += W[i] * kappa * sh
	})
	let mv = x => {
		let y = new Float64Array(N)
		for (let k = 0; k < n; k++) y[k] = P0[k] * x[k] + (k + 1 < n ? d1[k] * x[k + 1] : 0) + (k > 0 ? d1[k - 1] * x[k - 1] : 0) + (k + 2 < n ? d2[k] * x[k + 2] : 0) + (k > 1 ? d2[k - 2] * x[k - 2] : 0)
		for (let k = 0; k < K; k++) y[n + k] = 1e-12 * x[n + k]
		tracks.forEach((tr, i) => {
			if (!(W[i] > 0)) return
			let wi = w[i], ck = x[n + cl[i]], s = 0, tot = 0, sh = 1 / (W[i] + kappa)
			for (let j = 0; j < wi.length; j++) s += wi[j] * (x[tr.start + j] + ck)
			for (let j = 0; j < wi.length; j++) { let g = wi[j] * (x[tr.start + j] + ck - s * sh); y[tr.start + j] += g; tot += g }
			y[n + cl[i]] += tot
		})
		return y
	}
	let pre = r => { let z = new Float64Array(N); z.set(pentaSolve(d0, d1, d2, r.subarray(0, n))); for (let k = 0; k < K; k++) z[n + k] = r[n + k] / dc[k]; return z }
	let dot = (u, v) => { let s = 0; for (let k = 0; k < N; k++) s += u[k] * v[k]; return s }
	let x = new Float64Array(N), r = b.slice(), z = pre(r), q = z.slice(), rz = dot(r, z), r0 = rz
	for (let it = 0; it < CG_ITERS && rz > CG_TOL * r0 && rz > 0; it++) {
		let Aq = mv(q), al = rz / dot(q, Aq)
		for (let k = 0; k < N; k++) { x[k] += al * q[k]; r[k] -= al * Aq[k] }
		z = pre(r)
		let rz2 = dot(r, z)
		for (let k = 0; k < N; k++) q[k] = z[k] + rz2 / rz * q[k]
		rz = rz2
	}
	let p = x.slice(0, n), c = x.slice(n)
	let delta = tracks.map((tr, i) => { if (!(W[i] > 0)) return 0; let s = 0; for (let j = 0; j < tr.freq.length; j++) s += w[i][j] * (tr.freq[j] - c[cl[i]] - p[tr.start + j]); return s / (W[i] + kappa) })
	return { p, c, delta }
}
const CG_ITERS = 300, CG_TOL = 1e-18

// symmetric positive-definite pentadiagonal system (main d0, first and second super-diagonals d1, d2): LDLᵀ
function pentaSolve(d0, d1, d2, b) {
	let n = d0.length, D = new Float64Array(n), l1 = new Float64Array(n), l2 = new Float64Array(n), y = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		D[i] = d0[i] - (i > 0 ? l1[i - 1] ** 2 * D[i - 1] : 0) - (i > 1 ? l2[i - 2] ** 2 * D[i - 2] : 0)
		l1[i] = (d1[i] - (i > 0 ? l2[i - 1] * D[i - 1] * l1[i - 1] : 0)) / D[i]
		l2[i] = d2[i] / D[i]
		y[i] = b[i] - (i > 0 ? l1[i - 1] * y[i - 1] : 0) - (i > 1 ? l2[i - 2] * y[i - 2] : 0)
	}
	let x = new Float64Array(n)
	for (let i = n - 1; i >= 0; i--) x[i] = y[i] / D[i] - (i + 1 < n ? l1[i] * x[i + 1] : 0) - (i + 2 < n ? l2[i] * x[i + 2] : 0)
	return x
}

// Pitch classes: pieces sorted by their median log frequency less the current speed, split where two neighbours are
// more than `gap` cents apart and wherever a class grows wider than `width` (at its widest gap). Under wow the medians
// of one pitch spread by the speed left unmeasured, so classes start wide and tighten as the speed is found (30/60 →
// 10/20 cents): a class must not split one pitch by the phase of the wow it is there to measure.
function classes(tracks, p, gap, width) {
	let m = tracks.map((tr, i) => { let v = Array.from(tr.freq, (f, j) => f - p[tr.start + j]).sort((a, b) => a - b); return [v[v.length >> 1] * CENT, i] }).sort((a, b) => a[0] - b[0])
	let groups = m.length ? [[m[0]]] : []
	for (let k = 1; k < m.length; k++) { if (m[k][0] - m[k - 1][0] > gap) groups.push([]); groups[groups.length - 1].push(m[k]) }
	let split = g => {
		if (g.length < 2 || g[g.length - 1][0] - g[0][0] <= width) return [g]
		let bi = 1, bg = -1
		for (let k = 1; k < g.length; k++) if (g[k][0] - g[k - 1][0] > bg) { bg = g[k][0] - g[k - 1][0]; bi = k }
		return [...split(g.slice(0, bi)), ...split(g.slice(bi))]
	}
	groups = groups.flatMap(split)
	let cl = new Int32Array(tracks.length), c = new Float64Array(groups.length)
	groups.forEach((g, k) => { for (let [v, i] of g) { cl[i] = k; c[k] += v / CENT / g.length } })
	return { cl, K: groups.length, c }
}

// The estimate. (1) Relative: every piece its own centre (G&R as published), the curve's slow drift, which such a
// chain cannot measure, held off below DRIFT_HZ: enough of the wow's shape to sort the pieces into classes. (2) Tied,
// re-weighted with the biweight annealed (SCALES, cents) and the classes re-sorted on the new curve each time.
// `init`: a curve found already (the lines below): its last steps only, from that curve.
// α sets the curve's bandwidth: half power at CURVE_HZ where two sources agree (a hop's evidence 1 − EV0), higher
// where more do. β: across a stretch without evidence the curve returns to 0 within ~GAP_S. κ: a piece's reading
// errs coherently over ~NU hops (the frame is 16 hops long), so the tie to its class weighs NU hop-readings: a
// piece's offset from its class is held to about one reading's error.
const CURVE_HZ = 4, DRIFT_HZ = 0.3, GAP_S = 0.25, NU = 8, REL_SCALES = [30, 15], SCALES = [30, 15, 8, 8, 8, 8]
const GAPS = [30, 30, 30, 15, 10, 10], WIDTHS = [60, 60, 60, 30, 20, 20], OUTER_STEPS = 3

function estimate(tracks, n, o, init = null) {
	let { active, comp } = tracks.src, F = o.fs / o.hopSize, ev2 = 1 - EV0
	let alpha = ev2 / (2 * Math.sin(Math.PI * Math.min(CURVE_HZ, F / 3) / F)) ** 4, beta = alpha / (GAP_S * F) ** 4, kappa = NU
	let p = init ? Float64Array.from(init) : new Float64Array(n), w = tracks.map(tr => new Float64Array(tr.freq.length))
	if (!init) {
		let self = Int32Array.from(tracks, (_, i) => i), mu = tracks.map(tr => tr.freq.reduce((a, b) => a + b, 0) / tr.freq.length)
		let betaRel = NU * (2 * Math.sin(Math.PI * DRIFT_HZ / F)) ** 2
		for (let s of REL_SCALES) {
			weigh(tracks, active, comp, (i, j, t) => tracks[i].freq[j] - mu[i] - p[t], s / CENT, w)
			let r = solve(tracks, w, self, tracks.length, n, 1e9, alpha, betaRel)
			p = r.p
			mu = tracks.map((tr, i) => w[i].some(v => v > 0) ? r.c[i] + r.delta[i] : tr.freq.reduce((a, f, j) => a + f - p[tr.start + j], 0) / tr.freq.length)
		}
	}
	let steps = init ? SCALES.length - OUTER_STEPS : 0, cl, K, c, delta
	for (let it = steps; it < SCALES.length; it++) {
		;({ cl, K, c } = classes(tracks, p, GAPS[it], WIDTHS[it]))
		delta = new Float64Array(tracks.length)
		weigh(tracks, active, comp, (i, j, t) => tracks[i].freq[j] - c[cl[i]] - delta[i] - p[t], SCALES[it] / CENT, w)
		;({ p, c, delta } = solve(tracks, w, cl, K, n, kappa, alpha, beta))
	}
	return { p, w, cl, K, c, delta }
}

// ---- disc wow: lines at the rotation rate ----

// An off-centre or warped disc varies the speed with the turntable's rotation: a sinusoid at 33⅓, 45 or 78 rpm, its
// 2nd harmonic where the disc is warped (G&R §8.3.2: an AR prior with poles at the rotation rate, or deterministic
// sinusoids). 16⅔ rpm (spoken-word discs) is left out: 0.28 Hz and its harmonics are where a singer's or speaker's own
// slow drift is. In each WIN_S window (hop WIN_S/2) the estimate's periodogram (Hann, zero-padded ×8) is searched
// within ±RATE_TOL of each rate and harmonic, at least 3 cycles in the window; a peak standing LINE_T× over the median
// of the ±0.6 Hz around it (its main lobe left out), and highest within that lobe, is a candidate. Candidates are
// fitted to the pieces themselves (the tied model with p = Σ a·cos + b·sin) and kept where an amplitude stands T_MIN×
// over its noise: the same fit on the residuals with signs drawn at random (a wild bootstrap), RMS over DRAWS draws.
// A disc turns at one rate, so its line keeps amplitude and phase from one half of the window to the other: their
// correlation, 2·Re(a₁ā₂)/(|a₁|² + |a₂|²), must reach COHERENT. Measured on the tuning music, speech and singing with
// disc wow of 0.3 and 1 % at 33⅓, 45 and 78 rpm: the best false candidate stood 4.2× (audio-lena, 0.72 Hz under 78 rpm
// wow; halves 0.65); 57 of the 69 true lines stood 4.5× or more (halves 0.91–1), a lone voice's at most 3×.
// A line shallower than MIN_DEPTH (0.1 % peak, 1.7 cents) is left: within a good turntable's own wow (DIN 45500 asks
// ≤ 0.2 % weighted) and beneath hearing; a produced track's own slow chorus or tape effect can stand that high.
// A window shorter than MIN_S is not tested: the second bootstrap needs its seconds, and over a few seconds a voice's
// intonation has as much at 1–2 Hz as any disc (without it, short clean VoiceBank+DEMAND utterances, 1.9–4.4 s, took
// lines of 0.5–0.9 %).
const RPM = [100 / 3, 45, 78], RATE_TOL = 0.04, WIN_S = 20, MIN_S = 5, LINE_T = 6, LINE_D = 0.6, T_MIN = 4.5, DRAWS = 20, MIN_DEPTH = 0.001, COHERENT = 0.8

function lineFit(tracks, w, cl, K, F, freqs, a, b, kappa) {
	let M = 2 * freqs.length, ph = new Float64Array(M)
	let Hcc = new Float64Array(K), Hct = new Float64Array(K * M), Htt = new Float64Array(M * M), bc = new Float64Array(K), bt = new Float64Array(M)
	let sp = new Float64Array(M), spp = new Float64Array(M * M), syp = new Float64Array(M)
	for (let i = 0; i < tracks.length; i++) {
		let tr = tracks[i], wi = w[i], k = cl[i], W = 0, sy = 0
		if (tr.end < a || tr.start >= b) continue
		sp.fill(0); spp.fill(0); syp.fill(0)
		for (let j = 0; j < wi.length; j++) {
			let t = tr.start + j, ww = wi[j]
			if (!(ww > 0) || t < a || t >= b) continue
			for (let m = 0; m < freqs.length; m++) { let x = PI2 * freqs[m] * t / F; ph[2 * m] = Math.cos(x); ph[2 * m + 1] = Math.sin(x) }
			W += ww; sy += ww * tr.freq[j]
			for (let m = 0; m < M; m++) { sp[m] += ww * ph[m]; syp[m] += ww * tr.freq[j] * ph[m]; for (let q = 0; q < M; q++) spp[m * M + q] += ww * ph[m] * ph[q] }
		}
		if (!(W > 0)) continue
		let r = kappa / (W + kappa), sh = 1 / (W + kappa)
		Hcc[k] += W * r; bc[k] += sy * r
		for (let m = 0; m < M; m++) { Hct[k * M + m] += sp[m] * r; bt[m] += syp[m] - sy * sp[m] * sh; for (let q = 0; q < M; q++) Htt[m * M + q] += spp[m * M + q] - sp[m] * sp[q] * sh }
	}
	// the classes eliminated: (Htt − Σ_k Hctᵀ Hct / Hcc) θ = bt − Σ_k Hct bc / Hcc
	for (let k = 0; k < K; k++) {
		if (!(Hcc[k] > 1e-12)) continue
		for (let m = 0; m < M; m++) { bt[m] -= Hct[k * M + m] * bc[k] / Hcc[k]; for (let q = 0; q < M; q++) Htt[m * M + q] -= Hct[k * M + m] * Hct[k * M + q] / Hcc[k] }
	}
	for (let m = 0; m < M; m++) Htt[m * M + m] += 1e-12
	for (let m = 0; m < M; m++) for (let r = m + 1; r < M; r++) { let f = Htt[r * M + m] / Htt[m * M + m]; for (let q = m; q < M; q++) Htt[r * M + q] -= f * Htt[m * M + q]; bt[r] -= f * bt[m] }
	let th = new Float64Array(M)
	for (let m = M - 1; m >= 0; m--) { let s = bt[m]; for (let q = m + 1; q < M; q++) s -= Htt[m * M + q] * th[q]; th[m] = s / Htt[m * M + m] }
	return th
}
const lineAt = (freqs, th, F, t) => { let s = 0; for (let m = 0; m < freqs.length; m++) { let x = PI2 * freqs[m] * t / F; s += th[2 * m] * Math.cos(x) + th[2 * m + 1] * Math.sin(x) } return s }

// windows of the curve: starts, hop half a window, the last aligned to the end
function windows(n, L) {
	if (L >= n) return [0]
	let s = []
	for (let a = 0; a + L <= n; a += L >> 1) s.push(a)
	if (s[s.length - 1] + L < n) s.push(n - L)
	return s
}

// candidate lines in p[a, a + L): frequencies (Hz)
function candidates(p, a, L, F) {
	let N = 2 ** Math.ceil(Math.log2(8 * L)), re = new Float64Array(N), im = new Float64Array(N), m = 0
	for (let i = 0; i < L; i++) m += p[a + i] / L
	for (let i = 0; i < L; i++) re[i] = (p[a + i] - m) * (0.5 - 0.5 * Math.cos(PI2 * (i + 0.5) / L))
	fft(re, im)
	let P = Float64Array.from({ length: N / 2 + 1 }, (_, q) => re[q] ** 2 + im[q] ** 2), df = F / N, lobe = 2 * F / L, out = []
	for (let rpm of RPM) for (let h = 1; h <= 2; h++) {
		let fr = h * rpm / 60
		if (fr * L / F < 3) continue
		let q0 = Math.max(1, Math.floor(fr * (1 - RATE_TOL) / df)), q1 = Math.min(N / 2 - 1, Math.ceil(fr * (1 + RATE_TOL) / df)), q = q0
		for (let r = q0; r <= q1; r++) if (P[r] > P[q]) q = r
		// a peak, and the highest within its own main lobe: else it is the skirt of a line at another frequency
		let w = Math.round(lobe / df), top = true
		for (let r = Math.max(1, q - w); r <= Math.min(N / 2, q + w); r++) if (P[r] > P[q]) top = false
		if (!top) continue
		let ref = []
		for (let r = Math.max(1, Math.round((q * df - LINE_D) / df)); r <= Math.min(N / 2, Math.round((q * df + LINE_D) / df)); r++) if (Math.abs(r - q) * df > lobe) ref.push(P[r])
		ref.sort((u, v) => u - v)
		if (!(P[q] > LINE_T * (ref[ref.length >> 1] || 0))) continue
		let u = Math.log(P[q - 1]), v = Math.log(P[q]), z = Math.log(P[q + 1]), d = u - 2 * v + z < 0 ? 0.5 * (u - z) / (u - 2 * v + z) : 0
		let f = (q + d) * df
		if (!out.some(g => Math.abs(g - f) < lobe)) out.push(f)
	}
	return out
}

// accepted lines per window: [{ a, L, freqs, theta }]
function discLines(tracks, n, o, est) {
	let F = o.fs / o.hopSize, L = Math.min(n, Math.round(WIN_S * F)), kappa = NU, { group, G } = tracks.src, out = []
	if (L < MIN_S * F) return out
	for (let a of windows(n, L)) {
		let fr = candidates(est.p, a, L, F)
		if (!fr.length) continue
		let th = lineFit(tracks, est.w, est.cl, est.K, F, fr, a, a + L, kappa)
		let res = tracks.map((tr, i) => Float64Array.from(tr.freq, (f, j) => f - est.c[est.cl[i]] - est.delta[i] - lineAt(fr, th, F, tr.start + j)))
		// two bootstraps, the larger noise counts: one sign per harmonic group (independent notes), one per second (a
		// voice whose harmonics were not grouped moves them all at once)
		let B = Math.round(F), noise = new Float64Array(fr.length)
		for (let unit of [i => group[i], (i, t) => G + Math.floor(t / B)]) {
			let rnd = lcg(3), q = new Float64Array(fr.length)
			for (let d = 0; d < DRAWS; d++) {
				let sg = Float64Array.from({ length: G + Math.ceil(n / B) }, () => rnd() < 0.5 ? -1 : 1)
				let fake = tracks.map((tr, i) => ({ start: tr.start, end: tr.end, freq: res[i].map((v, j) => sg[unit(i, tr.start + j)] * v) }))
				let t2 = lineFit(fake, est.w, est.cl, est.K, F, fr, a, a + L, kappa)
				for (let m = 0; m < fr.length; m++) q[m] += (t2[2 * m] ** 2 + t2[2 * m + 1] ** 2) / DRAWS
			}
			for (let m = 0; m < fr.length; m++) noise[m] = Math.max(noise[m], q[m])
		}
		let h1 = lineFit(tracks, est.w, est.cl, est.K, F, fr, a, a + (L >> 1), kappa), h2 = lineFit(tracks, est.w, est.cl, est.K, F, fr, a + (L >> 1), a + L, kappa)
		let keep = fr.filter((_, m) => {
			let a2 = th[2 * m] ** 2 + th[2 * m + 1] ** 2, u = h1[2 * m], v = h1[2 * m + 1], x = h2[2 * m], y = h2[2 * m + 1]
			return a2 > T_MIN ** 2 * noise[m] && a2 >= MIN_DEPTH ** 2 && 2 * (u * x + v * y) >= COHERENT * (u * u + v * v + x * x + y * y)
		})
		if (keep.length) out.push({ a, L, freqs: keep })
	}
	return out
}

// the lines' curve: each window's fit, cross-faded (Hann halves, a partition of unity; the outer halves flat)
function linesCurve(tracks, n, o, est, lines) {
	let F = o.fs / o.hopSize, kappa = NU, all = windows(n, Math.min(n, Math.round(WIN_S * F))), q = new Float64Array(n), norm = new Float64Array(n)
	for (let { a, L, freqs } of lines) {
		let th = lineFit(tracks, est.w, est.cl, est.K, F, freqs, a, a + L, kappa), first = a === all[0], last = a === all[all.length - 1]
		lines.find(l => l.a === a).theta = th
		for (let i = 0; i < L; i++) {
			let wt = (first && i < L / 2) || (last && i >= L / 2) ? 1 : 0.5 - 0.5 * Math.cos(PI2 * (i + 0.5) / L)
			q[a + i] += wt * lineAt(freqs, th, F, a + i); norm[a + i] += wt
		}
	}
	// windows without a line count with weight, holding the curve down there
	for (let a of all) if (!lines.some(l => l.a === a)) {
		let L = Math.min(n, Math.round(WIN_S * F)), first = a === all[0], last = a === all[all.length - 1]
		for (let i = 0; i < L; i++) norm[a + i] += (first && i < L / 2) || (last && i >= L / 2) ? 1 : 0.5 - 0.5 * Math.cos(PI2 * (i + 0.5) / L)
	}
	for (let t = 0; t < n; t++) q[t] = norm[t] > 0 ? q[t] / norm[t] : 0
	return q
}

// ---- 'partial' ----

function partialCurve(mono, o) {
	// a pilot tone, where there is one, measures the speed outright, flutter too
	let pilot = findTone(mono, o, false)
	if (pilot) return referenceCurve(mono, { ...o, refFreq: 0, pilot })
	let { tracks, nFrames: n } = trackPartials(mono, o), zero = new Float64Array(n)
	let out = { p: zero, ev: zero, centre: o.frameSize / 2 - o.hopSize / 2, tracks: tracks.map(tr => ({ start: tr.start, end: tr.end, freq: Math.exp(median(tr.freq)), length: tr.freq.length })), lines: [] }
	if (tracks.length < 2) return out
	tracks.src = sources(tracks, n)
	let est = estimate(tracks, n, o), lines = discLines(tracks, n, o, est), q = zero, ev = new Float64Array(n)
	if (lines.length) {
		q = linesCurve(tracks, n, o, est, lines)
		est = estimate(tracks, n, o, q)
		q = linesCurve(tracks, n, o, est, lines)
		for (let { a, L } of lines) ev.fill(1, a, a + L)
	}
	// a correction that never reaches MIN_DEV (0.17 cents) is none
	if (!q.some(v => Math.abs(v) >= MIN_DEV)) return out
	out.lines = lines.flatMap(({ a, L, freqs, theta }) => freqs.map((f, m) => ({ start: (a * o.hopSize + out.centre) / o.fs, end: ((a + L) * o.hopSize + out.centre) / o.fs, freq: f, depth: 100 * Math.hypot(theta[2 * m], theta[2 * m + 1]), rpm: 60 * f })))
	return Object.assign(out, { p: q, ev })
}
const MIN_DEV = 1e-4
const median = v => { let s = Array.from(v).sort((a, b) => a - b); return s[s.length >> 1] }

// in-place radix-2 complex FFT
function fft(re, im) {
	let n = re.length
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1
		for (; j & bit; bit >>= 1) j ^= bit
		j ^= bit
		if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
	}
	for (let len = 2; len <= n; len <<= 1) {
		let a = -PI2 / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1
		for (let i = 0; i < n; i += len) {
			let cr = 1, ci = 0
			for (let j = 0; j < h; j++) {
				let k = i + j + h, vr = re[k] * cr - im[k] * ci, vi = re[k] * ci + im[k] * cr
				re[k] = re[i + j] - vr; im[k] = im[i + j] - vi; re[i + j] += vr; im[i + j] += vi
				let t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
			}
		}
	}
}

// A tone measures the speed's level directly ('reference': its nominal is known; 'pitch': its own trend), lightly
// smoothed (half power at `hz`, by default a third of the hop rate: flutter passes); across a gap without evidence
// the curve returns to 0 within ~LEVEL_GAP_S: minimise Σ ev_n (z_n − p_n)² + α Σ (Δ²p_n)² + β Σ p_n²,
// β = α/(LEVEL_GAP_S·F)⁴.
const LEVEL_GAP_S = 0.1
function levelSolve(e, z, o, hz = 0) {
	let n = e.length, F = o.fs / o.hopSize
	let alpha = 1 / (2 * Math.sin(Math.PI * Math.min(hz || F / 3, F / 3) / F)) ** 4, beta = alpha / (LEVEL_GAP_S * F) ** 4
	let d0 = new Float64Array(n), d1 = new Float64Array(n), d2 = new Float64Array(n), b = new Float64Array(n)
	for (let i = 0; i < n; i++) { d0[i] = e[i] + beta; b[i] = e[i] * z[i] }
	for (let i = 0; i + 2 < n; i++) {
		d0[i] += alpha; d0[i + 1] += 4 * alpha; d0[i + 2] += alpha
		d1[i] -= 2 * alpha; d1[i + 1] -= 2 * alpha
		d2[i] += alpha
	}
	return pentaSolve(d0, d1, d2, b)
}

// Phase-vocoder IF needs the analysed signal to be roughly stationary across the WHOLE analysis window, not just across
// one hop — the frame-to-frame phase difference is effectively an average over the frame's own span. Over a 93 ms
// frame a 30 Hz flutter completes ~2.8 cycles and the IF collapses toward the mean (measured: ±0.4 % 30 Hz flutter on
// a 440 Hz tone reads back as ~0, correlation −0.18 against the true curve). 'partial' mode accepts that: dense music
// needs the long frame to keep neighbouring partials out of each other's reading. A single known tone has no
// neighbours once band-passed, so 'reference' mode reads it over a short window (`IF_FRAME`, or ~4.5 cycles of a low
// tone) and resolves flutter, via a Goertzel-style evaluation of the DFT at the *exact* target frequency — no bin grid
// to flicker across from one frame to the next.
const IF_FRAME = 1024

// Windowed single-frequency DFT of `data[pos..pos+N)` at `freqHz`, via an
// angle-addition rotation (no per-sample trig call — same trick @audio/resample-sinc
// uses for its sinc kernel). Returns [re, im].
function goertzelDft(data, pos, N, freqHz, fs, win) {
	let w = PI2 * freqHz / fs
	let cw = Math.cos(w), sw = Math.sin(w) // e^{-iw} per-sample rotation
	let ca = 1, sa = 0, re = 0, im = 0
	for (let i = 0; i < N; i++) {
		let x = data[pos + i] * win[i]
		re += x * ca
		im -= x * sa
		let ca1 = ca * cw - sa * sw
		sa = sa * cw + ca * sw
		ca = ca1
	}
	return [re, im]
}

function hann(N) {
	let w = new Float64Array(N)
	for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(PI2 * i / (N - 1)))
	return w
}

// ---- mode 'reference': a steady tone recorded with the sound ----

// The tone is read where it dominates its neighbourhood. Per hop: the Goertzel DFT of the tone band-passed at Q 5 over
// ifN samples (~4.5 cycles, at least IF_FRAME), its phase advance over one hop the frequency — unambiguous within
// ±fs/(2·hop) (43 Hz at the defaults) of where it is read, so each hop reads at the last good reading, and where there
// is none, at the window's spectral peak within maxDeviation (a 19 kHz pilot under 2 % wow moves 380 Hz); read twice,
// the second time at the first reading. A reading counts where the tone stands SNR_DB over the DFT 3 bins either side
// and within maxDeviation of nominal.
const SNR_DB = 10
function readTone(mono, o, f, n, centre) {
	let { fs, hopSize: hop, maxDeviation } = o
	let x = cascade(Float64Array.from(mono), [bandpass(f, 5, fs)]), N = Math.max(IF_FRAME, Math.min(8192, Math.round(4.5 * fs / f))), win = hann(N), side = 3 * fs / N
	let z = new Float64Array(n), snr = new Float64Array(n).fill(-Infinity), fe = 0, M = 2 ** Math.ceil(Math.log2(2 * N))
	let peak = a => {   // the windowed spectrum's peak within maxDeviation of f, log-parabolic
		let re = new Float64Array(M), im = new Float64Array(M)
		for (let i = 0; i < N; i++) re[i] = x[a + i] * win[i]
		fft(re, im)
		let P = q => Math.log(re[q] * re[q] + im[q] * im[q] + 1e-300), q0 = Math.max(1, Math.floor(f * (1 - maxDeviation) * M / fs)), q1 = Math.min(M / 2 - 1, Math.ceil(f * (1 + maxDeviation) * M / fs)), k = q0
		for (let q = q0; q <= q1; q++) if (P(q) > P(k)) k = q
		let u = P(k - 1), v = P(k), w = P(k + 1), d = u - 2 * v + w < 0 ? 0.5 * (u - w) / (u - 2 * v + w) : 0
		return (k + d) * fs / M
	}
	for (let t = 0; t < n; t++) {
		let a = Math.round(t * hop + centre - (N + hop) / 2)
		if (a < 0 || a + hop + N > x.length) continue
		let read = g => { let [r0, i0] = goertzelDft(x, a, N, g, fs, win), [r1, i1] = goertzelDft(x, a + hop, N, g, fs, win); return [g + wrapPhase(Math.atan2(i1, r1) - Math.atan2(i0, r0) - PI2 * hop * g / fs) * fs / (PI2 * hop), r0 * r0 + i0 * i0] }
		let [f1] = read(fe || (f * maxDeviation > fs / (4 * hop) ? peak(a) : f)), [fi, P] = read(f1)
		let [u0, v0] = goertzelDft(x, a, N, fi - side, fs, win), [u1, v1] = goertzelDft(x, a, N, fi + side, fs, win)
		let s = 10 * Math.log10(P / Math.max(u0 * u0 + v0 * v0, u1 * u1 + v1 * v1, 1e-300)), r = Math.log(fi / f)
		if (s >= SNR_DB && Math.abs(r) < maxDeviation) { z[t] = r; snr[t] = s; fe = fi } else fe = 0
	}
	return { z, snr }
}

// A hum is read over ~90 ms (4.5 cycles of 50 Hz): its readings are smoothed to HUM_HZ (wow); a high pilot is read
// over 23 ms and keeps flutter. Only the fundamental: the hum's harmonics lie in the program's own range (a voice at
// 100 Hz puts its partials on the 2nd, 4th, 6th…), where a note near a line reads as the line.
const HUM_HZ = 4, ROBUST = 5 / CENT
function referenceCurve(mono, o) {
	let { fs, frameSize: N, hopSize: hop } = o, found = !o.refFreq, refFreq = o.refFreq || o.pilot || findTone(mono, o, true)
	if (refFreq != null && !(refFreq > 0 && refFreq < fs / 2)) throw new RangeError(`dewow: refFreq ${refFreq} Hz is out of range at fs ${fs} Hz`)
	let n = mono.length >= N ? Math.floor((mono.length - N) / hop) + 1 : 0, centre = N / 2, zero = new Float64Array(n)
	if (!refFreq || !n) return { p: zero, ev: zero, centre, refFreq: refFreq || null }
	let { z, snr } = readTone(mono, o, refFreq, n, centre), ev = Float64Array.from(snr, Number.isFinite), hz = refFreq < 400 ? HUM_HZ : 0
	// a tone found, not given, is known only to a bin: its nominal is its mean reading (wow averages out)
	if (found) { let m = 0, k = 0; for (let t = 0; t < n; t++) if (ev[t]) { m += z[t]; k++ } if (k) { m /= k; for (let t = 0; t < n; t++) if (ev[t]) z[t] -= m; refFreq *= Math.exp(m) } }
	let p = levelSolve(ev, z, o, hz)
	// re-weighted: a reading far from the smoothed curve is a note near the line, not the line (biweight, ROBUST)
	for (let c of [4 * ROBUST, 2 * ROBUST, ROBUST]) p = levelSolve(Float64Array.from(ev, (e, t) => { let q = (z[t] - p[t]) / c; return e && q * q < 1 ? (1 - q * q) ** 2 : 0 }), z, o, hz)
	return { p, ev, centre, refFreq }
}

// A tone to read when none is given. A pilot (FM's 19 kHz, a TV line's 15.6 kHz, a tape's): above PILOT_LO, in
// 1024-sample frames, the most prominent bin (its power over the median of the 3rd–12th bins either side) stands
// PILOT_DB out in PILOT_SHARE of the frames, and within maxDeviation of their median frequency one does again in as
// many — music holds no such line through a whole recording. Mains hum ('reference' mode only): 50 or 60 Hz and its
// 2nd harmonic each standing SNR_DB over the ±HUM_SIDE Hz around them (16384-sample frames) in HUM_SHARE of the frames.
const PILOT_LO = 5000, PILOT_DB = 20, PILOT_SHARE = 0.95, PILOT_SIDE = [3, 12], HUM_SHARE = 0.9, HUM_SIDE = 25
function findTone(mono, o, hum) {
	let { fs, maxDeviation } = o
	if (mono.length < Math.max(fs, 16384)) return null
	let pilot = findPilot(mono, fs, maxDeviation)
	if (pilot || !hum) return pilot
	let N = 16384, bin = fs / N, frames = 0
	let series = [50, 60].map(f => [f, 2 * f].map(g => ({ g, k0: Math.floor(g * (1 - maxDeviation) / bin), k1: Math.ceil(g * (1 + maxDeviation) / bin), on: 0 })))
	stftAnalyse(mono, mag => {
		frames++
		for (let s of series) for (let h of s) {
			let k = h.k0, ref = []
			for (let q = h.k0; q <= h.k1; q++) if (mag[q] > mag[k]) k = q
			for (let q = Math.max(1, Math.round(k - HUM_SIDE / bin)); q <= k + HUM_SIDE / bin; q++) if (Math.abs(q - k) > 2) ref.push(mag[q] * mag[q])
			ref.sort((a, b) => a - b)
			if (mag[k] * mag[k] > 10 ** (SNR_DB / 10) * ref[ref.length >> 1]) h.on++
		}
	}, { frameSize: N, hopSize: N >> 1, fs })
	for (let s of series) if (s.every(h => h.on >= HUM_SHARE * frames)) return s[0].g
	return null
}
function findPilot(mono, fs, maxDeviation) {
	let N = 1024, bin = fs / N, k0 = Math.ceil(PILOT_LO / bin), k1 = Math.floor(0.95 * N / 2) - PILOT_SIDE[1]
	if (k1 <= k0) return null
	// a bin's prominence: its power over the median of PILOT_SIDE bins either side of it (its main lobe left out)
	let prom = (mag, q) => { let r = []; for (let d = PILOT_SIDE[0]; d <= PILOT_SIDE[1]; d++) r.push(mag[q - d] ** 2, mag[q + d] ** 2); r.sort((a, b) => a - b); return mag[q] ** 2 / Math.max(r[r.length >> 1], 1e-300) }
	let best = (mag, lo, hi) => { let k = lo, pk = 0; for (let q = lo; q <= hi; q++) { let p = prom(mag, q); if (p > pk) { pk = p; k = q } } return [k, pk] }
	let peaks = [], frames = 0, on = 0, thr = 10 ** (PILOT_DB / 10)
	stftAnalyse(mono, mag => { frames++; let [k, pk] = best(mag, k0, k1); if (pk > thr) peaks.push(k * bin) }, { frameSize: N, hopSize: N, fs })
	if (peaks.length < PILOT_SHARE * frames) return null
	let m = median(peaks), lo = Math.max(k0, Math.floor(m * (1 - maxDeviation) / bin)), hi = Math.min(k1, Math.ceil(m * (1 + maxDeviation) / bin))
	stftAnalyse(mono, mag => { if (best(mag, lo, hi)[1] > thr) on++ }, { frameSize: N, hopSize: N, fs })
	return on >= PILOT_SHARE * frames ? m : null
}

// ---- mode 'pitch': frame f0 relative to its own smoothed trend ----

function pitchCurve(mono, o) {
	let { fs, frameSize: N, hopSize: hop, smooth, minFreq, maxFreq } = o
	let nFrames = mono.length >= N ? Math.floor((mono.length - N) / hop) + 1 : 0
	let f0 = new Float64Array(nFrames).fill(NaN)
	for (let t = 0; t < nFrames; t++) {
		let frame = mono.subarray(t * hop, t * hop + N)
		let r = pyin(frame, { fs, minFreq, maxFreq })
		if (r) f0[t] = r.freq
	}
	// Baseline = zero-phase low-pass of f0 itself, holding flat (not decaying to 1 —
	// there is no "nominal" f0) across unvoiced gaps. `smooth` doubles here as the
	// vibrato/drift cutoff: short smooth (the 0.05 s default) tracks pitch quickly, so
	// genuine slow wow gets absorbed into the baseline and cancels out of the ratio —
	// only fast flutter survives as deviation. Pass a `smooth` of several seconds to
	// recover slow wow in 'pitch' mode, at the cost of also absorbing real vibrato.
	let held = holdLast(f0)
	let baseline = zeroPhaseOnePole(held, hop / fs, smooth)
	let p = new Float64Array(nFrames), ev = new Float64Array(nFrames)
	for (let t = 0; t < nFrames; t++) if (Number.isFinite(f0[t]) && baseline[t] > 0) { p[t] = Math.log(f0[t] / baseline[t]); ev[t] = 1 }
	return { p: levelSolve(ev, p, o), ev, centre: N / 2 }
}

function holdLast(curve) {
	let out = new Float64Array(curve.length)
	let last = NaN
	for (let i = 0; i < curve.length; i++) {
		if (Number.isFinite(curve[i])) last = curve[i]
		out[i] = last
	}
	// back-fill a leading gap with the first value seen
	let first = NaN
	for (let i = 0; i < out.length; i++) if (Number.isFinite(out[i])) { first = out[i]; break }
	if (Number.isFinite(first)) for (let i = 0; i < out.length && !Number.isFinite(out[i]); i++) out[i] = first
	return out
}

// ---- shared: zero-phase smoothing, per-sample warp ----

// Forward-backward one-pole low-pass — zero phase, no group delay. Time constant
// `tau` seconds; `hopSec` is the curve's own sample spacing.
function zeroPhaseOnePole(curve, hopSec, tau) {
	let n = curve.length
	if (n === 0) return curve
	let a = Math.exp(-hopSec / Math.max(tau, hopSec))
	let fwd = new Float64Array(n)
	fwd[0] = curve[0]
	for (let i = 1; i < n; i++) fwd[i] = a * fwd[i - 1] + (1 - a) * curve[i]
	let out = new Float64Array(n)
	out[n - 1] = fwd[n - 1]
	for (let i = n - 2; i >= 0; i--) out[i] = a * out[i + 1] + (1 - a) * fwd[i]
	return out
}

// per-hop curve (hop t at sample t·hop + centre) → per-sample, linear between hops, held past the ends
function upsampleToSamples(curve, hop, centre, nSamples) {
	let n = curve.length
	let out = new Float64Array(nSamples)
	if (n === 0) { out.fill(1); return out }
	for (let i = 0; i < nSamples; i++) {
		let q = (i - centre) / hop
		if (q <= 0) { out[i] = curve[0]; continue }
		if (q >= n - 1) { out[i] = curve[n - 1]; continue }
		let f0 = Math.floor(q), frac = q - f0
		out[i] = curve[f0] + (curve[f0 + 1] - curve[f0]) * frac
	}
	return out
}

// Integrate 1/speed into a warped read position + the per-sample step used to get
// there (reused to pick the anti-alias cutoff). Genuine wow/flutter oscillates
// around 1.0, so its integral over any multi-cycle span is ~0 and the natural
// corrected length already lands within a fraction of a percent of the source
// length — no rescaling is applied here (an earlier version scaled `1/spd` by
// `n/Σ(1/spd)` to force an exact match, but that silently cancelled any curve
// with a non-zero mean, including real wow measured over a window that doesn't
// span a whole number of wow cycles — the correction it produced was audibly
// wrong). `outLen === null` walks until the read position exhausts the source
// (natural length); a fixed `outLen` (keepLength) just stops the walk there,
// leaving the read position pinned at the source's last sample past that point.
function buildPositions(spd, outLen) {
	let n = spd.length
	let fixed = outLen != null
	let cap = fixed ? outLen : n * 4 + 16 // safety bound against a runaway walk
	let pos = new Float64Array(fixed ? outLen : cap), step = new Float64Array(fixed ? outLen : cap)
	let p = 0, i = 0
	while (fixed ? i < outLen : (p < n - 1 && i < cap)) {
		pos[i] = p
		let idx = p < 0 ? 0 : p >= n ? n - 1 : Math.round(p)
		let s = 1 / spd[idx]
		step[i] = s
		p += s
		i++
	}
	return fixed ? { pos, step } : { pos: pos.subarray(0, i), step: step.subarray(0, i) }
}

// ---- shared curve pipeline (used by both analyze() and dewow()) ----

function computeCurve(mono, o) {
	let hop = o.hopSize, hopSec = hop / o.fs
	let r
	if (o.mode === 'reference') r = referenceCurve(mono, o)
	else if (o.mode === 'pitch') r = pitchCurve(mono, o)
	else if (o.mode === 'partial') r = partialCurve(mono, o)
	else throw new RangeError(`dewow: unknown mode "${o.mode}" (expected 'partial' | 'reference' | 'pitch')`)

	let nFrames = r.p.length
	let valid = 0
	for (let i = 0; i < nFrames; i++) if (r.ev[i] >= 0.5) valid++
	let filled = Float64Array.from(r.p, Math.exp)
	let wowComp = zeroPhaseOnePole(filled, hopSec, o.smooth)
	let flutterComp = new Float64Array(nFrames)
	for (let i = 0; i < nFrames; i++) flutterComp[i] = filled[i] - wowComp[i]

	return { filled, wowComp, flutterComp, hop, hopSec, centre: r.centre, nFrames, confidence: nFrames ? valid / nFrames : 0, tracks: r.tracks, lines: r.lines, reference: r.refFreq }
}

/**
 * Analysis-only "wow & flutter meter" — recovers the speed curve without correcting
 * the audio. `wow`/`flutter` are unweighted RMS deviation in % (not the IEC
 * 60386 / DIN 45507 psychoacoustically-*weighted* figure — see README); `wowPeak` /
 * `flutterPeak` are the unweighted peak deviation in %.
 */
export function analyze(data, opts = {}) {
	let o = normalizeOpts(opts)
	let { mono } = normalizeChannels(data)
	let c = computeCurve(mono, o)

	let wowSq = 0, flutterSq = 0, wowPeak = 0, flutterPeak = 0
	for (let i = 0; i < c.nFrames; i++) {
		let wd = c.wowComp[i] - 1, fd = c.flutterComp[i]
		wowSq += wd * wd; flutterSq += fd * fd
		if (Math.abs(wd) > wowPeak) wowPeak = Math.abs(wd)
		if (Math.abs(fd) > flutterPeak) flutterPeak = Math.abs(fd)
	}
	let times = new Float32Array(c.nFrames)
	for (let i = 0; i < c.nFrames; i++) times[i] = (i * c.hop + c.centre) / o.fs

	let result = {
		speed: Float32Array.from(c.filled),
		times, hop: c.hop, fs: o.fs,
		wow: c.nFrames ? Math.sqrt(wowSq / c.nFrames) * 100 : 0,
		flutter: c.nFrames ? Math.sqrt(flutterSq / c.nFrames) * 100 : 0,
		wowPeak: wowPeak * 100,
		flutterPeak: flutterPeak * 100,
		confidence: c.confidence,
	}
	if (c.tracks) result.tracks = c.tracks
	if (c.lines) result.lines = c.lines
	if (c.reference !== undefined) result.reference = c.reference
	return result
}

/**
 * Corrects wow & flutter by variable-rate resampling against the estimated speed
 * curve. `data` is a mono Float32Array or an array of channels; returns the same
 * shape (new arrays). See analyze() for the estimator this drives.
 */
export default function dewow(data, opts = {}) {
	let o = normalizeOpts(opts)
	let { channels, mono, multi } = normalizeChannels(data)
	if (!mono.length) return multi ? channels.map(() => new Float32Array(0)) : new Float32Array(0)

	let c = computeCurve(mono, o)
	let used = new Float64Array(c.nFrames)
	let lo = 1 - o.maxDeviation, hi = 1 + o.maxDeviation
	for (let i = 0; i < c.nFrames; i++) {
		let s = 1 + (o.wow ? c.wowComp[i] - 1 : 0) + (o.flutter ? c.flutterComp[i] : 0)
		used[i] = s < lo ? lo : s > hi ? hi : s
	}
	// nothing to correct: the input itself
	if (used.every(v => Math.abs(v - 1) < 1e-12)) {
		let out = channels.map(ch => { let y = new Float32Array(mono.length); y.set(ch); return y })
		return multi ? out : out[0]
	}

	let perSample = upsampleToSamples(used, c.hop, c.centre, mono.length)
	let { pos, step } = buildPositions(perSample, o.keepLength ? mono.length : null)
	let outLen = pos.length

	let out = channels.map(ch => {
		let y = new Float32Array(outLen)
		for (let i = 0; i < outLen; i++) {
			let cutoff = step[i] > 1 ? 1 / step[i] : 1
			y[i] = sincRead(ch, pos[i], 16, cutoff)
		}
		return y
	})
	return multi ? out : out[0]
}
