# @audio/denoise-dehum [![npm](https://img.shields.io/npm/v/@audio/denoise-dehum)](https://www.npmjs.com/package/@audio/denoise-dehum) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Mains hum and buzz removal: the mains phase tracked, every line subtracted along it; no hum, no change

```
npm install @audio/denoise-dehum
```

```js
import dehum, { measure } from '@audio/denoise-dehum'
```

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

The mains phase is tracked first from the harmonics to 1 kHz (each harmonic's phasor per Hann frame four mains cycles long, fitted over 2 s, their turn combined by h²·SNR over 8 s: Hajj-Ahmad, Garg & Wu 2013), then the signal is resampled so that the tracked mains period spans 2^k samples (computed order tracking: Fyfe & Munck 1997). There every harmonic sits on one bin of a 2^k-point transform of each frame however the mains wander, and the phase is refined from the turn between frames of the harmonics, to 16, 64, … 8 kHz, whose lines stand out alone (a partial beside a line turns it with the program), each weighted by its line's power over the program's there and smoothed by Rauch–Tung–Striebel at the likeliest rate of wander and noise scale; a refinement is kept only if it draws the lines tighter (their coherent power grows). Each harmonic's phasors are fitted over 2 s by weighted local-linear least squares (normalized convolution, Knutsson & Westin 1993), each frame weighted by the inverse of the program's power around the line there, so a passing voice or note is bridged from the frames around it rather than averaged in; the sinusoids are resynthesized period by period, brought back to the original samples (Kaiser-windowed sinc) and subtracted (harmonic subtraction, as power-line interference is taken out of ECG: Levkov et al. 2005).

Where the hum itself jumps (an edit's splice turns its phase, a level step, hum switched on or off), every line's phasors before and after a frame differ beyond their spread at once, a note beside one line moving that line alone: the tracking does not integrate across the jump, each stretch is fitted on its own frames, and the hum switches from one stretch's to the next at the sample that best splits the signal between them. A note within ~0.5 Hz of a line for seconds is taken for hum. Whole clip (`streaming: false`), a second at least to find hum; shorter, it removes the harmonics of a given `freq` as told and passes the audio through without one. About a tenth of real time (0.4.0: a hundredth), most of it in the 2 s fits.

Measured by `node scripts/dehum.js`, 0.4.0 → 0.5.0: the hum (mains: 12 harmonics at −6 dB per octave; buzz: odd-heavy to 8 kHz, odd h at h^−½, even at 0.3·h^−½, rolling off over 3 kHz; levels drifting ±10 %, f0 0.05 Hz off nominal and wandering) and the program told apart by phase inversion (Hagerman & Olofsson 2004). 50 Hz hum 20 dB under the program, wandering ±0.02 Hz; program SDR per band where the band holds 1 % of the program:

| material | hum down, dB | program SDR, dB | <100 Hz | 100–300 | 300–1k | 1–4k | >4k |
|---|---:|---:|---:|---:|---:|---:|---:|
| speech | 45.5 → 46.1 | 38.5 → 38.5 | 28.9 → 28.9 | 39.2 → 39.0 | 39.2 → 39.3 | 83.0 → 84.0 | – → – |
| narration | 43.5 → 43.9 | 42.7 → 42.7 | – → – | 38.8 → 38.8 | 42.9 → 42.9 | 64.5 → 64.1 | 73.9 → 73.6 |
| vibeace | no hum found → 50.8 | no hum found → 22.6 | no hum found → 21.4 | no hum found → 25.6 | no hum found → 28.2 | no hum found → 56.5 | no hum found → – |
| brahms | 42.2 → 36.4 | 25.7 → 25.6 | 30.2 → 30.2 | 17.9 → 17.9 | 27.0 → 27.0 | 57.8 → 58.0 | 50.2 → 50.4 |
| nutcracker | 41.6 → 43.4 | 27.6 → 27.6 | 23.5 → 23.5 | 30.7 → 30.7 | 26.8 → 26.8 | 63.6 → 63.7 | – → – |
| trumpet | 51.0 → 51.9 | 47.9 → 47.9 | – → – | – → – | 42.2 → 42.2 | 82.3 → 82.4 | – → – |

Hum down / program SDR, dB:

| material | 60 Hz | 50 Hz, ±0.05 Hz | 50 Hz, 30 dB under | 60 Hz buzz to 8 kHz | 50 Hz buzz, ±0.2 Hz |
|---|---|---|---|---|---|
| speech | 46.3 / 42.1 → 47.2 / 42.1 | 36.4 / 38.5 → 39.0 / 38.5 | 38.7 / 38.6 → 39.3 / 38.6 | 6.7 / 42.1 → 24.2 / 30.2 | 5.2 / 37.3 → 8.5 / 33.0 |
| narration | 43.6 / 44.0 → 43.9 / 43.9 | 33.8 / 42.8 → 40.0 / 43.0 | 42.3 / 42.9 → 42.4 / 42.8 | 6.7 / 43.9 → 22.8 / 36.9 | no hum found → no hum found |
| vibeace | no hum found → 50.2 / 25.8 | no hum found → 44.3 / 22.5 | no hum found → no hum found | no hum found → 21.7 / 25.9 | no hum found → 2.6 / 24.6 |
| brahms | 41.7 / 29.0 → 42.7 / 29.0 | 27.8 / 25.7 → 29.5 / 25.6 | 33.9 / 25.7 → 32.2 / 25.7 | 6.5 / 29.0 → 13.5 / 25.8 | 5.0 / 25.7 → 5.6 / 25.3 |
| nutcracker | 40.7 / 24.3 → 37.3 / 24.2 | 33.2 / 27.9 → 32.9 / 27.8 | no hum found → no hum found | 2.9 / 26.1 → 11.2 / 23.5 | 5.2 / 28.3 → 7.7 / 27.1 |
| trumpet | 51.9 / 47.8 → 53.0 / 47.8 | 46.0 / 47.7 → 50.5 / 47.7 | 48.4 / 48.0 → 48.6 / 48.1 | 6.1 / 48.0 → 41.7 / 40.5 | 6.2 / 45.8 → 14.5 / 31.3 |

An edited take (eight stretches cut out, from a pause to a pause in the speech, anywhere in the music, the hum's phase jumping at each cut), then the hum's level stepping four times among off, −10, −5, 0 and +5 dB; hum down within a second of a cut or step / elsewhere, and the program SDR, dB:

| material | within 1 s | elsewhere | program SDR |
|---|---:|---:|---:|
| speech | 6.5 → 9.2 | 41.1 → 40.5 | 38.3 → 35.8 |
| narration | no hum found → 24.5 | no hum found → 39.9 | no hum found → 33.1 |
| brahms | 9.5 → 9.5 | 37.0 → 34.6 | 25.0 → 24.9 |
| nutcracker | 9.7 → 10.9 | 36.0 → 32.6 | 28.0 → 27.6 |

| material | within 1 s | elsewhere | program SDR |
|---|---:|---:|---:|
| speech | 14.7 → 14.7 | 40.9 → 40.8 | 38.4 → 38.4 |
| narration | 15.0 → 21.4 | 41.0 → 33.4 | 42.5 → 41.3 |
| brahms | 13.9 → 14.0 | 40.5 → 39.7 | 25.8 → 25.8 |
| nutcracker | 15.0 → 17.4 | 40.7 → 40.1 | 27.7 → 26.4 |

Hum alone, 30 s, ±0.02 Hz: 56 → 61 dB down; buzz to 8 kHz alone: 6.4 → 62.2. Clean speech, narration and music: no sample changed. Buzz above 1 kHz is where 0.5.0 gains most and pays most: each of its ~130 lines takes the program within a fraction of a hertz of it, 7–12 dB of a voice's program SDR more than 12 lines of mains hum take (speech 42.1 → 30.2, with the buzz 24 dB down, not 7). Under an orchestra a line's turn is misread through the partials beside it: the phase is refined only from lines that stand alone, and a refinement kept only if the lines draw tighter, which keeps the Nutcracker at or over 0.4.0's hum down and Brahms within 0–6 dB of it, but follows a generator's ±0.2 Hz wander under speech by 8.5 dB only (19 when every line refines it, which cost Brahms 12). Vibe Ace's hum, among the track's own steady lines, is found now (0.4.0 left it): 50 dB down.

Against iZotope RX 12 De-hum (2026-10, `node bench/rx/dehum.mjs` in `audio`; RX hosted through Pedalboard, a new instance per render, its Learn on 3 s of the hum alone before each take as its manual has it): 21 test clips (6 VoiceBank speech clips of eight utterances, 4 Spoken Wikipedia readings, Brahms, Vibe Ace, the Nutcracker, the trumpet, 7 MUSDB18 test previews), six conditions (50 Hz mains, 60 Hz buzz to 8 kHz, 50 Hz buzz wandering ±0.2 Hz, level steps, six splices, 60 Hz buzz 30 dB under), RX's knobs chosen on a separate split (VoiceBank training speakers, other readings, MUSDB18 training previews): its best, Dynamic at sensitivity 1 and Q 10000, beat its defaults (sensitivity 5: 18.6 dB mean SDR on the tuning split) and every Static setting (7–12 dB: its notches, 16 harmonics at Q 300–3000, leave an error 3–10 dB under a white program's 40–1000 Hz band). Mean over conditions and materials, hum down / SDR against the clean program / PESQ (speech and readings):

| | RX defaults | RX tuned | 0.4.0 | 0.5.0 |
|---|---:|---:|---:|---:|
| hum down, dB | 7.7 | 3.2 | 11.8 | 19.8 |
| SDR, dB | 18.9 | 25.4 | 29.4 | 30.5 |
| PESQ | 3.06 | 2.80 | 3.27 | 3.92 |

RX's learned Dynamic profile acts as a gate: it takes the hum in the room tone 54–60 dB down and leaves it under the speech, where it takes as much of the voice (18.9 dB mean SDR, the input's 22.6). Tuned, it barely touches the take (3 dB of hum), the best SDR it reaches. 0.5.0 is over RX tuned in SDR in 16 of 18 condition × material cells; under it with buzz 30 dB under music (24.1 vs 32.2, input 31.3: the fits take more of a dense mix near the lines than the hum they remove, which is all RX tuned doesn't do) and with splices in music (22.3 vs 23.3). Hum as recorded (VocalSet and MIR-1K singing, DEMAND's washing machine and hallway, five readings, a VoiceBank take): RX's select-all Learn takes its lines up to 23 dB down and the singing with them (the rest of the spectrum 0.2–20 dB SDR); dehum takes them 0–15 dB down and leaves the rest 21–81 dB.

**Use when:** mains buzz, ground-loop hum, fixed tonal interference.<br>
**Not for:** broadband noise (use `wiener`/`omlsa`); shifting tones (use spectral methods); faint hum under a dense mix, where the fits take more of the music near the lines than the hum they remove.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
