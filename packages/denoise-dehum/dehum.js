// Mains hum removal: the hum measured, then subtracted.
//
// Mains hum is a few sinusoids at the harmonics of the mains frequency, each holding its level for seconds; buzz (a
// rectifier's pulses, a ground loop) carries them to several kHz. A voice or an instrument passes through those
// frequencies and moves on. A notch can't tell the two apart: it takes whatever its band holds and rings on it; narrow,
// it misses the upper harmonics as the mains frequency wanders (h times the wander at harmonic h). So dehum follows
// the mains phase, estimates each harmonic as a slowly varying phasor along it, and subtracts the sinusoids they
// describe (harmonic subtraction, as power-line interference is taken out of ECG: Levkov et al., BioMed Eng OnLine
// 4:50, 2005):
//
//   1. detect    the series, 50 or 60 Hz: measure() (one transform over the signal), or two lines or more standing
//                out alone in a tracked analysis of the band to 1 kHz (detect()), counting only lines that persist
//                where the program falls silent (persists(): a note held on a line goes quiet with the music, hum
//                does not); in a take with no such pause, no series the program's own comb runs through (a pattern
//                it repeats every whole number of mains periods: a kick at 200 bpm, every 15 at 50 Hz, 18 at 60);
//                no hum, no change.
//   2. track     the mains phase θ: first from the harmonics to 1 kHz at the nominal frequency (each harmonic's
//                phasor per Hann frame four cycles long, fitted over T, their turn combined over 8 s), then the signal
//                resampled so that the tracked mains period spans P = 2^k samples (computed order tracking: Fyfe &
//                Munck, MSSP 11(2), 1997) and θ refined from the turn between frames of the harmonics whose lines stand
//                out alone (to 16, 64, … 8 kHz), each by its precision (the line's power over the program's there),
//                smoothed by Rauch–Tung–Striebel at the likeliest rate of wander, kept if it draws the lines tighter.
//                In the resampled signal each harmonic sits on one bin of a P-point transform of each frame, however
//                the mains wander: one transform gives them all.
//   3. lines     which harmonics hold hum: those to 1 kHz, and above them each whose line stands out of the program
//                (lineSNR: its weighted phasors' power at 0 Hz over their median 0.5–8 Hz away, in 8 s blocks); of
//                them, those that persist where the program falls silent.
//   4. changes   where the hum itself jumps (an edit's splice turns its phase, a level step, hum switched on or off):
//                every line's phasors before and after a frame differ beyond their spread at once (changes()). The
//                tracking does not integrate across a jump, each segment is estimated alone, and the hum switches
//                from one segment's to the next at the sample that best splits the signal between them.
//   5. estimate  each line's phasors fitted over T by weighted local-linear least squares within its segment
//                (normalized convolution, Knutsson & Westin, CVPR 1993), each frame weighted by the inverse of the
//                program's power around the line there, and kept within HOLD (30 %) of the hum bridged through the
//                program (bridge(): a random walk smoothed by Rauch–Tung–Striebel over the line's phasors with the
//                tones beside it taken out, its rate the likeliest of a slow few: hum drifts over seconds). Where the
//                program is loud and steady around a line (a dense mix), the fit takes it in and the bridge does not:
//                faint hum under music no longer costs the music more than the hum it removes.
//   6. subtract  Σ_h Re(a_h·e^(j2πhi/P)) per frame of the resampled signal, blended between frame centres, brought
//                back to the original samples (Kaiser-windowed sinc) and subtracted.
//
// What it takes of the program is what lies within a fraction of a hertz of a line, mostly from where the program is
// quiet around it; a note held within ~0.5 Hz of a line for seconds goes with the hum.
//
//   freq       fundamental, Hz; omitted (or 0): the 50 or 60 Hz series, whichever is found. Given: that series, its
//              exact frequency tracked from there (measure() within ±0.4 %, or ±drift Hz when adaptive).
//   harmonics  remove h = 1..harmonics as told; omitted (or 0): those to 1 kHz and every line above to 8 kHz.
//   steady     the hum held through the take (a buzz under an instrument, no edit): steady() in place of steps 3–5.
//
// Returns the same buffer, processed in place. One call takes the whole signal: the estimate looks seconds either
// side, the detection wants a second at least. Shorter, nothing is detected: without `freq` the audio passes through,
// with it the harmonics are removed as told.

import { cascade, lowpass } from '@audio/biquad'

const MIN = 1, FMAX = 1000, BAND = 0.4                     // s; Hz first tracked on; at most this share of fs
const CYCLES = 2, T = 2, TR = 0.1, TT = 8, KAPPA = 0.01      // hop (cycles); fit, weights, tracking (s); weight floor
const DF = 0.01                                              // Hz: f0 found further off is estimated again
const TMAX = 8000                                            // Hz: the band tracked and removed unless told
const RATES = [0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3] // Hz/√s: the mains' wander, the likeliest of these
const SCALES = [1, 4, 16, 64, 256]                           // the turns' noise, of what their precision says
const LB = 8, LINE = 18, ISO = 6, FLOOR = 1e-4, QUIET = 1e-6 // a line: blocks (s), dB over the median, over its neighbours; floor; level
const KC = 0.5, CHG = 15, SHARE = 0.9                        // a change: span each side (s), power per line, the most one line holds
const RHO = [1e-6, 1e-5, 1e-4], HOLD = 0.3                   // the bridge's walk per frame (of the line's power); the fit kept within
const COMB = 0.25                                            // a pattern repeated: a quarter of its teeth over chance
const LINE_S = 10, HELD = 2                                  // steady: a held line's power over its variance, at least; over its power where the program falls silent, at most

export default function dehum(data, params = {}) {
  if (!data?.length) return data
  let fs = params.fs || 44100, freq = params.freq || 0, harmonics = params.harmonics || 0, short = data.length < MIN * fs
  let tol = freq && params.adaptive ? (params.drift ?? 0.5) / freq : 0.004
  let found = !short && detect(data, fs, freq ? [freq] : [50, 60], tol), f0 = found ? found.f0 : (short || harmonics) && freq
  if (f0) remove(data, fs, f0, Math.floor((harmonics ? Math.min(harmonics * f0, BAND * fs) : Math.min(TMAX, BAND * fs)) / f0), harmonics > 0, found || null, !!params.steady)
  return data
}

// The series and whether there is hum: measure() (one transform over the signal) finds it, or a tracked analysis
// does: the signal to 1 kHz (taken down to ~3 kHz as measure() does), tracked along each candidate series, two lines or
// more among its first 20 harmonics that stand out (lineSNR over LINE), are heard at all (60 dB under the signal at
// most) and stand alone (ISO over any other peak within 3 Hz), a third of those standing out at least (a bar repeated
// exactly is a comb of lines 1/bar apart, few alone): hum under music, whose lines are too faint against the program
// over the whole signal for measure(). Where the take has no pause to hear its lines persist in (persists()), a series
// on the program's own comb (comb(): a quarter of its teeth to 1 kHz over chance) is the program's: its lines can't be
// told from the pattern's, and a struck tone rings over its neighbouring teeth as hum stands over them. The series:
// measure()'s, else the one with the most lines. Returns its fundamental, as the tracking found it, and the tracked
// phase (knots in samples of the data), or null
function detect(data, fs, candidates, tol) {
  let M = Math.max(1, Math.floor(fs / 3000)), fd = fs / M, x = Float32Array.from(data, v => Number.isFinite(v) ? v : 0)
  if (M > 1) {
    cascade(x, [0.5098, 0.6013, 0.9, 2.5629].map(q => lowpass(1100, q, fs)))   // Butterworth pole pairs, order 8
    x = Float32Array.from({ length: Math.floor(x.length / M) }, (_, i) => x[i * M])
  }
  let pw = 0
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i])) pw += data[i] * data[i]
  pw /= data.length
  let s = look(data, fs), known = find(s, candidates, tol), best = null
  for (let f of known ? [known.f0, ...candidates.filter(c => Math.abs(c - known.f0) > 5)] : candidates) {
    let t = trace(x, fd, f, Math.min(20, Math.floor(1100 / f), Math.floor(fd / 2 / f) - 1))
    if (!t) continue
    let n = 0, all = 0, sum = 0, ls = lines(t.an, t.fr, []), held = persists(t.an, t.fr), sure = known && f === known.f0
    if (!held && s.comb(t.f0) >= COMB) continue                    // no pause to hear it in, and the program's own comb
    ls.forEach((l, i) => { if (l.snr >= LINE && l.amp / 2 >= QUIET * pw && (!held || held[i])) { all++; if (l.iso >= ISO) n++, sum += l.snr } })
    if ((sure ? all >= 1 : n >= 2 && 3 * n >= all) && (!best || n > best.n || n === best.n && sum > best.sum)) best = { f0: t.f0, n, sum, tk: t.tk.map(v => v * M), th: t.th }
    if (best && sure) break
  }
  return best
}

// The mains phase tracked through x and each harmonic's phasors along it. Tracked first on the harmonics to 1 kHz at
// the nominal frequency (where the tracked phase turns on average, f0 is off: estimated again at f0 moved by that
// turn, up to four times); then x is resampled so that the tracked mains period spans P = 2^k samples (computed order
// tracking: Fyfe & Munck, MSSP 11(2), 1997), where every harmonic, however the mains wander, sits on one bin of a
// P-point transform, and the phase is refined from the turn between frames of the harmonics to 16, 64, … 8 kHz whose
// lines stand out alone (lineSNR: a partial beside a line turns it with the program), each refinement kept if the
// lines' coherent power (lineSNR's amp, summed) grows. `from`: a phase tracked already ({ tk, th }: detect()'s, on
// the signal taken down), refined from there. Returns { xs, an, w, P, fr, hm, f0, tk, th } or null under two frames
function trace(x, fs, f0, hmax, from) {
  let tk, th
  if (from) tk = Float64Array.from(from.tk), th = Float64Array.from(from.th)
  else {
    let lo = []
    for (let h = 1; h <= Math.min(hmax, Math.floor(FMAX / f0)); h++) lo.push(h)
    let H = Math.round(CYCLES * fs / f0), e = estimate(x, fs, f0, lo, H)
    for (let it = 0; e && it < 4 && Math.abs(e.df) > DF; it++) e = estimate(x, fs, f0 += e.df, lo, H)
    if (!e) return null
    let w0 = 2 * Math.PI * f0 / fs, M = e.delta.length
    tk = new Float64Array(M), th = new Float64Array(M)
    for (let m = 0; m < M; m++) tk[m] = m * H + H - (H >> 1) - 0.5, th[m] = w0 * tk[m] + e.delta[m]
  }
  let P = 2 ** Math.ceil(Math.log2(fs / f0)), fr = f0 / CYCLES, hm = Math.min(hmax, P / 2 - 1), w, an
  let xs = Float64Array.from(x, v => Number.isFinite(v) ? v : 0)
  let ht = Math.min(hm, Math.max(1, Math.floor(TMAX / f0)))
  let ls = (an, H) => Array.from({ length: H }, (_, i) => lineSNR(an.c[i], weights(an, i, an.full, 'L', fr).w, fr))
  let held = l => l.reduce((q, l) => q + l.amp, 0)
  w = warpAt(x.length, tk, th, P); an = analyse(warp(xs, w.k), P, hm)
  for (let hn = from ? 64 : 16; ; hn *= 4) {                        // the turn, coarse to fine: harmonics to 16, 64, … TMAX
    let H = Math.min(hn, ht), l0 = ls(an, H), use = l0.map(l => l.snr >= LINE && l.iso >= ISO)
    if (use.some(Boolean)) {
      let [tk1, th1] = knots(w, P, turns(an, fr, H, [], use)), w1 = warpAt(x.length, tk1, th1, P), an1 = analyse(warp(xs, w1.k), P, hm)
      if (held(ls(an1, H)) >= held(l0)) tk = tk1, th = th1, w = w1, an = an1   // kept if it holds the lines tighter
    }
    if (hn >= ht) break
  }
  return { xs, an, w, P, fr, hm, f0, tk, th }
}

// remove the hum at harmonics 1..hmax of f0 from x, in place: those to FMAX (mains hum is there when there is hum)
// and above them the lines that stand out (all of them when `told`), estimated between the hum's jumps (changes())
// and subtracted
function remove(x, fs, f0, hmax, told, from, still) {
  let t = trace(x, fs, f0, hmax, from)
  if (!t) return
  if (still) return steady(x, t, f0, told)
  let { xs, an, w, P, fr, hm, tk, th } = t, all = an.c.map(() => true), pick = ls => ls.map((l, i) => (i + 1) * f0 <= FMAX || l.snr >= LINE)
  let held = told ? all : persists(an, fr) || all, on = told ? all : pick(lines(an, fr, [])).map((v, i) => v && held[i])
  if (!on.some(Boolean)) return
  let cut = changes(an, fr, on)
  if (cut.length) {                                                 // the turn again, not across the hum's jumps
    ;[tk, th] = knots(w, P, turns(an, fr, Math.min(hm, Math.floor(TMAX / f0)), cut, on))
    w = warpAt(x.length, tk, th, P); an = analyse(warp(xs, w.k), P, hm)
    if (!told) on = pick(lines(an, fr, cut)).map((v, i) => v && held[i])
  }
  let y = humOf(xs, an, w.k, P, fr, on, cut)
  for (let n = 0; n < x.length; n++) if (Number.isFinite(x[n])) x[n] -= y[n]
}

// the frames each segment holds between the hum's jumps (cut: the first of the two frames each jump straddles), and a
// frame mask per segment (whole frames only)
function segments(full, cut) {
  let M = full.length, out = [], a = 0
  for (let m of [...cut, M]) {
    let mask = new Float64Array(M), b = Math.min(m, M)
    for (let j = a; j < b; j++) mask[j] = full[j]
    if (b > a) out.push({ a, b, mask })
    a = m + 2
  }
  return out
}

// how far each harmonic's line stands out (lineSNR over the frames clear of the jumps): [{ snr, iso }]
function lines(an, fr, cut) {
  let { c, full, M } = an
  let g = hann(T * fr), gr = hann(TR * fr), lin = M >= g.length, mask = Float64Array.from(full)
  for (let m of cut) mask[m] = mask[m + 1] = 0
  return c.map((ck, i) => lineSNR(ck, weights(an, i, mask, cut.join() + 'L', fr).w, fr))
}

// Which lines persist where the program falls silent: mains hum is there in a take's pauses and room tone as under its
// loudest passage; a note's line goes quiet with the music. The frames where the program around the first 20
// harmonics (their fits' residual) is 20 dB under its median, half a second of them at least: each line's fitted
// power there against over the whole take, a tenth at least. A line that holds a note as well as hum fails too: what
// would go with it is more music than hum. A take with no such frames tells nothing: null
function persists(an, fr) {
  let { c, full, M } = an, H = c.length, L = new Float64Array(M), a = c.map((_, i) => weights(an, i, full, 'L', fr).a)
  for (let i = 0; i < Math.min(H, 20); i++) for (let m = 0; m < M; m++) L[m] += (c[i][0][m] - a[i][0][m]) ** 2 + (c[i][1][m] - a[i][1][m]) ** 2
  let v = Array.from(L).filter((_, m) => full[m]).sort((p, q) => p - q), med = v[v.length >> 1] || 0
  let quiet = Array.from({ length: M }, (_, m) => full[m] && L[m] <= 0.01 * med), nq = quiet.filter(Boolean).length
  if (nq < 0.5 * fr) return null
  return a.map(([ar, ai]) => {
    let pq = 0, pa = 0, na = 0
    for (let m = 0; m < M; m++) if (full[m]) { let p = ar[m] ** 2 + ai[m] ** 2; pa += p; na++; if (quiet[m]) pq += p }
    return pq / nq >= 0.1 * pa / na
  })
}

// where the hum itself changes: an edit's splice (its phase jumps), a level step, a hum switched on or off. At each
// frame, each line's phasors averaged over KC before it and after the frame after it (the two frames a change may
// straddle left out), their difference over its spread, summed over the lines: under a steady hum about one per line,
// at a change its power over the noise. A change: a local maximum over CHG per line, spread over the lines (no single
// line holding half of it: a note beside one line moves that line alone), KC apart at least
function changes(an, fr, on) {
  let { c, full, M } = an
  let g = hann(T * fr), gr = hann(TR * fr), lin = M >= g.length, K = Math.max(2, Math.round(KC * fr)), hs = []
  on.forEach((v, i) => v && hs.push(i))
  if (!hs.length || M < 2 * K + 2) return []
  let C = new Float64Array(M), big = new Float64Array(M)
  for (let i of hs) {
    let [cr, ci] = c[i], w = weights(an, i, full, 'L', fr).w, sw = new Float64Array(M + 1), sr = new Float64Array(M + 1), si = new Float64Array(M + 1)
    for (let m = 0; m < M; m++) sw[m + 1] = sw[m] + w[m], sr[m + 1] = sr[m] + w[m] * cr[m], si[m + 1] = si[m] + w[m] * ci[m]
    for (let m = K; m + K + 2 <= M; m++) {
      let wl = sw[m] - sw[m - K], wr = sw[m + K + 2] - sw[m + 2]
      if (!(wl > 0 && wr > 0)) continue
      let dr = (sr[m + K + 2] - sr[m + 2]) / wr - (sr[m] - sr[m - K]) / wl, di = (si[m + K + 2] - si[m + 2]) / wr - (si[m] - si[m - K]) / wl
      let q = (dr * dr + di * di) / (1 / wl + 1 / wr)
      C[m] += q; big[m] = Math.max(big[m], q)
    }
  }
  let n = hs.length, out = []
  for (let m = K; m + K + 2 <= M; m++) {
    if (C[m] < CHG * n || big[m] > SHARE * C[m]) continue
    let peak = true
    for (let j = Math.max(0, m - K); j <= Math.min(M - 1, m + K); j++) if (C[j] > C[m]) peak = false
    if (peak && (!out.length || m - out[out.length - 1] >= K)) out.push(m)
  }
  return out
}

// the hum on the original samples: each segment's lines fitted on its own frames (held past its ends), synthesized in
// the warped signal and brought back; between two segments, the switch at the sample that best splits the signal into
// the hum before and the hum after (least squares, over the frames the jump straddles)
function humOf(xs, an, k, P, fr, on, cut, held = null) {
  let { c, M, K } = an, N = k.length, y = new Float64Array(N), g = hann(T * fr), gr = hann(TR * fr), lin = M >= g.length, prev = null
  let sample = kw => { let lo = 0, hi = N; while (lo < hi) { let mid = (lo + hi) >> 1; if (k[mid] < kw) lo = mid + 1; else hi = mid } return lo }
  for (let s of segments(an.full, cut)) {
    let a = held || c.map((ck, i) => {
      if (!on[i]) return null
      let w = weights(an, i, s.mask, cut.length ? `S${s.a}` : 'L', fr).w, f = fit(ck, w, g, lin), b = bridge(untone(ck, s.mask, fr), w, s.mask)
      for (let m = 0; m < M; m++) {                                  // the fit, kept within HOLD of the bridge
        let dr = f[0][m] - b[0][m], di = f[1][m] - b[1][m], d = Math.hypot(dr, di), t = HOLD * Math.hypot(b[0][m], b[1][m]), q = d > t ? t / d : 1
        f[0][m] = b[0][m] + q * dr; f[1][m] = b[1][m] + q * di
      }
      for (let m = 0; m < M; m++) { let j = Math.min(Math.max(m, s.a), s.b - 1); if (m !== j) f[0][m] = f[0][j], f[1][m] = f[1][j] }
      return f
    })
    let k0 = Math.max(-PAD, (2 * (s.a - 2) + 1) * P), k1 = Math.min(K + PAD, (2 * (s.b + 2) + 1) * P), hw = synth(a, M, P, k0, k1)
    let n0 = sample(k0), n1 = sample(k1), h = new Float64Array(n1 - n0)
    for (let n = n0; n < n1; n++) h[n - n0] = at(hw, k[n] - k0 + PAD)
    let start = n0
    if (prev) {                                                      // the switch, within the frames the jump straddles
      let m = s.a - 2, lo = Math.max(n0, sample((2 * m + 1) * P - P)), hi = Math.min(prev.n1, sample((2 * m + 3) * P + P))
      let cost = 0, best = lo, bc = Infinity
      for (let n = lo; n < hi; n++) cost += (xs[n] - h[n - n0]) ** 2
      for (let n = lo; n <= hi; n++) {
        if (cost < bc) bc = cost, best = n
        if (n < hi) cost += (xs[n] - prev.h[n - prev.n0]) ** 2 - (xs[n] - h[n - n0]) ** 2
      }
      start = best
    }
    for (let n = start; n < n1; n++) y[n] = h[n - n0]
    prev = { n0, n1, h }
  }
  return y
}

// A steady hum: a buzz under a take, no edit in it, each line one phasor through the take. A fit over T takes in what
// the program puts near a line for seconds (a guitar's partials, its chords' attacks read as the hum's jumps: on
// GuitarSet takes under a buzz 35 dB down, 0.5.2 took the guitar to 39 dB SDR and the buzz 4 dB down); a phasor held
// over the take, weighted to where the program is quiet around the line, takes a partial in only as far as it stays on
// the line. Held, the lines show the mains phase's error frame by frame against them, all at once (against()), as the
// turns between frames do not (a line's turn is two frames' noise, and only lines standing out alone are read): from
// the trace, the phase refined against the comb held to harmonics 2, 4, … 64 and to TMAX twice, each step holding the
// higher lines tighter. Subtracted: the lines whose held phasor stands LINE_S over its spread (snr) and holds at most
// HELD times the line's power where the program falls silent (a note on a line rings into its held phasor, the take's
// silence does not hold it); each frame's by its expected coherence, e^(−h²σ²/2), σ² the phase's variance there (the
// smoother's): where the program masked the hum and the phase is bridged, the upper lines go less, never added.
function steady(x, { xs, an, w, P, fr, hm }, f0, told) {
  let ht = Math.min(hm, Math.max(1, Math.floor(TMAX / f0))), gr = hann(TR * fr), vr = null
  let comb = an => an.c.map((ck, i) => i < ht ? hold(ck, an.full, gr) : null), C = comb(an)
  for (let H of [...[2, 4, 8, 16, 32, 64].filter(h => h < ht), ht, ht]) {
    let r = against(an, C, H, fr), [tk, th] = knots(w, P, r.out)
    w = warpAt(x.length, tk, th, P); an = analyse(warp(xs, w.k), P, hm); C = comb(an); vr = r.vr
  }
  let quiet = told ? null : silent(an, C, fr), on = C.map((q, i) => !!q && (told || q.snr >= LINE_S && (!quiet || q.a[0] ** 2 + q.a[1] ** 2 <= HELD * line(an, i, quiet))))
  if (!on.some(Boolean)) return
  let { M } = an, s2 = m => Math.min(vr[Math.min(m, vr.length - 1)], 1e3)
  let a = C.map((q, i) => on[i] ? [0, 1].map(j => Float64Array.from({ length: M }, (_, m) => q.a[j] * Math.exp(-0.5 * (i + 1) ** 2 * s2(m)))) : null)
  let y = humOf(xs, an, w.k, P, fr, on, [], a)
  for (let n = 0; n < x.length; n++) if (Number.isFinite(x[n])) x[n] -= y[n]
}

// the frames where the program falls silent around the first 20 lines (their held residual, 1/w less KAPPA of the
// line, summed, 20 dB under its median), as persists() reads them, or null under half a second of them
function silent({ full, M }, C, fr) {
  let L = new Float64Array(M), n = 0
  for (let i = 0; i < Math.min(C.length, 20); i++) { let q = C[i]; if (q) for (let m = 0; m < M; m++) if (full[m]) L[m] += 1 / q.w[m] }
  let v = Array.from(L).filter((_, m) => full[m]).sort((p, q) => p - q), med = v[v.length >> 1] || 0
  let quiet = Uint8Array.from(L, (l, m) => full[m] && l <= 0.01 * med ? (n++, 1) : 0)
  return n >= 0.5 * fr ? quiet : null
}
// a line's mean power over those frames
const line = ({ c, M }, i, quiet) => { let s = 0, n = 0; for (let m = 0; m < M; m++) if (quiet[m]) s += c[i][0][m] ** 2 + c[i][1][m] ** 2, n++; return s / n }

// a line's phasor held through the take: its weighted mean, each frame weighted by the inverse of the program's power
// around the line there, plus KAPPA of the line's: first the line's own power over TR (where it is quietest, the hum
// stands alone), then three times the misfit of its magnitude to the held one's, over TR (the program's power, read
// from the magnitude: a phase still wrong is no program). { a: [re, im], w, snr }, snr the held phasor's power over its
// variance (1/Σw); null where no frame counts
function hold([cr, ci], mask, gr) {
  let M = cr.length, e = Float64Array.from({ length: M }, (_, m) => cr[m] * cr[m] + ci[m] * ci[m]), r = smooth(e, gr)
  let w = Float64Array.from(r, (v, m) => mask[m] / (v + 1e-30)), ar = 0, ai = 0, sw = 0
  for (let it = 0; it < 4; it++) {
    sw = ar = ai = 0
    for (let m = 0; m < M; m++) if (mask[m]) sw += w[m], ar += w[m] * cr[m], ai += w[m] * ci[m]
    if (!(sw > 0)) return null
    ar /= sw; ai /= sw
    if (it === 3) break
    let p = ar * ar + ai * ai, pa = Math.sqrt(p)
    for (let m = 0; m < M; m++) e[m] = (Math.hypot(cr[m], ci[m]) - pa) ** 2
    r = smooth(e, gr)
    for (let m = 0; m < M; m++) w[m] = mask[m] / (r[m] + KAPPA * p + 1e-30)
  }
  return { a: [ar, ai], w, snr: (ar * ar + ai * ai) * sw }
}

// the mains phase's error per frame against the held comb C, harmonics 1..H at once: Newton's steps from 0 on
// Σ_h w_h·Re(c_h·A_h*·e^(−jhε)) (each step within ±0.5/H), its precision 2·Σ_h h²·|A_h|²·w_h; smoothed by RTS at the
// likeliest rate of wander and scale of that precision, as turns() is: { out, vr }
function against({ c, full, M }, C, H, fr) {
  let z = new Float64Array(M), v = new Float64Array(M).fill(Infinity), best
  for (let m = 0; m < M; m++) {
    if (!full[m]) continue
    let e = 0, d2 = 0
    for (let it = 0; it < 4; it++) {
      let d1 = 0; d2 = 0
      for (let i = 0; i < H; i++) {
        let q = C[i]
        if (!q) continue
        let h = i + 1, yr = c[i][0][m] * q.a[0] + c[i][1][m] * q.a[1], yi = c[i][1][m] * q.a[0] - c[i][0][m] * q.a[1]
        let cs = Math.cos(h * e), sn = Math.sin(h * e)
        d1 += q.w[m] * h * (yi * cs - yr * sn); d2 += q.w[m] * h * h * (yr * cs + yi * sn)
      }
      if (!(d2 > 0)) break
      e += Math.max(-0.5 / H, Math.min(0.5 / H, d1 / d2))
    }
    if (d2 > 0) z[m] = e, v[m] = 1 / (2 * d2)
  }
  for (let k of SCALES) for (let rate of RATES) { let r = rts(z, v.map(x => x * k), (2 * Math.PI * rate / fr) ** 2 / fr); if (!best || r.ll > best.ll) best = r }
  return best
}

// A line's phasors without the steady tones beside it: a note held near h·f0 turns the phasor at the difference. In
// blocks of 2 s (hop half), Hann-tapered, each peak of the transform 0.75 Hz or more from the line and 20 dB over the
// median is a sinusoid: its frequency interpolated on the log power, its phasor fitted by least squares over the
// block; the sinusoids overlap-added (the Hann blocks sum to one) and taken out
function untone([re, im], mask, fr) {
  let M = re.length, B = Math.min(M, Math.round(2 * fr)), N = 2 ** Math.ceil(Math.log2(4 * B)), H = Math.max(1, B >> 1)
  let tr = new Float64Array(M), ti = new Float64Array(M), a = new Float64Array(N), b = new Float64Array(N), bin = fr / N, lo = Math.ceil(0.75 / bin)
  let win = Float64Array.from({ length: B }, (_, m) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (m + 0.5) / B))
  for (let s0 = -H; s0 < M; s0 += H) {
    a.fill(0); b.fill(0)
    for (let m = 0; m < B; m++) { let n = s0 + m; if (n >= 0 && n < M && mask[n]) a[m] = win[m] * re[n], b[m] = win[m] * im[n] }
    fft(a, b)
    let P = Float64Array.from({ length: N }, (_, k) => a[k] ** 2 + b[k] ** 2), med = Float64Array.from(P).sort()[N >> 1] || 1e-300
    for (let k = lo; k <= N - lo; k++) {
      let k0 = (k - 1 + N) % N, k1 = (k + 1) % N
      if (!(P[k] > P[k0] && P[k] >= P[k1] && P[k] > 100 * med)) continue
      let la = Math.log(P[k0] || 1e-300), lb = Math.log(P[k]), lc = Math.log(P[k1] || 1e-300), d = la - 2 * lb + lc ? 0.5 * (la - lc) / (la - 2 * lb + lc) : 0
      let w = 2 * Math.PI * (k + Math.max(-0.5, Math.min(0.5, d))) / N, zr = 0, zi = 0, sw = 0   // the tone turns by w per frame
      for (let m = 0; m < B; m++) { let n = s0 + m; if (n < 0 || n >= M || !mask[n]) continue; let cs = Math.cos(w * m), sn = Math.sin(w * m); zr += win[m] * (re[n] * cs + im[n] * sn); zi += win[m] * (im[n] * cs - re[n] * sn); sw += win[m] }
      if (!(sw > 0)) continue
      zr /= sw; zi /= sw
      for (let m = 0; m < B; m++) { let n = s0 + m; if (n < 0 || n >= M) continue; let cs = Math.cos(w * m), sn = Math.sin(w * m); tr[n] += win[m] * (zr * cs - zi * sn); ti[n] += win[m] * (zr * sn + zi * cs) }
    }
  }
  return [Float64Array.from(re, (v, m) => v - tr[m]), Float64Array.from(im, (v, m) => v - ti[m])]
}

// A line's hum bridged through the program: its phasor a random walk (the hum drifts slowly), seen in each frame with
// the program's power there as noise (1/w), smoothed by Rauch–Tung–Striebel, the walk's rate per frame the likeliest of
// RHO (of the line's power). Where the program is quiet around the line it follows the hum; where loud, it carries the
// hum across from both sides instead of taking the program in, as a fit over a fixed window does
function bridge([cr, ci], w, mask) {
  let M = w.length, v = Float64Array.from(w, (x, m) => mask[m] && x > 0 ? 1 / x : Infinity), p = 0, n = 0, best
  for (let m = 0; m < M; m++) if (Number.isFinite(v[m])) p += cr[m] ** 2 + ci[m] ** 2, n++
  p = n ? p / n : 0
  for (let rho of RHO) {
    let q = rho * p + 1e-30, xr = 0, xi = 0, P = Infinity, ll = 0, X = new Float64Array(2 * M), V = new Float64Array(M), Vp = new Float64Array(M)
    for (let m = 0; m < M; m++) {
      P += q; Vp[m] = P
      if (Number.isFinite(v[m])) {
        if (Number.isFinite(P)) { let s = P + v[m], er = cr[m] - xr, ei = ci[m] - xi; ll -= Math.log(s) + (er * er + ei * ei) / s; let k = P / s; xr += k * er; xi += k * ei; P *= v[m] / s }
        else xr = cr[m], xi = ci[m], P = v[m]
      }
      X[2 * m] = xr; X[2 * m + 1] = xi; V[m] = P
    }
    let out = [new Float64Array(M), new Float64Array(M)], ar = xr, ai = xi
    out[0][M - 1] = ar; out[1][M - 1] = ai
    for (let m = M - 2; m >= 0; m--) {
      let G = Number.isFinite(V[m]) && Number.isFinite(Vp[m + 1]) ? V[m] / Vp[m + 1] : 1
      ar = X[2 * m] + G * (ar - X[2 * m]); ai = X[2 * m + 1] + G * (ai - X[2 * m + 1]); out[0][m] = ar; out[1][m] = ai
    }
    if (!best || ll > best.ll) best = { out, ll }
  }
  return best.out
}

// the warped hum over warped samples k0..k1 (PAD more each side) from each frame's phasors a[h][re|im][m] (null: a
// harmonic left alone): Re Σ a_h e^(j2πhi/P) per frame (the transform of conj(a), its real part), blended linearly
// between frame centres
function synth(a, M, P, k0, k1) {
  let re = new Float64Array(P), im = new Float64Array(P), wave = new Array(M)
  let fa = Math.min(M - 1, Math.max(0, Math.floor((k0 - PAD - P) / (2 * P)))), fb = Math.max(fa, Math.min(M - 1, Math.ceil((k1 + PAD - P) / (2 * P))))
  for (let m = fa; m <= fb; m++) {
    re.fill(0); im.fill(0)
    a.forEach((ah, i) => { if (ah) re[i + 1] = ah[0][m], im[i + 1] = -ah[1][m] })
    fft(re, im)
    wave[m] = Float64Array.from(re)
  }
  let y = new Float64Array(k1 - k0 + 2 * PAD)
  for (let i = k0 - PAD; i < k1 + PAD; i++) {
    let u = (i - P) / (2 * P), m = Math.floor(u), l = Math.min(Math.max(m, fa), fb), r = Math.min(Math.max(m + 1, fa), fb), lam = u - m
    let p = ((i % P) + P) % P
    y[i - k0 + PAD] = l === r ? wave[l][p] : (1 - lam) * wave[l][p] + lam * wave[r][p]
  }
  return y
}

// the phase knots after a refinement: each warped frame centre (2m + 1)·P in original time, its phase moved by eps[m]
function knots({ k, t0 }, P, eps) {
  let M = eps.length, tk = [], th = [], n = 0
  for (let m = 0; m < M; m++) {
    let kc = (2 * m + 1) * P
    if (kc > k[k.length - 1]) break
    while (n + 2 < k.length && k[n + 1] <= kc) n++
    tk.push(n + (kc - k[n]) / (k[n + 1] - k[n])); th.push(t0 + 2 * Math.PI * kc / P + eps[m])
  }
  return tk.length < 2 ? [Float64Array.of(0, k.length), Float64Array.of(t0, t0 + 2 * Math.PI * k[k.length - 1] / P)] : [Float64Array.from(tk), Float64Array.from(th)]
}

// the mains phase's error per frame of the warped signal from its turn between frames, harmonics 1..hn, no reference:
// each pair's c_h(m+1)·c_h(m)* holds h times the turn; the turn that best explains them all (Newton's steps from 0 on
// Σ_h q_h·cos(∠ − hν), q_h the angle's precision: the two frames' fitted power over the program's power there, a
// harmonic without hum next to nothing), integrated by the Rauch–Tung–Striebel smoother below. The precisions hold
// only up to a scale (a voice's partial beside a line turns with it, frame after frame), so the scale is chosen with
// the rate of wander: the likeliest pair
function turns({ c, full, M }, fr, H, cut = [], use = null) {
  let g = hann(T * fr), gr = hann(TR * fr), lin = M >= g.length
  let qr = Array.from({ length: H }, () => new Float64Array(M)), qi = Array.from({ length: H }, () => new Float64Array(M))
  for (let i = 0; i < H; i++) {
    if (use && !use[i]) continue
    let ck = c[i], [cr, ci] = ck, { a } = weighFit(ck, full, g, gr, lin), [lr, li] = a, r = residual(ck, a, gr)
    for (let m = 0; m + 1 < M; m++) {
      if (!full[m] || !full[m + 1]) continue
      let pr = cr[m + 1] * cr[m] + ci[m + 1] * ci[m], pi = ci[m + 1] * cr[m] - cr[m + 1] * ci[m]
      let v = 0.5 * (r[m] / (lr[m] ** 2 + li[m] ** 2 + 1e-300) + r[m + 1] / (lr[m + 1] ** 2 + li[m + 1] ** 2 + 1e-300)), s = 1 / ((v + 1e-12) * (Math.hypot(pr, pi) || 1e-300))
      qr[i][m] = s * pr; qi[i][m] = s * pi
    }
  }
  let z = new Float64Array(M), v = new Float64Array(M).fill(Infinity), skip = new Uint8Array(M)
  for (let m of cut) for (let j = m - 1; j <= m + 1; j++) if (j >= 0 && j < M) skip[j] = 1     // pairs into the two frames a jump straddles
  for (let m = 0; m + 1 < M; m++) {
    if (skip[m]) continue
    let e = 0, d2 = 0
    for (let it = 0; it < 3; it++) {
      let d1 = 0; d2 = 0
      for (let i = 0; i < H; i++) { let h = i + 1, cs = Math.cos(h * e), sn = Math.sin(h * e), p = qr[i][m] * cs + qi[i][m] * sn, q = qi[i][m] * cs - qr[i][m] * sn; d1 += h * q; d2 += h * h * p }
      if (!(d2 > 0)) break
      e += Math.max(-0.5, Math.min(0.5, d1 / d2))
    }
    if (d2 > 0) z[m] = e, v[m] = 1 / d2                              // a turn: two frames' noise
  }
  let best
  for (let k of SCALES) for (let rate of RATES) { let r = rts(z, v.map(x => x * k), (2 * Math.PI * rate / fr) ** 2 / fr, true); if (!best || r.ll > best.ll) best = r }
  return best.out
}

// RTS smoother: phase φ and turn ν per frame, φ' = φ + ν, ν' = ν + noise (variance q); z = φ + noise (variance v);
// the smoothed φ and its variance
function rts(z, v, q, turn = false) {
  let M = z.length, X = new Float64Array(2 * M), C = new Float64Array(3 * M), Xp = new Float64Array(2 * M), Cp = new Float64Array(3 * M)
  let x0 = 0, x1 = 0, p00 = 1e2, p01 = 0, p11 = 1e-2, ll = 0
  for (let m = 0; m < M; m++) {
    if (m) { x0 += x1; p00 += 2 * p01 + p11; p01 += p11; p11 += q }
    Xp[2 * m] = x0; Xp[2 * m + 1] = x1; Cp[3 * m] = p00; Cp[3 * m + 1] = p01; Cp[3 * m + 2] = p11
    if (Number.isFinite(v[m]) && turn) {                              // the turn observed
      let s = p11 + v[m], k0 = p01 / s, k1 = p11 / s, r = z[m] - x1
      if (m > 1) ll -= 0.5 * (Math.log(s) + r * r / s)
      x0 += k0 * r; x1 += k1 * r
      ;[p00, p01, p11] = [p00 - k0 * p01, p01 - k0 * p11, (1 - k1) * p11]
    } else if (Number.isFinite(v[m])) {                               // the phase observed
      let s = p00 + v[m], k0 = p00 / s, k1 = p01 / s, r = z[m] - x0
      if (m > 1) ll -= 0.5 * (Math.log(s) + r * r / s)                // the innovations' log-likelihood
      x0 += k0 * r; x1 += k1 * r
      ;[p00, p01, p11] = [(1 - k0) * p00, (1 - k0) * p01, p11 - k1 * p01]
    }
    X[2 * m] = x0; X[2 * m + 1] = x1; C[3 * m] = p00; C[3 * m + 1] = p01; C[3 * m + 2] = p11
  }
  let out = new Float64Array(M), vr = new Float64Array(M), s0 = X[2 * M - 2], s1 = X[2 * M - 1], q00 = C[3 * M - 3], q01 = C[3 * M - 2], q11 = C[3 * M - 1]
  out[M - 1] = s0; vr[M - 1] = q00
  for (let m = M - 2; m >= 0; m--) {
    // gain G = P_m F' (P⁻_{m+1})⁻¹, F = [[1, 1], [0, 1]]
    let a = C[3 * m], b = C[3 * m + 1], d = C[3 * m + 2], pa = Cp[3 * m + 3], pb = Cp[3 * m + 4], pd = Cp[3 * m + 5], det = pa * pd - pb * pb
    let f00 = a + b, f01 = b, f10 = b + d, f11 = d                      // P_m F'
    let i00 = pd / det, i01 = -pb / det, i11 = pa / det
    let g00 = f00 * i00 + f01 * i01, g01 = f00 * i01 + f01 * i11, g10 = f10 * i00 + f11 * i01, g11 = f10 * i01 + f11 * i11
    let e0 = s0 - Xp[2 * m + 2], e1 = s1 - Xp[2 * m + 3]
    s0 = X[2 * m] + g00 * e0 + g01 * e1; s1 = X[2 * m + 1] + g10 * e0 + g11 * e1
    out[m] = s0
    let d00 = q00 - pa, d01 = q01 - pb, d11 = q11 - pd                // the smoothed covariance, P + G(Pₛ − P⁻)G'
    let h00 = g00 * d00 + g01 * d01, h01 = g00 * d01 + g01 * d11, h10 = g10 * d00 + g11 * d01, h11 = g10 * d01 + g11 * d11
    q00 = a + h00 * g00 + h01 * g01; q01 = b + h00 * g10 + h01 * g11; q11 = d + h10 * g10 + h11 * g11
    vr[m] = q00
  }
  return { out, vr, ll }
}

// each harmonic's phasor per frame of the warped signal xw (P samples per mains period): Hann over four periods, hop
// two; folded to one period, one P-point transform gives every harmonic (the window's zeros fall on the others).
// full: 1 for frames whole within the signal (or every frame, renormalized, when under two are)
function analyse(xw, P, hmax) {
  let K = xw.length, M = Math.max(2, Math.floor(K / (2 * P))), N = 4 * P
  let win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N))
  let c = Array.from({ length: hmax }, () => [new Float64Array(M), new Float64Array(M)]), full = new Float64Array(M)
  let re = new Float64Array(P), im = new Float64Array(P)
  for (let m = 0; m < M; m++) {
    let s0 = (2 * m - 1) * P, sum = 0
    re.fill(0); im.fill(0)
    for (let i = 0; i < N; i++) { let n = s0 + i; if (n >= 0 && n < K) re[i % P] += win[i] * xw[n], sum += win[i] }
    full[m] = s0 >= 0 && s0 + N <= K ? 1 : 0
    fft(re, im)
    for (let h = 1; h <= hmax; h++) c[h - 1][0][m] = 2 * re[h] / (sum || 1), c[h - 1][1][m] = 2 * im[h] / (sum || 1)
  }
  if (full.reduce((s, v) => s + v, 0) < 2) full.fill(1)
  return { c, full, M, K }
}

// each sample's place in the warped signal: P samples per turn of the mains phase θ (linear between knots tk, th)
function warpAt(N, tk, th, P) {
  let k = new Float64Array(N), M = tk.length, j = 0, s = P / (2 * Math.PI), t0
  for (let n = 0; n < N; n++) {
    while (j + 2 < M && n > tk[j + 1]) j++
    let t = th[j] + (n - tk[j]) * (th[j + 1] - th[j]) / (tk[j + 1] - tk[j])
    if (!n) t0 = t
    k[n] = s * (t - t0)
  }
  return { k, t0 }
}

// x resampled at the warped grid: sample i at the time n where k(n) = i
function warp(x, k) {
  let K = Math.floor(k[k.length - 1]) + 1, y = new Float64Array(K), n = 0
  for (let i = 0; i < K; i++) {
    while (n + 2 < k.length && k[n + 1] <= i) n++
    y[i] = at(x, n + (i - k[n]) / (k[n + 1] - k[n]))
  }
  return y
}

// how far a harmonic's line stands out: its phasors in blocks of LB (the tracked phase holds that long), weighted (w:
// the inverse of the program's power around the line), Hann-tapered and transformed; the power at the line (within the
// taper's main lobe of 0 Hz) over the median power 0.5–8 Hz from it (snr) and over the strongest within 3 Hz (iso),
// neither under FLOOR of the block's strongest component, each averaged over the blocks, dB; and the line's amplitude²
// (amp: the weighted mean phasor's)
function lineSNR([re, im], w, fr) {
  let M = re.length, B = Math.min(M, Math.round(LB * fr)), N = 2 ** Math.ceil(Math.log2(2 * B)), a = new Float64Array(N), b = new Float64Array(N)
  let bin = fr / N, lobe = Math.ceil(2 * fr / B / bin), snr = 0, iso = 0, amp = 0, nb = 0
  for (let s0 = 0; s0 + B <= M; s0 += Math.max(1, B >> 1)) {
    a.fill(0); b.fill(0)
    let su = 0
    for (let m = 0; m < B; m++) { let u = w[s0 + m] * (0.5 - 0.5 * Math.cos(2 * Math.PI * (m + 0.5) / B)); a[m] = u * re[s0 + m]; b[m] = u * im[s0 + m]; su += u }
    fft(a, b)
    let pk = 0, near = [], other = 0, top = 0
    for (let i = 0; i < N; i++) top = Math.max(top, a[i] ** 2 + b[i] ** 2)
    for (let k = -lobe; k <= lobe; k++) { let i = (k + N) % N; pk = Math.max(pk, a[i] ** 2 + b[i] ** 2) }
    for (let k = Math.ceil(0.5 / bin); k <= Math.min(N / 2 - 1, 8 / bin); k++) for (let i of [k, N - k]) {
      let p = a[i] ** 2 + b[i] ** 2; near.push(p)
      if (k > lobe && k * bin <= 3) other = Math.max(other, p)
    }
    near.sort((u, v) => u - v)
    let floor = FLOOR * top                                         // a line among the block's components, not their rounding
    snr += pk / Math.max(near[near.length >> 1], floor, 1e-300); iso += pk / Math.max(other, floor, 1e-300); amp += su > 0 ? pk / (su * su) : 0; nb++
  }
  return { snr: 10 * Math.log10(snr / nb), iso: 10 * Math.log10(iso / nb), amp: amp / nb }
}

// x at fractional position t: Kaiser-windowed sinc (β 9, 2·Q taps, tabulated); zero past the ends
const Q = 16, S = 512, PAD = Q + 2
let ROWS
function at(x, t) {
  let R = ROWS ??= rows(), i = Math.floor(t), u = (t - i) * S, p = Math.floor(u), a = u - p, r0 = R[p], r1 = R[p + 1], s0 = 0, s1 = 0, n0 = i - Q + 1
  if (n0 >= 0 && i + Q < x.length) for (let q = 0; q < 2 * Q; q++) { let v = x[n0 + q]; s0 += v * r0[q]; s1 += v * r1[q] }
  else for (let q = Math.max(0, -n0), q1 = Math.min(2 * Q, x.length - n0); q < q1; q++) { let v = x[n0 + q]; s0 += v * r0[q]; s1 += v * r1[q] }
  return s0 + a * (s1 - s0)
}
// the kernel at each of S + 1 fractional offsets p/S: taps q − Q + 1 − p/S, q = 0…2Q−1
function rows() {
  let i0 = v => { let s = 1, t = 1; for (let j = 1; j < 40; j++) { t *= (v / 2 / j) ** 2; s += t } return s }, b = 9
  let k = u => (u = Math.abs(u)) >= Q ? 0 : (u ? Math.sin(Math.PI * u) / (Math.PI * u) : 1) * i0(b * Math.sqrt(1 - (u / Q) ** 2)) / i0(b)
  return Array.from({ length: S + 1 }, (_, p) => Float64Array.from({ length: 2 * Q }, (_, q) => k(q - Q + 1 - p / S)))
}

// the hum at harmonics hs of f0 in x, in frames of 2H hopped by H: synthesize()'s arguments, and the tracked phase's
// mean turn in Hz; null under two frames
function estimate(x, fs, f0, hs, H) {
  let M = Math.floor(x.length / H)
  if (M < 2 || !hs.length) return null
  let w0 = 2 * Math.PI * f0 / fs, fr = fs / H
  let g = hann(T * fr), gr = hann(TR * fr), lin = M >= g.length          // a clip shorter than the window: constant fit
  let { c, full } = phasors(x, H, M, w0, hs), w = weigh(c, full, g, gr, lin), delta = track(c, w, hs, g, gr, lin, fr)
  return { df: (delta[M - 1] - delta[0]) / (M - 1) * fs / (2 * Math.PI * H), delta }
}

// each frame's weight: the inverse of the residual's local power around the line, from a uniform fit and then twice
// from the weighted one; floored at KAPPA of the line's mean power
function weigh(c, full, g, gr, lin) {
  return c.map(ck => weighFit(ck, full, g, gr, lin).w)
}
// one harmonic's weights and its weighted fit with them
function weighFit(ck, full, g, gr, lin) {
  {
    let M = ck[0].length, w = Float64Array.from(full), a = fit(ck, w, g, lin)
    for (let it = 0; it < 2; it++) {
      let r = residual(ck, a, gr), p = 0
      for (let m = 0; m < M; m++) p += a[0][m] ** 2 + a[1][m] ** 2
      for (let m = 0; m < M; m++) w[m] = full[m] / (r[m] + KAPPA * p / M + 1e-30)
      a = fit(ck, w, g, lin)
    }
    return { w, a }
  }
}
// the weights of harmonic i of an analysis under a frame mask (kept on the analysis: one key per mask)
function weights(an, i, mask, key, fr) {
  let g = hann(T * fr), memo = (an.memo ??= {})[key] ??= []
  return memo[i] ??= weighFit(an.c[i], mask, g, hann(TR * fr), an.M >= g.length)
}

// the mains phase δ per frame: the fitted phasors' turn from frame to frame over h, weighted by h²·SNR, averaged over
// TT and integrated, twice (the second time along the first)
function track(c, w, hs, g, gr, lin, fr) {
  let M = w[0].length, delta = new Float64Array(M)
  for (let it = 0; it < 2; it++) {
    let num = new Float64Array(M - 1), den = new Float64Array(M - 1)
    for (let k = 0; k < hs.length; k++) {
      let h = hs[k], cd = rotate(c[k], delta, h), a = fit(cd, w[k], g, lin), [re, im] = a, s = snr(cd, a, w[k], g, gr)
      for (let m = 0; m + 1 < M; m++) {
        let q = (s[m] + s[m + 1]) / 2
        num[m] += q * h * Math.atan2(im[m + 1] * re[m] - re[m + 1] * im[m], re[m + 1] * re[m] + im[m + 1] * im[m])
        den[m] += q * h * h
      }
    }
    for (let m = 0; m + 1 < M; m++) num[m] = den[m] > 0 ? num[m] / den[m] : 0
    let d = average(num, Math.round(TT * fr))
    for (let m = 1, acc = 0; m < M; m++) delta[m] += acc += d[m - 1]
  }
  return delta
}

// each harmonic's phasor per frame: Hann over 2H samples, hop H: [re, im]. The window's zeros fall on all the other
// harmonics, and its sidelobes keep the program far from a line out of that line's phasors.
// Non-finite samples count as 0. Also each frame's weight to start from: 1, or 0 for a frame the signal's ends cut
// (a cut window's zeros miss the harmonics), unless fewer than two frames are whole: then those are renormalized.
function phasors(x, H, M, w0, hs) {
  let N = 2 * H, o = H >> 1, fr = new Float64Array(N), win = new Float64Array(N), out = hs.map(() => [new Float64Array(M), new Float64Array(M)])
  let whole = m => m * H - o >= 0 && m * H - o + N <= x.length, full = Float64Array.from({ length: M }, (_, m) => +whole(m))
  if (full.reduce((s, v) => s + v, 0) < 2) full.fill(1)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / N)
  let tabs = hs.map(h => { let tc = new Float64Array(N), ts = new Float64Array(N); for (let i = 0; i < N; i++) tc[i] = win[i] * Math.cos(h * w0 * i), ts[i] = win[i] * Math.sin(h * w0 * i); return [tc, ts] })
  for (let m = 0; m < M; m++) {
    let n0 = m * H - o, sum = 0
    for (let i = 0; i < N; i++) { let n = n0 + i, v = x[n], in_ = n >= 0 && n < x.length; fr[i] = in_ && Number.isFinite(v) ? v : 0; if (in_) sum += win[i] }
    for (let k = 0; k < hs.length; k++) {
      let [tc, ts] = tabs[k], sr = 0, si = 0
      for (let i = 0; i < N; i++) sr += fr[i] * tc[i], si -= fr[i] * ts[i]
      let ph = hs[k] * w0 * n0, cs = Math.cos(ph), sn = Math.sin(ph)
      out[k][0][m] = 2 / sum * (sr * cs + si * sn)
      out[k][1][m] = 2 / sum * (si * cs - sr * sn)
    }
  }
  return { c: out, full }
}

// c·e^(−j·h·δ)
function rotate([re, im], delta, h) {
  let r = new Float64Array(re.length), i = new Float64Array(re.length)
  for (let m = 0; m < re.length; m++) { let cs = Math.cos(h * delta[m]), sn = Math.sin(h * delta[m]); r[m] = re[m] * cs + im[m] * sn; i[m] = im[m] * cs - re[m] * sn }
  return [r, i]
}

// weighted local-linear (lin) or local-constant fit of [re, im] over window g: the fitted line's value at each frame
function fit([re, im], w, g, lin) {
  let M = re.length, L = g.length, o = L >> 1, fr = new Float64Array(M), fi = new Float64Array(M)
  for (let m = 0; m < M; m++) {
    let s0 = 0, s1 = 0, s2 = 0, r0 = 0, i0 = 0, r1 = 0, i1 = 0
    for (let j = Math.max(0, o - m), J = Math.min(L, M - m + o); j < J; j++) {
      let n = m + j - o, u = g[j] * w[n], t = j - o
      s0 += u; s1 += u * t; s2 += u * t * t; r0 += u * re[n]; i0 += u * im[n]; r1 += u * t * re[n]; i1 += u * t * im[n]
    }
    let det = s0 * s2 - s1 * s1
    if (lin && det > 1e-9 * s0 * s2) { fr[m] = (s2 * r0 - s1 * r1) / det; fi[m] = (s2 * i0 - s1 * i1) / det }
    else if (s0 > 0) { fr[m] = r0 / s0; fi[m] = i0 / s0 }
  }
  return [fr, fi]
}

// the residual's power |c − a|², averaged over window g
function residual(c, a, g) {
  let M = c[0].length, e = new Float64Array(M)
  for (let m = 0; m < M; m++) e[m] = (c[0][m] - a[0][m]) ** 2 + (c[1][m] - a[1][m]) ** 2
  return smooth(e, g)
}

// each frame's SNR: the fitted phasor's power over the variance the fit carries from the residual, Σ(g·w)²·r / (Σg·w)²
function snr(c, a, w, g, gr) {
  let M = w.length, L = g.length, o = L >> 1, r = residual(c, a, gr), s = new Float64Array(M)
  for (let m = 0; m < M; m++) {
    let n0 = 0, v = 0
    for (let j = Math.max(0, o - m), J = Math.min(L, M - m + o); j < J; j++) { let n = m + j - o, u = g[j] * w[n]; n0 += u; v += u * u * r[n] }
    s[m] = (a[0][m] ** 2 + a[1][m] ** 2) * n0 * n0 / (v + 1e-300)
  }
  return s
}

// weighted average over window g, renormalized at the edges
function smooth(e, g) {
  let M = e.length, L = g.length, o = L >> 1, out = new Float64Array(M)
  for (let m = 0; m < M; m++) {
    let s = 0, n = 0
    for (let j = Math.max(0, o - m), J = Math.min(L, M - m + o); j < J; j++) { s += g[j] * e[m + j - o]; n += g[j] }
    out[m] = s / n
  }
  return out
}

// moving average over L points, renormalized at the edges (running sums)
function average(v, L) {
  let M = v.length, o = L >> 1, out = new Float64Array(M), cs = new Float64Array(M + 1)
  for (let m = 0; m < M; m++) cs[m + 1] = cs[m] + v[m]
  for (let m = 0; m < M; m++) { let a = Math.max(0, m - o), b = Math.min(M, m - o + L); out[m] = (cs[b] - cs[a]) / (b - a) }
  return out
}

// Hann window spanning `len` frames, odd length ≥ 3, its zero ends left out
function hann(len) {
  let L = Math.max(3, 2 * Math.round(len / 2) + 1), g = new Float64Array(L)
  for (let j = 0; j < L; j++) g[j] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (j + 1) / (L + 1))
  return g
}

// Measure mains hum near the candidate fundamentals: null when the signal is shorter than MIN seconds or no series
// stands out, else { f0, harmonics } with the harmonics (up to 1 kHz) whose lines stand out.
export function measure(data, fs, candidates = [50, 60], tol = 0.004) {
  return data.length < MIN * fs ? null : find(look(data, fs), candidates, tol)
}

// Mains hum is a sum of sinusoids that hold their frequency for minutes, speech holds none for long: one Fourier
// transform over the whole signal (its first 2^18 samples at ~3 kHz, 80–90 s) gathers each hum line into a peak 1/T
// wide while speech spreads.
// The signal is first brought to ~3 kHz (8th-order Butterworth at 1.1 kHz, every M-th sample) so the transform stays
// small. A line stands out by its peak over the median power of the ±8 Hz around it, its own main lobe left out, and
// stands alone by its peak over every other peak within 3 Hz of it beyond its lobe and the spread the mains' wander
// gives it (±0.06·h Hz): music that repeats a bar is a comb of lines 1/bar apart, lines at 50 and 60 Hz among them
// (at 120 bpm the comb is every 2 Hz), none alone. A faster pattern spaces its teeth past 3 Hz, and where the
// instrument rings a tooth stands over the next (a kick at 200 bpm: every 3.33 Hz, its tooth on 50 Hz 7 dB over the
// next in Dark Ride's "Burning Bridges"): comb() finds such a pattern by all its teeth to 1 kHz.
// Returns line(h, f, lo, hi), comb(f), and the transform's bin and rate
function look(data, fs) {
  let M = Math.max(1, Math.floor(fs / 3000)), fd = fs / M
  let x = Float32Array.from(data)
  if (M > 1) {
    cascade(x, [0.5098, 0.6013, 0.9, 2.5629].map(q => lowpass(1100, q, fs)))   // Butterworth pole pairs, order 8
    let y = new Float32Array(Math.floor(x.length / M))
    for (let i = 0; i < y.length; i++) y[i] = x[i * M]
    x = y
  }
  let L = Math.min(x.length, 1 << 18), N = 2 ** Math.ceil(Math.log2(2 * L)), bin = fd / N
  let re = new Float64Array(N), im = new Float64Array(N)
  for (let i = 0; i < L; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / L))
  fft(re, im)
  let K = Math.min(N >> 1, Math.ceil(1100 / bin)), P = new Float64Array(K)
  for (let k = 0; k < K; k++) P[k] = re[k] * re[k] + im[k] * im[k]
  let lobe = 2 * fd / L                             // Hann main lobe half width, Hz
  let peak = i => P[i] >= P[i - 1] && P[i] >= P[i + 1]
  let strongest = (lo, hi) => { let k0 = Math.max(1, Math.floor(lo / bin)), k1 = Math.min(K - 2, Math.ceil(hi / bin)), k = k0; for (let i = k0; i <= k1; i++) if (P[i] > P[k]) k = i; return k }
  let median = (k, f) => {                          // of the ±8 Hz around f, the main lobe at bin k left out
    let near = []
    for (let i = Math.round((f - 8) / bin); i <= Math.round((f + 8) / bin); i++) if (i > 0 && i < K && Math.abs(i - k) * bin > 2 * lobe) near.push(P[i])
    return near.sort((u, v) => u - v)[near.length >> 1]
  }
  // the strongest peak between two frequencies: its power over the median of ±8 Hz around it (snr, dB), over the
  // strongest other peak near it (iso, dB), its frequency interpolated on the log power; no local maximum, no line
  let line = (h, f, lo, hi) => {
    let k = strongest(lo, hi)
    if (!peak(k)) return { h, snr: -Infinity, iso: -Infinity, p: h * f, power: 0 }
    let other = 0, gap = 2 * lobe + 0.06 * h
    for (let i = Math.max(1, Math.round(k - (gap + 3) / bin)); i <= Math.min(K - 2, Math.round(k + (gap + 3) / bin)); i++)
      if (Math.abs(i - k) * bin > gap && peak(i)) other = Math.max(other, P[i])
    let a = Math.log(P[k - 1] || 1e-300), b = Math.log(P[k]), c = Math.log(P[k + 1] || 1e-300)
    let d = a - 2 * b + c ? 0.5 * (a - c) / (a - 2 * b + c) : 0, snr = 10 * Math.log10(P[k] / Math.max(median(k, h * f), 1e-300))
    return { h, snr, iso: 10 * Math.log10(P[k] / Math.max(other, 1e-300)), p: (k + Math.max(-0.5, Math.min(0.5, d))) * bin, power: P[k] }
  }
  // the program's comb through the series of f: a pattern the program repeats every n periods of f puts a line every
  // f/n Hz, one on each harmonic of f among them. For each n with f/n from 0.5 to 8 Hz (patterns of 1/8 s to 2 s: a
  // figure, a beat, a bar at 120 bpm) and resolved (two lobes at least), the share of the positions m·f/n from 40 Hz
  // to 1 kHz (m no multiple of n: not the series' own) holding a peak 10 dB over the ±8 Hz around it (log-mean), less
  // the share midway between them, where a comb has none and chance has as many: the largest
  let lg = new Float64Array(K + 1), W = Math.round(8 / bin)
  for (let k = 0; k < K; k++) lg[k + 1] = lg[k] + Math.log(P[k] + 1e-300)
  let held = k => { let a = Math.max(0, k - W), b = Math.min(K, k + W + 1); return k > 0 && k < K - 1 && peak(k) && P[k] >= 10 * Math.exp((lg[b] - lg[a]) / (b - a)) }
  let at = f => { let k = Math.round(f / bin); return held(k - 1) || held(k) || held(k + 1) ? 1 : 0 }
  let comb = f => {
    let best = 0
    for (let n = Math.ceil(f / 8); f / n >= Math.max(0.5, 2 * lobe); n++) {
      let d = f / n, on = 0, mid = 0, c = 0
      for (let m = Math.ceil(40 / d); m * d <= 1000; m++) if (m % n) on += at(m * d), mid += at((m + 0.5) * d), c++
      if (c) best = Math.max(best, (on - mid) / c)
    }
    return best
  }
  return { line, comb, bin, fd }
}

// Hum is there when the fundamental stands out by 20 dB or two of the first six harmonics by 15 dB, each searched
// within the mains tolerance and alone by 6 dB, all harmonics of one fundamental (p/h within 0.01 Hz and 2 bins: the
// grid's wander moves every harmonic alike). Over noise alone, the largest of M independent exponential powers sits
// (ln M + 0.58)/ln 2 times their median: 8–10 dB for the 35–210 independent bins of a 90 s search. On 504 clean and
// 504 noisy VoiceBank training utterances these find hum in one, which carries a steady 49.86 Hz tone at the
// speech's level; in 164 music clips (144 MUSDB18 7 s excerpts, the 20 BabySlakh mixes), in one (0.2.0: in 19): the
// kick's tooth on 50 Hz above, which detect() leaves (no pause to hear it persist in, and on the program's comb); with
// hum 20 dB under the speech, in 95 % (50 Hz) and 92 % (60 Hz) of the utterances.
function find({ line, bin, fd }, candidates, tol) {
  let best = null
  for (let f of candidates) {
    let first = []
    for (let h = 1; h <= 6 && h * f < fd / 2 - 10; h++) first.push(line(h, f, h * f * (1 - tol), h * f * (1 + tol)))
    let lines = first.filter(l => l.snr >= 15 && l.iso >= 6), strong = []
    for (let r of lines) {
      let set = lines.filter(l => Math.abs(l.p / l.h - r.p / r.h) <= 0.01 + 2 * bin)
      if (set.reduce((s, l) => s + l.power, 0) > strong.reduce((s, l) => s + l.power, 0)) strong = set
    }
    if (!(strong.some(l => l.h === 1 && l.snr >= 20) || strong.length >= 2)) continue
    let power = strong.reduce((s, l) => s + l.power, 0)
    if (!best || power > best.power) best = { f, strong, power }
  }
  if (!best) return null
  // f0: each strong line's p/h weighted by its precision, h²·SNR; then each harmonic up to 1 kHz searched right at
  // h·f0 (±3 bins, ±0.05 % for drift) is listed when it stands out by 13 dB
  let num = 0, den = 0
  for (let l of best.strong) { let w = l.h * l.h * 10 ** (l.snr / 10); num += w * l.p / l.h; den += w }
  let f0 = num / den, on = []
  for (let h = 1; h * f0 <= 1000 && h * f0 < fd / 2 - 10; h++) {
    let w = Math.max(3 * bin, 0.0005 * h * f0)
    if (line(h, f0, h * f0 - w, h * f0 + w).snr >= 13 || best.strong.some(s => s.h === h)) on.push(h)
  }
  return { f0, harmonics: on }
}

// in-place radix-2 complex FFT (the measurement's only transform)
function fft(re, im) {
  let n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    let ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < len >> 1; j++) {
        let a = i + j, b = a + (len >> 1)
        let tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
        let t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}
