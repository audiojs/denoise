// Test suite for noise-reduction methods.
// Synthetic generators for deterministic property tests + audio-lena for real speech.

import test, { almost, ok, is } from 'tst'
import raw from 'audio-lena/raw'
import {
  gate, dehum, specsub, wiener, omlsa, declick, decrackle, declip,
  dewind, deplosive, deesser, debreath, dereverb, denoise, classify
} from './index.js'
import { vad, spp, ddSnr } from '@audio/vad'
import { vad as vadUmbrella, minStats as minStatsUmbrella } from './index.js'
import { noiseProfile, minStats, imcra, known } from '@audio/noise-estimate'
import { processor as omlsaProcessor, frame as omlsaFrame } from '@audio/denoise-omlsa'
import { snr, segSnr, lsd, nrr, speechAttenuation } from '@audio/quality'
import { stftBatch, stftStream, stftAnalyse } from '@audio/stft'

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

// lena under pink noise (Voss-McCartney filter bank, seeded) at `snr` dB, and her loud 10 ms frames: within 20 dB of
// the loudest, speech beyond doubt. The fixture for what the speech ops must keep under noise.
function pinkNoise(n, seed = 7) {
  let s = seed >>> 0, r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296, x = new Float32Array(n), b = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    let w = r() * 2 - 1
    b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759; b[2] = 0.969 * b[2] + w * 0.153852
    b[3] = 0.8665 * b[3] + w * 0.3104856; b[4] = 0.55 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.016898
    x[i] = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362; b[6] = w * 0.115926
  }
  return x
}
function lenaInNoise(snr) {
  let x = mix(lena, pinkNoise(lena.length), snr), n = fs / 100, m = Math.floor(lena.length / n), e = new Float64Array(m)
  for (let k = 0; k < m; k++) for (let i = k * n; i < (k + 1) * n; i++) e[k] += lena[i] * lena[i]
  let top = Math.max(...e)
  return { x, n, loud: Array.from(e, v => v > top / 100) }
}

test('vad — speech under noise is speech, the noise alone is not', () => {
  // 1.x took the 10th-percentile frame energy of the whole input for the floor and wanted 11 dB over it: under noise
  // the 10th percentile is the noise, and at 5 dB SNR it heard 11 % of lena's loud frames
  let { x, n, loud } = lenaInNoise(5), { active, hop, frameSize } = vad(x, { fs }), on = 0, all = 0
  loud.forEach((l, k) => { if (!l) return; all++; on += active[Math.min(active.length - 1, Math.max(0, Math.round((k * n + n / 2 - frameSize / 2) / hop)))] })
  ok(on / all > 0.95, `loud speech frames active at 5 dB SNR: ${(100 * on / all).toFixed(1)} %`)
  let quiet = vad(pinkNoise(fs * 5, 3).map(v => 0.01 * v), { fs }).active
  is(quiet.reduce((a, b) => a + b, 0), 0, 'pink noise alone: no speech')
})

test('vad — noise alone is no speech: white, pink, brown, steady or stepping, at 16, 44.1 and 48 kHz', () => {
  // 2.0.0 took voicing from the Wiener estimate: on noise it keeps a few random bins, a sparse spectrum whose
  // autocorrelation peaks high (median 0.8). Where a level step left the floor low, the noise was present, voiced,
  // speech: on the loud side of each step down, 6-8 % of those clips
  let s = 21, r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
  let kinds = {
    white: n => Float32Array.from({ length: n }, () => r() * 2 - 1),
    pink: n => pinkNoise(n, s++),
    brown: n => { let x = new Float32Array(n), y = 0; for (let i = 0; i < n; i++) x[i] = y = 0.998 * y + (r() * 2 - 1) * 0.05; return x }
  }, bad = []
  for (let sr of [16000, 44100, 48000]) for (let [kind, make] of Object.entries(kinds)) for (let [a, b] of [[0.02, 0.02], [0.2, 0.2], [0.002, 0.002], [0.02, 0.002], [0.002, 0.02]]) {
    let n = 2 * sr, x = make(2 * n), p = 0
    for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]))
    for (let i = 0; i < x.length; i++) x[i] *= (i < n ? a : b) / p
    let on = vad(x, { fs: sr }).active.reduce((u, v) => u + v, 0)
    if (on) bad.push(`${kind} ${a} → ${b} at ${sr}: ${on} frames`)
  }
  is(bad, [], 'no frame of noise is speech')
})

test('vad — a note held past the floor window is not the floor', () => {
  // the floor is a minimum over 1.5 s: a steady sound longer than that is its own minimum, unless tones stay out of it
  let x = pinkNoise(fs * 4, 5).map(v => 0.0003 * v)
  for (let i = fs / 2, ph = 0; i < fs * 3.5; i++) { ph += 2 * Math.PI * 150 / fs; for (let h = 1; h <= 10; h++) x[i] += 0.2 * Math.sin(h * ph) / h }
  let { active, hop, frameSize } = vad(x, { fs }), mid = active.slice(Math.round((fs - frameSize / 2) / hop), Math.round((fs * 3 - frameSize / 2) / hop))
  ok(mid.every(v => v), `the held note is speech-like sound throughout its middle: ${mid.reduce((a, b) => a + b, 0)} of ${mid.length} frames`)
})

test('vad — empty, shorter than a frame, a single sample: no frames, no throw', () => {
  for (let x of [new Float32Array(0), new Float32Array(1), new Float32Array(1000).fill(0.1)]) {
    let r = vad(x, { fs })
    is(r.active.length, 0); is(r.voiced.length, 0); is(r.times.length, 0)
  }
  is(vad(lena.subarray(0, 2048), { fs }).active.length, 1, 'exactly a frame: one decision')
})

test('@audio/denoise umbrella forwards vad + noise estimation to their promoted atoms (single impl)', () => {
  is(vadUmbrella, vad, '@audio/denoise re-exports @audio/vad — one implementation')
  is(minStatsUmbrella, minStats, '@audio/denoise re-exports @audio/noise-estimate — one implementation')
  let { active } = vad(lena.subarray(0, fs * 2), { fs })
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

// mains hum: 12 harmonics at 1/h, the fundamental wandering ±dev Hz (a 20 s sine), scaled to rms r
function mainsHum(n, f0, dev, r) {
  let y = new Float32Array(n), ph = 0
  for (let i = 0; i < n; i++) { ph += 2 * Math.PI * (f0 + dev * Math.sin(2 * Math.PI * i / fs / 20)) / fs; for (let h = 1; h <= 12; h++) y[i] += Math.cos(h * ph + h) / h }
  let g = r / rms(y)
  return y.map(v => v * g)
}
function sumsq(d) { let s = 0; for (let v of d) s += v * v; return s }

// 0.2.0 notched at Q 30 the few harmonics that stood out from speech: hum 6 dB down, speech SDR 23 dB here
test('dehum — wandering hum under speech: removed, the speech kept', () => {
  let x = lena.subarray(0, fs * 8), h = mainsHum(x.length, 50.05, 0.02, rms(x) / 10)
  // phase inversion (Hagerman & Olofsson 2004): what became of the hum and of the speech, apart
  let yp = dehum(x.map((v, i) => v + h[i]), { fs }), ym = dehum(x.map((v, i) => v - h[i]), { fs })
  let down = 10 * Math.log10(sumsq(h) / sumsq(yp.map((v, i) => (v - ym[i]) / 2)))
  let sdr = 10 * Math.log10(sumsq(x) / sumsq(yp.map((v, i) => (v + ym[i]) / 2 - x[i])))
  ok(down > 35, `hum 20 dB under, ±0.02 Hz: ${down.toFixed(1)} dB down`)
  ok(sdr > 33, `speech SDR ${sdr.toFixed(1)} dB`)
})

// a Q 30 notch at 100.1 Hz is 3.3 Hz wide: it took 2 dB of a G2 2 Hz away
test('dehum — a note 2 Hz from a line is left to the program', () => {
  let n = fs * 6, x = new Float32Array(n)
  for (let i = 0; i < n; i++) for (let k = 1; k <= 4; k++) x[i] += 0.2 / k * Math.sin(2 * Math.PI * 98 * k * i / fs + k)
  let h = mainsHum(n, 50.05, 0, rms(x) / 10), y = dehum(x.map((v, i) => v + h[i]), { fs })
  // Hann-windowed DFT over the middle 4 s: the note's leakage stays off the line
  let at = (d, f) => { let re = 0, im = 0; for (let i = fs; i < n - fs; i++) { let w = 1 - Math.cos(2 * Math.PI * (i - fs) / (n - 2 * fs)); re += w * d[i] * Math.cos(2 * Math.PI * f * i / fs); im += w * d[i] * Math.sin(2 * Math.PI * f * i / fs) } return Math.hypot(re, im) }
  let kept = 20 * Math.log10(at(y, 98) / at(x, 98)), down = 20 * Math.log10(at(h, 100.1) / at(y, 100.1))
  ok(Math.abs(kept) < 0.3, `G2 at 98 Hz: ${kept.toFixed(2)} dB`)
  ok(down > 25, `the 100.1 Hz line beside it: ${down.toFixed(1)} dB down`)
})

test('dehum — hum alone, wandering ±0.05 Hz: tracked', () => {
  let h = mainsHum(fs * 20, 59.95, 0.05, 0.05), down = 10 * Math.log10(sumsq(h) / sumsq(dehum(copy(h), { fs })))
  ok(down > 35, `${down.toFixed(1)} dB down (0.2.0: 22)`)
})

// a bar repeated exactly is a comb of lines 1/bar apart: at 120 bpm every 2 Hz, 50 and 60 Hz among them
test('dehum — a loop is no hum, nor a chord beside the series; speech passes untouched', async () => {
  let { measure } = await import('@audio/denoise-dehum')
  let r = 1, rnd = () => (r = r * 16807 % 2147483647) / 2147483647, bar = new Float32Array(fs / 2)
  for (let i = 0; i < bar.length; i++) bar[i] = 0.3 * Math.exp(-i / 2000) * Math.sin(2 * Math.PI * 52 * i / fs) + 0.05 * (rnd() - 0.5)
  let loop = Float32Array.from({ length: fs * 30 }, (_, i) => bar[i % bar.length])
  let chord = new Float32Array(fs * 4)
  for (let i = 0; i < chord.length; i++) for (let f of [98, 146.83, 196]) chord[i] += 0.2 * Math.sin(2 * Math.PI * f * i / fs)
  for (let [name, x] of [['loop', loop], ['G2 D3 G3', chord], ['speech', lena.subarray(0, fs * 4)]])
    ok(!measure(x, fs) && dehum(copy(x), { fs }).every((v, i) => v === x[i]), `${name}: untouched`)
})

test('dehum — edges: empty, a sample, silence, half a second as told, NaN', async () => {
  let { measure } = await import('@audio/denoise-dehum')
  is(dehum(new Float32Array(0), { fs }).length, 0, 'empty')
  is(dehum(new Float32Array([0.5]), { fs, freq: 50 })[0], 0.5, 'one sample: too short to fit, untouched')
  ok(dehum(new Float32Array(fs * 2), { fs }).every(v => v === 0), 'silence')
  let s = mainsHum(fs / 2, 60, 0, 0.1), down = 10 * Math.log10(sumsq(s) / sumsq(dehum(copy(s), { fs, freq: 60 })))
  ok(down > 20, `0.5 s, freq 60 as told: ${down.toFixed(1)} dB down`)
  let t = mainsHum(fs * 3, 50, 0, 0.1); t[fs] = NaN
  ok(dehum(copy(t), { fs, freq: 50, harmonics: 12 }).every((v, i) => i === fs || Number.isFinite(v)), 'a NaN stays one sample')
  is(measure(t, fs), null, 'measure over a NaN: null')
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

// α = 0.98 is Ephraim & Malah's for an 8 ms frame step (1984 §VI) and was applied per frame, 10.7 ms at 48 kHz. On a
// learned profile the gain is the LSA rule on ξ = α^(Δt/8 ms) Â²(l−1)/λ + (1 − α^(Δt/8 ms)) max(γ − 1, 0), written out
test('wiener: the decision-directed α is per 8 ms, rescaled to the frame step', () => {
  let sr = 48000, N = 2048, hop = 512, o = { fs: sr, frameSize: N, hopSize: hop }, a = 0.98 ** (hop / sr / 0.008)
  let x = gauss(sr * 2, 0.01).map((v, i) => v + 0.1 * Math.sin(2 * Math.PI * 440 * i / sr) * (i > sr)), profile = noiseProfile(x, { to: sr, frameSize: N, hopSize: hop })
  // E1 by its series (Abramowitz & Stegun 5.1.11), apart from the kernel's rational approximation
  let e1 = v => { if (v > 30) return 0; let s = 0, t = 1; for (let k = 1; k < 200; k++) { t *= -v / k; s += t / k } return -0.5772156649015329 - Math.log(v) - s }
  let eta = new Float64Array(N / 2 + 1).fill(1)
  let ref = stftBatch(x, (mag, phase) => {
    for (let k = 0; k <= N / 2; k++) {
      let g = mag[k] ** 2 / profile[k], xi = Math.max(10 ** -1.5, a * eta[k] + (1 - a) * Math.max(g - 1, 0))
      let G = xi / (1 + xi) * Math.exp(0.5 * e1(xi * g / (1 + xi)))
      eta[k] = G * G * g; mag[k] *= G
    }
    return { mag, phase }
  }, o)
  let y = wiener(x, { ...o, profile }), d = 0
  for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(y[i] - ref[i]))
  ok(d < 1e-6, `α = 0.98^(Δt/8 ms) = ${a.toFixed(4)}: max deviation ${d.toExponential(1)} (signal peak 0.15)`)
})

// =================== omlsa ===================

test('omlsa — improves segSNR on noisy speech', () => {
  let speech = lena.subarray(0, fs * 4)
  let dirty = mix(speech, noise(speech.length), 5)
  let clean = omlsa(copy(dirty), { fs })
  ok(segSnr(clean, speech) > segSnr(dirty, speech), 'segSNR improved')
})

// Syllables after pauses: 120 Hz pulses through formants at 700 and 1200 Hz, rising and falling over 50 ms, 250 ms
// each, 300 ms apart, from 1 s; white Gaussian noise `snrDb` under the syllables' level
function afterPauses(sr, snrDb = 0) {
  let n = 4 * sr, s = new Float32Array(n), on = [], y1 = 0, y2 = 0, z1 = 0, z2 = 0, P = Math.round(sr / 120)
  for (let t = sr; t + 0.25 * sr < n; t += Math.round(0.55 * sr)) on.push(t)
  for (let i = 0; i < n; i++) {
    let t0 = on.find(t => i >= t && i < t + 0.25 * sr), e = t0 != null && i % P === 0 ? Math.min(1, (i - t0) / (0.05 * sr), (t0 + 0.25 * sr - i) / (0.05 * sr)) : 0
    let y = e + 2 * Math.cos(2 * Math.PI * 700 / sr) * 0.97 * y1 - 0.9409 * y2; y2 = y1; y1 = y
    let z = y + 2 * Math.cos(2 * Math.PI * 1200 / sr) * 0.95 * z1 - 0.9025 * z2; z2 = z1; z1 = z
    s[i] = 0.02 * z
  }
  let p = 0; for (let v of s) p += v * v
  let nz = gauss(n, Math.sqrt(p / (on.length * 0.25 * sr) / 10 ** (snrDb / 10)), 3)
  return { s, on, y: s.map((v, i) => v + nz[i]) }
}
// a frame process's gain on y, frame by frame, on @audio/stft's frames
function frameGains(proc, y, o) { let G = []; stftBatch(y, (m, p) => { let m0 = Float64Array.from(m), r = proc(m, p); G.push(Float64Array.from(m0, (v, k) => v > 0 ? r.mag[k] / v : 1)); return r }, o); return G }

// The decision-directed α is quoted per 8 ms frame (Cohen & Berdugo 2001 Table 1, Ephraim & Malah 1984 §VI) and was
// applied per frame: at 48 kHz (10.7 ms frames) the a priori SNR's memory ran 1.8× longer than at 44.1 kHz (5.8 ms)
test('known, imcra: the decision-directed α is per 8 ms, rescaled to the frame step as the other time constants', () => {
  let sr = 48000, N = 2048, hop = 512, x = gauss(sr, 0.01).map((v, i) => v + 0.2 * Math.sin(2 * Math.PI * 440 * i / sr) * (i > sr / 2))
  let profile = noiseProfile(gauss(sr, 0.01, 11), { frameSize: N, hopSize: hop, to: sr }), a = 0.92 ** (hop / sr / 0.008)
  let est = known(profile, { fs: sr, hop, alphaDD: 0.92 }), eta = new Float64Array(N / 2 + 1).fill(1), worst = 0
  stftAnalyse(x, mag => {
    est.update(mag)
    for (let k = 0; k <= N / 2; k++) {
      let g = mag[k] ** 2 / profile[k], xi = Math.max(a * eta[k] + (1 - a) * Math.max(g - 1, 0), 10 ** -2.5)
      worst = Math.max(worst, Math.abs(est.xi[k] - xi) / xi)
      eta[k] = est.gain[k] ** 2 * g
    }
  }, { frameSize: N, hopSize: hop })
  ok(worst < 1e-9, `known: ξ with α = 0.92^(Δt/8 ms) = ${a.toFixed(4)}, worst relative error ${worst.toExponential(1)}`)
  let m = imcra(N / 2, { fs: sr, hop, alphaDD: 0.92 }), worst2 = 0, e2 = null
  stftAnalyse(x, mag => {
    let prev = Float64Array.from(m.psd)
    m.update(mag)
    if (e2) for (let k = 0; k <= N / 2; k++) {                // ξ on the previous estimate, for this frame's p
      let g = mag[k] ** 2 / prev[k], xi = Math.max(a * e2[k] + (1 - a) * Math.max(g - 1, 0), 10 ** -2.5)
      worst2 = Math.max(worst2, Math.abs(m.xi0[k] - xi) / xi)
    }
    e2 = Float64Array.from(m.gain, (G, k) => G * G * m.gamma[k])
  }, { frameSize: N, hopSize: hop })
  ok(worst2 < 1e-9, `imcra: the same α, worst relative error ${worst2.toExponential(1)}`)
})

// G = G_H1^p G_min^(1−p) (eq. 16) dips below G_min where G_H1 does (to −18 dB at G_min −12). G_H1 floored at G_min:
// a bin where speech may be present goes no further down than one where it is absent
test('omlsa: G_min is the floor, tracked and on a learned noise', () => {
  let sr = 48000, N = omlsaFrame(sr), o = { fs: sr, frameSize: N, hopSize: N / 4 }, { y } = afterPauses(sr, 5)
  for (let [name, opts, gMin] of [['tracked', {}, -15], ['learned', { profile: noiseProfile(y, { to: sr, frameSize: N, hopSize: N / 4 }), gMin: -12 }, -12]]) {
    let lo = Infinity
    for (let g of frameGains(omlsaProcessor({ ...o, ...opts }), y, o)) for (let v of g) lo = Math.min(lo, v)
    ok(20 * Math.log10(lo) > gMin - 1e-6, `${name}: lowest gain ${(20 * Math.log10(lo)).toFixed(2)} dB, G_min ${gMin} dB`)
  }
})

// ξ trails a word's start after a pause; with α 0.98 per frame (per 10.7 ms at 48 kHz) a syllable's first 50 ms lost
// 6.3 dB tracked and 8.5 on the learned noise, at 0 dB SNR
test('omlsa: a syllable\'s first 50 ms after a pause is kept, tracked and on a learned noise', () => {
  let sr = 48000, N = omlsaFrame(sr), o = { fs: sr, frameSize: N, hopSize: N / 4 }, { s, y, on } = afterPauses(sr, 0)
  for (let [name, opts, least] of [['tracked', {}, -4], ['learned', { profile: noiseProfile(y, { to: sr, frameSize: N, hopSize: N / 4 }), gMin: -12 }, -2.5]]) {
    let G = frameGains(omlsaProcessor({ ...o, ...opts }), y, o), l = 0, a = 0, b = 0
    stftBatch(s, (mag, phase, st, ctx) => {
      let c = ctx.pos + N / 2                              // the frame's centre
      if (on.some(t => c >= t && c < t + 0.05 * sr)) for (let k = 0; k <= N / 2; k++) { a += mag[k] ** 2; b += (mag[k] * G[l][k]) ** 2 }
      l++
      return { mag, phase }
    }, o)
    let kept = 10 * Math.log10(b / a)
    ok(kept > least, `${name}: speech kept in the first 50 ms, ${kept.toFixed(2)} dB`)
  }
})

// Clean speech (syllables 60 dB over a room tone) comes back as it went in; degenerate input comes back finite, its length
test('omlsa, wiener, specsub: clean speech kept; empty, one-sample, sub-frame, silent input', () => {
  let ops = sr => [['omlsa', x => omlsa(x, { fs: sr })], ['omlsa learned', x => omlsa(x, { fs: sr, profileFrom: 0, profileTo: sr / 2, gMin: -12 })],
    ['wiener', x => wiener(x, { fs: sr })], ['specsub', x => specsub(x, { fs: sr })]]
  for (let sr of [44100, 48000]) {
    let { s, y } = afterPauses(sr, 60)
    for (let [name, op] of ops(sr)) {
      let out = op(copy(y)), e = 0, p = 0
      for (let i = 0; i < y.length; i++) { e += (out[i] - y[i]) ** 2; p += y[i] ** 2 }
      ok(10 * Math.log10(p / e) > 45, `${name} at ${sr} Hz: clean speech back at ${(10 * Math.log10(p / e)).toFixed(1)} dB SNR`)
    }
  }
  for (let [name, op] of ops(fs)) for (let [what, x] of [['empty', new Float32Array(0)], ['one sample', Float32Array.of(0.5)],
    ['100 samples', Float32Array.from({ length: 100 }, (_, i) => Math.sin(i))], ['silence', new Float32Array(fs)]]) {
    let out = op(copy(x))
    ok(out.length === x.length && out.every(Number.isFinite) && (what !== 'silence' || out.every(v => v === 0)), `${name}, ${what}`)
  }
})

// minStats keeps each bin's minimum over the last D frames by monotonic deque; the rescan it replaced is the reference,
// and once the window is full its mean the cap (a running sum, re-added once a window). Windows of 1, 3 and 96 frames,
// fewer frames than the window, repeated values, minima falling and rising. Frames of digital silence (every 37th
// frame starts five) are skipped; the smoother starts as the mean of the frames with sound so far, and enters the
// minimum from its 5th frame (its memory, 1/(1−α) = 3.3 frames, full), the mean standing for the estimate until then.
test('minStats — the D-frame minimum equals a rescan of the last D frames', () => {
  let seed = 5, rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let [half, D, frames] of [[64, 96, 300], [16, 1, 50], [16, 3, 200], [64, 96, 20]]) {
    let est = minStats(half, { D }), smoothed = new Float64Array(half + 1), hist = [], seen = 0, bad = 0
    for (let f = 0; f < frames; f++) {
      let mag = Float64Array.from({ length: half + 1 }, () => f % 37 < 5 ? 0 : rnd() < 0.1 ? 1 : rnd() * (1 + (f % 300) / 30))
      est.update(mag)
      if (f % 37 >= 5) { let a = Math.min(0.7, seen / (seen + 1)); seen++; hist.push(Float64Array.from(mag, (m, k) => smoothed[k] = a * smoothed[k] + (1 - a) * (m * m))) }
      if (hist.length > D) hist.shift()
      let mins = hist.slice(Math.max(0, hist.length - (seen - 4)))      // the frames that entered the minimum
      for (let k = 0; k <= half; k++) {
        let m = mins.length ? Math.min(...mins.map(p => p[k])) * est.bias : smoothed[k], mean = hist.reduce((a, p) => a + p[k], 0) / D
        let ref = mins.length && hist.length === D ? Math.min(m, mean) : m   // a full window caps it at its mean
        if (Math.abs(est.psd[k] - ref) > 1e-12 * ref) bad++
      }
    }
    is(bad, 0, `${half + 1} bins, D ${D}, ${frames} frames`)
  }
})

// =================== speech denoisers: references and properties ===================

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// scripts/reference.py's signal(): 'speech in noise' at 8 kHz in arithmetic only, so both languages make the same
// doubles. Park–Miller uniforms summed 12 at a time; noise ×3 from 1.5 s; four syllables of a 125 Hz pulse train
// through two resonators (formants near 600 Hz and 1.6 kHz).
function refSignal(n = 20000) {
  let seed = 1, x = new Float32Array(n), y1 = 0, y2 = 0, z1 = 0, z2 = 0
  let seg = [[2000, 5000], [7000, 10000], [13000, 15000], [16500, 19000]]
  for (let i = 0; i < n; i++) {
    let g = 0
    for (let j = 0; j < 12; j++) { seed = seed * 16807 % 2147483647; g += seed / 2147483647 }
    let e = 0
    for (let [s, t] of seg) if (s <= i && i < t && i % 64 === 0) e = Math.min(1, (i - s) / 400, (t - i) / 400)
    let y = e + 1.6 * y1 - 0.81 * y2; y2 = y1; y1 = y
    let z = y + 0.5 * z1 - 0.64 * z2; z2 = z1; z1 = z
    x[i] = 0.1 * z + (g - 6) * (i < 12000 ? 0.01 : 0.03)
  }
  return x
}
// white Gaussian (Irwin–Hall) noise, reproducible
function gauss(n, amp = 1, seed = 7) {
  let d = new Float32Array(n), rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647
  for (let i = 0; i < n; i++) { let s = -6; for (let j = 0; j < 12; j++) s += rnd(); d[i] = amp * s }
  return d
}
// the installed @audio/stft's first frame: hop − N over the input's mirror image (2.0.0 on), or 0 before
function stftFirst(N, hop) {
  let p0; stftBatch(new Float32Array(N), (mag, phase, s, c) => (p0 ??= c.pos, { mag, phase }), { frameSize: N, hopSize: hop })
  return p0 ?? 0
}

// fixtures/reference.json: numpy references written from the papers (scripts/reference.py). Its IMCRA reproduces
// Cohen's own omlsa.m to the last bit on 16 kHz VoiceBank frames, so these hold the JS to the published algorithms.
test('imcra, omlsa, wiener, specsub: equal their numpy references (Cohen 2003, Cohen & Berdugo 2001, Ephraim & Malah 1984/85, Berouti 1979, Martin 2001)', () => {
  let fx = JSON.parse(readFileSync(new URL('./fixtures/reference.json', import.meta.url)))
  let x = refSignal(), { fs: sr, frameSize: N, hopSize: hop, step, rms: r } = fx
  let est = imcra(N / 2), f = 0, worst = 0
  stftAnalyse(x, mag => {
    est.update(mag)
    let i = fx.imcra.frames.indexOf(f++)
    if (i >= 0) fx.imcra.bins.forEach((k, j) => { worst = Math.max(worst, Math.abs(est.psd[k] / fx.imcra.psd[i][j] - 1)) })
  }, { frameSize: N, hopSize: hop })
  ok(worst < 1e-6, `imcra: noise track within ${worst.toExponential(1)} of the reference`)
  let dev = (y, ref) => ref.reduce((m, v, i) => Math.max(m, Math.abs(y[i * step] - v)), 0) / r
  let o = { fs: sr, frameSize: N, hopSize: hop }, ms = { ...o, estimator: { D: 96 } }, bx = fx.batch[stftFirst(N, hop) < 0 ? 'reflect' : 'zero']
  for (let [name, y, ref] of [
    ['omlsa', omlsa(x, { ...o, ...fx.omlsaOpts }), bx.omlsa],
    ['wiener (LSA rule)', wiener(x, ms), bx.wiener],
    ['wiener (Wiener rule)', wiener(x, { ...ms, rule: 'wiener' }), bx.wienerRule],
    ['specsub', specsub(x, ms), bx.specsub],
  ]) { let d = dev(y, ref); ok(d < 1e-5, `${name}: output within ${d.toExponential(1)} of the RMS`) }
  for (let [key, v] of Object.entries(fx.biasMin)) {
    let [D, alpha] = key.split('/').map(Number)
    almost(minStats(8, { D, alpha }).bias, v, 1e-12, `B_min(${D}, ${alpha}) = ${v.toFixed(3)}, Martin 2001 eq. (17)`)
  }
})

test('minStats: unbiased on white noise; starts at the first frame; skips digital silence', () => {
  // B_min puts the mean estimate 0.2 dB under the noise power (the constant 1.5 it replaced left it 3.8 dB under); the cap
  // at the window's mean takes 0.35 dB more, where P_min·B_min spreads over the mean
  let x = gauss(48000 * 20), est = minStats(1024), f = 0, sum = 0, cnt = 0
  stftAnalyse(x, mag => { est.update(mag); if (f++ > 200) { for (let k = 10; k < 1000; k++) sum += est.psd[k]; cnt += 990 } }, { frameSize: 2048, hopSize: 512 })
  let db = 10 * Math.log10(sum / cnt / 768)                        // E|Y|² = σ² Σw² = 768 for unit white noise, Hann 2048
  ok(Math.abs(db) < 0.7, `mean estimate ${db.toFixed(2)} dB re the noise power`)
  let e = minStats(8), m = new Float64Array(9).fill(2)
  e.update(m)
  almost(e.psd[3], 4, 1e-9, 'first frame: its own power, no warm-up from zero')
  e.update(new Float64Array(9)); e.update(new Float64Array(9))
  almost(e.psd[3], 4, 1e-9, 'digital silence leaves the estimate as it was')
})

// A lone periodogram value swings over 2 degrees of freedom: started on it, the smoother put 1 % of bins 20 dB low, and
// the minimum held them there for the window's length (white noise, wiener's 1.5 s window at 48 kHz: 2.6 % of bins
// 10 dB under over the first 1.5 s). Started on the mean of the frames so far, it enters the minimum once its memory is full
test('minStats: the first frames do not hold the estimate down for a window', () => {
  let sr = 48000, N = 2048, hop = 512, D = Math.round(1.5 * sr / hop), low = 0, all = 0
  for (let seed of [1, 2, 3]) {
    let est = minStats(N / 2, { D }), l = 0
    stftAnalyse(gauss(sr * 2, 1, seed), mag => { est.update(mag); if (l++ < D) for (let k = 10; k < 1000; k++) { all++; if (est.psd[k] < 768 / 10) low++ } }, { frameSize: N, hopSize: hop })
  }
  ok(low / all < 0.005, `${(100 * low / all).toFixed(2)} % of bins 10 dB under the noise power over the first ${D} frames`)
})

// A steady line (a whine, a pilot tone) hardly swings: its minimum is its mean, and B_min put it 6.5 dB over in
// wiener's window (1024/256 frames at 44.1 kHz, D 258). The LSA gain's floor passes √(ξ_min λ), so the line came
// through 6 dB louder than on its learned profile, and denoise() on speech + 7 kHz line + white noise fell from
// 13.3 dB SNR (wiener 0.1's learned profile) to 7.8. The window's mean caps the estimate: the line as if learned.
test('minStats: a steady line is estimated at its power, not B_min over it; wiener takes it down as if learned', () => {
  let N = 1024, hop = 256, D = Math.round(1.5 * fs / hop), n = fs * 4, k0 = Math.round(7000 * N / fs), o = { frameSize: N, hopSize: hop }
  let speech = lena.subarray(0, n), line = sine(7000, n, 0.3), x = add(speech, line, gauss(n, 0.01))
  let psd = y => { let p = new Float64Array(N / 2 + 1), c = 0; stftAnalyse(y, m => { for (let k = 0; k <= N / 2; k++) p[k] += m[k] ** 2; c++ }, o); return p.map(v => v / c) }
  let est = minStats(N / 2, { D }), p = psd(line), worst = 0
  stftAnalyse(x, m => est.update(m), o)
  for (let k = k0 - 2; k <= k0 + 2; k++) worst = Math.max(worst, Math.abs(10 * Math.log10(est.psd[k] / p[k])))
  ok(worst < 0.5, `the line's 5 bins within ${worst.toFixed(2)} dB of its power (B_min put them 6.5 over)`)
  let amp = y => { let re = 0, im = 0; for (let i = 2 * fs; i < n; i++) { re += y[i] * Math.cos(2 * Math.PI * 7000 * i / fs); im += y[i] * Math.sin(2 * Math.PI * 7000 * i / fs) } return 20 * Math.log10(2 * Math.hypot(re, im) / (n - 2 * fs)) }
  let tracked = amp(wiener(copy(x), { fs })), learned = amp(wiener(copy(x), { fs, profile: psd(add(line, gauss(n, 0.01, 99))) }))
  ok(Math.abs(tracked - learned) < 0.5, `line left ${tracked.toFixed(1)} dBFS tracked, ${learned.toFixed(1)} on its learned profile (was 6 dB over)`)
  // forced: the line holds through the voice's pauses, as a held note would, so classify() can't call it a defect
  let { out, plan } = denoise(copy(x), { fs, force: 'wiener', returnPlan: true }), s = snr(speech, out)
  ok(plan.method === 'wiener' && s > 10, `denoise({ force: 'wiener' }): SNR ${s.toFixed(1)} dB (7.8 before)`)
})

test('imcra: unbiased on white noise; digital silence is skipped; a 12 dB step is followed within two windows', () => {
  let sr = 16000, N = 512, hop = 128, x = gauss(sr * 8, 0.01)
  for (let i = sr * 3; i < sr * 3.5; i++) x[i] = 0                  // an edited-out pause
  for (let i = sr * 5; i < x.length; i++) x[i] *= 4                  // the room gets 12 dB louder
  let est = imcra(N / 2, { fs: sr, hop }), track = []
  stftAnalyse(x, mag => { est.update(mag); let s = 0; for (let k = 10; k < 250; k++) s += est.psd[k]; track.push(s / 240) }, { frameSize: N, hopSize: hop })
  let at = t => 10 * Math.log10(track[Math.round(t * sr / hop)] / (0.01 ** 2 * 3 * N / 8))   // E|Y|² = σ² · 3N/8
  ok(Math.abs(at(2.9)) < 1, `before the pause: ${at(2.9).toFixed(2)} dB re the noise`)
  ok(Math.abs(at(3.6)) < 1, `right after the pause: ${at(3.6).toFixed(2)} dB (digital silence learned nothing)`)
  ok(Math.abs(at(7.9) - 12) < 1, `2.9 s after the step: ${at(7.9).toFixed(2)} dB (+12; IMCRA lags up to two ~1 s minimum windows)`)
})

// dehum measures before it notches: nothing without hum, the measured series and frequency with it
test('dehum: speech without hum comes back untouched; 50 and 60 Hz hum with harmonics is measured and removed', async () => {
  let { measure } = await import('@audio/denoise-dehum')
  let speech = lena.subarray(0, fs * 4), out = dehum(copy(speech), { fs })
  ok(out.every((v, i) => v === speech[i]), 'lena, no hum: output equals input')
  // 12 harmonics at −6 dB per octave, 0.05 Hz off nominal
  let hum = (f0, n) => { let y = new Float32Array(n); for (let i = 0; i < n; i++) for (let h = 1; h <= 12; h++) y[i] += Math.sin(2 * Math.PI * h * f0 * i / fs + h) / h; return y }
  for (let f0 of [50.05, 59.95]) {
    let h = hum(f0, fs * 4), m = measure(add(speech, h.map(v => v * 0.005)), fs)
    ok(m && Math.abs(m.f0 - f0) < 0.02, `under speech: ${f0} Hz hum measured at ${m?.f0.toFixed(3)} Hz, harmonics ${m?.harmonics}`)
    let y = dehum(copy(h), { fs }), after1s = a => rms(a.subarray(fs))
    let db = 20 * Math.log10(after1s(h) / after1s(y))
    ok(db > 30, `${f0} Hz hum alone: ${db.toFixed(1)} dB down`)
  }
})

// Musical noise is isolated spectral peaks left in the residual: a heavier-tailed power distribution. Its measure is
// the kurtosis ratio of the power spectral values, out over in (Uemura et al., IWAENC 2008; Miyazaki et al., IEEE
// TASLP 20(7), 2012); a gain that only scales the noise keeps it at 1.
test('omlsa: stationary noise alone: brought down by G_min, no musical noise', () => {
  let n = gauss(fs * 6, 0.01), y = omlsa(copy(n), { fs })
  let stats = x => { let s1 = 0, s2 = 0, c = 0; stftAnalyse(x.subarray(fs * 2), mag => { for (let k = 4; k < 1000; k++) { let p = mag[k] * mag[k]; s1 += p; s2 += p * p; c++ } }, { frameSize: 2048, hopSize: 512 }); return { k: s2 * c / (s1 * s1), p: s1 / c } }
  let a = stats(n), b = stats(y), lk = Math.log(b.k / a.k), down = 10 * Math.log10(a.p / b.p)
  ok(Math.abs(lk) < 0.1, `log kurtosis ratio ${lk.toFixed(3)} (2 s on, trackers settled)`)
  ok(Math.abs(down - 15) < 0.5, `noise down ${down.toFixed(1)} dB, G_min 15 dB`)
})

// 10 VoiceBank+DEMAND test utterances (Valentini-Botinhao 2017, CC BY 4.0) when ~/.cache/audiojs/data/vbdemand holds
// them (scripts/speech.mjs says where from); not committed. Guards what scripts/speech.py measured on all 824.
const VB = path.join(os.homedir(), '.cache', 'audiojs', 'data', 'vbdemand')
test('omlsa, wiener, specsub: 10 VoiceBank+DEMAND utterances: SI-SDR up from the noisy input, clean speech kept', { skip: !existsSync(path.join(VB, 'clean_testset_wav')), timeout: 300000 }, () => {
  let read = f => { let b = readFileSync(f), o = 12; while (b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4); let n = b.readUInt32LE(o + 4) / 2, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = b.readInt16LE(o + 8 + 2 * i) / 32768; return x }
  let sisdr = (r, e) => {                                          // Le Roux et al., ICASSP 2019, eq. 3, zero-mean
    let mr = 0, me = 0, d = 0, rr = 0, t = 0, u = 0
    for (let i = 0; i < r.length; i++) { mr += r[i] / r.length; me += e[i] / r.length }
    for (let i = 0; i < r.length; i++) { d += (e[i] - me) * (r[i] - mr); rr += (r[i] - mr) ** 2 }
    for (let i = 0; i < r.length; i++) { let a = d / rr * (r[i] - mr), b = e[i] - me - a; t += a * a; u += b * b }
    return 10 * Math.log10(t / u)
  }
  let names = readdirSync(path.join(VB, 'clean_testset_wav')).filter(f => f.endsWith('.wav')).sort().filter((_, i) => i % 82 === 0)
  for (let [name, fn, gain] of [['omlsa', omlsa, 4], ['wiener', wiener, 4], ['specsub', specsub, 3]]) {
    let up = 0, kept = Infinity
    for (let f of names) {
      let c = read(path.join(VB, 'clean_testset_wav', f)), x = read(path.join(VB, 'noisy_testset_wav', f))
      up += (sisdr(c, fn(x, { fs: 48000 })) - sisdr(c, x)) / names.length
      kept = Math.min(kept, sisdr(c, fn(c, { fs: 48000 })))
    }
    ok(up > gain, `${name}: SI-SDR +${up.toFixed(2)} dB over the noisy input`)
    ok(kept > 14, `${name}: clean speech through it, worst SI-SDR ${kept.toFixed(1)} dB`)
  }
})

// =================== declick ===================

test('declick — removes injected clicks', () => {
  let speech = lena.subarray(0, fs * 2)
  let dirty = add(speech, clicks(speech.length, 8, 0.9))
  let clean = declick(copy(dirty), { fs })
  ok(peak(clean) < peak(dirty) * 0.9, 'peak click reduced')
})

// a tick as a stylus reads one: an impulse ringing at 5 kHz, decaying in 0.2 ms, at 5× the speech around it
// (scripts/declick.js measures the kinds and sizes)
function ticks(x, every = 0.3) {
  let d = copy(x), at = []
  for (let t = Math.round(0.25 * fs); t < x.length - 0.25 * fs; t += Math.round(every * fs)) {
    let s = 0; for (let i = t - 441; i < t + 441; i++) s += x[i] * x[i]
    let level = Math.sqrt(s / 882), tau = 0.2 * fs / 1000
    for (let n = 0; n < 5 * tau; n++) d[t + n] += 5 * level * Math.exp(-n / tau) * Math.cos(2 * Math.PI * 5000 * n / fs)
    at.push(t)
  }
  return { d, at }
}
const err = (x, y, a, b) => { let s = 0; for (let i = a; i < b; i++) s += (x[i] - y[i]) ** 2; return s }

test('declick — a ringing tick, not only its onset', () => {
  let speech = lena.subarray(0, fs * 3), { d, at } = ticks(speech)
  let out = declick(copy(d), { fs }), before = 0, after = 0
  for (let t of at) before += err(d, speech, t - 44, t + 88), after += err(out, speech, t - 44, t + 88)
  ok(10 * Math.log10(before / after) > 12, `the ticks' error ${(10 * Math.log10(before / after)).toFixed(1)} dB down`)
})

test('declick — leaves clean speech alone', () => {
  let speech = lena.subarray(0, fs * 2)
  let out = declick(copy(speech), { fs })
  is([...out].findIndex((v, i) => v !== speech[i]), -1, 'not a sample changed')
})

test('declick — regions: the clicks there and nothing else', () => {
  let speech = lena.subarray(0, fs * 3), { d, at } = ticks(speech)
  let t = at[2], out = declick(copy(d), { fs, regions: [{ at: (t - 200) / fs, duration: 600 / fs }] })
  ok(err(out, speech, t - 44, t + 88) < err(d, speech, t - 44, t + 88) / 10, 'the tick in the region gone')
  let moved = []; for (let i = 0; i < d.length; i++) if (out[i] !== d[i]) moved.push(i)
  ok(moved[0] >= t - 200 - 64 && moved.at(-1) < t + 400 + 64, `changed only around it (${moved[0]}–${moved.at(-1)})`)
  is([...declick(copy(d), { fs, regions: [] })].findIndex((v, i) => v !== d[i]), -1, 'no region: none touched')
})

test('declick — a sound shorter than its window', () => {
  let x = new Float32Array(600)
  for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / fs)
  x[300] += 0.8
  let out = declick(copy(x), { fs })
  ok(out.every(Number.isFinite) && Math.abs(out[300] - 0.3 * Math.sin(2 * Math.PI * 440 * 300 / fs)) < 0.1, 'repaired')
  is(declick(new Float32Array(8), { fs }).length, 8, 'shorter than the model')
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

// crackle as scripts/decrackle.js makes it: impulses at Poisson times, `rate` a second, half 1–3 samples off, half ticks
// ringing at 2–8 kHz for 0.03–0.15 ms, peaking at A/5–A × the sound's RMS
function crackle(x, rate, A, seed = 1) {
  let s = seed, r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296, d = copy(x), g = rms(x)
  for (let at = 0; ; ) {
    at += Math.max(1, Math.round(-Math.log(r() || 1e-9) / rate * fs))
    if (at > x.length - 64) break
    let amp = g * A * 5 ** -r() * (r() < 0.5 ? -1 : 1), h
    if (r() < 0.5) h = Array.from({ length: 1 + Math.floor(r() * 3) }, () => 1 - r() * 0.3)
    else { let f = 2000 + r() * 6000, t = (0.03 + r() * 0.12) * fs / 1000; h = Array.from({ length: Math.ceil(5 * t) }, (_, n) => Math.exp(-n / t) * Math.cos(2 * Math.PI * f * n / fs)) }
    for (let j = 0; j < h.length; j++) d[at + j] += amp * h[j]
  }
  return d
}
const sdr = (c, y) => { let s = 0, e = 0; for (let i = 0; i < c.length; i++) s += c[i] ** 2, e += (y[i] - c[i]) ** 2; return 10 * Math.log10(s / e) }
const moved = (x, y) => { let c = 0, e = 0, s = 0; for (let i = 0; i < x.length; i++) { if (y[i] !== x[i]) c++; e += (y[i] - x[i]) ** 2; s += x[i] ** 2 } return { share: c / x.length, db: 10 * Math.log10(e / s) } }

test('decrackle — small crackle on speech taken out, the speech not made worse', () => {
  // 0.1.7 (2.5 × the window's MAD, Gauss-Seidel fill) took this from 32.5 to 20.5 dB
  let speech = lena.subarray(0, fs * 3), d = crackle(speech, 200, 0.5)
  let before = sdr(speech, d), after = sdr(speech, decrackle(d, { fs }))
  ok(after > before + 5, `SDR ${before.toFixed(1)} → ${after.toFixed(1)} dB`)
})

test('decrackle — dense crackle, 1000/s at 0.4–2× the speech', () => {
  let speech = lena.subarray(0, fs * 2), d = crackle(speech, 1000, 2, 7)
  let before = sdr(speech, d), after = sdr(speech, decrackle(d, { fs }))
  ok(after > before + 6, `SDR ${before.toFixed(1)} → ${after.toFixed(1)} dB`)
})

test('decrackle — clean speech and a sung-like tone left nearly as they are', () => {
  // 0.1.7 changed 7% of these samples, the speech to −20 dB
  let speech = lena.subarray(0, fs * 3), m = moved(speech, decrackle(speech, { fs }))
  ok(m.share < 0.001 && m.db < -50, `speech: ${(100 * m.share).toFixed(3)}% of samples, ${m.db.toFixed(1)} dB`)
  let tone = new Float32Array(fs * 2), ph = 0                     // 220 Hz, 8 harmonics at 1/k, ±30 cents at 5.5 Hz
  for (let i = 0; i < tone.length; i++) {
    ph += 2 * Math.PI * 220 * 2 ** (0.3 / 12 * Math.sin(2 * Math.PI * 5.5 * i / fs)) / fs
    for (let k = 1; k <= 8; k++) tone[i] += 0.3 * Math.sin(k * ph) / k
  }
  m = moved(tone, decrackle(tone, { fs }))
  ok(m.share < 0.005 && m.db < -50, `tone: ${(100 * m.share).toFixed(3)}% of samples, ${m.db.toFixed(1)} dB`)
  let hiss = noise(fs, 0.1)
  is([...decrackle(hiss, { fs })].findIndex((v, i) => v !== hiss[i]), -1, 'noise: not a sample changed')
})

test('decrackle — empty, one sample, silence, shorter than its window', () => {
  is(decrackle(new Float32Array(0), { fs }).length, 0, 'empty')
  is([...decrackle(Float32Array.of(0.5), { fs })], [0.5], 'one sample')
  ok(decrackle(new Float32Array(fs)).every(v => v === 0), 'silence stays silent')
  let x = new Float32Array(600)
  for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / fs)
  let d = copy(x); d[300] += 0.8
  let out = decrackle(d, { fs })
  ok(out.every(Number.isFinite) && Math.abs(out[300] - x[300]) < 0.01, `the impulse rebuilt (${out[300].toFixed(3)} for ${x[300].toFixed(3)})`)
  ok(decrackle(crackle(lena.subarray(0, fs), 1000, 8), { fs }).every(Number.isFinite), 'no NaN')
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

import { rails } from '@audio/denoise-declip'
import { arFill } from '@audio/lpc'
const scaled = (x, k) => Float32Array.from(x, v => v * k)
const clamp = (x, hi, lo = -hi) => Float32Array.from(x, v => Math.min(hi, Math.max(lo, v)))
const pcm16 = x => Float32Array.from(x, v => Math.max(-32768, Math.min(32767, Math.round(v * 32768))) / 32768)
const unchanged = (x, y) => x.length === y.length && x.every((v, i) => v === y[i])
// a lookahead limiter, as a mastered track has been through: the gain is the 5 ms moving average of the minimum over
// the next 5 ms of ceiling/|x|, so each peak touches the ceiling in one sample and its neighbours follow the wave
function limited(x, c = 0.98) {
  let L = Math.round(0.005 * fs), n = x.length, M = new Float64Array(n), y = new Float32Array(n)
  for (let i = 0; i < n; i++) { M[i] = 1; for (let j = i; j < Math.min(n, i + L); j++) M[i] = Math.min(M[i], c / Math.max(Math.abs(x[j]), c)) }
  for (let i = 0, s = 0; i < n; i++) { s += M[i]; if (i >= L) s -= M[i - L]; y[i] = x[i] * s / Math.min(i + 1, L) }
  return y
}

test('declip — sound with no rail comes back bit-exact, at any level and bit depth, limited or not', () => {
  // 0.1.7 took the most populated |x| bin over 0.5 for the rail: a limiter at half scale for any sound peaking over it
  let s = lena.subarray(0, fs), one = scaled(s, 1 / peak(s))
  for (let [v, x] of [['as is', s], ['peak 1', one], ['16-bit', pcm16(one)], ['16-bit at −40 dB', pcm16(scaled(one, 0.01))], ['limited 12 dB', limited(scaled(one, 4))]]) {
    let r = rails(x)
    ok(r.hi == null && r.lo == null && unchanged(x, declip(x, { fs })), `${v}: no rail, not a sample changed`)
  }
  for (let f of [50, 1000]) { let x = sine(f, fs, 0.9); ok(unchanged(x, declip(x, { fs })), `a ${f} Hz sine's top is no rail`) }
})

test('declip — finds the rail wherever it sits: clipped, then turned down to 0.28', () => {
  // 0.1.7 looked for a rail above 0.5 only, and left this alone
  let s = lena.subarray(0, fs), x = scaled(s, 0.4 / peak(s)), y = scaled(clamp(scaled(s, 1 / peak(s)), 0.7), 0.4)
  let { hi, lo } = rails(y), z = declip(y, { fs })
  ok(Math.abs(hi - 0.28) < 1e-6 && Math.abs(lo + 0.28) < 1e-6, `rails ${hi?.toFixed(4)} / ${lo?.toFixed(4)}`)
  ok(snr(x, z) > snr(x, y) + 10, `SDR ${snr(x, y).toFixed(1)} → ${snr(x, z).toFixed(1)} dB`)
})

test('declip — one rail, two different rails, a 16-bit converter overdriven', () => {
  let s = lena.subarray(0, fs), x = scaled(s, 1 / peak(s)), up = scaled(x, 1.3)
  for (let [v, ref, y, want] of [
    ['one side', x, clamp(x, 0.6, -2), [0.6, null]], ['two rails', x, clamp(x, 0.6, -0.45), [0.6, -0.45]],
    ['16-bit, 2.3 dB over', up, pcm16(up), [32767 / 32768, -1]]
  ]) {
    let { hi, lo } = rails(y), z = declip(y, { fs })
    ok(hi === Math.fround(want[0]) && lo === (want[1] == null ? null : Math.fround(want[1])), `${v}: rails ${hi} / ${lo}`)
    ok(snr(ref, z) > snr(ref, y) + 6, `${v}: SDR ${snr(ref, y).toFixed(1)} → ${snr(ref, z).toFixed(1)} dB`)
  }
})

test('declip — speech clipped to 10 dB SDR comes back over 20', () => {
  // 0.1.7 (AR on the left context, Gauss-Seidel fill, runs over 50 skipped): 10.6 dB at its best, the rail given
  let s = lena.subarray(0, fs), x = scaled(s, 1 / peak(s)), lo = 0, hi = 1
  for (let i = 0; i < 40; i++) { let m = (lo + hi) / 2; if (snr(x, clamp(x, m)) < 10) lo = m; else hi = m }
  let y = clamp(x, hi), z = declip(y, { fs })
  ok(snr(x, z) > 20, `SDR ${snr(x, y).toFixed(1)} → ${snr(x, z).toFixed(1)} dB`)
  ok(z.every(Number.isFinite), 'finite')
  ok(z.every((v, i) => y[i] === v || Math.abs(v) >= Math.abs(y[i])), 'consistent: each rebuilt sample at least as far out as recorded')
})

test('declip — edges: empty, one sample, silence, a constant, shorter than its window', () => {
  is(declip(new Float32Array(0), { fs }).length, 0, 'empty')
  ok(unchanged(new Float32Array([0.5]), declip(new Float32Array([0.5]), { fs, clipLevel: 0.5 })), 'one sample')
  ok(unchanged(new Float32Array(4096), declip(new Float32Array(4096), { fs })), 'silence')
  let dc = new Float32Array(4096).fill(0.3)
  ok(unchanged(dc, declip(dc, { fs })), 'a constant: nothing to rebuild it from')
  let x = sine(440, 600), y = clamp(x, 0.8), z = declip(y, { fs })
  ok(z.every(Number.isFinite) && peak(z) > 0.85 && snr(x, z) > snr(x, y) + 6, `600 samples: SDR ${snr(x, y).toFixed(1)} → ${snr(x, z).toFixed(1)} dB`)
})

test('lpc arFill: the exact least-squares fill; arBridge\'s on one contiguous gap', () => {
  let r = 0x9e3779b9, rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 0x100000000) - 0.5
  let x = new Float64Array(1500), y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) { let v = 1.6 * y1 - 0.9 * y2 + rand(); y2 = y1; y1 = v; x[i] = v }
  let p = 24, { a } = arFit(x, p), A = Float64Array.from(x), B = Float64Array.from(x), gap = []
  for (let i = 600; i < 700; i++) gap.push(i)
  arFill(A, gap, a); arBridge(B, 600, 700, a)
  ok(A.every((v, i) => Math.abs(v - B[i]) < 1e-9), 'a contiguous gap: arBridge')
  let C = Float64Array.from(x), g = []
  for (let i = 30; i < 1470; i++) if (rand() < -0.2 || (i >= 700 && i < 760)) g.push(i)
  ok(arFill(C, g, a), 'solved')
  // the gradient of Σ_t (a∗x)[t]² with respect to every unknown vanishes
  let e = new Float64Array(x.length + p), worst = 0
  for (let t = 0; t < e.length; t++) for (let k = 0; k <= p; k++) if (t - k >= 0 && t - k < x.length) e[t] += a[k] * C[t - k]
  for (let i of g) { let d = 0; for (let k = 0; k <= p; k++) d += a[k] * e[i + k]; worst = Math.max(worst, Math.abs(d)) }
  ok(worst < 1e-9, `normal equations hold (${worst.toExponential(1)}) over ${g.length} scattered unknowns`)
})

// =================== dewind ===================

// steady wind: Gaussian-ish noise through a one-pole 80 Hz low-pass (deterministic LCG)
function lfNoise(n, amp, seed = 12345) {
  let d = new Float32Array(n), y = 0, a = Math.exp(-2 * Math.PI * 80 / fs)
  let rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000) * 2 - 1
  for (let i = 0; i < n; i++) d[i] = amp * (y = a * y + (1 - a) * rand())
  return d
}

test('dewind – takes steady wind under speech', () => {
  let speech = lena.subarray(0, fs * 4), dirty = add(speech, lfNoise(speech.length, 6))
  let clean = dewind(copy(dirty), { fs })
  ok(snr(speech, clean) > snr(speech, dirty) + 3, `SNR ${snr(speech, dirty).toFixed(1)} → ${snr(speech, clean).toFixed(1)} dB (+3 required)`)
})

// 0.1.9 took any low end over the 300–2000 Hz band for wind, behind a fixed 60 Hz floor: it thinned voices and cut
// this bass line by 9 dB. A voice's, a note's, a tone's low end repeats at its pitch; wind's does not.
test('dewind – no wind, no change: speech, a bass line, a steady low tone', () => {
  let y = dewind(copy(lena), { fs }), md = 0
  for (let i = 0; i < lena.length; i++) md = Math.max(md, Math.abs(y[i] - lena[i]))
  is(md, 0, 'speech: untouched')
  let bass = bassline(), b = 10 * Math.log10(energy(dewind(copy(bass), { fs })) / energy(bass))
  ok(Math.abs(b) < 0.1, `bass line ${b.toFixed(2)} dB`)
  let tone = sine(40, 2 * fs, 0.4), t = dewind(copy(tone), { fs })
  ok(t.every((v, i) => v === tone[i]), '40 Hz tone: untouched (a tone is hum or a note, not wind)')
})

test('dewind – empty, one sample, shorter than a block, silence', () => {
  is(dewind(new Float32Array(0), { fs }).length, 0, 'empty')
  is(dewind(new Float32Array([0.5]), { fs })[0], 0.5, 'one sample')
  let short = lfNoise(100, 1), s = dewind(copy(short), { fs })
  ok(s.every((v, i) => v === short[i]), 'shorter than a block: nothing measured yet, nothing changed')
  ok(dewind(new Float32Array(fs), { fs }).every(v => v === 0), 'silence stays silent')
  ok(dewind(noise(fs, 0.5), { fs }).every(Number.isFinite), 'finite on noise')
})

test('dewind — the cutoff tracker keeps its clock across calls: same output under any chunking', () => {
  // Analysis blocks restarted at every call, and each short tail block took a full block's
  // attack/release step: at 64-sample host blocks the cutoff tracked 16× too fast
  let n = 2 * fs, x = add(sine(800, n, 0.2), lfNoise(n, 3))
  for (let i = 0; i < n; i++) if (i % fs > fs / 2) x[i] *= 0.05          // wind gusts on and off
  let run = block => {
    let d = copy(x), opts = { fs }
    for (let i = 0; i < n; i += block) dewind(d.subarray(i, Math.min(n, i + block)), opts)
    return d
  }
  let ref = dewind(copy(x), { fs })
  ok(ref.some((v, i) => v !== x[i]), 'the gusts engage it')
  for (let block of [1, 64, 997, 1024, 5000]) {
    let d = run(block), m = 0
    for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(d[i] - ref[i]))
    is(m, 0, `block ${block} ≡ one call`)
  }
})

test('dewind — improves SNR on intermittent gusts (design center)', () => {
  // Wind buffeting comes in bursts; the adaptive cutoff opens on gusts and closes
  // between them — where dewind beats spectral methods at a fraction of the cost.
  let speech = lena.subarray(0, fs * 4)
  let gust = new Float32Array(speech.length)
  let seed = 0x9e3779b9                                    // deterministic LCG noise
  let rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000) * 2 - 1
  let y = 0, a = Math.exp(-2 * Math.PI * 80 / fs)
  for (let g = 0; g < 3; g++) {
    let at = Math.floor((0.3 + g * 1.3) * fs), glen = Math.floor(0.4 * fs)
    for (let i = 0; i < glen && at + i < gust.length; i++) {
      y = a * y + (1 - a) * rand()
      gust[at + i] += y * 6 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / glen))
    }
  }
  let dirty = add(speech, gust)
  let clean = dewind(copy(dirty), { fs })
  ok(snr(speech, clean) > snr(speech, dirty) + 1, `gusts: SNR +${(snr(speech, clean) - snr(speech, dirty)).toFixed(1)} dB (≥1 required)`)
})

// =================== deplosive ===================

// a pop: a pressure pulse with no period, a half-sine of `ms`
function pulse(n, at, ms, amp = 1) {
  let p = new Float32Array(n), D = Math.round(ms * fs / 1000)
  for (let i = 0; i < D; i++) p[at + i] = amp * Math.sin(Math.PI * i / D)
  return p
}
// a bass line: E1–E2 notes, harmonics under 2 kHz at 1/k, 5 ms attack, 0.6 s decay, two a second
function bassline() {
  let notes = [41.2, 55, 61.7, 49, 82.4, 73.4, 55, 41.2], n = fs / 2, y = new Float32Array(n * notes.length), pk = 0
  notes.forEach((f, k) => { for (let i = 0; i < n; i++) { let t = i / fs, v = 0; for (let h = 1; h < 12 && f * h < 2000; h++) v += Math.sin(2 * Math.PI * f * h * t) / h; y[k * n + i] = v * Math.min(1, t / 0.005) * Math.exp(-t / 0.6) } })
  for (let v of y) pk = Math.max(pk, Math.abs(v))
  return y.map(v => 0.3 * v / pk)
}
function goertzel(d, f, a = 0, b = d.length) {
  let w = 2 * Math.PI * f / fs, c = 2 * Math.cos(w), s1 = 0, s2 = 0
  for (let i = a; i < b; i++) { let s = d[i] + c * s1 - s2; s2 = s1; s1 = s }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2))
}
function energy(d, a = 0, b = d.length) { let s = 0; for (let i = a; i < b; i++) s += d[i] * d[i]; return s }

test('deplosive – no pop: output equals input sample for sample', () => {
  // No pop → gain stays 1 → out = x − 0·(x − HP(x)) = x
  let x = sine(200, fs, 0.3)                              // sits right at the 200 Hz crossover
  let out = deplosive(copy(x), { fs })
  almost(rms(out), rms(x), rms(x) * 0.02, '200 Hz preserved — no crossover notch')
  let md = 0
  for (let i = 0; i < x.length; i++) md = Math.max(md, Math.abs(out[i] - x[i]))
  ok(md < 1e-5, 'output equals input sample-for-sample when no plosive fires')
})

test('deplosive – ducks a pop, keeps the high band', () => {
  let n = fs, at = Math.floor(0.3 * fs), D = Math.round(0.03 * fs)
  let hi = sine(1500, n, 0.05), dirty = add(hi, pulse(n, at, 30))
  let clean = deplosive(copy(dirty), { fs }), before = 0, after = 0
  for (let i = at; i < at + D + fs * 0.05; i++) { before += (dirty[i] - hi[i]) ** 2; after += (clean[i] - hi[i]) ** 2 }
  ok(before / after > 10 ** 0.9, `pop error ${(10 * Math.log10(before / after)).toFixed(1)} dB down (≥ 9)`)
  almost(goertzel(clean, 1500), goertzel(hi, 1500), goertzel(hi, 1500) * 0.01, 'high band kept')
})

// 0.1.10 ducked any low end over 4× the high band: a voice's, a bass line's (−3.4 dB on this one), a sine bass note's
// (−8.7 dB). Theirs repeats at a pitch; a pop's does not.
test('deplosive – a periodic low end passes: bass line, sine bass notes, speech', () => {
  let bass = bassline(), notes = new Float32Array(2 * fs)
  for (let k = 0; k < 4; k++) for (let i = 0; i < fs / 2; i++) notes[k * fs / 2 + i] = 0.5 * Math.sin(2 * Math.PI * 50 * i / fs) * Math.exp(-i / fs / 0.4)
  let b = 10 * Math.log10(energy(deplosive(copy(bass), { fs })) / energy(bass))
  let s = 10 * Math.log10(energy(deplosive(copy(notes), { fs })) / energy(notes))
  ok(b > -0.3, `bass line ${b.toFixed(2)} dB`)
  ok(s > -1, `sine notes, sharp attack ${s.toFixed(2)} dB`)
  let y = deplosive(copy(lena), { fs }), md = 0
  for (let i = 0; i < lena.length; i++) md = Math.max(md, Math.abs(y[i] - lena[i]))
  is(md, 0, 'speech: untouched')
})

// The duck was g·LP + (x − LP), and x − LP is no high-pass: under a pop it lifted 250 Hz by 1.7 dB
test('deplosive – the duck never lifts a band', () => {
  let n = fs, at = Math.floor(0.3 * fs), tone = sine(250, n, 0.1)
  let y = deplosive(add(tone, pulse(n, at, 100)), { fs })
  let a = at + Math.round(0.03 * fs), b = at + Math.round(0.07 * fs), g = 20 * Math.log10(goertzel(y, 250, a, b) / goertzel(tone, 250, a, b))
  ok(g < 0, `250 Hz under the pop ${g.toFixed(2)} dB`)
})

test('deplosive – any chunking, empty, one sample, silence', () => {
  let n = fs, x = add(sine(1500, n, 0.05), pulse(n, Math.floor(0.3 * fs), 30), sine(110, n, 0.1))
  let ref = deplosive(copy(x), { fs })
  for (let block of [1, 64, 997, 4096]) {
    let d = copy(x), o = { fs }, m = 0
    for (let i = 0; i < n; i += block) deplosive(d.subarray(i, Math.min(n, i + block)), o)
    for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(d[i] - ref[i]))
    is(m, 0, `block ${block} ≡ one call`)
  }
  is(deplosive(new Float32Array(0), { fs }).length, 0, 'empty')
  is(deplosive(new Float32Array([0.5]), { fs })[0], 0.5, 'one sample')
  ok(deplosive(new Float32Array(fs), { fs }).every(v => v === 0), 'silence stays silent')
  ok(deplosive(noise(fs, 0.5), { fs }).every(Number.isFinite), 'finite on noise')
})

// =================== deesser ===================

test('deesser — reduces 7kHz sibilance', () => {
  let speech = lena.subarray(0, fs * 2)
  let siss = new Float32Array(speech.length)
  for (let i = 0; i < speech.length; i++) siss[i] = 0.3 * Math.sin(2 * Math.PI * 7000 * i / fs)
  let dirty = add(speech, siss)
  let clean = deesser(copy(dirty), { fs, fc: 7000 })
  ok(narrowEnergy(clean, 7000) < narrowEnergy(dirty, 7000), 'sibilance attenuated')
})

test('deesser — preserves low-mid content', () => {
  let mix = add(sine(220, fs, 0.3), sine(7000, fs, 0.3))
  let clean = deesser(copy(mix), { fs, fc: 7000 })
  ok(narrowEnergy(clean, 220) > 0.1, '220Hz preserved')
})

// =================== debreath ===================

test('debreath — attenuates non-speech far more than speech', () => {
  // Pure noise (VAD all-inactive) must be pulled down; loud speech must survive.
  // A no-op or a full-mute would fail one side or the other.
  let speech = lena.subarray(0, fs * 4)
  let n = noise(fs, 0.05)
  let retNoise = rms(debreath(copy(n), { fs })) / rms(n)
  let retSpeech = rms(debreath(copy(speech), { fs })) / rms(speech)
  ok(retNoise < 0.6, 'pure non-speech attenuated (VAD inactive)')
  ok(retSpeech > retNoise * 1.5, 'speech retained far more than noise')
})

test('debreath — noise after speech goes down', () => {
  // the host's case: 1.5 s of lena, then 1.5 s of noise at 0.02. 2.0.0 heard the noise as voiced speech and kept it
  // whole (its floor, read before the noise, lay under it; its voicing, on the Wiener estimate, peaks on noise)
  let s = 5, r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
  for (let [kind, make] of [['white', n => Float32Array.from({ length: n }, () => r() * 2 - 1)], ['pink', n => pinkNoise(n, 9).map(v => v / 4)]]) {
    let sp = lena.subarray(0, Math.round(1.5 * fs)), x = new Float32Array(2 * sp.length), z = make(sp.length)
    x.set(sp); for (let i = 0; i < z.length; i++) x[sp.length + i] = 0.02 * z[i]
    let y = debreath(copy(x), { fs }), e = (d, a, b) => rms(d.subarray(a, b))
    ok(e(y, sp.length + 4096, x.length) < 0.6 * e(x, sp.length + 4096, x.length), `${kind}: the noise down (${(e(y, sp.length + 4096, x.length) / e(x, sp.length + 4096, x.length)).toFixed(2)})`)
    ok(e(y, 0, sp.length) > 0.95 * e(x, 0, sp.length), `${kind}: the speech kept`)
  }
})

test('debreath — speech under noise is not turned down', () => {
  // 0.1 turned down what lay under 9 dB over the input's 10th-percentile frame energy: under noise that is the noise,
  // and at 5 dB SNR it took 56 % of lena's loud frames down by over 3 dB
  let { x, n, loud } = lenaInNoise(5), y = debreath(copy(x), { fs }), cut = 0, all = 0
  loud.forEach((l, k) => {
    if (!l) return
    let a = 0, b = 0
    for (let i = k * n; i < (k + 1) * n; i++) { a += x[i] * x[i]; b += y[i] * y[i] }
    all++; cut += b < a / 2
  })
  ok(cut / all < 0.01, `loud speech frames turned down over 3 dB at 5 dB SNR: ${(100 * cut / all).toFixed(2)} %`)
  ok(y.every(Number.isFinite), 'finite output')
})

test('debreath — a breath between phrases goes down by `range`; the phrases, and a held note, stay as they were', () => {
  // two phrases of lena, a 1.2 s pause on a -70 dB floor, in its middle a breath: noise through three wide resonances
  // (500, 1500, 2500 Hz) under a 350 ms Hann envelope, 30 dB under the loudest speech
  let gap = Math.round(1.2 * fs), half = Math.round(2.5 * fs), L = Math.round(0.35 * fs), at = half + (gap - L >> 1)
  let x = pinkNoise(2 * half + gap, 11).map(v => 3e-4 * v), br = new Float32Array(L), w = pinkNoise(L, 13)
  x.set(lena.subarray(0, half).map((v, i) => v + x[i])); x.set(lena.subarray(half, 2 * half).map((v, i) => v + x[half + gap + i]), half + gap)
  for (let [f, bw] of [[500, 300], [1500, 400], [2500, 500]]) {
    let R = Math.exp(-Math.PI * bw / fs), c = 2 * R * Math.cos(2 * Math.PI * f / fs), y1 = 0, y2 = 0
    for (let i = 0; i < L; i++) { let v = (1 - R) * w[i] + c * y1 - R * R * y2; y2 = y1; y1 = v; br[i] += v }
  }
  let top = 0, n = fs / 100
  for (let k = 0; k + n <= lena.length; k += n) { let e = 0; for (let i = k; i < k + n; i++) e += lena[i] * lena[i]; top = Math.max(top, e / n) }
  let g = Math.sqrt(top * 1e-3) / rms(br)
  for (let i = 0; i < L; i++) x[at + i] += g * br[i] * Math.sin(Math.PI * i / L) ** 2
  let y = debreath(copy(x), { fs }), e = (d, a, b) => { let s = 0; for (let i = a; i < b; i++) s += d[i] * d[i]; return s }
  almost(10 * Math.log10(e(y, at, at + L) / e(x, at, at + L)), -12, 1, 'the breath down by range')
  let loudKept = true
  for (let k = 0; k + n <= x.length; k += n) if ((k < half || k >= half + gap) && e(x, k, k + n) > top * n / 100) loudKept &&= e(y, k, k + n) === e(x, k, k + n)
  ok(loudKept, 'every loud 10 ms of both phrases untouched')
  // nothing between phrases: a note held 3 s with vibrato, no pause anywhere, comes out bit-exact
  let note = new Float32Array(3 * fs)
  for (let i = 0, ph = 0; i < note.length; i++) { ph += 2 * Math.PI * 150 * (1 + 0.01 * Math.sin(2 * Math.PI * 5 * i / fs)) / fs; for (let h = 1; h <= 10; h++) note[i] += 0.2 * Math.sin(h * ph) / h }
  let out = debreath(copy(note), { fs }), dev = 0
  for (let i = 0; i < note.length; i++) dev = Math.max(dev, Math.abs(out[i] - note[i]))
  is(dev, 0, 'a held note passes untouched')
})

test('debreath — empty, a single sample, shorter than a frame, digital silence', () => {
  is(debreath(new Float32Array(0), { fs }).length, 0, 'empty')
  for (let x of [Float32Array.of(0.5), new Float32Array(1000).fill(0.25)]) {
    let y = debreath(copy(x), { fs })
    ok(y.every((v, i) => v === x[i]), `${x.length} samples: nothing to analyse, nothing changed`)
  }
  let z = debreath(new Float32Array(fs), { fs })
  ok(z.every(v => v === 0), 'digital silence stays silent, finite')
})

// =================== dereverb ===================

// the direct sound plus `mix` of four parallel feedback combs (Schroeder, JAES 10(3), 1962): delays `ds`, gains for a
// 60 dB decay in t60 s at rate sr; float64 in scripts/reference.py `room`'s order
function combs(x, { ds = [238, 297, 329, 350], gs, t60, sr = fs, mix = 0.25 } = {}) {
  gs ??= ds.map(d => 10 ** (-3 * d / (t60 * sr)))
  let y = new Float64Array(x.length), c = ds.map(() => new Float64Array(x.length))
  for (let n = 0; n < x.length; n++) {
    let s = 0
    for (let j = 0; j < ds.length; j++) { c[j][n] = x[n] + (n >= ds[j] ? gs[j] * c[j][n - ds[j]] : 0); s += c[j][n] }
    y[n] = x[n] + mix * s
  }
  return y
}

test('dereverb: equals its numpy reference (Nakatani et al. 2010; recursive, Yoshioka & Nakatani 2012)', () => {
  let fx = JSON.parse(readFileSync(new URL('./fixtures/reference.json', import.meta.url)))
  let { fs: sr, frameSize: N, hopSize: hop, step, rms: r } = fx
  let x = Float32Array.from(combs(refSignal(), { gs: [0.598, 0.527, 0.492, 0.470] }))   // reference.py `room`
  let y = dereverb(x, { fs: sr, frameSize: N, hopSize: hop }), ref = fx.batch[stftFirst(N, hop) < 0 ? 'reflect' : 'zero'].dereverb
  let d = ref.reduce((m, v, i) => Math.max(m, Math.abs(y[i * step] - v)), 0) / r
  ok(d < 1e-5, `output within ${d.toExponential(1)} of the RMS`)
})

test('dereverb: takes the late reverberation off speech, leaves dry speech', () => {
  // lena through combs of 53 to 79 ms (T60 0.5 s), mixed at half: each comb passes x once, so taking 4 · 0.5 x off
  // leaves the direct sound x, the target, and the echoes, late reverberation
  let x = lena.subarray(0, fs * 4), y = Float32Array.from(combs(x, { ds: [2337, 2690, 3131, 3484], t60: 0.5, mix: 0.5 }), (v, i) => v - 2 * x[i])
  let db = (a, b) => { let s = 0, e = 0; for (let i = fs; i < b.length; i++) { s += (a[i] - b[i]) ** 2; e += b[i] ** 2 } return 10 * Math.log10(s / e) }
  let before = db(y, x), after = db(dereverb(y, { fs }), x), dry = db(dereverb(x, { fs }), x)
  ok(after < before - 2, `late reverberation ${before.toFixed(1)} → ${after.toFixed(1)} dB under the direct sound`)
  ok(dry < -20, `dry speech changed by ${dry.toFixed(1)} dB of itself`)
})

test('dereverb: the writer equals the batch, look-ahead included, under any chunking', () => {
  let x = lena.subarray(0, fs), batch = dereverb(x, { fs }), write = dereverb({ fs }), parts = []
  for (let i = 0, k = 0, sizes = [1000, 37, 4096, 5]; i < x.length; i += sizes[k++ % 4]) parts.push(write(x.subarray(i, i + sizes[k % 4])))
  parts.push(write())
  let out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)), o = 0, err = 0
  for (let p of parts) { out.set(p, o); o += p.length }
  for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(out[i] - batch[i]))
  is(out.length, x.length, 'as long as the input')
  ok(err < 1e-6, `max deviation ${err.toExponential(1)}`)
})

// =================== denoise auto-classifier ===================

const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
// a voice: 120–180 Hz glottal pulses through formants at 700 and 1200 Hz, in syllables of 0.2 s with 0.15 s between
function syllables(n) {
  let d = new Float32Array(n), y1 = 0, y2 = 0, z1 = 0, z2 = 0, ph = 0
  for (let i = 0; i < n; i++) {
    let t = i / fs, on = t % 0.35 < 0.2
    ph += (120 + 60 * Math.sin(2 * Math.PI * 0.7 * t)) / fs
    let x = on && ph >= 1 ? 1 : 0
    if (ph >= 1) ph -= 1
    let y = x + 1.9 * Math.cos(2 * Math.PI * 700 / fs) * 0.95 * y1 - 0.9025 * y2; y2 = y1; y1 = y
    let z = y + 2 * Math.cos(2 * Math.PI * 1200 / fs) * 0.93 * z1 - 0.8649 * z2; z2 = z1; z1 = z
    d[i] = on ? z * 0.01 * Math.sin(Math.PI * (t % 0.35) / 0.2) : 0
  }
  return d
}
// a dense mix: a chord every 0.5 s (three voices, harmonics 1–8 at 1/k, struck and held) over a bass, no noise
function chords(n) {
  let d = new Float32Array(n), cs = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]]
  for (let i = 0; i < n; i++) {
    let t = i / fs, c = cs[Math.floor(t / 0.5) % 4], s = 2 * Math.sin(2 * Math.PI * c[0] / 4 * t) + Math.sin(Math.PI * c[0] * t)
    for (let f of c) for (let k = 1; k <= 8; k++) s += Math.sin(2 * Math.PI * f * k * t) / k
    let u = t % 0.5
    d[i] = (0.05 * Math.exp(-3 * u) + 0.02) * Math.min(1, u / 0.005, (0.5 - u) / 0.01) * s   // 5 ms in, 10 ms out
  }
  return d
}

test('classify — 60Hz hum routes to dehum', () => {
  let x = add(sine(60, fs, 0.3), sine(120, fs, 0.15))
  is(classify(x, fs).method, 'dehum')
})

test('classify — clicks route to declick', () => {
  let x = add(noise(fs, 0.02), clicks(fs, 12, 0.9))
  is(classify(x, fs).method, 'declick')
})

// Speech isn't clicks. Its AR residual is a glottal pulse train, impulsive but every 2.5–12 ms at like size; a click
// stands alone. The residual's kurtosis, the old score, read 2.5–401 on clean narration against a trigger of 12.
test('classify — speech and a sung vowel are not clicks; speech with clicks at 2.5 a second is', async () => {
  let { CLICK_RATE } = await import('@audio/denoise-detect')
  let speech = lena.subarray(0, fs * 4)
  let vowel = new Float32Array(fs * 2), y1 = 0, y2 = 0, z1 = 0, z2 = 0
  for (let i = 0; i < vowel.length; i++) {
    let x = i % Math.round(fs / 120) === 0 ? 1 : 0   // 120 Hz glottal pulses
    let y = x + 1.9 * Math.cos(2 * Math.PI * 700 / fs) * 0.95 * y1 - 0.9025 * y2; y2 = y1; y1 = y   // formant at 700 Hz
    let z = y + 2 * Math.cos(2 * Math.PI * 1200 / fs) * 0.93 * z1 - 0.8649 * z2; z2 = z1; z1 = z   // and 1200 Hz
    vowel[i] = z * 0.01
  }
  ok(classify(speech, fs).scores.click < CLICK_RATE, 'speech: ' + classify(speech, fs).scores.click.toFixed(2) + ' impulses/s')
  ok(classify(vowel, fs).scores.click < CLICK_RATE, 'vowel: ' + classify(vowel, fs).scores.click.toFixed(2) + ' impulses/s')
  let dirty = Float32Array.from(speech)
  for (let t = 0.2; t < 4; t += 0.4) dirty[Math.round(t * fs)] += 0.3
  is(classify(dirty, fs).method, 'declick', 'clicks: ' + classify(dirty, fs).scores.click.toFixed(2) + ' impulses/s')
})

test('classify — sibilance routes to deesser', () => {
  let x = add(noise(fs, 0.05), sine(7000, fs, 0.3))
  is(classify(x, fs).method, 'deesser')
})

// Wind is aperiodic low end in gusts (Nelke & Vary 2014); a low tone repeats at its period and is no wind (dewind 0.2
// leaves it alone), here the noise under it is the defect
test('classify — gusts of low noise route to dewind; a 40 Hz tone is no wind', () => {
  let v = syllables(fs * 4), w = new Float32Array(v.length), r = lcg(5), a = Math.exp(-2 * Math.PI * 150 / fs), l1 = 0, l2 = 0, g = 0
  for (let i = 0; i < w.length; i++) {          // noise under 150 Hz, gusting 0.6 s of every second
    l1 = a * l1 + (1 - a) * (r() * 2 - 1); l2 = a * l2 + (1 - a) * l1; g = 0.999 * g + 0.001 * ((i / fs) % 1 < 0.6)
    w[i] = l2 * g * 4 * rms(v) / 0.0577
  }
  let c = classify(add(v, w), fs)
  is(c.method, 'dewind', `wind in ${(100 * c.scores.wind).toFixed(0)}% of the blocks`)
  let tone = classify(add(sine(40, fs, 0.4), noise(fs, 0.05)), fs)
  ok(tone.method !== 'dewind' && tone.scores.wind === 0, `40 Hz tone: ${tone.method}, wind ${tone.scores.wind}`)
})

test('classify — broadband noise routes to wiener', () => {
  is(classify(noise(fs, 0.1), fs).method, 'wiener')
})

test('classify — stationary noise bed under speech routes to wiener', () => {
  let speech = lena.subarray(0, fs * 4)
  let dirty = add(speech, noise(speech.length, 0.05))
  is(classify(dirty, fs).method, 'wiener', 'stable floor → wiener despite speech dynamics')
})

test('classify — wandering (non-stationary) noise bed routes to omlsa', () => {
  // slow deep AM on the noise bed — babble/traffic class (deterministic LFO)
  let speech = lena.subarray(0, fs * 4)
  let bed = noise(speech.length, 0.06)
  for (let i = 0; i < bed.length; i++) bed[i] *= 1 + 0.8 * Math.sin(2 * Math.PI * 0.35 * i / fs)
  is(classify(add(speech, bed), fs).method, 'omlsa', 'wandering floor → omlsa')
})

// Each route needs evidence. 0.3 routed every recording somewhere: clean speech and music to omlsa (its floor statistic
// read a program's own dynamics as a wandering bed), a bass-heavy mix to dewind. A voice pauses into silence; a chord
// sequence never pauses, but its quietest frames hold partials, never a noise floor; the same chords with white noise
// 20 dB under them show the noise in steady bands.
test('classify — clean voice and clean music route to none; the music under white noise to wiener', () => {
  let v = syllables(fs * 4), m = chords(fs * 4)
  let cv = classify(v, fs), cm = classify(m, fs), n = noise(m.length, rms(m) * 0.1 * Math.sqrt(3))
  is(cv.method, 'none', `voice: bed ${cv.scores.snr.toFixed(1)} dB under`)
  is(cm.method, 'none', `music: bed ${cm.scores.snr.toFixed(1)} dB under`)
  let cn = classify(add(m, n), fs)
  is(cn.method, 'wiener', `music + white noise 20 dB under: bed ${cn.scores.snr.toFixed(1)} dB under`)
})

test('denoise — nothing evidenced: the sound comes back as it was', () => {
  let m = chords(fs * 2), { out, plan } = denoise(m, { fs, returnPlan: true })
  is(plan.method, 'none')
  ok(out !== m && out.length === m.length && out.every((v, i) => v === m[i]), 'a copy, sample for sample')
  is(denoise(copy(m), { fs, force: 'none' }).length, m.length, 'forced none')
})

test('classify — empty, one sample, shorter than a frame, silence: none, nothing changed', () => {
  for (let [name, x] of [['empty', new Float32Array(0)], ['one sample', new Float32Array([0.5])], ['short', noise(1000, 0.1)], ['silence', new Float32Array(fs)]]) {
    is(classify(x, fs).method, 'none', name)
    let y = denoise(copy(x), { fs })
    ok(y.length === x.length && y.every((v, i) => v === x[i]), name + ': unchanged')
  }
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

// Forced, no classify ran to name the series: dehum measures it (a fixed 50 Hz left 60 Hz mains in place)
test('denoise — forced dehum finds 60 Hz mains', () => {
  let speech = lena.subarray(0, fs * 4), x = add(speech, sine(60, speech.length, 0.05), sine(120, speech.length, 0.03))
  let y = denoise(copy(x), { fs, force: 'dehum' }).subarray(fs / 2)
  ok(narrowEnergy(y, 60) < 0.05 / 30, `60 Hz at ${(20 * Math.log10(narrowEnergy(y, 60) / 0.05)).toFixed(1)} dB of the hum`)
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

// arBridge: the least-squares AR interpolator for one contiguous gap. declick's arInterpolate solves
// the same problem by Gauss-Seidel for scattered clicks; this one exactly, for runs of any length.
import { arFit, arBridge } from '@audio/lpc'
import { plan as repairPlan } from '@audio/denoise-repair'

test('lpc arBridge: equals the dense solve of the least-squares AR normal equations (Godsill & Rayner 1998 §5.2.2)', () => {
	let a = Float64Array.from([1, -0.5, 0.2, 0.1, -0.05, 0.03]), p = 5, n = 40, from = 15, to = 22
	let x = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 1.9))
	let y = arBridge(x.slice(), from, to, a)
	// minimize ‖A·x‖² over x[from..to), A the (n+p)×n full-convolution matrix of a: (AᵤᵀAᵤ)·xᵤ = −AᵤᵀAₖ·xₖ
	let A = (t, j) => t - j >= 0 && t - j <= p ? a[t - j] : 0, m = to - from
	let Q = Array.from({ length: m }, () => new Float64Array(m + 1))
	for (let u = 0; u < m; u++) for (let t = 0; t < n + p; t++) {
		let e = 0
		for (let j = 0; j < n; j++) if (j < from || j >= to) e += A(t, j) * x[j]
		for (let v = 0; v < m; v++) Q[u][v] += A(t, from + u) * A(t, from + v)
		Q[u][m] -= A(t, from + u) * e
	}
	for (let c = 0; c < m; c++) for (let r = c + 1; r < m; r++) { let f = Q[r][c] / Q[c][c]; for (let k = c; k <= m; k++) Q[r][k] -= f * Q[c][k] }
	let sol = new Float64Array(m), err = 0
	for (let c = m - 1; c >= 0; c--) { let s = Q[c][m]; for (let k = c + 1; k < m; k++) s -= Q[c][k] * sol[k]; sol[c] = s / Q[c][c] }
	for (let u = 0; u < m; u++) err = Math.max(err, Math.abs(sol[u] - y[from + u]))
	ok(err < 1e-12, `max |arBridge − dense| ${err.toExponential(1)}`)
})

test('lpc arBridge: two Janssen passes match the reference janssen_inp.m (Mokrý & Rajmic, InpaintingAutoregressive)', () => {
	// reference: janssen_inp.m ('lpc' estimator, p = 32, maxit = 2) ported to numpy, on this signal with x[900..950) lost
	let x = Float64Array.from({ length: 2000 }, (_, n) => Math.sin(2 * Math.PI * 0.0123 * n) + 0.5 * Math.sin(2 * Math.PI * 0.0371 * n + 1) + 0.25 * Math.sin(2 * Math.PI * 0.0913 * n + 2) + 0.05 * Math.sin(0.001 * n * n))
	let y = x.slice().fill(0, 900, 950)
	for (let it = 0; it < 2; it++) arBridge(y, 900, 950, arFit(y, 32).a)
	let ref = { 900: 0.25182093619744267, 912: 0.7967138380834234, 925: 0.5186479956101665, 937: -0.6165023417226305, 949: -0.6102469873606511 }
	for (let i in ref) almost(y[i], ref[i], 1e-9, `x[${i}]`)
})

// a 1.5 s phrase (C4 E4 G4 C5, harmonic 2 at 0.3), exactly periodic: any lost second has copies 1.5 s away
const phrase = n => Float32Array.from({ length: n }, (_, i) => { let t = i / fs % 1.5, f = [262, 330, 392, 523][Math.floor(t / 0.375)]; return 0.3 * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) })

test('repair: auto routes by length and content', () => {
	let route = (x, at, duration, band) => repairPlan(x, { fs, regions: [{ at, duration, ...band }] })[0]
	is(route(lena, 2, 0.02).method, 'ar', '20 ms dropout in speech: AR')
	let loop = phrase(6 * fs), r = route(loop, 3.2, 1), k = (r.source - 3.2) / 1.5
	is(r.method, 'similarity', 'lost second of a repeating phrase: similarity')
	ok(Math.abs(k - Math.round(k)) < 0.001, `source ${r.source.toFixed(4)} s is a repetition`)
	is(route(loop, 3.2, 0.02).method, 'similarity', '20 ms of it: an exact repetition beats AR too')
	// an exponential glide, 200 Hz doubling every 2 s, never repeats: nothing to copy
	let glide = Float32Array.from({ length: 4 * fs }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 200 * (2 ** (i / fs / 2) - 1) * 2 / Math.LN2))
	is(route(glide, 2, 0.06).method, 'ar', '60 ms of a glide: AR, no passage joins')
	is(route(glide, 2, 0.3).method, 'sinusoidal', '300 ms of a glide: sinusoidal')
	is(route(glide, 2, 0.3, { from: 300, to: 3000 }).method, 'sinusoidal', 'a band routes alike')
})

test('repair: each tier rebuilds its design case', () => {
	let cut = (x, at, dur) => { let d = copy(x), a = Math.round(at * fs), b = a + Math.round(dur * fs); d.fill(0, a, b); return [d, a, b] }
	let gapSnr = (x, y, a, b) => { let s = 0, e = 0; for (let i = a; i < b; i++) { s += x[i] ** 2; e += (x[i] - y[i]) ** 2 } return 10 * Math.log10(s / e) }
	// AR: 20 ms of speech, beyond log-magnitude interpolation's reach
	let [d, a, b] = cut(lena, 2, 0.02), reg = [{ at: 2, duration: 0.02 }]
	let ar = gapSnr(lena, repair(d, { fs, regions: reg, method: 'ar' }), a, b), sp = gapSnr(lena, repair(d, { fs, regions: reg, method: 'spectral' }), a, b)
	ok(ar > 6 && ar > sp + 5, `ar ${ar.toFixed(1)} dB vs spectral ${sp.toFixed(1)} dB`)
	// sinusoidal: 300 ms of a held tone, phase-locked at both ends
	let tone = sine(440, 3 * fs, 0.5)
	;[d, a, b] = cut(tone, 1.5, 0.3)
	let si = gapSnr(tone, repair(d, { fs, regions: [{ at: 1.5, duration: 0.3 }], method: 'sinusoidal' }), a, b)
	ok(si > 60, `sinusoidal ${si.toFixed(1)} dB`)
	// similarity, stereo: one plan from the mix, the same passage transplanted in each channel
	let loop = phrase(6 * fs)
	;[d, a, b] = cut(loop, 3.2, 1)
	let right = d.map(v => 0.5 * v), opts = { fs, regions: [{ at: 3.2, duration: 1 }] }, p = repairPlan(d.map((v, i) => (v + right[i]) / 2), opts)
	let L = repair(d, { ...opts, regions: p }), R = repair(right, { ...opts, regions: p }), sim = gapSnr(loop, L, a, b)
	ok(sim > 40, `similarity ${sim.toFixed(1)} dB`)
	let dev = 0
	for (let i = a; i < b; i++) dev = Math.max(dev, Math.abs(R[i] - 0.5 * L[i]))
	ok(dev < 1e-6, 'right channel repaired from the same source')
})

// The measurement behind 'auto' in miniature (scripts/repair.js runs it on recordings too): gaps of
// 5 ms to 1 s in a sine, a chord, a vibrato tone, speech and a repeating song; SNR over the lost
// samples (the audio-inpainting convention, Adler et al. 2012), LSD over the frames overlapping them.
// 'auto' must land within 1 dB LSD of the best tier (~1 dB: transparent, per @audio/quality), or at
// a transparent SNR of 30 dB and more.
test('repair: every tier on gaps of 5 ms to 1 s against the original; auto picks the best or near it', () => {
	let n = 8 * fs, sig = f => Float32Array.from({ length: n }, (_, i) => f(i / fs))
	let tri = [261.63, 329.63, 392], chord = sig(t => tri.reduce((s, f) => s + [1, 2, 3, 4, 5, 6].reduce((u, k) => u + Math.sin(2 * Math.PI * f * k * t) / k, 0), 0) / 12)
	let ph = 0, vib = sig(t => (ph += 2 * Math.PI * 440 * 2 ** (0.5 / 12 * Math.sin(2 * Math.PI * 5.5 * t)) / fs, 0.3 * (Math.sin(ph) + Math.sin(2 * ph) / 2 + Math.sin(3 * ph) / 3)))   // ±50 cents at 5.5 Hz
	// a 2 s bar of kick, snare, hats (fresh noise every hit) and bass under a 4-bar melody, twice: every passage recurs 8 s away
	let r = (s => () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)(7), mel = Array.from({ length: 32 }, () => [0, 2, 4, 7, 9, 12][Math.floor(r() * 6)])
	let song = new Float32Array(2 * n), hat = Float32Array.from({ length: 2 * n }, () => r() * 2 - 1)
	for (let i = 0; i < 2 * n; i++) {
		let t = i / fs, e = t % 0.25, q = t % 0.5, bar = Math.floor(t / 2) % 4, f = 261.63 * 2 ** (mel[bar * 8 + Math.floor(t % 2 / 0.25)] / 12)
		song[i] = 0.4 * Math.sin(2 * Math.PI * 50 * q) * Math.exp(-q / 0.1) * (Math.floor(t / 0.5) % 2 ? 0 : 1) + 0.1 * hat[i] * Math.exp(-e / 0.02)
			+ 0.15 * (2 * (65.41 * [1, 1.68, 1.33, 1.5][bar] * e % 1) - 1) + 0.2 * Math.sin(2 * Math.PI * f * e) * Math.exp(-e / 0.2)
	}
	let signals = { sine: sine(440, n, 0.5), chord, vibrato: vib, speech: lena, song }, METHODS = ['ar', 'sinusoidal', 'similarity', 'spectral']
	let gapSnr = (x, y, a, b) => { let s = 0, e = 0; for (let i = a; i < b; i++) { s += x[i] ** 2; e += (x[i] - y[i]) ** 2 } return Math.min(99, 10 * Math.log10(s / e)) }
	let table = ['| signal | gap | ' + [...METHODS, 'auto'].join(' | ') + ' | picked |', '|---|---|' + '---:|'.repeat(5) + '---|']
	// speech changes from gap to gap: its cells average three of them; the synthetic signals are alike anywhere
	for (let [name, x] of Object.entries(signals)) for (let ms of [5, 20, 100, 300, 1000]) {
		let res = {}, picks = []
		for (let at of name === 'speech' ? [2, 5.5, 9] : [4]) {
			let a = Math.round(at * fs), b = a + Math.round(ms / 1000 * fs), d = copy(x).fill(0, a, b), regions = [{ at, duration: (b - a) / fs }], k = name === 'speech' ? 3 : 1
			picks.push(repairPlan(d, { fs, regions })[0].method)
			for (let m of [...METHODS, 'auto']) {
				if (m === 'ar' && ms > 300) continue   // O(m²) per pass: AR on 1 s gaps is in scripts/repair.js
				let y = repair(d, { fs, regions, method: m }), q = res[m] ??= [0, 0]
				q[0] += gapSnr(x, y, a, b) / k; q[1] += lsd(x.subarray(a - 768, b + 768), y.subarray(a - 768, b + 768), { frameSize: 1024, hopSize: 256 }) / k
			}
		}
		let best = Math.min(...METHODS.filter(m => res[m]).map(m => res[m][1])), [s, l] = res.auto
		ok(l <= best + 1 || s >= 30, `${name} ${ms} ms: auto (${picks}) ${s.toFixed(1)} dB / ${l.toFixed(2)} dB LSD, best LSD ${best.toFixed(2)}`)
		table.push(`| ${name} | ${ms} ms | ` + [...METHODS, 'auto'].map(m => res[m] ? `${res[m][0].toFixed(1)} / ${res[m][1].toFixed(2)}` : 'n/a').join(' | ') + ` | ${picks} |`)
	}
	console.log('SNR / LSD (dB)\n' + table.join('\n'))
})

// Each fill joins the program in a crossfade over the good audio at each edge, as short as the seams allow
// (scripts/repair.js "Seams"): none for AR, 15 ms for the bridge, 30 ms for spectral, 5 ms for a transplant that
// repeats the program; a looser transplant keeps the frame-long one. 0.2 crossfaded the bridge over 23 ms and every
// transplant over 46 ms either side, and wrote the spectral tier's frames back whole (35–39 ms).
test('repair: good audio beyond each tier\'s crossfade comes back bit-exact; the edges add no click', () => {
	let reach = (d, y, a, b) => { let lo = a, hi = b; for (let i = 0; i < d.length; i++) if (y[i] !== d[i]) lo = Math.min(lo, i), hi = Math.max(hi, i + 1); return [(a - lo) / fs * 1000, (hi - b) / fs * 1000] }
	// a click stands out of the AR residual (Vaseghi & Rayner 1990): its strongest 1 ms from 8 ms outside an edge to
	// 1 ms inside, over the original's there, dB (a hard splice of another passage: 13–38 dB)
	let click = (x, y, s, side) => {
		let M = Math.round(fs / 1000), g0 = side < 0 ? s - 110 * M : s + 10 * M, A = arFit(Float64Array.from(x.subarray(g0, g0 + 100 * M)), 32).a
		let peak = v => { let m = 0; for (let p = s - (side < 0 ? 8 : 1) * M; p + M <= s + (side < 0 ? 1 : 8) * M; p += M >> 2) { let e = 0; for (let n = p; n < p + M; n++) { let r = 0; for (let k = 0; k <= 32; k++) r += A[k] * v[n - k]; e += r * r } m = Math.max(m, e) } return m }
		return 10 * Math.log10(peak(y) / peak(x))
	}
	let a = 2 * fs, b = a + Math.round(0.1 * fs), d = copy(lena).fill(0, a, b), regions = [{ at: 2, duration: 0.1 }]
	for (let [m, X] of [['ar', 0], ['sinusoidal', 15], ['spectral', 30], ['similarity', 2048 / fs * 1000]]) {   // lena has no repeat: the frame
		let y = repair(d, { fs, regions, method: m }), [l, r] = reach(d, y, a, b), c = Math.max(click(lena, y, a, -1), click(lena, y, b, 1))
		ok(l <= X + 0.03 && r <= X + 0.03, `${m}: rewrites ${l.toFixed(1)} / ${r.toFixed(1)} ms of good audio either side (≤ ${X.toFixed(1)})`)
		ok(c < 3, `${m}: the edges' residual burst ${c.toFixed(1)} dB over the original's`)
	}
	// the phrase under noise 40 dB down: a near-exact repeat 1.5 s away, joined in 5 ms
	let r = (s => () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)(5), loop = phrase(6 * fs).map(v => v + 0.003 * (r() * 2 - 1))
	let la = Math.round(3.2 * fs), lb = la + fs, ld = copy(loop).fill(0, la, lb), [l, h] = reach(ld, repair(ld, { fs, regions: [{ at: 3.2, duration: 1 }], method: 'similarity' }), la, lb)
	ok(l <= 5.03 && h <= 5.03, `a repeat transplanted: ${l.toFixed(1)} / ${h.toFixed(1)} ms rewritten either side`)
})

test('repair: edge cases: empty, one sample, shorter than a frame, silence, a zero-length region; finite always', () => {
	let cases = [[new Float32Array(0), 0, 0.01], [Float32Array.of(0.5), 0, 0.01], [sine(300, 1000, 0.5), 0.005, 0.005], [new Float32Array(fs), 0.4, 0.1], [sine(300, fs, 0.5), 0.5, 0]], bad = []
	for (let [x, at, duration] of cases) for (let method of ['ar', 'sinusoidal', 'similarity', 'spectral', 'auto']) for (let band of [{}, { from: 300, to: 3000 }]) {
		let y = repair(x, { fs, regions: [{ at, duration, ...band }], method }), tag = `${x.length} samples, ${duration * 1000} ms, ${method}${band.from ? ', band' : ''}`
		if (y.length !== x.length || !y.every(Number.isFinite)) bad.push(`${tag}: not finite`)
		if (!duration && !y.every((v, i) => v === x[i])) bad.push(`${tag}: changed`)
		if (x.every(v => v === 0) && !y.every(v => Math.abs(v) < 1e-6)) bad.push(`${tag}: silence not silent`)
	}
	ok(!bad.length, bad.join('; ') || `${cases.length * 10} cases: finite, silence silent, a zero-length region untouched`)
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

test('stft — short input (< N−hop) reconstructs instead of returning silence', () => {
	// Old batch bound `pos + N <= outLen + hop` never entered the loop for inputs
	// shorter than N−hop → all zeros. `while (pos < outLen)` runs at least one frame.
	let N = 2048, hop = 512
	let x = sine(440, 1200, 0.5)                            // 1200 < N−hop = 1536
	let out = stftBatch(x, (mag, phase) => ({ mag, phase }), { frameSize: N, hopSize: hop })
	ok(rms(out) > rms(x) * 0.1, `short input reconstructed, not zeroed (rms ${rms(out).toFixed(3)})`)
})

test('stft — batch tail reaches the last sample (not under-normalized)', () => {
	// Old bound stopped N−hop samples early, attenuating the final ~1536 samples.
	let N = 2048, hop = 512
	let x = sine(440, 20000, 0.5)
	let out = stftBatch(x, (mag, phase) => ({ mag, phase }), { frameSize: N, hopSize: hop })
	let seg = (d, a, b) => { let s = 0; for (let i = a; i < b; i++) s += d[i] * d[i]; return Math.sqrt(s / (b - a)) }
	ok(Math.abs(seg(out, 18500, 19900) / seg(x, 18500, 19900) - 1) < 0.05, 'tail amplitude within 5% of input')
})

test('gate — look-ahead keeps output aligned: no silence prefix, no dropped tail', () => {
	// Old delay-line look-ahead prepended `lookahead` samples of silence (and dropped
	// the same count off the tail). Future-indexed detection stays sample-aligned.
	let x = sine(440, 8192, 0.5)                            // −6 dBFS, gate stays wide open
	let out = gate(copy(x), { threshold: -60, attack: 0.0005, fs, lookahead: 0.005 })
	let la = Math.round(0.005 * fs)
	ok(rms(out.subarray(0, la)) > rms(x) * 0.3, 'first look-ahead samples are signal, not silence')
	ok(rms(out.subarray(x.length - la)) > rms(x) * 0.3, 'tail samples preserved, not dropped')
})

// =================== desilence / dewow (2026-08 atoms; depth lives in each package's own suite) ===================
import { desilence, silenceSegments, splitSilence, dewow, wowFlutter } from './index.js'

test('desilence — shortens long pauses in a burst/pause scene, keeps speech level, exposes a time map', () => {
  let seg = (n) => { let d = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * 150 * h * i / fs) / h; d[i] = 0.3 * s * Math.sin(Math.PI * i / n) } return d }   // voiced-like harmonic burst (the VAD gates on tonality)
  let gap = (s) => new Float32Array(Math.round(s * fs))
  let x = add(seg(Math.round(0.6 * fs)))
  let parts = [seg(Math.round(0.6 * fs)), gap(2), seg(Math.round(0.6 * fs)), gap(0.2), seg(Math.round(0.6 * fs))]
  let total = parts.reduce((n, p) => n + p.length, 0), off = 0
  x = new Float32Array(total); for (let p of parts) { x.set(p, off); off += p.length }
  x = add(x, noise(total, 0.001))                       // −60 dBFS floor: a real recording is never digital zero
  let { speech } = silenceSegments(x, { fs })
  ok(speech.length >= 2 && speech.length <= 3, 'speech segments ' + speech.length)
  let r = desilence(x, { fs, mode: 'shorten', maxSilence: 0.25, minSilence: 0.5 })
  ok(r.data.length < x.length - fs, 'removed at least 1 s: ' + ((x.length - r.data.length) / fs).toFixed(2) + ' s')
  ok(r.map.length >= 2 && r.removed > 1, 'map + removed seconds')
  is(splitSilence(x, { fs }).length, speech.length, 'split gives one array per phrase')
})

test('desilence — speech under noise keeps every word', () => {
  // 0.1 read silence under 11 dB over the input's 10th-percentile frame energy: under noise that is the noise, and at
  // 5 dB SNR `shorten` cut 7.4 s of lena's 12.3 s, 54 % of her loud frames
  let { x, n, loud } = lenaInNoise(5), r = desilence(x, { fs }), keep = new Uint8Array(loud.length), lost = 0
  for (let s of r.segments) for (let k = Math.floor(s.start * 100); k < Math.ceil(s.end * 100) && k < keep.length; k++) keep[k] = 1
  loud.forEach((l, k) => lost += l && !keep[k])
  is(lost, 0, `loud speech frames cut at 5 dB SNR: ${lost} (${r.removed.toFixed(2)} s removed)`)
  ok(r.data.every(Number.isFinite), 'finite output')
})

test('desilence — noise after speech is a pause', () => {
  // 1.5 s of lena, then 1.5 s of white noise at 0.02: 2.0.0 called the noise speech and cut nothing
  let s = 7, r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
  let sp = lena.subarray(0, Math.round(1.5 * fs)), x = new Float32Array(2 * sp.length)
  x.set(sp); for (let i = sp.length; i < x.length; i++) x[i] = 0.02 * (r() * 2 - 1)
  let o = desilence(x, { fs })
  ok(o.removed > 0.7, `the noise shortened as a pause: ${o.removed.toFixed(2)} s removed`)
  ok(o.segments[0].start === 0 && o.segments[0].end > 1.4, 'the speech whole')
})

test('desilence — a held note is not a pause; nothing to cut, nothing changed', () => {
  // a note held 3 s between two 0.7 s silences: the silences shorten, the note stays whole
  let x = pinkNoise(Math.round(4.4 * fs), 17).map(v => 3e-4 * v), a = Math.round(0.7 * fs), b = a + 3 * fs
  for (let i = a, ph = 0; i < b; i++) { ph += 2 * Math.PI * 150 / fs; for (let h = 1; h <= 10; h++) x[i] += 0.2 * Math.sin(h * ph) / h }
  let r = desilence(x, { fs })
  ok(r.segments.some(s => s.start <= a / fs && s.end >= b / fs), 'the note is one kept span: ' + JSON.stringify(r.segments.map(s => [+s.start.toFixed(2), +s.end.toFixed(2)])))
  ok(r.removed > 0.5 && r.removed < 1, `the two silences shortened: ${r.removed.toFixed(2)} s removed`)
  // continuous speech-like sound with no pause: the output is the input
  let note = x.subarray(a, b), out = desilence(note, { fs })
  ok(out.removed === 0 && out.data.every((v, i) => v === note[i]), 'no pause: bit-exact')
  // empty, a single sample, shorter than a frame: whole, unchanged
  for (let y of [new Float32Array(0), Float32Array.of(0.5), new Float32Array(1000).fill(0.25)]) {
    let o = desilence(y, { fs, mode: 'remove' })
    ok(o.data.length === y.length && o.removed === 0, `${y.length} samples: unchanged`)
  }
})

// wow by variable-rate resampling: x read at speed s(t), linear interpolation
function wowed(x, s) {
  let y = new Float32Array(x.length), pos = 0
  for (let i = 0; i < x.length; i++) { let p = Math.floor(pos), f = pos - p; y[i] = p + 1 < x.length ? x[p] * (1 - f) + x[p + 1] * f : 0; pos += s(i / fs) }
  return y
}
// independent notes: equal-tempered C4 E4 G♯4 D5, no two in a ratio of small whole numbers
const notes = n => add(...[261.63, 329.63, 415.3, 587.33].map(f => sine(f, n, 0.2)))
// a voice, harmonics 1..8 at 1/k, at pitch f(t)
function voice(f, n) { let x = new Float32Array(n), ph = 0; for (let i = 0; i < n; i++) { ph += 2 * Math.PI * f(i / fs) / fs; for (let h = 1; h <= 8; h++) x[i] += 0.2 / h * Math.sin(h * ph) } return x }
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

test('dewow — flattens a synthetic 2 % wow on independent notes; wowFlutter reports it', () => {
  let x = wowed(notes(4 * fs), t => 1 + 0.02 * Math.sin(2 * Math.PI * 0.8 * t))
  let a = wowFlutter(x, { fs })
  ok(a.wow > 1 && a.wow < 3, 'wow % measured ' + a.wow.toFixed(2))
  let fixed = dewow(copy(x), { fs })
  is(fixed.length, x.length, 'length preserved')
  let a2 = wowFlutter(fixed, { fs })
  ok(a2.wow < a.wow / 3, 'residual wow ' + a2.wow.toFixed(2) + ' % < ' + (a.wow / 3).toFixed(2))
})

test('dewow — a performer\'s pitch movement is not wow: a vibrato voice and a glide come back bit-exact', () => {
  // 0.1 took a voice's own vibrato and glides for speed (each track against its own median): the ±50-cent vibrato
  // came out at a fifth of its depth, the held note before a glide 89 cents sharp
  let vib = voice(t => 220 * 2 ** (50 / 1200 * Math.sin(2 * Math.PI * 5.5 * t)), 4 * fs)
  let glide = voice(t => t < 1.5 ? 220 : t < 2.5 ? 220 * 1.5 ** (t - 1.5) : 330, 4 * fs)
  ok(same(dewow(copy(vib), { fs }), vib), 'vibrato voice untouched')
  ok(same(dewow(copy(glide), { fs }), glide), 'glide untouched')
  is(wowFlutter(vib, { fs }).confidence, 0, 'one source: no evidence of speed')
})

test('dewow — clean pass-through: speech and steady notes untouched, bit-exact', () => {
  let speech = lena.subarray(0, 4 * fs), chord = notes(4 * fs)
  ok(same(dewow(copy(speech), { fs }), speech), 'speech')
  ok(same(dewow(copy(chord), { fs }), chord), 'independent notes, no wow')
  let st = [copy(chord), copy(speech)], out = dewow(st, { fs })
  ok(same(out[0], chord) && same(out[1], speech), 'stereo')
})

test('dewow — edge cases: empty, a single sample, shorter than a frame, silence; finite output', () => {
  is(dewow(new Float32Array(0), { fs }).length, 0, 'empty')
  is(dewow(Float32Array.of(0.25), { fs })[0], 0.25, 'one sample')
  let short = sine(440, 1000, 0.5)
  ok(same(dewow(copy(short), { fs }), short), 'shorter than the 4096-sample frame')
  ok(dewow(new Float32Array(fs), { fs }).every(v => v === 0), 'silence')
  let x = wowed(add(notes(2 * fs), noise(2 * fs, 0.05)), t => 1 + 0.03 * Math.sin(2 * Math.PI * 1.1 * t))
  ok(dewow(x, { fs }).every(Number.isFinite), 'noisy wowed notes: no NaN')
  ok(dewow(x, { fs, mode: 'reference', refFreq: 50 }).every(Number.isFinite) && dewow(x, { fs, mode: 'pitch' }).every(Number.isFinite), 'reference, pitch modes: no NaN')
})

// Manifests (audio.js) — the host's view: fixed blocks in, equal blocks out.
import { specsub as specsubAtom } from '@audio/denoise-spectral/audio'
import { dereverb as dereverbAtom } from '@audio/denoise-dereverb/audio'
import { omlsa as omlsaAtom } from '@audio/denoise-omlsa/audio'
import { wiener as wienerAtom } from '@audio/denoise-wiener/audio'
import specsubKernel from '@audio/denoise-spectral'
import dereverbKernel from '@audio/denoise-dereverb'
import omlsaKernel from '@audio/denoise-omlsa'
import wienerKernel from '@audio/denoise-wiener'

const defaults = atom => Object.fromEntries(Object.entries(atom.params).map(([k, s]) => [k, s.type === 'number' ? Float32Array.of(s.default) : s.default]))
function hostRun(atom, x, block) {
  let params = defaults(atom)
  let process = atom({ sampleRate: fs, maxBlockSize: block, maxChannels: 1, params }), out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i += block) {
    let n = Math.min(block, x.length - i), o = new Float32Array(n)
    process([[x.subarray(i, i + n)]], [[o]], params); out.set(o, i)
  }
  return out
}

test('STFT manifests — output is the kernel stream delayed by exactly the declared latency, under any block size', () => {
  // The kernel stream emits a sample up to FRAME − 1 samples late; an unprimed FIFO ran
  // dry during warm-up and zero-filled, so where the signal landed depended on the block size
  let x = add(sine(440, fs, 0.3), noise(fs, 0.05))
  let f = Math.fround   // hosts carry params as Float32Array
  // specsub, omlsa and wiener frame by the rate (the power of two nearest 32 ms: 1024 at 44.1 kHz), dereverb by 40 ms
  // and adds its look-ahead, and declare their latency per rate; their kernels left to their own framing must land
  // where the manifests say
  let cases = [
    [specsubAtom, () => specsubKernel({ alpha: 0, beta: f(0.05), fs })],
    [dereverbAtom, () => dereverbKernel({ lookahead: f(0.25), fs })],
    [omlsaAtom, () => omlsaKernel({ alphaDD: f(0.97), xiMin: 10 ** (-25 / 10), qPrior: 0, gMin: -15, fs })],
    [wienerAtom, () => wienerKernel({ rule: 'mmse-lsa', alphaDD: f(0.98), xiMin: 10 ** (-15 / 10), fs })],
  ]
  for (let [atom, kernel] of cases) {
    let write = kernel(), parts = [], L = typeof atom.latency === 'function' ? atom.latency({ sampleRate: fs, params: defaults(atom) }) : atom.latency
    for (let i = 0; i < x.length; i += 333) parts.push(write(x.subarray(i, i + 333)))
    let ref = new Float32Array(x.length), o = 0
    for (let p of parts) { ref.set(p.subarray(0, x.length - o), o); o += p.length }
    for (let block of [2048, 997, 64, 1]) {
      let out = hostRun(atom, x, block), err = 0
      for (let i = 0; i < L; i++) err = Math.max(err, Math.abs(out[i]))
      for (let i = L; i < x.length; i++) err = Math.max(err, Math.abs(out[i] - ref[i - L]))
      ok(err === 0, `${atom.name}: block ${block}, latency ${L}: max deviation ${err}`)
    }
  }
})

test('specsub, omlsa, wiener: frame of the power of two nearest 32 ms at each rate, latency declared to match', () => {
  for (let atom of [specsubAtom, omlsaAtom, wienerAtom])
    is([16000, 22050, 44100, 48000].map(sampleRate => atom.latency({ sampleRate }) + 1).join(), '512,512,1024,2048', atom.name)
})
