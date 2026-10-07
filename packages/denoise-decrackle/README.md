# @audio/denoise-decrackle [![npm](https://img.shields.io/npm/v/@audio/denoise-decrackle)](https://www.npmjs.com/package/@audio/denoise-decrackle) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-crackle: dense small impulses found as outliers of both the AR prediction error and the two-sided error, all of a window rebuilt at once by least-squares AR interpolation, looked for again until none is new, each event kept only where an impulse added to the sound explains it better than the sound's own excitation, the sound around them made robust by EM under impulsive noise

```
npm install @audio/denoise-decrackle
```

```js
import decrackle from '@audio/denoise-decrackle'
```

Finds crackle, a worn record's dense small impulses, where the sound departs both from its AR prediction and from its least-squares interpolation from either side, and rebuilds all of it in a 46 ms window at once. The prediction error alone also stands out at the sound's own excitation, a voice's glottal pulses, a reed's or a bow's; the two-sided error (the prediction error through its matched filter, Vaseghi & Rayner 1990) holds those back by √Σa² against its spread and lifts an impulse added to the sound by as much, so crackle is where both stand over `threshold` × their local level: per 1.5 ms block the median |error|, the median of those over ±12 ms, which crackle can't raise until it fills half the samples of half the blocks. All flagged samples of a window are solved together by exact least-squares AR interpolation ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arFill`, Janssen 1986 / Godsill-Rayner 1998), so a neighbouring impulse is never taken for sound. Then it looks again on the rebuilt sound, the models fitted to it, until no new impulse stands out (Vaseghi & Rayner's iteration): with the largest gone, the smaller ones show; a new one must stand out of the input too, so a rebuild's own departures are never taken for crackle. Each event is then judged as `declick` judges a click: an impulse added to the recording against the sound's own excitation (an additive outlier against an innovational one, Chang, Tiao & Chen 1988), under AR fitted to the rebuilt sound, each explanation by its fewest freed samples at ln T of the excitation's variance each (Schwarz 1978). A voice's glottal pulse, a bow's or a reed's catch, a drum's attack is one outlier of the excitation, the recording after it its smooth response; an impulse added stands in `order` + 1 errors, and its own sample frees them all. What the excitation explains as well is left as recorded (and crackle within 0.7 ms of such a pulse with it). A ringing tick's tail and a small impulse beside a large one stay under the threshold, and a rebuild bends to fit them as if they were sound; so last, every sample from 0.1 ms before a crackle sample to 0.5 ms after it is made soft: the sound there is the posterior mean under the window's AR(64) model with a click of its own variance at each sample, the variances found by EM (impulsive noise as a scale mixture of Gaussians, Godsill & Rayner, IEEE TSAP 1998): where the sound fits the model the samples stay near as recorded, where it doesn't the model takes over. Samples farther than that from any crackle come back bit-exact.

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
| small (0.1–0.5×) | 38.7 → 45.5 · 32.1 | 32.7 → 39.4 · 31.1 | 25.8 → 31.8 · 27.5 |
| medium (0.4–2×) | 26.7 → 39.5 · 30.7 | 20.8 → 32.7 · 28.0 | 13.8 → 23.8 · 20.3 |
| loud (1.6–8×) | 14.8 → 32.7 · 26.1 | 8.6 → 25.1 · 19.7 | 1.7 → 15.7 · 8.7 |

`decrackle` does better than `adeclick` in 53 of the 54 cases, by up to 23.5 dB, and ties in one (the sung vibrato under small crackle at 1000/s, 30.9 each; 0.3.1 led in all 54); the sung vibrato, where 0.2.0 trailed in 8 (loud crackle at 50/s: 24.2 · 29.1), leads in the other 8 (30.7 · 29.1). 0.3.1, before each event was judged: 44.7, 39.3 and 32.0 dB small; 39.4, 32.9, 23.9 medium; 32.5, 25.1, 15.8 loud. 0.2.0 (the rebuild alone, no soft samples): 44.2, 38.3 and 30.2 dB small; 36.4, 29.6, 20.8 medium; 29.2, 21.8, 12.0 loud; the soft samples gain up to 6.5 dB (0.2–6.5 in 51 of the 54 cases, none in one) and lose 3.3 and 1.3 dB on the trumpet with small crackle at 50 and 200/s. The clean sound through it: audio-lena and Brahms not a sample changed; VoiceBank 1.4% of the samples, to −41 dB; "Vibe Ace" and the trumpet 0.07% and 0.05%, −52 and −69 dB; the song 0.17%, −64 dB (`adeclick`: 1.9–8.5%, −26 to −47 dB). 0.3.1 took the sound's own excitation for crackle too, a voice's glottal pulses, a bow's catch, and softened 0.6 ms around each: audio-lena 0.05%, −73 dB; VoiceBank 2.2%, −41; the music 0.07–1.1%, −49 to −70; the song 0.3%, −60. 0.2.0 changed 0.01–0.22%, to −41 to −74 dB. Tuned on other material (two narrations, VoiceBank+DEMAND training takes, other parts of "Vibe Ace" and Brahms, the Nutcracker, two other VocalSet singers): there 0.2.0 trailed `adeclick` in 23 of 72 cases, now in none. 0.1.7 (2.5 × its window's MAD, 30 Gauss-Seidel sweeps of the fill) made small crackle worse than it found it (38.7 → 21.9 dB at 50/s, the trumpet to 5.6) and changed 3.7–10% of the clean samples (the trumpet to −5.5 dB, speech to −21 dB). 1–1.6× 0.2.0's time, run side by side (the most at 1000/s).

Against iZotope RX 12 Advanced De-crackle (VST3 hosted by Pedalboard; [`audio`](https://github.com/audiojs/audio)'s `bench/rx/decrackle.mjs`, October 2026), through `audio`'s `decrackle()` on other takes (12 s of VoiceBank+DEMAND's clean test utterances, two Spoken Wikipedia narrations, "Vibe Ace" and Brahms 5–15 s, the trumpet), the same crackle: RX at its defaults (quality Low, strength 5) and at its best for each size on separate takes (quality × strength, then amplitude skew): small Medium, 3; medium High, 9.5; loud Medium, 9.5, skew 5. SDR out, dB, speech at 50 / 200 / 1000 a second · music:

| crackle | in | RX, defaults | RX, best for the size | `decrackle` |
|---|---|---|---|---|
| small | 38.7 / 32.9 / 26.0 · 38.9 / 32.8 / 25.7 | 30.7 / 29.5 / 25.6 · 40.5 / 35.0 / 27.1 | 38.1 / 33.2 / 26.2 · 40.7 / 34.1 / 26.2 | 43.4 / 38.7 / 31.5 · 46.5 / 40.0 / 31.9 |
| medium | 27.1 / 20.9 / 14.0 · 26.7 / 20.8 / 13.7 | 28.1 / 24.0 / 16.2 · 31.2 / 25.1 / 15.9 | 22.6 / 21.0 / 17.7 · 31.3 / 26.1 / 18.9 | 38.5 / 32.8 / 23.8 · 39.5 / 33.4 / 24.0 |
| loud | 14.8 / 8.9 / 1.9 · 14.8 / 8.6 / 1.7 | 22.1 / 15.9 / 5.4 · 22.4 / 15.0 / 4.8 | 19.4 / 15.5 / 10.1 · 22.7 / 17.2 / 11.4 | 31.6 / 25.3 / 16.7 · 32.7 / 25.5 / 16.2 |

`decrackle` is 4.8–15.9 dB over RX at its best for each size, in every rate and size (0.3.1, before each event was judged: 4.2–15.8; cell by cell 0.5 dB over these to 1.2 under). RX at its defaults makes small crackle on speech worse (38.7 → 30.7 dB at 50 a second). The clean takes through each (samples moved over 2⁻¹⁵ · error under the sound): `decrackle` 0–1.4% · −44 dB to none (Brahms comes back bit-exact); RX at its defaults 3.7–48% · −25 to −52; at its best for medium and loud crackle 4–75% · −15 to −59; at its best for small crackle, its gentlest, 0.3–10.3% · −36 to −67: more samples than `decrackle` on all six takes (6 to 110 times as many where `decrackle` moves any), more error on four (the narrations −51 and −36 against −70 and −47, Brahms −61 against none, the trumpet −67 against −69), less on two (VoiceBank −46 against −44, "Vibe Ace" −58 against −55). 0.3.1 moved 0.07–2.3% · −37 to −66 dB, less error than RX's gentlest on two takes: it took the sound's own excitation for crackle and softened 0.6 ms around each. What is left on VoiceBank is mostly its speakers' own mouth clicks (a 9-sample step at 9.58 s, a burst near 20 kHz at 0.90 s), which nothing in a recording tells from crackle; on "Vibe Ace", a percussive attack. The judging was chosen on the tuning takes (other utterances, narrations and passages, the Nutcracker): there the 54 crackle cases average 31.9 dB as with 0.3.1, and the clean takes' error falls from −38 to −69 dB to −39 dB to none (two untouched).

**Use when:** shellac / 78 RPM crackle; a worn LP's surface noise; dense small ticks under music or speech.<br>
**Not for:** loud isolated clicks and pops (use `declick`); long dropouts (use `repair`).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
