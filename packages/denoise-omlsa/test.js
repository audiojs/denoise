// OM-LSA on a held noise (`profile`): the noise learned where it plays alone, held rather than tracked (noise-estimate's
// `known`), speech presence read from γ averaged over neighbouring bins at fixed priors (Gerkmann, Breithaupt
// & Martin 2008) under Cohen's absence gate.
// Steady Gaussian noise and a harmonic "voice" with gaps, deterministic; audio-lena for real speech.

import test, { ok, is, throws } from 'tst'
import raw from 'audio-lena/raw'
import omlsa, { processor, frame } from './omlsa.js'
import { known, noiseProfile } from '@audio/noise-estimate'
import { stftAnalyse, stftBatch } from '@audio/stft'

const fs = 44100
let lena = new Float32Array(raw)

function gauss(n, amp = 1, seed = 7) {
  let d = new Float32Array(n), rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647
  for (let i = 0; i < n; i++) { let s = -6; for (let j = 0; j < 12; j++) s += rnd(); d[i] = amp * s }
  return d
}
// 1 s of noise alone, then speech in the noise
function take(noiseAmp = 0.01, seed = 7) {
  let s = new Float32Array(fs + 4 * fs); s.set(lena.subarray(0, 4 * fs), fs)
  let n = gauss(s.length, noiseAmp, seed)
  return { s, n, y: s.map((v, i) => v + n[i]) }
}
const pw = (x, a = 0, b = x.length) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return e / (b - a) }
// log kurtosis ratio of power spectral values, out over in (Uemura et al., IWAENC 2008): 0 when the noise is only scaled
function kurtRatio(x, y, a, b) {
  let st = z => { let s1 = 0, s2 = 0, c = 0; stftAnalyse(z.subarray(a, b), m => { for (let k = 4; k < 400; k++) { let p = m[k] * m[k]; s1 += p; s2 += p * p; c++ } }, { frameSize: 1024, hopSize: 512 }); return s2 * c / (s1 * s1) }
  return Math.log(st(y) / st(x))
}

test('known: imcra\'s per-frame outputs on a held noise, decision-directed on G_H1 (Cohen & Berdugo 2001 eqs. 15, 18)', () => {
  let N = 1024, half = N / 2, x = gauss(fs, 0.01).map((v, i) => v + 0.2 * Math.sin(2 * Math.PI * 440 * i / fs))
  let profile = noiseProfile(gauss(fs, 0.01, 11), { frameSize: N, hopSize: N / 4, to: fs })
  let est = known(profile, { alphaDD: 0.98 }), eta = new Float64Array(half + 1).fill(1), worst = 0, frames = 0
  // E1 by its series, γ + ln v + Σ (−1)^k v^k / (k k!) negated (A&S 5.1.11), an independent reference
  let e1 = v => { if (v > 30) return 0; let s = 0, t = 1; for (let k = 1; k < 200; k++) { t *= -v / k; s += t / k } return -0.5772156649015329 - Math.log(v) - s }
  stftAnalyse(x, mag => {
    est.update(mag); frames++
    for (let k = 0; k <= half; k++) {
      let g = mag[k] * mag[k] / profile[k], xi = Math.max(0.98 * eta[k] + 0.02 * Math.max(g - 1, 0), 10 ** -2.5)
      let v = g * xi / (1 + xi), G = xi / (1 + xi) * Math.exp(0.5 * e1(v))
      eta[k] = G * G * g
      worst = Math.max(worst, Math.abs(est.xi[k] - xi) / xi, Math.abs(est.gain[k] - G) / G)
    }
  }, { frameSize: N, hopSize: N / 4 })
  is(est.frames, frames, 'every frame counted')
  ok(worst < 1e-5, `ξ and G_H1 as written out, worst relative error ${worst.toExponential(1)}`)
  ok(est.psd.every((v, k) => v === profile[k]), 'the noise held')
  est.update(new Float64Array(half + 1))
  is(est.frames, frames, 'digital silence skipped')
})

test('omlsa with a profile: the noise alone brought down by G_min exactly, no musical noise, at −12 and −20 dB', () => {
  let { y } = take()
  for (let gMin of [-12, -20]) {
    let out = omlsa(y, { fs, profileFrom: 0, profileTo: fs, gMin })
    // the noise-only second, past the first frames
    let down = 10 * Math.log10(pw(y, 0.1 * fs, 0.9 * fs) / pw(out, 0.1 * fs, 0.9 * fs)), lk = kurtRatio(y, out, 0.1 * fs, 0.9 * fs)
    ok(Math.abs(down + gMin) < 0.2, `G_min ${gMin} dB: noise ${down.toFixed(2)} dB down`)
    ok(Math.abs(lk) < 0.02, `G_min ${gMin} dB: log kurtosis ratio ${lk.toFixed(3)}`)
  }
})

test('omlsa with a profile: speech kept, SNR up; the held noise beats the tracked one on steady noise', () => {
  let { s, y } = take(0.02)
  let snr = (a, b0 = fs) => { let p = 0, e = 0; for (let i = b0; i < s.length; i++) { p += s[i] * s[i]; e += (a[i] - s[i]) ** 2 } return 10 * Math.log10(p / e) }
  let held = omlsa(y, { fs, profileFrom: 0, profileTo: fs, gMin: -12 }), tracked = omlsa(y, { fs, gMin: -12 })
  let [a, b, c] = [snr(y), snr(held), snr(tracked)]
  ok(b > a + 5, `SNR ${a.toFixed(1)} → ${b.toFixed(1)} dB held`)
  ok(b > c, `held ${b.toFixed(1)} dB, tracked ${c.toFixed(1)} dB`)
  let level = 10 * Math.log10(pw(held, fs) / pw(s, fs))
  ok(Math.abs(level) < 1.5, `speech level ${level.toFixed(2)} dB from the clean take`)
})

test('omlsa: profileFrom/profileTo is noiseProfile of that stretch; processor under stftBatch is the batch form', () => {
  let { y } = take(), N = frame(fs, true), M = frame(fs)
  let profile = noiseProfile(y, { from: 4410, to: 40000, frameSize: N, hopSize: N / 4 })
  let a = omlsa(y, { fs, profile }), b = omlsa(y, { fs, profileFrom: 4410, profileTo: 40000 })
  ok(a.every((v, i) => v === b[i]), 'the same samples')
  let c = stftBatch(y, processor({ fs, profile }), { frameSize: N, hopSize: N / 4, fs })
  ok(c.every((v, i) => v === a[i]), 'processor: the same gain, frame by frame')
  let t = stftBatch(y, processor({ fs }), { frameSize: M, hopSize: M / 4, fs }), u = omlsa(y, { fs })
  ok(t.every((v, i) => v === u[i]), 'and tracked, without a profile')
  throws(() => omlsa(y, { fs, profile: new Float64Array(10) }), /profile has 10 bins, a 2048 frame has 1025/, 'a profile for no frame is refused')
  throws(() => omlsa(y, { fs, profile, frameSize: 512 }), /profile has \d+ bins, a 512 frame has 257/, 'a profile for another frame is refused')
})

test('omlsa with a profile: the stream form equals the batch under any chunking', () => {
  let { y } = take(), N = frame(fs, true), profile = noiseProfile(y, { to: fs, frameSize: N, hopSize: N / 4 })
  let batch = omlsa(y, { fs, profile }), write = omlsa({ fs, profile }), parts = []
  for (let i = 0; i < y.length; i += 777) parts.push(write(y.subarray(i, i + 777)))
  parts.push(write())
  let out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)), o = 0
  for (let p of parts) { out.set(p, o); o += p.length }
  is(out.length, y.length, 'stream length')
  let md = 0; for (let i = 0; i < y.length; i++) md = Math.max(md, Math.abs(out[i] - batch[i]))
  ok(md < 1e-6, `stream ≡ batch (max deviation ${md.toExponential(1)})`)
})

test('omlsa with a profile at 44.1 kHz: a 2048 frame (46 ms), so held partials under steady noise are kept as at 48 kHz', () => {
  is(frame(44100, true), 2048, 'held: the power of two at or above 32 ms')
  is(frame(44100), 1024, 'tracked: the nearest')
  is([16000, 22050, 48000].map(r => frame(r, true)).join(), '512,1024,2048', 'at the other rates')
  // eighteen harmonics of 110 Hz, each 57 dB under full scale, from 2 s, in white noise 40 dB under; the noise learned
  // from its first second alone. What the gain does to the partials and to the noise, read apart by the phase-inversion
  // method (Hagerman & Olofsson 2004): the take with the noise added and with it subtracted, their half sum and difference
  let n = 6 * fs, nz = gauss(n, 0.01, 3), s = new Float32Array(n)
  for (let h = 1; h <= 18; h++) for (let i = 2 * fs; i < n; i++) s[i] += 0.002 * Math.sin(2 * Math.PI * 110 * h * i / fs + h)
  let o = { fs, profileFrom: 0, profileTo: fs, gMin: -12 }, yp = omlsa(s.map((v, i) => v + nz[i]), o), ym = omlsa(s.map((v, i) => v - nz[i]), o)
  let half = (f, a, b) => { let e = 0; for (let i = a; i < b; i++) e += f(i) ** 2; return e }
  let kept = 10 * Math.log10(half(i => (yp[i] + ym[i]) / 2, 3 * fs, n) / half(i => s[i], 3 * fs, n))
  let down = 10 * Math.log10(half(i => nz[i], 0.2 * fs, 1.8 * fs) / half(i => (yp[i] - ym[i]) / 2, 0.2 * fs, 1.8 * fs))
  ok(kept > -3, `partials kept: ${kept.toFixed(2)} dB (a 1024 frame: −4.2)`)
  ok(Math.abs(down - 12) < 0.3, `the noise alone ${down.toFixed(2)} dB down`)
})

test('omlsa: threshold reads the noise louder, a held profile raised by it, the tracked estimate with it', () => {
  let { y } = take(0.02), N = frame(fs, true), profile = noiseProfile(y, { to: fs, frameSize: N, hopSize: N / 4 })
  let a = omlsa(y, { fs, profile, threshold: 6 }), b = omlsa(y, { fs, profile: profile.map(v => v * 10 ** 0.6) })
  ok(a.every((v, i) => v === b[i]), 'held: the profile 6 dB up')
  let t0 = omlsa(y, { fs }), t6 = omlsa(y, { fs, threshold: 6 }), lv = z => 10 * Math.log10(pw(z, fs) / pw(y, fs))
  ok(lv(t6) < lv(t0) - 0.1, `tracked: what passes ${lv(t0).toFixed(1)} → ${lv(t6).toFixed(1)} dB re the input: more counted as noise`)
  ok(omlsa(y, { fs, threshold: 0 }).every((v, i) => v === t0[i]), 'threshold 0: as without')
})
