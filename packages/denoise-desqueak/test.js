// De-squeak on synthesized guitar: plucked notes (decaying harmonic partials, a pick's click), a squeak between them (a
// fingertip sliding along a wound string: a pulse per winding crossed, at v/d, the hand's speed rising and falling as a
// minimum-jerk move; Pakarinen, Penttinen & Bank, JASA 122(6), 2007), hiss. audio's bench/rx/guitar.mjs measures it on
// GuitarSet against iZotope RX 12; here, what must hold whatever the tuning.

import test, { ok, is } from 'tst'
import desqueak, { frame } from './desqueak.js'

const fs = 44100
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5 }
const db = v => 10 * Math.log10(v)
const E = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s }
const Ed = (x, y, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += (x[i] - y[i]) ** 2; return s }

// a plucked note at `at` s: partials h·f0 at 1/h² (a string released from a triangle, Fletcher & Rossing, The Physics of
// Musical Instruments, 1998, §2.7), decaying faster the higher; a 1 ms click of noise at its start
function pluck(x, at, f0, amp, r) {
  let i0 = Math.round(at * fs)
  for (let h = 1; h * f0 < 12000; h++) {
    let a = amp / h / h, tau = 1.2 / (1 + 0.3 * h), ph = 2 * Math.PI * (r() + 0.5)
    for (let i = i0; i < x.length; i++) x[i] += a * Math.sin(2 * Math.PI * h * f0 * (i - i0) / fs + ph) * Math.exp(-(i - i0) / fs / tau)
  }
  for (let i = 0; i < fs / 1000; i++) x[i0 + i] += amp * 0.3 * r()
}
function guitar(seed, notes = [[0.2, 110], [0.9, 147], [1.6, 196], [2.3, 131]]) {
  let r = lcg(seed), x = new Float32Array(3 * fs)
  for (let [at, f0] of notes) pluck(x, at, f0, 0.2, r)
  return x
}
// a slide over a wound string (0.33 mm windings), T s from `at`, peaking at vmax m/s
function squeak(x, at, T, vmax, amp, seed) {
  let r = lcg(seed), n = Math.round(T * fs), D = vmax * T / 1.875, d = 0.33e-3, s = new Float64Array(n + 400), h = Float64Array.from({ length: 40 }, (_, i) => r() * Math.exp(-i / 6))
  let pos = t => D * (10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5), vel = t => 30 * D / T * t * t * (1 - t) ** 2
  for (let j = 1, i = 0; ; j++) {
    while (i < n && pos(i / n) < j * d) i++
    if (i >= n) break
    let a = Math.sqrt(vel(i / n) / vmax)
    for (let k = 0; k < h.length; k++) s[i + k] += a * h[k]
  }
  let m = 0; for (let v of s) m = Math.max(m, Math.abs(v))
  let i0 = Math.round(at * fs)
  for (let i = 0; i < s.length; i++) x[i0 + i] += amp * s[i] / m
  return [i0, i0 + s.length]
}

test('desqueak: the frame is the power of two nearest 23 ms', () => {
  is(frame(44100), 1024); is(frame(48000), 1024); is(frame(22050), 512); is(frame(96000), 2048)
})

test('desqueak: notes alone come back sample for sample', () => {
  let x = guitar(1), y = desqueak(x.slice(), { fs })
  ok(y.every((v, i) => v === x[i]), 'nothing found, nothing changed')
})

test('desqueak: a squeak between notes taken down, the notes kept', () => {
  let x = guitar(2), dirty = x.slice(), [a, b] = squeak(dirty, 0.62, 0.15, 0.6, 0.05, 3)
  let y = desqueak(dirty.slice(), { fs })
  let gone = db(Ed(dirty, x, a, b) / Ed(y, x, a, b))
  ok(gone > 10, `${gone.toFixed(1)} dB of the squeak gone`)
  // the notes before and after, beyond the squeak's 10 ms either side: sample for sample
  let w = Math.round(0.01 * fs), out = 0
  for (let i = 0; i < x.length; i++) if (i < a - w || i >= b + w) out += Math.abs(y[i] - dirty[i]) > 0
  is(out, 0, 'the take outside the squeak untouched')
})

test('desqueak: squeak 0 leaves the take', () => {
  let x = guitar(2), dirty = x.slice(); squeak(dirty, 0.62, 0.15, 0.6, 0.05, 3)
  let y = desqueak(dirty.slice(), { fs, squeak: 0 })
  ok(y.every((v, i) => v === dirty[i]))
})

test('desqueak: pick softens an attack made harsh, the note kept', () => {
  // the harshness: noise differenced twice (rising 12 dB an octave, its power over 2 kHz), decaying in 2 ms
  let x = guitar(4), harsh = x.slice(), r = lcg(5), spans = []
  for (let at of [0.2, 0.9, 1.6, 2.3]) {
    let i0 = Math.round(at * fs), u = [r(), r(), r()]
    for (let i = 0; i < 0.008 * fs; i++) { u = [u[1], u[2], r()]; harsh[i0 + i] += 0.1 * (u[2] - 2 * u[1] + u[0]) * Math.exp(-i / (0.002 * fs)) }
    spans.push([i0 - 100, i0 + Math.round(0.03 * fs)])
  }
  let y = desqueak(harsh.slice(), { fs, squeak: 0, pick: -12 })
  let e0 = 0, e1 = 0; for (let [a, b] of spans) e0 += Ed(harsh, x, a, b), e1 += Ed(y, x, a, b)
  ok(db(e0 / e1) > 5, `${db(e0 / e1).toFixed(1)} dB of the harsh attacks gone`)
  // the notes 50 ms on, and their partials: untouched
  let i0 = Math.round(0.95 * fs)
  ok(y.subarray(i0, i0 + fs / 2).every((v, i) => v === harsh[i0 + i]), 'the sustain sample for sample')
})

test('desqueak: amp takes steady hiss down between notes, the notes kept', () => {
  let x = new Float32Array(3.5 * fs), r = lcg(6)
  for (let [at, f0] of [[1, 110], [1.8, 165], [2.6, 220]]) pluck(x, at, f0, 0.2, r)
  let n = Float32Array.from(x, () => 0.002 * r()), mix = x.map((v, i) => v + n[i])
  let yp = desqueak(mix.slice(), { fs, squeak: 0, amp: -20 }), ym = desqueak(x.map((v, i) => v - n[i]), { fs, squeak: 0, amp: -20 })
  // phase inversion (Hagerman & Olofsson 2004): the noise left, the guitar kept; the lead-in second (the amp alone)
  let res = yp.map((v, i) => (v - ym[i]) / 2), gtr = yp.map((v, i) => (v + ym[i]) / 2), a = Math.round(0.1 * fs), b = Math.round(0.9 * fs)
  ok(db(E(n, a, b) / E(res, a, b)) > 18, `${db(E(n, a, b) / E(res, a, b)).toFixed(1)} dB of hiss gone before the playing`)
  ok(db(E(x) / Ed(gtr, x)) > 40, `the guitar's SDR ${db(E(x) / Ed(gtr, x)).toFixed(1)} dB`)
})

// 0.2 took a buzz down by gain alone, as it does hiss, and a gain can't part a buzz line from a partial in its bin: under
// a 60 Hz buzz to 8 kHz, 30 dB under four notes, its frequency wandering ±0.02 Hz, 4.8 dB of the buzz went and the
// notes came out at 46.3 dB SDR. The lines are subtracted now, each held through the take.
test('desqueak: amp subtracts a steady buzz, the notes kept', () => {
  let x = new Float32Array(4 * fs), r = lcg(6)
  for (let [at, f0] of [[1, 110], [1.8, 165], [2.6, 220], [3.2, 147]]) pluck(x, at, f0, 0.2, r)
  let b = new Float32Array(x.length), ph = 0
  for (let i = 0; i < b.length; i++) { ph += 2 * Math.PI * (60 + 0.02 * Math.sin(2 * Math.PI * i / fs / 5)) / fs; for (let h = 1; h * 60 <= 8000; h++) b[i] += (h % 2 ? 1 : 0.3) / Math.sqrt(h) / Math.hypot(1, h * 60 / 3000) * Math.sin(h * ph + h * h) }
  let g = Math.sqrt(E(x) / E(b)) * 10 ** (-30 / 20), n = b.map(v => g * v)
  let yp = desqueak(x.map((v, i) => v + n[i]), { fs, squeak: 0, amp: -20 }), ym = desqueak(x.map((v, i) => v - n[i]), { fs, squeak: 0, amp: -20 })
  let res = yp.map((v, i) => (v - ym[i]) / 2), gtr = yp.map((v, i) => (v + ym[i]) / 2)
  ok(db(E(n) / E(res)) > 15, `${db(E(n) / E(res)).toFixed(1)} dB of the buzz gone`)
  ok(db(E(x) / Ed(gtr, x)) > 50, `the notes' SDR ${db(E(x) / Ed(gtr, x)).toFixed(1)} dB`)
})

test('desqueak: short input, digital silence, Float64Array', () => {
  let s = new Float32Array(500).map((_, i) => Math.sin(i / 7))
  ok(desqueak(s.slice(), { fs, pick: -9, amp: -20 }).every((v, i) => v === s[i]), 'shorter than a frame: as it came')
  let z = new Float32Array(fs)
  ok(desqueak(z, { fs, pick: -9, amp: -20 }).every(v => v === 0), 'silence stays silence')
  let x = Float64Array.from(guitar(1)), y = desqueak(x.slice(), { fs })
  ok(y instanceof Float64Array && y.every((v, i) => v === x[i]))
})
