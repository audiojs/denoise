# @audio/denoise-dehum [![npm](https://img.shields.io/npm/v/@audio/denoise-dehum)](https://www.npmjs.com/package/@audio/denoise-dehum) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Mains hum / tonal noise removal via cascaded high-Q biquad notches

```
npm install @audio/denoise-dehum
```

```js
import dehum from '@audio/denoise-dehum'
```

Cascade of high-Q biquad notches at the fundamental + harmonics.

```js
dehum(data, { freq: 60, harmonics: 4 })
dehum(data, { freq: 50, adaptive: true, drift: 0.5 })          // tracks slow mains drift
```

| Param | Default | |
|---|---|---|
| `freq` | `50` | Fundamental (Hz) |
| `harmonics` | `4` | Number of notches placed |
| `Q` | `30` | Notch sharpness — higher = narrower |
| `adaptive` | `false` | Goertzel sweep refines `freq` ± `drift` Hz |

**Use when:** mains buzz, ground-loop hum, fixed tonal interference.<br>
**Not for:** broadband noise (use `wiener`/`omlsa`); shifting tones (use spectral methods).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
