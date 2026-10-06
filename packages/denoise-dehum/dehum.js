// Mains hum removal: the hum measured, then subtracted.
//
// Mains hum is a few sinusoids at the harmonics of the mains frequency, each holding its level for seconds; a voice or
// an instrument passes through those frequencies and moves on. A notch can't tell the two apart: it takes whatever its
// band holds, a band that grows with the harmonic (Q 30: 1.7 Hz at 50 Hz, 33 Hz at 1 kHz), and rings on it; narrow,
// it misses the upper harmonics as the mains frequency wanders. So dehum estimates each harmonic as a slowly turning
// phasor and subtracts the sinusoid it describes (harmonic subtraction, as power-line interference is taken out of ECG:
// Levkov et al., BioMed Eng OnLine 4:50, 2005):
//
//   1. measure   the series, 50 or 60 Hz, and its frequency over the whole signal (`measure` below); no hum, no change.
//   2. analyse   x in Hann frames four mains cycles long, two apart: each harmonic's phasor c_h(m) = 2·Σ w·x·e^(−j·h·ω₀·n)
//                / Σ w. The other harmonics fall on the window's zeros and the program far from a line on its
//                sidelobes, so neither leaks into the line's phasors.
//   3. fit       each phasor over T = 2 s (Hann) by weighted local-linear least squares (normalized convolution,
//                Knutsson & Westin, CVPR 1993), each frame weighted by the inverse of the program's power around the
//                line there (the fit's residual over 0.1 s): a passing voice or note is bridged from the frames around
//                it rather than averaged in. The linear term keeps the fit centred where the weights are lopsided.
//   4. track     the mains phase δ: the grid's frequency wanders ±0.02–0.05 Hz, h times that at harmonic h. The fitted
//                phasors' turn from frame to frame, over h, weighted by h²·SNR (harmonics combined as for ENF
//                estimation: Hajj-Ahmad, Garg & Wu, IEEE SPL 20(9), 2013), averaged over 8 s and integrated; twice,
//                the phasors refitted along it. Where it turns on average by more than 0.01 Hz, the measured f0 was
//                off, as when cuts in an edited take jump the hum's phase and spread its line in the measurement (eight
//                cuts in a minute: 0.07 Hz): f0 is moved by that turn and all estimated again.
//   5. subtract  Σ_h Re(a_h·e^(j·h·(ω₀·t + δ))), a_h and δ interpolated between frames.
//
// What it takes of the program is what lies within a fraction of a hertz of a line, mostly from where the program is
// quiet around it; a note held within ~0.5 Hz of a line for seconds goes with the hum. A cut in the recording jumps the
// hum's phase: within a second of it the fit blends the two phases (~9 dB down there, not ~40).
//
//   freq       fundamental, Hz; omitted (or 0): measured, the 50 or 60 Hz series. Given: that series, its exact
//              frequency measured within ±0.4 % (mains tolerance), or within ±drift Hz (default 0.5) when adaptive.
//   harmonics  remove h = 1..harmonics; omitted (or 0): every harmonic up to 1 kHz.
//
// Returns the same buffer, processed in place. One call takes the whole signal: the fit looks a second either side,
// the measurement wants a second at least. Shorter, nothing is measured: without `freq` the audio passes through, with
// it the harmonics are removed as told.

import { cascade, lowpass } from '@audio/biquad'

const MIN = 1, FMAX = 1000
const CYCLES = 2, T = 2, TR = 0.1, TT = 8, KAPPA = 0.01      // hop (cycles); fit, weights, tracking (s); weight floor
const DF = 0.01                                              // Hz: f0 found further off is estimated again

export default function dehum(data, params = {}) {
  if (!data?.length) return data
  let fs = params.fs || 44100, p = plan(data, fs, params)
  if (p) subtract(data, fs, p.f0, p.hs)
  return data
}

// the fundamental and the harmonics to remove, or null
function plan(data, fs, params) {
  let freq = params.freq || 0, harmonics = params.harmonics || 0, short = data.length < MIN * fs
  let m = short ? null : measure(data, fs, freq ? [freq] : [50, 60], freq && params.adaptive ? (params.drift ?? 0.5) / freq : 0.004)
  let f0 = m ? m.f0 : (short || harmonics) && freq
  if (!f0) return null
  let hs = []
  for (let h = 1; h <= (harmonics || Math.floor(FMAX / f0)) && h * f0 < fs / 2; h++) hs.push(h)
  return { f0, hs }
}

// estimate the hum at harmonics hs of f0 and subtract it from x, in place. Where the tracked mains phase turns on
// average, f0 is off: estimated again at f0 moved by that turn, up to four times, on the same frames
function subtract(x, fs, f0, hs) {
  let H = Math.round(CYCLES * fs / f0), e = estimate(x, fs, f0, hs, H)
  for (let it = 0; e && it < 4 && Math.abs(e.df) > DF; it++) e = estimate(x, fs, f0 += e.df, hs, H)
  if (e) synthesize(x, ...e.args)
}

// the hum at harmonics hs of f0 in x, in frames of 2H hopped by H: synthesize()'s arguments, and the tracked phase's
// mean turn in Hz; null under two frames
function estimate(x, fs, f0, hs, H) {
  let M = Math.floor(x.length / H)
  if (M < 2 || !hs.length) return null
  let w0 = 2 * Math.PI * f0 / fs, fr = fs / H
  let g = hann(T * fr), gr = hann(TR * fr), lin = M >= g.length          // a clip shorter than the window: constant fit
  let { c, full } = phasors(x, H, M, w0, hs), w = weigh(c, full, g, gr, lin), delta = track(c, w, hs, g, gr, lin, fr)
  let df = (delta[M - 1] - delta[0]) / (M - 1) * fs / (2 * Math.PI * H)
  return { df, args: [H, M, w0, hs, c.map((ck, k) => fit(rotate(ck, delta, hs[k]), w[k], g, lin)), delta] }
}

// each frame's weight: the inverse of the residual's local power around the line, from a uniform fit and then twice
// from the weighted one; floored at KAPPA of the line's mean power
function weigh(c, full, g, gr, lin) {
  return c.map(ck => {
    let M = ck[0].length, w = Float64Array.from(full), a = fit(ck, w, g, lin)
    for (let it = 0; it < 2; it++) {
      let r = residual(ck, a, gr), p = 0
      for (let m = 0; m < M; m++) p += a[0][m] ** 2 + a[1][m] ** 2
      for (let m = 0; m < M; m++) w[m] = full[m] / (r[m] + KAPPA * p / M + 1e-30)
      a = fit(ck, w, g, lin)
    }
    return w
  })
}

// the mains phase δ per frame: the fitted phasors' turn from frame to frame over h, weighted by h²·SNR, averaged over
// TT and integrated, twice (the second time along the first)
function track(c, w, hs, g, gr, lin, fr) {
  let M = w[0].length, delta = new Float64Array(M)
  for (let it = 0; it < 2; it++) {
    let num = new Float64Array(M - 1), den = new Float64Array(M - 1)
    for (let k = 0; k < hs.length; k++) {
      let h = hs[k], cd = rotate(c[k], delta, h), a = fit(cd, w[k], g, lin), [re, im] = a, s = snr(cd, a, w[k], g, gr)
      for (let m = 0; m + 1 < M; m++) {
        let q = (s[m] + s[m + 1]) / 2
        num[m] += q * h * Math.atan2(im[m + 1] * re[m] - re[m + 1] * im[m], re[m + 1] * re[m] + im[m + 1] * im[m])
        den[m] += q * h * h
      }
    }
    for (let m = 0; m + 1 < M; m++) num[m] = den[m] > 0 ? num[m] / den[m] : 0
    let d = average(num, Math.round(TT * fr))
    for (let m = 1, acc = 0; m < M; m++) delta[m] += acc += d[m - 1]
  }
  return delta
}

// each harmonic's phasor per frame: Hann over 2H samples, hop H: [re, im]. The window's zeros fall on all the other
// harmonics, and its sidelobes keep the program far from a line out of that line's phasors.
// Non-finite samples count as 0. Also each frame's weight to start from: 1, or 0 for a frame the signal's ends cut
// (a cut window's zeros miss the harmonics), unless fewer than two frames are whole: then those are renormalized.
function phasors(x, H, M, w0, hs) {
  let N = 2 * H, o = H >> 1, fr = new Float64Array(N), win = new Float64Array(N), out = hs.map(() => [new Float64Array(M), new Float64Array(M)])
  let whole = m => m * H - o >= 0 && m * H - o + N <= x.length, full = Float64Array.from({ length: M }, (_, m) => +whole(m))
  if (full.reduce((s, v) => s + v, 0) < 2) full.fill(1)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / N)
  let tabs = hs.map(h => { let tc = new Float64Array(N), ts = new Float64Array(N); for (let i = 0; i < N; i++) tc[i] = win[i] * Math.cos(h * w0 * i), ts[i] = win[i] * Math.sin(h * w0 * i); return [tc, ts] })
  for (let m = 0; m < M; m++) {
    let n0 = m * H - o, sum = 0
    for (let i = 0; i < N; i++) { let n = n0 + i, v = x[n], in_ = n >= 0 && n < x.length; fr[i] = in_ && Number.isFinite(v) ? v : 0; if (in_) sum += win[i] }
    for (let k = 0; k < hs.length; k++) {
      let [tc, ts] = tabs[k], sr = 0, si = 0
      for (let i = 0; i < N; i++) sr += fr[i] * tc[i], si -= fr[i] * ts[i]
      let ph = hs[k] * w0 * n0, cs = Math.cos(ph), sn = Math.sin(ph)
      out[k][0][m] = 2 / sum * (sr * cs + si * sn)
      out[k][1][m] = 2 / sum * (si * cs - sr * sn)
    }
  }
  return { c: out, full }
}

// c·e^(−j·h·δ)
function rotate([re, im], delta, h) {
  let r = new Float64Array(re.length), i = new Float64Array(re.length)
  for (let m = 0; m < re.length; m++) { let cs = Math.cos(h * delta[m]), sn = Math.sin(h * delta[m]); r[m] = re[m] * cs + im[m] * sn; i[m] = im[m] * cs - re[m] * sn }
  return [r, i]
}

// weighted local-linear (lin) or local-constant fit of [re, im] over window g: the fitted line's value at each frame
function fit([re, im], w, g, lin) {
  let M = re.length, L = g.length, o = L >> 1, fr = new Float64Array(M), fi = new Float64Array(M)
  for (let m = 0; m < M; m++) {
    let s0 = 0, s1 = 0, s2 = 0, r0 = 0, i0 = 0, r1 = 0, i1 = 0
    for (let j = Math.max(0, o - m), J = Math.min(L, M - m + o); j < J; j++) {
      let n = m + j - o, u = g[j] * w[n], t = j - o
      s0 += u; s1 += u * t; s2 += u * t * t; r0 += u * re[n]; i0 += u * im[n]; r1 += u * t * re[n]; i1 += u * t * im[n]
    }
    let det = s0 * s2 - s1 * s1
    if (lin && det > 1e-9 * s0 * s2) { fr[m] = (s2 * r0 - s1 * r1) / det; fi[m] = (s2 * i0 - s1 * i1) / det }
    else { fr[m] = r0 / s0; fi[m] = i0 / s0 }
  }
  return [fr, fi]
}

// the residual's power |c − a|², averaged over window g
function residual(c, a, g) {
  let M = c[0].length, e = new Float64Array(M)
  for (let m = 0; m < M; m++) e[m] = (c[0][m] - a[0][m]) ** 2 + (c[1][m] - a[1][m]) ** 2
  return smooth(e, g)
}

// each frame's SNR: the fitted phasor's power over the variance the fit carries from the residual, Σ(g·w)²·r / (Σg·w)²
function snr(c, a, w, g, gr) {
  let M = w.length, L = g.length, o = L >> 1, r = residual(c, a, gr), s = new Float64Array(M)
  for (let m = 0; m < M; m++) {
    let n0 = 0, v = 0
    for (let j = Math.max(0, o - m), J = Math.min(L, M - m + o); j < J; j++) { let n = m + j - o, u = g[j] * w[n]; n0 += u; v += u * u * r[n] }
    s[m] = (a[0][m] ** 2 + a[1][m] ** 2) * n0 * n0 / (v + 1e-300)
  }
  return s
}

// weighted average over window g, renormalized at the edges
function smooth(e, g) {
  let M = e.length, L = g.length, o = L >> 1, out = new Float64Array(M)
  for (let m = 0; m < M; m++) {
    let s = 0, n = 0
    for (let j = Math.max(0, o - m), J = Math.min(L, M - m + o); j < J; j++) { s += g[j] * e[m + j - o]; n += g[j] }
    out[m] = s / n
  }
  return out
}

// moving average over L points, renormalized at the edges (running sums)
function average(v, L) {
  let M = v.length, o = L >> 1, out = new Float64Array(M), cs = new Float64Array(M + 1)
  for (let m = 0; m < M; m++) cs[m + 1] = cs[m] + v[m]
  for (let m = 0; m < M; m++) { let a = Math.max(0, m - o), b = Math.min(M, m - o + L); out[m] = (cs[b] - cs[a]) / (b - a) }
  return out
}

// Hann window spanning `len` frames, odd length ≥ 3, its zero ends left out
function hann(len) {
  let L = Math.max(3, 2 * Math.round(len / 2) + 1), g = new Float64Array(L)
  for (let j = 0; j < L; j++) g[j] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (j + 1) / (L + 1))
  return g
}

// x −= Σ_h Re(a_h·e^(j·h·(ω₀·n + δ))), a_h and δ linear between frame centres; held (δ extrapolated) past the ends
function synthesize(x, H, M, w0, hs, a, delta) {
  let t = m => m * H + H - (H >> 1) - 0.5, y = new Float64Array(H + 1)              // frame centres, as phasors() has them
  for (let j = -1; j < M; j++) {
    let n0 = j < 0 ? 0 : Math.ceil(t(j)), n1 = j + 1 < M ? Math.ceil(t(j + 1)) : x.length, N = n1 - n0
    if (N <= 0) continue
    let l = Math.max(j, 0), r = Math.min(j + 1, M - 1), inner = l !== r
    let sl = (j < 0 ? delta[1] - delta[0] : j + 1 >= M ? delta[M - 1] - delta[M - 2] : delta[r] - delta[l]) / H
    if (N > y.length) y = new Float64Array(N)
    y.fill(0, 0, N)
    for (let k = 0; k < hs.length; k++) {
      let h = hs[k], [re, im] = a[k]
      let ph = h * (w0 * n0 + delta[l] + sl * (n0 - t(l))), er = Math.cos(ph), ei = Math.sin(ph)
      let st = h * (w0 + sl), sr = Math.cos(st), si = Math.sin(st)
      let dr = inner ? (re[r] - re[l]) / H : 0, di = inner ? (im[r] - im[l]) / H : 0
      let br = re[l] + (n0 - t(l)) * dr, bi = im[l] + (n0 - t(l)) * di
      for (let i = 0; i < N; i++) {
        y[i] += br * er - bi * ei
        let e = er * sr - ei * si; ei = er * si + ei * sr; er = e
        br += dr; bi += di
      }
    }
    for (let i = 0; i < N; i++) x[n0 + i] -= y[i]
  }
}

// Measure mains hum near the candidate fundamentals: null when the signal is shorter than MIN seconds or no series
// stands out, else { f0, harmonics } with the harmonics (up to 1 kHz) whose lines stand out.
// Mains hum is a sum of sinusoids that hold their frequency for minutes, speech holds none for long: one Fourier
// transform over the whole signal (its first 2^18 samples at ~3 kHz, 80–90 s) gathers each hum line into a peak 1/T
// wide while speech spreads.
// The signal is first brought to ~3 kHz (8th-order Butterworth at 1.1 kHz, every M-th sample) so the transform stays
// small. A line stands out by its peak over the median power of the ±8 Hz around it, its own main lobe left out, and
// stands alone by its peak over every other peak within 3 Hz of it beyond its lobe and the spread the mains' wander
// gives it (±0.06·h Hz): music that repeats a bar is a comb of lines 1/bar apart, lines at 50 and 60 Hz among them
// (at 120 bpm the comb is every 2 Hz), none alone.
export function measure(data, fs, candidates = [50, 60], tol = 0.004) {
  if (data.length < MIN * fs) return null
  let M = Math.max(1, Math.floor(fs / 3000)), fd = fs / M
  let x = Float32Array.from(data)
  if (M > 1) {
    cascade(x, [0.5098, 0.6013, 0.9, 2.5629].map(q => lowpass(1100, q, fs)))   // Butterworth pole pairs, order 8
    let y = new Float32Array(Math.floor(x.length / M))
    for (let i = 0; i < y.length; i++) y[i] = x[i * M]
    x = y
  }
  let L = Math.min(x.length, 1 << 18), N = 2 ** Math.ceil(Math.log2(2 * L)), bin = fd / N
  let re = new Float64Array(N), im = new Float64Array(N)
  for (let i = 0; i < L; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / L))
  fft(re, im)
  let K = Math.min(N >> 1, Math.ceil(1100 / bin)), P = new Float64Array(K)
  for (let k = 0; k < K; k++) P[k] = re[k] * re[k] + im[k] * im[k]
  let lobe = 2 * fd / L                             // Hann main lobe half width, Hz
  let peak = i => P[i] >= P[i - 1] && P[i] >= P[i + 1]
  // the strongest peak between two frequencies: its power over the median of ±8 Hz around it (snr, dB), over the
  // strongest other peak near it (iso, dB), its frequency interpolated on the log power; no local maximum, no line
  let line = (h, f, lo, hi) => {
    let k0 = Math.max(1, Math.floor(lo / bin)), k1 = Math.min(K - 2, Math.ceil(hi / bin)), k = k0
    for (let i = k0; i <= k1; i++) if (P[i] > P[k]) k = i
    if (!peak(k)) return { h, snr: -Infinity, iso: -Infinity, p: h * f, power: 0 }
    let near = [], other = 0, gap = 2 * lobe + 0.06 * h
    for (let i = Math.round((h * f - 8) / bin); i <= Math.round((h * f + 8) / bin); i++)
      if (i > 0 && i < K && Math.abs(i - k) * bin > 2 * lobe) near.push(P[i])
    for (let i = Math.max(1, Math.round(k - (gap + 3) / bin)); i <= Math.min(K - 2, Math.round(k + (gap + 3) / bin)); i++)
      if (Math.abs(i - k) * bin > gap && peak(i)) other = Math.max(other, P[i])
    near.sort((u, v) => u - v)
    let a = Math.log(P[k - 1] || 1e-300), b = Math.log(P[k]), c = Math.log(P[k + 1] || 1e-300)
    let d = a - 2 * b + c ? 0.5 * (a - c) / (a - 2 * b + c) : 0, snr = 10 * Math.log10(P[k] / Math.max(near[near.length >> 1], 1e-300))
    return { h, snr, iso: 10 * Math.log10(P[k] / Math.max(other, 1e-300)), p: (k + Math.max(-0.5, Math.min(0.5, d))) * bin, power: P[k] }
  }
  // Hum is there when the fundamental stands out by 20 dB or two of the first six harmonics by 15 dB, each searched
  // within the mains tolerance and alone by 6 dB, all harmonics of one fundamental (p/h within 0.01 Hz and 2 bins: the
  // grid's wander moves every harmonic alike). Over noise alone, the largest of M independent exponential powers sits
  // (ln M + 0.58)/ln 2 times their median: 8–10 dB for the 35–210 independent bins of a 90 s search. On 504 clean and
  // 504 noisy VoiceBank training utterances these find hum in one, which carries a steady 49.86 Hz tone at the
  // speech's level; in 164 music clips (144 MUSDB18 7 s excerpts, the 20 BabySlakh mixes), in one, with real 50 Hz
  // hum (0.2.0: in 19); with hum 20 dB under the speech, in 95 % (50 Hz) and 92 % (60 Hz) of the utterances.
  let best = null
  for (let f of candidates) {
    let first = []
    for (let h = 1; h <= 6 && h * f < fd / 2 - 10; h++) first.push(line(h, f, h * f * (1 - tol), h * f * (1 + tol)))
    let lines = first.filter(l => l.snr >= 15 && l.iso >= 6), strong = []
    for (let r of lines) {
      let set = lines.filter(l => Math.abs(l.p / l.h - r.p / r.h) <= 0.01 + 2 * bin)
      if (set.reduce((s, l) => s + l.power, 0) > strong.reduce((s, l) => s + l.power, 0)) strong = set
    }
    if (!(strong.some(l => l.h === 1 && l.snr >= 20) || strong.length >= 2)) continue
    let power = strong.reduce((s, l) => s + l.power, 0)
    if (!best || power > best.power) best = { f, strong, power }
  }
  if (!best) return null
  // f0: each strong line's p/h weighted by its precision, h²·SNR; then each harmonic up to 1 kHz searched right at
  // h·f0 (±3 bins, ±0.05 % for drift) is listed when it stands out by 13 dB
  let num = 0, den = 0
  for (let l of best.strong) { let w = l.h * l.h * 10 ** (l.snr / 10); num += w * l.p / l.h; den += w }
  let f0 = num / den, on = []
  for (let h = 1; h * f0 <= 1000 && h * f0 < fd / 2 - 10; h++) {
    let w = Math.max(3 * bin, 0.0005 * h * f0)
    if (line(h, f0, h * f0 - w, h * f0 + w).snr >= 13 || best.strong.some(s => s.h === h)) on.push(h)
  }
  return { f0, harmonics: on }
}

// in-place radix-2 complex FFT (the measurement's only transform)
function fft(re, im) {
  let n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    let ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < len >> 1; j++) {
        let a = i + j, b = a + (len >> 1)
        let tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
        let t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}
