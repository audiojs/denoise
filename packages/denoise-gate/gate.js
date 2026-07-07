// Look-ahead noise gate with hysteresis.
//   - Detection envelope tracks |x| with attack/release time constants
//   - Hysteresis: separate open/close thresholds prevents chatter near the threshold
//   - Look-ahead: detection runs `lookahead` samples ahead of audio so attack opens
//     *before* the transient, preserving onsets
//
// Returns the same buffer modified in-place. Pass the same params object on every
// call to persist envelope state across blocks.

import { db2lin } from '@audio/denoise-core'

export default function gate(data, params = {}) {
  let openTh = db2lin(params.threshold ?? -40)
  let closeTh = db2lin(params.closeThreshold ?? (params.threshold ?? -40) - 6)
  let attack = params.attack ?? 0.001
  let release = params.release ?? 0.05
  let hold = params.hold ?? 0.01                   // s gate stays open after signal drops
  let range = db2lin(params.range ?? -80)          // closed-state attenuation
  let lookahead = params.lookahead ?? 0.005        // s — detection leads audio
  let fs = params.fs || 44100

  let aA = Math.exp(-1 / (attack * fs))
  let aR = Math.exp(-1 / (release * fs))
  let holdSamples = Math.round(hold * fs)
  let laSamples = Math.round(lookahead * fs)

  let env = params._env ?? 0
  let gain = params._gain ?? range
  let holdLeft = params._hold ?? 0
  let lab = params._lab                            // look-ahead delay line for audio
  if (!lab || lab.length !== laSamples) {
    lab = new Float32Array(laSamples || 1)
    params._labPos = 0
  }
  let labPos = params._labPos ?? 0

  let n = data.length
  for (let i = 0; i < n; i++) {
    // Detection runs on incoming sample (the "future" relative to delayed audio).
    let xDet = data[i], xa = Math.abs(xDet)
    if (xa > env) env = aA * env + (1 - aA) * xa
    else env = aR * env + (1 - aR) * xa

    let target
    if (env > openTh) { target = 1; holdLeft = holdSamples }
    else if (env > closeTh || holdLeft > 0) { target = gain > 0.5 ? 1 : range }
    else { target = range }
    if (holdLeft > 0) holdLeft--

    if (target > gain) gain = aA * gain + (1 - aA) * target
    else gain = aR * gain + (1 - aR) * target

    // Pull delayed audio sample, push new one.
    let delayed
    if (laSamples > 0) {
      delayed = lab[labPos]
      lab[labPos] = xDet
      labPos = (labPos + 1) % laSamples
    } else {
      delayed = xDet
    }
    data[i] = delayed * gain
  }

  params._env = env
  params._gain = gain
  params._hold = holdLeft
  params._lab = lab
  params._labPos = labPos
  return data
}
