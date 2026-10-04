// De-clip: find the levels a sound was cut flat at, and rebuild what the cut took off.
//
//   1. The rails. A hard clip piles every sample it cuts onto one level: a point mass at the sound's extreme, in runs.
//      Each sign's rail is its extreme r, taken when the samples within t of it (t = 0.1 % of r, or one step of the
//      sound's PCM grid when coarser) outnumber 10 times those in the next t below, and most of them sit next to
//      another: the top-bin test of FFmpeg's adeclip (1000 bins, ratio 10), relative to the rail so it holds at any
//      level, and per sign so a rail on one side or two different rails are found. A loud peak is one sample; a
//      limiter's ceiling is touched by single samples or by arches, and a sine's top is an arch, which fills the band
//      below about as densely. Sound with no rail comes back bit-exact.
//   2. The fill. Per window of 186 ms (hop half, sin² crossfade), every sample within t of a rail is unknown at once:
//      AR(order) fitted to the window under its sin² taper, the unknowns solved by exact least squares (lpc arFill),
//      each held at least as far out as it was recorded (a clip only ever lowers a sample: the consistent set of
//      A-SPADE, Kitić, Bertin & Gribonval 2015), the model refitted to the filled window and solved again, 8 times
//      (Janssen, Veldhuis & Vries 1986). Runs of any length; samples off the rails come back bit-exact. 186 ms is the
//      block of the declipping survey (Záviška, Rajmic, Ozerov & Rencker 2021). Order 256 and the taper, measured over
//      clipped speech, song and music: untapered, 0.2–2.2 dB less SDR on average; order 512, the same in 3× the time.

import { arFit, arFill } from '@audio/lpc'

const TAU = 1e-3, K = 10, ITERS = 8

export default function declip(data, params = {}) {
  let fs = params.fs ?? 44100, p = params.order ?? 256, n = data.length, out = Float32Array.from(data)
  let cl = params.clipLevel > 0 ? params.clipLevel : 0, q = grid(data)
  let { hi, lo } = cl ? { hi: cl, lo: -cl } : rails(data, q)
  if (hi == null && lo == null) return out
  let th = hi == null ? Infinity : hi - Math.max(TAU * hi, q), tl = lo == null ? -Infinity : lo + Math.max(-TAU * lo, q)
  let cut = i => data[i] >= th || data[i] <= tl
  if (!data.some((v, i) => cut(i))) return out

  // window s covers [s, s + W); acc, wt hold [s, s + W) of the crossfade, the first half left by the window before
  let W = 2 ** Math.round(Math.log2(0.186 * fs)), H = W >> 1, acc = new Float64Array(W), wt = new Float64Array(W)
  let hann = Float64Array.from({ length: W }, (_, j) => Math.sin(Math.PI * (j + 0.5) / W) ** 2)
  let seg = new Float64Array(W), gap = []
  for (let s = -H; s < n; s += H) {
    let a0 = Math.max(0, s), a1 = Math.min(n, s + W), w = seg.subarray(0, a1 - a0)
    gap.length = 0
    for (let i = a0; i < a1; i++) if (cut(i)) gap.push(i - a0)
    if (gap.length && fill(w, gap, data, a0, p, hann.subarray(a0 - s))) for (let g of gap) {
      let j = a0 + g - s
      acc[j] += hann[j] * w[g], wt[j] += hann[j]
    }
    for (let j = Math.max(0, -s), e = Math.min(H, n - s); j < e; j++) if (wt[j] > 0) out[s + j] = acc[j] / wt[j]
    acc.copyWithin(0, H).fill(0, H), wt.copyWithin(0, H).fill(0, H)
  }
  return out
}

// Janssen's iteration on one window w (the recorded data[a0…]), every index in gap unknown: AR fit to the window under
// its taper (the autocorrelation method fits a tapered window, else its cut edges bias the model: Markel & Gray 1976;
// the order at most half the samples recorded there), exact least squares, each held at least as far out as recorded,
// ITERS times. false when the window has too little to fit on.
function fill(w, gap, data, a0, p, taper) {
  let order = Math.min(p, (w.length - gap.length) >> 1), f = new Float64Array(w.length)
  if (order < 2) return false
  for (let i = 0; i < w.length; i++) w[i] = data[a0 + i]
  for (let it = 0; it < ITERS; it++) {
    for (let i = 0; i < w.length; i++) f[i] = w[i] * taper[i]
    let { a, e } = arFit(f, order)
    if (!(e > 0) || !a.every(Number.isFinite) || !arFill(w, gap, a)) break
    for (let g of gap) { let v = data[a0 + g]; if (v > 0 ? w[g] < v : w[g] > v) w[g] = v }
  }
  return true
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

// the coarsest power-of-two grid every sample sits on (2⁻¹⁵ for 16-bit PCM, 2⁻²³ for 24-bit), 0 off any: below one
// step of it, equal samples are no evidence of a cut
function grid(x) {
  let k = 7
  for (let i = 0; i < x.length && k <= 24; i++) while (k <= 24 && !Number.isInteger(x[i] * 2 ** k)) k++
  return k > 24 ? 0 : 2 ** -k
}
