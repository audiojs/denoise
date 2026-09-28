# @audio/denoise [![npm](https://img.shields.io/npm/v/@audio/denoise)](https://www.npmjs.com/package/@audio/denoise) [![license](https://img.shields.io/badge/license-MIT-green.svg)](https://spdx.org/licenses/MIT.html)

Try it in the browser: [Noise remover](https://audiojs.dev/util/denoise/). Runs on this package, nothing is uploaded.

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
| [desilence](#desilence) | time | pauses | ★★★ | low | remove / shorten / trim silence, split by pause |
| [dereverb](#dereverb) | freq | late reverb | ★★★ | high | speech in a room |
| [dewow](#dewow) | time + freq | pitch drift | ★★★ | medium | tape / vinyl / cassette wow & flutter |

For broader DSP needs use [stretch](https://github.com/audiojs/stretch), [shift](https://github.com/audiojs/shift), [pitch](https://github.com/audiojs/pitch), [beat](https://github.com/audiojs/beat).


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
5. non-stationary noise (CV of the rolling-minimum frame-energy floor > 0.3) → omlsa
6. otherwise → wiener


## Tonal & narrowband

### `dehum`

Measures the hum, then notches it: biquad notches at the harmonics of the mains frequency that stand out, at the frequency measured. Without hum the audio comes back untouched. Notches cost speech wherever there is no hum to remove: a voice's harmonics sweep through them and each notch rings on what it takes out (the old default, four notches at 50–200 Hz, took clean VoiceBank speech from PESQ 4.64 to 3.2).

```js
dehum(data, { fs })                                            // 50 or 60 Hz, measured; nothing without hum
dehum(data, { fs, freq: 60 })                                  // the 60 Hz series, its exact frequency measured
dehum(data, { fs, freq: 60, harmonics: 4 })                    // notch 60–240 Hz whatever is there
measure(data, fs)                                              // → { f0, harmonics } or null (import from @audio/denoise-dehum)
```

| Param | Default | |
|---|---|---|
| `freq` | measured | Fundamental, Hz. Omitted: the 50 or 60 Hz series, whichever stands out. Given: its exact frequency within ±0.4 % (±`drift` Hz with `adaptive`) |
| `harmonics` | those present | Notch h = 1…`harmonics`, present or not. Omitted: the harmonics up to 1 kHz that stand out |
| `Q` | `30` | Notch sharpness — higher = narrower |

The measurement is one Fourier transform over the signal (its first 80–90 s, taken down to 3 kHz), where a hum line, steady for minutes, gathers into a peak 1/T wide while speech spreads. Each line is judged by its peak over the median power of the ±8 Hz around it: hum is there when the fundamental stands out by 20 dB or two of the first six harmonics by 15 dB (searched within ±0.4 %, the mains tolerance); the fundamental is the least-squares fit f0 = Σh·p<sub>h</sub>/Σh² to the interpolated peaks, and each harmonic up to 1 kHz found within ±0.05 % of h·f0 at 13 dB is notched. It needs a second of signal: in blocks, pass the same `params` object and give the first call a second or more. As an `audio` op it is whole-clip (`streaming: false`).

**Use when:** mains buzz, ground-loop hum, fixed tonal interference.<br>
**Not for:** broadband noise (use `wiener`/`omlsa`); shifting tones (use spectral methods).


### `dewind`

Adaptive high-pass. Cutoff slides between `cutoffMin` and `cutoffMax` based on the LF/MF energy ratio.

```js
dewind(data, { cutoffMin: 60, cutoffMax: 250 })
```

| Param | Default | |
|---|---|---|
| `cutoffMin` | `60` | Hz — minimum cutoff (LF mostly clean) |
| `cutoffMax` | `250` | Hz — maximum cutoff (heavy rumble) |
| `order` | `2` | HP sections (each 12 dB/oct) |
| `Q` | `0.707` | Butterworth-ish |
| `blockSize` | `1024` | Coefficient update interval (samples) |

**Use when:** intermittent wind buffeting, handling thumps, low-frequency room modes — the adaptive cutoff opens on gusts and closes between them (measured: beats `wiener` on gusty wind at ~1/10 the CPU).<br>
**Not for:** continuous rumble under speech — a time-domain cutoff can't separate overlapping spectra; use `wiener`/`omlsa` there (measured ~9 dB vs ~1 dB SNR gain). An LPC-null post-filter was evaluated and rejected: voiced speech is as AR-predictable as wind, so nulling wind poles whitens vowels too (LSD improves, SNR and speech level degrade).


### `deplosive`

Splits the signal into an LF band (`< crossover`) and its exact complement; ducks the LF band when its energy spikes above `triggerRatio`× the high band (a plosive signature). With no plosive present the output equals the input sample-for-sample — no crossover coloration.

```js
deplosive(data, { triggerRatio: 4, attack: 0.005, release: 0.08 })
```

| Param | Default | |
|---|---|---|
| `triggerRatio` | `4` | LF/high energy ratio that opens the duck |
| `attenuation` | `-18` | dB cut on the LF band when triggered |
| `crossover` | `200` | Hz — LF/high split point |
| `attack` | `0.005` | s |
| `release` | `0.08` | s |

**Use when:** mic plosives (`p`, `b`, `t`) producing low-frequency thuds.


### `deesser`

Dynamic peaking EQ centred on the sibilance band. Detection runs on a HP side-chain; when the envelope exceeds threshold, a negative-gain peaking EQ at `fc` engages on the audio path. Re-computed every `block` samples for smooth gain riding. Backed by [`@audio/dynamics-deesser`](https://github.com/audiojs/dynamics) `mode: 'band'` since the 2026-07 near-dupe merge — same seconds-based options here.

```js
deesser(data, { fc: 6500, threshold: -28, ratio: 4 })
```

| Param | Default | |
|---|---|---|
| `fc` | `6000` | Sibilance centre (Hz; `freq` still accepted) |
| `threshold` | `-30` | dBFS — engagement level |
| `ratio` | `4` | Compression ratio above threshold |
| `attack` | `0.001` | s — how fast the cut engages |
| `release` | `0.05` | s — how slowly it recovers |
| `Q` | `1.4` | Peaking EQ Q |
| `block` | `64` | Coefficient update interval (samples) |

**Use when:** voice post-production with hot s/sh; vocal bus de-essing.


## Broadband & spectral

### `specsub`

Power spectral subtraction with over-subtraction and a spectral floor (Berouti, Schwartz & Makhoul 1979): |Ŝ|² = |Y|² − α·N̂ where that stays above β·N̂, else β·N̂. Over-subtraction takes out the noise's peaks that plain subtraction leaves as musical tones; the floor, a fraction of the noise estimate, fills the valleys with a steady bed that masks what is left. α follows the frame's SNR (4 − 3/20·SNR: 4.75 at −5 dB down to 1 at 20 dB) unless fixed. The noise PSD is tracked by minimum statistics (Martin 2001) over a 1.5 s window, in batch and stream alike, unless a profile or a noise-only stretch is given.

```js
specsub(data, { fs })                                          // α(SNR), β 0.05, noise tracked
specsub(data, { fs, alpha: 2 })                                // fixed over-subtraction
specsub(data, { fs, noiseFrames: 6 })                          // noise from the first 6 frames
```

| Param | Default | |
|---|---|---|
| `alpha` | α(SNR) | Fixed over-subtraction factor; omitted (or 0): Berouti's α(SNR) |
| `beta` | `0.05` | Spectral floor, a fraction of the noise estimate: higher leaves less musical noise and more noise |
| `frameSize` | power of two nearest 32 ms | STFT frame: 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48 (`frame(fs)`) |
| `hopSize` | `frameSize/4` | OLA hop |
| `profile` | tracked | Noise PSD (`Float64Array`, `frameSize/2+1` bins) |
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to average for the profile |

**Use when:** quick baseline; offline cleanup with a known noise-only preamble.<br>
**Not for:** musical-noise-sensitive material — use `wiener` or `omlsa`.


### `wiener`

MMSE log-spectral amplitude (Ephraim & Malah 1985) or Wiener (Scalart & Filho 1996) gain on the decision-directed a priori SNR ξ = α·Â²(l−1)/λ(l−1) + (1−α)·max(γ−1, 0) (Ephraim & Malah 1984, eq. 51). The noise PSD λ is tracked by minimum statistics (Martin 2001) over a 1.5 s window, in batch and stream alike, unless a profile or a noise-only stretch is given.

```js
wiener(data, { fs })                                           // LSA gain, noise tracked
wiener(data, { fs, rule: 'wiener' })                           // Wiener gain
wiener(data, { fs, noiseFrames: 6 })                           // noise from the first 6 frames
```

| Param | Default | |
|---|---|---|
| `rule` | `'mmse-lsa'` | `'wiener'` or `'mmse-lsa'` (log-spectral, less musical noise) |
| `alpha` | `0.98` | Decision-directed smoothing (alias of `alphaDD`) |
| `xiMin` | `10^−1.5` | A priori SNR floor (−15 dB) |
| `frameSize` | power of two nearest 32 ms | STFT frame: 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48 (`frame(fs)`) |
| `hopSize` | `frameSize/4` | OLA hop |
| `profile` | tracked | Noise PSD (`Float64Array`, `frameSize/2+1` bins) |
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to average for the profile |

**Use when:** transparent broadband denoise; the "safe default" for stationary noise.


### `omlsa`

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


## Impulses

### `declick`

Detects impulses as AR-residual outliers (`> threshold·σ`); replaces each click region with an AR-LS interpolation (Janssen 1986 / Godsill-Rayner 1998).

```js
declick(data, { threshold: 4, order: 60 })
```

| Param | Default | |
|---|---|---|
| `threshold` | `4` | σ-multiple for click detection |
| `order` | `60` | AR model order |
| `guard` | `2` | Extra samples on each side of the detected click |
| `maxBurst` | `64` | Longest run repaired (longer → left as a real transient) |

**Use when:** vinyl pops, edit clicks, occasional impulse noise.<br>
**Not for:** dense crackle (use `decrackle`); long dropouts (use `arInterpolate` directly).


### `decrackle`

Continuous AR-residual outlier detection with MAD-based threshold. Suited to high-rate impulse noise.

```js
decrackle(data, { threshold: 3 })
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

Late reverberation off speech by weighted prediction error, WPE (Nakatani et al. 2010), in its recursive form (Yoshioka & Nakatani 2012). In each STFT bin, what the frames 30 to 130 ms back predict of the current one is the room's tail, and is subtracted. The prediction is fitted with each frame weighted by its inverse power, so it takes what the room adds, not the speech's own correlation. A linear filter per bin: no decay time to estimate, no gain floor, no musical noise. It adapts within about a second; each frame leaves through the filter a quarter second later has learned (`lookahead`), so a take's first words are cleaned too.

```js
dereverb(data, { fs: 48000 })
```

| Param | Default | |
|---|---|---|
| `lookahead` | `0.25` | s the filter learns past each frame before it leaves; the latency grows by it (0: the frame's alone, 32 to 46 ms) |

**Use when:** speech in a room, one microphone.<br>
**Not for:** music or anything holding a steady pitch: a steady tone is predictable, and taken (a held note with vibrato loses 13 dB). Noise: denoise first.


## Pitch drift

### `dewow`

Wow & flutter correction. Estimates the transport speed curve — from stable spectral partials tracked with a phase vocoder (McAulay–Quatieri linking, amplitude-weighted median across tracks), from a known reference tone (mains hum, calibration tone, tape bias residual), or from monophonic pitch — then reads the signal back through a variable-rate windowed-sinc resampler along the integrated curve. Whole-signal (needs the full curve), length-preserving by default. The classical counterpart of Celemony Capstan; `wowFlutter()` alone is a wow & flutter meter.

```js
dewow(data, { fs })                                            // partial tracking (default)
dewow(data, { fs, mode: 'reference', refFreq: 50 })            // lock to 50 Hz hum
dewow(data, { fs, wow: true, flutter: false })                 // remove slow drift only
wowFlutter(data, { fs })                                       // → { speed, times, wow, flutter, confidence }
```

| Param | Default | |
|---|---|---|
| `mode` | `'partial'` | `'partial' \| 'reference' \| 'pitch'` |
| `refFreq` | — | Hz — the known tone for `reference` mode |
| `smooth` | `0.05` | s — flutter-band smoothing of the speed curve |
| `wow` / `flutter` | `true` / `true` | correct the < 6 Hz / 6–43 Hz bands |
| `maxDeviation` | `0.05` | clamp on the speed ratio (±5 %) |
| `keepLength` | `true` | output length equals input |

Measured on synthetic 2 % wow @ 0.8 Hz + 0.4 % flutter @ 30 Hz over a sustained chord: curve correlation 0.98, residual deviation of the 440 Hz partial 1.4 % → 0.18 %; clean input passes at 44 dB SNR.

**Use when:** tape, cassette, vinyl and film transfers with audible pitch wobble; material with sustained tones or a reference tone.<br>
**Not for:** dropouts, azimuth/time-skew, material with no stable partials (percussion-only); flutter above `fs/(2·hopSize)` ≈ 43 Hz at defaults needs a smaller `hopSize`.


## Gates & inter-word

### `gate`

Look-ahead noise gate with hysteresis. Backed by [`@audio/dynamics-gate`](https://github.com/audiojs/dynamics) since the 2026-07 near-dupe merge — same seconds-based options here; `closeThreshold` (default `threshold − 6` dB) sets the hysteresis close level.

```js
gate(data, { threshold: -45, attack: 0.005, release: 0.1, hold: 0.05, lookahead: 0.005 })
```

**Use when:** silence enforcement; aggressive cut between phrases.<br>
**Not for:** continuous denoise — use `wiener`/`omlsa`.


### `debreath`

VAD-driven inverse gate. Uses energy + spectral flatness with a percentile-based noise floor; attenuates frames classified as non-speech with smooth attack/release.

```js
debreath(data, { range: -10 })                                // -10 dB on non-speech (default -12)
```

**Use when:** breath, mouth noise, hiss in pauses on a voiceover.


### `desilence`

VAD-driven silence editing. Runs `vad` once, folds frames into speech/pause segments, then cuts pauses per `mode` with equal-power crossfades at every splice — never a hard cut. Length-changing, so it is a batch call (and a `silence` stat atom), not a streaming processor.

```js
desilence(data, { mode: 'shorten', maxSilence: 0.25 })          // Overcast "Smart Speed": long pauses → 0.25 s
desilence(data, { mode: 'remove', minSilence: 0.5, pad: 0.1 })  // cut pauses > 0.5 s, keep 0.1 s around speech
desilence(data, { mode: 'trim' })                                // leading/trailing silence only
silenceSegments(data, { fs })                                    // → { speech: [{start, end}], silence: [...] }
splitSilence(data, { fs })                                       // → one Float32Array per phrase
```

| Param | Default | |
|---|---|---|
| `mode` | `'shorten'` | `'shorten' \| 'remove' \| 'trim'` |
| `minSilence` | `0.5` | s — pauses shorter than this are never touched |
| `maxSilence` | `0.25` | s — `shorten` target length of any remaining pause (cut from the middle, onsets kept) |
| `pad` | `0.1` | s — silence kept on each side of speech in `remove` mode |
| `merge` | `0.15` | s — speech gaps shorter than this join one segment |
| `fade` | `0.01` | s — crossfade at every cut |

Returns `{ data, segments, removed, map }`; `project(map, t)` re-times markers/subtitles (`@audio/subtitle` `project()` takes the same map).

**Use when:** podcast/lecture pause tightening, split-by-silence, auto-trim.<br>
**Not for:** music (a rest is a pause to this VAD); overlapping speech.


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
| 60 Hz hum + harmonics | -5.2 dB | `dehum` | 15.3 dB | 6.3 dB | 5 |
| white noise (~13 dB SNR) | 13.3 dB | `wiener` | 20.5 dB | 0.3 dB | 82 |
| clicks (vinyl-style) | 24.1 dB | `declick` | 44.1 dB | — | 462 |
| 7 kHz sibilance | 2.0 dB | `deesser` | 9.2 dB | 1.9 dB | 5 |

Higher = better.

### Speech

`node scripts/speech.mjs SET SYSTEMS` runs each op through its `audio.js` manifest, as `audio` does, and `python scripts/speech.py score SET SYSTEMS` scores the outputs as `@audio/neural-denoise`'s accuracy.py does: at 16 kHz, PESQ (P.862.2), STOI, SI-SDR, DNSMOS P.835 (SIG speech, BAK background, OVRL overall). Musical noise is the log kurtosis ratio of the power spectral values, output over input (Uemura et al. 2008): 0 when the noise is only scaled, higher when isolated peaks survive. Defaults were chosen on 168 utterances of a VoiceBank+DEMAND training subset that shares no speaker or noise with the test set (`python scripts/speech.py fetch`); the test set was scored once. Before: 0.3.11.

VoiceBank+DEMAND test set (Valentini-Botinhao 2017, CC BY 4.0), 824 utterances; noisy input PESQ 1.97, STOI 0.921, SI-SDR 8.45 dB, OVRL 2.68:

| op, before → after | PESQ | STOI | SI-SDR dB | SIG | BAK | OVRL |
|---|---|---|---|---|---|---|
| `omlsa` | 1.88 → **2.40** | 0.870 → 0.916 | 5.4 → **14.5** | 3.07 → 3.38 | 3.15 → **3.49** | 2.51 → **2.86** |
| `wiener` | 2.19 → 2.34 | 0.916 → 0.910 | 11.9 → 14.0 | 3.34 → 3.38 | 3.26 → 3.38 | 2.73 → 2.81 |
| `specsub` | 2.11 → 2.24 | 0.921 → 0.920 | 10.4 → 12.5 | 3.29 → 3.35 | 3.12 → 3.32 | 2.66 → 2.77 |
| `dehum` (no hum here) | 1.78 → 1.97 | 0.907 → 0.921 | 6.5 → 8.4 | 3.29 → 3.32 | 3.08 → 3.11 | 2.65 → 2.68 |

The same clean utterances in: PESQ 3.06 → 4.27 (`omlsa`), 3.97 → 4.03 (`wiener`), 4.30 → 4.05 (`specsub`, which now subtracts an unbiased noise estimate), 3.20 → 4.64 (`dehum`: no hum found, output equals input). Stationary white and pink noise alone, 8 s: `omlsa` takes it 15 dB down with log kurtosis ratio 0.00 (was +0.53 and +0.30), `wiener` 16 dB at +0.33 and +0.79 (was 10 dB at +0.93 and +1.35), `specsub` 12 dB at +0.65 and +1.36 (was 4 dB at +0.48 and +0.58). With mains hum 20 dB under the clean utterances (12 harmonics at −6 dB per octave, 0.05 Hz off nominal), `dehum` takes PESQ from 2.64 to 2.88 at 50 Hz and from 2.48 to 2.76 at 60 Hz (before: 2.54 and 2.19); alone, that hum goes 44.6 and 50.0 dB down (before: 10.3 dB at 50 Hz, nothing at 60).

Ten Spoken Wikipedia narrations, 60 s each (volunteers at home; raw OVRL 3.17): `omlsa` SIG 3.25 → 3.46 (raw 3.45), BAK 4.00 → 4.09, OVRL 2.96 → 3.19, speech level −1.1 → −0.04 dB, noise floor median −76 → −75 dBFS. Room tone stays: G<sub>min</sub> is 15 dB, so only a room already under −75 dBFS ends under −90 (one of the nine, raw −83).

Frames follow the rate: the power of two nearest 32 ms, the papers' frame, where they were 2048 samples at every rate (128 ms at 16 kHz). The same test set resampled (`python scripts/speech.py resample vbdemand RATE`, then `vbdemand@RATE`), PESQ and OVRL, 2048 → rate's frame; 48 kHz keeps 2048:

| op | 16 kHz (512) | 22.05 kHz (512) | 44.1 kHz (1024) |
|---|---|---|---|
| `omlsa` | 2.25 → 2.42, 2.80 → 2.87 | 2.29 → 2.42, 2.81 → 2.86 | 2.39 → 2.42, 2.86 → 2.86 |
| `wiener` | 2.20 → 2.36, 2.75 → 2.82 | 2.24 → 2.37, 2.76 → 2.82 | 2.33 → 2.37, 2.81 → 2.82 |
| `specsub` | 2.16 → 2.25, 2.77 → 2.75 | 2.20 → 2.23, 2.78 → 2.74 | 2.24 → 2.23, 2.77 → 2.74 |

STOI holds or rises for `wiener` and `specsub` and falls 0.001–0.002 for `omlsa`; SI-SDR falls 0.3–0.7 dB for `omlsa` and `wiener` at 22.05 and 44.1 kHz, and 0.8–1.2 dB for `specsub`, which alone prefers the longer frame there (so it did on the training subset).

Reverberant speech (`vbreverb`): a quarter of the clean test utterances, 206, through 130 rooms of the MIT IR Survey (Traer & McDermott 2016; T60 from each response's decay, 500 Hz and 1 kHz: median 0.40 s, 55 utterances at 0.6 s or more), scored against the dry takes, DNSMOS at the input's loudness. `dereverb` before (0.1.10: late-reverb subtraction at an assumed T60 of 0.5 s) → now:

| | PESQ | STOI | SI-SDR dB | SIG | BAK | OVRL |
|---|---|---|---|---|---|---|
| reverberant input | 2.33 | 0.904 | −5.7 | 3.19 | 3.71 | 2.82 |
| `dereverb` | 1.55 → **2.52** | 0.758 → **0.914** | −7.7 → **−5.2** | 2.27 → **3.22** | 3.85 → 3.73 | 2.08 → **2.85** |
| T60 ≥ 0.6 s (55), input | 1.65 | 0.838 | −10.7 | 2.81 | 3.28 | 2.38 |
| T60 ≥ 0.6 s, `dereverb` | 1.48 → **1.76** | 0.724 → **0.855** | −10.5 → **−10.0** | 2.25 → **2.88** | 3.76 → 3.37 | 2.03 → **2.45** |
| dry takes in (`vbreverb-dry`) | 4.64 | 1.000 | ∞ | 3.51 | 4.04 | 3.22 |
| dry, `dereverb` | 1.60 → 4.37 | 0.812 → 0.999 | 2.6 → 27.5 | 2.46 → 3.50 | 3.92 → 4.03 | 2.27 → 3.21 |

The old estimate summed every past frame's power though each already holds its own tail (about 6 dB over, then ×1.5), at a fixed T60, with a −26 dB floor: it took the direct sound itself. The prediction's length, delay, memory and look-ahead were chosen on the training utterances in the even-numbered rooms (`vbreverb-train`, 126: PESQ 2.36 → 2.56); longer prediction (160 ms) gained 0.04 PESQ there and cost 0.09 on dry takes. Late-reverb subtraction (Lebart et al. 2001) at each room's measured T60, the best a blind T60 estimator could do, scored below WPE there (PESQ 2.38–2.51, STOI down), and after it lowered WPE's scores: no T60 is estimated.


## Demo

`demo.html` is a self-contained browser demo: pick a noise scenario, pick a method (or `auto`), inspect input/output waveforms, hear the difference, and read the live classifier scores.


## References

- Boll, *Suppression of Acoustic Noise in Speech Using Spectral Subtraction*, IEEE TASSP 1979.
- Berouti, Schwartz, Makhoul, *Enhancement of Speech Corrupted by Acoustic Noise*, ICASSP 1979.
- Ephraim & Malah, *Speech Enhancement Using a Minimum Mean-Square Error Short-Time Spectral Amplitude Estimator*, IEEE TASSP 1984.
- Ephraim & Malah, *Speech Enhancement Using a Minimum Mean-Square Error Log-Spectral Amplitude Estimator*, IEEE TASSP 1985.
- Martin, *Noise Power Spectral Density Estimation Based on Optimal Smoothing and Minimum Statistics*, IEEE TSAP 2001.
- Martin, *Bias Compensation Methods for Minimum Statistics Noise Power Spectral Density Estimation*, Signal Processing 2006.
- Scalart & Vieira Filho, *Speech Enhancement Based on a Priori Signal to Noise Estimation*, ICASSP 1996.
- Cohen & Berdugo, *Speech Enhancement for Non-Stationary Noise Environments*, Signal Processing 2001.
- Cohen, *Optimal Speech Enhancement Under Signal Presence Uncertainty Using Log-Spectral Amplitude Estimator*, IEEE SPL 2002.
- Cohen, *Noise Spectrum Estimation in Adverse Environments: Improved Minima Controlled Recursive Averaging*, IEEE TSAP 2003.
- Cohen, `omlsa.m` (OM-LSA with IMCRA), [israelcohen.com/software](https://israelcohen.com/software/).
- Uemura, Takahashi, Saruwatari, Shikano & Kondo, *Automatic Optimization Scheme of Spectral Subtraction Based on Musical Noise Assessment via Higher-Order Statistics*, IWAENC 2008.
- Valentini-Botinhao, *Noisy Speech Database for Training Speech Enhancement Algorithms and TTS Models*, University of Edinburgh 2017, [doi:10.7488/ds/2117](https://doi.org/10.7488/ds/2117).
- Reddy, Gopal & Cutler, *DNSMOS P.835*, ICASSP 2022.
- Janssen, Veldhuis & Vries, *Adaptive Interpolation of Discrete-Time Signals That Can Be Modeled as Autoregressive Processes*, IEEE TASSP 1986.
- Godsill & Rayner, *Digital Audio Restoration*, Springer 1998.
- Lebart, Boucher & Denbigh, *A New Method Based on Spectral Subtraction for Speech Dereverberation*, Acta Acustica 2001.
- Nakatani, Yoshioka, Kinoshita, Miyoshi & Juang, *Speech Dereverberation Based on Variance-Normalized Delayed Linear Prediction*, IEEE TASLP 2010.
- Yoshioka & Nakatani, *Generalization of Multi-Channel Linear Prediction Methods for Blind MIMO Impulse Response Shortening*, IEEE TASLP 2012.
- Caroselli, Shafran, Narayanan & Rose, *Adaptive Multichannel Dereverberation for Automatic Speech Recognition*, Interspeech 2017.
- Traer & McDermott, *Statistics of Natural Reverberation Enable Perceptual Separation of Sound and Space*, PNAS 2016 (MIT IR Survey).
- RBJ Audio EQ Cookbook (biquad coefficients).


## License

MIT
