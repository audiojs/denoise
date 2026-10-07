// De-breath: the breaths between phrases go down by `range`; the room around them, and the speech, stay.
//
// A breath is told by what an inhalation is (Ruinskiy & Lavner, IEEE TASLP 15(3), 2007): unvoiced, longer than a
// consonant, well under the speech, between phrases, its noise shaped by the open tract. Per frame of @audio/vad, on
// the 0.3–8 kHz band: 10 dB or more over the room (the band's 10th-percentile frame) and 12 dB or more under the speech
// (its 95th), under half of it over 4 kHz (no sibilant, whose noise lies there) and under 80 % of it under 1 kHz (a
// breath's noise lies over the open tract's formants, 1–4 kHz; a phrase's decaying vowel, its murmur and creak lie
// under 1 kHz, and a breath that follows one within two frames no longer runs into it). Runs of such frames, bridged
// over two, are a breath when
//   - they last 0.15–1 s (a breath 0.15–0.6 s and more, Ruinskiy & Lavner; a consonant is shorter), their median 14 dB
//     or more over the room, under 60 % of their energy under 1 kHz,
//   - at most half their frames voiced: periodic in the 50–1000 Hz band, where a voice's first harmonics lie (Talkin's
//     normalized cross-correlation, its peak over 60–400 Hz lags of a 40 ms window, 0.6 or more), that band 6 dB or
//     more over its room (a room's hum is periodic too). A breath's noise through narrow resonances, or a codec's bands,
//     reads as periodic higher up: @audio/vad's voicing, over 60 Hz–4 kHz, called most frames of such breaths voiced,
//   - and a frame at the room's level lies within 0.1 s on either side: a pause, which a word's own consonants have not.
// The cut, on the band over 300 Hz (the room's rumble under a breath is the room's), reaches `range` over `attack` and
// leaves over `release` inside the breath, never under the room's level in that band (a breath taken down past its
// room leaves a hole in it). The whole clip is read at once (streaming: false).
//
// `room` (dB, default 0) also turns down what is neither speech nor breath, as 0.2 did: everything @audio/vad does not
// call speech, the gain zero-phase, rising over `attack` before speech and falling over `release` after it.

import { vad as runVad } from '@audio/vad'
import { highpass, lowpass, process as filter } from '@audio/biquad'

const db2lin = db => Math.pow(10, db / 20)
const OVER = 10, UNDER = 1 / 16, MEDIAN = 10 ** 1.4      // × the room, × the speech: a breath frame's level; its run's median
const SHORT = 0.15, LONG = 1                               // s, a breath's length
const PAUSE = 0.1                                          // s: a pause within this
const LOW = 0.6, SHAPE = 0.8                               // share of a breath under 1 kHz, at most: the run's, a frame's
const VOICED = 0.5, PERIODIC = 0.6                         // share of a breath's frames voiced, at most; a voiced frame's NCCF
const HOLD = 0.05                                          // room: s the gain holds past speech
const GAP = 0.15                                           // room: a shorter gap between speech is kept

export default function debreath(data, params = {}) {
  let fs = params.fs || 44100, range = params.range ?? -12, room = params.room ?? 0
  let attack = params.attack ?? 0.005, release = params.release ?? 0.01
  let { active, hop, frameSize: N } = runVad(data, { fs })
  let F = active.length, n = data.length
  if (!F) return data
  let gain = new Float32Array(n).fill(1), high = null
  if (range < 0 && breaths(data, fs, F, hop, N, range, attack, release, gain)) {
    // the cut on the band over 300 Hz alone, x − (1 − g)·HP(x), HP forward and backward (zero phase): the room's rumble
    // under a breath stays, and with no breath the input is untouched
    high = Float64Array.from(data)
    for (let c of [highpass(300, Math.SQRT1_2, fs)]) { filter(high, c); high.reverse(); filter(high, c); high.reverse() }
    for (let i = 0; i < n; i++) if (gain[i] < 1) data[i] -= (1 - gain[i]) * high[i]
  }
  if (room < 0) {
    gain.fill(1)
    between(active, hop, N, room, attack, release, gain, fs)
    for (let i = 0; i < n; i++) data[i] *= gain[i]
  }
  return data
}

// the breaths, taken down into `gain`
function breaths(data, fs, F, hop, N, range, attack, release, gain) {
  let c0 = (N - hop) >> 1, bp = (lo, hi) => [highpass(lo, 0.5412, fs), highpass(lo, 1.3066, fs), lowpass(hi, 0.5412, fs), lowpass(hi, 1.3066, fs)]
  let top = Math.min(8000, 0.45 * fs), B = bands(data, hop, c0, F, bp(300, top))
  let H = bands(data, hop, c0, F, bp(Math.min(4000, 0.9 * top), top)), L = bands(data, hop, c0, F, bp(300, 1000))
  let speech = pct(B, 0.95), floor = Math.max(pct(B, 0.1), speech * 1e-7), cut = db2lin(range), found = false
  let c = new Uint8Array(F), fr = t => Math.round(t * fs / hop), voiced = null
  for (let f = 0; f < F; f++) c[f] = B[f] > OVER * floor && B[f] < UNDER * speech && H[f] < 0.5 * B[f] && L[f] < SHAPE * B[f] ? 1 : 0
  for (let f = 1; f + 2 < F; f++) if (!c[f] && c[f - 1] && (c[f + 1] || c[f + 2])) c[f] = 1
  for (let f = 0; f < F;) {
    if (!c[f]) { f++; continue }
    let g = f, pause = false, sb = 0, sl = 0, nv = 0
    while (g < F && c[g]) g++
    for (let k = Math.max(0, f - fr(PAUSE)); k < Math.min(F, g + fr(PAUSE)); k++) if (k < f || k >= g) pause ||= B[k] < 4 * floor
    for (let k = f; k < g; k++) sb += B[k], sl += L[k]
    if (g - f >= fr(SHORT) && g - f <= fr(LONG) && pause) for (let k = f; k < g; k++) nv += (voiced ||= voicing(data, fs, hop, c0, F))(k)
    if (g - f >= fr(SHORT) && g - f <= fr(LONG) && pause && nv <= VOICED * (g - f) && pct(B.subarray(f, g), 0.5) > MEDIAN * floor && sl < LOW * sb) {
      // samples [a, b): the frames' centres; the cut, never under the room, ramps in and out inside them
      let a = f * hop + c0, b = Math.min(gain.length, g * hop + c0), depth = Math.max(cut, Math.sqrt(floor / pct(B.subarray(f, g), 0.5)))
      found = true
      let ra = Math.max(1, Math.min(Math.round(attack * fs), (b - a) >> 2)), rr = Math.max(1, Math.min(Math.round(release * fs), (b - a) >> 2))
      for (let i = a; i < b; i++) {
        let w = i - a < ra ? 0.5 - 0.5 * Math.cos(Math.PI * (i - a) / ra) : b - i <= rr ? 0.5 - 0.5 * Math.cos(Math.PI * (b - i) / rr) : 1
        gain[i] = Math.min(gain[i], 1 - (1 - depth) * w)
      }
    }
    f = g
  }
  return found
}

// mean square of x through `cs` per hop, over each VAD frame's centre
function bands(x, hop, c0, F, cs) {
  let y = Float64Array.from(x), out = new Float64Array(F)
  for (let c of cs) filter(y, c)
  for (let f = 0; f < F; f++) { let s = 0, a = f * hop + c0; for (let i = a; i < a + hop && i < y.length; i++) s += y[i] * y[i]; out[f] = s / hop }
  return out
}
const pct = (v, p) => { let s = Float64Array.from(v).sort(); return s.length ? s[Math.floor(p * (s.length - 1))] : 0 }

// whether a frame is voiced, read in the 50–1000 Hz band, where a voice's first harmonics lie: the band 6 dB or more over
// its 10th-percentile frame (a room's hum, periodic as it is, stays at the room's level there through a breath), and
// periodic, Talkin's normalized cross-correlation (RAPT, 1995) at ~8 kHz PERIODIC or more at the lags of a 60–400 Hz
// pitch, over a 40 ms window on the frame's hop
function voicing(x, fs, hop, c0, F) {
  let top = Math.min(1000, 0.45 * fs), cs = [highpass(50, 0.5412, fs), highpass(50, 1.3066, fs), lowpass(top, 0.5412, fs), lowpass(top, 1.3066, fs)]
  let V = bands(x, hop, c0, F, cs), room = 4 * pct(V, 0.1), b = Float64Array.from(x), d = Math.max(1, Math.round(fs / 8000)), q = fs / d
  for (let c of cs) filter(b, c)
  let y = Float64Array.from({ length: Math.floor(b.length / d) }, (_, i) => b[i * d]), W = Math.round(0.04 * q), lo = Math.floor(q / 400), hi = Math.ceil(q / 60)
  return f => {
    let s = Math.round((f * hop + c0 + hop / 2) / d) - (W >> 1), e0 = 0
    if (!(V[f] > room) || s < 0 || s + W + hi > y.length) return false
    for (let i = 0; i < W; i++) e0 += y[s + i] * y[s + i]
    for (let t = lo; t <= hi; t++) {
      let xy = 0, e1 = 0
      for (let i = 0; i < W; i++) xy += y[s + i] * y[s + i + t], e1 += y[s + i + t] * y[s + i + t]
      if (xy >= PERIODIC * Math.sqrt(e0 * e1)) return true
    }
    return false
  }
}

// what @audio/vad does not call speech goes down by `room`: speech frames held HOLD either side, gaps under GAP kept;
// per sample, the frame whose centre is nearest; release runs forward from each speech end, attack backward from each
// speech start, the gain the larger: 1 wherever speech is
function between(active, hop, N, room, attack, release, gain, fs) {
  let F = active.length, n = gain.length, keep = new Uint8Array(F), hold = Math.round(HOLD * fs / hop), gap = Math.round(GAP * fs / hop)
  for (let f = 0; f < F; f++) if (active[f]) keep.fill(1, Math.max(0, f - hold), Math.min(F, f + hold + 1))
  for (let f = 0; f < F;) {
    if (keep[f]) { f++; continue }
    let g = f
    while (g < F && !keep[g]) g++
    if (g - f < gap && f > 0 && g < F) keep.fill(1, f, g)
    f = g
  }
  let cut = db2lin(room), aA = Math.exp(-1 / (attack * fs)), aR = Math.exp(-1 / (release * fs)), target = new Float32Array(n), fw = new Float32Array(n)
  for (let i = 0; i < n; i++) target[i] = keep[Math.min(F - 1, Math.max(0, Math.round((i - N / 2) / hop)))] ? 1 : cut
  for (let i = 0, g = 1; i < n; i++) { let t = target[i]; g = t >= g ? t : aR * g + (1 - aR) * t; fw[i] = g }
  for (let i = n - 1, g = 1; i >= 0; i--) { let t = target[i]; g = t >= g ? t : aA * g + (1 - aA) * t; gain[i] = Math.min(gain[i], Math.max(g, fw[i])) }
}
