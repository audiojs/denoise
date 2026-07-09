// denoise — content-aware auto-selector that classifies the dominant noise type
// in `data` and dispatches to the most suitable single-pass method.
//
// Classification (single STFT sweep over the input):
//   - hum   — narrow peaks at mains harmonics (Goertzel) → dehum
//   - click — high kurtosis of AR residual → declick
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
import deesser from '@audio/denoise-deesser'
import dereverb from '@audio/denoise-dereverb'

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

  // Click score: max AR-residual excess kurtosis over windows spanning the whole
  // signal. Clicks are sparse and impulsive — a fixed prefix window can miss them
  // entirely, so scan across and take the peak (the window holding a click spikes).
  let clickScore = 0
  let cw = 4096
  if (data.length >= cw) {
    let stride = Math.max(cw, Math.floor((data.length - cw) / 8) || cw)
    for (let start = 0; start + cw <= data.length; start += stride) {
      let seg = data.subarray(start, start + cw)
      try {
        let { a } = arFit(seg, 30)
        let resid = new Float64Array(cw), mean = 0, m2 = 0, m4 = 0
        for (let i = 30; i < cw; i++) {
          let s = seg[i]
          for (let k = 1; k <= 30; k++) s += a[k] * seg[i - k]
          resid[i] = s; mean += s
        }
        mean /= (cw - 30)
        for (let i = 30; i < cw; i++) { let d = resid[i] - mean; m2 += d * d; m4 += d * d * d * d }
        m2 /= (cw - 30); m4 /= (cw - 30)
        let ex = m2 > 0 ? m4 / (m2 * m2) - 3 : 0       // excess kurtosis
        if (ex > clickScore) clickScore = ex
      } catch {}
    }
  }

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
  else if (clickScore > 12) method = 'declick'
  else if (hiRatio > 8) method = 'deesser'                // white noise scores ~3.9 by bandwidth alone
  else if (lfRatio > 3) method = 'dewind'
  else if (floorCV > 0.3) method = 'omlsa'         // white ~0.06 · rumble ~0.2 · babble ~0.5

  return { method, scores, humFreq }
}

// Goertzel power at frequency f.
function goertzelE(data, f, fs) {
  let w = 2 * Math.PI * f / fs, c = 2 * Math.cos(w), s1 = 0, s2 = 0
  for (let i = 0; i < data.length; i++) { let s = data[i] + c * s1 - s2; s2 = s1; s1 = s }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / data.length
}
