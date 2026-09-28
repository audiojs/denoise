# @audio/denoise-dehum [![npm](https://img.shields.io/npm/v/@audio/denoise-dehum)](https://www.npmjs.com/package/@audio/denoise-dehum) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Mains hum removal: measured, then notched; no hum, no change

```
npm install @audio/denoise-dehum
```

```js
import dehum, { measure } from '@audio/denoise-dehum'
```

Measures the hum, then notches it: biquad notches at the harmonics of the mains frequency that stand out, at the frequency measured. Without hum the audio comes back untouched. Notches cost speech wherever there is no hum to remove: a voice's harmonics sweep through them and each notch rings on what it takes out (the old default, four notches at 50–200 Hz, took clean VoiceBank speech from PESQ 4.64 to 3.2).

```js
dehum(data, { fs })                                            // 50 or 60 Hz, measured; nothing without hum
dehum(data, { fs, freq: 60 })                                  // the 60 Hz series, its exact frequency measured
dehum(data, { fs, freq: 60, harmonics: 4 })                    // notch 60–240 Hz whatever is there
measure(data, fs)                                              // → { f0, harmonics } or null
```

| Param | Default | |
|---|---|---|
| `freq` | measured | Fundamental, Hz. Omitted: the 50 or 60 Hz series, whichever stands out. Given: its exact frequency within ±0.4 % (±`drift` Hz with `adaptive`) |
| `harmonics` | those present | Notch h = 1…`harmonics`, present or not. Omitted: the harmonics up to 1 kHz that stand out |
| `Q` | `30` | Notch sharpness — higher = narrower |

The measurement is one Fourier transform over the signal (its first 80–90 s, taken down to 3 kHz), where a hum line, steady for minutes, gathers into a peak 1/T wide while speech spreads. Each line is judged by its peak over the median power of the ±8 Hz around it: hum is there when the fundamental stands out by 20 dB or two of the first six harmonics by 15 dB (searched within ±0.4 %, the mains tolerance); the fundamental is the least-squares fit f0 = Σh·p<sub>h</sub>/Σh² to the interpolated peaks, and each harmonic up to 1 kHz found within ±0.05 % of h·f0 at 13 dB is notched. It needs a second of signal: in blocks, pass the same `params` object and give the first call a second or more. As an `audio` op it is whole-clip (`streaming: false`).

**Use when:** mains buzz, ground-loop hum, fixed tonal interference.<br>
**Not for:** broadband noise (use `wiener`/`omlsa`); shifting tones (use spectral methods).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
