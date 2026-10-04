# @audio/denoise-detect [![npm](https://img.shields.io/npm/v/@audio/denoise-detect)](https://www.npmjs.com/package/@audio/denoise-detect) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

denoise — content-aware auto-selector: finds the defect a recording carries, if any, and routes to its method

```
npm install @audio/denoise-detect
```

```js
import denoise, { classify } from '@audio/denoise-detect'
```

Finds the defect a recording carries and routes it to the method for it. Each route needs evidence; with none, nothing is removed and the sound comes back as it was (`'none'`).

```js
denoise(data)                                                  // → cleaned Float32Array, or a copy: nothing to remove
denoise(data, { returnPlan: true })                            // → { out, plan }
denoise(data, { force: 'wiener' })                             // skip classifier
classify(data, fs)                                             // → { method, scores }, the plan alone
```

| Param | Default | |
|---|---|---|
| `fs` | `44100` | Sample rate |
| `force` | — | One of `'none' \| 'dehum' \| 'declick' \| 'dewind' \| 'deesser' \| 'dereverb' \| 'omlsa' \| 'wiener'` |
| `returnPlan` | `false` | Return `{ out, plan }` with classifier scores + chosen method |

**Routing, in priority order** (one STFT sweep, frames ≈ 46 ms, hop ¼; over 6 min, 16 spans of it spread across):
1. **hum → `dehum`**: dehum's own measurement finds a mains series, and the lines it finds, A-weighted (IEC 61672-1), lie within 50 dB of the program's A-weighted level. A lone 60 Hz line 30 dB under a voice is there, and the ear hears 60 Hz 26 dB less than 1 kHz.
2. **clicks → `declick`**: over 1 a second (`CLICK_RATE`) of impulses standing 32× out of the AR(30) error's local scale (the median of its 1.5 ms block RMS over ±12 ms, as declick judges), alone: no like of half its size 2.5–40 ms either side (a voice's pulses, creak down to 25 Hz), and no sound 10 dB louder after it than before (a plosive's burst, a note's attack).
3. **sibilance → `deesser`**: 5–9 kHz over 0.2–2 kHz power over 8.
4. **wind → `dewind`**: in over a tenth of the 0.15 s blocks, the low end (< 200 Hz) within 20 dB of the program, 6 dB over the 300–2000 Hz band, and without lines. Wind is turbulence at the microphone, without a period (Nelke & Vary, IWAENC 2014); a bass line or a voice's low end repeats at its pitch.
5. **noise bed → `wiener` or `omlsa`**: a floor within 25 dB of the program (`BED_SNR`; the program: frames within 40 dB of the loudest), shown in its *pauses* (runs of 0.15 s or more within 6 dB of the frame level's 10th percentile, flat and without lines in the bands from 300 Hz; the bed: their median level) or in *steady bands* (a band whose quieter half varies no more than twice what Gaussian noise over its bins would, without lines). A line is a band's fine structure (log power less its ±4-bin mean) correlated with the frame N back, which shares no sample: a partial holds its bins, noise draws them anew. Steady bands → `wiener`; a bed seen in the pauses alone wanders → `omlsa`.
6. otherwise **`none`**.

0.3 had no `none`: every recording went somewhere. Its floor statistic (the spread of a rolling-minimum frame energy) read a program's own dynamics as a wandering noise bed, so clean speech and music went to `omlsa`; a bass-heavy mix went to `dewind` (low over mid power above 3); clean VoiceBank went to `declick`, its impulse count firing on lip smacks and plosive bursts. A blind SNR estimate can't stand in for the bed, each assuming a speech-like program: on the training material below, clean music read (median) 5.4 dB by WADA-SNR (Kim & Stern, Interspeech 2008), 15.4 dB by a NIST STNR-like frame histogram and 7.0 dB by minimum statistics (Martin 2001), under the noisy VoiceBank takes' 13.2, 22.3 and 13.0. A bed has to show itself as noise, where the program pauses or never reaches.

`node scripts/detect.js tune|test` routes labelled material and prints what each class went to (sources and mixtures in the script); the share routed right, 0.3.2 → 0.4.0, thresholds chosen on `tune` (VoiceBank+DEMAND's training subset, Spoken Wikipedia narrations, repair/ music, VocalSet singers m1 f2 m2 f1, even Slakh mixes, MUSDB18 train), `test` run once (the VoiceBank+DEMAND test set, ten other narrations, other singers and tracks):

| material | wanted | tune | test |
|---|---|---:|---:|
| clean speech, VoiceBank (84 · 138) | `none` | 0 → 93% | 0 → 96% |
| narrations (20 · 20) | `none` | 0 → 90% | 0 → 85% |
| clean music (62 · 56) | `none` | 0 → 98% | 0 → 93% |
| VoiceBank+DEMAND noisy (84 · 138) | a reducer | 86 → 73% | 92 → 57% |
| speech + white, pink noise 0–20 dB under | a reducer | 100 → 95% | 99 → 100% |
| speech + babble 0–20 dB under | a reducer | 88 → 76% | 83 → 80% |
| music + white noise 10–20 dB under | a reducer | 97 → 92% | 100 → 89% |
| music + pink noise 10–20 dB under | a reducer | 97 → 68% | 100 → 68% |
| speech, music + mains hum 20 dB under | `dehum` | 57 → 83% | 69 → 81% |
| speech, music + clicks at 5× | `declick` | 100 → 94% | 99 → 90% |
| speech + wind gusts 0–10 dB under | `dewind` | 4 → 93% | 0 → 89% |
| music + wind gusts 0–10 dB under | `dewind` | 17 → 38% | 24 → 50% |
| all scored | | 66.4 → 84.6% | 68.8 → 84.9% |

Material with nothing to remove (tune 166, test 214): 0.3.2 processed all of it (median error −22.7 and −26.0 dB re the input); now 157 and 202 come back untouched. Of the 9 tune items processed, 5 VoiceBank takes go to `declick`, and they hold lip smacks 32–124× out of the error; a VoiceBank take and a metal track to `dehum`, each with a 50 Hz line 4–8 dB under its mean power; both excerpts of one narration to `omlsa`, its floor 21–23 dB under the voice, as audio-lena's is (22 dB). On test: `declick` 5, `omlsa` 2, `wiener` 2, `dewind` 2, `dehum` 1. Missed: noise holding a line through the pauses (an engine, a fan) unless it is steady elsewhere, so most of the test set's bus noise, and its office and living-room noise at 12.5–17.5 dB, stay; pink noise under a dense mix, masked where its power lies; a steady low rumble (traffic, a car) goes to `dewind` where its low end outweighs the mid band. ~10–17 ms per second of sound.

dereverb has no reliable single-pass signature, so auto-mode never selects it — reach it explicitly via `denoise(data, { force: 'dereverb' })` or `dereverb()`.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
