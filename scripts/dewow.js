// Measure @audio/denoise-dewow on wow and flutter added to clean speech, music and singing. Run: `node scripts/dewow.js
// [flutter | whole] [--test] [path to a dewow.js]` (tens of minutes; `flutter`, that table alone; `whole`, whole
// pieces of the repair/ music under disc wow). Prints the README's "Measured" tables: what dewow does to clean
// sound (the pitch instability it adds, cents RMS; the clips left bit-exact) and to performed pitch movement (a vibrato,
// a glide), and the pitch error left after it on recordings with wow or flutter, against doing nothing. The tuning
// material by default (the defaults were chosen on it); `--test`, the held-out material, never tuned on.
// `node scripts/dewow.js vbd` checks that the 824 clean VoiceBank+DEMAND test utterances pass through bit-exact.
//
// Defects: the clean sound read at a varying speed s(t) by the windowed sinc dewow corrects with (@audio/resample-sinc,
// 16 zero crossings). Disc: s = 1 + A sin(2π f_r t), an off-centre record (Godsill & Rayner, Digital Audio Restoration,
// 1998, eq. 8.2) at f_r = 33⅓/60, 45/60 or 78/60 Hz. Tape: random wow, 64 random-phase sines log-uniform in 0.5–6 Hz,
// amplitude ∝ f^−½, scaled to peak A. A = 0.3 % (a worn cassette), 1 %, 2 % (a warped disc). Flutter: 64 such sines in
// 6–30 Hz, peak 0.1 %, over 1 % tape wow; read by a tone: a 19 kHz pilot 40 dB under the program's RMS (found by
// itself, default mode) or mains hum, 50 Hz 30 dB under with its 2nd and 3rd harmonics 6 and 10 dB below it (found by
// itself, `mode: 'reference'`).
// Pitch error: the output's local lag against the clean sound (both low-passed at 1 kHz; normalised cross-correlation,
// 23 ms Hann windows every 10 ms, parabolic peak), differentiated over ±20 ms: 1200·log2(1 + dL/dt), its mean removed
// (a constant transposition is not instability), RMS over the windows where the clean sound is within 40 dB of its mean
// power and the match holds (correlation > 0.8). Independent of dewow's own estimate.
//
// Material, when present in ~/.cache/audiojs/data/ (audio-lena is a devDependency): speech — audio-lena; Spoken
// Wikipedia narrations (spoken/<name>.f32, 48 kHz, see scripts/speech.mjs), 20 s each. Music — the repair/ clips (see
// scripts/repair.js: "Vibe Ace", "Dance of the Sugar Plum Fairy", Brahms' Hungarian Dance No. 5, a trumpet loop);
// GuitarSet (Xi et al., ISMIR 2018, CC BY 4.0), mono-mic takes; MUSDB18 mixes (Rafii et al., 2017; the 7 s excerpts
// decoded with ffmpeg where it is installed); BabySlakh mixes (Manilow et al., WASPAA 2019; slakh/mix44/), 20 s from 0:30.
// Singing — VocalSet (Wilkins et al., ISMIR 2018, CC BY 4.0). Generated here: a voice with vibrato, a glide, a chord.

import { sincRead } from '@audio/resample-sinc'
import raw from 'audio-lena/raw'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { homedir } from 'os'

const args = process.argv.slice(2), TEST = args.includes('--test'), VBD = args.includes('vbd'), FLUTTER = args.includes('flutter'), WHOLE = args.includes('whole'), kpath = args.find(a => a.endsWith('.js'))
const dewow = (await import(kpath ? new URL(kpath, `file://${process.cwd()}/`) : '@audio/denoise-dewow')).default
const DATA = `${homedir()}/.cache/audiojs/data`
const f32 = p => new Float32Array(readFileSync(p).buffer.slice(0))
const cut = (x, fs, a, b) => Float32Array.from(x.subarray(Math.round(a * fs), Math.min(x.length, Math.round(b * fs))))
const ls = (d, ext = '') => existsSync(d) ? readdirSync(d).filter(f => f.endsWith(ext)).sort() : []
function wav(path) {   // 16-bit or float PCM, channels averaged
	let b = readFileSync(path), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), o = 12, fs = 0, ch = 1, bits = 16
	while (o < b.length) {
		let id = b.toString('ascii', o, o + 4), sz = dv.getUint32(o + 4, true)
		if (id === 'fmt ') { ch = dv.getUint16(o + 10, true); fs = dv.getUint32(o + 12, true); bits = dv.getUint16(o + 22, true) }
		if (id === 'data') {
			let n = Math.floor(sz / (bits / 8) / ch), x = new Float32Array(n)
			for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) x[i] += (bits === 16 ? dv.getInt16(o + 8 + (i * ch + c) * 2, true) / 32768 : dv.getFloat32(o + 8 + (i * ch + c) * 4, true)) / ch
			return { x, fs }
		}
		o += 8 + sz + (sz & 1)
	}
}
function musdb(path, a, b) {   // a MUSDB18 mixture (the stem file's first stream), mono, 44.1 kHz
	let r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(a), '-t', String(b - a), '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', '44100', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 })
	return r.error || !r.stdout?.length ? null : new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length))
}

// ---- 824 clean VoiceBank+DEMAND test utterances: bit-exact?
if (VBD) {
	let d = `${DATA}/vbdemand/clean_testset_wav`, files = ls(d, '.wav'), moved = []
	for (let f of files) { let w = wav(`${d}/${f}`), y = dewow(w.x.slice(), { fs: w.fs }); if (!y.every((v, i) => v === w.x[i])) moved.push(f) }
	console.log(`VoiceBank+DEMAND clean test: ${files.length - moved.length} of ${files.length} bit-exact${moved.length ? '; moved: ' + moved.join(', ') : ''}`)
	process.exit(0)
}

// ---- whole pieces: the longer the recording, the more turns of the disc and returns of each note it holds
if (WHOLE) {
	console.log('whole pieces, disc wow at 33⅓ rpm: pitch error left, cents RMS (do nothing → dewow)\n\n| | length | 0.3 % | 1 % | 2 % |\n|---|---:|---:|---:|---:|')
	for (let k of ['nutcracker', 'vibeace', 'brahms']) {
		if (!existsSync(`${DATA}/repair/${k}.f32`)) continue
		let x = f32(`${DATA}/repair/${k}.f32`), fs = 44100, cells = []
		for (let A of [0.003, 0.01, 0.02]) {
			let s = t => 1 + A * Math.sin(2 * Math.PI * 100 / 180 * t), y = new Float32Array(x.length), p = 0
			for (let i = 0; i < x.length; i++) { y[i] = p < x.length - 1 ? sincRead(x, p, 16, 1) : 0; p += s(i / fs) }
			cells.push(`${pitchError(x, y, fs).toFixed(1)} → ${pitchError(x, dewow(y, { fs }), fs).toFixed(1)}`)
		}
		console.log(`| ${k} | ${(x.length / fs).toFixed(0)} s | ${cells.join(' | ')} |`)
	}
	process.exit(0)
}

// ---- material: [name, kind, samples, rate]
const material = []
const push = (name, kind, x, fs) => x && x.length >= 5 * fs && material.push([name, kind, x, fs])
let sp = ls(`${DATA}/spoken`, '.f32'), gs = ls(`${DATA}/guitarset/audio_mono-mic`, '.wav'), mus = ls(`${DATA}/musdb/${TEST ? 'test' : 'train'}`, '.stem.mp4'), sl = ls(`${DATA}/slakh/mix44`, '.wav')
if (!TEST) push('lena', 'speech', cut(new Float32Array(raw), 44100, 0, 12), 44100)
for (let i of TEST ? [7, 9] : [1, 4]) if (sp[i]) push(sp[i].slice(0, 12), 'speech', cut(f32(`${DATA}/spoken/${sp[i]}`), 48000, 10, 30), 48000)
if (!TEST) for (let [k, a, b] of [['vibeace', 5, 25], ['brahms', 5, 25], ['trumpet', 0, 6], ['nutcracker', 5, 25]])
	if (existsSync(`${DATA}/repair/${k}.f32`)) push(k, 'music', cut(f32(`${DATA}/repair/${k}.f32`), 44100, a, b), 44100)
for (let i of TEST ? [101, 203, 305] : [0, 3, 40]) if (gs[i]) { let w = wav(`${DATA}/guitarset/audio_mono-mic/${gs[i]}`); push(gs[i].slice(0, 10), 'music', cut(w.x, w.fs, 0, 20), w.fs) }
for (let i of TEST ? [1, 9, 17, 25, 33, 41] : [2, 10, 20, 30, 40, 50]) if (mus[i]) push(mus[i].slice(0, 14), 'music', musdb(`${DATA}/musdb/${TEST ? 'test' : 'train'}/${mus[i]}`, 0, 7), 44100)
for (let i of TEST ? [1, 5, 9, 13] : [0, 4, 8, 12]) if (sl[i]) { let w = wav(`${DATA}/slakh/mix44/${sl[i]}`); push(sl[i].slice(0, 10), 'music', cut(w.x, w.fs, 30, 50), w.fs) }
for (let [s, p] of TEST ? [['male5', 'excerpts/vibrato'], ['female6', 'excerpts/vibrato'], ['male7', 'long_tones/forte'], ['female8', 'arpeggios/vibrato']]
	: [['male1', 'excerpts/vibrato'], ['female2', 'excerpts/vibrato'], ['male1', 'long_tones/forte'], ['female2', 'excerpts/straight'], ['male2', 'arpeggios/slow_forte']]) {
	let f = ls(`${DATA}/vocalset/FULL/${s}/${p}`, '.wav')[0]
	if (f) { let w = wav(`${DATA}/vocalset/FULL/${s}/${p}/${f}`); push(`${s} ${p.split('/').pop()}`, 'sung', cut(w.x, w.fs, 0, 20), w.fs) }
}

// generated: a voice (220 Hz, harmonics 1..8 at 1/k) with ±50 cents vibrato at 5.5 Hz (Sundberg 1987), the same voice
// gliding 220 → 330 Hz over a second, held either side; a steady chord of independent notes (C4 E4 G♯4 D5, harmonics
// 1..4), alone and under the vibrato voice
function voice(f, n, fs, H = 8, amp = 0.2) { let x = new Float32Array(n), ph = 0; for (let i = 0; i < n; i++) { ph += 2 * Math.PI * f(i / fs) / fs; for (let h = 1; h <= H; h++) x[i] += amp / h * Math.sin(h * ph) } return x }
const add = (...xs) => xs.reduce((a, b) => a.map((v, i) => v + b[i]))
const N8 = 8 * 44100, vib = t => 220 * 2 ** (50 / 1200 * Math.sin(2 * Math.PI * 5.5 * t))
const chord = () => add(...[261.63, 329.63, 415.3, 587.33].map(f => voice(() => f, N8, 44100, 4, 0.1)))
const movement = [
	['vibrato voice', voice(vib, N8, 44100)],
	['glide 220 → 330 Hz', voice(t => t < 2 ? 220 : t < 3 ? 220 * 1.5 ** (t - 2) : 330, N8, 44100)],
	['vibrato voice over a chord', add(voice(vib, N8, 44100), chord())],
	['steady chord', chord()],
]

// ---- defects and the meter
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
function random(lo, hi, A, seed) {   // 64 random-phase sines log-uniform in [lo, hi] Hz, amplitude ∝ f^−½, peak A over 60 s
	let r = lcg(seed), cs = Array.from({ length: 64 }, () => { let f = lo * (hi / lo) ** r(); return [f, r() * 2 * Math.PI, f ** -0.5] })
	let w = t => cs.reduce((s, [f, p, a]) => s + a * Math.sin(2 * Math.PI * f * t + p), 0), g = 0
	for (let t = 0; t < 60; t += 0.002) g = Math.max(g, Math.abs(w(t)))
	return t => A * w(t) / g
}
const shapes = {
	'disc 33⅓': A => t => 1 + A * Math.sin(2 * Math.PI * 100 / 180 * t),
	'disc 45': A => t => 1 + A * Math.sin(2 * Math.PI * 0.75 * t),
	'disc 78': A => t => 1 + A * Math.sin(2 * Math.PI * 1.3 * t),
	tape: A => { let w = random(0.5, 6, A, 1); return t => 1 + w(t) },
}
const flutter = (() => { let w = random(0.5, 6, 0.01, 2), f = random(6, 30, 0.001, 3); return t => 1 + w(t) + f(t) })()
function warp(x, s, fs) { let y = new Float32Array(x.length), p = 0; for (let i = 0; i < x.length; i++) { y[i] = p < x.length - 1 ? sincRead(x, p, 16, 1) : 0; p += s(i / fs) } return y }

// zero-phase low-pass at fc (RBJ biquad, Q 0.707, forward and backward): applied to both sounds alike, it leaves the
// lag alone; above it, a 2 % speed difference slides a window's partials apart within it and the match is lost
function lowpass(x, fc, fs) {
	let w = 2 * Math.PI * fc / fs, al = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), a0 = 1 + al
	let b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0
	let run = (v, back) => {
		let y = new Float64Array(v.length), x1 = 0, x2 = 0, y1 = 0, y2 = 0, n = v.length
		for (let k = 0; k < n; k++) { let i = back ? n - 1 - k : k, xi = v[i], yi = b0 * xi + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi }
		return y
	}
	return run(run(x, false), true)
}
function pitchError(ref, out, fs) {
	ref = lowpass(ref, 1000, fs); out = lowpass(out, 1000, fs)
	let W = 1024, half = W >> 1, hop = Math.round(fs / 100), win = Float64Array.from({ length: W }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / W))
	let tot = 0; for (let v of ref) tot += v * v
	let floor = tot / ref.length * W * 0.375 * 1e-4, seg = new Float64Array(W), L = 0, Ls = [], ok = []
	for (let c = half + 1000; c + half + 1000 < out.length; c += hop) {
		let e = 0, er = 0
		for (let i = 0; i < W; i++) { seg[i] = out[c - half + i] * win[i]; e += seg[i] * seg[i]; er += (ref[c - half + i] * win[i]) ** 2 }
		if (er < floor || !e) { Ls.push(L); ok.push(false); continue }
		let corr = r => { let s = 0, q = 0, b = c - half + r; for (let i = 0; i < W; i++) { let v = ref[b + i] * win[i]; s += seg[i] * v; q += v * v } return q > 0 ? s / Math.sqrt(q * e) : 0 }
		let best = -2, bi = 0, v = new Map(), search = (a, b, st = 1) => { for (let r = a; r <= b; r += st) { let q = corr(r); v.set(r, q); if (q > best) { best = q; bi = r } } }
		search(Math.round(L) - 40, Math.round(L) + 40)
		if (best < 0.6) { search(Math.round(L) - 1600, Math.round(L) + 1600, 2); search(bi - 2, bi + 2) }
		let a = v.get(bi - 1) ?? corr(bi - 1), d = v.get(bi + 1) ?? corr(bi + 1), den = a - 2 * best + d
		L = bi + (den < 0 ? 0.5 * (a - d) / den : 0); Ls.push(L); ok.push(best > 0.8)
	}
	let e = []
	// a lag that jumps a period between windows (a steady tone's correlation repeats) measures no pitch
	for (let k = 2; k + 2 < Ls.length; k++) if (ok[k - 2] && ok[k] && ok[k + 2] && Math.abs(Ls[k + 2] - Ls[k - 2]) < 2 * hop) e.push(1200 * Math.log2(1 + (Ls[k + 2] - Ls[k - 2]) / (4 * hop)))
	if (!e.length) return 0
	let m = e.reduce((s, v) => s + v, 0) / e.length
	return Math.sqrt(e.reduce((s, v) => s + (v - m) ** 2, 0) / e.length)
}
const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i])
const mean = a => a.reduce((s, v) => s + v, 0) / a.length
const rms = x => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
const tone = (x, fs, f, db, hs = [1]) => { let a = rms(x) * 10 ** (db / 20) * Math.SQRT2; return Float32Array.from(x, (v, i) => v + hs.reduce((s, g, h) => s + a * g * Math.sin(2 * Math.PI * f * (h + 1) * i / fs + h), 0)) }
const kinds = ['speech', 'music', 'sung'].filter(k => material.some(m => m[1] === k))
const cell = r => `${mean(r.map(v => v[0])).toFixed(1)} → ${mean(r.map(v => v[1])).toFixed(1)}${r.some(v => v[1] > v[0] * 1.05) ? ` (${r.filter(v => v[1] > v[0] * 1.05).length} worse)` : ''}`
console.log(`${TEST ? 'held-out' : 'tuning'} material: ${kinds.map(k => `${material.filter(m => m[1] === k).length} ${k}`).join(', ')} clips`)

// ---- clean sound
if (!FLUTTER) console.log('\nclean: pitch instability added, cents RMS (mean / worst), clips left bit-exact\n\n| | clips | added | bit-exact |\n|---|---:|---:|---:|')
if (!FLUTTER) for (let k of kinds) {
	let r = material.filter(m => m[1] === k).map(([, , x, fs]) => { let y = dewow(x.slice(), { fs }); return [pitchError(x, y, fs), same(x, y)] })
	console.log(`| ${k} | ${r.length} | ${mean(r.map(v => v[0])).toFixed(2)} / ${Math.max(...r.map(v => v[0])).toFixed(2)} | ${r.filter(v => v[1]).length} |`)
}
if (!TEST && !FLUTTER) {
	console.log('\nperformed pitch movement (generated, 8 s): pitch instability added, cents RMS; bit-exact\n\n| | added | bit-exact |\n|---|---:|---:|')
	for (let [name, x] of movement) { let y = dewow(x.slice(), { fs: 44100 }); console.log(`| ${name} | ${pitchError(x, y, 44100).toFixed(2)} | ${same(x, y) ? 'yes' : 'no'} |`) }
}

// ---- wow
let sev = [0.003, 0.01, 0.02]
if (!FLUTTER) console.log(`\nwow: pitch error left, cents RMS, mean over clips (do nothing → dewow); clips made worse (> 5 %)\n\n| | wow | ${sev.map(A => `${A * 100} %`).join(' | ')} |\n|---|---|${sev.map(() => '---:').join('|')}|`)
if (!FLUTTER) for (let k of [...kinds, ...(TEST ? [] : ['chord'])]) for (let sh in shapes) {
	let clips = k === 'chord' ? [['chord', 'chord', chord(), 44100]] : material.filter(m => m[1] === k)
	let cells = sev.map(A => cell(clips.map(([, , x, fs]) => { let y = warp(x, shapes[sh](A), fs); return [pitchError(x, y, fs), pitchError(x, dewow(y.slice(), { fs }), fs)] })))
	console.log(`| ${k} | ${sh} | ${cells.join(' | ')} |`)
}

// ---- flutter, and a tone to read it by
console.log('\nflutter (6–30 Hz, 0.1 % peak) over 1 % tape wow: pitch error left, cents RMS, mean over clips\n\n| | no tone | 19 kHz pilot, −40 dB | 50 Hz hum, −30 dB (`reference`) |\n|---|---:|---:|---:|')
for (let k of kinds) {
	let clips = material.filter(m => m[1] === k)
	let none = clips.map(([, , x, fs]) => { let y = warp(x, flutter, fs); return [pitchError(x, y, fs), pitchError(x, dewow(y.slice(), { fs }), fs)] })
	let pilot = clips.map(([, , x, fs]) => { let z = tone(x, fs, 19000, -40), y = warp(z, flutter, fs); return [pitchError(z, y, fs), pitchError(z, dewow(y, { fs }), fs)] })
	let hum = clips.map(([, , x, fs]) => { let z = tone(x, fs, 50, -30, [1, 0.5, 0.32]), y = warp(z, flutter, fs); return [pitchError(z, y, fs), pitchError(z, dewow(y, { fs, mode: 'reference' }), fs)] })
	console.log(`| ${k} | ${cell(none)} | ${cell(pilot)} | ${cell(hum)} |`)
}
