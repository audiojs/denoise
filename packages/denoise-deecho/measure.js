// The README's measures. Run: `node measure.js [section…]` (all of them about 10 minutes; the music where
// ~/.cache/audiojs/data holds it:
// MUSDB18's mono previews, musdb/test-mono and musdb/train-mono, 44.1 kHz float32, and GuitarSet's audio_mono-mic, as
// the family's scripts fetch them).
//   echoes   on lena (12.3 s and 4 s of it) and two MUSDB18 test previews (02, 30): one copy and repeats at 3 ms to 1 s,
//            gains 0.5, 0.2 and 0.08; a whole delay made sample for sample, a fractional one by the ideal band-limited
//            delay. Per delay: how many found, what is left of the echo (the error to the dry take, dB), the delay's and
//            the gain's error
//   none     takes with no echo: the synthetic ones test.js passes, lena, MUSDB18's test and train previews, GuitarSet
//   noise    white noise 40, 30, 20 dB under lena, added after an 80 ms echo of 0.5
//   filtered a reflection whose highs a wall took: the copy through a one-pole lowpass at 8, 4, 2 kHz, 0.5 at 30, 120 ms
//   time     one channel at 44.1 kHz, 4 s to 10 minutes
import raw from 'audio-lena/raw'
import { fft, ifft } from 'fourier-transform'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import deecho, { estimate } from './deecho.js'

const fs = 44100, lena = new Float32Array(raw), DATA = `${homedir()}/.cache/audiojs/data`
const lcg = seed => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5 }
const E = x => { let s = 0; for (let v of x) s += v * v; return s }
const err = (y, x) => { let s = 0, e = 0; for (let i = 0; i < x.length; i++) s += (y[i] - x[i]) ** 2, e += x[i] ** 2; return 10 * Math.log10(s / e) }
const f32 = p => new Float32Array(readFileSync(p).buffer.slice(0))
const pow2 = n => 2 ** Math.ceil(Math.log2(n))
function lines(x, D, g, f) { let y = Float64Array.from(x), w = new Float64Array(x.length); for (let n = D; n < x.length; n++) w[n] = x[n - D] + f * w[n - D], y[n] += g * w[n]; return y }
function ideal(x, D, g, f = 0) {
  let M = pow2(x.length + 64 * D), p = new Float64Array(M); p.set(x)
  let [r0, i0] = fft(p), re = Float64Array.from(r0), im = Float64Array.from(i0)
  for (let k = 0; k <= M / 2; k++) {
    let w = 2 * Math.PI * k / M, zr = Math.cos(w * D), zi = -Math.sin(w * D), dr = 1 - f * zr, di = -f * zi, d = dr * dr + di * di
    let hr = 1 + g * (zr * dr + zi * di) / d, hi = g * (zi * dr - zr * di) / d, a = re[k], b = im[k]
    re[k] = a * hr - b * hi, im[k] = a * hi + b * hr
  }
  return ifft(re, im).slice(0, x.length)
}
const echoed = (x, ms, g, f) => { let D = ms / 1000 * fs; return Number.isInteger(D) ? lines(x, D, g, f) : ideal(x, D, g, f) }

const only = process.argv.slice(2), run = name => !only.length || only.includes(name)

if (run('echoes')) {
console.log('## echoes: found / cases, the echo left (dB of the dry take, worst to best), the delay\'s error (samples), the gain\'s\n')
let takes = [['lena 12 s', lena], ['lena 4 s', lena.subarray(fs, 5 * fs)]]
for (let p of ['02', '30']) if (existsSync(`${DATA}/musdb/test-mono/${p}.f32`)) takes.push([`MUSDB18 ${p}`, f32(`${DATA}/musdb/test-mono/${p}.f32`)])
console.log(`| delay | ${takes.map(t => t[0]).join(' | ')} |\n|---|${takes.map(() => '---|').join('')}`)
for (let ms of [3, 12.34, 30, 80, 100, 150, 150.37, 400, 1000]) {
  let cells = takes.map(([, x]) => {
    let found = 0, left = [], dD = 0, dg = 0, n = 0
    for (let g of [0.5, 0.2, 0.08]) for (let f of [0, g]) {
      let y = echoed(x, ms, g, f), [e] = estimate(y, { fs }); n++
      if (!e) continue
      found++, left.push(err(deecho(y, { fs, echoes: [e] }), x)), dD = Math.max(dD, Math.abs(e.delay * fs - ms / 1000 * fs)), dg = Math.max(dg, Math.abs(e.gain - g))
    }
    return found ? `${found}/${n}, ${Math.max(...left).toFixed(0)} to ${Math.min(...left).toFixed(0)}, ${dD.toFixed(2)}, ${dg.toFixed(3)}` : `0/${n}`
  })
  console.log(`| ${ms} ms | ${cells.join(' | ')} |`)
}
}

if (run('none')) {
console.log('\n## none: takes with no echo, those an echo was found in\n')
let n = 6 * fs, r = lcg(5), none = [
  ['white noise', Float32Array.from({ length: n }, () => r())],
  ['a 440 Hz tone', Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / fs))],
  ['a sawtooth', Float32Array.from({ length: n }, (_, i) => { let s = 0; for (let h = 1; h * 110 < 16000; h++) s += Math.sin(2 * Math.PI * h * 110 * i / fs) / h; return 0.1 * s })],
  ['a pulse every 10 ms', Float32Array.from({ length: n }, (_, i) => i % 441 ? 0 : 0.5)],
  ['silence', new Float32Array(n)], ['lena', lena]]
let sets = [['synthetic and lena', none]]
for (let half of ['test', 'train']) { let d = `${DATA}/musdb/${half}-mono`; if (existsSync(d)) sets.push([`MUSDB18 ${half} previews`, readdirSync(d).filter(f => f.endsWith('.f32')).sort().map(f => [f, f32(`${d}/${f}`)])]) }
let gs = `${DATA}/guitarset/audio_mono-mic`
if (existsSync(gs)) sets.push(['GuitarSet, every 18th take, 12 s', readdirSync(gs).filter(f => f.endsWith('.wav')).sort().filter((_, i) => i % 18 === 0).map(f => {
  let b = readFileSync(`${gs}/${f}`), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), o = 12
  while (o < b.length) { let id = b.toString('ascii', o, o + 4), len = dv.getUint32(o + 4, true); if (id === 'data') return [f, Float32Array.from({ length: Math.min(len / 2, 12 * fs) }, (_, i) => dv.getInt16(o + 8 + 2 * i, true) / 32768)]; o += 8 + len + (len & 1) }
})])
for (let [name, list] of sets) {
  let hit = list.filter(([, x]) => estimate(x, { fs }).length).map(([f]) => f)
  console.log(`${name}: ${hit.length} of ${list.length}${hit.length ? ': ' + hit.join(', ') : ''}`)
}
}

if (run('noise')) {
console.log('\n## noise added after an 80 ms echo of 0.5 on lena\n')
for (let snr of [40, 30, 20]) {
  let r = lcg(9), s = Math.sqrt(E(lena) / lena.length) * 10 ** (-snr / 20) * Math.sqrt(12), noise = Float32Array.from(lena, () => s * r())
  let y = lines(lena, 3528, 0.5, 0).map((v, i) => v + noise[i]), dry = lena.map((v, i) => v + noise[i]), [e] = estimate(y, { fs })
  console.log(`${snr} dB under: ${e ? `${(e.delay * 1000).toFixed(3)} ms, gain ${e.gain.toFixed(3)}, feedback ${e.feedback.toFixed(3)}` : 'none'}; the dry take and its noise ${err(y, dry).toFixed(1)} → ${err(deecho(y, { fs }), dry).toFixed(1)} dB`)
}
}

if (run('filtered')) {
console.log('\n## a reflection filtered: the copy through a one-pole lowpass, gain 0.5, on lena\n')
for (let fc of [8000, 4000, 2000]) for (let ms of [30, 120]) {
  let D = Math.round(ms / 1000 * fs), a = Math.exp(-2 * Math.PI * fc / fs), lp = new Float64Array(lena.length), y = Float64Array.from(lena)
  for (let n = 0; n < lena.length; n++) lp[n] = (1 - a) * lena[n] + a * (n ? lp[n - 1] : 0)
  for (let n = D; n < lena.length; n++) y[n] += 0.5 * lp[n - D]
  let es = estimate(y, { fs })
  console.log(`${fc} Hz, ${ms} ms: ${es.map(e => `${(e.delay * 1000).toFixed(2)} ms, gain ${e.gain.toFixed(3)}`).join(' + ') || 'none'}; ${err(y, lena).toFixed(1)} → ${err(deecho(y, { fs, echoes: es }), lena).toFixed(1)} dB`)
}
}

if (run('time')) {
console.log('\n## time, one channel at 44.1 kHz (lena tiled, an 80 ms echo of 0.5)\n')
for (let sec of [4, 12, 60, 600]) {
  let x = Float32Array.from({ length: Math.round(sec * fs) }, (_, i) => lena[i % lena.length] * (1 + 0.1 * Math.floor(i / lena.length))), y = Float32Array.from(lines(x, 3528, 0.5, 0))
  let t = performance.now(), es = estimate(y, { fs }), te = performance.now() - t
  t = performance.now(); deecho(y, { fs, echoes: es }); let tw = performance.now() - t
  t = performance.now(); deecho(y, { fs, echoes: [{ delay: 3528.37 / fs, gain: 0.5, feedback: 0 }] }); let tf = performance.now() - t
  console.log(`${sec} s: the estimate ${(te / 1000).toFixed(2)} s; the removal ${(tw / 1000).toFixed(2)} s at a whole delay, ${(tf / 1000).toFixed(2)} s at a fractional one`)
}
}
