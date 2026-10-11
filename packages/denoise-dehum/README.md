# @audio/denoise-dehum [![npm](https://img.shields.io/npm/v/@audio/denoise-dehum)](https://www.npmjs.com/package/@audio/denoise-dehum) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Mains hum, buzz and steady tone removal: the mains phase tracked, every line subtracted along it, then each tone held through the take (a whine, a test tone) found and subtracted; nothing found, no change

```
npm install @audio/denoise-dehum
```

```js
import dehum, { measure, tones } from '@audio/denoise-dehum'
```

Follows the mains phase, then subtracts the hum along it: each harmonic of the mains frequency, to 8 kHz where buzz carries it, is estimated as a slowly varying sinusoid and taken out, so what goes with the hum is the program within a fraction of a hertz of each line, and less of it where the program is loud there. Without hum the audio comes back untouched. Notches (0.2.0) took whatever their band held, a band that grows with the harmonic (Q 30: 1.7 Hz at 50 Hz, 33 Hz at 1 kHz), an orchestra's G2 two hertz under the 100 Hz line among it; and as the mains frequency wanders (±0.02–0.2 Hz, h times that at harmonic h) narrow ones miss the upper harmonics.

```js
dehum(data, { fs })                                            // 50 or 60 Hz, found; nothing without hum
dehum(data, { fs, freq: 60 })                                  // the 60 Hz series, its exact frequency tracked
dehum(data, { fs, freq: 60, harmonics: 4 })                    // remove 60–240 Hz as told
dehum(data, { fs, steady: true })                              // a buzz held through the take, an amp's under a guitar
dehum(data, { fs, tones: [15734] })                            // this tone, as told (true, the default: those found)
dehum(data, { fs, tones: false })                              // the mains series alone, as 0.6
measure(data, fs)                                              // → { f0, harmonics } or null (import from @audio/denoise-dehum)
tones(data, fs)                                                // → [{ freq, level, … }] the steady tones found (import alike)
```

| Param | Default | |
|---|---|---|
| `freq` | found | Fundamental, Hz. Omitted: the 50 or 60 Hz series, whichever is found. Given: that series, its frequency tracked from there (within ±0.4 %, ±`drift` Hz with `adaptive`) |
| `harmonics` | to 8 kHz | Remove h = 1…`harmonics` as told. Omitted: every harmonic to 1 kHz and each line above it that stands out, to 8 kHz |
| `steady` | `false` | The hum held through the take: a buzz under an instrument, no edit in it. Each line one phasor through the take, the mains phase refined against them (below) |
| `tones` | `true` | Steady tones off the mains series, held through the take: those `tones()` finds (below); an array: those frequencies, Hz, as told; `false`: none |

Hum is found by `measure()`, one Fourier transform over the signal (its first 80–90 s, taken down to 3 kHz), where a hum line, steady for minutes, gathers into a peak 1/T wide while speech spreads: the fundamental 20 dB over the median of the ±8 Hz around it, or two of the first six harmonics 15 dB, each 6 dB over any other peak within 3 Hz, all harmonics of one fundamental. Under music a line 20 dB under the program is too faint for that, so the band to 1 kHz is also tracked along each series (below) and its lines weighed where the program is quiet around them: hum is there when two or more of the first 20 harmonics stand out by 18 dB, are no more than 60 dB under the signal and stand alone, 6 dB over any other peak within 3 Hz, a third at least of those that stand out (a bar of music repeated exactly is a comb of lines 1/bar apart, lines at 50 and 60 Hz among them, few alone). A faster pattern spaces its teeth past 3 Hz, and where its instrument rings a tooth stands over the next: a kick at 200 bpm repeats every 15 periods of 50 Hz and 18 of 60, a comb every 3.33 Hz with teeth on both series, and in the MUSDB18 preview of Dark Ride's "Burning Bridges" its 50 Hz tooth stands 7 dB over the next one; the take has no pause to hear the line persist in, and 0.5.1 took it for hum (the mix out at 6.0 dB SDR). Neither the line's level nor its neighbours tell such a tooth from hum; the program's comb does, by all its teeth: for each pattern of 1/8 s to 2 s that spans a whole number of mains periods (its comb runs through the series), the share of the positions of its other lines, 40 Hz to 1 kHz, that hold a peak, less the share midway between them, where chance puts as many. The kick scores 0.30 (synthetic kicks 0.44–0.50, two BabySlakh mixes rendered from MIDI at an exact tempo 0.33 and 0.53); the 143 other MUSDB18 previews 0.16 at most, the other 18 BabySlakh mixes 0.20, 200 VocalSet takes, 120 GuitarSet takes, ten readings and five DEMAND noises 0.06. Over a quarter, in a take with no pause, the series is the program's and is left. Through 468 clean takes (MUSDB18's 94 training and 50 test previews, Brahms, Vibe Ace, the Nutcracker and the trumpet whole, 200 VocalSet takes, 120 GuitarSet takes, 30 s each: `node bench/rx/dehum.mjs clean` in `audio`) 0.5.2 changes none; 0.5.1 changed that one. Hum under such a pattern is left too where the take has no pause; with one, its lines and the pattern's within a fraction of a hertz of them go together (59.95 Hz hum 20 dB under the 200 bpm kick after 2 s of room tone: the mix out at 2.0 dB SDR, 0.5.1 alike). A tone held right on a mains line through a take with no pause is taken for hum.

The mains phase is tracked first from the harmonics to 1 kHz (each harmonic's phasor per Hann frame four mains cycles long, fitted over 2 s, their turn combined by h²·SNR over 8 s: Hajj-Ahmad, Garg & Wu 2013), then the signal is resampled so that the tracked mains period spans 2^k samples (computed order tracking: Fyfe & Munck 1997). There every harmonic sits on one bin of a 2^k-point transform of each frame however the mains wander, and the phase is refined from the turn between frames of the harmonics, to 16, 64, … 8 kHz, whose lines stand out alone (a partial beside a line turns it with the program), each weighted by its line's power over the program's there and smoothed by Rauch–Tung–Striebel at the likeliest rate of wander and noise scale; a refinement is kept only if it draws the lines tighter (their coherent power grows). Each harmonic's phasors are fitted over 2 s by weighted local-linear least squares (normalized convolution, Knutsson & Westin 1993), each frame weighted by the inverse of the program's power around the line there, so a passing voice or note is bridged from the frames around it rather than averaged in. Under a dense mix there is no frame to bridge from, and a fit over 2 s takes the music near every line, more of it than a faint hum (0.5.0: buzz 30 dB under music came out 7 dB worse than it went in); so the fit is kept within 30 % of the hum bridged through the program: the line's phasors, with any steady tone beside it taken out, followed as a slow random walk by Rauch–Tung–Striebel with the program's power in each frame as its noise, which carries the hum across a loud passage from where it stands alone instead of taking the music in. A line counts only if it persists where the program falls silent, at a tenth of its power elsewhere at least (a note held on a line goes quiet with the music; a held synth note at exactly 50 Hz was taken for hum). The sinusoids are resynthesized period by period, brought back to the original samples (Kaiser-windowed sinc) and subtracted (harmonic subtraction, as power-line interference is taken out of ECG: Levkov et al. 2005).

Where the hum itself jumps (an edit's splice turns its phase, a level step, hum switched on or off), every line's phasors before and after a frame differ beyond their spread at once, a note beside one line moving that line alone: the tracking does not integrate across the jump, each stretch is fitted on its own frames, and the hum switches from one stretch's to the next at the sample that best splits the signal between them. A note within ~0.5 Hz of a line for seconds is taken for hum. Whole clip (`streaming: false`), a second at least to find hum; shorter, it removes the harmonics of a given `freq` as told and passes the audio through without one. About a tenth of real time (0.4.0: a hundredth), most of it in the 2 s fits.

`steady` (0.6.0) is for a hum that holds still through the take: an amp's ground loop under a guitar. A fit over 2 s takes in what the program puts near a line for seconds, and a chord's attack, moving many lines at once, reads as the hum's jump: on GuitarSet takes under a buzz 35 dB down (audio's `bench/rx/guitar.mjs`, players 00–02), 0.5.2 took the buzz 4.3 dB down and the guitar to 39.3 dB SDR. Steady, each line is one phasor through the take, its mean weighted to where the program around the line is quiet; the program's power there is read from the line's magnitude, not its phase, so a phase still off does not pass for program. Held, the lines show the mains phase's error frame by frame against them, all at once (Newton's steps on the held comb's correlation, smoothed by Rauch–Tung–Striebel at the likeliest rate of wander): from the trace, the phase is refined against the comb to harmonics 2, 4, … 64, then to 8 kHz twice, each step holding the higher lines tighter (on one of those takes, from 0.5 rad off the true phase at its start to under 0.001 rad throughout). A line goes when its held phasor stands 10 dB over its own spread and holds no more than twice the power the line has where the program falls silent (a note on the line, which the take's quiet does not hold), each frame's by its expected coherence, e^(−h²σ²/2) with σ² the phase's variance there: where the program masked the hum and the phase was bridged, the upper lines go less. The dense mix of the test suite under that buzz, wandering ±0.02 Hz: 48.0 dB of it down, the music at 78.4 dB SDR (by default 3.7 and 32.6).

**Steady tones** (0.7.0). Off the mains series a line held through a take is interference too: a whine, a test tone, a monitor's 15.7 kHz, an electrical or fan line. A held note can be as exact in frequency and level (an organ, a synth), so a line is taken only for what a note does not do through a take whose program comes and goes. `tones()` reads one short-time transform (Hann, ~0.19 s, hop half; 2048 frames at most, spread over a longer take), takes as candidates the peaks of the power each bin holds in four frames of five, 12 dB over the median of the bins 4–40 away, and keeps a line that
- **holds through the pauses**: the frames where all but the lines sits within 6 dB of its 10th percentile, half a second of them at least; it stands 6 dB over its bins' floor in 95 % of them, its level there within 3 dB (90th over 10th percentile). A take whose program never moves 10 dB (90th over 10th percentile) is left: nothing passes over its lines to tell them from notes;
- **is never gone under the program**: its five bins hold a quarter of its power in the pauses in 90 % of all frames. In a mix the quietest frames can be where the bass plays alone: in the MUSDB18 preview of Grants' "PunchDrunk" a 220 Hz line held 92 % of the pauses, its level within 1.6 dB and its turns' mean resultant length 0.994, and was there in 32 % of the frames;
- **turns as one line**: between consecutive pauses holding it, the mean resultant length of its phasor's turns is 0.9 at least (their spread under ~0.8 Hz), and its phase breaks off the turn (by over π/3) in 2 % of the transitions at most, across up to a second of the program too. A note struck again on the same pitch starts at a new phase, a kick tuned to it too (van Waterschoot & Moonen's interframe peak persistence, Proc. IEEE 99(2), 2011, a feedback detector's mark, read on the phase rather than the magnitude);
- stands within 60 dB of the take; under a found mains series, off its harmonics (±0.5 %);
- **is one source** (0.7.1), the lines kept together one harmonic series: each a whole multiple of a fundamental at the lowest line or an octave under it (a fundamental too faint to stand is missed), within 0.5 cents plus the lines' turn spread. One interference makes one line, or one periodic wave's series (a whine, a fan, a scan); lines off one series held alike through the take are the notes of a held chord, and none goes (equal temperament's fifth sits 1.96 cents off 3:2, its major third 13.7 off 5:4). A chord held under percussion passes every mark above: the hits never pass over its lines, so they hold through every pause, are never gone and turn as lines. 0.7.0 took @audio/chain's triad (220, 277.18, 329.63 Hz at 0.55 peak, a marimba-like hit once a second) whole once the take was tilted +3 dB/octave or more, the tilt lifting the hits until the program came and went 12–30 dB; of 1344 such takes (2–4 notes, sines or partials 1–6, under that hit, a snare or a kick 24 dB under the chord's peak to level with it, tilted 0–9 dB/octave, 4–16 s), 0.7.0 found lines in 938, 0.7.1 in none. A whine found in part still reads as one: under speech its fundamental can be missed while its 2nd–4th harmonics stand, a fundamental an octave under the 2nd; one whose 3rd and 4th alone stand would be left (of 120 takes of a whine with harmonics 1–4, at 180.3, 1234.5 and 4100 Hz, 10–50 dB under VoiceBank speech, every set of lines found reads as one series).

Each is subtracted as a harmonic is: its frequency read from its turn, its phasor per 80 ms Hann frame, weighted by the program's power around it, bridged through the program by Rauch–Tung–Striebel at the likeliest rate of drift (up to a turn of ~0.1 rad a frame: a whine wandering ±0.3 Hz), resynthesized and taken out. What goes of the program is what lies within a fraction of a hertz of the line. A note held through the whole take, struck before it starts and released after it ends, under a melody, is a tone by every mark the take offers and goes (the synthetic drone below), as do two notes an octave apart or a just fifth, one series; a chord in equal temperament is left; a tone switched on or off inside the take is left, as is one that glides, and two unrelated tones found together (off one series, as a chord's notes are).

Measured by `node scripts/tones.mjs` (`case`, `synth`, `music`, `speech`; thresholds chosen on its tune split: VoiceBank's training speakers, the odd-numbered VocalSet singers, every third MUSDB18 training preview, odd BabySlakh mixes, GuitarSet; then read once on the test split, below). Test.js's steady line, audio-lena's first 4 s with a 7 kHz sine at 0.3 and white noise at 0.01: speech SNR −3.8 dB as 0.6 leaves it (and `denoise()` routed it to `none`); 22.8 dB through `dehum` (with the line gone exactly, the noise alone leaves 22.8); 24.2 then through `wiener`, where a notch at 7 kHz, told, then `wiener` reaches 23.8. Tones under VoiceBank+DEMAND's test speakers (4 clips of 4 utterances, ~10–14 s), by phase inversion; tone down / speech SDR, dB, the mean over the clips where found, against a notch (Q 30) told each frequency:

| tone under speech | −10 dB | −30 dB | −50 dB | notch, told |
|---|---|---|---|---|
| 97 Hz | 92.2 / 60.4 (4 of 4) | not found | not found | 22.8 / 25.3 |
| 440 Hz | 96.1 / 60.5 (4) | 79.6 / 72.6 (3) | not found | 29.4 / 14.3 |
| 1 kHz | 85.0 / 64.5 (4) | 80.4 / 72.7 (4) | 45.8 / 82.1 (1) | 32.9 / 25.8 |
| 3.15 kHz | 67.2 / 69.9 (4) | 89.3 / 77.8 (4) | 57.3 / 86.9 (2) | 37.8 / 31.5 |
| 7 kHz | 60.1 / 72.0 (4) | 89.4 / 83.9 (4) | 86.7 / 96.5 (3) | 40.8 / 36.8 |
| 12 kHz | 57.8 / 79.1 (4) | 76.9 / 84.8 (4) | 76.5 / 92.9 (4) | 41.8 / 41.9 |
| 15.734 kHz | 57.5 / 82.7 (4) | 72.3 / 86.0 (4) | 81.0 / 92.6 (4) | 41.2 / 47.4 |

A whine at 1234.5 Hz with harmonics 2–4, 20 dB under: 84.9 / 66.8 (notch 34.6 / 21.6); a 3 kHz tone wandering ±0.3 Hz: 33.5 / 55.2 (36.7 / 31.3); a 2 kHz tone switched on halfway: left. Held notes, nothing added: 15 synthetic takes (organ chords with rests, held sines, a pedal held 85 % of the take under a melody, strings with vibrato, piano), 62 VocalSet long tones (straight, messa, pp, forte, trill, trillo, inhaled), 50 MUSDB18 test previews, 10 BabySlakh mixes, 7 GuitarSet takes and the four pieces: none changed by the tones (one VocalSet take, `f8_long_inhaled_a`, changed by the hum lines as 0.6 changes it, bit for bit); on the tune split, 142 takes, none. A drone held from the first sample to the last under a melody goes, 56 dB of it. Held chords under percussion (24 a split since 0.7.1: 2–4 notes, sines or partials 1–6, under a tonal hit, a snare or a kick, tilted 0–9 dB/octave, 4–16 s): 0.7.0's tones changed 20 of the test split's and 21 of the tune split's, 0.7.1's none; 3 and 2 change by the hum lines as 0.6 changes them, bit for bit, a partial on a mains harmonic in a take with no pause (F at 349.23 Hz, 7 × 49.89; A2's fifth partial, 550 Hz, 11 × 50). VoiceBank+DEMAND test set: of 824 clean utterances none changed, of 824 noisy one (`p232_381`, the bus noise's 38.2 Hz engine line, PESQ 2.211 → 2.204); `denoise()` routes every utterance as before, PESQ 2.30 → 2.30 (that utterance 2.292 → 2.290). Tune split, of 504: one changed (`p228_229`, the metro noise's 2374.6 Hz whine; through `denoise()` 2.472 → 2.491).

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

**Use when:** mains buzz, ground-loop hum, fixed tonal interference: a whine, a test tone, an electrical or fan line.<br>
**Not for:** broadband noise (use `wiener`/`omlsa`); tones that glide or switch on and off inside the take (use spectral methods).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
