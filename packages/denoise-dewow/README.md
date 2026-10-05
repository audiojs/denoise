# @audio/denoise-dewow [![npm](https://img.shields.io/npm/v/@audio/denoise-dewow)](https://www.npmjs.com/package/@audio/denoise-dewow) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Wow & flutter correction — pitch-drift removal for tape/vinyl/cassette transfers

```
npm install @audio/denoise-dewow
```

```js
import dewow, { analyze } from '@audio/denoise-dewow'
```

Corrects wow and flutter: measures the speed of the disc or tape over time and reads the sound back at the inverse speed (variable-rate windowed sinc). A speed change moves every frequency by one ratio at one instant; a performer's vibrato, glide or melody moves one note and its harmonics. The estimator measures only the first:

- `'partial'` (default) — tracks the partials (STFT peaks, McAulay & Quatieri 1986 linking, phase-vocoder frequency over a 0.19 s frame) and cuts them into steady pieces of at least 0.2 s: a partial moving faster than wow can move it is a glide, a vibrato or a slip onto a neighbour. The speed is Godsill & Rayner's model (*Digital Audio Restoration*, 1998, ch. 8: log-frequency tracks `f = f0 + p + v`, a smoothness prior on the speed `p`) with one change that makes it hold on real music: a piece's centre `f0` is tied to its pitch class, every piece at that pitch anywhere in the recording. With the centres free, errors add up along the chain of overlapping notes (on a clean strummed-guitar take the curve walked 730 cents in 20 s, chord after chord). Music reuses its pitches, so each class measures the speed every time it sounds. Harmonics of a note count as one source, and a hop is evidence only where two independent sources agree (Tukey's biweight). Of that curve only a disc's wow is applied: a sinusoid at a turntable's rotation rate (33⅓, 45 or 78 rpm within 4 %, or its 2nd harmonic), found in the curve's spectrum, fitted to the pieces themselves, and kept where its amplitude stands 4.5 times over its own noise (a wild bootstrap of the fit's residuals, by note and by second), holds amplitude and phase from one half of its 20 s window to the other, and reaches 0.1 %. Whatever else is in the curve is left: on real music that is mostly the notes' own movement. Where a pilot tone runs through the recording (above 5 kHz) it is read instead, flutter too.
- `'reference'` — reads one steady tone: a pilot or calibration tone, or mains hum (`refFreq`; omitted, a pilot is looked for, then 50/60 Hz hum). Per hop, the DFT at the tone's current frequency and its phase advance over the hop; a reading counts where the tone stands 10 dB over its neighbourhood. Czyżewski et al., *Wow detection and compensation employing spectral processing of audio*, AES 117th Convention, 2004; *DSP techniques for determining "wow" distortion*, JAES 55(4), 2007.
- `'pitch'` — one voice's f0 (`@audio/pitch-pyin`) against its own smoothed trend: takes the performer's own pitch movement for speed; opt-in.

See also Howarth & Wolfe, *Correction of Wow and Flutter Effects in Analogue Tape Transfers*, AES 117th/118th Convention, 2004/2005; Nichols, *The Digital Restoration of Wow and Flutter Distorted Gramophone Recordings*, 1999.

```js
let corrected = dewow(recording, { fs: 44100 })                          // a disc's wow from the music's partials; a pilot tone if there is one
let corrected = dewow(recording, { fs, mode: 'reference' })              // the tone found: a pilot, else 50/60 Hz hum
let corrected = dewow(recording, { fs, mode: 'reference', refFreq: 1000 }) // a 1 kHz calibration tone
let corrected = dewow(recording, { fs, mode: 'pitch', smooth: 3 })       // one voice, its vibrato taken too

let meter = analyze(recording, { fs })
// → { speed, times, hop, wow, flutter, wowPeak, flutterPeak, confidence, tracks?, lines?, reference? }
```

`recording` is a mono `Float32Array` or an array of channels (`[L, R, …]`); analysis runs on the mono mix, and one shared curve corrects every channel, so a stereo pair stays sample-aligned. Returns new arrays — never in place.

| Param | Default | |
|---|---|---|
| `fs` | `44100` | Sample rate |
| `mode` | `'partial'` | `'partial'` \| `'reference'` \| `'pitch'` |
| `refFreq` | found | The tone for `mode: 'reference'`, Hz; omitted or 0: a pilot above 5 kHz, else 50/60 Hz hum |
| `frameSize` | ≈ 0.19 s | STFT frame (8192 at 44.1–48 kHz); `'partial'` reads each partial's frequency over it (wow, not flutter) |
| `hopSize` | `frameSize / 16` | STFT hop — the curve's own sample rate |
| `smooth` | `0.05` | Zero-phase smoothing time constant (s) separating wow (slower) from flutter |
| `wow` | `true` | Correct the slower component |
| `flutter` | `true` | Correct the faster component |
| `maxDeviation` | `0.05` | Clamp the corrected speed ratio to `[1−x, 1+x]`; a tone is looked for within it |
| `minTrack` | `0.2` | Shortest steady piece of a partial used, in seconds — `'partial'` mode |
| `minFreq` / `maxFreq` | `50` / `2000` | Where partials (`'partial'`) or the f0 (`'pitch'`) are looked for, Hz |
| `keepLength` | `true` | Output length equals input length |

`analyze()` is the estimator alone — the "wow & flutter meter". `wow`/`flutter` are the **unweighted RMS** deviation in %, `wowPeak`/`flutterPeak` the **unweighted peak**; *not* the IEC 60386 / DIN 45507 figure, which weights the deviation (peaking near 4 Hz) first. `lines` (`'partial'`) lists the disc's wow found and applied: `{ start, end, freq, rpm, depth }`, depth the peak deviation in %; `reference` the tone read, Hz (null where `'reference'` found none); `confidence` the share of hops the curve stands on (a window with a line, the tone read, voiced pitch); `tracks` (`'partial'`) the pieces of partials. `times` are each hop's frame centre.

`node scripts/dewow.js` (in the [@audio/denoise](https://github.com/audiojs/denoise) repo) reads clean speech (audio-lena, two Spoken Wikipedia narrations), music ("Vibe Ace", "Dance of the Sugar Plum Fairy", Brahms' Hungarian Dance No. 5, a trumpet loop, three GuitarSet takes, six MUSDB18 mixes, four BabySlakh mixes) and singing (five VocalSet excerpts) at a varying speed — a disc turning off-centre at 33⅓, 45 or 78 rpm (a sine at the rotation rate), or tape's random wow (0.5–6 Hz) — at 0.3, 1 and 2 % peak, and measures the pitch error left on the audio itself (local lag against the clean sound, differentiated; cents RMS, mean over clips; doing nothing leaves the wow):

| | wow | 0.3 % | 1 % | 2 % |
|---|---|---:|---:|---:|
| music | disc 33⅓ | 3.7 → 1.7 | 12.2 → 2.1 | 24.5 → 4.3 |
| | disc 45 | 3.7 → 1.6 | 12.2 → 3.0 | 24.5 → 6.0 |
| | disc 78 | 3.7 → 1.2 | 12.2 → 2.9 | 24.5 → 13.4 |
| | tape | 1.4 → 1.4 | 4.6 → 4.6 | 9.2 → 9.2 |
| speech, singing | any | unchanged | unchanged | unchanged |
| steady notes (C4 E4 G♯4 D5) | disc 33⅓ / 45 / 78 | 3.7 → 0.0 / 0.1 / 0.1 | 12.3 → 0.1 / 0.2 / 0.5 | 24.6 → 0.3 / 0.5 / 0.9 |
| | tape | 1.3 → 1.3 | 4.5 → 4.5 | 9.0 → 9.0 |

The longer the recording, the more turns of the disc and returns of each note it holds: on whole pieces (`node scripts/dewow.js whole`), disc wow at 33⅓ rpm comes out of the Sugar Plum Fairy (120 s) at 0.4, 0.6 and 0.8 cents from 3.7, 12.2 and 24.5; of "Vibe Ace" (61 s) at 0.6, 1.0 and 1.9; of the Brahms (46 s, strings with vibrato) at 3.0, 2.4 and 3.2.

Flutter (random, 6–30 Hz, 0.1 % peak, over 1 % tape wow) is not read from the music; a pilot tone reads it all, found by itself (19 kHz, 40 dB under the program): speech, music and singing 4.2–4.5 → 0.1 cents. Mains hum is a poor reference under program that has its own energy at 50–100 Hz: 50 Hz hum 30 dB down, read in `mode: 'reference'`, brings singing 4.3 → 2.2, speech 4.3 → 3.7, music 4.4 → 4.2.

Clean, every clip comes back bit-exact: 25 tuning and 19 held-out clips of speech, music and singing, the 504 clean VoiceBank+DEMAND training and 824 test utterances, a vibrato voice (±50 cents at 5.5 Hz), a 220 → 330 Hz glide and a vibrato voice over steady notes. With wow, no clip came out worse than it went in. 0.2 on the same music: disc wow at 33⅓ rpm 3.7 → 3.6, 12.2 → 10.5, 24.5 → 18.0; it moved 3 of the 17 clean music clips (by up to 0.85 cents) and made 4 tape cases worse; it did correct steady notes under random tape wow (4.5 → 0.5 cents), which 0.3 leaves.

Held out (never tuned on: two more narrations, six MUSDB18 test mixes, three more GuitarSet takes, four more BabySlakh mixes, four more VocalSet singers): clean all bit-exact; music, disc wow at 0.3 / 1 / 2 %: 33⅓ rpm 3.7 → 2.3, 12.2 → 2.8, 24.5 → 6.9; 45 rpm 1.9, 2.8, 7.7; 78 rpm 2.0, 5.7, 17.6; tape, speech and singing unchanged; none worse (0.2: 12.2 → 11.4 at 1 %, 33⅓ rpm; 3 of 13 clean mixes moved).

What dewow cannot do, measured: random tape wow, read from the music alone, is left as it is — over a few seconds the notes' own pitch movement is as large as the wow, and no test told the two apart without also passing a voice's intonation; one voice or instrument alone gives no evidence (its own movement and the wow are the same observation), so speech and singing are corrected only through a tone; 78 rpm wow of 2 % is about half corrected in 20 s excerpts (24.5 → 13.4 cents; held out 17.6). A short clip (under 5 s) is never corrected from the music: over a few seconds a voice's intonation has as much at 1–2 Hz as any disc.

**Resolution.** `'partial'` reads frequency over the 0.19 s frame: wow (< 3 Hz) is resolved, flutter averaged away. `'reference'` band-passes the tone (Q 5) and reads it over ~4.5 of its cycles, at least 1024 samples (23 ms): a pilot or a 1 kHz calibration tone gives flutter (30 Hz flutter read within 30 % of its depth; up to the hop rate's Nyquist, `fs/(2·hopSize)` ≈ 43 Hz at 44.1 kHz); a 50 Hz hum is read over 90 ms and smoothed to 4 Hz, wow only. `'pitch'` mode's `smooth` doubles as its vibrato/drift cutoff (`speed = f0 / lowpass(f0, smooth)`): the 0.05 s default absorbs slow wow into the trend; several seconds recover it and take vibrato and intonation for speed with it.

**Not implemented:** azimuth/head-alignment error (a time skew across the stereo image, not a speed error), dropout repair (`@audio/denoise-repair`), anything ML-based. Not compared: Celemony Capstan (Melodyne's polyphonic note analysis; "the less polyphonic the music is, the more manual help is needed", its manual) and iZotope RX's Wow & Flutter (RX 8 and later, Advanced; a sensitivity control trades vibrato against correction) were not installed here, and ffmpeg has no such filter. dewow applies only what the signal proves: no sensitivity to set, and where nothing is proven the audio passes through bit-exact.

**Use when:** disc transfers (33⅓, 45, 78 rpm) of polyphonic music with an off-centre or warped record; any transfer with a pilot tone (found by itself) or a calibration tone or strong hum (`'reference'`).<br>
**Not for:** random tape wow from the music alone (it is left); a solo voice or instrument without a tone to read; dropouts; azimuth error.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella.

MIT © [audiojs](https://github.com/audiojs)
