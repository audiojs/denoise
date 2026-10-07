# @audio/denoise-dereverb [![npm](https://img.shields.io/npm/v/@audio/denoise-dereverb)](https://www.npmjs.com/package/@audio/denoise-dereverb) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-reverb: late reverberation off a voice, one channel: weighted prediction error (WPE, Nakatani et al. 2010) fitted over the take, then the late power the past carries, scaled by the take's own decays, taken by a gain; a dry take or music passes untouched

```
npm install @audio/denoise-dereverb
```

```js
import dereverb from '@audio/denoise-dereverb'
```

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

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
