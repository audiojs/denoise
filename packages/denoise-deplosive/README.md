# @audio/denoise-deplosive [![npm](https://img.shields.io/npm/v/@audio/denoise-deplosive)](https://www.npmjs.com/package/@audio/denoise-deplosive) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-plosive: close-mic 'p', 'b' pops found as sudden aperiodic bursts under 80 Hz and taken out as a linear-phase low band, ~14 ms look-ahead

```
npm install @audio/denoise-deplosive
```

```js
import deplosive from '@audio/denoise-deplosive'
```

Takes a close-mic `p` or `b` out: a pressure pulse that rises out of nothing under 80 Hz and has no period, where a voice's or a bass note's low end repeats at its pitch. A pop begins when the 3 ms envelope of the band under 80 Hz jumps over 3× its 30 ms average while standing over `triggerRatio`× the band over 120 Hz (a voice's fundamental and up), and holds while that lasts and the low band stays aperiodic: its normalized autocorrelation's peak at a 2.5–25 ms lag (Talkin 1995) under ½, where a harmonic part would lead (Boersma 1993). The voice band is floored 6 dB under its peak over the last seconds: a room's rumble in a pause is no pop, and a pop reaches the voice's level. Removal takes the sound's own part under `crossover` away, x − w·LP(x), LP linear-phase: a pulse through a causal filter leaves the filter's response to its edges behind (with the pops' spans known, a duck to a causal 2nd-order high-pass at 100 Hz takes a median 12 dB of their error, the linear-phase band at 120 Hz 21). LP runs at ~2 kHz (three box sums decimate, a Kaiser-windowed sinc low-passes, linear interpolation returns), and its half-length is the look-ahead: the output is `latency(fs)` samples late (~14 ms, declared to the host), the duck starts 4 ms before where the pop's low band rose and is held to its end. With no pop the output is the input, sample for sample, that late.

```js
deplosive(data, { fs: 48000 })                  // in place, aligned
let write = deplosive({ fs: 48000 })            // stream: each block back whole, latency(48000) samples late; write() flushes
```

| Param | Default | |
|---|---|---|
| `triggerRatio` | `1` | the band under 80 Hz over the band over 120 Hz that a pop must exceed |
| `attenuation` | `-40` | dB, how far the band under `crossover` goes in a pop |
| `crossover` | `120` | Hz, the band a pop is taken from |
| `attack` | `0.0005` | s |
| `release` | `0.03` | s |

Against iZotope RX 12 De-plosive, `node bench/rx/deplosive.mjs` in [audio](https://github.com/audiojs/audio) (2026-10): VoiceBank clean speech (2 test speakers, 11.4 min), pops added at stop bursts found on it (Liu 1996's +b landmark), six in ten: a one-sided pressure pulse of 20–80 ms rising in 1–4 ms (as the narrations' own pops do), under 200 Hz, 0.3–2× the speech peak. Every setting chosen on 28 training speakers; RX tuned: sensitivity 1, strength 5, frequency limit 125 Hz (defaults 5, 5, 200). The error to the clean speech taken away over each pop and the 100 ms after it; SNR to the clean speech over the reels with pops; on the speech alone, its voiced frames:

| | pops: error taken away, median · 10th pct | with pops: SNR to clean | clean, voiced frames: SNR to input | voiced frames thinned > 3 dB under 250 Hz |
|---|---:|---:|---:|---:|
| RX 12 defaults | 21.8 · 11.1 dB | 19.1 dB | 22.8 dB | 4.9 % |
| RX 12 tuned | 21.9 · 13.4 dB | 22.0 dB | 46.8 dB | 0.0 % |
| 0.2.0 | 5.8 · 0.8 dB | 9.1 dB | 39.9 dB | 0.1 % |
| **0.3.0** | **22.5 · 16.3 dB** | **24.6 dB** | **53.4 dB** | **0.0 %** |

0.2.0 missed one pop in ten (a pop under a word's level never stood 4× over the band above 200 Hz) and took 6 dB of the rest. `node scripts/lowend.js deplosive` puts clean speech and music through it, then speech with pops (half-sine pressure pulses of 20–60 ms under 150 Hz before each word that follows a pause): VoiceBank+DEMAND test utterances, Spoken Wikipedia narrations, the music `repair` uses, 0.2.0 → 0.3.0; voiced frames thinned: the voiced 10 ms frames whose level under 250 Hz fell by more than 3 dB:

| | voiced frames thinned | 20–63 Hz | 63–125 Hz | 125–250 Hz |
|---|---:|---:|---:|---:|
| speech, male | 0.7% → 0.2% | −0.1 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| speech, female | 2.2% → 0.7% | −0.2 → −0.1 | 0.0 → 0.0 | 0.0 → 0.0 |
| narrations | 0.0% → 0.1% | −0.2 → −0.2 | 0.0 → 0.0 | 0.0 → 0.0 |
| audio-lena | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Vibe Ace (jazz) | 0.4% → 1.6% | 0.0 → −0.1 | 0.0 → −0.2 | 0.0 → −0.1 |
| Brahms (strings) | 0.1% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Nutcracker | 0.1% → 0.1% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| trumpet | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| bass line | 0.0% → 0.0% | −0.1 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |

Pops peaking at 0.5, 1 and 2× the utterance's peak, the error to the clean speech taken away over each pop and the 150 ms after it (dB):

| | 0.5× | 1× | 2× |
|---|---:|---:|---:|
| speech, male | 11.0 → 23.3 | 13.2 → 28.1 | 14.5 → 31.3 |
| speech, female | 12.6 → 25.8 | 14.2 → 30.6 | 15.0 → 33.6 |

**Use when:** mic plosives (`p`, `b`, `t`) producing low-frequency thuds.<br>
**Not for:** a kick drum: it is a pop to this (a jazz mix loses 3 dB under 250 Hz on 1.6 % of its frames, 0.2.0: 0.4 %); a live path that cannot wait 14 ms.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
