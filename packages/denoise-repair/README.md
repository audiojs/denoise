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
- **`similarity`**: the passage whose half-second contexts best match the gap's, found within `window` seconds on dB spectra (Perraudin et al. 2018). The match is aligned to the sample by correlation and transplanted. It wins on music that repeats, at any length.
- **`spectral`**: the original method. Log-magnitude interpolation between the clean frames on both sides, each frame's phase advanced from the nearer side, so the frames at both edges line up with the program.

`'auto'` looks for a passage first. If, once aligned, it correlates with the gap's surroundings by 0.4 or more, it is transplanted; up to 50 ms the bar is 0.995, a match to 20 dB SNR, since only a near-exact repeat beats AR there. Otherwise AR takes gaps up to 70 ms and the sinusoidal bridge the longer ones.

Each fill meets the program in a crossfade over the good audio at each edge. Its gains keep the power steady for how alike the two are there: equal gain where the fill continues the program, equal power where it only resembles it (Fink, Holters & Zölzer 2016). It is as short as the seams allow (see [Seams](#seams)): none for AR, whose fill is continuous with its context; 15 ms for the bridge; 30 ms for spectral; 5 ms for a transplant that repeats the program (aligned correlation 0.9 or more), one frame (46 ms) for a looser one, which shows at any shorter length. Band-limited regions route the same way and take only their band from the joined fill, frame by frame. Samples beyond the crossfades come back bit-exact; in a band-limited region, beyond the frames that overlap it.

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
| 5 ms | 10.7 / 2.68 | 1.4 / 4.69 | 1.3 / 4.06 | 1.0 / 4.69 | 10.7 / 2.68 | ar 8 |
| 20 ms | 3.2 / 3.67 | -2.3 / 4.99 | 0.4 / 4.28 | -1.2 / 4.90 | 3.2 / 3.67 | ar 8 |
| 50 ms | -0.0 / 5.41 | -2.2 / 5.39 | -1.1 / 4.41 | -0.7 / 5.47 | -0.0 / 5.41 | ar 8 |
| 70 ms | -0.2 / 6.17 | -1.9 / 5.49 | -1.8 / 4.94 | -0.4 / 5.62 | -1.8 / 4.94 | similarity 8 |
| 100 ms | -0.4 / 7.26 | -2.8 / 5.65 | -1.2 / 5.00 | -0.5 / 5.76 | -1.2 / 5.00 | similarity 8 |
| 300 ms | 0.1 / 9.84 | -2.1 / 5.63 | -4.2 / 5.27 | -0.8 / 5.74 | -3.2 / 5.14 | similarity 5, sinusoidal 3 |
| 1000 ms | 0.0 / 12.76 | -1.3 / 7.05 | -2.6 / 6.83 | -0.4 / 7.15 | -1.7 / 6.63 | similarity 2, sinusoidal 6 |

**Music** ("Vibe Ace", "Dance of the Sugar Plum Fairy", Hungarian Dance No. 5; 4 gaps each per length):

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 15.5 / 2.18 | 3.8 / 4.48 | 4.6 / 4.54 | 6.4 / 5.10 | 16.5 / 2.09 | ar 11, similarity 1 |
| 20 ms | 10.2 / 3.51 | 1.7 / 4.78 | 3.9 / 4.84 | 4.9 / 5.42 | 11.3 / 3.24 | ar 11, similarity 1 |
| 50 ms | 6.7 / 5.43 | 0.8 / 5.34 | 2.5 / 5.41 | 2.9 / 5.78 | 7.6 / 4.97 | ar 11, similarity 1 |
| 70 ms | 5.4 / 6.04 | -0.6 / 5.83 | 2.7 / 5.01 | 1.8 / 6.05 | 6.1 / 4.92 | similarity 7, ar 5 |
| 100 ms | 3.5 / 7.06 | -2.1 / 5.95 | 2.3 / 4.89 | 0.6 / 6.05 | 2.7 / 4.68 | similarity 7, sinusoidal 5 |
| 300 ms | 1.3 / 9.72 | -1.5 / 5.66 | 2.9 / 5.76 | -0.2 / 6.07 | 3.2 / 5.04 | similarity 7, sinusoidal 5 |
| 1000 ms | 0.3 / 11.42 | -1.8 / 6.13 | 3.4 / 6.14 | -0.5 / 6.46 | 3.7 / 5.13 | similarity 5, sinusoidal 7 |

**Solo trumpet** (a 5 s loop, 4 gaps per length):

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 17.3 / 2.02 | 5.9 / 3.92 | 1.7 / 4.73 | 2.7 / 4.11 | 17.3 / 2.02 | ar 4 |
| 20 ms | 11.3 / 3.01 | -0.2 / 4.19 | -2.6 / 6.41 | 0.8 / 4.66 | 11.3 / 3.01 | ar 4 |
| 50 ms | 3.3 / 3.96 | -2.5 / 5.02 | -5.3 / 10.43 | -2.1 / 5.51 | 3.3 / 3.96 | ar 4 |
| 70 ms | 0.9 / 4.68 | -4.8 / 5.63 | -5.9 / 10.44 | -3.0 / 5.84 | 0.9 / 4.68 | ar 4 |
| 100 ms | -0.0 / 5.64 | -2.2 / 5.52 | -2.7 / 10.68 | -0.8 / 5.87 | -2.2 / 5.52 | sinusoidal 4 |
| 300 ms | -0.0 / 9.18 | -1.7 / 6.64 | -4.2 / 9.81 | -0.4 / 6.72 | -1.7 / 6.64 | sinusoidal 4 |
| 1000 ms | -0.0 / 12.71 | -1.7 / 7.60 | -2.2 / 8.17 | -0.4 / 7.79 | -1.7 / 7.60 | sinusoidal 4 |

<details><summary>Synthetic signals, and band-limited damage over the program</summary>

A 440 Hz sine; a C-major triad, 6 harmonics per note; a vibrato tone, ±50 cents at 5.5 Hz; a 120 BPM song whose 8 s phrase plays twice, with hi-hats of fresh noise. SNR is capped at 60 dB.

**Sine**:

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 60.0 / 0.00 | 60.0 / 0.00 | 45.0 / 0.03 | 60.0 / 0.00 | 45.0 / 0.03 | similarity 3 |
| 20 ms | 59.9 / 0.00 | 60.0 / 0.00 | 45.0 / 0.02 | 60.0 / 0.00 | 45.0 / 0.02 | similarity 3 |
| 50 ms | 46.0 / 0.01 | 60.0 / 0.00 | 44.9 / 0.01 | 60.0 / 0.01 | 44.9 / 0.01 | similarity 3 |
| 70 ms | 41.1 / 0.01 | 60.0 / 0.00 | 44.9 / 0.01 | 60.0 / 0.00 | 44.9 / 0.01 | similarity 3 |
| 100 ms | 35.6 / 0.02 | 60.0 / 0.00 | 44.9 / 0.01 | 60.0 / 0.00 | 44.9 / 0.01 | similarity 3 |
| 300 ms | 14.8 / 0.21 | 60.0 / 0.00 | 44.9 / 0.00 | 60.0 / 0.01 | 44.9 / 0.00 | similarity 3 |
| 1000 ms | 3.2 / 1.32 | 60.0 / 0.00 | 44.9 / 0.00 | 60.0 / 0.02 | 44.9 / 0.00 | similarity 3 |

**Chord**:

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 57.5 / 0.02 | 13.2 / 1.16 | 17.6 / 1.39 | 16.6 / 1.15 | 57.5 / 0.02 | ar 3 |
| 20 ms | 48.7 / 0.03 | 12.7 / 1.03 | 18.0 / 1.10 | 14.2 / 1.18 | 48.7 / 0.03 | ar 3 |
| 50 ms | 35.8 / 0.12 | 11.5 / 1.07 | 18.1 / 0.78 | 13.4 / 1.24 | 35.8 / 0.12 | ar 3 |
| 70 ms | 29.0 / 0.19 | 12.3 / 0.99 | 18.0 / 0.73 | 12.9 / 1.20 | 18.0 / 0.73 | similarity 3 |
| 100 ms | 22.4 / 0.42 | 12.4 / 0.87 | 18.1 / 0.64 | 12.8 / 1.17 | 18.1 / 0.64 | similarity 3 |
| 300 ms | 13.9 / 1.47 | 10.7 / 1.01 | 18.0 / 0.55 | 12.1 / 1.26 | 18.0 / 0.55 | similarity 3 |
| 1000 ms | 3.9 / 4.10 | 7.9 / 1.17 | 18.0 / 0.51 | 8.0 / 1.39 | 18.0 / 0.51 | similarity 3 |

**Vibrato**:

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 38.7 / 0.48 | 6.7 / 2.07 | 36.8 / 0.41 | 3.2 / 2.27 | 36.8 / 0.41 | similarity 3 |
| 20 ms | 12.5 / 1.80 | 1.1 / 2.67 | 35.6 / 0.23 | 0.8 / 2.59 | 35.6 / 0.23 | similarity 3 |
| 50 ms | 2.5 / 2.43 | -1.7 / 2.69 | 37.1 / 0.12 | -0.5 / 3.34 | 37.1 / 0.12 | similarity 3 |
| 70 ms | 1.5 / 2.50 | -2.4 / 2.72 | 33.7 / 0.13 | -2.1 / 3.28 | 33.7 / 0.13 | similarity 3 |
| 100 ms | 1.3 / 2.88 | -2.3 / 2.74 | 30.1 / 0.12 | -2.1 / 2.97 | 30.1 / 0.12 | similarity 3 |
| 300 ms | 0.5 / 5.71 | -3.1 / 3.04 | 28.5 / 0.06 | -2.6 / 3.25 | 28.5 / 0.06 | similarity 3 |
| 1000 ms | 0.1 / 7.98 | -2.7 / 2.90 | 28.5 / 0.04 | -1.9 / 3.46 | 28.5 / 0.04 | similarity 3 |

**Song**:

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 14.7 / 3.68 | 7.4 / 7.29 | 27.1 / 4.21 | 8.9 / 7.26 | 22.3 / 3.44 | ar 4, similarity 2 |
| 20 ms | 11.2 / 5.68 | 5.5 / 7.13 | 27.9 / 4.11 | 6.8 / 7.06 | 20.2 / 4.74 | ar 4, similarity 2 |
| 50 ms | 8.6 / 7.71 | 4.0 / 8.31 | 21.3 / 4.39 | 4.1 / 8.01 | 13.0 / 6.83 | ar 4, similarity 2 |
| 70 ms | 6.9 / 8.40 | 3.0 / 8.54 | 22.1 / 4.11 | 2.6 / 7.75 | 22.1 / 4.11 | similarity 6 |
| 100 ms | 5.6 / 8.68 | 2.6 / 7.95 | 13.6 / 3.93 | 2.5 / 7.40 | 13.6 / 3.93 | similarity 6 |
| 300 ms | 2.3 / 14.15 | 0.1 / 8.10 | 12.4 / 3.18 | 1.1 / 6.95 | 12.4 / 3.18 | similarity 6 |
| 1000 ms | 0.4 / 17.45 | -1.4 / 9.78 | 12.0 / 2.25 | -0.7 / 8.95 | 12.0 / 2.25 | similarity 6 |

Band-limited damage, the region naming the damaged band, over speech, music, trumpet and song (2 gaps per recording): a cough (noise masked to 300–3000 Hz at twice the program's RMS) and a phone ring (400 + 450 Hz, 3 harmonics).

**Cough, 300–3000 Hz**:

| gap | ar | sinusoidal | similarity | spectral | auto | unrepaired |
|---|---:|---:|---:|---:|---:|---:|
| 100 ms | 6.3 / 3.49 | 3.8 / 2.87 | 7.3 / 3.20 | 3.9 / 2.96 | 7.7 / 2.43 | -4.1 / 7.54 |
| 300 ms | 3.9 / 5.14 | 1.3 / 3.36 | 6.3 / 3.33 | 3.1 / 3.33 | 6.9 / 3.14 | -4.0 / 8.10 |
| 1000 ms | 3.1 / 7.86 | 0.4 / 4.10 | 3.3 / 4.01 | 2.2 / 3.81 | 4.6 / 3.56 | -4.0 / 8.67 |

**Phone ring, 350–1400 Hz**:

| gap | ar | sinusoidal | similarity | spectral | auto | unrepaired |
|---|---:|---:|---:|---:|---:|---:|
| 100 ms | 6.7 / 3.28 | 4.2 / 2.88 | 5.4 / 3.09 | 4.4 / 2.89 | 5.9 / 2.62 | -3.8 / 4.36 |
| 300 ms | 4.5 / 3.57 | 2.1 / 2.54 | 5.8 / 2.48 | 3.9 / 2.53 | 6.3 / 2.27 | -3.8 / 4.06 |
| 1000 ms | 4.1 / 5.32 | 1.7 / 2.77 | 4.8 / 2.78 | 3.3 / 2.66 | 6.1 / 2.44 | -3.7 / 3.97 |

</details>

On speech, music and the trumpet, `'auto'` has the lowest mean LSD of any tier at every gap length but one: speech at 50 ms, where it keeps AR (5.41 dB LSD, 0.0 dB SNR) over the transplant (4.41 dB, −1.1 dB).

What set the thresholds (the same material, gaps drawn at seeded positions; measured with 0.2's longer joins):

- **AR up to 70 ms.** AR fits the waveform itself, so it leads every tier on SNR: at every length on speech and the trumpet, up to 100 ms on music. Its LSD falls behind past ~50 ms, though (speech at 70 ms: 6.17 dB against the transplant's 4.94), because the least-squares fill decays toward silence in the middle of a long gap. On the 9 gaps where no passage joined, AR still beat the bridge at 70 ms (5.28 vs 5.52 dB LSD, 3.5 vs −2.5 dB SNR) and lost to it at 100 ms (6.13 vs 5.41 dB LSD).
- **Transplant at correlation ≥ 0.4.** Over 195 gaps of 100 ms to 1 s, transplanting always gives a mean LSD of 4.35 dB, bridging always 5.43, and the 0.4 gate 3.81; an oracle choosing per gap reaches 3.71. Any gate from 0.3 to 0.6 lands within 0.06 dB of 0.4. The gate turns away the trumpet loop, which has no repeat to copy: 6.8 dB LSD there instead of 10.0.
- **Correlation ≥ 0.995 up to 50 ms.** Over 36 gaps each at 5 and 20 ms, AR alone gives 22.1 / 1.89 and 13.8 / 2.96 dB (SNR / LSD). With a 0.995 gate this becomes 23.2 / 1.82 and 18.5 / 2.67. A 0.9 gate gives 20.1 / 1.86 and 16.1 / 2.62, because it lets a chord's near-repeat (r ≈ 0.992, worth 17 dB) displace AR's 50 dB.
- **AR order N/2, two passes.** Order 1024 matched 2048 (Mokrý & Rajmic's best at 44.1 kHz) at half the cost. The second pass gains up to 1 dB on short gaps; later passes lose slowly. Burg's estimator, which they recommend, peaked 1 dB higher at 5 ms but not at 20–50 ms, degraded with more passes, and ran 8× slower.
- **Search window.** `audio`'s `repair` op searches only the past, which adds no latency. Against searching both sides, that costs at most 0.2 dB LSD (`'auto'` at 100 ms: 3.99 vs 3.78).

### Seams

A fill seldom matches the program exactly where they meet, so each joins it in a crossfade over good audio. 0.2 used long ones: half a frame (23 ms) for the bridge and a frame (46 ms) for every transplant, and the spectral tier wrote its frames back whole (35–39 ms). That rewrote 46–93 ms of good audio around every gap, at 3–6 dB SNR. `node scripts/repair.js seams` cuts gaps of 20, 50, 100, 300 ms and 1 s and measures what each tier rewrites and what its joins add at the edges:

- **new onsets**: the share of edges where the output's onset strength, from 8 ms outside the edge to 1 ms inside, tops every onset of the original within ±150 ms. Onset strength is librosa's: 40 mel bands, dB, the mean rise from the frame before (Böck & Widmer 2013). After the slash, the original's own share at the same edges.
- **clicks**: the strongest 1 ms of the AR(32) residual there, where a click stands out (Vaseghi & Rayner 1990), over the original's, in dB.

**Speech** (audio-lena, 16 gaps per length), 0.2.0 → 0.3.0:

| tier | good audio rewritten per gap | its SNR | new onsets | clicks | gap SNR / LSD |
|---|---:|---:|---:|---:|---:|
| ar (≤ 100 ms) | 0 | – | 15% / 4% | −0.3 dB | 1.7 / 5.36 |
| sinusoidal | 46 → 30 ms | 5.7 → 5.4 dB | 4% → 3% / 3% | −1.8 → −1.3 dB | −1.8 / 5.70 → −1.8 / 5.63 |
| similarity | 93 → 93 ms | 3.2 → 4.1 dB | 4% → 4% / 3% | 1.1 → 1.3 dB | −2.6 / 5.47 → −2.6 / 5.43 |
| spectral | 75 → 60 ms | 3.9 → 6.1 dB | 1% → 1% / 3% | −5.8 → −6.0 dB | −0.4 / 5.89 → −0.3 / 5.88 |
| auto | 38 → 31 ms | 5.3 → 5.5 dB | 7% → 8% / 3% | −0.6 → −0.5 dB | −0.4 / 5.43 → −0.4 / 5.41 |

**Music** ("Vibe Ace", "Dance of the Sugar Plum Fairy", Hungarian Dance No. 5, the trumpet loop; 6 gaps each per length), 0.2.0 → 0.3.0:

| tier | good audio rewritten per gap | its SNR | new onsets | clicks | gap SNR / LSD |
|---|---:|---:|---:|---:|---:|
| ar (≤ 100 ms) | 0 | – | 16% / 2% | −0.2 dB | 7.5 / 4.44 |
| sinusoidal | 46 → 30 ms | 5.9 → 6.2 dB | 2% → 2% / 4% | −0.9 → −0.6 dB | 0.3 / 5.32 → 0.3 / 5.28 |
| similarity | 93 → 78 ms | 4.9 → 4.8 dB | 6% → 8% / 4% | −1.5 → −0.7 dB | 1.6 / 6.13 → 1.6 / 6.03 |
| spectral | 75 → 60 ms | 4.9 → 9.0 dB | 0% → 2% / 4% | −4.2 → −3.6 dB | 0.8 / 5.43 → 1.5 / 5.40 |
| auto | 40 → 24 ms | 9.1 → 7.1 dB | 6% → 6% / 4% | −0.4 → −0.3 dB | 4.8 / 4.66 → 4.8 / 4.65 |

Joined with no crossfade, the bridge, the transplant and spectral all click: the residual burst stands 7–15 dB over the original's. A 2 ms crossfade ends the click. The onsets that remain come from the fill sounding different from the program at the edge, and even AR's fill, continuous with its context, shows them (15% of edges). A crossfade only spreads that change over good audio, so each tier gets the shortest one at which its onsets fall to the original's own rate, on VoiceBank+DEMAND training speech, spoken narrations, audio-lena and the four recordings:

- **The bridge: 15 ms.** 5 ms is enough on the VoiceBank speech, the narrations and music, but not on audio-lena: 6% of edges against the original's 1%.
- **Spectral: 30 ms.** Its frames overlap with phases that only roughly agree, so the fill comes out 1.5–4.5 dB quiet, and the program returning after it is an onset (at 15 ms, 10% of edges in audio-lena, nearly all where the gap ends).
- **A transplant: 5 ms if it repeats the program** (aligned correlation 0.9 or more: no more onsets than the original's). A looser one still shows at 46 ms (9% of edges in music against the original's 6%) and more at any shorter length, so it keeps the frame.

On VoiceBank+DEMAND test speech (24 utterances, held out), the bridge rewrites 30 ms per gap instead of 43 and spectral 60 instead of 69, with no new onsets (the original: 3%); `'auto'` rewrites 22 ms instead of 28.

Where the short join costs: the near-repeats of the synthetic tones above show it in LSD (the vibrato at 5 ms: 0.41 dB, was 0.03; the chord: 1.39, was 0.55). The copies differ by 17–37 dB, and switching that difference in 5 ms instead of 46 spreads it between the partials of a spectrum with nothing else there. On the recordings it does not show.

## Cost

CPU time per region at 44.1 kHz (Node 25, Apple M4 Max):

- **`ar`**: O(n·p) for the fit and O(m²) for the exact solve (m samples lost, Levinson). 0.11 s for 50 ms, 3.5 s for 1 s. `'auto'` never sends a gap past 70 ms to AR.
- **`sinusoidal`**: a tracker pass over 2N of context on each side, least squares per partial, O(partials · m) synthesis. About 0.17 s.
- **`similarity`**: two grids of 2·window/hop feature frames, 3.4k FFTs at the default 10 s. About 0.14 s. `'auto'` runs this search for every region.
- **`spectral`**: one STFT over the region and 3N of context. 0.03 s.

**Use when:** dropouts and packet loss, edit gaps, a lost second of a take that repeats, a cough, chair squeak or phone ring over the program (with `from`/`to`).<br>
**Not for:** clicks you have not located (use `declick`, which finds them); noise under the program (use `wiener`/`omlsa`); gaps in speech longer than about 100 ms. No tier invents words: a transplant copies other speech, and the bridge holds the voice's last sound.

References: A. J. E. M. Janssen, R. N. J. Veldhuis, L. B. Vries, *Adaptive interpolation of discrete-time signals that can be modeled as autoregressive processes*, IEEE TASSP 34(2), 1986 · S. J. Godsill, P. J. W. Rayner, *Digital Audio Restoration*, Springer 1998, §5 · O. Mokrý, P. Rajmic, *Tweaking autoregressive methods for inpainting of gaps in audio signals*, EUSIPCO 2025 ([arXiv:2403.04433](https://arxiv.org/abs/2403.04433)) · R. J. McAulay, T. F. Quatieri, *Speech analysis/synthesis based on a sinusoidal representation*, IEEE TASSP 34(4), 1986 · X. Serra, J. Smith, *Spectral modeling synthesis*, Computer Music Journal 14(4), 1990 · Y. Stylianou, *Applying the harmonic plus noise model in concatenative speech synthesis*, IEEE TSAP 9(1), 2001 · N. Perraudin, N. Holighaus, P. Majdak, P. Balazs, *Inpainting of long audio segments with similarity graphs*, IEEE/ACM TASLP 26(6), 2018 ([arXiv:1607.06667](https://arxiv.org/abs/1607.06667)) · A. Adler et al., *Audio inpainting*, IEEE TASLP 20(3), 2012 · M. Fink, M. Holters, U. Zölzer, *Signal-matched power-complementary cross-fading and dry-wet mixing*, DAFx 2016 · S. V. Vaseghi, P. J. W. Rayner, *Detection and suppression of impulsive noise in speech communication systems*, IEE Proc. I 137(1), 1990 · S. Böck, G. Widmer, *Maximum filter vibrato suppression for onset detection*, DAFx 2013.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise), the denoise family umbrella.

MIT © [audiojs](https://github.com/audiojs)
