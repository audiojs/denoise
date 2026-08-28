// De-silence — VAD-driven silence handling for speech recordings: remove, shorten
// ("smart speed"), split, trim.
//
// Runs @audio/vad once on the mono mix to get a frame-level speech/non-speech track,
// folds it into time segments (bridging gaps shorter than `merge` — VAD jitter and
// short in-word pauses shouldn't fragment a phrase), then edits the *silence*
// between/around speech per `mode`:
//   - trim:    strip only leading/trailing silence, in full
//   - remove:  cut any pause longer than `minSilence` down to `pad` s kept on each
//              side (the side that borders speech; a leading/trailing pause has only
//              one side to pad)
//   - shorten: cut any pause longer than `maxSilence` down to `maxSilence`, split
//              evenly off the middle so the natural onset/offset around speech
//              survives — Overcast's "Smart Speed" (Marco Arment, 2015)
// `minSilence` gates whether a pause is touched at ALL, uniformly across shorten and
// remove — trim ignores it (trim always strips edges in full, that's its only job).
//
// Cuts are never hard splices. Each one is an equal-power (quarter-cosine) crossfade:
// the last `fade` seconds before the cut and the first `fade` seconds after it are
// blended into one `fade`-second transition, so cutting mid-waveform never clicks.
// A leading/trailing cut fades to/from silence instead (nothing to blend with).

import { vad as runVad } from '@audio/vad'
import { stftAnalyse } from '@audio/stft'

let toChannels = data => Array.isArray(data) ? data : [data]

function mixMono(channels) {
	if (channels.length === 1) return channels[0]
	let n = channels[0]?.length || 0
	let mono = new Float32Array(n)
	for (let c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length
	return mono
}

// Absolute-dB-threshold frame classifier — used only when opts.threshold overrides
// vad()'s adaptive percentile floor. Same STFT frame grid vad.js walks (mag energy,
// see @audio/vad's `lin2db(sqrt(e/N))`), but no spectral-flatness gate: an absolute
// level threshold has no "is it tonal" component to combine with, by construction.
function energyFrames(mono, { fs, frameSize, hopSize, threshold }) {
	let N = frameSize || 1024
	let hop = hopSize || (N >> 1)
	let frames = Math.max(0, Math.floor((mono.length - N) / hop) + 1)
	let active = new Uint8Array(frames)
	let times = new Float32Array(frames)
	let i = 0
	stftAnalyse(mono, (mag, _phase, pos) => {
		let half = mag.length - 1, e = 0
		for (let k = 1; k <= half; k++) e += mag[k] * mag[k]
		let db = 10 * Math.log10(Math.max(e / N, 1e-30))         // power dB, matches vad.js's 20·log10(sqrt(e/N))
		active[i] = db > threshold ? 1 : 0
		times[i] = pos / fs
		i++
	}, { frameSize: N, hopSize: hop })
	return { active, times, hop, frameSize: N }
}

// Frame-level active/inactive → merged speech time segments (input seconds).
function analyse(channels, opts) {
	let fs = opts.fs || 44100
	let mono = mixMono(channels)
	let n = mono.length
	let duration = n / fs
	let frameSize = opts.frameSize || 1024
	let hopSize = opts.hopSize || (frameSize >> 1)
	let merge = opts.merge ?? 0.15

	// Too short to run a single STFT frame over — nothing to analyse, whole input
	// counts as one speech segment (so every mode below naturally produces zero cuts).
	if (n < frameSize) return { speech: n ? [{ start: 0, end: duration }] : [], duration, fs, mono }

	let { active, times, hop } = opts.threshold == null
		? runVad(mono, { fs, frameSize, hopSize })
		: energyFrames(mono, { fs, frameSize, hopSize, threshold: opts.threshold })

	// STFT frames start at k·hop — each frame "owns" a hop-wide, non-overlapping time
	// cell. Group consecutive active cells into raw segments on that grid.
	let raw = [], start = -1
	for (let i = 0; i < active.length; i++) {
		if (active[i]) { if (start < 0) start = times[i] }
		else if (start >= 0) { raw.push({ start, end: times[i] }); start = -1 }
	}
	if (start >= 0) raw.push({ start, end: Math.min(duration, times[active.length - 1] + hop / fs) })

	// hangover: bridge speech separated by a gap shorter than `merge`
	let speech = []
	for (let s of raw) {
		let last = speech[speech.length - 1]
		if (last && s.start - last.end < merge) last.end = s.end
		else speech.push({ start: s.start, end: s.end })
	}
	return { speech, duration, fs, mono }
}

// Silence between/around speech, tagged with which side(s) border actual speech —
// remove mode needs that to know which edge(s) it may pad.
function silenceIntervals(speech, duration) {
	let out = [], prevEnd = 0, before = false
	for (let s of speech) {
		if (s.start > prevEnd) out.push({ start: prevEnd, end: s.start, before, after: true })
		prevEnd = s.end
		before = true
	}
	if (prevEnd < duration) out.push({ start: prevEnd, end: duration, before, after: false })
	return out
}

// Decide which time ranges (seconds, ascending, disjoint) to cut for a given mode.
function decideCuts(mode, speech, duration, opts) {
	let minSilence = opts.minSilence ?? 0.5
	let maxSilence = opts.maxSilence ?? 0.25
	let pad = opts.pad ?? 0.1
	let cuts = []

	if (mode === 'trim') {
		if (!speech.length) { if (duration > 0) cuts.push({ start: 0, end: duration }); return cuts }
		if (speech[0].start > 0) cuts.push({ start: 0, end: speech[0].start })
		let tailStart = speech[speech.length - 1].end
		if (tailStart < duration) cuts.push({ start: tailStart, end: duration })
		return cuts
	}

	for (let iv of silenceIntervals(speech, duration)) {
		let len = iv.end - iv.start
		if (len <= minSilence) continue                          // never touched, any mode

		if (mode === 'shorten') {
			let target = Math.min(len, maxSilence)
			if (target >= len) continue
			let keepEach = target / 2                              // symmetric — keeps the onset/offset
			cuts.push({ start: iv.start + keepEach, end: iv.end - keepEach })
		} else {                                                  // remove
			let before = iv.before ? pad : 0, after = iv.after ? pad : 0
			let target = before + after
			if (target >= len) continue
			cuts.push({ start: iv.start + before, end: iv.end - after })
		}
	}
	return cuts
}

// Apply cuts to every channel as equal-power crossfades. Returns new typed arrays,
// the kept (post-cut) time ranges, the input→output breakpoint map, and total removed.
function applyCuts(channels, cuts, fs, fadeSec) {
	let n = channels[0]?.length || 0
	let cutsS = cuts
		.map(c => ({ start: Math.max(0, Math.min(n, Math.round(c.start * fs))), end: Math.max(0, Math.min(n, Math.round(c.end * fs))) }))
		.filter(c => c.end > c.start)

	let kept = [], pos = 0
	for (let c of cutsS) { if (c.start > pos) kept.push({ start: pos, end: c.start }); pos = Math.max(pos, c.end) }
	if (pos < n) kept.push({ start: pos, end: n })

	let maxFade = Math.round(fadeSec * fs)
	let fadeIn = new Array(kept.length).fill(0)
	let fadeOut = new Array(kept.length).fill(0)
	for (let i = 0; i < kept.length; i++) {
		let span = kept[i], len = span.end - span.start
		if (i === 0 && span.start > 0) fadeIn[i] = Math.max(0, Math.min(maxFade, span.start, Math.floor(len / 2)))
		if (i > 0) {
			let prev = kept[i - 1]
			let gap = span.start - prev.end
			let f = Math.max(0, Math.min(maxFade, gap, Math.floor((prev.end - prev.start) / 2), Math.floor(len / 2)))
			fadeOut[i - 1] = f
			fadeIn[i] = f
		}
		if (i === kept.length - 1 && span.end < n) fadeOut[i] = Math.max(0, Math.min(maxFade, n - span.end, Math.floor(len / 2)))
	}

	let outLen = 0
	for (let i = 0; i < kept.length; i++) outLen += (kept[i].end - kept[i].start) - (i > 0 ? fadeIn[i] : 0)

	let outCh = channels.map(() => new Float32Array(outLen))
	let map = []
	let outPos = 0
	for (let i = 0; i < kept.length; i++) {
		let span = kept[i], fi = fadeIn[i], fo = fadeOut[i]
		let outStart = outPos

		if (fi > 0) {
			for (let c = 0; c < channels.length; c++) {
				let src = channels[c], dst = outCh[c]
				let prevEnd = i > 0 ? kept[i - 1].end : 0
				for (let t = 0; t < fi; t++) {
					let theta = (t / fi) * (Math.PI / 2)
					let gIn = Math.sin(theta)
					let head = src[span.start + t] * gIn
					dst[outPos + t] = i === 0 ? head : head + src[prevEnd - fi + t] * Math.cos(theta)
				}
			}
			outPos += fi
		}

		let midStart = span.start + fi, midEnd = span.end - fo, midLen = midEnd - midStart
		for (let c = 0; c < channels.length; c++) outCh[c].set(channels[c].subarray(midStart, midEnd), outPos)
		outPos += midLen

		if (fo > 0 && i === kept.length - 1) {
			for (let c = 0; c < channels.length; c++) {
				let src = channels[c], dst = outCh[c]
				for (let t = 0; t < fo; t++) dst[outPos + t] = src[midEnd + t] * Math.cos((t / fo) * (Math.PI / 2))
			}
			outPos += fo
		}

		map.push({ from: span.start / fs, to: outStart / fs })
		map.push({ from: span.end / fs, to: (outStart + (span.end - span.start)) / fs })
	}

	return {
		channels: outCh,
		kept: kept.map(k => ({ start: k.start / fs, end: k.end / fs })),
		map,
		removed: (n - outLen) / fs,
	}
}

export default function desilence(data, opts = {}) {
	let isMulti = Array.isArray(data)
	let channels = isMulti ? data : [data]
	let fs = opts.fs || 44100
	let mode = opts.mode || 'shorten'
	let fade = opts.fade ?? 0.01

	let { speech, duration } = analyse(channels, { ...opts, fs })
	let cuts = decideCuts(mode, speech, duration, opts)
	let { channels: outCh, kept, map, removed } = applyCuts(channels, cuts, fs, fade)

	return {
		data: isMulti ? outCh : outCh[0],
		segments: kept,
		removed,
		map,
	}
}

// Analysis only — speech/silence time segments (input seconds), no editing.
export function segments(data, opts = {}) {
	let { speech, duration } = analyse(toChannels(data), opts)
	let silence = silenceIntervals(speech, duration).map(({ start, end }) => ({ start, end }))
	return { speech: speech.map(s => ({ start: s.start, end: s.end })), silence }
}

// One clip per speech segment, padded by `opts.pad` seconds and edge-faded — "split by
// silence". Returns Float32Array[] for mono input, Float32Array[][] for multi-channel.
export function split(data, opts = {}) {
	let isMulti = Array.isArray(data)
	let channels = isMulti ? data : [data]
	let fs = opts.fs || 44100
	let pad = opts.pad ?? 0.1
	let fade = opts.fade ?? 0.01
	let n = channels[0]?.length || 0
	let { speech } = analyse(channels, { ...opts, fs })

	let out = []
	for (let s of speech) {
		let a = Math.max(0, Math.round((s.start - pad) * fs))
		let b = Math.min(n, Math.round((s.end + pad) * fs))
		if (b <= a) continue
		let len = b - a
		let fadeLen = Math.max(0, Math.min(Math.round(fade * fs), Math.floor(len / 2)))
		let chunk = channels.map(ch => {
			let seg = ch.slice(a, b)
			for (let t = 0; t < fadeLen; t++) {
				let g = Math.sin((t / fadeLen) * (Math.PI / 2))
				seg[t] *= g
				seg[len - 1 - t] *= g
			}
			return seg
		})
		out.push(isMulti ? chunk : chunk[0])
	}
	return out
}

// Project an input-seconds time through a desilence() `map` to its output-seconds
// position. Inside a kept span the map is exact (slope 1). Anything else — a cut, or
// the fraction-of-a-`fade`-second zone shared by a crossfade — collapses to the
// output instant right after the preceding kept content: there's no single correct
// sub-point answer once time has been removed or blended.
export function project(map, t) {
	if (!map.length) return t
	if (t <= map[0].from) return map[0].to
	let last = map[map.length - 1]
	if (t >= last.from) return last.to
	for (let i = 0; i < map.length - 1; i++) {
		let a = map[i], b = map[i + 1]
		if (t <= b.from) {
			let df = b.from - a.from
			if (df <= 0) return a.to
			let slope = (b.to - a.to) / df
			if (Math.abs(slope - 1) > 1e-6) return a.to
			return a.to + (t - a.from) * slope
		}
	}
	return last.to
}
