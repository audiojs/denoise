# @audio/vad

> Voice activity detection — frame-level speech/non-speech decision, plus the speech-presence primitives that drive spectral denoise.

Classical, deterministic, no model weights. `vad()` gives a per-frame speech track; `spp()` and `ddSnr()` are the per-bin estimators that OM-LSA / Wiener / IMCRA gain rules consume.

```js
import { vad, spp, ddSnr } from '@audio/vad'

let { active, voiced, times, hop, frameSize } = vad(signal, { fs: 48000 })
// active: Uint8Array — 1 where speech is
// voiced: Uint8Array — 1 where the frame is voiced
// times:  Float32Array — frame-start time (s) for each flag
```

## `vad(data, opts?)`

A frame is **speech** when it holds voicing, or sound over the noise floor next to voicing. Five steps, on frames of three periods of the 75 Hz pitch floor (2048 samples at 44.1 and 48 kHz, 1024 at 16 kHz), a quarter frame apart:

1. **Noise floor** per bin: minimum statistics (Martin 2001, [`@audio/noise-estimate`](https://github.com/audiojs/denoise/tree/main/packages/noise-estimate)'s `minStats`) over the 1.5 s before the frame and the 1.5 s after it, the larger of the two. A level that steps up or down (a fan switched on, the room after a cut) reads low on one side only; within 1.5 s of either end of the input the one whole side counts, so a recording that starts or ends on speech is not misread. A frame so periodic it is a tone (normalized autocorrelation 0.8 or more) stays out of the floor, as AMR's VAD keeps tones out of its background estimate (3GPP TS 26.094): a note or a vowel held past the window is not the room.
2. **Sound present**: Sohn's likelihood ratio (Sohn, Kim & Sung 1999), the mean over 60 Hz–8 kHz of γξ/(1+ξ) − ln(1+ξ), γ = |Y|²/λ, ξ decision-directed (Ephraim & Malah 1984), over 0.1: fewer than 0.1 % of frames of stationary noise pass.
3. **Voiced**: present, and periodic twice over below 4 kHz: the normalized autocorrelation r(τ)/r<sub>w</sub>(τ) (Boersma 1993), peaked over 75–600 Hz, of the frame whitened by its floor (γ<sub>k</sub>) at 0.4 or more, and of the frame whitened by its own envelope (its power averaged over ±300 Hz) at 0.25 or more. Whitened, a noise's colour, a hum or an engine in the floor carries no period; unwhitened it does. Over the six VoiceBank+DEMAND training noises that are no crowd (car, kitchen, metro, station, traffic, speech-shaped) the autocorrelation peaks at a median 0.40 on the raw frame and 0.80 on the Wiener estimate ξ/(1+ξ)·|Y| (2.0.0's: a few random bins left, a sparse spectrum), 0.22 whitened by the floor and 0.23 by the envelope. The envelope keeps it where the floor read low (a level step at an edge of the input leaves the noise's tilt in γ), and it is narrower than formants lie apart, so a vowel's or a breath's resonances are no period either. The thresholds were chosen on the training sets; Praat's 0.45 on the floor-whitened frame lost more of the noisy speech.
4. **Level**: nothing 30 dB under the voiced frames' mean power is speech: the weakest phoneme lies some 28 dB under the strongest (Fletcher 1953); quieter is a breath, a click, the room.
5. **Speech**: vowels (30 ms of voicing within ±50 ms), grown outward through present sound up to 0.3 s, across gaps up to 0.15 s (a stop's closure). A breath, a cough, a door between phrases holds no voicing and is not speech; one that runs into a word is.

| opt | default | meaning |
|---|---|---|
| `fs` | `44100` | sample rate (Hz) |
| `frameSize` | 3 periods of 75 Hz, power of two | STFT frame: shorter loses voicing of low voices |
| `hopSize` | `frameSize/4` | hop between frames |

Returns `{ active: Uint8Array, voiced: Uint8Array, times: Float32Array, hop, frameSize }`. It reads the whole input: the floor looks 0.75 s ahead, the level is the input's.

Measured through [`desilence`](https://github.com/audiojs/denoise/tree/main/packages/denoise-desilence) and [`debreath`](https://github.com/audiojs/denoise/tree/main/packages/denoise-debreath) (their READMEs; `scripts/vad.py` in [@audio/denoise](https://github.com/audiojs/denoise)): on VoiceBank+DEMAND's noisy test set the voiced frames they take fall from 3.89 % (desilence) and 5.87 % (debreath) under 1.x to 0.02 % and 0.06 %, the consonants and word edges from 3.93 % and 24.55 % to 0.08 % and 0.30 %. The 1.x floor was the 10th-percentile frame energy of the whole input plus 5 dB, and a frame spoke only 6 dB over it with a spectral flatness under 0.4: in noise, the 10th percentile is the noise, and every word under 11 dB local SNR was silence.

Noise alone, frames called speech (2.0.0 → 2.0.1): white, pink and brown noise at 0.002–0.2, steady 0 → 0 %, stepping down tenfold 4–7 → 0 %; the VoiceBank+DEMAND training noises car 40 → 2 %, kitchen 43 → 0 %, metro 35 → 5 %, station 27 → 3 %, traffic 25 → 0 %, speech-shaped 0 → 0 %. Those with talkers in them stay speech, as they are: babble 100 %, cafeteria 90 %, restaurant 81 %, meeting 72 % (the test set's bus 92 %, public square 72 %, cafe 85 %, living room 50 %). 2.0.0 read voicing off the Wiener estimate, which peaks on any noise, and its floor, centred on the frame, read low beside a level step: noise after speech was speech whole.

**Not for:** whispered speech (it holds no voicing: it reads as silence); speech under music. Dense music reads partly as pause: 9 % of the loud frames of Brahms' Hungarian Dance No. 5 for strings (2.0.0: 0.02 %), where the floor rises with the orchestra and the whitened frames lose their period.

**Not for:** whispered speech (it holds no voicing: it reads as silence); speech under music.

## `spp(mag, noisePsd, opts?)`

Per-bin **speech-presence probability** from a-priori SNR ξ: `p = ξ / (1 + ξ)` (Gaussian model, q-prior 0.5). Bind to a noise PSD (e.g. `minStats`/`imcra` from `@audio/denoise`). `opts.xiMin` floors ξ (default `0.0316`, −15 dB).

## `ddSnr(mag, noisePsd, prevGain, prevMag, alpha?)`

Decision-directed a-priori SNR (Ephraim & Malah 1984), recursively smoothed with `alpha` (default `0.98`). The ξ̂ estimate feeding Wiener / MMSE / OM-LSA gains.

## References

J. Sohn, N. S. Kim, W. Sung, "A statistical model-based voice activity detection", IEEE Signal Processing Letters 6(1), 1999 · R. Martin, "Noise power spectral density estimation based on optimal smoothing and minimum statistics", IEEE Trans. Speech Audio Process. 9(5), 2001 · Y. Ephraim, D. Malah, "Speech enhancement using a minimum mean-square error short-time spectral amplitude estimator", IEEE Trans. ASSP 32(6), 1984 · P. Boersma, "Accurate short-term analysis of the fundamental frequency and the harmonics-to-noise ratio of a sampled sound", Proc. Institute of Phonetic Sciences 17, Amsterdam, 1993 · H. Fletcher, *Speech and Hearing in Communication*, 1953 · 3GPP TS 26.094, *AMR speech codec; voice activity detector*.

## Notes

Hann window from [`@audio/stft`](https://github.com/audiojs/stft), FFT from [`fourier-transform`](https://github.com/scijs/fourier-transform), noise floor from [`@audio/noise-estimate`](https://github.com/audiojs/denoise/tree/main/packages/noise-estimate). Also re-exported from [`@audio/denoise`](https://github.com/audiojs/denoise) for restoration pipelines. MIT.
