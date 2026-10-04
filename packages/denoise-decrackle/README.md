# @audio/denoise-decrackle [![npm](https://img.shields.io/npm/v/@audio/denoise-decrackle)](https://www.npmjs.com/package/@audio/denoise-decrackle) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-crackle: dense small impulses found as outliers of both the AR prediction error and the two-sided error, all of a window rebuilt at once by least-squares AR interpolation, looked for again until none is new

```
npm install @audio/denoise-decrackle
```

```js
import decrackle from '@audio/denoise-decrackle'
```

Finds crackle, a worn record's dense small impulses, where the sound departs both from its AR prediction and from its least-squares interpolation from either side, and rebuilds all of it in a 46 ms window at once. The prediction error alone also stands out at the sound's own excitation, a voice's glottal pulses, a reed's or a bow's; the two-sided error (the prediction error through its matched filter, Vaseghi & Rayner 1990) holds those back by √Σa² against its spread and lifts an impulse added to the sound by as much, so crackle is where both stand over `threshold` × their local level: per 1.5 ms block the median |error|, the median of those over ±12 ms, which crackle can't raise until it fills half the samples of half the blocks. All flagged samples of a window are solved together by exact least-squares AR interpolation ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arFill`, Janssen 1986 / Godsill-Rayner 1998), so a neighbouring impulse is never taken for sound. Then it looks again on the rebuilt sound, the models fitted to it, until no new impulse stands out (Vaseghi & Rayner's iteration): with the largest gone, the smaller ones show; a new one must stand out of the input too, so a rebuild's own departures are never taken for crackle. Samples no crackle reaches come back bit-exact.

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
| small (0.1–0.5×) | 38.7 → 44.2 · 32.1 | 32.7 → 38.3 · 31.1 | 25.8 → 30.2 · 27.5 |
| medium (0.4–2×) | 26.7 → 36.4 · 30.7 | 20.8 → 29.6 · 28.0 | 13.8 → 20.8 · 20.3 |
| loud (1.6–8×) | 14.8 → 29.2 · 26.1 | 8.6 → 21.8 · 19.7 | 1.7 → 12.0 · 8.7 |

Of the 54 cases, `adeclick` does better in 16: 8 of the sung vibrato's (by 0.1–4.9 dB, most with loud crackle at 50/s: 24.2 · 29.1), 8 of speech and Brahms by 0.3–1.4 dB; `decrackle` in the rest, by up to 22 dB (the trumpet, small crackle at 50/s: 48.6 · 26.7). The clean sound through it: audio-lena 0.01% of the samples changed, to −66 dB; VoiceBank 0.22%, −41 dB; the music 0.01–0.12%, −52 to −74 dB; the song 0.02%, −67 dB (`adeclick`: 1.9–8.5%, −26 to −47 dB). 0.1.7 (2.5 × its window's MAD, 30 Gauss-Seidel sweeps of the fill) made small crackle worse than it found it (38.7 → 21.9 dB at 50/s, the trumpet to 5.6) and changed 3.7–10% of the clean samples (the trumpet to −5.5 dB, speech to −21 dB). `threshold: 3` takes 0.6–2.5 dB more of medium and loud crackle (1000/s: 22.1 and 14.5 dB) and trails `adeclick` on the song alone, but changes up to 0.56% of the clean samples, to −40.5 dB, the trumpet above 8 kHz by as much as is in it. 10 s in 0.1–0.5 s clean, 1–4 s crackled (0.1.7: 4–11 s).

**Use when:** shellac / 78 RPM crackle; a worn LP's surface noise; dense small ticks under music or speech.<br>
**Not for:** loud isolated clicks and pops (use `declick`); long dropouts (use `repair`).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
