# @audio/denoise-spectral [![npm](https://img.shields.io/npm/v/@audio/denoise-spectral)](https://www.npmjs.com/package/@audio/denoise-spectral) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Spectral subtraction (Boll 1979) with Berouti over-subtraction + spectral floor

```
npm install @audio/denoise-spectral
```

```js
import specsub from '@audio/denoise-spectral'
```

Berouti spectral subtraction (1979). Estimates noise from the first `noiseFrames` (or tracks it via Minimum Statistics) and subtracts `α(γ)·N̂(k)` — an SNR-adaptive over-subtraction factor — from each magnitude frame, with a `β·|Y(k)|²` spectral floor. Pass an explicit `alpha` to force a fixed factor.

```js
specsub(data, { beta: 0.02, noiseFrames: 6 })                 // adaptive α(γ)
specsub(data, { alpha: 2, beta: 0.02 })                       // fixed over-subtraction
```

| Param | Default | |
|---|---|---|
| `alpha` | adaptive | Fixed over-subtraction factor; omit for Berouti α(γ) |
| `beta` | `0.02` | Spectral floor (fraction of the noisy spectrum) |
| `noiseFrames` | first 4 frames | Leading noise-only frames for the PSD bootstrap |

**Use when:** quick baseline; offline cleanup with a known noise-only preamble.<br>
**Not for:** musical-noise-sensitive material — use `wiener` or `omlsa`.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
