// Tests synthesize a known speed defect s(t) = 1 + 0.02·sin(2π·0.75t) + 0.004·sin(2π·30t)
// (2% wow at 0.75 Hz, a 45 rpm disc turning off-centre, + 0.4% flutter at 30 Hz — Howarth
// & Wolfe 2004/2005 report wow/flutter in this range) by reading a clean signal through the
// SAME windowed-sinc kernel dewow() uses for correction (@audio/resample-sinc,
// r=16), at a warped position that integrates s(t) — the round-trip methodology
// this repo's siblings use (dereverb's convolve-then-correct, denoise-repair's
// clip-then-restore): the defect-injection and the correction share one
// authoritative resampling primitive, so a pass genuinely exercises the
// estimator/corrector rather than an artifact of two different resamplers.

import t, { ok, is, throws } from 'tst'
import dewow, { analyze } from './dewow.js'
import { sincRead } from '@audio/resample-sinc'
import { stftAnalyse } from '@audio/stft'
import raw from 'audio-lena/raw'

const fs = 44100
const PI2 = 2 * Math.PI

// --- generators ---
function sine(freq, n, amp = 1) {
	let d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = amp * Math.sin(PI2 * freq * i / fs)
	return d
}
function add(...arrays) {
	let n = Math.max(...arrays.map(a => a.length))
	let d = new Float32Array(n)
	for (let a of arrays) for (let i = 0; i < a.length; i++) d[i] += a[i]
	return d
}
function mul(a, b) {
	let d = new Float32Array(a.length)
	for (let i = 0; i < a.length; i++) d[i] = a[i] * (b[i] || 0)
	return d
}
function envelope(n, attackS = 0.05) {
	let d = new Float32Array(n), a = Math.floor(attackS * fs)
	for (let i = 0; i < n; i++) d[i] = i < a ? i / a : 1
	return d
}
function harmonicTone(f0, n, amps) {
	return add(...amps.map((a, i) => sine(f0 * (i + 1), n, a)))
}
function rms(d) { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length) }

// The defect curve: 2% wow @ 0.75 Hz + 0.4% flutter @ 30 Hz, both well inside the
// analyser's representable range (wow ≪ 6 Hz; flutter's ceiling is the per-hop
// curve's own Nyquist fs/(2·hop) = 43 Hz at the defaults, and 30 Hz sits under it
// with margin — see README for why 100 Hz flutter needs a smaller hopSize).
const sOfT = tt => 1 + 0.02 * Math.sin(PI2 * 0.75 * tt) + 0.004 * Math.sin(PI2 * 30 * tt)

// Applies s(t) with the same primitive (and r=16 kernel) dewow() corrects with —
// see file header. `sFn` is evaluated in the *output* (distorted) timeline, so
// s>1 reads the source faster (pitch rises), matching dewow's own `pos += 1/s`.
function warp(clean, sFn) {
	let out = new Float32Array(clean.length), pos = 0
	for (let i = 0; i < clean.length; i++) {
		out[i] = sincRead(clean, pos, 16, 1)
		pos += sFn(i / fs)
	}
	return out
}

function corr(a, b) {
	let n = Math.min(a.length, b.length)
	let ma = 0, mb = 0
	for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
	ma /= n; mb /= n
	let sab = 0, saa = 0, sbb = 0
	for (let i = 0; i < n; i++) { let da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db }
	return sab / Math.sqrt(saa * sbb)
}

function snr(clean, out) {
	let n = Math.min(clean.length, out.length)
	let s = 0, e = 0
	for (let i = 0; i < n; i++) { let d = clean[i] - out[i]; s += clean[i] * clean[i]; e += d * d }
	return e > 0 ? 10 * Math.log10(s / e) : Infinity
}

// Segmental SNR with a small per-segment lag search — "SNR after alignment" (the
// brief's own wording): a corrector built on real analysis (not the exact,
// noiseless curve) leaves a slowly-wandering absolute-time drift baked into the
// output. That drift is inaudible on its own (there is no reference clock to
// hear it against) and is not the defect being corrected — the defect is the
// pitch wobble, which is what analyze()'s residual-deviation check below measures
// directly. Comparing raw, unaligned samples conflates the two and fails even a
// mathematically-correct correction (verified with the ground-truth curve fed
// straight into the resampler, bypassing estimation entirely: 79 dB unaligned).
// 100 ms segments / ±5 ms search were swept against 25–300 ms and ±1–15 ms; this
// pair gave the best recovery for our test signal's partial spacing.
function localSnr(clean, out, segMs = 100, maxLagMs = 5) {
	let seg = Math.round(segMs / 1000 * fs), maxLag = Math.round(maxLagMs / 1000 * fs)
	let vals = []
	for (let pos = maxLag; pos + seg + maxLag <= clean.length; pos += seg) {
		let best = -Infinity
		for (let lag = -maxLag; lag <= maxLag; lag++) {
			let s = 0, e = 0
			for (let i = 0; i < seg; i++) { let c = clean[pos + i], d = c - out[pos + i + lag]; s += c * c; e += d * d }
			let v = e > 0 ? 10 * Math.log10(s / e) : 100
			if (v > best) best = v
		}
		vals.push(best)
	}
	return vals.reduce((a, b) => a + b, 0) / vals.length
}

// Independent phase-vocoder tracker (does not reuse any dewow.js internals) —
// standard technique, matches the one denoise-repair/dereverb tests use for their
// own tone-tracking checks.
function trackFreq(signal, targetHz) {
	let N = 4096, hop = 512, half = N >> 1, k = Math.round(targetHz * N / fs)
	let prevPhase = null, freqs = []
	stftAnalyse(signal, (mag, phase) => {
		if (prevPhase) {
			let expected = PI2 * hop * k / N
			let d = phase[k] - prevPhase[k] - expected
			d -= PI2 * Math.round(d / PI2)
			freqs.push(k * fs / N + d * fs / (PI2 * hop))
		}
		if (!prevPhase) prevPhase = new Float64Array(half + 1)
		prevPhase.set(phase)
	}, { frameSize: N, hopSize: hop, fs })
	return freqs
}
function rmsDevPercent(freqs, nominal) {
	let s = 0
	for (let f of freqs) { let d = (f - nominal) / nominal; s += d * d }
	return 100 * Math.sqrt(s / freqs.length)
}

// --- fixtures ---
const DUR = 6, N6 = DUR * fs
const env6 = envelope(N6)
// Four independent notes: equal-tempered C4 E4 G♯4 D5, no two in a ratio of small whole numbers, so none can be a
// harmonic of another — four witnesses to the speed. (220/330/440/660 Hz, this suite's chord before 0.2, are the
// 2nd–6th harmonics of one 110 Hz note: one witness, which by design measures nothing.)
const chord = mul(add(sine(261.63, N6, 0.25), sine(329.63, N6, 0.25), sine(415.30, N6, 0.25), sine(587.33, N6, 0.25)), env6)
const tone = mul(harmonicTone(110, N6, [0.3, 0.2, 0.12, 0.08, 0.05, 0.03]), env6) // one note, six harmonics
const wowOnly = tt => 1 + 0.02 * Math.sin(PI2 * 0.75 * tt)
const dirtyChord = warp(chord, sOfT)
const dirtyTone = warp(tone, sOfT)
function voice(fn, n = N6) { // a voice, harmonics 1..8 at 1/k, its pitch fn(t)
	let x = new Float32Array(n), ph = 0
	for (let i = 0; i < n; i++) { ph += PI2 * fn(i / fs) / fs; for (let h = 1; h <= 8; h++) x[i] += 0.2 / h * Math.sin(h * ph) }
	return x
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

// =================== analyze() — speed curve recovery ===================

t('analyze — recovers the wow on independent notes (correlation ≥ 0.95)', () => {
	// 'partial' reads frequency over the 0.19 s analysis frame and applies the rotation-rate line it finds: the 0.75 Hz
	// wow, not the 30 Hz flutter (reference mode below resolves that), so the curve is compared with the wow alone
	let a = analyze(dirtyChord, { fs })
	let c = corr(a.speed, Array.from(a.times).map(wowOnly))
	ok(c >= 0.95, `correlation ${c.toFixed(4)}`)
	// tracks are steady pieces of partials, cut where one moves faster than wow can; the 30 Hz flutter's FM sidebands
	// (−28 dB) are tracked too and move with the speed like any partial
	let notesHz = [261.63, 329.63, 415.30, 587.33], on = t => notesHz.some(f => Math.abs(t.freq / f - 1) < 0.03), time = ts => ts.reduce((s, t) => s + t.length, 0)
	ok(notesHz.every(f => a.tracks.some(t => Math.abs(t.freq / f - 1) < 0.03)), 'every note tracked')
	ok(time(a.tracks.filter(on)) > 0.75 * time(a.tracks), `${a.tracks.length} pieces, ${(100 * time(a.tracks.filter(on)) / time(a.tracks)).toFixed(0)} % of their time on the notes`)
})

t('analyze — a disc turning off-centre at 33⅓ rpm: the line found and fitted (0.5 %, the chord)', () => {
	let s = tt => 1 + 0.005 * Math.sin(PI2 * 100 / 180 * tt), a = analyze(warp(add(chord, chord), s), { fs })
	ok(a.lines.length && Math.abs(a.lines[0].rpm / (100 / 3) - 1) < 0.02, 'line at ' + a.lines.map(l => l.rpm.toFixed(2) + ' rpm').join(', '))
	ok(Math.abs(a.lines[0].depth - 0.5) < 0.05, `depth ${a.lines[0].depth.toFixed(3)} %`)
})

t('analyze — wow amplitude within 15% of the injected 2%', () => {
	let a = analyze(dirtyChord, { fs })
	ok(a.wowPeak >= 1.7 && a.wowPeak <= 2.3, `wowPeak ${a.wowPeak.toFixed(3)}%`)
})

t('analyze — one note and its harmonics carry no evidence: wow and a performer\'s pitch movement look the same there', () => {
	let a = analyze(dirtyTone, { fs })
	is(a.confidence, 0, 'no hop has two independent sources')
	ok(a.speed.every(v => v === 1), 'curve stays at nominal')
})

t('analyze — confidence reflects how much of the signal has independent sources agreeing', () => {
	let a = analyze(dirtyChord, { fs })
	ok(a.confidence > 0.9, `confidence ${a.confidence.toFixed(3)}`)
	is(analyze(new Float32Array(fs * 2), { fs }).confidence, 0, 'silence has no evidence anywhere')
})

// =================== dewow() — correction ===================

t('dewow — reduces the E4 partial\'s residual frequency deviation from ~1.4% to ≤ 0.3%', () => {
	let corrected = dewow(dirtyChord, { fs })
	let devDirty = rmsDevPercent(trackFreq(dirtyChord, 329.63).slice(20, -20), 329.63)
	let devCorrected = rmsDevPercent(trackFreq(corrected, 329.63).slice(20, -20), 329.63)
	ok(devDirty > 1, `sanity: the dirty chord deviates (${devDirty.toFixed(2)}%)`)
	ok(devCorrected <= 0.3, `residual deviation ${devCorrected.toFixed(3)}% (from ${devDirty.toFixed(2)}%)`)
})

t('dewow — SNR vs. the clean original after alignment improves by ≥ 10 dB', () => {
	// see localSnr for why "after alignment"
	let corrected = dewow(dirtyChord, { fs })
	let before = localSnr(chord, dirtyChord), after = localSnr(chord, corrected)
	ok(after >= before + 10, `${before.toFixed(1)} dB → ${after.toFixed(1)} dB`)
})

t('dewow — clean input passes through bit-exact', () => {
	ok(same(dewow(chord, { fs }), chord), 'steady chord: nothing to correct')
	ok(same(dewow(tone, { fs }), tone), 'one note')
})

t('dewow — a vibrato and a glide are the performer\'s, kept bit-exact (0.1 flattened both)', () => {
	let vib = voice(tt => 220 * 2 ** (50 / 1200 * Math.sin(PI2 * 5.5 * tt)))
	let glide = voice(tt => tt < 2 ? 220 : tt < 3 ? 220 * 1.5 ** (tt - 2) : 330)
	ok(same(dewow(vib, { fs }), vib), 'vibrato ±50 cents at 5.5 Hz')
	ok(same(dewow(glide, { fs }), glide), '220 → 330 Hz glide')
	ok(same(dewow(dirtyTone, { fs }), dirtyTone), 'one note with wow: the wow cannot be told from the note\'s own movement')
})

t('dewow — a vibrato voice over steady notes keeps its vibrato and loses the wow', () => {
	let vib = voice(tt => 220 * 2 ** (50 / 1200 * Math.sin(PI2 * 5.5 * tt)))
	let clean = add(vib, chord), dirty = warp(clean, wowOnly)
	let a = analyze(dirty, { fs })
	ok(corr(a.speed, Array.from(a.times).map(wowOnly)) > 0.95, 'the speed is the wow, not the vibrato')
	let corrected = dewow(dirty, { fs })
	let devDirty = rmsDevPercent(trackFreq(dirty, 329.63).slice(20, -20), 329.63)
	let devCorrected = rmsDevPercent(trackFreq(corrected, 329.63).slice(20, -20), 329.63)
	ok(devCorrected < devDirty / 3, `E4 deviation ${devDirty.toFixed(2)}% → ${devCorrected.toFixed(2)}%`)
})

t('dewow — keepLength: output length equals input length', () => {
	let out = dewow(dirtyChord, { fs })
	is(out.length, dirtyChord.length)
	let outFalse = dewow(dirtyChord, { fs, keepLength: false })
	ok(Math.abs(outFalse.length - dirtyChord.length) < dirtyChord.length * 0.05, 'natural length stays within 5% of input (wow integrates to ~0 net drift)')
})

t('dewow — multi-channel stays sample-aligned (one shared curve from the mono mix)', () => {
	let out = dewow([dirtyChord, dirtyChord], { fs })
	is(out.length, 2)
	is(out[0].length, out[1].length)
	ok(same(out[0], out[1]), 'L and R correct identically when the input channels are identical')
})

// =================== mode 'reference' ===================

t('analyze — reference mode locks onto a 50 Hz hum at −30 dB under speech (correlation ≥ 0.95)', () => {
	let speech = new Float32Array(raw).subarray(0, N6)
	let hum = sine(50, N6, 1)
	let scale = rms(speech) * Math.pow(10, -30 / 20) / rms(hum)
	let cleanRef = add(speech, hum.map(v => v * scale))
	let a = analyze(warp(cleanRef, sOfT), { fs, mode: 'reference', refFreq: 50 })
	let c = corr(a.speed, Array.from(a.times).map(sOfT))
	ok(c >= 0.95, `correlation ${c.toFixed(4)}`)
})

t('analyze — reference mode resolves 30 Hz flutter on a 1 kHz calibration tone (within 30% of 0.4%)', () => {
	let a = analyze(warp(sine(1000, N6, 0.5), sOfT), { fs, mode: 'reference', refFreq: 1000 })
	ok(a.flutterPeak >= 0.28 && a.flutterPeak <= 0.52, `flutterPeak ${a.flutterPeak.toFixed(3)}%`)
	ok(a.wowPeak >= 1.7 && a.wowPeak <= 2.3, `wowPeak ${a.wowPeak.toFixed(3)}%`)
})

t('reference mode — without refFreq a tone is looked for: none in a chord, a 19 kHz pilot found; an out-of-range one throws', () => {
	let a = analyze(dirtyChord, { fs, mode: 'reference' })
	ok(a.reference === null && a.speed.every(v => v === 1), 'no tone: no curve')
	let speech = new Float32Array(raw).subarray(0, N6), pilot = sine(19000, N6, rms(speech) * 0.01 * Math.SQRT2)
	let b = analyze(warp(add(speech, pilot), sOfT), { fs, mode: 'reference' })
	ok(Math.abs(b.reference / 19000 - 1) < 0.002, `found ${b.reference.toFixed(1)} Hz`)
	let c = corr(b.speed, Array.from(b.times).map(sOfT))
	ok(c >= 0.95, `curve correlation ${c.toFixed(4)} (wow and 30 Hz flutter, the latter read over 23 ms)`)
	throws(() => analyze(dirtyChord, { fs, mode: 'reference', refFreq: 30000 }), null, 'refFreq above Nyquist throws')
})

t('unknown mode throws', () => {
	throws(() => analyze(dirtyChord, { fs, mode: 'bogus' }))
})

// =================== mode 'pitch' ===================

t('pitch mode — runs on real speech, produces finite same-length output', () => {
	// opt-in, monophonic: it takes the voice's own pitch movement for speed (see dewow.js); a functional check
	let speech = new Float32Array(raw).subarray(0, N6)
	let dirtySpeech = warp(speech, sOfT)
	let out = dewow(dirtySpeech, { fs, mode: 'pitch', smooth: 3 })
	is(out.length, dirtySpeech.length)
	ok(out.every(isFinite), 'no NaN/Inf')
	let a = analyze(dirtySpeech, { fs, mode: 'pitch' })
	ok(a.confidence > 0.5, `voiced-frame confidence ${a.confidence.toFixed(2)}`)
})

// =================== edge cases ===================

t('edge cases — silence, very short input, a single sample, empty input: finite, no throw', () => {
	let silent = dewow(new Float32Array(fs * 2), { fs })
	is(silent.length, fs * 2)
	ok(silent.every(v => v === 0), 'silence stays silent')
	let short = dewow(sine(440, 100, 0.5), { fs })
	is(short.length, 100)
	ok(short.every(isFinite), 'shorter than one analysis frame — no crash, no NaN')
	is(dewow(Float32Array.of(0.5), { fs })[0], 0.5, 'one sample')
	is(dewow(new Float32Array(0), { fs }).length, 0)
	for (let mode of ['reference', 'pitch']) ok(dewow(sine(440, 100, 0.5), { fs, mode, refFreq: 50 }).every(isFinite), mode + ' mode, short')
})

t('edge cases — wow:false / flutter:false disable their own band only', () => {
	let wowOnlyOut = dewow(dirtyChord, { fs, flutter: false }), flutterOnly = dewow(dirtyChord, { fs, wow: false })
	ok(wowOnlyOut.every(isFinite) && flutterOnly.every(isFinite))
	is(wowOnlyOut.length, dirtyChord.length)
	is(flutterOnly.length, dirtyChord.length)
})

t('edge cases — maxDeviation clamps an outlier curve', () => {
	let out = dewow(new Float32Array(fs).fill(0), { fs, mode: 'reference', refFreq: 1000, maxDeviation: 0.05 })
	ok(out.every(isFinite))
})

// =================== speed ===================

t('speed — 60s stereo', () => {
	let n = 60 * fs
	let long = mul(add(sine(261.63, n, 0.25), sine(329.63, n, 0.25), sine(415.30, n, 0.25), sine(587.33, n, 0.25)), envelope(n))
	let t0 = Date.now()
	dewow([long, long], { fs })
	let ms = Date.now() - t0
	console.log(`  60s stereo dewow(): ${ms}ms`)
	ok(ms < 15000, `${ms}ms`)
})
