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
| [declip](#declip) | time | hard clipping | ★★★★ | medium | clipped recordings, rails found by itself |
| [dewind](#dewind) | freq | wind, LF rumble | ★★★ | medium | wind under a voice, its harmonics kept |
| [deplosive](#deplosive) | time | LF bursts | ★★★ | low | mic plosives (p, b) |
| [deesser](#deesser) | time | sibilance | ★★★★ | low | voice (s, sh) |
| [debreath](#debreath) | time | inter-word noise | ★★★ | low | breath / hiss in pauses |
| [desilence](#desilence) | time | pauses | ★★★ | low | remove / shorten / trim silence, split by pause |
| [dereverb](#dereverb) | freq | late reverb | ★★★ | high | speech in a room |
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


## Tonal & narrowband

### `dehum`

Measures the hum, then subtracts it: each harmonic of the mains frequency is estimated as a slowly varying sinusoid and taken out, so what goes with the hum is the program within a fraction of a hertz of each line, and less of it where the program is loud there. Without hum the audio comes back untouched. Notches (0.2.0) took whatever their band held, a band that grows with the harmonic (Q 30: 1.7 Hz at 50 Hz, 33 Hz at 1 kHz), an orchestra's G2 two hertz under the 100 Hz line among it; and as the mains frequency wanders (±0.02–0.05 Hz, h times that at harmonic h) narrow ones miss the upper harmonics.

```js
dehum(data, { fs })                                            // 50 or 60 Hz, measured; nothing without hum
dehum(data, { fs, freq: 60 })                                  // the 60 Hz series, its exact frequency measured
dehum(data, { fs, freq: 60, harmonics: 4 })                    // remove 60–240 Hz as told
measure(data, fs)                                              // → { f0, harmonics } or null (import from @audio/denoise-dehum)
```

| Param | Default | |
|---|---|---|
| `freq` | measured | Fundamental, Hz. Omitted: the 50 or 60 Hz series, whichever stands out. Given: its exact frequency within ±0.4 % (±`drift` Hz with `adaptive`) |
| `harmonics` | to 1 kHz | Remove h = 1…`harmonics`. Omitted: every harmonic up to 1 kHz |

The measurement is one Fourier transform over the signal (its first 80–90 s, taken down to 3 kHz), where a hum line, steady for minutes, gathers into a peak 1/T wide while speech spreads. Hum is there when the fundamental stands out by 20 dB over the median of the ±8 Hz around it, or two of the first six harmonics by 15 dB (searched within ±0.4 %, the mains tolerance), each 6 dB over any other peak within 3 Hz, all of them harmonics of one fundamental (p<sub>h</sub>/h within 0.01 Hz). A bar of music repeated exactly is a comb of lines 1/bar apart (every 2 Hz at 120 bpm), lines at 50 and 60 Hz among them: none stands alone. On 164 music clips (MUSDB18 excerpts, BabySlakh) this finds hum in one, which has it (0.2.0: in 19); on 504 clean and 504 noisy VoiceBank training utterances, in one, a steady 49.86 Hz tone at the speech's level; with hum 20 dB under the speech, in 95 % (50 Hz) and 92 % (60 Hz) of them, as before.

Then the signal is cut into Hann frames four mains cycles long, two apart, and each harmonic's phasor taken per frame; the window's zeros fall on the other harmonics. Each harmonic's phasors are fitted over 2 s by weighted local-linear least squares (normalized convolution, Knutsson & Westin 1993), each frame weighted by the inverse of the program's power around the line there, so a passing voice or note is bridged from the frames around it rather than averaged in. The mains phase is tracked from the fitted phasors' turn, harmonics combined by h²·SNR (Hajj-Ahmad, Garg & Wu 2013) over 8 s, and the sinusoids are subtracted along it (harmonic subtraction, as power-line interference is taken out of ECG: Levkov et al. 2005). A cut in the recording jumps the hum's phase: within a second of it the fit blends the two phases and takes the hum ~10 dB down, not ~40. A note within ~0.5 Hz of a line for seconds is taken for hum. Whole clip (`streaming: false`), a second at least to measure; shorter, it removes the harmonics of a given `freq` as told and passes the audio through without one.

Measured by `node scripts/dehum.js`: the hum (12 harmonics at −6 dB per octave, levels drifting ±10 %, f0 0.05 Hz off nominal and wandering) and the program told apart by phase inversion (Hagerman & Olofsson 2004). 50 Hz hum 20 dB under the program, wandering ±0.02 Hz; program SDR per band where the band holds 1 % of the program:

| material | hum down, dB | program SDR, dB | <100 Hz | 100–300 | 300–1k | 1–4k | >4k |
|---|---:|---:|---:|---:|---:|---:|---:|
| speech | 45.5 | 38.5 | 28.9 | 39.2 | 39.2 | 83.0 | – |
| narration | 43.5 | 42.7 | – | 38.8 | 42.9 | 64.5 | 73.9 |
| vibeace | no hum found | | | | | | |
| brahms | 42.2 | 25.7 | 30.2 | 17.9 | 27.0 | 57.8 | 50.2 |
| nutcracker | 41.6 | 27.6 | 23.5 | 30.7 | 26.8 | 63.6 | – |
| trumpet | 51.0 | 47.9 | – | – | 42.2 | 82.3 | – |

Hum down / program SDR, dB:

| material | 60 Hz | 50 Hz, ±0.05 Hz | 50 Hz, 30 dB under |
|---|---|---|---|
| speech | 46.3 / 42.1 | 36.6 / 38.6 | 38.7 / 38.6 |
| narration | 43.6 / 44.0 | 33.8 / 42.8 | 42.3 / 42.9 |
| vibeace | no hum found | no hum found | no hum found |
| brahms | 41.7 / 29.0 | 27.8 / 25.7 | 33.9 / 25.7 |
| nutcracker | 40.7 / 24.3 | 33.2 / 27.9 | no hum found |
| trumpet | 51.9 / 47.8 | 46.0 / 47.7 | 48.4 / 48.0 |

The same mixtures through 0.2.0 (its Q 30 notches at the lines it found, run on hum and program apart): hum 5–15 dB down (26 in Vibe Ace at 60 Hz), program SDR 10–38 dB (speech 22.3, Brahms 13.6, its 100–300 Hz band 5.7). Hum alone, 30 s, ±0.02 Hz: 56 dB down (0.2.0: 26). Clean speech, narration and music: no sample changed. In Vibe Ace the hum's lines stand among the track's own steady ones, none alone, so none is taken for hum (0.2.0 found hum in the clean track); `freq` and `harmonics` remove them as told.

**Use when:** mains buzz, ground-loop hum, fixed tonal interference.<br>
**Not for:** broadband noise (use `wiener`/`omlsa`); shifting tones (use spectral methods).


### `dewind`

Takes wind out from under a voice or an instrument and leaves their harmonics. Wind is turbulence at the microphone: noise under a few hundred Hz with no period, in gusts (Nelke & Vary, IWAENC 2014), where a voice's low end is a row of harmonics. A high-pass can only take everything under its cutoff, the voice's low harmonics with the wind; here each STFT bin under `cutoff` is weighed against a wind spectrum read from the frame itself.

The frame is the power of two nearest 85 ms (4096 samples at 44.1 and 48 kHz), so a 100 Hz voice's harmonics stand 8 bins apart with valleys between them. The wind spectrum is the periodogram's morphological opening over 5 bins: every peak narrower than that is cut, and a steady harmonic under a Hann window is 4 bins wide, so the harmonics go and the broad wind stays (the inverse harmonic mask of Nelke, Naylor & Vary, ICASSP 2015, without a pitch track). Over 100 Hz it is held to 4× the least it has been over the last 1.5 s relative to its level under 100 Hz (minimum statistics, Martin 2001): wind keeps its shape while it gusts, and a voice's valleys, onsets and unvoiced sounds don't pass for it. The gain is OM-LSA's form (Cohen & Berdugo 2001): a Wiener gain on the decision-directed a priori SNR, raised to the speech presence probability, which takes a fixed 15 dB prior (Gerkmann & Hendriks 2012) and an a priori absence of 0.2 on a harmonic (a peak 6 dB over the wind), 0.9 elsewhere. So a harmonic keeps what of it stands over the wind, and the wind's own random peaks don't come through as musical noise.

It runs while wind blows: the 20–300 Hz band aperiodic (its normalized autocorrelation, taken through the frame's spectrum over the window's, under ½ at 2.5–25 ms; a harmonic H in noise N reads H / (H + N), Boersma 1993) and its noise over the 300–2000 Hz band, floored 20 dB under its peak over the last seconds, three frames in a row (a 150 ms gap between words shows it); then held 1 s, through the words, whose low end hides it. A bass line, a kick drum's body or a voice's low end repeats; a room's quiet rumble in a pause is no wind next to a voice. With no wind the output equals the input, sample for sample, `frameSize − 1` samples later (85 ms at 48 kHz, the manifest's declared latency).

```js
dewind(data, { fs: 48000 })                     // in place
let write = dewind({ fs: 48000 })               // stream: write(chunk) → the samples done, write() → the rest
```

| Param | Default | |
|---|---|---|
| `cutoff` | `1500` | Hz, the top of the band wind is taken from; read every frame |
| `attenuation` | `-20` | dB, the most a bin is turned down; `0` takes nothing |
| `frameSize` | 85 ms | STFT frame, a power of two; the hop a quarter |

`python scripts/wind.py fetch`, then `node scripts/lowend.js dewind` puts clean speech and music through it, then speech with wind: synthetic (Gaussian noise shaped and gusting as Nelke & Vary measure it), generated (the SC-Wind-Noise-Generator, Mirabilii et al., IWAENC 2022: spectrum and gusts by wind speed) and recorded (twelve CC0 recordings of wind on a microphone, freesound.org), half of the generated and recorded tuning the defaults, half below. VoiceBank+DEMAND test utterances (every fourth: p232 male, p257 female), ten Spoken Wikipedia narrations, the music `repair` uses, 0.2.0 → now; voiced frames thinned: the voiced 10 ms frames whose level under 250 Hz fell by more than 3 dB; their periodic part: whose periodic energy there (r·E, Boersma 1993) did:

| | untouched | voiced frames thinned | their periodic part | 20–63 Hz | 63–125 Hz | 125–250 Hz |
|---|---:|---:|---:|---:|---:|---:|
| speech, male | 0% → 0% | 5.1% → 9.1% | 4.9% → 7.2% | −0.2 → −1.7 | 0.0 → −0.5 | 0.0 → −0.1 |
| speech, female | 0% → 0% | 8.8% → 16.2% | 8.5% → 11.6% | −1.2 → −4.5 | −0.1 → −0.7 | 0.0 → 0.0 |
| narrations | 0% → 20% | 2.4% → 6.0% | 2.4% → 5.2% | −0.1 → −0.7 | −0.1 → −0.3 | 0.0 → −0.2 |
| audio-lena | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Vibe Ace (jazz) | 0% → 0% | 0.1% → 1.2% | 0.1% → 0.9% | 0.0 → −0.2 | 0.0 → −0.1 | 0.0 → −0.1 |
| Brahms (strings) | 0% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Nutcracker | 0% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| trumpet | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| bass line | 0% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |

A recording's own low rumble, where it outweighs the mid band in a pause, reads as wind: VoiceBank's room tone before each take engages it for the take's first second, and narrations recorded at home in their pauses. The rumble goes; the voiced frames that thin are onsets, whose low end an 85 ms frame smears into a broad bump that reads as floor, and frames whose low end is mostly that rumble. Orchestral music, a trumpet and a bass line come back untouched; a jazz track's drums engage it for moments.

Wind at a speech-to-wind ratio of +10, 0 and −10 dB, the error to the clean speech taken away (dB):

| | +10 dB | 0 dB | −10 dB |
|---|---:|---:|---:|
| synthetic | −0.1 → 5.1 | 2.4 → 9.9 | 5.6 → 13.1 |
| generated | −0.1 → 4.4 | 1.3 → 8.3 | 4.1 → 11.3 |
| recorded | −0.4 → 3.8 | 1.1 → 7.5 | 3.2 → 10.2 |

The wind removed and the speech kept, by phase inversion (Hagerman & Olofsson, Acta Acustica 2004: the op on s + n and on s − n, ŝ = (y₊ + y₋)/2, n̂ = (y₊ − y₋)/2), dB:

| | wind removed, +10 dB | 0 dB | −10 dB | speech kept, +10 dB | 0 dB | −10 dB |
|---|---:|---:|---:|---:|---:|---:|
| synthetic | 2.2 → 9.3 | 5.3 → 14.0 | 7.0 → 15.0 | −0.1 → −0.3 | −0.4 → −0.8 | −0.7 → −1.8 |
| generated | 1.7 → 8.8 | 3.5 → 12.4 | 5.4 → 13.3 | −0.1 → −0.4 | −0.5 → −1.2 | −0.7 → −3.0 |
| recorded | 1.3 → 8.0 | 3.1 → 10.8 | 4.0 → 11.4 | −0.1 → −0.4 | −0.4 → −1.1 | −0.3 → −2.1 |

PESQ (wideband), STOI and DNSMOS P.835 of the same outputs, the three winds together (`python scripts/wind.py score DIR/now test`; scored at 16 kHz as `scripts/speech.py` does):

| | PESQ | STOI | SIG | BAK | OVRL |
|---|---:|---:|---:|---:|---:|
| +10 dB: input | 1.76 | 0.939 | 3.51 | 3.36 | 2.89 |
| 0.2.0 | 1.67 | 0.937 | 3.47 | 3.44 | 2.90 |
| now | 2.30 | 0.935 | 3.34 | 3.61 | 2.88 |
| 0 dB: input | 1.21 | 0.874 | 3.25 | 2.44 | 2.31 |
| 0.2.0 | 1.23 | 0.870 | 3.26 | 2.66 | 2.41 |
| now | 1.58 | 0.875 | 3.20 | 3.19 | 2.58 |
| −10 dB: input | 1.06 | 0.754 | 2.06 | 1.43 | 1.43 |
| 0.2.0 | 1.09 | 0.753 | 2.36 | 1.67 | 1.63 |
| now | 1.16 | 0.756 | 2.83 | 2.41 | 2.08 |
| all: input | 1.34 | 0.856 | 2.94 | 2.41 | 2.21 |
| 0.2.0 | 1.33 | 0.853 | 3.03 | 2.59 | 2.31 |
| now | 1.68 | 0.855 | 3.12 | 3.07 | 2.51 |

STOI barely moves: its bands begin at 150 Hz, above most of the wind. In light wind DNSMOS's SIG drops 0.17; an ideal Wiener gain from the wind's own spectrum under 1.5 kHz lost 0.12 there on the tuning material.

0.2.0 high-passed only between the words: a voiced low end sent its filter out, so the wind under the words stayed. The wind now goes under the words too, between and under the harmonics; what a voice loses is mostly the harmonics the wind buries (its low end at −10 dB), and onsets.

**Use when:** wind on a microphone under a voice or an instrument, gusting or steady; a recording's low rumble (traffic, a fan) where it outweighs the mid band in the pauses.<br>
**Not for:** a lone thump (`deplosive`), a steady low tone or hum, which has a period (`dehum`, `highpass`), or broadband noise (`omlsa`, `wiener`). Air rushing over the whole band is taken only under `cutoff`. A neural model (`@audio/neural-denoise`'s DeepFilterNet3) takes more of the wind and keeps more of the voice; dewind leaves a sound with no aperiodic low end as it is (music, a voice with no rumble under it), streams at a frame's delay, and needs no model.


### `deplosive`

Ducks the band under `crossover` for a close-mic `p` or `b`: a pressure pulse that rises out of nothing, outweighs the band above it and has no period, where a voice's or a bass note's low end repeats at its pitch. A duck begins when the low band's 3 ms envelope jumps over 3× its 30 ms average while standing over `triggerRatio`× the high band, and holds while that lasts and the low band stays aperiodic: its normalized autocorrelation's peak at a 2.5–25 ms lag (Talkin 1995) under ½, where a harmonic part would lead (Boersma 1993). The high band is floored 20 dB under its peak over the last seconds, so a room's own rumble in a pause is no pop. The duck crossfades toward the high-passed sound, x − (1 − g)·(x − HP(x)), so it never lifts a band; with no pop the output equals the input sample for sample.

```js
deplosive(data, { triggerRatio: 4, attack: 0.002, release: 0.03 })
```

| Param | Default | |
|---|---|---|
| `triggerRatio` | `4` | LF/high envelope ratio a pop must exceed |
| `attenuation` | `-18` | dB cut on the LF band when triggered |
| `crossover` | `200` | Hz — LF/high split point |
| `attack` | `0.002` | s |
| `release` | `0.03` | s |

At full duck the response is −24 dB at 60 Hz, −17 at 100, −2.1 at 250 and −0.5 at 400 Hz; 0.1.10's g·LP + (x − LP), x − LP being no high-pass, gave −7.5, −3.1, +1.8 and +1.3 dB, and it ducked any low end over 4× the high band: a voice's, a jazz track's, a bass line's. `node scripts/lowend.js deplosive` puts clean speech and music through it, then speech with pops added (synthetic: half-sine pressure pulses of 20–60 ms under 150 Hz before each word that follows a pause; no recordings of real pops over their clean speech exist here). VoiceBank+DEMAND test utterances, Spoken Wikipedia narrations, the music `repair` uses, 0.1.10 → now; voiced frames thinned: the voiced 10 ms frames whose level under 250 Hz fell by more than 3 dB:

| | voiced frames thinned | 20–63 Hz | 63–125 Hz | 125–250 Hz |
|---|---:|---:|---:|---:|
| speech, male | 8.9% → 0.7% | −1.2 → −0.1 | −0.5 → 0.0 | −0.1 → 0.0 |
| speech, female | 16.3% → 2.2% | −3.4 → −0.2 | −0.3 → 0.0 | 0.2 → 0.0 |
| narrations | 2.4% → 0.0% | −0.7 → −0.2 | −0.2 → 0.0 | 0.0 → 0.0 |
| audio-lena | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Vibe Ace (jazz) | 41.3% → 0.4% | −4.3 → 0.0 | −2.9 → 0.0 | −0.6 → 0.0 |
| Brahms (strings) | 0.4% → 0.1% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Nutcracker | 3.6% → 0.1% | 0.0 → 0.0 | −0.1 → 0.0 | 0.0 → 0.0 |
| trumpet | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| bass line | 53.1% → 0.0% | −8.3 → −0.1 | −4.6 → 0.0 | 0.2 → 0.0 |

Pops peaking at 0.5, 1 and 2× the utterance's peak, the error to the clean speech taken away over each pop and the 150 ms after it (dB):

| | 0.5× | 1× | 2× |
|---|---:|---:|---:|
| speech, male | 11.5 → 11.0 | 13.6 → 13.2 | 14.4 → 14.5 |
| speech, female | 13.9 → 12.6 | 14.7 → 14.2 | 14.9 → 15.0 |

0.1.10 often met a pop with its duck already down on the pause's rumble before the word; it now waits for the pop, and takes the first few ms of it a little less.

**Use when:** mic plosives (`p`, `b`, `t`) producing low-frequency thuds.<br>
**Not for:** a kick drum or a bass note struck hard: so sudden a low end is ducked for its first few ms, before its period shows.


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

Power spectral subtraction with over-subtraction and a spectral floor (Berouti, Schwartz & Makhoul 1979): |Ŝ|² = |Y|² − α·N̂ where that stays above β·N̂, else β·N̂. Over-subtraction takes out the noise's peaks that plain subtraction leaves as musical tones; the floor, a fraction of the noise estimate, fills the valleys with a steady bed that masks what is left. α follows the frame's SNR (4 − 3/20·SNR: 4.75 at −5 dB down to 1 at 20 dB) unless fixed. The noise PSD is tracked by minimum statistics (Martin 2001) over a 1.5 s window, in batch and stream alike, unless a profile or a noise-only stretch is given. `processor(opts)` is the gain as an @audio/stft frame process, for a host running its own frames.

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
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to average for the profile |

**Use when:** quick baseline; offline cleanup with a known noise-only preamble.<br>
**Not for:** musical-noise-sensitive material — use `wiener` or `omlsa`.


### `wiener`

MMSE log-spectral amplitude (Ephraim & Malah 1985) or Wiener (Scalart & Filho 1996) gain on the decision-directed a priori SNR ξ = α·Â²(l−1)/λ(l−1) + (1−α)·max(γ−1, 0) (Ephraim & Malah 1984, eq. 51). α = 0.98 is theirs for an 8 ms frame step (§VI: 256 samples at 8 kHz, a new frame every 64) and is rescaled to the actual step as α<sup>Δt/8 ms</sup>, so the a priori SNR's memory holds in seconds; applied per frame until 0.3, it ran 1.8× longer at 48 kHz (10.7 ms steps) than at 44.1 kHz (5.8 ms). The floor ξ<sub>min</sub> stays −15 dB: −25 dB, Cohen's and Loizou's, left more musical noise on steady white and pink noise (log kurtosis ratio 0.98 and 1.49, against 0.53 and 1.01) and cost PESQ and SIG on the training speech (`scripts/speech.mjs`). The noise PSD λ is tracked by minimum statistics (Martin 2001) over a 1.5 s window, in batch and stream alike, unless a profile or a noise-only stretch is given. `processor(opts)` is the gain as an @audio/stft frame process, for a host running its own frames.

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
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to average for the profile |

**Use when:** transparent broadband denoise; the "safe default" for stationary noise.


### `omlsa`

Optimally-Modified Log-Spectral Amplitude estimator (Cohen & Berdugo 2001) with IMCRA noise estimation (Cohen 2003). The log-spectral amplitude gain when speech is present, weighed against a floor by the speech presence probability p: `G = max(G_H1, G_min)^p · G_min^(1−p)` (eq. 16 with G<sub>H1</sub> floored at G<sub>min</sub>: as written it took a bin below G<sub>min</sub> wherever G<sub>H1</sub> was under it, to −18 dB at G<sub>min</sub> −12, so `gMin` was not the floor). The a priori SNR is decision-directed on G<sub>H1</sub> (eq. 18), the a priori speech absence is estimated from the spread of an a priori SNR over time and neighbouring bins (§4), the noise spectrum comes from IMCRA. As Cohen's own `omlsa.m`, a bin whose speech absence reaches 0.9 counts as noise: noise that happens to peak keeps G<sub>min</sub> and leaves no musical tone, so what remains of the noise is the noise, G<sub>min</sub> quieter. Time constants, the decision-directed α among them, are set for 8 ms frames and rescaled to the actual frame step (`omlsa.m` rescales by the reciprocal, which lengthens them at 48 kHz).

α sets how soon ξ follows a word's start after a pause, and how much gain a noise peak gets. Until 0.3 it was 0.98 per frame, whatever the frame (0.985 per 8 ms at 48 kHz, 0.972 at 44.1), and a word's second and third frames after a pause lost 10 and 5 dB. It is now the lowest value per 8 ms that leaves steady white and pink noise without musical noise: 0.97 tracking the noise (log kurtosis ratio 0.00 at G<sub>min</sub> −15 and −25 dB; 0.96 left 1.16 and 0.49 at −25, the paper's 0.92 0.99 and 1.81 at −15), 0.95 on a learned noise (`omlsa.m`'s; 0.92 left 0.19 and 0.42). The paper's cap q ≤ q<sub>max</sub> = 0.95 (Table 1) in place of the gate kept a word's second frame after a pause another 3 dB but left musical noise on steady noise (0.24 and 0.46 at α 0.97), so the gate stays. The table under [Speech](#speech) has what each keeps. `scripts/reference.py` holds a numpy version written from the papers; on 16 kHz VoiceBank frames it gives `omlsa.m`'s noise track, speech absence and gains to the last bit (but for near-empty bins, where `omlsa.m`'s absolute 1e-10 floors bind), and test.js holds this code to it.

The a priori SNR the speech absence is read from is smoothed in the cepstrum (Breithaupt, Gerkmann & Martin 2008): the speech power's maximum-likelihood estimate λ·max(γ−1, ξ<sub>ml,min</sub>), its cepstrum smoothed over time per quefrency, hardly where speech lives (the envelope's low quefrencies, the pitch's peak), much where a lone noise peak lives, and back. The decision-directed ξ (Cohen's, `qFrom: 'dd'`) lags a word's start after a pause, and takes a short burst of noise the tracker cannot follow for speech; the cepstral one follows a word's envelope at once and smooths a lone spectral peak away. Its constants are Table 1's, per 16 ms of frame step, but under 1.25 ms of quefrency Gerkmann & Hendriks's (ICASSP 2012: 0 and 0.2, where the 2008 paper's 0.5 and 0.7 lag an onset as the decision-directed ξ does) and above it 0.9: the least that leaves steady white and pink noise on a learned noise free of musical noise (0.85 left 0.22 on pink). On the training speech, tracked: PESQ 1.823 → 1.825, STOI 0.832 → 0.834, OVRL 2.525 → 2.543, BAK 3.00 → 3.04, musical noise 0.82 → 0.80; 40 ms tone bursts in steady noise pass at −6.5 dB (were −2.6). The cepstral ξ as the gain's own ξ as well lost voiced speech where the pitch glides (SIG −0.04), so the gain keeps the decision-directed one.

A noise that holds still can be learned instead: `profile`, the noise's PSD (`noiseProfile` of a stretch where it plays alone), or, in the batch form, `noiseFrames`/`profileFrom`/`profileTo` naming that stretch. The noise is then held (`known` of @audio/noise-estimate), and p reads the observation: γ averaged over 105.5 Hz and over 543 Hz of the frame, at fixed priors (Gerkmann, Breithaupt & Martin 2008: the averaged γ is χ² with r degrees of freedom from the Hann window's correlation across bins, ξ<sub>fix</sub> the a priori SNR that minimizes false alarms plus misses, eq. 13; at 48 kHz r 5.7 and 24, ξ<sub>fix</sub> 9.4 and 5.1 dB), and 0 where the estimated q reaches 0.9, as before. Until 0.4 it read γ in each bin alone, at ξ<sub>H1</sub> = 15 dB (Gerkmann & Hendriks 2012), and speech 0–5 dB over the noise lost 7.8 dB on the training speech, where the MMSE Wiener gain keeps 3.9. The paper averages over 64 ms of frames as well; presence then outlasted a sound by those frames, and in the half second after music stopped the noise came through in tones (log kurtosis ratio 0.45 at G<sub>min</sub> −12 dB, 1.77 at −20): over the frame alone. On the training speech, G<sub>min</sub> −12 dB: PESQ 1.861 → 1.867, OVRL 2.564 → 2.572, BAK 3.05 → 3.08, musical noise 0.53 → 0.46, speech 0–5 dB over the noise −7.8 → −5.1 dB, the noise taken in pauses 9.7 → 10.1 dB. Steady noise under speech and music goes exactly G<sub>min</sub> down, with no musical noise from −12 to −20 dB (log kurtosis ratio 0.00); in the half second after music stops, 0.05 at −12 dB and 0.61 at −20 (0.3: 0.11 and 1.00; `scripts/broadband.mjs`). Tracking the noise from the print (Gerkmann & Hendriks 2012's MMSE tracker started on it, RX's "adaptive") lost OVRL 0.04 and left musical noise (0.40 on pink): the print is held. `processor(opts)` is the gain as an @audio/stft frame process, for a host running its own frames: audio's `denoise` op learns a print from a range and runs it so.

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
| `frameSize` | power of two nearest 32 ms | STFT frame: 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48 (`frame(fs)`) |
| `hopSize` | `frameSize/4` | |
| `profile` | tracked | A known noise PSD (`frameSize/2+1` bins), held |
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to learn the profile from (batch) |

**Use when:** speech in non-stationary noise (street, café, car); generally the highest-quality choice for noisy speech. A steady noise with a stretch of it alone (hiss, hum, a fan, room tone): learn it, `profile`.


## Impulses

### `declick`

Finds each click as an outlier of the AR prediction error and rebuilds it from the sound either side. The error is judged against its own median level over ±12 ms, so a click can't raise the bar it must clear; the model is fitted again with the outliers left out, since a loud click otherwise teaches it its own ringing and only its onset stands out. A click spans where the error stays over 3× that level after its onset; one with a like half its size 2.5–15 ms away is a glottal pulse or a plucked string, and is left alone. Each is rebuilt by least-squares AR interpolation over 46 ms either side ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arBridge`, Janssen 1986 / Godsill-Rayner 1998). Samples no click reaches come back bit-exact.

```js
declick(data, { fs: 44100 })                                          // everywhere
declick(data, { fs: 44100, regions: [{ at: 12.31, duration: 0.02 }] }) // the clicks seen there
```

| Param | Default | |
|---|---|---|
| `threshold` | `8` | how far over the error's local level a click stands, multiples |
| `longest` | `6` | longest click rebuilt, ms; longer is taken for real sound |
| `order` | `32` | AR order of the detection |
| `regions` | — | `[{ at, duration }]`, s: look only there, and take nothing there for a pulse or too long |
| `fs` | `44100` | sample rate, Hz |

`node scripts/declick.js` adds clicks to speech (audio-lena) and music (librosa/data, as `repair`), one every 0.25–0.45 s at 2, 5 and 15× the sound's RMS around it, and measures how much of each click's error is gone (median dB, over the click and 1 ms either side) and the share gone by 10 dB or more:

| click | 2× | 5× | 15× |
|---|---:|---:|---:|
| tick (rings at 2–8 kHz, 0.05–0.3 ms) | 13.4 dB · 60% | 17.5 dB · 88% | 25.4 dB · 99% |
| pop (300–1500 Hz, 0.3–1 ms) | 5.7 dB · 30% | 12.9 dB · 60% | 18.2 dB · 86% |
| glitch (1–8 samples off) | 15.5 dB · 71% | 20.5 dB · 90% | 29.4 dB · 99% |
| mouth (1–3 ms of noise) | 9.3 dB · 49% | 17.8 dB · 86% | 25.6 dB · 100% |

0.1.7 (AR(60) on its own window, σ including the click, 2 samples either side): ticks 5–6 dB, pops 0, mouth clicks 4–6 dB. The clean material through it: speech, Brahms and the trumpet untouched (0.1.7 changed 2295, 123 and 2283 samples, the trumpet to −19 dB), "Vibe Ace" 112 samples at −42 dB. Each click's surroundings (3–20 ms either side) given as `regions`: the same within 0.5 dB; regions over the clean material change nothing. Ticks at 2× are as far as the interpolation reaches: rebuilt at their exact span, they come out the same. 10 s in 0.1 s.

**Use when:** vinyl ticks, edit clicks, digital glitches, mouth clicks on a voice; a click seen on a spectrogram, given as a region.<br>
**Not for:** dense crackle (use `decrackle`); long dropouts (use `repair`).


### `decrackle`

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


### `declip`

Finds where a sound was cut flat and rebuilds what the cut took off. A hard clip piles every sample it cuts onto one level, its rail. Each side's rail is the sound's extreme there, taken when the samples within 0.1 % of it outnumber those in the next 0.1 % below tenfold and most of them sit in runs: the top-bin test of FFmpeg's `adeclip` (1000 bins, ratio 10), made relative to the rail so it holds at any level (and never finer than one step of a 16- or 24-bit grid), and per side, so one rail or two different ones are found. A loud peak is one sample; a limiter's ceiling is touched by single samples or by arches, and a sine's top is an arch, which fill the band below about as densely: sound with no rail comes back bit-exact. Then, per window of 186 ms (hop half, crossfaded), every sample at a rail is unknown at once: AR(256) fitted to the window under its taper, all of them solved by exact least squares ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arFill`), each held at least as far out as it was recorded (a clip only ever lowers a sample: the consistent set of A-SPADE, Kitić, Bertin & Gribonval 2015), the model refitted to the filled window and the solve repeated, 8 times (Janssen, Veldhuis & Vries 1986). Runs of any length; samples off the rails come back bit-exact.

```js
declip(data, { fs: 44100 })                                    // each side's rail found; none: untouched
declip(data, { fs: 44100, clipLevel: 0.95 })                   // a known rail, ±0.95
```

| Param | Default | |
|---|---|---|
| `clipLevel` | auto | the rail, ± this; omitted or 0: found per side |
| `order` | `256` | AR order of the rebuild; `512` takes dense music up to 2 dB closer and speech further, in about 3× the time |
| `fs` | `44100` | sample rate, Hz |

`node scripts/declip.js` clips speech (audio-lena) and music ("Vibe Ace", Brahms, the trumpet loop, as `repair`), 6 s of each, peak-normalized and cut at the level that leaves the clipped sound 3–20 dB from the original (the input SDR of the declipping survey, Záviška, Rajmic, Ozerov & Rencker 2021), and measures the SDR after, dB, declip (finding the rails itself) · FFmpeg `adeclip` at its defaults:

| input SDR | 3 dB | 7 dB | 10 dB | 15 dB | 20 dB |
|---|---:|---:|---:|---:|---:|
| speech | 11.6 · 5.0 | 24.2 · 12.1 | 31.2 · 16.9 | 37.7 · 24.0 | 42.4 · 30.5 |
| "Vibe Ace" | 9.3 · 5.0 | 15.6 · 10.3 | 19.7 · 14.0 | 26.5 · 19.9 | 32.9 · 24.6 |
| Brahms | 8.5 · 3.9 | 16.1 · 10.2 | 20.0 · 14.4 | 26.4 · 19.8 | 34.0 · 23.8 |
| trumpet | 15.1 · 4.1 | 31.4 · 10.4 | 45.6 · 14.8 | 46.1 · 21.4 | 59.0 · 25.0 |

A-SPADE as the survey's code runs it (`--spade`: 186 ms blocks, a twice-redundant DFT, s = r = 1, ε = 0.1): speech 9.7 / 22.4 / 27.6 / 33.7 / 37.7, "Vibe Ace" 13.2 / 19.0 / 24.4 / 29.0 / 33.0, Brahms 12.9 / 18.0 / 21.0 / 26.3 / 31.8, the trumpet 17.7 / 31.4 / 37.2 / 49.8 / 57.0: ahead of declip in 9 of the 15 music cases, by 1.0–4.7 dB (each at 3 dB, "Vibe Ace" up to 15 dB), within 0.1 dB in 3, behind in 3 (the trumpet at 10 dB by 8.4); behind it on speech at every level, by 1.8–4.7 dB; in 27–65 s per second of sound. VoiceBank+DEMAND's test set, every 20th utterance clipped to 10 and 20 dB: declip 19.8 and 32.4 dB, `adeclip` 16.0 and 28.2.

Rails are found at the 20 dB level clipped asymmetrically (with the 10 dB level below), on one side only, then turned down to 0.4, quantized to 16 bits plain or dithered, and on a 16-bit converter driven 2.5 dB over (rails at 32767 and −32768): 10 dB or more of SDR gained in each. The unclipped material through it, as it is, peak-normalized, at 16 bits and through a lookahead limiter 12 dB over its ceiling: not a sample changed; nor in any of VoiceBank+DEMAND's 824 clean test utterances. 0.1.7 took the most populated level over half scale for the rail: on unclipped sound peaking over it, a limiter at half scale (151–43,538 samples changed per 6 s; the overdriven converter's Brahms 41.1 → 21.3 dB), while clipping at other levels it mostly left as it was (3–20 dB in, the same out). It takes about 0.1 s per second of sound clipped at the 20 dB level, 0.5 s at 10 dB, 5 s at 3 dB (`adeclip`: 0.07, 1.3 and 23 s on the same machine).

**Use when:** digital clipping: a converter overdriven, a mix bounced too hot, a plug-in's hard clip; at any level, on either side or both.<br>
**Not for:** clipping that has since been through lossy coding or resampling (the plateau is no longer flat, and no rail is found); soft saturation, tape or tube, which has no rail.


## Reverb

### `dereverb`

Late reverberation off a voice, one microphone, the whole take at once. First weighted prediction error, WPE (Nakatani et al. 2010): in each STFT bin, what the frames 50 to 160 ms back predict of the current one is the room's tail, and is subtracted; the prediction is fitted over the whole take, each frame weighted by its inverse power, three times. The room is one for the take and the voice is not, so the fit learns the room. One microphone cannot invert a room, and the prediction cancels a dB or two of the tail; but its taps measure the room. The power they carry from the past into a frame is the late reverberation's power, which Lebart et al. (2001) and Habets (2010) model from a decay time and a direct-to-reverberant ratio: here neither is estimated, and on a dry voice the taps are near zero. A log-spectral-amplitude gain (Ephraim & Malah 1985) takes that power off what WPE left, floored at −14 dB, and no bin leaves louder than it came. Below 500 Hz the estimate falls 3 dB an octave: there a voice's harmonics hold their phase longest and the taps learn some of them as room. A bin cut to digital silence (an edit, a gate) is left out of the fit. About 0.1 s per second of 48 kHz sound.

```js
dereverb(data, { fs: 48000 })
dereverb(data, { fs: 48000, strength: 0.5 })   // a lighter hand
```

| Param | Default | |
|---|---|---|
| `strength` | `1` | Scale of the late-reverberation estimate: 0 is the linear prediction alone, 2 takes more of the tail and more of the voice |

Measured (`python scripts/dereverb.py`, test set): 42 VoiceBank test utterances (1.6–5.9 s), and four 41–60 s takes of ten utterances by one speaker, in 19 MIT IR Survey rooms the tuning never heard (T60 0.38–1.85 s). Each room's response is split at direct + 50 ms: under it, the voice as the room colours it; over it, the tail to take. Voice lost: the output's power where the voice is 10 dB over the tail; tail taken: where the tail is 10 dB over the voice. PESQ and STOI against the dry take; SRMR (Falk et al. 2010) higher is drier; DNSMOS at the input's loudness; a dry voice through it, PESQ. 0.2 → 0.3:

| | voice lost dB | tail taken dB | PESQ | STOI | SRMR | OVRL | dry voice, PESQ |
|---|---|---|---|---|---|---|---|
| short takes in | | | 1.39 | 0.774 | 3.98 | 2.19 | 4.64 |
| short, `dereverb` | −0.32 → −0.81 | −1.7 → **−6.2** | 1.45 → **1.50** | 0.793 → 0.768 | 4.56 → **6.90** | 2.28 → **2.47** | 4.42 → 4.25 |
| long takes in | | | 1.37 | 0.739 | 3.43 | 1.98 | 4.64 |
| long, `dereverb` | −0.13 → −0.25 | −1.1 → **−3.3** | 1.43 → **1.49** | 0.756 → 0.749 | 3.83 → **4.99** | 2.03 → **2.43** | 4.58 → 4.58 |

`strength` 0, 1, 2, 4: on the short takes the tail −1.4, −6.2, −7.7, −9.0 dB for the voice −0.12, −0.81, −1.18, −1.64, a dry voice's PESQ 4.51, 4.25, 4.17, 4.10; on the long ones the tail −0.9, −3.3, −4.5, −6.0 for the voice −0.02, −0.25, −0.41, −0.65. A sung voice passes (VocalSet: SI-SDR 19.4 → 35.3 dB, 125–250 Hz −2.55 → −0.45 dB). STOI falls 0.025 on the short takes, the gain's cost; PESQ, SRMR and DNSMOS rise.

0.2 fitted the prediction recursively, over its last second: it learned some of the voice as room (−0.32 dB of the voice for 1.7 dB of the tail), and alone it cannot take much more (at 30 taps, about 4 dB of the tail for 0.6 dB of the voice). Late-reverb subtraction at each room's measured T60 (Lebart; Habets's κ) took 6 dB for −0.4 dB of the voice on the training takes, but it needs the T60, which free-decay estimates did not give on 3 s takes (correlation −0.3 to 0.2 with the measured one), and it took a dry voice for a room (PESQ 3.7). DeepFilterNet3 (`@audio/neural-denoise`), a denoiser that also learned to take reverberation, took 6.6–8.1 dB of the tail on the training takes and 2.1–2.9 dB of the first 50 ms, early reflections with the tail: PESQ 1.71–1.74 against 1.70 here, STOI 0.84 against 0.82.

**Use when:** a voice in a room, one microphone, one room per take.<br>
**Not for:** music or anything holding a pitch: a held note is predictable, and taken for room (music loses 2–5.5 dB under 1 kHz; 0.2 lost 1–4.3). Noise: denoise first.


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

VAD-driven inverse gate: what [`vad`](#lower-level-building-blocks) does not call speech (breaths, mouth noise, the room between phrases) goes down by `range`. Speech is voicing and the sound over the noise floor next to it, so a soft word in noise stays and a breath that a pause parts from the phrase goes. A gap under 0.15 s is no breath (a breath lasts 0.15–0.6 s, Ruinskiy & Lavner 2007) and stays; the gain holds 50 ms past speech. The whole clip is read at once (streaming: false), so the gain is zero-phase: it rises over `attack` before speech starts and falls over `release` after it ends.

```js
debreath(data, { range: -10 })                                // -10 dB between phrases (default -12)
```

| Param | Default | |
|---|---|---|
| `range` | `-12` | dB — how far everything between phrases goes down |
| `attack` | `0.005` | s — the gain rises over this before speech starts |
| `release` | `0.1` | s — and falls over this after speech ends |

`snrTh` and `flatTh` (0.1) are gone: they tuned the old detector, whose floor was the 10th-percentile frame energy of the whole input. Under noise that percentile is the noise, and every word under 9 dB over it went down. Measured with `python scripts/vad.py` (VoiceBank+DEMAND test set, ten Spoken Wikipedia narrations; defaults chosen on the training subset and ten other narrations), 0.1.8 → 0.2.1, frames turned down by over 3 dB:

| | voiced | word edges |
|---|---:|---:|
| VoiceBank+DEMAND, 824 noisy | 5.87 → **0.06** % | 24.55 → **0.30** % |
| the same, clean | 0.03 → 0.09 % | 1.22 → **0.60** % |
| 10 narrations | 0.07 → 0.05 % | 0.23 → 0.03 % |

Breaths (350 ms of noise through three wide resonances, 500/1500/2500 Hz) put into the narrations' pauses, ending G before the next phrase, 35 and 25 dB under the speech: median gain, share turned down by 6 dB or more.

| G | −35 dB | −25 dB |
|---|---|---|
| 0.05 s | −6.6 dB, 53 % → **−11.1 dB, 55 %** | −0.2 dB, 45 % → 0.0 dB, 13 % |
| 0.15 s | −2.9 dB, 44 % → **−11.7 dB, 81 %** | −0.1 dB, 44 % → **−11.4 dB, 74 %** |
| 0.3 s | −4.0 dB, 50 % → **−11.8 dB, 75 %** | −3.2 dB, 50 % → **−11.8 dB, 69 %** |
| 0.5 s | −11.5 dB, 55 % → **−12.0 dB, 91 %** | −11.5 dB, 55 % → **−11.6 dB, 73 %** |

A breath within 0.3 s of a vowel, parted from it by less than 0.15 s, reads as the word's onset and stays: that is where consonants lie, parted from the vowel at most by a stop's closure. A loud breath that close to a phrase went down more often before (45 → 13 %), and so did a quarter of the word edges in noise.

Noise after speech goes down: 1.5 s of noise after 1.5 s of a VoiceBank utterance, frames from 0.4 s on turned down by 6 dB or more, white, pink and brown 94 %, the office 99 %; noises with talkers in them (bus, cafe, public square) stay, as speech. 0.2.0 kept white and pink noise after speech whole (its VAD read voicing off the Wiener estimate, which peaks on any noise). Music, frames within 30 dB of the loudest turned down by over 3 dB: Vibe Ace 37.4 → 0.67 %, Nutcracker 22.1 → 0 %, trumpet 0 → 0 %, four sung excerpts (VocalSet) up to 21.6 → up to 0.39 %, but Brahms (strings) 4.29 → 9.35 %: an orchestra raises its own floor (0.2.0: 0.02 %).

**Use when:** breath, mouth noise, hiss in pauses on a voiceover.<br>
**Not for:** a breath that runs into a word; whispered speech (it holds no voicing: it goes down whole).


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

0.1 read silence under 11 dB over the input's 10th-percentile frame energy: under noise that percentile is the noise, and whole words went. Measured with `python scripts/vad.py` (as `debreath` above), `shorten` at its defaults, 0.1.1 → 0.2.1, frames cut:

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


## Measurements

`npm run measure` produces a Markdown table of SNR / segSNR / LSD / NRR per method on canonical scenarios. Headline numbers on the included `audio-lena` fixture (8 s mono speech, 44.1 kHz):

| scenario | SNR-in | best method | SNR-out | NRR | ms |
|---|---:|---|---:|---:|---:|
| 60 Hz hum + harmonics | -5.2 dB | `dehum` | 40.4 dB | 6.4 dB | 65 |
| white noise (~13 dB SNR) | 13.3 dB | `wiener` | 20.5 dB | 0.3 dB | 82 |
| clicks (vinyl-style) | 24.1 dB | `declick` | 46.2 dB | — | 227 |
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

The same clean utterances in: PESQ 3.06 → 4.29 (`omlsa`), 3.97 → 4.03 (`wiener`), 4.30 → 4.03 (`specsub`, which now subtracts an unbiased noise estimate), 3.20 → 4.64 (`dehum`: no hum found, output equals input). Stationary white and pink noise alone, 8 s: `omlsa` takes it 15 dB down with log kurtosis ratio 0.00 (was +0.53 and +0.30), `wiener` 15.5 dB at +0.53 and +1.01 (was 10 dB at +0.93 and +1.35), `specsub` 12 dB at +0.78 and +1.44 (was 4 dB at +0.48 and +0.58). With mains hum 20 dB under the clean utterances (12 harmonics at −6 dB per octave, 0.05 Hz off nominal), `dehum` takes PESQ from 2.64 to 4.17 at 50 Hz and from 2.48 to 4.26 at 60 Hz, SI-SDR from 20.0 to 39.1 and 41.5 dB, STOI to 0.998 (0.2.0's notches: PESQ 2.88 and 2.76, SI-SDR 23.8 and 24.2 dB); alone, that hum goes 110 and 87 dB down (0.2.0: 44.6 and 50.0).

Ten Spoken Wikipedia narrations, 60 s each (volunteers at home; raw OVRL 3.17): `omlsa` SIG 3.25 → 3.46 (raw 3.45), BAK 4.00 → 4.09, OVRL 2.96 → 3.20, speech level −1.1 → −0.04 dB, noise floor median −76 → −75 dBFS. Room tone stays: G<sub>min</sub> is 15 dB, so only a room already under −75 dBFS ends under −90 (one of the nine, raw −83).

In the rows above, `omlsa` 0.3 and `wiener` 0.3 take the decision-directed α per 8 ms of frame step, as their papers quote it, where it was per frame (the a priori SNR's memory ran 1.8× longer at 48 kHz than at 44.1); `omlsa`'s is the lowest per 8 ms that leaves steady noise free of musical noise, 0.97 tracking and 0.95 on a learned noise, `wiener`'s Ephraim & Malah's 0.98; `omlsa`'s G<sub>min</sub> is the floor; and minimum statistics (`wiener`, `specsub`; noise-estimate 2.2) starts its smoother on the mean of the first frames, not on one periodogram that left 2.6 % of bins 10 dB low for the first 1.5 s. Against 0.2 on the test set: `omlsa` PESQ 2.40 → 2.36, STOI 0.916 → 0.919, SI-SDR 14.5 → 14.0, SIG 3.39 → 3.38, OVRL 2.86 → 2.84; `wiener` 2.34 → 2.36, 0.910 → 0.911, 14.0 → 14.3, 3.38 → 3.40, 2.81 → 2.84; `specsub` 2.24 → 2.26, 0.920 → 0.919, 12.5 → 12.8, 3.35 → 3.36, 2.77 → 2.79 (chosen on the training subset, where tracked `omlsa` went STOI 0.826 → 0.832, PESQ 1.83 → 1.82). On a learned noise (`omlsa` with `profile`, as audio's `denoise` runs it, G<sub>min</sub> −12 dB, the noise learned from the lead-in): PESQ 2.48 → 2.45, STOI 0.915 → 0.919, SIG 3.36 → 3.38, OVRL 2.89 → 2.88.

`omlsa` 0.4 reads the speech absence from the a priori SNR smoothed in the cepstrum, and on a learned noise the speech presence from γ averaged over neighbouring bins ([`omlsa`](#omlsa)). Chosen on the training subset; on the test set, once, 0.3 → 0.4, tracked: PESQ 2.362 → 2.364, STOI 0.919 → 0.920, SI-SDR 14.04 → 14.25 dB, SIG 3.382 → 3.384, BAK 3.43 → 3.47, OVRL 2.838 → 2.853, musical noise 0.49 → 0.48; on a learned noise (`node scripts/speech.mjs vbdemand omlsa-learned`, as audio's `denoise` runs it, 12 dB): 2.453 → 2.455, 0.919 → 0.920, 15.05 → 15.11, 3.380 → 3.367, 3.53 → 3.54, 2.875 → 2.874, 0.39 → 0.34. The clean utterances in: PESQ 4.288 → 4.287 tracked, 4.299 → 4.288 learned; steady white and pink noise alone 15 dB down at log kurtosis ratio 0.00 and 0.02. (The learned form was scored on the test set once before, its presence averaged over 64 ms of frames as the paper has it: PESQ 2.421, OVRL 2.885; the musical noise it left after music stops, measured on the training material, then took it to the frame alone.)

The open classical denoisers on the same 824, each given the noise as ours is: noisereduce 3.0.3 (stationary spectral gating, the lead-in as its noise clip) at 12 dB (`prop_decrease` 0.75): PESQ 2.409, STOI 0.921, SI-SDR 12.8, SIG 3.37, BAK 3.51, OVRL 2.861, musical noise 0.03; at full reduction 2.357, 0.910, 12.4, 3.22, 3.72, 2.825, 0.74; logmmse 1.5 (a port of Loizou's `logmmse.m`, noise from the lead-in, updated by its VAD) 2.350, 0.900, 14.7, 3.29, 3.52, 2.799, 0.73; FFmpeg 8.0.1's `afftdn` learning the lead-in, 12 dB: 2.048, 0.920, 8.6, 3.25, 3.14, 2.657, 0.20 (`anlmdn` at its defaults leaves the input as it is). Neural, for scale: DeepFilterNet3 limited to 12 dB 2.670, 0.939, 16.2, 3.49, 3.69, 3.026, 0.06; RNNoise 2.109, 0.890, 12.3, 3.28, 3.85, 2.935, 0.90. iZotope RX was not measured: no RX plug-in is installed where these ran.

Tried on the training subset and not taken: the cepstral a priori SNR as the gain's ξ as well (tracked SIG −0.04, music cut 9.6 → 15.6 %); Gerkmann & Hendriks's MMSE noise tracker (2012) in place of IMCRA (tracked PESQ +0.04, OVRL +0.03, but STOI −0.008, clean speech in PESQ 4.24 → 4.08, music cut 9.6 → 28.5 %) or of minimum statistics in `wiener` (PESQ 1.82 → 1.87, steady-noise musical noise 0.53 → 0.79, music cut 14.5 → 28.5 %); that tracker started on a learned print (RX's "adaptive": OVRL −0.04, musical noise 0.40 on pink noise); the cepstral ξ in `wiener` (STOI +0.014, SIG −0.06); the averaged presence in the tracked gain (PESQ +0.015, a word's second frame after a pause 0.7 dB lower); the gain smoothed over frequency, in dB or linear, ±100 Hz (musical noise 0.46 → 0.22–0.29, speech cut by more than 3 dB 9.5 → 25–38 %). With the noise known exactly (the true noise's periodogram, recursively smoothed) the learned form scores PESQ 2.11 on the training subset (1.87 with the print) and leaves musical noise of 0.01 (0.46): what remains to be had is in the estimate of a noise that changes, not in the gain.

What each keeps of the speech, by shadow filtering (`node scripts/broadband.mjs`: each frame's gain, computed on the noisy mix, applied to the clean speech and to the noise alone): a word's second and third frame after 85 ms of pause, in ten Spoken Wikipedia narrations under pink noise 10 dB down; speech 20–50 dB under the take's loudest frame, and bins where it stands 0–5 dB over the noise (the MMSE-optimal Wiener gain keeps −3.9 dB there), in the test set's every fourth utterance; the noise taken; the share of clean speech, and of clean music, cut by more than 3 dB. dB, `omlsa` 0.3 → 0.4 (`wiener` and `specsub` as they stand):

| op | onset +1 | onset +2 | quiet | 0–5 dB | noise, VB | noise, narr. | clean cut % | music cut % |
|---|---|---|---|---|---|---|---|---|
| `omlsa` | −8.9 → −6.1 | −4.8 → −3.5 | −2.0 → −2.1 | −3.6 → −3.6 | −6.7 → −7.0 | −7.5 → −7.6 | 0.3 → 0.3 | 9.6 → 9.9 |
| `omlsa`, learned noise | −6.1 → −4.8 | −2.7 → −2.6 | −3.0 → −3.0 | −7.9 → −4.6 | −8.3 → −8.1 | −8.4 → −7.3 | 0.4 → 0.4 | – |
| `wiener` | −5.4 | −2.4 | −2.1 | −3.7 | −7.1 | −7.1 | 0.7 | 14.5 |
| `specsub` | −1.5 | −0.3 | −1.9 | −3.9 | −4.8 | −5.8 | 0.3 | 10.3 |

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

Reverberant speech (`vbreverb`): a quarter of the clean test utterances, 206, through 130 rooms of the MIT IR Survey (Traer & McDermott 2016), scored against the dry takes, DNSMOS at the input's loudness. `dereverb` 0.2 (recursive WPE) → 0.3; the rooms with a tail to hear are in [`dereverb`](#dereverb)'s own table:

| | PESQ | STOI | SI-SDR dB | SIG | BAK | OVRL |
|---|---|---|---|---|---|---|
| reverberant input | 2.33 | 0.904 | −5.7 | 3.19 | 3.71 | 2.82 |
| `dereverb` | 2.52 → **2.55** | 0.914 → 0.897 | −5.2 → −5.3 | 3.22 → **3.27** | 3.73 → **3.89** | 2.85 → **2.93** |
| dry takes in (`vbreverb-dry`) | 4.64 | 1.000 | ∞ | 3.51 | 4.04 | 3.22 |
| dry, `dereverb` | 4.37 → 4.24 | 0.999 → 0.997 | 27.5 → 28.2 | 3.50 → 3.49 | 4.03 → 4.05 | 3.21 → 3.21 |

On the training utterances (`vbreverb-train`, 126): PESQ 2.36 → 2.56 → 2.57, OVRL 2.81 → 2.84 → 2.91. The constants were chosen on `scripts/dereverb.py train`: VoiceBank training speakers in the even-numbered rooms, 1.8–4.5 s utterances and 25–41 s takes.


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
- Falk, Zheng & Chan, *A Non-Intrusive Quality and Intelligibility Measure of Reverberant and Dereverberated Speech*, IEEE TASLP 2010 (SRMR).
- Traer & McDermott, *Statistics of Natural Reverberation Enable Perceptual Separation of Sound and Space*, PNAS 2016 (MIT IR Survey).
- Talkin, *A Robust Algorithm for Pitch Tracking (RAPT)*, in Kleijn & Paliwal (eds.), Speech Coding and Synthesis, Elsevier 1995.
- Boersma, *Accurate Short-Term Analysis of the Fundamental Frequency and the Harmonics-to-Noise Ratio of a Sampled Sound*, IFA Proceedings 17, 1993.
- Nelke & Vary, *Measurement, Analysis and Simulation of Wind Noise Signals for Mobile Communication Devices*, IWAENC 2014.
- RBJ Audio EQ Cookbook (biquad coefficients).


## License

MIT
