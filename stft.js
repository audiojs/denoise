// STFT analysis-modification-synthesis with OLA reconstruction.
// `process(mag, phase, state, ctx)` returns { mag, phase } for synthesis.
// State persists across frames; OLA divides by ∑win² to make windowing transparent.
//
// Two flavours:
//   stftBatch — process whole signal, return Float32Array
//   stftStream — write(chunk) / write() pull-based wrapper for real-time

import { fft, ifft } from 'fourier-transform'
import { hannWindow, makeStreamBufs, appendIn, growOut, compactIn, take, normFloor, PI2 } from './util.js'

export function wrapPhase(p) { return p - Math.round(p / PI2) * PI2 }

function frame(data, pos, win, half, process, state, ctx, sc) {
  let N = win.length, f = sc.f
  for (let i = 0; i < N; i++) f[i] = (data[pos + i] || 0) * win[i]

  let [re, im] = fft(f)
  let mag = sc.mag, phase = sc.phase
  for (let k = 0; k <= half; k++) {
    mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
    phase[k] = Math.atan2(im[k], re[k])
  }

  let r = process(mag, phase, state, ctx)
  let r2 = sc.r2, i2 = sc.i2
  for (let k = 0; k <= half; k++) {
    r2[k] = r.mag[k] * Math.cos(r.phase[k])
    i2[k] = r.mag[k] * Math.sin(r.phase[k])
  }
  return ifft(r2, i2)
}

function scratch(N, half) {
  return {
    f: new Float64Array(N),
    mag: new Float64Array(half + 1),
    phase: new Float64Array(half + 1),
    r2: new Float64Array(half + 1),
    i2: new Float64Array(half + 1)
  }
}

export function stftBatch(data, process, opts) {
  let N = opts?.frameSize || 2048
  let hop = opts?.hopSize || (N >> 2)
  let half = N >> 1
  let win = hannWindow(N)
  let ctx = { hop, half, N, fs: opts?.fs || 44100, freqPerBin: PI2 / N }

  let outLen = data.length
  let out = new Float32Array(outLen)
  let norm = new Float32Array(outLen)
  let state = {}
  let sc = scratch(N, half)
  let pos = 0

  while (pos + N <= outLen + hop) {
    let sf = frame(data, pos, win, half, process, state, ctx, sc)
    for (let i = 0; i < N && pos + i < outLen; i++) {
      out[pos + i] += sf[i] * win[i]
      norm[pos + i] += win[i] * win[i]
    }
    pos += hop
  }

  let nf = normFloor(win, hop)
  for (let i = 0; i < outLen; i++) {
    let n = Math.max(norm[i], nf)
    if (n > 1e-8) out[i] /= n
  }
  return out
}

export function stftStream(process, opts) {
  let N = opts?.frameSize || 2048
  let hop = opts?.hopSize || (N >> 2)
  let half = N >> 1
  let win = hannWindow(N)
  let ctx = { hop, half, N, fs: opts?.fs || 44100, freqPerBin: PI2 / N }
  let state = {}, sc = scratch(N, half)
  let nf = normFloor(win, hop)

  let st = makeStreamBufs(N, nf)
  let aPos = 0, flushed = false

  function run() {
    while (aPos + N <= st.il) {
      let sf = frame(st.ib, aPos, win, half, process, state, ctx, sc)
      growOut(st, st.pos + N)
      let ob = st.ob, nb = st.nb, base = st.pos
      for (let i = 0; i < N; i++) {
        ob[base + i] += sf[i] * win[i]
        nb[base + i] += win[i] * win[i]
      }
      aPos += hop
      st.pos += hop
    }
    if (aPos > N * 2) { compactIn(st, aPos - N); aPos -= aPos - N }
  }

  return {
    write(chunk) {
      appendIn(st, chunk); run()
      return take(st, Math.max(0, st.pos - N + hop))
    },
    flush() {
      if (!flushed) { appendIn(st, new Float32Array(N)); flushed = true }
      run()
      return take(st, st.pos)
    }
  }
}

// Analysis-only sweep — visit every frame's magnitude+phase but produce no output.
// Used by VAD, noise-profile estimators, dereverb late-tail estimation.
export function stftAnalyse(data, visit, opts) {
  let N = opts?.frameSize || 2048
  let hop = opts?.hopSize || (N >> 2)
  let half = N >> 1
  let win = hannWindow(N)
  let f = new Float64Array(N)
  let mag = new Float64Array(half + 1), phase = new Float64Array(half + 1)

  for (let pos = 0; pos + N <= data.length; pos += hop) {
    for (let i = 0; i < N; i++) f[i] = data[pos + i] * win[i]
    let [re, im] = fft(f)
    for (let k = 0; k <= half; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      phase[k] = Math.atan2(im[k], re[k])
    }
    visit(mag, phase, pos)
  }
}
