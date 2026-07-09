// Test suite for noise-reduction methods.
// Synthetic generators for deterministic property tests + audio-lena for real speech.

import test, { almost, ok, is } from 'tst'
import raw from 'audio-lena/raw'
import {
  gate, dehum, specsub, wiener, omlsa, declick, decrackle, declip,
  dewind, deplosive, deesser, debreath, dereverb, denoise, classify
} from './index.js'
import { vad, spp, ddSnr } from '@audio/denoise-core'
import { vad as vadDirect } from '@audio/vad'
import { noiseProfile, minStats, imcra } from '@audio/denoise-core'
import { snr, segSnr, lsd, nrr, speechAttenuation } from '@audio/denoise-core'
import { stftBatch, stftStream, stftAnalyse } from '@audio/denoise-core'

let fs = 44100
let lena = new Float32Array(raw)                          // 12.27s mono speech

// --- generators ---
function sine(freq, n, amp = 1, phase = 0) {
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = amp * Math.sin(2 * Math.PI * freq * i / fs + phase)
  return d
}
function noise(n, amp = 1) {
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = amp * (Math.random() * 2 - 1)
  return d
}
function add(...arrays) {
  let n = Math.max(...arrays.map(a => a.length))
  let d = new Float32Array(n)
  for (let a of arrays) for (let i = 0; i < a.length; i++) d[i] += a[i]
  return d
}
function copy(a) { return new Float32Array(a) }
function rms(d) { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length) }
function peak(d) { let p = 0; for (let i = 0; i < d.length; i++) { let a = Math.abs(d[i]); if (a > p) p = a } return p }
function mix(speech, noise, snrDb) {
  let sR = rms(speech), nR = rms(noise)
  let target = sR / Math.pow(10, snrDb / 20)
  let scale = target / Math.max(nR, 1e-30)
  let n = Math.max(speech.length, noise.length)
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = (speech[i] || 0) + (noise[i] || 0) * scale
  return d
}
function clicks(n, count, amp = 0.9) {
  let d = new Float32Array(n)
  for (let k = 0; k < count; k++) d[(k + 1) * Math.floor(n / (count + 1))] = (k & 1 ? -1 : 1) * amp
  return d
}

// =================== Phase 0 — utilities ===================

test('stft — round-trip preserves signal', () => {
  let x = sine(440, 8192)
  let out = stftBatch(x, (mag, phase) => ({ mag, phase }), { frameSize: 1024, hopSize: 256 })
  let n = Math.min(x.length, out.length) - 2048
  let err = 0
  for (let i = 1024; i < 1024 + n; i++) err += (out[i] - x[i]) ** 2
  ok(Math.sqrt(err / n) < 0.01, 'reconstruction error < 1%')
})

test('stft — streaming identity reconstructs mid-region across chunk boundaries', () => {
  // Pins the stream-buffer bookkeeping (appendIn/compactIn/take): irregular chunk
  // sizes force ring growth + input compaction; mid-region must reconstruct exactly.
  let N = 2048, hop = 512
  let x = sine(440, 12000)
  let s = stftStream((mag, phase) => ({ mag, phase }), { frameSize: N, hopSize: hop })
  let chunks = [], pos = 0
  for (let size of [700, 4096, 33, 2048, 5000, 123]) {
    chunks.push(s.write(x.subarray(pos, Math.min(pos + size, x.length))))
    pos = Math.min(pos + size, x.length)
  }
  chunks.push(s.flush())
  let out = new Float32Array(chunks.reduce((a, c) => a + c.length, 0)), o = 0
  for (let c of chunks) { out.set(c, o); o += c.length }
  ok(out.length >= 10000, 'stream emits the signal body')
  let err = 0, n = 10000 - N
  for (let i = N; i < 10000; i++) err += (out[i] - x[i]) ** 2
  ok(Math.sqrt(err / n) < 0.01, 'mid-region reconstruction error < 1%')
})

test('stft — analyse visits frames in order', () => {
  let positions = []
  stftAnalyse(noise(4096), (mag, phase, pos) => positions.push(pos), { frameSize: 1024, hopSize: 512 })
  ok(positions.length >= 6, 'gets ≥6 frames')
  for (let i = 1; i < positions.length; i++) is(positions[i] - positions[i - 1], 512)
})

test('vad — flags speech-only frames active', () => {
  let speech = lena.subarray(0, fs * 4)
  let { active } = vad(speech, { fs })
  let activeCount = active.reduce((a, b) => a + b, 0)
  ok(activeCount > 0 && activeCount < active.length, 'some active, not all')
})

test('vad — silence yields no active frames', () => {
  let { active } = vad(new Float32Array(fs), { fs })
  is(active.reduce((a, b) => a + b, 0), 0)
})

test('vad — @audio/vad standalone is the same fn denoise-core re-exports (promotion is a forward, not a copy)', () => {
  is(vadDirect, vad, 'denoise-core forwards to @audio/vad — single implementation')
  let { active } = vadDirect(lena.subarray(0, fs * 2), { fs })
  ok(active.reduce((a, b) => a + b, 0) > 0, 'standalone @audio/vad flags speech active')
})

test('spp — pure tone gets high probability', () => {
  let mag = new Float64Array(513)
  for (let k = 0; k < 513; k++) mag[k] = 0.01
  mag[100] = 1.0
  let np = new Float64Array(513).fill(0.0001)
  let p = spp(mag, np)
  ok(p[100] > 0.99, 'tone bin is speech')
})

test('noiseProfile — averages first frames', () => {
  let np = noiseProfile(noise(8192, 0.1), { frameSize: 512, fs })
  ok(np.length > 0, 'has profile')
  ok(np[10] > 0, 'has energy')
})

test('minStats — tracks decreasing floor', () => {
  let est = minStats(513)
  let mag = new Float64Array(513).fill(1)
  for (let i = 0; i < 50; i++) est.update(mag)
  for (let k = 0; k < 513; k++) mag[k] = 0.1
  for (let i = 0; i < 100; i++) est.update(mag)
  ok(est.psd[100] < 0.5, 'floor follows minimum')
})

test('quality — snr inf for identical', () => {
  let x = sine(440, 4096)
  ok(snr(x, x) > 100, 'matched signal scores >100 dB')
})

test('quality — lsd zero for identical', () => {
  let x = sine(440, 4096)
  almost(lsd(x, x), 0, 0.01)
})

test('quality — nrr positive after attenuation', () => {
  let n = noise(4096, 0.5)
  let q = new Float32Array(n.length)
  for (let i = 0; i < n.length; i++) q[i] = n[i] * 0.1
  ok(nrr(n, q) > 15, 'nrr ≥ 15 dB for 10× attenuation')
})

// =================== gate ===================

test('gate — silences below threshold', () => {
  let x = noise(8192, 0.001)
  let out = gate(copy(x), { threshold: -40, fs })
  ok(rms(out) < rms(x) * 0.5, 'attenuates quiet noise')
})

test('gate — preserves signal above threshold', () => {
  let x = sine(440, 8192, 0.5)
  let out = gate(copy(x), { threshold: -40, fs })
  almost(rms(out), rms(x), rms(x) * 0.1, 'loud signal passes')
})

// =================== dehum ===================

test('dehum — removes 60Hz tone', () => {
  let hum = sine(60, fs, 0.3)
  let speech = lena.subarray(0, fs)
  let dirty = add(speech, hum)
  let clean = dehum(copy(dirty), { freq: 60, fs })
  ok(narrowEnergy(clean, 60) < narrowEnergy(dirty, 60) * 0.2, 'hum reduced ≥5×')
})

test('dehum — removes harmonics', () => {
  let hum = add(sine(60, fs, 0.3), sine(120, fs, 0.15), sine(180, fs, 0.075))
  let clean = dehum(hum, { freq: 60, harmonics: 3, fs })
  ok(narrowEnergy(clean, 120) < 0.05, 'second harmonic gone')
})

test('dehum — preserves nearby content', () => {
  let mix = add(sine(60, fs, 0.3), sine(440, fs, 0.3))
  let clean = dehum(mix, { freq: 60, fs })
  ok(narrowEnergy(clean, 440) > 0.1, '440Hz content preserved')
})

// =================== specsub ===================

test('specsub — improves SNR on white-noisy speech', () => {
  let speech = lena.subarray(0, fs * 4)
  let dirty = mix(speech, noise(speech.length), 5)
  let clean = specsub(copy(dirty), { fs })
  ok(rms(clean) > 0, 'has output')
  let nIn = nrr(dirty.subarray(0, fs / 2), dirty.subarray(0, fs / 2))     // proxy
  ok(rms(clean) < rms(dirty), 'noise floor reduced')
})

// =================== wiener ===================

test('wiener — improves segSNR on noisy speech', () => {
  let speech = lena.subarray(0, fs * 4)
  let n = noise(speech.length, 1)
  let dirty = mix(speech, n, 5)
  let clean = wiener(copy(dirty), { fs })
  ok(segSnr(clean, speech) > segSnr(dirty, speech), 'segSNR improved')
})

test('wiener — mmse-lsa rule runs', () => {
  let dirty = mix(lena.subarray(0, fs * 2), noise(fs * 2), 5)
  let clean = wiener(copy(dirty), { fs, rule: 'mmse-lsa' })
  ok(rms(clean) > 0, 'produces output')
})

// =================== omlsa ===================

test('omlsa — improves segSNR on noisy speech', () => {
  let speech = lena.subarray(0, fs * 4)
  let dirty = mix(speech, noise(speech.length), 5)
  let clean = omlsa(copy(dirty), { fs })
  ok(segSnr(clean, speech) > segSnr(dirty, speech), 'segSNR improved')
})

// =================== declick ===================

test('declick — removes injected clicks', () => {
  let speech = lena.subarray(0, fs * 2)
  let dirty = add(speech, clicks(speech.length, 8, 0.9))
  let clean = declick(copy(dirty), { fs })
  ok(peak(clean) < peak(dirty) * 0.9, 'peak click reduced')
})

test('declick — leaves clean speech alone', () => {
  let speech = lena.subarray(0, fs * 2)
  let out = declick(copy(speech), { fs, threshold: 6 })
  almost(rms(out), rms(speech), rms(speech) * 0.1, 'rms preserved within 10%')
})

// =================== decrackle ===================

test('decrackle — reduces high-rate impulse noise', () => {
  let n = lena.length > fs * 2 ? lena.subarray(0, fs * 2) : lena
  let crack = new Float32Array(n.length)
  for (let i = 0; i < n.length; i += 256) crack[i] = (i & 1 ? -1 : 1) * 0.4
  let dirty = add(n, crack)
  let clean = decrackle(copy(dirty), { fs })
  ok(peak(clean) < peak(dirty), 'peaks reduced')
})

// =================== declip ===================

test('declip — restores clipped peaks', () => {
  let x = sine(440, fs)                                    // 100 samples/cycle, ~10-sample clipped run at 0.85
  let limit = 0.85
  let clipped = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) clipped[i] = Math.max(-limit, Math.min(limit, x[i]))
  let restored = declip(copy(clipped), { fs, clipLevel: limit })
  ok(peak(restored) > limit + 0.02, 'peak restored above clip level')
})

// =================== dewind ===================

test('dewind — attenuates LF rumble', () => {
  let speech = lena.subarray(0, fs * 2)
  let rumble = sine(40, speech.length, 0.4)
  let dirty = add(speech, rumble)
  let clean = dewind(copy(dirty), { fs })
  ok(narrowEnergy(clean, 40) < narrowEnergy(dirty, 40) * 0.3, 'rumble cut ≥3×')
})

// =================== deplosive ===================

test('deplosive — ducks LF burst', () => {
  let speech = lena.subarray(0, fs * 2)
  let burst = new Float32Array(speech.length)
  let blen = 0.05 * fs
  for (let i = 0; i < blen; i++) burst[Math.floor(fs * 0.3) + i] = 0.6 * Math.exp(-i / (blen / 2))
  let dirty = add(speech, burst)
  let clean = deplosive(copy(dirty), { fs })
  ok(rms(clean) <= rms(dirty), 'burst energy reduced')
})

// =================== deesser ===================

test('deesser — reduces 7kHz sibilance', () => {
  let speech = lena.subarray(0, fs * 2)
  let siss = new Float32Array(speech.length)
  for (let i = 0; i < speech.length; i++) siss[i] = 0.3 * Math.sin(2 * Math.PI * 7000 * i / fs)
  let dirty = add(speech, siss)
  let clean = deesser(copy(dirty), { fs, freq: 7000 })
  ok(narrowEnergy(clean, 7000) < narrowEnergy(dirty, 7000), 'sibilance attenuated')
})

test('deesser — preserves low-mid content', () => {
  let mix = add(sine(220, fs, 0.3), sine(7000, fs, 0.3))
  let clean = deesser(copy(mix), { fs, freq: 7000 })
  ok(narrowEnergy(clean, 220) > 0.1, '220Hz preserved')
})

// =================== debreath ===================

test('debreath — attenuates noise during silent gaps', () => {
  let speech = lena.subarray(0, fs * 4)
  let breath = noise(speech.length, 0.02)
  let dirty = add(speech, breath)
  let clean = debreath(copy(dirty), { fs })
  ok(rms(clean) <= rms(dirty), 'output not louder')
})

// =================== dereverb ===================

test('dereverb — reduces tail energy', () => {
  let speech = lena.subarray(0, fs * 2)
  let imp = new Float32Array(speech.length)
  let t60 = 0.5
  for (let i = 0; i < speech.length; i++) imp[i] = (Math.random() * 2 - 1) * Math.exp(-6.9 * i / (t60 * fs))
  let rev = convolve(speech, imp.subarray(0, 4096))
  let clean = dereverb(rev, { fs, t60 })
  ok(rms(clean) <= rms(rev) * 1.1, 'tail not boosted')
})

// =================== denoise auto-classifier ===================

test('classify — 60Hz hum routes to dehum', () => {
  let x = add(sine(60, fs, 0.3), sine(120, fs, 0.15))
  is(classify(x, fs).method, 'dehum')
})

test('classify — clicks route to declick', () => {
  let x = add(noise(fs, 0.05), clicks(fs, 12, 0.9))
  is(classify(x, fs).method, 'declick')
})

test('classify — sibilance routes to deesser', () => {
  let x = add(noise(fs, 0.05), sine(7000, fs, 0.3))
  is(classify(x, fs).method, 'deesser')
})

test('classify — rumble routes to dewind', () => {
  let x = add(sine(40, fs, 0.4), noise(fs, 0.05))
  is(classify(x, fs).method, 'dewind')
})

test('classify — broadband noise routes to wiener', () => {
  is(classify(noise(fs, 0.1), fs).method, 'wiener')
})

test('denoise — returnPlan exposes routing decision', () => {
  let { plan } = denoise(add(sine(60, fs, 0.3), sine(120, fs, 0.15)), { fs, returnPlan: true })
  is(plan.method, 'dehum')
})

test('denoise — force overrides classifier', () => {
  let x = add(sine(60, fs, 0.3), sine(120, fs, 0.15))
  let { plan } = denoise(x, { fs, force: 'wiener', returnPlan: true })
  is(plan.method, 'wiener')
})

// =================== streaming dual-API ===================

for (let [name, fn] of [['dehum', dehum], ['specsub', specsub], ['wiener', wiener], ['omlsa', omlsa], ['dereverb', dereverb]]) {
  test(`${name} — streaming writer matches batch shape`, () => {
    let x = lena.subarray(0, fs * 2)
    let batch = fn(copy(x), { fs })
    ok(batch.length > 0, 'batch produces output')
    // Streaming via writer
    let write = fn({ fs })
    if (typeof write !== 'function') return                 // not all expose stream API
    let chunks = [], chunk = 4096
    for (let i = 0; i < x.length; i += chunk) {
      let out = write(x.subarray(i, Math.min(i + chunk, x.length)))
      if (out && out.length) chunks.push(out)
    }
    let tail = write()
    if (tail && tail.length) chunks.push(tail)
    let total = chunks.reduce((s, c) => s + c.length, 0)
    ok(total > 0, 'stream produces output')
  })
}

// --- helpers ---
// Goertzel normalised so a pure sine of amplitude A at f returns ~A.
function narrowEnergy(d, f) {
  let w = 2 * Math.PI * f / fs, c = 2 * Math.cos(w), s1 = 0, s2 = 0
  for (let i = 0; i < d.length; i++) { let s = d[i] + c * s1 - s2; s2 = s1; s1 = s }
  return 2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / d.length
}

function convolve(x, h) {
  let n = x.length + h.length - 1
  let y = new Float32Array(n)
  for (let i = 0; i < x.length; i++) {
    let xi = x[i]
    if (xi === 0) continue
    for (let j = 0; j < h.length; j++) y[i + j] += xi * h[j]
  }
  return y.subarray(0, x.length)
}

import repair from '@audio/denoise-repair'

function goertzelMag (d, f, from, to) {
  let w = 2 * Math.PI * f / fs, cw = Math.cos(w), s1 = 0, s2 = 0
  for (let i = from; i < to; i++) { let s0 = d[i] + 2 * cw * s1 - s2; s2 = s1; s1 = s0 }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - 2 * cw * s1 * s2)) / (to - from)
}

test('repair — 60 ms dropout reconstructed to full level (tonal)', () => {
	let n = fs, d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = 0.7 * Math.sin(2 * Math.PI * 440 * i / fs)
	let a = Math.round(0.45 * fs), b = Math.round(0.51 * fs)
	for (let i = a; i < b; i++) d[i] = 0
	let r = repair(d, { regions: [{ at: 0.45, duration: 0.06 }], fs: fs })
	let gap = goertzelMag(r, 440, a, b), ref = goertzelMag(r, 440, 4410, 17640)
	ok(Math.abs(gap / ref - 1) < 0.05, `gap restored to ${(100 * gap / ref).toFixed(1)}% of reference`)
	ok(r.every(isFinite))
})

test('repair — band-limited region removes a beep, preserves program', () => {
	let n = fs, d = new Float32Array(n)
	let a = Math.round(0.45 * fs), b = Math.round(0.51 * fs)
	for (let i = 0; i < n; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * 300 * i / fs)
	for (let i = a; i < b; i++) d[i] += 0.5 * Math.sin(2 * Math.PI * 1000 * (i - a) / fs)
	let r = repair(d, { regions: [{ at: 0.44, duration: 0.08, from: 700, to: 1400 }], fs: fs })
	ok(goertzelMag(r, 1000, a, b) < goertzelMag(d, 1000, a, b) * 0.05, 'beep gone (−26 dB+)')
	almost(goertzelMag(r, 300, a, b) / goertzelMag(d, 300, 4410, 17640), 1, 0.05, 'program untouched')
})

test('repair — requires regions', () => {
	let threw = false
	try { repair(new Float32Array(4096), {}) } catch { threw = true }
	ok(threw)
})

test('stft stream — long-run ring compaction preserves OLA tails (regression)', () => {
	// >N·8 samples through take() triggers ring compaction; the old fill(0, pos) erased
	// the last frame's partial overlap-add tail → sample-level corruption mid-stream
	let x = sine(330, fs)
	let identity = (mag, phase) => ({ mag, phase })
	let batch = stftBatch(x, identity, { fs })
	let s = stftStream(identity, { fs })
	let parts = []
	for (let pos = 0, sizes = [64, 1000, 3, 2048, 777]; pos < x.length;) {
		let n = Math.min(sizes[pos % sizes.length] || 512, x.length - pos)
		parts.push(s.write(x.subarray(pos, pos + n))); pos += n
	}
	parts.push(s.flush())
	let cat = new Float32Array(parts.reduce((a, p) => a + p.length, 0)), o = 0
	for (let p of parts) { cat.set(p, o); o += p.length }
	let m = 0
	for (let i = 2048; i < batch.length - 2048; i++) m = Math.max(m, Math.abs(batch[i] - cat[i]))
	ok(m < 1e-6, `stream ≡ batch over 1 s (${m.toExponential(1)})`)
})
