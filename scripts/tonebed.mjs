// Steady tones and classify()'s noise bed: a line is no bed, and a bed under a line reads at its own level. Run:
// `node scripts/tonebed.mjs SECTION [BUILD.js ...]` (a minute or two a build), SECTION `matrix` or `lines`, each BUILD
// a denoise-detect denoise.js where its imports resolve (default: the workspace's), one column each.
//
// matrix  6 s takes, the tone(s) from 0.5 to 5.5 s at 0.4 peak, digital silence either side:
//           tone    1 kHz
//           bursts  300 Hz from 0.5 to 2 s and from 3.5 to 5 s
//           chord   C major: 261.63, 329.63, 392 Hz
//           sweep   exponential, 50 Hz to 0.45 fs
//           reed    196 Hz and its harmonics under 0.45 fs at 1/h
//         each over digital silence (exact zeros between and around), over a 16-bit file's dither (the take rounded
//         to 1/32768 over TPDF dither of ±1 LSB, the silence too), and over a bed: white Gaussian noise 20, 30, 40 dB
//         under the tone's power while it sounds, through the whole take; at 8, 16, 44.1 and 48 kHz. Per build: the
//         method, scores.snr, scores.steady; for a bed, the reading's error re the level it was made at, and re its
//         level under the program as classify() reads the program (frames of its sweep's length and hop within 40 dB
//         of the loudest, their mean power, over the bed's mean power in the same frames): the bursts' program holds
//         the bed's frames between them (at 48 kHz, where the bands cover 22.6 of the 24 kHz, a bed made 20 or 30 dB
//         down reads 2.7 dB under that, 0.2 to 0.3 over its level under the program)
// lines   takes that hold nothing but lines: 1 kHz, 440, 300, 100, 3150 and 7000 Hz sines, the chord, the reed; as
//         bursts, at two levels (0.4 from 0.5 to 2.5 s, 0.04 from 3.5 to 5.5 s), stepping down (0.4, then 0.04 from
//         3 s), fading 30 dB over the take, alone (0.4 throughout), quiet (0.01 throughout); over digital silence and
//         over the dither; at 8, 16, 22.05, 44.1, 48 and 96 kHz: 576 takes, those each build reads a bed in (snr under
//         BED_SNR), by kind
import { fileURLToPath } from 'url'
const here = fileURLToPath(new URL('.', import.meta.url))
const [section = 'matrix', ...paths] = process.argv.slice(2)
const builds = paths.length ? paths : [here + '../packages/denoise-detect/denoise.js']
const mods = await Promise.all(builds.map(b => import(new URL(b, `file://${process.cwd()}/`))))
const BED_SNR = mods[0].BED_SNR ?? 25
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 }
const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r())
const dither = (x, r) => Float32Array.from(x, v => Math.round(v * 32768 + r() - r()) / 32768)
const f1 = v => v === Infinity ? '∞' : v.toFixed(1)
const sine = f => t => Math.sin(2 * Math.PI * f * t)
const chord = t => [261.63, 329.63, 392].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) / 3
const reed = (t, fs) => { let s = 0; for (let h = 1; 196 * h < 0.45 * fs; h++) s += Math.sin(2 * Math.PI * 196 * h * t + h) / h; return s / 2 }

if (section === 'matrix') {
  const on = t => t >= 0.5 && t < 5.5
  const shapes = {
    tone: (t) => on(t) ? sine(1000)(t) : 0,
    bursts: (t) => (t >= 0.5 && t < 2) || (t >= 3.5 && t < 5) ? sine(300)(t) : 0,
    chord: (t) => on(t) ? chord(t) : 0,
    sweep: (t, fs) => { if (!on(t)) return 0; let f1 = 50, k = Math.log(0.45 * fs / f1); return Math.sin(2 * Math.PI * f1 * 5 / k * (Math.exp(k * (t - 0.5) / 5) - 1)) },
    reed: (t, fs) => on(t) ? reed(t, fs) : 0,
  }
  const take = (shape, fs) => { let x = Float64Array.from({ length: 6 * fs }, (_, i) => shapes[shape](i / fs, fs)), pk = x.reduce((a, v) => Math.max(a, Math.abs(v)), 0); return x.map(v => v * 0.4 / pk) }
  const tonePower = x => { let s = 0, c = 0; for (let v of x) if (v !== 0) { s += v * v; c++ } return s / c }
  // the bed's level under the program as classify() reads the program
  const program = (y, n, fs) => {
    let N = 2 ** Math.round(Math.log2(0.046 * fs)), hop = N >> 2, py = [], pn = []
    for (let a = 0; a + N <= y.length; a += hop) { let sy = 0, sn = 0; for (let i = a; i < a + N; i++) { sy += y[i] * y[i]; sn += n[i] * n[i] } py.push(sy); pn.push(sn) }
    let pk = Math.max(...py), act = py.filter(v => v >= pk * 1e-4)
    return 10 * Math.log10(act.reduce((a, b) => a + b, 0) / act.length / (pn.reduce((a, b) => a + b, 0) / pn.length))
  }
  console.log(`| take | over | kHz | ${builds.map((_, i) => `build ${i + 1}`).join(' | ')} | error re the level made | re the program |\n|---|---|---:|${builds.map(() => '---|').join('')}---:|---:|`)
  let seed = 1
  for (let shape of Object.keys(shapes)) for (let bg of ['silence', 'dither', 20, 30, 40]) for (let fs of [8000, 16000, 44100, 48000]) {
    let x = take(shape, fs), r = lcg(seed++), y, n
    if (bg === 'silence') y = Float32Array.from(x)
    else if (bg === 'dither') y = dither(x, r)
    else { let g = Math.sqrt(tonePower(x) / 10 ** (bg / 10)); n = Float32Array.from(x, () => g * gauss(r)); y = Float32Array.from(x, (v, i) => v + n[i]) }
    let cs = mods.map(m => m.classify(y, fs)), err = (c, v) => (c.scores.snr - v).toFixed(1)
    console.log(`| ${shape} | ${n ? `bed ${bg} dB` : bg} | ${fs / 1000} | ${cs.map(c => `${c.method} ${f1(c.scores.snr)}${c.scores.steady ? ' steady' : ''}`).join(' | ')} | ${n ? cs.map(c => err(c, bg)).join(', ') : ''} | ${n ? cs.map(c => err(c, program(y, n, fs))).join(', ') : ''} |`)
  }
}

if (section === 'lines') {
  const shapes = { '1 kHz': sine(1000), '440 Hz': sine(440), '300 Hz': sine(300), '100 Hz': sine(100), '3150 Hz': sine(3150), '7 kHz': sine(7000), chord, reed }
  const envs = {
    bursts: t => (t >= 0.5 && t < 2) || (t >= 3.5 && t < 5) ? 0.4 : 0,
    'two levels': t => t > 0.5 && t < 2.5 ? 0.4 : t > 3.5 && t < 5.5 ? 0.04 : 0,
    stepping: t => t < 3 ? 0.4 : 0.04,
    fading: t => 0.4 * 10 ** (-30 * t / 6 / 20),
    alone: () => 0.4,
    quiet: () => 0.01,
  }
  let n = 0, beds = mods.map(() => [])
  for (let [s, g] of Object.entries(shapes)) for (let [e, env] of Object.entries(envs)) for (let fs of [8000, 16000, 22050, 44100, 48000, 96000]) for (let over of ['silence', 'dither']) {
    let r = lcg(++n), x = Float32Array.from({ length: 6 * fs }, (_, i) => env(i / fs) * g(i / fs, fs))
    if (over === 'dither') x = dither(x, r)
    mods.forEach((m, j) => { let c = m.classify(x, fs); if (c.scores.snr < BED_SNR) beds[j].push({ k: `${e} over ${over}`, s, fs, c }) })
  }
  builds.forEach((b, j) => {
    console.log(`\nbuild ${j + 1} (${b}): a bed read in ${beds[j].length} of ${n} takes holding lines alone`)
    let kinds = [...new Set(beds[j].map(v => v.k))]
    for (let k of kinds) { let v = beds[j].filter(w => w.k === k); console.log(`  ${k}: ${v.length} (${v.map(w => `${w.s} ${w.fs / 1000} kHz ${f1(w.c.scores.snr)}`).join('; ')})`) }
  })
}
