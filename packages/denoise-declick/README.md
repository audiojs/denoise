# @audio/denoise-declick [![npm](https://img.shields.io/npm/v/@audio/denoise-declick)](https://www.npmjs.com/package/@audio/denoise-declick) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-click: clicks found as outliers of the AR prediction error, each one's reach and ring chosen by marginal likelihood, a struck resonance taken off, the gap rebuilt as the sound's posterior mean under the click's own level and spectrum, everywhere or in given regions

```
npm install @audio/denoise-declick
```

```js
import declick from '@audio/denoise-declick'
```

Finds each click as an outlier of the AR prediction error, finds how far it reaches and whether it rings on, and rebuilds the sound under it. The error is judged against its own median level over ±12 ms, so a click can't raise the bar it must clear; the model is fitted again with the outliers left out, since a loud click otherwise teaches it its own ringing. A click spans where the error stays over 3× that level after its onset; one with a like half its size 2.5–15 ms away is a glottal pulse or a plucked string, and is left alone. Each click is then judged under a finer model, AR(256) of the 46 ms either side: as a gap from its start over every length up to its end, or up to the end of another click within 6 ms (a dropout's two edges), every length's error from one Levinson-Durbin pass since the gaps nest; and as a damped resonance struck at its onset, which is what a stylus's tick and a scratch's pop are (Godsill & Rayner 1998, ch. 7), with a gap over the onset or over its first sample alone. Kept: the one that explains the sound at least cost, each gap sample at its marginal likelihood's cost under a Gaussian click of the onset's size (ch. 9), so a loud click's gap is dear and a resonance that explains its ring wins; no resonance that would take off more than the recording holds; and nothing at all where the sound's own excitation explains it better, an innovation outlier rather than an added one (Chang, Tiao & Chen 1988): a plosive's burst, a note's attack. The gap is rebuilt by least-squares AR(512) interpolation over 46 ms either side ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arBridge`, Janssen 1986), then as the sound's posterior mean under the click as Gaussian noise of its own envelope and spectrum (AR(4) of what least squares took off, refined by EM, Godsill & Rayner §5.3 with the click coloured): under a mouth click the voice is kept where the click is weak, in time and in frequency. Samples no click reaches come back bit-exact.

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

`node scripts/declick.js` adds clicks to speech (audio-lena) and music ("Vibe Ace", Brahms, the trumpet, as `repair`), one every 0.25–0.45 s at 2, 5 and 15× the sound's RMS around it, and measures how much of each click's error is gone (median dB, from 1 ms before the click to 20 ms after it, so a repair's own ringing counts), the share gone by 10 dB or more, and FFmpeg `adeclick` at its defaults after ·:

| click | 2× | 5× | 15× |
|---|---:|---:|---:|
| tick (rings at 2–8 kHz, 0.05–0.3 ms) | 26.9 dB · 93% · 8.0 | 33.8 dB · 100% · 8.0 | 41.0 dB · 100% · 9.8 |
| pop (300–1500 Hz, 0.3–1 ms) | 19.2 dB · 71% · 0.4 | 28.6 dB · 99% · 0.6 | 34.5 dB · 100% · 0.3 |
| glitch (1–8 samples off) | 41.6 dB · 100% · 19.8 | 45.5 dB · 100% · 24.8 | 56.7 dB · 100% · 29.2 |
| spike (a jump decaying over 1–3 samples, cut off after 4–8) | 28.3 dB · 96% · 22.3 | 37.9 dB · 100% · 24.4 | 50.6 dB · 99% · 33.1 |
| mouth (1–3 ms of noise) | 23.2 dB · 99% · 4.4 | 27.8 dB · 100% · 11.0 | 32.8 dB · 100% · 15.7 |
| dropout (0.02–1 ms gone to zero) | 13.8 dB · 56% · 0.2 | | |

0.3.0 (a gap over the onset ±0.1 ms or over all of the error's span, nothing between; the click under it white), measured the same way: ticks 23.9, 31.0 and 39.5 dB; pops 18.5, 27.1, 34.5; glitches 29.2, 37.9, 48.7; spikes 21.3, 24.2, 41.3; mouth clicks 20.4, 24.5, 31.4; dropouts 7.1. 0.2.0 (a gap as far as the AR(32) error showed the click, least squares; over the click and 1 ms either side): ticks 13.4, 17.5 and 25.4 dB; pops 5.7, 12.9, 18.2; glitches 15.5, 20.5, 29.4; mouth clicks 9.3, 17.8, 25.6. The clean material through it: untouched (0.3.0 changed 112 samples of "Vibe Ace", to −62 dB; 0.1.7 2295, 123 and 2283 of the speech, Brahms and the trumpet); `adeclick` changes 7 116–22 978 samples of each, to −27 to −49 dB. Each click's surroundings (3–20 ms either side) given as `regions`: the same within 1.3 dB; regions over the clean material change nothing. Tuned on other material (VoiceBank+DEMAND training takes, two other narrations, other parts of "Vibe Ace" and Brahms, the Nutcracker). Clicked sound takes 1.25× 0.3.0's time (10 s with three clicks a second in about 0.3–0.7 s), clean sound as long.

Against iZotope RX 12 Advanced, De-click and Mouth De-click (VST3 hosted by Pedalboard; [`audio`](https://github.com/audiojs/audio)'s `bench/rx/declick.mjs`, October 2026), through `audio`'s `declick()`, on other takes: 12 s of VoiceBank+DEMAND's clean test utterances, two Spoken Wikipedia narrations, "Vibe Ace" and Brahms (5–15 s) and the trumpet. RX at its defaults, and at its best per kind on separate takes (VoiceBank+DEMAND training utterances, two other narrations, other passages, the Nutcracker) from algorithm × sensitivity × click widening, Mouth De-click from sensitivity × frequency skew (its best: its defaults). Median dB gone as above, speech at 2 / 5 / 15× · music:

| click | RX, defaults | RX, best on other takes | `declick` 0.3.0 | `declick` |
|---|---|---|---|---|
| tick | 7.2 / 14.6 / 20.2 · 10.3 / 13.3 / 19.2 | 11.7 / 14.8 / 18.6 · 13.9 / 16.2 / 19.1 (Multi-band random, 3) | 20.5 / 28.8 / 34.7 · 26.0 / 30.0 / 40.3 | 23.1 / 31.4 / 37.6 · 28.1 / 32.7 / 41.2 |
| pop | 0.0 / 1.0 / 3.8 · 0.0 / 2.4 / 5.5 | 5.0 / 8.9 / 15.5 · 6.8 / 12.9 / 19.0 (Multi-band random, 7) | 12.9 / 25.5 / 35.5 · 16.8 / 24.6 / 34.3 | 13.8 / 26.6 / 37.4 · 18.4 / 26.4 / 35.5 |
| glitch | 10.9 / 15.7 / 30.0 · 10.9 / 20.2 / 27.2 | 11.1 / 17.1 / 30.1 · 9.9 / 20.4 / 28.3 (Single-band, 1.5) | 21.8 / 33.3 / 44.4 · 30.3 / 40.1 / 49.1 | 30.8 / 40.5 / 51.9 · 37.8 / 45.8 / 56.6 |
| spike | 10.0 / 13.3 / 25.7 · 7.7 / 17.2 / 27.1 | 11.3 / 15.1 / 26.1 · 9.7 / 17.8 / 27.1 (Single-band, 1.5) | 17.0 / 21.2 / 28.4 · 21.6 / 31.9 / 38.9 | 22.8 / 30.1 / 42.7 · 27.0 / 39.0 / 46.5 |
| dropout | 0.0 · 0.0 | 1.3 · 4.2 (Multi-band random, 7) | 3.0 · 7.9 | 6.3 · 15.4 |
| mouth, speech at 1 / 2 / 5× | Mouth De-click 9.6 / 16.0 / 20.5 | the same | 13.5 / 16.4 / 21.8 | 13.4 / 18.1 / 23.6 |

The share of mouth clicks gone by 10 dB or more: 65, 83 and 92%, Mouth De-click's 45, 78 and 83%. Do no harm: on the clicked takes, the error left outside the clicks' spans is 35–43 dB under the sound, RX's 22–29 dB at its defaults and 21–37 at its best. The clean takes through each (samples moved over 2⁻¹⁵ · error under the sound): `declick` VoiceBank 0.5% · −38 dB, the narrations 0.03% · −43 and 0.3% · −43, the music untouched (0.3.0: 0.7% · −36, 0.2% · −36, 1.1% · −27, "Vibe Ace" −62); RX De-click at its defaults 1.1% · −28, 0.1% · −40, 0.3% · −29, the music 0.009–1.9%, the trumpet to −13; Mouth De-click 5.1% · −34, 0.4% · −44, 5.1% · −26; Single-band at sensitivity 1.5, RX's least, 0.3% · −38, 0.03% · −45, 0.06% · −42, the trumpet to −28. On four real narrations (30 s each, with their own mouth clicks), `declick` changes 27.5 places a minute (0.3.0: 49.5), Mouth De-click 75 and De-click 81; RX De-click changes 65% of `declick`'s places too. Each click selected, 3–20 ms either side (`declick({ at, duration })` a click): ticks 22.5 / 30.1 / 37.4 · 28.1 / 32.7 / 41.2 dB, glitches 30.0 / 36.8 / 50.2 · 37.0 / 45.8 / 55.9, mouth clicks 13.3 / 17.7 / 23.6, within 3.7 dB of the whole take and over RX's on the whole take in every condition.


**Use when:** vinyl ticks, edit clicks, digital glitches, mouth clicks on a voice; a click seen on a spectrogram, given as a region.<br>
**Not for:** dense crackle (use `decrackle`); long dropouts (use `repair`).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
