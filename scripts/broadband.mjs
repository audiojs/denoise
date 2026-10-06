// What the broadband reducers keep of speech and music and take of noise. Run: `node scripts/broadband.mjs [--train]`
// (minutes). Prints the README's table of what each keeps, under Speech; a tracking system's cells read "without →
// with" noise-estimate's `partials` (`estimator: { partials: false }` turns it off).
//
// Shadow filtering: each frame's gain, as the kernel's own frame process (`processor`) computes it on the noisy mix, is
// applied to the clean speech and to the noise alone on the same @audio/stft frames, so what the gain does to each is
// read apart. A frame is speech 10 dB over the take's floor (the 10th percentile of its frame levels); dB re the clean:
//   onset +1, +2  speech kept in a word's 2nd and 3rd frame (a frame 20 dB over the floor after 85 ms, 8 frames, under
//                 floor + 6 dB): the decision-directed a priori SNR lags a word's start
//   quiet         speech kept in frames 20–50 dB under the take's loudest
//   0–5 dB        speech kept in bins where it stands 0–5 dB over the noise (the MMSE-optimal Wiener gain keeps −3.9)
//   noise         the noise taken in all frames
//   clean cut     clean speech in (the take's own room tone as the noise; omlsa learned: the print of its lead-in), the
//                 share of its time-frequency energy cut by more than 3 dB; music, sung long tones and Slakh mixes
//                 likewise
// Systems at their defaults, 48 kHz (2048/512 frames): `omlsa` tracking the noise (IMCRA), `omlsa learned`
// on the noise learned from the lead-in before the speaker starts (audio's bench/denoise.mjs `lead`) at G_min −12 dB as
// audio's denoise() runs it, `wiener`, `specsub`.
//
// Material, from ~/.cache/audiojs/data: VoiceBank+DEMAND test set (Valentini-Botinhao 2017, CC BY 4.0, scripts/
// speech.mjs says where from), every fourth utterance, with its own noise (noisy − clean); --train: every third of the
// training subset `python scripts/speech.py fetch` writes, the set the defaults were chosen on. Ten Spoken Wikipedia
// narrations (spoken/, --train: spoken-train/; 60 s, see scripts/speech.mjs) with pink Gaussian noise 10 dB under
// their active speech level (20 ms frames within 40 dB of the loudest), 1 s of it alone first. Music: the four tracks
// in repair/ (see scripts/repair.js), first 60 s. Sung long tones: VocalSet 1.1 (Wilkins et al., ISMIR 2018, CC BY 4.0,
// zenodo.org/records/1193957), each of its 20 singers' straight long tone (vocalset/FULL/<singer>/long_tones/straight/).
// Slakh2100 (Manilow et al., WASPAA 2019, CC BY 4.0), mixes Track00001–00006 at 44.1 kHz (slakh/mix44/), first 60 s:
// synthesized band arrangements, held pads and chords throughout, never heard while choosing anything.
//
// Then `omlsa learned` where the noise is left alone, the musical noise: the log kurtosis ratio of the power spectral
// values out over in (Uemura et al., IWAENC 2008; 0 when the noise is only scaled, above where isolated peaks survive),
// 94 Hz–7.9 kHz, at G_min −12 and −20 dB, on pink noise 20 dB under each music track: 1 s of it alone (the print),
// 10 s of the music over it (from 5 s in), 2 s of it alone; over the half second after the music stops and the last
// second.

import { readFileSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { stftBatch, stftAnalyse } from '@audio/stft'
import { noiseProfile } from '@audio/noise-estimate'
import { processor as omlsaNow, frame } from '@audio/denoise-omlsa'
import { processor as wiener } from '@audio/denoise-wiener'
import { processor as specsub } from '@audio/denoise-spectral'
import { omlsa as omlsaM } from '@audio/denoise-omlsa/audio'
import { wiener as wienerM } from '@audio/denoise-wiener/audio'
import { specsub as specsubM } from '@audio/denoise-spectral/audio'
import { wav, lead } from './speech.mjs'

let train = process.argv.includes('--train')
const D = `${homedir()}/.cache/audiojs/data`
const f32 = p => new Float32Array(readFileSync(p).buffer.slice(0))
const db = x => 10 * Math.log10(x)
const def = m => Object.fromEntries(Object.entries(m.params).map(([k, s]) => [k, s.default]))
// the manifests' defaults, as their audio.js passes them
const om = def(omlsaM), wi = def(wienerM), ss = def(specsubM)
const SYSTEMS = {
  omlsa: o => omlsaNow({ ...o, xiMin: 10 ** (om.xiFloor / 10), qPrior: om.qPrior, gMin: om.gMin }),
  'omlsa learned': o => omlsaNow({ ...o, gMin: -12 }),
  wiener: o => wiener({ ...o, rule: wi.rule, alphaDD: wi.alphaDD, xiMin: 10 ** (wi.xiFloor / 10) }),
  specsub: o => specsub({ ...o, alpha: ss.alpha, beta: ss.beta }),
}

// 20 ms frame powers; the active speech level (P.56-like: frames within 40 dB of the loudest)
const powers = (x, fs) => { let L = Math.round(0.02 * fs), p = []; for (let i = 0; i + L <= x.length; i += L) { let e = 0; for (let j = i; j < i + L; j++) e += x[j] * x[j]; p.push(e / L) } return p }
const asl = (x, fs) => { let p = powers(x, fs), mx = Math.max(...p), a = p.filter(v => v > mx * 1e-4); return a.reduce((s, v) => s + v, 0) / a.length }
// pink Gaussian noise: Irwin–Hall normals from a Park–Miller generator through Kellet's filter (as speech.mjs's)
function pink(n, seed) {
  let x = new Float32Array(n), r = () => (seed = seed * 16807 % 2147483647) / 2147483647, b = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    let w = -6; for (let j = 0; j < 12; j++) w += r()
    b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759; b[2] = 0.969 * b[2] + w * 0.153852
    b[3] = 0.8665 * b[3] + w * 0.3104856; b[4] = 0.55 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.016898
    x[i] = 0.11 * (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362); b[6] = w * 0.115926
  }
  return x
}

// gains of `proc` on y, applied to s and n: per frame, |S|², |N|², G
function shadow(proc, y, s, n, fs) {
  let N = frame(fs), o = { frameSize: N, hopSize: N >> 2, fs }, K = N / 2 + 1, G = [], S2 = [], N2 = [], i = 0
  stftBatch(y, (mag, phase) => { let m0 = Float64Array.from(mag), r = proc(mag, phase); G.push(Float64Array.from(m0, (v, k) => v > 0 ? r.mag[k] / v : 1)); return r }, o)
  let apply = to => (mag, phase) => { let g = G[i++]; to.push(Float64Array.from(mag, v => v * v)); for (let k = 0; k < K; k++) mag[k] *= g[k]; return { mag, phase } }
  stftBatch(s, apply(S2), o); i = 0
  if (n) stftBatch(n, apply(N2), o)
  return { G, S2, N2, K, N, hop: N >> 2 }
}

// one take's tallies into `t`: [reference energy, energy after the gain] per measure; cut: [energy cut > 3 dB, all]
// (a cell of the table is the mean over takes of each take's dB, or %: a loud take does not outweigh a quiet one)
function tally(t, { G, S2, N2, K }) {
  let add = (k, a, b) => { let v = t[k] ??= [0, 0]; v[0] += a; v[1] += b }
  let lv = S2.map(a => a.reduce((s, v) => s + v, 0)), mx = Math.max(...lv); lv = lv.map(v => db(v / mx + 1e-30))
  let fl = [...lv].sort((a, b) => a - b)[Math.floor(0.1 * lv.length)]
  let lam = new Float64Array(K); for (let a of N2) for (let k = 0; k < K; k++) lam[k] += a[k] / N2.length
  for (let l = 0; l < G.length; l++) {
    let sp = lv[l] > fl + 10, quiet = sp && lv[l] < -20 && lv[l] >= -50
    for (let k = 1; k < K; k++) {
      let g2 = G[l][k] ** 2, S = S2[l][k]
      if (sp) { add('cut', g2 < 0.5 ? S : 0, S); if (quiet) add('quiet', S, g2 * S); let r = db(S / lam[k]); if (N2.length && r >= 0 && r < 5) add('l0', S, g2 * S) }
      if (N2.length) add('noise', N2[l][k], g2 * N2[l][k])
    }
  }
  for (let l = 8; l < lv.length - 3; l++) if (lv[l] > fl + 20 && lv.slice(l - 8, l).every(v => v < fl + 6))
    for (let d of [1, 2]) { let a = 0, b = 0; for (let k = 1; k < K; k++) { a += S2[l + d][k]; b += G[l + d][k] ** 2 * S2[l + d][k] } add('on' + d, a, b) }
}

// takes: { s, n, fs, lead } (n null: clean in, the noise its own room tone)
const vb = (dir, every) => readdirSync(`${D}/${dir}/noisy${dir === 'vbdemand' ? '_testset_wav' : ''}`).filter(f => f.endsWith('.wav')).sort().filter((_, i) => i % every === 0)
function* voicebank(clean) {
  let [dir, cd, nd] = train ? ['vbdemand-train', 'clean', 'noisy'] : ['vbdemand', 'clean_testset_wav', 'noisy_testset_wav']
  for (let f of vb(dir, train ? 3 : 4)) {
    let { x: s, fs } = wav(`${D}/${dir}/${cd}/${f}`), y = wav(`${D}/${dir}/${nd}/${f}`).x
    yield { s, n: clean ? null : y.map((v, i) => v - s[i]), fs, lead: lead(s, fs) }
  }
}
function* narrations() {
  let dir = `${D}/${train ? 'spoken-train' : 'spoken'}`
  for (let [i, f] of readdirSync(dir).filter(f => f.endsWith('.f32')).sort().entries()) {
    let s0 = f32(`${dir}/${f}`), fs = 48000, s = new Float32Array(s0.length + fs); s.set(s0, fs)
    let n = pink(s.length, 11 + i), g = Math.sqrt(asl(s0, fs) / n.reduce((a, v) => a + v * v / n.length, 0) / 10)
    yield { s, n: n.map(v => v * g), fs, lead: 1 }
  }
}
function* music() { for (let name of ['brahms', 'nutcracker', 'trumpet', 'vibeace']) yield { s: f32(`${D}/repair/${name}.f32`).subarray(0, 60 * 44100), n: null, fs: 44100, lead: 1 } }
function* sung() {
  let root = `${D}/vocalset/FULL`
  for (let singer of readdirSync(root).sort()) for (let f of readdirSync(`${root}/${singer}/long_tones/straight`).filter(f => f.endsWith('.wav')))
    yield { ...clean(wav(`${root}/${singer}/long_tones/straight/${f}`)), lead: 1 }
}
function* slakh() { for (let i = 1; i <= 6; i++) yield { ...clean(wav(`${D}/slakh/mix44/Track0000${i}.wav`), 60), lead: 1 } }
const clean = ({ x, fs }, sec = Infinity) => ({ s: x.subarray(0, Math.min(x.length, sec * fs)), n: null, fs })

// each measure per take, then their mean over the takes that have it
function measure(name, make, takes) {
  let all = {}
  for (let { s, n, fs, lead: ld } of takes()) {
    let y = n ? s.map((v, i) => v + n[i]) : s, N = frame(fs), o = { fs, frameSize: N, hopSize: N >> 2 }, t = {}
    if (name === 'omlsa learned') o.profile = noiseProfile(y, { from: 0, to: Math.round(ld * fs), frameSize: N, hopSize: N >> 2 })
    tally(t, shadow(make(o), y, s, n, fs))
    for (let [k, [a, b]] of Object.entries(t)) if (b > 0 && a > 0 || k === 'cut' && b > 0) (all[k] ??= []).push(k === 'cut' ? 100 * a / b : db(b / a))
  }
  return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]))
}

let rows = []
for (let [name, sys] of Object.entries(SYSTEMS)) {
  let learned = name === 'omlsa learned', runs = learned ? [sys] : [false, true].map(p => o => sys({ ...o, estimator: { partials: p } }))
  let res = runs.map(make => ({
    vb: measure(name, make, () => voicebank(false)), narr: measure(name, make, narrations), clean: measure(name, make, () => voicebank(true)),
    ...learned ? {} : { music: measure(name, make, music), sung: measure(name, make, sung), slakh: measure(name, make, slakh) }
  }))
  let cell = (set, k, d = 1) => res.map(r => r[set]?.[k] == null ? '–' : r[set][k].toFixed(d).replace('-', '−')).join(' → ')
  rows.push(`| ${learned ? '`omlsa`, learned noise' : `\`${name}\``} | ${cell('narr', 'on1')} | ${cell('narr', 'on2')} | ${cell('vb', 'quiet')} | ${cell('vb', 'l0')} | ${cell('vb', 'noise')} | ${cell('narr', 'noise')} | ${cell('clean', 'cut')} | ${cell('music', 'cut')} | ${cell('sung', 'cut')} | ${cell('slakh', 'cut')} |`)
  console.error(rows.at(-1))
}
// musical noise where the music leaves the learned noise alone
const kurt = (x, y, a, b, fs, N) => {
  let st = z => { let s1 = 0, s2 = 0, c = 0; stftAnalyse(z.subarray(a, b), m => { for (let k = Math.round(94 * N / fs); k <= Math.round(7900 * N / fs); k++) { let p = m[k] * m[k]; s1 += p; s2 += p * p; c++ } }, { frameSize: N, hopSize: N >> 2 }); return s2 * c / (s1 * s1) }
  return Math.log(st(y) / st(x))
}
let after = (p, gMin) => {
  let fs = 44100, N = frame(fs), r = [0, 0], names = ['brahms', 'nutcracker', 'trumpet', 'vibeace']
  for (let [i, name] of names.entries()) {
    let m = f32(`${D}/repair/${name}.f32`).subarray(5 * fs, 15 * fs), s = new Float32Array(13 * fs); s.set(m, fs)
    let n = pink(s.length, 3 + i), g = Math.sqrt(asl(m, fs) / n.reduce((a, v) => a + v * v / n.length, 0) / 100), y = s.map((v, j) => v + g * n[j])
    let o = { fs, frameSize: N, hopSize: N >> 2 }, out = stftBatch(y, p({ ...o, profile: noiseProfile(y, { to: fs, frameSize: N, hopSize: N >> 2 }), gMin }), o)
    r[0] += kurt(y, out, 11 * fs, 11.5 * fs, fs, N) / names.length; r[1] += kurt(y, out, 12 * fs, 13 * fs, fs, N) / names.length
  }
  return r
}
let stops = [-12, -20].map(gMin => [after(omlsaNow, gMin)])

console.log(`\n${train ? 'VoiceBank+DEMAND training subset, spoken-train' : 'VoiceBank+DEMAND test set, spoken'}: speech kept, dB (0: all of it), and noise taken\n`)
console.log('| op | onset +1 | onset +2 | quiet | 0–5 dB | noise, VB | noise, narr. | clean cut % | music cut % | sung cut % | Slakh cut % |\n|---|---|---|---|---|---|---|---|---|---|---|')
console.log(rows.join('\n'))
let ks = (i, d) => stops[i].map(r => r[d].toFixed(2)).join(' → ')
console.log(`\n\`omlsa learned\`, musical noise (log kurtosis ratio) in the half second after music stops: ${ks(0, 0)} at G_min −12 dB, ${ks(1, 0)} at −20; in the last second: ${ks(0, 1)} and ${ks(1, 1)}`)
