# @audio/denoise-wiener [![npm](https://img.shields.io/npm/v/@audio/denoise-wiener)](https://www.npmjs.com/package/@audio/denoise-wiener) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Wiener filter / MMSE-LSA denoise with decision-directed a-priori SNR

```
npm install @audio/denoise-wiener
```

```js
import wiener from '@audio/denoise-wiener'
```

MMSE log-spectral amplitude (Ephraim & Malah 1985) or Wiener (Scalart & Filho 1996) gain on the decision-directed a priori SNR ξ = α·Â²(l−1)/λ(l−1) + (1−α)·max(γ−1, 0) (Ephraim & Malah 1984, eq. 51). α = 0.98 is theirs for an 8 ms frame step (§VI: 256 samples at 8 kHz, a new frame every 64) and is rescaled to the actual step as α<sup>Δt/8 ms</sup>, so the a priori SNR's memory holds in seconds; applied per frame until 0.3, it ran 1.8× longer at 48 kHz (10.7 ms steps) than at 44.1 kHz (5.8 ms). The floor ξ<sub>min</sub> stays −15 dB: −25 dB, Cohen's and Loizou's, left more musical noise on steady white and pink noise (log kurtosis ratio 0.98 and 1.49, against 0.53 and 1.01) and cost PESQ and SIG on the training speech (`scripts/speech.mjs`). The noise PSD λ is tracked by minimum statistics (Martin 2001) over a 1.5 s window, in batch and stream alike, unless a profile or a noise-only stretch is given; a held note, a sustained vowel or a chord is kept out of it (@audio/noise-estimate's `partials`, as [`omlsa`](https://github.com/audiojs/denoise#omlsa) has it: clean music cut by more than 3 dB 14.5 → 3.4 %, sung long tones 36.3 → 0.0 %, Slakh mixes 26.6 → 3.3 %; `estimator: { partials: false }` turns it off). `processor(opts)` is the gain as an @audio/stft frame process, for a host running its own frames.

```js
wiener(data, { fs })                                           // LSA gain, noise tracked
wiener(data, { fs, rule: 'wiener' })                           // Wiener gain
wiener(data, { fs, noiseFrames: 6 })                           // noise from the first 6 frames
```

| Param | Default | |
|---|---|---|
| `rule` | `'mmse-lsa'` | `'wiener'` or `'mmse-lsa'` (log-spectral, less musical noise) |
| `alpha` | `0.98` | Decision-directed smoothing per 8 ms of frame step, rescaled to the actual step (alias of `alphaDD`) |
| `xiMin` | `10^−1.5` | A priori SNR floor (−15 dB) |
| `frameSize` | power of two nearest 32 ms | STFT frame: 512 at 16 and 22.05 kHz, 1024 at 44.1, 2048 at 48 (`frame(fs)`) |
| `hopSize` | `frameSize/4` | OLA hop |
| `profile` | tracked | Noise PSD (`Float64Array`, `frameSize/2+1` bins) |
| `estimator` | | Minimum statistics options (@audio/noise-estimate `minStats`); `{ partials: false }`: held notes learned as noise, as before |
| `noiseFrames` / `profileFrom` / `profileTo` | | A noise-only stretch to average for the profile |

**Use when:** transparent broadband denoise; the "safe default" for stationary noise.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
