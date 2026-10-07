// denoise — content-aware auto-selector: finds the defect a recording carries and dispatches to the method for it.
// Each route needs positive evidence; with none, nothing is removed ('none': the sound comes back as it was).
//
// classify(), in priority order:
//   - hum   — dehum's own measurement finds a mains series, A-weighted within 50 dB of the program → dehum
//   - click — isolated impulses standing 32σ out of the AR error, over 1 a second → declick
//   - hi    — 5–9 kHz over 0.2–2 kHz power over 8 → deesser
//   - bed   — a noise floor within 25 dB of the program, shown in its pauses or as steady bands → omlsa
//   - wind  — loud, aperiodic low end 6 dB over the mid band in over a tenth of the recording, no bed shown → dewind
//   - none
//
// Every bed goes to omlsa: over 994 noisy tuning takes (VoiceBank+DEMAND's noises, DEMAND's, white, pink, babble,
// wind; scripts/detect.py) it kept STOI 0.007 ± 0.001 over wiener's at the same PESQ and SIG; wiener's edge, BAK on
// stationary noise, lies in the noise left. A bed outranks wind: a steady low rumble (a car, traffic, a metro) is a
// bed, and omlsa took it 0.1–0.3 PESQ over dewind; gusts with calms between, which the pauses show as no bed, stay
// dewind's (PESQ 1.88 to omlsa's 1.56).
//
// dereverb has no reliable single-pass signature, so auto-mode never selects it —
// reach it explicitly via `denoise(data, { force: 'dereverb' })` or `dereverb()`.
// Returns { out, plan } so callers can inspect which method ran.

import { stftAnalyse } from '@audio/stft'
import { arFit } from '@audio/lpc'
import wiener from '@audio/denoise-wiener'
import omlsa from '@audio/denoise-omlsa'
import dehum, { measure as humMeasure } from '@audio/denoise-dehum'
import declick from '@audio/denoise-declick'
import dewind from '@audio/denoise-dewind'
import deesser_ from '@audio/dynamics-deesser'
import dereverb from '@audio/denoise-dereverb'

// deesser: @audio/dynamics-deesser behind this family's seconds/fs API (2026-07 near-dupe merge), every setting the
// kernel's unless given (its split mode: the band over 3.5 kHz alone, 5 ms ahead; `mode: 'band'` a bell at `fc`).
// Exported: the umbrella index.js re-exports this same adapter instead of carrying its own copy.
const ms = s => s == null ? undefined : s * 1000
export const deesser = (data, params = {}) => {
  data.set(deesser_(data, {
    sampleRate: params.fs || 44100,
    mode: params.mode, split: params.split,
    fc: params.fc ?? params.freq,   // `freq`: former name
    Q: params.Q, threshold: params.threshold, range: params.range, ratio: params.ratio,
    attack: ms(params.attack), release: ms(params.release), lookahead: params.lookahead,
  }))
  return data
}

export default function denoise(data, params = {}) {
  let fs = params.fs || 44100
  let force = params.force                          // skip classification
  let plan = force ? { method: force, scores: {} } : classify(data, fs)
  let opts = { fs, ...params }
  let out
  switch (plan.method) {
    // the series classify heard; dehum measures its exact frequency and harmonics. Forced without `freq`,
    // dehum measures 50 and 60 Hz itself (a fixed 50 missed 60 Hz mains)
    case 'dehum':   out = dehum(new Float32Array(data), { ...opts, freq: params.freq ?? plan.humFreq }); break
    case 'declick': out = declick(new Float32Array(data), opts); break
    case 'dewind':  out = dewind(new Float32Array(data), opts); break
    case 'deesser': out = deesser(new Float32Array(data), opts); break
    case 'dereverb':out = dereverb(data, opts); break
    case 'omlsa':   out = omlsa(data, opts); break
    case 'wiener':  out = wiener(data, opts); break
    default:        out = Float32Array.from(data)    // 'none': no defect evidenced, nothing removed
  }
  return params.returnPlan ? { out, plan } : out
}

/** Impulses per second a recording must carry for declick. */
export const CLICK_RATE = 1
/** Program over noise bed, dB, under which the bed is reduced. */
export const BED_SNR = 25

const HUM_LEVEL = -50                              // dB A re the program: a line under it goes unheard
const WIND_SHARE = 0.1                             // share of 0.15 s blocks
const FLOOR_SLACK = 3                              // dB a bed's pauses may wander over its floor, past Gaussian spread
const MAX_FRAMES = 1 << 15                         // ≈ 6 min at 48 kHz; longer, 16 spans of it spread across

export function classify(data, fs = 44100) {
  let s = sweep(data, fs)
  if (!s) return { method: 'none', scores: { hum: 0, humFreq: 0, humLevel: -Infinity, click: 0, hi: 0, wind: 0, snr: Infinity, steady: false }, humFreq: 0 }
  let hum = humLevel(data, fs, s), click = impulseRate(data, fs), hi = s.hi / Math.max(s.mid, 1e-30)
  let wind = windShare(s), bed = noiseBed(s)
  let method = hum.level >= HUM_LEVEL ? 'dehum'
    : click > CLICK_RATE ? 'declick'
    : hi > 8 ? 'deesser'                           // white noise scores ~3.9 by bandwidth alone
    : bed.snr < BED_SNR ? 'omlsa'
    : wind > WIND_SHARE ? 'dewind'
    : 'none'
  let scores = { hum: hum.harmonics, humFreq: hum.f0, humLevel: hum.level, click, hi, wind, snr: bed.snr, steady: bed.steady }
  return { method, scores, humFreq: hum.f0 }
}

// One STFT sweep, N ≈ 46 ms (2048 at 44.1/48 kHz), hop N/4. Per frame: each half-octave band's power (from 62.5 Hz,
// mean over its bins), its spectral flatness (geometric over arithmetic mean) and, for the bands from 300 Hz with 8
// bins or more, its persistence: the correlation of the fine structure (log power less its ±4-bin mean) with the
// frame N back, which shares no sample. A partial holds its bins from frame to frame; noise draws them anew, 0. The
// low end, 40–300 Hz less its least-squares line, gets its own persistence for wind. Per frame too: the power under
// 200 Hz and at 300–2000 Hz; for the whole: 5–9 kHz, and the A-weighted share of the power, for hum.
function sweep(data, fs) {
  let N = 2 ** Math.round(Math.log2(0.046 * fs)), half = N >> 1, hop = N >> 2
  let total = data.length >= N ? Math.floor((data.length - N) / hop) + 1 : 0
  if (!total) return null
  let spans = total <= MAX_FRAMES ? [[0, data.length]] : Array.from({ length: 16 }, (_, i) => {
    let a = Math.round(i * (data.length - MAX_FRAMES / 16 * hop - N) / 15)
    return [a, a + (MAX_FRAMES / 16 - 1) * hop + N]
  })
  let T = spans.reduce((n, [a, b]) => n + Math.floor((b - a - N) / hop) + 1, 0)
  let edges = []
  for (let f = 62.5; f < fs / 2; f *= Math.SQRT2) edges.push(f)
  let B = edges.length - 1, band = new Int16Array(half + 1).fill(-1), nb = new Float64Array(B)
  for (let k = 1; k <= half; k++) for (let b = 0; b < B; b++) if (k * fs / N >= edges[b] && k * fs / N < edges[b + 1]) { band[k] = b; nb[b]++ }
  let test = edges.slice(0, B).map((e, b) => e >= 300 && nb[b] >= 8)
  let k0 = Math.max(1, Math.round(40 * N / fs)), k1 = Math.round(300 * N / fs), m = k1 - k0 + 1
  let aw = new Float64Array(half + 1), zone = new Int8Array(half + 1), tb = new Int16Array(half + 1).fill(-1)
  for (let k = 1; k <= half; k++) {
    let f = k * fs / N
    aw[k] = aWeight(f); zone[k] = f < 200 ? 1 : f >= 300 && f < 2000 ? 2 : f >= 5000 && f < 9000 ? 3 : 0
    if (band[k] >= 0 && test[band[k]] && k >= 4 && k <= half - 4) tb[k] = band[k]
  }
  let L = new Float32Array(T * B), F = new Float32Array(T * B), C = new Float32Array(T * B).fill(NaN)
  let tot = new Float64Array(T), lf = new Float64Array(T), mf = new Float64Array(T), lfC = new Float32Array(T).fill(NaN), valid = new Uint8Array(T)
  let ring = Array.from({ length: 5 }, () => new Float64Array(half + 1)), lring = Array.from({ length: 5 }, () => new Float64Array(m))
  let p = new Float64Array(B), lg = new Float64Array(B), lp = new Float64Array(half + 1)
  let xy = new Float64Array(B), xx = new Float64Array(B), yy = new Float64Array(B)
  let hi = 0, mid = 0, all = 0, aw2 = 0, t = 0
  for (let [a, b] of spans) {
    let u = 0                                      // frame within the span: persistence looks 4 back in it
    stftAnalyse(data.subarray(a, b), mag => {
      let d = ring[u % 5], pr = ring[(u + 1) % 5], ld = lring[u % 5], lq = lring[(u + 1) % 5], back = u >= 4
      p.fill(0); lg.fill(0); xy.fill(0); xx.fill(0); yy.fill(0)
      lp[0] = Math.log(mag[0] * mag[0] + 1e-30)
      for (let k = 1; k <= half; k++) {
        let v = mag[k] * mag[k], z = zone[k], c = band[k]
        lp[k] = Math.log(v + 1e-30); all += v; aw2 += v * aw[k]
        if (z === 1) lf[t] += v; else if (z === 2) mf[t] += v; else if (z === 3) hi += v
        if (c >= 0) { p[c] += v; lg[c] += lp[k] }
      }
      mid += mf[t]
      let run = 0
      for (let k = 0; k <= 8; k++) run += lp[k]
      for (let k = 4; k <= half - 4; k++) {
        let v = d[k] = lp[k] - run / 9, c = tb[k]
        if (k + 5 <= half) run += lp[k + 5] - lp[k - 4]
        if (back && c >= 0) { xy[c] += v * pr[k]; xx[c] += v * v; yy[c] += pr[k] * pr[k] }
      }
      for (let c = 0; c < B; c++) {
        let i = t * B + c, mean = p[c] / nb[c]
        L[i] = 10 * Math.log10(mean + 1e-30); F[i] = mean > 0 ? Math.exp(lg[c] / nb[c]) / mean : 0
        tot[t] += p[c]
        if (back && xx[c] > 0 && yy[c] > 0) C[i] = xy[c] / Math.sqrt(xx[c] * yy[c])
      }
      let sx = 0, sy = 0, sxx = 0, sxy = 0
      for (let j = 0; j < m; j++) { ld[j] = lp[k0 + j]; sx += j; sy += ld[j]; sxx += j * j; sxy += j * ld[j] }
      let sl = (m * sxy - sx * sy) / (m * sxx - sx * sx), ic = (sy - sl * sx) / m, q = 0, r = 0, w = 0
      for (let j = 0; j < m; j++) ld[j] -= ic + sl * j
      if (back) { for (let j = 0; j < m; j++) { q += ld[j] * lq[j]; r += ld[j] * ld[j]; w += lq[j] * lq[j] } if (r > 0 && w > 0) lfC[t] = q / Math.sqrt(r * w) }
      valid[t] = back
      u++; t++
    }, { frameSize: N, hopSize: hop })
  }
  let peak = 0
  for (let i = 0; i < T; i++) if (tot[i] > peak) peak = tot[i]
  if (!(peak > 0)) return null
  let act = 0, na = 0
  for (let i = 0; i < T; i++) if (tot[i] >= peak * 1e-4) { act += tot[i]; na++ }
  return { fs, hop, T, B, nb, test, L, F, C, tot, lf, mf, lfC, valid, peak, act: act / na, hi, mid, aShare: aw2 / all }
}

// Hum, by dehum's own measurement over the first 90 s, and how loud: the lines it finds (Goertzel power over the
// same span), A-weighted (IEC 61672-1), over the program's A-weighted power, dB. The ear hears 50 Hz 30 dB less
// than 1 kHz: a lone 60 Hz line 30 dB under a voice is there, and under the threshold of hearing at its level.
function humLevel(data, fs, s) {
  let x = data.subarray(0, Math.min(data.length, Math.round(90 * fs))), m = humMeasure(x, fs)
  if (!m) return { f0: 0, harmonics: 0, level: -Infinity }
  let p = 0, h = 0
  for (let i = 0; i < x.length; i++) p += x[i] * x[i]
  for (let k of m.harmonics) h += goertzel(x, k * m.f0, fs) * aWeight(k * m.f0)
  return { f0: m.f0, harmonics: m.harmonics.length, level: 10 * Math.log10(h / (p / x.length * s.aShare) + 1e-30) }
}

// power of the sinusoid at f in x, amplitude² / 2
function goertzel(x, f, fs) {
  let w = 2 * Math.PI * f / fs, c = 2 * Math.cos(w), s1 = 0, s2 = 0
  for (let i = 0; i < x.length; i++) { let s = x[i] + c * s1 - s2; s2 = s1; s1 = s }
  return 2 * (s1 * s1 + s2 * s2 - c * s1 * s2) / x.length / x.length
}

// A-weighting as a power gain (IEC 61672-1 eq. E.1, +2.00 dB at 1 kHz)
function aWeight(f) {
  let f2 = f * f, r = 12194 ** 2 * f2 * f2 / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
  return r * r * 10 ** 0.2
}

// Wind: turbulence at the microphone, energy under a few hundred Hz without a period (Nelke & Vary, IWAENC 2014),
// where a bass line or a voice's low end repeats at its pitch. The share of 0.15 s blocks where, in two frames of
// three, the low end (< 200 Hz) is within 20 dB of the program, 6 dB over the 300–2000 Hz band (pink noise: 2 dB),
// and holds no lines (its median persistence under 0.2). A plosive's thump is over within a block.
function windShare(s) {
  let R = Math.max(1, Math.round(0.15 * s.fs / s.hop)), loud = s.act * 0.01, blocks = 0, windy = 0, c = []
  for (let i = 0; i + R <= s.T; i += R) {
    c.length = 0
    for (let j = i; j < i + R; j++) if (s.valid[j] && s.lf[j] > loud && s.lf[j] > 4 * s.mf[j]) c.push(s.lfC[j])
    blocks++
    if (c.length >= 2 * R / 3 && median(c) < 0.2) windy++
  }
  return blocks ? windy / blocks : 0
}

// The noise bed and the program's level over it, dB; the program: its frames within 40 dB of the loudest. Frames
// within 80 dB of the loudest count: digital silence is no bed. Two kinds of evidence:
//   pauses — runs of 0.15 s or more within 6 dB of the 10th percentile of the frame level that hold noise or hold
//            the floor. Noise: no lines (each band's median persistence there: their median under 0.05, none over
//            0.5) and flat (the bands' median flatness over 0.4; Gaussian noise reads e^−γ ≈ 0.56). The floor: a bed
//            lies under the program all the time, so in every band the pauses sit where the band sinks to over the
//            whole take (its 5th percentile) and no further over it than Gaussian noise's own spread puts them
//            (1.645 · 4.34/√(n/1.5) dB) plus FLOOR_SLACK for the bed's slow wander (the bands' median), with no
//            partials that come and go (the bands' median persistence under 0.1, babble's 0.04–0.08). A line held
//            through every pause, an engine's, a fan's, a mains-like tone, is part of the floor; a quiet passage of
//            music isn't: its notes come and go, and its pauses stand over the floors other passages sink to. The
//            bed: the pauses' median level. A voice pauses; a dense mix doesn't sink that long without its partials,
//            nor does a held note.
//   steady — bands whose frames at or under the band's median level spread no more than twice what Gaussian noise
//            would over its bins (4.34/√(n/1.5) dB, Hann-windowed bins correlated in pairs) and hold no lines
//            (median persistence under 0.05): stationary noise where the program doesn't reach. The bed: those
//            frames' mean power, summed over such bands.
// The SNR is the lower of the two; steady when the steady bands alone put the bed within BED_SNR.
function noiseBed({ T, B, nb, test, L, F, C, tot, valid, peak, act, hop, fs }) {
  let keep = []
  for (let t = 0; t < T; t++) if (valid[t] && tot[t] > peak * 1e-8) keep.push(t)
  if (keep.length < 8) return { snr: Infinity, steady: false }
  let lv = keep.map(t => 10 * Math.log10(tot[t])), q10 = quantile(lv, 0.1), run = Math.round(0.15 * fs / hop), pause = []
  for (let j = 0, e; j < keep.length; j = Math.max(e, j + 1)) {
    for (e = j; e < keep.length && lv[e] <= q10 + 6 && keep[e] - keep[j] === e - j; e++);
    if (e - j >= run) for (let i = j; i < e; i++) pause.push(keep[i])
  }
  let at = (A, ts, b) => median(ts.map(t => A[t * B + b]).filter(v => v === v))
  let snrP = Infinity
  if (pause.length) {
    let c = [], f = [], over = []
    for (let b = 0; b < B; b++) if (test[b]) {
      c.push(at(C, pause, b)); f.push(at(F, pause, b))
      over.push(at(L, pause, b) - quantile(keep.map(t => L[t * B + b]), 0.05) - 1.645 * 4.343 / Math.sqrt(nb[b] / 1.5))
    }
    let noise = median(c) < 0.05 && Math.max(...c) < 0.5 && median(f) > 0.4, floor = median(over) <= FLOOR_SLACK && median(c) < 0.1
    if (noise || floor) snrP = 10 * Math.log10(act / median(pause.map(t => tot[t])))
  }
  let bed = 0
  for (let b = 0; b < B; b++) {
    if (!test[b]) continue
    let md = at(L, keep, b), lo = keep.filter(t => L[t * B + b] <= md), l = lo.map(t => L[t * B + b])
    let mean = l.reduce((s, v) => s + v, 0) / l.length, sd = Math.sqrt(l.reduce((s, v) => s + (v - mean) ** 2, 0) / l.length)
    if (sd <= 2 * 4.343 / Math.sqrt(nb[b] / 1.5) && at(C, lo, b) < 0.05) bed += l.reduce((s, v) => s + 10 ** (v / 10), 0) / l.length * nb[b]
  }
  let snrE = bed > 0 ? 10 * Math.log10(act / bed) : Infinity
  return { snr: Math.min(snrP, snrE), steady: snrE < BED_SNR }
}

/** Impulses per second. The AR(30) prediction error, per window of 4096, judged against its local scale σ: the
 *  median of its 1.5 ms block RMS over ±12 ms (declick's: a click can't raise the bar it must clear). An impulse
 *  stands over 32σ, 5 ms or more from the last, and alone: no like of half its size 2.5–40 ms either side (a voice's
 *  pulses, creak down to 25 Hz, a plucked string repeat), and no sound 10 dB louder over the 3–20 ms after it than
 *  before (a plosive's burst or a note's attack begins one). Over the whole signal up to 30 s, else 30 spans of 1 s
 *  spread across it. VoiceBank's clean takes carry lip smacks of 32–124σ themselves; the bar is set over most. */
function impulseRate(data, fs) {
  const P = 30, W = 4096, K = 32, ms = fs / 1000
  let near = Math.round(2.5 * ms), far = Math.round(40 * ms), gap = Math.round(5 * ms), a = Math.round(3 * ms), z = Math.round(20 * ms)
  let n = data.length, whole = n <= 30 * fs, len = whole ? n : Math.round(fs), count = whole ? 1 : 30
  let stride = count > 1 ? (n - len) / (count - 1) : 0, events = 0, seconds = 0
  for (let w = 0; w < count; w++) {
    let x = data.subarray(Math.round(w * stride), Math.round(w * stride) + len)
    if (x.length < 2 * far + W) continue
    let e = residual(x, P, W), Bk = Math.round(1.5 * ms), sg = scale(e, Bk, 8), last = -gap
    for (let i = far; i < x.length - far; i++) {
      let v = Math.abs(e[i]), s = sg[(i / Bk) | 0]
      if (!(s > 0 && v > K * s && i - last > gap)) continue
      last = i
      let m = 0
      for (let j = i - far; j <= i + far; j++) if (Math.abs(j - i) >= near && Math.abs(e[j]) > m) m = Math.abs(e[j])
      if (v > 2 * m && power(x, i + a, i + z) < 10 * power(x, i - z, i - a)) events++
    }
    seconds += (x.length - 2 * far) / fs
  }
  return seconds ? events / seconds : 0
}

// AR(p) prediction error of x, a fit per window of W samples
function residual(x, p, W) {
  let e = new Float64Array(x.length)
  for (let s = 0; s + 2 * p < x.length; s += W - p) {
    let seg = x.subarray(s, Math.min(x.length, s + W)), a
    try { ({ a } = arFit(seg, p)) } catch { continue }
    if (!a.every(Number.isFinite)) continue
    for (let i = p; i < seg.length; i++) { let v = seg[i]; for (let k = 1; k <= p; k++) v += a[k] * seg[i - k]; e[s + i] = v }
  }
  return e
}

// per block of B samples: the median, over ±R blocks, of the blocks' RMS
function scale(e, B, R) {
  let nb = Math.ceil(e.length / B), rms = new Float64Array(nb), sg = new Float64Array(nb)
  for (let b = 0; b < nb; b++) rms[b] = Math.sqrt(power(e, b * B, (b + 1) * B))
  for (let b = 0; b < nb; b++) sg[b] = median(rms.subarray(Math.max(0, b - R), Math.min(nb, b + R + 1)))
  return sg
}

function power(x, a, b) { a = Math.max(0, a); b = Math.min(x.length, b); let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return b > a ? s / (b - a) : 0 }
function median(a) { return quantile(a, 0.5) }
function quantile(a, q) { let s = Float64Array.from(a).sort(); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN }
