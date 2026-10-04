# @audio/denoise-declick [![npm](https://img.shields.io/npm/v/@audio/denoise-declick)](https://www.npmjs.com/package/@audio/denoise-declick) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-click: clicks found as outliers of the AR prediction error, each rebuilt by least-squares AR interpolation, everywhere or in given regions

```
npm install @audio/denoise-declick
```

```js
import declick from '@audio/denoise-declick'
```

Finds each click as an outlier of the AR prediction error and rebuilds it from the sound either side. The error is judged against its own median level over ±12 ms, so a click can't raise the bar it must clear; the model is fitted again with the outliers left out, since a loud click otherwise teaches it its own ringing and only its onset stands out. A click spans where the error stays over 3× that level after its onset; one with a like half its size 2.5–15 ms away is a glottal pulse or a plucked string, and is left alone. Each is rebuilt by least-squares AR interpolation over 46 ms either side ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arBridge`, Janssen 1986 / Godsill-Rayner 1998). Samples no click reaches come back bit-exact.

```js
declick(data, { fs: 44100 })                                          // everywhere
declick(data, { fs: 44100, regions: [{ at: 12.31, duration: 0.02 }] }) // the clicks seen there
```

| Param | Default | |
|---|---|---|
| `threshold` | `8` | how far over the error's local level a click stands, multiples |
| `longest` | `6` | longest click rebuilt, ms; longer is taken for real sound |
| `order` | `32` | AR order of the detection |
| `regions` | — | `[{ at, duration }]`, s: look only there, and take nothing there for a pulse or too long |
| `fs` | `44100` | sample rate, Hz |

`node scripts/declick.js` adds clicks to speech (audio-lena) and music (librosa/data, as `repair`), one every 0.25–0.45 s at 2, 5 and 15× the sound's RMS around it, and measures how much of each click's error is gone (median dB, over the click and 1 ms either side) and the share gone by 10 dB or more:

| click | 2× | 5× | 15× |
|---|---:|---:|---:|
| tick (rings at 2–8 kHz, 0.05–0.3 ms) | 13.4 dB · 60% | 17.5 dB · 88% | 25.4 dB · 99% |
| pop (300–1500 Hz, 0.3–1 ms) | 5.7 dB · 30% | 12.9 dB · 60% | 18.2 dB · 86% |
| glitch (1–8 samples off) | 15.5 dB · 71% | 20.5 dB · 90% | 29.4 dB · 99% |
| mouth (1–3 ms of noise) | 9.3 dB · 49% | 17.8 dB · 86% | 25.6 dB · 100% |

0.1.7 (AR(60) on its own window, σ including the click, 2 samples either side): ticks 5–6 dB, pops 0, mouth clicks 4–6 dB. The clean material through it: speech, Brahms and the trumpet untouched (0.1.7 changed 2295, 123 and 2283 samples, the trumpet to −19 dB), "Vibe Ace" 112 samples at −42 dB. Each click's surroundings (3–20 ms either side) given as `regions`: the same within 0.5 dB; regions over the clean material change nothing. Ticks at 2× are as far as the interpolation reaches: rebuilt at their exact span, they come out the same. 10 s in 0.1 s.

**Use when:** vinyl ticks, edit clicks, digital glitches, mouth clicks on a voice; a click seen on a spectrogram, given as a region.<br>
**Not for:** dense crackle (use `decrackle`); long dropouts (use `repair`).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
