// Shared helpers: window functions, dB conversions, biquad cascade, streaming buffers.

export const PI2 = Math.PI * 2

export function clamp(v, min, max) { return v < min ? min : v > max ? max : v }

export function db2lin(db) { return Math.pow(10, db / 20) }
export function lin2db(x) { return 20 * Math.log10(Math.max(x, 1e-30)) }

let _hannCache = new Map()
export function hannWindow(N) {
  let w = _hannCache.get(N)
  if (w) return w
  w = new Float64Array(N)
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(PI2 * i / N))
  _hannCache.set(N, w)
  return w
}

let _sqrtHannCache = new Map()
export function sqrtHannWindow(N) {
  let w = _sqrtHannCache.get(N)
  if (w) return w
  let h = hannWindow(N)
  w = new Float64Array(N)
  for (let i = 0; i < N; i++) w[i] = Math.sqrt(h[i])
  _sqrtHannCache.set(N, w)
  return w
}

// Wrap stream { write, flush } into write(chunk) → process, write() → flush
export function writer(s) { return chunk => chunk ? s.write(chunk) : s.flush() }

// Apply a single biquad section in-place, persisting state in s = [z1, z2].
export function biquad(data, b0, b1, b2, a1, a2, s) {
  let z1 = s[0], z2 = s[1]
  for (let i = 0, l = data.length; i < l; i++) {
    let x = data[i]
    let y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    data[i] = y
  }
  s[0] = z1; s[1] = z2
}

// Cascade of biquad sections. coefs: array of {b0,b1,b2,a1,a2}. state: 2-num arrays per section.
export function biquadCascade(data, coefs, state) {
  for (let i = 0; i < coefs.length; i++) {
    let c = coefs[i]
    biquad(data, c.b0, c.b1, c.b2, c.a1, c.a2, state[i])
  }
}

// RBJ notch (peak-rejection) at fc with quality Q. Normalized a0 = 1.
export function notchCoefs(fc, Q, fs) {
  let w = PI2 * fc / fs
  let cw = Math.cos(w), sw = Math.sin(w)
  let alpha = sw / (2 * Q)
  let a0 = 1 + alpha
  return {
    b0: 1 / a0,
    b1: -2 * cw / a0,
    b2: 1 / a0,
    a1: -2 * cw / a0,
    a2: (1 - alpha) / a0
  }
}

// RBJ high-pass at fc, Q.
export function highpassCoefs(fc, Q, fs) {
  let w = PI2 * fc / fs
  let cw = Math.cos(w), sw = Math.sin(w)
  let alpha = sw / (2 * Q)
  let a0 = 1 + alpha
  return {
    b0: (1 + cw) / 2 / a0,
    b1: -(1 + cw) / a0,
    b2: (1 + cw) / 2 / a0,
    a1: -2 * cw / a0,
    a2: (1 - alpha) / a0
  }
}

// RBJ low-pass at fc, Q.
export function lowpassCoefs(fc, Q, fs) {
  let w = PI2 * fc / fs
  let cw = Math.cos(w), sw = Math.sin(w)
  let alpha = sw / (2 * Q)
  let a0 = 1 + alpha
  return {
    b0: (1 - cw) / 2 / a0,
    b1: (1 - cw) / a0,
    b2: (1 - cw) / 2 / a0,
    a1: -2 * cw / a0,
    a2: (1 - alpha) / a0
  }
}

// RBJ peaking EQ at fc, Q, gain in dB.
export function peakingCoefs(fc, Q, gainDb, fs) {
  let A = Math.pow(10, gainDb / 40)
  let w = PI2 * fc / fs
  let cw = Math.cos(w), sw = Math.sin(w)
  let alpha = sw / (2 * Q)
  let a0 = 1 + alpha / A
  return {
    b0: (1 + alpha * A) / a0,
    b1: -2 * cw / a0,
    b2: (1 - alpha * A) / a0,
    a1: -2 * cw / a0,
    a2: (1 - alpha / A) / a0
  }
}

// Streaming buffer: input ring (grow-on-demand), output OLA buffer + norm buffer.
// Same shape as time-stretch/util.js — kept compatible so we can lift its STFT.
export function makeStreamBufs(N, nf = 0) {
  let ib = new Float32Array(N * 4), il = 0
  let ob = new Float32Array(N * 8), nb = new Float32Array(N * 8)
  let pos = 0, oread = 0

  function appendIn(chunk) {
    let need = il + chunk.length
    if (need > ib.length) {
      let b = new Float32Array(Math.max(need * 2, ib.length * 2))
      b.set(ib.subarray(0, il)); ib = b
    }
    ib.set(chunk, il); il += chunk.length
  }

  function growOut(need) {
    if (need <= ob.length) return
    let len = Math.max(need * 2, ob.length * 2)
    let o = new Float32Array(len), n = new Float32Array(len)
    o.set(ob); n.set(nb); ob = o; nb = n
  }

  function compactIn(trim) {
    if (trim <= 0) return
    ib.copyWithin(0, trim, il); il -= trim
  }

  function take(upTo) {
    upTo = Math.min(upTo, pos)
    if (upTo <= oread) return new Float32Array(0)
    let len = Math.floor(upTo - oread)
    let out = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      let j = oread + i, n = nf > 0 ? Math.max(nb[j], nf) : nb[j]
      out[i] = n > 1e-8 ? ob[j] / n : 0
    }
    oread += len
    if (oread > N * 8) {
      ob.copyWithin(0, oread); nb.copyWithin(0, oread)
      pos -= oread; oread = 0
      ob.fill(0, pos); nb.fill(0, pos)
    }
    return out
  }

  return {
    get ib() { return ib }, get il() { return il },
    get ob() { return ob }, get nb() { return nb },
    get pos() { return pos }, set pos(v) { pos = v },
    appendIn, growOut, compactIn, take
  }
}

// Steady-state win² sum — floor prevents amplification at OLA boundaries.
export function normFloor(win, hop) {
  let N = win.length, min = Infinity
  for (let i = 0; i < hop; i++) {
    let s = 0
    for (let j = i; j < N; j += hop) s += win[j] * win[j]
    if (s > 0 && s < min) min = s
  }
  return min === Infinity ? 0 : min
}

// In-place RMS (per chunk).
export function rms(data) {
  let s = 0
  for (let i = 0; i < data.length; i++) s += data[i] * data[i]
  return Math.sqrt(s / data.length)
}
