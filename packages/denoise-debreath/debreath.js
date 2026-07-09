// De-breath — VAD-driven downward attenuation during non-speech regions.
//
// Runs a frame-based VAD; for samples in inactive frames applies `range` dB cut
// with attack/release smoothing. Distinct from gate by:
//   - decision is spectral (energy + flatness), not amplitude — catches breath
//     even when its peak is similar to speech low energy
//   - default attenuation is moderate (-12 dB), preserves naturalness vs full mute

import { vad as runVad } from '@audio/vad'
import { db2lin } from '@audio/denoise-core'

export default function debreath(data, params = {}) {
  let fs = params.fs || 44100
  let range = params.range ?? -12
  let attack = params.attack ?? 0.005
  let release = params.release ?? 0.1
  let snrTh = params.snrTh ?? 4
  let flatTh = params.flatTh ?? 0.5

  let { active, hop, frameSize } = runVad(data, { fs, snrTh, flatTh, frameSize: 1024, hopSize: 256 })
  let cut = db2lin(range)
  let aA = Math.exp(-1 / (attack * fs))
  let aR = Math.exp(-1 / (release * fs))
  let gain = 1

  for (let i = 0; i < data.length; i++) {
    let f = Math.min(active.length - 1, Math.floor((i - frameSize / 2) / hop))
    let target = (f >= 0 && active[f]) ? 1 : cut
    let aRate = target > gain ? aA : aR
    gain = aRate * gain + (1 - aRate) * target
    data[i] *= gain
  }
  return data
}
