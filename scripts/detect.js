// Measure @audio/denoise-detect's routing on labelled material. Run: `node scripts/detect.js [tune|test] [path to a
// denoise.js]` (minutes; an earlier version's denoise.js where its imports resolve, e.g. `git show v:path >
// packages/denoise-detect/old.js`). Prints the README's tables: per class of material, the method classify() picks
// and the share routed right; per noise, the noisy speech and music routed to a reducer; then what denoise() does to
// the material with nothing to remove: the share passed untouched and, for the rest, samples changed and the error re
// the input.
//   `node scripts/detect.js tune|test reduce` puts each noisy take (VoiceBank+DEMAND, DEMAND, wind, white and pink
// noise) through wiener, omlsa and dewind as denoise() runs them, into ~/.cache/audiojs/data/detect/<set>/, and
// `python scripts/detect.py score tune|test` scores them per noise (PESQ, STOI, DNSMOS): which reducer a bed should get.
//
// Material, from ~/.cache/audiojs/data (never committed); each set is skipped where missing:
//   speech  VoiceBank+DEMAND (Valentini-Botinhao 2017, CC BY 4.0), every utterance: tune, the 28-speaker training
//           subset (`python scripts/speech.py fetch`); test, the test set. Clean, and its noisy twin (DEMAND noises,
//           babble, speech-shaped noise; 0–15 dB in training, 2.5–17.5 dB in the test set; types from its logs).
//   +noise  every 18th of those clean takes under white, pink or babble (six other VoiceBank talkers) noise at 0, 10,
//           20 dB re its active level (20 ms frames within 40 dB of the loudest); 30 dB: borderline, not scored.
//   +DEMAND every 4th clean take under a DEMAND recording (Thiemann, Ito & Vincent 2013, CC BY-SA 3.0; ch01, 48 kHz,
//           `python scripts/detect.py fetch`) of a kind in neither VoiceBank+DEMAND set: washing machine, field, park,
//           river, hallway; high-passed at 20 Hz (its power lies mostly under 20 Hz: the washing machine's drum at
//           16 Hz holds all but 0.1 dB of it), a stretch from its first half for tune, its second for test, at 2.5,
//           7.5, 12.5, 17.5 dB in turn.
//   +recorded wind  every 6th clean take under scripts/wind.py's recorded and generated wind (its tune or test half)
//           at 10 and 0 dB in turn: dewind or a reducer both count as right.
//   narration  Spoken Wikipedia (CC BY-SA), volunteers at home, 15 s at 10 s and at 40 s of each: spoken-train/ (tune)
//           or spoken/ (test), 48 kHz float32.
//   music   repair/*.f32 (tune; see scripts/repair.js), VocalSet (Wilkins et al. 2018, CC BY 4.0; tune: singers m1 f2
//           m2 f1, test: f3 f4 m3 m4), Slakh2100 mixes (Manilow et al. 2019, CC BY 4.0; even tracks tune, odd test),
//           GuitarSet mic takes (Xi et al. 2018, CC BY 4.0), MUSDB18 7 s previews' mixtures (Rafii et al. 2017;
//           train or test, every 3rd, decoded by ffmpeg when on the PATH). Clean: none of these is to be denoised.
//   +noise  every 2nd piece under white or pink noise at 10, 20 dB re its active level; 30 dB not scored; every
//           piece under the DEMAND recordings above at 10 and 20 dB.
//   +hum, +clicks, +wind  every 6th clean take and every 3rd piece: mains hum 20 dB under (12 harmonics at −6 dB/oct,
//           0.05 Hz off 50 or 60), clicks one every 0.25–0.45 s at 5× the RMS around (scripts/declick.js' ticks and
//           pops), wind at 0 and 10 dB (noise under 100–300 Hz in gusts of 0.3–2 s, calms of 0.2–1.5 s, the shape
//           Nelke & Vary, IWAENC 2014, measure).

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { spawnSync } from 'child_process'
import { homedir } from 'os'

const set = process.argv[2] || 'tune', T = set === 'test', REDUCE = process.argv[3] === 'reduce'
const { default: denoise, classify } = await import(process.argv[3] && !REDUCE ? new URL(process.argv[3], `file://${process.cwd()}/`) : '@audio/denoise-detect')
const H = `${homedir()}/.cache/audiojs/data`
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r())
const pw = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s / Math.max(1, b - a) }
const ls = (d, ext = '.wav') => existsSync(d) ? readdirSync(d).filter(f => f.endsWith(ext)).sort() : []
const f32 = p => { let b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) }
function wav(path) {
  let b = readFileSync(path), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), o = 12, fs = 0, ch = 1, bits = 16
  while (o < b.length) {
    let id = b.toString('ascii', o, o + 4), sz = dv.getUint32(o + 4, true)
    if (id === 'fmt ') { ch = dv.getUint16(o + 10, true); fs = dv.getUint32(o + 12, true); bits = dv.getUint16(o + 22, true) }
    if (id === 'data') {
      let n = Math.floor(sz / (bits / 8) / ch), x = new Float32Array(n)
      for (let i = 0; i < n; i++) x[i] = bits === 16 ? dv.getInt16(o + 8 + i * 2 * ch, true) / 32768 : dv.getFloat32(o + 8 + i * 4 * ch, true)
      return { x, fs }
    }
    o += 8 + sz + (sz & 1)
  }
}
const asl = (s, fs) => { let L = Math.round(0.02 * fs), p = []; for (let i = 0; i + L <= s.length; i += L) p.push(pw(s, i, i + L)); let mx = Math.max(...p), a = p.filter(v => v > mx * 1e-4); return a.reduce((x, y) => x + y, 0) / a.length }
const mix = (s, n, fs, snr) => { let g = Math.sqrt(asl(s, fs) / pw(n) / 10 ** (snr / 10)); return s.map((v, i) => v + g * n[i]) }

// ---- defects
const white = (n, seed) => { let r = lcg(seed); return Float32Array.from({ length: n }, () => gauss(r)) }
function pink(n, seed) {   // Kellet's filter
  let w = white(n, seed), b = [0, 0, 0, 0, 0, 0, 0]
  return w.map(v => {
    b[0] = 0.99886 * b[0] + v * 0.0555179; b[1] = 0.99332 * b[1] + v * 0.0750759; b[2] = 0.969 * b[2] + v * 0.153852
    b[3] = 0.8665 * b[3] + v * 0.3104856; b[4] = 0.55 * b[4] + v * 0.5329522; b[5] = -0.7616 * b[5] - v * 0.016898
    let y = 0.11 * (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + v * 0.5362); b[6] = v * 0.115926; return y
  })
}
let talkers
function babble(n, seed) {
  talkers ??= ls(`${H}/vbdemand-train/clean`).filter((_, i) => i % 18 === 9).map(f => wav(`${H}/vbdemand-train/clean/${f}`).x)
  let r = lcg(seed), x = new Float32Array(n)
  for (let t = 0; t < 6; t++) {
    let s = talkers[Math.floor(r() * talkers.length)], g = 1 / Math.sqrt(asl(s, 48000)), o = Math.floor(r() * s.length)
    for (let i = 0; i < n; i++) x[i] += g * s[(i + o) % s.length]
  }
  return x
}
function wind(n, fs, seed) {
  let r = lcg(seed), x = new Float32Array(n), q = Math.exp(-2 * Math.PI * (100 + 200 * r()) / fs), ae = Math.exp(-2 * Math.PI * 3 / fs), ag = Math.exp(-1 / (0.05 * fs))
  let l1 = 0, l2 = 0, e = 0, on = r() < 0.5, left = 0, g = 0
  for (let i = 0; i < n; i++) {
    if (left-- <= 0) { on = !on; left = Math.round((on ? 0.3 + 1.7 * r() : 0.2 + 1.3 * r()) * fs) }
    g = ag * g + (1 - ag) * (on ? 1 : 0.03)
    l1 = q * l1 + (1 - q) * gauss(r); l2 = q * l2 + (1 - q) * l1
    e = ae * e + (1 - ae) * gauss(r) * 40
    x[i] = l2 * g * 10 ** (Math.max(-1, Math.min(1, e)) * 6 / 20)
  }
  return x
}
// DEMAND, 20 Hz high-pass (2nd-order Butterworth, RBJ biquad), as scripts/wind.py treats its recordings
function hp20(x, fs) {
  let w = 2 * Math.PI * 20 / fs, al = Math.sin(w) / Math.SQRT2, c = Math.cos(w), a0 = 1 + al, b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0
  let a1 = -2 * c / a0, a2 = (1 - al) / a0, x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return x.map(v => { let y = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; return y })
}
const KINDS = ['DWASHING', 'NFIELD', 'NPARK', 'NRIVER', 'OHALLWAY'], demand = {}
const stretch = (k, n, r) => {   // n samples of DEMAND kind k from its first half (tune) or second (test)
  let x = demand[k] ??= hp20(wav(`${H}/demand/${k}/ch01.wav`).x, 48000), h = x.length >> 1, o = (T ? h : 0) + Math.floor(r() * (h - n))
  return x.subarray(o, o + n)
}
const hum = (n, fs, f0) => { let x = new Float32Array(n); for (let h = 1; h <= 12; h++) for (let i = 0; i < n; i++) x[i] += Math.sin(2 * Math.PI * h * (f0 + 0.05) * i / fs + h) / h; return x }
const kinds = {
  tick: (r, fs) => { let f = 2000 + r() * 6000, t = (0.05 + r() * 0.25) * fs / 1000; return Array.from({ length: Math.ceil(5 * t) }, (_, n) => Math.exp(-n / t) * Math.cos(2 * Math.PI * f * n / fs)) },
  pop: (r, fs) => { let f = 300 + r() * 1200, t = (0.3 + r() * 0.7) * fs / 1000; return Array.from({ length: Math.ceil(5 * t) }, (_, n) => Math.exp(-n / t) * Math.sin(2 * Math.PI * f * n / fs + 0.3)) }
}
function clicked(clean, fs, kind, seed) {
  let r = lcg(seed), x = clean.slice()
  for (let at = Math.round(0.3 * fs); at < clean.length - 0.3 * fs; at += Math.round(fs * (0.25 + r() * 0.2))) {
    let level = Math.max(1e-3, Math.sqrt(pw(clean, at - fs / 100, at + fs / 100))), h = kinds[kind](r, fs), pk = Math.max(...h.map(Math.abs)), sign = r() < 0.5 ? -1 : 1
    for (let j = 0; j < h.length; j++) x[at + j] += sign * 5 * level * h[j] / pk
  }
  return x
}

// ---- material: { name, cls, want } with want 'none' | 'reduce' (wiener or omlsa) | a method | 'gray' (not scored)
function* material() {
  let vb = T ? `${H}/vbdemand/clean_testset_wav` : `${H}/vbdemand-train/clean`, vn = T ? `${H}/vbdemand/noisy_testset_wav` : `${H}/vbdemand-train/noisy`
  let lg = `${H}/vbdemand-train/logs/log_${T ? 'testset' : 'trainset_28spk'}.txt`, kind = new Map(existsSync(lg) ? readFileSync(lg, 'utf8').trim().split('\n').map(l => l.trim().split(/\s+/)) : [])
  let all = ls(vb).map(f => ({ name: f, ...wav(`${vb}/${f}`) })), speech = all.filter((_, i) => i % 6 === 0)
  for (let s of all) {
    if (!REDUCE) yield { ...s, cls: 'speech', want: 'none' }
    if (existsSync(`${vn}/${s.name}`)) yield { name: s.name, ...wav(`${vn}/${s.name}`), clean: s.x, cls: 'speech, VoiceBank+DEMAND noisy', type: kind.get(s.name.slice(0, -4)), want: 'reduce' }
  }
  if (KINDS.every(k => existsSync(`${H}/demand/${k}/ch01.wav`))) for (let [j, s] of all.filter((_, i) => i % 4 === 0).entries()) {
    let k = KINDS[j % 5], snr = [2.5, 7.5, 12.5, 17.5][(j / 5 | 0) % 4]
    yield { name: s.name, fs: s.fs, x: mix(s.x, stretch(k, s.x.length, lcg(j)), s.fs, snr), clean: s.x, cls: 'speech + DEMAND', type: k, want: 'reduce' }
  }
  let W = ['151853', '207443', '397641', '611197', '718030', '117773', '170439', '239485', '592387', '623003', '760989', '20108'].slice(T ? 6 : 0, T ? 12 : 6).map(n => `real/${n}`)
  W.push(...Array.from({ length: 6 }, (_, i) => `sc/sc${T ? i + 7 : i + 1}`))
  if (W.every(w => existsSync(`${H}/wind/${w}.f32`))) for (let [j, s] of all.filter((_, i) => i % 6 === 0).entries()) {
    let w = f32(`${H}/wind/${W[j % W.length]}.f32`), o = Math.floor(lcg(j)() * (w.length - s.x.length))
    yield { name: s.name, fs: s.fs, x: mix(s.x, w.subarray(o, o + s.x.length), s.fs, (j / W.length | 0) % 2 ? 0 : 10), clean: s.x, cls: 'speech + recorded wind', type: W[j % W.length].split('/')[0], want: 'wind' }
  }
  for (let [j, s] of speech.filter((_, i) => i % 3 === 0).entries())
    for (let [k, gen] of [['white', white], ['pink', pink], ['babble', babble]]) for (let snr of [0, 10, 20, 30])
      yield { name: s.name, fs: s.fs, x: mix(s.x, gen(s.x.length, 100 + j), s.fs, snr), clean: s.x, cls: `speech + ${k}`, want: snr <= 20 ? 'reduce' : 'gray' }
  let sp = `${H}/${T ? 'spoken' : 'spoken-train'}`
  for (let f of ls(sp, '.f32')) { let x = f32(`${sp}/${f}`); for (let a of [10, 40]) if (x.length >= (a + 15) * 48000) yield { name: f, x: x.subarray(a * 48000, (a + 15) * 48000), fs: 48000, cls: 'narration', want: 'none' } }
  let music = []
  if (!T) for (let [n, a, b] of [['vibeace', 5, 15], ['vibeace', 40, 50], ['brahms', 5, 15], ['nutcracker', 5, 15], ['nutcracker', 60, 70], ['trumpet', 0, 6]])
    if (existsSync(`${H}/repair/${n}.f32`)) music.push({ name: n, x: f32(`${H}/repair/${n}.f32`).subarray(a * 44100, b * 44100), fs: 44100 })
  for (let s of T ? ['female3', 'female4', 'male3', 'male4'] : ['male1', 'female2', 'male2', 'female1'])
    for (let sub of ['excerpts/vibrato', 'excerpts/straight', 'long_tones/forte', 'arpeggios/slow_piano', 'scales/belt']) {
      let d = `${H}/vocalset/FULL/${s}/${sub}`, f = ls(d)[0]
      if (f) { let w = wav(`${d}/${f}`); music.push({ name: f, x: w.x.subarray(0, 12 * w.fs), fs: w.fs }) }
    }
  for (let f of ls(`${H}/slakh/mix44`).filter((_, i) => i % 2 === (T ? 1 : 0))) { let w = wav(`${H}/slakh/mix44/${f}`); music.push({ name: f, x: w.x.subarray(30 * w.fs, 40 * w.fs), fs: w.fs }) }
  for (let f of ls(`${H}/guitarset/audio_mono-mic`).filter((_, i) => i % 36 === (T ? 18 : 0))) { let w = wav(`${H}/guitarset/audio_mono-mic/${f}`); music.push({ name: f, x: w.x.subarray(0, 12 * w.fs), fs: w.fs }) }
  let md = `${H}/musdb/${T ? 'test' : 'train'}`
  if (!spawnSync('ffmpeg', ['-version']).error) for (let f of ls(md, '.stem.mp4').filter((_, i) => i % 3 === 0).slice(0, 16)) {
    let r = spawnSync('ffmpeg', ['-v', 'error', '-i', `${md}/${f}`, '-map', '0:a:0', '-ac', '1', '-ar', '44100', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 })
    if (r.stdout?.length) music.push({ name: f, x: new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length)), fs: 44100 })
  }
  music = music.filter(m => m.x.length >= m.fs)
  for (let m of music) yield { ...m, cls: 'music', want: 'none' }
  for (let [j, m] of music.filter((_, i) => i % 2 === 0).entries()) for (let [k, gen] of [['white', white], ['pink', pink]]) for (let snr of [10, 20, 30])
    yield { name: m.name, fs: m.fs, x: mix(m.x, gen(m.x.length, 300 + j), m.fs, snr), cls: `music + ${k}`, want: snr <= 20 ? 'reduce' : 'gray' }
  if (KINDS.every(k => existsSync(`${H}/demand/${k}/ch01.wav`))) for (let [j, m] of music.entries()) for (let snr of [10, 20]) {
    let k = KINDS[(j + snr / 10) % 5]   // 48 kHz as is under 44.1 kHz music: 9% lower, no matter for a bed
    yield { name: m.name, fs: m.fs, x: mix(m.x, stretch(k, m.x.length, lcg(500 + j)), m.fs, snr), cls: 'music + DEMAND', type: k, want: 'reduce' }
  }
  let some = [...speech.filter((_, i) => i % 6 === 1).map(s => ({ ...s, k: 'speech' })), ...music.filter((_, i) => i % 3 === 1).map(m => ({ ...m, k: 'music' }))]
  for (let [j, s] of some.entries()) {
    yield { name: s.name, fs: s.fs, x: mix(s.x, hum(s.x.length, s.fs, j % 2 ? 60 : 50), s.fs, 20), cls: `${s.k} + hum`, want: 'dehum' }
    for (let k of ['tick', 'pop']) yield { name: s.name, fs: s.fs, x: clicked(s.x, s.fs, k, 7 + j + k.length), cls: `${s.k} + clicks`, want: 'declick' }
    for (let snr of [0, 10]) yield { name: s.name, fs: s.fs, x: mix(s.x, wind(s.x.length, s.fs, 50 + j), s.fs, snr), clean: s.k === 'speech' ? s.x : undefined, cls: `${s.k} + wind`, want: 'dewind' }
  }
}

// ---- reduce: each noisy take with its clean twin through the reducers, as denoise() runs them
if (REDUCE) {
  const run = { wiener: (await import('@audio/denoise-wiener')).default, omlsa: (await import('@audio/denoise-omlsa')).default, dewind: (await import('@audio/denoise-dewind')).default }
  let dir = `${H}/detect/${set}`, meta = []
  for (let d of ['clean', 'noisy', ...Object.keys(run)]) mkdirSync(`${dir}/${d}`, { recursive: true })
  for (let it of material()) {
    if (!it.clean || it.want === 'gray') continue
    let id = `${meta.length}`, out = d => `${dir}/${d}/${id}.f32`
    meta.push({ id, cls: it.cls, type: it.type ?? it.cls.replace('speech + ', ''), fs: it.fs, name: it.name })
    if (!existsSync(out('noisy'))) { writeFileSync(out('clean'), Float32Array.from(it.clean)); writeFileSync(out('noisy'), Float32Array.from(it.x)) }
    for (let [k, f] of Object.entries(run)) if (!existsSync(out(k))) writeFileSync(out(k), Float32Array.from(f(Float32Array.from(it.x), { fs: it.fs })))
  }
  writeFileSync(`${dir}/meta.json`, JSON.stringify(meta))
  console.log(`${meta.length} takes in ${dir}; score them: python scripts/detect.py score ${set}`)
  process.exit()
}

// ---- route, tally
const methods = ['none', 'wiener', 'omlsa', 'dehum', 'declick', 'dewind', 'deesser']
const right = (w, m) => w === m || ((w === 'reduce' || w === 'wind') && (m === 'wiener' || m === 'omlsa')) || (w === 'wind' && m === 'dewind')
let rows = new Map(), byNoise = new Map(), clean = [], sec = 0, ms = 0
for (let it of material()) {
  let t = performance.now(), m = classify(it.x, it.fs).method
  ms += performance.now() - t; sec += it.x.length / it.fs
  let k = `${it.cls} → ${it.want}`, r = rows.get(k) ?? { want: it.want, n: 0, by: {} }
  r.n++; r.by[m] = (r.by[m] || 0) + 1; rows.set(k, r)
  if (it.type && it.want === 'reduce') { let q = `${it.cls.replace('speech, ', '')}: ${it.type}`, v = byNoise.get(q) ?? [0, 0]; v[0]++; v[1] += right('reduce', m); byNoise.set(q, v) }
  if (it.want === 'none') {
    let y = m === 'none' ? it.x : denoise(Float32Array.from(it.x), { fs: it.fs }), c = 0, e = 0
    for (let i = 0; i < it.x.length; i++) { let d = y[i] - it.x[i]; if (d) c++; e += d * d }
    clean.push({ cls: it.cls, m, frac: c / it.x.length, err: c ? 10 * Math.log10(e / pw(it.x) / it.x.length) : -Infinity })
  }
}
console.log(`\n${set}: classify() of every item, ${(ms / sec).toFixed(1)} ms per second of sound\n\n| material → wanted | n | ${methods.join(' | ')} | right |\n|---|---:|${methods.map(() => '---:|').join('')}---:|`)
let scored = 0, good = 0
for (let [k, r] of rows) {
  let ok = methods.reduce((s, m) => s + (right(r.want, m) ? r.by[m] || 0 : 0), 0)
  if (r.want !== 'gray') { scored += r.n; good += ok }
  console.log(`| ${k} | ${r.n} | ${methods.map(m => r.by[m] || '·').join(' | ')} | ${r.want === 'gray' ? '—' : Math.round(100 * ok / r.n) + '%'} |`)
}
console.log(`\nscored ${scored}: ${(100 * good / scored).toFixed(1)}% routed right`)
console.log(`\nto a reducer, per noise:\n\n| noise | n | right |\n|---|---:|---:|`)
for (let [k, [n, ok]] of [...byNoise].sort()) console.log(`| ${k} | ${n} | ${Math.round(100 * ok / n)}% |`)
let none = clean.filter(c => c.m === 'none'), hit = clean.filter(c => c.m !== 'none'), med = a => a.sort((p, q) => p - q)[a.length >> 1]
console.log(`\nnothing to remove (${clean.length}): ${none.length} untouched; ${hit.length} processed` + (hit.length ? `, median ${(100 * med(hit.map(c => c.frac))).toFixed(1)}% of samples changed, error ${med(hit.map(c => c.err)).toFixed(1)} dB re the input (${[...new Set(hit.map(c => c.m))].map(m => `${m} ${hit.filter(c => c.m === m).length}`).join(', ')})` : ''))
