# @audio/denoise-dewow [![npm](https://img.shields.io/npm/v/@audio/denoise-dewow)](https://www.npmjs.com/package/@audio/denoise-dewow) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Wow & flutter correction — pitch-drift removal for tape/vinyl/cassette transfers

```
npm install @audio/denoise-dewow
```

```js
import dewow, { analyze } from '@audio/denoise-dewow'
```

Corrects wow and flutter: measures the speed of the tape or disc over time and reads the sound back at the inverse speed (variable-rate windowed sinc). A speed change moves every frequency by one ratio at one instant; a performer's vibrato, glide or melody moves one note and its harmonics. The estimator measures only the first:

- `'partial'` (default) — tracks the partials (STFT peaks, McAulay & Quatieri 1986 linking, phase-vocoder frequency over the 93 ms frame), groups each note's harmonics into one source, and takes as speed only what at least two independent sources agree on, hop to hop: Godsill & Rayner, *Digital Audio Restoration*, 1998, ch. 8 (log-frequency tracks `f = f0 + p + v`, a zero-mean smoothness prior on `p`), with sources in place of tracks, robust (Tukey biweight) weights, and the speed solved on hop-to-hop increments so no track's centre needs estimating. A Wiener gate keeps of the curve only what stands above its own measured uncertainty. Where nothing is evidence nothing is corrected; a clip with none comes back bit-exact.
- `'reference'` — locks onto one known steady tone (mains hum, a pilot or calibration tone): evidence on its own. The method to reach for when such a tone is there. Czyżewski et al., *Wow detection and compensation employing spectral processing of audio*, AES 117th Convention, 2004.
- `'pitch'` — one voice's f0 (`@audio/pitch-pyin`) against its own smoothed trend: takes the performer's own pitch movement for speed; opt-in.

See also Howarth & Wolfe, *Correction of Wow and Flutter Effects in Analogue Tape Transfers*, AES 117th/118th Convention, 2004/2005; Nichols, *The Digital Restoration of Wow and Flutter Distorted Gramophone Recordings*, 1999.

```js
let corrected = dewow(recording, { fs: 44100 })                          // from the music's own partials
let corrected = dewow(recording, { fs, mode: 'reference', refFreq: 50 }) // from 50 Hz mains hum
let corrected = dewow(recording, { fs, mode: 'pitch', smooth: 3 })       // one voice, its vibrato taken too

let meter = analyze(recording, { fs })
// → { speed, times, hop, wow, flutter, wowPeak, flutterPeak, confidence, tracks? }
```

`recording` is a mono `Float32Array` or an array of channels (`[L, R, …]`); analysis runs on the mono mix, and one shared curve corrects every channel, so a stereo pair stays sample-aligned. Returns new arrays — never in place.

| Param | Default | |
|---|---|---|
| `fs` | `44100` | Sample rate |
| `mode` | `'partial'` | `'partial'` \| `'reference'` \| `'pitch'` |
| `refFreq` | — | Known tone/hum frequency (Hz) — required for `mode: 'reference'` |
| `frameSize` | `4096` | STFT frame; `'partial'` reads each partial's frequency over it (wow, not flutter) |
| `hopSize` | `512` | STFT hop — the curve's own sample rate |
| `smooth` | `0.05` | Zero-phase smoothing time constant (s) separating wow (slower) from flutter |
| `wow` | `true` | Correct the slower component |
| `flutter` | `true` | Correct the faster component |
| `maxDeviation` | `0.05` | Clamp the corrected speed ratio to `[1−x, 1+x]` |
| `minTrack` | `0.1` | Shortest partial used, in seconds — `'partial'` mode |
| `minFreq` / `maxFreq` | `50` / `2000` | Where partials (`'partial'`) or the f0 (`'pitch'`) are looked for, Hz |
| `keepLength` | `true` | Output length equals input length |

`analyze()` is the estimator alone — the "wow & flutter meter". `wow`/`flutter` are the **unweighted RMS** deviation in %, `wowPeak`/`flutterPeak` the **unweighted peak**; *not* the IEC 60386 / DIN 45507 figure, which weights the deviation (peaking near 4 Hz) first. `confidence` is the fraction of hops with evidence (two independent sources agreeing, the reference tone present, or voiced pitch); `tracks` (`'partial'` only) lists the partials used. `times` are each hop's frame centre.

`node scripts/dewow.js` (in the [@audio/denoise](https://github.com/audiojs/denoise) repo) reads clean speech (audio-lena, two Spoken Wikipedia narrations), music ("Vibe Ace", "Dance of the Sugar Plum Fairy", Brahms' Hungarian Dance No. 5, a trumpet loop, three GuitarSet takes) and singing (five VocalSet excerpts) at a varying speed — an off-centre disc (0.55 Hz sine) or tape (0.3–3 Hz random) at 0.3, 1 and 2 % peak — and measures the pitch error left after dewow on the audio itself (local lag against the clean sound, differentiated; cents RMS, mean over clips; doing nothing leaves the wow):

| | wow | 0.3 % | 1 % | 2 % |
|---|---|---:|---:|---:|
| speech | disc | 3.7 → 3.7 | 12.4 → 12.4 | 25.5 → 25.5 |
| | tape | 1.3 → 1.3 | 4.4 → 4.4 | 9.1 → 9.1 |
| music | disc | 3.7 → 3.6 | 12.3 → 10.8 | 24.5 → 18.2 |
| | tape | 1.3 → 1.4 | 4.2 → 4.2 | 8.5 → 8.2 |
| singing | disc | 3.7 → 3.7 | 12.2 → 12.2 | 24.7 → 24.7 |
| | tape | 1.3 → 1.3 | 4.4 → 4.4 | 8.9 → 8.9 |
| steady notes (C4 E4 G♯4 D5) | disc | 3.7 → 0.2 | 12.3 → 0.6 | 24.7 → 1.2 |
| | tape | 1.2 → 0.2 | 4.1 → 0.3 | 8.3 → 0.6 |

Clean, the speech and singing come back bit-exact, five of the seven music clips too; a comped guitar gains 0.85 cents (its strings move together after each chord, as under a speed change), and a strummed one with 0.3 % tape wow comes out 1.3 → 2.4 cents, the one clip left less steady. A vibrato voice (±50 cents at 5.5 Hz), a 220 → 330 Hz glide and a vibrato voice over steady notes come back untouched. 0.1 took every partial's movement for speed: clean speech gained 8 cents of pitch wobble, music 16, singing 34; the glide came out 120 cents off, the vibrato at a fifth of its depth; with wow, 3 to 7 of the 7 music clips and all 5 singing clips came out worse than they went in (singing at 1 % disc: 12 → 48 cents). What dewow cannot do, measured: one voice or instrument alone, whatever its harmonics, gives no evidence — its own pitch movement and wow are the same observation; in real music it corrects only where notes hold steady (the guitars and the Sugar Plum Fairy most; Brahms' strings, "Vibe Ace" and the trumpet little or nothing) and leaves 0.3 % wow as it is, under the music's own pitch jitter; flutter needs a reference tone.

Held out (never tuned on): the 824 clean VoiceBank+DEMAND test utterances all come back bit-exact (0.1: none, the worst at −3.3 dB SNR against the input); five MUSDB18 mixes, three more GuitarSet takes and four more VocalSet singers: clean, all within 0.1 cent (all but one bit-exact), and with wow none came out worse — but only two mixes were corrected at all, at 2 % disc wow (24.4 → 22.1 and 21.8 cents); 0.1 added 10–51 cents to each of the music and singing clips, clean, and left 47 of 48 music and 23 of 24 singing cases with wow worse than it found them.

**Resolution.** `'partial'` reads frequency over the 93 ms frame: wow (< 6 Hz) is resolved, flutter averaged away — a shorter frame lets neighbouring partials of dense music into each other's reading. `'reference'` band-passes the tone (Q 5) and reads it over ~4.5 of its cycles, at least 1024 samples (23 ms): a 1 kHz calibration tone gives flutter too (30 Hz flutter read at 80 % of its depth, up to the hop rate's Nyquist, `fs/(2·hopSize)` ≈ 43 Hz), a 50 Hz hum is read over 90 ms and gives wow only. `'pitch'` mode's `smooth` doubles as its vibrato/drift cutoff (`speed = f0 / lowpass(f0, smooth)`): the 0.05 s default absorbs slow wow into the trend; several seconds recover it and take vibrato and intonation for speed with it.

**Not implemented:** azimuth/head-alignment error (a time skew across the stereo image, not a speed error), dropout repair (`@audio/denoise-repair`), anything ML-based. Celemony Capstan and similar tools use trained models to tell vibrato from wow on a solo voice; this package only measures speed from evidence present in the signal.

**Use when:** tape, cassette, vinyl and film transfers with audible wow over sustained, steady notes; any transfer with a hum, pilot or calibration tone (`'reference'`).<br>
**Not for:** a solo voice or instrument without a reference tone, speech (use `'reference'` on its hum, or leave it); dropouts; azimuth error; flutter from the music itself.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella.

MIT © [audiojs](https://github.com/audiojs)
