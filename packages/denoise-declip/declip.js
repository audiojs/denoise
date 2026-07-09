// De-clip — restore samples that have been hard-clipped at ±threshold.
//
// AR-extrapolation approach (Janssen et al. 1986, Godsill-Rayner 1998):
//   1. Detect runs of samples at |x| ≥ clipLevel
//   2. For each run, fit AR(p) on the un-clipped neighbourhood (left + right context)
//   3. LS-interpolate the clipped samples consistent with the AR model AND the
//      one-sided constraint sign(x) · x̂ > clipLevel (light constraint via clamp)
//
// Works well for short runs (< ~p/2 samples). Long sustained clipping yields
// smooth fills that may sound dull — for those, a sparsity-based method (A-SPADE)
// is more appropriate.

import { arFit, arInterpolate } from '@audio/lpc'

export default function declip(data, params = {}) {
  let p = params.order ?? 100
  let clipLevel = params.clipLevel ?? autoClipLevel(data)
  let context = params.context ?? p * 4
  let maxRun = params.maxRun ?? p / 2

  if (clipLevel <= 0) return data
  let out = new Float32Array(data)
  let n = out.length

  // Find runs of samples at the clip rail.
  let runs = []
  let inRun = false, rs = 0, sign = 0
  for (let i = 0; i < n; i++) {
    let x = out[i]
    let clipped = Math.abs(x) >= clipLevel * 0.999
    if (clipped) {
      let s = x >= 0 ? 1 : -1
      if (!inRun) { rs = i; sign = s; inRun = true }
      else if (s !== sign) { runs.push([rs, i - 1, sign]); rs = i; sign = s }
    } else if (inRun) {
      runs.push([rs, i - 1, sign]); inRun = false
    }
  }
  if (inRun) runs.push([rs, n - 1, sign])

  for (let [rs, re, sgn] of runs) {
    let len = re - rs + 1
    if (len > maxRun) continue
    let lo = Math.max(0, rs - context)
    let hi = Math.min(n, re + context + 1)
    if (hi - lo < 2 * p + len) continue

    // Build local working buffer
    let buf = new Float64Array(hi - lo)
    for (let i = 0; i < buf.length; i++) buf[i] = out[lo + i]

    // Fit AR on un-clipped portion
    let cleanLeft = new Float64Array(rs - lo)
    for (let i = 0; i < cleanLeft.length; i++) cleanLeft[i] = buf[i]
    let { a } = arFit(cleanLeft, Math.min(p, cleanLeft.length - 1))
    if (!isFinite(a[1])) continue

    let gap = []
    for (let i = rs; i <= re; i++) gap.push(i - lo)
    arInterpolate(buf, gap, a)

    // Enforce one-sided constraint: filled values should not fall back below ±clipLevel
    // by an arbitrary margin — clamp magnitude to at least clipLevel along sign.
    for (let i = rs; i <= re; i++) {
      let v = buf[i - lo]
      if (sgn > 0 && v < clipLevel) v = clipLevel
      if (sgn < 0 && v > -clipLevel) v = -clipLevel
      out[i] = v
    }
  }
  return out
}

// Auto-detect clip level: the most frequent |sample| above 0.5. Falls back to peak.
function autoClipLevel(data) {
  let bins = new Uint32Array(1024), peak = 0
  for (let i = 0; i < data.length; i++) {
    let a = Math.abs(data[i])
    if (a > peak) peak = a
    if (a > 0.5) bins[Math.min(1023, Math.floor(a * 1023))]++
  }
  if (peak < 0.5) return 0
  let maxCount = 0, maxBin = -1
  for (let i = 512; i < 1024; i++) if (bins[i] > maxCount) { maxCount = bins[i]; maxBin = i }
  if (maxCount < 8) return 0                       // not enough clipped samples to be sure
  return Math.min(peak, maxBin / 1023)
}
