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

// Streaming buffer state: input ring (grow-on-demand), output OLA buffer + norm buffer.
// Plain data + free functions — no accessors/closures, stays in the jz subset.
export function makeStreamBufs(N, nf = 0) {
  return {
    N, nf,
    ib: new Float32Array(N * 4), il: 0,
    ob: new Float32Array(N * 8), nb: new Float32Array(N * 8),
    pos: 0, oread: 0, hi: 0
  }
}

export function appendIn(st, chunk) {
  let need = st.il + chunk.length
  if (need > st.ib.length) {
    let b = new Float32Array(Math.max(need * 2, st.ib.length * 2))
    b.set(st.ib.subarray(0, st.il)); st.ib = b
  }
  st.ib.set(chunk, st.il); st.il += chunk.length
}

export function growOut(st, need) {
  if (need <= st.ob.length) return
  let len = Math.max(need * 2, st.ob.length * 2)
  let o = new Float32Array(len), n = new Float32Array(len)
  o.set(st.ob); n.set(st.nb); st.ob = o; st.nb = n
}

export function compactIn(st, trim) {
  if (trim <= 0) return
  st.ib.copyWithin(0, trim, st.il); st.il -= trim
}

export function take(st, upTo) {
  upTo = Math.min(upTo, st.pos)
  if (upTo <= st.oread) return new Float32Array(0)
  let len = Math.floor(upTo - st.oread)
  let out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    let j = st.oread + i, n = st.nf > 0 ? Math.max(st.nb[j], st.nf) : st.nb[j]
    out[i] = n > 1e-8 ? st.ob[j] / n : 0
  }
  st.oread += len
  if (st.oread > st.N * 8) {
    // shift left; zero only past the high-water mark — frames extend N−hop beyond
    // pos, so zeroing from pos would erase the last frame's partial overlap-add tail
    st.ob.copyWithin(0, st.oread); st.nb.copyWithin(0, st.oread)
    st.pos -= st.oread; st.hi = Math.max(0, st.hi - st.oread); st.oread = 0
    st.ob.fill(0, st.hi); st.nb.fill(0, st.hi)
  }
  return out
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
