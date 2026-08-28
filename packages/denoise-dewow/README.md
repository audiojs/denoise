# @audio/denoise-dewow [![npm](https://img.shields.io/npm/v/@audio/denoise-dewow)](https://www.npmjs.com/package/@audio/denoise-dewow) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Wow & flutter correction — pitch-drift removal for tape/vinyl/cassette transfers

```
npm install @audio/denoise-dewow
```

```js
import dewow, { analyze } from '@audio/denoise-dewow'
```

Estimates the transport's instantaneous speed over time and corrects it by variable-rate resampling — the classical (non-ML) counterpart of Celemony Capstan. Three estimators: track the phase-vocoder instantaneous frequency of stable spectral partials (`'partial'`, default — McAulay & Quatieri 1986 partial tracking + Godsill & Rayner, *Digital Audio Restoration*, 1998, ch. 6), lock onto one known tone such as mains hum or a calibration tone (`'reference'` — Czyżewski et al., *Wow detection and compensation employing spectral processing of audio*, JAES 2007), or track monophonic pitch (`'pitch'` — `@audio/pitch-pyin`). See Howarth & Wolfe, *Correction of Wow and Flutter Effects in Analogue Tape Transfers*, AES 117th/118th Convention, 2004/2005, and Nichols, *The Digital Restoration of Wow and Flutter Distorted Gramophone Recordings*, 1999.

```js
let corrected = dewow(recording, { fs: 44100 })                       // default: track partials
let corrected = dewow(recording, { fs, mode: 'reference', refFreq: 50 }) // lock onto 50 Hz mains hum
let corrected = dewow(recording, { fs, mode: 'pitch', smooth: 3 })    // monophonic voice/instrument

let meter = analyze(recording, { fs })
// → { speed, times, hop, wow, flutter, wowPeak, flutterPeak, confidence, tracks? }
```

`recording` is a mono `Float32Array` or an array of channels (`[L, R, …]`); analysis always runs on the mono mix, and one shared curve corrects every channel, so a stereo pair stays sample-aligned. Returns new arrays — never in place.

| Param | Default | |
|---|---|---|
| `fs` | `44100` | Sample rate |
| `mode` | `'partial'` | `'partial'` \| `'reference'` \| `'pitch'` |
| `refFreq` | — | Known tone/hum frequency (Hz) — required for `mode: 'reference'` |
| `frameSize` | `4096` | STFT frame for peak-picking / track continuity |
| `hopSize` | `512` | STFT hop — also the per-hop curve's own sample rate (its Nyquist, `fs/(2·hopSize)`, caps flutter frequency) |
| `smooth` | `0.05` | Zero-phase smoothing time constant (s) separating wow (below) from flutter (residual) |
| `wow` | `true` | Correct the low-passed (`<~6 Hz`) component |
| `flutter` | `true` | Correct the residual (faster) component |
| `maxDeviation` | `0.05` | Clamp the corrected speed ratio to `[1−x, 1+x]` |
| `minTrack` | `0.5` | Shortest partial kept, in seconds — `'partial'` mode only |
| `minFreq` / `maxFreq` | `50` / `2000` | f0 search range — `'pitch'` mode only |
| `keepLength` | `true` | Output length equals input length |

`analyze()` is the estimator alone — the "wow & flutter meter" — with no audio output. `wow`/`flutter` are the **unweighted RMS** deviation in %; `wowPeak`/`flutterPeak` are the **unweighted peak** deviation in %. These are *not* the IEC 60386 / DIN 45507 figure, which applies a psychoacoustic weighting curve (peaking near 4 Hz) before measuring — that weighting filter isn't implemented here, so a reading from this meter isn't directly comparable to a spec-sheet wow-and-flutter number. `confidence` is the fraction of hops with a usable estimate (a stable track, a present reference tone, or voiced pitch); `tracks` (mode `'partial'` only) lists the accepted partials.

**Resolution trade-offs, measured, not assumed:**
- **Flutter ceiling.** The per-hop curve is itself sampled at `fs/hopSize` (86 Hz at the defaults) — anything above its Nyquist, `fs/(2·hopSize)` ≈ 43 Hz, can't be represented at all. Below that, the *phase-vocoder* estimate needs the analysed signal to be roughly stationary across its whole analysis window, not just one hop — a 4096-sample window (93 ms) averages away a 30 Hz flutter almost entirely (measured: a synthetic ±0.4% 30 Hz flutter reads back as ~0, correlation −0.18 against the true curve). `'partial'` mode works around this with a second, short window (1024 samples, 23.2 ms) purely for the frequency reading, while the long window still does peak-picking / track continuity (which needs the frequency resolution to keep this repo's own test chord's 220/330/440/660 Hz partials from crosstalking). That recovers 30 Hz flutter to within the tolerances below, but a shorter `hopSize` is the honest fix for tracking flutter closer to the nominal 100 Hz ceiling.
- **`'reference'` mode and low reference frequencies.** A 50/60 Hz mains hum needs a much longer reading window than a musical partial does — one cycle of 50 Hz is 20 ms, comparable to the flutter-tracking window above, so `'reference'` mode scales its window to the target frequency (~4.5 cycles) instead of using the fixed one. It also band-passes (Q 5) around `refFreq` before reading phase: program content sharing that band (speech has real energy down at 50 Hz) otherwise corrupts the reading (measured: 50 Hz hum at −30 dB under 6 s of speech, curve correlation 0.94 unfiltered → 0.97 filtered).
- **`'pitch'` mode and real speech/instruments.** `smooth` doubles as the mode's own vibrato/prosody-vs-drift cutoff (`speed = f0 / lowpass(f0, smooth)`): the default 0.05 s tracks pitch fast enough that genuine slow wow gets absorbed into the baseline and cancels out of the ratio, leaving only fast flutter as a visible deviation. A `smooth` of several seconds recovers slow wow, at the cost of also absorbing real vibrato/prosody as if it were flutter — natural speech intonation moves far more (measured: tens of percent) than a 2% wow defect, so this mode is a functional correction, not a precision one, on unpitched or lightly-inflected material. It's also frame-independent (`@audio/pitch-pyin` has no Viterbi/HMM smoothing across frames — see that package's own README) — no octave-jump correction is applied.

**Correction.** Once the speed curve is built, correction is a single windowed-sinc read (`@audio/resample-sinc`, 16 zero-crossings) per output sample at a warped position — `pos[n] = pos[n-1] + 1/speed(pos[n-1])`, narrowing the anti-alias cutoff whenever the local read rate exceeds 1×. Measured on the synthetic 2%-wow-@0.8 Hz + 0.4%-flutter-@30 Hz defect used in the tests: the 440 Hz partial's own residual frequency deviation drops from 1.4% to 0.18% RMS (target ≤0.2%); a clean, undistorted input passes through at ≥40 dB SNR (the estimator finds `speed≈1` and a sinc read at near-integer positions is near-identity). A plain sample-domain SNR against the pristine original is *not* meaningful after correction, even a mathematically exact one — see the source comment on `localSnr` in `test.js` for why, and use `analyze()`'s own residual-deviation-style check instead if you need a number.

**Not implemented:** azimuth/head-alignment error (a *frequency-independent* time skew across the stereo image, not a speed error — out of scope), dropout/gap repair (`@audio/denoise-repair`), or anything ML-based. Celemony Capstan and similar tools additionally use trained models to separate genuine musical vibrato from mechanical wow on program material with no stable partial or reference tone at all; this package only ever measures speed from spectral evidence actually present in the signal.

**Use when:** tape hiss/wobble on cassette or reel-to-reel transfers, turntable speed instability (belt/motor wear), 16mm/optical-track flutter — anything with a stable tone, a mains-hum residual, or several seconds of sustained pitched content to lock onto.<br>
**Not for:** dropouts, azimuth error, or program material with no stable partial and no reference tone (a cappella breath, pure noise, hard cuts) — the estimator has nothing to track.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella.

MIT © [audiojs](https://github.com/audiojs)
