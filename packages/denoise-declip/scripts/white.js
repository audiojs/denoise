// The white-block bound, measured: declip as it is against its rebuild with every sparse block run from k = 1
// (aspade.js, the loop declip runs, without the bound), take by take: the SNR against the sound before the clip or the
// curve, the dB the bound gives up (+) or gains (−), the CPU seconds of each (process.cpuUsage, one call after another).
//   node scripts/white.js            white Gaussian noise (σ 0.15) clipped at 1, 1.5 and 2 σ and uniform noise (±0.5)
//                                    clipped at 0.35, 0.3 s at 16, 22.05, 44.1 and 96 kHz, the rail given and, at 1 and
//                                    1.5 σ, found blind; white noise through tanh at drive 4; 8192 stereo frames of a
//                                    uniform noise through the manifest; the passes a white block makes (about 4 minutes)
//   node scripts/white.js --random [n]  n (60) random takes of white or uniform noise, 8–48 kHz, hard-clipped at a random
//                                    level or through tanh or arctan at drive 2–6 (about 2 minutes of CPU for 60, 20
//                                    for 300); a larger n goes on from the same draw
//   node scripts/white.js --curves   the 116 of 311 takes (speech, tones, Gaussian or uniform noise, through tanh or
//                                    arctan, and 11 named ones; seed 4242) a curve restores (about 30 minutes)
//   node scripts/white.js --flatness the white test's spread: white Gaussian noise in blocks of 1024 to 16384 under the
//                                    window, whole and cut to a quarter by the take's edge, 500 of each; the spectral
//                                    flatness's mean and its standard deviation times √(the samples on the take)
// The SNR is taken as it is on a hard clip, after the best scale on a curve (a curve's gain is no restorer's to know).
import declip from '../declip.js'
import { unbounded } from './aspade.js'

const args = process.argv.slice(2)
const cpu = () => { let u = process.cpuUsage(); return (u.user + u.system) / 1e6 }
const lcg = seed => { let s = seed; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; return { rnd, gauss: () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()) } }
const clamp = (x, L) => Float32Array.from(x, v => Math.min(L, Math.max(-L, v)))
const snr = (x, z) => { let s = 0, e = 0; for (let i = 0; i < x.length; i++) s += x[i] ** 2, e += (x[i] - z[i]) ** 2; return 10 * Math.log10(s / e) }
const snrg = (x, z) => { let xz = 0, zz = 0; for (let i = 0; i < x.length; i++) xz += x[i] * z[i], zz += z[i] * z[i]; return snr(x, Float64Array.from(z, v => v * xz / zz)) }

// per white block run from k = 1 (declip's test: its lines' spectral flatness within four of its deviations of
// e^(−γ)): the passes, and the share of the lines at which the least residual first falls under the first pass's
let white = []
const tally = r => { if (r.white) white.push(r) }

// each take bounded, then from k = 1; `changed`: only the takes declip changes (the others are no take of the bound's);
// a take with no sound before it to measure against (x null) is counted by its samples alone
async function run(takes, changed = false) {
  let rows = [], ran = 0
  for (let { what, x, y, p, g } of takes) {
    let t0 = cpu(), b = declip(y, p), tb = cpu() - t0
    if (changed && b.every((v, i) => v === y[i])) continue
    ran++
    t0 = cpu(); let a = await unbounded(y, p, tally), ta = cpu() - t0
    let same = a.every((v, i) => Object.is(v, b[i]))
    if (!x) { console.log(`${what}: ${same ? 'the same samples' : 'not the same samples'} (no sound before it to measure against); CPU ${ta.toFixed(1)} → ${tb.toFixed(1)} s`); continue }
    let m = g ? snrg : snr, r = { what, in: m(x, y), a: m(x, a), b: m(x, b), ta, tb, same }
    rows.push(r)
    console.log(`${what}: in ${r.in.toFixed(2)} dB, from k = 1 ${r.a.toFixed(2)}, bounded ${r.b.toFixed(2)} (${r.same ? 'the same samples' : `given up ${(r.a - r.b).toFixed(3)} dB`}); CPU ${ta.toFixed(1)} → ${tb.toFixed(1)} s`)
  }
  let d = rows.map(r => r.a - r.b), ta = rows.reduce((s, r) => s + r.ta, 0), tb = rows.reduce((s, r) => s + r.tb, 0)
  if (changed) console.log(`${ran} of ${takes.length} takes changed`)
  console.log(`${rows.length} takes measured, ${rows.filter(r => r.same).length} the same samples: given up ${Math.min(...d).toFixed(3)} to ${Math.max(...d).toFixed(3)} dB, mean ${(d.reduce((s, v) => s + v, 0) / d.length).toFixed(3)}, over 0.1 dB on ${d.filter(v => v > 0.1).length}; CPU ${ta.toFixed(1)} → ${tb.toFixed(1)} s`)
}

if (args.includes('--flatness')) {
  let { gauss } = lcg(1), { fft } = await import('fourier-transform')
  for (let w of [1024, 2048, 4096, 8192, 16384]) for (let s of [w, w / 4]) {
    let N = 2 * w, H = w + 1, buf = new Float64Array(N), spec = [new Float64Array(H), new Float64Array(H)], F = []
    for (let r = 0; r < 500; r++) {
      buf.fill(0)
      for (let i = w - s; i < w; i++) buf[i] = gauss() * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / w))
      let [re, im] = fft(buf, spec), lg = 0, ar = 0
      for (let j = 0; j < H; j++) { let p = re[j] * re[j] + im[j] * im[j]; lg += Math.log(p), ar += p }
      F.push(Math.exp(lg / H) / (ar / H))
    }
    let m = F.reduce((a, b) => a + b, 0) / F.length, sd = Math.sqrt(F.reduce((a, b) => a + (b - m) ** 2, 0) / F.length)
    let low = Math.min(...F.map(f => (f - Math.exp(-0.5772156649015329)) * Math.sqrt(s) / 0.64))
    console.log(`a block of ${w}, ${s} samples on the take: flatness ${m.toFixed(4)} (e^(−γ) ${Math.exp(-0.5772156649015329).toFixed(4)}), its deviation × √${s} ${(sd * Math.sqrt(s)).toFixed(3)}, the lowest ${low.toFixed(2)} of 0.64/√${s}`)
  }
} else if (args.includes('--random')) {
  let { rnd, gauss } = lcg(9001), takes = [], count = +args[args.indexOf('--random') + 1] || 60
  for (let t = 0; t < count; t++) {
    let fs = [8000, 16000, 22050, 44100, 48000][Math.floor(5 * rnd())], n = Math.round(fs * (0.2 + 0.3 * rnd())), uni = rnd() < 0.5, kind = Math.floor(3 * rnd())
    let x = Float32Array.from({ length: n }, () => uni ? 0.5 * (2 * rnd() - 1) : 0.15 * gauss()), y, p = { fs }, what
    if (kind < 2) {
      let L = uni ? 0.5 * (0.3 + 0.6 * rnd()) : 0.15 * (0.5 + 2 * rnd())
      y = clamp(x, L); if (kind === 0) p.clipLevel = L
      what = `${uni ? 'uniform ±0.5' : 'white σ 0.15'} clipped at ${L.toFixed(3)}, ${kind === 0 ? 'rail given' : 'blind'}, ${fs} Hz`
    } else {
      let d = 2 + 4 * rnd(), f = rnd() < 0.5 ? Math.tanh : Math.atan
      y = Float32Array.from(x, v => 0.6 * f(d * v / 0.5) / f(d))
      what = `${uni ? 'uniform ±0.5' : 'white σ 0.15'} through ${f === Math.tanh ? 'tanh' : 'arctan'} at drive ${d.toFixed(1)}, ${fs} Hz`
    }
    takes.push({ what: `${t}: ${what}`, x, y, p, g: kind === 2 })
  }
  await run(takes)
} else if (args.includes('--curves')) {
  // 11 named takes, then 300 random ones: speech 0–1, Gaussian or uniform noise 5–55 dB down, a tone, through tanh or
  // arctan at drive 1–6 for half of them (seed 4242)
  let raw = (await import('audio-lena/raw')).default, lena = new Float32Array(raw), FS = 44100, N = FS, seed = 4242, takes = []
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296, gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd())
  const norm = (x, p) => { let m = 0; for (let v of x) m = Math.max(m, Math.abs(v)); return x.map(v => v * p / m) }
  const pink = len => { let b0 = 0, b1 = 0, b2 = 0; return Float32Array.from({ length: len }, () => { let w = gauss(); b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; return 0.05 * (b0 + b1 + b2 + w * 0.1848) }) }
  let classes = [
    ['uniform white ±0.3', () => [Float32Array.from({ length: N }, () => 0.3 * (2 * rnd() - 1)), null]],
    ['Gaussian white', () => { let y = norm(Float32Array.from({ length: N }, gauss), 0.5); return [y, y] }],
    ['tanh(2·Gaussian white)', () => { let g = Float64Array.from({ length: N }, gauss); return [Float32Array.from(g, v => 0.5 * Math.tanh(2 * 0.3 * v)), g] }],
    ['tanh(4·Gaussian white)', () => { let g = Float64Array.from({ length: N }, gauss); return [Float32Array.from(g, v => 0.5 * Math.tanh(4 * 0.3 * v)), g] }],
    ['arctan(4·Gaussian white)', () => { let g = Float64Array.from({ length: N }, gauss); return [Float32Array.from(g, v => 0.4 * Math.atan(4 * 0.3 * v)), g] }],
    ['pink', () => { let y = norm(pink(N), 0.5); return [y, y] }],
    ['tanh(3·pink)', () => { let p = norm(pink(N), 1); return [p.map(v => 0.5 * Math.tanh(3 * v)), p] }],
    ['speech', () => { let y = norm(lena.slice(0, N), 0.7); return [y, y] }],
    ['tanh(3·speech)', () => { let s = norm(lena.slice(0, N), 1); return [s.map(v => 0.6 * Math.tanh(3 * v)), s] }],
    ['speech + uniform floor at −20 dB', () => { let s = norm(lena.slice(FS, FS + N), 0.7), y = s.map(v => v + 0.07 * (2 * rnd() - 1)); return [y, y] }],
    ['tanh(3·(speech + Gaussian at −6 dB))', () => { let s = norm(lena.slice(2 * FS, 2 * FS + N), 0.5), v = Float64Array.from(s, u => u + 0.25 * gauss()); return [Float32Array.from(v, u => 0.6 * Math.tanh(3 * u)), v] }],
  ]
  for (let [what, make] of classes) { let [y, x] = make(); takes.push({ what, x, y }) }
  for (let t = 0; t < 300; t++) {
    let len = Math.floor(FS * (0.3 + 0.7 * rnd())), off = Math.floor(rnd() * (lena.length - len)), sp = rnd(), nz = 10 ** (-(5 + 50 * rnd()) / 20), f0 = 60 + 4000 * rnd(), ac = 0.3 * rnd()
    let drive = rnd() < 0.5 ? 1 + 5 * rnd() : 0, curve = rnd() < 0.5 ? Math.tanh : Math.atan, uni = rnd() < 0.3, x = new Float32Array(len), v0 = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      let v = sp * lena[off + i] + (uni ? nz * (2 * rnd() - 1) : nz * gauss()) + ac * Math.sin(2 * Math.PI * f0 * i / FS)
      v0[i] = v, x[i] = drive ? 0.6 * curve(drive * v) / curve(drive) : 0.9 * v
    }
    takes.push({ what: `take ${t}`, x: v0, y: x })
  }
  // a take a curve restores is one declip changes
  await run(takes.map(t => ({ ...t, p: { fs: FS }, g: true })), true)
} else {
  // the passes a white block makes: k from 1, and from ⌈0.3 H⌉, k grown by max(1, ⌊k/50⌋) until every line is kept
  for (let w of [1024, 2048, 4096, 8192, 16384]) {
    let H = w + 1, count = k0 => { let p = 0; for (let k = k0; ; k += Math.max(1, Math.floor(k / 50))) { p++; if (k >= H) return p } }
    console.log(`a white block of ${w}: ${count(1)} passes from k = 1, ${count(Math.ceil(0.3 * H))} from 0.3 of its lines`)
  }
  let takes = []
  // 0.3 s of each noise at each rate, its own seed
  for (let fs of [16000, 22050, 44100, 96000]) {
    let n = Math.round(0.3 * fs), cases = []
    for (let k of [1, 1.5, 2]) cases.push([`white noise clipped at ${k} σ`, g => Float32Array.from({ length: n }, () => 0.15 * g.gauss()), 0.15 * k, k < 2])
    cases.push(['uniform noise clipped at 0.35', g => Float32Array.from({ length: n }, () => (2 * g.rnd() - 1) * 0.5), 0.35, false])
    for (let [i, [what, gen, L, blind]] of cases.entries()) {
      let x = gen(lcg(4242 + 17 * i + fs)), y = clamp(x, L)
      takes.push({ what: `${what}, ${fs} Hz, rail given`, x, y, p: { fs, clipLevel: L } })
      if (blind) takes.push({ what: `${what}, ${fs} Hz, blind`, x, y, p: { fs } })
    }
  }
  { // 0.4 s of white noise through tanh at drive 4 (seed 77)
    let { gauss } = lcg(77), n = Math.round(0.4 * 44100), x = Float32Array.from({ length: n }, () => 0.3 * gauss()), m = 0
    for (let v of x) m = Math.max(m, Math.abs(v))
    x = x.map(v => v / m * 0.8)
    takes.push({ what: 'white noise through tanh at drive 4, 44100 Hz', x, y: x.map(v => 0.6 * Math.tanh(4 * v) / Math.tanh(4)), p: { fs: 44100 }, g: true })
  }
  white = []
  await run(takes)
  let fell = white.filter(r => r.fell < 1).map(r => r.fell).sort((a, b) => a - b), q = p => fell[Math.min(fell.length - 1, Math.floor(p * fell.length))]
  console.log(`${white.length} white blocks run from k = 1: the least residual first under the block's own at ${q(0).toFixed(2)}–${q(1).toFixed(2)} of the lines (median ${q(0.5).toFixed(2)})${white.length - fell.length ? `, never in ${white.length - fell.length}` : ''}`)
  // the manifest on 8192 stereo frames of uniform noise ±0.3 (the validator's length), each channel declip()
  let r = 0x2545f491, rand = () => (r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32, ch = [0, 1].map(() => Float32Array.from({ length: 8192 }, () => 0.3 * (2 * rand() - 1)))
  let { declip: atom } = await import('../audio.js'), params = { clipLevel: Float32Array.of(0), order: Float32Array.of(256) }, out = ch.map(c => new Float32Array(c.length))
  let t0 = cpu(); for (let c of ch) await unbounded(c, { fs: 44100, clipLevel: 0, order: 256 }); let ta = cpu() - t0
  t0 = cpu(); atom({ sampleRate: 44100, maxBlockSize: 8192, maxChannels: 2, params })([ch], [out], params); let tb = cpu() - t0
  console.log(`the manifest, 8192 stereo frames of uniform noise: CPU ${ta.toFixed(1)} s from k = 1, ${tb.toFixed(1)} s bounded`)
}
