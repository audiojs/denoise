// Steady tones (a whine, a test tone, an electrical or fan line off the mains series) and @audio/denoise-dehum: how
// far a tone goes, what goes of the program with it, and what held musical notes lose. Written and frozen before the
// tone path was tuned; each build's scores are kept in ~/.cache/audiojs/data/tones/<split>/<section>/<label>.json
// (label: the build's file name and its source's hash), so a build is measured once and compared with any other.
// Two fixes since, both to the measure, neither to a threshold, every build measured again after them: "tone down" read
// the tone's reproduction error, not the tone left; the pure tones faded in over 10 ms, the late tone's ramp, which no
// held line does and which capped every subtraction near 35 dB.
//
//   node scripts/tones.mjs SECTION SPLIT [BUILD.js ...]
//     SECTION  case | synth | music | speech | all
//     SPLIT    tune | test (tuning chooses thresholds; the test split is read once they are fixed)
//     BUILD    a dehum.js (default: the workspace's packages/denoise-dehum/dehum.js); several: one column each
//
// case    test.js's steady line: audio-lena's first 4 s, a 7 kHz sine at 0.3, white Gaussian noise at 0.01 (fs 44.1k).
//         SNR of the speech, dB: dehum alone, dehum then wiener, a notch (Q 30, the line's frequency told) then wiener
//         (the reference a previous session measured: 23.8 dB), and the umbrella's denoise() in auto mode
// synth   tones added to clean speech (VoiceBank+DEMAND, Valentini-Botinhao 2017, CC BY 4.0: tune vbdemand-train/clean,
//         test clean_testset_wav; 4 clips of 4 utterances back to back, ~10–14 s at 48 kHz). Tones, random phase,
//         scaled to `lvl` dB under the speech's RMS: pure (97, 440, 1000, 3150, 7000, 12000, 15734 Hz × −10, −30, −50 dB;
//         15734 Hz is NTSC's line rate, a CRT's whine), whine (1234.5 Hz, harmonics 1–4 at 1/h, −20 dB), wander (3 kHz,
//         its frequency a smooth random walk of ±0.3 Hz over ~4 s, −20 dB), late (2 kHz from the take's middle on, a
//         device switched on, −20 dB). Told apart by phase inversion (Hagerman & Olofsson, Acta Acustica 90(2), 2004):
//         y₊ = sys(s + t), y₋ = sys(s − t); tone down 10·log10 E(t)/E((y₊ − y₋)/2), program SDR of (y₊ + y₋)/2
//         against s, SDR of y₊ against s. Notch: Q 30 at each tone's frequency, told (the bound a notch reaches)
// music   held notes, no tone added: what a build changes. Synthetic, the hardest (exact frequency, no vibrato, 20 s,
//         a −80 dBFS white floor, seeded per split): organ (triads, partials 1–6 at 1/k, held 1.5–3.5 s, 0.3–0.8 s
//         apart), flute (single sines, a −30 dB second partial, held 0.8–3 s, 0.15 s apart), pedal (an organ note held
//         from 1 s to 18 s under a flute melody), strings (partials 1–10, vibrato 5.5 Hz ±30 cents, legato 2–4 s), piano
//         (partials 1–8, inharmonicity 1e-4, decaying), and drone (an organ note held through the whole take under a
//         melody: no onset, no release, no pause; a tone by every mark the take offers, reported apart, outside the
//         criterion). Recorded: VocalSet long tones (Wilkins et al., ISMIR 2018: straight, messa, pp, forte, trill,
//         trillo, inhaled; tune the odd-numbered singers, test the even), MUSDB18 previews (Rafii et al. 2017; tune
//         every third training song, test the 50 test songs), BabySlakh mixes rendered at 44.1 kHz (Manilow et al.
//         2019; tune odd tracks, test even; 30 s from 10 s in), GuitarSet mono mic (Xi et al., ISMIR 2018; every 24th
//         take, tune odd, test even), and for test the four pieces of scripts/repair.js (30 s).
//         Measured: whether any sample changed; SDR of the output against the input; the loss at the input's partials
//         (each peak of its whole-take spectrum, Hann, within 50 dB of the strongest and 10 dB over the median of
//         ±50 bins: its power ±3 bins in over out, dB), the largest. Criterion: under 0.5 dB at every partial
// speech   VoiceBank+DEMAND test set, 824 noisy and 824 clean utterances (tune: the 504-utterance training subset):
//         the takes the build changes; PESQ (ITU-T P.862.2 wideband, python-pesq, at 16 kHz by resample_poly 1/3) of
//         input and output against the clean take where it changes one; and the umbrella's denoise() in auto mode,
//         each utterance's route and PESQ (run with the workspace's packages: measured before and after a change, the
//         label the hash of denoise-detect's and dehum's sources). Criterion: PESQ does not drop.

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import raw from 'audio-lena/raw'
import { cascade, notch } from '@audio/biquad'

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, '..')
const DATA = path.join(os.homedir(), '.cache', 'audiojs', 'data'), OUT = path.join(DATA, 'tones')
const PY = process.env.PY || path.join(os.homedir(), '.cache', 'audiojs', 'venv', 'bin', 'python')
const [section = 'all', split = 'tune', ...paths] = process.argv.slice(2)
const builds = (paths.length ? paths : [path.join(ROOT, 'packages/denoise-dehum/dehum.js')]).map(p => path.resolve(p))
const label = p => `${path.basename(p, '.js')}-${createHash('sha1').update(readFileSync(p)).digest('hex').slice(0, 8)}`
const load = async p => (await import(pathToFileURL(p).href)).default

// ---- helpers
const f32 = p => new Float32Array(readFileSync(p).buffer.slice(0))
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
const gauss = r => { let u = r() || 1e-12; return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()) }
const E = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s }
const db = v => 10 * Math.log10(v)
const f1 = v => v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(1) : '–'
const f2 = v => Number.isFinite(v) ? v.toFixed(2) : '–'
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN
const ls = (d, ext) => existsSync(d) ? readdirSync(d).filter(f => f.endsWith(ext)).sort().map(f => path.join(d, f)) : []
const sdr = (ref, y) => { let e = 0; for (let i = 0; i < ref.length; i++) e += (y[i] - ref[i]) ** 2; return e > 0 ? db(E(ref) / e) : Infinity }
function wav(file) {                                                  // 16-bit PCM WAV, mono
  let b = readFileSync(file), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), o = 12, fs = 0
  while (o < b.length) {
    let id = b.toString('ascii', o, o + 4), len = dv.getUint32(o + 4, true)
    if (id === 'fmt ') fs = dv.getUint32(o + 12, true)
    if (id === 'data') return { x: Float32Array.from({ length: len >> 1 }, (_, i) => dv.getInt16(o + 8 + 2 * i, true) / 32768), fs }
    o += 8 + len + (len & 1)
  }
}
function fft(re, im) {
  let n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    let ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < len >> 1; j++) {
        let a = i + j, b = a + (len >> 1), tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
        let t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}
// the whole take's power spectrum, Hann
function spectrum(x) {
  let N = 2 ** Math.ceil(Math.log2(x.length)), re = new Float64Array(N), im = new Float64Array(N)
  for (let i = 0; i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / x.length))
  fft(re, im)
  return Float64Array.from({ length: N / 2 + 1 }, (_, k) => re[k] * re[k] + im[k] * im[k])
}
// the input's partials and the most any lost, dB (Infinity under: no partial)
function partialLoss(x, y) {
  let P = spectrum(x), Q = spectrum(y), K = P.length, top = 0, worst = 0, n = 0
  for (let k = 1; k < K - 1; k++) top = Math.max(top, P[k])
  for (let k = 4; k < K - 4; k++) {
    if (!(P[k] > P[k - 1] && P[k] >= P[k + 1] && P[k] >= 1e-5 * top)) continue
    let near = []
    for (let j = Math.max(1, k - 50); j <= Math.min(K - 1, k + 50); j++) if (Math.abs(j - k) > 3) near.push(P[j])
    near.sort((a, b) => a - b)
    if (P[k] < 10 * near[near.length >> 1]) continue
    let a = 0, b = 0
    for (let j = k - 3; j <= k + 3; j++) a += P[j], b += Q[j]
    worst = Math.max(worst, db(a / Math.max(b, 1e-300))); n++
  }
  return { worst, n }
}
function save(sec, lab, obj) { let d = path.join(OUT, split, sec); mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, `${lab}.json`), JSON.stringify(obj)) }
function read(sec, lab) { let f = path.join(OUT, split, sec, `${lab}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null }
function table(head, rows) {
  let w = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)))
  console.log('| ' + head.map((h, i) => h.padEnd(w[i])).join(' | ') + ' |')
  console.log('|' + w.map((v, i) => (i ? '-'.repeat(v + 1) + ':' : '-'.repeat(v + 2))).join('|') + '|')
  for (let r of rows) console.log('| ' + r.map((c, i) => i ? String(c).padStart(w[i]) : String(c).padEnd(w[i])).join(' | ') + ' |')
}

// ---- case
async function caseSection() {
  let { wiener, denoise } = await import(pathToFileURL(path.join(ROOT, 'index.js')).href)
  let fs = 44100, n = fs * 4, lena = new Float32Array(raw), speech = lena.slice(0, n)
  let g = (seed => { let d = new Float32Array(n), s = seed, rnd = () => (s = s * 16807 % 2147483647) / 2147483647; for (let i = 0; i < n; i++) { let v = -6; for (let j = 0; j < 12; j++) v += rnd(); d[i] = 0.01 * v } return d })(7)
  let x = Float32Array.from(speech, (v, i) => v + 0.3 * Math.sin(2 * Math.PI * 7000 * i / fs) + g[i])
  let snr = y => sdr(speech, y), rows = []
  let nt = new Float32Array(x); cascade(nt, [notch(7000, 30, fs)])
  rows.push(['notch Q30 (told) → wiener', '', f2(snr(wiener(nt, { fs })))])
  rows.push(['input', '', f2(snr(x))])
  rows.push(['denoise() auto (workspace)', '', f2(snr(denoise(new Float32Array(x), { fs })))])
  rows.push(["denoise({ force: 'wiener' })", '', f2(snr(denoise(new Float32Array(x), { fs, force: 'wiener' })))])
  for (let b of builds) {
    let dh = await load(b), y = dh(new Float32Array(x), { fs })
    rows.push([label(b), 'dehum', f2(snr(y))], [label(b), 'dehum → wiener', f2(snr(wiener(new Float32Array(y), { fs })))])
  }
  console.log('\n### case: lena 4 s + 7 kHz sine 0.3 + Gaussian 0.01, SNR of the speech (dB)\n')
  table(['system', 'stage', 'SNR'], rows)
}

// ---- synth: tones under speech
function speechClips(dir, clips = 4, per = 4) {
  let files = ls(dir, '.wav'), N = files.length
  return Array.from({ length: clips }, (_, k) => {
    let parts = Array.from({ length: per }, (_, j) => wav(files[(k * 137 + j * 101) % N]).x), x = new Float32Array(parts.reduce((s, p) => s + p.length, 0)), o = 0
    for (let p of parts) x.set(p, o), o += p.length
    return { name: `speech${k}`, x, fs: 48000 }
  })
}
function slow(n, fs, r, tc) {                                        // a smooth random process at 100 Hz, unit variance
  let m = Math.ceil(n / fs * 100) + 2, a = Math.exp(-1 / (tc * 100)), u = 0, v = 0, s = new Float64Array(m), e = 0
  for (let i = -2000; i < m; i++) { u = a * u + (1 - a) * gauss(r); v = a * v + (1 - a) * u; if (i >= 0) s[i] = v, e += v * v }
  let g = Math.sqrt(m / e)
  return t => { let p = t * 100, j = Math.min(Math.floor(p), m - 2); return g * (s[j] + (p - j) * (s[j + 1] - s[j])) }
}
const CONDS = [
  ...[97, 440, 1000, 3150, 7000, 12000, 15734].flatMap(f => [-10, -30, -50].map(lvl => ({ name: `${f} Hz ${lvl} dB`, kind: 'pure', f, lvl }))),
  { name: 'whine 1234.5 Hz ×4 -20 dB', kind: 'whine', f: 1234.5, lvl: -20 },
  { name: 'wander 3 kHz ±0.3 Hz -20 dB', kind: 'wander', f: 3000, lvl: -20 },
  { name: 'late 2 kHz -20 dB', kind: 'late', f: 2000, lvl: -20 },
]
function toneOf(c, n, fs, r) {
  let t = new Float64Array(n), freqs = [c.f]
  if (c.kind === 'whine') { freqs = [1, 2, 3, 4].map(h => h * c.f); for (let h = 1; h <= 4; h++) { let p = 2 * Math.PI * r(); for (let i = 0; i < n; i++) t[i] += Math.sin(2 * Math.PI * h * c.f * i / fs + p) / h } }
  else if (c.kind === 'wander') { let w = slow(n, fs, r, 4), ph = 2 * Math.PI * r(); for (let i = 0; i < n; i++) { ph += 2 * Math.PI * (c.f + 0.3 * w(i / fs)) / fs; t[i] = Math.sin(ph) } }
  else { let p = 2 * Math.PI * r(), late = c.kind === 'late', on = late ? n >> 1 : 0, ramp = Math.round(0.01 * fs); for (let i = on; i < n; i++) t[i] = (late ? Math.min(1, (i - on) / ramp) : 1) * Math.sin(2 * Math.PI * c.f * i / fs + p) }
  return { t, freqs: freqs.filter(f => f < fs / 2) }
}
async function synthSection() {
  let clips = speechClips(path.join(DATA, split === 'tune' ? 'vbdemand-train/clean' : 'vbdemand/clean_testset_wav'))
  let systems = [...builds.map(b => ({ lab: label(b), run: null, path: b })), { lab: 'notch Q30 (told)', notch: true }]
  let res = {}
  for (let s of systems) {
    let cached = s.notch ? null : read('synth', s.lab)
    if (cached) { res[s.lab] = cached; continue }
    let fn = s.notch ? null : await load(s.path), out = {}
    for (let c of CONDS) {
      let rows = []
      for (let [k, clip] of clips.entries()) {
        let { x, fs } = clip, n = x.length, r = lcg(1000 * k + CONDS.indexOf(c) + (split === 'test' ? 77 : 0)), { t, freqs } = toneOf(c, n, fs, r)
        let g = Math.sqrt(E(x) / E(t)) * 10 ** (c.lvl / 20), ts = Float32Array.from(t, v => v * g)
        let sys = y => { if (s.notch) { cascade(y, freqs.map(f => notch(f, 30, fs))); return y } return fn(y, { fs }) }
        let yp = sys(Float32Array.from(x, (v, i) => v + ts[i])), ym = sys(Float32Array.from(x, (v, i) => v - ts[i]))
        let te = 0, pe = 0, oe = 0
        for (let i = 0; i < n; i++) { let h = (yp[i] - ym[i]) / 2, p = (yp[i] + ym[i]) / 2; te += h * h; pe += (p - x[i]) ** 2; oe += (yp[i] - x[i]) ** 2 }
        rows.push({ down: db(E(ts) / Math.max(te, 1e-300)), prog: pe > 0 ? db(E(x) / pe) : Infinity, sdr: db(E(x) / Math.max(oe, 1e-300)), inp: db(E(x) / E(ts)) })
      }
      out[c.name] = rows
      process.stderr.write(`${s.lab} ${c.name}: down ${f1(mean(rows.map(r => r.down)))}, prog ${f1(mean(rows.map(r => Math.min(r.prog, 99))))}\n`)
    }
    if (!s.notch) save('synth', s.lab, out)
    res[s.lab] = out
  }
  console.log(`\n### synth (${split}): tones under speech, mean over ${clips.length} clips: tone down / program SDR / SDR (dB; input SDR = −lvl)\n`)
  let labs = Object.keys(res)
  table(['condition', ...labs], CONDS.map(c => [c.name, ...labs.map(l => { let r = res[l][c.name]; return `${f1(mean(r.map(v => v.down)))} / ${f1(mean(r.map(v => Math.min(v.prog, 99))))} / ${f1(mean(r.map(v => v.sdr)))}` })]))
}

// ---- music: held notes
const midi = m => 440 * 2 ** ((m - 69) / 12)
function synthMusic(kind, seed) {
  let fs = 44100, n = 20 * fs, y = new Float64Array(n), r = lcg(seed)
  let note = (f, t0, t1, amps, { vib = 0, decay = 0, B = 0, att = 0.02, rel = 0.05, a = 0.05 } = {}) => {
    let i0 = Math.max(0, Math.round(t0 * fs)), i1 = Math.min(n, Math.round(t1 * fs)), ph = amps.map(() => 2 * Math.PI * r()), vr = 2 * Math.PI * r()
    for (let i = i0; i < i1; i++) {
      let t = (i - i0) / fs, env = a * Math.min(1, t / att, (i1 - i) / fs / rel), fm = vib ? 2 ** (vib / 1200 * Math.sin(2 * Math.PI * 5.5 * t + vr)) : 1
      for (let k = 0; k < amps.length; k++) {
        let h = k + 1, fk = f * h * Math.sqrt(1 + B * h * h)
        ph[k] += 2 * Math.PI * fk * fm / fs
        y[i] += env * amps[k] * (decay ? Math.exp(-t / (decay / Math.sqrt(h))) : 1) * Math.sin(ph[k])
      }
    }
  }
  let organ = Array.from({ length: 6 }, (_, k) => 1 / (k + 1)), flute = [1, 0.03]
  let melody = (t0, t1, lo, hi, d0, d1, gap, amps, o = {}) => { for (let t = t0; t < t1;) { let d = d0 + (d1 - d0) * r(), m = lo + Math.floor((hi - lo) * r()); note(midi(m), t, Math.min(t + d, t1), amps, o); t += d + gap } }
  if (kind === 'organ') for (let t = 0.5; t < 19;) { let d = 1.5 + 2 * r(), m = 48 + Math.floor(12 * r()), third = r() < 0.5 ? 3 : 4; for (let s of [0, third, 7]) note(midi(m + s), t, Math.min(t + d, 19.5), organ); t += d + 0.3 + 0.5 * r() }
  if (kind === 'flute') melody(0.5, 19.5, 60, 84, 0.8, 3, 0.15, flute, { att: 0.04 })
  if (kind === 'pedal') { note(midi(36), 1, 18, Array.from({ length: 8 }, (_, k) => 1 / (k + 1))); melody(1.5, 17.5, 67, 84, 0.5, 1.5, 0.2, flute, { att: 0.04 }) }
  if (kind === 'strings') melody(0.3, 19.7, 55, 79, 2, 4, 0, Array.from({ length: 10 }, (_, k) => 1 / (k + 1)), { vib: 30, att: 0.08, rel: 0.08 })
  if (kind === 'piano') melody(0.3, 19.7, 48, 84, 0.4, 1, 0, Array.from({ length: 8 }, (_, k) => 1 / (k + 1)), { decay: 1.2, B: 1e-4, att: 0.003, rel: 0.02 })
  if (kind === 'drone') { note(midi(43), 0, 20, organ, { att: 0.001, rel: 0.001 }); melody(0.5, 19.5, 67, 84, 0.5, 1.5, 0.2, flute, { att: 0.04 }) }
  let rf = lcg(seed + 1)
  return Float32Array.from(y, v => v + 1e-4 * gauss(rf))
}
function musicSet() {
  let set = [], tune = split === 'tune'
  for (let kind of ['organ', 'flute', 'pedal', 'strings', 'piano', 'drone']) for (let s = 0; s < 3; s++)
    set.push({ name: `synth-${kind}-${s}`, group: kind === 'drone' ? 'drone (no onset, no pause)' : 'synthetic held notes', load: () => ({ x: synthMusic(kind, (tune ? 1 : 101) + 10 * s + kind.length), fs: 44100 }) })
  for (let f of ls(path.join(DATA, 'vocalset/FULL'), '').flatMap(d => ['straight', 'messa', 'pp', 'forte', 'trill', 'trillo', 'inhaled'].flatMap(t => ls(path.join(d, 'long_tones', t), '.wav')))) {
    let singer = +path.basename(path.dirname(path.dirname(path.dirname(f)))).replace(/\D/g, '')
    if ((singer % 2 === 1) === tune) set.push({ name: path.basename(f, '.wav'), group: 'VocalSet long tones', load: () => wav(f) })
  }
  ls(path.join(DATA, 'musdb', tune ? 'train-mono' : 'test-mono'), '.f32').filter((_, i) => !tune || i % 3 === 0)
    .forEach(f => set.push({ name: `musdb-${path.basename(f, '.f32')}`, group: 'MUSDB18 previews', load: () => ({ x: f32(f), fs: 44100 }) }))
  ls(path.join(DATA, 'slakh/mix44'), '.wav').filter((_, i) => (i % 2 === 0) === tune)
    .forEach(f => set.push({ name: path.basename(f, '.wav'), group: 'BabySlakh mixes', load: () => { let w = wav(f); return { x: w.x.slice(10 * w.fs, 40 * w.fs), fs: w.fs } } }))
  ls(path.join(DATA, 'guitarset/audio_mono-mic'), '.wav').filter((_, i) => i % 24 === 0).filter((_, i) => (i % 2 === 0) === tune)
    .forEach(f => set.push({ name: path.basename(f, '.wav'), group: 'GuitarSet', load: () => wav(f) }))
  if (!tune) for (let k of ['vibeace', 'brahms', 'nutcracker', 'trumpet']) {
    let f = path.join(DATA, 'repair', `${k}.f32`)
    if (existsSync(f)) set.push({ name: k, group: 'the four pieces', load: () => { let x = f32(f), s = x.length > 40 * 44100 ? 5 * 44100 : 0; return { x: x.slice(s, s + 30 * 44100), fs: 44100 } } })
  }
  return set
}
async function musicSection() {
  let set = musicSet(), res = {}
  for (let b of builds) {
    let lab = label(b), cached = read('music', lab)
    if (cached) { res[lab] = cached; continue }
    let fn = await load(b), out = {}
    for (let it of set) {
      let { x, fs } = it.load(), y = fn(new Float32Array(x), { fs }), changed = y.some((v, i) => v !== x[i])
      out[it.name] = { group: it.group, changed, sdr: changed ? sdr(x, y) : Infinity, loss: changed ? partialLoss(x, y).worst : 0 }
      if (changed) process.stderr.write(`${lab} ${it.name}: changed, SDR ${f1(out[it.name].sdr)}, worst partial −${f2(out[it.name].loss)} dB\n`)
    }
    save('music', lab, out); res[lab] = out
  }
  console.log(`\n### music (${split}): held notes, no tone added: takes changed / of them, worst partial loss (dB) / takes over 0.5 dB\n`)
  let labs = Object.keys(res), groups = [...new Set(set.map(s => s.group))]
  table(['material', 'takes', ...labs], groups.map(g => {
    let names = set.filter(s => s.group === g).map(s => s.name)
    return [g, names.length, ...labs.map(l => { let v = names.map(nm => res[l][nm]).filter(Boolean), ch = v.filter(r => r.changed); return `${ch.length} / ${f2(Math.max(0, ...ch.map(r => r.loss)))} / ${ch.filter(r => r.loss >= 0.5).length}` })]
  }))
  for (let l of labs) for (let [nm, r] of Object.entries(res[l])) if (r.changed) console.log(`  ${l}  ${nm}: SDR ${f1(r.sdr)} dB, worst partial −${f2(r.loss)} dB`)
}

// ---- speech: VoiceBank+DEMAND, PESQ
function pesq(pairs) {                                               // [[ref.f32, deg.f32], …] at 48 kHz → PESQ wb at 16 kHz
  if (!pairs.length) return []
  let list = path.join(OUT, 'tmp', `pairs-${process.pid}.json`); writeFileSync(list, JSON.stringify(pairs))
  let code = `import json,sys,numpy as np
from scipy.signal import resample_poly
from pesq import pesq
out=[]
for r,d in json.load(open(sys.argv[1])):
    a=resample_poly(np.fromfile(r,dtype=np.float32).astype(np.float64),1,3); b=resample_poly(np.fromfile(d,dtype=np.float32).astype(np.float64),1,3)
    try: out.append(pesq(16000,a,b,'wb'))
    except Exception: out.append(None)
print(json.dumps(out))`
  let p = spawnSync(PY, ['-c', code, list], { encoding: 'utf8', maxBuffer: 1 << 26 })
  if (p.status) throw new Error(p.stderr)
  return JSON.parse(p.stdout)
}
async function speechSection() {
  mkdirSync(path.join(OUT, 'tmp'), { recursive: true })
  let tune = split === 'tune', cdir = path.join(DATA, tune ? 'vbdemand-train/clean' : 'vbdemand/clean_testset_wav'), ndir = path.join(DATA, tune ? 'vbdemand-train/noisy' : 'vbdemand/noisy_testset_wav')
  let names = ls(cdir, '.wav').map(f => path.basename(f)).filter(f => existsSync(path.join(ndir, f)))
  let tmp = (tag, nm, x) => { let f = path.join(OUT, 'tmp', `${tag}-${nm}.f32`); writeFileSync(f, Buffer.from(new Float32Array(x).buffer)); return f }
  let inPesq = read('speech', 'input')
  if (!inPesq) {
    let pairs = names.map(nm => [tmp('clean', nm, wav(path.join(cdir, nm)).x), tmp('noisy', nm, wav(path.join(ndir, nm)).x)])
    let s = pesq(pairs); inPesq = Object.fromEntries(names.map((nm, i) => [nm, s[i]])); save('speech', 'input', inPesq)
  }
  let res = {}
  for (let b of builds) {
    let lab = label(b), cached = read('speech', lab)
    if (cached) { res[lab] = cached; continue }
    let fn = await load(b), out = { noisy: {}, clean: [] }, pairs = [], who = []
    for (let nm of names) {
      let c = wav(path.join(cdir, nm)).x, x = wav(path.join(ndir, nm)).x
      let yc = fn(new Float32Array(c), { fs: 48000 }); if (yc.some((v, i) => v !== c[i])) out.clean.push(nm)
      let y = fn(new Float32Array(x), { fs: 48000 })
      if (y.some((v, i) => v !== x[i])) { pairs.push([path.join(OUT, 'tmp', `clean-${nm}.f32`), tmp('out', nm, y)]); who.push(nm) }
    }
    pesq(pairs).forEach((s, i) => out.noisy[who[i]] = s)
    save('speech', lab, out); res[lab] = out
  }
  // the umbrella's auto mode, the workspace's packages
  let src = ['packages/denoise-detect/denoise.js', 'packages/denoise-dehum/dehum.js'].map(f => readFileSync(path.join(ROOT, f))).join('')
  let alab = `auto-${createHash('sha1').update(src).digest('hex').slice(0, 8)}`
  if (!read('speech', alab)) {
    let { denoise } = await import(pathToFileURL(path.join(ROOT, 'index.js')).href), routes = {}, pairs = []
    for (let nm of names) {
      let x = wav(path.join(ndir, nm)).x, { out, plan } = denoise(x, { fs: 48000, returnPlan: true })
      routes[nm] = plan.method; pairs.push([path.join(OUT, 'tmp', `clean-${nm}.f32`), tmp('auto', nm, out)])
    }
    let s = pesq(pairs)
    save('speech', alab, Object.fromEntries(names.map((nm, i) => [nm, { route: routes[nm], pesq: s[i] }])))
  }
  console.log(`\n### speech (${split}): VoiceBank+DEMAND, ${names.length} utterances\n`)
  let rows = []
  for (let [l, r] of Object.entries(res)) {
    let ch = Object.keys(r.noisy), d = ch.map(nm => r.noisy[nm] - inPesq[nm])
    rows.push([l, `${r.clean.length}`, `${ch.length}`, ch.length ? `${f2(mean(ch.map(nm => inPesq[nm])))} → ${f2(mean(ch.map(nm => r.noisy[nm])))}` : '–', ch.length ? f2(Math.min(...d)) : '–'])
  }
  table(['dehum build', 'clean changed', 'noisy changed', 'PESQ of those, in → out', 'worst ΔPESQ'], rows)
  let autos = readdirSync(path.join(OUT, split, 'speech')).filter(f => f.startsWith('auto-')).map(f => f.slice(0, -5))
  console.log('\ndenoise() auto, workspace builds (route counts; mean PESQ; input mean PESQ ' + f2(mean(names.map(nm => inPesq[nm]))) + ')\n')
  table(['auto build', 'routes', 'PESQ'], autos.map(a => { let r = read('speech', a), v = Object.values(r), c = {}; for (let q of v) c[q.route] = (c[q.route] || 0) + 1; return [a + (a === alab ? ' (now)' : ''), Object.entries(c).map(([k, n]) => `${k} ${n}`).join(', '), f2(mean(v.map(q => q.pesq).filter(p => p != null)))] }))
}

for (let s of section === 'all' ? ['case', 'synth', 'music', 'speech'] : [section]) await ({ case: caseSection, synth: synthSection, music: musicSection, speech: speechSection })[s]()
