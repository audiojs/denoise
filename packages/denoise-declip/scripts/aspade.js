// A-SPADE on one block as declip.js runs it, k started at any value: from 1 on every block it is the rebuild without
// the white-block bound, the reference test.js and scripts/white.js hold the bound to. The block of `sec` at c in y:
// w samples (a power of 2) under a peak-1 Hann window, the analysis a unitary DFT of 2w; per pass the k largest lines
// kept (a conjugate pair counted once, DC at half), the residual ‖Ax − z̄‖ measured, x set to the consistent nearest to
// A*(z̄ − u), u += Ax − z̄; k grown by max(1, ⌊k/50⌋) until the residual is 1 % of the block's norm or every line is
// kept. Returns the iterate of least residual (the block's samples, windowed), the passes made, whether declip reads
// the block as white noise (its lines' spectral flatness within four of its deviations of e^(−γ)), and the share of
// the lines at which the least residual first fell under the first pass's (1: never)
import { declipAsync, solve } from '../declip.js'
import { fft, ifft } from 'fourier-transform'

export function aspade(y, mask, fs, sec, c, k0 = 1) {
  let n = y.length, w = 2 ** Math.round(Math.log2(sec * fs)), N = 2 * w, H = w + 1, nrm = Math.sqrt(N)
  let g = Float64Array.from({ length: w }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / w))
  let buf = new Float64Array(N), re = new Float64Array(H), im = new Float64Array(H), zr = new Float64Array(H), zi = new Float64Array(H)
  let ur = new Float64Array(H), ui = new Float64Array(H), mag = new Float64Array(H), sel = new Float64Array(H)
  let b = new Float64Array(w), x = new Float64Array(w), best = new Float64Array(w), e2 = 0, passes = 0, fell = 1
  let A = () => { buf.set(x); fft(buf, [re, im]); for (let j = 0; j < H; j++) zr[j] = re[j] / nrm, zi[j] = im[j] / nrm }
  for (let i = 0, t = c; i < w; i++, t++) b[i] = t >= 0 && t < n ? y[t] * g[i] : 0, e2 += b[i] * b[i]
  best.set(b), x.set(b), A()
  let lg = 0, ar = 0, s = Math.min(n, c + w) - Math.max(0, c)
  for (let j = 0; j < H; j++) { let p = zr[j] * zr[j] + zi[j] * zi[j]; lg += Math.log(p), ar += p }
  let white = (Math.exp(lg / H) / (ar / H) - Math.exp(-0.5772156649015329)) * Math.sqrt(s) > -4 * 0.64
  for (let k = k0, lo = Infinity, first = 0; ; k += Math.max(1, Math.floor(k / 50))) {
    passes++
    for (let j = 0; j < H; j++) { let r = zr[j] + ur[j], m = zi[j] + ui[j]; re[j] = r, im[j] = m, mag[j] = sel[j] = (r * r + m * m) / (j ? 1 : 4) }
    let cut = k < H ? select(sel, H - k) : -1, res = 0
    for (let j = 0; j < H; j++) {
      if (mag[j] < cut) re[j] = im[j] = 0
      res += (j && j < H - 1 ? 2 : 1) * ((zr[j] - re[j]) ** 2 + (zi[j] - im[j]) ** 2)
    }
    if (passes === 1) first = res; else if (fell === 1 && res < first) fell = k / H
    if (res < lo) lo = res, best.set(x)
    if (res <= 1e-4 * e2 || k >= H) break
    for (let j = 0; j < H; j++) ur[j] -= re[j], ui[j] -= im[j], re[j] = -ur[j], im[j] = -ui[j]
    let v = ifft(re, im)
    for (let i = 0, t = c; i < w; i++, t++) {
      let s = t >= 0 && t < n ? mask[t] : 0, u = v[i] * nrm
      x[i] = !s ? b[i] : s > 0 ? Math.max(b[i], u) : Math.min(b[i], u)
    }
    A()
    for (let j = 0; j < H; j++) ur[j] += zr[j], ui[j] += zi[j]
  }
  return { block: best, passes, white, fell }
}

// the k-th smallest of a (0-based), a reordered: any selection gives the one value
function select(a, k) {
  let l = 0, r = a.length - 1
  while (r > l) {
    let v = a[(l + r) >> 1], i = l, j = r
    while (i <= j) { while (a[i] < v) i++; while (v < a[j]) j--; if (i <= j) { let t = a[i]; a[i] = a[j]; a[j] = t; i++; j-- } }
    if (k <= j) r = j; else if (k >= i) l = i; else break
  }
  return a[k]
}

// declip's rebuild with every sparse block run by aspade() from k = 1, through declipAsync; `each` sees every block's run
export const unbounded = (data, params, each) => declipAsync(data, params, (shared, jobs) => jobs.map(j => {
  if (j.r === 'ar') return solve(shared, j)
  let r = aspade(shared.y, shared.mask, shared.fs, j.r, j.at)
  each?.(r)
  return r.block
}))
