# @audio/denoise-dewind [![npm](https://img.shields.io/npm/v/@audio/denoise-dewind)](https://www.npmjs.com/package/@audio/denoise-dewind) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-wind / de-rumble — adaptive high-pass that opens wider when low-frequency

```
npm install @audio/denoise-dewind
```

```js
import dewind from '@audio/denoise-dewind'
```

A high-pass that comes in while wind blows and stays out otherwise. Wind is turbulence at the microphone: its energy lies under a few hundred Hz and has no period (Nelke & Vary 2014), where a voice's or an instrument's low end repeats at its pitch. Every 5 ms the energy under 200 Hz, weighed by how aperiodic it is, is set against the 300–2000 Hz band: 1 − r of it is noise, r the normalized autocorrelation's peak at a 2.5–25 ms lag (Talkin 1995; a harmonic H in noise N reads H / (H + N), Boersma 1993). The mid band is floored 20 dB under its peak over the last seconds, so a room's own rumble in a pause is no wind. Once the low band's noise outweighs the mid band, aperiodic for 30 ms, a Butterworth high-pass crossfades in over `attack`, its cutoff rising from `cutoffMin` toward `cutoffMax` with the wind. It goes back out over `release`, or within 5 ms once the low end turns periodic: a voice or a note began. With no wind the output equals the input, sample for sample.

```js
dewind(data, { cutoffMin: 60, cutoffMax: 250 })
```

| Param | Default | |
|---|---|---|
| `cutoffMin` | `60` | Hz, the cutoff in light wind |
| `cutoffMax` | `250` | Hz, the cutoff in strong wind |
| `order` | `2` | Butterworth sections (each 12 dB/oct), −3 dB at the cutoff |
| `attack` | `0.05` | s, how fast it comes in |
| `release` | `0.4` | s, how slowly it goes back out |
| `blockSize` | 5 ms | Re-estimation interval (samples) |

`node scripts/lowend.js dewind` puts clean speech and music through it, then speech with wind added (synthetic: Gaussian noise shaped and gusting as Nelke & Vary measure it, under 100 Hz and ±8 dB at 1 Hz; no recordings of real wind over their clean speech exist here). VoiceBank+DEMAND test utterances (every fourth: p232 male, p257 female), ten Spoken Wikipedia narrations, the music `repair` uses, 0.1.9 → now; voiced frames thinned: the voiced 10 ms frames whose level under 250 Hz fell by more than 3 dB (now mostly the first syllable after a recording's opening room tone, which reads as wind until the voice comes in):

| | voiced frames thinned | 20–63 Hz | 63–125 Hz | 125–250 Hz |
|---|---:|---:|---:|---:|
| speech, male | 73.5% → 5.1% | −10.5 → −0.2 | −7.1 → 0.0 | −3.4 → 0.0 |
| speech, female | 45.6% → 8.8% | −23.4 → −1.2 | −2.9 → −0.1 | −1.9 → 0.0 |
| narrations | 33.4% → 2.4% | −6.6 → −0.1 | −3.2 → −0.1 | −1.1 → 0.0 |
| audio-lena | 0.2% → 0.0% | −1.6 → 0.0 | −1.0 → 0.0 | −0.1 → 0.0 |
| Vibe Ace (jazz) | 94.5% → 0.1% | −27.7 → 0.0 | −18.8 → 0.0 | −6.0 → 0.0 |
| Brahms (strings) | 22.0% → 0.0% | −5.1 → 0.0 | −2.7 → 0.0 | −0.4 → 0.0 |
| Nutcracker | 12.6% → 0.0% | −6.4 → 0.0 | −2.6 → 0.0 | −0.1 → 0.0 |
| trumpet | 0.0% → 0.0% | −7.3 → 0.0 | −0.1 → 0.0 | 0.0 → 0.0 |
| bass line | 100.0% → 0.0% | −32.8 → 0.0 | −18.7 → 0.0 | −5.8 → 0.0 |

Wind at a speech-to-wind ratio of +10, 0 and −10 dB, the error to the clean speech taken away (dB):

| | +10 dB | 0 dB | −10 dB |
|---|---:|---:|---:|
| speech, male | −10.9 → 0.1 | −1.2 → 2.4 | 7.7 → 5.7 |
| speech, female | −11.1 → −0.5 | −1.5 → 2.4 | 7.5 → 5.6 |

0.1.9 took any low end that outweighed the mid band for wind, a voice's and a bass line's too, behind a fixed 60 Hz floor whose two Q 0.707 sections were −6 dB at the cutoff. Its larger take of the wind came with as much of the voice: the error to the clean speech grew, by 11 dB at +10 dB and by 1.2–1.5 dB at 0 dB. At −10 dB, where the wind dwarfs the voice, a blanket cut still takes more (7.5–7.7 dB against 5.6–5.7). The wind under a voiced low end is what a time-domain cutoff can't take without the voice; it is now left there.

**Use when:** intermittent wind buffeting — the adaptive cutoff opens on gusts and closes between them (measured: beats `wiener` on gusty wind at ~1/10 the CPU).<br>
**Not for:** continuous rumble under speech — a time-domain cutoff can't separate overlapping spectra; use `wiener`/`omlsa` there (measured ~9 dB vs ~1 dB SNR gain). Nor a lone thump (`deplosive`), or a steady low tone or hum, which has a period (`dehum`, `highpass`). An LPC-null post-filter was evaluated and rejected: voiced speech is as AR-predictable as wind, so nulling wind poles whitens vowels too (LSD improves, SNR and speech level degrade).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
