// De-click: find clicks as outliers of the AR prediction error, rebuild each from its surroundings
// (Godsill & Rayner 1998, "Digital Audio Restoration" §5; Janssen, Veldhuis & Vries 1986).
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
//   5. Each rebuilt by AR(N/8) fitted to N = 46 ms either side with the click zeroed, least squares (lpc
//      arBridge), refitted on the filled segment and rebuilt again (denoise-repair's 'ar' tier).
//
// `regions` ([{ at, duration }], s) says where the clicks are: they are looked for only there, and none there is
// taken for a pulse or left for its length. Samples no click reaches come back bit-exact. The windows and blocks
// count from the data's start: a run over part of a longer sound, starting on a multiple of W/2 with 8·W of it
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

  let found = []
  for (let i = p; i < n; i++) {
    if (!looked(i) || !over(i, K)) continue
    let a = i, b = i
    for (let j = a - 1; j >= Math.max(0, a - guard) && i - a <= longest; j--) if (over(j, KL)) a = j
    for (let j = b + 1; j <= Math.min(n - 1, b + reach) && b - i <= longest; j++) if (over(j, KL)) b = j
    if (!only && pulse(e, a, b, near, far)) { i = b; continue }
    found.push([Math.max(0, a - guard), Math.min(n, b + 1 + guard)])
    i = b
  }

  let N = Math.round(2048 * fs / 44100), last = null
  let fix = ([a, b]) => { if (only || b - a <= longest) fill(out, a, b, N >> 3, N) }
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

// x[a, b) rebuilt in place: AR(p) on C either side with the gap zeroed, least squares, refit on the filled, again
function fill(x, a, b, p, C) {
  let s0 = Math.max(0, a - C), s1 = Math.min(x.length, b + C)
  let seg = Float64Array.from(x.subarray(s0, s1)), g0 = a - s0, g1 = b - s0
  p = Math.min(p, seg.length - (g1 - g0) - 1)
  seg.fill(0, g0, g1)
  for (let it = 0; it < 2 && p > 0; it++) {
    let { a: c, e } = arFit(seg, p)
    if (!(e > 0) || !c.every(Number.isFinite)) break
    arBridge(seg, g0, g1, c)
  }
  for (let i = a; i < b; i++) x[i] = seg[i - s0]
}
