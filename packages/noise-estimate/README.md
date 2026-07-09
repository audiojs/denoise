# @audio/noise-estimate

> Noise power-spectral-density estimation — the noise floor that spectral denoisers subtract.

Three stateful estimators over STFT magnitude frames. Feed them per-frame; read `.psd` (a `Float64Array` of `N/2+1` bins) whenever you need the current noise estimate.

```js
import { minStats } from '@audio/noise-estimate'
import { stftAnalyse } from '@audio/stft'

let est = minStats(1024, { D: 96 })          // half = frameSize/2
stftAnalyse(signal, mag => est.update(mag), { frameSize: 2048 })
let noisePsd = est.psd                        // drive Wiener / MMSE / OM-LSA gain
```

## `minStats(half, opts?)`

Minimum Statistics (Martin 2001) — tracks a rolling `D`-frame minimum of the smoothed PSD per bin, scaled by a bias factor so the minimum estimates E{|N|²} rather than the lower tail. `opts`: `D` (window frames, default 96 ≈ 1.5 s), `alpha` (PSD smoothing, 0.7), `bias` (1.5). Returns `{ psd, update(mag) }`.

## `imcra(half, opts?)`

Improved Minima-Controlled Recursive Averaging (Cohen 2003) — updates the noise PSD only where speech is absent, gated by a speech-presence probability (supply your own via `update(mag, spp)`, or it derives one from the smoothed-to-minimum ratio). `opts`: `alpha` (0.92), `alphaD` (0.85), `beta` (1.47). Returns `{ psd, update(mag, sppOverride?) }`.

## `noiseProfile(data, opts?)`

One-shot baseline: averages |X|² over a quiet segment (`opts.from`/`opts.to` samples). Returns a `Float64Array` PSD. Use when you can point at a known noise-only region.

## Notes

STFT via [`@audio/stft`](https://github.com/audiojs/stft); pairs with [`@audio/vad`](https://github.com/audiojs/denoise/tree/main/packages/vad)'s `spp()`. Also re-exported from [`@audio/denoise`](https://github.com/audiojs/denoise). MIT.
