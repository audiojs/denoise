// classify()'s noise bed against steady tones: a line is no bed, whatever the road, and a bed under a line reads at its
// own level. Deterministic takes, 6 s, as scripts/tonebed.mjs makes them (its matrix and lines sections measure every
// rate and shape; these hold the property on a cross-section of them).

import test, { ok, is } from 'tst'
import { classify, BED_SNR } from './denoise.js'

const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r())
const sine = f => t => Math.sin(2 * Math.PI * f * t)
const chord = t => [261.63, 329.63, 392].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) / 3
const reed = (t, fs) => { let s = 0; for (let h = 1; 196 * h < 0.45 * fs; h++) s += Math.sin(2 * Math.PI * 196 * h * t + h) / h; return s / 2 }
const sweep = (t, fs) => { let k = Math.log(0.45 * fs / 50); return Math.sin(2 * Math.PI * 50 * 5 / k * (Math.exp(k * (t - 0.5) / 5) - 1)) }
const on = t => t >= 0.5 && t < 5.5
const bursts = t => (t >= 0.5 && t < 2) || (t >= 3.5 && t < 5)
// the shape at 0.4 peak where `gain(t)` is 1, `gain(t)` times that elsewhere, 6 s
function take(shape, fs, gain = t => on(t) ? 1 : 0) {
  let x = Float64Array.from({ length: 6 * fs }, (_, i) => gain(i / fs) * shape(i / fs, fs)), pk = 0
  for (let i = 0; i < x.length; i++) if (gain(i / fs) === 1) pk = Math.max(pk, Math.abs(x[i]))
  return Float32Array.from(x, v => 0.4 * v / pk)
}
// a 16-bit file's: rounded to 1/32768 over TPDF dither of ±1 LSB
const dither = (x, seed) => { let r = lcg(seed); return x.map(v => Math.round(v * 32768 + r() - r()) / 32768) }
const tonePower = x => { let s = 0, c = 0; for (let v of x) if (v !== 0) { s += v * v; c++ } return s / c }
const f1 = v => v === Infinity ? '∞' : v.toFixed(1)
const noBed = (x, fs, name) => { let c = classify(x, fs); ok(c.scores.snr >= BED_SNR && c.method !== 'omlsa', `${name}: ${c.method}, bed ${f1(c.scores.snr)} dB under`) }

// Nothing lies between or under a tone over digital silence but zeros, and under one over a 16-bit file's dither but
// the dither, 80 dB and more down: the quietest frames that are no silence are the tone's, and a take that never
// stands 6 dB over them has no pauses to read a bed in.
test('classify: tones over digital silence or a 16-bit file\'s dither read no bed', () => {
  let shapes = { '1 kHz': [sine(1000)], '300 Hz bursts': [sine(300), t => bursts(t) ? 1 : 0], chord: [chord], sweep: [sweep], reed: [reed] }
  let seed = 1
  for (let [name, [shape, gain]] of Object.entries(shapes)) for (let fs of [8000, 16000, 44100, 48000]) {
    let x = take(shape, fs, gain)
    noBed(x, fs, `${name} over silence, ${fs} Hz`)
    noBed(dither(x, seed++), fs, `${name} over dither, ${fs} Hz`)
  }
})

// Two roads by which a line alone reads as a bed: a tone or a chord stepping 20 dB down with nothing under it, whose
// quiet half holds the line held a second on and its leakage, flat and held, as noise with its own lines would (a band
// held within 0.05 of 1 draws nothing anew); a tone alone over dither, its own frames its pauses (a take never
// standing 6 dB over its quietest tenth has none).
test('classify: a line alone is no bed: a step down, a tone alone over dither', () => {
  for (let fs of [16000, 44100, 48000]) {
    for (let [name, shape] of [['1 kHz', sine(1000)], ['chord', chord], ['reed', reed]])
      noBed(take(shape, fs, t => t < 3 ? 1 : 0.1), fs, `${name} stepping 20 dB down, ${fs} Hz`)
    noBed(dither(take(sine(1000), fs, () => 1), 2), fs, `1 kHz alone over dither, ${fs} Hz`)
    noBed(dither(take(sine(1000), fs, () => 1).map(v => v / 40), 2), fs, `1 kHz alone at −40 dBFS over dither, ${fs} Hz`)
  }
})

// A bed under a tone shows between and around it: white noise 20, 30, 40 dB under the tone's power reads within 2 dB of
// that (1.7 at most, scripts/tonebed.mjs matrix: the steady bands sum the bed over the bands they hold, which stop
// short of fs/2 by up to half an octave), a bed under 20 dB and none at 30 and 40; radio static, white noise fading
// ±4 dB every 20 ms, which no steady band holds, reads in the pauses. The bursts' program holds the bed's frames between
// them, so they read 1.3 to 2.7 dB under (of the bed at 20 and 30 dB): a bed there too.
test('classify: a bed under a tone reads at its level', () => {
  let seed = 100
  for (let [name, shape] of [['1 kHz', sine(1000)], ['chord', chord], ['sweep', sweep], ['reed', reed]]) for (let fs of [8000, 16000, 44100, 48000]) for (let db of [20, 30, 40]) {
    let x = take(shape, fs), r = lcg(seed++), g = Math.sqrt(tonePower(x) / 10 ** (db / 10)), c = classify(x.map(v => v + g * gauss(r)), fs)
    ok(Math.abs(c.scores.snr - db) <= 2, `${name} over white noise ${db} dB under, ${fs} Hz: bed ${f1(c.scores.snr)} dB under`)
    is(c.method === 'omlsa', db < BED_SNR, `${name}, ${db} dB, ${fs} Hz: ${c.method}`)
  }
  for (let fs of [8000, 48000]) {
    let x = take(sine(300), fs, t => bursts(t) ? 1 : 0), r = lcg(seed++), g = Math.sqrt(tonePower(x) / 100), c = classify(x.map(v => v + g * gauss(r)), fs)
    is(c.method, 'omlsa', `300 Hz bursts over white noise 20 dB under, ${fs} Hz: bed ${f1(c.scores.snr)} dB under`)
  }
  for (let fs of [44100, 48000]) {
    let x = take(sine(1000), fs), r = lcg(9), q = lcg(4), a = Math.sqrt(tonePower(x) / 100 * 3), g = 1, step = Math.round(0.02 * fs)
    let y = x.map((v, i) => { if (i % step === 0) g = 10 ** ((q() * 2 - 1) * 4 / 20); return v + g * a * (r() * 2 - 1) })
    let c = classify(y, fs)
    ok(c.method === 'omlsa' && Math.abs(c.scores.snr - 20) <= 2, `1 kHz over radio static 20 dB under, ${fs} Hz: ${c.method}, bed ${f1(c.scores.snr)} dB under`)
  }
})

// A voice's syllables (glottal pulses through two formants, 0.2 s on in every 0.35 s), as the root suite makes them
function syllables(n, fs) {
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
const rms = x => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
// the root suite's beds under a voice: a low rumble, a fan (lines over a hiss), radio static with its buzz; and white noise
const beds = {
  rumble: (v, fs) => { let a = rms(v), r = lcg(5), k = Math.exp(-2 * Math.PI * 150 / fs), l1 = 0, l2 = 0; return v.map(s => { l1 = k * l1 + (1 - k) * (r() * 2 - 1); l2 = k * l2 + (1 - k) * l1; return s + l2 * a / 0.0577 }) },
  fan: (v, fs) => { let a = rms(v), r = lcg(9); return v.map((s, i) => { let x = s + 0.05 * a * (r() * 2 - 1) * Math.sqrt(3); for (let h = 1; h <= 8; h++) x += 0.3 * a / h * Math.sin(2 * Math.PI * 137 * h * i / fs); return x }) },
  'radio static': (v, fs) => {
    let a = rms(v), r = lcg(9), q = lcg(4), g = 1, step = Math.round(0.02 * fs)
    return v.map((s, i) => { if (i % step === 0) g = 10 ** ((q() * 2 - 1) * 4 / 20); let b = 0; for (let h = 2; h <= 40; h++) b += Math.sin(2 * Math.PI * 172 * h * i / fs + h); return s + 0.25 * a * (g * (r() * 2 - 1) * Math.sqrt(3) + b / Math.sqrt(39)) })
  },
  white: (v, fs) => { let a = rms(v), r = lcg(11); return v.map(s => s + 0.1 * a * gauss(r)) },
}
const zeros = n => new Float32Array(Math.round(n))
const cat = (...xs) => { let y = new Float32Array(xs.reduce((s, x) => s + x.length, 0)), o = 0; for (let x of xs) { y.set(x, o); o += x.length } return y }

// A bed lies under the voice whatever digital silence the file holds beside it: a lead-in of exact zeros, or zeros
// between phrases (takes joined, an edit's gaps). The pauses that hold the bed read it as they do without the zeros,
// which are no pause of the program's but the file's: within 1 dB (they read within 0.1, as 0.8.0 does). Radio
// static's buzz counts as the bed's own only where pause frames a second apart hold it; this voice repeats every
// 0.35 s, and 0.5 s gaps leave no such pair, so its gaps are not asked of it.
test('classify: a bed under a voice reads as before with digital silence beside it, a lead-in or gaps between phrases', () => {
  const fs = 44100, v = syllables(4 * fs, fs), cut = [Math.round(1.325 * fs), Math.round(2.725 * fs)]
  for (let [name, bed] of Object.entries(beds)) {
    let x = bed(v, fs), base = classify(x, fs)
    is(base.method, 'omlsa', `${name} under a voice: bed ${f1(base.scores.snr)} dB under`)
    let forms = { 'a lead-in of zeros, 15 % of the take': cat(zeros(x.length * 0.15 / 0.85), x) }
    if (name !== 'radio static') forms['0.5 s of zeros between three phrases'] = cat(x.subarray(0, cut[0]), zeros(0.5 * fs), x.subarray(cut[0], cut[1]), zeros(0.5 * fs), x.subarray(cut[1]))
    for (let [form, y] of Object.entries(forms)) {
      let c = classify(y, fs)
      ok(c.method === 'omlsa' && Math.abs(c.scores.snr - base.scores.snr) <= 1, `${name} under a voice, ${form}: ${c.method}, bed ${f1(c.scores.snr)} dB under (${f1(base.scores.snr)} without)`)
    }
  }
})
