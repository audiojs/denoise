// Measure denoise quality + perf across canonical noise scenarios.
// Run: `npm run measure`
//
// Prints a Markdown table:  scenario × method  → SNR, segSNR, LSD, NRR, ms
// Picks the scenario-specific method first, then a baseline (wiener) for context.

import raw from 'audio-lena/raw'
import {
  dehum, specsub, wiener, omlsa, declick, decrackle, declip,
  dewind, deesser, debreath, dereverb, denoise
} from '../index.js'
import { snr, segSnr, lsd, nrr, speechAttenuation } from '@audio/quality'

let fs = 44100
let lena = new Float32Array(raw)
let speech = lena.subarray(0, fs * 8)                       // 8 s clean reference

// --- corruption generators ---
function sine(f, n, a) {
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = a * Math.sin(2 * Math.PI * f * i / fs)
  return d
}
function white(n, a) {
  let d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = a * (Math.random() * 2 - 1)
  return d
}
function add(...as) {
  let n = Math.max(...as.map(a => a.length))
  let d = new Float32Array(n)
  for (let a of as) for (let i = 0; i < a.length; i++) d[i] += a[i]
  return d
}
function clicks(n, count) {
  let d = new Float32Array(n)
  for (let k = 0; k < count; k++) d[(k + 1) * Math.floor(n / (count + 1))] = (k & 1 ? -1 : 1) * 0.9
  return d
}
function rumble(n, fc) {
  let d = white(n, 1)
  // 1-pole LP
  let y = 0, a = Math.exp(-2 * Math.PI * fc / fs)
  for (let i = 0; i < n; i++) { y = a * y + (1 - a) * d[i]; d[i] = y * 4 }
  return d
}
// Intermittent wind gusts — dewind's design center (vs continuous rumble = wiener's)
function gusts(n, fc) {
  let d = new Float32Array(n), y = 0, a = Math.exp(-2 * Math.PI * fc / fs)
  for (let g = 0; g < 6; g++) {
    let at = Math.floor((0.3 + g * 1.3) * fs), len = Math.floor(0.4 * fs)
    for (let i = 0; i < len && at + i < n; i++) {
      let w = Math.random() * 2 - 1; y = a * y + (1 - a) * w
      d[at + i] += y * 6 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / len))
    }
  }
  return d
}
function reverbTail(x, t60) {
  let n = x.length, h = new Float32Array(8192)
  for (let i = 0; i < h.length; i++) h[i] = (Math.random() * 2 - 1) * Math.exp(-6.9 * i / (t60 * fs))
  let y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let xi = x[i]; if (xi === 0) continue
    let lim = Math.min(h.length, n - i)
    for (let j = 0; j < lim; j++) y[i + j] += xi * h[j]
  }
  return y
}

// --- benchmark wrapper ---
function bench(fn, x, opts, runs = 3) {
  fn(new Float32Array(x), opts)                              // warmup
  let times = []
  for (let i = 0; i < runs; i++) {
    let t = process.hrtime.bigint()
    fn(new Float32Array(x), opts)
    times.push(Number(process.hrtime.bigint() - t) / 1e6)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(runs / 2)]
}

// --- measurement core ---
function measure(name, scenarios) {
  console.log(`\n## ${name}\n`)
  console.log('| scenario | method | SNR-in | SNR-out | segSNR-out | LSD | NRR | speech atten | ms |')
  console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|')
  for (let { label, dirty, methods, ref = speech } of scenarios) {
    let snrIn = snr(ref, dirty.subarray(0, ref.length))
    for (let { name: mName, fn, opts } of methods) {
      let out = fn(new Float32Array(dirty), { fs, ...opts })
      let n = Math.min(out.length, ref.length)
      let outClip = out.subarray(0, n), refClip = ref.subarray(0, n)
      let snrOut = snr(refClip, outClip)
      let seg = segSnr(refClip, outClip)
      let l = lsd(outClip, refClip)
      let nIn = dirty.subarray(0, n), nOut = outClip
      let nrrV = nrr(nIn, nOut)
      let sa = speechAttenuation(refClip, outClip)
      let ms = bench(fn, dirty, { fs, ...opts })
      console.log(`| ${label} | ${mName} | ${snrIn.toFixed(1)} | ${snrOut.toFixed(1)} | ${seg.toFixed(1)} | ${l.toFixed(2)} | ${nrrV.toFixed(1)} | ${sa.toFixed(1)} | ${ms.toFixed(1)} |`)
    }
  }
}

// --- scenarios ---
let humSig = add(speech, sine(60, speech.length, 0.3), sine(120, speech.length, 0.15), sine(180, speech.length, 0.075))
let whiteSig = add(speech, white(speech.length, 0.05))
let clickSig = add(speech, clicks(speech.length, 30))
let rumbleSig = add(speech, rumble(speech.length, 80))
let gustSig = add(speech, gusts(speech.length, 80))
let sissSig = add(speech, sine(7000, speech.length, 0.15))
let reverbSig = reverbTail(speech, 0.6)

measure('Mains hum (60 Hz + harmonics)', [
  { label: 'hum', dirty: humSig, methods: [
    { name: 'dehum', fn: dehum, opts: { freq: 60 } },
    { name: 'wiener', fn: wiener, opts: {} },
  ]},
])

measure('Broadband white noise (≈10 dB SNR)', [
  { label: 'white', dirty: whiteSig, methods: [
    { name: 'wiener', fn: wiener, opts: {} },
    { name: 'omlsa', fn: omlsa, opts: {} },
    { name: 'specsub', fn: specsub, opts: {} },
  ]},
])

measure('Clicks / vinyl pops', [
  { label: 'clicks', dirty: clickSig, methods: [
    { name: 'declick', fn: declick, opts: {} },
    { name: 'decrackle', fn: decrackle, opts: {} },
  ]},
])

measure('LF rumble / wind', [
  { label: 'rumble', dirty: rumbleSig, methods: [
    { name: 'dewind', fn: dewind, opts: {} },
    { name: 'wiener', fn: wiener, opts: {} },
  ]},
  { label: 'gusts', dirty: gustSig, methods: [
    { name: 'dewind', fn: dewind, opts: {} },
    { name: 'wiener', fn: wiener, opts: {} },
  ]},
])

measure('Sibilance', [
  { label: 'sib', dirty: sissSig, methods: [
    { name: 'deesser', fn: deesser, opts: { freq: 7000 } },
  ]},
])

measure('Reverb (T60 ≈ 0.6 s)', [
  { label: 'reverb', dirty: reverbSig, methods: [
    { name: 'dereverb', fn: dereverb, opts: { t60: 0.6 } },
  ]},
])

console.log('\n## denoise auto-selector\n')
console.log('| scenario | chosen | SNR-out | LSD | ms |')
console.log('|---|---|---:|---:|---:|')
for (let [label, dirty] of [['hum', humSig], ['white', whiteSig], ['clicks', clickSig], ['rumble', rumbleSig], ['sib', sissSig]]) {
  let t = process.hrtime.bigint()
  let { out, plan } = denoise(new Float32Array(dirty), { fs, returnPlan: true })
  let ms = Number(process.hrtime.bigint() - t) / 1e6
  let n = Math.min(out.length, speech.length)
  let snrOut = snr(speech.subarray(0, n), out.subarray(0, n))
  let l = lsd(out.subarray(0, n), speech.subarray(0, n))
  console.log(`| ${label} | ${plan.method} | ${snrOut.toFixed(1)} | ${l.toFixed(2)} | ${ms.toFixed(1)} |`)
}
