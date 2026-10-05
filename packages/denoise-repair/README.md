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

`'auto'` looks for a passage first. If, once aligned, it correlates with the gap's surroundings by 0.4 or more, it is transplanted; up to 30 ms the bar is 0.995, a match to 20 dB SNR, since only a near-exact repeat beats AR there. Otherwise AR takes gaps up to 30 ms and the sinusoidal bridge the longer ones.

Before it joins, each fill but AR's is brought to the program's level and spectrum at both edges. Per 1/3-octave band, the program's power over the 15 ms of good audio beside an edge, against the fill's over the same samples, gives that edge a gain (at most ±12 dB), and the gain runs log-linearly from the left edge's to the right's across the gap. A transplant from a quieter or darker passage, a bridge whose partials were measured a frame from the edge, a spectral fill whose overlapping frames come out 4–5 dB short: each arrives at the program's level. AR's fill is the program itself outside the gap, so it has nothing to match.

Each fill then meets the program in a crossfade over the good audio at each edge. Its gains keep the power steady for how alike the two are there: equal gain where the fill continues the program, equal power where it only resembles it (Fink, Holters & Zölzer 2016). It is as short as the seams allow (see [Seams](#seams)): none for AR, whose fill is continuous with its context; 5 ms for the bridge; 30 ms for spectral; 5 ms for a transplant that repeats the program (aligned correlation 0.9 or more), one frame (46 ms) for a looser one, which shows at any shorter length. Band-limited regions route the same way and take only their band from the joined fill, frame by frame. Samples beyond the crossfades come back bit-exact; in a band-limited region, beyond the frames that overlap it.

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
| 5 ms | 10.7 / 2.68 | 1.3 / 4.41 | 1.3 / 4.03 | 0.0 / 4.30 | 10.7 / 2.68 | ar 8 |
| 20 ms | 3.2 / 3.67 | -2.2 / 4.75 | -0.5 / 4.29 | -2.5 / 4.59 | 3.2 / 3.67 | ar 8 |
| 50 ms | -0.0 / 5.41 | -3.3 / 5.18 | -2.1 / 4.62 | -2.1 / 5.24 | -2.1 / 4.62 | similarity 8 |
| 70 ms | -0.2 / 6.17 | -2.2 / 5.28 | -1.7 / 5.12 | -1.3 / 5.29 | -1.7 / 5.12 | similarity 8 |
| 100 ms | -0.4 / 7.26 | -3.0 / 5.60 | -1.0 / 4.99 | -1.6 / 5.58 | -1.0 / 4.99 | similarity 8 |
| 300 ms | 0.1 / 9.84 | -2.4 / 5.65 | -4.7 / 5.27 | -1.3 / 5.65 | -3.2 / 5.23 | similarity 5, sinusoidal 3 |
| 1000 ms | 0.0 / 12.76 | -1.7 / 7.14 | -4.4 / 7.03 | -0.8 / 7.23 | -1.6 / 6.80 | similarity 2, sinusoidal 6 |

**Music** ("Vibe Ace", "Dance of the Sugar Plum Fairy", Hungarian Dance No. 5; 4 gaps each per length):

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 15.5 / 2.18 | 3.7 / 3.87 | 5.1 / 4.21 | 5.8 / 4.22 | 16.6 / 2.09 | ar 11, similarity 1 |
| 20 ms | 10.2 / 3.51 | 1.2 / 4.27 | 4.3 / 4.53 | 4.2 / 4.51 | 11.3 / 3.24 | ar 11, similarity 1 |
| 50 ms | 6.7 / 5.43 | 0.5 / 4.67 | 3.3 / 4.86 | 2.7 / 4.93 | 5.1 / 4.40 | similarity 6, sinusoidal 6 |
| 70 ms | 5.4 / 6.04 | -0.2 / 4.93 | 3.3 / 4.74 | 1.3 / 5.14 | 4.3 / 4.43 | similarity 7, sinusoidal 5 |
| 100 ms | 3.5 / 7.06 | -1.4 / 5.65 | 2.4 / 4.70 | 0.6 / 5.67 | 2.6 / 4.47 | similarity 7, sinusoidal 5 |
| 300 ms | 1.3 / 9.72 | -1.7 / 5.60 | 2.0 / 5.40 | -0.6 / 5.70 | 2.6 / 4.85 | similarity 7, sinusoidal 5 |
| 1000 ms | 0.3 / 11.42 | -1.6 / 6.19 | 2.9 / 5.73 | -0.8 / 6.30 | 3.3 / 4.91 | similarity 5, sinusoidal 7 |

**Solo trumpet** (a 5 s loop, 4 gaps per length):

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 17.3 / 2.02 | 8.0 / 3.29 | 3.1 / 4.44 | 3.0 / 3.53 | 17.3 / 2.02 | ar 4 |
| 20 ms | 11.3 / 3.01 | 1.8 / 3.99 | -2.5 / 6.02 | 0.9 / 3.95 | 11.3 / 3.01 | ar 4 |
| 50 ms | 3.3 / 3.96 | -0.8 / 4.70 | -2.6 / 9.90 | -1.1 / 4.52 | -0.8 / 4.70 | sinusoidal 4 |
| 70 ms | 0.9 / 4.68 | -2.5 / 4.95 | -3.0 / 9.94 | -1.1 / 4.83 | -2.5 / 4.95 | sinusoidal 4 |
| 100 ms | -0.0 / 5.64 | -2.6 / 5.25 | -2.1 / 10.38 | -1.4 / 5.22 | -2.6 / 5.25 | sinusoidal 4 |
| 300 ms | -0.0 / 9.18 | -1.8 / 6.49 | -2.9 / 9.85 | -0.5 / 6.54 | -1.8 / 6.49 | sinusoidal 4 |
| 1000 ms | -0.0 / 12.71 | -2.0 / 7.65 | -3.5 / 8.18 | -0.6 / 7.66 | -2.0 / 7.65 | sinusoidal 4 |

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
| 5 ms | 57.5 / 0.02 | 13.5 / 1.95 | 16.4 / 1.36 | 17.5 / 0.98 | 57.5 / 0.02 | ar 3 |
| 20 ms | 48.7 / 0.03 | 12.7 / 1.46 | 17.3 / 1.09 | 13.9 / 1.07 | 48.7 / 0.03 | ar 3 |
| 50 ms | 35.8 / 0.12 | 11.9 / 1.32 | 17.1 / 0.83 | 13.7 / 1.21 | 17.1 / 0.83 | similarity 3 |
| 70 ms | 29.0 / 0.19 | 12.3 / 1.12 | 17.1 / 0.79 | 12.4 / 1.13 | 17.1 / 0.79 | similarity 3 |
| 100 ms | 22.4 / 0.42 | 12.4 / 1.07 | 17.4 / 0.70 | 13.0 / 1.24 | 17.4 / 0.70 | similarity 3 |
| 300 ms | 13.9 / 1.47 | 10.7 / 1.03 | 17.7 / 0.59 | 12.2 / 1.23 | 17.7 / 0.59 | similarity 3 |
| 1000 ms | 3.9 / 4.10 | 8.1 / 1.19 | 16.9 / 0.63 | 8.1 / 1.44 | 16.9 / 0.63 | similarity 3 |

**Vibrato**:

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 38.7 / 0.48 | 6.5 / 3.36 | 36.8 / 0.41 | 3.9 / 2.11 | 36.8 / 0.41 | similarity 3 |
| 20 ms | 12.5 / 1.80 | 1.1 / 3.80 | 35.6 / 0.23 | 1.6 / 2.25 | 35.6 / 0.23 | similarity 3 |
| 50 ms | 2.5 / 2.43 | -1.7 / 3.37 | 37.1 / 0.12 | -0.0 / 2.84 | 37.1 / 0.12 | similarity 3 |
| 70 ms | 1.5 / 2.50 | -2.3 / 3.18 | 33.7 / 0.13 | -2.3 / 2.87 | 33.7 / 0.13 | similarity 3 |
| 100 ms | 1.3 / 2.88 | -2.3 / 3.14 | 30.1 / 0.12 | -2.2 / 2.76 | 30.1 / 0.12 | similarity 3 |
| 300 ms | 0.5 / 5.71 | -3.1 / 3.16 | 28.5 / 0.06 | -2.6 / 3.21 | 28.5 / 0.06 | similarity 3 |
| 1000 ms | 0.1 / 7.98 | -2.7 / 2.94 | 28.5 / 0.04 | -1.9 / 3.36 | 28.5 / 0.04 | similarity 3 |

**Song**:

| gap | ar | sinusoidal | similarity | spectral | auto | auto picked |
|---|---:|---:|---:|---:|---:|---:|
| 5 ms | 14.7 / 3.68 | 6.8 / 5.74 | 27.0 / 4.22 | 8.8 / 5.77 | 22.3 / 3.44 | ar 4, similarity 2 |
| 20 ms | 11.2 / 5.68 | 4.9 / 6.32 | 25.6 / 4.16 | 6.4 / 6.10 | 20.2 / 4.74 | ar 4, similarity 2 |
| 50 ms | 8.6 / 7.71 | 3.9 / 6.67 | 21.2 / 4.40 | 3.6 / 6.31 | 21.2 / 4.40 | similarity 6 |
| 70 ms | 6.9 / 8.40 | 3.3 / 6.76 | 18.1 / 4.23 | 2.5 / 6.51 | 18.1 / 4.23 | similarity 6 |
| 100 ms | 5.6 / 8.68 | 2.6 / 7.28 | 13.5 / 4.07 | 2.4 / 6.71 | 13.5 / 4.07 | similarity 6 |
| 300 ms | 2.3 / 14.15 | -0.6 / 8.24 | 12.3 / 3.30 | 0.4 / 7.21 | 12.3 / 3.30 | similarity 6 |
| 1000 ms | 0.4 / 17.45 | -2.5 / 10.79 | 11.8 / 2.48 | -1.2 / 10.54 | 11.8 / 2.48 | similarity 6 |

Band-limited damage, the region naming the damaged band, over speech, music, trumpet and song (2 gaps per recording): a cough (noise masked to 300–3000 Hz at twice the program's RMS) and a phone ring (400 + 450 Hz, 3 harmonics).

**Cough, 300–3000 Hz**:

| gap | ar | sinusoidal | similarity | spectral | auto | unrepaired |
|---|---:|---:|---:|---:|---:|---:|
| 100 ms | 6.3 / 3.49 | 3.9 / 2.84 | 7.6 / 3.01 | 3.8 / 2.77 | 7.9 / 2.47 | -4.1 / 7.54 |
| 300 ms | 3.9 / 5.14 | 1.3 / 3.27 | 5.8 / 3.11 | 2.9 / 3.16 | 7.0 / 2.91 | -4.0 / 8.10 |
| 1000 ms | 3.1 / 7.86 | 0.5 / 4.06 | 2.6 / 4.01 | 1.9 / 3.80 | 4.3 / 3.53 | -4.0 / 8.67 |

**Phone ring, 350–1400 Hz**:

| gap | ar | sinusoidal | similarity | spectral | auto | unrepaired |
|---|---:|---:|---:|---:|---:|---:|
| 100 ms | 6.7 / 3.28 | 4.3 / 2.87 | 5.7 / 3.00 | 4.3 / 2.80 | 6.0 / 2.65 | -3.8 / 4.36 |
| 300 ms | 4.5 / 3.57 | 2.2 / 2.53 | 5.6 / 2.32 | 3.8 / 2.48 | 6.3 / 2.16 | -3.8 / 4.06 |
| 1000 ms | 4.1 / 5.32 | 1.8 / 2.73 | 4.2 / 2.78 | 3.2 / 2.63 | 6.0 / 2.38 | -3.7 / 3.97 |

</details>

On speech and music, `'auto'` has the lowest mean LSD of any tier at every gap length. On the solo trumpet it does not from 50 to 100 ms: a single held line is what AR predicts best, and AR keeps the lead there (3.96 dB LSD and 3.3 dB SNR at 50 ms, against the bridge's 4.70 and −0.8), where speech and the ensembles have handed it to the bridge or a transplant (below). 0.3, with AR up to 70 ms, kept it.

What set the thresholds (the same material, gaps drawn at seeded positions; the transplant gates measured with 0.2's longer joins):

- **AR up to 30 ms** (70 ms in 0.3). AR fits the waveform itself, so it leads every tier on SNR. Its LSD falls behind as the gap grows, because the least-squares fill decays toward silence in its middle, and the program returning after it is an onset at the gap's end: at 15–25% of edges in audio-lena and the recordings for gaps of 20–70 ms, where the originals have 0–10%. Once the bridge and the transplant meet the program's level at their edges (0.4), they overtake AR sooner. Over gaps of 20–100 ms, `'auto'`'s mean LSD with AR (and the transplant's 0.995 bar) up to 30 / 40 / 50 ms, and with 0.3's 70 ms (50 for the bar), is 6.63 / 6.64 / 6.75 / 6.96 dB on VoiceBank+DEMAND training speech and narrations, 4.31 / 4.37 / 4.48 / 4.61 on audio-lena, 3.89 / 3.90 / 3.93 / 3.94 on the four recordings. Past 30 ms a transplant competes with the bridge, not AR, so its bar drops to 0.4 there too. What AR gives up is SNR: music at 40 ms, 8.5 dB against 3.0.
- **Transplant at correlation ≥ 0.4.** Over 195 gaps of 100 ms to 1 s, transplanting always gives a mean LSD of 4.35 dB, bridging always 5.43, and the 0.4 gate 3.81; an oracle choosing per gap reaches 3.71. Any gate from 0.3 to 0.6 lands within 0.06 dB of 0.4. The gate turns away the trumpet loop, which has no repeat to copy: 6.8 dB LSD there instead of 10.0.
- **Correlation ≥ 0.995 up to 30 ms.** Over 36 gaps each at 5 and 20 ms, AR alone gives 22.1 / 1.89 and 13.8 / 2.96 dB (SNR / LSD). With a 0.995 gate this becomes 23.2 / 1.82 and 18.5 / 2.67. A 0.9 gate gives 20.1 / 1.86 and 16.1 / 2.62, because it lets a chord's near-repeat (r ≈ 0.992, worth 17 dB) displace AR's 50 dB.
- **Edge gains within ±12 dB.** Over 96 gaps of 100 and 300 ms on the tuning set, the transplant's mean LSD is 7.94 / 7.70 / 7.52 dB with the gains held to ±6 / 12 / 24 dB, the bridge's 6.97 / 6.91 / 6.87. The wider bound lifts a wrong passage as readily as a right one: the worst transplant's SNR goes from −12.4 to −16.5 dB.
- **AR order N/2, two passes.** Order 1024 matched 2048 (Mokrý & Rajmic's best at 44.1 kHz) at half the cost. The second pass gains up to 1 dB on short gaps; later passes lose slowly. Burg's estimator, which they recommend, peaked 1 dB higher at 5 ms but not at 20–50 ms, degraded with more passes, and ran 8× slower.
- **Search window.** `audio`'s `repair` op searches only the past, which adds no latency. Against searching both sides, that costs at most 0.2 dB LSD (`'auto'` at 100 ms: 3.99 vs 3.78).

### Seams

A fill seldom matches the program exactly where they meet, so each joins it in a crossfade over good audio. 0.2 used long ones: half a frame (23 ms) for the bridge and a frame (46 ms) for every transplant, and the spectral tier wrote its frames back whole (35–39 ms). That rewrote 46–93 ms of good audio around every gap, at 3–6 dB SNR. 0.3 cut them to what its seams allowed; 0.4 first brings each fill to the program's level at the edges. `node scripts/repair.js seams` cuts gaps of 20, 50, 100, 300 ms and 1 s and measures what each tier rewrites and what its joins add at the edges:

- **new onsets**: the share of edges where the output's onset strength, from 8 ms outside the edge to 1 ms inside, tops every onset of the original within ±150 ms. Onset strength is librosa's: 40 mel bands, dB, the mean rise from the frame before (Böck & Widmer 2013). After the slash, the original's own share at the same edges.
- **clicks**: the strongest 1 ms of the AR(32) residual there, where a click stands out (Vaseghi & Rayner 1990), over the original's, in dB.
- **level at the edges**: the output's power over the 10 ms of fill beside each edge, against the original's there, pooled over the edges; below 0, the fill comes in short.

**Speech** (audio-lena, 16 gaps per length), 0.3.0 → 0.4.0:

| tier | good audio rewritten per gap | its SNR | new onsets | clicks | level at the edges | gap SNR / LSD |
|---|---:|---:|---:|---:|---:|---:|
| ar (≤ 100 ms) | 0 | – | 15% / 4% | −0.3 dB | −1.2 dB | 1.7 / 5.36 |
| sinusoidal | 30 → 10 ms | 5.4 → 4.6 dB | 3% → 3% / 3% | −1.3 → −0.5 dB | −1.2 → −0.5 dB | −1.8 / 5.63 → −1.9 / 5.51 |
| similarity | 93 → 93 ms | 4.1 → 4.4 dB | 4% → 5% / 3% | 1.3 → 0.4 dB | −0.1 → −0.0 dB | −2.6 / 5.43 → −2.9 / 5.44 |
| spectral | 60 → 60 ms | 6.1 → 5.1 dB | 1% → 3% / 3% | −6.0 → −1.7 dB | −4.2 → −2.1 dB | −0.3 / 5.88 → −0.8 / 5.57 |
| auto | 31 → 36 ms | 5.5 → 5.0 dB | 8% → 6% / 3% | −0.5 → −0.3 dB | −0.9 → −0.4 dB | −0.4 / 5.41 → −1.1 / 5.28 |

**Music** ("Vibe Ace", "Dance of the Sugar Plum Fairy", Hungarian Dance No. 5, the trumpet loop; 6 gaps each per length), 0.3.0 → 0.4.0:

| tier | good audio rewritten per gap | its SNR | new onsets | clicks | level at the edges | gap SNR / LSD |
|---|---:|---:|---:|---:|---:|---:|
| ar (≤ 100 ms) | 0 | – | 16% / 2% | −0.2 dB | −1.3 dB | 7.5 / 4.44 |
| sinusoidal | 30 → 10 ms | 6.2 → 4.0 dB | 2% → 3% / 4% | −0.6 → −0.1 dB | −0.8 → +0.7 dB | 0.3 / 5.28 → 0.1 / 5.09 |
| similarity | 78 → 78 ms | 4.8 → 4.9 dB | 8% → 5% / 4% | −0.7 → −0.6 dB | −0.7 → −0.2 dB | 1.6 / 6.03 → 1.7 / 5.75 |
| spectral | 60 → 60 ms | 9.0 → 8.3 dB | 2% → 1% / 4% | −3.6 → −0.9 dB | −2.5 → −1.1 dB | 1.5 / 5.40 → 1.4 / 5.12 |
| auto | 24 → 24 ms | 7.1 → 7.0 dB | 6% → 5% / 4% | −0.3 → −0.1 dB | −0.8 → −0.3 dB | 4.8 / 4.65 → 4.0 / 4.58 |

Joined with no crossfade, the bridge, the transplant and spectral all click: the residual burst stands 7–15 dB over the original's. A 2 ms crossfade ends the click. The onsets that remain came, in 0.3, mostly from the fill sounding different from the program at the edge: the bridge's partials measured at frame centres 23 ms from it, a transplant from a quieter or darker passage, spectral frames 1.5–4.5 dB short. A crossfade only spreads that change over good audio. Matched first, each tier gets the shortest crossfade at which its onsets fall to the original's own rate, on VoiceBank+DEMAND training speech, spoken narrations, audio-lena and the four recordings:

- **The bridge: 5 ms** (15 ms in 0.3). At 5 ms its onsets are 3% of edges in audio-lena (the original's: 2%), 2% in the VoiceBank speech and narrations (3%) and 3% in music (8%); unmatched they were 9%, 3% and 6%. At 2 ms, audio-lena shows 9%.
- **Spectral: 30 ms.** Matched at the edges, its fill still comes in 1–2 dB short just inside them (the match measures where the frames still overlap the program), and at 15 ms 6% of edges in audio-lena show onsets against the original's 2%.
- **A transplant: 5 ms if it repeats the program** (aligned correlation 0.9 or more: no more onsets than the original's). A looser one still shows at 15 ms, matched (18% of edges in music against the original's 9%), so it keeps the frame.
- **AR: none.** Its least-squares fill is continuous with its context, but it decays inside the gap, and the program returning after it is an onset (15–16% of edges). That, with its LSD, is why `'auto'` hands gaps past 30 ms to the bridge or a transplant.

`'auto'` rewrites more good audio on audio-lena than 0.3 (36 ms per gap, was 31) because it now takes the transplant at 50 ms too (0.3 kept AR there), with a frame-long join.

On VoiceBank+DEMAND test speech (24 utterances, held out; gaps of 20, 50, 100, 300 ms and 1 s, one per utterance), 0.3.0 → 0.4.0: `'auto'` 8.18 → 7.80 dB LSD and −1.4 → −2.0 dB SNR, rewriting 16 ms of good audio per gap instead of 22, new onsets at 2.5% of edges (was 2.9%; the original's 2.9%); the bridge 8.53 → 7.78 dB LSD and −2.6 → −2.0 dB SNR, rewriting 10 ms instead of 30, onsets 2.1% (was 0.4%); spectral 8.89 → 8.06 and −1.0 → −1.2; the transplant, forced, 10.88 → 9.91 and −2.3 → −3.1.

Where the short join costs: the synthetic tones above show it in LSD, where nothing between their partials hides the switch. The bridge on 5 ms gaps: the chord 1.95 dB, was 1.16; the vibrato 3.36, was 2.07. The shorter crossfade does it: the match alone moves either by 0.12 dB at most. A transplant's 5 ms join did the same in 0.3 (the vibrato: 0.41 dB against 0.03 at 46 ms). On the recordings the shorter join is the better one: the bridge's LSD on the tuning speech is 7.66 dB at 5 ms against 7.89 at 15.

### Tried, and not kept

Measured on the same tuning material, against what ships:

- **Phase by Griffin–Lim for the spectral tier** (fast GLA, Perraudin, Balazs & Søndergaard 2013, the known samples imposed every pass, as in TF-domain inpainting). On 20 ms gaps the fill came out 2.8 dB short instead of 5.1, but the frames that straddle an edge cannot reach their interpolated magnitude with most of their samples fixed, and the fill clicked where the gap begins: residual bursts 4.5 dB over the original's, new onsets at 33% of edges in audio-lena.
- **Each band's power interpolated linearly across the gap** (the log-magnitude interpolation scaled to it). The spectral fill holds its level mid-gap, but at 100 ms its LSD rose 0.1–0.4 dB and its SNR fell 0.6–1.4 dB: where the two sides differ, the geometric mean's dip is the safer guess.
- **AR by sampling** (Godsill & Rayner 1998 §5.2.3: a draw from the posterior of the gap, not its mean, so the fill keeps the context's power). SNR fell 3–5 dB and LSD rose 1–2 dB at 5–50 ms, with no fewer onsets.
- **Each edge of a transplant aligned on its own** (Perraudin et al. §V-B, which lets the replacement differ in length from the gap; a fixed timeline cannot). On the tuning music it brought no more transplants to correlation 0.9 at both edges than the joint alignment: 12 of 72 gaps either way.
- **Deep inpainting** (Marafioti et al. 2019, a context encoder for 64 ms gaps; Marafioti et al. 2021, GACELA, 375 ms to 1.5 s; Moliner & Välimäki 2024, diffusion, up to 300 ms). Each is trained for one domain and needs a GPU-scale model; Moliner & Välimäki report parity with the baselines they compare at 50 ms and a lead up to 300 ms. None ships here: no model covers speech and music at this cost.

iZotope RX's Spectral Repair runs only inside the RX editor, not as a plugin, and no RX was installed where this was measured; it has not been compared.

## Cost

CPU time per region at 44.1 kHz (Node 25, Apple M4 Max):

- **`ar`**: O(n·p) for the fit and O(m²) for the exact solve (m samples lost, Levinson). 0.11 s for 50 ms, 3.5 s for 1 s. `'auto'` never sends a gap past 30 ms to AR.
- **`sinusoidal`**: a tracker pass over 2N of context on each side, least squares per partial, O(partials · m) synthesis. About 0.17 s.
- **`similarity`**: two grids of 2·window/hop feature frames, 3.4k FFTs at the default 10 s. About 0.14 s. `'auto'` runs this search for every region.
- **`spectral`**: one STFT over the region and 3N of context. 0.03 s.
- **the edge match** (every tier but AR): eight N/4-point FFTs at the edges and one STFT over the region and 4N of context. 2 ms for 50 ms, 11 ms for 1 s.

**Use when:** dropouts and packet loss, edit gaps, a lost second of a take that repeats, a cough, chair squeak or phone ring over the program (with `from`/`to`).<br>
**Not for:** clicks you have not located (use `declick`, which finds them); noise under the program (use `wiener`/`omlsa`); gaps in speech longer than about 100 ms. No tier invents words: a transplant copies other speech, and the bridge holds the voice's last sound.

References: A. J. E. M. Janssen, R. N. J. Veldhuis, L. B. Vries, *Adaptive interpolation of discrete-time signals that can be modeled as autoregressive processes*, IEEE TASSP 34(2), 1986 · S. J. Godsill, P. J. W. Rayner, *Digital Audio Restoration*, Springer 1998, §5 · O. Mokrý, P. Rajmic, *Tweaking autoregressive methods for inpainting of gaps in audio signals*, EUSIPCO 2025 ([arXiv:2403.04433](https://arxiv.org/abs/2403.04433)) · R. J. McAulay, T. F. Quatieri, *Speech analysis/synthesis based on a sinusoidal representation*, IEEE TASSP 34(4), 1986 · X. Serra, J. Smith, *Spectral modeling synthesis*, Computer Music Journal 14(4), 1990 · Y. Stylianou, *Applying the harmonic plus noise model in concatenative speech synthesis*, IEEE TSAP 9(1), 2001 · N. Perraudin, N. Holighaus, P. Majdak, P. Balazs, *Inpainting of long audio segments with similarity graphs*, IEEE/ACM TASLP 26(6), 2018 ([arXiv:1607.06667](https://arxiv.org/abs/1607.06667)) · A. Adler et al., *Audio inpainting*, IEEE TASLP 20(3), 2012 · M. Fink, M. Holters, U. Zölzer, *Signal-matched power-complementary cross-fading and dry-wet mixing*, DAFx 2016 · S. V. Vaseghi, P. J. W. Rayner, *Detection and suppression of impulsive noise in speech communication systems*, IEE Proc. I 137(1), 1990 · S. Böck, G. Widmer, *Maximum filter vibrato suppression for onset detection*, DAFx 2013 · N. Perraudin, P. Balazs, P. L. Søndergaard, *A fast Griffin–Lim algorithm*, IEEE WASPAA 2013 · A. Marafioti, N. Perraudin, N. Holighaus, P. Majdak, *A context encoder for audio inpainting*, IEEE/ACM TASLP 27(12), 2019 · A. Marafioti, P. Majdak, N. Holighaus, N. Perraudin, *GACELA: a generative adversarial context encoder for long audio inpainting of music*, IEEE JSTSP 15(1), 2021 · E. Moliner, V. Välimäki, *Diffusion-based audio inpainting*, JAES 72(3), 2024 ([arXiv:2305.15266](https://arxiv.org/abs/2305.15266)).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise), the denoise family umbrella.

MIT © [audiojs](https://github.com/audiojs)
