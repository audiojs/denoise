// What specsub, wiener, omlsa and dewind allocate in a process's first stream, second by second, while V8 compiles the
// code they run once a hop and takes for the first time the paths a stream reaches late. Run:
//   node scripts/firststream.js [seconds, 90] [--own] [--flags=a,b] [--runs=N]
// Each processor alone in a fresh child Node, as a real-time host calls it: the manifest (@audio/denoise-<x>/audio),
// stereo at 44.1 kHz, its defaults, blocks of 128 frames, its inputs and outputs made before any count; each second of
// sound (345 blocks, 1.0014 s) what the young generation, the stores of typed arrays and the old generation take in
// between two forced minor collections (the measure of test.js and of the contract validator). The validator's flags
// (synchronous compilation, no pretenuring, no concurrent sweeping of array buffers), or with `--own` Node's own (the
// compiler on its thread, so the code runs interpreted longer); `--flags` adds V8 flags to either. Two sounds: the
// validator's noise (σ 0.15, 0.19 s looped), and speech in noise (audio-lena's 12.3 s, 20 dB over pink noise, looped);
// then 10 s of a second instance in the same process. A processor that copies its input, through the same harness,
// reads the measure's own floor. Prints, per processor and sound: the first second, each later second over 1 KB, and
// the most of the others (with JSON=1 in the environment, every second as JSON too). With `--runs=N`, N fresh
// processes each, and per process what the seconds from 20 on took together: what V8 compiles on its own thread lands
// at a moment that differs from run to run, and with it what a stream allocates.

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const FLAGS = ['--expose-gc', '--no-concurrent-recompilation', '--no-allocation-site-pretenuring', '--no-concurrent-array-buffer-sweeping']
const SR = 44100, B = 128, SEC = 345, R = 64

if (process.argv[2] === '--child') child(JSON.parse(process.argv[3]))
else main()

async function child({ pkg, name, sound, seconds }) {
  let v8 = (await import('node:v8')).default, minor = { type: 'minor' }
  let sp = { young: ['new_space', 'new_large_object_space'], old: ['old_space', 'large_object_space'] }
  let used = (g, w) => g.heapSpaceStatistics.reduce((a, s) => sp[w].includes(s.spaceName) ? a + s.spaceUsedSize : a, 0)
  let taken = f => {
    let p = new v8.GCProfiler(), t = 0
    p.start(); gc(minor); f(); gc(minor)
    let g = p.stop().statistics
    for (let i = 1; i < g.length; i++) { let a = g[i - 1].afterGC, b = g[i].beforeGC; t += used(b, 'young') - used(a, 'young') + Math.max(0, used(b, 'old') - used(a, 'old')) + b.heapStatistics.externalMemory - a.heapStatistics.externalMemory }
    return t
  }
  // the copying processor: what the harness itself reads
  let copy = () => (inputs, outputs) => { for (let c = 0; c < inputs[0].length; c++) outputs[0][c].set(inputs[0][c]) }
  copy.params = {}
  let m = pkg ? (await import(`@audio/denoise-${pkg}/audio`))[name] : copy
  let params = Object.fromEntries(Object.entries(m.params).map(([k, p]) => [k, p.type === 'number' ? Float32Array.of(p.default) : p.default]))
  // the sound, per channel, played block by block and looped
  let s = 999, u = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
  let gauss = () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u())
  let src
  if (sound === 'noise') src = [0, 1].map(() => Float32Array.from({ length: B * R }, () => 0.15 * gauss()))
  else {
    let speech = new Float32Array((await import('audio-lena/raw')).default), n = speech.length, rms = 0
    for (let i = 0; i < n; i++) rms += speech[i] * speech[i]
    rms = Math.sqrt(rms / n)
    src = [0, 1].map(() => {
      let pink = new Float32Array(n), b0 = 0, b1 = 0, b2 = 0, p = 0
      for (let i = 0; i < n; i++) { let w = gauss(); b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; pink[i] = b0 + b1 + b2 + w * 0.1848; p += pink[i] * pink[i] }
      let g = rms / Math.sqrt(p / n) / 10, x = new Float32Array(n)
      for (let i = 0; i < n; i++) x[i] = speech[i] + g * pink[i]
      return x
    })
  }
  let L = src[0].length, nb = Math.floor(L / B), outs = [[new Float32Array(B), new Float32Array(B)]]
  let blocks = Array.from({ length: nb }, (_, k) => [src.map(c => c.subarray(k * B, k * B + B))])
  let make = () => m({ sampleRate: SR, maxBlockSize: B, maxChannels: 8, params })
  let run = (proc, secs) => {
    let k = 0, row = []
    let f = () => { for (let i = 0; i < SEC; i++) { proc(blocks[k], outs, params); if (++k === nb) k = 0 } }
    for (let t = 0; t < secs; t++) row.push(taken(f))
    return row
  }
  let first = run(make(), seconds), second = run(make(), 10)
  console.log(JSON.stringify({ first, second }))
}

function main() {
  let args = process.argv.slice(2), own = args.includes('--own'), seconds = +args.find(a => /^\d+$/.test(a)) || 90
  let runs = +(args.find(a => a.startsWith('--runs='))?.slice(7) ?? 1), self = fileURLToPath(import.meta.url)
  let more = args.find(a => a.startsWith('--flags='))?.slice(8).split(',') ?? []
  console.log(`# Node ${process.version} ${process.platform} ${process.arch}, ${own ? "Node's own flags" : "the validator's flags"}${more.length ? ` and ${more.join(' ')}` : ''}, ${seconds} s at 44.1 kHz, blocks of 128${runs > 1 ? `, ${runs} runs` : ''}`)
  let kb = b => b < 1024 ? `${b} B` : b < 1 << 20 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`
  for (let [pkg, name] of [[null, 'copy'], ['spectral', 'specsub'], ['wiener', 'wiener'], ['omlsa', 'omlsa'], ['dewind', 'dewind']]) for (let sound of ['noise', 'speech']) {
    let flags = [...(own ? ['--expose-gc'] : FLAGS), ...more]
    let one = () => JSON.parse(execFileSync(process.execPath, [...flags, self, '--child', JSON.stringify({ pkg, name, sound, seconds })], { encoding: 'utf8', maxBuffer: 1 << 26 }))
    if (runs > 1) {
      let late = Array.from({ length: runs }, () => one().first.slice(20).reduce((a, b) => a + b, 0))
      console.log(`${name.padEnd(8)} ${sound.padEnd(7)} 20-${seconds} s, each run: ${late.map(kb).join(', ')}`)
      continue
    }
    let r = one(), over = r.first.map((b, t) => [t, b]).slice(1).filter(([, b]) => b > 1024), rest = r.first.slice(1).filter(b => b <= 1024)
    console.log(`${name.padEnd(8)} ${sound.padEnd(7)} 0-1 s ${kb(r.first[0])}; over 1 KB: ${over.length ? over.map(([t, b]) => `${t}-${t + 1} s ${kb(b)}`).join(', ') : 'none'}; the rest at most ${kb(Math.max(0, ...rest))}; a second instance: 0-1 s ${kb(r.second[0])}, then at most ${kb(Math.max(...r.second.slice(1)))}`)
    if (process.env.JSON) console.log(JSON.stringify({ name, sound, own, ...r }))
  }
}
