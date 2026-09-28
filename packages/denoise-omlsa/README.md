# @audio/denoise-omlsa [![npm](https://img.shields.io/npm/v/@audio/denoise-omlsa)](https://www.npmjs.com/package/@audio/denoise-omlsa) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

OM-LSA: Optimally Modified Log-Spectral Amplitude (Cohen & Berdugo 2001), with IMCRA noise (Cohen 2003) or a noise learned where it plays alone

```
npm install @audio/denoise-omlsa
```

```js
import omlsa from '@audio/denoise-omlsa'
```

Optimally-Modified Log-Spectral Amplitude estimator (Cohen & Berdugo 2001) with IMCRA noise estimation (Cohen 2003). The log-spectral amplitude gain when speech is present, weighed against a floor by the speech presence probability p: `G = G_H1^p · G_min^(1−p)` (eq. 16). The a priori SNR is decision-directed on G<sub>H1</sub> (eq. 18), the a priori speech absence is estimated from its spread over time and neighbouring bins (§4), the noise spectrum comes from IMCRA. As Cohen's own `omlsa.m`, a bin whose speech absence reaches 0.9 counts as noise: noise that happens to peak keeps G<sub>min</sub> and leaves no musical tone, so what remains of the noise is the noise, G<sub>min</sub> quieter. Time constants are set for 8 ms frames and rescaled to the actual frame step (`omlsa.m` rescales by the reciprocal, which lengthens them at 48 kHz). `scripts/reference.py` holds a numpy version written from the papers; on 16 kHz VoiceBank frames it gives `omlsa.m`'s noise track, speech absence and gains to the last bit (but for near-empty bins, where `omlsa.m`'s absolute 1e-10 floors bind), and test.js holds this code to it.

A noise that holds still can be learned instead: `profile`, the noise's PSD (`noiseProfile` of a stretch where it plays alone), or, in the batch form, `noiseFrames`/`profileFrom`/`profileTo` naming that stretch. The noise is then held (`known` of @audio/noise-estimate), and p reads the observation alone: (9) at the a priori SNR of speech ξ<sub>H1</sub> = 15 dB and q = 0.5 (Gerkmann & Hendriks 2012), and 0 where the estimated q reaches 0.9, as before. The decision-directed ξ lags a word's onset; a known noise need not wait for it. On the VoiceBank+DEMAND test set, the noise learned from the half second before each speaker starts and G<sub>min</sub> −12 dB: PESQ 2.48, SI-SDR 15.2 dB, OVRL 2.89, against 2.40, 14.5 and 2.86 tracked; on steady noise under speech and music the noise goes exactly G<sub>min</sub> down, with no musical noise from −12 to −20 dB (log kurtosis ratio 0.00; in the half second after music stops, 0.06 at −12 dB and 0.46 at −20). `processor(opts)` is the gain as an @audio/stft frame process, for a host running its own frames: audio's `denoise` op learns a print from a range and runs it so.

```js
omlsa(data, { fs })
omlsa(data, { fs, gMin: -10 })                                 // gentler: more room tone left
omlsa(data, { fs, profileFrom: 0, profileTo: fs / 2, gMin: -12 })   // the noise learned from the first half second
```

| Param | Default | |
|---|---|---|
| `gMin` | `-15` | dB: what noise-only bins keep (alias `gMinDb`) |
| `alpha` | `0.98` | Decision-directed smoothing (alias of `alphaDD`) |
| `xiMin` | `10^−2.5` | A priori SNR floor (−25 dB) |
| `qPrior` | estimated | A fixed a priori speech absence instead of the estimate |
| `frameSize` | power of two nearest 32 ms | STFT frame: 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48 (`frame(fs)`) |
| `hopSize` | `frameSize/4` | |
| `profile` | tracked | A known noise PSD (`frameSize/2+1` bins), held |
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to learn the profile from (batch) |

**Use when:** speech in non-stationary noise (street, café, car); generally the highest-quality choice for noisy speech. A steady noise with a stretch of it alone (hiss, hum, a fan, room tone): learn it, `profile`.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
