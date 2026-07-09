
const db2lin = db => Math.pow(10, db / 20)
// Look-ahead noise gate with hysteresis.
//   - Detection envelope tracks |x| with attack/release time constants
//   - Hysteresis: separate open/close thresholds prevents chatter near the threshold
//   - Look-ahead: detection reads `lookahead` samples ahead of the sample being
//     gated so the attack opens *before* the transient, preserving onsets. Output
//     stays sample-aligned with input (no net latency, no dropped tail).
//
// Returns the same buffer modified in-place. Pass the same params object on every
// call to persist envelope/gain state across blocks.


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
  let openGate = (1 + range) / 2                   // midpoint of open(1)/closed(range)

  let env = params._env ?? 0
  let gain = params._gain ?? range
  let holdLeft = params._hold ?? 0

  let n = data.length
  for (let i = 0; i < n; i++) {
    // Detection peeks ahead within the buffer (clamped at the end); reading a
    // future, not-yet-written sample is safe in-place since we only write data[i].
    let xa = Math.abs(data[i + laSamples < n ? i + laSamples : n - 1])
    if (xa > env) env = aA * env + (1 - aA) * xa
    else env = aR * env + (1 - aR) * xa

    let target
    if (env > openTh) { target = 1; holdLeft = holdSamples }
    else if (env > closeTh || holdLeft > 0) target = gain > openGate ? 1 : range
    else target = range
    if (holdLeft > 0) holdLeft--

    if (target > gain) gain = aA * gain + (1 - aA) * target
    else gain = aR * gain + (1 - aR) * target

    data[i] = data[i] * gain
  }

  params._env = env
  params._gain = gain
  params._hold = holdLeft
  return data
}
