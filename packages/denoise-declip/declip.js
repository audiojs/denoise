// De-clip: find the levels a sound was cut at, and rebuild what the cut took off.
//
//   1. The rails. A hard clip piles every sample it cuts onto one level: a point mass at the sound's extreme, in runs.
//      Each sign's rail is its extreme r, taken when the samples within t of it (t = 0.1 % of r, or one step of the
//      sound's PCM grid when coarser) outnumber 10 times those in the next t below, and most of them sit next to
//      another: the top-bin test of FFmpeg's adeclip (1000 bins, ratio 10), relative to the rail so it holds at any
//      level, and per sign so a rail on one side or two different rails are found. A loud peak is one sample; a
//      limiter's ceiling is touched by single samples or by arches, and a sine's top is an arch, which fills the band
//      below about as densely.
//      Lossy coding (MP3, AAC, Opus) spreads a rail into a band: the coder's noise around the level the runs were cut
//      at, a mode of the amplitude density with mass on both sides of it. A waveform's own peaks, a sine's top, a
//      limiter's ceiling, only approach a level from below. So, with no flat rail, each sign's band is its highest mode
//      standing 4 times over the density 2–6 % below it (at 1, 2 and 4 times that scale, for coarser coders), with
//      samples over it reaching 3 of its spreads σ (the RMS of the samples over the mode) and beyond; the sound is
//      cut again at κσ under the mode (κ = 6) and rebuilt as a clip there: every sample over the cut is unknown, held
//      at least at the cut.
//      Soft saturation (tape, a valve or transistor stage driven hot) leaves no rail and no band: a memoryless curve
//      bends the peaks over toward a ceiling. With neither, the curve is fitted by maximum likelihood, the sound under
//      it taken as locally AR Gaussian (a Wiener system inverted blindly: Taleb, Solé-Casals & Jutten 2001): for a
//      curve f, z = f⁻¹(x) is the sound before it, and the likelihood is AR(24)'s of z per window of 46 ms, its
//      variance profiled out, times the Jacobian Π (f⁻¹)'(x). Its curves, of unit slope at 0, each side its ceiling c
//      and both a knee k: c·tanh((|x|/c)^k)^(1/k) (tanh at k = 1, an exponential approach to the ceiling) and
//      x/(1 + (|x|/c)^k)^(1/k) (an algebraic one, as arctan's). Read over the 48 windows of the highest peaks; kept
//      when it gains over 0.02 nats a sample on the sound as it is and bends the loudest peak to half its slope or
//      less (the clean recordings nearest, VocalSet's sung long tones, fit curves leaving 0.6–0.9 of it, 0.01 nats
//      at most; saturation to 10 dB SDR gains 0.07 or more, its peaks bent to 1/17 or less). A curve undoes peaks
//      bent over; it can't make new harmonics predictable, so a band the recording left empty (a lowpass, a codec's)
//      is held at 70 dB under each window (white-noise correction of its fit): a curve's harmonics there cost no more
//      than that. A limiter is no curve: its gain moves over milliseconds and keeps each wave's shape (MUSDB18's
//      mixtures 12 dB into one, under 10⁻⁴ nats a sample). The sound is inverted, z = f⁻¹(x), where the curve's slope
//      is over 1/40 (its noise and the fit's error raised at most 32 dB); above, z is unknown, held at least at f⁻¹
//      there: a clip, rebuilt as one. Sound with no rail, no band and no curve comes back bit-exact.
//   2. Three rebuilds of every sample at a rail, each consistent (held at least as far out as it was recorded: a clip
//      only ever lowers a sample), each strong where the others are weak: sparse methods lead the declipping survey on
//      music (Záviška, Rajmic, Ozerov & Rencker 2021, IEEE JSTSP 15(1)), an AR model wins on speech and on mild
//      clipping, and a sparse model wants blocks as long as the sound holds still.
//      - sparse: A-SPADE (Kitić, Bertin & Gribonval 2015), per block of 93 ms, and per block of 186 ms, as few DFT
//        lines as agree with what was recorded;
//      - AR: per window of 186 ms, AR(order) fitted, every unknown solved at once by exact least squares, refitted and
//        solved again until the fill moves by under 1 % (Janssen, Veldhuis & Vries 1986).
//   3. The blend. A convex combination of consistent rebuilds is consistent; its weights are chosen per region by
//      cross-validation (Stone 1974; stacked regressions, Breiman 1996). The clipped sound is clipped once more, at the
//      share ρ of each rail that takes as large a share of what the first clip left as it took of the whole; each
//      method rebuilds that; the weights, on a grid of tenths over the three, are those whose blend lies nearest what is
//      known there: the samples the second clip hid, and, for those the first took, their recorded bound. They are read
//      per 93 ms over a triangle ±1 s wide; each rebuild then runs only where its weight is not 0. Samples off the
//      rails come back bit-exact. A fixed ρ (0.7) told the methods apart at mild clipping only: at heavy clipping the
//      error lies deep inside runs a shallow second clip never reaches. The validation scores a fill's overshoot inside
//      the first clip's runs as nothing (only its bound is known there), so it can favour the AR rebuild where its fill
//      overshoots: a VoiceBank utterance clipped to 7 dB comes back 2.2 dB under its sparse rebuild alone.

import { arFit, arFill, autocorr, levinson } from '@audio/lpc'
import { fft, ifft } from 'fourier-transform'

const TAU = 1e-3, K = 10, ITERS = 8, TOL = 0.01, G = 10, KAPPA = 6, PROM = 4
// a curve: its likelihood's AR order and floor, the windows read, the nats a sample it must gain, the least slope of
// its inverse at the loudest peak, the inverse's steepest slope
const P = 24, FLOOR = 1e-7, WS = 48, LR = 0.02, BEND = 2, SLOPE = 40
// the rebuilds the blend weighs: the AR one, and the sparse one over blocks of 93 and of 186 ms
const REBUILDS = ['ar', 0.093, 0.186]

export default function declip(data, params = {}) {
  let fs = params.fs ?? 44100, p = params.order ?? 256, n = data.length, out = Float32Array.from(data)
  let cl = params.clipLevel > 0 ? params.clipLevel : 0, q = grid(data), y = data
  let { hi, lo } = cl ? { hi: cl, lo: -cl } : rails(data, q)
  if (hi == null && lo == null && !cl) {
    let b = bands(data), cut = (m, s) => m && m.r - KAPPA * m.s > 0 ? s * (m.r - KAPPA * m.s) : null
    hi = cut(b.hi, 1), lo = cut(b.lo, -1)
    if (hi != null || lo != null) y = Float32Array.from(data, v => hi != null && v > hi ? hi : lo != null && v < lo ? lo : v)
  }
  let mask
  if (hi == null && lo == null) {
    // no rail, no band: a curve, the sound inverted under it where its slope is over 1/SLOPE, a clip at f⁻¹ above
    let c = saturation(data, fs)
    if (!c) return out
    let F = CURVES[c.curve], o = new Float64Array(2), at = (v, s) => F(v, s > 0 ? c.hi : -c.lo, c.k, o)
    let T = s => { let a = 0, b = s > 0 ? c.hi : -c.lo; for (let i = 0; i < 50; i++) { let m = (a + b) / 2; if (at(s * m, s)[1] > Math.log(SLOPE)) b = m; else a = m } return a }
    let tp = T(1), tn = T(-1)
    hi = at(tp, 1)[0], lo = at(-tn, -1)[0]
    mask = Int8Array.from(data, v => v > tp ? 1 : v < -tn ? -1 : 0)
    y = Float32Array.from(data, (v, i) => mask[i] > 0 ? hi : mask[i] < 0 ? lo : v && at(v, v)[0])
    out = Float32Array.from(y)
  } else {
    let th = hi == null ? Infinity : hi - Math.max(TAU * hi, q), tl = lo == null ? -Infinity : lo + Math.max(-TAU * lo, q)
    mask = Int8Array.from(y, v => v >= th ? 1 : v <= tl ? -1 : 0)
  }
  if (!mask.some(Boolean)) return out

  // pieces of 30 s overlapping by 2 (the blend reads ±1 s, a rebuild 186 ms), each rebuilt alone, crossfaded
  let rho = share(y, mask, hi, lo), C = Math.round(30 * fs), O = Math.round(2 * fs)
  for (let a = 0, b = 0; b < n; a = b - O) {
    b = n - a <= C + O ? n : a + C
    let z = rebuild(y.subarray(a, b), mask.subarray(a, b), rho * (hi ?? 0), rho * (lo ?? 0), fs, p)
    for (let i = a; i < b; i++) if (mask[i]) {
      let w = Math.min(1, a ? (i - a + 0.5) / O : 1, b < n ? (b - i - 0.5) / O : 1)
      out[i] = (a && i < a + O ? out[i] : 0) + w * z[i - a]
    }
  }
  return out
}

// the rebuilds of y and their blend; the validation y clipped again at h2 / l2 (0: that side left as it is)
function rebuild(y, mask, h2, l2, fs, p) {
  let n = y.length, z = Float32Array.from(y)
  if (!mask.some(Boolean)) return z
  let up = v => h2 > 0 && v >= h2, dn = v => l2 < 0 && v <= l2
  let y2 = Float32Array.from(y, v => up(v) ? h2 : dn(v) ? l2 : v), m2 = Int8Array.from(y, (v, i) => mask[i] || (up(v) ? 1 : dn(v) ? -1 : 0))
  let run = (r, y, mask, want) => r === 'ar' ? janssen(y, mask, fs, p, want) : spade(y, mask, fs, r, want)
  let W = weights(y, mask, m2, REBUILDS.map(r => run(r, y2, m2)), fs)
  let Z = REBUILDS.map((r, k) => run(r, y, mask, i => W[k][i] > 0))
  for (let i = 0; i < n; i++) if (mask[i]) { let v = 0; for (let k = 0; k < Z.length; k++) if (W[k][i] > 0) v += W[k][i] * Z[k][i]; z[i] = v }
  return z
}

// ρ: the share of its side's rail at or over which as large a share of the unclipped samples lies as the clip took of
// all (from a histogram of 1024 steps): a clip of 1 % is checked on a clip of 1 %, one of 60 % on one of 60 %
function share(y, mask, hi, lo) {
  let h = new Float64Array(1025), c = 0, n = y.length
  for (let i = 0; i < n; i++) {
    if (mask[i]) { c++; continue }
    let v = y[i], u = v > 0 && hi != null ? v / hi : v < 0 && lo != null ? v / lo : 0
    h[Math.min(1024, Math.floor(u * 1024))]++
  }
  let want = c / n * (n - c), k = 1025
  for (let s = 0; k > 0 && s < want; ) s += h[--k]
  return k / 1024
}

// each rebuild's weight per sample: per block of 93 ms, the squared distance of each convex combination on a grid of
// steps 1/G to what the validation knows (a hidden sample's value; a clipped one's bound, missed only below it), summed
// over a triangle ±1 s wide, the least taken; linear between block centres
function weights(y, mask, m2, V, fs) {
  let n = y.length, K = V.length, cs = simplex(K, G), C = cs.length
  let B = 2 ** Math.round(Math.log2(0.093 * fs)), nb = Math.ceil(n / B), E = new Float64Array(nb * C)
  for (let i = 0; i < n; i++) {
    if (!m2[i]) continue
    for (let c = 0, o = ((i / B) | 0) * C; c < C; c++) {
      let v = -y[i], w = cs[c]
      for (let k = 0; k < K; k++) v += w[k] * V[k][i]
      let d = mask[i] > 0 ? Math.min(0, v) : mask[i] < 0 ? Math.max(0, v) : v
      E[o + c] += d * d
    }
  }
  let R = Math.max(1, Math.round(fs / B)), at = new Int32Array(nb), e = new Float64Array(C)
  for (let b = 0; b < nb; b++) {
    e.fill(0)
    for (let j = Math.max(0, b - R); j < Math.min(nb, b + R + 1); j++) for (let c = 0, w = 1 - Math.abs(j - b) / (R + 1); c < C; c++) e[c] += w * E[j * C + c]
    for (let c = 1; c < C; c++) if (e[c] < e[at[b]]) at[b] = c
  }
  return cs[0].map((_, k) => Float32Array.from({ length: n }, (_, i) => {
    if (nb < 2) return cs[at[0]][k]
    let u = Math.min(nb - 1, Math.max(0, i / B - 0.5)), b = Math.min(nb - 2, u | 0)
    return cs[at[b]][k] + (cs[at[b + 1]][k] - cs[at[b]][k]) * (u - b)
  }))
}

// the points of the simplex of K weights on a grid of steps 1/g
function simplex(K, g) {
  if (K === 1) return [[1]]
  let out = []
  for (let a = 0; a <= g; a++) for (let r of simplex(K - 1, g - a)) out.push([a / g, ...r.map(v => v * (g - a) / g)])
  return out
}

// A-SPADE as the survey's code runs it (declipping2020_codes/Methods/SPADE: spade_segmentation.m, aspade.m): blocks of w
// under a peak-1 Hann window at hop w/4, added back under its canonical dual; the analysis operator a DFT of redundancy 2
// (zero-padded, unitary); per block, ADMM between the k largest DFT coefficients (a conjugate pair counted once, DC at
// half) and the block's consistent set, k growing, until the residual ‖Ax − z̄‖ is 1 % of the block's norm (0.1 in the
// survey, at its sounds' level); the iterate of least residual kept. Blocks of `sec` (186 ms in the survey); k grown by
// 1 per iteration up to 50, then by 2 % (the survey: by 1 every 2): 8× fewer iterations, up to 1.7 dB less at 1 dB in,
// 0.3 at 3, as good above (the survey's growth on a violin clipped to 1 dB: 0.3 dB more in 23× the time). Only blocks
// holding a sample `want` takes, and 4 recorded (as janssen's order 2 needs), are rebuilt.
function spade(y, mask, fs, sec, want = () => true) {
  let n = y.length, w = 2 ** Math.round(Math.log2(sec * fs)), a = w >> 2, N = 2 * w, H = w + 1, nrm = Math.sqrt(N)
  let g = Float64Array.from({ length: w }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / w)), gs = new Float64Array(a)
  for (let i = 0; i < w; i++) gs[i % a] += g[i] * g[i]
  let acc = new Float64Array(n), buf = new Float64Array(N), re = new Float64Array(H), im = new Float64Array(H), spec = [re, im]
  let zr = new Float64Array(H), zi = new Float64Array(H), ur = new Float64Array(H), ui = new Float64Array(H)
  let mag = new Float64Array(H), sel = new Float64Array(H), b = new Float64Array(w), x = new Float64Array(w), best = new Float64Array(w)
  let A = () => { buf.set(x); fft(buf, spec); for (let j = 0; j < H; j++) zr[j] = re[j] / nrm, zi[j] = im[j] / nrm }
  for (let c = a - w; c < n; c += a) {
    let any = false, rec = 0, e2 = 0
    for (let i = 0, t = c; i < w; i++, t++) {
      b[i] = t >= 0 && t < n ? y[t] * g[i] : 0, e2 += b[i] * b[i]
      if (t >= 0 && t < n) if (!mask[t]) rec++; else if (want(t)) any = true
    }
    best.set(b)
    if (any && rec >= 4) {
      x.set(b); A(); ur.fill(0); ui.fill(0)
      for (let k = 1, lo = Infinity; ; k += Math.max(1, Math.floor(k / 50))) {
        // z̄ = H_k(Ax + u): the k largest kept
        for (let j = 0; j < H; j++) { let r = zr[j] + ur[j], m = zi[j] + ui[j]; re[j] = r, im[j] = m, mag[j] = sel[j] = (r * r + m * m) / (j ? 1 : 4) }
        let cut = k < H ? select(sel, H - k) : -1, res = 0
        for (let j = 0; j < H; j++) {
          if (mag[j] < cut) re[j] = im[j] = 0
          res += (j && j < H - 1 ? 2 : 1) * ((zr[j] - re[j]) ** 2 + (zi[j] - im[j]) ** 2)
        }
        if (res < lo) lo = res, best.set(x)
        if (res <= 1e-4 * e2 || k >= H) break
        // x: the consistent set's nearest to A*(z̄ − u); then u += Ax − z̄
        for (let j = 0; j < H; j++) ur[j] -= re[j], ui[j] -= im[j], re[j] = -ur[j], im[j] = -ui[j]
        let v = ifft(re, im)
        for (let i = 0, t = c; i < w; i++, t++) {
          let s = t >= 0 && t < n ? mask[t] : 0, u = v[i] * nrm
          x[i] = !s ? b[i] : s > 0 ? Math.max(b[i], u) : Math.min(b[i], u)
        }
        A()
        for (let j = 0; j < H; j++) ur[j] += zr[j], ui[j] += zi[j]
      }
    }
    for (let i = 0, t = c; i < w; i++, t++) if (t >= 0 && t < n) acc[t] += best[i] * g[i] / gs[i % a]
  }
  return Float32Array.from(acc)
}

// the k-th smallest of a (0-based), Hoare's selection; a is reordered
function select(a, k) {
  let l = 0, r = a.length - 1
  while (r > l) {
    let v = a[(l + r) >> 1], i = l, j = r
    while (i <= j) { while (a[i] < v) i++; while (v < a[j]) j--; if (i <= j) { let t = a[i]; a[i] = a[j]; a[j] = t; i++; j-- } }
    if (k <= j) r = j; else if (k >= i) l = i; else break
  }
  return a[k]
}

// Janssen's iteration per window of 186 ms (hop half, sin² crossfade), every masked sample unknown at once: AR fit to the
// window under its taper (the autocorrelation method fits a tapered window, else its cut edges bias the model: Markel &
// Gray 1976; the order at most half the samples recorded there), exact least squares (lpc arFill), each held at least
// as far out as recorded, until the fill moves by under TOL of its norm, at most ITERS times (to 8 every time: within
// 0.15 dB, in half the time at 3 dB). Order 256 and the taper, measured over clipped speech, song and music:
// untapered, 0.2–2.2 dB less SDR on average; order 512, the same in 3× the time. Only windows holding a sample `want`
// takes are rebuilt.
function janssen(y, mask, fs, p, want = () => true) {
  let n = y.length, W = 2 ** Math.round(Math.log2(0.186 * fs)), H = W >> 1, out = Float32Array.from(y)
  let acc = new Float64Array(W), wt = new Float64Array(W), seg = new Float64Array(W), f = new Float64Array(W), gap = []
  let hann = Float64Array.from({ length: W }, (_, j) => Math.sin(Math.PI * (j + 0.5) / W) ** 2)
  for (let s = -H; s < n; s += H) {
    let a0 = Math.max(0, s), a1 = Math.min(n, s + W), w = seg.subarray(0, a1 - a0), tp = hann.subarray(a0 - s), any = false
    gap.length = 0
    for (let i = a0; i < a1; i++) if (mask[i]) gap.push(i - a0), any ||= want(i)
    let order = Math.min(p, (w.length - gap.length) >> 1)
    if (any && order >= 2) {
      for (let i = 0; i < w.length; i++) w[i] = y[a0 + i]
      for (let it = 0, was = Float64Array.from(gap, g => w[g]); it < ITERS; it++) {
        for (let i = 0; i < w.length; i++) f[i] = w[i] * tp[i]
        let { a, e } = arFit(f.subarray(0, w.length), order)
        if (!(e > 0) || !a.every(Number.isFinite) || !arFill(w, gap, a)) break
        let dd = 0, nn = 0
        for (let j = 0; j < gap.length; j++) {
          let g = gap[j], v = y[a0 + g]
          if (mask[a0 + g] > 0 ? w[g] < v : w[g] > v) w[g] = v
          dd += (w[g] - was[j]) ** 2, nn += w[g] ** 2, was[j] = w[g]
        }
        if (it && dd <= TOL * TOL * nn) break
      }
      for (let g of gap) { let j = a0 + g - s; acc[j] += hann[j] * w[g], wt[j] += hann[j] }
    }
    for (let j = Math.max(0, -s), e = Math.min(H, n - s); j < e; j++) if (wt[j] > 0) out[s + j] = acc[j] / wt[j]
    acc.copyWithin(0, H).fill(0, H), wt.copyWithin(0, H).fill(0, H)
  }
  return out
}

// each sign's rail, or null: its extreme, when the samples within t of it are a point mass in runs
export function rails(x, q = grid(x)) {
  let hi = -Infinity, lo = Infinity, n = x.length
  for (let i = 0; i < n; i++) { let v = x[i]; if (v > hi) hi = v; if (v < lo) lo = v }
  let side = (r, s) => {
    if (!(s * r > 0)) return null
    let t = Math.max(TAU * s * r, q), at = i => s * (r - x[i]) < t, T = 0, B = 0, F = 0
    for (let i = 0; i < n; i++) {
      let d = s * (r - x[i])
      if (d < t) { T++; if ((i > 0 && at(i - 1)) || (i + 1 < n && at(i + 1))) F++ }
      else if (d < 2 * t) B++
    }
    return T > K * Math.max(B, 1) && 2 * F >= T ? r : null
  }
  return { hi: side(hi, 1), lo: side(lo, -1) }
}

// each sign's band, a rail lossy coding spread, or null: the side's highest mode over half its extreme (bins of 1/400 of
// it, smoothed over 2s + 1 at scales s = 1, 2, 4) that stands PROM times over the median of the band 8s–24s bins below,
// with r the mode, s the RMS of the samples over it, and those reaching 3s and beyond (mass on both sides of a level:
// noise around a cut; a waveform's own peaks approach a level from below only)
export function bands(x) {
  let n = x.length, B = 400
  let side = sg => {
    let M = 0
    for (let i = 0; i < n; i++) if (sg * x[i] > M) M = sg * x[i]
    if (!(M > 0)) return null
    let h = new Float64Array(B + 1), best = 0, j = 0
    for (let i = 0; i < n; i++) { let v = sg * x[i]; if (v > M / 2) h[Math.min(B, Math.floor(v / M * B))]++ }
    for (let s of [1, 2, 4]) {
      let hs = Float64Array.from(h, (_, k) => { let t = 0; for (let d = -s; d <= s; d++) t += h[k + d] || 0; return t / (2 * s + 1) })
      let low = new Float64Array(16 * s)
      for (let k = B / 2 + 24 * s; k <= B; k++) {
        low.set(hs.subarray(k - 24 * s, k - 8 * s)); low.sort()
        let p = hs[k] / Math.max(low[8 * s], 3 / (2 * s + 1))
        if (p > best) best = p, j = k
      }
    }
    let r = M * (j + 0.5) / B, e = 0, u = 0
    for (let i = 0; i < n; i++) { let v = sg * x[i]; if (v > r) e += (v - r) ** 2, u++ }
    let s = Math.sqrt(e / Math.max(u, 1))
    return best >= PROM && u >= 16 && M - r >= 3 * s ? { r, s } : null
  }
  return { hi: side(1), lo: side(-1) }
}

// The curves a saturation is fitted with, of unit slope at 0, ceiling c, knee k: each as its inverse at x into o[0] and
// the log of the inverse's slope into o[1], u = |x|/c < 1. 'tanh': c·tanh(u^k)^(1/k), tanh at k = 1, an exponential
// approach to the ceiling; 'alg': x/(1 + u^k)^(1/k), x/(1 + |x|/c) at k = 1, x/√(1 + (x/c)²) at 2, an algebraic one.
export const CURVES = {
  tanh: (x, c, k, o) => {
    let u = Math.abs(x) / c, a = u ** k, t = Math.atanh(a)
    o[0] = Math.sign(x) * c * t ** (1 / k), o[1] = (k - 1) * Math.log(u) - Math.log1p(-a * a) - (1 - 1 / k) * Math.log(t)
    return o
  },
  alg: (x, c, k, o) => { let a = (Math.abs(x) / c) ** k; o[0] = x * (1 - a) ** (-1 / k), o[1] = -(1 / k + 1) * Math.log1p(-a); return o },
}

// the log-likelihood of x as `curve` (ceilings cp, cn; Infinity: that side as it is; knee k) of a sound that is locally
// AR(P) Gaussian: per window of W from each start in ws (Hann), AR(P) fitted to z = f⁻¹(x) with a white floor FLOOR
// under its power, its error over the window's middle half, its variance there profiled out; plus Σ ln (f⁻¹)'(x) over
// the same samples (the Jacobian)
function likelihood(x, ws, W, curve, cp, cn, k) {
  let F = CURVES[curve], o = new Float64Array(2), z = new Float64Array(W), w = new Float64Array(W), L = 0, n = x.length
  for (let s of ws) {
    let J = 0
    for (let j = 0; j < W; j++) {
      let t = s + j, v = t >= 0 && t < n ? x[t] : 0, c = v > 0 ? cp : cn
      if (!v || c === Infinity) z[j] = v
      else {
        if (Math.abs(v) >= c) return -Infinity
        F(v, c, k, o), z[j] = o[0]
        if (j >= W >> 2 && j < W - (W >> 2)) J += o[1]
      }
      w[j] = z[j] * Math.sin(Math.PI * (j + 0.5) / W) ** 2
    }
    let r = autocorr(w, P)
    r[0] *= 1 + FLOOR
    let { a } = levinson(r, P), E = 0
    for (let j = W >> 2; j < W - (W >> 2); j++) { let e = z[j]; for (let m = 1; m <= P; m++) e += a[m] * z[j - m]; E += e * e }
    L += -(W >> 2) * Math.log(E / (W >> 1) + 1e-300) + J
  }
  return L
}

// A saturation, or null: { curve, k, hi, lo, gain }, the curve of the most likelihood, its ceilings (lo negative) and
// the nats a sample it gains. Read over the WS windows of 46 ms of the highest peaks: screened on a quarter of them
// (both curves at k = 1, a ceiling shared, c = M·(1 + e^u), u from ln 10⁻⁴ to ln 10 by 2: under a quarter of LR,
// none), then the ceiling and the knee by golden sections in turn, then each side's ceiling with the knee, kept if
// that gains over ½ ln N (Schwarz 1978). Taken if it gains over LR and bends the loudest peak to 1/BEND of its slope
// or less
export function saturation(x, fs = 44100) {
  let W = 2 ** Math.round(Math.log2(0.046 * fs)), H = W >> 1, n = x.length, Mp = 0, Mn = 0, all = []
  for (let v of x) if (v > Mp) Mp = v; else if (-v > Mn) Mn = -v
  if (n < W || !(Mp > 0 && Mn > 0)) return null
  for (let s = -(H >> 1); s + (W >> 2) < n; s += H) {
    let m = 0
    for (let t = Math.max(0, s + (W >> 2)); t < Math.min(n, s + W - (W >> 2)); t++) m = Math.max(m, Math.abs(x[t]))
    all.push([s, m])
  }
  all.sort((a, b) => b[1] - a[1])
  let M = Math.max(Mp, Mn), like = (ws, curve, up, un, lk) => likelihood(x, ws, W, curve, Mp * (1 + Math.exp(up)), Mn * (1 + Math.exp(un)), Math.exp(lk))
  let sym = (ws, curve, u, lk) => likelihood(x, ws, W, curve, M * (1 + Math.exp(u)), M * (1 + Math.exp(u)), Math.exp(lk))
  let ws = all.slice(0, WS >> 2).map(w => w[0]), L0 = sym(ws, 'tanh', Infinity, 0), best = { L: L0 }
  for (let curve of ['tanh', 'alg']) for (let u = Math.log(1e-4); u <= Math.log(10); u += 2) {
    let l = sym(ws, curve, u, 0)
    if (l > best.L) best = { L: l, curve, u }
  }
  if (!best.curve || (best.L - L0) / (ws.length * H) < LR / 4) return null
  ws = all.slice(0, WS).map(w => w[0]), L0 = sym(ws, 'tanh', Infinity, 0)
  let { curve, u } = best, lk = 0, L = -Infinity, N = ws.length * H
  for (let r = 1; r <= 2; r++) {
    ;[u, L] = gold(v => sym(ws, curve, v, lk), u - 2 / r, u + 2 / r)
    ;[lk, L] = gold(v => sym(ws, curve, u, v), lk - 0.7 / r, lk + 0.7 / r)
  }
  let c = M * (1 + Math.exp(u)), up = Math.log(c / Mp - 1), un = Math.log(c / Mn - 1), lk2 = lk, La = L
  for (let r = 1; r <= 2; r++) {
    ;[up, La] = gold(v => like(ws, curve, v, un, lk2), up - 1.5 / r, up + 1.5 / r)
    ;[un, La] = gold(v => like(ws, curve, up, v, lk2), un - 1.5 / r, un + 1.5 / r)
    ;[lk2, La] = gold(v => like(ws, curve, up, un, v), lk2 - 0.5 / r, lk2 + 0.5 / r)
  }
  let s = La > L + Math.log(N) / 2 ? { curve, k: Math.exp(lk2), hi: Mp * (1 + Math.exp(up)), lo: -Mn * (1 + Math.exp(un)), gain: (La - L0) / N }
    : { curve, k: Math.exp(lk), hi: c, lo: -c, gain: (L - L0) / N }
  let o = new Float64Array(2), bend = Math.max(CURVES[curve](Mp, s.hi, s.k, o)[1], CURVES[curve](-Mn, -s.lo, s.k, o)[1])
  return s.gain > LR && bend > Math.log(BEND) ? s : null
}

// golden section for the most of f over [a, b], 10 steps: [u, f(u)]
function gold(f, a, b) {
  let m1 = b - 0.618 * (b - a), m2 = a + 0.618 * (b - a), f1 = f(m1), f2 = f(m2)
  for (let i = 0; i < 10; i++) {
    if (f1 > f2) b = m2, m2 = m1, f2 = f1, m1 = b - 0.618 * (b - a), f1 = f(m1)
    else a = m1, m1 = m2, f1 = f2, m2 = a + 0.618 * (b - a), f2 = f(m2)
  }
  return f1 > f2 ? [m1, f1] : [m2, f2]
}

// the coarsest power-of-two grid every sample sits on (2⁻¹⁵ for 16-bit PCM, 2⁻²³ for 24-bit), 0 off any: below one
// step of it, equal samples are no evidence of a cut
function grid(x) {
  let k = 7
  for (let i = 0; i < x.length && k <= 24; i++) while (k <= 24 && !Number.isInteger(x[i] * 2 ** k)) k++
  return k > 24 ? 0 : 2 ** -k
}
