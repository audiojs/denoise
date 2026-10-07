# @audio/denoise-debreath [![npm](https://img.shields.io/npm/v/@audio/denoise-debreath)](https://www.npmjs.com/package/@audio/denoise-debreath) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-breath: breaths between phrases taken down, told by their length, level and the pauses either side; the room and the speech stay

```
npm install @audio/denoise-debreath
```

```js
import debreath from '@audio/denoise-debreath'
```

Takes the breaths between phrases down by `range`; the room around them, and the speech, stay. A breath is told by what an inhalation is (Ruinskiy & Lavner 2007): unvoiced, longer than a consonant, well under the speech, between phrases, its noise shaped by the open tract. Per frame of [`vad`](#lower-level-building-blocks), on the 0.3–8 kHz band: 10 dB or more over the room (the band's 10th-percentile frame), 12 dB or more under the speech (its 95th), under half of it over 4 kHz (no sibilant), under 80 % of it under 1 kHz (a breath's noise lies over the open tract's formants; a phrase's decaying vowel, its murmur and creak lie under 1 kHz, and a breath they run into is no longer taken for part of them). Runs of such frames are a breath when they last 0.15–1 s, their median stands 14 dB over the room, under 60 % of their energy lies under 1 kHz, at most half their frames are voiced (periodic in the 50–1000 Hz band, where a voice's first harmonics lie: Talkin's normalized cross-correlation 0.6 or more, the band 6 dB over its room, whose hum is periodic too; @audio/vad's periodicity, read up to 4 kHz, took a breath through narrow resonances or a codec's bands for voiced), and a room-level frame lies within 0.1 s on either side: a pause, which a word's own consonants have not. The cut works on the band over 300 Hz (split at zero phase: a room's rumble under a breath is the room's), ramps in over `attack` and out over `release` inside the breath, and never takes it under the room's level in that band, where it would leave a hole. `room` turns down what is neither speech nor breath, as 0.2 did. The whole clip is read at once (streaming: false).

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
| RX 12 tuned | −12.0 dB · 88 % | 1.96 % | −0.1 dB | −12.0 dB · 73 % | 0.99 % |
| 0.2.1 | 0.0 dB · 11 % | 0.11 % | 0.0 dB | 0.0 dB · 20 % | 0.19 % |
| 0.3.0 | −10.9 dB · 78 % | 0.49 % | 0.0 dB | −11.2 dB · 78 % | 0.58 % |
| **0.4.0** | −11.2 dB · **92 %** | 0.76 % | 0.0 dB | −11.5 dB · **88 %** | **0.49 %** |

0.3.0 missed 20 of the 90 narration breaths. Eight ran into the phrase before or after them through its quiet frames (a vowel's decay, an onset's murmur), which passed for breath by level: bridged into one run, it had no pause on that side. Six, in one narration whose codec left a breath as a few narrow bands, were read as voiced by @audio/vad's periodicity, which looks up to 4 kHz. 0.4.0 catches the six and six of the eight; it asks a frame's shape too (under 80 % of its 0.3–8 kHz energy under 1 kHz) and reads voicing where a voice's first harmonics are, under 1 kHz; the median a run needs over the room went from 15 to 14 dB, chosen on the tuning narrations (one breath more there, no speech frame more). On the tuning sets, breaths caught 51 → 54 of 55 and 19 → 20 of 26, speech frames touched 0.23 → 0.15 % and 0.21 → 0.37 %. On the test narrations it touches more speech than 0.3.0 (0.76 % against 0.49 %, still under RX's 1.96 %): most of the new spans are noise between phrases, inhalations ending at the next phrase's onset or holding a few frames periodic under 1 kHz, which the measure's 0.1 s word edges count as speech; one is a phrase's creaky end. 0.2.1 turned down what the VAD did not call speech; its speech reaches 0.3 s from a vowel across gaps of 0.15 s, which holds most breaths. Music and singing (Vibe Ace, Brahms, the Nutcracker, a trumpet, four VocalSet arpeggios), frames within 30 dB of the loudest turned down by over 3 dB: none (0.3.0, counted the same way: 1.8 % of the trumpet's; 0.2.1, as counted then: Brahms 8.8 %, Vibe Ace 2.2 %). VoiceBank+DEMAND noisy test speech, every fourth utterance, frames within 30 dB of the clean utterance's loudest turned down by over 3 dB: 0.07 % (0.3.0: 0.05 %; 0.2.1, as counted then: 5.0 %).

**Use when:** breaths between phrases on a voiceover, a podcast, a narration.<br>
**Not for:** a breath that runs into a word (no pause on either side); hiss or room tone in pauses: `room`, `gate`, `omlsa`.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
