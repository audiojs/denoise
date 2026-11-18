# @audio/denoise-wiener [![npm](https://img.shields.io/npm/v/@audio/denoise-wiener)](https://www.npmjs.com/package/@audio/denoise-wiener) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Wiener filter / MMSE-LSA denoise with decision-directed a-priori SNR

```
npm install @audio/denoise-wiener
```

```js
import wiener from '@audio/denoise-wiener'
```

MMSE log-spectral amplitude (Ephraim & Malah 1985) or Wiener (Scalart & Filho 1996) gain on the decision-directed a priori SNR ξ = α·Â²(l−1)/λ(l−1) + (1−α)·max(γ−1, 0) (Ephraim & Malah 1984, eq. 51). α = 0.98 is theirs for an 8 ms frame step (§VI: 256 samples at 8 kHz, a new frame every 64) and is rescaled to the actual step as α<sup>Δt/8 ms</sup>, so the a priori SNR's memory holds in seconds; applied per frame until 0.3, it ran 1.8× longer at 48 kHz (10.7 ms steps) than at 44.1 kHz (5.8 ms). The floor ξ<sub>min</sub> stays −15 dB: −25 dB, Cohen's and Loizou's, left more musical noise on steady white and pink noise (log kurtosis ratio 0.98 and 1.49, against 0.53 and 1.01) and cost PESQ and SIG on the training speech (`scripts/speech.mjs`). The noise PSD λ is tracked by minimum statistics (Martin 2001) over a 1.5 s window, in batch and stream alike, unless a profile or a noise-only stretch is given; a held note, a sustained vowel or a chord is kept out of it (@audio/noise-estimate's `partials`, as [`omlsa`](https://github.com/audiojs/denoise#omlsa) has it: clean music cut by more than 3 dB 14.5 → 3.4 %, sung long tones 36.3 → 0.0 %, Slakh mixes 26.6 → 3.3 %; `estimator: { partials: false }` turns it off). `processor(opts)` is the gain as an @audio/stft frame process, for a host running its own frames. The stream form reads `rule`, `alphaDD` (`alpha`) and `xiMin` from its options object each frame: changed between writes, they change from the next frame (so the `audio.js` processor's are live).

```js
wiener(data, { fs })                                           // LSA gain, noise tracked
wiener(data, { fs, rule: 'wiener' })                           // Wiener gain
wiener(data, { fs, noiseFrames: 6 })                           // noise from the first 6 frames
```

| Param | Default | |
|---|---|---|
| `rule` | `'mmse-lsa'` | `'wiener'` or `'mmse-lsa'` (log-spectral, less musical noise) |
| `alpha` | `0.98` | Decision-directed smoothing per 8 ms of frame step, rescaled to the actual step (alias of `alphaDD`) |
| `xiMin` | `10^−1.5` | A priori SNR floor (−15 dB) |
| `frameSize` | power of two nearest 32 ms | STFT frame: 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48 (`frame(fs)`) |
| `hopSize` | `frameSize/4` | OLA hop |
| `profile` | tracked | Noise PSD (`Float64Array`, `frameSize/2+1` bins) |
| `estimator` | | Minimum statistics options (@audio/noise-estimate `minStats`); `{ partials: false }`: held notes learned as noise, as before |
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to average for the profile |

**Allocation in a process's first stream**: until V8 has compiled the code a stream runs each frame, that code runs interpreted and allocates as it goes, and a path the stream first takes later stops the compiled code once (the noise tracker's guard of held partials closing its first window, 7.5 s in; later ones the sound decides). The `audio.js` processor, stereo at 44.1 kHz in blocks of 128 frames at its defaults, on noise and on speech in noise, what V8's heap and the typed arrays' stores take each second of sound, under the flags of @audio/compile's validator (compilation on the main thread) and under Node's own ([how](https://github.com/audiojs/denoise#allocation-in-a-first-stream); `node scripts/firststream.js`; Node 18, 20 and 22 on Linux, 20, 22 and 25 on macOS):

| Node | 0–1 s | 1–3 s | 7–8 s | 3–16 s, the most a second | 16–90 s, the most a second | a second instance: 0–1 s, then the most a second |
|---|---|---|---|---|---|---|
| 18 | 12.5–13.8 MB | 2.4 MB | 416 KB | 116 KB | 440 B | 1.2–1.3 MB, 76 KB |
| 18, own flags | 24.1–39.4 MB | 2.3 MB | 5.7 MB | 14 KB | 248 B | 2.0–2.8 MB, 76 KB |
| 20 | 13.6–14.8 MB | 1.8 MB | 586 KB | 68 KB | 608 B | 1.2 MB, 51 KB |
| 20, own flags | 25.8–49.7 MB | 15.9 MB | 7.6 MB | 171 KB | 171 KB | 2.0–13.4 MB, 116 KB |
| 22 | 26.6–29.1 MB | 4.0 MB | 1.2 MB | 70 KB | 1008 B | 545 KB to 2.3 MB, 171 KB |
| 22, own flags | 39.0–54.1 MB | 12.8 MB | 8.2 MB | 84 KB | 1.6 KB | 3.1–6.8 MB, 19 KB |
| 25 | 17.2–19.5 MB | 6.7 MB | 1.1 MB | 104 B | 2.6 KB | 506–509 KB, 336 B |
| 25, own flags | 25.4–33.2 MB | 16.0 MB | 7.2 MB | 104 B | 2.7 KB | 1.6–1.9 MB, 104 B |

A processor that copies its input reads up to 1.7 KB a second through the same harness after 16 s. On Node 20 under its own flags the stream went on allocating, to its end, in 12 of 20 runs (`--runs=5`, noise and speech, Linux and macOS; 118 to 171 KB a second through 90 s, 1.27 to 2.93 MB in seconds 20 to 30): V8 11.3, compiling on the compiler's thread, can leave the noise tracker's update (noise-estimate's minimum statistics, or its guard of held partials) entering its on-stack-replacement code from the interpreter every frame, its own compiled code never taking over. With `--no-concurrent-recompilation`, as the validator runs, it did not in 10 runs on Linux (`--own --flags=--no-concurrent-recompilation --runs=5`), at most 1.5 KB in seconds 20 to 30. Node 18, 22 and 25 took at most 5.7 KB in seconds 20 to 30 in every run, the copying processor 1.0 KB. So a first stream allocates for its first 16 s, most of it in its first second, and a second instance in the same process up to 2.3 MB in its first second (13.4 MB under Node 20's own flags), then up to 171 KB.

**Use when:** transparent broadband denoise; the "safe default" for stationary noise.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
