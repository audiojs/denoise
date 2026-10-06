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
//    NLMS off is the normal state here), where the bleed outweighs it, it learns at once. The wanted sound's power is
//    the error's less the residual the filter expects, smoothed over blocks: a click's own block, all bleed, says
//    nothing of the voice under it. The path is a stationary AR(1) process (W ← A·W, A per block), so the filter
//    follows a moving source and its uncertainty never collapses to nothing. It learns from the reference exactly as
//    it predicts from it (an update from any other signal is not the gradient of the error it leaves), and each
//    partition's update is held to its B taps every block (the constrained filter: the circular wrap of a full step,
//    left in place, rings through the next predictions).
// 2. Suppression. What cancellation leaves (a path not learned yet, a source moving faster than the filter follows,
//    the room's tail past `span`) has a known power: the filter's uncertainty times the reference's power, plus the
//    tail. A Wiener gain on the decision-directed a priori SNR (Ephraim & Malah 1984) against it, floored at
//    `attenuation`, takes it from the remaining error, on sqrt-Hann frames of 2B at a hop of B. Removal = prediction
//    + suppressed part; with no reference both are exactly zero and the output is the input, sample for sample.
//
// A path's prior, E|W_p(k)|² = level(k)·ρ^p, is what the filter knows about it before hearing it: a room's power
// decay ρ per block (RT 0.25 s) and a level per band (a quarter of its frequency wide). Where the source first sounds
// in a band, the level starts at the most it can be: all the mic's power there from the source. Then it is learned as
// it goes (empirical Bayes): the power coherent with the prediction (the short-time magnitude-squared coherence of
// the two, Carter 1973, debiased, times the mic's power) over the source's power through the decay, averaged in dB,
// each block weighed by the coherence² (at least 0.1: blocks without coherence pull a path that never bleeds down).
// Coherence is blind to the prediction's level, so a path the filter has barely begun to learn already reads at its
// true level, and the wanted sound, incoherent with the reference, is not taken for bleed. No level predicts more bleed
// than the mic holds: the mic's whole power over the source's through the decay, over the last seconds. That bound is
// blind to the tracks' gains (a click track recorded 20 dB under its bleed is learned all the same), and it keeps two
// mics that hear each other from taking the wanted voice: while that voice sounds alone the reference holds its echo,
// which predicts it only through a path louder than the mic. The level sets how fast the filter learns and how much
// residual the suppressor expects. The batch call runs the take twice, the second pass from where the first ended (the
// levels and the filter: a static path is cancelled from the first sample, and a level learned down where nothing
// bleeds leaves the wanted sound alone). The stream cannot look ahead, and a level at its bound would take a voice
// the source never reached in its first seconds, so it learns as above but cancels and suppresses a band only once
// the evidence proves a path there: the power its prediction (made before the block was heard) takes off the mic, two
// spreads over nothing (a t-test; the prediction of a filter fit to an unrelated voice adds power instead). Until then
// the band passes as it came, and with no band open the stream is the input, sample for sample. A talker under a louder
// voice takes seconds to prove, so the stream takes less of it than the batch call. If the cancellation ever adds
// power in a band (a path that jumped), that band's filter starts over (the divergence reset of WebRTC's AEC3 and
// Speex's MDF).

import { fft, ifft } from 'fourier-transform'

// the block: the power of two nearest 10.7 ms (512 at 44.1 and 48 kHz); the path partitions and the hop
export const block = fs => 2 ** Math.round(Math.log2(0.0107 * fs))

const SPAN = 0.3, RT = 0.25                         // s of path in the filter; the room's decay for the prior and tail
const A = 0.998                                     // the path's AR(1) coefficient per block (memory ~5 s)
const W0 = 10, STEP = 0.005                         // the level average's prior weight (blocks), its least step
const W_MIN = 0.1, MSC_MIN = 3e-4                   // a block's least weight; the least coherence it reads (−35 dB)
const COH = 8, SM = 4, VALID = 0.01                 // blocks of coherence, of power smoothing; source ≥ −20 dB of its peak
const PEAK = 3                                      // dB/s the source's peak decays by
const HOLD = 10                                     // s of the mic's and the sources' powers that bound the level
const GATE_T = 1, ZG = 2                            // the stream's gate: s it weighs; the spreads that open a band
const RISE = 10, RISE_T = 3                         // a source sounds in a band 10 dB over its least there; that rising 3 dB/s
const BETA = 0.5                                    // the wanted power's smoothing per block
const INFO = 0.5                                    // the information a block adds to the filter, × the diagonal model's
const ADD = 0.9, XI_MIN = 1e-3                      // decision-directed α per block, a priori SNR floor (−30 dB)
const DIVERGE = 2, DIV_T = 0.5                      // a band resets when its error outweighs its mic 2×, over 0.5 s

/** Batch: takes the bleed of `ref` (one channel, or an array of channels) out of `data` in place and returns it;
 *  two passes: the path learned over the whole take, then the removal from where it ended. Stream: `debleed(opts)`
 *  returns write(chunk, ref) → the samples done so far (up to 2B − 1 behind), write() → the rest; it cancels a band
 *  once the evidence proves the path there. */
export default function debleed(data, ref, opts) {
  if (data instanceof Float32Array || data instanceof Float64Array) {
    let refs = Array.isArray(ref) ? ref : ref ? [ref] : [], o = opts || {}
    let learn = stream(o)
    learn.write(data, refs); learn.write()
    let s = stream(o, learn.state())
    let y = s.write(data, refs), z = s.write()
    data.set(y); data.set(z, y.length)
    return data
  }
  return writer(stream(data || {}, null, true))
}

const writer = s => (chunk, ref) => chunk ? s.write(chunk, ref == null ? [] : Array.isArray(ref) ? ref : [ref]) : s.write()

// blocks of B in, B out a block behind; the core made on the first block, with as many references as it brings
function stream(o, learned, gated) {
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
        core ??= canceller(o, fs, B, inR.length, learned, gated)
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
    state: () => core?.state()
  }
}
const concat = a => { let n = 0; for (let x of a) n += x.length; let y = new Float32Array(n), k = 0; for (let x of a) y.set(x, k), k += x.length; return y }
const arr = (n, f) => Array.from({ length: n }, f)
const zeros = n => new Float64Array(n)
const copy = a => a.map(b => b.map(v => Float64Array.from(v)))

// one block in (B samples of the mic, B of each reference), B out once the suppressor's frame is done (null before)
function canceller(o, fs, B, C, learned, gated) {
  let M = 2 * B, K = B + 1, P = Math.max(1, Math.ceil((o.span ?? SPAN) * fs / B))
  let fwd = path(fs, B, P, C, learned, gated)
  let yh = zeros(B), yo = zeros(B), ep = zeros(B), e = zeros(B), any = false, blocks = 0
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
    state: () => fwd.state(),
    block(y, x) {
      if (!any) for (let c = 0; c < C && !any; c++) for (let n = 0; n < B; n++) if (x[c][n] !== 0) { any = true; break }
      let R = null
      if (!any) e.set(y)
      else {
        // the bleed predicted from the reference, taken off the mic; the level; the update
        fwd.hear(x); fwd.predict(yh)
        for (let n = 0; n < B; n++) ep[n] = y[n] - yh[n]
        fwd.learn(y, yh)
        R = fwd.update(ep, y)
        // the stream: only the bands its gate opened are cancelled and suppressed, the rest pass as they came
        if (gated) { R = fwd.shown(yo, R); for (let n = 0; n < B; n++) e[n] = y[n] - yo[n] }
        else e.set(ep)
      }
      let out = suppress(R)
      return blocks++ ? out : null
    }
  }
}

// a room path from C sources to one mic: a partitioned-block Kalman filter over P partitions of B taps (overlap-save),
// the prior's level per band learned by coherence, the sources' power past the span (the tail). `learned`: the state
// a first pass ended with, its levels held
function path(fs, B, P, C, learned, gated) {
  let M = 2 * B, K = B + 1, r = B / M
  let rho = 10 ** (-6 * B / fs / RT), dp = Float64Array.from({ length: P }, (_, p) => rho ** p), A2 = A * A

  // bands a quarter of their frequency wide (≥ 2 bins), each with its level: log-mean, weight, heard yet, statistics
  let bands = [], k0 = 1
  while (k0 < K) { let k1 = Math.min(K, k0 + Math.max(2, Math.round(0.25 * k0))); bands.push([k0, k1]); k0 = k1 }
  bands[0][0] = 0
  let NB = bands.length, lev = zeros(K), bandOf = new Int32Array(K)
  bands.forEach(([a, z], b) => bandOf.fill(b, a, z))
  let lc = learned ? Float64Array.from(learned.lc) : zeros(NB), ws = learned ? Float64Array.from(learned.ws) : zeros(NB).fill(W0)
  let heard = learned ? Uint16Array.from(learned.heard) : new Uint16Array(NB)
  for (let k = 0; k < K; k++) lev[k] = heard[bandOf[k]] ? Math.exp(lc[bandOf[k]]) : 0
  let Ya = zeros(NB), Za = zeros(NB), Zpk = zeros(NB), cr = zeros(NB), ci = zeros(NB), cyy = zeros(NB), chh = zeros(NB)
  let Zmn = zeros(NB), Ys = zeros(NB), Zs = zeros(NB), Yd = zeros(NB), Ed = zeros(NB), Yg = 0, Zg = 0, Gs = 0, Gmn = Infinity, ng = 0, ns = 0
  let ac = 1 - 1 / COH, as = 1 - 1 / SM, pk = 10 ** (-PEAK * B / fs / 10), ad = Math.exp(-B / fs / DIV_T), ag = Math.exp(-B / fs / HOLD), up = 10 ** (RISE_T * B / fs / 10)

  // per source: its last 2B samples, the spectra of its last P frames, its power past the span; per source and
  // partition: W and its variance Pw
  let xb = arr(C, () => zeros(M)), T = arr(C, () => zeros(K))
  let Xr = arr(C, () => arr(P, () => zeros(K))), Xi = arr(C, () => arr(P, () => zeros(K)))
  let Wr = learned ? copy(learned.Wr) : arr(C, () => arr(P, () => zeros(K))), Wi = learned ? copy(learned.Wi) : arr(C, () => arr(P, () => zeros(K)))
  let Pw = learned ? copy(learned.Pw) : arr(C, () => arr(P, () => zeros(K)))
  let head = 0, blocks = 0
  // the stream's gate per band: the power the prediction takes, its spread, their weights; the prediction's spectrum
  let open = new Uint8Array(NB), gd = zeros(NB), gv = zeros(NB), gn = zeros(NB), ag2 = Math.exp(-B / fs / GATE_T)
  let Pr = zeros(K), Pi = zeros(K), Rm = zeros(K)

  let Yr = zeros(K), Yi = zeros(K), Er = zeros(K), Ei = zeros(K), Ps = zeros(K), Phi = zeros(K), R = zeros(K)
  let Y0 = zeros(K), Z = zeros(K), t = zeros(M), sp = [zeros(K), zeros(K)], sy = [zeros(K), zeros(K)], sh = [zeros(K), zeros(K)]
  let at = (p) => (head - p + P) % P

  // the spectrum of [0, x]: a block in the filter's terms (B samples, zero-padded in front)
  let front = (x, out) => { for (let n = 0; n < B; n++) { t[n] = 0; t[B + n] = x[n] } fft(t, out) }

  // a band's new level: each prior variance replaced, the data's precision kept (zero prior mean), so the posterior
  // mean scales with it: a level coming down takes what was learned under the looser prior down with it
  let relevel = (b, v) => {
    let [a, z] = bands[b]
    for (let k = a; k < z; k++) {
      for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
        let c0 = lev[k] * dp[p], c1 = v * dp[p], pw = Pw[c][p][k]
        if (!(c0 > 0 && pw > 0)) { Pw[c][p][k] = c1; continue }
        let pn = 1 / (Math.max(1 / pw - 1 / c0, 0) + 1 / c1), f = pn / pw
        Pw[c][p][k] = pn; Wr[c][p][k] *= f; Wi[c][p][k] *= f
      }
      lev[k] = v
    }
  }

  return {
    state: () => ({ lc, ws, heard, Wr, Wi, Pw }),

    // the sources' new frame (the oldest leaves the span for the tail); W⁺ = A·W, P⁺ = A²·P + (1 − A²)·prior: W
    // stationary AR(1) of the prior's variance
    hear(x) {
      head = (head + 1) % P
      for (let c = 0; c < C; c++) {
        let b = xb[c], tc = T[c], xr = Xr[c][head], xi = Xi[c][head]
        for (let k = 0; k < K; k++) tc[k] = rho * (tc[k] + dp[P - 1] * (xr[k] * xr[k] + xi[k] * xi[k]))
        b.copyWithin(0, B); b.set(x[c], B)
        fft(b, sp); xr.set(sp[0]); xi.set(sp[1])
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
      if (gated) { Pr.set(Yr); Pi.set(Yi) }
      ifft(Yr, Yi, t)
      out.set(t.subarray(B))
    },

    // the prediction in the open bands alone, and the residual's power there (exact zeros while none is open)
    shown(out, R) {
      let any = false
      for (let k = 0; k < K; k++) { let on = open[bandOf[k]]; any ||= on; Yr[k] = on ? Pr[k] : 0; Yi[k] = on ? Pi[k] : 0; Rm[k] = on ? R[k] : 0 }
      if (!any) { out.fill(0); return Rm }
      ifft(Yr, Yi, t); out.set(t.subarray(B))
      return Rm
    },

    // the level per band: the mic's power coherent with the prediction `yh`, over the sources' power through the
    // decay, at most the mic's whole power over the sources' (the last HOLD s)
    learn(y, yh) {
      // the sources' power through the decay, Σ_p ρ^p |X_{l−p}|², the span and the tail together
      for (let k = 0; k < K; k++) { let v = 0; for (let c = 0; c < C; c++) v += Xr[c][head][k] ** 2 + Xi[c][head][k] ** 2; Z[k] = rho * Z[k] + v }
      front(y, sy); front(yh, sh)
      // the bound: the mic's power over the sources' through the decay, in the blocks they sound in (RISE over their
      // least: a track's own noise before it plays says nothing of the path)
      let gy = 0, gz = 0
      for (let k = 0; k < K; k++) { Y0[k] = sy[0][k] ** 2 + sy[1][k] ** 2; gy += Y0[k]; gz += r * Z[k] }
      Gs = as * Gs + (1 - as) * gz; Gmn = ++ng <= SM ? Infinity : Math.min(Gmn * up, Gs)
      if (Gs > RISE * Gmn) { let g = Math.min(1 - 1 / ++ns, ag); Yg = g * Yg + (1 - g) * gy; Zg = g * Zg + (1 - g) * gz }
      let lMax = Zg > 0 ? Math.log(Yg / Zg) : Infinity
      for (let b = 0; b < NB; b++) {
        let [a, z] = bands[b], xr = 0, xi = 0, yy = 0, hh = 0, zs = 0
        for (let k = a; k < z; k++) {
          let yr = sy[0][k], yi = sy[1][k], hr = sh[0][k], hi = sh[1][k]
          xr += yr * hr + yi * hi; xi += yi * hr - yr * hi; yy += Y0[k]; hh += hr * hr + hi * hi
          zs += r * Z[k]
        }
        cr[b] = ac * cr[b] + (1 - ac) * xr; ci[b] = ac * ci[b] + (1 - ac) * xi; cyy[b] = ac * cyy[b] + (1 - ac) * yy; chh[b] = ac * chh[b] + (1 - ac) * hh
        Ya[b] = as * Ya[b] + (1 - as) * yy; Za[b] = as * Za[b] + (1 - as) * zs; Zpk[b] = Math.max(Za[b], pk * Zpk[b])
        if (gated && Za[b] > VALID * Zpk[b]) {
          // the stream's gate: the power the prediction (made before the block was heard) takes off the mic, Σ|Y|² −
          // Σ|Y − H|² = Σ 2·Re(Y·H*) − |H|², weighed over GATE_T, against its spread (the cross term's about what the
          // prediction leaves, Σ 2|Y − H|²|H|² a block, 2× for the bins of a frame zero-padded 2×): a band opens ZG
          // spreads up, closes once the prediction takes nothing
          let d = 0, v = 0
          for (let k = a; k < z; k++) {
            let er = sy[0][k] - sh[0][k], ei = sy[1][k] - sh[1][k], e2 = er * er + ei * ei
            d += Y0[k] - e2; v += 4 * e2 * (sh[0][k] ** 2 + sh[1][k] ** 2)
          }
          let g = Math.min(1 - 1 / ++gn[b], ag2); gd[b] = g * gd[b] + (1 - g) * d; gv[b] = g * g * gv[b] + (1 - g) * (1 - g) * v
          let zt = gv[b] > 0 ? gd[b] / Math.sqrt(gv[b]) : 0
          if (zt > ZG) open[b] = 1
          else if (!(zt > 0)) open[b] = 0
        }
        if (learned) continue
        // the band's least power (once smoothed), rising back RISE_T; the source sounds here once RISE over it
        Zmn[b] = ng <= SM ? Infinity : Math.min(Zmn[b] * up, Za[b])
        if (!heard[b] && !(Za[b] > RISE * Zmn[b])) continue
        if (!(Za[b] > VALID * Zpk[b]) || !(Ya[b] > 0)) continue
        // its first span here: the most the path can be, all the mic's energy over it from the source's (the bleed
        // of the span's first frames arrives within it)
        if (heard[b]++ < P) {
          Ys[b] += yy; Zs[b] += zs
          relevel(b, Math.exp(lc[b] = Math.min(lMax, Math.log(Ys[b] / Zs[b]))))
          continue
        }
        if (!(chh[b] > 0)) continue
        // magnitude-squared coherence less its bias over (2/(1 − ac) − 1)·bins independent looks (Carter 1973)
        let m0 = (1 - ac) / (1 + ac) / (z - a), msc = Math.max(0, ((cr[b] ** 2 + ci[b] ** 2) / (cyy[b] * chh[b]) - m0) / (1 - m0))
        let w = Math.max(msc * msc, W_MIN)
        ws[b] += w
        lc[b] = Math.min(lMax, lc[b] + Math.max(w / ws[b], STEP * w) * (Math.log(Math.max(msc, MSC_MIN) * Ya[b] / Za[b]) - lc[b]))
        relevel(b, Math.exp(lc[b]))
      }
    },

    // the error e = y − prediction: the residual's power (the filter's uncertainty and the tail past it), the wanted
    // sound's (the error less it, smoothed), the Kalman update (diagonal, Enzner & Vary 2006), each partition's
    // gradient held to B taps; the divergence check; → the residual's power
    update(e, y) {
      front(e, sp); Er.set(sp[0]); Ei.set(sp[1])
      Phi.fill(0)
      for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
        let q = at(p), xr = Xr[c][q], xi = Xi[c][q], pw = Pw[c][p]
        for (let k = 0; k < K; k++) Phi[k] += (xr[k] * xr[k] + xi[k] * xi[k]) * pw[k]
      }
      let first = !blocks++
      for (let k = 0; k < K; k++) {
        let tl = 0; for (let c = 0; c < C; c++) tl += T[c][k]
        R[k] = r * (Phi[k] + lev[k] * tl)
        let v = Math.max(Er[k] * Er[k] + Ei[k] * Ei[k] - R[k], 0)
        Ps[k] = first ? v : BETA * Ps[k] + (1 - BETA) * v
      }
      for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
        let q = at(p), xr = Xr[c][q], xi = Xi[c][q], wr = Wr[c][p], wi = Wi[c][p], pw = Pw[c][p], [ur, ui] = sp
        for (let k = 0; k < K; k++) {
          let x2 = xr[k] * xr[k] + xi[k] * xi[k], d = Phi[k] + Ps[k] / r, mu = d > 0 ? pw[k] / d : 0
          ur[k] = wr[k] + mu * (xr[k] * Er[k] + xi[k] * Ei[k]); ui[k] = wi[k] + mu * (xr[k] * Ei[k] - xi[k] * Er[k])
          pw[k] *= 1 - INFO * r * mu * x2
        }
        ifft(ur, ui, t); t.fill(0, B); fft(t, sp); wr.set(sp[0]); wi.set(sp[1])
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
