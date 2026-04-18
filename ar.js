// Auto-regressive modelling for click/click-burst interpolation and de-clip extrapolation.
//   - Levinson-Durbin recursion → AR(p) coefficients from autocorrelation
//   - LS interpolation of missing samples from neighbouring AR predictions
//   - Forward AR extrapolation (used by de-clip)
//
// Reference: Godsill & Rayner (1998), "Digital Audio Restoration", §5.

// Biased autocorrelation R[0..p]. Bias is preferable for short windows (Toeplitz PSD).
export function autocorr(x, p) {
  let n = x.length, R = new Float64Array(p + 1)
  for (let k = 0; k <= p; k++) {
    let s = 0
    for (let i = 0; i + k < n; i++) s += x[i] * x[i + k]
    R[k] = s
  }
  return R
}

// Levinson-Durbin: solve Toeplitz Yule-Walker for AR(p) coefficients.
// Returns { a: Float64Array(p+1), e: residual variance }.  a[0] = 1 by convention.
export function levinson(R, p) {
  let a = new Float64Array(p + 1)
  let prev = new Float64Array(p + 1)
  a[0] = 1
  let e = R[0]
  if (e <= 0) return { a, e: 0 }

  for (let i = 1; i <= p; i++) {
    let k = -R[i]
    for (let j = 1; j < i; j++) k -= a[j] * R[i - j]
    k /= e
    for (let j = 0; j <= i; j++) prev[j] = a[j]
    a[i] = k
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j]
    e *= 1 - k * k
    if (e <= 0) { e = 0; break }
  }
  return { a, e }
}

// Convenience: AR fit on a window.
export function arFit(x, p) {
  return levinson(autocorr(x, p), p)
}

// Predict next sample via AR(p): x̂[n] = -∑ a[k]·x[n-k], k=1..p.
export function arPredict(a, hist) {
  let p = a.length - 1, s = 0
  for (let k = 1; k <= p; k++) s -= a[k] * hist[hist.length - k]
  return s
}

// Forward AR extrapolation by m samples beyond context tail.
// Used for de-clip: fit AR on un-clipped neighbourhood, project into clipped region.
export function arExtrapolate(context, a, m) {
  let p = a.length - 1
  let buf = new Float64Array(p + m)
  for (let i = 0; i < p; i++) buf[i] = context[context.length - p + i]
  for (let i = 0; i < m; i++) {
    let s = 0
    for (let k = 1; k <= p; k++) s -= a[k] * buf[p + i - k]
    buf[p + i] = s
  }
  return buf.subarray(p)
}

// Least-squares interpolation of indices `gap` (sorted ints) inside x using AR(p).
// Solves Bᵀ B  · u = -Bᵀ A · k, where u = unknowns, k = knowns,
// (B,A) split of the AR convolution matrix on (gap, ¬gap).
//
// Direct sparse Gauss-Seidel is enough for clusters up to ~50 samples; very small
// gaps (≤8) reduce to a few iterations and are dominated by the AR fit cost itself.
export function arInterpolate(x, gap, a) {
  let p = a.length - 1
  let n = x.length, m = gap.length
  if (m === 0) return x

  let inGap = new Uint8Array(n)
  for (let i = 0; i < m; i++) inGap[gap[i]] = 1

  // M = sum over t of (sum_{k:t-k∈gap} a[k] * a[k - (t - gap_j)]) — assemble m×m system implicitly.
  // For practicality, use Jacobi iteration: x_g = -∑_{j≠g} M[g,j]/M[g,g] · x_j  + b/M[g,g]
  // with M[g,g] = ∑_k a[k]² for k where g+k≤n+p
  // and forcing term computed from neighbours.
  let mdiag = new Float64Array(m)
  for (let i = 0; i < m; i++) {
    let g = gap[i], s = 0
    for (let k = 0; k <= p; k++) {
      let t = g + k
      if (t >= 0 && t < n + p) s += a[k] * a[k]
    }
    mdiag[i] = s || 1
  }

  // initial: linear interpolation between gap boundaries
  for (let i = 0; i < m; i++) {
    let g = gap[i]
    let lo = g, hi = g
    while (lo > 0 && inGap[lo - 1]) lo--
    while (hi < n - 1 && inGap[hi + 1]) hi++
    let xLo = lo > 0 ? x[lo - 1] : 0
    let xHi = hi < n - 1 ? x[hi + 1] : 0
    x[g] = xLo + (xHi - xLo) * (g - lo + 1) / (hi - lo + 2)
  }

  // 30 Gauss-Seidel sweeps converge well past audible accuracy for short gaps
  let iter = 30
  for (let it = 0; it < iter; it++) {
    for (let i = 0; i < m; i++) {
      let g = gap[i]
      // residual r[t] = ∑_k a[k] x[t-k] for t = g..g+p; gradient wrt x[g] is
      // ∑_k a[k] r[g+k]; setting it to zero gives the update.
      let num = 0
      for (let k = 0; k <= p; k++) {
        let t = g + k
        if (t < 0 || t >= n + p) continue
        let rt = 0
        for (let j = 0; j <= p; j++) {
          let idx = t - j
          if (idx < 0 || idx >= n) continue
          rt += a[j] * x[idx]
        }
        // remove self-contribution so we can solve for x[g]
        rt -= a[k] * x[g]
        num -= a[k] * rt
      }
      x[g] = num / mdiag[i]
    }
  }
  return x
}
