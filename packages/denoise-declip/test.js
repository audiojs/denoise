// declip's own tests: what this version added. The rest (rails, bit-exactness, edges) is in the umbrella's test.js.
import test, { ok } from 'tst'
import raw from 'audio-lena/raw'
import declip, { rails, bands } from './declip.js'

const fs = 44100, lena = new Float32Array(raw)
const peak = x => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const scaled = (x, k) => Float32Array.from(x, v => v * k)
const clamp = (x, hi, lo = -hi) => Float32Array.from(x, v => Math.min(hi, Math.max(lo, v)))
const snr = (x, y) => { let s = 0, e = 0; for (let i = 0; i < x.length; i++) s += x[i] ** 2, e += (x[i] - y[i]) ** 2; return 10 * Math.log10(s / e) }
const unchanged = (x, y) => x.length === y.length && x.every((v, i) => v === y[i])
// the clip level leaving x db from the original
const cut = (x, db) => { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { let m = (lo + hi) / 2; if (snr(x, clamp(x, m)) < db) lo = m; else hi = m } return hi }
// a lossy coder's work on a clip's flat top, without a coder: lowpass at 16 kHz (windowed sinc, 255 taps, Blackman),
// then 16-bit PCM; the top ripples around the cut level
function coded(x) {
  let L = 127, h = Float64Array.from({ length: 2 * L + 1 }, (_, k) => {
    let t = k - L, w = 0.42 + 0.5 * Math.cos(Math.PI * t / L) + 0.08 * Math.cos(2 * Math.PI * t / L)
    return (t ? Math.sin(2 * Math.PI * 16000 / fs * t) / (Math.PI * t) : 2 * 16000 / fs) * w
  })
  return Float32Array.from(x, (_, i) => {
    let s = 0
    for (let k = -L; k <= L; k++) s += h[k + L] * (x[i - k] ?? 0)
    return Math.max(-32768, Math.min(32767, Math.round(s * 32768))) / 32768
  })
}
// three notes of six partials, a slow swell
const chord = n => Float32Array.from({ length: n }, (_, i) => {
  let t = i / fs, s = 0
  for (let f of [220, 277.18, 329.63]) for (let k = 1; k <= 6; k++) s += Math.sin(2 * Math.PI * f * k * t + k) / k
  return 0.2 * s * (0.6 + 0.4 * Math.sin(2 * Math.PI * 1.5 * t))
})

test('declip — a clip lossy coding spread into a band: found, cut under the band, rebuilt', () => {
  // 0.3.0 found no rail (the top is no longer flat) and returned it untouched: 0 dB gained
  let s = lena.subarray(fs, fs + fs / 2), x = scaled(s, 0.9 / peak(s)), y = coded(clamp(x, cut(x, 7))), b = bands(y), r = rails(y)
  ok(r.hi == null && r.lo == null, 'no flat rail')
  ok(b.hi && b.lo && Math.abs(b.hi.r - b.lo.r) < 0.01 * b.hi.r, `a band each side: ${b.hi?.r.toFixed(4)} / ${b.lo?.r.toFixed(4)}`)
  let z = declip(y, { fs })
  ok(snr(x, z) > snr(x, y) + 5, `SDR ${snr(x, y).toFixed(1)} → ${snr(x, z).toFixed(1)} dB`)
})

test('declip — no band where nothing was cut: speech, a limited master, sines, noise', () => {
  let s = lena.subarray(0, fs), one = scaled(s, 1 / peak(s)), r = 0x9e3779b9, rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5
  let lim = Float32Array.from(scaled(one, 4), v => Math.tanh(v) * 0.98)   // a hard soft-saturation, no flat top: no band
  for (let [v, x] of [['speech', s], ['peak 1', one], ['coded unclipped', coded(scaled(one, 0.95))], ['saturated', lim],
    ['50 Hz', Float32Array.from({ length: fs }, (_, i) => 0.9 * Math.sin(2 * Math.PI * 50 * i / fs))],
    ['noise', Float32Array.from({ length: fs }, () => rand() + rand() + rand())]]) {
    let b = bands(x)
    ok(!b.hi && !b.lo && unchanged(x, declip(x, { fs })), `${v}: no band, not a sample changed`)
  }
})

test('declip — a held chord clipped to 1 dB: the 186 ms sparse rebuild carries it', () => {
  // 0.3.0 (the AR and the 93 ms sparse rebuilds): 11.6 dB over half a second
  let x = chord(fs / 2), y = clamp(x, cut(x, 1)), z = declip(y, { fs })
  ok(snr(x, z) > 13, `SDR ${snr(x, y).toFixed(1)} → ${snr(x, z).toFixed(1)} dB`)
  ok(z.every((v, i) => y[i] === v || Math.abs(v) >= Math.abs(y[i])), 'consistent: each rebuilt sample at least as far out as recorded')
})
