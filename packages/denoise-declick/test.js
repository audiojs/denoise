// declick 0.4: a click's extent, its ring and its rebuild (the umbrella's test.js covers the rest). Run: node test.js
import test, { ok } from 'tst'
import raw from 'audio-lena/raw'
import declick from './declick.js'

const fs = 44100, speech = new Float32Array(raw).subarray(0, fs * 3)
const err = (p, q, a, b) => { let s = 0; for (let i = a; i < b; i++) s += (p[i] - q[i]) ** 2; return s }

// every 0.3 s, h scaled to k × the speech's RMS over ±10 ms; how much of the error is gone from 1 ms before each to
// 20 ms after it (dB)
function gone(h, k) {
  let d = Float32Array.from(speech), at = []
  for (let t = Math.round(0.25 * fs); t < speech.length - 0.25 * fs; t += Math.round(0.3 * fs)) {
    let e = 0
    for (let i = t - 441; i < t + 441; i++) e += speech[i] ** 2
    for (let j = 0; j < h.length; j++) d[t + j] += k * Math.sqrt(e / 882) * h[j]
    at.push(t)
  }
  let y = declick(Float32Array.from(d), { fs }), before = 0, after = 0
  for (let t of at) before += err(d, speech, t - 44, t + h.length + 882), after += err(y, speech, t - 44, t + h.length + 882)
  return 10 * Math.log10(before / after)
}

test('declick — a spike decaying over six samples, its last sample too', () => {
  // 0.3.0 (the onset's gap ended a sample short; a gap over all the error's span was the only longer one): 10.1 dB
  let g = gone(Array.from({ length: 6 }, (_, j) => Math.exp(-j / 2)), 5)
  ok(g > 25, `${g.toFixed(1)} dB gone`)
})

test('declick — a faint tick rings on from its first sample: the gap over that sample alone', () => {
  // 5 kHz decaying in 0.2 ms at 2× the speech; 0.3.0 (the gap over the onset ±0.1 ms, or longer): 23.3 dB
  let t = 0.2 * fs / 1000, g = gone(Array.from({ length: Math.ceil(5 * t) }, (_, n) => Math.exp(-n / t) * Math.cos(2 * Math.PI * 5000 * n / fs)), 2)
  ok(g > 25, `${g.toFixed(1)} dB gone`)
})

test('declick — six samples off, a gap over them alone', () => {
  // 0.3.0: 25.8 dB (its gap the onset's or all of the error's span, nothing between)
  let g = gone([1, 1, 1, 1, 1, 1], 5)
  ok(g > 35, `${g.toFixed(1)} dB gone`)
})

test('declick — a mouth click rebuilt toward the voice under it, by its own spectrum', () => {
  // 3 ms of differenced noise under a Hann window at 2× the speech; 0.3.0 (the click white): 17.2 dB
  let s = 9, r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296, q = 0
  let h = Array.from({ length: 132 }, (_, n) => { let w = r() * 2 - 1, y = w - q; q = w; return y * Math.sin(Math.PI * n / 132) ** 2 })
  let pk = Math.max(...h.map(Math.abs)), g = gone(h.map(v => v / pk), 2)
  ok(g > 20, `${g.toFixed(1)} dB gone`)
})
