# @audio/denoise-deplosive [![npm](https://img.shields.io/npm/v/@audio/denoise-deplosive)](https://www.npmjs.com/package/@audio/denoise-deplosive) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-plosive — detect short low-frequency bursts ('p', 'b' attacks on close mics)

```
npm install @audio/denoise-deplosive
```

```js
import deplosive from '@audio/denoise-deplosive'
```

Ducks the band under `crossover` for a close-mic `p` or `b`: a pressure pulse that rises out of nothing, outweighs the band above it and has no period, where a voice's or a bass note's low end repeats at its pitch. A duck begins when the low band's 3 ms envelope jumps over 3× its 30 ms average while standing over `triggerRatio`× the high band, and holds while that lasts and the low band stays aperiodic: its normalized autocorrelation's peak at a 2.5–25 ms lag (Talkin 1995) under ½, where a harmonic part would lead (Boersma 1993). The high band is floored 20 dB under its peak over the last seconds, so a room's own rumble in a pause is no pop. The duck crossfades toward the high-passed sound, x − (1 − g)·(x − HP(x)), so it never lifts a band; with no pop the output equals the input sample for sample.

```js
deplosive(data, { triggerRatio: 4, attack: 0.002, release: 0.03 })
```

| Param | Default | |
|---|---|---|
| `triggerRatio` | `4` | LF/high envelope ratio a pop must exceed |
| `attenuation` | `-18` | dB cut on the LF band when triggered |
| `crossover` | `200` | Hz — LF/high split point |
| `attack` | `0.002` | s |
| `release` | `0.03` | s |

At full duck the response is −24 dB at 60 Hz, −17 at 100, −2.1 at 250 and −0.5 at 400 Hz; 0.1.10's g·LP + (x − LP), x − LP being no high-pass, gave −7.5, −3.1, +1.8 and +1.3 dB, and it ducked any low end over 4× the high band: a voice's, a jazz track's, a bass line's. `node scripts/lowend.js deplosive` puts clean speech and music through it, then speech with pops added (synthetic: half-sine pressure pulses of 20–60 ms under 150 Hz before each word that follows a pause; no recordings of real pops over their clean speech exist here). VoiceBank+DEMAND test utterances, Spoken Wikipedia narrations, the music `repair` uses, 0.1.10 → now; voiced frames thinned: the voiced 10 ms frames whose level under 250 Hz fell by more than 3 dB:

| | voiced frames thinned | 20–63 Hz | 63–125 Hz | 125–250 Hz |
|---|---:|---:|---:|---:|
| speech, male | 8.9% → 0.7% | −1.2 → −0.1 | −0.5 → 0.0 | −0.1 → 0.0 |
| speech, female | 16.3% → 2.2% | −3.4 → −0.2 | −0.3 → 0.0 | 0.2 → 0.0 |
| narrations | 2.4% → 0.0% | −0.7 → −0.2 | −0.2 → 0.0 | 0.0 → 0.0 |
| audio-lena | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Vibe Ace (jazz) | 41.3% → 0.4% | −4.3 → 0.0 | −2.9 → 0.0 | −0.6 → 0.0 |
| Brahms (strings) | 0.4% → 0.1% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Nutcracker | 3.6% → 0.1% | 0.0 → 0.0 | −0.1 → 0.0 | 0.0 → 0.0 |
| trumpet | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| bass line | 53.1% → 0.0% | −8.3 → −0.1 | −4.6 → 0.0 | 0.2 → 0.0 |

Pops peaking at 0.5, 1 and 2× the utterance's peak, the error to the clean speech taken away over each pop and the 150 ms after it (dB):

| | 0.5× | 1× | 2× |
|---|---:|---:|---:|
| speech, male | 11.5 → 11.0 | 13.6 → 13.2 | 14.4 → 14.5 |
| speech, female | 13.9 → 12.6 | 14.7 → 14.2 | 14.9 → 15.0 |

0.1.10 often met a pop with its duck already down on the pause's rumble before the word; it now waits for the pop, and takes the first few ms of it a little less.

**Use when:** mic plosives (`p`, `b`, `t`) producing low-frequency thuds.<br>
**Not for:** a kick drum or a bass note struck hard: so sudden a low end is ducked for its first few ms, before its period shows.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
