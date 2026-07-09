# @audio/denoise-deesser [![npm](https://img.shields.io/npm/v/@audio/denoise-deesser)](https://www.npmjs.com/package/@audio/denoise-deesser) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-esser — dynamic peaking EQ centred on the sibilance band

```
npm install @audio/denoise-deesser
```

```js
import deesser from '@audio/denoise-deesser'
```

Dynamic peaking EQ centred on the sibilance band. Detection runs on a HP side-chain; when the envelope exceeds threshold, a negative-gain peaking EQ at `freq` engages on the audio path. Re-computed every `block` samples for smooth gain riding.

```js
deesser(data, { freq: 6500, threshold: -28, ratio: 4 })
```

| Param | Default | |
|---|---|---|
| `freq` | `6000` | Sibilance centre (Hz) |
| `threshold` | `-30` | dBFS — engagement level |
| `ratio` | `4` | Compression ratio above threshold |
| `attack` | `0.001` | s — how fast the cut engages |
| `release` | `0.05` | s — how slowly it recovers |
| `Q` | `1.4` | Peaking EQ Q |
| `block` | `64` | Coefficient update interval (samples) |

**Use when:** voice post-production with hot s/sh; vocal bus de-essing.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
