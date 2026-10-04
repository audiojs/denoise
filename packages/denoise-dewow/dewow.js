// Wow & flutter correction — pitch-drift removal for tape/vinyl/cassette transfers
// (the classical, non-ML counterpart of Celemony Capstan).
//
// A speed change of the medium scales every frequency in the recording by one ratio at one instant. A performer's
// pitch movement (vibrato, a scoop, a glide, a melody, intonation) moves one source: one note and its harmonics.
// That difference is all the estimator relies on; where the signal cannot show it, nothing is corrected.
//
// 1. Speed curve, one value per STFT hop, at the analysis frame's centre (nominal = 1):
//    'partial'   — Godsill & Rayner, Digital Audio Restoration, 1998, ch. 8: log-frequency tracks
//                  f_ni = f0_i + p_n + v_ni (eq. 8.9, 8.33), each track an unknown centre f0_i, the log speed p_n
//                  common to all, under a zero-mean smoothness prior (eq. 8.23, 8.31). Their v_ni is i.i.d. noise,
//                  and the method fails where vibrato or slides dominate (§8.1): a voice's harmonics move together,
//                  so a per-track consensus follows its vibrato. Here harmonics of one note are grouped into one
//                  source and count once, and a hop is evidence only where at least two independent sources agree
//                  on it (re-weighted least squares, Tukey's biweight, annealed), solved on hop-to-hop increments so
//                  the centres never need estimating. A Wiener gate then keeps of the curve only what stands above
//                  its own measured uncertainty. A lone voice, however many harmonics, measures nothing: its
//                  vibrato and wow are the same observation. Tracks: STFT peak-picking, McAulay & Quatieri 1986
//                  nearest-frequency linking, phase-vocoder instantaneous frequency.
//    'reference' — phase-vocoder IF locked to one known tone (mains hum, a pilot or calibration tone): a source
//                  known not to move, so evidence on its own; the method of choice where such a tone is present.
//                  Czyżewski et al., "Wow detection and compensation employing spectral processing of audio",
//                  AES 117th Convention, 2004; "DSP techniques for determining 'wow' distortion", JAES, 2007.
//    'pitch'     — @audio/pitch-pyin f0 relative to its own zero-phase smoothed trend: monophonic material, and it
//                  takes the performer's own pitch movement for speed (opt-in).
// 2. Hops without evidence return to 1 (the prior's mean): no evidence, no correction; a clip with none comes back
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

const PI2 = Math.PI * 2

function normalizeOpts(opts) {
	return {
		fs: opts.fs || 44100,
		mode: opts.mode || 'partial',
		refFreq: opts.refFreq,
		frameSize: opts.frameSize || 4096,
		hopSize: opts.hopSize || 512,
		smooth: opts.smooth ?? 0.05,
		wow: opts.wow ?? true,
		flutter: opts.flutter ?? true,
		maxDeviation: opts.maxDeviation ?? 0.05,
		minTrack: opts.minTrack ?? 0.1,
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

// Phase-vocoder IF needs the analysed signal to be roughly stationary across the
// WHOLE analysis window, not just across one hop — the frame-to-frame phase
// difference is effectively an average over the frame's own span. At the default
// frameSize (4096, 93 ms) that holds fine for wow (<6 Hz, period > 166 ms) but not
// for flutter — a 30 Hz component (33 ms period) completes ~2.8 cycles inside one
// window and the IF estimate collapses toward the mean (measured: a synthetic ±0.4%
// 30 Hz flutter on a 440 Hz tone reads back as ~0 at frameSize 4096, correlation
// −0.18 against the true curve). 'partial' mode accepts that: dense music needs the
// long frame to keep neighbouring partials out of each other's reading (a 1024-sample
// reading, tried, let a C-E-G triad's fundamentals, 62–68 Hz apart, beat into each
// other). A single known tone has no neighbours once band-passed, so 'reference'
// mode reads it over a short window (`IF_FRAME`, or ~4.5 cycles of a low tone) and
// resolves flutter, via a Goertzel-style evaluation of the DFT at the *exact* target
// frequency — no bin grid to flicker across from one frame to the next.
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

// Phase-vocoder instantaneous frequency of a (slowly moving) target frequency at hop t: the phase advance between
// two `ifN` windows one hop apart, placed symmetrically about the STFT frame's centre (t·hop + frameSize/2), so the
// reading belongs to the same instant as the frame it was picked in and as the curve sample it becomes. Stateless
// per call (re-evaluates both windows), so each live track can ask at its own frequency. NaN where a window leaves
// the signal.
function makeFineTracker(source, fs, hop, ifN, centre) {
	let win = hann(ifN)
	return function freqAt(t, freqHz) {
		let a = Math.round(t * hop + centre - (ifN + hop) / 2)
		if (a < 0 || a + hop + ifN > source.length) return NaN
		let [re0, im0] = goertzelDft(source, a, ifN, freqHz, fs, win)
		let [re1, im1] = goertzelDft(source, a + hop, ifN, freqHz, fs, win)
		let d = wrapPhase(Math.atan2(im1, re1) - Math.atan2(im0, re0) - PI2 * hop * freqHz / fs)
		return freqHz + d * fs / (PI2 * hop)
	}
}

// ---- mode 'partial': partial tracks → sources → the speed they agree on ----

// STFT peak-picking + McAulay-Quatieri nearest-frequency linking (±3 %/hop), within [minFreq, maxFreq]. A track may
// follow a vibrato or a glide: what its movement means is decided later, by whether other sources share it.
// Frequency: the phase-vocoder IF at the peak bin, over the frame (93 ms at the defaults): wow (< 6 Hz) is
// resolved, flutter is averaged away (a tone in 'reference' mode resolves it); a shorter window would let
// neighbouring partials of dense music into each other's reading.
function trackPartials(mono, o) {
	let { fs, frameSize: N, hopSize: hop } = o
	let half = N >> 1
	let k0 = Math.max(2, Math.floor(o.minFreq * N / fs)), k1 = Math.min(half - 2, Math.ceil(o.maxFreq * N / fs))
	let prev = new Float64Array(half + 1)
	let live = [], done = []
	let t = 0

	stftAnalyse(mono, (mag, phase) => {
		let maxMag = 0
		for (let k = 0; k <= half; k++) if (mag[k] > maxMag) maxMag = mag[k]
		// -50 dB relative to the frame's loudest bin: conservative vs. sinusoidal-track's
		// -60 dB default — we need long *stable* tracks for a speed estimate, not maximal
		// peak recall, so a slightly higher floor trades a few weak partials for fewer
		// spurious noise-bin tracks.
		let floor = maxMag * 3.1622776601683795e-3 // 10^(-50/20)
		let peaks = []
		if (maxMag > 0 && t > 0) {
			// A Hann-windowed pure tone has its own local maxima beyond the main lobe —
			// the first sidelobe is only ~31.5 dB down, well above the floor above — so a
			// plain "local max + amplitude" scan mistakes window sidelobes for extra
			// partials (confirmed empirically: a single steady 440 Hz tone spawns "peaks"
			// 3 bins away). Non-max suppression fixes it: rank candidates by amplitude,
			// accept the loudest first, then reject anything within one Hann main-lobe
			// width (4 bins, null-to-null) of an already-accepted bin.
			let cands = []
			for (let k = k0; k < k1; k++) {
				if (mag[k] > floor && mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) cands.push(k)
			}
			cands.sort((a, b) => mag[b] - mag[a])
			let accepted = []
			for (let k of cands) {
				if (accepted.some(k0 => Math.abs(k - k0) < 4)) continue
				accepted.push(k)
				// A sinusoid's IF (phase advance over the hop) sits where its magnitude peaks (log-parabolic
				// interpolation, within ~0.05 bin for a Hann window); a noise peak's phase advance is arbitrary,
				// ±hop/2 bins around it. Kept only where the two agree within SINUS_TOL bins: a noise track would
				// have to pass by chance hop after hop
				let bin = k + wrapPhase(phase[k] - prev[k] - PI2 * hop * k / N) * N / (PI2 * hop)
				let a = Math.log(mag[k - 1] + 1e-30), b = Math.log(mag[k]), c = Math.log(mag[k + 1] + 1e-30), den = a - 2 * b + c
				if (Math.abs(bin - k - (den < 0 ? 0.5 * (a - c) / den : 0)) < SINUS_TOL) peaks.push({ freq: bin * fs / N, amp: mag[k] })
			}
		}
		prev.set(phase)

		let claimed = new Set()
		for (let tr of live) {
			let last = tr.freq[tr.freq.length - 1]
			let bestJ = -1, bestErr = 0.03
			for (let j = 0; j < peaks.length; j++) {
				if (claimed.has(j)) continue
				let err = Math.abs(peaks[j].freq / last - 1)
				if (err < bestErr) { bestErr = err; bestJ = j }
			}
			if (bestJ >= 0) { claimed.add(bestJ); tr.freq.push(peaks[bestJ].freq); tr.amp.push(peaks[bestJ].amp); tr.end = t }
			else tr.dead = true
		}
		for (let tr of live) if (tr.dead) done.push(tr)
		live = live.filter(tr => !tr.dead)
		for (let j = 0; j < peaks.length; j++) {
			if (!claimed.has(j)) live.push({ start: t, end: t, freq: [peaks[j].freq], amp: [peaks[j].amp] })
		}
		t++
	}, { frameSize: N, hopSize: hop, fs })
	done.push(...live)

	let minFrames = Math.max(SETTLE + 2, Math.round(o.minTrack * fs / hop))
	let maxTrackAmp = 0
	for (let tr of done) {
		let m = 0; for (let a of tr.amp) m += a; m /= tr.amp.length
		tr.meanAmp = m
		if (m > maxTrackAmp) maxTrackAmp = m
	}
	// Keep tracks within −50 dB of the loudest (every source that can witness, the weak ones too); drop each track's
	// first SETTLE hops: a partial is often "new" because an onset just put energy in its bin, where the phase
	// vocoder's stationarity is weakest.
	let kept = done.filter(tr => tr.freq.length >= minFrames && tr.meanAmp >= maxTrackAmp * TRACK_FLOOR)
	for (let tr of kept) {
		let f = Float64Array.from(tr.freq.slice(SETTLE), Math.log), s = f.slice().sort()
		tr.median = s[s.length >> 1]
		tr.length = tr.freq.length
		tr.start += SETTLE
		tr.freq = f
		tr.amp = Float64Array.from(tr.amp.slice(SETTLE))
	}
	return { tracks: kept, nFrames: t }
}
const SETTLE = 2, SINUS_TOL = 0.25, TRACK_FLOOR = 3.1622776601683795e-3 // 10^(-50/20)

// Harmonics of one note share its pitch movement exactly (a periodic source's partials are integer multiples of one
// f0 at every instant), so together they are one witness to the speed, not many. Two tracks are taken for one source
// when, over their overlap, the median ratio of their frequencies is h/k within HARM_TOL, k ≤ 2 (the lower one the
// fundamental or the 2nd harmonic: a weak fundamental) and h ≤ 20k (a voice's harmonics within maxFreq). HARM_TOL:
// measured on harmonics of a ±50-cent vibrato voice, synthetic and VocalSet, whose IF over a moving frame is biased by
// up to 0.2 %. Independent notes an octave or a fifth apart pass too: merging them costs evidence, never adds false.
const HARM_TOL = 0.003, HARM_K = 2, HARM_H = 20

function harmonicPairs(tracks) {
	let adj = tracks.map(() => [])
	for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
		let a = tracks[i], b = tracks[j], s = Math.max(a.start, b.start), e = Math.min(a.end, b.end)
		if (s > e) continue
		let r = []
		for (let n = s; n <= e; n++) r.push(Math.abs(a.freq[n - a.start] - b.freq[n - b.start]))
		r.sort((x, y) => x - y)
		let ratio = Math.exp(r[r.length >> 1])
		for (let k = 1; k <= HARM_K; k++) {
			let h = Math.round(ratio * k)
			if (h > k && h <= HARM_H * k && Math.abs(Math.log(ratio * k / h)) < HARM_TOL) { adj[i].push(j); adj[j].push(i); break }
		}
	}
	return adj
}

// A track agrees with the speed where its log frequency less p is constant over ±WIN hops (the RMS about the local
// mean: offset-free), biweight at the scale c (Tukey). ±WIN hops (±93 ms at the defaults) span a vibrato cycle
// (4–8 Hz), which then never agrees; wow, slower, moves the window as one. The scale anneals from 3 %, wide enough
// that wow itself is not taken for disagreement, to 0.2 %, the local scatter of two steady partials. EV0: weak
// agreement is no evidence (two sources count once each is past biweight 0.3, |r| < 0.67c).
const SCALES = [0.03, 0.015, 0.008, 0.004, 0.002, 0.002, 0.002], WIN = 8, EV0 = 0.3
const biweight = (r, c) => { let q = r / c; return q * q < 1 ? (1 - q * q) ** 2 : 0 }

function partialCurve(mono, o) {
	let { tracks, nFrames } = trackPartials(mono, o)
	let adj = harmonicPairs(tracks)

	// per hop: the active tracks, grouped into sources (connected components of the harmonic relation)
	let active = Array.from({ length: nFrames }, () => [])
	tracks.forEach((tr, i) => { for (let n = tr.start; n <= tr.end; n++) active[n].push(i) })
	let root = new Int32Array(tracks.length), comp = active.map(act => {
		for (let i of act) root[i] = i
		let find = i => { while (root[i] !== i) i = root[i] = root[root[i]]; return i }
		let on = new Set(act)
		for (let i of act) for (let j of adj[i]) if (on.has(j)) root[find(i)] = find(j)
		let ids = new Map()
		return act.map(i => { let r = find(i); if (!ids.has(r)) ids.set(r, ids.size); return ids.get(r) })
	})

	// Each track's centre frequency f0_i is unknown, its hop-to-hop change is not: Δf_ni = Δp_n + Δv_ni. The speed
	// is solved on increments, the offsets never estimated, its level left to the zero-mean prior. Re-weighted from
	// p = 0: a source's weight at a hop is its best-agreeing partial's, its increment the mean of its partials'
	// (agreement × amplitude); the hop's evidence is the total source weight less the largest one — what survives
	// losing any one source, zero unless two independent sources agree; r2 their scatter about the consensus.
	let p = new Float64Array(nFrames), ev = new Float64Array(nFrames), dbar = new Float64Array(nFrames), r2 = new Float64Array(nFrames)
	let u = tracks.map(tr => new Float64Array(tr.freq.length))
	for (let c of SCALES) {
		tracks.forEach((tr, i) => agreement(tr, p, c, u[i]))
		ev.fill(0); dbar.fill(0); r2.fill(0)
		for (let n = 1; n < nFrames; n++) {
			let act = active[n], cp = comp[n], K = act.length ? Math.max(...cp) + 1 : 0
			if (K < 2) continue
			let ws = new Float64Array(K), ds = new Float64Array(K), as = new Float64Array(K)
			act.forEach((i, m) => {
				let tr = tracks[i], j = n - tr.start
				if (j < 1) return
				let w = Math.min(u[i][j], u[i][j - 1]), q = w * tr.amp[j], k = cp[m]
				if (w > ws[k]) ws[k] = w
				ds[k] += q * (tr.freq[j] - tr.freq[j - 1]); as[k] += q
			})
			let S = 0, M = 0, Z = 0, Q = 0
			for (let k = 0; k < K; k++) if (as[k] > 0) { ds[k] /= as[k]; S += ws[k]; if (ws[k] > M) M = ws[k]; Z += ws[k] * ds[k] }
			if (!(S > 0)) continue
			dbar[n] = Z / S
			for (let k = 0; k < K; k++) if (as[k] > 0) Q += ws[k] * (ds[k] - dbar[n]) ** 2
			ev[n] = Math.max(0, S - M - EV0)
			r2[n] = Q / S
		}
		p = solveIncrements(ev, dbar, o)
	}
	wiener(p, ev, r2, o)
	return { p, ev, centre: o.frameSize / 2 - o.hopSize / 2, tracks: tracks.map(tr => ({ start: tr.start - SETTLE, end: tr.end, freq: Math.exp(tr.median), length: tr.length })) }
}

// biweight of a track's local disagreement with p at each of its hops (prefix sums: O(length))
function agreement(tr, p, c, out) {
	let L = tr.freq.length, s1 = new Float64Array(L + 1), s2 = new Float64Array(L + 1)
	for (let j = 0; j < L; j++) { let e = tr.freq[j] - p[tr.start + j]; s1[j + 1] = s1[j] + e; s2[j + 1] = s2[j] + e * e }
	for (let j = 0; j < L; j++) {
		let a = Math.max(0, j - WIN), b = Math.min(L, j + WIN + 1), k = b - a, m = (s1[b] - s1[a]) / k
		out[j] = biweight(Math.sqrt(Math.max(0, (s2[b] - s2[a]) / k - m * m)), c)
	}
}

// MAP log speed from its increments under a zero-mean smoothness prior (Godsill & Rayner eq. 8.23, 8.31):
//   Σ ev_n (p_n − p_{n−1} − d_n)² + α Σ (Δ²p_n)² + β Σ p_n²
// α sets the curve's bandwidth: half power at WOW_HZ for unit evidence, α·(2 sin(π f/F))² = 1 (F the hop rate). β
// sets the slowest variation corrected, DRIFT_HZ (β = (2 sin(π DRIFT_HZ/F))²): slower is the transport's drift, not
// wow (a disc turns at 0.55–1.3 Hz). Across a stretch without evidence the curve returns to 0 in (α/β)^(1/4) hops.
const WOW_HZ = 6, DRIFT_HZ = 0.1
function solveIncrements(e, d, o) {
	let n = e.length, F = o.fs / o.hopSize
	let alpha = 1 / (2 * Math.sin(Math.PI * Math.min(WOW_HZ, F / 3) / F)) ** 2, beta = (2 * Math.sin(Math.PI * DRIFT_HZ / F)) ** 2
	let d0 = new Float64Array(n).fill(beta), d1 = new Float64Array(n), d2 = new Float64Array(n), b = new Float64Array(n)
	for (let i = 1; i < n; i++) { d0[i] += e[i]; d0[i - 1] += e[i]; d1[i - 1] -= e[i]; b[i] += e[i] * d[i]; b[i - 1] -= e[i] * d[i] }
	for (let i = 0; i + 2 < n; i++) {
		d0[i] += alpha; d0[i + 1] += 4 * alpha; d0[i + 2] += alpha
		d1[i] -= 2 * alpha; d1[i + 1] -= 2 * alpha
		d2[i] += alpha
	}
	return pentaSolve(d0, d1, d2, b)
}

// What the curve is worth. The agreeing sources' increments scatter about their consensus (IF noise, a string
// settling, a player's drift): a hop's consensus carries noise variance r2/ev. Carried through the same solve (DRAWS
// random-sign draws), it is the noise in the curve; over ±GATE_S the curve keeps the share of its power that stands
// above GATE_K × that noise, G = 1 − GATE_K·noise/power (Wiener). GATE_K > 1: sources kept for agreeing scatter
// less than they err, and some move together on their own (a strummed chord settling, a fretting hand's pressure);
// chosen on the tuning music: at 2 no clean clip gains a cent of pitch instability, at 1 a strummed guitar gained
// 2.3 cents. Wow is a property of the transport and lasts: a window holding less than MIN_EV_S of evidence (a few
// hops where a speaker's unlinked harmonics agreed with each other) measures nothing — without it 12 of 504 clean
// VoiceBank+DEMAND training utterances moved, by up to 1.7 cents; with it none. Where the agreed speed does not
// stand clearly above its own uncertainty, nothing is corrected.
const GATE_S = 2, GATE_K = 2, DRAWS = 4, MIN_EV_S = 0.25
function wiener(p, ev, r2, o) {
	let n = p.length, W = Math.round(GATE_S * o.fs / o.hopSize), noise = new Float64Array(n)
	let seed = 1, rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
	for (let k = 0; k < DRAWS; k++) {
		let q = solveIncrements(ev, Float64Array.from(r2, (v, f) => ev[f] > 0 ? (rnd() < 0.5 ? -1 : 1) * Math.sqrt(v / ev[f]) : 0), o)
		for (let f = 0; f < n; f++) noise[f] += q[f] * q[f] / DRAWS
	}
	let cp = new Float64Array(n + 1), cv = new Float64Array(n + 1), ce = new Float64Array(n + 1), kMin = MIN_EV_S * o.fs / o.hopSize
	for (let f = 0; f < n; f++) { cp[f + 1] = cp[f] + p[f] * p[f]; cv[f + 1] = cv[f] + noise[f]; ce[f + 1] = ce[f] + Math.min(ev[f], 1) }
	let g = new Float64Array(n)
	for (let f = 0; f < n; f++) {
		let a = Math.max(0, f - W), b = Math.min(n, f + W + 1), P = cp[b] - cp[a]
		g[f] = P > 0 && ce[b] - ce[a] >= kMin ? Math.max(0, 1 - GATE_K * (cv[b] - cv[a]) / P) : 0
	}
	for (let f = 0; f < n; f++) p[f] *= g[f]
}

// A tone measures the speed's level directly ('reference': its nominal is known; 'pitch': its own trend), lightly
// smoothed (half power at a third of the hop rate: flutter passes); across a gap without evidence the curve returns
// to 0 within ~GAP_S: minimise Σ ev_n (z_n − p_n)² + α Σ (Δ²p_n)² + β Σ p_n², β = α/(GAP_S·F)⁴.
const GAP_S = 0.1
function levelSolve(e, z, o) {
	let n = e.length, F = o.fs / o.hopSize
	let alpha = 1 / (2 * Math.sin(Math.PI / 3)) ** 4, beta = alpha / (GAP_S * F) ** 4
	let d0 = new Float64Array(n), d1 = new Float64Array(n), d2 = new Float64Array(n), b = new Float64Array(n)
	for (let i = 0; i < n; i++) { d0[i] = e[i] + beta; b[i] = e[i] * z[i] }
	for (let i = 0; i + 2 < n; i++) {
		d0[i] += alpha; d0[i + 1] += 4 * alpha; d0[i + 2] += alpha
		d1[i] -= 2 * alpha; d1[i + 1] -= 2 * alpha
		d2[i] += alpha
	}
	return pentaSolve(d0, d1, d2, b)
}

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

// ---- mode 'reference': phase-vocoder IF locked to a single known tone ----

function referenceCurve(mono, o) {
	let { fs, frameSize: N, hopSize: hop, refFreq } = o
	if (!(refFreq > 0)) throw new RangeError('dewow: mode "reference" requires opts.refFreq (Hz), a known tone or mains-hum residual')
	let half = N >> 1
	let k0 = Math.round(refFreq * N / fs)
	if (k0 < 1 || k0 >= half) throw new RangeError(`dewow: refFreq ${refFreq} Hz is out of range for frameSize ${N} at fs ${fs} Hz`)

	// A single reference bin has no partial-tracking peer to average against, so it
	// needs its own two adaptations 'partial' mode doesn't:
	//  - a Q=5 bandpass at refFreq ahead of the Goertzel read. Program content sharing
	//    the reference's band (speech has real energy down at 50/60 Hz) leaks into a
	//    plain Goertzel read and corrupts its phase; pre-filtering it out is standard
	//    practice for mains-locked tracking (measured: 50 Hz hum at −30 dB under 6 s of
	//    speech, curve correlation 0.94 unfiltered → 0.97 filtered). Q much above 5
	//    starts hurting instead — the filter's own group delay near the passband edge
	//    is no longer negligible next to the deviation being measured.
	//  - a frequency-scaled fine window instead of the fixed IF_FRAME: a single-cycle
	//    reading of a 50 Hz tone spans only 1.2 fine-window periods at IF_FRAME=1024,
	//    too few for a stable phase (measured correlation 0.13). ~4.5 cycles of the
	//    target is enough for a stable reading without over-smoothing the flutter band;
	//    high refFreq (a 1 kHz calibration tone) just floors out at IF_FRAME.
	let filtered = cascade(Float64Array.from(mono), [bandpass(refFreq, 5, fs)])
	let ifN = Math.max(IF_FRAME, Math.min(8192, Math.round(4.5 * fs / refFreq)))
	let fine = makeFineTracker(filtered, fs, hop, ifN, N / 2)
	let t = 0
	let p = [], mags = []
	stftAnalyse(filtered, (mag) => {
		p.push(Math.log(fine(t, refFreq) / refFreq))
		mags.push(mag[k0])
		t++
	}, { frameSize: N, hopSize: hop, fs })

	// a hop is evidence when the tone holds a non-trivial fraction of its typical energy (tone dropout / silence)
	let sorted = mags.slice().sort((a, b) => a - b)
	let floor = (sorted[sorted.length >> 1] || 0) * 0.1
	let ev = new Float64Array(t)
	for (let i = 0; i < t; i++) {
		if (mags[i] > floor && mags[i] > 1e-12 && Number.isFinite(p[i])) ev[i] = 1
		else p[i] = 0
	}
	return { p: levelSolve(ev, p, o), ev, centre: N / 2 }
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

	return { filled, wowComp, flutterComp, hop, hopSec, centre: r.centre, nFrames, confidence: nFrames ? valid / nFrames : 0, tracks: r.tracks }
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
