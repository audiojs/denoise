# @audio/denoise-deecho [![npm](https://img.shields.io/npm/v/@audio/denoise-deecho)](https://www.npmjs.com/package/@audio/denoise-deecho) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-echo: a delayed copy of the sound (a slap-back, a delay left on a take, one strong reflection) found by its cepstral peak, its delay to a fraction of a sample, its gain and its repeats, and undone by its inverse filter; no echo, no change

```
npm install @audio/denoise-deecho
```

```js
import deecho, { estimate } from '@audio/denoise-deecho'
```

A take with an echo is the sound and copies of it, y = x + Σ gᵢ·wᵢ, each wᵢ a delay line run on the sound, wᵢ[n] = x[n − Dᵢ] + fᵢ·wᵢ[n − Dᵢ]: one copy (f = 0: a slap-back, a reflection off a wall), or copies repeating, each f of the one before (a delay left on). The cepstrum was made for this (Bogert, Healy & Tukey 1963): the log of the power spectrum turns the echo's factor into a sum, and its inverse transform sets the echo at the quefrency D, apart from the sound's own spectrum. There, by the power series of log(1 + (g − f) z^−D) − log(1 − f z^−D) (the complex cepstrum of a minimum-phase echo, Oppenheim & Schafer 2010, ch. 13; its even part, the inverse transform of the log power, Childers, Skinner & Kemerait 1977), it reads g at D, (2f − g)·g/2 at 2D and ((g − f)³ + f³)/3 at 3D: the peak's height is the first copy's gain, the second rahmonic tells one copy (−g²/2) from repeats (+g²/2), the third checks both.

The cepstrum was chosen by measurement over the simple alternative, the autocorrelation's peak: on lena (12 s and 4 s of it) and ten MUSDB18 test previews with echoes at 3, 12, 30, 80, 150, 400 and 900 ms, one copy and repeats, the strongest lag from 1 ms to 1 s was the echo's for 28 of 28 speech cases at gains 0.15 and 0.5 and for 130 and 140 of 140 music cases, against 19, 21, 85 and 110 for the whitened autocorrelation (PHAT, Knapp & Carter 1976) and 0, 5, 0 and 89 for the plain one, whose peaks are the sound's own low frequencies and pitch. At 0.05 the cepstrum's raw height lost to the voice's own envelope near 1 to 3 ms (0 of 28; PHAT 18), so each lag is read against its own neighbourhood, below.

The estimate reads the take's middle 2²² samples at most (95 s at 44.1 kHz): its power spectrum over segments four times the longest delay searched, in the 1/6-octave bands the take's own sound fills: within 60 dB of the loudest, and either pausing (their quietest frames 20 dB under their mean, as a voice's pauses fall) or following (their quieter half of frames following the bands beside them, as music's do: a band of a noise is that noise alone in its quiet frames, stationary, following nothing). A noise added after the echo carries none of it and dilutes the peak where it fills the band: 0.5 at 80 ms on speech with white noise 40 dB under it reads 0.19 on the plain cepstrum over the whole band, 0.489 over the bands kept. Each lag is set against the median and spread (MAD) of its neighbourhood; a peak 8 spreads up and 0.06 (−24 dB) at least is tried, its delay the maximum of the band-limited cepstrum between whole lags, whole when within 0.1 of one (a digital delay's). It is fitted again on what its removal leaves, three times: a segment cuts the copies off at its ends (a 1 s echo in 6 s segments reads low), and the removal's residual, cut off nowhere, settles on the echo's own gain. It is kept only if what the removal leaves is nothing at 2D and 3D, nothing at D in each part of the take (up to four, each four delays long) and in each quarter of its band, a departure counted in spreads or in fiftieths of the gain, whichever is larger: an echo is in all of the take, while a beat, a loop or a held note comes and goes over it and over its band. When the top quarter alone reads it short, a noise fills more of the band there than its quiet frames showed, and the band loses that quarter (twice at most). Then the next copy, three at most, never at twice or three times the delay of a stronger peak (its rahmonics). The removal runs the echo's own lines on what comes out and takes them off it, x[n] = y[n] − Σ gᵢ·wᵢ[n], each wᵢ[n] read from before n: a whole delay sample for sample (as scipy.signal.lfilter undoes it, to the Float32 rounding), a fractional one through a 32-tap Kaiser-windowed sinc (Laakso et al. 1996; within −57 dB of the ideal delay to 0.85 of Nyquist), with no latency, so it streams once the echoes are known. Stable while |f| < 0.95 and |g − f| < 0.95: a copy as loud as the sound has no causal inverse.

```js
deecho(data, { fs: 44100 })                                         // found and undone; none found, the samples as they came
deecho(data, { fs: 44100, delay: 0.12 })                            // at 120 ms: its gain and repeats measured there
deecho(data, { fs: 44100, delay: 0.12, gain: 0.4, feedback: 0.3 })  // as given, nothing measured
estimate(data, { fs: 44100 })     // audio-lena through a 120 ms delay of gain 0.4, feedback 0.3: [{ delay: 0.12, gain: 0.404, feedback: 0.315 }]
let write = deecho({ fs: 44100, delay: 0.12, gain: 0.4 })            // a stream: write(chunk) → the chunk undone
```

| Param | Default | |
|---|---|---|
| `delay` | found | Seconds. Given alone, the gain and feedback are measured at it (any delay, 2.5 s as well) |
| `gain` | measured | The first copy's gain to the sound (negative: an inverted copy). With `delay`, nothing is measured |
| `feedback` | `0` with `gain` | Each further copy's gain to the one before: 0 one copy |
| `echoes` | | `[{ delay, gain, feedback }]`, as `estimate` returns them: several lines, nothing measured |
| `min`, `max` | `0.001`, `1` | The delays searched, s (and a quarter of the take at most) |
| `taps` | `3` | The most echoes found |

Measured (`node measure.js`, November 2026; `test.js` holds the bounds). Echoes added to audio-lena (12.3 s of speech, and 4 s of it) and to two MUSDB18 test previews (02, 30; 6.8 s, AAC-decoded, mono): one copy and repeats, gains 0.5, 0.2 and 0.08, a whole delay made sample for sample, a fractional one by the ideal band-limited delay. Each cell: found of 6; what is left of the echo, the error to the dry take, dB, worst to best; the delay's error, samples; the gain's:

| delay | lena 12 s | lena 4 s | MUSDB18 02 | MUSDB18 30 |
|---|---|---|---|---|
| 3 ms | 0/6 | 0/6 | 2/6, −36 to −44, 0.02, 0.014 | 1/6, −36, 0.01, 0.015 |
| 12.34 ms | 4/6, −31 to −34, 0.04, 0.023 | 4/6, −35 to −38, 0.19, 0.015 | 4/6, −33 to −41, 0.06, 0.017 | 6/6, −33 to −43, 0.00, 0.011 |
| 30 ms | 6/6, −44 to −58, 0, 0.001 | 4/6, −64 to −67, 0, 0.001 | 6/6, −43 to −58, 0, 0.002 | 6/6, −44 to −75, 0, 0.002 |
| 80 ms | 6/6, −58 to −70, 0, 0.001 | 6/6, −53 to −59, 0, 0.002 | 6/6, −42 to −45, 0, 0.006 | 6/6, −47 to −49, 0, 0.004 |
| 100 ms | 6/6, −66 to −68, 0, 0.000 | 6/6, −47 to −49, 0, 0.004 | 6/6, −45 to −47, 0, 0.005 | 6/6, −60 to −63, 0, 0.001 |
| 150 ms | 6/6, −45 to −47, 0, 0.005 | 6/6, −39 to −41, 0.14, 0.010 | 6/6, −53 to −54, 0, 0.002 | 6/6, −52 to −57, 0, 0.002 |
| 150.37 ms | 6/6, −53 to −54, 0.13, 0.000 | 6/6, −49 to −51, 0.17, 0.000 | 6/6, −48 to −52, 0.05, 0.004 | 6/6, −57 to −65, 0, 0.001 |
| 400 ms | 6/6, −50 to −51, 0, 0.003 | 6/6, −45 to −62, 0, 0.001 | 6/6, −51 to −62, 0, 0.003 | 6/6, −42 to −49, 0, 0.005 |
| 1 s | 6/6, −43 to −57, 0, 0.002 | 6/6, −44 to −58, 0.11, 0.002 | 6/6, −28 to −66, 0, 0.037 | 6/6, −33 to −59, 0, 0.009 |

On lena at gain 0.5, a copy's strength (the normalised autocorrelation at its lag) 0.398, 0.380, 0.394, 0.400 at 30, 80, 100 and 150 ms comes out −0.007, −0.025, −0.017, −0.001, the dry voice's −0.008, −0.024, −0.017, 0.004; the echo left −56, −58, −67, −45 dB; repeating at 80 ms, −68 dB. `comb` (the Filter group's) undoes such an echo exactly when it is given the delay and gain, up to its 100 ms; given an 80 ms repeating echo's delay 2 ms off it leaves −1.7 dB of it, a gain of 0.4 for 0.5 −18.9 dB, and this removal given the same leaves the same (`test.js`): what undoing an echo needs is the delay to the sample, which the estimate gives. With white noise added after the echo (80 ms, 0.5), 40, 30 and 20 dB under the voice: found (gain 0.489, 0.498, 0.464), the dry take and its noise within −37, −35 and −24 dB, near what the noise allows (the inverse colours the noise the echo never carried, 4.8 dB under it). Echoes found where there are none: 0 of the 50 MUSDB18 test previews, of the 94 train previews (none looked at while the constants were set) and of 20 GuitarSet takes (12 s each); none in white noise, a 440 Hz tone, a sawtooth, a pulse every 10 ms, silence or the dry voice. Against scipy (`reference.py`): its `lfilter` echoes undone as its inverse undoes them, within 2.1·10⁻⁷ of the RMS (the output is Float32); a fractional delay within −49 dB of the ideal inverse. One channel at 44.1 kHz: the estimate 0.5 s for 4 s, 1.1 s for 12 s, 2.8 s for a minute, 3.4 s for ten (it reads 95 s at most); the removal 1.2 s for ten minutes at a whole delay, 3.2 s at a fractional one.

The constants (8 spreads, 0.06, the bands' 20 dB and 0.3, the departures' 4, 6 and 8 and their fiftieth of the gain) were set on the MUSDB18 test previews, lena and the two previews above with echoes added; they are this package's own, chosen so that no take without an echo is changed.

**Use when:** a voice or an instrument with one echo or a few at fixed delays: a slap-back off a hard wall, a delay left on a track, a second microphone summed in late, a network echo of a fixed lag; one channel or each channel on its own (a stereo take whose channels echo apart is undone channel by channel).<br>
**Not for:** a room's reverberation, thousands of reflections filtered and dense: `dereverb`. Short delays: under about 20 ms the voice's own pitch and formants lie at the same quefrencies; at 12 ms an echo of 0.2 or more is found and taken 31 to 43 dB down, at 3 ms one on speech is not found (it is a comb filter's colour more than an echo). An echo under −24 dB (gain 0.06) is left. An echo at the delay of the music's own beat or bar, or a loop that repeats sample for sample through the whole take, reads with the repetition added (a 1 s echo of 0.5 on MUSDB18 02: gain 0.465, −28 dB left); where the parts and bands disagree it is left, and a periodic piece that holds through the whole take and its whole band is, to this model, an echo (none of the 144 MUSDB18 previews was). A reflection whose highs a wall took is a filter, not a copy, and its bands disagree: the copy through a one-pole lowpass at 8 or 4 kHz, 0.5 at 30 ms, is undone in part (−23 and −21 dB left), at 120 ms or through a 2 kHz lowpass it is left (`node measure.js filtered`). A delay that moves over the take (a talker walking, a modulated delay), a copy as loud as the sound or louder, and a delay effect on one track of a mix (the mix's other tracks carry no echo) are not undone. The estimate needs the whole take; once known, the echoes stream.

References: Bogert, Healy & Tukey, *The Quefrency Alanysis of Time Series for Echoes: Cepstrum, Pseudo-Autocovariance, Cross-Cepstrum and Saphe Cracking*, in Rosenblatt (ed.), Proceedings of the Symposium on Time Series Analysis, Wiley 1963. Childers, Skinner & Kemerait, *The Cepstrum: A Guide to Processing*, Proceedings of the IEEE 65(10), 1977. Oppenheim & Schafer, *Discrete-Time Signal Processing*, 3rd ed., Pearson 2010, ch. 13, Cepstrum Analysis and Homomorphic Deconvolution. Knapp & Carter, *The Generalized Correlation Method for Estimation of Time Delay*, IEEE TASSP 24(4), 1976. Laakso, Välimäki, Karjalainen & Laine, *Splitting the Unit Delay: Tools for Fractional Delay Filter Design*, IEEE Signal Processing Magazine 13(1), 1996. Kaiser, *Nonrecursive Digital Filter Design Using the I0-sinh Window Function*, IEEE ISCAS 1974. Rousseeuw & Croux, *Alternatives to the Median Absolute Deviation*, JASA 88(424), 1993. Rafii, Liutkus, Stöter, Mimilakis & Bittner, *The MUSDB18 Corpus for Music Separation*, 2017. Xi, Bittner, Pauwels, Ye & Bello, *GuitarSet: A Dataset for Guitar Transcription*, ISMIR 2018.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise): the denoise family umbrella.

MIT © [audiojs](https://github.com/audiojs)
