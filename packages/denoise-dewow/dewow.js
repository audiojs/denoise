// Wow & flutter correction — pitch-drift removal for tape/vinyl/cassette transfers
// (the classical, non-ML counterpart of Celemony Capstan).
//
// 1. Speed-curve estimation (one estimate per STFT hop, nominal = 1.0):
//    'partial'   — STFT peak-picking (parabolic interpolation) + phase-vocoder
//                  instantaneous frequency (unwrapped phase difference across the
//                  hop), linked frame-to-frame into tracks (McAulay & Quatieri 1986
//                  nearest-frequency continuity, ±3%/frame). Each track's
//                  freq(t)/median(freq) is a speed-ratio estimate; frames combine
//                  tracks by amplitude×length-weighted median (Godsill & Rayner,
//                  Digital Audio Restoration, 1998, ch. 6 — pitch variation defects).
//    'reference' — phase-vocoder IF locked to a single known bin (a mains hum
//                  residual or a calibration tone), same technique as
//                  denoise-dehum's Goertzel tracker but continuous per-hop instead
//                  of a sweep (Czyżewski et al., "Wow detection and compensation
//                  employing spectral processing of audio", JAES 2007).
//    'pitch'     — @audio/pitch-pyin frame f0 relative to its own zero-phase
//                  smoothed trend; only correct for monophonic material.
// 2. Smoothing/separation: zero-phase (forward-backward) one-pole low-pass at
//    `smooth` splits the curve into wow (<~6 Hz) and flutter (residual); gaps
//    (no track/tone/voicing) hold the last value with exponential decay toward 1.
// 3. Correction: variable-rate resampling. Integrate 1/speed into a warped read
//    position and read the source with a 16-zero-crossing windowed sinc
//    (@audio/resample-sinc), narrowing the anti-alias cutoff when the local read
//    rate exceeds 1×. Multi-channel: one curve from the mono mix, applied to every
//    channel so they stay sample-aligned.
//
// Refs: Howarth & Wolfe, "Correction of Wow and Flutter Effects in Analogue Tape
// Transfers", AES 117th/118th Convention 2004/2005. Nichols, "The Digital
// Restoration of Wow and Flutter Distorted Gramophone Recordings", 1999.
// Celemony Capstan's product notes are the ML-based practical precedent this
// package deliberately does not attempt to match — see README.

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
		minTrack: opts.minTrack ?? 0.5,
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

function wrapPhase(p) { return p - Math.round(p / PI2) * PI2 }

// Phase-vocoder instantaneous frequency at bin k, given this frame's phase and
// the previous frame's phase at the same bin. Exact for a stationary sinusoid
// within ±fs/(2·hop) of the bin center — e.g. ±43 Hz at the fs=44100/hop=512
// default, comfortably above realistic wow/flutter deviations of a few Hz to a
// few tens of Hz.
function instFreq(phase, prevPhase, k, fs, hop, N) {
	let expected = PI2 * hop * k / N
	let d = wrapPhase(phase[k] - prevPhase[k] - expected)
	return k * fs / N + d * fs / (PI2 * hop)
}

// Phase-vocoder IF needs the analysed signal to be roughly stationary across the
// WHOLE analysis window, not just across one hop — the frame-to-frame phase
// difference is effectively an average over the frame's own span. At the default
// frameSize (4096, 93 ms) that holds fine for wow (<6 Hz, period > 166 ms) but not
// for flutter — a 30 Hz component (33 ms period) completes ~2.8 cycles inside one
// window and the IF estimate collapses toward the mean, understating the true
// swing by an order of magnitude (measured: a synthetic ±0.4% 30 Hz flutter on a
// 440 Hz tone reads back as ~0 at frameSize 4096, correlation −0.18 against the
// true curve — worse than noise). A short window recovers it (correlation 0.996
// at 512 samples/11.6 ms) but a *plain* 512-sample FFT then can't separate our own
// test chord's partials (220/330 Hz are 110 Hz apart — inside a 512-point/44.1 kHz
// Hann main lobe). 1024 samples (23.2 ms, ~0.7 flutter cycles, some understatement
// but within test tolerance) is the balance that keeps both working.
//
// So peak-picking / track continuity run at the caller's (large) frameSize — that
// needs the fine frequency resolution to separate nearby partials — while the
// actual IF numbers come from a Goertzel-style direct evaluation of the DFT at the
// *exact* target frequency (not snapped to any FFT bin grid) over a short window
// (`IF_FRAME`), at the same hop. An FFT-bin version of this (evaluate a second,
// short-window FFT and pick whichever of the two nearest bins is louder) was tried
// first and rejected: a target sitting near a bin boundary (a 220 Hz partial sits
// at bin 2.5 of a 512-point/44.1 kHz grid) flickers between neighbours from one
// frame to the next, corrupting the estimate far worse than the window-length
// problem it was meant to fix. Evaluating directly at the target frequency has no
// grid to flicker across.
const IF_FRAME = 1024

// Windowed single-frequency DFT of `data[pos..pos+N)` at `freqHz`, via an
// angle-addition rotation (no per-sample trig call — same trick @audio/resample-sinc
// uses for its sinc kernel). Returns [re, im].
function goertzelDft(data, pos, N, freqHz, fs, win) {
	let w = PI2 * freqHz / fs
	let cw = Math.cos(w), sw = Math.sin(w) // e^{-iw} per-sample rotation
	let ca = 1, sa = 0, re = 0, im = 0
	for (let i = 0; i < N; i++) {
		let x = (data[pos + i] || 0) * win[i]
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

// Tracks the phase-vocoder instantaneous frequency of a (slowly moving) target
// frequency across hops, without needing a persistent per-track buffer: each call
// re-evaluates both frames it needs, trading a little redundant work (2×ifN
// samples per call) for a stateless, per-call API that partialCurve/referenceCurve
// can call with a different target frequency per live track. `ifN` — the caller
// picks it (see IF_FRAME and referenceCurve's frequency-scaled window below).
function makeFineTracker(source, fs, hop, ifN) {
	let win = hann(ifN)
	let nFrames = source.length >= ifN ? Math.floor((source.length - ifN) / hop) + 1 : 0
	// frame 0 has no previous frame — no phase-vocoder IF is possible yet. Falling
	// back to the raw bin-center frequency would seed every track/reference-bin with
	// a bin-quantization error, so callers treat that fallback as low-confidence
	// (partialCurve's `settle`, referenceCurve's magnitude gate).
	return function freqAt(t, freqHz) {
		if (t <= 0 || t >= nFrames) return freqHz
		let [re0, im0] = goertzelDft(source, (t - 1) * hop, ifN, freqHz, fs, win)
		let [re1, im1] = goertzelDft(source, t * hop, ifN, freqHz, fs, win)
		let expected = PI2 * hop * freqHz / fs
		let d = wrapPhase(Math.atan2(im1, re1) - Math.atan2(im0, re0) - expected)
		return freqHz + d * fs / (PI2 * hop)
	}
}

// ---- mode 'partial': STFT peak-picking + McAulay-Quatieri partial tracking ----

function partialCurve(mono, o) {
	let { fs, frameSize: N, hopSize: hop, minTrack } = o
	let half = N >> 1
	let fine = makeFineTracker(mono, fs, hop, Math.min(N, IF_FRAME))
	let live = [], done = []
	let t = 0

	stftAnalyse(mono, (mag) => {
		let maxMag = 0
		for (let k = 0; k <= half; k++) if (mag[k] > maxMag) maxMag = mag[k]
		// -50 dB relative to the frame's loudest bin: conservative vs. sinusoidal-track's
		// -60 dB default — we need long *stable* tracks for a speed estimate, not maximal
		// peak recall, so a slightly higher floor trades a few weak partials for fewer
		// spurious noise-bin tracks that would corrupt the weighted median.
		let floor = maxMag * 3.1622776601683795e-3 // 10^(-50/20)
		let peaks = []
		if (maxMag > 0) {
			// A Hann-windowed pure tone has its own local maxima beyond the main lobe —
			// the first sidelobe is only ~31.5 dB down, well above the floor above — so a
			// plain "local max + amplitude" scan mistakes window sidelobes for extra
			// partials (confirmed empirically: a single steady 440 Hz tone spawns "peaks"
			// 3 bins away). Non-max suppression fixes it: rank candidates by amplitude,
			// accept the loudest first, then reject anything within one Hann main-lobe
			// width (4 bins, null-to-null) of an already-accepted bin.
			let cands = []
			for (let k = 2; k < half - 2; k++) {
				if (mag[k] > floor && mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) cands.push(k)
			}
			cands.sort((a, b) => mag[b] - mag[a])
			let accepted = []
			for (let k of cands) {
				if (accepted.some(k0 => Math.abs(k - k0) < 4)) continue
				accepted.push(k)
				peaks.push({ freq: fine(t, k * fs / N), amp: mag[k] })
			}
		}

		// link live tracks to the nearest unclaimed peak within ±3% (McAulay-Quatieri
		// nearest-frequency continuity, same scheme as @audio/sinusoidal-track but with
		// the phase-vocoder frequency instead of the parabolic-interpolated bin).
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

	let nFrames = t
	let minFrames = Math.max(1, Math.round(minTrack * fs / hop))
	let maxTrackAmp = 0
	for (let tr of done) {
		let m = 0; for (let a of tr.amp) m += a; m /= tr.amp.length
		tr.meanAmp = m
		if (m > maxTrackAmp) maxTrackAmp = m
	}
	let ampFloor = maxTrackAmp * 0.05 // keep loud tracks: within -26 dB of the loudest
	let kept = done.filter(tr => tr.freq.length >= minFrames && tr.meanAmp >= ampFloor)
	// A track's first couple of frames are its least reliable: a partial is often "new"
	// exactly because an onset/transient just put energy in that bin, and the phase
	// vocoder's local-stationarity assumption is weakest right there. `settle` frames
	// (kept-length tracks are ≥ minFrames long, so this is always a small fraction) are
	// excluded from both the track's reference median and its per-frame contribution.
	let settle = 2
	for (let tr of kept) {
		let core = tr.freq.slice(settle)
		let sorted = core.slice().sort((a, b) => a - b)
		tr.median = sorted[sorted.length >> 1]
	}

	let speed = new Float64Array(nFrames).fill(NaN)
	let vals = [], weights = []
	for (let f = 0; f < nFrames; f++) {
		vals.length = 0; weights.length = 0
		for (let tr of kept) {
			if (f < tr.start + settle || f > tr.end) continue
			let idx = f - tr.start
			vals.push(tr.freq[idx] / tr.median)
			weights.push(tr.amp[idx] * tr.freq.length) // amplitude × track length
		}
		if (vals.length) speed[f] = weightedMedian(vals, weights)
	}

	let tracks = kept.map(tr => ({ start: tr.start, end: tr.end, freq: tr.median, length: tr.freq.length }))
	return { speed, tracks }
}

function weightedMedian(vals, weights) {
	let idx = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b])
	let total = 0; for (let w of weights) total += w
	let acc = 0
	for (let i of idx) { acc += weights[i]; if (acc * 2 >= total) return vals[i] }
	return vals[idx[idx.length - 1]]
}

// ---- mode 'reference': phase-vocoder IF locked to a single known bin ----

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
	let fine = makeFineTracker(filtered, fs, hop, ifN)
	let t = 0
	let ratios = [], mags = []
	stftAnalyse(filtered, (mag) => {
		// frame 0: fine() has no previous phase yet and returns refFreq unchanged —
		// mark it as no-evidence rather than trust an un-refined estimate.
		ratios.push(t > 0 ? fine(t, refFreq) / refFreq : NaN)
		mags.push(mag[k0])
		t++
	}, { frameSize: N, hopSize: hop, fs })

	// gate weak frames (tone dropout / pure silence) — a frame's estimate is only
	// trusted when the tracked bin holds a non-trivial fraction of its typical energy.
	let sorted = mags.slice().sort((a, b) => a - b)
	let medMag = sorted[sorted.length >> 1] || 0
	let floor = medMag * 0.1
	let speed = new Float64Array(ratios.length)
	for (let i = 0; i < ratios.length; i++) speed[i] = mags[i] > floor && mags[i] > 1e-12 ? ratios[i] : NaN
	return speed
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
	let speed = new Float64Array(nFrames)
	for (let t = 0; t < nFrames; t++) speed[t] = Number.isFinite(f0[t]) && baseline[t] > 0 ? f0[t] / baseline[t] : NaN
	return speed
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

// ---- shared: gap fill, zero-phase smoothing, per-sample warp ----

// No-evidence frames hold the last speed estimate, decaying toward the nominal 1.0
// (tape assumed to return to nominal speed absent contrary evidence). Leading gaps
// (no estimate yet) start from 1.0.
function holdDecayToward1(curve, hopSec, decayTau = 0.3) {
	let out = new Float64Array(curve.length)
	let a = Math.exp(-hopSec / decayTau)
	let last = 1
	for (let i = 0; i < curve.length; i++) {
		if (Number.isFinite(curve[i])) { out[i] = curve[i]; last = curve[i] }
		else { last = 1 + (last - 1) * a; out[i] = last }
	}
	return out
}

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

function upsampleToSamples(curve, hop, nSamples) {
	let n = curve.length
	let out = new Float64Array(nSamples)
	if (n === 0) { out.fill(1); return out }
	if (n === 1) { out.fill(curve[0]); return out }
	for (let i = 0; i < nSamples; i++) {
		let p = i / hop
		let f0 = Math.floor(p), frac = p - f0
		let a = curve[f0 < 0 ? 0 : f0 >= n ? n - 1 : f0]
		let b = curve[f0 + 1 < 0 ? 0 : f0 + 1 >= n ? n - 1 : f0 + 1]
		out[i] = a + (b - a) * frac
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
	let raw, tracks
	if (o.mode === 'reference') raw = referenceCurve(mono, o)
	else if (o.mode === 'pitch') raw = pitchCurve(mono, o)
	else if (o.mode === 'partial') { let r = partialCurve(mono, o); raw = r.speed; tracks = r.tracks }
	else throw new RangeError(`dewow: unknown mode "${o.mode}" (expected 'partial' | 'reference' | 'pitch')`)

	let nFrames = raw.length
	let valid = 0
	for (let i = 0; i < nFrames; i++) if (Number.isFinite(raw[i])) valid++
	let confidence = nFrames ? valid / nFrames : 0

	let filled = holdDecayToward1(raw, hopSec)
	let wowComp = zeroPhaseOnePole(filled, hopSec, o.smooth)
	let flutterComp = new Float64Array(nFrames)
	for (let i = 0; i < nFrames; i++) flutterComp[i] = filled[i] - wowComp[i]

	return { filled, wowComp, flutterComp, hop, hopSec, nFrames, confidence, tracks }
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
	for (let i = 0; i < c.nFrames; i++) times[i] = i * c.hopSec

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

	let perSample = upsampleToSamples(used, c.hop, mono.length)
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
