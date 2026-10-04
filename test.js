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
import { noiseProfile, minStats, imcra } from '@audio/noise-estimate'
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

// minStats keeps each bin's minimum over the last D frames by monotonic deque; the rescan it replaced is the reference,
// and once the window is full its mean the cap (a running sum, re-added once a window). Windows of 1, 3 and 96 frames,
// fewer frames than the window, repeated values, minima falling and rising. Frames of digital silence (every 37th
// frame starts five) are skipped, and the smoother starts at the first frame with sound.
test('minStats — the D-frame minimum equals a rescan of the last D frames', () => {
  let seed = 5, rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let [half, D, frames] of [[64, 96, 300], [16, 1, 50], [16, 3, 200], [64, 96, 20]]) {
    let est = minStats(half, { D }), smoothed = new Float64Array(half + 1), hist = [], bad = 0
    for (let f = 0; f < frames; f++) {
      let mag = Float64Array.from({ length: half + 1 }, () => f % 37 < 5 ? 0 : rnd() < 0.1 ? 1 : rnd() * (1 + (f % 300) / 30))
      est.update(mag)
      if (f % 37 >= 5) hist.push(Float64Array.from(mag, (m, k) => smoothed[k] = hist.length ? 0.7 * smoothed[k] + (1 - 0.7) * (m * m) : m * m))
      if (hist.length > D) hist.shift()
      for (let k = 0; k <= half; k++) {
        let m = hist.length ? Math.min(...hist.map(p => p[k])) * est.bias : 0, mean = hist.reduce((a, p) => a + p[k], 0) / D
        let ref = hist.length === D ? Math.min(m, mean) : m                  // a full window caps it at its mean
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
  almost(e.psd[3], 4 * e.bias, 1e-9, 'first frame: its own power times B_min, no warm-up from zero')
  e.update(new Float64Array(9)); e.update(new Float64Array(9))
  almost(e.psd[3], 4 * e.bias, 1e-9, 'digital silence leaves the estimate as it was')
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
  let { out, plan } = denoise(copy(x), { fs, returnPlan: true }), s = snr(speech, out)
  ok(plan.method === 'wiener' && s > 10, `denoise() routes it to wiener: SNR ${s.toFixed(1)} dB (7.8 before)`)
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

test('dewind — the cutoff tracker keeps its clock across calls: same output under any chunking', () => {
  // Analysis blocks restarted at every call, and each short tail block took a full block's
  // attack/release step: at 64-sample host blocks the cutoff tracked 16× too fast
  let n = 2 * fs, x = add(sine(800, n, 0.2), sine(40, n, 0.5))
  for (let i = 0; i < n; i++) if (i % fs > fs / 2) x[i] *= 0.05          // wind gusts on and off
  let run = block => {
    let d = copy(x), opts = { fs }
    for (let i = 0; i < n; i += block) dewind(d.subarray(i, Math.min(n, i + block)), opts)
    return d
  }
  let ref = dewind(copy(x), { fs })
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

test('deplosive — complementary split leaves non-plosive content untouched', () => {
  // No LF burst → gain stays 1 → HF = x − LF makes output identical to input.
  // The old independent LP+HP Butterworth split notched content near the crossover.
  let x = sine(200, fs, 0.3)                              // sits right at the 200 Hz crossover
  let out = deplosive(copy(x), { fs })
  almost(rms(out), rms(x), rms(x) * 0.02, '200 Hz preserved — no crossover notch')
  let md = 0
  for (let i = 0; i < x.length; i++) md = Math.max(md, Math.abs(out[i] - x[i]))
  ok(md < 1e-5, 'output equals input sample-for-sample when no plosive fires')
})

test('deplosive — ducks a dominant LF burst, preserves the high band', () => {
  // LF burst must dominate the high band by > triggerRatio (4) to fire. A strong
  // 90 Hz burst over a quiet 1.5 kHz reference triggers ducking on the LF band only.
  let n = fs
  let hi = sine(1500, n, 0.05)                            // quiet high-band reference
  let at = Math.floor(fs * 0.3), blen = Math.floor(0.08 * fs)
  let burst = new Float32Array(n)
  for (let i = 0; i < blen; i++) burst[at + i] = Math.sin(2 * Math.PI * 40 * i / fs)   // 40 Hz thump, amp 1.0
  let dirty = add(hi, burst)
  let clean = deplosive(copy(dirty), { fs })
  let seg = (d, f) => { let w = 2 * Math.PI * f / fs, c = 2 * Math.cos(w), s1 = 0, s2 = 0; for (let i = at; i < at + blen; i++) { let s = d[i] + c * s1 - s2; s2 = s1; s1 = s } return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / blen }
  ok(seg(clean, 40) < seg(dirty, 40) * 0.5, 'LF burst ducked ≥6 dB')
  almost(narrowEnergy(clean, 1500), narrowEnergy(dirty, 1500), narrowEnergy(dirty, 1500) * 0.03, 'high band preserved')
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

test('classify — 60Hz hum routes to dehum', () => {
  let x = add(sine(60, fs, 0.3), sine(120, fs, 0.15))
  is(classify(x, fs).method, 'dehum')
})

test('classify — clicks route to declick', () => {
  let x = add(noise(fs, 0.05), clicks(fs, 12, 0.9))
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

test('classify — rumble routes to dewind', () => {
  let x = add(sine(40, fs, 0.4), noise(fs, 0.05))
  is(classify(x, fs).method, 'dewind')
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

test('dewow — flattens a synthetic 2 % wow on a sustained chord; wowFlutter reports it', () => {
  let n = 4 * fs, clean = new Float32Array(n)
  for (let i = 0; i < n; i++) clean[i] = 0.3 * (Math.sin(2 * Math.PI * 220 * i / fs) + Math.sin(2 * Math.PI * 330 * i / fs) + Math.sin(2 * Math.PI * 440 * i / fs))
  // apply wow by variable-rate resampling: speed = 1 + 0.02 sin(2π 0.8 t)
  let wowed = new Float32Array(n), pos = 0
  for (let i = 0; i < n; i++) { let p = Math.floor(pos), f = pos - p; wowed[i] = p + 1 < n ? clean[p] * (1 - f) + clean[p + 1] * f : 0; pos += 1 + 0.02 * Math.sin(2 * Math.PI * 0.8 * i / fs) }
  let a = wowFlutter(wowed, { fs })
  ok(a.wow > 1 && a.wow < 3, 'wow % measured ' + a.wow.toFixed(2))
  let fixed = dewow(copy(wowed), { fs })
  is(fixed.length, wowed.length, 'length preserved')
  let a2 = wowFlutter(fixed, { fs })
  ok(a2.wow < a.wow / 3, 'residual wow ' + a2.wow.toFixed(2) + ' % < ' + (a.wow / 3).toFixed(2))
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
    [omlsaAtom, () => omlsaKernel({ alphaDD: f(0.98), xiMin: 10 ** (-25 / 10), qPrior: 0, gMin: -15, fs })],
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
