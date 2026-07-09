# @audio/denoise-omlsa [![npm](https://img.shields.io/npm/v/@audio/denoise-omlsa)](https://www.npmjs.com/package/@audio/denoise-omlsa) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

OM-LSA — Optimally Modified Log-Spectral Amplitude (Cohen 2002), with IMCRA noise

```
npm install @audio/denoise-omlsa
```

```js
import omlsa from '@audio/denoise-omlsa'
```

Optimally-Modified Log-Spectral Amplitude estimator (Cohen 2002) driven by IMCRA noise tracking. Combines an LSA gain with a minimum-gain floor weighted by speech presence probability:
`G = G_LSA^p · G_min^(1-p)`.

```js
omlsa(data)
omlsa(data, { gMinDb: -25 })                                   // less aggressive floor
```

| Param | Default | |
|---|---|---|
| `gMinDb` | `-20` | dB floor for non-speech bins (alias of `gMin`) |
| `alpha` | `0.92` | Decision-directed smoothing (alias of `alphaDD`) |
| `frameSize` | `2048` | |
| `hopSize` | `frameSize/4` | |

**Use when:** speech in non-stationary noise (street, café, car); generally the highest-quality choice for noisy speech.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
