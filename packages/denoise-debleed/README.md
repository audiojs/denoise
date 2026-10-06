# @audio/denoise-debleed [![npm](https://img.shields.io/npm/v/@audio/denoise-debleed)](https://www.npmjs.com/package/@audio/denoise-debleed) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-bleed: a source's spill taken out of another microphone, given that source's own track. A Kalman filter cancels it through the room path it learns, a Wiener gain takes the residual it predicts

```
npm install @audio/denoise-debleed
```

```js
import debleed from '@audio/denoise-debleed'
```

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

---

Part of [@audio/denoise](https://github.com/audiojs/denoise), the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
