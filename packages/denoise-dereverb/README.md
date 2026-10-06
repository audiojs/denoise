# @audio/denoise-dereverb [![npm](https://img.shields.io/npm/v/@audio/denoise-dereverb)](https://www.npmjs.com/package/@audio/denoise-dereverb) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-reverb: late reverberation off a voice, one channel: weighted prediction error (WPE, Nakatani et al. 2010) fitted over the take, then the late power the past carries, scaled by the take's own decays, taken by a gain; a dry take or music passes untouched

```
npm install @audio/denoise-dereverb
```

```js
import dereverb from '@audio/denoise-dereverb'
```

Late reverberation off a voice, one microphone, the whole take at once. First weighted prediction error, WPE (Nakatani et al. 2010): in each STFT bin, what the frames from 43 to 150 ms back predict of the current one (at 48 kHz: from the first frame that shares no sample with it) is the room's tail, and is subtracted; the prediction is fitted over the whole take, each frame weighted by its inverse power, three times. The room is one for the take and the voice is not, so the fit learns the room. One microphone cannot invert a room, and the prediction cancels a dB or two of the tail. The rest is taken in power, as Lebart et al. (2001) and Habets (2010) model the late reverberation: from the power of the frames before, here weighed by the shape of WPE's taps, the room's decay in that bin. Its scale is read off the take itself: where only the tail sounds, the power over its expectation is exponential, and a tenth of such cells fall under 0.105 of it, while the voice's cells lie above; so the 10th percentile of the power over the weighed past, per octave band, divided by 0.105, is the late reverberation's share. It reads a 3 s clip and a minute-long take alike (0.3 scaled the taps' own power, which on 3 s predicted about all the late power and on 30 s a quarter). A log-spectral-amplitude gain (Ephraim & Malah 1985) takes that power off what WPE left, floored at −14 dB, and no bin leaves louder than it came. Two checks on the whole take come first, and either returns it bit for bit: dry, when its fastest falls are faster than a room's tail lets a sound fall (90 % of dry VoiceBank takes); no pauses, when under half of its frames are under half its mean power (Scheirer & Slaney 1997): there a held note's sustain reads as a room's. A bin cut to digital silence (an edit, a gate) is left out of the fit. About 0.1 s per second of 48 kHz sound (a 41 s take: 4.7 s, 0.3 4.0 s).

```js
dereverb(data, { fs: 48000 })
dereverb(data, { fs: 48000, strength: 0.5 })   // a lighter hand
```

| Param | Default | |
|---|---|---|
| `strength` | `1` | Scale of the late-reverberation estimate (1: as the take's own decays read it): 0 is the linear prediction alone, 2 takes more of the tail and more of the voice |

Measured (`python scripts/dereverb.py`, test set): 42 VoiceBank test utterances (1.6–5.9 s), and four 41–60 s takes of ten utterances by one speaker, in 19 MIT IR Survey rooms the tuning never heard (T60 0.38–1.85 s). Each room's response is split at direct + 50 ms: under it, the voice as the room colours it; over it, the tail to take. Voice lost: the output's power where the voice is 10 dB over the tail; tail taken: where the tail is 10 dB over the voice. PESQ and STOI against the dry take; SRMR (Falk et al. 2010) higher is drier; DNSMOS at the input's loudness; the dry takes through it: the share returned untouched, PESQ. 0.3 → 0.4, and DeepFilterNet3 (`@audio/neural-denoise`, a denoiser that also learned to take reverberation) on the same takes:

| | voice lost dB | tail taken dB | PESQ | STOI | SRMR | OVRL | dry: untouched, PESQ |
|---|---|---|---|---|---|---|---|
| short takes in | | | 1.39 | 0.774 | 3.98 | 2.19 | 4.64 |
| short, `dereverb` | −0.81 → −0.79 | −6.2 → −6.3 | 1.50 → **1.53** | 0.768 → **0.783** | 6.90 → 6.84 | 2.47 → 2.48 | 0 → **95 %**, 4.25 → **4.63** |
| short, DeepFilterNet3 | −2.71 | −3.7 | 1.52 | 0.787 | 5.48 | 2.46 | 4.54 |
| long takes in | | | 1.37 | 0.739 | 3.43 | 1.98 | 4.64 |
| long, `dereverb` | −0.25 → −0.61 | −3.3 → **−6.6** | 1.49 → **1.54** | 0.749 → 0.753 | 4.99 → **6.13** | 2.43 → **2.52** | 0 → **100 %**, 4.58 → **4.64** |
| long, DeepFilterNet3 | −2.42 | −0.8 | 1.51 | 0.757 | 4.10 | 2.22 | 4.52 |

`strength` 0, 1, 2, 4: on the short takes the tail −1.5, −6.3, −8.3, −10.3 dB for the voice −0.20, −0.79, −1.17, −1.67; on the long ones the tail −1.1, −6.6, −8.8, −10.6 for the voice −0.07, −0.61, −0.95, −1.39. The voice lost is mostly under 250 Hz (−1.5 to −2.3 dB there, −0.4 to −0.6 over 1 kHz), where a voice's low harmonics hold their pitch as a room's tail does.

Through it as it is (0.3 → 0.4; untouched: the share returned bit for bit; level change per octave, the worst of 63 Hz–8 kHz):

| | untouched | level change |
|---|---|---|
| VocalSet spoken, 20 | 0 → 85 % | −0.64 → −0.21 dB |
| VocalSet sung straight tones, 20 | 0 → 70 % | −1.38 → −0.92 dB |
| MUSDB18 previews, 25 | 0 → 76 % | −3.73 → −0.24 dB |
| GuitarSet, 20 | 0 → 75 % | −2.37 → −0.77 dB |
| Brahms, the Nutcracker, a trumpet | 0 → 100 % | −5.53 → 0 dB |
| Vibe Ace | 0 → 0 % | −4.26 → −3.68 dB |

On reverberant VoiceBank in 130 rooms (`vbreverb`, below) PESQ 2.55 → 2.62, STOI 0.897 → 0.908 (the input 0.904), dry takes 4.24 → 4.63, 94 % of them untouched. The constants were chosen on `scripts/dereverb.py train` (training speakers in the even-numbered rooms: tail −7.4 and −7.9 dB, PESQ 1.48 → 1.72 and 1.51 → 1.81), the music checks on the even-numbered MUSDB18 previews and other GuitarSet takes.

0.2 fitted the prediction recursively, over its last second, and learned some of the voice as room. 0.3 scaled the taps' power by a constant, so its estimate grew as the take shortened: on 3 s it took 2–3 dB more than on a minute, and a dry voice came out at PESQ 4.25. Late-reverb subtraction at each room's measured T60 (Lebart; Habets's κ, the T60 an oracle's) scored under the taps' shape scaled by the percentile (short training takes: PESQ 1.64 against 1.71), and an exponential decay at the measured T60 in place of the taps' shape scored the same. Refitting WPE on the gain's output (its weights from the voice estimate, as DNN-WPE takes them) changed nothing. Sparing a spectral peak that holds over 43 ms (a held partial) cost 1.5–2 dB of the tail. No feature tried told speech in the longest rooms from music: the share of low-energy frames, over a second or over the take, and how long the spectrum's fine structure holds (0.3 at 110 ms in a room, 0.34–0.53 for the music pieces) overlap. DeepFilterNet3 takes the first 50 ms with the tail (−2.4 to −2.7 dB of the voice) and here less of the tail; iZotope RX was not available to measure.

**Use when:** a voice in a room, one microphone, one room per take.<br>
**Not for:** music with pauses in it is taken for a voice in a room (Vibe Ace −3.7 dB under 500 Hz). Noise: denoise first.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
