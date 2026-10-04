// De-crackle: dense small impulses (a worn record's crackle) found as outliers of the AR prediction error that the
// model can't have made, all of a window rebuilt at once by least-squares AR interpolation, and looked for again on the
// rebuilt sound until none is new (Vaseghi & Rayner 1990; Godsill & Rayner 1998, "Digital Audio Restoration" §5).
//
//   1. Per window of 46 ms (Hann-weighted, hop W/2, each fit applied over its middle half) AR(order) fitted to the
//      sound, and two errors of it: the prediction error e (Godsill & Rayner §5.3.1), and the two-sided error v, each
//      sample less its least-squares interpolation from `order` samples either side, v = (r ∗ x) / r₀ with r the
//      autocorrelation of the model's coefficients: e through its matched filter (Vaseghi & Rayner 1990). Against each
//      one's spread, an impulse added to the sound stands √r₀ further out of v than of e; a pulse of the sound's own
//      excitation (a voice's glottal pulse, a reed's, a bow's) √r₀ less far. Crackle stands out of both.
//   2. Each one's local scale: per block of W/32 (1.5 ms) 1.4826 × the median |·| (σ for a Gaussian), the median of
//      those over ±8 blocks. Crackle can't raise it until it fills half a block's samples; a block's RMS (declick's
//      scale) is crackle's own once half the blocks hold an impulse, which at 1000/s three in four do.
//   3. A crackle sample: over `threshold` × its scale in both errors, `order` samples or more from either end.
//   4. Every crackle sample of a window rebuilt at once, the exact least-squares fill under AR fitted to the window
//      with them zeroed, refitted on the filled and filled again (lpc arFill: Janssen, Veldhuis & Vries 1986; Godsill
//      & Rayner §5.2.2); each window's middle half kept. A neighbour within the model's reach is unknown too, never
//      taken for sound, as rebuilding one click at a time would take it.
//   5. Again from 1 on the rebuilt sound, its fits on it (Vaseghi & Rayner's iteration): with the largest impulses
//      gone, the model and the scales they biased come clean and the smaller ones stand out. A new one must stand out
//      of the input's errors too, under the same fits: a rebuilt sample's departure from the model is no crackle.
//      While searching, rebuilt under AR(order), the detection's order, so a rebuild stands out of its errors the
//      least; the windows a rebuild reaches fitted again, the rest kept. Once none is new, rebuilt under AR(W/8).
//
// Samples no crackle reaches come back bit-exact. The windows and blocks count from the data's start.

import { arFit, arFill } from '@audio/lpc'

// scales over ±R blocks; PASSES at most (crackle at 1000/s settles in 15–20, clean sound in 2–10)
const R = 8, PASSES = 20

export default function decrackle(data, params = {}) {
  let fs = params.fs ?? 44100, n = data.length, p = params.order ?? 32, K = params.threshold ?? 4
  let W = 2 ** Math.round(Math.log2(0.046 * fs)), B = W >> 5, nb = Math.ceil(n / B)
  let out = Float32Array.from(data)
  if (n <= p) return out

  // y: the errors of the rebuilt sound, x: of the input under the same fits; each one's block levels and scales
  let y = { e: new Float32Array(n), v: new Float32Array(n) }, x = { e: new Float32Array(n), v: new Float32Array(n) }
  let lv = { e: new Float64Array(nb), v: new Float64Array(nb) }
  let sg = { e: new Float64Array(nb), v: new Float64Array(nb) }
  let gap = new Uint8Array(n), fresh = new Uint8Array(nb), moved = null
  for (let pass = 0; pass < PASSES; pass++) {
    errors(out, pass ? [out, data] : [out], pass ? [y, x] : [y], p, W, B, moved, fresh)
    if (!pass) x.e.set(y.e), x.v.set(y.v)
    scale(y.e, B, lv.e, sg.e, fresh), scale(y.v, B, lv.v, sg.v, fresh)
    let more = false
    for (let i = p; i < n - p; i++) {
      if (gap[i]) continue
      let b = (i / B) | 0, t = K * sg.e[b], u = K * sg.v[b]
      if (Math.abs(y.e[i]) > t && Math.abs(x.e[i]) > t && Math.abs(y.v[i]) > u && Math.abs(x.v[i]) > u)
        gap[i] = 2, more = true
    }
    if (!more) break
    moved = fill(out, data, gap, p, W, 2)
    for (let i = 0; i < n; i++) if (gap[i]) gap[i] = 1
  }
  if (moved) fill(out, data, gap, W >> 3, W, 1)
  return out
}

// AR(p) fitted to f per window of W at hop W/2 (Hann-weighted), applied over the window's middle half to each of xs:
// its prediction error e[i] = Σ a[k]·x[i−k] and its two-sided error v[i] = Σ r[|k|]·x[i−k] / r[0] over |k| ≤ p, into
// outs. Given `moved`, only the windows a moved sample reaches; the blocks so computed marked in `fresh`.
function errors(f, xs, outs, p, W, B, moved, fresh) {
  let n = f.length, H = W >> 1, seg = new Float64Array(W), r = new Float64Array(p + 1)
  fresh.fill(0)
  for (let s = -(H >> 1); s < n; s += H) {
    let a0 = Math.max(0, s), a1 = Math.min(n, s + W), c0 = s <= 0 ? 0 : s + (W >> 2), c1 = Math.min(n, s + W - (W >> 2))
    if (moved && !some(moved, Math.min(a0, c0 - p), Math.max(a1, c1 + p), 1)) continue
    for (let b = (c0 / B) | 0; b * B < c1; b++) fresh[b] = 1
    let w = seg.subarray(0, a1 - a0)
    for (let i = a0; i < a1; i++) w[i - a0] = f[i] * Math.sin(Math.PI * (i - s + .5) / W) ** 2
    let { a } = arFit(w, p)
    if (!a.every(Number.isFinite)) { outs.forEach(o => (o.e.fill(0, c0, c1), o.v.fill(0, c0, c1))); continue }
    for (let k = 0; k <= p; k++) { let t = 0; for (let i = 0; i + k <= p; i++) t += a[i] * a[i + k]; r[k] = t }
    xs.forEach((x, j) => {
      let { e, v } = outs[j]
      for (let i = c0; i < c1; i++) {
        let pe = x[i], te = r[0] * x[i]
        for (let k = 1; k <= p; k++) {
          let lo = i >= k ? x[i - k] : 0
          pe += a[k] * lo, te += r[k] * (lo + (i + k < n ? x[i + k] : 0))
        }
        e[i] = pe, v[i] = te / r[0]
      }
    })
  }
}

// per block of B samples its level, 1.4826 × its median |e| (σ for a Gaussian), and its scale, the median of the levels
// over ±R blocks; the fresh blocks' levels and the scales within R of them
function scale(e, B, lv, sg, fresh) {
  let nb = lv.length, w = new Float64Array(B), m = new Float64Array(2 * R + 1)
  for (let b = 0; b < nb; b++) if (fresh[b]) {
    let i0 = b * B, l = Math.min(e.length, i0 + B) - i0
    for (let i = 0; i < l; i++) w[i] = Math.abs(e[i0 + i])
    lv[b] = 1.4826 * w.subarray(0, l).sort()[l >> 1]
  }
  for (let b = 0; b < nb; b++) {
    let j0 = Math.max(0, b - R), j1 = Math.min(nb, b + R + 1)
    if (!some(fresh, j0, j1, 1)) continue
    let v = m.subarray(0, j1 - j0)
    v.set(lv.subarray(j0, j1))
    sg[b] = v.sort()[v.length >> 1]
  }
}

// out's gap samples rebuilt from x, all of a window at once where its middle half has one and the window one marked
// `mark` or later: AR(q) fitted to the window with its gap zeroed, the exact least-squares fill, refitted on the filled
// and filled again; the middle half kept. Returns the samples rebuilt.
function fill(out, x, gap, q, W, mark) {
  let n = x.length, H = W >> 1, moved = new Uint8Array(n)
  for (let s = -(H >> 1); s < n; s += H) {
    let a0 = Math.max(0, s), a1 = Math.min(n, s + W), c0 = s <= 0 ? 0 : s + (W >> 2), c1 = Math.min(n, s + W - (W >> 2))
    if (!some(gap, c0, c1, 1) || !some(gap, a0, a1, mark)) continue
    let seg = Float64Array.from(x.subarray(a0, a1)), g = []
    for (let i = a0; i < a1; i++) if (gap[i]) g.push(i - a0), seg[i - a0] = 0
    let m = Math.min(q, seg.length >> 3, seg.length - g.length - 1), ok = false
    for (let it = 0; it < 2 && m > 0; it++) {
      let { a, e } = arFit(seg, m)
      if (!(e > 0) || !a.every(Number.isFinite) || !arFill(seg, g, a)) break
      ok = true
    }
    if (ok) for (let i = c0; i < c1; i++) if (gap[i]) out[i] = seg[i - a0], moved[i] = 1
  }
  return moved
}

// any of a[i..j) at m or over
function some(a, i, j, m) {
  for (i = Math.max(0, i), j = Math.min(a.length, j); i < j; i++) if (a[i] >= m) return true
  return false
}
