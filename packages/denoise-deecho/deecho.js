/**
 * De-echo: a delayed copy of the sound, or a few, found and undone.
 *
 * The take is y = x + Σ g_i w_i, each w_i a delay line run on the sound x: w_i[n] = x(n − D_i) + f_i·w_i(n − D_i).
 * One line with f = 0 is a single copy (a slap-back, one strong reflection); with f > 0 it repeats, each copy f of the
 * one before (a delay left on a take); its first copy is g of the sound. Its transfer function is
 * 1 + g z^−D / (1 − f z^−D) = (1 + (g − f) z^−D) / (1 − f z^−D).
 *
 * Found by its cepstrum (Bogert, Healy & Tukey 1963, the cepstrum's first use: echoes; Childers, Skinner & Kemerait,
 * Proc. IEEE 65(10), 1977): the log of the power spectrum turns the echo's factor into a sum, whose inverse transform
 * puts the echo at quefrency D apart from the sound's own spectrum. With b = g − f and a = f, log(1 + b z^−D) −
 * log(1 − a z^−D) = Σ_m ((−1)^{m+1} b^m + a^m)/m · z^−mD (Oppenheim & Schafer, Discrete-Time Signal Processing, 3rd ed.,
 * 2010, ch. 13: the complex cepstrum of a minimum-phase echo), and the inverse transform of the log power is twice the
 * real cepstrum, the complex one's even part: at D it reads g, at 2D (2f − g)·g/2, at 3D ((g − f)³ + f³)/3. So the
 * height of the peak is the first copy's gain, the second rahmonic tells one copy (−g²/2) from repeats (+g²/2), and the
 * third checks the two.
 *
 * Undone by the echo's own lines run on what comes out: x[n] = y[n] − Σ g_i w_i[n], each w_i[n] read from x and w_i
 * before n; a fractional delay reads them through a Kaiser-windowed sinc (Laakso, Välimäki, Karjalainen & Laine, IEEE
 * SPM 13(1), 1996). Stable while |f| < 1 and |g − f| < 1: a copy as loud as the sound has no causal inverse.
 *
 * The estimate, on the take's middle 2²² samples at most: their power spectrum over segments 4× the longest delay
 * searched, in the 1/6-octave bands the take's sound fills (a noise added after the echo carries none of it and would
 * dilute it); the cepstrum, each lag's height over the median and spread (MAD) of its neighbourhood; a peak 8 spreads up,
 * the first copy 0.06 (−24 dB) at least, its delay to a fraction of a sample. Then fitted again on what the removal
 * leaves (no copy cut off at a segment's ends there) until that leaves nothing at D and 2D; kept only if it leaves
 * nothing at 3D either, nor at D in each part of the take and each quarter of its band: an echo is in all of the take,
 * a beat, a loop or a held note comes and goes. When the top quarter alone reads it short, a noise fills more of the
 * band there than its quiet frames showed, and the band is trimmed. Then the next copy, to three.
 */

import { fft } from 'fourier-transform'

const MIN = 0.001, MAX = 1            // the delays searched, s
const SPAN = 2 ** 22                  // the most of a take the estimate reads, its middle (95 s at 44.1 kHz)
const TAPER = 0.05                    // s, a segment's ends
const Z = 8                           // a peak's height over its neighbourhood's spread
const FAINT = 0.06                    // the faintest first copy taken (−24 dB)
export const STABLE = 0.95            // |f| and |g − f| under it: the echo dies away and so does its inverse
const SNAP = 0.1                      // a delay this near a whole sample is whole: a digital delay's
const ITER = 3, TRY = 3, TAPS = 3     // refits, candidates per copy, copies
const KEEP = 0.01, FOLLOW = 0.3, RANGE = 1e-6  // a band kept: its pauses 20 dB under its mean, or its quiet frames
                                      // following the bands beside it (r over 0.3); and within 60 dB of the loudest
const LEFT = 4, STRAY = 6, PARTS = 8 // what the removal may leave, in spreads: at 2D and 3D; in a part or a band; and
                                      // over the parts, its mean square

/** The take with its echoes undone: found, or as given; with none found, its samples as they came. */
export default function deecho(data, opts = {}) {
  if (!data || typeof data.length !== 'number') return stream(data ?? {})
  let fs = rate(opts), echoes = estimate(data, opts)
  return echoes.length ? Float32Array.from(remover(echoes, fs)(data)) : Float32Array.from(data)
}

/** deecho(opts) with its echoes given: write(chunk) → the chunk undone; write() → nothing held. */
function stream(opts) {
  let fs = rate(opts), echoes = given(opts, fs)
  if (!echoes) throw new TypeError('deecho: a stream needs its echoes ({ delay, gain[, feedback] } or { echoes }); to find them, the whole take')
  let run = remover(echoes, fs)
  return chunk => chunk ? Float32Array.from(run(chunk)) : new Float32Array(0)
}

const rate = o => {
  let fs = o.fs ?? 44100
  if (!(fs > 0) || !Number.isFinite(fs)) throw new RangeError(`deecho: fs is a sample rate, not ${fs}`)
  return fs
}
const stable = e => Number.isFinite(e.gain) && Number.isFinite(e.feedback) && Math.abs(e.feedback) < STABLE && Math.abs(e.gain - e.feedback) < STABLE
function check(e, fs) {
  if (!(e.delay * fs >= 1) || !Number.isFinite(e.delay)) throw new RangeError(`deecho: delay is seconds, a sample (${1 / fs}) or more, not ${e.delay}`)
  if (!stable(e)) throw new RangeError(`deecho: an echo of gain ${e.gain}, feedback ${e.feedback} has no stable inverse (|feedback| and |gain − feedback| under ${STABLE})`)
  return e
}
// the echoes the options state, or null
function given(o, fs) {
  if (o.echoes) return o.echoes.map(e => check({ delay: e.delay, gain: e.gain, feedback: e.feedback ?? 0 }, fs))
  if (o.delay != null && o.gain != null) return [check({ delay: o.delay, gain: o.gain, feedback: o.feedback ?? 0 }, fs)]
  return null
}

/**
 * The echoes in a take, [{ delay (s), gain, feedback }], strongest first; [] for none. With `delay` the gain and
 * feedback are measured there; with `gain` too, nothing is measured.
 */
export function estimate(data, opts = {}) {
  let fs = rate(opts), known = given(opts, fs)
  if (known) return known
  let a = analyse(data, fs, opts)
  if (!a) return []
  if (opts.delay != null) {
    let D = opts.delay * fs
    if (!(D >= 1) || !Number.isFinite(D) || 2 * D > a.S / 2) throw new RangeError(`deecho: delay is seconds, 1 sample to ${a.S / 4 / fs} here, not ${opts.delay}`)
    let r = fit(a, [], D)
    return r ? r.echoes.map(({ delay, gain, feedback }) => ({ delay, gain, feedback })) : []
  }
  let echoes = [], spec = a.spec, c = a.c
  for (let tap = 0; tap < (opts.taps ?? TAPS); tap++) {
    let found = null
    for (let i of peaks(a, c, echoes)) {
      // the top of the kept band trimmed by a quarter, twice at most, while it alone reads the echo short: there a noise
      // added after the echo fills more of the band than its quiet frames showed
      for (let b = a, s = spec, k = 0; b && k < 3; k++) {
        let D = refine(s, i)
        if (Math.abs(D - Math.round(D)) < SNAP) D = Math.round(D)
        let r = fit(b, echoes, D, s), v = r && accepted(b, r, D)
        if (v === true) { found = r, a = b; break }
        if (!v?.top) break
        b = trimmed(b), s = echoes.length ? reading(b, echoes) : b.spec
      }
      if (found) break
    }
    if (!found) break
    echoes = found.echoes, spec = found.spec, c = found.c
  }
  if (opts.gain != null && echoes.length) echoes = [check({ delay: echoes[0].delay, gain: opts.gain, feedback: opts.feedback ?? 0 }, fs)]
  return echoes.map(({ delay, gain, feedback }) => ({ delay, gain, feedback }))
}

// ---- the analysis ----

function analyse(data, fs, o) {
  let N = data.length, a0 = N > SPAN ? (N - SPAN) >> 1 : 0, n = Math.min(N, SPAN), y = Float64Array.from(data.slice(a0, a0 + n))
  for (let i = 0; i < n; i++) if (!Number.isFinite(y[i])) return null
  let lo = Math.max(2, Math.round((o.min ?? MIN) * fs)), hi = Math.min(Math.round((o.max ?? MAX) * fs), Math.floor(n / 4))
  if (o.delay != null) lo = 2, hi = Math.max(hi, Math.ceil(o.delay * fs))
  if (hi <= lo) return null
  // segments that hold the second copy of the longest delay with room to spare: its third shows while 3D < S/2
  let S = pow2(Math.max(4 * hi + 2 * TAPER * fs, 2 ** 15))
  return banded({ y, fs, lo, hi, S, power: power(y, S, fs) }, sounding(y, fs))
}
// the analysis over the kept bands `runs`; null when they are too few to read
function banded(a, runs) {
  if (runs.reduce((s, [p, q]) => s + q - p, 0) < 0.02 * a.fs / 2) return null
  let spec = logspec(a.power, a.S, runs, a.fs), c = cepstrum(spec), { mean, rms } = local(c, a.lo, Math.min(3 * a.hi + 3, a.S / 2 - 1))
  return { ...a, runs, spec, c, mean, rms }
}
// the kept bands less their top quarter, by Hz
const trimmed = a => banded(a, quarters(a.runs, 0, 3))
// the k-th to the m-th quarters of the kept Hz
function quarters(runs, k, m) {
  let hz = runs.reduce((s, [p, q]) => s + q - p, 0), from = k * hz / 4, to = m * hz / 4, acc = 0, sub = []
  for (let [p, q] of runs) { let s = Math.max(p, p + from - acc), t = Math.min(q, p + to - acc); if (t > s) sub.push([s, t]); acc += q - p }
  return sub
}
// the log power of what removing the echoes leaves, over the kept bands
const reading = (a, echoes) => logspec(power(remover(echoes, a.fs)(a.y), a.S, a.fs), a.S, a.runs, a.fs)

// the bands the take's own sound fills, [from, to] Hz: of 1/6-octave bands from 40 Hz, over 46 ms frames, those within
// 60 dB of the loudest whose quietest frames (their 5th percentile) lie 20 dB under their mean, as a voice's pauses do,
// or whose quieter half of frames still follows the bands beside it (a correlation of the log powers over 0.3), as
// music's, which never pauses, does. A noise added after the echo carries none of it: in its quiet frames a band of it
// is that noise alone, stationary, following nothing
function sounding(y, fs) {
  let F = pow2(0.046 * fs), hop = F / 2, H = F / 2 + 1, n = Math.max(0, Math.floor((y.length - F) / hop) + 1)
  if (n < 8) return [[0, fs / 2]]
  let edges = [0]
  for (let f = 40; f < fs / 2; f *= 2 ** (1 / 6)) edges.push(f)
  edges.push(fs / 2)
  let B = edges.length - 1, P = Array.from({ length: B }, () => new Float64Array(n)), band = new Int32Array(H)
  for (let k = 0, b = 0; k < H; k++) { while (b < B - 1 && k * fs / F >= edges[b + 1]) b++; band[k] = b }
  let w = Float64Array.from({ length: F }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / F)), fr = new Float64Array(F)
  for (let t = 0; t < n; t++) {
    for (let i = 0; i < F; i++) fr[i] = y[t * hop + i] * w[i]
    let [re, im] = fft(fr)
    for (let k = 1; k < H; k++) P[band[k]][t] += re[k] * re[k] + im[k] * im[k]
  }
  let mean = P.map(v => v.reduce((s, x) => s + x, 0) / n), dens = mean.map((m, b) => m / (edges[b + 1] - edges[b]))
  let top = dens.reduce((p, q) => Math.max(p, q), 0), q5 = Math.floor(0.05 * n), runs = []
  for (let b = 0; b < B; b++) {
    if (!(dens[b] > RANGE * top)) continue
    let v = P[b].slice().sort(), quiet = []
    for (let t = 0; t < n; t++) if (P[b][t] <= v[n >> 1]) quiet.push(t)
    let pick = p => Float64Array.from(quiet, t => p[t])
    if (!(v[q5] < KEEP * mean[b] || corr(logs(pick(P[b])), logs(pick(beside(P, b)))) > FOLLOW)) continue
    if (runs.length && runs.at(-1)[1] === edges[b]) runs.at(-1)[1] = edges[b + 1]
    else runs.push([edges[b], edges[b + 1]])
  }
  return runs
}
// the power of the bands within half an octave of b, b's own left out
function beside(P, b) { let v = new Float64Array(P[0].length); for (let j = Math.max(0, b - 3); j <= Math.min(P.length - 1, b + 3); j++) if (j !== b) for (let t = 0; t < v.length; t++) v[t] += P[j][t]; return v }
function logs(v) { let m = v.reduce((s, x) => s + x, 0) / v.length; return v.map(x => Math.log(x + 1e-12 * m + 1e-300)) }
function corr(p, q) {
  let n = p.length, mp = 0, mq = 0, spq = 0, spp = 0, sqq = 0
  for (let i = 0; i < n; i++) mp += p[i], mq += q[i]
  mp /= n, mq /= n
  for (let i = 0; i < n; i++) { let u = p[i] - mp, v = q[i] - mq; spq += u * v, spp += u * u, sqq += v * v }
  return spp > 0 && sqq > 0 ? spq / Math.sqrt(spp * sqq) : 0
}

const pow2 = n => 2 ** Math.ceil(Math.log2(Math.max(2, n)))
// the power spectrum of x over segments of S samples, each raised-cosine tapered over 50 ms at its ends, summed
function power(x, S, fs) {
  let H = S / 2 + 1, P = new Float64Array(H), seg = new Float64Array(S)
  for (let a = 0; a < x.length; a += S) {
    let n = Math.min(S, x.length - a), t = Math.min(Math.round(TAPER * fs), n >> 2)
    seg.fill(0)
    for (let i = 0; i < n; i++) seg[i] = x[a + i] * (i < t ? 0.5 - 0.5 * Math.cos(Math.PI * i / t) : i >= n - t ? 0.5 - 0.5 * Math.cos(Math.PI * (n - 1 - i) / t) : 1)
    let [re, im] = fft(seg)
    for (let k = 0; k < H; k++) P[k] += re[k] * re[k] + im[k] * im[k]
  }
  return P
}
// the log power, floored 120 dB under its mean; outside the kept bands drawn straight between the kept bins' means at
// either side, so it holds no ripple and no step. share: the kept bins' share of all
function logspec(P, S, runs, fs) {
  let H = S / 2 + 1, L = new Float64Array(H), keep = new Uint8Array(H), m = 0, kn = 0
  for (let k = 0; k < H; k++) m += P[k]
  let floor = 1e-12 * m / H || 1e-300
  for (let k = 0; k < H; k++) L[k] = Math.log(P[k] + floor)
  for (let [f0, f1] of runs) for (let k = Math.max(1, Math.ceil(f0 / fs * S)); k < Math.min(H, f1 / fs * S); k++) if (!keep[k]) keep[k] = 1, kn++
  let side = (s, d) => { let v = 0, c = 0; for (let k = s; k >= 0 && k < H && c < 64 && keep[k]; k += d) v += L[k], c++; return c ? v / c : null }
  for (let k = 0; k < H;) {
    if (keep[k]) { k++; continue }
    let e = k; while (e < H && !keep[e]) e++
    let l = side(k - 1, -1), r = side(e, 1)
    l ??= r ?? 0, r ??= l
    for (let j = k; j < e; j++) L[j] = l + (r - l) * (j - k + 1) / (e - k + 1)
    k = e
  }
  return { L, share: kn / (S / 2), S }
}
// the inverse transform of the log power at whole quefrencies, scaled as if every bin were kept: L is real and even,
// so its inverse transform is its forward one over S
function cepstrum({ L, share, S }) {
  let e = new Float64Array(S), c = new Float64Array(S / 2 + 1)
  for (let k = 0; k <= S / 2; k++) e[k] = L[k]
  for (let k = 1; k < S / 2; k++) e[S - k] = L[k]
  let [re] = fft(e)
  for (let i = 0; i <= S / 2; i++) c[i] = re[i] / S / share
  return c
}
// the same at a fractional quefrency q: (L_0 + 2 Σ L_k cos(2π k q / S) + L_{S/2} cos(π q)) / S, the band-limited
// continuation of the whole quefrencies (the cosine by rotation, set exactly every 1024 bins)
function at({ L, share, S }, q) {
  let th = 2 * Math.PI * q / S, cr = Math.cos(th), ci = Math.sin(th), zr = 1, zi = 0, s = 0
  for (let k = 1; k < S / 2; k++) {
    let r = zr * cr - zi * ci; zi = zr * ci + zi * cr; zr = r
    if ((k & 1023) === 0) zr = Math.cos(th * k), zi = Math.sin(th * k)
    s += L[k] * zr
  }
  return (2 * s + L[0] + L[S / 2] * Math.cos(Math.PI * q)) / S / share
}
// the level and spread of c about lag i: the median and 1.4826 times the median absolute deviation over i ± W (W a
// twelfth of i, 24 at least; 1.4826 = 1/Φ⁻¹(3/4), a normal's MAD to its σ, Rousseeuw & Croux, JASA 88(424), 1993), so
// an echo's peak and the sidelobes its kept bands give it do not raise its own spread
const reach = i => Math.max(24, Math.round(i / 12))
const median = v => { v.sort(); let h = v.length >> 1; return v.length & 1 ? v[h] : (v[h - 1] + v[h]) / 2 }
function around(c, i) {
  let W = reach(i), v = c.slice(Math.max(1, i - W), Math.min(c.length, i + W + 1)), mean = median(v.slice())
  for (let j = 0; j < v.length; j++) v[j] = Math.abs(v[j] - mean)
  return { mean, rms: Math.max(1.4826 * median(v), 1e-15) }
}
// the same over lo..hi, at anchors a quarter of W apart, straight between
function local(c, lo, hi) {
  let mean = new Float64Array(c.length), rms = new Float64Array(c.length), prev = null
  for (let i = Math.max(1, lo); ; i = Math.min(hi, i + Math.max(1, Math.round(reach(i) / 4)))) {
    let s = around(c, i)
    if (!prev) mean[i] = s.mean, rms[i] = s.rms
    else for (let j = prev.i; j <= i; j++) { let t = (j - prev.i) / (i - prev.i || 1); mean[j] = prev.mean + t * (s.mean - prev.mean), rms[j] = prev.rms + t * (s.rms - prev.rms) }
    prev = { i, ...s }
    if (i >= hi) break
  }
  return { mean, rms }
}

// the lags worth a try, strongest first: local maxima of the height over the neighbourhood, Z spreads up and near the
// faintest copy; not at a copy found, nor at twice or three times the lag of a stronger peak (its rahmonics)
function peaks({ lo, hi, mean, rms, fs }, c, echoes) {
  let h = i => c[i] - mean[i], near = (i, d) => [1, 2, 3].some(m => Math.abs(i - m * d) < 3), out = []
  for (let i = lo; i <= hi; i++) {
    let v = Math.abs(h(i))
    if (v < Z * rms[i] || v < 0.8 * FAINT || v <= Math.abs(h(i - 1)) || v < Math.abs(h(i + 1))) continue
    if (!echoes.some(e => near(i, e.delay * fs))) out.push(i)
  }
  out.sort((p, q) => Math.abs(h(q)) - Math.abs(h(p)))
  return out.filter((i, k) => !out.slice(0, k).some(j => j < i && near(i, j))).slice(0, TRY)
}
// the maximum of |c(q)| in [i − 1, i + 1], golden section
function refine(spec, i) {
  let g = (Math.sqrt(5) - 1) / 2, a = i - 1, b = i + 1, f = q => -Math.abs(at(spec, q))
  let x1 = b - g * (b - a), x2 = a + g * (b - a), f1 = f(x1), f2 = f(x2)
  for (let k = 0; k < 24; k++) {
    if (f1 < f2) b = x2, x2 = x1, f2 = f1, x1 = b - g * (b - a), f1 = f(x1)
    else a = x1, x1 = x2, f1 = f2, x2 = a + g * (b - a), f2 = f(x2)
  }
  return (a + b) / 2
}

// ---- the fit ----

// a line's cepstrum at mD
const rah = (g, f, m) => ((m % 2 ? 1 : -1) * (g - f) ** m + f ** m) / m
// the line at D, its gain and feedback read off the cepstrum: one copy, repeats, or both, as its second rahmonic reads
// within 3 spreads; then fitted again with the lines before it on what their removal leaves. Null when it cannot be
// undone
function fit(a, echoes, D, spec = a.spec) {
  let { fs, mean, rms } = a, g = at(spec, D) - (mean[Math.round(D)] ?? 0), c2 = at(spec, 2 * D) - (mean[Math.round(2 * D)] ?? 0), s2 = rms[Math.round(2 * D)] ?? Infinity
  let one = Math.abs(c2 + g * g / 2), rep = Math.abs(c2 - g * g / 2)
  let kind = Math.min(one, rep) < 3 * s2 ? (one <= rep ? 'one' : 'repeats') : 'both'
  let e = { delay: D / fs, gain: g, feedback: kind === 'one' ? 0 : kind === 'repeats' ? g : c2 / g + g / 2, kind }
  if (!stable(e)) return null
  let r = refit(a, [...echoes, e])
  // a model of one copy or of repeats the removal shows wrong at 2D: fitted as both
  if (kind !== 'both' && Math.abs(r.left(2 * D, unit(r))) > LEFT) r = refit(a, [...echoes, { ...r.echoes.at(-1), kind: 'both' }])
  return r.echoes.every(stable) ? r : null
}
// undo the lines, read what is left over its neighbourhood at each line's D and 2D, add it to the line's own cepstrum
// and read the line again: the removal leaves no copy cut off at a segment's ends, so this settles on the echo's own
function refit(a, echoes) {
  let { y, S, runs, fs } = a
  echoes = echoes.map(e => ({ ...e }))
  let x, spec, c
  for (let it = 0; it < ITER; it++) {
    x = remover(echoes, fs)(y), spec = logspec(power(x, S, fs), S, runs, fs), c = cepstrum(spec)
    for (let e of echoes) {
      let d = e.delay * fs, C1 = e.gain + at(spec, d) - around(c, Math.round(d)).mean
      let C2 = rah(e.gain, e.feedback, 2) + at(spec, 2 * d) - around(c, Math.round(2 * d)).mean
      e.feedback = e.kind === 'one' ? 0 : e.kind === 'repeats' ? C1 : C2 / C1 + C1 / 2, e.gain = C1
    }
  }
  // what the removal leaves at a lag, in its spreads, or in `floor` when larger
  let left = (q, floor = 0) => { let { mean, rms } = around(c, Math.round(q)); return (at(spec, q) - mean) / Math.max(rms, floor) }
  return { echoes, x, spec, c, left }
}
// a departure is counted in spreads, or in fiftieths of the line's gain when larger: the sound's own cepstrum at D (a
// part of a song repeating at it) moves a strong echo's reading by a few hundredths, while what is no echo strays from
// the reading by about all of it
const unit = r => Math.abs(r.echoes.at(-1).gain) / 50
// a line kept: its first copy FAINT at least; the removal leaving none at 3D (where the segments hold it), nor at D in
// the parts of the take long enough to hold four delays (up to 4), nor in any quarter of its kept band, each over its
// own spread, never under the whole's: a beat, a loop or a held note comes and goes over the take and over its band
function accepted(a, r, D) {
  let { S, runs, fs } = a, e = r.echoes.at(-1), i = Math.round(D), u = unit(r)
  if (Math.abs(e.gain) < FAINT) return false
  if (3 * D < S / 2 - reach(3 * D) && Math.abs(r.left(3 * D, u)) > LEFT) return false
  let whole = Math.max(around(r.c, i).rms, u), worst = 0
  let gap = s => { let { mean, rms } = around(cepstrum(s), i); return (at(s, D) - mean) / Math.max(rms, whole) }
  let n = r.x.length, P = Math.min(4, Math.floor(n / (4 * D))), sq = 0
  if (P > 1) for (let p = 0; p < P; p++) {
    let part = r.x.subarray(Math.floor(p * n / P), Math.floor((p + 1) * n / P)), Sp = pow2(part.length), z = gap(logspec(power(part, Sp, fs), Sp, runs, fs))
    worst = Math.max(worst, Math.abs(z)), sq += z * z / P
  }
  if (sq > PARTS || worst > STRAY) return false
  let all = power(r.x, S, fs), z = [0, 1, 2, 3].map(k => gap(logspec(all, S, quarters(runs, k, k + 1), fs)))
  if (z.every(v => Math.abs(v) <= STRAY)) return true
  // only the top quarter strays, and below: the echo read short there, {top}
  return z.slice(0, 3).every(v => Math.abs(v) <= STRAY) && z[3] < -STRAY ? { top: true } : false
}

// ---- the removal ----

// a delay D read from the past: a whole one its sample; a fractional one through a Kaiser-windowed sinc (β 8; Kaiser,
// IEEE ISCAS 1974; Laakso et al. 1996) over 2K taps about it, K up to 16 and at most floor(D), so it reads nothing
// at or after now; its taps sum to 1. With K 16 it delays within −57 dB of the ideal to 0.85 of Nyquist, −25 dB at 0.9
const I0 = x => { let s = 1, t = 1; for (let k = 1; k < 30; k++) t *= (x / (2 * k)) ** 2, s += t; return s }
function kernel(D) {
  let Di = Math.floor(D), f = D - Di
  if (f === 0) return { Di, K: 0, h: Float64Array.of(1) }
  let K = Math.min(16, Di), h = new Float64Array(2 * K), s = 0
  for (let j = 0; j < 2 * K; j++) {
    let u = 1 - f - (j - K + 1), r = u / K, w = Math.abs(r) < 1 ? I0(8 * Math.sqrt(1 - r * r)) / I0(8) : 0
    h[j] = (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u)) * w, s += h[j]
  }
  for (let j = 0; j < h.length; j++) h[j] /= s
  return { Di, K, h }
}
// the removal over a stream: chunk → the chunk less each line run on what came out, the lines' and the output's past
// kept between chunks
function remover(echoes, fs) {
  let lines = echoes.map(e => ({ ...kernel(e.delay * fs), g: e.gain, f: e.feedback }))
  let back = lines.reduce((m, l) => Math.max(m, l.Di + l.K), 1), hx = new Float64Array(back), hw = lines.map(() => new Float64Array(back))
  return chunk => {
    let n = chunk.length, x = new Float64Array(back + n), w = hw.map(p => { let v = new Float64Array(back + n); v.set(p); return v })
    x.set(hx)
    for (let i = back; i < back + n; i++) {
      let v = chunk[i - back]
      for (let l = 0; l < lines.length; l++) {
        let { Di, K, h, g, f } = lines[l], wl = w[l], p = i - Di - K, s = 0
        for (let j = 0; j < h.length; j++) s += h[j] * (x[p + j] + f * wl[p + j])
        wl[i] = s, v -= g * s
      }
      x[i] = v
    }
    hx = x.slice(n), hw = w.map(v => v.slice(n))
    return x.subarray(back)
  }
}
