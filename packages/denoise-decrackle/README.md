# @audio/denoise-decrackle [![npm](https://img.shields.io/npm/v/@audio/denoise-decrackle)](https://www.npmjs.com/package/@audio/denoise-decrackle) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-crackle: dense small impulses found as outliers of both the AR prediction error and the two-sided error, all of a window rebuilt at once by least-squares AR interpolation, looked for again until none is new, the sound around them made robust by EM under impulsive noise

```
npm install @audio/denoise-decrackle
```

```js
import decrackle from '@audio/denoise-decrackle'
```

Finds crackle, a worn record's dense small impulses, where the sound departs both from its AR prediction and from its least-squares interpolation from either side, and rebuilds all of it in a 46 ms window at once. The prediction error alone also stands out at the sound's own excitation, a voice's glottal pulses, a reed's or a bow's; the two-sided error (the prediction error through its matched filter, Vaseghi & Rayner 1990) holds those back by √Σa² against its spread and lifts an impulse added to the sound by as much, so crackle is where both stand over `threshold` × their local level: per 1.5 ms block the median |error|, the median of those over ±12 ms, which crackle can't raise until it fills half the samples of half the blocks. All flagged samples of a window are solved together by exact least-squares AR interpolation ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arFill`, Janssen 1986 / Godsill-Rayner 1998), so a neighbouring impulse is never taken for sound. Then it looks again on the rebuilt sound, the models fitted to it, until no new impulse stands out (Vaseghi & Rayner's iteration): with the largest gone, the smaller ones show; a new one must stand out of the input too, so a rebuild's own departures are never taken for crackle. A ringing tick's tail and a small impulse beside a large one stay under the threshold, and a rebuild bends to fit them as if they were sound; so last, every sample from 0.1 ms before a crackle sample to 0.5 ms after it is made soft: the sound there is the posterior mean under the window's AR(64) model with a click of its own variance at each sample, the variances found by EM (impulsive noise as a scale mixture of Gaussians, Godsill & Rayner, IEEE TSAP 1998): where the sound fits the model the samples stay near as recorded, where it doesn't the model takes over. Samples farther than that from any crackle come back bit-exact.

```js
decrackle(data, { fs: 44100 })
```

| Param | Default | |
|---|---|---|
| `threshold` | `4` | how far over each error's local level an impulse stands, multiples |
| `order` | `32` | AR order of the detection |
| `fs` | `44100` | sample rate, Hz |

`node scripts/decrackle.js` adds crackle to speech (audio-lena; 8 VoiceBank+DEMAND test utterances), music ("Vibe Ace", Brahms, the trumpet loop, as `repair`) and a sung vibrato (VocalSet), 6 s of each: impulses at random times, half 1–3 samples off, half ticks ringing at 2–8 kHz for 0.03–0.15 ms, each peaking at a fifth to all of 0.5, 2 or 8× the sound's RMS. It measures the SDR to the clean sound, input → decrackle · FFmpeg `adeclick` at its defaults, the mean over the six:

| crackle, peaks × RMS | 50/s | 200/s | 1000/s |
|---|---:|---:|---:|
| small (0.1–0.5×) | 38.7 → 44.7 · 32.1 | 32.7 → 39.3 · 31.1 | 25.8 → 32.0 · 27.5 |
| medium (0.4–2×) | 26.7 → 39.4 · 30.7 | 20.8 → 32.9 · 28.0 | 13.8 → 23.9 · 20.3 |
| loud (1.6–8×) | 14.8 → 32.5 · 26.1 | 8.6 → 25.1 · 19.7 | 1.7 → 15.8 · 8.7 |

`decrackle` does better than `adeclick` in all 54 cases, by 0.3–18.6 dB; the sung vibrato, where 0.2.0 trailed in 8 (loud crackle at 50/s: 24.2 · 29.1), now leads in all 9 (30.7 · 29.1). 0.2.0 (the rebuild alone, no soft samples): 44.2, 38.3 and 30.2 dB small; 36.4, 29.6, 20.8 medium; 29.2, 21.8, 12.0 loud; the soft samples gain up to 6.5 dB (0.2–6.5 in 51 of the 54 cases, none in one) and lose 3.3 and 1.3 dB on the trumpet with small crackle at 50 and 200/s. The clean sound through it: audio-lena 0.05% of the samples changed, to −73 dB; VoiceBank 2.2%, −41 dB; the music 0.07–1.1%, −49 to −70 dB; the song 0.3%, −60 dB (`adeclick`: 1.9–8.5%, −26 to −47 dB). The soft samples move more of them, each by less: 0.2.0 changed 0.01–0.22%, to −41 to −74 dB ("Vibe Ace" −64, now −49). Tuned on other material (two narrations, VoiceBank+DEMAND training takes, other parts of "Vibe Ace" and Brahms, the Nutcracker, two other VocalSet singers): there 0.2.0 trailed `adeclick` in 23 of 72 cases, now in none. 0.1.7 (2.5 × its window's MAD, 30 Gauss-Seidel sweeps of the fill) made small crackle worse than it found it (38.7 → 21.9 dB at 50/s, the trumpet to 5.6) and changed 3.7–10% of the clean samples (the trumpet to −5.5 dB, speech to −21 dB). 1–1.6× 0.2.0's time, run side by side (the most at 1000/s).

**Use when:** shellac / 78 RPM crackle; a worn LP's surface noise; dense small ticks under music or speech.<br>
**Not for:** loud isolated clicks and pops (use `declick`); long dropouts (use `repair`).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
