# @audio/vad

> Voice activity detection — frame-level speech/non-speech decision, plus the speech-presence primitives that drive spectral denoise.

Classical, deterministic, no model weights. `vad()` gives a per-frame active/inactive track; `spp()` and `ddSnr()` are the per-bin estimators that OM-LSA / Wiener / IMCRA gain rules consume.

```js
import { vad, spp, ddSnr } from '@audio/vad'

let { active, times, hop, frameSize } = vad(signal, { fs: 48000 })
// active: Uint8Array — 1 where speech is present
// times:  Float32Array — frame-start time (s) for each flag
```

## `vad(data, opts?)`

Per-frame decision: a frame is **active** iff its energy sits `snrTh` dB above the noise floor **and** its spectral flatness is below `flatTh` (speech is tonal → low flatness; noise is flat → high). The floor is the 10th-percentile frame energy plus `bias` dB — robust on clips where any short window may be entirely speech, avoiding the "speech eats its own floor" failure of exponential smoothing.

| opt | default | meaning |
|---|---|---|
| `fs` | `44100` | sample rate (Hz) |
| `frameSize` | `1024` | STFT frame length |
| `hopSize` | `frameSize/2` | hop between frames |
| `snrTh` | `6` | dB above floor to count as active |
| `flatTh` | `0.4` | spectral-flatness ceiling for "tonal" |
| `bias` | `5` | dB added to the percentile floor |

Returns `{ active: Uint8Array, times: Float32Array, hop, frameSize }`.

## `spp(mag, noisePsd, opts?)`

Per-bin **speech-presence probability** from a-priori SNR ξ: `p = ξ / (1 + ξ)` (Gaussian model, q-prior 0.5). Bind to a noise PSD (e.g. `minStats`/`imcra` from `@audio/denoise`). `opts.xiMin` floors ξ (default `0.0316`, −15 dB).

## `ddSnr(mag, noisePsd, prevGain, prevMag, alpha?)`

Decision-directed a-priori SNR (Ephraim & Malah 1984), recursively smoothed with `alpha` (default `0.98`). The ξ̂ estimate feeding Wiener / MMSE / OM-LSA gains.

## Notes

STFT via [`@audio/stft`](https://github.com/audiojs/stft). Also re-exported from [`@audio/denoise`](https://github.com/audiojs/denoise) for restoration pipelines. MIT.
