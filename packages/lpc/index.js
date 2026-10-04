// Linear predictive coding — autoregressive modelling of audio.
//   - autocorr + levinson (Levinson-Durbin) → AR(p) / LPC coefficients from a window
//   - arPredict / arExtrapolate → forward prediction (de-clip projection)
//   - arInterpolate → least-squares fill of scattered samples (de-click / de-crackle)
//   - arFill → the same fill solved exactly, banded Cholesky (de-clip)
//   - arBridge → exact least-squares fill of one contiguous gap, any length (repair)
//
// `lpc(x, p)` is the standard entry point (alias of arFit): coefficients a[] + residual e.
// References: Markel & Gray (1976); Godsill & Rayner (1998), "Digital Audio Restoration" §5.

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

// LPC analysis on a window → { a, e }. Standard entry point.
export function arFit(x, p) {
  return levinson(autocorr(x, p), p)
}

// Alias: the conventional name for AR fit in the LPC literature.
export const lpc = arFit

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

// arInterpolate's problem solved exactly, for unknowns scattered anywhere: `gap` (sorted ints) in place under model `a`.
// The normal equations Σ_j r[|g_i−g_j|]·u_j = −Σ_known r[|g_i−k|]·x_k (r the autocorrelation of `a`) couple two
// unknowns only within p samples of each other, so the matrix is banded in the gap's order: Cholesky within its
// envelope, O(m·b²) for m unknowns at most b within p of one another. The Janssen step of de-clipping, where every
// clipped sample of a window is unknown at once (Janssen, Veldhuis & Vries 1986; Godsill & Rayner 1998 §5.2.2).
// Returns false, leaving x as it was, when the model makes the system singular.
export function arFill(x, gap, a) {
  let p = a.length - 1, m = gap.length, n = x.length
  if (!m) return true
  let r = new Float64Array(p + 1)
  for (let k = 0; k <= p; k++) {
    let s = 0
    for (let i = 0; i + k <= p; i++) s += a[i] * a[i + k]
    r[k] = s
  }
  // row i of L spans columns lo[i]..i (the unknowns within p before it), stored from at[i]
  let lo = new Int32Array(m), at = new Int32Array(m + 1), unk = new Uint8Array(n)
  for (let i = 0, j = 0; i < m; i++) {
    while (gap[i] - gap[j] > p) j++
    lo[i] = j, at[i + 1] = at[i] + i - j + 1, unk[gap[i]] = 1
  }
  let L = new Float64Array(at[m]), u = new Float64Array(m)
  for (let i = 0; i < m; i++) {
    let g = gap[i], s = 0, o = at[i] - lo[i]
    for (let k = Math.max(0, g - p), e = Math.min(n - 1, g + p); k <= e; k++) if (!unk[k]) s += r[Math.abs(g - k)] * x[k]
    u[i] = -s
    for (let j = lo[i]; j <= i; j++) L[o + j] = r[g - gap[j]]
  }
  for (let i = 0; i < m; i++) {
    let oi = at[i] - lo[i]
    for (let j = lo[i]; j <= i; j++) {
      let oj = at[j] - lo[j], s = L[oi + j]
      for (let k = Math.max(lo[i], lo[j]); k < j; k++) s -= L[oi + k] * L[oj + k]
      if (j < i) L[oi + j] = s / L[oj + j]
      else if (s > 1e-12 * r[0]) L[oi + i] = Math.sqrt(s)
      else return false
    }
  }
  for (let i = 0; i < m; i++) {
    let oi = at[i] - lo[i], s = u[i]
    for (let k = lo[i]; k < i; k++) s -= L[oi + k] * u[k]
    u[i] = s / L[oi + i]
  }
  for (let i = m - 1; i >= 0; i--) {
    let oi = at[i] - lo[i]
    u[i] /= L[oi + i]
    for (let k = lo[i]; k < i; k++) u[k] -= L[oi + k] * u[i]
  }
  for (let i = 0; i < m; i++) if (!Number.isFinite(u[i])) return false
  for (let i = 0; i < m; i++) x[gap[i]] = u[i]
  return true
}

// Least-squares interpolation of the contiguous gap x[from..to), in place, under model `a`
// (Janssen, Veldhuis & Vries 1986; Godsill & Rayner 1998 §5.2.2): the unknowns minimize the
// total prediction error of the full convolution a∗x. Its normal equations are Toeplitz in the
// autocorrelation of `a`, so Levinson recursion solves them exactly in O(m²) at any order:
// the same solve as the Audio Inpainting Toolbox's Janssen step (Adler et al. 2012). This is
// arInterpolate's problem for one run (declick's interpolator iterates Gauss-Seidel over
// scattered indices, too slow to converge on runs of hundreds of samples at order ~p).
export function arBridge(x, from, to, a) {
  let p = a.length - 1, n = x.length, m = to - from
  if (m <= 0) return x
  let r = new Float64Array(p + 1)
  for (let k = 0; k <= p; k++) {
    let s = 0
    for (let i = 0; i + k <= p; i++) s += a[i] * a[i + k]
    r[k] = s
  }
  // right side: −Σ r[|g−j|]·x[j] over the known samples within p of each unknown g
  let b = new Float64Array(m)
  for (let i = 0; i < m; i++) {
    let g = from + i, s = 0
    for (let j = Math.max(0, g - p); j < from; j++) s += r[g - j] * x[j]
    for (let j = to, e = Math.min(n - 1, g + p); j <= e; j++) s += r[j - g] * x[j]
    b[i] = -s
  }
  let u = toeplitz(r.subarray(0, Math.min(m, p + 1)), b)
  if (u) for (let i = 0; i < m; i++) x[from + i] = u[i]
  return x
}

// Solve T·x = b for symmetric positive-definite Toeplitz T (first column t, zero past t.length):
// Levinson's algorithm (Golub & Van Loan, Matrix Computations, Alg. 4.7.2); the inner products stop
// at the band. null if T is not numerically positive definite.
function toeplitz(t, b) {
  let m = b.length, t0 = t[0], q = t.length - 1
  if (!(t0 > 0)) return null
  let r = new Float64Array(m + 1)
  for (let k = 1; k <= Math.min(q, m); k++) r[k] = t[k] / t0
  let x = new Float64Array(m), y = new Float64Array(m)
  x[0] = b[0] / t0
  if (m === 1) return x
  let beta = 1, alpha = -r[1]
  y[0] = alpha
  for (let k = 1; k < m; k++) {
    beta *= 1 - alpha * alpha
    if (!(beta > 0)) return null
    let s = b[k] / t0, e = Math.min(k, q)
    for (let i = 0; i < e; i++) s -= r[i + 1] * x[k - 1 - i]
    let mu = s / beta
    for (let i = 0; i < k; i++) x[i] += mu * y[k - 1 - i]
    x[k] = mu
    if (k === m - 1) break
    s = r[k + 1]
    for (let i = 0; i < e; i++) s += r[i + 1] * y[k - 1 - i]
    alpha = -s / beta
    for (let i = 0, j = k - 1; i <= j; i++, j--) {
      let yi = y[i], yj = y[j]
      y[i] = yi + alpha * yj
      if (i !== j) y[j] = yj + alpha * yi
    }
    y[k] = alpha
  }
  return x
}
