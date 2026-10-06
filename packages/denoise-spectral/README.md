# @audio/denoise-spectral [![npm](https://img.shields.io/npm/v/@audio/denoise-spectral)](https://www.npmjs.com/package/@audio/denoise-spectral) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Spectral subtraction (Boll 1979) with Berouti over-subtraction + spectral floor

```
npm install @audio/denoise-spectral
```

```js
import specsub from '@audio/denoise-spectral'
```

Power spectral subtraction with over-subtraction and a spectral floor (Berouti, Schwartz & Makhoul 1979): |Ŝ|² = |Y|² − α·N̂ where that stays above β·N̂, else β·N̂. Over-subtraction takes out the noise's peaks that plain subtraction leaves as musical tones; the floor, a fraction of the noise estimate, fills the valleys with a steady bed that masks what is left. α follows the frame's SNR (4 − 3/20·SNR: 4.75 at −5 dB down to 1 at 20 dB) unless fixed. The noise PSD is tracked by minimum statistics (Martin 2001) over a 1.5 s window, in batch and stream alike, unless a profile or a noise-only stretch is given; a held note, a sustained vowel or a chord is kept out of it (@audio/noise-estimate's `partials`, as [`omlsa`](https://github.com/audiojs/denoise#omlsa) has it: clean music cut by more than 3 dB 10.3 → 3.2 %, sung long tones 36.9 → 0.0 %, Slakh mixes 13.1 → 0.8 %; `estimator: { partials: false }` turns it off). `processor(opts)` is the gain as an @audio/stft frame process, for a host running its own frames.

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
| `estimator` | | Minimum statistics options (@audio/noise-estimate `minStats`); `{ partials: false }`: held notes learned as noise, as before |
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to average for the profile |

**Use when:** quick baseline; offline cleanup with a known noise-only preamble.<br>
**Not for:** musical-noise-sensitive material — use `wiener` or `omlsa`.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
