# @audio/denoise-debleed [![npm](https://img.shields.io/npm/v/@audio/denoise-debleed)](https://www.npmjs.com/package/@audio/denoise-debleed) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-bleed: a source's spill taken out of another microphone, given that source's own track. A Kalman filter cancels it through the room path it learns, a Wiener gain takes the residual it predicts

```
npm install @audio/denoise-debleed
```

```js
import debleed from '@audio/denoise-debleed'
```

Takes out of a microphone the bleed of a source whose own track you have: the click track leaking from a singer's headphones, the guitar amp in the vocal mic, the co-host's voice in the other host's mic, drums in a piano mic. The bleed is that track through the room, a delay of tens of ms and the room's response, changing as people move; the wanted sound plays over it nearly all the time. It comes out in two stages.

Cancellation: a partitioned-block frequency-domain Kalman filter (Enzner & Vary, Signal Processing 2006; Kuech, Mabande & Enzner, ICASSP 2014) learns the path from the reference to the mic, `span` seconds of it in 10.7 ms partitions (512 samples at 44.1 and 48 kHz), and subtracts the bleed it predicts. Its step in each bin is its uncertainty about the path over that uncertainty plus the wanted sound's power: it hardly moves while the wanted voice sings over the bleed, the double talk that throws an echo canceller's NLMS off, and learns at once in the pauses. The path is a slowly wandering state (AR(1), memory ~5 s), so the filter follows a moving source. It learns from the reference less the reference's own noise floor (minimum statistics, Martin 2001): a reference mic's hiss never reached the other mic. Suppression: what cancellation leaves, a path not yet learned, movement faster than the filter follows, the room's tail past `span`, has a power the filter knows (its uncertainty times the reference's power, plus the decaying tail), and a Wiener gain against it (decision-directed, Ephraim & Malah 1984), floored at `attenuation`, takes it from what remains. With no reference energy the output is the input, bit for bit.

What the filter assumes of the path before hearing it, its prior, sets how fast it learns and how much residual the suppressor expects: a room's decay and a level per band, learned from the coherence of the mic with the bleed predicted (Carter 1973's magnitude-squared coherence, debiased): coherence ignores the prediction's level, so a path the filter has barely begun to learn already reads at its level, and the wanted sound, incoherent with the reference, is not taken for bleed. Each path's level is held at 0 dB or under: bleed is quieter than its source in its own track. Two mics in one room also hear each other the other way: the reference holds the wanted voice, and while that voice sounds alone a canceller learns to predict it from its echo and takes it away. A second filter learns that way back, from the output to the reference, and the first learns from the reference less it (the crosstalk-resistant canceller of Mirchandani, Zinser & Evans, IEEE TCAS-II 1992). The batch call runs twice, learning the levels over the whole take and then removing; the stream learns as it goes, so its first seconds take less. Latency 2·512 − 1 samples at 44.1 and 48 kHz (23 and 21 ms); the batch call runs at about 8× real time at 48 kHz on one core (two passes), the stream at about 16×.

```js
debleed(vocal, clickTrack, { fs: 48000 })                   // in place
debleed(hostA, [coHostL, coHostR], { fs: 48000 })           // a stereo reference
let write = debleed({ fs: 48000 })                          // stream: write(chunk, refChunk) → the samples done, write() → the rest
```

In `audio`, the reference is the op's second bus, as the ducker's key: `a.debleed({ key: clickTrack })`.

| Param | Default | |
|---|---|---|
| `attenuation` | `-20` | dB, the most the residual is turned down; `0` cancels only; read every block |
| `span` | `0.3` | s of room path the filter learns: the delay and the early room; the tail past it is suppressed as a decay |
| `blockSize` | 10.7 ms | the partition and hop, a power of two |

Measured (`node scripts/debleed.js test`, then `python scripts/debleed.py test`): bleed made from real recordings, 14 s takes, three per kind and level. The wanted sound: VoiceBank voices (p232, p257) and Spoken Wikipedia narrations, or MUSDB18 vocals. The bleed: another VoiceBank voice (co-host), a click track, MUSDB18 drums, its "other" stem (guitars, keys), through MIT IR Survey rooms (the odd-numbered responses; the defaults were chosen on the even ones, VoiceBank's training speakers and MUSDB18's training previews), 1–30 ms away, −30, −18 or −6 dB under the wanted sound's level; the op gets the source as its own track recorded it, at another gain and tilt, with its own noise. A static path, and a moving one: the source sways ±0.5 ms over 6–10 s, the gain drifts ±1.5 dB, a second room comes in to 30 % over the take. Each system runs on the take and on the take with the bleed inverted (Hagerman & Olofsson 2004), which splits its output into the wanted sound as it left it and the bleed it left. Bleed removed, dB; the wanted sound's SI-SDR after it (the takes' distortion pooled), all and per band; musical noise, the log kurtosis ratio of the bleed left over the bleed (Uemura et al. 2008: 0 for a gain that scales it, more for isolated peaks):

| static path | co-host −30 / −18 / −6 | click | drums | other | wanted SI-SDR | <300 Hz | 0.3–1k | 1–3k | 3–8k | >8k | kurtosis |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| `debleed` | 10.9 / 14.6 / 14.3 | 10.2 / 11.0 / 11.8 | 11.3 / 8.7 / 12.0 | 8.0 / 9.9 / 20.5 | 22.3 | 19.6 | 22.5 | 22.0 | 22.4 | 24.4 | 0.08 |
| stream | 11.7 / 9.5 / 5.3 | 10.2 / 6.4 / 5.6 | 11.5 / 7.0 / 5.8 | 7.5 / 8.0 / 14.7 | 23.7 | 21.2 | 24.0 | 23.5 | 24.1 | 26.2 | 0.39 |
| time-aligned subtraction | 6.4 / 1.6 / 2.3 | 1.9 / 9.0 / 2.1 | 0.7 / 2.2 / 2.0 | 0.4 / 1.1 / 5.1 | 32.6 | 28.8 | 35.8 | 26.5 | 32.3 | 37.3 | −0.12 |
| reference Wiener | 4.8 / 5.3 / 9.9 | 5.3 / 11.5 / 10.9 | 5.9 / 4.7 / 6.2 | 3.8 / 5.9 / 9.4 | 20.7 | 20.5 | 20.1 | 19.3 | 20.2 | 26.7 | −0.11 |
| Speex MDF + suppressor | −4.0 / 6.7 / 8.5 | 3.1 / 6.8 / 6.5 | 0.7 / 6.4 / 10.7 | 4.1 / 9.0 / 16.4 | 7.2 | 1.6 | 12.0 | 16.0 | 5.5 | −23.6 | 0.60 |
| WebRTC AEC3 | −5.9 / 8.9 / 10.8 | −8.3 / 3.6 / 10.4 | −5.2 / 1.7 / 10.5 | −5.0 / 2.6 / 11.5 | −4.1 | −24.4 | 2.8 | −14.9 | −44.7 | −43.1 | 1.00 |

| moving path | co-host −30 / −18 / −6 | click | drums | other | wanted SI-SDR | <300 Hz | 0.3–1k | 1–3k | 3–8k | >8k | kurtosis |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| `debleed` | 6.5 / 8.2 / 7.0 | 4.4 / 4.5 / 3.9 | 7.2 / 5.3 / 5.5 | 3.8 / 5.7 / 8.7 | 22.8 | 19.7 | 22.9 | 24.2 | 27.7 | 26.8 | 0.04 |
| stream | 7.2 / 5.7 / 3.1 | 4.9 / 3.2 / 2.2 | 7.2 / 4.9 / 4.1 | 3.4 / 4.4 / 7.1 | 24.0 | 21.2 | 23.9 | 25.4 | 29.3 | 28.7 | 0.18 |
| time-aligned subtraction | 0.4 / 0.3 / 0.3 | 0.0 / 0.2 / 0.0 | 0.6 / 0.1 / 0.0 | 0.0 / 0.0 / 0.0 | 29.6 | 31.2 | 28.5 | 28.3 | 31.4 | 26.1 | −0.01 |
| reference Wiener | 4.4 / 3.2 / 7.6 | 2.6 / 3.9 / 1.8 | 6.4 / 3.2 / 3.9 | 3.0 / 3.0 / 3.9 | 23.0 | 21.4 | 22.5 | 24.7 | 28.8 | 30.8 | −0.06 |
| Speex MDF + suppressor | −0.5 / 3.3 / 4.3 | −0.0 / 0.1 / −0.8 | 2.4 / 3.8 / 5.9 | 1.6 / 4.0 / 6.1 | 7.0 | 1.3 | 11.7 | 15.7 | 7.9 | −23.6 | 0.25 |
| WebRTC AEC3 | −3.1 / 6.3 / 10.1 | 2.8 / 4.2 / 6.3 | −6.0 / 3.5 / 8.1 | −5.1 / 1.9 / 8.4 | −4.1 | −33.6 | 2.6 | −25.3 | −21.9 | −36.7 | 0.80 |

PESQ (wideband) / STOI of the voices (co-host and click takes) against the wanted voice, scored at 16 kHz as `scripts/speech.py` does:

| | static −30 dB | −18 dB | −6 dB | moving −30 dB | −18 dB | −6 dB |
|---|---|---|---|---|---|---|
| input | 3.28 / 0.989 | 2.23 / 0.960 | 1.49 / 0.868 | 3.29 / 0.989 | 2.24 / 0.960 | 1.52 / 0.869 |
| `debleed` | 4.10 / 0.995 | 3.41 / 0.983 | 2.20 / 0.935 | 3.84 / 0.994 | 2.72 / 0.973 | 1.67 / 0.900 |
| stream | 4.10 / 0.995 | 3.06 / 0.979 | 1.87 / 0.920 | 3.87 / 0.993 | 2.62 / 0.971 | 1.62 / 0.892 |
| time-aligned subtraction | 3.55 / 0.992 | 2.69 / 0.970 | 1.55 / 0.894 | 3.32 / 0.989 | 2.25 / 0.960 | 1.52 / 0.870 |
| reference Wiener | 3.74 / 0.992 | 3.02 / 0.974 | 1.99 / 0.913 | 3.57 / 0.991 | 2.57 / 0.968 | 1.63 / 0.895 |
| Speex MDF + suppressor | 3.14 / 0.984 | 2.74 / 0.968 | 1.87 / 0.920 | 3.01 / 0.981 | 2.20 / 0.955 | 1.50 / 0.874 |
| WebRTC AEC3 | 1.73 / 0.852 | 1.53 / 0.823 | 1.31 / 0.738 | 1.63 / 0.835 | 1.53 / 0.823 | 1.28 / 0.733 |

The wanted sound alone, its source's track present but never heard by the mic: the batch call adds an error 41.3 dB under it on average (34.4 at most), the stream 38.5 (33.9). With a silent reference every take comes back bit for bit.

Time-aligned subtraction is the delay and gain of Clifford & Reiss (DAFx 2011): one tap cannot follow a room, and a moving one not at all. The reference Wiener is Kokkinis, Reiss & Mourjopoulos's form (IEEE TASLP 2012): the reference's power through |H|² read from the whole take, a gain against it; it takes the bleed's average spectrum, not the bleed in each cell. Speex's MDF echo canceller (speexdsp 1.2.1, 20 ms frames, 0.3 s tail) with its residual-echo suppressor, and WebRTC's AEC3 (through LiveKit's AudioProcessingModule), are telephone echo cancellers: they protect a far end, not the near voice, and in a near voice that never stops they cancel and suppress it (their wanted SI-SDR; their output is nonlinear, so the inversion splits it only roughly). FFmpeg's `anlms` and `arls` would not converge on a 10-sample delay in our setup and are left out. iZotope RX De-bleed was not available to measure.

The tuning half (even-numbered rooms, other speakers and songs): static 7.6–15.3 dB of bleed removed, moving 2.5–10.7, the wanted SI-SDR 23.1 and 24.1, PESQ at −18 dB 2.33 → 3.63 (static) and 2.32 → 2.96 (moving). Tried there, by the error to the wanted sound taken away (bleed and damage together): Speex's MDF canceller alone −8.6 dB and AEC3 −14.6 on the moving path (each learns the wanted voice); the whole take's cross-spectrum as a fixed transfer, subtracted per bin, +4.0 static and −0.8 moving; the Kalman filter given the true path as its prior +12.2 static, given only its true level per band +10.6 static and +6.4 moving, which the learned level falls 1.8 and 1.5 dB short of. That level learned from the ratio of the mic's power to the reference's: its minimum went negative (onsets, the reference's own noise and the room's tail make it lie), its 10th percentile reached 5.1 dB static; the one regressed on the other turned negative where two voices take turns; EM on the filter's posterior reached 6.3 in one pass and 5.0 run twice (it drifts), the coherence 6.2 in one pass and 9.1 run twice. Without the way back, a reference hearing the wanted voice 15 dB down cost 1.0 dB more error than it removed; with it, 3.1 dB is removed. The gradient held to B taps in one partition per block, in turn, in place of all of them, halved the time and changed nothing measurable.

**Use when:** you have the bleeding source's own track: a click or backing track, the amp's own close mic, the other mic of a pair, the drums' close mics.<br>
**Not for:** bleed with no track of its own (denoise it). A path the reference cannot predict, an overdriven amp's DI as the reference of its speaker's sound: the suppressor alone acts on it.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise), the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
