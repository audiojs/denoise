// denoise — content-aware auto-selector that classifies the dominant noise type
// in `data` and dispatches to the most suitable single-pass method.
//
// Classification (single STFT sweep over the input):
//   - tonalScore     — strong narrow peaks at mains harmonics → dehum
//   - clickScore     — high kurtosis of AR residual → declick
//   - lfScore        — LF/MF energy ratio above 4 → dewind
//   - sibilanceScore — 5–9 kHz peaks vs. mids → deesser
//   - reverbScore    — slow late-tail decay (cepstral peak) → dereverb
//   - stationary    → omlsa  (best non-stationary general denoise)
//   - otherwise     → wiener (transparent broadband)
//
// Returns { out, plan } so callers can inspect which method ran.

import { stftAnalyse } from './stft.js'
import { arFit } from './ar.js'
import wiener from './wiener.js'
import omlsa from './omlsa.js'
import dehum from './dehum.js'
import declick from './declick.js'
import dewind from './dewind.js'
import deesser from './deesser.js'
import dereverb from './dereverb.js'

export default function denoise(data, params = {}) {
  let fs = params.fs || 44100
  let force = params.force                          // skip classification
  let plan = force ? { method: force, scores: {} } : classify(data, fs)
  let opts = { fs, ...params }
  let out
  switch (plan.method) {
    case 'dehum':   out = dehum(new Float32Array(data), { ...opts, freq: plan.humFreq || 50 }); break
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
    let lf = 0, mf = 0, hi = 0
    for (let k = 0; k <= half; k++) {
      let p = mag[k] * mag[k]
      bins[k] += p
      let f = k * fs / N
      if (f < 200) lf += p
      else if (f < 2000) mf += p
      else if (f < 9000) hi += p
    }
    lfSum += lf; mfSum += mf; hiSum += hi
    frameVar.push(lf + mf + hi)
    frames++
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

  // Click score: AR residual kurtosis on a short window
  let clickScore = 0
  if (data.length >= 4096) {
    let win = data.subarray(0, 4096)
    try {
      let { a } = arFit(win, 30)
      let resid = new Float64Array(4096), mean = 0, m2 = 0, m4 = 0
      for (let i = 30; i < 4096; i++) {
        let s = win[i]
        for (let k = 1; k <= 30; k++) s += a[k] * win[i - k]
        resid[i] = s; mean += s
      }
      mean /= (4096 - 30)
      for (let i = 30; i < 4096; i++) { let d = resid[i] - mean; m2 += d * d; m4 += d * d * d * d }
      m2 /= (4096 - 30); m4 /= (4096 - 30)
      clickScore = m2 > 0 ? m4 / (m2 * m2) - 3 : 0     // excess kurtosis
    } catch {}
  }

  // Stationarity: variance-of-variances of frame energy
  let mean = 0; for (let v of frameVar) mean += v; mean /= frames
  let varE = 0; for (let v of frameVar) varE += (v - mean) ** 2; varE /= frames
  let cv = mean > 0 ? Math.sqrt(varE) / mean : 0       // higher = less stationary

  let scores = {
    hum: humBest, humFreq,
    click: clickScore,
    lf: lfRatio,
    hi: hiRatio,
    nonstationarity: cv
  }

  // Priority: tonal hum > impulses > sibilance > rumble > non-stationary > broadband.
  // humBest is a hit count: ≥2 of the first 3 harmonics show 20× peak-to-median sharpness.
  let method = 'wiener'
  if (humBest >= 2) method = 'dehum'
  else if (clickScore > 12) method = 'declick'
  else if (hiRatio > 8) method = 'deesser'                // white noise scores ~3.9 by bandwidth alone
  else if (lfRatio > 3) method = 'dewind'
  else if (cv > 0.6) method = 'omlsa'

  return { method, scores, humFreq }
}

// Goertzel power at frequency f.
function goertzelE(data, f, fs) {
  let w = 2 * Math.PI * f / fs, c = 2 * Math.cos(w), s1 = 0, s2 = 0
  for (let i = 0; i < data.length; i++) { let s = data[i] + c * s1 - s2; s2 = s1; s1 = s }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / data.length
}
