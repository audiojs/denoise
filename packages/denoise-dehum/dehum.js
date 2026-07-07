// Mains hum / tonal noise removal via cascaded high-Q biquad notches.
//   - Default freq 50 Hz (EU); set { freq: 60 } for US
//   - Notches placed at fundamental + N harmonics
//   - Optional adaptive tracking: refines fundamental ±drift Hz from STFT peak energy
//
// Returns the same buffer modified in-place. Pass the same params object across blocks
// so biquad state and tracker phase carry over.

import { biquadCascade, notchCoefs } from '@audio/denoise-core'

export default function dehum(data, params = {}) {
  let freq = params.freq ?? 50
  let harmonics = params.harmonics ?? 4
  let Q = params.Q ?? 30
  let fs = params.fs || 44100
  let adaptive = params.adaptive ?? false
  let drift = params.drift ?? 0.5                  // Hz tracking range

  // Lazy build per (freq, harmonics, Q, fs) signature.
  if (!params._coefs || params._sig !== `${freq}|${harmonics}|${Q}|${fs}`) {
    let coefs = []
    for (let h = 1; h <= harmonics; h++) {
      let f = freq * h
      if (f >= fs / 2) break
      coefs.push(notchCoefs(f, Q, fs))
    }
    params._coefs = coefs
    params._state = coefs.map(() => [0, 0])
    params._sig = `${freq}|${harmonics}|${Q}|${fs}`
    params._fEst = freq
  }

  if (adaptive) {
    let f = trackMains(data, params._fEst, drift, fs)
    if (f !== params._fEst) {
      let coefs = []
      for (let h = 1; h <= harmonics; h++) {
        let fh = f * h
        if (fh >= fs / 2) break
        coefs.push(notchCoefs(fh, Q, fs))
      }
      params._coefs = coefs
      // keep state arrays — close enough freq, biquad memory still valid
      while (params._state.length < coefs.length) params._state.push([0, 0])
      params._fEst = f
    }
  }

  biquadCascade(data, params._coefs, params._state)
  return data
}

// Goertzel sweep around f₀ ± drift Hz to find the strongest tonal bin.
function trackMains(data, f0, drift, fs) {
  let best = f0, bestE = -1
  let step = 0.05                                  // 0.05 Hz resolution
  for (let f = f0 - drift; f <= f0 + drift; f += step) {
    let w = 2 * Math.PI * f / fs, c = 2 * Math.cos(w), s1 = 0, s2 = 0
    for (let i = 0; i < data.length; i++) {
      let s = data[i] + c * s1 - s2
      s2 = s1; s1 = s
    }
    let e = s1 * s1 + s2 * s2 - c * s1 * s2
    if (e > bestE) { bestE = e; best = f }
  }
  return best
}
