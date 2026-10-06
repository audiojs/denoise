# @audio/denoise-omlsa [![npm](https://img.shields.io/npm/v/@audio/denoise-omlsa)](https://www.npmjs.com/package/@audio/denoise-omlsa) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

OM-LSA: Optimally Modified Log-Spectral Amplitude (Cohen & Berdugo 2001), with IMCRA noise (Cohen 2003) or a noise learned where it plays alone

```
npm install @audio/denoise-omlsa
```

```js
import omlsa from '@audio/denoise-omlsa'
```

Optimally-Modified Log-Spectral Amplitude estimator (Cohen & Berdugo 2001) with IMCRA noise estimation (Cohen 2003). The log-spectral amplitude gain when speech is present, weighed against a floor by the speech presence probability p: `G = max(G_H1, G_min)^p · G_min^(1−p)` (eq. 16 with G<sub>H1</sub> floored at G<sub>min</sub>: as written it took a bin below G<sub>min</sub> wherever G<sub>H1</sub> was under it, to −18 dB at G<sub>min</sub> −12, so `gMin` was not the floor). The a priori SNR is decision-directed on G<sub>H1</sub> (eq. 18), the a priori speech absence is estimated from the spread of an a priori SNR over time and neighbouring bins (§4), the noise spectrum comes from IMCRA. As Cohen's own `omlsa.m`, a bin whose speech absence reaches 0.9 counts as noise: noise that happens to peak keeps G<sub>min</sub> and leaves no musical tone, so what remains of the noise is the noise, G<sub>min</sub> quieter. Time constants, the decision-directed α among them, are set for 8 ms frames and rescaled to the actual frame step (`omlsa.m` rescales by the reciprocal, which lengthens them at 48 kHz).

α sets how soon ξ follows a word's start after a pause, and how much gain a noise peak gets. Until 0.3 it was 0.98 per frame, whatever the frame (0.985 per 8 ms at 48 kHz, 0.972 at 44.1), and a word's second and third frames after a pause lost 10 and 5 dB. It is now the lowest value per 8 ms that leaves steady white and pink noise without musical noise: 0.97 tracking the noise (log kurtosis ratio 0.00 at G<sub>min</sub> −15 and −25 dB; 0.96 left 1.16 and 0.49 at −25, the paper's 0.92 0.99 and 1.81 at −15), 0.95 on a learned noise (`omlsa.m`'s; 0.92 left 0.19 and 0.42). The paper's cap q ≤ q<sub>max</sub> = 0.95 (Table 1) in place of the gate kept a word's second frame after a pause another 3 dB but left musical noise on steady noise (0.24 and 0.46 at α 0.97), so the gate stays. The table under [Speech](https://github.com/audiojs/denoise#speech) has what each keeps. `scripts/reference.py` holds a numpy version written from the papers; on 16 kHz VoiceBank frames it gives `omlsa.m`'s noise track, speech absence and gains to the last bit (but for near-empty bins, where `omlsa.m`'s absolute 1e-10 floors bind), and test.js holds this code to it.

The a priori SNR the speech absence is read from is smoothed in the cepstrum (Breithaupt, Gerkmann & Martin 2008): the speech power's maximum-likelihood estimate λ·max(γ−1, ξ<sub>ml,min</sub>), its cepstrum smoothed over time per quefrency, hardly where speech lives (the envelope's low quefrencies, the pitch's peak), much where a lone noise peak lives, and back. The decision-directed ξ (Cohen's, `qFrom: 'dd'`) lags a word's start after a pause, and takes a short burst of noise the tracker cannot follow for speech; the cepstral one follows a word's envelope at once and smooths a lone spectral peak away. Its constants are Table 1's, per 16 ms of frame step, but under 1.25 ms of quefrency Gerkmann & Hendriks's (ICASSP 2012: 0 and 0.2, where the 2008 paper's 0.5 and 0.7 lag an onset as the decision-directed ξ does) and above it 0.9: the least that leaves steady white and pink noise on a learned noise free of musical noise (0.85 left 0.22 on pink). On the training speech, tracked: PESQ 1.823 → 1.825, STOI 0.832 → 0.834, OVRL 2.525 → 2.543, BAK 3.00 → 3.04, musical noise 0.82 → 0.80; 40 ms tone bursts in steady noise pass at −6.5 dB (were −2.6). The cepstral ξ as the gain's own ξ as well lost voiced speech where the pitch glides (SIG −0.04), so the gain keeps the decision-directed one.

A held note, a sustained vowel or a chord is not learned as the noise. IMCRA, as minimum statistics, takes whatever holds a bin for about a second as noise: clean music through `omlsa` lost 9.9 % of its time-frequency energy by more than 3 dB, a sung long tone 8.8 %, a synthesized band 22.6 %. @audio/noise-estimate's `partials` reads, each frame, where a partial stands, a peak over the spectrum's morphological floor (the inverse harmonic mask of Nelke, Naylor & Vary, ICASSP 2015) held 0.3 s within ±1 bin and 10 dB over what its bin held while free, and there holds the noise at that memory; elsewhere, and on noise alone, the tracker's estimate is as it was, to the bit. A line steady from the take's start (hum, a fan, an engine) has no free frame and stays noise; one that starts mid-take is held up to 60 s, then learned, as is a note held longer; a note sounding from the first frame is learned until its bin is once free of it. Music cut 9.9 → 3.0 %, sung long tones 8.8 → 0.0 %, Slakh mixes 22.6 → 2.3 %; on the training speech PESQ 1.825 → 1.823, OVRL 2.543 → 2.542, musical noise 0.80 → 0.81 ([Speech](https://github.com/audiojs/denoise#speech) has the test set). `estimator: { partials: false }` turns it off.

A noise that holds still can be learned instead: `profile`, the noise's PSD (`noiseProfile` of a stretch where it plays alone), or, in the batch form, `noiseFrames`/`profileFrom`/`profileTo` naming that stretch. The noise is then held (`known` of @audio/noise-estimate), and p reads the observation: γ averaged over 105.5 Hz and over 543 Hz of the frame, at fixed priors (Gerkmann, Breithaupt & Martin 2008: the averaged γ is χ² with r degrees of freedom from the Hann window's correlation across bins, ξ<sub>fix</sub> the a priori SNR that minimizes false alarms plus misses, eq. 13; at 48 kHz r 5.7 and 24, ξ<sub>fix</sub> 9.4 and 5.1 dB), and 0 where the estimated q reaches 0.9, as before. Until 0.4 it read γ in each bin alone, at ξ<sub>H1</sub> = 15 dB (Gerkmann & Hendriks 2012), and speech 0–5 dB over the noise lost 7.8 dB on the training speech, where the MMSE Wiener gain keeps 3.9. The paper averages over 64 ms of frames as well; presence then outlasted a sound by those frames, and in the half second after music stopped the noise came through in tones (log kurtosis ratio 0.45 at G<sub>min</sub> −12 dB, 1.77 at −20): over the frame alone. On the training speech, G<sub>min</sub> −12 dB: PESQ 1.861 → 1.867, OVRL 2.564 → 2.572, BAK 3.05 → 3.08, musical noise 0.53 → 0.46, speech 0–5 dB over the noise −7.8 → −5.1 dB, the noise taken in pauses 9.7 → 10.1 dB. Steady noise under speech and music goes exactly G<sub>min</sub> down, with no musical noise from −12 to −20 dB (log kurtosis ratio 0.00); in the half second after music stops, 0.05 at −12 dB and 0.61 at −20 (0.3: 0.11 and 1.00; `scripts/broadband.mjs`). Tracking the noise from the print (Gerkmann & Hendriks 2012's MMSE tracker started on it, RX's "adaptive") lost OVRL 0.04 and left musical noise (0.40 on pink): the print is held. `processor(opts)` is the gain as an @audio/stft frame process, for a host running its own frames: audio's `denoise` op learns a print from a range and runs it so.

```js
omlsa(data, { fs })
omlsa(data, { fs, gMin: -10 })                                 // gentler: more room tone left
omlsa(data, { fs, profileFrom: 0, profileTo: fs / 2, gMin: -12 })   // the noise learned from the first half second
```

| Param | Default | |
|---|---|---|
| `gMin` | `-15` | dB: what noise-only bins keep, the floor (alias `gMinDb`) |
| `alpha` | `0.97`; `0.95` with a `profile` | Decision-directed smoothing per 8 ms of frame step, rescaled to the actual step (alias of `alphaDD`) |
| `xiMin` | `10^−2.5` | A priori SNR floor (−25 dB) |
| `qPrior` | estimated | A fixed a priori speech absence instead of the estimate |
| `qFrom` | `'cts'` | The a priori SNR the speech absence is read from: smoothed in the cepstrum, or `'dd'`, decision-directed (Cohen's `omlsa.m`) |
| `frameSize` | power of two nearest 32 ms | STFT frame: 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48 (`frame(fs)`) |
| `hopSize` | `frameSize/4` | |
| `profile` | tracked | A known noise PSD (`frameSize/2+1` bins), held |
| `estimator` | | IMCRA options (@audio/noise-estimate `imcra`); `{ partials: false }`: held notes learned as noise, as before 0.5 |
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to learn the profile from (batch) |

**Use when:** speech in non-stationary noise (street, café, car); generally the highest-quality choice for noisy speech. A steady noise with a stretch of it alone (hiss, hum, a fan, room tone): learn it, `profile`.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
