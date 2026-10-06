// De-bleed: the bleed's lead. A source tens of ms from the mic puts its path in the filter's later partitions; the
// prior's room decay starts there (0.2.0 started it at no delay: the path fell where the prior was 5 dB down, and the
// empty partitions before it took up the voice). The batch call reads the lead from the whole take.
// audio-lena for the wanted voice; a click track (1.5 kHz, 5 ms decay, twice a second) through a room, deterministic.

import test, { ok } from 'tst'
import raw from 'audio-lena/raw'
import debleed from './debleed.js'

const fs = 44100
const lena = new Float32Array(raw)
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5 }
// the direct sound after `ms`, 40 ms of diffuse tail decaying 60 dB in 0.15 s, unit energy
function room(ms, seed) {
  let r = lcg(seed), d = Math.round(ms * fs / 1000), h = new Float32Array(d + Math.round(0.04 * fs)), e = 0
  h[d] = 1
  for (let i = d + 1; i < h.length; i++) h[i] = 0.5 * r() * 10 ** (-3 * (i - d) / (0.15 * fs))
  for (let v of h) e += v * v
  return h.map(v => v / Math.sqrt(e))
}
const conv = (x, h) => { let y = new Float32Array(x.length); for (let j = 0; j < h.length; j++) if (h[j]) for (let i = j; i < x.length; i++) y[i] += h[j] * x[i - j]; return y }
function clicks(n) {
  let x = new Float32Array(n)
  for (let t = 0; t < n; t += fs / 2) for (let i = 0; i < 400 && t + i < n; i++) x[t + i] = 0.5 * Math.sin(2 * Math.PI * 1500 * i / fs) * Math.exp(-i / 80)
  return x
}
const db = x => 10 * Math.log10(x)

// the take and the take with the bleed inverted (Hagerman & Olofsson 2004): the bleed left from 1 s on, dB under the
// bleed; the voice's error, dB under the voice
test('debleed: a click track 25 ms away: the batch call reads the lead and cancels it (0.2.0: 10.1 dB)', () => {
  let n = 4 * fs, s = lena.slice(0, n), x = clicks(n), b = conv(x, room(25, 1))
  let yp = debleed(s.map((v, i) => v + b[i]), x, { fs }), ym = debleed(s.map((v, i) => v - b[i]), x.map(v => -v), { fs })
  let e0 = 0, e1 = 0, d = 0, p = 0
  for (let i = 0; i < n; i++) { let left = (yp[i] - ym[i]) / 2, kept = (yp[i] + ym[i]) / 2; if (i >= fs) e0 += b[i] ** 2, e1 += left * left; d += (kept - s[i]) ** 2; p += s[i] ** 2 }
  ok(db(e0 / e1) > 15, `${db(e0 / e1).toFixed(1)} dB of the bleed gone`)
  ok(db(d / p) < -25, `the voice's error ${db(d / p).toFixed(1)} dB`)
})

test('debleed: a click track never heard: no lead read, the voice left alone', () => {
  let n = 4 * fs, s = lena.slice(0, n), y = debleed(s.slice(), clicks(n), { fs }), e = 0, p = 0
  for (let i = 0; i < n; i++) e += (y[i] - s[i]) ** 2, p += s[i] ** 2
  ok(db(e / p) < -30, `the voice changed by ${db(e / p).toFixed(1)} dB`)
})
