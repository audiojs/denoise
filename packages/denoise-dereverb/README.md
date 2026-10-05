# @audio/denoise-dereverb [![npm](https://img.shields.io/npm/v/@audio/denoise-dereverb)](https://www.npmjs.com/package/@audio/denoise-dereverb) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-reverb: late reverberation off a voice, one channel: weighted prediction error (WPE, Nakatani et al. 2010) fitted over the take, then the late power its taps predict taken by a gain

```
npm install @audio/denoise-dereverb
```

```js
import dereverb from '@audio/denoise-dereverb'
```

Late reverberation off a voice, one microphone, the whole take at once. First weighted prediction error, WPE (Nakatani et al. 2010): in each STFT bin, what the frames 50 to 160 ms back predict of the current one is the room's tail, and is subtracted; the prediction is fitted over the whole take, each frame weighted by its inverse power, three times. The room is one for the take and the voice is not, so the fit learns the room. One microphone cannot invert a room, and the prediction cancels a dB or two of the tail; but its taps measure the room. The power they carry from the past into a frame is the late reverberation's power, which Lebart et al. (2001) and Habets (2010) model from a decay time and a direct-to-reverberant ratio: here neither is estimated, and on a dry voice the taps are near zero. A log-spectral-amplitude gain (Ephraim & Malah 1985) takes that power off what WPE left, floored at −14 dB, and no bin leaves louder than it came. Below 500 Hz the estimate falls 3 dB an octave: there a voice's harmonics hold their phase longest and the taps learn some of them as room. A bin cut to digital silence (an edit, a gate) is left out of the fit. About 0.1 s per second of 48 kHz sound.

```js
dereverb(data, { fs: 48000 })
dereverb(data, { fs: 48000, strength: 0.5 })   // a lighter hand
```

| Param | Default | |
|---|---|---|
| `strength` | `1` | Scale of the late-reverberation estimate: 0 is the linear prediction alone, 2 takes more of the tail and more of the voice |

Measured (`python scripts/dereverb.py`, test set): 42 VoiceBank test utterances (1.6–5.9 s), and four 41–60 s takes of ten utterances by one speaker, in 19 MIT IR Survey rooms the tuning never heard (T60 0.38–1.85 s). Each room's response is split at direct + 50 ms: under it, the voice as the room colours it; over it, the tail to take. Voice lost: the output's power where the voice is 10 dB over the tail; tail taken: where the tail is 10 dB over the voice. PESQ and STOI against the dry take; SRMR (Falk et al. 2010) higher is drier; DNSMOS at the input's loudness; a dry voice through it, PESQ. 0.2 → 0.3:

| | voice lost dB | tail taken dB | PESQ | STOI | SRMR | OVRL | dry voice, PESQ |
|---|---|---|---|---|---|---|---|
| short takes in | | | 1.39 | 0.774 | 3.98 | 2.19 | 4.64 |
| short, `dereverb` | −0.32 → −0.81 | −1.7 → **−6.2** | 1.45 → **1.50** | 0.793 → 0.768 | 4.56 → **6.90** | 2.28 → **2.47** | 4.42 → 4.25 |
| long takes in | | | 1.37 | 0.739 | 3.43 | 1.98 | 4.64 |
| long, `dereverb` | −0.13 → −0.25 | −1.1 → **−3.3** | 1.43 → **1.49** | 0.756 → 0.749 | 3.83 → **4.99** | 2.03 → **2.43** | 4.58 → 4.58 |

`strength` 0, 1, 2, 4: on the short takes the tail −1.4, −6.2, −7.7, −9.0 dB for the voice −0.12, −0.81, −1.18, −1.64, a dry voice's PESQ 4.51, 4.25, 4.17, 4.10; on the long ones the tail −0.9, −3.3, −4.5, −6.0 for the voice −0.02, −0.25, −0.41, −0.65. A sung voice passes (VocalSet: SI-SDR 19.4 → 35.3 dB, 125–250 Hz −2.55 → −0.45 dB). STOI falls 0.025 on the short takes, the gain's cost; PESQ, SRMR and DNSMOS rise.

0.2 fitted the prediction recursively, over its last second: it learned some of the voice as room (−0.32 dB of the voice for 1.7 dB of the tail), and alone it cannot take much more (at 30 taps, about 4 dB of the tail for 0.6 dB of the voice). Late-reverb subtraction at each room's measured T60 (Lebart; Habets's κ) took 6 dB for −0.4 dB of the voice on the training takes, but it needs the T60, which free-decay estimates did not give on 3 s takes (correlation −0.3 to 0.2 with the measured one), and it took a dry voice for a room (PESQ 3.7). DeepFilterNet3 (`@audio/neural-denoise`), a denoiser that also learned to take reverberation, took 6.6–8.1 dB of the tail on the training takes and 2.1–2.9 dB of the first 50 ms, early reflections with the tail: PESQ 1.71–1.74 against 1.70 here, STOI 0.84 against 0.82.

**Use when:** a voice in a room, one microphone, one room per take.<br>
**Not for:** music or anything holding a pitch: a held note is predictable, and taken for room (music loses 2–5.5 dB under 1 kHz; 0.2 lost 1–4.3). Noise: denoise first.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
