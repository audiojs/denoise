# @audio/denoise-spectral [![npm](https://img.shields.io/npm/v/@audio/denoise-spectral)](https://www.npmjs.com/package/@audio/denoise-spectral) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Spectral subtraction (Boll 1979) with Berouti over-subtraction + spectral floor

```
npm install @audio/denoise-spectral
```

```js
import specsub from '@audio/denoise-spectral'
```

Power spectral subtraction with over-subtraction and a spectral floor (Berouti, Schwartz & Makhoul 1979): |Ŝ|² = |Y|² − α·N̂ where that stays above β·N̂, else β·N̂. Over-subtraction takes out the noise's peaks that plain subtraction leaves as musical tones; the floor, a fraction of the noise estimate, fills the valleys with a steady bed that masks what is left. α follows the frame's SNR (4 − 3/20·SNR: 4.75 at −5 dB down to 1 at 20 dB) unless fixed. The noise PSD is tracked by minimum statistics (Martin 2001) over a 1.5 s window, in batch and stream alike, unless a profile or a noise-only stretch is given; a held note, a sustained vowel or a chord is kept out of it (@audio/noise-estimate's `partials`, as [`omlsa`](https://github.com/audiojs/denoise#omlsa) has it: clean music cut by more than 3 dB 10.3 → 3.2 %, sung long tones 36.9 → 0.0 %, Slakh mixes 13.1 → 0.8 %; `estimator: { partials: false }` turns it off). `processor(opts)` is the gain as an @audio/stft frame process, for a host running its own frames. The stream form reads `alpha` and `beta` from its options object each frame: changed between writes, they change from the next frame (so the `audio.js` processor's are live).

```js
specsub(data, { fs })                                          // α(SNR), β 0.05, noise tracked
specsub(data, { fs, alpha: 2 })                                // fixed over-subtraction
specsub(data, { fs, noiseFrames: 6 })                          // noise from the first 6 frames
```

| Param | Default | |
|---|---|---|
| `alpha` | α(SNR) | Fixed over-subtraction factor; omitted (or 0): Berouti's α(SNR) |
| `beta` | `0.05` | Spectral floor, a fraction of the noise estimate: higher leaves less musical noise and more noise |
| `frameSize` | power of two nearest 32 ms | STFT frame: 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48 (`frame(fs)`) |
| `hopSize` | `frameSize/4` | OLA hop |
| `profile` | tracked | Noise PSD (`Float64Array`, `frameSize/2+1` bins) |
| `estimator` | | Minimum statistics options (@audio/noise-estimate `minStats`); `{ partials: false }`: held notes learned as noise, as before |
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to average for the profile |

**Allocation in a process's first stream**: until V8 has compiled the code a stream runs each frame, that code runs interpreted and allocates as it goes, and a path the stream first takes later stops the compiled code once (the noise tracker's guard of held partials closing its first window, 7.5 s in; later ones the sound decides). The `audio.js` processor, stereo at 44.1 kHz in blocks of 128 frames at its defaults, on noise and on speech in noise, what V8's heap and the typed arrays' stores take each second of sound, under the flags of @audio/compile's validator (compilation on the main thread) and under Node's own ([how](https://github.com/audiojs/denoise#allocation-in-a-first-stream); `node scripts/firststream.js`; Node 18, 20 and 22 on Linux, 20, 22 and 25 on macOS):

| Node | 0–1 s | 1–3 s | 7–8 s | 3–16 s, the most a second | 16–90 s, the most a second | a second instance: 0–1 s, then the most a second |
|---|---|---|---|---|---|---|
| 18 | 11.2–11.9 MB | 2.1 MB | 551 KB | 270 KB | 752 B | 1.2 MB, 54 KB |
| 18, own flags | 22.7–34.7 MB | 2.4 MB | 7.9 MB | 248 KB | 248 B | 1.8–2.1 MB, 55 KB |
| 20 | 11.6–12.7 MB | 1.5 MB | 655 KB | 45 KB | 872 B | 1.2–1.3 MB, 121 KB |
| 20, own flags | 22.4–41.9 MB | 15.9 MB | 7.2 MB | 135 KB | 135 KB | 2.0–10.9 MB, 36 KB |
| 22 | 22.2–24.6 MB | 4.0 MB | 1.2 MB | 67 KB | 2.0 KB | 701 KB to 2.3 MB, 9.3 KB |
| 22, own flags | 34.6–47.0 MB | 13.8 MB | 11.9 MB | 43 KB | 1.3 KB | 3.1–4.3 MB, 8.4 KB |
| 25 | 12.5–14.8 MB | 6.7 MB | 1.1 MB | 104 B | 1.7 KB | 505–508 KB, 120 B |
| 25, own flags | 21.2–29.5 MB | 14.4 MB | 8.9 MB | 104 B | 912 B | 805–991 KB, 120 B |

A processor that copies its input reads up to 1.7 KB a second through the same harness after 16 s. On Node 20 under its own flags the stream went on allocating, to its end, in 9 of 20 runs (`--runs=5`, noise and speech, Linux and macOS; 118 to 135 KB a second through 90 s, 1.27 MB in seconds 20 to 30): V8 11.3, compiling on the compiler's thread, can leave the noise tracker's update (noise-estimate's minimum statistics, or its guard of held partials) entering its on-stack-replacement code from the interpreter every frame, its own compiled code never taking over. With `--no-concurrent-recompilation`, as the validator runs, it did not in 10 runs on Linux (`--own --flags=--no-concurrent-recompilation --runs=5`), at most 1.2 KB in seconds 20 to 30. Node 18, 22 and 25 took at most 5.7 KB in seconds 20 to 30 in every run, the copying processor 1.0 KB. So a first stream allocates for its first 16 s, most of it in its first second, and a second instance in the same process up to 2.3 MB in its first second (10.9 MB under Node 20's own flags), then up to 121 KB.

**Use when:** quick baseline; offline cleanup with a known noise-only preamble.<br>
**Not for:** musical-noise-sensitive material — use `wiener` or `omlsa`.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
