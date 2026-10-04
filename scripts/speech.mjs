// Speech clean-up measured: each system on VoiceBank+DEMAND (test set and a training subset) and on ten Spoken
// Wikipedia narrations, one float32 file per system and input, in ~/.cache/audiojs/data/<set>/out/<system>/.
// Existing files are kept, so an interrupted run resumes; scripts/speech.py scores them.
//
//   node scripts/speech.mjs SET SYSTEMS [SHARD/N] [TAG] [PARAMS]
//     SET: vbdemand | vbclean | noise | vbhum50 | vbhum60 | vbtrain | rooms | vbdemand@RATE | vbtrain@RATE
//          | vbreverb | vbreverb-train | vbreverb-dry
//     PARAMS: JSON manifest params for the systems
//   node scripts/speech.mjs hum                            dehum's hum reduction, dB
//   e.g. node scripts/speech.mjs vbtrain omlsa 0/1 g12 '{"gMin":-12}'
//
// Systems run through the packages' audio.js manifests, as `audio` runs them: the host's default parameters (or
// PARAMS; Float32 like a host's param buffers), 1024-sample blocks (the whole clip when a manifest is streaming: false),
// the declared latency compensated (input padded by `latency` zeros, the first `latency` output samples dropped).
// TAG names the output folder (<system>.<TAG>), so before/after runs of one system sit side by side. The defaults were
// chosen on vbtrain (its every third utterance) with `python scripts/speech.py score vbtrain SYSTEM...`.
//
// Data (never committed):
//   vbdemand: VoiceBank+DEMAND test set (Valentini-Botinhao 2017, CC BY 4.0, doi:10.7488/ds/2117), 824 pairs in
//     ~/.cache/audiojs/data/vbdemand/{clean,noisy}_testset_wav/.
//   vbclean: the test set's clean utterances as input (does clean speech pass untouched?), outputs in vbdemand/out-clean/.
//   noise: stationary white and pink Gaussian noise, no speech (musical noise), outputs in vbdemand/out-noise/.
//   vbhum50, vbhum60: the clean utterances with mains hum 20 dB under them (`hum` below), outputs in vbdemand/out-hum50|60/.
//   vbtrain: a speaker-disjoint subset of the 28-speaker training set, 18 utterances of each speaker, fetched by
//     `python scripts/speech.py fetch` into ~/.cache/audiojs/data/vbdemand-train/{clean,noisy}/. Tuning uses only this.
//   rooms: the first 60 s of ten Spoken Wikipedia narrations at 48 kHz, ~/.cache/audiojs/data/spoken/<name>.f32
//     (scripts/accuracy.mjs in @audio/neural-denoise lists them and how they were decoded).
//   vbreverb, vbreverb-train: a quarter of the clean VoiceBank+DEMAND test (206) and training-subset (126) utterances
//     through MIT IR Survey rooms (Traer & McDermott, PNAS 2016; odd-numbered responses for the test set, even for
//     training), the direct sound aligned to the dry take, in ~/.cache/audiojs/data/vbreverb/{test,train}-{reverb,clean}/
//     (as audio's bench/speech.mjs uses them); outputs in vbreverb/out/, vbreverb/out-train/. vbreverb-dry: the test
//     set's dry takes as input (does dry speech pass untouched?), outputs in vbreverb/out-dry/.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { highpass, cascade } from '@audio/biquad'
import { omlsa } from '@audio/denoise-omlsa/audio'
import { wiener } from '@audio/denoise-wiener/audio'
import { specsub } from '@audio/denoise-spectral/audio'
import { dehum } from '@audio/denoise-dehum/audio'
import { dereverb } from '@audio/denoise-dereverb/audio'

const DATA = path.join(os.homedir(), '.cache', 'audiojs', 'data')
const BLOCK = 1024

export function wav(file) {
	let b = readFileSync(file), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), o = 12, fs = 0
	while (o < b.length) {
		let id = b.toString('ascii', o, o + 4), len = dv.getUint32(o + 4, true)
		if (id === 'fmt ') fs = dv.getUint32(o + 12, true)
		if (id === 'data') { let x = new Float32Array(len / 2); for (let i = 0; i < x.length; i++) x[i] = dv.getInt16(o + 8 + 2 * i, true) / 32768; return { x, fs } }
		o += 8 + len + (len & 1)
	}
	throw new Error(`no data chunk in ${file}`)
}

// A host for one manifest: params as a host passes them, blocks of BLOCK samples (the whole clip in one call when
// the manifest says streaming: false), latency compensated.
export function host(m, x, fs, opts = {}) {
	let params = {}
	for (let [k, s] of Object.entries(m.params || {})) {
		let v = opts[k] ?? s.default
		params[k] = s.type === 'number' ? new Float32Array([v]) : v
	}
	let L = typeof m.latency === 'function' ? m.latency({ sampleRate: fs, params }) : (m.latency | 0)
	let block = m.streaming === false ? x.length + L : BLOCK
	let proc = m({ sampleRate: fs, maxBlockSize: block, maxChannels: 1, currentTime: 0, params })
	let n = x.length + L, inp = new Float32Array(n), out = new Float32Array(n)
	inp.set(x)
	for (let i = 0; i < n; i += block) {
		let len = Math.min(block, n - i), o = new Float32Array(len)
		proc([[inp.subarray(i, i + len)]], [[o]], params); out.set(o, i)
	}
	return out.slice(L, L + x.length)
}

// audio's highpass(80): order 2, one Butterworth biquad (RBJ cookbook, Q = 1/√2)
const hp80 = (x, fs) => cascade(Float32Array.from(x), [highpass(80, Math.SQRT1_2, fs)])

export const SYSTEMS = {
	raw: (x) => x,
	omlsa: (x, fs, p) => host(omlsa, x, fs, p),
	wiener: (x, fs, p) => host(wiener, x, fs, p),
	specsub: (x, fs, p) => host(specsub, x, fs, p),
	dehum: (x, fs, p) => host(dehum, x, fs, p),
	dehum60: (x, fs) => host(dehum, x, fs, { freq: 60 }),
	dereverb: (x, fs, p) => host(dereverb, x, fs, p),
	'enhance-denoise': (x, fs) => host(omlsa, host(dehum, hp80(x, fs), fs), fs),
}

// Mains hum: 12 harmonics of f0 at 1/h amplitude (-6 dB per octave), phases from a fixed seed, scaled to `rms`.
// The sets put it 20 dB under each clean test utterance, f0 0.05 Hz off nominal (grids hold ±0.2 Hz).
export function hum(n, fs, f0, rms) {
	let seed = 1, rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647, ph = [], y = new Float32Array(n), e = 0
	for (let h = 1; h <= 12; h++) ph.push(2 * Math.PI * rnd())
	for (let i = 0; i < n; i++) {
		let v = 0
		for (let h = 1; h <= 12 && h * f0 < fs / 2; h++) v += Math.sin(2 * Math.PI * h * f0 * i / fs + ph[h - 1]) / h
		y[i] = v; e += v * v
	}
	let g = rms / Math.sqrt(e / n)
	for (let i = 0; i < n; i++) y[i] *= g
	return y
}
const rmsOf = x => { let e = 0; for (let v of x) e += v * v; return Math.sqrt(e / x.length) }
const withHum = f0 => ({ x, fs }) => { let h = hum(x.length, fs, f0, rmsOf(x) / 10); return { x: x.map((v, i) => v + h[i]), fs } }

// Hum reduction on the hum alone, dB, 10 s of it, the first 0.5 s left out. dehum adapts to what it is given, so this
// is the hum without a program; scripts/dehum.js measures it under speech and music.
function humReduction(fs = 48000) {
	for (let f0 of [50, 50.05, 60, 59.95]) {
		let h = hum(10 * fs, fs, f0, 0.01), row = []
		for (let [label, sys] of [['dehum', SYSTEMS.dehum], ['dehum60', SYSTEMS.dehum60]]) {
			let y = sys(h, fs), a = h.subarray(fs / 2), b = y.subarray(fs / 2)
			row.push(`${label} ${(20 * Math.log10(rmsOf(a) / rmsOf(b))).toFixed(1)} dB`)
		}
		console.log(`hum at ${f0} Hz: ${row.join(', ')}`)
	}
}

function each(inputs, list, out, tag, params) {
	for (let s of list) {
		if (!SYSTEMS[s]) throw new Error(`unknown system ${s}`)
		let dir = path.join(out, tag ? `${s}.${tag}` : s)
		mkdirSync(dir, { recursive: true })
		let c0 = process.cpuUsage(), dur = 0
		for (let [name, get] of inputs) {
			let file = path.join(dir, name + '.f32')
			if (existsSync(file)) continue
			let { x, fs } = get(), y = SYSTEMS[s](x, fs, params)
			if (y.length !== x.length) throw new Error(`${s} ${name}: ${y.length} samples for ${x.length}`)
			writeFileSync(file, new Uint8Array(y.buffer, y.byteOffset, y.length * 4))
			dur += x.length / fs
		}
		let c = process.cpuUsage(c0)
		console.log(`${s}${tag ? '.' + tag : ''}: ${dur.toFixed(0)} s of audio, ${((c.user + c.system) / 1e6).toFixed(1)} s of CPU`)
	}
}

export const SETS = {
	vbdemand: () => { let d = path.join(DATA, 'vbdemand'); return [d, readdirSync(path.join(d, 'noisy_testset_wav')).filter(f => f.endsWith('.wav')).sort().map(f => [f.slice(0, -4), () => wav(path.join(d, 'noisy_testset_wav', f))])] },
	vbclean: () => { let d = path.join(DATA, 'vbdemand'); return [path.join(d, 'out-clean'), readdirSync(path.join(d, 'clean_testset_wav')).filter(f => f.endsWith('.wav')).sort().map(f => [f.slice(0, -4), () => wav(path.join(d, 'clean_testset_wav', f))])] },
	vbtrain: () => { let d = path.join(DATA, 'vbdemand-train'); return [d, readdirSync(path.join(d, 'noisy')).filter(f => f.endsWith('.wav')).sort().map(f => [f.slice(0, -4), () => wav(path.join(d, 'noisy', f))])] },
	noise: noiseOnly,
	vbreverb: () => reverb('test-reverb', 'out'),
	'vbreverb-train': () => reverb('train-reverb', 'out-train'),
	'vbreverb-dry': () => reverb('test-clean', 'out-dry'),
	vbhum50: () => hummed(50.05),
	vbhum60: () => hummed(59.95),
	rooms: () => {
		let d = path.join(DATA, 'spoken'), f32 = p => { let b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
		return [d, readdirSync(d).filter(f => f.endsWith('.f32')).sort().map(f => [f.slice(0, -4), () => ({ x: f32(path.join(d, f)), fs: 48000 })])]
	},
}

// Stationary Gaussian noise alone (no speech), white and pink, 8 s at 48 kHz: what a denoiser does to noise it has
// learned, where musical noise shows. Irwin–Hall normals from a Park–Miller generator; pink by Kellet's filter.
function noiseOnly() {
	let fs = 48000, n = 8 * fs, mk = pink => {
		let seed = pink ? 2 : 1, rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647, x = new Float32Array(n)
		let b = [0, 0, 0, 0, 0, 0, 0]
		for (let i = 0; i < n; i++) {
			let w = -6
			for (let j = 0; j < 12; j++) w += rnd()
			if (!pink) { x[i] = 0.01 * w; continue }
			b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759; b[2] = 0.969 * b[2] + w * 0.153852
			b[3] = 0.8665 * b[3] + w * 0.3104856; b[4] = 0.55 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.016898
			x[i] = 0.01 * 0.11 * (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362); b[6] = w * 0.115926
		}
		return x
	}
	return [path.join(DATA, 'vbdemand', 'out-noise'), [['white', () => ({ x: mk(false), fs })], ['pink', () => ({ x: mk(true), fs })]]]
}

function reverb(input, out) {
	let d = path.join(DATA, 'vbreverb')
	return [path.join(d, out), readdirSync(path.join(d, input)).filter(f => f.endsWith('.wav')).sort().map(f => [f.slice(0, -4), () => wav(path.join(d, input, f))])]
}

function hummed(f0) {
	let d = path.join(DATA, 'vbdemand'), tag = Math.round(f0)
	return [path.join(d, `out-hum${tag}`), readdirSync(path.join(d, 'clean_testset_wav')).filter(f => f.endsWith('.wav')).sort().map(f => [f.slice(0, -4), () => withHum(f0)(wav(path.join(d, 'clean_testset_wav', f)))])]
}

// vbdemand@RATE, vbtrain@RATE: the noisy inputs at another sample rate, as `python scripts/speech.py resample SET RATE`
// writes them (<set dir>/rate<RATE>/<name>.f32); outputs in <set dir>/out@RATE/.
function resampled(set, rate) {
	let d = path.join(DATA, set === 'vbtrain' ? 'vbdemand-train' : 'vbdemand'), src = path.join(d, `rate${rate}`)
	let f32 = p => { let b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
	return [path.join(d, `out@${rate}`), readdirSync(src).filter(f => f.endsWith('.f32')).sort().map(f => [f.slice(0, -4), () => ({ x: f32(path.join(src, f)), fs: rate })])]
}

if (import.meta.url === `file://${process.argv[1]}`) {
	let [set, systems, shard = '0/1', tag = '', params] = process.argv.slice(2)
	let [base, rate] = (set || '').split('@')
	if (set === 'hum') humReduction()
	else if (!SETS[set] && !(rate && SETS[base])) { console.log('usage: node scripts/speech.mjs vbdemand|vbclean|noise|vbhum50|vbhum60|vbtrain|rooms|vbdemand@RATE|vbtrain@RATE|vbreverb|vbreverb-train|vbreverb-dry SYSTEMS [SHARD/N] [TAG] [PARAMS] | hum'); process.exit(1) }
	else {
		let [dir, inputs] = rate ? resampled(base, +rate) : SETS[set](), [k, n] = shard.split('/').map(Number)
		each(inputs.filter((_, i) => i % n === k), systems.split(','), !rate && (set === 'vbdemand' || set === 'vbtrain' || set === 'rooms') ? path.join(dir, 'out') : dir, tag, params && JSON.parse(params))
	}
}
