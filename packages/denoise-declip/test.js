// declip's own tests: what this version added. The rest (rails, bit-exactness, edges) is in the umbrella's test.js.
import test, { ok } from 'tst'
import raw from 'audio-lena/raw'
import declip, { declipAsync, rails, bands, saturation, solve } from './declip.js'
import { aspade, unbounded } from './scripts/aspade.js'

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
const chord = (n, rate = fs) => Float32Array.from({ length: n }, (_, i) => {
  let t = i / rate, s = 0
  for (let f of [220, 277.18, 329.63]) for (let k = 1; k <= 6; k++) s += Math.sin(2 * Math.PI * f * k * t + k) / k
  return 0.2 * s * (0.6 + 0.4 * Math.sin(2 * Math.PI * 1.5 * t))
})

// x from 44.1 kHz to `rate`: a Blackman-windowed sinc, 16 zero crossings a side, cut at 0.95 of the lower Nyquist
function resampled(x, rate) {
  let q = fs / rate, fc = 0.95 * Math.min(1, 1 / q), L = Math.ceil(16 / fc)
  return Float32Array.from({ length: Math.floor(x.length / q) }, (_, m) => {
    let t = m * q, s = 0
    for (let k = Math.max(0, Math.ceil(t - L)); k <= Math.min(x.length - 1, Math.floor(t + L)); k++) {
      let u = k - t, v = u / L
      s += x[k] * (u ? Math.sin(Math.PI * fc * u) / (Math.PI * u) : fc) * (0.42 + 0.5 * Math.cos(Math.PI * v) + 0.08 * Math.cos(2 * Math.PI * v))
    }
    return s
  })
}

test('declip — a clip lossy coding spread into a band: found, cut under the band, rebuilt', () => {
  // 0.3.0 found no rail (the top is no longer flat) and returned it untouched: 0 dB gained
  let s = lena.subarray(fs, fs + fs / 2), x = scaled(s, 0.9 / peak(s)), y = coded(clamp(x, cut(x, 7))), b = bands(y), r = rails(y)
  ok(r.hi == null && r.lo == null, 'no flat rail')
  ok(b.hi && b.lo && Math.abs(b.hi.r - b.lo.r) < 0.01 * b.hi.r, `a band each side: ${b.hi?.r.toFixed(4)} / ${b.lo?.r.toFixed(4)}`)
  let z = declip(y, { fs })
  ok(snr(x, z) > snr(x, y) + 5, `SDR ${snr(x, y).toFixed(1)} → ${snr(x, z).toFixed(1)} dB`)
})

// a lookahead limiter, as a loud master has been through: the gain the 5 ms moving average of the least ceiling/|x|
// over the next 5 ms, so a peak touches the ceiling and its neighbours follow the wave
function limited(x, c = 0.98) {
  let L = Math.round(0.005 * fs), n = x.length, M = new Float64Array(n), y = new Float32Array(n)
  for (let i = 0; i < n; i++) { M[i] = 1; for (let j = i; j < Math.min(n, i + L); j++) M[i] = Math.min(M[i], c / Math.max(Math.abs(x[j]), c)) }
  for (let i = 0, s = 0; i < n; i++) { s += M[i]; if (i >= L) s -= M[i - L]; y[i] = x[i] * s / Math.min(i + 1, L) }
  return y
}

test('declip — no band and no curve where nothing was cut or bent: speech, a limited master, sines, noise', () => {
  let s = lena.subarray(0, fs), one = scaled(s, 1 / peak(s)), r = 0x9e3779b9, rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5
  for (let [v, x] of [['speech', s], ['peak 1', one], ['coded unclipped', coded(scaled(one, 0.95))], ['limited 12 dB', limited(scaled(one, 4))],
    ['50 Hz', Float32Array.from({ length: fs }, (_, i) => 0.9 * Math.sin(2 * Math.PI * 50 * i / fs))],
    ['noise', Float32Array.from({ length: fs }, () => rand() + rand() + rand())]]) {
    let b = bands(x)
    ok(!b.hi && !b.lo && !saturation(x, fs) && unchanged(x, declip(x, { fs })), `${v}: no band, no curve, not a sample changed`)
  }
})

test('declip: saturated noise is inverted, white or not; uniform noise and dither come back finite, through the kernel and the manifest', async () => {
  // a Gaussian through its own CDF is uniform, so a hard-edged white noise reads as a saturated one and no likelihood
  // tells the two apart. Taking white noise for no curve (an AR prediction gain under 1 dB in the fit's windows) left
  // every saturated take its noise outweighs as it came: speech under white noise 10 dB over it, through tanh
  let r = 0x2545f491, rand = () => (r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32, gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
  // the SNR after the best scale: the curve's gain is no restorer's to know
  let snrg = (x, y) => { let xy = 0, yy = 0; for (let i = 0; i < x.length; i++) xy += x[i] * y[i], yy += y[i] * y[i]; return snr(x, scaled(y, xy / yy)) }
  let s = lena.subarray(3 * fs, 3.4 * fs), rms = Math.sqrt(s.reduce((a, v) => a + v * v, 0) / s.length), x = Float32Array.from(s, v => v + 3.16 * rms * gauss())
  x = scaled(x, 0.8 / peak(x))
  let y = Float32Array.from(x, v => 0.6 * Math.tanh(2.5 * v) / Math.tanh(2.5)), z = declip(y, { fs })
  ok(saturation(y, fs) && snrg(x, z) > snrg(x, y) + 10, `speech under noise through tanh: ${snrg(x, y).toFixed(1)} → ${snrg(x, z).toFixed(1)} dB`)
  // a uniform noise and dither: by their amplitudes alone saturated white noises (README), read so or not (an open
  // question), they come back finite and as long, through the kernel and through the manifest
  for (let [v, u] of [['uniform ±0.3', Float32Array.from({ length: fs }, () => 0.3 * (2 * rand() - 1))], ['16-bit, ±10 LSB', Float32Array.from({ length: fs }, () => Math.round(32768 * 3e-4 * (2 * rand() - 1)) / 32768)]]) {
    let z = declip(u, { fs })
    ok(z.length === u.length && z.every(Number.isFinite), `${v}: finite, as long as it came (${unchanged(u, z) ? 'as it came' : 'inverted under a curve'})`)
  }
  let { declip: atom } = await import('./audio.js'), ch = [0, 1].map(() => Float32Array.from({ length: 8192 }, () => 0.3 * (2 * rand() - 1)))
  let params = { clipLevel: Float32Array.of(0), order: Float32Array.of(256) }, out = ch.map(c => new Float32Array(c.length))
  atom({ sampleRate: fs, maxBlockSize: 8192, maxChannels: 2, params })([ch], [out], params)
  ok(out.every(o => o.every(Number.isFinite)), 'the manifest, 8192 stereo frames: finite')
})

// The white-block bound, read off solve(), a job of the rebuild as declipAsync hands it out (a block of the sparse
// rebuild: its samples, windowed), against A-SPADE run here from a given k (scripts/aspade.js: the kernel's loop written
// a second time, the two held equal sample for sample, the pass count to the schedule's arithmetic): a block whose spectrum
// is white noise is the run from 0.3 of its lines, sample for sample, a block of clipped speech or of a clipped chord the
// run from k = 1. At each rate both block lengths (93 and 186 ms: 1024 to 16384 samples), a whole block and the take's
// first, which holds a quarter of its samples, where the flatness spreads twice as far
test('declip: a sparse block of white noise is run from 0.3 of its lines, one of clipped speech or of a chord from k = 1, at every rate', () => {
  let r = 0x5bd1e995, rand = () => (r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32, gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
  // the passes from k = 1 to every line, k grown by max(1, ⌊k/50⌋)
  let all = H => { let p = 0; for (let k = 1; ; k += Math.max(1, Math.floor(k / 50))) { p++; if (k >= H) return p } }
  for (let rate of [8000, 16000, 22050, 44100, 96000]) {
    let n = Math.round(0.6 * rate), s = rate === fs ? lena.subarray(fs, fs + n) : resampled(lena.subarray(fs, 2 * fs), rate).subarray(0, n), sp = scaled(s, 0.9 / peak(s)), ch = chord(n, rate)
    for (let [what, x, L, white] of [['white noise clipped at 1.5σ', Float32Array.from({ length: n }, () => 0.1 * gauss()), 0.15, true], ['speech clipped to 1 dB', sp, cut(sp, 1)], ['a chord clipped to 1 dB', ch, cut(ch, 1)]]) {
      for (let sec of [0.093, 0.186]) {
        // the take from half a hop before its first clipped sample, so that both blocks hold it
        let w = 2 ** Math.round(Math.log2(sec * rate)), a = w / 4, H = w + 1
        let c0 = clamp(x, L), y = c0.subarray(Math.max(0, c0.findIndex(v => Math.abs(v) >= L) - a / 2)), mask = Int8Array.from(y, v => v >= L ? 1 : v <= -L ? -1 : 0)
        for (let [where, c] of [['the take\'s first, a quarter on it', a - w], ['whole', 0]]) {
          let z = solve({ y, mask, fs: rate, p: 256 }, { r: sec, at: c }), ref = aspade(y, mask, rate, sec, c, white ? Math.ceil(0.3 * H) : 1)
          let same = z.length === ref.block.length && z.every((v, i) => Object.is(v, ref.block[i]))
          ok(same && (white ? ref.passes * 3 < all(H) : ref.passes <= all(H)), `${what}, ${rate} Hz, a block of ${w}, ${where}: ${same ? 'the run' : 'not the run'} from ${white ? '0.3 of its lines' : 'k = 1'}, ${ref.passes} passes${white ? ` (from k = 1: ${all(H)})` : ''}`)
        }
      }
    }
  }
})

// What the bound keeps, against the rebuild with every sparse block run from k = 1 (scripts/aspade.js through
// declipAsync), both made here on takes of 0.3 s at 16 kHz: on these three of white and uniform noise, clipped to a rail
// or through a curve, at most 0.1 dB of SNR given up (a white block's iterate depends on the run's whole path, so a
// start at 0.3 of the lines lands near the run from 1, on either side: a wider draw scatters further, scripts/white.js
// --random); on clipped speech and a chord, whose blocks are not white, the same samples
test('declip: on three takes of white and uniform noise the bound gives up at most 0.1 dB against the run from k = 1, on clipped speech and a chord none', async () => {
  let rate = 16000, n = Math.round(0.3 * rate), lcg = seed => { let r = seed; const rnd = () => (r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 2 ** 32; return { rnd, gauss: () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()) } }
  let snrg = (x, y) => { let xy = 0, yy = 0; for (let i = 0; i < x.length; i++) xy += x[i] * y[i], yy += y[i] * y[i]; return snr(x, scaled(y, xy / yy)) }
  let w = lcg(4242 + 17 + rate), white = Float32Array.from({ length: n }, () => 0.15 * w.gauss())
  let u = lcg(4242 + 51 + rate), uni = Float32Array.from({ length: n }, () => (2 * u.rnd() - 1) * 0.5)
  let t = lcg(77), soft = Float32Array.from({ length: n }, () => 0.2 * t.gauss())
  let s = resampled(lena.subarray(fs, 2 * fs), rate).subarray(0, n), sp = scaled(s, 0.9 / peak(s)), ch = chord(n, rate)
  for (let [v, x, y, p, m, same] of [
    ['white noise clipped at 1.5σ, its rail given', white, clamp(white, 0.225), { clipLevel: 0.225 }, snr],
    ['uniform noise clipped at 0.35, its rail given', uni, clamp(uni, 0.35), { clipLevel: 0.35 }, snr],
    ['white noise through tanh at drive 4', soft, Float32Array.from(soft, v => 0.6 * Math.tanh(4 * v / 0.6) / Math.tanh(4)), {}, snrg],
    ['speech clipped to 5 dB', sp, clamp(sp, cut(sp, 5)), {}, snr, true],
    ['a chord clipped to 1 dB', ch, clamp(ch, cut(ch, 1)), {}, snr, true]
  ]) {
    let z = declip(y, { fs: rate, ...p }), z1 = await unbounded(y, { fs: rate, ...p }), d = m(x, z1) - m(x, z), bit = z.every((v, i) => Object.is(v, z1[i]))
    ok(same ? bit : d <= 0.1, `${v}: ${m(x, y).toFixed(2)} dB as it came, ${m(x, z1).toFixed(2)} from k = 1, ${m(x, z).toFixed(2)} bounded (${bit ? 'the same samples' : `${d.toFixed(3)} dB given up`})`)
  }
}, { timeout: 600000 })

test('declip — soft saturation, no rail: its curve fitted blind, the sound inverted under it, the bent peaks rebuilt', () => {
  // 0.4.0 found no rail and no band and returned each untouched: 0 dB gained
  let s = lena.subarray(0, fs / 2), x = scaled(s, 2 / peak(s))
  for (let [v, f, want] of [
    ['tanh', Math.tanh, 25],
    ['arctan, outside its curves', u => 2 / Math.PI * Math.atan(Math.PI / 2 * u), 8],
    ['asymmetric, the negative side to 0.6', u => u > 0 ? Math.tanh(u) : 0.6 * Math.tanh(u / 0.6), 6]
  ]) {
    let y = Float32Array.from(x, f), c = saturation(y, fs), z = declip(y, { fs }), b = bands(y), r = rails(y)
    ok(c && r.hi == null && r.lo == null && !b.hi && !b.lo, `${v}: no rail, no band, a curve (${c?.curve}, k ${c?.k.toFixed(2)}, ceilings ${c?.hi.toFixed(3)} / ${c?.lo.toFixed(3)})`)
    ok(snr(x, z) > snr(x, y) + want, `${v}: SDR ${snr(x, y).toFixed(1)} → ${snr(x, z).toFixed(1)} dB`)
  }
})

test('declip — a held chord clipped to 1 dB: the 186 ms sparse rebuild carries it', () => {
  // 0.3.0 (the AR and the 93 ms sparse rebuilds): 11.6 dB over half a second
  let x = chord(fs / 2), y = clamp(x, cut(x, 1)), z = declip(y, { fs })
  ok(snr(x, z) > 13, `SDR ${snr(x, y).toFixed(1)} → ${snr(x, z).toFixed(1)} dB`)
  ok(z.every((v, i) => y[i] === v || Math.abs(v) >= Math.abs(y[i])), 'consistent: each rebuilt sample at least as far out as recorded')
})

test('declipAsync — its jobs made in any order and anywhere come back the same samples, bit for bit', async () => {
  // a map that makes each batch's jobs last to first, a turn of the event loop between: as threads would hand them back
  let s = lena.subarray(fs, fs + fs / 2), x = scaled(s, 0.9 / peak(s)), calls = 0
  let map = async (shared, jobs) => { calls++; await new Promise(r => setTimeout(r)); let out = new Array(jobs.length); for (let i = jobs.length - 1; i >= 0; i--) out[i] = (await import('./declip.js')).solve(structuredClone(shared), jobs[i]); return out }
  for (let [v, y] of [['hard', clamp(x, cut(x, 5))], ['asymmetric', clamp(x, 0.6, -0.4)], ['soft', Float32Array.from(x, u => Math.tanh(2 * u))], ['clean', x]]) {
    let a = declip(y, { fs }), b = await declipAsync(y, { fs }, map)
    ok(a.length === b.length && a.every((u, i) => Object.is(u, b[i])), `${v}: the same samples`)
  }
  ok(calls > 0, `${calls} batches of jobs`)
}, { timeout: 600000 })
