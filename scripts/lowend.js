// Measure @audio/denoise-dewind and @audio/denoise-deplosive: what each takes from clean speech and music, and how much
// of the defect it is for it takes away. Run: `node scripts/lowend.js dewind|deplosive [BEFORE] [--train]` (minutes;
// BEFORE, a path to an older dewind.js or deplosive.js, makes each cell read "before → now"). Prints the README's tables.
//
// Clean material through the op at its defaults, in 1024-sample calls as the `audio` host runs it:
//   thinned   the share of voiced 10 ms frames (normalized autocorrelation ≥ 0.6 at a 60–400 Hz lag over 40 ms of the
//             50–1000 Hz band; within 35 dB of the 99th-percentile frame) whose level under 250 Hz fell by over 3 dB
//   20–63, 63–125, 125–250   each band's level change over the whole input, dB (4th-order Butterworth bands)
// The defect, added to the speech:
//   wind   Gaussian noise through a 2nd-order 100 Hz low-pass, plus a 1st-order 500 Hz part 20 dB under it, under a
//          log-normal gust envelope (±8 dB, 1 Hz): the spectrum and gusts Nelke & Vary measure (IWAENC 2014); at a
//          speech-to-wind ratio of +10, 0 and −10 dB
//   pops   a half-sine pressure pulse of 20–60 ms through a 4th-order 150 Hz low-pass, peaking at 0.5, 1 and 2× the
//          utterance's peak, 5 ms before each word that follows 100 ms of quiet (frames 30 dB under the 99th percentile)
// measured as the error to the clean speech taken away, dB: 10·log10 Σ(x − s)² / Σ(y − s)², over each pop and the 150 ms
// after it for pops. Both are synthetic: no recordings of real wind or pops with their clean speech exist here.
//
// Material: VoiceBank+DEMAND clean test utterances (Valentini-Botinhao 2017, CC BY 4.0), every fourth (p232 male, p257
// female; --train: every third of the training subset `python scripts/speech.py fetch` writes, by VCTK's speaker sex);
// the first 60 s of ten Spoken Wikipedia narrations, ~/.cache/audiojs/data/spoken/ (--train: spoken-train/, 30 s); the
// music in ~/.cache/audiojs/data/repair/ (see scripts/repair.js), 60 s at most; audio-lena; and a bass line made here
// (E1–E2, harmonics to 2 kHz at 1/k, two notes a second).

import { readFileSync, readdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import raw from 'audio-lena/raw'
import { highpass, lowpass, step } from '@audio/biquad'
import { wav } from './speech.mjs'

let [op, ...rest] = process.argv.slice(2), train = rest.includes('--train'), beforePath = rest.find(a => !a.startsWith('--'))
if (op !== 'dewind' && op !== 'deplosive') { console.log('usage: node scripts/lowend.js dewind|deplosive [BEFORE] [--train]'); process.exit(1) }
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
  let pick = male => files.filter(f => MALE.has(f.slice(0, 4)) === male).map(f => wav(`${dir}/${f}`).x)
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
function run(K, x, fs) {
  let y = Float32Array.from(x), st = { fs }
  for (let i = 0; i < y.length; i += 1024) K(y.subarray(i, Math.min(y.length, i + 1024)), st)
  return y
}

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
function passthrough(K, xs, fs, vs) {
  let N = 0, thin = 0, bi = BANDS.map(() => 0), bo = BANDS.map(() => 0)
  xs.forEach((x, j) => {
    let y = run(K, x, fs), v = vs[j], lx = sos(x, lp4(250, fs)), ly = sos(y, lp4(250, fs)), n = fs / 100, et = [], ex = [], ey = []
    for (let k = 0; k < v.length; k++) { let a = 0, b = 0, t = 0; for (let i = k * n; i < (k + 1) * n; i++) { a += lx[i] ** 2; b += ly[i] ** 2; t += x[i] ** 2 } ex.push(a); ey.push(b); et.push(t) }
    let ref = [...et].sort((a, b) => a - b)[Math.floor(0.99 * (et.length - 1))]
    for (let k = 0; k < v.length; k++) if (v[k] && et[k] > ref * 10 ** -3.5 && ex[k] > 0) { N++; if (ey[k] < ex[k] / 2) thin++ }
    BANDS.forEach(([a, b], q) => { let c = [...hp4(a, fs), ...lp4(b, fs)]; bi[q] += sum2(sos(x, c)); bo[q] += sum2(sos(y, c)) })
  })
  return [N ? 100 * thin / N : 0, ...BANDS.map((_, q) => db(bo[q] / bi[q]))]
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
console.log(`\n${op}${train ? ', training material' : ''}: clean sound through it\n\n| | voiced frames thinned | 20–63 Hz | 63–125 Hz | 125–250 Hz |\n|---|---:|---:|---:|---:|`)
for (let [name, [fs, xs]] of clean) {
  let vs = xs.map(x => voiced(x, fs)), a = passthrough(now, xs, fs, vs), b = before && passthrough(before, xs, fs, vs)
  console.log(`| ${name} | ${cell(b?.[0], a[0], pct)} | ${[1, 2, 3].map(q => cell(b?.[q], a[q])).join(' | ')} |`)
}
const levels = op === 'dewind' ? [10, 0, -10] : [0.5, 1, 2]
console.log(`\n${op === 'dewind' ? 'wind at a speech-to-wind ratio of' : 'pops peaking at'}: error to the clean speech taken away, dB\n\n| | ${levels.map(l => op === 'dewind' ? `${l > 0 ? '+' : l < 0 ? '−' : ''}${Math.abs(l)} dB` : `${l}×`).join(' | ')} |\n|---|${levels.map(() => '---:').join('|')}|`)
for (let [name, [fs, xs]] of Object.entries(speech)) console.log(`| ${name} | ${levels.map(l => cell(before && defect(before, xs, fs, l), defect(now, xs, fs, l))).join(' | ')} |`)
