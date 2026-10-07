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
dehum(data, { fs, steady: true })                              // a buzz held through the take, an amp's under a guitar
measure(data, fs)                                              // → { f0, harmonics } or null (import from @audio/denoise-dehum)
```

| Param | Default | |
|---|---|---|
| `freq` | found | Fundamental, Hz. Omitted: the 50 or 60 Hz series, whichever is found. Given: that series, its frequency tracked from there (within ±0.4 %, ±`drift` Hz with `adaptive`) |
| `harmonics` | to 8 kHz | Remove h = 1…`harmonics` as told. Omitted: every harmonic to 1 kHz and each line above it that stands out, to 8 kHz |
| `steady` | `false` | The hum held through the take: a buzz under an instrument, no edit in it. Each line one phasor through the take, the mains phase refined against them (below) |

Hum is found by `measure()`, one Fourier transform over the signal (its first 80–90 s, taken down to 3 kHz), where a hum line, steady for minutes, gathers into a peak 1/T wide while speech spreads: the fundamental 20 dB over the median of the ±8 Hz around it, or two of the first six harmonics 15 dB, each 6 dB over any other peak within 3 Hz, all harmonics of one fundamental. Under music a line 20 dB under the program is too faint for that, so the band to 1 kHz is also tracked along each series (below) and its lines weighed where the program is quiet around them: hum is there when two or more of the first 20 harmonics stand out by 18 dB, are no more than 60 dB under the signal and stand alone, 6 dB over any other peak within 3 Hz, a third at least of those that stand out (a bar of music repeated exactly is a comb of lines 1/bar apart, lines at 50 and 60 Hz among them, few alone). A faster pattern spaces its teeth past 3 Hz, and where its instrument rings a tooth stands over the next: a kick at 200 bpm repeats every 15 periods of 50 Hz and 18 of 60, a comb every 3.33 Hz with teeth on both series, and in the MUSDB18 preview of Dark Ride's "Burning Bridges" its 50 Hz tooth stands 7 dB over the next one; the take has no pause to hear the line persist in, and 0.5.1 took it for hum (the mix out at 6.0 dB SDR). Neither the line's level nor its neighbours tell such a tooth from hum; the program's comb does, by all its teeth: for each pattern of 1/8 s to 2 s that spans a whole number of mains periods (its comb runs through the series), the share of the positions of its other lines, 40 Hz to 1 kHz, that hold a peak, less the share midway between them, where chance puts as many. The kick scores 0.30 (synthetic kicks 0.44–0.50, two BabySlakh mixes rendered from MIDI at an exact tempo 0.33 and 0.53); the 143 other MUSDB18 previews 0.16 at most, the other 18 BabySlakh mixes 0.20, 200 VocalSet takes, 120 GuitarSet takes, ten readings and five DEMAND noises 0.06. Over a quarter, in a take with no pause, the series is the program's and is left. Through 468 clean takes (MUSDB18's 94 training and 50 test previews, Brahms, Vibe Ace, the Nutcracker and the trumpet whole, 200 VocalSet takes, 120 GuitarSet takes, 30 s each: `node bench/rx/dehum.mjs clean` in `audio`) 0.5.2 changes none; 0.5.1 changed that one. Hum under such a pattern is left too where the take has no pause; with one, its lines and the pattern's within a fraction of a hertz of them go together (59.95 Hz hum 20 dB under the 200 bpm kick after 2 s of room tone: the mix out at 2.0 dB SDR, 0.5.1 alike). A tone held right on a mains line through a take with no pause is taken for hum.

The mains phase is tracked first from the harmonics to 1 kHz (each harmonic's phasor per Hann frame four mains cycles long, fitted over 2 s, their turn combined by h²·SNR over 8 s: Hajj-Ahmad, Garg & Wu 2013), then the signal is resampled so that the tracked mains period spans 2^k samples (computed order tracking: Fyfe & Munck 1997). There every harmonic sits on one bin of a 2^k-point transform of each frame however the mains wander, and the phase is refined from the turn between frames of the harmonics, to 16, 64, … 8 kHz, whose lines stand out alone (a partial beside a line turns it with the program), each weighted by its line's power over the program's there and smoothed by Rauch–Tung–Striebel at the likeliest rate of wander and noise scale; a refinement is kept only if it draws the lines tighter (their coherent power grows). Each harmonic's phasors are fitted over 2 s by weighted local-linear least squares (normalized convolution, Knutsson & Westin 1993), each frame weighted by the inverse of the program's power around the line there, so a passing voice or note is bridged from the frames around it rather than averaged in. Under a dense mix there is no frame to bridge from, and a fit over 2 s takes the music near every line, more of it than a faint hum (0.5.0: buzz 30 dB under music came out 7 dB worse than it went in); so the fit is kept within 30 % of the hum bridged through the program: the line's phasors, with any steady tone beside it taken out, followed as a slow random walk by Rauch–Tung–Striebel with the program's power in each frame as its noise, which carries the hum across a loud passage from where it stands alone instead of taking the music in. A line counts only if it persists where the program falls silent, at a tenth of its power elsewhere at least (a note held on a line goes quiet with the music; a held synth note at exactly 50 Hz was taken for hum). The sinusoids are resynthesized period by period, brought back to the original samples (Kaiser-windowed sinc) and subtracted (harmonic subtraction, as power-line interference is taken out of ECG: Levkov et al. 2005).

Where the hum itself jumps (an edit's splice turns its phase, a level step, hum switched on or off), every line's phasors before and after a frame differ beyond their spread at once, a note beside one line moving that line alone: the tracking does not integrate across the jump, each stretch is fitted on its own frames, and the hum switches from one stretch's to the next at the sample that best splits the signal between them. A note within ~0.5 Hz of a line for seconds is taken for hum. Whole clip (`streaming: false`), a second at least to find hum; shorter, it removes the harmonics of a given `freq` as told and passes the audio through without one. About a tenth of real time (0.4.0: a hundredth), most of it in the 2 s fits.

`steady` (0.6.0) is for a hum that holds still through the take: an amp's ground loop under a guitar. A fit over 2 s takes in what the program puts near a line for seconds, and a chord's attack, moving many lines at once, reads as the hum's jump: on GuitarSet takes under a buzz 35 dB down (audio's `bench/rx/guitar.mjs`, players 00–02), 0.5.2 took the buzz 4.3 dB down and the guitar to 39.3 dB SDR. Steady, each line is one phasor through the take, its mean weighted to where the program around the line is quiet; the program's power there is read from the line's magnitude, not its phase, so a phase still off does not pass for program. Held, the lines show the mains phase's error frame by frame against them, all at once (Newton's steps on the held comb's correlation, smoothed by Rauch–Tung–Striebel at the likeliest rate of wander): from the trace, the phase is refined against the comb to harmonics 2, 4, … 64, then to 8 kHz twice, each step holding the higher lines tighter (on one of those takes, from 0.5 rad off the true phase at its start to under 0.001 rad throughout). A line goes when its held phasor stands 10 dB over its own spread and holds no more than twice the power the line has where the program falls silent (a note on the line, which the take's quiet does not hold), each frame's by its expected coherence, e^(−h²σ²/2) with σ² the phase's variance there: where the program masked the hum and the phase was bridged, the upper lines go less. The dense mix of the test suite under that buzz, wandering ±0.02 Hz: 48.0 dB of it down, the music at 78.4 dB SDR (by default 3.7 and 32.6).

Measured by `node scripts/dehum.js`, 0.4.0 → 0.5.1 (0.5.2 alike, every cell): the hum (mains: 12 harmonics at −6 dB per octave; buzz: odd-heavy to 8 kHz, odd h at h^−½, even at 0.3·h^−½, rolling off over 3 kHz; levels drifting ±10 %, f0 0.05 Hz off nominal and wandering) and the program told apart by phase inversion (Hagerman & Olofsson 2004). 50 Hz hum 20 dB under the program, wandering ±0.02 Hz; program SDR per band where the band holds 1 % of the program:

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

| | RX defaults | RX tuned | 0.4.0 | 0.5.2 |
|---|---:|---:|---:|---:|
| hum down, dB | 7.7 | 3.2 | 11.8 | 17.7 |
| SDR, dB | 18.9 | 25.4 | 29.4 | 34.9 |
| PESQ | 3.06 | 2.80 | 3.27 | 4.01 |

RX's learned Dynamic profile acts as a gate: it takes the hum in the room tone 54–60 dB down and leaves it under the speech, where it takes as much of the voice (18.9 dB mean SDR, the input's 22.6). Tuned, it barely touches the take (3 dB of hum), the best SDR it reaches. 0.5.2 (every score as 0.5.1's) is over RX tuned in SDR in all 18 condition × material cells (buzz 30 dB under music: 35.9 against 32.2, input 31.3), and every clip comes out within 0.2 dB of its input SDR or better. Hum as recorded (MIR-1K singing, DEMAND's washing machine and hallway, five readings, a VoiceBank take): RX's select-all Learn takes its lines up to 18 dB down and the program with them (the rest of the spectrum 1.5–20 dB SDR); dehum takes them 0–14 dB down and leaves the rest 21–60 dB. VocalSet's 60 Hz lines, more than 60 dB under the singing and barely over its room tone, are left as they are (0.4.0 took them 0–7 dB down; RX up to 23, the rest of the spectrum 0.2–12.5 dB).

**Use when:** mains buzz, ground-loop hum, fixed tonal interference.<br>
**Not for:** broadband noise (use `wiener`/`omlsa`); shifting tones (use spectral methods).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
