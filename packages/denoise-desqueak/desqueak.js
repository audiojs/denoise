// De-squeak: a guitar's noises taken down, its notes left as they ring. Three parts, as iZotope RX's Guitar De-noise has:
// string squeaks (on by default), a pick's harsh attack, the amp's hiss, hum and buzz.
//
// Squeak. A fingertip sliding along a wound string strikes each winding it crosses: a pulse train at v/d (the slide's
// speed over the winding's pitch), so a comb of harmonics rising and falling with the hand's move, an RMS that grows
// with the speed, and static lines at the string's longitudinal modes (Pakarinen, Penttinen & Bank, JASA 122(6),
// EL197–EL202, 2007). It is told from the guitar by what a note is not: a note's partials hold their bins (harmonic, in
// Driedger, Müller & Disch's split, ISMIR 2014, read on 93 ms frames, where a bass note's partials 82 Hz apart stand
// apart and a sweeping comb smears), a pluck starts with partials or a click, a squeak has neither and lasts tens of ms.
// Where the share of 1–10 kHz that is not harmonic rises 14 dB over what the 200 ms around hold, no note starting, the
// region is taken down per bin to what the bin holds just outside it, never in a harmonic cell, on 23 ms frames; the edit is confined to the region, and the take elsewhere stays sample for
// sample.
//
// Pick: each pluck's click found on the 2–10 kHz envelope, its first 10 ms taken down to what the note holds 15–35 ms
// on. Amp: OM-LSA (@audio/denoise-omlsa) on a noise print read from the take's quietest frames.

import { fft, ifft } from 'fourier-transform'
import { highpass, lowpass, process as filter } from '@audio/biquad'
import { frame as heldFrame, processor } from '@audio/denoise-omlsa'
import { stftAnalyse, stftBatch } from '@audio/stft'

/** The squeak part's analysis frame at a rate: the power of two nearest 23 ms (1024 at 44.1 and 48 kHz). */
export const frame = fs => 2 ** Math.max(8, Math.round(Math.log2(0.0232 * fs)))

export default function desqueak(data, opts = {}) {
  let fs = opts.fs || 44100, squeak = opts.squeak ?? -30, pick = opts.pick ?? 0, amp = opts.amp ?? 0
  if (amp < 0) hush(data, fs, amp)
  if (squeak < 0) squeaks(data, fs, squeak)
  if (pick < 0) picks(data, fs, pick, opts.attack ?? 0.01)
  return data
}

const pct = (v, p) => { let s = Float64Array.from(v).sort(); return s[Math.floor(p * (s.length - 1))] }
const win = N => Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N))
// x's 1–10 kHz (or 2–10 kHz) band, causal, a copy
const band = (x, fs, lo) => { let y = Float64Array.from(x); for (let c of [highpass(lo, 0.5412, fs), highpass(lo, 1.3066, fs), lowpass(Math.min(10000, 0.45 * fs), 0.7071, fs)]) filter(y, c); return y }

// ---- squeak

function squeaks(x, fs, squeak) {
  let N = frame(fs), hop = N >> 2
  if (x.length < 4 * N) return
  let S = analyse(x, N, hop, fs), { regions, harmonic } = detect(S, fs)
  regions = regions.filter(r => sustained(x, r, S, fs))
  if (regions.length) apply(x, S, gains(S, regions, fs, squeak, harmonic), regions)
}

// power spectra of every frame (the first starts N − hop before the input, then every hop; outside the input, zeros)
function analyse(x, N, hop, fs) {
  let w = win(N), F = Math.ceil((x.length + N - hop) / hop), K = (N >> 1) + 1, P = new Float32Array(F * K), f = new Float64Array(N)
  for (let t = 0; t < F; t++) {
    let p = t * hop - (N - hop)
    for (let i = 0; i < N; i++) { let j = p + i; f[i] = j >= 0 && j < x.length ? x[j] * w[i] : 0 }
    let [re, im] = fft(f)
    for (let k = 0; k < K; k++) P[t * K + k] = re[k] * re[k] + im[k] * im[k]
  }
  return { P, F, K, N, hop, w, x, fs }
}

// median of the first m values (quickselect, in place)
function median(a, m) {
  let lo = 0, hi = m - 1, k = m >> 1
  while (lo < hi) {
    let p = a[(lo + hi) >> 1], i = lo, j = hi
    while (i <= j) { while (a[i] < p) i++; while (a[j] > p) j--; if (i <= j) { let t = a[i]; a[i] = a[j]; a[j] = t; i++; j-- } }
    if (k <= j) hi = j; else if (k >= i) lo = i; else break
  }
  return a[k]
}

// Harmonic cells: a cell's median over ±100 ms stands 6 dB over its median over ±350 Hz (Driedger, Müller & Disch's
// harmonic class, β 2), read on frames four times as long, a frame's hop apart: 93 ms at 44.1 kHz, 10.8 Hz bins, where a
// low note's partials, 82–200 Hz apart, stand apart (on 23 ms frames they merge into what reads as noise, and the cut
// took a bass note's upper partials) and a squeak's sweeping comb smears further. A short frame's cell is harmonic when
// the strongest long bin under it is, in the nearest long frame. Per short frame, over 80 Hz–1 kHz and 1–10 kHz: the
// band's power and its harmonic part.
function hpr(S, fs) {
  let { P, F, K, N, hop, x } = S, bin = f => Math.min(K - 1, Math.round(f / fs * N)), k0 = bin(80), kb = bin(1000), k1 = bin(10000)
  let L = analyse(x, 4 * N, N, fs), KL = L.K, l0 = 4 * k0 - 2, l1 = Math.min(KL - 1, 4 * k1 + 2)
  let wt = Math.max(2, Math.round(0.1 * fs / N)), wf = Math.max(2, Math.round(350 / fs * 4 * N)), buf = new Float64Array(2 * Math.max(wt, wf) + 1)
  let H = new Float32Array(L.F * KL), flag = new Uint8Array(L.F * KL)
  for (let k = l0; k <= l1; k++) for (let t = 0; t < L.F; t++) {
    let m = 0
    for (let j = Math.max(0, t - wt); j <= Math.min(L.F - 1, t + wt); j++) buf[m++] = L.P[j * KL + k]
    H[t * KL + k] = median(buf, m)
  }
  for (let t = 0; t < L.F; t++) for (let k = l0; k <= l1; k++) {
    let m = 0
    for (let j = Math.max(l0, k - wf); j <= Math.min(l1, k + wf); j++) buf[m++] = L.P[t * KL + j]
    if (H[t * KL + k] > 4 * median(buf, m)) flag[t * KL + k] = 1
  }
  let harmonic = new Uint8Array(F * K), lo = { tot: new Float64Array(F), harm: new Float64Array(F) }, hi = { tot: new Float64Array(F), harm: new Float64Array(F) }
  for (let t = 0; t < F; t++) {
    let j = Math.min(L.F - 1, Math.max(0, Math.round((t * hop - (N - hop) + N / 2 + N) / N)))     // the long frame centred nearest
    for (let k = k0; k <= k1; k++) {
      let best = 4 * k
      for (let i = 4 * k - 2; i <= 4 * k + 2; i++) if (L.P[j * KL + i] > L.P[j * KL + best]) best = i
      let p = P[t * K + k], B = k < kb ? lo : hi
      B.tot[t] += p
      if (flag[j * KL + best]) B.harm[t] += p, harmonic[t * K + k] = 1
    }
  }
  return { lo, hi, harmonic, k0, k1 }
}

// Where notes start (frames), each marked from 2 frames before it to 6 after. Either the low bands jump: three or more
// third-octave bands from 80 to 560 Hz staying 6 dB or more for 30 ms over the most they held a frame's length before
// (the frames overlap: an onset rises over four hops), to within 15 dB of the band's 95th-percentile frame: a pluck's
// click and its note's low partials, where a squeak's comb passes through a band and stays far under a note's level.
// Or partials come: harmonic bins whose least over the next 50 ms (from 2 frames on) stands 4.5 dB or more over the most
// they held 2–6 frames before, a quarter or more of the harmonic power then, under 1 kHz (within 20 dB of that band's
// 95th-percentile harmonic power) or over it (16 bins or more there): a note whose earlier notes stop as it starts lifts
// no band, a chord struck again over its own ringing raises partials already there, a squeak brings its comb, which
// moves on within 50 ms, and its longitudinal modes, a few static lines.
function notes(S, fs, harmonic, k0, k1) {
  let { P, F, K, N, hop } = S, on = new Uint8Array(F), at = [], edges = [], hold = Math.round(0.05 * fs / hop), stay = Math.round(0.03 * fs / hop), lag = N / hop, kb = Math.round(1000 / fs * N)
  for (let f = 80; f < 560; f *= 2 ** (1 / 3)) edges.push(Math.max(k0, Math.round(f / fs * N)))
  let B = edges.length - 1, L = new Float64Array(F * B)
  for (let t = 0; t < F; t++) for (let b = 0; b < B; b++) { let e = 0; for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) e += P[t * K + k]; L[t * B + b] = e }
  let loud = Array.from({ length: B }, (_, b) => pct(Array.from({ length: F }, (_, t) => L[t * B + b]), 0.95) * 10 ** -1.5)
  let lowLoud = pct(Array.from({ length: F }, (_, t) => { let e = 0; for (let k = k0; k < kb; k++) if (harmonic[t * K + k]) e += P[t * K + k]; return e }), 0.95) * 0.01
  for (let t = Math.max(6, lag + 1); t + 2 + hold < F; t++) {
    let jump = 0
    for (let b = 0; b < B; b++) {
      let before = Math.max(L[(t - lag) * B + b], L[(t - lag - 1) * B + b]), held = Infinity
      for (let j = t; j <= t + stay; j++) held = Math.min(held, L[j * B + b])
      if (held > 4 * before && L[t * B + b] > loud[b]) jump++
    }
    let fresh = [0, 0], all = [0, 0], count = 0
    if (jump < 3) for (let k = k0; k <= k1; k++) {
      if (!harmonic[(t + 2 + (hold >> 1)) * K + k]) continue
      let after = Infinity, before = 0, b = k < kb ? 0 : 1
      for (let j = t + 2; j <= t + 2 + hold; j++) after = Math.min(after, P[j * K + k])
      for (let j = t - 6; j <= t - 2; j++) before = Math.max(before, P[j * K + k])
      all[b] += after
      if (after > 2.8 * before) fresh[b] += after, count += b
    }
    if (jump >= 3 || (fresh[0] > 0.25 * all[0] && fresh[0] > lowLoud) || (fresh[1] > 0.25 * all[1] && count >= 16)) on.fill(1, t - 2, t + 7), at.push(t)
  }
  return { on, at }
}

// Squeak regions [s, e] (frames). A squeak lifts the part of 1–10 kHz that is not harmonic and none of the harmonic
// part, so their ratio, which a note keeps as it decays, rises: core frames have it 14 dB or more over its floor nearby
// (the more of the least it reaches in the 200 ms before and in the 200 ms after, notes' starts left out), 70 % or more
// of the band not harmonic, that part 10 dB or more over the band's quiet (its 10th-percentile frame), and no note
// starting. Runs bridged over five frames, widened while the ratio stays 6 dB over its floor and half the band is not
// harmonic, 45 ms or more: real squeaks on the tuning takes ran 46–134 ms, while the pick's touch before a pluck, which
// the same cues catch, ran 12–35 ms (at 20 ms the pluck's touch lost a median 5.8 dB over 1–10 kHz, RX 12's 3.0). A region with a note starting in its first half (or 3 frames before it) is that note's
// attack (a strum's pick noise comes before its partials); a squeak ends as the next note starts, or before.
function detect(S, fs) {
  let { F, hop } = S, { hi, harmonic, k0, k1 } = hpr(S, fs), { on, at } = notes(S, fs, harmonic, k0, k1)
  let live = Array.from(hi.tot).filter(v => v > 0), quiet = live.length ? pct(live, 0.1) : 0, W = Math.round(0.2 * fs / hop)
  let nh = Float64Array.from(hi.tot, (v, t) => Math.max(0, v - hi.harm[t])), q = Float64Array.from(nh, (v, t) => (v + 1e-20) / (hi.harm[t] + 1e-20))
  let floor = new Float64Array(F)
  for (let t = 0; t < F; t++) {
    let l = Infinity, r = Infinity
    for (let j = Math.max(0, t - W); j < t; j++) if (!on[j] && q[j] < l) l = q[j]
    for (let j = t + 1; j <= Math.min(F - 1, t + W); j++) if (!on[j] && q[j] < r) r = q[j]
    floor[t] = Math.max(l === Infinity ? 0 : l, r === Infinity ? 0 : r)
  }
  let core = t => !on[t] && q[t] > 10 ** 1.4 * floor[t] && nh[t] > 0.7 * hi.tot[t] && nh[t] > 10 * quiet
  let ext = t => !on[t] && q[t] > 10 ** 0.6 * floor[t] && nh[t] > 0.5 * hi.tot[t] && nh[t] > 2.5 * quiet
  let c = Uint8Array.from({ length: F }, (_, t) => core(t)), out = [], minLen = Math.round(0.045 * fs / hop)
  for (let t = 1, last = -1; t < F; t++) if (c[t]) { if (last >= 0 && t - last <= 5) c.fill(1, last, t); last = t }
  for (let t = 0; t < F;) {
    if (!c[t]) { t++; continue }
    let s = t, e = t
    while (e + 1 < F && c[e + 1]) e++
    while (s > 0 && ext(s - 1)) s--
    while (e + 1 < F && ext(e + 1)) e++
    if (e - s + 1 >= minLen) out.length && s <= out[out.length - 1][1] + 1 ? out[out.length - 1][1] = e : out.push([s, e])
    t = e + 1
  }
  return { regions: out.filter(([s, e]) => !at.some(o => o >= s - 3 && o <= (s + e) / 2)), harmonic }
}

// A squeak is a contact held while the hand moves, a click an instant. A region stays if its 1–10 kHz energy spreads over
// 15 ms or more (its 2 ms energies' participation ratio, (Σe)²/Σe², times 2 ms: a pick's click, a fret's buzz, a muted
// stroke, smeared over a 23 ms frame, last a few ms), and never jumps: no millisecond 16 dB over the mean of the 6
// before it and within 6 dB of the region's loudest (a pluck's click rises at once, a squeak with the hand's speed).
function sustained(x, [s, e], S, fs) {
  let { N, hop } = S, w = Math.round(0.001 * fs), a = Math.max(0, s * hop - (N - hop) + (N >> 2)), b = Math.min(x.length, e * hop - (N - hop) + N - (N >> 2))
  let y = band(x.subarray(a, b), fs, 1000), m = Math.floor(y.length / w), E = new Float64Array(m), s1 = 0, s2 = 0, top = 0
  for (let i = 0; i < m; i++) { for (let j = i * w; j < i * w + w; j++) E[i] += y[j] * y[j]; top = Math.max(top, E[i]) }
  for (let i = 0; i + 1 < m; i += 2) { let v = E[i] + E[i + 1]; s1 += v; s2 += v * v }
  if (!(s2 > 0 && s1 * s1 / s2 * 0.002 >= 0.015)) return false
  for (let i = 6; i < m; i++) { let before = 0; for (let j = i - 6; j < i; j++) before += E[j]; if (E[i] > 40 * before / 6 && E[i] > top / 4) return false }
  return true
}

// Gains in each region, every bin over 300 Hz but a harmonic cell (a partial, where a squeak's comb moves on): down to
// what the bin holds just outside the region (the lesser side's mean over 4 frames, smoothed over ±2 bins), `squeak` dB
// at most. (Never under what the bin held for 60 ms on either side as well, as tried on the tuning takes: a real squeak,
// slow, lingers in its bins, and kept 10.4 dB of it where 11.2 now goes; the long frames' harmonic cells keep the notes.)
function gains(S, regions, fs, squeak, harmonic) {
  let { P, F, K, N } = S, k0 = Math.round(300 / fs * N), gmin = 10 ** (squeak / 20), G = new Map()
  let side = (a, b) => { let m = new Float64Array(K), c = 0; for (let t = Math.max(0, a); t <= Math.min(F - 1, b); t++, c++) for (let k = 0; k < K; k++) m[k] += P[t * K + k]; return c ? m.map(v => v / c) : null }
  let smooth = m => m.map((_, k) => { let s = 0, c = 0; for (let j = Math.max(0, k - 2); j <= Math.min(K - 1, k + 2); j++) s += m[j], c++; return s / c })
  for (let [s, e] of regions) {
    let A = side(s - 4, s - 1), B = side(e + 1, e + 4), edge = smooth(A && B ? A.map((v, k) => Math.min(v, B[k])) : A || B)
    for (let t = s; t <= e; t++) {
      let g = new Float32Array(K).fill(1)
      for (let k = k0; k < K; k++) { let p = P[t * K + k]; if (!harmonic[t * K + k] && p > edge[k]) g[k] = Math.max(gmin, Math.sqrt(edge[k] / p)) }
      G.set(t, g)
    }
  }
  return G
}

// x −= m·ISTFT((1 − G)·X): m is 1 over each region's own span (half a hop before its first frame's centre to half a hop
// after its last's) and 0 elsewhere, with 2 ms raised-cosine edges, for a frame reaches half its length past its centre,
// into the note that often follows a squeak. Elsewhere the take stays sample for sample.
function apply(x, S, G, regions) {
  let { w, K, N, hop, fs } = S, n = x.length, f = new Float64Array(N), corr = new Float64Array(n), R = new Float64Array(K), I = new Float64Array(K)
  let ola = 0; for (let i = 0; i < N; i += hop) ola += w[i] * w[i]      // Σw² over the frames on a sample: the same everywhere at hop N/4
  for (let [t, g] of G) {
    let p = t * hop - (N - hop)
    for (let i = 0; i < N; i++) { let j = p + i; f[i] = j >= 0 && j < n ? x[j] * w[i] : 0 }
    let [re, im] = fft(f)
    for (let k = 0; k < K; k++) R[k] = re[k] * (1 - g[k]), I[k] = im[k] * (1 - g[k])
    let y = ifft(R, I)
    for (let i = 0; i < N; i++) { let j = p + i; if (j >= 0 && j < n) corr[j] += y[i] * w[i] }
  }
  let m = new Float64Array(n), fade = Math.max(1, Math.round(0.002 * fs))
  for (let [s, e] of regions) {
    let a = s * hop - (N - hop) + (N >> 1) - (hop >> 1), b = e * hop - (N - hop) + (N >> 1) + (hop >> 1)
    for (let i = Math.max(0, a - fade); i < Math.min(n, b + fade); i++) {
      let d = i < a ? (a - i) / fade : i >= b ? (i - b + 1) / fade : 0
      if (d < 1) m[i] = Math.max(m[i], 0.5 + 0.5 * Math.cos(Math.PI * d))
    }
  }
  for (let i = 0; i < n; i++) if (m[i] && corr[i]) x[i] -= m[i] * corr[i] / ola
}

// ---- pick

// A pluck's click: a 2–10 kHz millisecond 9 dB or more over the quietest 4 ms of the 40 ms before it (a strum's strings
// click one after another within a few ms, each over the last), the loudest within ±5 ms, the loudest of those within
// 20 ms, within 50 dB of the take's loudest milliseconds (99th percentile). Its attack, 2 ms before it to `attack` after,
// is taken down on frames of 5.8 ms (the power of two nearest), each bin over 1.5 kHz to the mean level it holds 15–35 ms
// on (the note ringing, the click gone), `pick` dB at most. A note that rings on keeps its partials.
function picks(x, fs, pick, attack) {
  let ms = Math.round(0.001 * fs), y = band(x, fs, 2000), m = Math.floor(x.length / ms), e = new Float64Array(m)
  for (let i = 0; i < m; i++) for (let j = i * ms; j < i * ms + ms; j++) e[i] += y[j] * y[j]
  let top = pct(Array.from(e).filter(v => v > 0), 0.99) || 0, clicks = []
  for (let i = 40; i < m - 5; i++) {
    let low = Infinity
    for (let j = i - 40; j + 4 <= i - 2; j++) low = Math.min(low, (e[j] + e[j + 1] + e[j + 2] + e[j + 3]) / 4)
    if (e[i] < 8 * low || e[i] < top * 1e-5) continue
    let peak = true
    for (let j = i - 5; j <= i + 5; j++) if (e[j] > e[i]) peak = false
    if (!peak) continue
    let last = clicks[clicks.length - 1]
    if (clicks.length && i - last <= 20) { if (e[i] > e[last]) clicks[clicks.length - 1] = i; continue }
    clicks.push(i)
  }
  if (!clicks.length) return
  let N = 2 ** Math.max(6, Math.round(Math.log2(0.0058 * fs))), hop = N >> 2, S = analyse(x, N, hop, fs), K = S.K, k0 = Math.round(1500 / fs * N)
  let fr = smp => Math.round((smp + N - hop - N / 2) / hop), G = new Map(), gmin = 10 ** (pick / 20), regions = []
  for (let i of clicks) {
    let c = i * ms, a = fr(c - 2 * ms), b = fr(c + Math.round(attack * fs)), r0 = fr(c + 15 * ms), r1 = fr(c + 35 * ms)
    if (a < 0 || r1 >= S.F) continue
    let T = new Float64Array(K)
    for (let t = r0; t <= r1; t++) for (let k = k0; k < K; k++) T[k] += S.P[t * K + k] / (r1 - r0 + 1)
    for (let t = a; t <= b; t++) {
      let g = G.get(t) || new Float32Array(K).fill(1)
      for (let k = k0; k < K; k++) { let p = S.P[t * K + k]; if (p > T[k]) g[k] = Math.min(g[k], Math.max(gmin, Math.sqrt(T[k] / p))) }
      G.set(t, g)
    }
    regions.push([a, b])
  }
  apply(x, S, G, regions)
}

// ---- amp

// Hiss, hum and buzz hold still under the playing. Their print is read from the frames within 1 dB of the take's
// 1st-percentile frame (by power over 100 Hz–10 kHz): the amp alone before the playing, where the take has that, all of
// it, else the gaps between notes. (The quietest few alone are steady noise's quieter frames and read it low; frames
// within 3 dB took in a chord ringing softly through a take's quietest stretches; and a second of the amp alone before
// a 25 s take is 4 % of its frames, so a 5th percentile falls among the guitar's.) Split in time into four groups, per
// bin their mean; where the groups' means spread over 6 dB a note rang into some of them, and the least group's mean is
// taken, ×1.5 for what the least of four noisy means falls short by. (The plain mean read the bins under 100 Hz 14–61 dB
// high on a take with a second of hiss before the playing, a bass note's, and cost the guitar 12 dB of SNR; the least
// group everywhere read steady noise 2 dB low, and OM-LSA, hearing presence in noise read over its print, took it 10 dB
// down at −20.) Then OM-LSA on that held noise, `amp` dB down at most (@audio/denoise-omlsa: presence read from the a
// posteriori SNR averaged over neighbouring bins, Gerkmann, Breithaupt & Martin 2008; frames of 32 ms or more, so a
// note's partials part from the buzz's lines between them), but a spectral peak 10 dB or more over the print keeps its
// level, with its main lobe (±2 bins, while 3 dB over the print): a note ringing on is peaks well over the noise, where
// hiss peaks so high in one bin in 22 000 and a buzz's line sits at the print. OM-LSA alone took the last chord of a
// test take, 22 dB over the hiss, 6 dB down, its speech absence read as certain in the chord's steady bins; on the
// tuning takes the guitar's SDR under hiss, buzz and both went 47.2, 44.3, 44.2 → 50.1, 47.6, 46.6 dB, the noise taken
// where it is heard 14.7, 11.6, 12.6 → 13.3, 10.0, 10.7 dB.
function hush(x, fs, gMin) {
  let N = heldFrame(fs, true), hop = N >> 2, K = (N >> 1) + 1, lo = Math.round(100 / fs * N), hi = Math.min(K - 1, Math.round(10000 / fs * N)), level = [], spec = []
  if (x.length < 2 * N) return
  stftAnalyse(x, mag => {
    let e = 0, p = new Float32Array(K)
    for (let k = 0; k < K; k++) p[k] = mag[k] * mag[k]
    for (let k = lo; k <= hi; k++) e += p[k]
    if (e > 0) level.push(e), spec.push(p)
  }, { frameSize: N, hopSize: hop })
  let F = spec.length
  if (F < 8) return
  let cut = Math.max(1.26 * pct(level, 0.01), pct(level, Math.min(1, 8 / F))), q = [], G = 4, mean = Array.from({ length: G }, () => new Float64Array(K)), c = new Array(G).fill(0)
  for (let t = 0; t < F; t++) if (level[t] <= cut) q.push(t)
  q.forEach((t, j) => { let g = Math.floor(j * G / q.length); for (let k = 0; k < K; k++) mean[g][k] += spec[t][k]; c[g]++ })
  let profile = Float64Array.from({ length: K }, (_, k) => {
    let v = mean.map((m, g) => m[k] / c[g]), lo = Math.min(...v), hi = Math.max(...v)
    return hi > 4 * lo ? 1.5 * lo : v.reduce((s, u, g) => s + u * c[g], 0) / q.length
  })
  let gain = processor({ fs, profile, gMin, frameSize: N, hopSize: hop }), m0 = new Float64Array(K)
  x.set(stftBatch(x, (mag, phase) => {
    m0.set(mag)
    let r = gain(mag, phase)
    for (let k = 2; k < K - 2; k++) {
      if (m0[k] * m0[k] < 10 * profile[k] || m0[k] < m0[k - 1] || m0[k] < m0[k + 1]) continue
      for (let j = k - 2; j <= k + 2; j++) if (m0[j] * m0[j] > 2 * profile[j]) r.mag[j] = m0[j]
    }
    return r
  }, { frameSize: N, hopSize: hop, fs }))
}

