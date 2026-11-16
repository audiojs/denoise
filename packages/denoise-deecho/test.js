// deecho: echoes made by scipy.signal.lfilter (reference.py) and on the family's speech take, found and undone; takes
// with none passed sample for sample. Expected values are the echoes each take was made with, scipy's inverse filter
// and the ideal band-limited delay; the bounds (dB, samples) are ours, each a margin under what the build measures.

import test, { ok, is, almost } from 'tst'
import raw from 'audio-lena/raw'
import { fft, ifft } from 'fourier-transform'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import deecho, { estimate } from './deecho.js'
import { deecho as atom } from './audio.js'

const fs = 44100, lena = new Float32Array(raw)                 // audio-lena: 12.3 s of speech at 44.1 kHz
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5 }
const E = x => { let s = 0; for (let v of x) s += v * v; return s }
const dB = v => 10 * Math.log10(v)
// what is left of the echo: the error to the dry take, dB of the dry take
const err = (y, x, a = 0, b = x.length) => { let s = 0, e = 0; for (let i = a; i < b; i++) s += (y[i] - x[i]) ** 2, e += x[i] ** 2; return dB(s / e) }
const same = (y, x) => y.length === x.length && y.every((v, i) => v === x[i])
const pow2 = n => 2 ** Math.ceil(Math.log2(n))

// a delay line's echo y = x + g·w, w[n] = x[n − D] + f·w[n − D], a whole D, in doubles (as lfilter, checked below)
function lines(x, echoes, sr = fs) {
  let y = Float64Array.from(x)
  for (let { delay, gain, feedback } of echoes) {
    let D = Math.round(delay * sr), w = new Float64Array(x.length)
    for (let n = D; n < x.length; n++) w[n] = x[n - D] + feedback * w[n - D], y[n] += gain * w[n]
  }
  return y
}
// the ideal band-limited echo at any delay: the spectrum times 1 + g e^{−iωD}/(1 − f e^{−iωD}) over a zero padded FFT
// (the ideal fractional delay, Laakso et al., IEEE SPM 13(1), 1996), as reference.py's ideal()
function ideal(x, D, g, f = 0, M = pow2(x.length + 64 * D)) {
  let p = new Float64Array(M); p.set(x)
  let [r0, i0] = fft(p), re = Float64Array.from(r0), im = Float64Array.from(i0)
  for (let k = 0; k <= M / 2; k++) {
    let w = 2 * Math.PI * k / M, zr = Math.cos(w * D), zi = -Math.sin(w * D)
    let dr = 1 - f * zr, di = -f * zi, d = dr * dr + di * di, qr = (zr * dr + zi * di) / d, qi = (zi * dr - zr * di) / d
    let hr = 1 + g * qr, hi = g * qi, a = re[k], b = im[k]
    re[k] = a * hr - b * hi, im[k] = a * hi + b * hr
  }
  return ifft(re, im).slice(0, x.length)
}

// reference.py's signal(): a voice-like take at 16 kHz in arithmetic only, so both languages make the same doubles
function signal(n = 4 * 16000) {
  let seed = 1, pitch = 7, x = new Float64Array(n), y1 = 0, y2 = 0, z1 = 0, z2 = 0, nxt = 0
  let syl = [[1600, 12000], [16000, 26000], [30000, 44000], [48000, 60000]]
  for (let i = 0; i < n; i++) {
    let g = 0
    for (let j = 0; j < 12; j++) { seed = seed * 16807 % 2147483647; g += seed / 2147483647 }
    let e = 0
    if (i === nxt) {
      pitch = pitch * 48271 % 2147483647
      nxt = i + 100 + pitch % 60
      for (let [s, t] of syl) if (s <= i && i < t) e = Math.min(1, (i - s) / 800, (t - i) / 800)
    }
    let y = e + 1.8 * y1 - 0.9 * y2; y2 = y1; y1 = y
    let z = y + 0.9 * z1 - 0.72 * z2; z2 = z1; z1 = z
    x[i] = 0.05 * z + (g - 6) * 0.002
  }
  return x
}
const fx = JSON.parse(readFileSync(new URL('./reference.json', import.meta.url)))

test('deecho: the echoes undone as scipy.signal.lfilter undoes them: one copy, repeats, a delay effect, two copies, 750 ms', () => {
  // the fixture keeps 9 digits: a sample agrees to 1e-8 of itself
  let x = signal(), { step, rms } = fx, rel = (p, q) => Math.abs(p - q) / (Math.abs(q) + 1e-12 * rms), d = 0
  for (let i = 0; i * step < x.length; i++) d = Math.max(d, rel(x[i * step], fx.x[i]))
  ok(d < 1e-8, `the take as reference.py makes it: each sample within ${d.toExponential(1)} of itself`)
  for (let [name, c] of Object.entries(fx.cases)) {
    if (name === 'fractional') continue
    let y = lines(x, c.echoes, 16000), dy = 0, dx = 0, out = deecho(Float32Array.from(y), { fs: 16000, echoes: c.echoes }), back = deecho(y, { fs: 16000, echoes: c.echoes })
    for (let i = 0; i * step < x.length; i++) dy = Math.max(dy, rel(y[i * step], c.y[i])), dx = Math.max(dx, Math.abs(back[i * step] - c.inverse[i]))
    ok(dy < 1e-8, `${name}: the echo as lfilter makes it, each sample within ${dy.toExponential(1)} of itself`)
    ok(dx < 1e-6 * rms, `${name}: undone as lfilter's inverse undoes it, within ${(dx / rms).toExponential(1)} of the RMS (the output is Float32)`)
    ok(err(out, x) < -120, `${name}: from the Float32 take, ${err(out, x).toFixed(0)} dB of the dry take left`)
  }
})

test('deecho: a fractional delay (1500.37 samples) undone as the ideal band-limited inverse undoes it, but for the top of the band', () => {
  let x = signal(), { step, rms } = fx, c = fx.cases.fractional, D = c.echoes[0].delay * 16000
  let y = ideal(x, D, c.echoes[0].gain), dy = 0
  for (let i = 0; i * step < x.length; i++) dy = Math.max(dy, Math.abs(y[i * step] - c.y[i]) / (Math.abs(c.y[i]) + 1e-6 * rms))
  ok(dy < 1e-7, `the echo as numpy makes it, each sample within ${dy.toExponential(1)} of itself`)
  // the sinc's 32 taps delay to within −57 dB of the ideal up to 0.85 of Nyquist, −25 dB at 0.9: what is left is the top
  // of the band and the take's ends
  let out = deecho(y, { fs: 16000, echoes: c.echoes }), ref = Float64Array.from(c.inverse), got = Float64Array.from({ length: ref.length }, (_, i) => out[i * step])
  let e = err(got.subarray(20, -20), ref.subarray(20, -20))
  ok(e < -45, `within ${e.toFixed(1)} dB of the ideal inverse`)
  ok(err(out, x, 1000, x.length - 1000) < -45, `${err(out, x, 1000, x.length - 1000).toFixed(1)} dB of the dry take left`)
})

test('deecho: found in the scipy takes: the delay to the sample, the gain and the feedback within 0.02', () => {
  let x = signal()
  for (let [name, c] of Object.entries(fx.cases)) {
    let y = name === 'fractional' ? ideal(x, c.echoes[0].delay * 16000, c.echoes[0].gain) : lines(x, c.echoes, 16000)
    let found = estimate(y, { fs: 16000 }), want = [...c.echoes].sort((p, q) => q.gain - p.gain)
    is(found.length, want.length, `${name}: ${found.length} echo${found.length === 1 ? '' : 'es'}`)
    found.forEach((e, i) => {
      let w = want[i], dD = (e.delay - w.delay) * 16000
      ok(Math.abs(dD) < (name === 'fractional' ? 0.05 : 1e-9), `${name}: delay ${(e.delay * 1000).toFixed(3)} ms, ${dD.toFixed(3)} samples off`)
      ok(Math.abs(e.gain - w.gain) < 0.02 && Math.abs(e.feedback - w.feedback) < 0.02, `${name}: gain ${e.gain.toFixed(3)} for ${w.gain}, feedback ${e.feedback.toFixed(3)} for ${w.feedback}`)
    })
    let out = deecho(y, { fs: 16000 }), e = err(out, x)
    ok(e < -35, `${name}: ${err(y, x).toFixed(1)} → ${e.toFixed(1)} dB of the dry take left`)
  }
})

// lena with echoes at known delays and gains, single and repeating: the research note's 30, 80, 100, 150 ms, a
// fractional delay, 400 ms and 1 s; the gain 0.5 the note measured comb with, 0.2 and 0.08 (−22 dB)
test('deecho: echoes on speech, 30 ms to 1 s, gains 0.5 to 0.08, one copy and repeats: found to the sample, left 40 dB down', () => {
  for (let ms of [30, 80, 100, 150, 150.37, 400, 1000]) for (let g of ms === 80 ? [0.5, 0.2, 0.08] : [0.5]) for (let f of [0, g]) {
    let D = ms / 1000 * fs, y = Number.isInteger(D) ? lines(lena, [{ delay: ms / 1000, gain: g, feedback: f }]) : ideal(lena, D, g, f)
    let [e, ...more] = estimate(y, { fs }), out = deecho(y, { fs }), kind = f ? 'repeats' : 'one copy'
    ok(e && !more.length, `${ms} ms, ${g}, ${kind}: one echo found`)
    if (!e) continue
    ok(Math.abs(e.delay * fs - D) < 0.1 && Math.abs(e.gain - g) < 0.01 + 0.02 * g && Math.abs(e.feedback - f) < 0.02 + 0.05 * f,
      `${ms} ms, ${g}, ${kind}: ${(e.delay * fs - D).toFixed(3)} samples off, gain ${e.gain.toFixed(3)}, feedback ${e.feedback.toFixed(3)}`)
    ok(err(out, lena) < -40, `${ms} ms, ${g}, ${kind}: ${err(y, lena).toFixed(1)} → ${err(out, lena).toFixed(1)} dB of the dry take left`)
  }
})

test('deecho: a 12 ms echo, among the voice\'s own pitch and formants: gain 0.5 found, taken 30 dB down', () => {
  let y = ideal(lena, 0.01234 * fs, 0.5), [e] = estimate(y, { fs }), out = deecho(y, { fs })
  ok(e && Math.abs(e.delay - 0.01234) * fs < 0.1, `delay ${e && (e.delay * 1000).toFixed(3)} ms`)
  ok(err(out, lena) < -30, `${err(y, lena).toFixed(1)} → ${err(out, lena).toFixed(1)} dB`)
})

test('deecho: two copies (a wall at 69 ms and one at 181 ms) and a delay effect (wet 0.4 over dry 0.6, feedback 0.35)', () => {
  let two = lines(lena, [{ delay: 0.069, gain: 0.4, feedback: 0 }, { delay: 0.181, gain: 0.25, feedback: 0 }]), es = estimate(two, { fs })
  is(es.map(e => Math.round(e.delay * 1000)), [69, 181], `two copies: ${es.map(e => `${(e.delay * 1000).toFixed(1)} ms ${e.gain.toFixed(3)}`).join(', ')}`)
  ok(err(deecho(two, { fs }), lena) < -40, `two copies: ${err(two, lena).toFixed(1)} → ${err(deecho(two, { fs }), lena).toFixed(1)} dB`)
  // the delay's output y = 0.6 x + 0.4 d, d[n] = x[n − D] + 0.35 d[n − D]: over its dry, a line of gain 0.4/0.6
  let fx = lines(lena, [{ delay: 0.12, gain: 0.4 / 0.6, feedback: 0.35 }]), [e] = estimate(fx, { fs })
  ok(e && Math.abs(e.gain - 0.4 / 0.6) < 0.02 && Math.abs(e.feedback - 0.35) < 0.02, `delay effect: gain ${e?.gain.toFixed(3)}, feedback ${e?.feedback.toFixed(3)}`)
  ok(err(deecho(fx, { fs }), lena) < -40, `delay effect: ${err(fx, lena).toFixed(1)} → ${err(deecho(fx, { fs }), lena).toFixed(1)} dB`)
})

test('deecho: a noise added after the echo, 40 to 20 dB under the voice: found, the echo taken down to what the noise allows', () => {
  // the inverse colours the noise the echo never carried: x̂ = x + n/(1 + 0.5 z^−D), the noise's own error 4.8 dB under it
  for (let [snr, bound] of [[40, -33], [30, -29], [20, -19]]) {
    let r = lcg(9), s = Math.sqrt(E(lena) / lena.length) * 10 ** (-snr / 20) * Math.sqrt(12), noise = Float32Array.from(lena, () => s * r())
    let y = lines(lena, [{ delay: 0.08, gain: 0.5, feedback: 0 }]).map((v, i) => v + noise[i]), dry = lena.map((v, i) => v + noise[i])
    let [e] = estimate(y, { fs }), out = deecho(y, { fs })
    ok(e && e.delay === 0.08 && Math.abs(e.gain - 0.5) < 0.05, `${snr} dB: ${e ? `gain ${e.gain.toFixed(3)}` : 'none'}`)
    ok(err(out, dry) < bound, `${snr} dB: ${err(y, dry).toFixed(1)} → ${err(out, dry).toFixed(1)} dB of the dry take and its noise`)
  }
})

test('deecho: the delay given, the gain and feedback measured there; both given, nothing measured', () => {
  let y = lines(lena, [{ delay: 0.2, gain: 0.3, feedback: 0.3 }]), [e] = estimate(y, { fs, delay: 0.2 })
  ok(Math.abs(e.gain - 0.3) < 0.01 && Math.abs(e.feedback - 0.3) < 0.02, `at 200 ms: gain ${e.gain.toFixed(3)}, feedback ${e.feedback.toFixed(3)}`)
  is(estimate(y, { fs, delay: 0.2, gain: 0.3, feedback: 0.3 }), [{ delay: 0.2, gain: 0.3, feedback: 0.3 }], 'as given')
  ok(err(deecho(y, { fs, delay: 0.2, gain: 0.3, feedback: 0.3 }), lena) < -100, 'given exactly: undone to the rounding')
  // a delay past the search's second, given: 2.5 s
  let far = lines(lena, [{ delay: 2.5, gain: 0.5, feedback: 0 }]), [g] = estimate(far, { fs, delay: 2.5 })
  ok(Math.abs(g.gain - 0.5) < 0.02, `2.5 s given: gain ${g.gain.toFixed(3)}`)
})

test('deecho: a delay 2 ms off, or a gain 20 % off, undoes little: why the delay is found to the sample', () => {
  // the research note's measure (comb at 82 ms on an 80 ms repeating echo): what a 2 ms error leaves
  let y = lines(lena, [{ delay: 0.08, gain: 0.5, feedback: 0.5 }])
  let off = err(deecho(y, { fs, delay: 0.082, gain: 0.5, feedback: 0.5 }), lena), low = err(deecho(y, { fs, delay: 0.08, gain: 0.4, feedback: 0.4 }), lena)
  let found = err(deecho(y, { fs }), lena)
  ok(off > -3 && low > -25 && found < -50, `2 ms off: ${off.toFixed(1)} dB left; gain 0.4 for 0.5: ${low.toFixed(1)}; found: ${found.toFixed(1)}`)
})

test('deecho: no echo, no change: speech, white noise, a tone, a sawtooth, a pulse train, held chords, a beat, silence', () => {
  let n = 6 * fs, r = lcg(5)
  let takes = {
    speech: lena,
    'white noise': Float32Array.from({ length: n }, () => r()),
    'a 440 Hz tone': Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / fs)),
    'a sawtooth at 110 Hz': Float32Array.from({ length: n }, (_, i) => { let s = 0; for (let h = 1; h * 110 < 16000; h++) s += Math.sin(2 * Math.PI * h * 110 * i / fs) / h; return 0.1 * s }),
    'a pulse every 10 ms': Float32Array.from({ length: n }, (_, i) => i % 441 ? 0 : 0.5),
    // four chords of six partials, each struck every 2 s and decaying: a periodic piece
    'chords every 0.5 s': Float32Array.from({ length: n }, (_, i) => { let t = i / fs, k = Math.floor(t / 0.5) % 4, u = t % 0.5, s = 0; for (let f of [[220, 277, 330], [196, 247, 294], [175, 220, 262], [165, 208, 247]][k]) for (let h = 1; h <= 6; h++) s += 0.03 / h * Math.exp(-u * 3) * Math.sin(2 * Math.PI * f * h * t); return s }),
    // a kick (a 60 Hz thump falling over 80 ms) every half second and a hat (noise over 30 ms) between: 120 bpm
    'a beat at 120 bpm': Float32Array.from({ length: n }, (_, i) => { let t = i / fs, u = t % 0.5, v = (t + 0.25) % 0.5; return 0.3 * Math.exp(-u / 0.08) * Math.sin(2 * Math.PI * 60 * u) + 0.1 * Math.exp(-v / 0.03) * r() }),
    silence: new Float32Array(n),
  }
  for (let [name, x] of Object.entries(takes)) {
    is(estimate(x, { fs }), [], `${name}: no echo`)
    ok(same(deecho(x, { fs }), x), `${name}: sample for sample`)
  }
})

test('deecho: empty, a sample, shorter than four of the shortest delay, NaN: as they came', () => {
  is(deecho(new Float32Array(0), { fs }).length, 0, 'empty')
  for (let x of [Float32Array.of(0.5), new Float32Array(100).fill(0.1), Float32Array.from(lena.subarray(0, fs), (v, i) => i === 500 ? NaN : v)])
    ok(deecho(x, { fs }).every((v, i) => Object.is(v, x[i])), `${x.length} samples: as they came`)
})

test('deecho: stream ≡ batch under any chunking, its echoes given', () => {
  let echoes = [{ delay: 0.0837, gain: 0.45, feedback: 0.2 }, { delay: 0.031, gain: -0.2, feedback: 0 }], y = lines(lena.subarray(0, 3 * fs), [{ delay: 0.1, gain: 0.3, feedback: 0 }])
  let whole = deecho(y, { fs, echoes }), r = lcg(11)
  for (let trial = 0; trial < 3; trial++) {
    let write = deecho({ fs, echoes }), out = [], i = 0
    while (i < y.length) { let n = 1 + Math.floor((r() + 0.5) * 3000); out.push(...write(y.subarray(i, i + n))); i += n }
    is(write().length, 0, 'nothing held back')
    ok(same(Float32Array.from(out), whole), `chunks of 1 to 3000 samples: sample for sample`)
  }
})

test('deecho: options checked', () => {
  let threw = (f, T) => { try { f() } catch (e) { return e instanceof T } return false }
  ok(threw(() => deecho(lena, { fs, delay: 0.1, gain: 1.2 }), RangeError), 'a copy louder than 0.95 of the sound: no stable inverse')
  ok(threw(() => deecho(lena, { fs, delay: 0.1, gain: 0.5, feedback: 0.97 }), RangeError), 'feedback 0.97: the echo would not die away')
  ok(threw(() => deecho({ fs }), TypeError), 'a stream without its echoes')
  ok(threw(() => deecho(lena, { fs: 0 }), RangeError), 'fs 0')
  ok(threw(() => deecho(lena, { fs, delay: 1e-6, gain: 0.5 }), RangeError), 'a delay under a sample')
})

test('deecho: the manifest undoes each channel on its own: a stereo take whose channels echo apart', () => {
  let a = lena.subarray(0, 4 * fs), L = Float32Array.from(lines(a, [{ delay: 0.09, gain: 0.5, feedback: 0 }])), R = Float32Array.from(lines(a, [{ delay: 0.137, gain: 0.35, feedback: 0.35 }]))
  is(atom.streaming, false, 'streaming: false (the echo is found in the whole take)')
  let params = Object.fromEntries(Object.entries(atom.params).map(([k, s]) => [k, Float32Array.of(s.default)])), out = [new Float32Array(a.length), new Float32Array(a.length)]
  atom({ sampleRate: fs, maxBlockSize: a.length, maxChannels: 2, params })([[L, R]], [out], params)
  ok(same(out[0], deecho(L, { fs })) && same(out[1], deecho(R, { fs })), 'each channel as the kernel undoes it alone')
  ok(err(out[0], a) < -40 && err(out[1], a) < -40, `left ${err(out[0], a).toFixed(1)} dB, right ${err(out[1], a).toFixed(1)} dB of the dry take left`)
  let given = { delay: Float32Array.of(0.09), gain: Float32Array.of(0.5), feedback: Float32Array.of(0) }, one = [new Float32Array(a.length)]
  atom({ sampleRate: fs, maxBlockSize: a.length, maxChannels: 1, params: given })([[L]], [one], given)
  ok(err(one[0], a) < -60, `delay and gain given: ${err(one[0], a).toFixed(1)} dB left`)
})

// MUSDB18 previews (Rafii et al. 2017), mono at 44.1 kHz, where the data set is installed (scripts in @audio/denoise)
const MUS = `${homedir()}/.cache/audiojs/data/musdb/test-mono`
test('deecho: music: no echo found in MUSDB18\'s 50 test previews; one added to a preview found and undone', { skip: !existsSync(MUS) }, () => {
  let f32 = p => new Float32Array(readFileSync(p).buffer.slice(0)), files = readdirSync(MUS).filter(f => f.endsWith('.f32')).sort(), found = []
  for (let f of files) if (estimate(f32(`${MUS}/${f}`), { fs }).length) found.push(f)
  is(found, [], `${files.length} previews, none with an echo found`)
  let x = f32(`${MUS}/02.f32`)
  for (let [ms, g, f] of [[80, 0.5, 0], [150.37, 0.2, 0.2], [400, 0.5, 0]]) {
    let D = ms / 1000 * fs, y = ideal(x, D, g, f), [e] = estimate(y, { fs }), out = deecho(y, { fs })
    ok(e && Math.abs(e.delay * fs - D) < 0.2 && Math.abs(e.gain - g) < 0.02, `${ms} ms, ${g}: ${e ? `${(e.delay * fs - D).toFixed(3)} samples off, gain ${e.gain.toFixed(3)}` : 'none'}`)
    ok(err(out, x) < -35, `${ms} ms, ${g}: ${err(y, x).toFixed(1)} → ${err(out, x).toFixed(1)} dB`)
  }
})
