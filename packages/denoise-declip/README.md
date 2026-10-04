# @audio/denoise-declip [![npm](https://img.shields.io/npm/v/@audio/denoise-declip)](https://www.npmjs.com/package/@audio/denoise-declip) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-clip: each side's rail found where the sound was cut flat, every clipped sample rebuilt by consistent least-squares AR interpolation; unclipped sound untouched

```
npm install @audio/denoise-declip
```

```js
import declip from '@audio/denoise-declip'
```

Finds where a sound was cut flat and rebuilds what the cut took off. A hard clip piles every sample it cuts onto one level, its rail. Each side's rail is the sound's extreme there, taken when the samples within 0.1 % of it outnumber those in the next 0.1 % below tenfold and most of them sit in runs: the top-bin test of FFmpeg's `adeclip` (1000 bins, ratio 10), made relative to the rail so it holds at any level (and never finer than one step of a 16- or 24-bit grid), and per side, so one rail or two different ones are found. A loud peak is one sample; a limiter's ceiling is touched by single samples or by arches, and a sine's top is an arch, which fill the band below about as densely: sound with no rail comes back bit-exact. Then, per window of 186 ms (hop half, crossfaded), every sample at a rail is unknown at once: AR(256) fitted to the window under its taper, all of them solved by exact least squares ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arFill`), each held at least as far out as it was recorded (a clip only ever lowers a sample: the consistent set of A-SPADE, Kitić, Bertin & Gribonval 2015), the model refitted to the filled window and the solve repeated, 8 times (Janssen, Veldhuis & Vries 1986). Runs of any length; samples off the rails come back bit-exact.

```js
declip(data, { fs: 44100 })                                    // each side's rail found; none: untouched
declip(data, { fs: 44100, clipLevel: 0.95 })                   // a known rail, ±0.95
```

| Param | Default | |
|---|---|---|
| `clipLevel` | auto | the rail, ± this; omitted or 0: found per side |
| `order` | `256` | AR order of the rebuild; `512` takes dense music up to 2 dB closer and speech further, in about 3× the time |
| `fs` | `44100` | sample rate, Hz |

`node scripts/declip.js` clips speech (audio-lena) and music ("Vibe Ace", Brahms, the trumpet loop, as `repair`), 6 s of each, peak-normalized and cut at the level that leaves the clipped sound 3–20 dB from the original (the input SDR of the declipping survey, Záviška, Rajmic, Ozerov & Rencker 2021), and measures the SDR after, dB, declip (finding the rails itself) · FFmpeg `adeclip` at its defaults:

| input SDR | 3 dB | 7 dB | 10 dB | 15 dB | 20 dB |
|---|---:|---:|---:|---:|---:|
| speech | 11.6 · 5.0 | 24.2 · 12.1 | 31.2 · 16.9 | 37.7 · 24.0 | 42.4 · 30.5 |
| "Vibe Ace" | 9.3 · 5.0 | 15.6 · 10.3 | 19.7 · 14.0 | 26.5 · 19.9 | 32.9 · 24.6 |
| Brahms | 8.5 · 3.9 | 16.1 · 10.2 | 20.0 · 14.4 | 26.4 · 19.8 | 34.0 · 23.8 |
| trumpet | 15.1 · 4.1 | 31.4 · 10.4 | 45.6 · 14.8 | 46.1 · 21.4 | 59.0 · 25.0 |

A-SPADE as the survey's code runs it (`--spade`: 186 ms blocks, a twice-redundant DFT, s = r = 1, ε = 0.1): speech 9.7 / 22.4 / 27.6 / 33.7 / 37.7, "Vibe Ace" 13.2 / 19.0 / 24.4 / 29.0 / 33.0, Brahms 12.9 / 18.0 / 21.0 / 26.3 / 31.8, the trumpet 17.7 / 31.4 / 37.2 / 49.8 / 57.0: ahead of declip in 9 of the 15 music cases, by 1.0–4.7 dB (each at 3 dB, "Vibe Ace" up to 15 dB), within 0.1 dB in 3, behind in 3 (the trumpet at 10 dB by 8.4); behind it on speech at every level, by 1.8–4.7 dB; in 27–65 s per second of sound. VoiceBank+DEMAND's test set, every 20th utterance clipped to 10 and 20 dB: declip 19.8 and 32.4 dB, `adeclip` 16.0 and 28.2.

Rails are found at the 20 dB level clipped asymmetrically (with the 10 dB level below), on one side only, then turned down to 0.4, quantized to 16 bits plain or dithered, and on a 16-bit converter driven 2.5 dB over (rails at 32767 and −32768): 10 dB or more of SDR gained in each. The unclipped material through it, as it is, peak-normalized, at 16 bits and through a lookahead limiter 12 dB over its ceiling: not a sample changed; nor in any of VoiceBank+DEMAND's 824 clean test utterances. 0.1.7 took the most populated level over half scale for the rail: on unclipped sound peaking over it, a limiter at half scale (151–43,538 samples changed per 6 s; the overdriven converter's Brahms 41.1 → 21.3 dB), while clipping at other levels it mostly left as it was (3–20 dB in, the same out). It takes about 0.1 s per second of sound clipped at the 20 dB level, 0.5 s at 10 dB, 5 s at 3 dB (`adeclip`: 0.07, 1.3 and 23 s on the same machine).

**Use when:** digital clipping: a converter overdriven, a mix bounced too hot, a plug-in's hard clip; at any level, on either side or both.<br>
**Not for:** clipping that has since been through lossy coding or resampling (the plateau is no longer flat, and no rail is found); soft saturation, tape or tube, which has no rail.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
