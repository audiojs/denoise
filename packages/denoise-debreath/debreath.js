// De-breath — VAD-driven downward attenuation between phrases.
//
// @audio/vad marks speech: voicing, and the sound over the noise floor next to it. Everything else (breaths, mouth
// noise, the room) is turned down by `range` dB. Distinct from gate by:
//   - the decision is voicing, not amplitude: a breath as loud as a soft word is still a breath, a soft word in
//     noise is still a word
//   - default attenuation is moderate (-12 dB), preserves naturalness vs full mute
//
// The whole clip is at hand (the manifest is streaming: false), so the gain is zero-phase: it rises over `attack`
// before speech starts and falls over `release` once speech has held HOLD s past its last frame.

import { vad as runVad } from '@audio/vad'

const db2lin = db => Math.pow(10, db / 20)
const BREATH = 0.15                  // s: a breath lasts 0.15-0.6 s (Ruinskiy & Lavner 2007); a shorter gap is a stop, a word boundary
const HOLD = 0.05                    // s the gain holds past speech: a word's decay under the noise floor still sounds

export default function debreath(data, params = {}) {
  let fs = params.fs || 44100
  let range = params.range ?? -12
  let attack = params.attack ?? 0.005
  let release = params.release ?? 0.1

  let { active, hop, frameSize: N } = runVad(data, { fs })
  let F = active.length, n = data.length
  if (!F) return data
  let keep = speech(active, Math.round(HOLD * fs / hop), Math.round(BREATH * fs / hop))

  // per sample, the frame whose centre is nearest; then release runs forward from each speech end, attack backward
  // from each speech start, and the gain is the larger: 1 wherever speech is
  let cut = db2lin(range), aA = Math.exp(-1 / (attack * fs)), aR = Math.exp(-1 / (release * fs))
  let target = new Float32Array(n), fw = new Float32Array(n)
  for (let i = 0; i < n; i++) target[i] = keep[Math.min(F - 1, Math.max(0, Math.round((i - N / 2) / hop)))] ? 1 : cut
  for (let i = 0, g = 1; i < n; i++) { let t = target[i]; g = t >= g ? t : aR * g + (1 - aR) * t; fw[i] = g }
  for (let i = n - 1, g = 1; i >= 0; i--) { let t = target[i]; g = t >= g ? t : aA * g + (1 - aA) * t; data[i] *= Math.max(g, fw[i]) }
  return data
}

// speech frames held `hold` frames either side; a gap between them shorter than `breath` frames is kept too
function speech(active, hold, breath) {
  let F = active.length, keep = new Uint8Array(F)
  for (let f = 0; f < F; f++) if (active[f]) keep.fill(1, Math.max(0, f - hold), Math.min(F, f + hold + 1))
  for (let f = 0; f < F;) {
    if (keep[f]) { f++; continue }
    let g = f
    while (g < F && !keep[g]) g++
    if (g - f < breath && f > 0 && g < F) keep.fill(1, f, g)
    f = g
  }
  return keep
}
