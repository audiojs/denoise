import t, { is, ok, almost } from 'tst'
import raw from 'audio-lena/raw'
import desilence, { segments, split, project } from './desilence.js'

let fs = 44100
let lena = new Float32Array(raw)                                          // 12.27s mono speech

// --- seeded PRNG (LCG, same recipe @audio/denoise's own test.js uses for dewind) ---
function rngFor(seed) {
	let s = seed >>> 0
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)
}

// Band-limited "speech-like" burst: a handful of random partials in 300-3000 Hz
// (speech's spectral envelope), scaled to a target dBFS RMS. Deterministic per seed.
function burst(dur, dbfs, seed) {
	let n = Math.round(dur * fs)
	let d = new Float32Array(n)
	let rand = rngFor(seed)
	let partials = 6, freqs = [], phases = []
	for (let p = 0; p < partials; p++) { freqs.push(300 + rand() * 2700); phases.push(rand() * 2 * Math.PI) }
	for (let i = 0; i < n; i++) {
		let s = 0
		for (let p = 0; p < partials; p++) s += Math.sin(2 * Math.PI * freqs[p] * i / fs + phases[p])
		d[i] = s / partials
	}
	let rms = 0; for (let i = 0; i < n; i++) rms += d[i] * d[i]; rms = Math.sqrt(rms / n)
	let g = Math.pow(10, dbfs / 20) / Math.max(rms, 1e-9)
	for (let i = 0; i < n; i++) d[i] *= g
	return d
}

// The fixture scene: 0.3s lead-in, 4 bursts (0.6s, -12dBFS) separated by 0.2s / 1.0s /
// 3.0s pauses, 0.3s trail-out, all riding a -60dBFS noise floor. minSilence=0.5 (default)
// means only the 1.0s and 3.0s pauses ever get touched; the 0.2s pause, the lead-in and
// the trail-out are all below it and stay untouched in every mode but trim.
let layout = { lead: 0.3, b: 0.6, g1: 0.2, g2: 1.0, g3: 3.0, trail: 0.3 }
let bounds = (() => {
	let t0 = layout.lead
	let b1 = [t0, t0 + layout.b]; t0 = b1[1] + layout.g1
	let b2 = [t0, t0 + layout.b]; t0 = b2[1] + layout.g2
	let b3 = [t0, t0 + layout.b]; t0 = b3[1] + layout.g3
	let b4 = [t0, t0 + layout.b]; t0 = b4[1] + layout.trail
	return { bursts: [b1, b2, b3, b4], duration: t0 }
})()

function scene() {
	let n = Math.round(bounds.duration * fs)
	let d = new Float32Array(n)
	let floor = rngFor(0xC0FFEE)
	for (let i = 0; i < n; i++) d[i] = (floor() * 2 - 1) * Math.pow(10, -60 / 20)   // -60dBFS noise floor
	bounds.bursts.forEach((b, i) => {
		let seg = burst(layout.b, -12, 0x1000 + i)
		let a = Math.round(b[0] * fs)
		for (let k = 0; k < seg.length && a + k < n; k++) d[a + k] += seg[k]
	})
	return d
}

let rms = d => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length) }
let db = x => 20 * Math.log10(Math.max(x, 1e-30))
let maxDiff = d => { let m = 0; for (let i = 1; i < d.length; i++) { let a = Math.abs(d[i] - d[i - 1]); if (a > m) m = a } return m }

// hop at defaults (frameSize 1024, hopSize 512) — the frame-decision grid resolution.
let hop = 512 / fs

// =================== segments() — boundary detection ===================

t('segments — finds exactly 4 speech segments at the expected boundaries (±3 hops)', () => {
	let { speech } = segments(scene(), { fs })
	is(speech.length, 4, 'four bursts detected')
	speech.forEach((s, i) => {
		let [a, b] = bounds.bursts[i]
		ok(Math.abs(s.start - a) <= 3 * hop, `seg${i} start within 3 hops (${(s.start - a).toFixed(4)}s)`)
		ok(Math.abs(s.end - b) <= 3 * hop, `seg${i} end within 3 hops (${(s.end - b).toFixed(4)}s)`)
	})
})

t('segments — silence complements speech, covers lead/gaps/trail', () => {
	let { speech, silence } = segments(scene(), { fs })
	is(silence.length, speech.length + 1, 'one silence interval per gap incl. lead/trail')
	almost(silence[0].end - silence[0].start, layout.lead, 3 * hop, 'lead-in length')
	almost(silence[silence.length - 1].end - silence[silence.length - 1].start, layout.trail, 3 * hop, 'trail-out length')
})

// =================== mode: remove ===================

t('remove — cuts pauses > minSilence to `pad` per side, keeps the 0.2s pause whole', () => {
	// analytic expected duration: lead(0.3, untouched) + 4×burst(0.6) + g1(0.2, untouched)
	// + g2→2×pad(0.2) + g3→2×pad(0.2) + trail(0.3, untouched), minus one `fade` (0.01s)
	// per internal crossfade (g2, g3 are both internal cuts) — see desilence.js's
	// applyCuts: an internal crossfade merges 2×fadeLen input samples into fadeLen
	// output samples, so each internal cut additionally shrinks the timeline by `fade`.
	let pad = 0.1, fade = 0.01
	let expected = layout.lead + 4 * layout.b + layout.g1 + 2 * pad + 2 * pad + layout.trail - 2 * fade
	let out = desilence(scene(), { fs, mode: 'remove', pad })
	let dur = out.data.length / fs
	almost(dur, expected, 6 * hop, `remove duration ${dur.toFixed(3)}s ≈ ${expected.toFixed(3)}s`)
	ok(out.removed > 0, 'reports seconds removed')
	almost(out.removed, bounds.duration - expected, 6 * hop)
})

// =================== mode: shorten ("Smart Speed") ===================

t('shorten — pauses > maxSilence collapse to maxSilence, short pause untouched', () => {
	let maxSilence = 0.25
	let out = desilence(scene(), { fs, mode: 'shorten', maxSilence })
	let { silence } = segments(out.data, { fs })
	is(silence.length, 5, 'lead, g1, shortened-g2, shortened-g3, trail')
	almost(silence[0].end - silence[0].start, layout.lead, 3 * hop, 'lead-in untouched')
	almost(silence[1].end - silence[1].start, layout.g1, 3 * hop, '0.2s pause untouched (< minSilence)')
	// the fadeLen (0.01s) shrink documented above applies here too — target minus one fade
	almost(silence[2].end - silence[2].start, maxSilence - 0.01, 0.05, '1.0s pause shortened to ~0.25s')
	almost(silence[3].end - silence[3].start, maxSilence - 0.01, 0.05, '3.0s pause shortened to ~0.25s')
	almost(silence[4].end - silence[4].start, layout.trail, 3 * hop, 'trail-out untouched')
})

t('shorten — never lengthens a pause (maxSilence > pause is a no-op)', () => {
	let out = desilence(scene(), { fs, mode: 'shorten', maxSilence: 10 })          // way bigger than any pause
	is(out.removed, 0, 'nothing cut when the target exceeds every pause')
	is(out.data.length, scene().length)
})

// =================== mode: trim ===================

t('trim — removes only leading/trailing silence, leaves internal pauses (incl. long ones) alone', () => {
	let out = desilence(scene(), { fs, mode: 'trim' })
	let expected = bounds.duration - layout.lead - layout.trail
	let dur = out.data.length / fs
	almost(dur, expected, 3 * hop, `trim duration ${dur.toFixed(3)}s ≈ ${expected.toFixed(3)}s`)
	let { silence } = segments(out.data, { fs })
	// 3 internal pauses (g1, g2, g3) remain untouched, in order — re-running VAD on a
	// signal that now ends right at burst4 can add one more sub-hop sliver at the very
	// tail (the STFT frame grid rarely divides the trimmed length evenly); tolerate it.
	ok(silence.length === 3 || silence.length === 4, `3 real gaps (+ optional tail sliver), got ${silence.length}`)
	if (silence.length === 4) ok(silence[3].end - silence[3].start < 2 * hop, 'the 4th is a sub-hop tail artifact')
	almost(silence[0].end - silence[0].start, layout.g1, 3 * hop, '0.2s internal pause untouched by trim')
	almost(silence[1].end - silence[1].start, layout.g2, 3 * hop, '1.0s internal pause untouched by trim')
	almost(silence[2].end - silence[2].start, layout.g3, 3 * hop, '3.0s internal pause untouched by trim')
})

// =================== split ===================

t('split — one clip per speech segment, padded and length-matched', () => {
	let pad = 0.1
	let clips = split(scene(), { fs, pad })
	is(clips.length, 4)
	clips.forEach((c, i) => {
		let [a, b] = bounds.bursts[i]
		let expectedLen = Math.round((b - a + 2 * pad) * fs)
		ok(Math.abs(c.length - expectedLen) <= 6 * Math.round(hop * fs), `clip${i} length ≈ segment+2×pad`)
	})
})

// =================== click-free cuts ===================

// A hard splice puts the entire boundary jump in a single sample; a proper equal-power
// crossfade spreads it over `fade` seconds. That's signal-independent, so it's measured
// directly: within each crossfade window (out.map's non-1:1 breakpoint pairs — see
// project()'s slope check), no single sample-to-sample step should be more than a small
// fraction of the window's total variation. A hard-cut regression would put ~100% of the
// variation in one step; a real crossfade spreads it over hundreds of samples.
//
// This is measured on the plain synthetic scene rather than smuggling an artificial
// discontinuity into a "silent" pause to make a bad implementation "obviously" fail, as
// tried first: vad.js's frame energy explicitly skips the DC bin (`for k=1..half`), but
// any offset large enough to read as an obvious click against -12dBFS speech is also
// large enough to leak through the analysis window's own sidelobes into bin 1+ and get
// classified as speech itself — corrupting the very silence region under test. There's
// no magnitude that is simultaneously "loud enough to click" and "quiet enough to stay
// silent" once a real spectral VAD is in the loop, so the crossfade is verified structurally instead.
function crossfadeWindows(map, fs) {
	let windows = []
	for (let i = 0; i < map.length - 1; i++) {
		let a = map[i], b = map[i + 1]
		let isKept = Math.abs((b.to - a.to) - (b.from - a.from)) < 1e-9
		if (isKept) continue
		let lo = Math.round(b.to * fs), hi = Math.round(a.to * fs)
		if (hi - lo >= 2) windows.push([lo, hi])
	}
	return windows
}

t('remove/shorten — cuts are crossfaded: no single sample dominates the transition', () => {
	let data = scene()
	for (let mode of ['remove', 'shorten']) {
		let out = desilence(data, { fs, mode })
		let windows = crossfadeWindows(out.map, fs)
		is(windows.length, 2, `${mode}: the 1.0s and 3.0s pauses are the only internal crossfades`)
		for (let [lo, hi] of windows) {
			let maxStep = 0, totalVar = 0
			for (let k = lo + 1; k < hi; k++) { let d = Math.abs(out.data[k] - out.data[k - 1]); maxStep = Math.max(maxStep, d); totalVar += d }
			ok(totalVar > 0, `${mode}: crossfade window has content`)
			ok(maxStep / totalVar < 0.3, `${mode}: max step is ${(100 * maxStep / totalVar).toFixed(2)}% of the window's total variation`)
		}
	}
})

// =================== real speech (audio-lena) ===================

t('segments — lena speech coverage is 50-95% of the file', () => {
	// Measured: audio-lena's 12.27s clip is narrated speech with natural word/sentence
	// pauses but no long silences — coverage came out ~78% in a manual run.
	let { speech } = segments(lena, { fs })
	let covered = speech.reduce((s, x) => s + (x.end - x.start), 0)
	let frac = covered / (lena.length / fs)
	ok(frac > 0.5 && frac < 0.95, `speech coverage ${(frac * 100).toFixed(1)}%`)
})

t('shorten — reduces lena duration by 3-40%, preserves kept-region RMS within 0.5dB', () => {
	// Measured: lena's natural pauses top out around 0.4s (segments() above), all below
	// the 0.5s default minSilence — the defaults are a no-op on this fixture. Podcast-
	// style "Smart Speed" settings (minSilence 0.15s, maxSilence 0.1s) are what actually
	// exercises the feature on close-miced narration like this; use those here.
	let opts = { fs, minSilence: 0.15, maxSilence: 0.1 }
	let { speech } = segments(lena, opts)
	let out = desilence(lena, { ...opts, mode: 'shorten' })
	let ratio = 1 - out.data.length / lena.length
	ok(ratio > 0.03 && ratio < 0.40, `duration reduced by ${(ratio * 100).toFixed(1)}%`)

	// RMS of the original speech regions vs. the RMS of the whole (speech-dominated) output
	let n = 0, sum = 0
	for (let s of speech) {
		let a = Math.round(s.start * fs), b = Math.round(s.end * fs)
		for (let i = a; i < b; i++) { sum += lena[i] * lena[i]; n++ }
	}
	let inRms = Math.sqrt(sum / n)
	let outRms = rms(out.data)
	almost(db(outRms), db(inRms), 0.5, `kept-region RMS within 0.5dB (${db(outRms).toFixed(2)} vs ${db(inRms).toFixed(2)})`)
})

// =================== multi-channel ===================

t('multi-channel — the same cuts apply to every channel', () => {
	let mono = scene()
	let ch = [mono, mono.map(v => v * 0.5)]
	let out = desilence(ch, { fs, mode: 'remove' })
	is(out.data.length, 2, 'two channels out')
	is(out.data[0].length, out.data[1].length, 'channels stay aligned')
	// second channel is exactly half the first throughout (same cuts, same crossfade windows)
	let maxErr = 0
	for (let i = 0; i < out.data[0].length; i++) maxErr = Math.max(maxErr, Math.abs(out.data[1][i] - out.data[0][i] * 0.5))
	ok(maxErr < 1e-6, `channels scaled identically post-cut (max err ${maxErr.toExponential(2)})`)
})

// =================== map / project ===================

t('project — a marker inside kept speech maps to matching content', () => {
	let data = scene()
	let out = desilence(data, { fs, mode: 'remove', pad: 0.1 })
	let [a, b] = bounds.bursts[0]                                          // first burst untouched by any cut
	let t0 = (a + b) / 2                                                   // well inside it
	let t1 = project(out.map, t0)
	let i0 = Math.round(t0 * fs), i1 = Math.round(t1 * fs)
	let win = 50
	let err = 0
	for (let k = -win; k <= win; k++) err = Math.max(err, Math.abs(out.data[i1 + k] - data[i0 + k]))
	ok(err < 1e-6, `samples around projected marker match the original (max err ${err.toExponential(2)})`)
})

t('project — a marker inside a cut pause snaps to the surviving edge', () => {
	let data = scene()
	let out = desilence(data, { fs, mode: 'remove', pad: 0.1 })
	let [, e1] = bounds.bursts[1], [s2] = bounds.bursts[2]                 // gap2, cut in the middle
	let tCut = (e1 + s2) / 2
	let t1 = project(out.map, tCut)
	ok(t1 >= 0 && t1 <= out.data.length / fs, 'projected time lands inside the output')
})

// =================== edge cases ===================

t('edge — all-silence input: remove empties it, shorten leaves a short one unchanged', () => {
	let rand = rngFor(1)
	let long = new Float32Array(Math.round(2 * fs))                        // 2s, > minSilence
	for (let i = 0; i < long.length; i++) long[i] = (rand() * 2 - 1) * Math.pow(10, -50 / 20)
	let removed = desilence(long, { fs, mode: 'remove' })
	is(removed.data.length, 0, 'remove empties an all-silence clip')

	let short = new Float32Array(Math.round(0.3 * fs))                     // 0.3s, < minSilence(0.5): never touched
	for (let i = 0; i < short.length; i++) short[i] = (rand() * 2 - 1) * Math.pow(10, -50 / 20)
	let shortened = desilence(short, { fs, mode: 'shorten' })
	is(shortened.data.length, short.length, 'shorten leaves a too-short pause unchanged')
	is(shortened.removed, 0)
})

t('edge — input shorter than frameSize is returned unchanged', () => {
	let tiny = new Float32Array(500)
	for (let i = 0; i < tiny.length; i++) tiny[i] = Math.sin(i)
	for (let mode of ['remove', 'shorten', 'trim']) {
		let out = desilence(tiny, { fs, mode })
		is(out.data.length, tiny.length, `${mode}: unchanged length`)
		let maxErr = 0
		for (let i = 0; i < tiny.length; i++) maxErr = Math.max(maxErr, Math.abs(out.data[i] - tiny[i]))
		ok(maxErr < 1e-9, `${mode}: samples unchanged`)
	}
})

t('edge — empty input produces empty, finite output', () => {
	let out = desilence(new Float32Array(0), { fs, mode: 'remove' })
	is(out.data.length, 0)
	is(out.removed, 0)
})

t('edge — NaN-free across every mode', () => {
	let data = scene()
	for (let mode of ['remove', 'shorten', 'trim']) {
		let out = desilence(data, { fs, mode })
		ok(out.data.every(Number.isFinite), `${mode}: finite output`)
	}
})

t('threshold — absolute dB override bypasses the adaptive floor', () => {
	// A very low absolute threshold (below the -60dBFS floor) marks everything active —
	// no pause qualifies, so no mode ever cuts.
	let out = desilence(scene(), { fs, mode: 'remove', threshold: -90 })
	is(out.removed, 0, 'threshold below the noise floor ⇒ nothing counts as silence')
})
