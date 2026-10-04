# @audio/denoise-dehum [![npm](https://img.shields.io/npm/v/@audio/denoise-dehum)](https://www.npmjs.com/package/@audio/denoise-dehum) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Mains hum removal: measured, then subtracted; no hum, no change

```
npm install @audio/denoise-dehum
```

```js
import dehum, { measure } from '@audio/denoise-dehum'
```

Measures the hum, then subtracts it: each harmonic of the mains frequency is estimated as a slowly varying sinusoid and taken out, so what goes with the hum is the program within a fraction of a hertz of each line, and less of it where the program is loud there. Without hum the audio comes back untouched. Notches (0.2.0) took whatever their band held, a band that grows with the harmonic (Q 30: 1.7 Hz at 50 Hz, 33 Hz at 1 kHz), an orchestra's G2 two hertz under the 100 Hz line among it; and as the mains frequency wanders (±0.02–0.05 Hz, h times that at harmonic h) narrow ones miss the upper harmonics.

```js
dehum(data, { fs })                                            // 50 or 60 Hz, measured; nothing without hum
dehum(data, { fs, freq: 60 })                                  // the 60 Hz series, its exact frequency measured
dehum(data, { fs, freq: 60, harmonics: 4 })                    // remove 60–240 Hz as told
measure(data, fs)                                              // → { f0, harmonics } or null
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

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
