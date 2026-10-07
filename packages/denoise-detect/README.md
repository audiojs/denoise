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
4. **noise bed → `omlsa`**: a floor within 25 dB of the program (`BED_SNR`; the program: frames within 40 dB of the loudest), shown in its *pauses* or in *steady bands*. The pauses are runs of 0.15 s or more within 6 dB of the frame level's 10th percentile that hold noise or hold the floor; the bed is their median level. *Noise*: flat and without lines in the bands from 300 Hz. *The floor*: a bed lies under the program all the time, so in each band the pauses sit where the band sinks to over the whole take (its 5th percentile), no further over it than Gaussian noise's own spread puts them (1.645 · 4.34/√(n/1.5) dB over n bins) plus 3 dB for the bed's slow wander (the bands' median), and they hold no partials that come and go (median persistence under 0.1; babble reads 0.04–0.08). A line held through every pause and across the notes, an engine's, a fan's, a mains-like tone, is part of the floor; a quiet passage of music isn't: its notes come and go, and its pauses stand over the floors other passages sink to. *Steady bands*: a band whose quieter half varies no more than twice what Gaussian noise over its bins would, without lines. A line is a band's fine structure (log power less its ±4-bin mean) correlated with the frame N back, which shares no sample: a partial holds its bins, noise draws them anew.
5. **wind → `dewind`**: in over a tenth of the 0.15 s blocks, the low end (< 200 Hz) within 20 dB of the program, 6 dB over the 300–2000 Hz band, and without lines, where no bed shows. Wind is turbulence at the microphone, without a period (Nelke & Vary, IWAENC 2014); a bass line or a voice's low end repeats at its pitch.
6. otherwise **`none`**.

Every bed goes to `omlsa`, and a bed outranks wind, by what each reducer made of the noisy speech the router sends them (`node scripts/detect.js tune reduce`, `python scripts/detect.py score tune`; PESQ wideband, STOI, DNSMOS SIG at 16 kHz as `scripts/speech.py` scores):

| noise (takes) | PESQ: noisy · `wiener` · `omlsa` · `dewind` | STOI, the same | SIG, the same |
|---|---|---|---|
| VoiceBank+DEMAND, its ten training noises (504) | 1.47 · 1.84 · 1.83 · 1.68 | 0.841 · 0.833 · 0.842 · 0.828 | 3.00 · 3.18 · 3.18 · 2.98 |
| of them car (43) | 2.43 · 3.27 · 3.32 · 3.06 | 0.959 · 0.954 · 0.961 · 0.949 | 3.49 · 3.50 · 3.50 · 3.45 |
| DEMAND washing machine, field, park, river, hallway (126) | 1.77 · 2.25 · 2.26 · 1.98 | 0.883 · 0.879 · 0.887 · 0.870 | 3.28 · 3.42 · 3.43 · 3.27 |
| white, pink noise 0–20 dB (168) | 1.42 · 1.86 · 1.85 · 1.62 | 0.809 · 0.811 · 0.820 · 0.787 | 3.20 · 3.33 · 3.32 · 3.15 |
| six-talker babble 0–20 dB (84) | 1.53 · 1.57 · 1.57 · 1.55 | 0.761 · 0.753 · 0.756 · 0.752 | 2.78 · 2.94 · 2.93 · 2.76 |
| recorded and generated wind 0, 10 dB (84) | 1.51 · 1.99 · 1.98 · 2.07 | 0.891 · 0.889 · 0.896 · 0.886 | 3.34 · 3.35 · 3.32 · 3.26 |
| synthetic wind gusts 0, 10 dB (28) | 1.48 · 1.52 · 1.56 · 1.88 | 0.871 · 0.867 · 0.870 · 0.874 | 3.22 · 3.17 · 3.10 · 3.20 |

Over all 994 takes `omlsa` kept STOI 0.007 over `wiener`'s (paired, ±0.001 at 95%; on each noise but six-talker babble and the synthetic gusts, its interval clear of 0) at the same PESQ (−0.001 ± 0.006) and SIG (−0.008 ± 0.012); `wiener`'s edge, BAK and OVRL on stationary noise (white, pink, speech-shaped: OVRL 0.02–0.09), lies in the noise left, not the speech. 0.4 sent a bed seen in steady bands to `wiener`. A steady low rumble is a bed: on a car, traffic, a metro, a field, a park `omlsa` took it 0.1–0.3 PESQ and 0.01–0.02 STOI over `dewind`, where 0.4 sent it, wind outranking the bed. Recorded and generated wind split them: `dewind` leads PESQ by 0.09, `omlsa` STOI by 0.010 and SIG by 0.06; synthetic gusts with calms between are `dewind`'s, and still go to it where their calms show no bed, about half (the `+ wind gusts` rows below). Run once on `test`'s 1628 takes (`score test`): STOI +0.008 ± 0.000 again, PESQ −0.006 ± 0.005 and SIG −0.010 ± 0.008 (on VoiceBank+DEMAND's test noises +0.002 and −0.013; `dewind` there 2.25 to `omlsa`'s 2.36), recorded wind as on `tune` (`dewind` PESQ 1.93, `omlsa` 1.74; STOI 0.885 and 0.902, SIG 3.14 and 3.24).

0.3 had no `none`: every recording went somewhere. Its floor statistic (the spread of a rolling-minimum frame energy) read a program's own dynamics as a wandering noise bed, so clean speech and music went to `omlsa`; a bass-heavy mix went to `dewind` (low over mid power above 3); clean VoiceBank went to `declick`, its impulse count firing on lip smacks and plosive bursts. A blind SNR estimate can't stand in for the bed, each assuming a speech-like program: on the training material below, clean music read (median) 5.4 dB by WADA-SNR (Kim & Stern, Interspeech 2008), 15.4 dB by a NIST STNR-like frame histogram and 7.0 dB by minimum statistics (Martin 2001), under the noisy VoiceBank takes' 13.2, 22.3 and 13.0. A bed has to show itself, where the program pauses or never reaches.

`node scripts/detect.js tune|test` routes labelled material and prints what each class went to (sources and mixtures in the script); the share routed right, 0.4.1 → 0.5.0, thresholds chosen on `tune` (VoiceBank+DEMAND's training subset, DEMAND's washing machine, field, park, river and hallway in the first half of each recording, Spoken Wikipedia narrations, repair/ music, VocalSet singers m1 f2 m2 f1, even Slakh mixes, MUSDB18 train, `scripts/wind.py`'s tune half), `test` run once (the VoiceBank+DEMAND test set, the second half of each DEMAND recording, ten other narrations, other singers, tracks and winds):

| material | wanted | tune | test |
|---|---|---:|---:|
| clean speech, VoiceBank (504 · 824) | `none` | 97 → 97% | 95 → 95% |
| narrations (20 · 20) | `none` | 90 → 90% | 85 → 85% |
| clean music (62 · 56) | `none` | 98 → 97% | 93 → 91% |
| VoiceBank+DEMAND noisy (504 · 824) | a reducer | 75 → 91% | 59 → 76% |
| speech + DEMAND 2.5–17.5 dB under (126 · 206) | a reducer | 55 → 79% | 63 → 78% |
| speech + white, pink noise 0–20 dB under | a reducer | 95 → 96% | 100 → 100% |
| speech + babble 0–20 dB under | a reducer | 76 → 79% | 80 → 80% |
| music + white noise 10–20 dB under | a reducer | 92 → 92% | 89 → 89% |
| music + pink noise 10–20 dB under | a reducer | 68 → 73% | 68 → 70% |
| music + DEMAND 10, 20 dB under (124 · 112) | a reducer | 27 → 34% | 28 → 32% |
| speech + recorded wind 0, 10 dB under (84 · 138) | `dewind` or a reducer | 92 → 92% | 91 → 91% |
| speech, music + mains hum 20 dB under | `dehum` | 83 → 83% | 81 → 81% |
| speech, music + clicks at 5× | `declick` | 94 → 94% | 90 → 90% |
| speech + wind gusts 0–10 dB under | `dewind` | 93 → 64% | 89 → 54% |
| music + wind gusts 0–10 dB under | `dewind` | 38 → 33% | 50 → 45% |
| all scored | | 80.3 → 86.0% | 77.8 → 83.5% |

Per noise, the noisy speech routed to a reducer (VoiceBank+DEMAND's training and test sets hold different noises):

| tune | | test | |
|---|---:|---|---:|
| babble | 79 → 80% | bus | 38 → 55% |
| cafeteria | 64 → 81% | cafe | 86 → 95% |
| car | 33 → 77% | living room | 64 → 92% |
| kitchen | 90 → 98% | office | 46 → 51% |
| meeting | 71 → 91% | public square | 60 → 90% |
| metro | 55 → 92% | | |
| restaurant | 95 → 100% | | |
| speech-shaped | 100 → 100% | | |
| station | 98 → 98% | | |
| traffic | 58 → 100% | | |

| DEMAND under speech | tune | test |
|---|---:|---:|
| washing machine | 15 → 15% | 21 → 21% |
| field | 24 → 100% | 29 → 71% |
| park | 84 → 96% | 83 → 100% |
| river | 100 → 100% | 100 → 100% |
| hallway | 52 → 84% | 80 → 100% |

Material with nothing to remove (tune 586, test 900): 565 and 854 come back untouched (0.4.1: 566, 855). Most of the rest goes to `declick` on VoiceBank's lip smacks (14 and 37 takes, 32–124× out of the error); to `omlsa` (5 and 6): three VoiceBank takes and one narration in each set whose floor reads 8–25 dB under the voice (audio-lena's: 22 dB), a GuitarSet mic take and a VocalSet one 19–25 dB over theirs, two MUSDB18 mixes (`wiener`'s in 0.4.1). Missed: a bed further under the program than `BED_SNR`, where VoiceBank's own clean takes sit (their room 28–41 dB under): DEMAND's bus and office noise holds its power under 63 Hz, so the test set's bus and office takes at 12.5 and 17.5 dB read 26–33 dB in the pauses, as do the training set's car at 15 dB, and the washing machine's drum at 16 Hz leaves almost nothing above; babble and cafeteria that wander more than 3 dB pause to pause; a bed under a dense mix, masked where its power lies. ~10–18 ms per second of sound.

Most of the test set's misses are those: bus and office at 12.5 and 17.5 dB go to a reducer in 0–52 % of takes, the rest in 75–100 %. Their noise holds 88 % (bus) and 95 % (office) of its power under 40 Hz (every 3rd test take, noisy less clean); above 63 Hz it lies 26–33 dB under the voice, where VoiceBank's clean takes keep their own room (10th–90th percentile 30–40 dB). On the training material a bar low enough to take them does not pay: over 351 tuning takes (VoiceBank+DEMAND's training set, every 6th utterance clean and noisy, and the speech of `audio`'s `bench/rx/assistant.mjs` tuning split, whose brown and rumble beds sit as low), routing every bed read under T dB to `omlsa` changes PESQ by +40.4 summed at 25 dB, +41.7 at 28, +34.8 at 31, +19.0 at 34 (STOI +0.24, +0.22, +0.03, −0.29): `omlsa` takes a clean take's room 15 dB down and 0.40 of its PESQ. Taking a bed only to 40 dB under the program (ACX's noise floor under its loudness; `threshold` 4) slows the fall, +33.4 at 31 and +27.0 at 34, but never reaches 25 dB's; the pauses' power at 20–63 Hz, 15–20 dB under the voice in the test set's bus and office takes against 28 in its clean ones, is 18 dB or less in 5 % of the training speakers' clean takes. Under the chain's 40 Hz highpass (`@audio/chain`) the bulk of those beds goes anyway.

dereverb has no reliable single-pass signature, so auto-mode never selects it — reach it explicitly via `denoise(data, { force: 'dereverb' })` or `dereverb()`.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
