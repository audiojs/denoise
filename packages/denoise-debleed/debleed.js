// De-bleed. A microphone hears its own source and, quieter, another one: a click track leaking from headphones, a
// guitar amp across the room, the co-host in the other mic. Given that other source as it was recorded (its own track,
// the reference), the bleed is the reference through an unknown, slowly changing room path, y = s + h∗x, and comes
// out in two stages:
//
// 1. Cancellation. A partitioned-block frequency-domain Kalman filter (Enzner & Vary, Signal Processing 86(6), 2006;
//    the partitioned form of Kuech, Mabande & Enzner, ICASSP 2014) predicts the bleed from the
//    reference, P partitions of B taps (overlap-save, 2B frames, `span` s of path; a delay of tens of ms sits in it),
//    and subtracts it. Its step, per bin, is its uncertainty about the path over that uncertainty plus the wanted
//    sound's power: while the wanted sound plays it hardly moves (the double-talk that throws an echo canceller's
//    NLMS off is the normal state here), in its pauses it learns at once. The path is a stationary AR(1) process
//    (W ← A·W, A per block), so the filter follows a moving source and its uncertainty never collapses to nothing.
//    It learns from the reference less its own noise floor (Martin 2001's minimum statistics, a Wiener gain): a
//    reference mic's hiss never reached the other mic, and learning from it says the path is nothing.
// 2. Suppression. What cancellation leaves (a path not learned yet, a source moving faster than the filter follows,
//    the room's tail past `span`) has a known power: the filter's uncertainty times the reference's power, plus the
//    tail. A Wiener gain on the decision-directed a priori SNR (Ephraim & Malah 1984) against it, floored at
//    `attenuation`, takes it from the remaining error, on sqrt-Hann frames of 2B at a hop of B. Removal = prediction
//    + suppressed part; with no reference both are exactly zero and the output is the input, sample for sample.
//
// Two mics in one room hear each other both ways: the reference holds the wanted sound too, and while that sound
// plays alone the filter would learn to predict it from its echo in the reference and take it away. So a second
// filter of the same kind learns the way back, from the cancelled output to the reference, and the first learns from
// the reference less that (the crosstalk-resistant canceller of Mirchandani, Zinser & Evans, IEEE TCAS-II 39(10),
// 1992). Each path's level is held at most 0 dB: bleed is quieter than its source in its own track, while a relation
// the wrong way round (the wanted sound from its own echo) is louder.
//
// A path's prior, E|W_p(k)|² = level(k)·ρ^p, is what the filter knows about it before hearing it: a room's power
// decay ρ per block (RT 0.25 s) and a level per band (a quarter of its frequency wide), learned as it goes (empirical
// Bayes): the power coherent with the prediction (the short-time magnitude-squared coherence of the two, Carter 1973,
// debiased, times the mic's power) over the source's power through the decay, averaged in dB, each block weighed by
// the coherence² (at least 0.02: blocks without coherence pull a path that never bleeds down). Coherence is blind to
// the prediction's level, so a path the filter has barely begun to learn already reads at its true level, and the
// wanted sound, incoherent with the reference, is not taken for bleed. The level sets how fast the filter learns and
// how much residual the suppressor expects; the batch call learns it over the whole take first, then runs again with
// it (the stream learns as it goes, its first seconds lighter). If the cancellation ever adds power in a band (a path
// that jumped), that band's filter starts over (the divergence reset of WebRTC's AEC3 and Speex's MDF).

import { fft, ifft } from 'fourier-transform'
import { minStats } from '@audio/noise-estimate'

// the block: the power of two nearest 10.7 ms (512 at 44.1 and 48 kHz); the path partitions and the hop
export const block = fs => 2 ** Math.round(Math.log2(0.0107 * fs))

const SPAN = 0.3, RT = 0.25                         // s of path in the filter; the room's decay for the prior and tail
const A = 0.998                                     // the path's AR(1) coefficient per block (memory ~5 s)
const LEVEL0 = 0.001                                // a path's level before any coherence is heard (−30 dB)
const W0 = 10, STEP = 0.005                         // the level average's prior weight (blocks), its least step
const W_MIN = 0.02, MSC_MIN = 3e-4                  // a block's least weight; the least coherence it reads (−35 dB)
const COH = 8, SM = 4, VALID = 0.01                 // blocks of coherence, of power smoothing; source ≥ −20 dB of its peak
const PEAK = 3                                      // dB/s the source's peak decays by
const BETA = 0.5, PS_FLOOR = 0.1                    // the wanted power's smoothing per block; its floor × the error's
const INFO = 0.5                                    // the information a block adds to the filter, × the diagonal model's
const ADD = 0.9, XI_MIN = 1e-3                      // decision-directed α per block, a priori SNR floor (−30 dB)
const NX_SPAN = 1.5                                 // s of minimum statistics for a source's noise floor
const DIVERGE = 2, DIV_T = 0.5                      // a band resets when its error outweighs its mic 2×, over 0.5 s

/** Batch: takes the bleed of `ref` (one channel, or an array of channels) out of `data` in place and returns it;
 *  two passes: the paths' levels learned over the whole take, then the removal. Stream: `debleed(opts)` returns
 *  write(chunk, ref) → the samples done so far (up to 2B − 1 behind), write() → the rest. */
export default function debleed(data, ref, opts) {
  if (data instanceof Float32Array || data instanceof Float64Array) {
    let refs = Array.isArray(ref) ? ref : ref ? [ref] : [], o = opts || {}
    let learn = stream(o)
    learn.write(data, refs); learn.write()
    let s = stream(o, learn.levels())
    let y = s.write(data, refs), z = s.write()
    data.set(y); data.set(z, y.length)
    return data
  }
  return writer(stream(data || {}))
}

const writer = s => (chunk, ref) => chunk ? s.write(chunk, ref == null ? [] : Array.isArray(ref) ? ref : [ref]) : s.write()

// blocks of B in, B out a block behind; the core made on the first block, with as many references as it brings
function stream(o, levels) {
  let fs = o.fs || 44100, B = o.blockSize || block(fs), core = null
  let inM = new Float64Array(B), inR = [], fill = 0, total = 0, sent = 0
  let run = (m, refs, n) => {
    let out = []
    while (inR.length < Math.max(1, refs.length)) inR.push(new Float64Array(B))
    for (let i = 0; i < n; i++) {
      inM[fill] = m ? m[i] : 0
      for (let c = 0; c < inR.length; c++) inR[c][fill] = refs[c]?.[i] ?? 0
      if (++fill === B) {
        fill = 0
        core ??= canceller(o, fs, B, inR.length, levels)
        let y = core.block(inM, inR)
        if (y) out.push(y)
      }
    }
    let y = concat(out); sent += y.length; return y
  }
  return {
    write(m, refs) {
      if (m) { total += m.length; return run(m, refs, m.length) }
      let out = []
      while (sent < total) out.push(run(null, [], B))
      let y = concat(out); return y.subarray(0, y.length - (sent - total))
    },
    levels: () => core?.levels()
  }
}
const concat = a => { let n = 0; for (let x of a) n += x.length; let y = new Float32Array(n), k = 0; for (let x of a) y.set(x, k), k += x.length; return y }
const arr = (n, f) => Array.from({ length: n }, f)
const zeros = n => new Float64Array(n)

// one block in (B samples of the mic, B of each reference), B out once the suppressor's frame is done (null before)
function canceller(o, fs, B, C, levels) {
  let M = 2 * B, K = B + 1, P = Math.max(1, Math.ceil((o.span ?? SPAN) * fs / B))
  let fwd = path(fs, B, P, C, levels?.fwd), back = arr(C, (_, c) => path(fs, B, P, 1, levels?.back[c]))
  let yh = zeros(B), e = zeros(B), xh = zeros(B), xc = arr(C, () => zeros(B)), any = false, blocks = 0
  let t = zeros(M), sp = [zeros(K), zeros(K)], win = Float64Array.from({ length: M }, (_, n) => Math.sin(Math.PI * (n + 0.5) / M))
  let eb = zeros(M), ola = zeros(M), Gp = zeros(K).fill(1), Ep = zeros(K)

  // the suppressor on the error: sqrt-Hann frames of 2B, hop B; out: the oldest B, its error less the removal
  let suppress = R => {
    eb.copyWithin(0, B); eb.set(e, B)
    let gMin = 10 ** (Math.min(0, o.attenuation ?? -20) / 20)
    for (let n = 0; n < M; n++) t[n] = eb[n] * win[n]
    fft(t, sp)
    let [ur, ui] = sp
    for (let k = 0; k < K; k++) {
      let E2 = ur[k] * ur[k] + ui[k] * ui[k], g = 1
      if (R && R[k] > 0) {
        let xi = Math.max(ADD * Gp[k] * Gp[k] * Ep[k] / R[k] + (1 - ADD) * Math.max(E2 / R[k] - 1, 0), XI_MIN)
        g = Math.max(xi / (1 + xi), gMin)
      }
      Gp[k] = g; Ep[k] = E2
      ur[k] *= 1 - g; ui[k] *= 1 - g
    }
    ifft(ur, ui, t)
    for (let n = 0; n < M; n++) ola[n] += t[n] * win[n]
    let out = new Float32Array(B)
    for (let n = 0; n < B; n++) out[n] = eb[n] - ola[n]
    ola.copyWithin(0, B); ola.fill(0, B)
    return out
  }

  return {
    levels: () => ({ fwd: fwd.level(), back: back.map(b => b.level()) }),
    block(y, x) {
      if (!any) for (let c = 0; c < C && !any; c++) for (let n = 0; n < B; n++) if (x[c][n] !== 0) { any = true; break }
      let R = null
      if (!any) e.set(y)
      else {
        // the bleed predicted from the reference as it is, taken off the mic
        fwd.hear(x); fwd.predict(yh)
        for (let n = 0; n < B; n++) e[n] = y[n] - yh[n]
        // the way back: each reference less what the output predicts of it, which the forward path learns from
        for (let c = 0; c < C; c++) {
          let b = back[c]
          b.hear([e]); b.predict(xh)
          for (let n = 0; n < B; n++) xc[c][n] = x[c][n] - xh[n]
          b.learn([e], x[c], xh); b.update(xc[c], x[c])
        }
        fwd.learn(xc, y, yh)
        R = fwd.update(e, y)
      }
      let out = suppress(R)
      return blocks++ ? out : null
    }
  }
}

// a room path from C sources to one mic: a partitioned-block Kalman filter over P partitions of B taps (overlap-save),
// the prior's level per band learned by coherence, the source's power past the span (the tail)
function path(fs, B, P, C, learned) {
  let M = 2 * B, K = B + 1, r = B / M
  let rho = 10 ** (-6 * B / fs / RT), dp = Float64Array.from({ length: P }, (_, p) => rho ** p), A2 = A * A
  let lMax = Math.log(1 - rho)                     // the level of a path of 0 dB in all (Σ_p ρ^p = 1/(1 − ρ))

  // bands a quarter of their frequency wide (≥ 2 bins), each with its level: log-mean, weight, statistics
  let bands = [], k0 = 1
  while (k0 < K) { let k1 = Math.min(K, k0 + Math.max(2, Math.round(0.25 * k0))); bands.push([k0, k1]); k0 = k1 }
  bands[0][0] = 0
  let NB = bands.length, lev = zeros(K), bandOf = new Int32Array(K)
  bands.forEach(([a, z], b) => bandOf.fill(b, a, z))
  let lc = learned ? Float64Array.from(learned.lc) : zeros(NB).fill(Math.log(LEVEL0))
  let ws = learned ? Float64Array.from(learned.ws) : zeros(NB).fill(W0)
  for (let k = 0; k < K; k++) lev[k] = Math.exp(lc[bandOf[k]])
  let Ya = zeros(NB), Za = zeros(NB), Zpk = zeros(NB), cr = zeros(NB), ci = zeros(NB), cyy = zeros(NB), chh = zeros(NB)
  let Yd = zeros(NB), Ed = zeros(NB)
  let ac = 1 - 1 / COH, as = 1 - 1 / SM, pk = 10 ** (-PEAK * B / fs / 10), ad = Math.exp(-B / fs / DIV_T)

  // per source: its last 2B samples as heard and as learned from, the spectra of its last P frames (as heard, for the
  // prediction; less its noise floor, to learn from), its power past the span; per source and partition: W, Pw
  let xb = arr(C, () => zeros(M)), lb = arr(C, () => zeros(M)), nx = arr(C, () => minStats(B, { D: Math.round(NX_SPAN * fs / B) }))
  let Xr = arr(C, () => arr(P, () => zeros(K))), Xi = arr(C, () => arr(P, () => zeros(K)))
  let Vr = arr(C, () => arr(P, () => zeros(K))), Vi = arr(C, () => arr(P, () => zeros(K)))
  let T = arr(C, () => zeros(K))
  let Wr = arr(C, () => arr(P, () => zeros(K))), Wi = arr(C, () => arr(P, () => zeros(K)))
  let Pw = arr(C, () => arr(P, (_, p) => Float64Array.from(lev, v => v * dp[p])))
  let head = 0, blocks = 0

  let Yr = zeros(K), Yi = zeros(K), Er = zeros(K), Ei = zeros(K), Ps = zeros(K), Phi = zeros(K), R = zeros(K)
  let Y0 = zeros(K), Z = zeros(K), mg = zeros(K), t = zeros(M), sp = [zeros(K), zeros(K)], sy = [zeros(K), zeros(K)], sh = [zeros(K), zeros(K)]
  let at = (p) => (head - p + P) % P

  // the spectrum of [0, x]: a block in the filter's terms (B samples, zero-padded in front)
  let front = (x, out) => { for (let n = 0; n < B; n++) { t[n] = 0; t[B + n] = x[n] } fft(t, out) }

  // a new prior variance for W_p(k): the data's precision kept, the prior's replaced (zero prior mean)
  let reprior = (c, p, k, c0, c1) => {
    let pw = Pw[c][p][k]
    if (!(c0 > 0) || !(pw > 0)) { Pw[c][p][k] = c1; return }
    let pn = 1 / (Math.max(1 / pw - 1 / c0, 0) + 1 / c1), f = pn / pw
    Pw[c][p][k] = pn; Wr[c][p][k] *= f; Wi[c][p][k] *= f
  }

  return {
    level: () => ({ lc, ws }),

    // the sources' new frame (as heard); W⁺ = A·W, P⁺ = A²·P + (1 − A²)·prior: W stationary AR(1) of the prior's variance
    hear(x) {
      head = (head + 1) % P
      for (let c = 0; c < C; c++) {
        let b = xb[c]
        b.copyWithin(0, B); b.set(x[c], B)
        fft(b, sp); Xr[c][head].set(sp[0]); Xi[c][head].set(sp[1])
        for (let p = 0; p < P; p++) {
          let wr = Wr[c][p], wi = Wi[c][p], pw = Pw[c][p], d = (1 - A2) * dp[p]
          for (let k = 0; k < K; k++) { wr[k] *= A; wi[k] *= A; pw[k] = A2 * pw[k] + d * lev[k] }
        }
      }
    },

    // the prediction Σ X_p W_p: its last B samples, this block's
    predict(out) {
      Yr.fill(0); Yi.fill(0)
      for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
        let q = at(p), xr = Xr[c][q], xi = Xi[c][q], wr = Wr[c][p], wi = Wi[c][p]
        for (let k = 0; k < K; k++) { Yr[k] += xr[k] * wr[k] - xi[k] * wi[k]; Yi[k] += xr[k] * wi[k] + xi[k] * wr[k] }
      }
      ifft(Yr, Yi, t)
      out.set(t.subarray(B))
    },

    // the sources' new frame to learn from (less their noise floor, a Wiener gain on the minimum statistics); the
    // oldest leaves the span for the tail. Then the level per band: the mic's power coherent with the prediction
    // `yh`, over the sources' power through the decay
    learn(x, y, yh) {
      for (let c = 0; c < C; c++) {
        let b = lb[c], vr = Vr[c][head], vi = Vi[c][head], tc = T[c]
        for (let k = 0; k < K; k++) tc[k] = rho * (tc[k] + dp[P - 1] * (vr[k] * vr[k] + vi[k] * vi[k]))
        b.copyWithin(0, B); b.set(x[c], B)
        fft(b, sp)
        for (let k = 0; k < K; k++) mg[k] = Math.hypot(sp[0][k], sp[1][k])
        nx[c].update(mg)
        for (let k = 0; k < K; k++) { let p2 = mg[k] * mg[k], g = p2 > 0 ? Math.max(0, 1 - nx[c].psd[k] / p2) : 0; vr[k] = g * sp[0][k]; vi[k] = g * sp[1][k] }
      }
      // the sources' power through the decay, Σ_p ρ^p |V_{l−p}|², the span and the tail together
      for (let k = 0; k < K; k++) { let v = 0; for (let c = 0; c < C; c++) v += Vr[c][head][k] ** 2 + Vi[c][head][k] ** 2; Z[k] = rho * Z[k] + v }
      front(y, sy); front(yh, sh)
      for (let k = 0; k < K; k++) Y0[k] = sy[0][k] ** 2 + sy[1][k] ** 2
      for (let b = 0; b < NB; b++) {
        let [a, z] = bands[b], xr = 0, xi = 0, yy = 0, hh = 0, zs = 0
        for (let k = a; k < z; k++) {
          let yr = sy[0][k], yi = sy[1][k], hr = sh[0][k], hi = sh[1][k]
          xr += yr * hr + yi * hi; xi += yi * hr - yr * hi; yy += Y0[k]; hh += hr * hr + hi * hi
          zs += r * Z[k]
        }
        cr[b] = ac * cr[b] + (1 - ac) * xr; ci[b] = ac * ci[b] + (1 - ac) * xi; cyy[b] = ac * cyy[b] + (1 - ac) * yy; chh[b] = ac * chh[b] + (1 - ac) * hh
        Ya[b] = as * Ya[b] + (1 - as) * yy; Za[b] = as * Za[b] + (1 - as) * zs; Zpk[b] = Math.max(Za[b], pk * Zpk[b])
        if (learned || !(chh[b] > 0) || !(Za[b] > VALID * Zpk[b])) continue
        // magnitude-squared coherence less its bias over (2/(1 − ac) − 1)·bins independent looks (Carter 1973)
        let m0 = (1 - ac) / (1 + ac) / (z - a), msc = Math.max(0, ((cr[b] ** 2 + ci[b] ** 2) / (cyy[b] * chh[b]) - m0) / (1 - m0))
        let w = Math.max(msc * msc, W_MIN)
        ws[b] += w
        lc[b] = Math.min(lMax, lc[b] + Math.max(w / ws[b], STEP * w) * (Math.log(Math.max(msc, MSC_MIN) * Ya[b] / Za[b]) - lc[b]))
        let v = Math.exp(lc[b])
        for (let k = a; k < z; k++) { for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) reprior(c, p, k, lev[k] * dp[p], v * dp[p]); lev[k] = v }
      }
    },

    // the error e = y − prediction: the residual's power (the filter's uncertainty and the tail past it), the wanted
    // sound's (the error less it), the Kalman update (diagonal, Enzner & Vary 2006), the divergence
    // check; → the residual's power. The gradient is held to B taps in one partition per block, in turn (the
    // alternately constrained filter of Speex's MDF, Valin 2007; Soo & Pang 1990): the others' circular wrap is
    // small and cleared on their turn, at a fraction of the transforms
    update(e, y) {
      front(e, sp); Er.set(sp[0]); Ei.set(sp[1])
      Phi.fill(0)
      for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
        let q = at(p), vr = Vr[c][q], vi = Vi[c][q], pw = Pw[c][p]
        for (let k = 0; k < K; k++) Phi[k] += (vr[k] * vr[k] + vi[k] * vi[k]) * pw[k]
      }
      let first = !blocks++
      for (let k = 0; k < K; k++) {
        let tl = 0; for (let c = 0; c < C; c++) tl += T[c][k]
        R[k] = r * (Phi[k] + lev[k] * tl)
        let E2 = Er[k] * Er[k] + Ei[k] * Ei[k], v = Math.max(E2 - R[k], PS_FLOOR * E2)
        Ps[k] = first ? E2 : BETA * Ps[k] + (1 - BETA) * v
      }
      for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
        let q = at(p), vr = Vr[c][q], vi = Vi[c][q], wr = Wr[c][p], wi = Wi[c][p], pw = Pw[c][p], [ur, ui] = sp
        for (let k = 0; k < K; k++) {
          let d = Phi[k] + Ps[k] / r, mu = d > 0 ? pw[k] / d : 0
          ur[k] = mu * (vr[k] * Er[k] + vi[k] * Ei[k]); ui[k] = mu * (vr[k] * Ei[k] - vi[k] * Er[k])
          pw[k] *= 1 - INFO * r * mu * (vr[k] * vr[k] + vi[k] * vi[k])
        }
        for (let k = 0; k < K; k++) { wr[k] += ur[k]; wi[k] += ui[k] }
        if (p === blocks % P) { ifft(wr, wi, t); t.fill(0, B); fft(t, sp); wr.set(sp[0]); wi.set(sp[1]) }
      }
      // a band whose error outweighs its mic: the filter there starts over
      front(y, sy)
      for (let b = 0; b < NB; b++) {
        let [a, z] = bands[b], ys = 0, es = 0
        for (let k = a; k < z; k++) ys += sy[0][k] ** 2 + sy[1][k] ** 2, es += Er[k] * Er[k] + Ei[k] * Ei[k]
        Yd[b] = ad * Yd[b] + (1 - ad) * ys; Ed[b] = ad * Ed[b] + (1 - ad) * es
        if (!(Ed[b] > DIVERGE * Yd[b])) continue
        for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) for (let k = a; k < z; k++) { Wr[c][p][k] = 0; Wi[c][p][k] = 0; Pw[c][p][k] = lev[k] * dp[p] }
        Ed[b] = Yd[b]
      }
      return R
    }
  }
}
