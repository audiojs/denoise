# @audio/denoise-repair [![npm](https://img.shields.io/npm/v/@audio/denoise-repair)](https://www.npmjs.com/package/@audio/denoise-repair) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Rebuild damaged audio from its surroundings: a dropout, a lost second of music, a cough or a phone ring over the program

```
npm install @audio/denoise-repair
```

```js
import repair, { plan } from '@audio/denoise-repair'
```

Each region is rebuilt by one of four tiers, chosen per region by length and content (`method: 'auto'`):

- **`ar`**: gap-wise Janssen interpolation. An AR(N/2) model is fitted to 2N of context on both sides with the gap zeroed, the gap is filled by the exact least-squares solve ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arBridge`), and the fit and fill run once more on the filled segment (Janssen, Veldhuis & Vries 1986; the gap-wise variant of Mokrý & Rajmic 2025). It recovers the waveform itself, and wins on short gaps.
- **`sinusoidal`**: partials tracked on both sides ([`sinusoidal-track`](https://github.com/audiojs/sinusoidal/tree/main/packages/sinusoidal-track)) are measured at the frames touching the gap: frequency from the phase advance, amplitude and phase by joint least squares (Stylianou 2001). They are matched across the gap by nearest frequency and bridged with cubic phase, which keeps both ends phase-locked (McAulay & Quatieri 1986). Under them goes the context's residual floor, log-interpolated from the left side to the right and shaped from white noise (Serra & Smith 1990).
- **`similarity`**: the passage whose half-second contexts best match the gap's, found within `window` seconds on dB spectra (Perraudin et al. 2018). The match is aligned to the sample by correlation and transplanted with crossfades. It wins on music that repeats, at any length.
- **`spectral`**: the original method. Log-magnitude interpolation between the clean frames on both sides, with phase advanced from the leading context.

`'auto'` looks for a passage first. If, once aligned, it correlates with the gap's surroundings by 0.4 or more, it is transplanted; up to 50 ms the bar is 0.995, a match to 20 dB SNR, since only a near-exact repeat beats AR there. Otherwise AR takes gaps up to 70 ms and the sinusoidal bridge the longer ones. Band-limited regions route the same way and take only their band from the fill, frame by frame. Samples the repair does not reach come back bit-exact.

```js
repair(data, { fs: 44100, regions: [{ at: 1.2, duration: 0.02 }] })                       // a dropout
repair(data, { fs: 44100, regions: [{ at: 42, duration: 1 }] })                           // a lost second of music: the passage that fits
repair(data, { fs: 44100, regions: [{ at: 7.1, duration: 0.3, from: 300, to: 3000 }] })   // a cough: that band only
repair(data, { fs: 44100, regions: [{ at: 7.1, duration: 0.3 }], method: 'sinusoidal' }) // one tier, forced

let regions = plan(mix, opts)                                // stereo: decide once, on the mix,
let [l, r] = [left, right].map(ch => repair(ch, { ...opts, regions }))   // so a transplant copies one passage into both
```

| Param | Default | |
|---|---|---|
| `regions` | required | `[{ at, duration, from?, to?, method?, source? }]`: seconds, Hz; `source` is where a `'similarity'` passage starts (searched when omitted) |
| `method` | `'auto'` | `'ar'` \| `'sinusoidal'` \| `'similarity'` \| `'spectral'`; a region's own `method` wins |
| `window` | `10` | s on each side of a region that the similarity search may read |
| `fs` | `44100` | sample rate, Hz |
| `frameSize` | `2048` | STFT frame N; the AR order is N/2 and its context 2N |
| `hopSize` | `frameSize / 4` | STFT hop |

`plan(data, opts)` returns the regions with `method` resolved and, for `'similarity'`, `source` set. Pass them back as `regions` and the repair skips the search. A forced `'similarity'` with no passage in the window falls back to the bridge.

## Measured

`node scripts/repair.js` in [@audio/denoise](https://github.com/audiojs/denoise) cuts gaps into speech (audio-lena), recordings (Kevin MacLeod, "Vibe Ace" and "Dance of the Sugar Plum Fairy", CC BY 3.0; Brahms, Hungarian Dance No. 5, US Army Strings, public domain; Mihai Sorohan, trumpet loop, CC BY 3.0; all from [librosa/data](https://github.com/librosa/data)) and synthetic signals. It measures SNR over the lost samples, the audio-inpainting convention (Adler et al. 2012), and log-spectral distance (LSD) over the STFT frames that overlap them (`@audio/quality`, 1024/256). The cells give mean SNR / LSD in dB; higher SNR and lower LSD are better.

**Speech** (audio-lena, 8 gaps per length):

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 10.7 / 2.68 | 1.4 / 5.01 | 1.3 / 4.08 | 0.1 / 4.65 | 10.7 / 2.68 | ar 8 |
| 20 ms | 3.2 / 3.67 | -2.3 / 5.16 | 0.4 / 4.29 | -1.6 / 4.88 | 3.2 / 3.67 | ar 8 |
| 50 ms | -0.0 / 5.41 | -2.2 / 5.49 | -1.1 / 4.42 | -0.5 / 5.51 | -0.0 / 5.41 | ar 8 |
| 70 ms | -0.2 / 6.17 | -1.9 / 5.59 | -1.8 / 4.96 | -0.4 / 5.65 | -1.8 / 4.96 | similarity 8 |
| 100 ms | -0.4 / 7.26 | -2.8 / 5.73 | -1.2 / 5.01 | -0.5 / 5.82 | -1.2 / 5.01 | similarity 8 |
| 300 ms | 0.1 / 9.84 | -2.1 / 5.65 | -4.2 / 5.28 | -0.8 / 5.77 | -3.2 / 5.15 | similarity 5, sinusoidal 3 |
| 1000 ms | 0.0 / 12.76 | -1.3 / 7.06 | -2.6 / 6.85 | -0.4 / 7.20 | -1.7 / 6.64 | similarity 2, sinusoidal 6 |

**Music** ("Vibe Ace", "Dance of the Sugar Plum Fairy", Hungarian Dance No. 5; 4 gaps each per length):

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 15.5 / 2.18 | 3.8 / 4.86 | 4.6 / 4.67 | 5.3 / 5.06 | 16.5 / 2.11 | ar 11, similarity 1 |
| 20 ms | 10.2 / 3.51 | 1.7 / 5.08 | 3.9 / 4.92 | 3.7 / 5.45 | 11.3 / 3.26 | ar 11, similarity 1 |
| 50 ms | 6.7 / 5.43 | 0.8 / 5.48 | 2.5 / 5.45 | 2.3 / 5.78 | 7.6 / 4.98 | ar 11, similarity 1 |
| 70 ms | 5.4 / 6.04 | -0.6 / 5.96 | 2.7 / 5.06 | 1.5 / 6.06 | 6.1 / 4.96 | similarity 7, ar 5 |
| 100 ms | 3.5 / 7.06 | -2.1 / 6.05 | 2.3 / 4.94 | 0.6 / 6.19 | 2.7 / 4.74 | similarity 7, sinusoidal 5 |
| 300 ms | 1.3 / 9.72 | -1.5 / 5.69 | 2.9 / 5.78 | -0.8 / 6.15 | 3.2 / 5.06 | similarity 7, sinusoidal 5 |
| 1000 ms | 0.3 / 11.42 | -1.8 / 6.14 | 3.4 / 6.15 | -0.7 / 6.49 | 3.7 / 5.13 | similarity 5, sinusoidal 7 |

**Solo trumpet** (a 5 s loop, 4 gaps per length):

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 17.3 / 2.02 | 5.9 / 4.03 | 1.7 / 4.98 | 0.7 / 4.32 | 17.3 / 2.02 | ar 4 |
| 20 ms | 11.3 / 3.01 | -0.2 / 4.28 | -2.6 / 6.63 | -0.3 / 4.91 | 11.3 / 3.01 | ar 4 |
| 50 ms | 3.3 / 3.96 | -2.5 / 5.07 | -5.3 / 11.30 | -2.6 / 5.82 | 3.3 / 3.96 | ar 4 |
| 70 ms | 0.9 / 4.68 | -4.8 / 5.69 | -5.9 / 11.21 | -3.1 / 6.15 | 0.9 / 4.68 | ar 4 |
| 100 ms | -0.0 / 5.64 | -2.2 / 5.58 | -2.7 / 11.25 | -0.8 / 6.08 | -2.2 / 5.58 | sinusoidal 4 |
| 300 ms | -0.0 / 9.18 | -1.7 / 6.64 | -4.2 / 9.93 | -0.4 / 6.71 | -1.7 / 6.64 | sinusoidal 4 |
| 1000 ms | -0.0 / 12.71 | -1.7 / 7.61 | -2.2 / 8.21 | -0.4 / 7.76 | -1.7 / 7.61 | sinusoidal 4 |

<details><summary>Synthetic signals, and band-limited damage over the program</summary>

A 440 Hz sine; a C-major triad, 6 harmonics per note; a vibrato tone, ±50 cents at 5.5 Hz; a 120 BPM song whose 8 s phrase plays twice, with hi-hats of fresh noise. SNR is capped at 60 dB.

**Sine**:

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 60.0 / 0.00 | 60.0 / 0.00 | 45.0 / 0.00 | 60.0 / 0.00 | 45.0 / 0.00 | similarity 3 |
| 20 ms | 59.9 / 0.00 | 60.0 / 0.00 | 45.0 / 0.00 | 60.0 / 0.00 | 45.0 / 0.00 | similarity 3 |
| 50 ms | 46.0 / 0.01 | 60.0 / 0.00 | 44.9 / 0.00 | 60.0 / 0.00 | 44.9 / 0.00 | similarity 3 |
| 70 ms | 41.1 / 0.01 | 60.0 / 0.00 | 44.9 / 0.00 | 60.0 / 0.00 | 44.9 / 0.00 | similarity 3 |
| 100 ms | 35.6 / 0.02 | 60.0 / 0.00 | 44.9 / 0.00 | 60.0 / 0.01 | 44.9 / 0.00 | similarity 3 |
| 300 ms | 14.8 / 0.21 | 60.0 / 0.00 | 44.9 / 0.00 | 60.0 / 0.01 | 44.9 / 0.00 | similarity 3 |
| 1000 ms | 3.2 / 1.32 | 60.0 / 0.00 | 44.9 / 0.00 | 60.0 / 0.02 | 44.9 / 0.00 | similarity 3 |

**Chord**:

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 57.5 / 0.02 | 13.2 / 1.09 | 17.6 / 0.55 | 14.6 / 1.29 | 57.5 / 0.02 | ar 3 |
| 20 ms | 48.7 / 0.03 | 12.7 / 1.04 | 18.0 / 0.57 | 13.6 / 1.23 | 48.7 / 0.03 | ar 3 |
| 50 ms | 35.8 / 0.12 | 11.5 / 1.07 | 18.1 / 0.50 | 11.6 / 1.25 | 35.8 / 0.12 | ar 3 |
| 70 ms | 29.0 / 0.19 | 12.3 / 0.99 | 18.0 / 0.51 | 12.1 / 1.35 | 18.0 / 0.51 | similarity 3 |
| 100 ms | 22.4 / 0.42 | 12.4 / 0.87 | 18.1 / 0.48 | 12.0 / 1.26 | 18.1 / 0.48 | similarity 3 |
| 300 ms | 13.9 / 1.47 | 10.7 / 1.02 | 18.0 / 0.50 | 11.2 / 1.44 | 18.0 / 0.50 | similarity 3 |
| 1000 ms | 3.9 / 4.10 | 7.9 / 1.17 | 18.0 / 0.49 | 5.9 / 1.38 | 18.0 / 0.49 | similarity 3 |

**Vibrato**:

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 38.7 / 0.48 | 6.7 / 2.11 | 36.8 / 0.03 | 2.0 / 2.11 | 36.8 / 0.03 | similarity 3 |
| 20 ms | 12.5 / 1.80 | 1.1 / 2.67 | 35.6 / 0.03 | 0.3 / 2.76 | 35.6 / 0.03 | similarity 3 |
| 50 ms | 2.5 / 2.43 | -1.7 / 2.71 | 37.1 / 0.03 | -2.2 / 3.33 | 37.1 / 0.03 | similarity 3 |
| 70 ms | 1.5 / 2.50 | -2.4 / 2.76 | 33.7 / 0.03 | -2.5 / 3.34 | 33.7 / 0.03 | similarity 3 |
| 100 ms | 1.3 / 2.88 | -2.3 / 2.75 | 30.1 / 0.03 | -2.9 / 3.30 | 30.1 / 0.03 | similarity 3 |
| 300 ms | 0.5 / 5.71 | -3.1 / 3.05 | 28.5 / 0.03 | -2.1 / 3.23 | 28.5 / 0.03 | similarity 3 |
| 1000 ms | 0.1 / 7.98 | -2.7 / 2.90 | 28.5 / 0.03 | -1.0 / 3.37 | 28.5 / 0.03 | similarity 3 |

**Song**:

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 14.7 / 3.68 | 7.4 / 7.80 | 27.1 / 4.40 | 7.2 / 7.34 | 22.3 / 3.44 | ar 4, similarity 2 |
| 20 ms | 11.2 / 5.68 | 5.5 / 7.42 | 27.9 / 4.42 | 6.1 / 6.92 | 20.2 / 4.74 | ar 4, similarity 2 |
| 50 ms | 8.6 / 7.71 | 4.0 / 8.47 | 21.3 / 4.46 | 3.9 / 8.28 | 13.0 / 6.84 | ar 4, similarity 2 |
| 70 ms | 6.9 / 8.40 | 3.0 / 8.67 | 22.1 / 4.15 | 2.9 / 7.99 | 22.1 / 4.15 | similarity 6 |
| 100 ms | 5.6 / 8.68 | 2.6 / 8.05 | 13.6 / 4.00 | 1.3 / 7.51 | 13.6 / 4.00 | similarity 6 |
| 300 ms | 2.3 / 14.15 | 0.1 / 8.13 | 12.4 / 3.19 | 0.1 / 7.51 | 12.4 / 3.19 | similarity 6 |
| 1000 ms | 0.4 / 17.45 | -1.4 / 9.80 | 12.0 / 2.25 | -1.0 / 8.81 | 12.0 / 2.25 | similarity 6 |

Band-limited damage, the region naming the damaged band, over speech, music, trumpet and song (2 gaps per recording): a cough (noise masked to 300–3000 Hz at twice the program's RMS) and a phone ring (400 + 450 Hz, 3 harmonics).

**Cough, 300–3000 Hz**:

| gap | ar | sinusoidal | similarity | spectral | auto | unrepaired |
|---|---:|---:|---:|---:|---:|---:|
| 100 ms | 6.3 / 3.49 | 3.8 / 2.91 | 7.3 / 3.27 | 3.9 / 3.11 | 7.7 / 2.46 | -4.1 / 7.54 |
| 300 ms | 3.9 / 5.14 | 1.3 / 3.37 | 6.3 / 3.35 | 2.4 / 3.53 | 6.9 / 3.16 | -4.0 / 8.10 |
| 1000 ms | 3.1 / 7.86 | 0.4 / 4.11 | 3.3 / 4.03 | 2.1 / 3.99 | 4.6 / 3.57 | -4.0 / 8.67 |

**Phone ring, 350–1400 Hz**:

| gap | ar | sinusoidal | similarity | spectral | auto | unrepaired |
|---|---:|---:|---:|---:|---:|---:|
| 100 ms | 6.7 / 3.28 | 4.2 / 2.89 | 5.4 / 3.11 | 4.3 / 2.92 | 5.9 / 2.62 | -3.8 / 4.36 |
| 300 ms | 4.5 / 3.57 | 2.1 / 2.55 | 5.8 / 2.49 | 3.3 / 2.58 | 6.3 / 2.27 | -3.8 / 4.06 |
| 1000 ms | 4.1 / 5.32 | 1.7 / 2.78 | 4.8 / 2.78 | 3.3 / 2.67 | 6.1 / 2.44 | -3.7 / 3.97 |

</details>

On speech, music and the trumpet, `'auto'` has the lowest mean LSD of any tier at every gap length but one: speech at 50 ms, where it keeps AR (5.41 dB LSD, 0.0 dB SNR) over the transplant (4.42 dB, −1.1 dB).

What set the thresholds (the same material, gaps drawn at seeded positions):

- **AR up to 70 ms.** AR fits the waveform itself, so it leads every tier on SNR: at every length on speech and the trumpet, up to 100 ms on music. Its LSD falls behind past ~50 ms, though (speech at 70 ms: 6.17 dB against the transplant's 4.96), because the least-squares fill decays toward silence in the middle of a long gap. On the 9 gaps where no passage joined, AR still beat the bridge at 70 ms (5.28 vs 5.52 dB LSD, 3.5 vs −2.5 dB SNR) and lost to it at 100 ms (6.13 vs 5.41 dB LSD).
- **Transplant at correlation ≥ 0.4.** Over 195 gaps of 100 ms to 1 s, transplanting always gives a mean LSD of 4.35 dB, bridging always 5.43, and the 0.4 gate 3.81; an oracle choosing per gap reaches 3.71. Any gate from 0.3 to 0.6 lands within 0.06 dB of 0.4. The gate turns away the trumpet loop, which has no repeat to copy: 6.8 dB LSD there instead of 10.0.
- **Correlation ≥ 0.995 up to 50 ms.** Over 36 gaps each at 5 and 20 ms, AR alone gives 22.1 / 1.89 and 13.8 / 2.96 dB (SNR / LSD). With a 0.995 gate this becomes 23.2 / 1.82 and 18.5 / 2.67. A 0.9 gate gives 20.1 / 1.86 and 16.1 / 2.62, because it lets a chord's near-repeat (r ≈ 0.992, worth 17 dB) displace AR's 50 dB.
- **AR order N/2, two passes.** Order 1024 matched 2048 (Mokrý & Rajmic's best at 44.1 kHz) at half the cost. The second pass gains up to 1 dB on short gaps; later passes lose slowly. Burg's estimator, which they recommend, peaked 1 dB higher at 5 ms but not at 20–50 ms, degraded with more passes, and ran 8× slower.
- **Search window.** `audio`'s `repair` op searches only the past, which adds no latency. Against searching both sides, that costs at most 0.2 dB LSD (`'auto'` at 100 ms: 3.99 vs 3.78).

## Cost

CPU time per region at 44.1 kHz (Node 25, Apple M4 Max):

- **`ar`**: O(n·p) for the fit and O(m²) for the exact solve (m samples lost, Levinson). 0.11 s for 50 ms, 3.5 s for 1 s. `'auto'` never sends a gap past 70 ms to AR.
- **`sinusoidal`**: a tracker pass over 2N of context on each side, least squares per partial, O(partials · m) synthesis. About 0.17 s.
- **`similarity`**: two grids of 2·window/hop feature frames, 3.4k FFTs at the default 10 s. About 0.14 s. `'auto'` runs this search for every region.
- **`spectral`**: one STFT over the region and 3N of context. 0.03 s.

**Use when:** dropouts and packet loss, edit gaps, a lost second of a take that repeats, a cough, chair squeak or phone ring over the program (with `from`/`to`).<br>
**Not for:** clicks you have not located (use `declick`, which finds them); noise under the program (use `wiener`/`omlsa`); gaps in speech longer than about 100 ms. No tier invents words: a transplant copies other speech, and the bridge holds the voice's last sound.

References: A. J. E. M. Janssen, R. N. J. Veldhuis, L. B. Vries, *Adaptive interpolation of discrete-time signals that can be modeled as autoregressive processes*, IEEE TASSP 34(2), 1986 · S. J. Godsill, P. J. W. Rayner, *Digital Audio Restoration*, Springer 1998, §5 · O. Mokrý, P. Rajmic, *Tweaking autoregressive methods for inpainting of gaps in audio signals*, EUSIPCO 2025 ([arXiv:2403.04433](https://arxiv.org/abs/2403.04433)) · R. J. McAulay, T. F. Quatieri, *Speech analysis/synthesis based on a sinusoidal representation*, IEEE TASSP 34(4), 1986 · X. Serra, J. Smith, *Spectral modeling synthesis*, Computer Music Journal 14(4), 1990 · Y. Stylianou, *Applying the harmonic plus noise model in concatenative speech synthesis*, IEEE TSAP 9(1), 2001 · N. Perraudin, N. Holighaus, P. Majdak, P. Balazs, *Inpainting of long audio segments with similarity graphs*, IEEE/ACM TASLP 26(6), 2018 ([arXiv:1607.06667](https://arxiv.org/abs/1607.06667)) · A. Adler et al., *Audio inpainting*, IEEE TASLP 20(3), 2012.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise), the denoise family umbrella.

MIT © [audiojs](https://github.com/audiojs)
