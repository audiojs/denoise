# @audio/denoise [![npm](https://img.shields.io/npm/v/@audio/denoise)](https://www.npmjs.com/package/@audio/denoise) [![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Single-pass noise reduction. 13 specialised methods + an auto-classifier.

| | Domain | Targets | Quality | CPU | Best for |
|---|---|---|---|---|---|
| [denoise](#denoise) | meta | auto | — | varies | "just clean it" |
| [gate](#gate) | time | silence | ★ | very low | hard cut at threshold |
| [dehum](#dehum) | time | mains hum | ★★★★ | very low | 50/60 Hz + harmonics |
| [specsub](#specsub) | freq | broadband stationary | ★★ | medium | baseline |
| [wiener](#wiener) | freq | broadband stationary | ★★★ | medium | general broadband |
| [omlsa](#omlsa) | freq | broadband non-stationary | ★★★★ | high | speech in changing noise |
| [declick](#declick) | time | impulses | ★★★★ | medium | vinyl pops, edit clicks |
| [decrackle](#decrackle) | time | dense impulses | ★★★ | medium | shellac crackle |
| [declip](#declip) | time | hard clipping | ★★★ | medium | restoration |
| [dewind](#dewind) | time | LF rumble | ★★★ | very low | wind, handling noise |
| [deplosive](#deplosive) | time | LF bursts | ★★★ | low | mic plosives (p, b) |
| [deesser](#deesser) | time | sibilance | ★★★★ | low | voice (s, sh) |
| [debreath](#debreath) | time | inter-word noise | ★★★ | low | breath / hiss in pauses |
| [dereverb](#dereverb) | freq | late reverb | ★★ | medium | moderate room reverb |

For broader DSP needs use [time-stretch](https://github.com/audiojs/time-stretch), [pitch-shift](https://github.com/audiojs/pitch-shift), [pitch-detection](https://github.com/audiojs/pitch-detection), [beat-detection](https://github.com/audiojs/beat-detection).


## Usage

```sh
npm install @audio/denoise
```

```js
import { denoise, dehum, wiener, declick } from '@audio/denoise'

let cleaned   = denoise(samples)                              // auto-classify + dispatch
let unhummed  = dehum(samples, { freq: 60 })                  // explicit method
let { out, plan } = denoise(samples, { returnPlan: true })    // see what was chosen
```

```js
// Streaming — pass options first, then call repeatedly with chunks.
let write = wiener({ fs: 48000 })
write(block1)
write(block2)
write()                                                        // → flush remaining samples
```

> Mono `Float32Array` in/out. State lives on the `params` object; pass the same one across calls and biquad memory / spectral history persists. For stereo, process channels independently.


## `denoise`

Content-aware auto-selector. Runs a single STFT classification sweep over the input and dispatches to the most suitable method.

```js
denoise(data)                                                  // → cleaned Float32Array
denoise(data, { returnPlan: true })                            // → { out, plan }
denoise(data, { force: 'wiener' })                             // skip classifier
```

| Param | Default | |
|---|---|---|
| `fs` | `44100` | Sample rate |
| `force` | — | One of `'dehum' \| 'declick' \| 'dewind' \| 'deesser' \| 'dereverb' \| 'omlsa' \| 'wiener'` |
| `returnPlan` | `false` | Return `{ out, plan }` with classifier scores + chosen method |

**Routing (in priority order):**
1. tonal hum (Goertzel — ≥2 of first 3 harmonics show 50× line/off-line ratio at 50 or 60 Hz)
2. impulses (excess kurtosis of AR residual > 12)
3. sibilance (high/mid band power ratio > 8)
4. LF rumble (low/mid band power ratio > 3)
5. non-stationary noise (frame-energy CV > 0.6) → omlsa
6. otherwise → wiener


## Tonal & narrowband

### `dehum`

Cascade of high-Q biquad notches at the fundamental + harmonics.

```js
dehum(data, { freq: 60, harmonics: 4 })
dehum(data, { freq: 50, adaptive: true, drift: 0.5 })          // tracks slow mains drift
```

| Param | Default | |
|---|---|---|
| `freq` | `50` | Fundamental (Hz) |
| `harmonics` | `4` | Number of notches placed |
| `Q` | `30` | Notch sharpness — higher = narrower |
| `adaptive` | `false` | Goertzel sweep refines `freq` ± `drift` Hz |

**Use when:** mains buzz, ground-loop hum, fixed tonal interference.<br>
**Not for:** broadband noise (use `wiener`/`omlsa`); shifting tones (use spectral methods).


### `dewind`

Adaptive high-pass. Cutoff slides between `cutoffMin` and `cutoffMax` based on the LF/MF energy ratio.

```js
dewind(data, { cutoffMin: 60, cutoffMax: 200 })
```

| Param | Default | |
|---|---|---|
| `cutoffMin` | `60` | Hz — minimum cutoff (LF mostly clean) |
| `cutoffMax` | `200` | Hz — maximum cutoff (heavy rumble) |
| `Q` | `0.707` | Butterworth-ish |
| `block` | `512` | Coefficient update interval (samples) |

**Use when:** wind buffeting, handheld-mic rumble, low-frequency room modes.


### `deplosive`

Splits the signal into LF (`<200 Hz`) and HF bands; ducks the LF band when it spikes relative to HF (a plosive signature).

```js
deplosive(data, { ratio: 0.2, attack: 0.005, release: 0.05 })
```

**Use when:** mic plosives (`p`, `b`, `t`) producing low-frequency thuds.


### `deesser`

Dynamic peaking EQ centred on the sibilance band. Detection runs on a HP side-chain; when the envelope exceeds threshold, a negative-gain peaking EQ at `freq` engages on the audio path. Re-computed every `block` samples for smooth gain riding.

```js
deesser(data, { freq: 6500, threshold: -28, ratio: 4 })
```

| Param | Default | |
|---|---|---|
| `freq` | `6000` | Sibilance centre (Hz) |
| `threshold` | `-30` | dBFS — engagement level |
| `ratio` | `4` | Compression ratio above threshold |
| `attack` | `0.001` | s |
| `release` | `0.05` | s |
| `Q` | `1.4` | Peaking EQ Q |

**Use when:** voice post-production with hot s/sh; vocal bus de-essing.


## Broadband & spectral

### `specsub`

Berouti spectral subtraction (1979). Estimates noise from the first `noiseFrames` and subtracts `α·N̂(k)` from each magnitude frame, with a `β·|Y(k)|` floor.

```js
specsub(data, { alpha: 2, beta: 0.01, noiseFrames: 6 })
```

**Use when:** quick baseline; offline cleanup with a known noise-only preamble.<br>
**Not for:** musical-noise-sensitive material — use `wiener` or `omlsa`.


### `wiener`

MMSE Wiener / log-MMSE (Ephraim-Malah 1984/1985) with decision-directed a-priori SNR.

```js
wiener(data, { rule: 'mmse-lsa', alpha: 0.98 })
wiener(data)                                                   // defaults: 'wiener' rule
```

| Param | Default | |
|---|---|---|
| `rule` | `'wiener'` | `'wiener'` or `'mmse-lsa'` (log-spectral, less musical noise) |
| `alpha` | `0.98` | Decision-directed smoothing |
| `frameSize` | `1024` | STFT frame |
| `hopSize` | `frameSize/4` | OLA hop |
| `noiseFrames` | `6` | Initial noise-only frames for PSD bootstrap |

**Use when:** transparent broadband denoise; the "safe default" for stationary noise.


### `omlsa`

Optimally-Modified Log-Spectral Amplitude estimator (Cohen 2002) driven by IMCRA noise tracking. Combines an LSA gain with a minimum-gain floor weighted by speech presence probability:
`G = G_LSA^p · G_min^(1-p)`.

```js
omlsa(data)
omlsa(data, { gMinDb: -25 })                                   // less aggressive floor
```

| Param | Default | |
|---|---|---|
| `gMinDb` | `-25` | dB floor for non-speech bins |
| `alpha` | `0.92` | Decision-directed smoothing |
| `frameSize` | `1024` | |
| `hopSize` | `frameSize/4` | |

**Use when:** speech in non-stationary noise (street, café, car); generally the highest-quality choice for noisy speech.


## Impulses

### `declick`

Detects impulses as AR-residual outliers (`> threshold·σ`); replaces each click region with an AR-LS interpolation (Janssen 1986 / Godsill-Rayner 1998).

```js
declick(data, { threshold: 4, order: 50 })
```

| Param | Default | |
|---|---|---|
| `threshold` | `4` | σ-multiple for click detection |
| `order` | `50` | AR model order |
| `pad` | `2` | Extra samples on each side of the detected click |
| `maxGap` | `order` | Maximum gap to interpolate (longer → skipped) |

**Use when:** vinyl pops, edit clicks, occasional impulse noise.<br>
**Not for:** dense crackle (use `decrackle`); long dropouts (use `arInterpolate` directly).


### `decrackle`

Continuous AR-residual outlier detection with MAD-based threshold. Suited to high-rate impulse noise.

```js
decrackle(data, { madThreshold: 4 })
```

**Use when:** shellac / 78 RPM crackle; persistent low-amplitude clicks.


### `declip`

Detects runs of samples at ±`clipLevel`, fits AR on the un-clipped neighbourhood, extrapolates a sign-constrained interpolation.

```js
declip(data, { clipLevel: 0.95 })                              // explicit threshold
declip(data)                                                   // auto-detects clip level
```

| Param | Default | |
|---|---|---|
| `clipLevel` | auto | Detected from histogram of \|x\| > 0.5 |
| `order` | `100` | AR model order |
| `maxRun` | `order/2` | Longest run that gets restored |

**Use when:** hard digital clipping with short clip runs.<br>
**Not for:** sustained clipping covering many cycles (use sparsity-based methods).


## Reverb

### `dereverb`

Late-reverb spectral subtraction (Lebart, Boucher & Denbigh 2001). Models the late tail as exponentially decaying noise:
`|R̂(k)|² ≈ exp(-2·δ·t·hop) · |Y_prev(k)|²` and subtracts à la Berouti.

```js
dereverb(data, { t60: 0.6, predelay: 0.04 })
```

| Param | Default | |
|---|---|---|
| `t60` | `0.5` | Assumed reverberation time (s) |
| `predelay` | `0.04` | Direct-sound passthrough (s) |
| `alpha` | `1.5` | Over-subtraction factor |
| `beta` | `0.05` | Spectral floor |

**Use when:** moderate room reverb (RT60 ≤ 1 s) on a single channel.<br>
**Not for:** heavy reverb or convolutive distortion — use multi-channel WPE (out of scope).


## Gates & inter-word

### `gate`

Look-ahead noise gate with hysteresis.

```js
gate(data, { threshold: -45, attack: 0.005, release: 0.1, hold: 0.05, lookahead: 0.005 })
```

**Use when:** silence enforcement; aggressive cut between phrases.<br>
**Not for:** continuous denoise — use `wiener`/`omlsa`.


### `debreath`

VAD-driven inverse gate. Uses energy + spectral flatness with a percentile-based noise floor; attenuates frames classified as non-speech with smooth attack/release.

```js
debreath(data, { reduction: 0.3 })                             // -10 dB on non-speech
```

**Use when:** breath, mouth noise, hiss in pauses on a voiceover.


## Quality measurement

```js
import { snr, segSnr, lsd, nrr, speechAttenuation } from '@audio/denoise'

snr(reference, processed)                                       // global SNR (dB)
segSnr(reference, processed)                                    // segmental SNR (dB)
lsd(reference, processed)                                       // log-spectral distance
nrr(noisyInput, processed)                                      // noise reduction ratio
speechAttenuation(reference, processed)                         // dB lost on speech segments
```

| Metric | Higher is better | What it captures |
|---|---|---|
| `snr` | ✓ | Energy ratio reference / error |
| `segSnr` | ✓ | Time-localised SNR — better correlates with perception |
| `lsd` | ✗ | Mean log-magnitude error per bin |
| `nrr` | ✓ | Floor reduction in non-speech regions |
| `speechAttenuation` | ✗ | Loss of speech energy (over-aggressive denoising) |


## Lower-level building blocks

```js
import { stftBatch, stftStream, stftAnalyse } from '@audio/denoise'
import { vad, spp, ddSnr } from '@audio/denoise'
import { noiseProfile, minStats, imcra } from '@audio/denoise'
```

- **`stft*`** — analysis-modification-synthesis with Hann + ∑win² OLA reconstruction. Visit `(mag, phase, state, ctx) => { mag, phase }`.
- **`vad`** — frame-level activity (energy + spectral flatness, percentile floor).
- **`spp`** — per-bin Speech Presence Probability under Gaussian model.
- **`ddSnr`** — decision-directed a-priori SNR (Ephraim-Malah).
- **`noiseProfile`** — average PSD over leading frames.
- **`minStats`** — Martin (2001) minimum-statistics noise PSD tracker.
- **`imcra`** — Cohen (2003) Improved Minima-Controlled Recursive Averaging — drives `omlsa`.


## Measurements

`npm run measure` produces a Markdown table of SNR / segSNR / LSD / NRR per method on canonical scenarios. Headline numbers on the included `audio-lena` fixture (8 s mono speech, 44.1 kHz):

| scenario | SNR-in | best method | SNR-out | NRR | ms |
|---|---:|---|---:|---:|---:|
| 60 Hz hum + harmonics | -5.2 dB | `dehum` | 15.0 dB | 6.3 dB | 5 |
| white noise (~13 dB SNR) | 13.2 dB | `wiener` | 19.8 dB | 0.3 dB | 82 |
| clicks (vinyl-style) | 24.1 dB | `declick` | 44.1 dB | — | 462 |
| 7 kHz sibilance | 2.0 dB | `deesser` | 9.5 dB | 1.9 dB | 5 |

Higher = better.


## Demo

`demo.html` is a self-contained browser demo: pick a noise scenario, pick a method (or `auto`), inspect input/output waveforms, hear the difference, and read the live classifier scores.


## References

- Boll, *Suppression of Acoustic Noise in Speech Using Spectral Subtraction*, IEEE TASSP 1979.
- Berouti, Schwartz, Makhoul, *Enhancement of Speech Corrupted by Acoustic Noise*, ICASSP 1979.
- Ephraim & Malah, *Speech Enhancement Using a Minimum Mean-Square Error Short-Time Spectral Amplitude Estimator*, IEEE TASSP 1984.
- Ephraim & Malah, *Speech Enhancement Using a Minimum Mean-Square Error Log-Spectral Amplitude Estimator*, IEEE TASSP 1985.
- Martin, *Noise Power Spectral Density Estimation Based on Optimal Smoothing and Minimum Statistics*, IEEE TSAP 2001.
- Cohen, *Optimal Speech Enhancement Under Signal Presence Uncertainty Using Log-Spectral Amplitude Estimator*, IEEE SPL 2002.
- Cohen, *Noise Spectrum Estimation in Adverse Environments: Improved Minima Controlled Recursive Averaging*, IEEE TSAP 2003.
- Janssen, Veldhuis & Vries, *Adaptive Interpolation of Discrete-Time Signals That Can Be Modeled as Autoregressive Processes*, IEEE TASSP 1986.
- Godsill & Rayner, *Digital Audio Restoration*, Springer 1998.
- Lebart, Boucher & Denbigh, *A New Method Based on Spectral Subtraction for Speech Dereverberation*, Acta Acustica 2001.
- RBJ Audio EQ Cookbook (biquad coefficients).


## License

MIT
