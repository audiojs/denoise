// denoise — content-aware auto-selector that classifies the dominant noise type
// in `data` and dispatches to the most suitable single-pass method.
//
// Classification (single STFT sweep over the input):
//   - hum   — narrow peaks at mains harmonics (Goertzel) → dehum
//   - click — impulses standing out of the AR residual, over 1 a second → declick
//   - hi    — 5–9 kHz / mid energy ratio → deesser
//   - lf    — LF/mid energy ratio → dewind
//   - stationarity — frame-energy floor CV: stable → wiener, wandering → omlsa
//   - otherwise → wiener (transparent broadband)
//
// dereverb has no reliable single-pass signature, so auto-mode never selects it —
// reach it explicitly via `denoise(data, { force: 'dereverb' })` or `dereverb()`.
// Returns { out, plan } so callers can inspect which method ran.

import { stftAnalyse } from '@audio/stft'
import { arFit } from '@audio/lpc'
import wiener from '@audio/denoise-wiener'
import omlsa from '@audio/denoise-omlsa'
import dehum from '@audio/denoise-dehum'
import declick from '@audio/denoise-declick'
import dewind from '@audio/denoise-dewind'
import deesser_ from '@audio/dynamics-deesser'
import dereverb from '@audio/denoise-dereverb'

// deesser — @audio/dynamics-deesser mode 'band' behind this family's seconds/fs
// API (2026-07 near-dupe merge). Exported: the umbrella index.js re-exports this
// same adapter instead of carrying its own copy.
export const deesser = (data, params = {}) => {
  data.set(deesser_(data, {
    sampleRate: params.fs || 44100,
    mode: 'band',
    fc: params.fc ?? params.freq ?? 6000,   // `freq`: former name
    Q: params.Q ?? 1.4,
    threshold: params.threshold ?? -30,
    ratio: params.ratio ?? 4,
    attack: (params.attack ?? 0.001) * 1000,
    release: (params.release ?? 0.05) * 1000,
    block: params.block,
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
    case 'wiener':
    default:        out = wiener(data, opts)
  }
  return params.returnPlan ? { out, plan } : out
}

export function classify(data, fs = 44100) {
  let N = 2048, hop = 512, half = N >> 1
  let bins = new Float64Array(half + 1)
  let frames = 0
  let lfSum = 0, mfSum = 0, hiSum = 0
  let frameVar = []                                 // for stationarity

  stftAnalyse(data, mag => {
    let lf = 0, mf = 0, hi = 0, tot = 0
    for (let k = 0; k <= half; k++) {
      let p = mag[k] * mag[k]
      bins[k] += p
      tot += p
      let f = k * fs / N
      if (f < 200) lf += p
      else if (f < 2000) mf += p
      else if (f >= 5000 && f < 9000) hi += p    // sibilance band, kept specific (not 2–9 kHz)
    }
    lfSum += lf; mfSum += mf; hiSum += hi
    frameVar.push(tot)                            // full-spectrum energy — band-restricted
    frames++                                      // sums under-average the floor statistic
  }, { frameSize: N, hopSize: hop })
  if (!frames) return { method: 'wiener', scores: {} }

  // Tonal hum detection via Goertzel: line power vs. off-line power at ±15 Hz.
  // Avoids FFT-bin leakage at low frequencies (50/60 Hz fall between coarse bins).
  // Counts harmonics where on/off ratio ≥ 50; threshold ≥2 means harmonic series
  // is present (rules out arbitrary single tones).
  let chunk = data.length > 16384 ? data.subarray(0, 16384) : data
  let humScore = (f0) => {
    let hits = 0
    for (let h = 1; h <= 3; h++) {
      let f = f0 * h
      if (f > fs / 2 - 50 || f - 15 < 1) break
      let on = goertzelE(chunk, f, fs)
      let offL = goertzelE(chunk, f - 15, fs)
      let offR = goertzelE(chunk, f + 15, fs)
      let off = Math.max((offL + offR) / 2, 1e-30)
      if (on / off > 50) hits++
    }
    return hits
  }
  let s50 = humScore(50), s60 = humScore(60)
  let humBest = Math.max(s50, s60)
  let humFreq = s50 >= s60 ? 50 : 60

  // LF/MF ratio
  let lfRatio = lfSum / Math.max(mfSum, 1e-30)
  // HI/MF ratio
  let hiRatio = hiSum / Math.max(mfSum, 1e-30)

  // Click score: impulses per second. A click stands far out of the AR(30) prediction error around it; a glottal
  // pulse doesn't, its neighbours 2.5–12 ms away being pulses too (the error's kurtosis can't tell them apart:
  // clean narration read 2.5–401 against a trigger of 12).
  let clickScore = impulseRate(data, fs)

  // Noise stationarity: CV of the frame-energy FLOOR (rolling minimum over ~0.75 s).
  // Speech dynamics ride above the floor, so the floor tracks the *noise bed*:
  // stationary noise → stable floor (CV ≈ 0.06 measured on speech+white), babble /
  // wandering beds → drifting floor (CV ≈ 0.5). Raw frame-energy CV can't make this
  // call — speech's own variance trips it regardless of the noise.
  let floorCV = 0
  {
    let D = 64, step = 16, floors = []
    for (let i = D; i < frames; i += step) {
      let mn = Infinity
      for (let j = i - D; j < i; j++) if (frameVar[j] < mn) mn = frameVar[j]
      floors.push(mn)
    }
    if (floors.length >= 3) {
      let m = 0; for (let f of floors) m += f; m /= floors.length
      let v = 0; for (let f of floors) v += (f - m) ** 2; v /= floors.length
      floorCV = m > 0 ? Math.sqrt(v) / m : 0
    }
  }

  let scores = {
    hum: humBest, humFreq,
    click: clickScore,
    lf: lfRatio,
    hi: hiRatio,
    stationarity: floorCV                              // low = stationary noise bed
  }

  // Priority: tonal hum > impulses > sibilance > rumble > stationary → wiener,
  // non-stationary → omlsa (IMCRA keeps adapting where a frozen profile can't).
  // humBest is a hit count: ≥2 of the first 3 harmonics show 20× peak-to-median sharpness.
  let method = 'wiener'
  if (humBest >= 2) method = 'dehum'
  else if (clickScore > CLICK_RATE) method = 'declick'
  else if (hiRatio > 8) method = 'deesser'                // white noise scores ~3.9 by bandwidth alone
  else if (lfRatio > 3) method = 'dewind'
  else if (floorCV > 0.3) method = 'omlsa'         // white ~0.06 · rumble ~0.2 · babble ~0.5

  return { method, scores, humFreq }
}

// Goertzel power at frequency f.
/** Impulses per second a recording must carry for declick. Measured: clean narration, music and a sung vowel 0–0.87;
 *  the same with clicks at 2.5 a second 1.9 and up, faint ones (0.05) 1.3 and up (Spoken Wikipedia takes, lena). */
export const CLICK_RATE = 1

/** Impulses per second. An impulse is an AR(30) residual sample over 12× the residual RMS within ±10 ms that also
 *  towers (2×) over every residual 2.5–15 ms away: a glottal pulse has its like one pitch period off, a click doesn't.
 *  Events 5 ms apart, over up to 64 windows of 4096 samples spread across the signal (≈ 6 s at 44.1 kHz). */
function impulseRate(data, fs) {
  const W = 4096, P = 30, K = 12, M = 2
  const h = Math.round(0.01 * fs), gap = Math.round(0.005 * fs), near = Math.round(0.0025 * fs), far = Math.round(0.015 * fs)
  if (data.length < W || W - P <= 2 * h) return 0
  let count = Math.min(64, Math.floor(data.length / W)), stride = count > 1 ? (data.length - W) / (count - 1) : 0
  let r = new Float64Array(W), events = 0, seconds = 0
  for (let w = 0; w < count; w++) {
    let seg = data.subarray(Math.round(w * stride), Math.round(w * stride) + W), a
    try { ({ a } = arFit(seg, P)) } catch { continue }
    for (let i = P; i < W; i++) { let e = seg[i]; for (let k = 1; k <= P; k++) e += a[k] * seg[i - k]; r[i] = e }
    let e2 = 0, last = -gap
    for (let i = P; i < P + 2 * h; i++) e2 += r[i] * r[i]
    for (let i = P + h; i < W - h; i++) {
      let v = Math.abs(r[i]), rms = Math.sqrt(e2 / (2 * h))
      if (rms > 0 && v > K * rms && i - last > gap) {
        let m = 0
        for (let j = Math.max(P, i - far); j <= Math.min(W - 1, i + far); j++) if (Math.abs(j - i) >= near && Math.abs(r[j]) > m) m = Math.abs(r[j])
        if (v > M * m) { events++; last = i }
      }
      e2 += r[i + h] * r[i + h] - r[i - h] * r[i - h]
    }
    seconds += (W - P - 2 * h) / fs
  }
  return seconds ? events / seconds : 0
}

function goertzelE(data, f, fs) {
  let w = 2 * Math.PI * f / fs, c = 2 * Math.cos(w), s1 = 0, s2 = 0
  for (let i = 0; i < data.length; i++) { let s = data[i] + c * s1 - s2; s2 = s1; s1 = s }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / data.length
}
