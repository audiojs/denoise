# @audio/denoise [![npm](https://img.shields.io/npm/v/@audio/denoise)](https://www.npmjs.com/package/@audio/denoise) [![license](https://img.shields.io/badge/license-MIT-green.svg)](https://spdx.org/licenses/MIT.html)

Try it in the browser: [Noise remover](https://audiojs.dev/util/denoise/). Runs on this package, nothing is uploaded.

Single-pass noise reduction. 13 specialised methods + an auto-classifier.

| | Domain | Targets | Quality | CPU | Best for |
|---|---|---|---|---|---|
| [denoise](#denoise) | meta | auto | — | varies | "just clean it" |
| [gate](#gate) | time | silence | ★ | very low | hard cut at threshold |
| [dehum](#dehum) | time | mains hum | ★★★★ | low | 50/60 Hz + harmonics |
| [specsub](#specsub) | freq | broadband stationary | ★★ | medium | baseline |
| [wiener](#wiener) | freq | broadband stationary | ★★★ | medium | general broadband |
| [omlsa](#omlsa) | freq | broadband non-stationary | ★★★★ | high | speech in changing noise |
| [declick](#declick) | time | impulses | ★★★★ | medium | vinyl ticks, edit clicks, mouth clicks |
| [decrackle](#decrackle) | time | dense impulses | ★★★ | medium | shellac crackle |
| [declip](#declip) | time + freq | hard clipping | ★★★★ | high | clipped speech and music, rails found by itself, also through MP3/AAC |
| [dewind](#dewind) | freq | wind, LF rumble | ★★★ | medium | wind under a voice, its harmonics kept |
| [deplosive](#deplosive) | time | LF bursts | ★★★★ | low | mic plosives (p, b) |
| [deesser](#deesser) | time | sibilance | ★★★★ | low | voice (s, sh) |
| [debreath](#debreath) | time | breaths | ★★★★ | low | breaths between phrases |
| [desilence](#desilence) | time | pauses | ★★★ | low | remove / shorten / trim silence, split by pause |
| [dereverb](#dereverb) | freq | late reverb | ★★★ | high | speech in a room |
| [debleed](#debleed) | freq | bleed of a source with its own track | ★★★ | high | click track, amp or co-host in a mic |
| [dewow](#dewow) | time + freq | pitch drift | ★★★ | medium | disc wow (33⅓ / 45 / 78 rpm) in music; tape by its pilot tone |

For broader DSP needs use [stretch](https://github.com/audiojs/stretch), [shift](https://github.com/audiojs/shift), [pitch](https://github.com/audiojs/pitch), [beat](https://github.com/audiojs/beat).


## Usage

```sh
npm install @audio/denoise
```

```js
import { denoise, dehum, wiener, declick } from '@audio/denoise'

let cleaned   = denoise(samples)                              // auto-classify + dispatch
let unhummed  = dehum(samples, { freq: 60 })                  // explicit method
let { out, plan } = denoise(samples, { returnPlan: true })    // see what was chosen
```

```js
// Streaming — pass options first, then call repeatedly with chunks.
let write = wiener({ fs: 48000 })
write(block1)
write(block2)
write()                                                        // → flush remaining samples
```

> Mono `Float32Array` in/out. State lives on the `params` object; pass the same one across calls and biquad memory / spectral history persists. For stereo, process channels independently.


## `denoise`

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

dereverb has no reliable single-pass signature, so auto-mode never selects it — reach it explicitly via `denoise(data, { force: 'dereverb' })` or `dereverb()`.


## Tonal & narrowband

### `dehum`

Follows the mains phase, then subtracts the hum along it: each harmonic of the mains frequency, to 8 kHz where buzz carries it, is estimated as a slowly varying sinusoid and taken out, so what goes with the hum is the program within a fraction of a hertz of each line, and less of it where the program is loud there. Without hum the audio comes back untouched. Notches (0.2.0) took whatever their band held, a band that grows with the harmonic (Q 30: 1.7 Hz at 50 Hz, 33 Hz at 1 kHz), an orchestra's G2 two hertz under the 100 Hz line among it; and as the mains frequency wanders (±0.02–0.2 Hz, h times that at harmonic h) narrow ones miss the upper harmonics.

```js
dehum(data, { fs })                                            // 50 or 60 Hz, found; nothing without hum
dehum(data, { fs, freq: 60 })                                  // the 60 Hz series, its exact frequency tracked
dehum(data, { fs, freq: 60, harmonics: 4 })                    // remove 60–240 Hz as told
measure(data, fs)                                              // → { f0, harmonics } or null (import from @audio/denoise-dehum)
```

| Param | Default | |
|---|---|---|
| `freq` | found | Fundamental, Hz. Omitted: the 50 or 60 Hz series, whichever is found. Given: that series, its frequency tracked from there (within ±0.4 %, ±`drift` Hz with `adaptive`) |
| `harmonics` | to 8 kHz | Remove h = 1…`harmonics` as told. Omitted: every harmonic to 1 kHz and each line above it that stands out, to 8 kHz |

Hum is found by `measure()`, one Fourier transform over the signal (its first 80–90 s, taken down to 3 kHz), where a hum line, steady for minutes, gathers into a peak 1/T wide while speech spreads: the fundamental 20 dB over the median of the ±8 Hz around it, or two of the first six harmonics 15 dB, each 6 dB over any other peak within 3 Hz, all harmonics of one fundamental. Under music a line 20 dB under the program is too faint for that, so the band to 1 kHz is also tracked along each series (below) and its lines weighed where the program is quiet around them: hum is there when two or more of the first 20 harmonics stand out by 18 dB, are no more than 60 dB under the signal, and half of those that stand out stand 6 dB over any other peak within 3 Hz (a bar of music repeated exactly is a comb of lines 1/bar apart, lines at 50 and 60 Hz among them, few alone).

The mains phase is tracked first from the harmonics to 1 kHz (each harmonic's phasor per Hann frame four mains cycles long, fitted over 2 s, their turn combined by h²·SNR over 8 s: Hajj-Ahmad, Garg & Wu 2013), then the signal is resampled so that the tracked mains period spans 2^k samples (computed order tracking: Fyfe & Munck 1997). There every harmonic sits on one bin of a 2^k-point transform of each frame however the mains wander, and the phase is refined from the turn between frames of the harmonics, to 16, 64, … 8 kHz, whose lines stand out alone (a partial beside a line turns it with the program), each weighted by its line's power over the program's there and smoothed by Rauch–Tung–Striebel at the likeliest rate of wander and noise scale; a refinement is kept only if it draws the lines tighter (their coherent power grows). Each harmonic's phasors are fitted over 2 s by weighted local-linear least squares (normalized convolution, Knutsson & Westin 1993), each frame weighted by the inverse of the program's power around the line there, so a passing voice or note is bridged from the frames around it rather than averaged in. Under a dense mix there is no frame to bridge from, and a fit over 2 s takes the music near every line, more of it than a faint hum (0.5.0: buzz 30 dB under music came out 7 dB worse than it went in); so the fit is kept within 30 % of the hum bridged through the program: the line's phasors, with any steady tone beside it taken out, followed as a slow random walk by Rauch–Tung–Striebel with the program's power in each frame as its noise, which carries the hum across a loud passage from where it stands alone instead of taking the music in. A line counts only if it persists where the program falls silent, at a tenth of its power elsewhere at least (a note held on a line goes quiet with the music; a held synth note at exactly 50 Hz was taken for hum). The sinusoids are resynthesized period by period, brought back to the original samples (Kaiser-windowed sinc) and subtracted (harmonic subtraction, as power-line interference is taken out of ECG: Levkov et al. 2005).

Where the hum itself jumps (an edit's splice turns its phase, a level step, hum switched on or off), every line's phasors before and after a frame differ beyond their spread at once, a note beside one line moving that line alone: the tracking does not integrate across the jump, each stretch is fitted on its own frames, and the hum switches from one stretch's to the next at the sample that best splits the signal between them. A note within ~0.5 Hz of a line for seconds is taken for hum. Whole clip (`streaming: false`), a second at least to find hum; shorter, it removes the harmonics of a given `freq` as told and passes the audio through without one. About a tenth of real time (0.4.0: a hundredth), most of it in the 2 s fits.

Measured by `node scripts/dehum.js`, 0.4.0 → 0.5.1: the hum (mains: 12 harmonics at −6 dB per octave; buzz: odd-heavy to 8 kHz, odd h at h^−½, even at 0.3·h^−½, rolling off over 3 kHz; levels drifting ±10 %, f0 0.05 Hz off nominal and wandering) and the program told apart by phase inversion (Hagerman & Olofsson 2004). 50 Hz hum 20 dB under the program, wandering ±0.02 Hz; program SDR per band where the band holds 1 % of the program:

| material | hum down, dB | program SDR, dB | <100 Hz | 100–300 | 300–1k | 1–4k | >4k |
|---|---:|---:|---:|---:|---:|---:|---:|
| speech | 45.5 → 41.7 | 38.5 → 41.7 | 28.9 → 28.9 | 39.2 → 42.3 | 39.2 → 45.1 | 83.0 → 83.8 | – → – |
| narration | 43.5 → 38.6 | 42.7 → 46.8 | – → – | 38.8 → 40.0 | 42.9 → 48.1 | 64.5 → 85.9 | 73.9 → 89.0 |
| vibeace | no hum found → 33.3 | no hum found → 32.6 | no hum found → 32.3 | no hum found → 32.8 | no hum found → 32.4 | no hum found → 74.8 | no hum found → – |
| brahms | 42.2 → 24.4 | 25.7 → 31.4 | 30.2 → 34.0 | 17.9 → 22.3 | 27.0 → 36.9 | 57.8 → 84.5 | 50.2 → 77.5 |
| nutcracker | 41.6 → 26.4 | 27.6 → 33.2 | 23.5 → 27.9 | 30.7 → 35.2 | 26.8 → 32.9 | 63.6 → 77.4 | – → – |
| trumpet | 51.0 → 47.3 | 47.9 → 49.4 | – → – | – → – | 42.2 → 43.6 | 82.3 → 94.8 | – → – |

Hum down / program SDR, dB:

| material | 60 Hz | 50 Hz, ±0.05 Hz | 50 Hz, 30 dB under | 60 Hz buzz to 8 kHz | 50 Hz buzz, ±0.2 Hz |
|---|---|---|---|---|---|
| speech | 46.3 / 42.1 → 45.4 / 44.5 | 36.4 / 38.5 → 35.5 / 41.5 | 38.7 / 38.6 → 35.1 / 43.9 | 6.7 / 42.1 → 28.9 / 36.2 | 5.2 / 37.3 → 7.8 / 36.4 |
| narration | 43.6 / 44.0 → 39.9 / 45.8 | 33.8 / 42.8 → 36.8 / 46.8 | 42.3 / 42.9 → 31.8 / 50.4 | 6.7 / 43.9 → 26.4 / 40.2 | no hum found → no hum found |
| vibeace | no hum found → 33.7 / 32.3 | no hum found → 29.0 / 32.5 | no hum found → no hum found | no hum found → 22.1 / 33.8 | no hum found → 3.6 / 26.8 |
| brahms | 41.7 / 29.0 → 25.1 / 34.0 | 27.8 / 25.7 → 16.1 / 31.5 | 33.9 / 25.7 → 13.2 / 32.9 | 6.5 / 29.0 → 11.8 / 31.9 | 5.0 / 25.7 → 4.3 / 32.9 |
| nutcracker | 40.7 / 24.3 → 20.4 / 35.0 | 33.2 / 27.9 → 23.1 / 32.9 | no hum found → no hum found | 2.9 / 26.1 → 13.6 / 31.4 | 5.2 / 28.3 → 6.2 / 33.3 |
| trumpet | 51.9 / 47.8 → 50.5 / 50.2 | 46.0 / 47.7 → 42.0 / 48.9 | 48.4 / 48.0 → 39.9 / 49.0 | 6.1 / 48.0 → 39.0 / 43.9 | 6.2 / 45.8 → 20.6 / 38.2 |

An edited take (eight stretches cut out, from a pause to a pause in the speech, anywhere in the music, the hum's phase jumping at each cut), then the hum's level stepping four times among off, −10, −5, 0 and +5 dB; hum down within a second of a cut or step / elsewhere, and the program SDR, dB:

| material | within 1 s | elsewhere | program SDR |
|---|---:|---:|---:|
| speech | 6.5 → 7.7 | 41.1 → 41.2 | 38.3 → 38.7 |
| narration | no hum found → 24.6 | no hum found → 35.3 | no hum found → 41.9 |
| brahms | 9.5 → 7.9 | 37.0 → 15.1 | 25.0 → 30.7 |
| nutcracker | 9.7 → 9.1 | 36.0 → 13.9 | 28.0 → 34.8 |

| material | within 1 s | elsewhere | program SDR |
|---|---:|---:|---:|
| speech | 14.7 → 18.9 | 40.9 → 28.8 | 38.4 → 39.8 |
| narration | 15.0 → 23.6 | 41.0 → 34.7 | 42.5 → 43.7 |
| brahms | 13.9 → 14.1 | 40.5 → 26.7 | 25.8 → 32.0 |
| nutcracker | 15.0 → 17.7 | 40.7 → 24.0 | 27.7 → 34.5 |

Hum alone, 30 s, ±0.02 Hz: 56 → 61 dB down; buzz to 8 kHz alone: 6.4 → 62.2. Clean speech, narration and music: no sample changed. Under music 0.5.1 takes less hum than 0.4.0 and far less of the music: Brahms loses 24 dB of its hum, not 42, and keeps 31.4 dB of program SDR, not 25.7, its 100–300 Hz band 22.3, not 17.9; what is left of the hum is 44 dB under the orchestra. Vibe Ace's hum, among the track's own steady lines, is found now (0.4.0 left it): 33 dB down. A generator's ±0.2 Hz wander under a voice is followed by 8 dB only.

Against iZotope RX 12 De-hum (2026-10, `node bench/rx/dehum.mjs` in `audio`; RX hosted through Pedalboard, a new instance per render, its Learn on 3 s of the hum alone before each take as its manual has it): 21 test clips (6 VoiceBank speech clips of eight utterances, 4 Spoken Wikipedia readings, Brahms, Vibe Ace, the Nutcracker, the trumpet, 7 MUSDB18 test previews), six conditions (50 Hz mains, 60 Hz buzz to 8 kHz, 50 Hz buzz wandering ±0.2 Hz, level steps, six splices, 60 Hz buzz 30 dB under), RX's knobs chosen on a separate split (VoiceBank training speakers, other readings, MUSDB18 training previews): its best, Dynamic at sensitivity 1 and Q 10000, beat its defaults (sensitivity 5: 18.6 dB mean SDR on the tuning split) and every Static setting (7–12 dB: its notches, 16 harmonics at Q 300–3000, leave an error 3–10 dB under a white program's 40–1000 Hz band). Mean over conditions and materials, hum down / SDR against the clean program / PESQ (speech and readings):

| | RX defaults | RX tuned | 0.4.0 | 0.5.1 |
|---|---:|---:|---:|---:|
| hum down, dB | 7.7 | 3.2 | 11.8 | 17.7 |
| SDR, dB | 18.9 | 25.4 | 29.4 | 34.9 |
| PESQ | 3.06 | 2.80 | 3.27 | 4.01 |

RX's learned Dynamic profile acts as a gate: it takes the hum in the room tone 54–60 dB down and leaves it under the speech, where it takes as much of the voice (18.9 dB mean SDR, the input's 22.6). Tuned, it barely touches the take (3 dB of hum), the best SDR it reaches. 0.5.1 is over RX tuned in SDR in all 18 condition × material cells (buzz 30 dB under music: 35.9 against 32.2, input 31.3), and every clip comes out within 0.2 dB of its input SDR or better. Hum as recorded (MIR-1K singing, DEMAND's washing machine and hallway, five readings, a VoiceBank take): RX's select-all Learn takes its lines up to 18 dB down and the program with them (the rest of the spectrum 1.5–20 dB SDR); dehum takes them 0–14 dB down and leaves the rest 21–60 dB. VocalSet's 60 Hz lines, more than 60 dB under the singing and barely over its room tone, are left as they are (0.4.0 took them 0–7 dB down; RX up to 23, the rest of the spectrum 0.2–12.5 dB).

**Use when:** mains buzz, ground-loop hum, fixed tonal interference.<br>
**Not for:** broadband noise (use `wiener`/`omlsa`); shifting tones (use spectral methods).


### `dewind`

Takes wind out from under a voice or an instrument and leaves their harmonics. Wind is turbulence at the microphone: noise under a few hundred Hz with no period, in gusts (Nelke & Vary, IWAENC 2014), where a voice's low end is a row of harmonics. A high-pass can only take everything under its cutoff, the voice's low harmonics with the wind; here each STFT bin under `cutoff` is weighed against a wind spectrum read from the frame itself.

The frame is the power of two nearest 85 ms (4096 samples at 44.1 and 48 kHz), so a 100 Hz voice's harmonics stand 8 bins apart with valleys between them. The wind spectrum is the periodogram's morphological opening over 5 bins: every peak narrower than that is cut, and a steady harmonic under a Hann window is 4 bins wide, so the harmonics go and the broad wind stays (the inverse harmonic mask of Nelke, Naylor & Vary, ICASSP 2015, without a pitch track). Over 100 Hz it is held to 4× the least it has been over the last 1.5 s relative to its level under 100 Hz (minimum statistics, Martin 2001): wind keeps its shape while it gusts, and a voice's valleys, onsets and unvoiced sounds don't pass for it. A voiced harmonic whose pitch moves within the frame spreads wider than 5 bins and would pass for floor too (a male voice's fundamental, under 100 Hz, where that cap doesn't reach): under a peak standing 6 dB over the floor, wider than 5 bins and 15 dB over the minima either side of it, the floor is bridged between those minima, in dB. The gain is OM-LSA's form (Cohen & Berdugo 2001): a Wiener gain on the decision-directed a priori SNR, raised to the speech presence probability, which takes a fixed 15 dB prior (Gerkmann & Hendriks 2012) and an a priori absence of 0.2 on a harmonic (a peak 6 dB over the wind), 0.9 elsewhere. So a harmonic keeps what of it stands over the wind, and the wind's own random peaks don't come through as musical noise.

It runs while wind blows: the 20–300 Hz band aperiodic (its normalized autocorrelation, taken through the frame's spectrum over the window's, under ½ at 2.5–25 ms; a harmonic H in noise N reads H / (H + N), Boersma 1993) and its noise over the 300–2000 Hz band, floored 20 dB under its peak over the last seconds, three frames in a row (a 150 ms gap between words shows it); then held 1 s, through the words, whose low end hides it. A bass line, a kick drum's body or a voice's low end repeats; a room's quiet rumble in a pause is no wind next to a voice. With no wind the output equals the input, sample for sample, `frameSize − 1` samples later (85 ms at 48 kHz, the manifest's declared latency).

```js
dewind(data, { fs: 48000 })                     // in place
let write = dewind({ fs: 48000 })               // stream: write(chunk) → the samples done, write() → the rest
```

| Param | Default | |
|---|---|---|
| `cutoff` | `8000` | Hz, the top of the band wind is taken from; read every frame. Most wind lies under 500 Hz, strong wind rushes to several kHz |
| `attenuation` | `-20` | dB, the most a bin is turned down; `0` takes nothing |
| `frameSize` | 85 ms | STFT frame, a power of two; the hop a quarter |

`python scripts/wind.py fetch`, then `node scripts/lowend.js dewind` puts clean speech and music through it, then speech with wind: synthetic (Gaussian noise shaped and gusting as Nelke & Vary measure it), generated (the SC-Wind-Noise-Generator, Mirabilii et al., IWAENC 2022: spectrum and gusts by wind speed) and recorded (twelve CC0 recordings of wind on a microphone, freesound.org), half of the generated and recorded tuning the defaults, half below. VoiceBank+DEMAND test utterances (every fourth: p232 male, p257 female), ten Spoken Wikipedia narrations, the music `repair` uses, 0.3.0 → now; voiced frames thinned: the voiced 10 ms frames, from the first to the last within 20 dB of the take's loudest, whose level under 250 Hz fell by more than 3 dB; their periodic part: whose periodic energy there (r·E, Boersma 1993) did. 0.3.0's figures (male 9.1 %, female 16.2 %) also counted the room tone before and after the words, flagged voiced by its hum, whose rumble going is no thinning:

| | untouched | voiced frames thinned | their periodic part | 20–63 Hz | 63–125 Hz | 125–250 Hz |
|---|---:|---:|---:|---:|---:|---:|
| speech, male | 0% → 0% | 4.8% → 3.2% | 3.0% → 1.4% | −1.7 → −1.3 | −0.5 → −0.2 | −0.1 → 0.0 |
| speech, female | 0% → 0% | 7.9% → 7.9% | 3.0% → 3.0% | −4.5 → −4.5 | −0.7 → −0.7 | 0.0 → 0.0 |
| narrations | 20% → 20% | 5.9% → 4.8% | 5.1% → 4.0% | −0.7 → −0.6 | −0.3 → −0.2 | −0.2 → −0.1 |
| audio-lena | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Vibe Ace (jazz) | 0% → 0% | 1.2% → 1.1% | 0.9% → 0.8% | −0.2 → −0.2 | −0.1 → −0.1 | −0.1 → −0.1 |
| Brahms (strings) | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Nutcracker | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| trumpet | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| bass line | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |

A recording's own low rumble, where it outweighs the mid band in a pause, reads as wind: VoiceBank's room tone before each take engages it for the take's first second, and narrations recorded at home in their pauses. The rumble is noise and goes. Of a voice under it, 0.3.0 thinned mostly a male fundamental moving in pitch, spread wider than the opening under 100 Hz, where the cap doesn't reach; now bridged, its periodic part thins half as often. What still thins: onsets, whose low end an 85 ms frame smears, and, in female takes, frames whose low end under the fundamental is mostly that rumble. Orchestral music, a trumpet and a bass line come back untouched; a jazz track's drums engage it for moments.

Wind at a speech-to-wind ratio of +10, 0 and −10 dB, the error to the clean speech taken away (dB):

| | +10 dB | 0 dB | −10 dB |
|---|---:|---:|---:|
| synthetic | 5.1 → 5.4 | 9.9 → 10.0 | 13.1 → 13.3 |
| generated | 4.4 → 4.8 | 8.3 → 8.4 | 11.3 → 11.4 |
| recorded | 3.8 → 4.1 | 7.5 → 7.6 | 10.2 → 10.3 |

The wind removed and the speech kept, by phase inversion (Hagerman & Olofsson, Acta Acustica 2004: the op on s + n and on s − n, ŝ = (y₊ + y₋)/2, n̂ = (y₊ − y₋)/2), dB:

| | wind removed, +10 dB | 0 dB | −10 dB | speech kept, +10 dB | 0 dB | −10 dB |
|---|---:|---:|---:|---:|---:|---:|
| synthetic | 9.3 → 9.2 | 14.0 → 14.1 | 15.0 → 15.2 | −0.3 → −0.2 | −0.8 → −0.7 | −1.8 → −1.7 |
| generated | 8.8 → 8.6 | 12.4 → 12.3 | 13.3 → 13.4 | −0.4 → −0.3 | −1.2 → −1.1 | −3.0 → −2.9 |
| recorded | 8.0 → 7.8 | 10.8 → 10.8 | 11.4 → 11.5 | −0.4 → −0.3 | −1.1 → −1.0 | −2.1 → −2.1 |

PESQ (wideband), STOI and DNSMOS P.835 of the same outputs, the three winds together (`python scripts/wind.py score DIR/now test`; scored at 16 kHz as `scripts/speech.py` does):

| | PESQ | STOI | SIG | BAK | OVRL |
|---|---:|---:|---:|---:|---:|
| +10 dB: input | 1.76 | 0.939 | 3.51 | 3.36 | 2.89 |
| 0.3.0 | 2.30 | 0.935 | 3.34 | 3.61 | 2.88 |
| now | 2.40 | 0.932 | 3.33 | 3.67 | 2.89 |
| 0 dB: input | 1.21 | 0.874 | 3.25 | 2.44 | 2.31 |
| 0.3.0 | 1.58 | 0.875 | 3.20 | 3.19 | 2.58 |
| now | 1.68 | 0.869 | 3.16 | 3.31 | 2.59 |
| −10 dB: input | 1.06 | 0.754 | 2.06 | 1.43 | 1.43 |
| 0.3.0 | 1.16 | 0.756 | 2.83 | 2.41 | 2.08 |
| now | 1.21 | 0.750 | 2.88 | 2.65 | 2.19 |
| all: input | 1.34 | 0.856 | 2.94 | 2.41 | 2.21 |
| 0.3.0 | 1.68 | 0.855 | 3.12 | 3.07 | 2.51 |
| now | 1.76 | 0.850 | 3.12 | 3.21 | 2.56 |

STOI barely moves: its bands begin at 150 Hz, above most of the wind. Wind on a microphone rushes on above 1.5 kHz, 0.3.0's cutoff, where a voice's consonants and the upper harmonics stand over it: taken up to 8 kHz, it goes 5–11 dB down at 2–4 kHz and 4–9 dB at 4–8 kHz, the speech there 0.1–1.6 dB (on the tuning material); PESQ gains 0.08, BAK 0.14, STOI loses 0.005, from a gain that now moves over the upper bands as well. Clean speech and music lose under 0.07 dB above 1 kHz. In light wind DNSMOS's SIG drops 0.18; an ideal Wiener gain from the wind's own spectrum under 1.5 kHz lost 0.12 there on the tuning material.

The wind goes under the words too, between and under the harmonics; what a voice loses is mostly the harmonics the wind buries (its low end at −10 dB), and onsets.

**Use when:** wind on a microphone under a voice or an instrument, gusting or steady; a recording's low rumble (traffic, a fan) where it outweighs the mid band in the pauses.<br>
**Not for:** a lone thump (`deplosive`), a steady low tone or hum, which has a period (`dehum`, `highpass`), or broadband noise (`omlsa`, `wiener`). Air rushing over the whole band is taken only under `cutoff`. A neural model (`@audio/neural-denoise`'s DeepFilterNet3) takes more of the wind and keeps more of the voice; dewind leaves a sound with no aperiodic low end as it is (music, a voice with no rumble under it), streams at a frame's delay, and needs no model.


### `deplosive`

Takes a close-mic `p` or `b` out: a pressure pulse that rises out of nothing under 80 Hz and has no period, where a voice's or a bass note's low end repeats at its pitch. A pop begins when the 3 ms envelope of the band under 80 Hz jumps over 3× its 30 ms average while standing over `triggerRatio`× the band over 120 Hz (a voice's fundamental and up), and holds while that lasts and the low band stays aperiodic: its normalized autocorrelation's peak at a 2.5–25 ms lag (Talkin 1995) under ½, where a harmonic part would lead (Boersma 1993). The voice band is floored 6 dB under its peak over the last seconds: a room's rumble in a pause is no pop, and a pop reaches the voice's level. Removal takes the sound's own part under `crossover` away, x − w·LP(x), LP linear-phase: a pulse through a causal filter leaves the filter's response to its edges behind (with the pops' spans known, a duck to a causal 2nd-order high-pass at 100 Hz takes a median 12 dB of their error, the linear-phase band at 120 Hz 21). LP runs at ~2 kHz (three box sums decimate, a Kaiser-windowed sinc low-passes, linear interpolation returns), and its half-length is the look-ahead: the output is `latency(fs)` samples late (~14 ms, declared to the host), the duck starts 4 ms before where the pop's low band rose and is held to its end. With no pop the output is the input, sample for sample, that late.

```js
deplosive(data, { fs: 48000 })                  // in place, aligned
let write = deplosive({ fs: 48000 })            // stream: each block back whole, latency(48000) samples late; write() flushes
```

| Param | Default | |
|---|---|---|
| `triggerRatio` | `1` | the band under 80 Hz over the band over 120 Hz that a pop must exceed |
| `attenuation` | `-40` | dB, how far the band under `crossover` goes in a pop |
| `crossover` | `120` | Hz, the band a pop is taken from |
| `attack` | `0.0005` | s |
| `release` | `0.03` | s |

Against iZotope RX 12 De-plosive, `node bench/rx/deplosive.mjs` in [audio](https://github.com/audiojs/audio) (2026-10): VoiceBank clean speech (2 test speakers, 11.4 min), pops added at stop bursts found on it (Liu 1996's +b landmark), six in ten: a one-sided pressure pulse of 20–80 ms rising in 1–4 ms (as the narrations' own pops do), under 200 Hz, 0.3–2× the speech peak. Every setting chosen on 28 training speakers; RX tuned: sensitivity 1, strength 5, frequency limit 125 Hz (defaults 5, 5, 200). The error to the clean speech taken away over each pop and the 100 ms after it; SNR to the clean speech over the reels with pops; on the speech alone, its voiced frames:

| | pops: error taken away, median · 10th pct | with pops: SNR to clean | clean, voiced frames: SNR to input | voiced frames thinned > 3 dB under 250 Hz |
|---|---:|---:|---:|---:|
| RX 12 defaults | 21.8 · 11.1 dB | 19.1 dB | 22.8 dB | 4.9 % |
| RX 12 tuned | 21.9 · 13.4 dB | 22.0 dB | 46.8 dB | 0.0 % |
| 0.2.0 | 5.8 · 0.8 dB | 9.1 dB | 39.9 dB | 0.1 % |
| **0.3.0** | **22.5 · 16.3 dB** | **24.6 dB** | **53.4 dB** | **0.0 %** |

0.2.0 missed one pop in ten (a pop under a word's level never stood 4× over the band above 200 Hz) and took 6 dB of the rest. `node scripts/lowend.js deplosive` puts clean speech and music through it, then speech with pops (half-sine pressure pulses of 20–60 ms under 150 Hz before each word that follows a pause): VoiceBank+DEMAND test utterances, Spoken Wikipedia narrations, the music `repair` uses, 0.2.0 → 0.3.0; voiced frames thinned: the voiced 10 ms frames whose level under 250 Hz fell by more than 3 dB:

| | voiced frames thinned | 20–63 Hz | 63–125 Hz | 125–250 Hz |
|---|---:|---:|---:|---:|
| speech, male | 0.7% → 0.2% | −0.1 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| speech, female | 2.2% → 0.7% | −0.2 → −0.1 | 0.0 → 0.0 | 0.0 → 0.0 |
| narrations | 0.0% → 0.1% | −0.2 → −0.2 | 0.0 → 0.0 | 0.0 → 0.0 |
| audio-lena | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Vibe Ace (jazz) | 0.4% → 1.6% | 0.0 → −0.1 | 0.0 → −0.2 | 0.0 → −0.1 |
| Brahms (strings) | 0.1% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Nutcracker | 0.1% → 0.1% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| trumpet | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| bass line | 0.0% → 0.0% | −0.1 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |

Pops peaking at 0.5, 1 and 2× the utterance's peak, the error to the clean speech taken away over each pop and the 150 ms after it (dB):

| | 0.5× | 1× | 2× |
|---|---:|---:|---:|
| speech, male | 11.0 → 23.3 | 13.2 → 28.1 | 14.5 → 31.3 |
| speech, female | 12.6 → 25.8 | 14.2 → 30.6 | 15.0 → 33.6 |

**Use when:** mic plosives (`p`, `b`, `t`) producing low-frequency thuds.<br>
**Not for:** a kick drum: it is a pop to this (a jazz mix loses 3 dB under 250 Hz on 1.6 % of its frames, 0.2.0: 0.4 %); a live path that cannot wait 14 ms.


### `deesser`

Sibilance reduction, [`@audio/dynamics-deesser`](https://github.com/audiojs/dynamics) `mode: 'band'` behind this family's seconds-based options (2026-07 near-dupe merge). An 's' is told by its shape, not its level: the sibilance band at `fc` is measured against the voice body under `fc / 2`, in dB, and how far it rises over `threshold` sets a peaking cut at `fc`, held within `range`.

```js
deesser(data, { fs })                                          // the kernel's threshold (0 dB) and range (−6 dB)
deesser(data, { fs, fc: 7500, threshold: -3, range: -8 })      // softer esses too, deeper
```

| Param | Default | |
|---|---|---|
| `fc` | `6000` | Sibilance centre (Hz; `freq` still accepted) |
| `threshold` | kernel's (`0`) | dB of the sibilance band over the voice body where the cut starts; not a level |
| `range` | kernel's (`-6`) | dB, the deepest cut |
| `ratio` | `4` | Compression ratio above threshold |
| `attack` | `0.001` | s — how fast the cut engages |
| `release` | `0.05` | s — how slowly it recovers |
| `Q` | `1.4` | Peaking EQ Q |
| `block` | `64` | Coefficient update interval (samples) |

`threshold` was a level, −30 dBFS here; under the kernel's 0.3 it is the band over the body, and −30 cut a ride cymbal 12 dB under a mix by a median 2.7 dB.

**Use when:** voice post-production with hot s/sh; vocal bus de-essing.


## Broadband & spectral

### `specsub`

Power spectral subtraction with over-subtraction and a spectral floor (Berouti, Schwartz & Makhoul 1979): |Ŝ|² = |Y|² − α·N̂ where that stays above β·N̂, else β·N̂. Over-subtraction takes out the noise's peaks that plain subtraction leaves as musical tones; the floor, a fraction of the noise estimate, fills the valleys with a steady bed that masks what is left. α follows the frame's SNR (4 − 3/20·SNR: 4.75 at −5 dB down to 1 at 20 dB) unless fixed. The noise PSD is tracked by minimum statistics (Martin 2001) over a 1.5 s window, in batch and stream alike, unless a profile or a noise-only stretch is given; a held note, a sustained vowel or a chord is kept out of it (@audio/noise-estimate's `partials`, as [`omlsa`](https://github.com/audiojs/denoise#omlsa) has it: clean music cut by more than 3 dB 10.3 → 3.2 %, sung long tones 36.9 → 0.0 %, Slakh mixes 13.1 → 0.8 %; `estimator: { partials: false }` turns it off). `processor(opts)` is the gain as an @audio/stft frame process, for a host running its own frames.

```js
specsub(data, { fs })                                          // α(SNR), β 0.05, noise tracked
specsub(data, { fs, alpha: 2 })                                // fixed over-subtraction
specsub(data, { fs, noiseFrames: 6 })                          // noise from the first 6 frames
```

| Param | Default | |
|---|---|---|
| `alpha` | α(SNR) | Fixed over-subtraction factor; omitted (or 0): Berouti's α(SNR) |
| `beta` | `0.05` | Spectral floor, a fraction of the noise estimate: higher leaves less musical noise and more noise |
| `frameSize` | power of two nearest 32 ms | STFT frame: 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48 (`frame(fs)`) |
| `hopSize` | `frameSize/4` | OLA hop |
| `profile` | tracked | Noise PSD (`Float64Array`, `frameSize/2+1` bins) |
| `estimator` | | Minimum statistics options (@audio/noise-estimate `minStats`); `{ partials: false }`: held notes learned as noise, as before |
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to average for the profile |

**Use when:** quick baseline; offline cleanup with a known noise-only preamble.<br>
**Not for:** musical-noise-sensitive material — use `wiener` or `omlsa`.


### `wiener`

MMSE log-spectral amplitude (Ephraim & Malah 1985) or Wiener (Scalart & Filho 1996) gain on the decision-directed a priori SNR ξ = α·Â²(l−1)/λ(l−1) + (1−α)·max(γ−1, 0) (Ephraim & Malah 1984, eq. 51). α = 0.98 is theirs for an 8 ms frame step (§VI: 256 samples at 8 kHz, a new frame every 64) and is rescaled to the actual step as α<sup>Δt/8 ms</sup>, so the a priori SNR's memory holds in seconds; applied per frame until 0.3, it ran 1.8× longer at 48 kHz (10.7 ms steps) than at 44.1 kHz (5.8 ms). The floor ξ<sub>min</sub> stays −15 dB: −25 dB, Cohen's and Loizou's, left more musical noise on steady white and pink noise (log kurtosis ratio 0.98 and 1.49, against 0.53 and 1.01) and cost PESQ and SIG on the training speech (`scripts/speech.mjs`). The noise PSD λ is tracked by minimum statistics (Martin 2001) over a 1.5 s window, in batch and stream alike, unless a profile or a noise-only stretch is given; a held note, a sustained vowel or a chord is kept out of it (@audio/noise-estimate's `partials`, as [`omlsa`](https://github.com/audiojs/denoise#omlsa) has it: clean music cut by more than 3 dB 14.5 → 3.4 %, sung long tones 36.3 → 0.0 %, Slakh mixes 26.6 → 3.3 %; `estimator: { partials: false }` turns it off). `processor(opts)` is the gain as an @audio/stft frame process, for a host running its own frames.

```js
wiener(data, { fs })                                           // LSA gain, noise tracked
wiener(data, { fs, rule: 'wiener' })                           // Wiener gain
wiener(data, { fs, noiseFrames: 6 })                           // noise from the first 6 frames
```

| Param | Default | |
|---|---|---|
| `rule` | `'mmse-lsa'` | `'wiener'` or `'mmse-lsa'` (log-spectral, less musical noise) |
| `alpha` | `0.98` | Decision-directed smoothing per 8 ms of frame step, rescaled to the actual step (alias of `alphaDD`) |
| `xiMin` | `10^−1.5` | A priori SNR floor (−15 dB) |
| `frameSize` | power of two nearest 32 ms | STFT frame: 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48 (`frame(fs)`) |
| `hopSize` | `frameSize/4` | OLA hop |
| `profile` | tracked | Noise PSD (`Float64Array`, `frameSize/2+1` bins) |
| `estimator` | | Minimum statistics options (@audio/noise-estimate `minStats`); `{ partials: false }`: held notes learned as noise, as before |
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to average for the profile |

**Use when:** transparent broadband denoise; the "safe default" for stationary noise.


### `omlsa`

Optimally-Modified Log-Spectral Amplitude estimator (Cohen & Berdugo 2001) with IMCRA noise estimation (Cohen 2003). The log-spectral amplitude gain when speech is present, weighed against a floor by the speech presence probability p: `G = max(G_H1, G_min)^p · G_min^(1−p)` (eq. 16 with G<sub>H1</sub> floored at G<sub>min</sub>: as written it took a bin below G<sub>min</sub> wherever G<sub>H1</sub> was under it, to −18 dB at G<sub>min</sub> −12, so `gMin` was not the floor). The a priori SNR is decision-directed on G<sub>H1</sub> (eq. 18), the a priori speech absence is estimated from the spread of an a priori SNR over time and neighbouring bins (§4), the noise spectrum comes from IMCRA. As Cohen's own `omlsa.m`, a bin whose speech absence reaches 0.9 counts as noise: noise that happens to peak keeps G<sub>min</sub> and leaves no musical tone, so what remains of the noise is the noise, G<sub>min</sub> quieter. Time constants, the decision-directed α among them, are set for 8 ms frames and rescaled to the actual frame step (`omlsa.m` rescales by the reciprocal, which lengthens them at 48 kHz).

α sets how soon ξ follows a word's start after a pause, and how much gain a noise peak gets. Until 0.3 it was 0.98 per frame, whatever the frame (0.985 per 8 ms at 48 kHz, 0.972 at 44.1), and a word's second and third frames after a pause lost 10 and 5 dB. It is now the lowest value per 8 ms that leaves steady white and pink noise without musical noise: 0.97 tracking the noise (log kurtosis ratio 0.00 at G<sub>min</sub> −15 and −25 dB; 0.96 left 1.16 and 0.49 at −25, the paper's 0.92 0.99 and 1.81 at −15), 0.95 on a learned noise (`omlsa.m`'s; 0.92 left 0.19 and 0.42). The paper's cap q ≤ q<sub>max</sub> = 0.95 (Table 1) in place of the gate kept a word's second frame after a pause another 3 dB but left musical noise on steady noise (0.24 and 0.46 at α 0.97), so the gate stays. The table under [Speech](#speech) has what each keeps. `scripts/reference.py` holds a numpy version written from the papers; on 16 kHz VoiceBank frames it gives `omlsa.m`'s noise track, speech absence and gains to the last bit (but for near-empty bins, where `omlsa.m`'s absolute 1e-10 floors bind), and test.js holds this code to it.

The a priori SNR the speech absence is read from is smoothed in the cepstrum (Breithaupt, Gerkmann & Martin 2008): the speech power's maximum-likelihood estimate λ·max(γ−1, ξ<sub>ml,min</sub>), its cepstrum smoothed over time per quefrency, hardly where speech lives (the envelope's low quefrencies, the pitch's peak), much where a lone noise peak lives, and back. The decision-directed ξ (Cohen's, `qFrom: 'dd'`) lags a word's start after a pause, and takes a short burst of noise the tracker cannot follow for speech; the cepstral one follows a word's envelope at once and smooths a lone spectral peak away. Its constants are Table 1's, per 16 ms of frame step, but under 1.25 ms of quefrency Gerkmann & Hendriks's (ICASSP 2012: 0 and 0.2, where the 2008 paper's 0.5 and 0.7 lag an onset as the decision-directed ξ does) and above it 0.9: the least that leaves steady white and pink noise on a learned noise free of musical noise (0.85 left 0.22 on pink). On the training speech, tracked: PESQ 1.823 → 1.825, STOI 0.832 → 0.834, OVRL 2.525 → 2.543, BAK 3.00 → 3.04, musical noise 0.82 → 0.80; 40 ms tone bursts in steady noise pass at −6.5 dB (were −2.6). The cepstral ξ as the gain's own ξ as well lost voiced speech where the pitch glides (SIG −0.04), so the gain keeps the decision-directed one.

A held note, a sustained vowel or a chord is not learned as the noise. IMCRA, as minimum statistics, takes whatever holds a bin for about a second as noise: clean music through `omlsa` lost 9.9 % of its time-frequency energy by more than 3 dB, a sung long tone 8.8 %, a synthesized band 22.6 %. @audio/noise-estimate's `partials` reads, each frame, where a partial stands, a peak over the spectrum's morphological floor (the inverse harmonic mask of Nelke, Naylor & Vary, ICASSP 2015) held 0.3 s within ±1 bin and 10 dB over what its bin held while free, and there holds the noise at that memory; elsewhere, and on noise alone, the tracker's estimate is as it was, to the bit. A line steady from the take's start (hum, a fan, an engine) has no free frame and stays noise; one that starts mid-take is held up to 60 s, then learned, as is a note held longer; a note sounding from the first frame is learned until its bin is once free of it. Music cut 9.9 → 3.0 %, sung long tones 8.8 → 0.0 %, Slakh mixes 22.6 → 2.3 %; on the training speech PESQ 1.825 → 1.823, OVRL 2.543 → 2.542, musical noise 0.80 → 0.81 ([Speech](#speech) has the test set). `estimator: { partials: false }` turns it off.

A noise that holds still can be learned instead: `profile`, the noise's PSD (`noiseProfile` of a stretch where it plays alone), or, in the batch form, `noiseFrames`/`profileFrom`/`profileTo` naming that stretch. The noise is then held (`known` of @audio/noise-estimate), and p reads the observation: γ averaged over 105.5 Hz and over 543 Hz of the frame, at fixed priors (Gerkmann, Breithaupt & Martin 2008: the averaged γ is χ² with r degrees of freedom from the Hann window's correlation across bins, ξ<sub>fix</sub> the a priori SNR that minimizes false alarms plus misses, eq. 13; at 48 kHz r 5.7 and 24, ξ<sub>fix</sub> 9.4 and 5.1 dB), and 0 where the estimated q reaches 0.9, as before. Until 0.4 it read γ in each bin alone, at ξ<sub>H1</sub> = 15 dB (Gerkmann & Hendriks 2012), and speech 0–5 dB over the noise lost 7.8 dB on the training speech, where the MMSE Wiener gain keeps 3.9. The paper averages over 64 ms of frames as well; presence then outlasted a sound by those frames, and in the half second after music stopped the noise came through in tones (log kurtosis ratio 0.45 at G<sub>min</sub> −12 dB, 1.77 at −20): over the frame alone. On the training speech, G<sub>min</sub> −12 dB: PESQ 1.861 → 1.867, OVRL 2.564 → 2.572, BAK 3.05 → 3.08, musical noise 0.53 → 0.46, speech 0–5 dB over the noise −7.8 → −5.1 dB, the noise taken in pauses 9.7 → 10.1 dB. Steady noise under speech and music goes exactly G<sub>min</sub> down, with no musical noise from −12 to −20 dB (log kurtosis ratio 0.00); in the half second after music stops, 0.04 at −12 dB and 0.40 at −20 (0.5: 0.05 and 0.61, 0.3: 0.11 and 1.00; `scripts/broadband.mjs`). Held, the frame is the power of two at or above 32 ms (`frame(fs, true)`; a `profile` without a `frameSize` brings its own, 2(K − 1) for K bins): 2048 at 44.1 kHz as at 48, where the nearest power of two, the tracked frame, left 1024 and 43 Hz bins, half the resolution 48 kHz gets. Nothing is tracked on a held noise, so the frame's length goes to frequency, and a partial under the noise is parted from it. 0.5 → 0.6, music under steady noise at 44.1 kHz (audio's `bench/rx/denoise.mjs`: ten MUSDB18 test mixtures, strings and jazz, under white, pink and two DEMAND noises 10 and 25 dB down, 96 takes): SDR 20.16 → 20.94 dB, noise-to-mask ratio −9.6 → −10.0 dB, music cut by more than 3 dB 2.2 → 1.3 %, above 8 kHz −2.8 → −2.6 dB, musical noise under the music 0.44 → 0.38; VoiceBank training speech at 44.1 kHz, its lead-in learned: PESQ 1.875 → 1.872, STOI 0.830 → 0.835, OVRL 2.549 → 2.574. Tracking, the shorter frame stays: 2048 at 44.1 kHz cost that speech PESQ 0.053 and BAK 0.08. Tracking the noise from the print (Gerkmann & Hendriks 2012's MMSE tracker started on it, RX's "adaptive") lost OVRL 0.04 and left musical noise (0.40 on pink): the print is held. `processor(opts)` is the gain as an @audio/stft frame process, for a host running its own frames: audio's `denoise` op learns a print from a range and runs it so.

```js
omlsa(data, { fs })
omlsa(data, { fs, gMin: -10 })                                 // gentler: more room tone left
omlsa(data, { fs, profileFrom: 0, profileTo: fs / 2, gMin: -12 })   // the noise learned from the first half second
```

| Param | Default | |
|---|---|---|
| `gMin` | `-15` | dB: what noise-only bins keep, the floor (alias `gMinDb`) |
| `alpha` | `0.97`; `0.95` with a `profile` | Decision-directed smoothing per 8 ms of frame step, rescaled to the actual step (alias of `alphaDD`) |
| `xiMin` | `10^−2.5` | A priori SNR floor (−25 dB) |
| `qPrior` | estimated | A fixed a priori speech absence instead of the estimate |
| `qFrom` | `'cts'` | The a priori SNR the speech absence is read from: smoothed in the cepstrum, or `'dd'`, decision-directed (Cohen's `omlsa.m`) |
| `frameSize` | by the rate | Tracking, the power of two nearest 32 ms: 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48 (`frame(fs)`); on a held noise, at or above 32 ms: 512 at 16 kHz, 1024 at 22.05, 2048 at 44.1 and 48 (`frame(fs, true)`) |
| `hopSize` | `frameSize/4` | |
| `profile` | tracked | A known noise PSD (`frameSize/2+1` bins), held |
| `threshold` | `0` | dB: the noise read that much louder (RX's Threshold), a held profile raised, the tracked estimate's β multiplied: more of what is quiet counts as noise |
| `estimator` | | IMCRA options (@audio/noise-estimate `imcra`); `{ partials: false }`: held notes learned as noise, as before 0.5 |
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to learn the profile from (batch) |

Against iZotope RX 12's Voice De-noise and Spectral De-noise on the same speech, narrations and music: [Speech](#speech).

**Use when:** speech in non-stationary noise (street, café, car); generally the highest-quality choice for noisy speech. A steady noise with a stretch of it alone (hiss, hum, a fan, room tone): learn it, `profile`.


## Impulses

### `declick`

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

0.3.0 (a gap over the onset ±0.1 ms or over all of the error's span, nothing between; the click under it white), measured the same way: ticks 23.9, 31.0 and 39.5 dB; pops 18.5, 27.1, 34.5; glitches 29.2, 37.9, 48.7; spikes 21.3, 24.2, 41.3; mouth clicks 20.4, 24.5, 31.4; dropouts 7.1. 0.2.0 (a gap as far as the AR(32) error showed the click, least squares; over the click and 1 ms either side): ticks 13.4, 17.5 and 25.4 dB; pops 5.7, 12.9, 18.2; glitches 15.5, 20.5, 29.4; mouth clicks 9.3, 17.8, 25.6. The clean material through it: untouched (0.3.0 changed 112 samples of "Vibe Ace", to −62 dB; 0.1.7 2295, 123 and 2283 of the speech, Brahms and the trumpet); `adeclick` changes 7 116–22 978 samples of each, to −27 to −49 dB. Each click's surroundings (3–20 ms either side) given as `regions`: the same within 1.3 dB; regions over the clean material change nothing. Tuned on other material (VoiceBank+DEMAND training takes, two other narrations, other parts of "Vibe Ace" and Brahms, the Nutcracker). Clicked sound takes 1.25× 0.3.0's time, run side by side (10 s with three clicks a second), clean sound as long.

Against iZotope RX 12 Advanced, De-click and Mouth De-click (VST3 hosted by Pedalboard; [`audio`](https://github.com/audiojs/audio)'s `bench/rx/declick.mjs`, October 2026), through `audio`'s `declick()`, on other takes: 12 s of VoiceBank+DEMAND's clean test utterances, two Spoken Wikipedia narrations, "Vibe Ace" and Brahms (5–15 s) and the trumpet. RX at its defaults, and at its best per kind on separate takes (VoiceBank+DEMAND training utterances, two other narrations, other passages, the Nutcracker) from algorithm × sensitivity × click widening, Mouth De-click from sensitivity, then frequency skew. Median dB gone as above, speech at 2 / 5 / 15× · music:

| click | RX, defaults | RX, best on other takes | `declick` 0.3.0 | `declick` |
|---|---|---|---|---|
| tick | 7.2 / 14.6 / 20.2 · 10.3 / 13.3 / 19.2 | 11.7 / 14.8 / 18.6 · 13.9 / 16.2 / 19.1 (Multi-band random, 3) | 20.5 / 28.8 / 34.7 · 26.0 / 30.0 / 40.3 | 23.1 / 31.4 / 37.6 · 28.1 / 32.7 / 41.2 |
| pop | 0.0 / 1.0 / 3.8 · 0.0 / 2.4 / 5.5 | 5.0 / 8.9 / 15.5 · 6.8 / 12.9 / 19.0 (Multi-band random, 7) | 12.9 / 25.5 / 35.5 · 16.8 / 24.6 / 34.3 | 13.8 / 26.6 / 37.4 · 18.4 / 26.4 / 35.5 |
| glitch | 10.9 / 15.7 / 30.0 · 10.9 / 20.2 / 27.2 | 11.1 / 17.1 / 30.1 · 9.9 / 20.4 / 28.3 (Single-band, 1.5) | 21.8 / 33.3 / 44.4 · 30.3 / 40.1 / 49.1 | 30.8 / 40.5 / 51.9 · 37.8 / 45.8 / 56.6 |
| spike | 10.0 / 13.3 / 25.7 · 7.7 / 17.2 / 27.1 | 11.3 / 15.1 / 26.1 · 9.7 / 17.8 / 27.1 (Single-band, 1.5) | 17.0 / 21.2 / 28.4 · 21.6 / 31.9 / 38.9 | 22.8 / 30.1 / 42.7 · 27.0 / 39.0 / 46.5 |
| dropout | 0.0 · 0.0 | 1.3 · 4.2 (Multi-band random, 7) | 3.0 · 7.9 | 6.3 · 15.4 |
| mouth, speech at 1 / 2 / 5× | Mouth De-click 9.6 / 16.0 / 20.5 | 11.0 / 16.7 / 21.2 (sensitivity 4, skew 5) | 13.5 / 16.4 / 21.8 | 13.4 / 18.1 / 23.6 |

The share of mouth clicks gone by 10 dB or more: 65, 83 and 92%, Mouth De-click's 45, 78 and 83% at its defaults, 53, 82 and 87% at its best. Do no harm: on the clicked takes, the error left outside the clicks' spans is 35–43 dB under the sound, RX's 22–29 dB at its defaults and 21–37 at its best. The clean takes through each (samples moved over 2⁻¹⁵ · error under the sound): `declick` VoiceBank 0.5% · −38 dB, the narrations 0.03% · −43 and 0.3% · −43, the music untouched (0.3.0: 0.7% · −36, 0.2% · −36, 1.1% · −27, "Vibe Ace" −62); RX De-click at its defaults 1.1% · −28, 0.1% · −40, 0.3% · −29, the music 0.009–1.9%, the trumpet to −13; Mouth De-click 5.1% · −34, 0.4% · −44, 5.1% · −26 (at its best 5.0% · −35, 0.4% · −45, 5.0% · −27); Single-band at sensitivity 1.5, RX's least, 0.3% · −38, 0.03% · −45, 0.06% · −42, the trumpet to −28. On four real narrations (30 s each, with their own mouth clicks), `declick` changes 27.5 places a minute (0.3.0: 49.5), Mouth De-click 75 and De-click 81; RX De-click changes 65% of `declick`'s places too. Each click selected, 3–20 ms either side (`declick({ at, duration })` a click): ticks 22.5 / 30.1 / 37.4 · 28.1 / 32.7 / 41.2 dB, glitches 30.0 / 36.8 / 50.2 · 37.0 / 45.8 / 55.9, mouth clicks 13.3 / 17.7 / 23.6, within 3.7 dB of the whole take and over RX's on the whole take in every condition.


**Use when:** vinyl ticks, edit clicks, digital glitches, mouth clicks on a voice; a click seen on a spectrogram, given as a region.<br>
**Not for:** dense crackle (use `decrackle`); long dropouts (use `repair`).


### `decrackle`

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

Against iZotope RX 12 Advanced De-crackle (VST3 hosted by Pedalboard; [`audio`](https://github.com/audiojs/audio)'s `bench/rx/decrackle.mjs`, October 2026), through `audio`'s `decrackle()` on other takes (12 s of VoiceBank+DEMAND's clean test utterances, two Spoken Wikipedia narrations, "Vibe Ace" and Brahms 5–15 s, the trumpet), the same crackle: RX at its defaults (quality Low, strength 5) and at its best for each size on separate takes (quality × strength, then amplitude skew): small Medium, 3; medium High, 9.5; loud Medium, 9.5, skew 5. SDR out, dB, speech at 50 / 200 / 1000 a second · music:

| crackle | in | RX, defaults | RX, best for the size | `decrackle` |
|---|---|---|---|---|
| small | 38.7 / 32.9 / 26.0 · 38.9 / 32.8 / 25.7 | 30.7 / 29.5 / 25.6 · 40.5 / 35.0 / 27.1 | 38.1 / 33.2 / 26.2 · 40.7 / 34.1 / 26.2 | 42.3 / 38.6 / 31.7 · 45.3 / 39.5 / 32.1 |
| medium | 27.1 / 20.9 / 14.0 · 26.7 / 20.8 / 13.7 | 28.1 / 24.0 / 16.2 · 31.2 / 25.1 / 15.9 | 22.6 / 21.0 / 17.7 · 31.3 / 26.1 / 18.9 | 38.4 / 33.1 / 24.0 · 39.3 / 33.5 / 24.2 |
| loud | 14.8 / 8.9 / 1.9 · 14.8 / 8.6 / 1.7 | 22.1 / 15.9 / 5.4 · 22.4 / 15.0 / 4.8 | 19.4 / 15.5 / 10.1 · 22.7 / 17.2 / 11.4 | 32.1 / 25.5 / 16.7 · 32.7 / 25.4 / 16.2 |

RX at its defaults makes small crackle on speech worse (38.7 → 30.7 dB at 50 a second). The clean takes through each (samples moved over 2⁻¹⁵ · error under the sound): `decrackle` 0.07–2.3% · −37 to −66 dB; RX at its defaults 3.7–48% · −25 to −52; at its best for medium and loud crackle 4–75% · −15 to −59; at its best for small crackle, its gentlest, 0.3–10.3% · −36 to −67, more samples than `decrackle` on five of the six takes but less error on four (VoiceBank −46 against −42, the narrations −51 against −50, "Vibe Ace" −58 against −50, the trumpet −67 against −49): what `decrackle` takes for crackle in clean sound it softens 0.6 ms around, each sample moved further.

**Use when:** shellac / 78 RPM crackle; a worn LP's surface noise; dense small ticks under music or speech.<br>
**Not for:** loud isolated clicks and pops (use `declick`); long dropouts (use `repair`).


### `declip`

Finds where a sound was cut and rebuilds what the cut took off. A hard clip piles every sample it cuts onto one level, its rail. Each side's rail is the sound's extreme there, taken when the samples within 0.1 % of it outnumber those in the next 0.1 % below tenfold and most of them sit in runs: the top-bin test of FFmpeg's `adeclip` (1000 bins, ratio 10), made relative to the rail so it holds at any level (and never finer than one step of a 16- or 24-bit grid), and per side, so one rail or two different ones are found. A loud peak is one sample; a limiter's ceiling is touched by single samples or by arches, and a sine's top is an arch, which fill the band below about as densely.

Lossy coding (MP3, AAC, Opus) leaves no flat top: it spreads the rail into a band, the coder's noise around the level the runs were cut at, a mode of the amplitude density with mass on both sides of it. A waveform's own peaks, a sine's top, a limiter's ceiling, only approach a level from below. So, where no side has a flat rail, each side's band is its highest mode standing 4 times over the density 2–6 % of the extreme below it (at 1, 2 and 4 times that scale, for coarser coders), with samples over it reaching 3 of its spreads σ (the RMS of the samples over the mode) and beyond; the sound is cut again 6σ under the mode and rebuilt as a clip there (κ = 6 chosen on VoiceBank and MUSDB18 training material through LAME at 128 kbit/s: 0.6 dB over 4 on average, speech +0.9, music −0.1; 5 and 8 within 0.2 on speech). Sound with no rail and no band comes back bit-exact: none of VoiceBank+DEMAND's 1328 clean utterances, MUSDB18's 144 mixtures, the survey's ten SQAM excerpts or sines from 50 Hz to 5 kHz shows one.

Every sample at a rail is then rebuilt three times, each rebuild held at least as far out as the sample was recorded (a clip only ever lowers a sample). AR: per window of 186 ms, AR(256) fitted under its taper, every unknown solved at once by exact least squares ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arFill`), refitted and solved again until the fill moves by under 1 %, at most 8 times (Janssen, Veldhuis & Vries 1986). Sparse: A-SPADE (Kitić, Bertin & Gribonval 2015) as the declipping survey's code runs it (Záviška, Rajmic, Ozerov & Rencker 2021), the fewest DFT lines that agree with what was recorded, per block of 93 ms and per block of 186 ms: the long block resolves a held note's partials (a held chord clipped to 1 dB, half a second: 11.6 → 14.2 dB), the short one follows speech and attacks. No one of the three wins everywhere, so they are blended, region by region, by weights chosen by cross-validation (Stone 1974; stacked regressions, Breiman 1996): the clipped sound is clipped once more, at the level that takes as large a share of what the first clip left as the first took of the whole; each method rebuilds that; the weights, on a grid of tenths over the three, are those whose blend lies nearest what is known there (the samples the second clip hid, and the bounds of those the first took), read per 93 ms over ±1 s. A blend of consistent rebuilds is consistent; each rebuild runs only where its weight is not 0. Samples off the rails come back bit-exact; a sound over 30 s is rebuilt in pieces crossfaded over 2 s.

```js
declip(data, { fs: 44100 })                                    // each side's rail (or band) found; none: untouched
declip(data, { fs: 44100, clipLevel: 0.95 })                   // a known rail, ±0.95; soft saturation: the level to cut at
```

| Param | Default | |
|---|---|---|
| `clipLevel` | auto | the rail, ± this; omitted or 0: found per side |
| `order` | `256` | AR order of the AR rebuild; `512` takes it on dense music up to 2 dB closer, in about 3× the time |
| `fs` | `44100` | sample rate, Hz |

`node scripts/declip.js` clips speech (audio-lena) and music ("Vibe Ace", Brahms, the trumpet loop, as `repair`), 6 s of each, peak-normalized and cut at the level that leaves the clipped sound 1–20 dB from the original (the input SDR of the declipping survey), and measures the SDR after, dB, declip (finding the rails itself) · FFmpeg `adeclip` at its defaults:

| input SDR | 1 dB | 3 dB | 7 dB | 10 dB | 15 dB | 20 dB |
|---|---:|---:|---:|---:|---:|---:|
| speech | 8.5 · 1.1 | 10.9 · 5.0 | 24.1 · 12.1 | 31.7 · 16.9 | 38.2 · 24.0 | 42.8 · 30.5 |
| "Vibe Ace" | 8.4 · 1.6 | 13.8 · 5.0 | 19.7 · 10.3 | 24.4 · 14.0 | 31.4 · 19.9 | 36.3 · 24.6 |
| Brahms | 7.2 · 0.6 | 13.4 · 3.9 | 19.3 · 10.2 | 23.1 · 14.4 | 29.2 · 19.8 | 35.9 · 23.8 |
| trumpet | 6.6 · 1.3 | 16.7 · 4.1 | 31.4 · 10.4 | 42.8 · 14.8 | 46.2 · 21.4 | 59.7 · 25.0 |

0.3.0 (the AR rebuild and the 93 ms sparse one), 1–20 dB: speech 8.4 / 10.9 / 24.2 / 31.9 / 38.3 / 42.6, "Vibe Ace" 6.9 / 13.1 / 19.1 / 22.7 / 31.4 / 36.2, Brahms 6.9 / 12.7 / 18.9 / 22.8 / 29.2 / 35.8, the trumpet 6.1 / 16.8 / 31.4 / 44.7 / 46.5 / 60.3: the long blocks gain up to 1.7 dB on the music, the trumpet at 10 dB loses 1.9. On the survey's own test, its ten SQAM excerpts (solo instruments and an ensemble, 44.1 kHz) clipped by its `clip_sdr.m`, mean ΔSDR over the clipped samples, dB, and PEAQ's ODG (Kabal's implementation as the survey ran it, ported in [audio](https://github.com/audiojs/audio)'s `bench/rx/peaq.py`: the survey's grades of its clipped inputs to within 0.0015), beside the means it publishes for its leading methods (code and results: [declipping2020_codes](https://github.com/rajmic/declipping2020_codes); PEAQ with the reliable samples replaced, as declip keeps them):

| input SDR | 1 dB | 3 dB | 5 dB | 7 dB | 10 dB | 15 dB | 20 dB | mean ΔSDR | mean ODG |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| declip | 9.7 | 14.0 | 15.6 | 16.7 | 18.5 | 20.5 | 22.1 | 16.7 | −1.84 |
| declip 0.3.0 | 8.3 | 13.2 | 14.8 | 15.8 | 17.6 | 19.7 | 21.9 | 15.9 | −1.95 |
| social sparsity, PEW (Siedenburg, Kowalski & Dörfler 2014) | 12.2 | 15.0 | 16.6 | 17.7 | 19.0 | 21.2 | 22.2 | 17.7 | −1.60 |
| A-SPADE | 11.9 | 13.9 | 15.1 | 16.0 | 17.3 | 19.4 | 20.3 | 16.3 | −2.40 |
| S-SPADE | 11.4 | 13.7 | 15.0 | 15.6 | 17.1 | 19.3 | 19.9 | 16.0 | −2.59 |
| ℓ1, parabola-weighted | 9.9 | 13.0 | 14.8 | 16.0 | 17.4 | 19.6 | 21.0 | 16.0 | −1.66 |
| NMF (Bilen, Ozerov & Pérez 2018) | 5.1 | 12.2 | 14.3 | 16.2 | 18.0 | 20.6 | 22.0 | 15.5 | −1.46 |
| Janssen (AR) | −0.9 | −1.3 | 0.6 | 3.5 | 7.9 | 17.0 | 19.6 | 6.6 | −2.28 |
| iZotope RX 12 De-clip, tuned (below) | 0.8 | 5.4 | 8.2 | 9.7 | 11.5 | 14.0 | 15.8 | 9.4 | −2.26 |

On the mean ΔSDR 2nd of the 7 (0.3.0: 5th), 1.0 dB behind social sparsity; from 3 dB up ahead of both SPADEs and ℓ1 at every level, of NMF but at 15 dB (0.1), behind social sparsity by 0.15–1.05 dB; at 1 dB behind A-SPADE by 2.2 and social sparsity by 2.5. On ODG 4th, behind NMF, social sparsity and ℓ1 by 0.18–0.38, at 3–7 dB by up to 0.7. The blend misjudges some held tones: the clarinet clipped to 15 dB comes back 17.1 dB, its 186 ms sparse rebuild alone 22.1 (the second clip scores a fill's overshoot inside the first clip's runs as nothing, only its bound being known there). On VoiceBank speech (below) it is 0.3.0 within 0.1 dB at every level.

Against iZotope RX 12 Advanced De-clip (VST3 hosted by Pedalboard, output aligned to the input; [audio](https://github.com/audiojs/audio)'s `bench/rx/declip.mjs`, 2026-10), through `audio`'s `declip()`. Test: the ten SQAM excerpts; "other music", four MUSDB18 test mixtures and "Vibe Ace", Brahms, the trumpet and the Sugar Plum Fairy (6 s each); speech, 16 VoiceBank clean test utterances. Each clipped at the level leaving it 1–20 dB from the original and scaled so its rails sit at 0 dBFS; asym: the positive rail at the 15 dB level, the negative at the 7 dB level; down: the 7 dB clip turned down 6 dB; MP3: the 7 dB clip through LAME at 128 kbit/s; soft: tanh(g·x), g giving 10 dB (analog saturation, no rail). RX at its defaults (threshold −1.02 dBFS, quality Low, post-limiter on), and tuned per condition and kind on other material (four MUSDB18 training mixtures, ten VoiceBank training utterances): asymmetric thresholds at each side's peak plus an offset (−0.07 to −6 dB) × quality, post-limiter off; its best: −0.07 dB on flat rails (High; Low or Medium on some speech conditions), High at −2 dB on MP3, −2 (music) and −4 (speech) on soft. Mean ΔSDR, dB, RX default · RX tuned · declip:

| condition | SQAM | other music | speech |
|---|---:|---:|---:|
| 1 dB | −0.8 · 0.8 · 9.7 | −0.8 · −0.6 · 6.2 | −0.8 · −0.4 · 5.8 |
| 3 dB | −1.4 · 5.4 · 14.0 | −1.6 · 1.5 · 10.4 | −1.5 · 2.3 · 8.7 |
| 5 dB | −1.9 · 8.2 · 15.6 | −2.2 · 3.5 · 12.0 | −2.1 · 4.7 · 10.0 |
| 7 dB | −2.4 · 9.7 · 16.7 | −2.6 · 4.8 · 12.8 | −2.6 · 7.0 · 10.5 |
| 10 dB | −3.2 · 11.5 · 18.5 | −3.2 · 6.3 · 14.5 | −3.5 · 8.2 · 10.1 |
| 15 dB | −4.3 · 14.0 · 20.5 | −3.9 · 8.3 · 14.5 | −4.8 · 10.7 · 12.2 |
| 20 dB | −5.1 · 15.8 · 22.1 | −4.4 · 9.4 · 15.6 | −5.9 · 11.4 · 13.0 |
| asym | −1.4 · 12.0 · 18.4 | −0.9 · 6.4 · 14.2 | −2.1 · 10.5 · 12.0 |
| down | 0.0 · 9.7 · 16.7 | 0.0 · 4.8 · 12.8 | 0.0 · 6.8 · 10.5 |
| MP3 | −2.0 · 7.1 · 11.7 | −2.2 · 3.5 · 9.2 | −2.2 · 5.2 · 9.5 |
| soft | −0.8 · 0.6 · 0.0 (level given: 1.6) | −0.7 · 0.2 · 0.0 (2.0) | −1.0 · 2.2 · 0.0 (5.1) |

Perceptually the same order: PEAQ ODG on the music, PESQ (wideband, 16 kHz) on speech, input · RX tuned · declip: 7 dB, SQAM −3.75 · −2.44 · −1.74, other music −3.65 · −2.72 · −1.85, speech 2.10 · 3.42 · 3.85; 20 dB −2.35 · −0.39 · −0.18, −1.29 · −0.23 · −0.12, 3.69 · 4.50 · 4.56; MP3 −3.49 · −3.27 · −2.78, −3.60 · −3.21 · −2.77, 2.10 · 3.05 · 3.74; soft, the level given, −2.86 · −2.84 · −2.75, −2.51 · −2.40 · −2.21, 3.12 · 3.41 · 3.85. RX at its defaults takes SDR off everywhere: its post-limiter holds the restored peaks to 0 dBFS, and its threshold finds nothing on rails under −1 dBFS (down). On the unclipped recordings peak-normalized to 0 dBFS, and through a lookahead limiter 12 dB over a −0.2 dBFS ceiling, declip changes no sample; RX changes them (SDR to its input, median: defaults 59–68 dB, 43–49 limited; tuned 77–94, 58–74). Soft saturation is the one condition where RX gains something by itself: declip finds no rail there and returns it untouched (0.0); given the level RX's tuned threshold sits at, `declip({ clipLevel })` gains more than RX on every set.

Rails are found at the 20 dB level clipped asymmetrically (with the 10 dB level below), on one side only, then turned down to 0.4, quantized to 16 bits plain or dithered, and on a 16-bit converter driven 2.5 dB over (rails at 32767 and −32768): 13 dB or more of SDR gained in each; through MP3 and AAC at 128 kbit/s, bands: speech 18.0 → 25.2 and 19.9 → 31.6, "Vibe Ace" 18.3 → 25.1 and 19.8 → 28.7, Brahms 18.2 → 24.8 and 19.6 → 28.0, the trumpet 18.1 → 24.9 and 19.3 → 26.9 dB (0.3.0: untouched). The unclipped material through it, as it is, peak-normalized, at 16 bits and through a lookahead limiter 12 dB over its ceiling: not a sample changed; nor in any of VoiceBank+DEMAND's 824 clean test utterances. The third rebuild costs time: 1.2–2.1× 0.3.0's side by side (0.3.0: about 7 s per second of sound averaged over the six levels, most of it at 1–3 dB), the AR rebuild's early stop giving some back (speech clipped to 3 dB: 0.8×).

**Use when:** digital clipping: a converter overdriven, a mix bounced too hot, a plug-in's hard clip; at any level, on either side or both; also after it went through MP3, AAC or Opus.<br>
**Not for:** soft saturation, tape or tube, which has no rail: pass the level it bends at as `clipLevel`; clipping that has since been resampled or heavily filtered.


## Reverb

### `dereverb`

Late reverberation off a voice, one microphone, the whole take at once. First weighted prediction error, WPE (Nakatani et al. 2010): in each STFT bin, what the frames from 43 to 150 ms back predict of the current one (at 48 kHz: from the first frame that shares no sample with it) is the room's tail, and is subtracted; the prediction is fitted over the whole take, each frame weighted by its inverse power, three times. The room is one for the take and the voice is not, so the fit learns the room. One microphone cannot invert a room, and the prediction cancels a dB or two of the tail. The rest is taken in power, as Lebart et al. (2001) and Habets (2010) model the late reverberation: from the power of the frames before, here weighed by the shape of WPE's taps, the room's decay in that bin. Its scale is read off the take itself: where only the tail sounds, the power over its expectation is exponential, and a tenth of such cells fall under 0.105 of it, while the voice's cells lie above; so the 10th percentile of the power over the weighed past, per octave band, divided by 0.105, is the late reverberation's share. It reads a 3 s clip and a minute-long take alike (0.3 scaled the taps' own power, which on 3 s predicted about all the late power and on 30 s a quarter). A log-spectral-amplitude gain (Ephraim & Malah 1985) takes that power off what WPE left, floored at −14 dB, and no bin leaves louder than it came. Three checks on the whole take come first, and any returns it bit for bit: dry, when its fastest falls are faster than a room's tail lets a sound fall (90 % of dry VoiceBank takes); no diffuse tail, when its lowest cells do not fall as a room's tail does: a diffuse tail's power is exponential, its 2nd percentile 7.2 dB under its 10th (ln 0.98 / ln 0.9), while a dry sound's own decays, a voice's closures, a muted string, part them further (the training rooms 7.0–8.1 dB apart, dry VoiceBank 8.6–17.7, GuitarSet 8.3–12.6; over 9, the take passes); no pauses, when under half of its frames are under half its mean power (Scheirer & Slaney 1997): there a held note's sustain reads as a room's. A bin cut to digital silence (an edit, a gate) is left out of the fit, and the frames that reach into such a cut, or past the take's end, out of the checks and the scale: their fall is the cut's. About 0.1 s per second of 48 kHz sound (a 41 s take: 4.7 s, 0.3 4.0 s).

```js
dereverb(data, { fs: 48000 })
dereverb(data, { fs: 48000, strength: 0.5 })   // a lighter hand
```

| Param | Default | |
|---|---|---|
| `strength` | `1` | Scale of the late-reverberation estimate (1: as the take's own decays read it): 0 is the linear prediction alone, 2 takes more of the tail and more of the voice |

Measured against iZotope RX 12 Advanced De-reverb (VST3 hosted by Pedalboard; [`audio`](https://github.com/audiojs/audio)'s `bench/rx/dereverb.mjs`, October 2026), through `audio`'s `dereverb()`, on the takes of `scripts/dereverb.py` (test set): 42 VoiceBank test utterances (1.6–5.9 s) and four 41–60 s takes of ten utterances by one speaker, in 19 MIT IR Survey rooms the tuning never heard (T60 0.38–1.85 s), each room's response split at direct + 50 ms: under it, the voice as the room colours it; over it, the tail to take. Voice lost: the output's power where the voice is 10 dB over the tail; tail taken: where the tail is 10 dB over the voice. PESQ against the dry take, DNSMOS OVRL at the input's loudness; noisy: the same takes with DEMAND noise 10 dB under them; dry: their dry takes, the share returned bit for bit and PESQ. RX at its defaults (reduction 10 dB, tail length 1 s, artifact smoothing 9, band strengths 6); after its Learn on each take (it learns a tail length and four band strengths); and at its best on reverberant VoiceBank training utterances by PESQ, searched over reduction, tail length, smoothing, the band strengths, enhance dry signal and Learn (tail length 0.5 s, band strengths 8, 4, 6, 4, the rest at defaults). RX Dialogue Isolate, a trained separator, with its reverb gain at −∞ and its noise kept, for reference:

| | short: voice lost, tail taken dB | PESQ | OVRL | long: voice lost, tail taken dB | PESQ | OVRL | noisy: PESQ | OVRL | dry: untouched, PESQ |
|---|---|---|---|---|---|---|---|---|---|
| takes in | | 1.39 | 2.19 | | 1.37 | 2.01 | 1.26 | 1.66 | 4.64 |
| RX De-reverb, defaults | −0.01, −1.1 | 1.45 | 2.36 | −0.02, −0.8 | 1.43 | 2.16 | 1.28 | 1.80 | 0, 4.07 |
| RX De-reverb, learned | −0.77, −3.1 | 1.47 | 2.35 | −1.07, −4.6 | 1.51 | 2.28 | 1.29 | 1.89 | 0, 4.30 |
| RX De-reverb, tuned | −0.18, −2.3 | 1.45 | 2.32 | −0.16, −1.5 | 1.43 | 2.09 | 1.27 | 1.75 | 0, 4.17 |
| RX Dialogue Isolate, reverb off | −3.18, −8.3 | **1.79** | **2.70** | −4.29, −6.2 | **1.77** | **2.57** | 1.34 | **2.18** | 0, 4.64 |
| `dereverb` 0.4 → 0.5 | −0.79, −6.3 | 1.53 | 2.49 | −0.61, −6.6 | 1.54 | 2.52 | **1.35** | 2.08 | 96 → **100 %**, 4.63 → **4.64** |

Take by take, `dereverb` over RX De-reverb tuned: PESQ +0.08 ± 0.02 (short), +0.10 ± 0.05 (long), +0.08 ± 0.02 (noisy), OVRL +0.17 ± 0.09, +0.43 ± 0.43, +0.33 ± 0.12 (95 % intervals); over its Learn, PESQ +0.06 ± 0.03, +0.02 ± 0.06, +0.06 ± 0.02. At the voice its Learn loses (−0.8 dB on the short takes) it takes 3.2 dB more of the tail; tuned, RX keeps more of the voice (−0.2 dB) and takes a third of the tail. On reverberant VoiceBank in 130 rooms (`vbreverb`, 206 test utterances; `audio`'s `bench/speech.mjs`): PESQ 2.33 in, RX defaults 2.42, tuned 2.46, `dereverb` 0.4 2.62, 0.5 2.61 (over RX tuned +0.14 ± 0.02), OVRL 2.82, 2.86, 2.87, 2.94, 2.94; the dry takes through it: RX 4.09 and 4.17, `dereverb` 4.63 → 4.64, untouched 94 → 100 %. On the training utterances RX's best setting gained PESQ 0.07 (2.42 → 2.49; on the half searched 2.37 → 2.44), its Learn 0.04 (2.37 → 2.41).

Where the rest lies: on the training rooms the take with its late part gone exactly scores PESQ 2.03 (short) and 2.12 (long), the ideal ratio mask (each cell's true voice and tail power) 1.98 and 2.11, `dereverb` 1.72 and 1.81. Its gain fed each cell's true late power, in place of the estimate, reaches 1.73 and 1.80 (1.75 and 1.83 at a −20 dB floor): the late power is estimated as well as it can be used. The floor (−10, −14, −20 dB), a Wiener gain for the LSA, the decision-directed memory (0.7–0.95) and the strength (0.7–1.5) all moved PESQ by under 0.02. What is missing is the voice's own power in each cell, which no model of the room gives and a trained model learns: RX Dialogue Isolate scores 0.26 over `dereverb` on the short takes, taking 3.2–4.3 dB of the voice's first 50 ms with the tail.

Through it as it is, music at 44.1 kHz (untouched: the share returned bit for bit; level change per octave, the worst of 63 Hz–8 kHz; with pauses: the same music cut into 2–4 s phrases, 0.5–1.5 s apart, over a noise floor 50 dB under it; in a room: through the test rooms, music lost and tail taken as for the voice):

| | RX defaults | RX learned | RX tuned | `dereverb` 0.4 → 0.5 |
|---|---|---|---|---|
| MUSDB18 previews (25) | −0.32 dB | −5.66 | −1.27 | 80 → **92 %**, −0.47 → **−0.15** |
| … with pauses | −0.58 | −1.44 | −1.91 | 76 → **100 %**, −0.35 → **0** |
| GuitarSet (20) | −0.81 | −0.24 | −1.03 | 75 → **100 %**, −0.77 → **0** |
| … with pauses | −1.67 | −0.27 | −2.50 | 95 → **100 %**, 0 |
| VocalSet sung straight tones (10) | −0.34 | −2.29 | −0.14 | 70 → **100 %**, −0.65 → **0** |
| … with pauses | −0.59 | −0.25 | −2.68 | 100 %, 0 |
| Brahms, the Nutcracker, a trumpet, Vibe Ace | −0.53 | −5.58 | −1.74 | 50 %, −3.07 |
| … with pauses | −0.84 | −0.74 | −2.02 | 50 → **100 %**, −2.16 → **0** |
| in a room, music lost, tail taken dB: MUSDB18 | 0.0, −0.6 | −3.5, −8.6 | −0.3, −3.0 | −0.5, −0.1 |
| GuitarSet | −0.2, 0.0 | −0.4, −2.8 | −0.4, −0.7 | −1.6, −1.5 |
| the four pieces | −0.2, −0.4 | −3.0, −7.1 | −0.3, −2.5 | −1.1, −10.1 |
| VocalSet sung | +0.1, −0.2 | −1.3, −3.0 | +0.1, −0.1 | −2.9, −7.8 |

In a room the music's lowest cells are the room's tail, so it is processed, and the late power the past carries over-reads a held note: in steady state the estimate is the scale times the note itself, while a room with a strong direct sound adds less (Lebart's model over-estimates as the direct-to-reverberant ratio grows; Habets, IEEE SPL 16(9), 2009). The constants were chosen on `scripts/dereverb.py train` (training speakers in the even-numbered rooms), the 9 dB on those takes, the dry training takes and the even-numbered MUSDB18 previews, other GuitarSet takes and VocalSet singers; it passes 13 % of the reverberant VoiceBank training utterances that 0.4 processed (rooms with little tail, where the voice's own falls outnumber the tail's), which cost PESQ 0.03 there and 0.01 on the test set.

0.2 fitted the prediction recursively, over its last second, and learned some of the voice as room. 0.3 scaled the taps' power by a constant, so its estimate grew as the take shortened: on 3 s it took 2–3 dB more than on a minute, and a dry voice came out at PESQ 4.25. Late-reverb subtraction at each room's measured T60 (Lebart; Habets's κ, the T60 an oracle's) scored under the taps' shape scaled by the percentile (short training takes: PESQ 1.64 against 1.71), and an exponential decay at the measured T60 in place of the taps' shape scored the same. Refitting WPE on the gain's output (its weights from the voice estimate, as DNN-WPE takes them) changed nothing. Sparing a spectral peak that holds over 43 ms (a held partial) cost 1.5–2 dB of the tail; peaks held 0.3 s (as noise-estimate's partials guard holds them) hold in a long room's reverberant speech as in music (up to 95 % of the energy). Pitch steadiness, power steadiness over three frames and 4 Hz modulation overlapped between speech in a room and music. 0.4 judged a take dry on its fastest fall alone, and passed music only when it had no pauses: GuitarSet, sung tones and music with pauses were processed.

**Use when:** a voice in a room, one microphone, one room per take.<br>
**Not for:** music recorded in a room, or produced with reverb, is processed, and a held note loses 0.5–3 dB with the room (the four pieces −3.1 dB in their worst octave). Noise: denoise first.


## Bleed

### `debleed`

Takes out of a microphone the bleed of a source whose own track you have: the click track leaking from a singer's headphones, the guitar amp in the vocal mic, the co-host's voice in the other host's mic, drums in a piano mic. The bleed is that track through the room, a delay of tens of ms and the room's response, changing as people move; the wanted sound plays over it nearly all the time. It comes out in two stages.

Cancellation: a partitioned-block frequency-domain Kalman filter (Enzner & Vary, Signal Processing 2006; Kuech, Mabande & Enzner, ICASSP 2014) learns the path from the reference to the mic, `span` seconds of it in 10.7 ms partitions (512 samples at 44.1 and 48 kHz), and subtracts the bleed it predicts. Its step in each bin is its uncertainty about the path over that uncertainty plus the wanted sound's power: it hardly moves while the wanted voice sings over the bleed, the double talk that throws an echo canceller's NLMS off, and learns at once where the bleed outweighs it. The wanted sound's power is the error's less the residual the filter expects, smoothed over blocks, so a click's own block, all bleed, does not pass for the voice under it. The path is a slowly wandering state (AR(1), memory ~5 s), so the filter follows a moving source. It learns from the reference exactly as it predicts from it, and each partition's update is held to its 512 taps every block. Suppression: what cancellation leaves, a path not yet learned, movement faster than the filter follows, the room's tail past `span`, has a power the filter knows (its uncertainty times the reference's power, plus the decaying tail), and a Wiener gain against it (decision-directed, Ephraim & Malah 1984), floored at `attenuation`, takes it from what remains. With no reference energy the output is the input, bit for bit.

What the filter assumes of the path before hearing it, its prior, sets how fast it learns and how much residual the suppressor expects: a room's decay and a level per band. Where the source first sounds in a band (10 dB over the least it has had there), the level starts at the most it can be, the mic's energy over the source's across the next `span`; from then on it is learned from the coherence of the mic with the bleed predicted (Carter 1973's magnitude-squared coherence, debiased): coherence ignores the prediction's level, so a path the filter has barely begun to learn already reads at its level, and the wanted sound, incoherent with the reference, is not taken for bleed. As a level comes down, what the filter learned under the looser prior comes down with it. No level predicts more bleed than the mic holds, the mic's power over the source's while the source sounds: a bound blind to the tracks' gains (a click track recorded 10 dB under its bleed is learned like any other), which also keeps two mics that hear each other from taking the wanted voice: while that voice sounds alone the reference holds only its echo, which predicts it only through a path louder than the mic. The batch call runs twice, the second pass from where the first ended (its levels and its filter), so a static path is cancelled from the first sample and a level learned down where nothing bleeds leaves the wanted sound alone. The stream cannot look ahead, and a level started at its bound would take a voice the source never reached in the first seconds, so it learns the same way but cancels and suppresses a band only once the evidence proves a path there: the power its prediction, made before the block was heard, takes off the mic, two spreads over nothing (a filter fit to an unrelated voice adds power instead). Until then the band passes as it came; with no band open the stream is the input, sample for sample. A click or a drum proves itself in a second; a talker under a louder voice takes seconds, so the stream takes less of a co-host than the batch call, and less than 0.1.0's stream did. Stream latency 2·512 − 1 samples at 44.1 and 48 kHz (23 and 21 ms); the batch call runs at about 11× real time at 48 kHz on one core (two passes), the stream at about 22×.

```js
debleed(vocal, clickTrack, { fs: 48000 })                   // in place
debleed(hostA, [coHostL, coHostR], { fs: 48000 })           // a stereo reference
let write = debleed({ fs: 48000 })                          // stream: write(chunk, refChunk) → the samples done, write() → the rest
```

In `audio`, the reference is the op's second bus, as the ducker's key: `a.debleed({ key: clickTrack })`; the op renders the whole take with the batch call.

| Param | Default | |
|---|---|---|
| `attenuation` | `-20` | dB, the most the residual is turned down; `0` cancels only; read every block |
| `span` | `0.3` | s of room path the filter learns: the delay and the early room; the tail past it is suppressed as a decay |
| `blockSize` | 10.7 ms | the partition and hop, a power of two |

Measured (`node scripts/debleed.js test`, then `python scripts/debleed.py test`): bleed made from real recordings, 14 s takes, three per kind and level. The wanted sound: VoiceBank voices (p232, p257) and Spoken Wikipedia narrations, or MUSDB18 vocals. The bleed: another VoiceBank voice (co-host), a click track, MUSDB18 drums, its "other" stem (guitars, keys), through MIT IR Survey rooms (the odd-numbered responses; the defaults were chosen on the even ones, VoiceBank's training speakers and MUSDB18's training previews), 1–30 ms away, −30, −18 or −6 dB under the wanted sound's level; the op gets the source as its own track recorded it, at another gain and tilt, with its own noise. A static path, and a moving one: the source sways ±0.5 ms over 6–10 s, the gain drifts ±1.5 dB, a second room comes in to 30 % over the take. Each system runs on the take and on the take with the bleed inverted (Hagerman & Olofsson 2004), which splits its output into the wanted sound as it left it and the bleed it left. Bleed removed, dB; the wanted sound's SI-SDR after it (the takes' distortion pooled), all and per band; musical noise, the log kurtosis ratio of the bleed left over the bleed (Uemura et al. 2008: 0 for a gain that scales it, more for isolated peaks):

| static path | co-host −30 / −18 / −6 | click | drums | other | wanted SI-SDR | <300 Hz | 0.3–1k | 1–3k | 3–8k | >8k | kurtosis |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| `debleed` | 10.6 / 14.9 / 15.5 | 12.0 / 14.8 / 16.1 | 12.1 / 11.8 / 16.2 | 9.0 / 11.0 / 24.9 | 23.2 | 21.7 | 23.2 | 21.6 | 21.9 | 24.4 | 0.12 |
| stream | 2.2 / 4.7 / 11.7 | 2.6 / 5.9 / 8.4 | 2.7 / 5.5 / 8.7 | 1.9 / 6.2 / 15.1 | 22.7 | 20.6 | 23.1 | 20.7 | 21.9 | 24.3 | 0.60 |
| time-aligned subtraction | 6.4 / 1.6 / 2.3 | 1.9 / 9.0 / 2.1 | 0.7 / 2.2 / 2.0 | 0.4 / 1.1 / 5.1 | 32.6 | 28.8 | 35.8 | 26.5 | 32.3 | 37.3 | −0.12 |
| reference Wiener | 4.8 / 5.3 / 9.9 | 5.3 / 11.5 / 10.9 | 5.9 / 4.7 / 6.2 | 3.8 / 5.9 / 9.4 | 20.7 | 20.5 | 20.1 | 19.3 | 20.2 | 26.7 | −0.11 |
| Speex MDF + suppressor | −4.0 / 6.7 / 8.5 | 3.1 / 6.8 / 6.5 | 0.7 / 6.4 / 10.7 | 4.1 / 9.0 / 16.4 | 7.2 | 1.6 | 12.0 | 16.0 | 5.5 | −23.6 | 0.60 |
| WebRTC AEC3 | −5.9 / 8.9 / 10.8 | −8.3 / 3.6 / 10.4 | −5.2 / 1.7 / 10.5 | −5.0 / 2.6 / 11.5 | −4.1 | −24.4 | 2.8 | −14.9 | −44.7 | −43.1 | 1.00 |

| moving path | co-host −30 / −18 / −6 | click | drums | other | wanted SI-SDR | <300 Hz | 0.3–1k | 1–3k | 3–8k | >8k | kurtosis |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| `debleed` | 5.1 / 7.5 / 9.0 | 3.6 / 5.6 / 5.0 | 7.0 / 5.7 / 6.8 | 3.5 / 5.7 / 8.6 | 23.8 | 21.9 | 23.4 | 23.6 | 26.1 | 26.6 | 0.13 |
| stream | 1.1 / 4.2 / 7.7 | 0.1 / 0.6 / 0.5 | 1.8 / 3.5 / 5.4 | 0.7 / 3.7 / 7.4 | 22.8 | 20.3 | 22.7 | 22.9 | 25.2 | 25.6 | 0.21 |
| time-aligned subtraction | 0.4 / 0.3 / 0.3 | 0.0 / 0.2 / 0.0 | 0.6 / 0.1 / 0.0 | 0.0 / 0.0 / 0.0 | 29.6 | 31.2 | 28.5 | 28.3 | 31.4 | 26.1 | −0.01 |
| reference Wiener | 4.4 / 3.2 / 7.6 | 2.6 / 3.9 / 1.8 | 6.4 / 3.2 / 3.9 | 3.0 / 3.0 / 3.9 | 23.0 | 21.4 | 22.5 | 24.7 | 28.8 | 30.8 | −0.06 |
| Speex MDF + suppressor | −0.5 / 3.3 / 4.3 | −0.0 / 0.1 / −0.8 | 2.4 / 3.8 / 5.9 | 1.6 / 4.0 / 6.1 | 7.0 | 1.3 | 11.7 | 15.7 | 7.9 | −23.6 | 0.25 |
| WebRTC AEC3 | −3.1 / 6.3 / 10.1 | 2.8 / 4.2 / 6.3 | −6.0 / 3.5 / 8.1 | −5.1 / 1.9 / 8.4 | −4.1 | −33.6 | 2.6 | −25.3 | −21.9 | −36.7 | 0.80 |

PESQ (wideband) / STOI of the voices (co-host and click takes) against the wanted voice, scored at 16 kHz as `scripts/speech.py` does:

| | static −30 dB | −18 dB | −6 dB | moving −30 dB | −18 dB | −6 dB |
|---|---|---|---|---|---|---|
| input | 3.28 / 0.989 | 2.23 / 0.960 | 1.49 / 0.868 | 3.29 / 0.989 | 2.24 / 0.960 | 1.52 / 0.869 |
| `debleed` | 4.07 / 0.995 | 3.57 / 0.983 | 2.41 / 0.938 | 3.74 / 0.993 | 2.83 / 0.974 | 1.76 / 0.908 |
| stream | 3.49 / 0.992 | 2.94 / 0.975 | 2.14 / 0.930 | 3.35 / 0.990 | 2.44 / 0.967 | 1.62 / 0.898 |
| time-aligned subtraction | 3.55 / 0.992 | 2.69 / 0.970 | 1.55 / 0.894 | 3.32 / 0.989 | 2.25 / 0.960 | 1.52 / 0.870 |
| reference Wiener | 3.74 / 0.992 | 3.02 / 0.974 | 1.99 / 0.913 | 3.57 / 0.991 | 2.57 / 0.968 | 1.63 / 0.895 |
| Speex MDF + suppressor | 3.14 / 0.984 | 2.74 / 0.968 | 1.87 / 0.920 | 3.01 / 0.981 | 2.20 / 0.955 | 1.50 / 0.874 |
| WebRTC AEC3 | 1.73 / 0.852 | 1.53 / 0.823 | 1.31 / 0.738 | 1.63 / 0.835 | 1.53 / 0.823 | 1.28 / 0.733 |

The wanted sound alone, its source's track present but never heard by the mic: the batch call adds an error 44.1 dB under it on average (34.6 at most); the stream one take bit for bit, the other eleven 56.9 dB under on average (35.5 at most; 0.1.0's stream 38.5 and 33.9). With a silent reference every take comes back bit for bit.

Time-aligned subtraction is the delay and gain of Clifford & Reiss (DAFx 2011): one tap cannot follow a room, and a moving one not at all. The reference Wiener is Kokkinis, Reiss & Mourjopoulos's form (IEEE TASLP 2012): the reference's power through |H|² read from the whole take, a gain against it; it takes the bleed's average spectrum, not the bleed in each cell. Speex's MDF echo canceller (speexdsp 1.2.1, 20 ms frames, 0.3 s tail) with its residual-echo suppressor, and WebRTC's AEC3 (through LiveKit's AudioProcessingModule), are telephone echo cancellers: they protect a far end, not the near voice, and in a near voice that never stops they cancel and suppress it (their wanted SI-SDR; their output is nonlinear, so the inversion splits it only roughly). FFmpeg's `anlms` and `arls` would not converge on a 10-sample delay in our setup and are left out. iZotope RX De-bleed was not available to measure.

The tuning half (even-numbered rooms, other speakers and songs): the batch call took 9.1–18.6 dB of bleed static and 3.5–10.4 moving (0.1.0: 7.6–15.3 and 2.5–10.7), the wanted SI-SDR 23.0 and 24.0 (0.1.0: 23.1 and 24.1), PESQ at −18 dB 2.33 → 3.68 static and 2.32 → 2.96 moving; the stream 1.5–10.7 and 0.0–7.8 (0.1.0: 3.5–16.1 and 1.2–12.0) at an SI-SDR of 21.5 and 21.4 (0.1.0: 24.1 and 24.0), its error on the wanted sound alone −49.9 dB on average, −30.7 at most (0.1.0: −36.5 and −29.5). Without its gate the stream took 6.0–17.6 and 3.6–12.4 at 20.4 and 20.7, but took a wanted voice the source never reached in its first seconds (−17.2 dB at most on the tuning half, −2.1 on the test half: a MUSDB18 vocal under its own song's "other" stem, its first two seconds made louder than the voice); gates read from the mic's cross-spectrum with each partition (an F test) or from the coherence with the prediction opened on a click only after 2 s, and a fixed share of power taken could never open on a co-host 11 dB under the voice. Version 0.1.0 learned slowly or not at all wherever its source was sparse, line-level or talking all the time: a click track 8.6 dB under a voice through a three-tap path of +10 dB, 3.1 dB taken by the batch call and 1.3 by the stream (now 30.5 by the inversion, the voice's error −24.5 dB). Six faults, found on that click and on the tuning half, each fixed at its cause: the filter learned from the reference less its noise floor, and minimum statistics, which skip digital silence, read a click track's clicks as its floor, so it learned from a signal other than the one it predicted from (the canceller alone, with no wanted voice, took 11.5 dB of a talking co-host with it and 25.4 without); the way back (the crosstalk-resistant second filter of Mirchandani, Zinser & Evans, predicting the reference from the output) learned the reference from the bleed left in the output, which the reference itself predicts, and the canceller alone took 9.2 dB of a click with no voice under it with that filter, 16.5 without; the wanted sound's power, floored at a tenth of the error, read a click's own block, all bleed, as voice, so a click moved the filter about a seventh of a full step; one partition per block held to its taps let the wrap of a full step ring (the canceller alone on a metronome: 3.5 dB in turn, 9.4 every block); the level started at −30 dB and was capped at 0 dB, which a line-level source's path exceeds; and the second pass started empty (the canceller alone on the click: 19.4 dB from where the first ended, 10.6 from nothing). Tried there as well: the a posteriori error as the wanted sound's power (Enzner & Vary's) took the voice under a constant co-host; the prior read from the mic's cross-spectrum with each partition's frames overestimated the path by 10–20 dB in the first second (the frames overlap and a voice is its own echo); starting the level 10 or 30 dB under its bound gave the click back its slowness and little of the voice; a block's least weight 0.02 (0.1.0's) left the level high where nothing bleeds, the batch call's error on the wanted sound alone −32.4 dB, now −39.0 at 1–2 dB less removal. The gradient held to B taps every block costs no more than 0.1.0's alternating form with its second filter.

**Use when:** you have the bleeding source's own track: a click or backing track, the amp's own close mic, the other mic of a pair, the drums' close mics.<br>
**Not for:** bleed with no track of its own (denoise it). A path the reference cannot predict, an overdriven amp's DI as the reference of its speaker's sound: the suppressor alone acts on it.


## Pitch drift

### `dewow`

Wow & flutter correction. A speed change of the disc or tape moves every frequency in the recording by one ratio at one instant; a singer's vibrato, a glide or a melody moves one note and its harmonics. dewow tracks the partials (phase-vocoder frequency over a 0.19 s frame), cuts them into steady pieces, and fits Godsill & Rayner's speed model (*Digital Audio Restoration*, 1998, ch. 8) with each piece's centre tied to its pitch class: music reuses its pitches, so every return of a note measures the speed, where free centres let errors add up along the chain of overlapping notes. Harmonics of a note count as one source; a hop counts where two independent sources agree. Of that curve it applies only what a second test proves: a disc's wow, a sinusoid at a turntable's rotation (33⅓, 45 or 78 rpm within 4 %, or its 2nd harmonic), fitted to the partials and kept where its amplitude stands 4.5 times over its own bootstrapped noise, holds from one half of its 20 s window to the other and reaches 0.1 %. A pilot tone running through the recording (above 5 kHz) is read instead, flutter too; `mode: 'reference'` reads a tone given or found (a pilot, a calibration tone, mains hum). The sound is read back through a variable-rate windowed sinc. Nothing proven, nothing changed: the clip comes back bit-exact. Whole-signal, length-preserving. `wowFlutter()` alone is the meter.

```js
dewow(data, { fs })                                            // a disc's wow from the music; a pilot tone if there is one
dewow(data, { fs, mode: 'reference' })                         // the tone found: a pilot, else 50/60 Hz hum
dewow(data, { fs, mode: 'reference', refFreq: 1000 })          // a 1 kHz calibration tone
wowFlutter(data, { fs })                                       // → { speed, times, wow, flutter, lines, reference, confidence }
```

| Param | Default | |
|---|---|---|
| `mode` | `'partial'` | `'partial' \| 'reference' \| 'pitch'` (`pitch`: one voice's f0 against its own trend; takes its vibrato for speed) |
| `refFreq` | found | Hz — the tone for `reference`; omitted: a pilot above 5 kHz, else 50/60 Hz hum |
| `smooth` | `0.05` | s — splits the curve into wow (slower) and flutter |
| `wow` / `flutter` | `true` / `true` | correct each part |
| `maxDeviation` | `0.05` | clamp on the speed ratio (±5 %) |
| `minTrack` | `0.2` | s — shortest steady piece of a partial used (`partial`) |
| `minFreq` / `maxFreq` | `50` / `2000` | Hz — where partials (`partial`) or the f0 (`pitch`) are looked for |
| `keepLength` | `true` | output length equals input |

`node scripts/dewow.js` reads clean speech (audio-lena, two Spoken Wikipedia narrations), music ("Vibe Ace", "Dance of the Sugar Plum Fairy", Brahms' Hungarian Dance No. 5, a trumpet loop, three GuitarSet takes, six MUSDB18 and four BabySlakh mixes) and singing (five VocalSet excerpts) at a varying speed — a disc turning off-centre at 33⅓, 45 or 78 rpm, or tape's random wow (0.5–6 Hz) — at 0.3, 1 and 2 % peak, and measures the pitch error left on the audio itself (local lag against the clean sound, differentiated; cents RMS, mean over clips; doing nothing leaves the wow):

| | wow | 0.3 % | 1 % | 2 % |
|---|---|---:|---:|---:|
| music | disc 33⅓ | 3.7 → 1.7 | 12.2 → 2.1 | 24.5 → 4.3 |
| | disc 45 | 3.7 → 1.6 | 12.2 → 3.0 | 24.5 → 6.0 |
| | disc 78 | 3.7 → 1.2 | 12.2 → 2.9 | 24.5 → 13.4 |
| | tape | 1.4 → 1.4 | 4.6 → 4.6 | 9.2 → 9.2 |
| speech, singing | any | unchanged | unchanged | unchanged |
| steady notes (C4 E4 G♯4 D5) | disc 33⅓ / 45 / 78 | 3.7 → 0.0 / 0.1 / 0.1 | 12.3 → 0.1 / 0.2 / 0.5 | 24.6 → 0.3 / 0.5 / 0.9 |
| | tape | 1.3 → 1.3 | 4.5 → 4.5 | 9.0 → 9.0 |

The longer the recording, the more turns of the disc and returns of each note it holds: on whole pieces (`node scripts/dewow.js whole`) disc wow at 33⅓ rpm comes out of the Sugar Plum Fairy (120 s) at 0.4, 0.6 and 0.8 cents from 3.7, 12.2 and 24.5; of "Vibe Ace" (61 s) at 0.6, 1.0 and 1.9; of the Brahms (46 s, strings with vibrato) at 3.0, 2.4 and 3.2. Flutter (random, 6–30 Hz, 0.1 % peak, over 1 % tape wow) is not read from the music; a 19 kHz pilot 40 dB under the program, found by itself, reads it all: 4.2–4.5 → 0.1 cents on speech, music and singing. 50 Hz hum 30 dB down is a poor reference where the program has its own energy at 50–100 Hz: singing 4.3 → 2.2, speech 4.3 → 3.7, music 4.4 → 4.2 (`reference`).

Clean, every clip comes back bit-exact: 25 tuning and 19 held-out clips, the 504 clean VoiceBank+DEMAND training and 824 test utterances, a vibrato voice (±50 cents at 5.5 Hz), a 220 → 330 Hz glide, a vibrato voice over steady notes. With wow, no clip came out worse. Held out (never tuned on: two narrations, six MUSDB18 test mixes, three GuitarSet takes, four BabySlakh mixes, four VocalSet singers), music under disc wow at 0.3 / 1 / 2 %: 33⅓ rpm 3.7 → 2.3, 12.2 → 2.8, 24.5 → 6.9; 45 rpm 1.9, 2.8, 7.7; 78 rpm 2.0, 5.7, 17.6. 0.2 on the tuning music: 33⅓ rpm 3.7 → 3.6, 12.2 → 10.5, 24.5 → 18.0, 3 of 17 clean clips moved and 4 tape cases made worse (held out: 12.2 → 11.4 at 1 %); it did correct steady notes under random tape wow (4.5 → 0.5 cents), which 0.3 leaves. What dewow cannot do, measured: random tape wow, read from the music alone, is left — over a few seconds the notes' own pitch movement is as large as the wow, and no test told the two apart without also passing a voice's intonation; one voice or instrument alone gives no evidence, so speech and singing are corrected only through a tone; a clip under 5 s is never corrected from the music.

**Use when:** disc transfers (33⅓, 45, 78 rpm) of music with more than one voice, the record off-centre or warped; any transfer with a pilot tone (found by itself) or a calibration tone (`reference`).<br>
**Not for:** random tape wow read from the music alone (left as it is); a solo voice or instrument without a tone to read; dropouts; azimuth/time-skew.


## Gates & inter-word

### `gate`

Look-ahead noise gate with hysteresis. Backed by [`@audio/dynamics-gate`](https://github.com/audiojs/dynamics) since the 2026-07 near-dupe merge — same seconds-based options here; `closeThreshold` (default `threshold − 6` dB) sets the hysteresis close level.

```js
gate(data, { threshold: -45, attack: 0.005, release: 0.1, hold: 0.05, lookahead: 0.005 })
```

**Use when:** silence enforcement; aggressive cut between phrases.<br>
**Not for:** continuous denoise — use `wiener`/`omlsa`.


### `debreath`

Takes the breaths between phrases down by `range`; the room around them, and the speech, stay. A breath is told by what an inhalation is (Ruinskiy & Lavner 2007): unvoiced, longer than a consonant, well under the speech, between phrases, its noise shaped by the open tract. Per frame of [`vad`](#lower-level-building-blocks), on the 0.3–8 kHz band: 10 dB or more over the room (the band's 10th-percentile frame), 12 dB or more under the speech (its 95th), under half of it over 4 kHz (no sibilant). Runs of such frames are a breath when they last 0.15–1 s, their median stands 15 dB over the room, under 60 % of their energy lies under 1 kHz (where a phrase's creaky end and murmur lie), at most half their frames are voiced (the VAD's periodicity reads a breath's formant-shaped noise as voiced now and then; a vowel is voiced throughout), and a room-level frame lies within 0.1 s on either side: a pause, which a word's own consonants have not. The cut works on the band over 300 Hz (split at zero phase: a room's rumble under a breath is the room's), ramps in over `attack` and out over `release` inside the breath, and never takes it under the room's level in that band, where it would leave a hole. `room` turns down what is neither speech nor breath, as 0.2 did. The whole clip is read at once (streaming: false).

```js
debreath(data, { fs: 48000 })                   // breaths 12 dB down
debreath(data, { range: -20, room: -6 })        // deeper, and the room between phrases 6 dB down too
```

| Param | Default | |
|---|---|---|
| `range` | `-12` | dB, how far a breath goes down |
| `room` | `0` | dB, how far what is neither speech nor breath goes down |
| `attack` | `0.005` | s, the cut's ramp in (with `room`: the gain's rise before speech) |
| `release` | `0.01` | s, its ramp out (with `room`: the gain's fall after speech) |

Against iZotope RX 12 Breath Control, `node bench/rx/debreath.mjs` in [audio](https://github.com/audiojs/audio) (2026-10): ten Spoken Wikipedia narrations, 3 minutes each, their 90 breaths labelled by the acoustics of an inhalation (most clear inhalations on spectrograms, the rest quiet noise in pauses), and VoiceBank test speech with 60 of those breaths put before its phrases (labels exact, the speech another). Every setting chosen on ten other narrations (55 breaths) and 28 other speakers (26), by Youden's J, breaths caught less speech frames harmed; RX at Gain −12 dB, `range`'s (its default 0 dB changes nothing), tuned: Offline, Gated, sensitivity 0 (defaults Real-time, Natural, 5). Per breath, its 0.3–8 kHz level change; per speech frame (voiced, or a word's edge within 0.1 s of voicing), turned down by over 3 dB or not:

| | narrations: breaths, median · down ≥ 6 dB | speech frames down > 3 dB | other frames, median | VoiceBank + breaths: median · down ≥ 6 dB | speech frames down > 3 dB |
|---|---:|---:|---:|---:|---:|
| RX 12 defaults (Gain 0 dB) | 0.0 dB · 0 % | 0.0 % | 0.0 dB | 0.0 dB · 0 % | 0.0 % |
| RX 12 defaults, Gain −12 dB | −9.7 dB · 81 % | 0.69 % | 0.0 dB | −6.6 dB · 52 % | 0.59 % |
| RX 12 tuned | **−12.0 dB · 88 %** | 1.96 % | −0.1 dB | −12.0 dB · 73 % | 0.99 % |
| 0.2.1 | 0.0 dB · 11 % | 0.11 % | 0.0 dB | 0.0 dB · 20 % | 0.19 % |
| **0.3.0** | −10.9 dB · 78 % | **0.49 %** | 0.0 dB | **−11.2 dB · 78 %** | **0.58 %** |

0.2.1 turned down what the VAD did not call speech; its speech reaches 0.3 s from a vowel across gaps of 0.15 s, which holds most breaths. Music and singing (Vibe Ace, Brahms, the Nutcracker, a trumpet, four VocalSet excerpts), frames within 30 dB of the loudest turned down by over 3 dB: none (0.2.1: Brahms 8.8 %, Vibe Ace 2.2 %). VoiceBank+DEMAND noisy test speech, every fourth utterance, speech frames turned down by over 3 dB: 0.03 % (0.2.1: 5.0 %).

**Use when:** breaths between phrases on a voiceover, a podcast, a narration.<br>
**Not for:** a breath that runs into a word (no pause on either side); hiss or room tone in pauses: `room`, `gate`, `omlsa`.


### `desilence`

VAD-driven silence editing. Runs [`vad`](#lower-level-building-blocks) once (voicing, and the sound over a tracked noise floor next to it: noise, breaths and room tone between phrases are pause, a quiet word in noise is not), folds frames into speech/pause segments, then cuts pauses per `mode` with equal-power crossfades at every splice — never a hard cut. Length-changing, so it is a batch call (and a `silence` stat atom), not a streaming processor.

```js
desilence(data, { mode: 'shorten', maxSilence: 0.25 })          // Overcast "Smart Speed": long pauses → 0.25 s
desilence(data, { mode: 'remove', minSilence: 0.5, pad: 0.1 })  // cut pauses > 0.5 s, keep 0.1 s around speech
desilence(data, { mode: 'trim' })                                // leading/trailing silence only
silenceSegments(data, { fs })                                    // → { speech: [{start, end}], silence: [...] }
splitSilence(data, { fs })                                       // → one Float32Array per phrase
```

| Param | Default | |
|---|---|---|
| `mode` | `'shorten'` | `'shorten' \| 'remove' \| 'trim'` |
| `minSilence` | `0.5` | s — pauses shorter than this are never touched |
| `maxSilence` | `0.25` | s — `shorten` target length of any remaining pause (cut from the middle, onsets kept) |
| `pad` | `0.1` | s — silence kept on each side of speech in `remove` mode |
| `merge` | `0.15` | s — speech gaps shorter than this join one segment |
| `fade` | `0.01` | s — crossfade at every cut |

Returns `{ data, segments, removed, map }`; `project(map, t)` re-times markers/subtitles (`@audio/subtitle` `project()` takes the same map).

0.1 read silence under 11 dB over the input's 10th-percentile frame energy: under noise that percentile is the noise, and whole words went. Measured with `python scripts/vad.py` (VoiceBank+DEMAND test set, ten Spoken Wikipedia narrations; defaults chosen on the training subset and ten other narrations), `shorten` at its defaults, 0.1.1 → 0.2.1, frames cut:

| | voiced | word edges | removed |
|---|---:|---:|---:|
| VoiceBank+DEMAND, 824 noisy | 3.89 → **0.02** % | 3.93 → **0.08** % | 290 → 40 of 2072 s |
| the same, clean | 0.00 → 0.05 % | 0.01 → 0.19 % | 167 → 156 s |
| 10 narrations | 0.00 → 0.04 % | 0.00 → 0.03 % | 50 → 56 of 600 s |

Breaths in the narrations' pauses (as above) ending 0.3 s before the next phrase: 56 → 75 % of each removed at −35 dB, 50 → 69 % at −25 dB. Noise after speech is a pause (0.2.0 read white or pink noise there as speech and cut none of it). Music, frames within 30 dB of the loudest cut: Vibe Ace 10.5 → 0.5 %, Nutcracker 16.8 → 0 %, sung (VocalSet m8) 25.3 → 0 %, but Brahms (strings) 3.5 → 9.1 % (0.2.0: 0.02 %).

**Use when:** podcast/lecture pause tightening, split-by-silence, auto-trim.<br>
**Not for:** music (a rest is a pause to this VAD); overlapping speech; whispered speech (no voicing: it reads as pause).


## Quality measurement

```js
import { snr, segSnr, lsd, nrr, speechAttenuation } from '@audio/denoise'

snr(reference, processed)                                       // global SNR (dB)
segSnr(reference, processed)                                    // segmental SNR (dB)
lsd(reference, processed)                                       // log-spectral distance
nrr(noisyInput, processed)                                      // noise reduction ratio
speechAttenuation(reference, processed)                         // dB lost on speech segments
```

| Metric | Higher is better | What it captures |
|---|---|---|
| `snr` | ✓ | Energy ratio reference / error |
| `segSnr` | ✓ | Time-localised SNR — better correlates with perception |
| `lsd` | ✗ | Mean log-magnitude error per bin |
| `nrr` | ✓ | Floor reduction in non-speech regions |
| `speechAttenuation` | ✗ | Loss of speech energy (over-aggressive denoising) |


## Lower-level building blocks

```js
import { stftBatch, stftStream, stftAnalyse } from '@audio/denoise'
import { vad, spp, ddSnr } from '@audio/denoise'
import { noiseProfile, minStats, imcra } from '@audio/denoise'
```

- **`stft*`** — analysis-modification-synthesis with Hann + ∑win² OLA reconstruction. Visit `(mag, phase, state, ctx) => { mag, phase }`.
- **`vad`** — frame-level speech: Sohn's likelihood ratio over a minimum-statistics noise floor, anchored on voicing ([`@audio/vad`](packages/vad)).
- **`spp`** — per-bin Speech Presence Probability under Gaussian model.
- **`ddSnr`** — decision-directed a-priori SNR (Ephraim-Malah).
- **`noiseProfile`** — average PSD over leading frames.
- **`minStats`** — Martin (2001) minimum-statistics noise PSD tracker.
- **`imcra`** — Cohen (2003) Improved Minima-Controlled Recursive Averaging — drives `omlsa`.
- **`partials`** (`@audio/noise-estimate`) — a tracker's estimate kept off a program's held partials; `lines`: the steady lines of a noise bed.


## Measurements

`npm run measure` produces a Markdown table of SNR / segSNR / LSD / NRR per method on canonical scenarios. Headline numbers on the included `audio-lena` fixture (8 s mono speech, 44.1 kHz):

| scenario | SNR-in | best method | SNR-out | NRR | ms |
|---|---:|---|---:|---:|---:|
| 60 Hz hum + harmonics | -5.2 dB | `dehum` | 40.4 dB | 6.4 dB | 65 |
| white noise (~13 dB SNR) | 13.3 dB | `wiener` | 20.5 dB | 0.3 dB | 82 |
| clicks (vinyl-style) | 24.1 dB | `declick` | 65.2 dB | — | 450 |
| 7 kHz sibilance | 2.0 dB | `deesser` | 9.2 dB | 1.9 dB | 5 |

Higher = better.

### Speech

`node scripts/speech.mjs SET SYSTEMS` runs each op through its `audio.js` manifest, as `audio` does, and `python scripts/speech.py score SET SYSTEMS` scores the outputs as `@audio/neural-denoise`'s accuracy.py does: at 16 kHz, PESQ (P.862.2), STOI, SI-SDR, DNSMOS P.835 (SIG speech, BAK background, OVRL overall). Musical noise is the log kurtosis ratio of the power spectral values, output over input (Uemura et al. 2008): 0 when the noise is only scaled, higher when isolated peaks survive. Defaults were chosen on 168 utterances of a VoiceBank+DEMAND training subset that shares no speaker or noise with the test set (`python scripts/speech.py fetch`); the test set was scored once. Before: 0.3.11.

VoiceBank+DEMAND test set (Valentini-Botinhao 2017, CC BY 4.0), 824 utterances; noisy input PESQ 1.97, STOI 0.921, SI-SDR 8.45 dB, OVRL 2.68:

| op, before → after | PESQ | STOI | SI-SDR dB | SIG | BAK | OVRL |
|---|---|---|---|---|---|---|
| `omlsa` | 1.88 → **2.36** | 0.870 → 0.919 | 5.4 → **14.0** | 3.07 → 3.38 | 3.15 → **3.43** | 2.51 → **2.84** |
| `wiener` | 2.19 → 2.36 | 0.916 → 0.911 | 11.9 → 14.3 | 3.34 → 3.40 | 3.26 → 3.43 | 2.73 → 2.84 |
| `specsub` | 2.11 → 2.26 | 0.921 → 0.919 | 10.4 → 12.8 | 3.29 → 3.36 | 3.12 → 3.36 | 2.66 → 2.79 |
| `dehum` (no hum here) | 1.78 → 1.97 | 0.907 → 0.921 | 6.5 → 8.4 | 3.29 → 3.32 | 3.08 → 3.11 | 2.65 → 2.68 |

The same clean utterances in: PESQ 3.06 → 4.29 (`omlsa`), 3.97 → 4.03 (`wiener`), 4.30 → 4.03 (`specsub`, which now subtracts an unbiased noise estimate), 3.20 → 4.64 (`dehum`: no hum found, output equals input). Stationary white and pink noise alone, 8 s: `omlsa` takes it 15 dB down with log kurtosis ratio 0.00 (was +0.53 and +0.30), `wiener` 15.5 dB at +0.53 and +1.01 (was 10 dB at +0.93 and +1.35), `specsub` 12 dB at +0.78 and +1.44 (was 4 dB at +0.48 and +0.58). With mains hum 20 dB under the clean utterances (12 harmonics at −6 dB per octave, 0.05 Hz off nominal), `dehum` takes PESQ from 2.64 to 4.18 at 50 Hz and from 2.48 to 4.27 at 60 Hz, SI-SDR from 20.0 to 39.2 and 41.6 dB, STOI to 0.998 (0.2.0's notches: PESQ 2.88 and 2.76, SI-SDR 23.8 and 24.2 dB); alone, that hum goes 110 and 87 dB down (0.2.0: 44.6 and 50.0).

Ten Spoken Wikipedia narrations, 60 s each (volunteers at home; raw OVRL 3.17): `omlsa` SIG 3.25 → 3.46 (raw 3.45), BAK 4.00 → 4.09, OVRL 2.96 → 3.20, speech level −1.1 → −0.04 dB, noise floor median −76 → −75 dBFS. Room tone stays: G<sub>min</sub> is 15 dB, so only a room already under −75 dBFS ends under −90 (one of the nine, raw −83).

In the rows above, `omlsa` 0.3 and `wiener` 0.3 take the decision-directed α per 8 ms of frame step, as their papers quote it, where it was per frame (the a priori SNR's memory ran 1.8× longer at 48 kHz than at 44.1); `omlsa`'s is the lowest per 8 ms that leaves steady noise free of musical noise, 0.97 tracking and 0.95 on a learned noise, `wiener`'s Ephraim & Malah's 0.98; `omlsa`'s G<sub>min</sub> is the floor; and minimum statistics (`wiener`, `specsub`; noise-estimate 2.2) starts its smoother on the mean of the first frames, not on one periodogram that left 2.6 % of bins 10 dB low for the first 1.5 s. Against 0.2 on the test set: `omlsa` PESQ 2.40 → 2.36, STOI 0.916 → 0.919, SI-SDR 14.5 → 14.0, SIG 3.39 → 3.38, OVRL 2.86 → 2.84; `wiener` 2.34 → 2.36, 0.910 → 0.911, 14.0 → 14.3, 3.38 → 3.40, 2.81 → 2.84; `specsub` 2.24 → 2.26, 0.920 → 0.919, 12.5 → 12.8, 3.35 → 3.36, 2.77 → 2.79 (chosen on the training subset, where tracked `omlsa` went STOI 0.826 → 0.832, PESQ 1.83 → 1.82). On a learned noise (`omlsa` with `profile`, as audio's `denoise` runs it, G<sub>min</sub> −12 dB, the noise learned from the lead-in): PESQ 2.48 → 2.45, STOI 0.915 → 0.919, SIG 3.36 → 3.38, OVRL 2.89 → 2.88.

`omlsa` 0.4 reads the speech absence from the a priori SNR smoothed in the cepstrum, and on a learned noise the speech presence from γ averaged over neighbouring bins ([`omlsa`](#omlsa)). Chosen on the training subset; on the test set, once, 0.3 → 0.4, tracked: PESQ 2.362 → 2.364, STOI 0.919 → 0.920, SI-SDR 14.04 → 14.25 dB, SIG 3.382 → 3.384, BAK 3.43 → 3.47, OVRL 2.838 → 2.853, musical noise 0.49 → 0.48; on a learned noise (`node scripts/speech.mjs vbdemand omlsa-learned`, as audio's `denoise` runs it, 12 dB): 2.453 → 2.455, 0.919 → 0.920, 15.05 → 15.11, 3.380 → 3.367, 3.53 → 3.54, 2.875 → 2.874, 0.39 → 0.34. The clean utterances in: PESQ 4.288 → 4.287 tracked, 4.299 → 4.288 learned; steady white and pink noise alone 15 dB down at log kurtosis ratio 0.00 and 0.02. (The learned form was scored on the test set once before, its presence averaged over 64 ms of frames as the paper has it: PESQ 2.421, OVRL 2.885; the musical noise it left after music stops, measured on the training material, then took it to the frame alone.)

Tracking the noise, `omlsa` 0.5, `wiener` 0.4 and `specsub` 0.3 keep a program's held partials out of it (noise-estimate 2.3's `partials`, see [`omlsa`](#omlsa)). Chosen on the training subset (tracked `omlsa` PESQ 1.825 → 1.823, OVRL 2.543 → 2.542; `wiener` 1.819 → 1.820, 2.530 → 2.529; `specsub` 1.730 → 1.730, 2.459 → 2.462), music and VocalSet; on the test set, once, before → after: `omlsa` PESQ 2.364 → 2.361, STOI 0.920 → 0.920, SI-SDR 14.25 → 14.15 dB, SIG 3.384 → 3.383, BAK 3.467 → 3.466, OVRL 2.853 → 2.851, musical noise 0.48 → 0.49; `wiener` 2.355 → 2.359, 0.911 → 0.912, 14.29 → 14.29, 3.395 → 3.396, 3.431 → 3.430, 2.843 → 2.844, 0.49 → 0.50; `specsub` 2.264 → 2.270, 0.919 → 0.919, 12.80 → 12.76, 3.358 → 3.359, 3.363 → 3.362, 2.794 → 2.795, 0.35 → 0.36. The clean utterances in: PESQ 4.287 → 4.290, 4.03 → 4.07, 4.03 → 4.08; steady white and pink noise alone as before. Clean music, sung long tones and Slakh mixes cut by more than 3 dB: the table below. Tried and not taken: holding a partial from 54 ms on, not 0.3 s (more music kept, but the noise rising under a voice's harmonics was held down with them: PESQ −0.015 on the training speech); the spectral floor as the noise of a partial with no memory yet, at a take's start (the trumpet's first note kept, but DEMAND's low, peaked noises held as partials: PESQ −0.03); a 10 s window (a song's chords, repeated past it, were learned: Slakh mixes cut six times as much); the noise under a partial following the floor beside it (less music kept, more noise left under the voice). The trackers themselves: MCRA-2 (Rangachari & Loizou 2006; Loizou's `mcra2_estimation.m` constants per 10 ms) PESQ 1.72 against IMCRA's 1.83, music cut 1.7 times IMCRA's, steady noise alone 10–13 dB down with musical noise 1.0–1.1; Gerkmann & Hendriks's MMSE tracker (2012) with `partials` PESQ 1.849 (+0.024), but STOI −0.003, clean speech in 4.24 → 4.14, steady pink noise left with musical noise 0.33, and music hardly kept: it follows a held note within the 0.3 s before a partial is held. With the noise known exactly the learned form reaches PESQ 2.11 on the training subset: a tracker that gets there has to know the noise under the speech, which none of these do.

The open classical denoisers on the same 824, each given the noise as ours is: noisereduce 3.0.3 (stationary spectral gating, the lead-in as its noise clip) at 12 dB (`prop_decrease` 0.75): PESQ 2.409, STOI 0.921, SI-SDR 12.8, SIG 3.37, BAK 3.51, OVRL 2.861, musical noise 0.03; at full reduction 2.357, 0.910, 12.4, 3.22, 3.72, 2.825, 0.74; logmmse 1.5 (a port of Loizou's `logmmse.m`, noise from the lead-in, updated by its VAD) 2.350, 0.900, 14.7, 3.29, 3.52, 2.799, 0.73; FFmpeg 8.0.1's `afftdn` learning the lead-in, 12 dB: 2.048, 0.920, 8.6, 3.25, 3.14, 2.657, 0.20 (`anlmdn` at its defaults leaves the input as it is). Neural, for scale: DeepFilterNet3 limited to 12 dB 2.670, 0.939, 16.2, 3.49, 3.69, 3.026, 0.06; RNNoise 2.109, 0.890, 12.3, 3.28, 3.85, 2.935, 0.90. iZotope RX 12, below.

iZotope RX 12 Advanced on the same buffers (2026-10; audio's `bench/rx/denoise.mjs` hosts the VST3 plug-ins through Pedalboard, their output aligned to the input): Voice De-noise (adaptive, 12 dB) and Spectral De-noise (adaptive learning, 12 dB) at their defaults, and at their best PESQ on the training subset over their main knobs (Voice De-noise: reduction 12, 16 or 20 dB, filter Surgical or Gentle, master threshold −12 to +10 dB, Dialogue or Music; best 20 dB at +10. Spectral De-noise: quality Simple, Advanced or Extreme at 12, 20 or 30 dB; best Extreme at 20). On a learned noise each holds the print its adaptive mode learns over the lead-in (Learn is no plug-in parameter; Spectral De-noise hears the lead-in looped to 2 s at its shortest learning time, 0.5 s). VoiceBank+DEMAND test set, 824 utterances; "clean in": PESQ of every second clean utterance (412) through the same system; MN: musical noise:

| | PESQ | STOI | SI-SDR dB | SIG | BAK | OVRL | MN | clean in |
|---|---|---|---|---|---|---|---|---|
| noisy input | 1.967 | 0.921 | 8.45 | 3.322 | 3.116 | 2.685 | 0 | |
| `omlsa` | 2.361 | 0.920 | 14.15 | 3.382 | 3.474 | 2.854 | 0.49 | 4.29 |
| `omlsa`, `threshold` 4 dB | 2.472 | 0.914 | 15.45 | 3.366 | 3.627 | 2.905 | 0.36 | 4.26 |
| `wiener` | 2.359 | 0.912 | 14.29 | 3.398 | 3.440 | 2.848 | 0.50 | 4.07 |
| `specsub` | 2.270 | 0.919 | 12.76 | 3.359 | 3.367 | 2.797 | 0.36 | 4.09 |
| RX Voice De-noise | 2.367 | 0.918 | 7.30 | 3.332 | 3.468 | 2.818 | 0.31 | 4.42 |
| RX Voice De-noise, 20 dB, threshold +10 | 2.500 | 0.899 | 3.72 | 3.211 | 3.657 | 2.798 | 0.66 | 4.09 |
| RX Spectral De-noise | 2.216 | 0.917 | 13.94 | 3.328 | 3.378 | 2.800 | −0.02 | 4.26 |
| RX Spectral De-noise, Extreme, 20 dB | 2.381 | 0.919 | 13.91 | 3.279 | 3.455 | 2.786 | 0.36 | 4.06 |
| learned: audio's `denoise`, 12 dB | 2.455 | 0.920 | 15.13 | 3.369 | 3.559 | 2.881 | 0.32 | 4.28 |
| RX Spectral De-noise, learned | 2.191 | 0.923 | 15.64 | 3.354 | 3.336 | 2.798 | 0.09 | 4.30 |
| RX Spectral De-noise, learned, Extreme, 20 dB | 2.349 | 0.925 | 16.37 | 3.364 | 3.449 | 2.846 | 0.27 | |
| RX Voice De-noise, learned | 2.368 | 0.918 | 7.13 | 3.335 | 3.465 | 2.819 | 0.20 | |
| RX Voice De-noise, learned, 20 dB, threshold +10 | 2.528 | 0.901 | 3.55 | 3.224 | 3.666 | 2.812 | 0.50 | 4.20 |

At their defaults RX ties or trails: Voice De-noise's PESQ ties `omlsa`'s (+0.006 ± 0.011, paired 95 % interval) at OVRL −0.036 and SI-SDR −6.9 dB (it reports no latency and keeps six band thresholds; its output moves the waveform), Spectral De-noise trails on every measure, learned or adaptive. Tuned for PESQ, Voice De-noise leads, +0.139 ± 0.016 tracking and +0.073 ± 0.015 on the learned print: at 20 dB with its threshold at +10 dB it takes all within 10 dB of its noise estimate for noise, emptying the pauses PESQ marks down (BAK +0.18) at the voice's cost (SIG −0.17, STOI −0.022, SI-SDR −10.4 dB; clean speech in 4.29 → 4.09). Spectral De-noise's best, Extreme, looks 203 ms ahead (9727 samples of latency at 48 kHz, against a frame here) for +0.019 ± 0.016, OVRL −0.068. The same knob on `omlsa`, the noise read louder (`threshold`, 0.6), at its best on the training subset (+4 dB of 2 to 10; PESQ 1.823 → 1.858 there): 2.472, within 0.028 of Voice De-noise's best and over it on all else but BAK (3.627 against 3.657): OVRL +0.107, SIG +0.155, STOI +0.015, SI-SDR +11.7 dB, musical noise 0.36 against 0.66. It stays off by default: tracking clean music it cut 60 % of the music's time-frequency energy by more than 3 dB, not 42 % (below), clean speech in fell 4.285 → 4.256, and the training speech lost STOI 0.012. Voice De-noise passes clean speech higher at its defaults (4.42, against 4.29), where it differs most by leaving the clean takes' own room tone, which `omlsa` takes 15 dB down and PESQ counts as a change; RX leaves less musical noise at its defaults (0.31 and −0.02, against 0.49), at 12 dB of reduction against 15.

Ten Spoken Wikipedia narrations (raw OVRL 3.176): the noise floor (the quietest 500 ms, median over the takes) and the speech level (the loudest half of 50 ms frames) against the raw take:

| | SIG | BAK | OVRL | floor down | speech |
|---|---|---|---|---|---|
| `omlsa` | 3.473 | 4.089 | 3.204 | 14.7 dB | −0.03 dB |
| RX Voice De-noise | 3.452 | 4.098 | 3.191 | 6.3 dB | −0.31 dB |
| RX Voice De-noise, 20 dB, threshold +10 | 3.443 | 4.119 | 3.190 | 14.8 dB | −0.72 dB |
| RX Spectral De-noise | 3.461 | 4.091 | 3.198 | 11.2 dB | −0.21 dB |
| RX Spectral De-noise, Extreme, 20 dB | 3.455 | 4.109 | 3.202 | 17.2 dB | −0.28 dB |

Music under steady noise, Spectral De-noise's own ground: ten MUSDB18 test mixtures (Rafii et al. 2017), the strings and the jazz of `scripts/repair.js`, at 44.1 kHz, under white and pink noise and two DEMAND recordings (a hallway's room tone, a washing machine) 10 and 25 dB under the music's active level, 1.5 s of the noise alone before it (the learned systems learn there) and 1 s after: 96 takes. What a system does to the music and to the noise is read apart by phase inversion (Hagerman & Olofsson 2004: it hears music + noise and music − noise). SDR: the output against the clean music; NMR: its error's noise-to-mask ratio after ITU-R BS.1387's FFT ear model (under 0 dB, masked); cut: the music's time-frequency energy cut by more than 3 dB; HF: what is left of the music above 8 kHz; MN: musical noise of what is left of the noise, under the music and in the second after it stops. RX's settings were chosen by SDR on three MUSDB18 training mixtures (24 takes):

| | SDR dB | NMR dB | cut % | HF dB | MN, music | MN, after |
|---|---|---|---|---|---|---|
| input | 17.63 | −3.9 | 0 | 0 | 0 | 0 |
| audio's `denoise`, `omlsa` 0.5 (1024 frames) | 20.16 | −9.6 | 2.2 | −2.8 | 0.44 | 0.38 |
| audio's `denoise`, `omlsa` 0.6 (2048 frames) | 20.94 | −10.0 | 1.3 | −2.6 | 0.38 | 0.36 |
| RX Spectral De-noise, learned | 19.37 | −8.2 | 1.3 | −2.4 | 0.30 | 0.68 |
| RX Spectral De-noise, learned, Extreme, 20 dB | 20.23 | −10.6 | 2.9 | −3.5 | 0.43 | 1.00 |
| `omlsa`, tracking | 12.05 | −3.6 | 17.1 | −4.0 | 1.74 | 1.46 |
| RX Spectral De-noise, adaptive | 4.35 | −1.2 | 79.4 | −5.3 | 1.47 | 0.06 |

The learned `denoise` leads RX's SDR in each of the eight noises and levels (by 0.5 to 3.6 dB against its defaults, 0.1 to 1.7 against its best). RX's best reaches a lower NMR, on hiss 10 dB down above all (3.8 against 7.6 dB), by taking 20 dB where `denoise` takes its 12, and cuts more of the music for it (2.9 %, its top 3.5 dB down); at its defaults RX touches the music less under noise 25 dB down (its masking leaves the noise the music covers: SNR gained under the music 0.0 and 0.2 dB on the room tone and the machine, `denoise` 1.1 and 4.9). Adaptive, RX takes music for the noise: 79 % of it cut, against 17 % for `omlsa` tracking. The same music clean, nothing to remove (24 takes: the twenty MUSDB18 mixtures and the four recordings), cut by more than 3 dB: `omlsa` 42 %, `wiener` 43 %, `specsub` 33 %, RX Spectral De-noise adaptive 65 %, Voice De-noise 67 %: a tracker of any make learns what holds still as noise; the learned print is the way for music.

Tried on the training subset and not taken: the cepstral a priori SNR as the gain's ξ as well (tracked SIG −0.04, music cut 9.6 → 15.6 %); Gerkmann & Hendriks's MMSE noise tracker (2012) in place of IMCRA (tracked PESQ +0.04, OVRL +0.03, but STOI −0.008, clean speech in PESQ 4.24 → 4.08, music cut 9.6 → 28.5 %) or of minimum statistics in `wiener` (PESQ 1.82 → 1.87, steady-noise musical noise 0.53 → 0.79, music cut 14.5 → 28.5 %); that tracker started on a learned print (RX's "adaptive": OVRL −0.04, musical noise 0.40 on pink noise); the cepstral ξ in `wiener` (STOI +0.014, SIG −0.06); the averaged presence in the tracked gain (PESQ +0.015, a word's second frame after a pause 0.7 dB lower); the gain smoothed over frequency, in dB or linear, ±100 Hz (musical noise 0.46 → 0.22–0.29, speech cut by more than 3 dB 9.5 → 25–38 %). With the noise known exactly (the true noise's periodogram, recursively smoothed) the learned form scores PESQ 2.11 on the training subset (1.87 with the print) and leaves musical noise of 0.01 (0.46): what remains to be had is in the estimate of a noise that changes, not in the gain.

What each keeps of the speech, by shadow filtering (`node scripts/broadband.mjs`: each frame's gain, computed on the noisy mix, applied to the clean speech and to the noise alone): a word's second and third frame after 85 ms of pause, in ten Spoken Wikipedia narrations under pink noise 10 dB down; speech 20–50 dB under the take's loudest frame, and bins where it stands 0–5 dB over the noise (the MMSE-optimal Wiener gain keeps −3.9 dB there), in the test set's every fourth utterance; the noise taken; the share of clean speech, clean music (the four recordings `repair` uses), VocalSet's straight long tones (one per singer, 20) and Slakh2100 mixes (six, 60 s each: synthesized bands, never heard while choosing) cut by more than 3 dB. dB; each tracking system without → with noise-estimate 2.3's `partials` (the learned noise is held, not tracked):

| op | onset +1 | onset +2 | quiet | 0–5 dB | noise, VB | noise, narr. | clean cut % | music cut % | sung cut % | Slakh cut % |
|---|---|---|---|---|---|---|---|---|---|---|
| `omlsa` | −6.1 → −6.1 | −3.5 → −3.5 | −2.1 → −2.1 | −3.6 → −3.5 | −7.0 → −6.9 | −7.6 → −7.6 | 0.3 → 0.3 | 9.9 → 3.0 | 8.8 → 0.0 | 22.6 → 2.3 |
| `omlsa`, learned noise | −4.8 | −2.6 | −3.0 | −4.6 | −8.1 | −7.3 | 0.4 | – | – | – |
| `wiener` | −5.4 → −5.4 | −2.4 → −2.3 | −2.1 → −2.0 | −3.7 → −3.7 | −7.1 → −7.1 | −7.1 → −7.1 | 0.7 → 0.5 | 14.5 → 3.4 | 36.3 → 0.0 | 26.6 → 3.3 |
| `specsub` | −1.5 → −1.4 | −0.3 → −0.3 | −1.9 → −1.8 | −3.9 → −3.9 | −4.8 → −4.8 | −5.8 → −5.8 | 0.3 → 0.2 | 10.3 → 3.2 | 36.9 → 0.0 | 13.1 → 0.8 |

What a tracker still takes of clean music is where nothing tells the program from the noise: a note sounding from a take's first frame (most of the music cut left is the trumpet recording, which starts on one), and a dense mix no bin of which is ever free of it from the start (a song cut in mid-chorus). There a learned noise (`profile`; audio's `denoise`) is the way: the print says what the noise is.

The paper's α 0.92 kept more again (tracked, a word's second frame after a pause on the training narrations: −1.6 dB) but left musical noise on steady noise (log kurtosis ratio 0.99 and 1.81), as did the paper's q ≤ q<sub>max</sub> in place of the gate (0.24 and 0.46). Martin's time-varying optimal smoothing for minimum statistics kept more speech only by reading the noise low (pink noise 1.7 dB under; `wiener`'s noise taken on the training speech 5.0 → 3.8 dB, PESQ 1.79 → 1.73), and a −25 dB ξ<sub>min</sub> for `wiener` brought more musical noise (0.98 and 1.49) and lower PESQ and SIG: none was taken. Minimum statistics' fixed start costs clean music cut at the start of a take, where the first frame's low values used to hold the estimate down (music cut 12.5 → 14.5 % for `wiener`, all of it in the first 1.5 s of the 6 s trumpet loop, cut 8 → 20 % there; the other three tracks are unchanged). In the half second after music stops, `omlsa` on a learned noise leaves musical noise of 0.11 → 0.05 at G<sub>min</sub> −12 dB and 1.00 → 0.61 at −20 (0.3 → 0.4; 0.00 a second later). Its noise taken in all frames falls (narrations 8.4 → 7.3 dB) for what lies under the weak speech it now keeps; in pauses it is as before or more (training speech 9.7 → 10.1 dB).

The same test set at other rates (`vbdemand@RATE`), PESQ, STOI and OVRL, 0.2 → 0.3. At 16 kHz (8 ms steps) `wiener`'s α is as it was; at 22.05 and 44.1 kHz (5.8 ms) it rose per frame, 0.980 → 0.985, and its STOI fell 0.004:

| op | 16 kHz | 22.05 kHz | 44.1 kHz | 48 kHz |
|---|---|---|---|---|
| `omlsa` | 2.42 → 2.41, 0.915 → 0.918, 2.87 → 2.85 | 2.42 → 2.44, 0.915 → 0.916, 2.86 → 2.86 | 2.42 → 2.44, 0.915 → 0.916, 2.86 → 2.86 | 2.40 → 2.36, 0.916 → 0.919, 2.86 → 2.84 |
| `wiener` | 2.36 → 2.39, 0.912 → 0.911, 2.82 → 2.85 | 2.37 → 2.40, 0.913 → 0.909, 2.82 → 2.86 | 2.37 → 2.40, 0.913 → 0.909, 2.82 → 2.86 | 2.34 → 2.36, 0.910 → 0.911, 2.81 → 2.84 |
| `specsub` | 2.25 → 2.27, 0.920 → 0.919, 2.75 → 2.77 | 2.23 → 2.25, 0.920 → 0.919, 2.74 → 2.76 | 2.23 → 2.25, 0.920 → 0.919, 2.74 → 2.76 | 2.24 → 2.26, 0.920 → 0.919, 2.77 → 2.79 |

Frames follow the rate: the power of two nearest 32 ms, the papers' frame, where they were 2048 samples at every rate (128 ms at 16 kHz). The same test set resampled (`python scripts/speech.py resample vbdemand RATE`, then `vbdemand@RATE`), PESQ and OVRL, 2048 → rate's frame (0.2); 48 kHz keeps 2048:

| op | 16 kHz (512) | 22.05 kHz (512) | 44.1 kHz (1024) |
|---|---|---|---|
| `omlsa` | 2.25 → 2.42, 2.80 → 2.87 | 2.29 → 2.42, 2.81 → 2.86 | 2.39 → 2.42, 2.86 → 2.86 |
| `wiener` | 2.20 → 2.36, 2.75 → 2.82 | 2.24 → 2.37, 2.76 → 2.82 | 2.33 → 2.37, 2.81 → 2.82 |
| `specsub` | 2.16 → 2.25, 2.77 → 2.75 | 2.20 → 2.23, 2.78 → 2.74 | 2.24 → 2.23, 2.77 → 2.74 |

STOI holds or rises for `wiener` and `specsub` and falls 0.001–0.002 for `omlsa`; SI-SDR falls 0.3–0.7 dB for `omlsa` and `wiener` at 22.05 and 44.1 kHz, and 0.8–1.2 dB for `specsub`, which alone prefers the longer frame there (so it did on the training subset).

Reverberant speech (`vbreverb`): a quarter of the clean test utterances, 206, through 130 rooms of the MIT IR Survey (Traer & McDermott 2016), scored against the dry takes, DNSMOS at the input's loudness. `dereverb` 0.4 → 0.5; the rooms with a tail to hear, and iZotope RX 12, are in [`dereverb`](#dereverb)'s own section:

| | PESQ | STOI | SI-SDR dB | SIG | BAK | OVRL |
|---|---|---|---|---|---|---|
| reverberant input | 2.33 | 0.904 | −5.7 | 3.19 | 3.71 | 2.82 |
| `dereverb` | 2.62 → 2.61 | 0.908 → 0.908 | −5.1 → −5.1 | 3.28 → 3.29 | 3.86 → 3.86 | 2.93 → **2.94** |
| dry takes in (`vbreverb-dry`) | 4.64 | 1.000 | ∞ | 3.51 | 4.04 | 3.22 |
| dry, `dereverb` | 4.63 → **4.64** | 1.000 → 1.000 | ∞ (94 → **100 %** untouched) | 3.51 → 3.51 | 4.04 → 4.04 | 3.22 → 3.22 |

On the training utterances (`vbreverb-train`, 126): PESQ 2.36 → 2.64 → 2.61 (input, 0.4, 0.5). The constants were chosen on `scripts/dereverb.py train`: VoiceBank training speakers in the even-numbered rooms, 1.8–4.5 s utterances and 25–41 s takes. Of the 206 reverberant test utterances 18 % (0.4) and 25 % (0.5) come out untouched: rooms with little tail, which the dry and diffuse checks pass.


## Demo

`demo.html` is a self-contained browser demo: pick a noise scenario, pick a method (or `auto`), inspect input/output waveforms, hear the difference, and read the live classifier scores.


## References

- Boll, *Suppression of Acoustic Noise in Speech Using Spectral Subtraction*, IEEE TASSP 1979.
- Berouti, Schwartz, Makhoul, *Enhancement of Speech Corrupted by Acoustic Noise*, ICASSP 1979.
- Ephraim & Malah, *Speech Enhancement Using a Minimum Mean-Square Error Short-Time Spectral Amplitude Estimator*, IEEE TASSP 1984.
- Ephraim & Malah, *Speech Enhancement Using a Minimum Mean-Square Error Log-Spectral Amplitude Estimator*, IEEE TASSP 1985.
- Martin, *Noise Power Spectral Density Estimation Based on Optimal Smoothing and Minimum Statistics*, IEEE TSAP 2001.
- Martin, *Bias Compensation Methods for Minimum Statistics Noise Power Spectral Density Estimation*, Signal Processing 2006.
- Sohn, Kim & Sung, *A Statistical Model-Based Voice Activity Detection*, IEEE SPL 1999.
- Ruinskiy & Lavner, *An Effective Algorithm for Automatic Detection and Exact Demarcation of Breath Sounds in Speech and Song Signals*, IEEE TASLP 2007.
- Scalart & Vieira Filho, *Speech Enhancement Based on a Priori Signal to Noise Estimation*, ICASSP 1996.
- Cohen & Berdugo, *Speech Enhancement for Non-Stationary Noise Environments*, Signal Processing 2001.
- Cohen, *Optimal Speech Enhancement Under Signal Presence Uncertainty Using Log-Spectral Amplitude Estimator*, IEEE SPL 2002.
- Cohen, *Noise Spectrum Estimation in Adverse Environments: Improved Minima Controlled Recursive Averaging*, IEEE TSAP 2003.
- Cohen, `omlsa.m` (OM-LSA with IMCRA), [israelcohen.com/software](https://israelcohen.com/software/).
- Breithaupt, Gerkmann & Martin, *A Novel A Priori SNR Estimation Approach Based on Selective Cepstro-Temporal Smoothing*, ICASSP 2008.
- Gerkmann, Breithaupt & Martin, *Improved A Posteriori Speech Presence Probability Estimation Based on a Likelihood Ratio With Fixed Priors*, IEEE TASLP 2008.
- Gerkmann & Hendriks, *Unbiased MMSE-Based Noise Power Estimation With Low Complexity and Low Tracking Delay*, IEEE TASLP 2012.
- Gerkmann & Hendriks, *Improved MMSE-Based Noise PSD Tracking Using Temporal Cepstrum Smoothing*, ICASSP 2012.
- Uemura, Takahashi, Saruwatari, Shikano & Kondo, *Automatic Optimization Scheme of Spectral Subtraction Based on Musical Noise Assessment via Higher-Order Statistics*, IWAENC 2008.
- Valentini-Botinhao, *Noisy Speech Database for Training Speech Enhancement Algorithms and TTS Models*, University of Edinburgh 2017, [doi:10.7488/ds/2117](https://doi.org/10.7488/ds/2117).
- Reddy, Gopal & Cutler, *DNSMOS P.835*, ICASSP 2022.
- Janssen, Veldhuis & Vries, *Adaptive Interpolation of Discrete-Time Signals That Can Be Modeled as Autoregressive Processes*, IEEE TASSP 1986.
- Godsill & Rayner, *Digital Audio Restoration*, Springer 1998.
- Lebart, Boucher & Denbigh, *A New Method Based on Spectral Subtraction for Speech Dereverberation*, Acta Acustica 2001.
- Nakatani, Yoshioka, Kinoshita, Miyoshi & Juang, *Speech Dereverberation Based on Variance-Normalized Delayed Linear Prediction*, IEEE TASLP 2010.
- Yoshioka & Nakatani, *Generalization of Multi-Channel Linear Prediction Methods for Blind MIMO Impulse Response Shortening*, IEEE TASLP 2012.
- Kinoshita, Delcroix, Nakatani & Miyoshi, *Suppression of Late Reverberation Effect on Speech Signal Using Long-Term Multiple-Step Linear Prediction*, IEEE TASLP 2009.
- Habets, *Speech Dereverberation Using Statistical Reverberation Models*, in Naylor & Gaubitch (eds.), Speech Dereverberation, Springer 2010.
- Polack, *Playing Billiards in the Concert Hall: The Mathematical Foundations of Geometrical Room Acoustics*, Applied Acoustics 1993.
- Scheirer & Slaney, *Construction and Evaluation of a Robust Multifeature Speech/Music Discriminator*, ICASSP 1997.
- Falk, Zheng & Chan, *A Non-Intrusive Quality and Intelligibility Measure of Reverberant and Dereverberated Speech*, IEEE TASLP 2010 (SRMR).
- Traer & McDermott, *Statistics of Natural Reverberation Enable Perceptual Separation of Sound and Space*, PNAS 2016 (MIT IR Survey).
- Talkin, *A Robust Algorithm for Pitch Tracking (RAPT)*, in Kleijn & Paliwal (eds.), Speech Coding and Synthesis, Elsevier 1995.
- Boersma, *Accurate Short-Term Analysis of the Fundamental Frequency and the Harmonics-to-Noise Ratio of a Sampled Sound*, IFA Proceedings 17, 1993.
- Nelke & Vary, *Measurement, Analysis and Simulation of Wind Noise Signals for Mobile Communication Devices*, IWAENC 2014.
- Nelke, Naylor & Vary, *Wind Noise Short Term Power Spectrum Estimation Using Pitch Adaptive Inverse Binary Masks*, ICASSP 2015.
- Rangachari & Loizou, *A Noise-Estimation Algorithm for Highly Non-Stationary Environments*, Speech Communication 2006.
- Enzner & Vary, *Frequency-Domain Adaptive Kalman Filter for Acoustic Echo Control in Hands-Free Telephones*, Signal Processing 2006.
- Kuech, Mabande & Enzner, *State-Space Architecture of the Partitioned-Block-Based Acoustic Echo Controller*, ICASSP 2014.
- Valin, *On Adjusting the Learning Rate in Frequency Domain Echo Cancellation With Double-Talk*, IEEE TASLP 2007 (Speex MDF).
- Soo & Pang, *Multidelay Block Frequency Domain Adaptive Filter*, IEEE TASSP 1990.
- Mirchandani, Zinser & Evans, *A New Adaptive Noise Cancellation Scheme in the Presence of Crosstalk*, IEEE TCAS-II 1992.
- Carter, Knapp & Nuttall, *Estimation of the Magnitude-Squared Coherence Function via Overlapped FFT Processing*, IEEE TAU 1973.
- Kokkinis, Reiss & Mourjopoulos, *A Wiener Filter Approach to Microphone Leakage Reduction in Close-Microphone Applications*, IEEE TASLP 2012.
- Clifford & Reiss, *Microphone Interference Reduction in Live Sound*, DAFx 2011.
- Hagerman & Olofsson, *A Method to Measure the Effect of Noise Reduction Algorithms Using Simultaneous Speech and Noise*, Acta Acustica 2004.
- Rafii, Liutkus, Stöter, Mimilakis & Bittner, *The MUSDB18 Corpus for Music Separation*, 2017, [doi:10.5281/zenodo.1117372](https://doi.org/10.5281/zenodo.1117372).
- RBJ Audio EQ Cookbook (biquad coefficients).


## License

MIT
