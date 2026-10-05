# @audio/denoise-dewind [![npm](https://img.shields.io/npm/v/@audio/denoise-dewind)](https://www.npmjs.com/package/@audio/denoise-dewind) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-wind / de-rumble — per STFT bin, the wind between and under the harmonics taken, the harmonics kept

```
npm install @audio/denoise-dewind
```

```js
import dewind from '@audio/denoise-dewind'
```

Takes wind out from under a voice or an instrument and leaves their harmonics. Wind is turbulence at the microphone: noise under a few hundred Hz with no period, in gusts (Nelke & Vary, IWAENC 2014), where a voice's low end is a row of harmonics. A high-pass can only take everything under its cutoff, the voice's low harmonics with the wind; here each STFT bin under `cutoff` is weighed against a wind spectrum read from the frame itself.

The frame is the power of two nearest 85 ms (4096 samples at 44.1 and 48 kHz), so a 100 Hz voice's harmonics stand 8 bins apart with valleys between them. The wind spectrum is the periodogram's morphological opening over 5 bins: every peak narrower than that is cut, and a steady harmonic under a Hann window is 4 bins wide, so the harmonics go and the broad wind stays (the inverse harmonic mask of Nelke, Naylor & Vary, ICASSP 2015, without a pitch track). Over 100 Hz it is held to 4× the least it has been over the last 1.5 s relative to its level under 100 Hz (minimum statistics, Martin 2001): wind keeps its shape while it gusts, and a voice's valleys, onsets and unvoiced sounds don't pass for it. The gain is OM-LSA's form (Cohen & Berdugo 2001): a Wiener gain on the decision-directed a priori SNR, raised to the speech presence probability, which takes a fixed 15 dB prior (Gerkmann & Hendriks 2012) and an a priori absence of 0.2 on a harmonic (a peak 6 dB over the wind), 0.9 elsewhere. So a harmonic keeps what of it stands over the wind, and the wind's own random peaks don't come through as musical noise.

It runs while wind blows: the 20–300 Hz band aperiodic (its normalized autocorrelation, taken through the frame's spectrum over the window's, under ½ at 2.5–25 ms; a harmonic H in noise N reads H / (H + N), Boersma 1993) and its noise over the 300–2000 Hz band, floored 20 dB under its peak over the last seconds, three frames in a row (a 150 ms gap between words shows it); then held 1 s, through the words, whose low end hides it. A bass line, a kick drum's body or a voice's low end repeats; a room's quiet rumble in a pause is no wind next to a voice. With no wind the output equals the input, sample for sample, `frameSize − 1` samples later (85 ms at 48 kHz, the manifest's declared latency).

```js
dewind(data, { fs: 48000 })                     // in place
let write = dewind({ fs: 48000 })               // stream: write(chunk) → the samples done, write() → the rest
```

| Param | Default | |
|---|---|---|
| `cutoff` | `1500` | Hz, the top of the band wind is taken from; read every frame |
| `attenuation` | `-20` | dB, the most a bin is turned down; `0` takes nothing |
| `frameSize` | 85 ms | STFT frame, a power of two; the hop a quarter |

`python scripts/wind.py fetch`, then `node scripts/lowend.js dewind` puts clean speech and music through it, then speech with wind: synthetic (Gaussian noise shaped and gusting as Nelke & Vary measure it), generated (the SC-Wind-Noise-Generator, Mirabilii et al., IWAENC 2022: spectrum and gusts by wind speed) and recorded (twelve CC0 recordings of wind on a microphone, freesound.org), half of the generated and recorded tuning the defaults, half below. VoiceBank+DEMAND test utterances (every fourth: p232 male, p257 female), ten Spoken Wikipedia narrations, the music `repair` uses, 0.2.0 → now; voiced frames thinned: the voiced 10 ms frames whose level under 250 Hz fell by more than 3 dB; their periodic part: whose periodic energy there (r·E, Boersma 1993) did:

| | untouched | voiced frames thinned | their periodic part | 20–63 Hz | 63–125 Hz | 125–250 Hz |
|---|---:|---:|---:|---:|---:|---:|
| speech, male | 0% → 0% | 5.1% → 9.1% | 4.9% → 7.2% | −0.2 → −1.7 | 0.0 → −0.5 | 0.0 → −0.1 |
| speech, female | 0% → 0% | 8.8% → 16.2% | 8.5% → 11.6% | −1.2 → −4.5 | −0.1 → −0.7 | 0.0 → 0.0 |
| narrations | 0% → 20% | 2.4% → 6.0% | 2.4% → 5.2% | −0.1 → −0.7 | −0.1 → −0.3 | 0.0 → −0.2 |
| audio-lena | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Vibe Ace (jazz) | 0% → 0% | 0.1% → 1.2% | 0.1% → 0.9% | 0.0 → −0.2 | 0.0 → −0.1 | 0.0 → −0.1 |
| Brahms (strings) | 0% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| Nutcracker | 0% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| trumpet | 100% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |
| bass line | 0% → 100% | 0.0% → 0.0% | 0.0% → 0.0% | 0.0 → 0.0 | 0.0 → 0.0 | 0.0 → 0.0 |

A recording's own low rumble, where it outweighs the mid band in a pause, reads as wind: VoiceBank's room tone before each take engages it for the take's first second, and narrations recorded at home in their pauses. The rumble goes; the voiced frames that thin are onsets, whose low end an 85 ms frame smears into a broad bump that reads as floor, and frames whose low end is mostly that rumble. Orchestral music, a trumpet and a bass line come back untouched; a jazz track's drums engage it for moments.

Wind at a speech-to-wind ratio of +10, 0 and −10 dB, the error to the clean speech taken away (dB):

| | +10 dB | 0 dB | −10 dB |
|---|---:|---:|---:|
| synthetic | −0.1 → 5.1 | 2.4 → 9.9 | 5.6 → 13.1 |
| generated | −0.1 → 4.4 | 1.3 → 8.3 | 4.1 → 11.3 |
| recorded | −0.4 → 3.8 | 1.1 → 7.5 | 3.2 → 10.2 |

The wind removed and the speech kept, by phase inversion (Hagerman & Olofsson, Acta Acustica 2004: the op on s + n and on s − n, ŝ = (y₊ + y₋)/2, n̂ = (y₊ − y₋)/2), dB:

| | wind removed, +10 dB | 0 dB | −10 dB | speech kept, +10 dB | 0 dB | −10 dB |
|---|---:|---:|---:|---:|---:|---:|
| synthetic | 2.2 → 9.3 | 5.3 → 14.0 | 7.0 → 15.0 | −0.1 → −0.3 | −0.4 → −0.8 | −0.7 → −1.8 |
| generated | 1.7 → 8.8 | 3.5 → 12.4 | 5.4 → 13.3 | −0.1 → −0.4 | −0.5 → −1.2 | −0.7 → −3.0 |
| recorded | 1.3 → 8.0 | 3.1 → 10.8 | 4.0 → 11.4 | −0.1 → −0.4 | −0.4 → −1.1 | −0.3 → −2.1 |

PESQ (wideband), STOI and DNSMOS P.835 of the same outputs, the three winds together (`python scripts/wind.py score DIR/now test`; scored at 16 kHz as `scripts/speech.py` does):

| | PESQ | STOI | SIG | BAK | OVRL |
|---|---:|---:|---:|---:|---:|
| +10 dB: input | 1.76 | 0.939 | 3.51 | 3.36 | 2.89 |
| 0.2.0 | 1.67 | 0.937 | 3.47 | 3.44 | 2.90 |
| now | 2.30 | 0.935 | 3.34 | 3.61 | 2.88 |
| 0 dB: input | 1.21 | 0.874 | 3.25 | 2.44 | 2.31 |
| 0.2.0 | 1.23 | 0.870 | 3.26 | 2.66 | 2.41 |
| now | 1.58 | 0.875 | 3.20 | 3.19 | 2.58 |
| −10 dB: input | 1.06 | 0.754 | 2.06 | 1.43 | 1.43 |
| 0.2.0 | 1.09 | 0.753 | 2.36 | 1.67 | 1.63 |
| now | 1.16 | 0.756 | 2.83 | 2.41 | 2.08 |
| all: input | 1.34 | 0.856 | 2.94 | 2.41 | 2.21 |
| 0.2.0 | 1.33 | 0.853 | 3.03 | 2.59 | 2.31 |
| now | 1.68 | 0.855 | 3.12 | 3.07 | 2.51 |

STOI barely moves: its bands begin at 150 Hz, above most of the wind. In light wind DNSMOS's SIG drops 0.17; an ideal Wiener gain from the wind's own spectrum under 1.5 kHz lost 0.12 there on the tuning material.

0.2.0 high-passed only between the words: a voiced low end sent its filter out, so the wind under the words stayed. The wind now goes under the words too, between and under the harmonics; what a voice loses is mostly the harmonics the wind buries (its low end at −10 dB), and onsets.

**Use when:** wind on a microphone under a voice or an instrument, gusting or steady; a recording's low rumble (traffic, a fan) where it outweighs the mid band in the pauses.<br>
**Not for:** a lone thump (`deplosive`), a steady low tone or hum, which has a period (`dehum`, `highpass`), or broadband noise (`omlsa`, `wiener`). Air rushing over the whole band is taken only under `cutoff`. A neural model (`@audio/neural-denoise`'s DeepFilterNet3) takes more of the wind and keeps more of the voice; dewind leaves a sound with no aperiodic low end as it is (music, a voice with no rumble under it), streams at a frame's delay, and needs no model.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
