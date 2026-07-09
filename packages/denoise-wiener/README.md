# @audio/denoise-wiener [![npm](https://img.shields.io/npm/v/@audio/denoise-wiener)](https://www.npmjs.com/package/@audio/denoise-wiener) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Wiener filter / MMSE-LSA denoise with decision-directed a-priori SNR

```
npm install @audio/denoise-wiener
```

```js
import wiener from '@audio/denoise-wiener'
```

MMSE Wiener / log-MMSE (Ephraim-Malah 1984/1985) with decision-directed a-priori SNR.

```js
wiener(data, { rule: 'wiener' })                              // pure Wiener gain
wiener(data)                                                   // defaults: 'mmse-lsa' rule
```

| Param | Default | |
|---|---|---|
| `rule` | `'mmse-lsa'` | `'wiener'` or `'mmse-lsa'` (log-spectral, less musical noise) |
| `alpha` | `0.98` | Decision-directed smoothing (alias of `alphaDD`) |
| `frameSize` | `2048` | STFT frame |
| `hopSize` | `frameSize/4` | OLA hop |
| `noiseFrames` | first 4 frames | Leading noise-only frames for PSD bootstrap |

**Use when:** transparent broadband denoise; the "safe default" for stationary noise.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
