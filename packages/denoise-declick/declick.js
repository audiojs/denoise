// De-click — detect impulsive transients via AR prediction residual, replace with
// AR-LS interpolated samples (Godsill-Rayner 1998).
//
// Algorithm per analysis window:
//   1. Fit AR(p) on the window (Levinson-Durbin)
//   2. Compute residual e[n] = x[n] + ∑ a[k]·x[n-k]
//   3. Mark samples where |e| > threshold·σ_e as click locations
//   4. Expand each click into a contiguous gap (±guard samples)
//   5. AR-LS interpolate the gap samples from surrounding context
//
// One pass over the signal in overlapping windows. Edges of windows skipped to
// avoid boundary effects (the AR fit is least reliable there).

import { arFit, arInterpolate } from '@audio/lpc'

export default function declick(data, params = {}) {
  let p = params.order ?? 60                       // AR order — high captures vocal formants
  let winSize = params.windowSize ?? 1024
  let hop = params.hopSize ?? 512
  let threshold = params.threshold ?? 4            // multiples of residual σ
  let guard = params.guard ?? 2                    // samples to widen each click region
  let maxBurst = params.maxBurst ?? 64             // skip mega-bursts (likely real transients)

  let n = data.length
  if (n < winSize) return data

  let out = new Float32Array(data)
  let halfWin = winSize >> 1

  for (let pos = 0; pos + winSize <= n; pos += hop) {
    let win = out.subarray(pos, pos + winSize)
    let { a } = arFit(win, p)
    if (!isFinite(a[1])) continue

    // residual energy stats
    let sumSq = 0, count = 0
    let resid = new Float64Array(winSize)
    for (let i = p; i < winSize; i++) {
      let s = win[i]
      for (let k = 1; k <= p; k++) s += a[k] * win[i - k]
      resid[i] = s
      sumSq += s * s
      count++
    }
    let sigma = Math.sqrt(sumSq / Math.max(count, 1))
    if (sigma <= 0) continue
    let th = threshold * sigma

    // detect contiguous bursts
    let bursts = []
    let inBurst = false, bs = 0
    for (let i = p; i < winSize; i++) {
      if (Math.abs(resid[i]) > th) {
        if (!inBurst) { bs = i; inBurst = true }
      } else {
        if (inBurst) { bursts.push([bs, i - 1]); inBurst = false }
      }
    }
    if (inBurst) bursts.push([bs, winSize - 1])

    // expand by guard, drop edge bursts (window boundary artifacts), drop too-long
    let gap = []
    for (let [bs, be] of bursts) {
      bs = Math.max(p, bs - guard)
      be = Math.min(winSize - 1, be + guard)
      if (be - bs > maxBurst) continue
      // skip bursts touching window edges — handled by neighbour windows
      if (bs < p + 4 || be > winSize - 4) continue
      // only repair central region within hop ± winSize/4 to avoid double-fixing on overlap
      let center = (bs + be) >> 1
      if (center < halfWin - hop / 2 || center > halfWin + hop / 2) continue
      for (let j = bs; j <= be; j++) gap.push(j)
    }
    if (gap.length === 0) continue

    arInterpolate(win, gap, a)
  }

  return out
}
