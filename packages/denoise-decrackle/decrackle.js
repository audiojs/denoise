// De-crackle — continuous-stream version of de-click for vinyl-style noise.
//
// Same AR-residual detection as declick but with:
//   - Lower threshold (denser, smaller events vs. isolated clicks)
//   - Wider scan: every sample's residual considered a candidate
//   - Median-of-residuals normalisation: robust to long tonal contexts that
//     inflate σ_e and hide tiny crackles
//
// Best on broadband background impulse showers — quiet record surface noise,
// shellac dust, mild dropouts. For loud isolated pops use declick.

import { arFit, arInterpolate } from '@audio/lpc'

export default function decrackle(data, params = {}) {
  let p = params.order ?? 50
  let winSize = params.windowSize ?? 2048
  let hop = params.hopSize ?? 1024
  let threshold = params.threshold ?? 2.5          // multiples of MAD
  let guard = params.guard ?? 1
  let maxBurst = params.maxBurst ?? 12

  let n = data.length
  if (n < winSize) return data
  let out = new Float32Array(data)
  let halfWin = winSize >> 1

  for (let pos = 0; pos + winSize <= n; pos += hop) {
    let win = out.subarray(pos, pos + winSize)
    let { a } = arFit(win, p)
    if (!isFinite(a[1])) continue

    let resid = new Float64Array(winSize)
    for (let i = p; i < winSize; i++) {
      let s = win[i]
      for (let k = 1; k <= p; k++) s += a[k] * win[i - k]
      resid[i] = s
    }

    // robust scale: MAD ≈ 1.4826 · median(|resid|)
    let abs = new Float64Array(winSize - p)
    for (let i = 0; i < abs.length; i++) abs[i] = Math.abs(resid[p + i])
    abs.sort()
    let med = abs[abs.length >> 1]
    let mad = 1.4826 * med
    if (mad <= 0) continue
    let th = threshold * mad

    let gap = []
    let inBurst = false, bs = 0
    for (let i = p; i < winSize; i++) {
      let high = Math.abs(resid[i]) > th
      if (high && !inBurst) { bs = i; inBurst = true }
      else if (!high && inBurst) {
        let be = i - 1
        let bsExp = Math.max(p, bs - guard)
        let beExp = Math.min(winSize - 1, be + guard)
        if (beExp - bsExp <= maxBurst) {
          let center = (bsExp + beExp) >> 1
          if (center >= halfWin - hop / 2 && center <= halfWin + hop / 2 &&
              bsExp > p + 4 && beExp < winSize - 4) {
            for (let j = bsExp; j <= beExp; j++) gap.push(j)
          }
        }
        inBurst = false
      }
    }
    if (gap.length === 0) continue
    arInterpolate(win, gap, a)
  }
  return out
}
