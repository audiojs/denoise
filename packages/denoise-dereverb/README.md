# @audio/denoise-dereverb [![npm](https://img.shields.io/npm/v/@audio/denoise-dereverb)](https://www.npmjs.com/package/@audio/denoise-dereverb) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-reverb — late-reverb spectral subtraction (Lebart, Boucher & Denbigh 2001)

```
npm install @audio/denoise-dereverb
```

```js
import dereverb from '@audio/denoise-dereverb'
```

Late-reverb suppression (Lebart, Boucher & Denbigh 2001 estimate, Habets-class gain). Models the late tail as a decaying sum of past frames' power, then applies a decision-directed Wiener gain on the signal-to-reverb ratio — the cross-frame smoothing suppresses the musical noise hard subtraction produces.

```js
dereverb(data, { t60: 0.6, predelay: 0.04 })
```

| Param | Default | |
|---|---|---|
| `t60` | `0.5` | Assumed reverberation time (s) |
| `predelay` | `0.04` | Direct-sound passthrough (s) |
| `alpha` | `1.5` | Reverb-PSD over-estimation factor |
| `alphaDD` | `0.98` | Decision-directed SIR smoothing |
| `gMin` | `0.05` | Gain floor for reverb-dominated bins |

**Use when:** moderate room reverb (RT60 ≤ 1 s) on a single channel.<br>
**Not for:** heavy reverb or convolutive distortion — use multi-channel WPE (out of scope).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
