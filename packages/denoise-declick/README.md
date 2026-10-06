# @audio/denoise-declick [![npm](https://img.shields.io/npm/v/@audio/denoise-declick)](https://www.npmjs.com/package/@audio/denoise-declick) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-click: clicks found as outliers of the AR prediction error, each taken for a gap or a damped resonance by BIC, the resonance taken off, the gap rebuilt as its posterior mean under AR interpolation, everywhere or in given regions

```
npm install @audio/denoise-declick
```

```js
import declick from '@audio/denoise-declick'
```

Finds each click as an outlier of the AR prediction error, decides what it is, and rebuilds the sound under it. The error is judged against its own median level over ±12 ms, so a click can't raise the bar it must clear; the model is fitted again with the outliers left out, since a loud click otherwise teaches it its own ringing. A click spans where the error stays over 3× that level after its onset; one with a like half its size 2.5–15 ms away is a glottal pulse or a plucked string, and is left alone. Each click is then judged under a finer model, AR(256) of the 46 ms either side, three ways: a gap over all of it; a gap over its onset alone; that gap and a damped resonance struck at the onset, which is what a stylus's tick and a scratch's pop are (Godsill & Rayner 1998, ch. 7). Where the resonance shares a voice's or an instrument's frequencies, its tail barely shows in the prediction error, so a gap found by the error stops short of it; fitted from the onset (frequency, decay, amplitude, phase), the resonance is taken off whole. Of the three, the one of least BIC is kept: the error each leaves after its gap is rebuilt, against the number of values it is free to choose. The gap is rebuilt by least-squares AR(512) interpolation over 46 ms either side ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arBridge`, Janssen 1986), then pulled toward each recorded sample as far as the click there is small: the posterior mean under the click as Gaussian noise whose variance is half of what least squares took off (Godsill & Rayner §5.3). Samples no click reaches come back bit-exact.

```js
declick(data, { fs: 44100 })                                          // everywhere
declick(data, { fs: 44100, regions: [{ at: 12.31, duration: 0.02 }] }) // the clicks seen there
```

| Param | Default | |
|---|---|---|
| `threshold` | `8` | how far over the error's local level a click stands, multiples |
| `longest` | `6` | longest click rebuilt, ms; longer is taken for real sound. A pop's ring is taken off if it dies away within it (decays in a fifth) |
| `order` | `32` | AR order of the detection |
| `regions` | — | `[{ at, duration }]`, s: look only there, and take nothing there for a pulse or too long |
| `fs` | `44100` | sample rate, Hz |

`node scripts/declick.js` adds clicks to speech (audio-lena) and music (librosa/data, as `repair`), one every 0.25–0.45 s at 2, 5 and 15× the sound's RMS around it, and measures how much of each click's error is gone (median dB, over the click and 1 ms either side), the share gone by 10 dB or more, and FFmpeg `adeclick` at its defaults after ·:

| click | 2× | 5× | 15× |
|---|---:|---:|---:|
| tick (rings at 2–8 kHz, 0.05–0.3 ms) | 23.9 dB · 89% · 8.0 | 31.0 dB · 99% · 8.2 | 39.5 dB · 100% · 9.8 |
| pop (300–1500 Hz, 0.3–1 ms) | 18.5 dB · 72% · 0.4 | 27.1 dB · 98% · 0.6 | 34.5 dB · 100% · 0.3 |
| glitch (1–8 samples off) | 29.2 dB · 80% · 21.5 | 37.9 dB · 92% · 24.8 | 48.7 dB · 99% · 29.5 |
| mouth (1–3 ms of noise) | 20.4 dB · 99% · 5.1 | 24.5 dB · 100% · 11.0 | 31.4 dB · 100% · 15.7 |

0.2.0 (a gap as far as the AR(32) error showed the click, least squares): ticks 13.4, 17.5 and 25.4 dB; pops 5.7, 12.9, 18.2; glitches 15.5, 20.5, 29.4; mouth clicks 9.3, 17.8, 25.6. Pops rebuilt at their true span by least squares under AR(512) reach 9.5, 18.0 and 27.8: the resonance taken off beats the best gap by 7–9 dB. 0.1.7 (AR(60) on its own window, σ including the click, 2 samples either side): ticks 5–6 dB, pops 0, mouth clicks 4–6 dB. The clean material through it: speech, Brahms and the trumpet untouched (0.1.7 changed 2295, 123 and 2283 samples, the trumpet to −19 dB), "Vibe Ace" 112 samples at −62 dB (0.2.0: −42 dB); `adeclick` changes 7 116–22 978 samples of each, to −27 to −49 dB. Each click's surroundings (3–20 ms either side) given as `regions`: the same within 0.4 dB; regions over the clean material change nothing. Tuned on other material (two narrations, VoiceBank+DEMAND training takes, other parts of "Vibe Ace" and Brahms, the Nutcracker, two other VocalSet singers). Clicked sound takes 1–2× 0.2.0's time (10 s with three clicks a second in 0.3–0.7 s), clean sound as long.

**Use when:** vinyl ticks, edit clicks, digital glitches, mouth clicks on a voice; a click seen on a spectrogram, given as a region.<br>
**Not for:** dense crackle (use `decrackle`); long dropouts (use `repair`).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
