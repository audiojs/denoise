// De-click: find clicks as outliers of the AR prediction error; find how far each reaches, and whether it rings on as
// a damped resonance struck at its onset, by which explains the sound best; rebuild the sound under it as its most
// likely value, the click taken for Gaussian noise of its own level and spectrum (Godsill & Rayner 1998, "Digital
// Audio Restoration" §5, ch. 7, ch. 9; Janssen, Veldhuis & Vries 1986).
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
//   5. Each judged under AR(N/8) fitted to N = 46 ms either side, the click's `longest` ms left out, by the error a
//      model leaves over the click and the model's reach after it: a gap from the click's start over each length
//      from its first sample to its end, or to the end of a click found within `longest` of it (a dropout's two
//      edges); a damped resonance β·ρᵗ·cos(ωt + φ) struck at the onset, with a gap over the onset or over its first
//      sample alone (Godsill & Rayner ch. 7: a stylus's tick and a scratch's pop ring on in a tail the AR(order) error
//      barely shows where the sound's own resonances hide it). The gaps nest, so one Levinson-Durbin pass gives every
//      length's error. Kept: the least T·ln E + k·cost (Schwarz 1978), a gap's sample at its marginal likelihood's
//      cost under a Gaussian click of the onset's size, ln(σn²·r₀/σe²) (Godsill & Rayner ch. 9), no less than BIC's
//      ln T; the resonance's (β, φ, ω, ρ) at 2·ln T each, as ω and ρ are searched; none with more energy past its gap
//      than twice the recording's there (a click is in the recording; a sound's own ring fitted from a false onset
//      can have more). The resonance is then taken off. None at all if the sound's own excitation explains it
//      better: innovation outliers over [a, a + l), the error's own samples free, of less cost than any click added
//      to the sound (Chang, Tiao & Chen 1988: an innovation outlier against an additive one; a plosive's burst, a
//      note's attack).
//   6. The gap rebuilt by AR(N/4) fitted to N either side with it zeroed, least squares (lpc arBridge), refitted on
//      the filled, again; then as the sound's posterior mean under the click d = x − s as Gaussian noise: an
//      envelope (its RMS within m/16) times AR(4) noise of its own spectrum, Σd⁻¹ = V⁻½·AᵀA·V⁻½/σw², so the sound is
//      kept where the click is weak, in time and in frequency: (R/σ² + Σd⁻¹)·u = −R_k·x_k/σ² + Σd⁻¹·x_g, R the sound
//      model's autocorrelation, σ² its excitation's variance (Godsill & Rayner §5.3, the click coloured). The click's
//      model by EM, 10 steps from half what least squares took off (the other half its own error), each from what
//      the last took off.
//
// `regions` ([{ at, duration }], s) says where the clicks are: they are looked for only there, and none there is
// taken for a periodic pulse or left for its length (each still judged against the sound's own excitation, step 5).
// Samples no click reaches come back bit-exact. The windows and blocks
// count from the data's start: a run over part of a longer sound, starting on a multiple of W/2 with 4·W of it
// either side, rebuilds its middle as a run over the whole would.

import { arFit, arBridge } from '@audio/lpc'

// detection's widening level; a pulse's like within VETO; the click's AR order and EM steps
const KL = 3, VETO = 2, Q = 4, EM = 10

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

  // each click: its span [a, b), its onset's [a, g), its first sample over the threshold i
  let found = []
  for (let i = p; i < n; i++) {
    if (!looked(i) || !over(i, K)) continue
    let a = i, b = i
    for (let j = a - 1; j >= Math.max(0, a - guard) && i - a <= longest; j--) if (over(j, KL)) a = j
    for (let j = b + 1; j <= Math.min(n - 1, b + reach) && b - i <= longest; j++) if (over(j, KL)) b = j
    if (!only && pulse(e, a, b, near, far)) { i = b; continue }
    let l = found.at(-1), r = [Math.max(0, a - guard), Math.min(n, b + 1 + guard), Math.min(n, i + 1 + guard), i]
    if (l && r[0] - l[1] <= reach) l[1] = Math.max(l[1], r[1])
    else found.push(r)
    i = b
  }

  // each rebuilt in turn: its gap may reach the end of any found within `longest` of its start (a dropout's two edges)
  let N = Math.round(2048 * fs / 44100), done = 0
  for (let k = 0; k < found.length; k++) {
    let [a, b, g, i] = found[k]
    if (b <= done) continue
    if (a < done) a = done, g = Math.max(g, a + 1), i = Math.max(i, a)
    if (!only && b - a > longest) continue
    let L = Math.max(longest, b - a), to = b
    for (let j = k + 1; j < found.length && found[j][0] < a + longest; j++) to = Math.max(to, Math.min(found[j][1], a + L))
    let c = model(out, a, a + L, N >> 3, N), click = extent(out, a, i, g, to, L, c, longest / 5, fs)
    if (!click) continue
    let { end, y } = click
    if (y) for (let t = 0; t < y.length && a + t < n; t++) out[a + t] -= y[t]
    fill(out, a, end, N >> 2, N)
    done = end
  }
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

// The click from a, its first sample over the threshold i, its onset [a, g), judged under AR model c by the error E
// it leaves over rows a..a+T, T = L + the model's order (all its reach), each model's gap free: a gap [a, a + l) for
// every l from i − a + 1 to `to` − a; a resonance zᵗ = ρᵗe^{iωt} from a with the gap [a, g), or with the gap over
// [a, i] alone, of least E over ω (0 to 0.47 fs) and τ = −1/ln ρ (0.03 ms to tmax) on a grid, then refined. Kept: the
// least T·ln E + k (step 5). Returns the gap's end and the resonance's samples (y null: none), or null if the sound's
// own excitation explains it better.
function extent(x, a, i, g, to, L, c, tmax, fs) {
  let p = c.length - 1, T = Math.min(L + p, x.length - a), l = g - a, r = autocorr(c)
  let M = Math.max(l, to - a), lmin = Math.min(l, i - a + 1)
  if (T <= p + 2 || M + p > T) return { end: Math.max(g, to), y: null }
  let xl = new Float64Array(T + p)
  for (let t = 0; t < T + p; t++) xl[t] = a - p + t >= 0 ? x[a - p + t] : 0
  let e0 = new Float64Array(T), E0 = 0
  for (let t = 0; t < T; t++) { let v = 0; for (let k = 0; k <= p; k++) v += c[k] * xl[p + t - k]; e0[t] = v, E0 += v * v }
  // h = Cᵀe0, C the gap's columns (column j: c from row j)
  let h = new Float64Array(M), lT = Math.log(T)
  for (let j = 0; j < M; j++) { let s = 0; for (let k = 0; k <= p && j + k < T; k++) s += c[k] * e0[j + k]; h[j] = s }

  // the gap [a, a + n): CᵀC (the n×n Toeplitz of r) = LLᵀ; the click there by least squares, (CᵀC)⁻¹h; e0 with it off
  let gap = n => {
    let Lc = new Float64Array(n * n), d = h.slice(0, n), e = Float64Array.from(e0), E = 0
    for (let u = 0; u < n; u++) for (let j = 0; j <= u; j++) {
      let s = u - j <= p ? r[u - j] : 0
      for (let k = 0; k < j; k++) s -= Lc[u * n + k] * Lc[j * n + k]
      Lc[u * n + j] = u === j ? Math.sqrt(Math.max(s, 1e-300)) : s / Lc[j * n + j]
    }
    let lower = v => { for (let u = 0; u < n; u++) { let s = v[u]; for (let k = 0; k < u; k++) s -= Lc[u * n + k] * v[k]; v[u] = s / Lc[u * n + u] } return v }
    lower(d)
    for (let u = n - 1; u >= 0; u--) { let s = d[u]; for (let k = u + 1; k < n; k++) s -= Lc[k * n + u] * d[k]; d[u] = s / Lc[u * n + u] }
    for (let j = 0; j < n; j++) for (let k = 0; k <= p && j + k < T; k++) e[j + k] -= c[k] * d[j]
    for (let t = 0; t < T; t++) E += e[t] * e[t]
    return { n, d, e, E, lower }
  }

  // a gap's sample costs ln(σn²·r0/σe²), its marginal likelihood's under a Gaussian click of the onset's mean square
  // σn² (what least squares takes off there), σe² the error's variance left (Godsill & Rayner ch. 9); ln T at least
  let on = gap(l), sn = 0
  for (let j = 0; j < l; j++) sn += on.d[j] * on.d[j] / l
  let cost = Math.max(lT, Math.log(sn * r[0] * T / Math.max(on.E, 1e-300)))

  // the gaps nest: row m of L⁻¹ is the order-m forward predictor of r (Levinson-Durbin) over √ its error, so E(l)
  // falls from E0 by (L⁻¹h)ₘ² at each m < l: every length at O(M²)
  let best = { B: Infinity }, Bi = Infinity, A = new Float64Array(M), Ap = new Float64Array(M)
  A[0] = 1
  for (let m = 0, E = E0, Ei = E0, P = r[0]; m < M; m++) {
    if (m) {
      let s = m <= p ? r[m] : 0
      for (let j = 1; j < m; j++) s += A[j] * (m - j <= p ? r[m - j] : 0)
      let k = -s / P
      Ap.set(A)
      for (let j = 1; j < m; j++) A[j] = Ap[j] + k * Ap[m - j]
      A[m] = k, P *= 1 - k * k
      if (!(P > 0)) break
    }
    let v = 0
    for (let j = 0; j <= m; j++) v += A[j] * h[m - j]
    E -= v * v / P, Ei -= e0[m] * e0[m]
    if (m + 1 < lmin) continue
    let B = T * Math.log(Math.max(E, 1e-300)) + (m + 1) * cost
    if (B < best.B) best = { B, end: a + m + 1, y: null }
    Bi = Math.min(Bi, T * Math.log(Math.max(Ei, 1e-300)) + (m + 1) * cost)
  }
  for (let R of [resonance(on), lmin < l ? resonance(gap(lmin)) : null]) if (R && R.B < best.B) best = R
  // the sound's own: its excitation's outliers over [a, a + l) explain it better than any click added to it
  if (Bi < best.B) return null
  return best

  // the gap G and a resonance from a: E at z, the resonance spent within T. Its error u(t) = Σ c_k z^{t−k} meets G's
  // error e as Σ_i z^i·w(i), w(i) = Σ c_k e(i + k); with K = Σ_{k≥1} r_k z^k, Σ|u|² = (r0 + 2·Re K)/(1 − ρ²) and
  // Σu² = (r0 + 2K)/(1 − z²) give the products of u's real and imaginary parts; Cᵀu: v_j = Σ_{k=1..j} r_k z^{j−k} +
  // z^j·(r0 + K); projected off the gap, uᵀu − vᵀ(CᵀC)⁻¹v; β by least squares
  function resonance({ n, e, E: Eg, lower }) {
    let w = new Float64Array(T), v1 = new Float64Array(n), v2 = new Float64Array(n)
    for (let t = 0; t < T; t++) { let s = 0; for (let k = 0; k <= p && t + k < T; k++) s += c[k] * e[t + k]; w[t] = s }
    let E = (f, tau) => {
      let rho = Math.exp(-1000 / (tau * fs)), zr = rho * Math.cos(2 * Math.PI * f / fs), zi = rho * Math.sin(2 * Math.PI * f / fs)
      let hr = 0, hi = 0
      for (let k = p; k >= 1; k--) { let t = hr * zr - hi * zi + r[k]; hi = hr * zi + hi * zr, hr = t }
      let Gr = hr * zr - hi * zi, Gi = hr * zi + hi * zr
      let A = (r[0] + 2 * Gr) / (1 - rho * rho), dr = 1 - zr * zr + zi * zi, di = -2 * zr * zi, dd = dr * dr + di * di
      let Br = ((r[0] + 2 * Gr) * dr + 2 * Gi * di) / dd, Bi = (2 * Gi * dr - (r[0] + 2 * Gr) * di) / dd
      let s11 = (A + Br) / 2, s22 = (A - Br) / 2, s12 = Bi / 2, qr = 0, qi = 0
      for (let t = T - 1; t >= 0; t--) { let q = qr * zr - qi * zi + w[t]; qi = qr * zi + qi * zr, qr = q }
      for (let j = 0, Pr = 0, Pi = 0, Zr = 1, Zi = 0; j < n; j++) {
        if (j) {
          let t = Pr * zr - Pi * zi + (j <= p ? r[j] : 0); Pi = Pr * zi + Pi * zr, Pr = t
          t = Zr * zr - Zi * zi; Zi = Zr * zi + Zi * zr, Zr = t
        }
        v1[j] = Pr + Zr * (r[0] + Gr) - Zi * Gi, v2[j] = Pi + Zr * Gi + Zi * (r[0] + Gr)
      }
      lower(v1), lower(v2)
      for (let j = 0; j < n; j++) s11 -= v1[j] * v1[j], s12 -= v1[j] * v2[j], s22 -= v2[j] * v2[j]
      let d = s11 * s22 - s12 * s12, b1 = 0, b2 = 0
      if (d > 1e-9 * s11 * s22) b1 = (qr * s22 - qi * s12) / d, b2 = (qi * s11 - qr * s12) / d
      else if (s11 > 0) b1 = qr / s11
      return { E: Eg - b1 * qr - b2 * qi, f, tau, b1, b2, zr, zi }
    }
    let R = { E: Infinity }, tm = tmax * 1000 / fs
    let at = (f, tau) => { if (tau >= 0.03 && tau <= tm) { let s = E(f, tau); if (s.E < R.E) R = s } }
    for (let f = 0; f < 0.47 * fs; f = f ? f * 1.12 : 60) for (let tau = 0.03; tau <= tm; tau *= 1.3) at(f, tau)
    for (let df = 0.06, dt = 0.15, it = 0; it < 12; it++, df /= 1.6, dt /= 1.6) {
      let { f, tau } = R
      at(f * (1 + df), tau), at(f / (1 + df), tau), at(f, tau * (1 + dt)), at(f, tau / (1 + dt))
    }
    if (!(R.E < Infinity)) return null
    // the resonance, to −80 dB of its size past the gap (within it the gap's free)
    let { b1, b2, zr, zi } = R, y = new Float64Array(Math.min(T, n + Math.ceil(R.tau * fs / 1000 * Math.log(1e4))))
    for (let t = 0, pr = 1, pi = 0; t < y.length; t++) { y[t] = b1 * pr + b2 * pi; let q = pr * zr - pi * zi; pi = pr * zi + pi * zr, pr = q }
    // a click is in the recording: what's taken off past the gap has no more than twice the energy recorded there
    let Ey = 0, Ex = 0
    for (let t = n; t < y.length; t++) Ey += y[t] * y[t], Ex += x[a + t] * x[a + t]
    if (Ey > 2 * Ex) return null
    return { B: T * Math.log(Math.max(R.E, 1e-300)) + n * cost + 8 * lT, end: a + n, y }
  }
}

// x[a, b) rebuilt in place from C samples either side: AR(p) fitted with the gap zeroed, least squares, refitted on the
// filled, again; then the posterior mean under the click as coloured Gaussian noise, its model by EM (step 6). A gap
// longer than the model's order stays least squares.
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
    // the sound's part: R/σ² over the gap (Toeplitz), and −R_k·x_k/σ² from the samples about it
    let rf = autocorr(c), sw = Math.max(1, Math.round(m / 16)), q = Math.min(Q, m >> 2)
    let xg = Float64Array.from(x.subarray(a, b)), u = seg.slice(g0, g1), rhs = new Float64Array(m)
    let H = new Float64Array(m * m), P = new Float64Array(m * m), y = new Float64Array(m), d = new Float64Array(m), v = new Float64Array(m)
    for (let i = 0; i < m; i++) {
      let gi = g0 + i, s = 0
      for (let j = Math.max(0, gi - p); j < g0; j++) s += rf[gi - j] * seg[j]
      for (let j = g1, e = Math.min(seg.length - 1, gi + p); j <= e; j++) s += rf[j - gi] * seg[j]
      rhs[i] = -s / ve
    }
    for (let it = 0; it < EM; it++) {
      // the click's envelope v and, whitened by it, its AR(q): Σd⁻¹ = V⁻½·AᵀA·V⁻½/σw² (A lower triangular Toeplitz)
      for (let i = 0; i < m; i++) d[i] = xg[i] - u[i]
      for (let i = 0; i < m; i++) {
        let t = 0, k = 0
        for (let j = Math.max(0, i - sw); j <= Math.min(m - 1, i + sw); j++) t += d[j] * d[j], k++
        v[i] = Math.sqrt(Math.max(t / k / (it ? 1 : 2), ve * 1e-6))
      }
      let f = q > 0 ? arFit(d.map((t, i) => t / v[i]), q) : null, A = f && f.e > 0 && f.a.every(Number.isFinite) ? f.a : Float64Array.of(1)
      let sw2 = f && f.e > 0 ? f.e / m : 1, o = A.length - 1
      P.fill(0)
      for (let t = 0; t < m; t++) for (let i = Math.max(0, t - o); i <= t; i++) for (let j = Math.max(0, t - o); j <= t; j++) P[i * m + j] += A[t - i] * A[t - j] / sw2
      for (let i = 0; i < m; i++) {
        let t = 0
        for (let j = 0; j < m; j++) {
          let w = P[i * m + j] / (v[i] * v[j]), k = Math.abs(i - j)
          H[i * m + j] = (k <= p ? rf[k] / ve : 0) + w, t += w * xg[j]
        }
        y[i] = rhs[i] + t
      }
      let w = solve(H, y, m)
      if (!w) break
      u = w
    }
    seg.set(u, g0)
  }
  for (let i = a; i < b; i++) x[i] = seg[i - s0]
}

// H·u = y, H symmetric positive definite (m×m, dense): Cholesky; null if not definite
function solve(H, y, m) {
  let L = new Float64Array(m * m), u = Float64Array.from(y)
  for (let i = 0; i < m; i++) for (let j = 0; j <= i; j++) {
    let s = H[i * m + j]
    for (let k = 0; k < j; k++) s -= L[i * m + k] * L[j * m + k]
    if (i > j) L[i * m + j] = s / L[j * m + j]
    else if (s > 0) L[i * m + i] = Math.sqrt(s)
    else return null
  }
  for (let i = 0; i < m; i++) { let s = u[i]; for (let k = 0; k < i; k++) s -= L[i * m + k] * u[k]; u[i] = s / L[i * m + i] }
  for (let i = m - 1; i >= 0; i--) { let s = u[i]; for (let k = i + 1; k < m; k++) s -= L[k * m + i] * u[k]; u[i] = s / L[i * m + i] }
  return u
}
