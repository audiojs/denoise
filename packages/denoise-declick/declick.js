// De-click: find clicks as outliers of the AR prediction error; take each for a gap, or for a damped resonance struck
// at its onset, whichever explains the sound better; rebuild it as the sound's most likely value under the click
// (Godsill & Rayner 1998, "Digital Audio Restoration" §5, ch. 7; Janssen, Veldhuis & Vries 1986).
//
//   1. The AR(order) prediction error e of the sound, fitted per window of 46 ms (Hann-weighted, hop W/2), each
//      fit taking the middle half of its window.
//   2. Its local scale σ: the RMS of e per block of W/32 (1.5 ms), the median of those over ±8 blocks. A click
//      fills a block or two, so it can't raise the scale it is judged against.
//   3. The fits again, with every outlier (|e| > threshold·σ), the millisecond before it and `longest` ms after it
//      left out: a loud click otherwise teaches the model its own ringing, and only its onset stands out.
//   4. A click: |e| over threshold·σ, widened while |e| stays over 3σ within 0.5 ms after it and 0.1 ms before
//      (a click starts at once; a voice's pulse just before it would widen it into the voice), 0.1 ms more either
//      side; clicks within 0.5 ms join. One with its like (half its size or more) 2.5–15 ms away is a periodic pulse,
//      a voice's glottal pulse or a plucked string, and is left alone; so is one longer than `longest`.
//   5. Each judged under AR(N/8) fitted to N = 46 ms either side, the click's `longest` ms left out, three ways: as a
//      gap over all of it; as a gap over its onset alone; as that and a damped resonance β·ρᵗ·cos(ωt + φ) struck at
//      the onset (Godsill & Rayner ch. 7: a pulse as a resonance's response to an impulse; a stylus's tick and a
//      scratch's pop are, and ring on in a tail the AR(order) error barely shows, where the sound's own resonances
//      hide it). Each is scored by the error the model leaves over the click and the model's reach after it, its gap's
//      samples free, and the one of least BIC kept (Schwarz 1978): a gap's samples count one each, the resonance's
//      four (β, φ, ω, ρ) twice, as ω and ρ are searched. The resonance is then taken off the sound.
//   6. The gap rebuilt by AR(N/4) fitted to N either side with it zeroed, least squares (lpc arBridge), refitted on
//      the filled, again; then the click taken for noise of variance vn, half the mean square of what least squares
//      took off within m/16 of each sample (the other half the interpolation's own error), and the sound rebuilt as
//      its posterior mean, least squares pulled toward each sample as far as the click there is small (Godsill &
//      Rayner §5.3, the click as additive Gaussian noise): (R + Λ)u = −R_k·x_k + Λx_g, Λ = σ²/vn.
//
// `regions` ([{ at, duration }], s) says where the clicks are: they are looked for only there, and none there is
// taken for a pulse or left for its length. Samples no click reaches come back bit-exact. The windows and blocks
// count from the data's start: a run over part of a longer sound, starting on a multiple of W/2 with 4·W of it
// either side, rebuilds its middle as a run over the whole would.

import { arFit, arBridge } from '@audio/lpc'

const KL = 3, VETO = 2

export default function declick(data, params = {}) {
  let fs = params.fs ?? 44100, ms = fs / 1000, n = data.length
  let p = params.order ?? 32, K = params.threshold ?? 8
  let longest = Math.round((params.longest ?? 6) * ms)
  let W = 2 ** Math.round(Math.log2(0.046 * fs)), B = W >> 5, R = 8
  let near = Math.round(2.5 * ms), far = Math.round(15 * ms), reach = Math.round(0.5 * ms), guard = Math.round(0.1 * ms)
  let out = Float32Array.from(data)
  if (n <= p) return out

  // where clicks are looked for: everywhere, or in the regions alone
  let only = null
  if (params.regions) {
    only = new Uint8Array(n)
    for (let r of params.regions) {
      let a = Math.max(0, Math.round(r.at * fs)), b = Math.min(n, Math.round((r.at + r.duration) * fs))
      if (b > a) only.fill(1, a, b)
    }
  }
  let looked = i => !only || only[i]

  let e = residual(out, p, W), sg = scale(e, B, R)
  let skip = new Uint8Array(n), any = false
  for (let i = p; i < n; i++) if (looked(i) && Math.abs(e[i]) > K * sg[(i / B) | 0]) {
    any = true
    skip.fill(1, Math.max(0, i - Math.round(ms)), Math.min(n, i + longest))
  }
  if (!any) return out
  e = residual(out, p, W, skip), sg = scale(e, B, R)
  let over = (i, k) => Math.abs(e[i]) > k * sg[(i / B) | 0]

  // each click: its span [a, b) and its onset's [a, g)
  let found = []
  for (let i = p; i < n; i++) {
    if (!looked(i) || !over(i, K)) continue
    let a = i, b = i
    for (let j = a - 1; j >= Math.max(0, a - guard) && i - a <= longest; j--) if (over(j, KL)) a = j
    for (let j = b + 1; j <= Math.min(n - 1, b + reach) && b - i <= longest; j++) if (over(j, KL)) b = j
    if (!only && pulse(e, a, b, near, far)) { i = b; continue }
    found.push([Math.max(0, a - guard), Math.min(n, b + 1 + guard), Math.min(n, i + 1 + guard)])
    i = b
  }

  let N = Math.round(2048 * fs / 44100), last = null
  let fix = ([a, b, g]) => {
    if (!only && b - a > longest) return
    let L = Math.max(longest, b - a), c = model(out, a, a + L, N >> 3, N), y = ring(out, a, g, b, L, c, longest / 5, fs)
    if (y) { b = g; for (let t = 0; t < y.length && a + t < n; t++) out[a + t] -= y[t] }
    fill(out, a, b, N >> 2, N)
  }
  for (let r of found) {
    if (last && r[0] - last[1] <= reach) last[1] = Math.max(last[1], r[1])
    else { if (last) fix(last); last = r }
  }
  if (last) fix(last)
  return out
}

// AR(p) prediction error of x, a fit per window of W at hop W/2, each applied over its window's middle half;
// samples in `skip` left out of the fits
function residual(x, p, W, skip) {
  let n = x.length, e = new Float32Array(n), H = W >> 1, seg = new Float64Array(W), I = new Float64Array(p + 1)
  I[0] = 1
  for (let s = -(H >> 1); s < n; s += H) {
    let a0 = Math.max(0, s), a1 = Math.min(n, s + W), w = seg.subarray(0, a1 - a0)
    for (let i = a0; i < a1; i++) w[i - a0] = skip?.[i] ? 0 : x[i] * Math.sin(Math.PI * (i - s + .5) / W) ** 2
    let { a } = arFit(w, p)
    if (!a.every(Number.isFinite)) a = I
    let c0 = s <= 0 ? 0 : s + (W >> 2), c1 = Math.min(n, s + W - (W >> 2))
    for (let i = c0; i < c1; i++) {
      let v = x[i]
      for (let k = 1, m = Math.min(p, i); k <= m; k++) v += a[k] * x[i - k]
      e[i] = v
    }
  }
  return e
}

// per block of B samples: the median, over ±R blocks, of the blocks' RMS
function scale(e, B, R) {
  let nb = Math.ceil(e.length / B), rms = new Float64Array(nb), sg = new Float64Array(nb), w = []
  for (let b = 0; b < nb; b++) {
    let s = 0, i0 = b * B, i1 = Math.min(e.length, i0 + B)
    for (let i = i0; i < i1; i++) s += e[i] * e[i]
    rms[b] = Math.sqrt(s / (i1 - i0))
  }
  for (let b = 0; b < nb; b++) {
    w.length = 0
    for (let j = Math.max(0, b - R); j <= Math.min(nb - 1, b + R); j++) w.push(rms[j])
    w.sort((p, q) => p - q)
    sg[b] = w[w.length >> 1]
  }
  return sg
}

// a periodic pulse: the error peaks within [a, b] at no more than VETO times its peak near..far either side
function pulse(e, a, b, near, far) {
  let pk = 0, m = 0
  for (let j = a; j <= b; j++) pk = Math.max(pk, Math.abs(e[j]))
  for (let j = Math.max(0, a - far); j < a - near; j++) m = Math.max(m, Math.abs(e[j]))
  for (let j = b + near + 1; j <= Math.min(e.length - 1, b + far); j++) m = Math.max(m, Math.abs(e[j]))
  return pk <= VETO * m
}

// AR(q) of x's C samples either side of [a, b), the span zeroed
function model(x, a, b, q, C) {
  let s0 = Math.max(0, a - C), s1 = Math.min(x.length, b + C), seg = Float64Array.from(x.subarray(s0, s1))
  seg.fill(0, a - s0, b - s0)
  let { a: c } = arFit(seg, Math.min(q, seg.length >> 2))
  return c.every(Number.isFinite) ? c : Float64Array.of(1)
}

// r[k] = Σ c[i]·c[i + k]: an AR model's coefficients' autocorrelation, the normal equations' Toeplitz column
const autocorr = c => c.map((_, k) => { let t = 0; for (let i = 0; i + k < c.length; i++) t += c[i] * c[i + k]; return t })

// The click from a, of span [a, b) and onset [a, g), judged under AR model c by the error E it leaves over rows
// a..a+T, T = L + the model's order (all its reach), each model's gap free: the gap [a, b); the gap [a, g); that and a
// resonance zᵗ = ρᵗe^{iωt} from a, of least E over ω (0 to 0.47 fs) and τ = −1/ln ρ (0.03 ms to tmax) on a grid, then
// refined. Kept: the least T·ln E + k·ln T (BIC). Returns the resonance's samples (none: the onset's gap alone), or
// null for the whole gap.
function ring(x, a, g, b, L, c, tmax, fs) {
  let p = c.length - 1, T = Math.min(L + p, x.length - a), l = g - a, r = autocorr(c)
  if (T <= p + 2) return null
  // the error from a, and with the gap [a, b) rebuilt by least squares
  let xl = new Float64Array(T + p)
  for (let t = 0; t < T + p; t++) xl[t] = a - p + t >= 0 ? x[a - p + t] : 0
  let err = () => {
    let s = 0, e = new Float64Array(T)
    for (let t = 0; t < T; t++) { let v = 0; for (let k = 0; k <= p; k++) v += c[k] * xl[p + t - k]; e[t] = v, s += v * v }
    return [e, s]
  }
  let [e0] = err()
  arBridge(xl, p, p + b - a, c)
  let [, Eb] = err()
  // the gap [a, g): its columns C (column j is c from row j), CᵀC the l×l Toeplitz of r = LLᵀ; C projected out of e0
  let Lc = new Float64Array(l * l)
  for (let i = 0; i < l; i++) for (let j = 0; j <= i; j++) {
    let s = i - j <= p ? r[i - j] : 0
    for (let k = 0; k < j; k++) s -= Lc[i * l + k] * Lc[j * l + k]
    Lc[i * l + j] = i === j ? Math.sqrt(Math.max(s, 1e-300)) : s / Lc[j * l + j]
  }
  let lower = v => { for (let i = 0; i < l; i++) { let s = v[i]; for (let k = 0; k < i; k++) s -= Lc[i * l + k] * v[k]; v[i] = s / Lc[i * l + i] } return v }
  let h = new Float64Array(l)
  for (let j = 0; j < l; j++) { let s = 0; for (let k = 0; k <= p && j + k < T; k++) s += c[k] * e0[j + k]; h[j] = s }
  lower(h)
  for (let i = l - 1; i >= 0; i--) { let s = h[i]; for (let k = i + 1; k < l; k++) s -= Lc[k * l + i] * h[k]; h[i] = s / Lc[i * l + i] }
  for (let j = 0; j < l; j++) for (let k = 0; k <= p && j + k < T; k++) e0[j + k] -= c[k] * h[j]
  let Eg = 0
  for (let t = 0; t < T; t++) Eg += e0[t] * e0[t]
  // the resonance's error u(t) = Σ c_k z^{t−k} meets e0 as Σ_t u(t)·e0(t) = Σ_i z^i·w(i), w(i) = Σ c_k e0(i + k)
  let w = new Float64Array(T), v1 = new Float64Array(l), v2 = new Float64Array(l)
  for (let i = 0; i < T; i++) { let s = 0; for (let k = 0; k <= p && i + k < T; k++) s += c[k] * e0[i + k]; w[i] = s }
  // E at z, the resonance spent within T: with G = Σ_{k≥1} r_k z^k, Σ|u|² = (r0 + 2·Re G)/(1 − ρ²) and
  // Σu² = (r0 + 2G)/(1 − z²) give the products of u's real and imaginary parts; Cᵀu: v_j = Σ_{k=1..j} r_k z^{j−k} +
  // z^j·(r0 + G); projected off the gap, uᵀu − vᵀ(CᵀC)⁻¹v; β by least squares
  let E = (f, tau) => {
    let rho = Math.exp(-1000 / (tau * fs)), zr = rho * Math.cos(2 * Math.PI * f / fs), zi = rho * Math.sin(2 * Math.PI * f / fs)
    let hr = 0, hi = 0
    for (let k = p; k >= 1; k--) { let t = hr * zr - hi * zi + r[k]; hi = hr * zi + hi * zr, hr = t }
    let Gr = hr * zr - hi * zi, Gi = hr * zi + hi * zr
    let A = (r[0] + 2 * Gr) / (1 - rho * rho), dr = 1 - zr * zr + zi * zi, di = -2 * zr * zi, dd = dr * dr + di * di
    let Br = ((r[0] + 2 * Gr) * dr + 2 * Gi * di) / dd, Bi = (2 * Gi * dr - (r[0] + 2 * Gr) * di) / dd
    let s11 = (A + Br) / 2, s22 = (A - Br) / 2, s12 = Bi / 2, qr = 0, qi = 0
    for (let i = T - 1; i >= 0; i--) { let t = qr * zr - qi * zi + w[i]; qi = qr * zi + qi * zr, qr = t }
    for (let j = 0, Pr = 0, Pi = 0, Zr = 1, Zi = 0; j < l; j++) {
      if (j) {
        let t = Pr * zr - Pi * zi + (j <= p ? r[j] : 0); Pi = Pr * zi + Pi * zr, Pr = t
        t = Zr * zr - Zi * zi; Zi = Zr * zi + Zi * zr, Zr = t
      }
      v1[j] = Pr + Zr * (r[0] + Gr) - Zi * Gi, v2[j] = Pi + Zr * Gi + Zi * (r[0] + Gr)
    }
    lower(v1), lower(v2)
    for (let j = 0; j < l; j++) s11 -= v1[j] * v1[j], s12 -= v1[j] * v2[j], s22 -= v2[j] * v2[j]
    let d = s11 * s22 - s12 * s12, b1 = 0, b2 = 0
    if (d > 1e-9 * s11 * s22) b1 = (qr * s22 - qi * s12) / d, b2 = (qi * s11 - qr * s12) / d
    else if (s11 > 0) b1 = qr / s11
    return { E: Eg - b1 * qr - b2 * qi, f, tau, b1, b2, zr, zi }
  }
  let best = { E: Infinity }, tm = tmax * 1000 / fs
  let at = (f, tau) => { if (tau <= tm) { let s = E(f, tau); if (s.E < best.E) best = s } }
  for (let f = 0; f < 0.47 * fs; f = f ? f * 1.12 : 60) for (let tau = 0.03; tau <= tm; tau *= 1.3) at(f, tau)
  for (let df = 0.06, dt = 0.15, it = 0; it < 12; it++, df /= 1.6, dt /= 1.6) {
    let { f, tau } = best
    at(f * (1 + df), tau), at(f / (1 + df), tau), at(f, tau * (1 + dt)), at(f, tau / (1 + dt))
  }
  let lT = Math.log(T), Bb = T * Math.log(Eb) + (b - a) * lT, Bg = T * Math.log(Eg) + l * lT, Br = T * Math.log(best.E) + (l + 8) * lT
  if (!(Bg < Bb || Br < Bb)) return null
  if (!(Br < Bg)) return new Float64Array(0)
  // the resonance, to −80 dB
  let { b1, b2, zr, zi } = best, y = new Float64Array(Math.min(T, Math.ceil(best.tau * fs / 1000 * Math.log(1e4))))
  for (let t = 0, pr = 1, pi = 0; t < y.length; t++) { y[t] = b1 * pr + b2 * pi; let q = pr * zr - pi * zi; pi = pr * zi + pi * zr, pr = q }
  return y
}

// x[a, b) rebuilt in place from C samples either side: AR(p) fitted with the gap zeroed, least squares, refitted on the
// filled, again; then the posterior mean under the click as noise of variance vn per sample, half the mean square of
// what least squares took off within m/16 of it: (R + Λ)·u = −R_k·x_k + Λ·x_g, Λ = σ²/vn, R the model's
// autocorrelation, σ² its excitation's variance. A gap longer than the model's order stays least squares.
function fill(x, a, b, p, C) {
  let s0 = Math.max(0, a - C), s1 = Math.min(x.length, b + C)
  let seg = Float64Array.from(x.subarray(s0, s1)), g0 = a - s0, g1 = b - s0, m = g1 - g0, c = null, ve = 0
  p = Math.min(p, seg.length - m - 1)
  seg.fill(0, g0, g1)
  for (let it = 0; it < 2 && p > 0; it++) {
    let f = arFit(seg, p)
    if (!(f.e > 0) || !f.a.every(Number.isFinite)) break
    arBridge(seg, g0, g1, c = f.a), ve = f.e / seg.length
  }
  if (c && m <= p) {
    let rf = autocorr(c), d = new Float64Array(m), y = new Float64Array(m), sw = Math.round(m / 16)
    for (let i = 0; i < m; i++) {
      let s = 0, k = 0
      for (let j = Math.max(0, i - sw); j <= Math.min(m - 1, i + sw); j++) s += (x[a + j] - seg[g0 + j]) ** 2, k++
      d[i] = ve / Math.max(s / k / 2, 1e-30)
    }
    for (let i = 0; i < m; i++) {
      let gi = g0 + i, s = 0
      for (let j = Math.max(0, gi - p); j < g0; j++) s += rf[gi - j] * seg[j]
      for (let j = g1, e = Math.min(seg.length - 1, gi + p); j <= e; j++) s += rf[j - gi] * seg[j]
      y[i] = d[i] * x[a + i] - s
    }
    let u = cholesky(rf, d, y)
    if (u) for (let i = 0; i < m; i++) seg[g0 + i] = u[i]
  }
  for (let i = a; i < b; i++) x[i] = seg[i - s0]
}

// (R + diag d)·u = y, R symmetric Toeplitz of first column r (zero past it): Cholesky; null if not definite
function cholesky(r, d, y) {
  let m = y.length, L = new Float64Array(m * m), q = r.length - 1, u = Float64Array.from(y)
  for (let i = 0; i < m; i++) for (let j = 0; j <= i; j++) {
    let s = (i - j <= q ? r[i - j] : 0) + (i === j ? d[i] : 0)
    for (let k = 0; k < j; k++) s -= L[i * m + k] * L[j * m + k]
    if (i > j) L[i * m + j] = s / L[j * m + j]
    else if (s > 0) L[i * m + i] = Math.sqrt(s)
    else return null
  }
  for (let i = 0; i < m; i++) { let s = u[i]; for (let k = 0; k < i; k++) s -= L[i * m + k] * u[k]; u[i] = s / L[i * m + i] }
  for (let i = m - 1; i >= 0; i--) { let s = u[i]; for (let k = i + 1; k < m; k++) s -= L[k * m + i] * u[k]; u[i] = s / L[i * m + i] }
  return u
}
