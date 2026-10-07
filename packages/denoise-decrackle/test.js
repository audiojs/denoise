// decrackle 0.4: each event judged against the sound's own excitation (the umbrella's test.js covers the rest). Run:
// node test.js
import test, { ok } from 'tst'
import raw from 'audio-lena/raw'
import decrackle from './decrackle.js'

const fs = 44100, lena = new Float32Array(raw)
const sdr = (c, y) => { let s = 0, e = 0; for (let i = 0; i < c.length; i++) s += c[i] ** 2, e += (y[i] - c[i]) ** 2; return 10 * Math.log10(s / e) }
const moved = (x, y) => x.reduce((c, v, i) => c + (v !== y[i]), 0) / x.length
const lcg = seed => { let s = seed; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }

// a vowel with no recording in it: two formants (700 and 1200 Hz) rung by a pulse every 6.7 ms (150 Hz), over breath
// 34 dB down; peak 0.5
function vowel(n) {
  let r = lcg(1), e = Float64Array.from({ length: n }, (_, i) => 0.02 * (r() - 0.5) + (i % 294 ? 0 : 1))
  let ring = (x, f, bw) => {
    let R = Math.exp(-Math.PI * bw / fs), a1 = 2 * R * Math.cos(2 * Math.PI * f / fs), y = new Float64Array(x.length)
    for (let i = 0; i < x.length; i++) y[i] = x[i] + a1 * (y[i - 1] || 0) - R * R * (y[i - 2] || 0)
    return y
  }
  let y = ring(ring(e, 700, 80), 1200, 100), pk = y.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  return Float32Array.from(y, v => 0.5 * v / pk)
}
// crackle as scripts/decrackle.js makes it: impulses at Poisson times, half 1–3 samples off, half ticks ringing at
// 2–8 kHz for 0.03–0.15 ms, peaking at A/5–A × the sound's RMS
function crackle(x, rate, A, seed = 1) {
  let r = lcg(seed), d = Float32Array.from(x), g = Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
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

test('decrackle — a vowel\'s pulses are its own excitation, no crackle: left as recorded', () => {
  // 0.3.1 took each pulse for crackle: 17.7 % of the samples moved, to −63 dB
  let x = vowel(2 * fs), y = decrackle(x, { fs })
  ok(moved(x, y) === 0, `${(100 * moved(x, y)).toFixed(2)} % of the samples moved`)
})

test('decrackle — speech under crackle: the crackle still taken', () => {
  // 0.3.1: 20.7 → 33.5 dB; the events its excitation explains as well, left
  let x = lena.subarray(0, 2 * fs), d = crackle(x, 200, 2, 3), y = decrackle(d, { fs })
  ok(sdr(x, y) > sdr(x, d) + 10, `SDR ${sdr(x, d).toFixed(1)} → ${sdr(x, y).toFixed(1)} dB`)
})
