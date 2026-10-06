# @audio/denoise-dewind [![npm](https://img.shields.io/npm/v/@audio/denoise-dewind)](https://www.npmjs.com/package/@audio/denoise-dewind) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-wind / de-rumble — per STFT bin, the wind between and under the harmonics taken, the harmonics kept

```
npm install @audio/denoise-dewind
```

```js
import dewind from '@audio/denoise-dewind'
```

Takes wind out from under a voice or an instrument and leaves their harmonics. Wind is turbulence at the microphone: noise under a few hundred Hz with no period, in gusts (Nelke & Vary, IWAENC 2014), where a voice's low end is a row of harmonics. A high-pass can only take everything under its cutoff, the voice's low harmonics with the wind; here each STFT bin under `cutoff` is weighed against a wind spectrum read from the frame itself.

The frame is the power of two nearest 85 ms (4096 samples at 44.1 and 48 kHz), so a 100 Hz voice's harmonics stand 8 bins apart with valleys between them. The wind spectrum is the periodogram's morphological opening over 5 bins: every peak narrower than that is cut, and a steady harmonic under a Hann window is 4 bins wide, so the harmonics go and the broad wind stays (the inverse harmonic mask of Nelke, Naylor & Vary, ICASSP 2015, without a pitch track). Over 100 Hz it is held to 4× the least it has been over the last 1.5 s relative to its level under 100 Hz (minimum statistics, Martin 2001): wind keeps its shape while it gusts, and a voice's valleys, onsets and unvoiced sounds don't pass for it. A voiced harmonic whose pitch moves within the frame spreads wider than 5 bins and would pass for floor too (a male voice's fundamental, under 100 Hz, where that cap doesn't reach): under a peak standing 6 dB over the floor, wider than 5 bins and 15 dB over the minima either side of it, the floor is bridged between those minima, in dB. The gain is OM-LSA's form (Cohen & Berdugo 2001): a Wiener gain on the decision-directed a priori SNR, raised to the speech presence probability, which takes a fixed 15 dB prior (Gerkmann & Hendriks 2012) and an a priori absence of 0.2 on a harmonic (a peak 6 dB over the wind), 0.9 elsewhere. So a harmonic keeps what of it stands over the wind, and the wind's own random peaks don't come through as musical noise.

It runs while wind blows: the 20–300 Hz band aperiodic (its normalized autocorrelation, taken through the frame's spectrum over the window's, under ½ at 2.5–25 ms; a harmonic H in noise N reads H / (H + N), Boersma 1993) and its noise over the 300–2000 Hz band, floored 20 dB under its peak over the last seconds, three frames in a row (a 150 ms gap between words shows it); then held 1 s, through the words, whose low end hides it. A bass line, a kick drum's body or a voice's low end repeats; a room's quiet rumble in a pause is no wind next to a voice. With no wind the output equals the input, sample for sample, `frameSize − 1` samples later (85 ms at 48 kHz, the manifest's declared latency).

```js
dewind(data, { fs: 48000 })                     // in place
let write = dewind({ fs: 48000 })               // stream: write(chunk) → the samples done, write() → the rest
```

| Param | Default | |
|---|---|---|
| `cutoff` | `8000` | Hz, the top of the band wind is taken from; read every frame. Most wind lies under 500 Hz, strong wind rushes to several kHz |
| `attenuation` | `-20` | dB, the most a bin is turned down; `0` takes nothing |
| `frameSize` | 85 ms | STFT frame, a power of two; the hop a quarter |

`python scripts/wind.py fetch`, then `node scripts/lowend.js dewind` puts clean speech and music through it, then speech with wind: synthetic (Gaussian noise shaped and gusting as Nelke & Vary measure it), generated (the SC-Wind-Noise-Generator, Mirabilii et al., IWAENC 2022: spectrum and gusts by wind speed) and recorded (twelve CC0 recordings of wind on a microphone, freesound.org), half of the generated and recorded tuning the defaults, half below. VoiceBank+DEMAND test utterances (every fourth: p232 male, p257 female), ten Spoken Wikipedia narrations, the music `repair` uses, 0.3.0 → now; voiced frames thinned: the voiced 10 ms frames, from the first to the last within 20 dB of the take's loudest, whose level under 250 Hz fell by more than 3 dB; their periodic part: whose periodic energy there (r·E, Boersma 1993) did. 0.3.0's figures (male 9.1 %, female 16.2 %) also counted the room tone before and after the words, flagged voiced by its hum, whose rumble going is no thinning:

| | untouched | voiced frames thinned | their periodic part | 20–63 Hz | 63–125 Hz | 125–250 Hz |
|---|---:|---:|---:|---:|---:|---:|
| speech, male | 0% → 0% | 4.8% → 3.2% | 3.0% → 1.4% | −1.7 → −1.3 | −0.5 → −0.2 | −0.1 → 0.0 |
| speech, female | 0% → 0% | 7.9% → 7.9% | 3.0% → 3.0% | −4.5 → −4.5 | −0.7 → −0.7 | 0.0 → 0.0 |
| narrations | 20% → 20% | 5.9% → 4.8% | 5.1% → 4.0% | −0.7 → −0.6 | −0.3 → −0.2 | −0.2 → −0.1 |
| audio-lena | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Vibe Ace (jazz) | 0% → 0% | 1.2% → 1.1% | 0.9% → 0.8% | −0.2 → −0.2 | −0.1 → −0.1 | −0.1 → −0.1 |
| Brahms (strings) | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Nutcracker | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| trumpet | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| bass line | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |

A recording's own low rumble, where it outweighs the mid band in a pause, reads as wind: VoiceBank's room tone before each take engages it for the take's first second, and narrations recorded at home in their pauses. The rumble is noise and goes. Of a voice under it, 0.3.0 thinned mostly a male fundamental moving in pitch, spread wider than the opening under 100 Hz, where the cap doesn't reach; now bridged, its periodic part thins half as often. What still thins: onsets, whose low end an 85 ms frame smears, and, in female takes, frames whose low end under the fundamental is mostly that rumble. Orchestral music, a trumpet and a bass line come back untouched; a jazz track's drums engage it for moments.

Wind at a speech-to-wind ratio of +10, 0 and −10 dB, the error to the clean speech taken away (dB):

| | +10 dB | 0 dB | −10 dB |
|---|---:|---:|---:|
| synthetic | 5.1 → 5.4 | 9.9 → 10.0 | 13.1 → 13.3 |
| generated | 4.4 → 4.8 | 8.3 → 8.4 | 11.3 → 11.4 |
| recorded | 3.8 → 4.1 | 7.5 → 7.6 | 10.2 → 10.3 |

The wind removed and the speech kept, by phase inversion (Hagerman & Olofsson, Acta Acustica 2004: the op on s + n and on s − n, ŝ = (y₊ + y₋)/2, n̂ = (y₊ − y₋)/2), dB:

| | wind removed, +10 dB | 0 dB | −10 dB | speech kept, +10 dB | 0 dB | −10 dB |
|---|---:|---:|---:|---:|---:|---:|
| synthetic | 9.3 → 9.2 | 14.0 → 14.1 | 15.0 → 15.2 | −0.3 → −0.2 | −0.8 → −0.7 | −1.8 → −1.7 |
| generated | 8.8 → 8.6 | 12.4 → 12.3 | 13.3 → 13.4 | −0.4 → −0.3 | −1.2 → −1.1 | −3.0 → −2.9 |
| recorded | 8.0 → 7.8 | 10.8 → 10.8 | 11.4 → 11.5 | −0.4 → −0.3 | −1.1 → −1.0 | −2.1 → −2.1 |

PESQ (wideband), STOI and DNSMOS P.835 of the same outputs, the three winds together (`python scripts/wind.py score DIR/now test`; scored at 16 kHz as `scripts/speech.py` does):

| | PESQ | STOI | SIG | BAK | OVRL |
|---|---:|---:|---:|---:|---:|
| +10 dB: input | 1.76 | 0.939 | 3.51 | 3.36 | 2.89 |
| 0.3.0 | 2.30 | 0.935 | 3.34 | 3.61 | 2.88 |
| now | 2.40 | 0.932 | 3.33 | 3.67 | 2.89 |
| 0 dB: input | 1.21 | 0.874 | 3.25 | 2.44 | 2.31 |
| 0.3.0 | 1.58 | 0.875 | 3.20 | 3.19 | 2.58 |
| now | 1.68 | 0.869 | 3.16 | 3.31 | 2.59 |
| −10 dB: input | 1.06 | 0.754 | 2.06 | 1.43 | 1.43 |
| 0.3.0 | 1.16 | 0.756 | 2.83 | 2.41 | 2.08 |
| now | 1.21 | 0.750 | 2.88 | 2.65 | 2.19 |
| all: input | 1.34 | 0.856 | 2.94 | 2.41 | 2.21 |
| 0.3.0 | 1.68 | 0.855 | 3.12 | 3.07 | 2.51 |
| now | 1.76 | 0.850 | 3.12 | 3.21 | 2.56 |

STOI barely moves: its bands begin at 150 Hz, above most of the wind. Wind on a microphone rushes on above 1.5 kHz, 0.3.0's cutoff, where a voice's consonants and the upper harmonics stand over it: taken up to 8 kHz, it goes 5–11 dB down at 2–4 kHz and 4–9 dB at 4–8 kHz, the speech there 0.1–1.6 dB (on the tuning material); PESQ gains 0.08, BAK 0.14, STOI loses 0.005, from a gain that now moves over the upper bands as well. Clean speech and music lose under 0.07 dB above 1 kHz. In light wind DNSMOS's SIG drops 0.18; an ideal Wiener gain from the wind's own spectrum under 1.5 kHz lost 0.12 there on the tuning material.

The wind goes under the words too, between and under the harmonics; what a voice loses is mostly the harmonics the wind buries (its low end at −10 dB), and onsets.

**Use when:** wind on a microphone under a voice or an instrument, gusting or steady; a recording's low rumble (traffic, a fan) where it outweighs the mid band in the pauses.<br>
**Not for:** a lone thump (`deplosive`), a steady low tone or hum, which has a period (`dehum`, `highpass`), or broadband noise (`omlsa`, `wiener`). Air rushing over the whole band is taken only under `cutoff`. A neural model (`@audio/neural-denoise`'s DeepFilterNet3) takes more of the wind and keeps more of the voice; dewind leaves a sound with no aperiodic low end as it is (music, a voice with no rumble under it), streams at a frame's delay, and needs no model.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
