// Measure @audio/denoise-dewind and @audio/denoise-deplosive: what each takes from clean speech and music, and how much
// of the defect it is for it takes away. Run: `node scripts/lowend.js dewind|deplosive [BEFORE] [--train] [--out=DIR]`
// (minutes; BEFORE, a path to an older dewind.js or deplosive.js, makes each cell read "before → now"; --out=DIR, dewind:
// the outputs on speech under wind in DIR/now and DIR/before, its input in DIR/input, for `python scripts/wind.py score
// DIR/now`). Prints the README's tables.
//
// Clean material through the op at its defaults, one batch call (each op's stream equals its batch sample for sample,
// latency aside):
//   thinned   the share of voiced 10 ms frames (normalized autocorrelation ≥ 0.6 at a 60–400 Hz lag over 40 ms of the
//             50–1000 Hz band; within 35 dB of the 99th-percentile frame) whose level under 250 Hz fell by over 3 dB;
//             dewind: only those from the first to the last frame within 20 dB of it (a take's room tone before and
//             after the words is no voice, though its hum reads periodic)
//   20–63, 63–125, 125–250   each band's level change over the whole input, dB (4th-order Butterworth bands)
//   untouched dewind: the share of inputs that come back sample for sample
// The defect, added to the speech:
//   wind   at a speech-to-wind ratio of +10, 0 and −10 dB, three kinds, `python scripts/wind.py fetch` writing the last
//          two (tune and test halves apart):
//          synthetic  Gaussian noise through a 2nd-order 100 Hz low-pass, plus a 1st-order 500 Hz part 20 dB under it,
//                     under a log-normal gust envelope (±8 dB, 1 Hz): the spectrum and gusts Nelke & Vary measure
//                     (IWAENC 2014)
//          generated  the SC-Wind-Noise-Generator (Mirabilii et al., IWAENC 2022): spectrum and gusts by wind speed
//          recorded   twelve CC0 recordings of wind on a microphone (freesound.org)
//          a stretch of each, at a seeded offset; measured as the error to the clean speech taken away, dB,
//          10·log10 Σ(x − s)² / Σ(y − s)², and, by phase inversion (Hagerman & Olofsson, Acta Acustica 2004: the op on
//          s + n and on s − n, ŝ = (y₊ + y₋)/2, n̂ = (y₊ − y₋)/2), the wind removed, 10·log10 Σn² / Σn̂², and the speech
//          kept per band, 10·log10 Σŝ² / Σs² (4th-order Butterworth bands)
//   pops   a half-sine pressure pulse of 20–60 ms through a 4th-order 150 Hz low-pass, peaking at 0.5, 1 and 2× the
//          utterance's peak, 5 ms before each word that follows 100 ms of quiet (frames 30 dB under the 99th percentile)
//          measured as the error to the clean speech taken away over each pop and the 150 ms after it. Synthetic: no
//          recordings of real pops with their clean speech exist here.
//
// Material: VoiceBank+DEMAND clean test utterances (Valentini-Botinhao 2017, CC BY 4.0), every fourth (p232 male, p257
// female; --train: every third of the training subset `python scripts/speech.py fetch` writes, by VCTK's speaker sex);
// the first 60 s of ten Spoken Wikipedia narrations, ~/.cache/audiojs/data/spoken/ (--train: spoken-train/, 30 s); the
// music in ~/.cache/audiojs/data/repair/ (see scripts/repair.js), 60 s at most; audio-lena; and a bass line made here
// (E1–E2, harmonics to 2 kHz at 1/k, two notes a second).

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import raw from 'audio-lena/raw'
import { highpass, lowpass, step } from '@audio/biquad'
import { wav } from './speech.mjs'

let [op, ...rest] = process.argv.slice(2), train = rest.includes('--train'), beforePath = rest.find(a => !a.startsWith('--'))
let outDir = rest.find(a => a.startsWith('--out='))?.slice(6)
if (op !== 'dewind' && op !== 'deplosive') { console.log('usage: node scripts/lowend.js dewind|deplosive [BEFORE] [--train] [--out=DIR]'); process.exit(1) }
const now = (await import(`@audio/denoise-${op}`)).default
const before = beforePath && (await import(new URL(beforePath, `file://${process.cwd()}/`))).default

const DATA = `${homedir()}/.cache/audiojs/data`
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r())
const db = v => 10 * Math.log10(Math.max(v, 1e-30))
const sum2 = x => { let s = 0; for (let v of x) s += v * v; return s }
const f32 = (p, n = Infinity) => { let b = readFileSync(p), x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); return x.subarray(0, Math.min(x.length, n)) }

// ---- material
const MALE = new Set(['p226', 'p227', 'p232', 'p243', 'p254', 'p256', 'p258', 'p259', 'p270', 'p273', 'p274', 'p278', 'p279', 'p286', 'p287'])  // VCTK speaker-info.txt
function voicebank() {
  let dir = train ? `${DATA}/vbdemand-train/clean` : `${DATA}/vbdemand/clean_testset_wav`
  if (!existsSync(dir)) return {}
  let files = readdirSync(dir).filter(f => f.endsWith('.wav')).sort().filter((_, i) => i % (train ? 3 : 4) === 0)
  let pick = male => files.filter(f => MALE.has(f.slice(0, 4)) === male).map(f => Object.assign(wav(`${dir}/${f}`).x, { name: f.slice(0, -4) }))
  return { 'speech, male': [48000, pick(true)], 'speech, female': [48000, pick(false)] }
}
function bassline(fs = 44100) {
  let notes = [41.2, 55, 61.7, 49, 82.4, 73.4, 55, 41.2], n = fs / 2, y = new Float32Array(n * notes.length * 2), pk = 0
  for (let k = 0; k < notes.length * 2; k++) for (let i = 0, f = notes[k % notes.length]; i < n; i++) {
    let t = i / fs, v = 0
    for (let h = 1; h < 12 && f * h < 2000; h++) v += Math.sin(2 * Math.PI * f * h * t) / h
    y[k * n + i] = v * Math.min(1, t / 0.005) * Math.exp(-t / 0.6)
  }
  for (let v of y) pk = Math.max(pk, Math.abs(v))
  return y.map(v => 0.3 * v / pk)
}
const narr = train ? 'spoken-train' : 'spoken', music = name => existsSync(`${DATA}/repair/${name}.f32`) ? [44100, [f32(`${DATA}/repair/${name}.f32`, 44100 * 60)]] : null
const speech = voicebank()
const clean = Object.entries({
  ...speech,
  narrations: existsSync(`${DATA}/${narr}`) ? [48000, readdirSync(`${DATA}/${narr}`).filter(f => f.endsWith('.f32')).sort().map(f => f32(`${DATA}/${narr}/${f}`, 48000 * (train ? 30 : 60)))] : null,
  'audio-lena': [44100, [new Float32Array(raw)]],
  'Vibe Ace (jazz)': music('vibeace'), 'Brahms (strings)': music('brahms'), 'Nutcracker': music('nutcracker'), 'trumpet': music('trumpet'),
  'bass line': [44100, [bassline()]]
}).filter(([, s]) => s)

// ---- filters, the op as a host runs it
const sos = (x, cs) => { let y = Float64Array.from(x); for (let c of cs) { let s = [0, 0]; for (let i = 0; i < y.length; i++) y[i] = step(c, s, y[i]) } return y }
const lp4 = (f, fs) => [lowpass(f, 0.5412, fs), lowpass(f, 1.3066, fs)], hp4 = (f, fs) => [highpass(f, 0.5412, fs), highpass(f, 1.3066, fs)]
const run = (K, x, fs) => K(Float32Array.from(x), { fs })

// ---- measures
function voiced(x, fs) {
  let b = sos(sos(x, hp4(50, fs)), lp4(1000, fs)), d = Math.round(fs / 8000), r = fs / d, y = Float64Array.from({ length: Math.floor(b.length / d) }, (_, i) => b[i * d])
  let n = fs / 100, m = Math.floor(x.length / n), W = Math.round(0.04 * r), lo = Math.floor(r / 400), hi = Math.ceil(r / 60), v = new Uint8Array(m)
  for (let k = 0; k < m; k++) {
    let c = Math.round((k * n + n / 2) / d) - (W >> 1), e0 = 0
    if (c < 0 || c + W + hi > y.length) continue
    for (let i = 0; i < W; i++) e0 += y[c + i] ** 2
    for (let t = lo; t <= hi && e0 > 1e-12; t++) {
      let xy = 0, e1 = 0
      for (let i = 0; i < W; i++) { xy += y[c + i] * y[c + i + t]; e1 += y[c + i + t] ** 2 }
      if (xy / Math.sqrt(e0 * e1) >= 0.6) { v[k] = 1; break }
    }
  }
  return v
}
const BANDS = [[20, 63], [63, 125], [125, 250]]
// the periodic part of 40 ms of the low band (at 8 kHz), r·E at the lag (2.5–17 ms) where its normalized autocorrelation
// peaks (a harmonic H in noise N reads r = H / (H + N), Boersma 1993); `at` takes the lag found on another signal
function periodic(z, c, W, lo, hi, at) {
  let e0 = 0, best = -1, lag = at || lo
  for (let i = 0; i < W; i++) e0 += z[c + i] ** 2
  for (let t = at || lo; t <= (at || hi); t++) {
    let xy = 0, e1 = 0
    for (let i = 0; i < W; i++) { xy += z[c + i] * z[c + i + t]; e1 += z[c + i + t] ** 2 }
    let r = xy / Math.sqrt(e0 * e1 + 1e-30)
    if (r > best) { best = r; lag = t }
  }
  return [Math.max(0, best) * e0, lag]
}
function passthrough(K, xs, fs, vs) {
  let N = 0, thin = 0, thinH = 0, same = 0, bi = BANDS.map(() => 0), bo = BANDS.map(() => 0)
  xs.forEach((x, j) => {
    let y = run(K, x, fs), v = vs[j]
    if (y.every((u, i) => u === x[i])) same++
    let lx = sos(x, lp4(250, fs)), ly = sos(y, lp4(250, fs)), n = fs / 100, et = [], ex = [], ey = []
    for (let k = 0; k < v.length; k++) { let a = 0, b = 0, t = 0; for (let i = k * n; i < (k + 1) * n; i++) { a += lx[i] ** 2; b += ly[i] ** 2; t += x[i] ** 2 } ex.push(a); ey.push(b); et.push(t) }
    let ref = [...et].sort((a, b) => a - b)[Math.floor(0.99 * (et.length - 1))]
    let a0 = op === 'dewind' ? et.findIndex(e => e > ref / 100) : 0, a1 = op === 'dewind' ? et.findLastIndex(e => e > ref / 100) : et.length
    let d = Math.round(fs / 8000), r = fs / d, W = Math.round(0.04 * r), lo = Math.round(r / 400), hi = Math.round(r / 60)
    let dx = op === 'dewind' && Float64Array.from({ length: Math.floor(x.length / d) }, (_, i) => lx[i * d]), dy = dx && Float64Array.from(dx, (_, i) => ly[i * d])
    for (let k = Math.max(0, a0); k <= Math.min(v.length - 1, a1); k++) if (v[k] && et[k] > ref * 10 ** -3.5 && ex[k] > 0) {
      N++; if (ey[k] < ex[k] / 2) thin++
      let c = Math.round((k * n + n / 2) / d) - (W >> 1)
      if (!dx || c < 0 || c + W + hi > dx.length) continue
      let [hx, lag] = periodic(dx, c, W, lo, hi), [hy] = periodic(dy, c, W, lo, hi, lag)
      if (hy < hx / 2) thinH++
    }
    BANDS.forEach(([a, b], q) => { let c = [...hp4(a, fs), ...lp4(b, fs)]; bi[q] += sum2(sos(x, c)); bo[q] += sum2(sos(y, c)) })
  })
  return [N ? 100 * thin / N : 0, ...BANDS.map((_, q) => db(bo[q] / bi[q])), 100 * same / xs.length, N ? 100 * thinH / N : 0]
}
// wind: synthetic (seeded), or a stretch of a generated or recorded one (tune and test halves apart), 48 kHz
const WIND = `${DATA}/wind`, REAL = ['151853', '170439', '207443', '239485', '397641', '592387', '611197', '623003', '718030', '760989', '117773', '20108']
const pools = {}
function pool(src) {
  let files = src === 'recorded' ? REAL.filter((_, i) => i % 2 === (train ? 0 : 1)).map(id => `${WIND}/real/${id}.f32`) : Array.from({ length: 6 }, (_, i) => `${WIND}/sc/sc${train ? i + 1 : i + 7}.f32`)
  return pools[src] ??= files.every(f => existsSync(f)) ? files.map(f => f32(f)) : null
}
function windOf(src, n, fs, k) {
  if (src === 'synthetic') return wind(n, fs, 7 + k)
  let p = pool(src), r = lcg(1000 + k), w = p[k % p.length]
  for (let t = 0; t < 8; t++) {                    // not a stretch where the recording is all but silent
    let o = Math.floor(r() * Math.max(1, w.length - n)), seg = w.subarray(o, o + n)
    if (seg.length === n && sum2(seg) / n > 1e-7) return Float64Array.from(seg)
  }
  return Float64Array.from({ length: n }, (_, i) => w[i % w.length])
}
const WBANDS = [[20, 63], [63, 125], [125, 250], [250, 500], [500, 2000]]
// error taken away, wind removed, speech kept (all, then per band), by phase inversion
function windMeasure(K, xs, fs, src, swr, tag) {
  let eb = 0, ea = 0, ni = 0, no = 0, si = 0, so = 0, bi = WBANDS.map(() => 0), bo = WBANDS.map(() => 0)
  xs.forEach((s, j) => {
    let w = windOf(src, s.length, fs, j), g = Math.sqrt(sum2(s) / sum2(w) / 10 ** (swr / 10)), n = w.map(v => v * g)
    let x = Float32Array.from(s, (v, i) => v + n[i]), yp = run(K, x, fs), ym = run(K, Float32Array.from(s, (v, i) => v - n[i]), fs)
    let ys = Float64Array.from(yp, (v, i) => (v + ym[i]) / 2), yn = Float64Array.from(yp, (v, i) => (v - ym[i]) / 2)
    for (let i = 0; i < s.length; i++) { eb += (x[i] - s[i]) ** 2; ea += (yp[i] - s[i]) ** 2 }
    ni += sum2(n); no += sum2(yn); si += sum2(s); so += sum2(ys)
    WBANDS.forEach(([a, b], q) => { let c = [...hp4(a, fs), ...lp4(b, fs)]; bi[q] += sum2(sos(s, c)); bo[q] += sum2(sos(ys, c)) })
    if (outDir) for (let [t, y] of [[tag, yp], ...tag === 'now' ? [['input', x]] : []]) {
      mkdirSync(`${outDir}/${t}`, { recursive: true })
      writeFileSync(`${outDir}/${t}/${src}_${swr}_${s.name}.f32`, Buffer.from(y.buffer, y.byteOffset, y.byteLength))
    }
  })
  return [db(eb / ea), db(ni / no), db(so / si), ...WBANDS.map((_, q) => db(bo[q] / bi[q]))]
}
function wind(n, fs, seed) {
  let r = lcg(seed), a = sos(Float64Array.from({ length: n }, () => gauss(r)), [lowpass(100, Math.SQRT1_2, fs)])
  let b = new Float64Array(n), q = Math.exp(-2 * Math.PI * 500 / fs), g = sos(Float64Array.from({ length: n }, () => gauss(r)), [lowpass(1, Math.SQRT1_2, fs)])
  for (let i = 0, s = 0; i < n; i++) b[i] = s = (1 - q) * gauss(r) + q * s
  let sa = Math.sqrt(sum2(a) / n), sb = Math.sqrt(sum2(b) / n), sg = Math.sqrt(sum2(g) / n)
  return Float64Array.from(a, (v, i) => (v / sa + 0.1 * b[i] / sb) * 10 ** (8 * g[i] / sg / 20))
}
function onsets(x, fs) {
  let n = fs / 100, m = Math.floor(x.length / n), lv = [], at = []
  for (let k = 0; k < m; k++) { let e = 0; for (let i = k * n; i < (k + 1) * n; i++) e += x[i] ** 2; lv.push(db(e)) }
  let ref = [...lv].sort((a, b) => a - b)[Math.floor(0.99 * (m - 1))], act = lv.map(v => v > ref - 30)
  for (let k = 1, last = -1; k < m; k++) if (act[k]) { if (last >= 0 && k - last > 1 && k - last <= 7) act.fill(true, last, k); last = k }
  for (let k = 10; k < m; k++) if (act[k] && act.slice(k - 10, k).every(a => !a)) at.push(k * n)
  return at
}
function pops(x, fs, k, seed) {
  let r = lcg(seed), p = new Float32Array(x.length), pk = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0), at = []
  for (let o of onsets(x, fs)) {
    let D = Math.round((0.02 + 0.04 * r()) * fs), h = sos(Float64Array.from({ length: 4 * D }, (_, i) => i < D ? Math.sin(Math.PI * i / D) : 0), lp4(150, fs))
    let hp = h.reduce((m, v) => Math.max(m, Math.abs(v)), 0), sg = r() < 0.5 ? -1 : 1, s0 = Math.max(0, o - Math.round(0.005 * fs))
    for (let i = 0; i < h.length && s0 + i < x.length; i++) p[s0 + i] += sg * k * pk * h[i] / hp
    at.push([s0, Math.min(x.length, s0 + D + Math.round(0.15 * fs))])
  }
  return { p, at }
}
function defect(K, xs, fs, level) {
  let eb = 0, ea = 0
  xs.forEach((s, j) => {
    let d, spans
    if (op === 'dewind') { let w = wind(s.length, fs, 7 + j), g = Math.sqrt(sum2(s) / sum2(w) / 10 ** (level / 10)); d = w.map(v => v * g); spans = [[0, s.length]] }
    else ({ p: d, at: spans } = pops(s, fs, level, 3 + j))
    let x = Float32Array.from(s, (v, i) => v + d[i]), y = run(K, x, fs)
    for (let [a, b] of spans) for (let i = a; i < b; i++) { eb += (x[i] - s[i]) ** 2; ea += (y[i] - s[i]) ** 2 }
  })
  return db(eb / ea)
}

// ---- tables
const num = v => (Math.abs(v) < 0.05 ? 0 : v).toFixed(1).replace('-', '−')
const cell = (b, a, f = num) => before ? `${f(b)} → ${f(a)}` : f(a)
const pct = v => v.toFixed(1) + '%'
const dw = op === 'dewind'
console.log(`\n${op}${train ? ', training material' : ''}: clean sound through it\n\n| |${dw ? ' untouched |' : ''} voiced frames thinned |${dw ? ' their periodic part |' : ''} 20–63 Hz | 63–125 Hz | 125–250 Hz |\n|---|${dw ? '---:|---:|' : ''}---:|---:|---:|---:|`)
for (let [name, [fs, xs]] of clean) {
  let vs = xs.map(x => voiced(x, fs)), a = passthrough(now, xs, fs, vs), b = before && passthrough(before, xs, fs, vs)
  console.log(`| ${name} |${dw ? ` ${cell(b?.[4], a[4], v => v.toFixed(0) + '%')} |` : ''} ${cell(b?.[0], a[0], pct)} |${dw ? ` ${cell(b?.[5], a[5], pct)} |` : ''} ${[1, 2, 3].map(q => cell(b?.[q], a[q])).join(' | ')} |`)
}
if (dw) {
  let xs = [...(speech['speech, male']?.[1] || []), ...(speech['speech, female']?.[1] || [])], srcs = ['synthetic', 'generated', 'recorded'].filter(s => s === 'synthetic' || pool(s))
  let res = {}
  for (let src of srcs) for (let swr of [10, 0, -10]) res[src + swr] = [before && windMeasure(before, xs, 48000, src, swr, 'before'), windMeasure(now, xs, 48000, src, swr, 'now')]
  let head = l => `| | ${[10, 0, -10].map(l => `${l > 0 ? '+' : l < 0 ? '−' : ''}${Math.abs(l)} dB`).join(' | ')} |\n|---|---:|---:|---:|`
  for (let [q, what] of [[0, 'error to the clean speech taken away'], [1, 'wind removed'], [2, 'speech kept']]) {
    console.log(`\nwind at a speech-to-wind ratio of: ${what}, dB\n\n${head()}`)
    for (let src of srcs) console.log(`| ${src} | ${[10, 0, -10].map(l => cell(res[src + l][0]?.[q], res[src + l][1][q])).join(' | ')} |`)
  }
  console.log(`\nspeech kept per band, dB\n\n| | ${WBANDS.map(([a, b]) => `${a}–${b} Hz`).join(' | ')} |\n|---|${WBANDS.map(() => '---:').join('|')}|`)
  for (let src of srcs) for (let l of [10, 0, -10]) console.log(`| ${src}, ${l > 0 ? '+' : l < 0 ? '−' : ''}${Math.abs(l)} dB | ${WBANDS.map((_, q) => cell(res[src + l][0]?.[3 + q], res[src + l][1][3 + q])).join(' | ')} |`)
  process.exit(0)
}
const levels = op === 'dewind' ? [10, 0, -10] : [0.5, 1, 2]
console.log(`\n${op === 'dewind' ? 'wind at a speech-to-wind ratio of' : 'pops peaking at'}: error to the clean speech taken away, dB\n\n| | ${levels.map(l => op === 'dewind' ? `${l > 0 ? '+' : l < 0 ? '−' : ''}${Math.abs(l)} dB` : `${l}×`).join(' | ')} |\n|---|${levels.map(() => '---:').join('|')}|`)
for (let [name, [fs, xs]] of Object.entries(speech)) console.log(`| ${name} | ${levels.map(l => cell(before && defect(before, xs, fs, l), defect(now, xs, fs, l))).join(' | ')} |`)
