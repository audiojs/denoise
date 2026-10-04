# @audio/denoise-debreath [![npm](https://img.shields.io/npm/v/@audio/denoise-debreath)](https://www.npmjs.com/package/@audio/denoise-debreath) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-breath — VAD-driven downward attenuation between phrases: breaths, mouth noise, the room

```
npm install @audio/denoise-debreath
```

```js
import debreath from '@audio/denoise-debreath'
```

VAD-driven inverse gate: what [`@audio/vad`](https://github.com/audiojs/denoise/tree/main/packages/vad) does not call speech (breaths, mouth noise, the room between phrases) goes down by `range`. Speech is voicing and the sound over the noise floor next to it, so a soft word in noise stays and a breath that a pause parts from the phrase goes. A gap under 0.15 s is no breath (a breath lasts 0.15–0.6 s, Ruinskiy & Lavner 2007) and stays; the gain holds 50 ms past speech. The whole clip is read at once (streaming: false), so the gain is zero-phase: it rises over `attack` before speech starts and falls over `release` after it ends.

```js
debreath(data, { range: -10 })                                // -10 dB between phrases (default -12)
```

| Param | Default | |
|---|---|---|
| `range` | `-12` | dB — how far everything between phrases goes down |
| `attack` | `0.005` | s — the gain rises over this before speech starts |
| `release` | `0.1` | s — and falls over this after speech ends |

`snrTh` and `flatTh` (0.1) are gone: they tuned the old detector, whose floor was the 10th-percentile frame energy of the whole input. Under noise that percentile is the noise, and every word under 9 dB over it went down. Measured with `python scripts/vad.py` in [@audio/denoise](https://github.com/audiojs/denoise) (VoiceBank+DEMAND test set, ten Spoken Wikipedia narrations; defaults chosen on the training subset and ten other narrations), 0.1.8 → 0.2.1, frames turned down by over 3 dB:

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

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
