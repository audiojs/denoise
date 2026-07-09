# @audio/denoise-detect [![npm](https://img.shields.io/npm/v/@audio/denoise-detect)](https://www.npmjs.com/package/@audio/denoise-detect) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

denoise — content-aware auto-selector that classifies the dominant noise type

```
npm install @audio/denoise-detect
```

```js
import denoise from '@audio/denoise-detect'
```

Content-aware auto-selector. Runs a single STFT classification sweep over the input and dispatches to the most suitable method.

```js
denoise(data)                                                  // → cleaned Float32Array
denoise(data, { returnPlan: true })                            // → { out, plan }
denoise(data, { force: 'wiener' })                             // skip classifier
```

| Param | Default | |
|---|---|---|
| `fs` | `44100` | Sample rate |
| `force` | — | One of `'dehum' \| 'declick' \| 'dewind' \| 'deesser' \| 'dereverb' \| 'omlsa' \| 'wiener'` |
| `returnPlan` | `false` | Return `{ out, plan }` with classifier scores + chosen method |

**Routing (in priority order):**
1. tonal hum (Goertzel — ≥2 of first 3 harmonics show 50× line/off-line ratio at 50 or 60 Hz)
2. impulses (excess kurtosis of AR residual > 12)
3. sibilance (high/mid band power ratio > 8)
4. LF rumble (low/mid band power ratio > 3)
5. non-stationary noise (frame-energy CV > 0.6) → omlsa
6. otherwise → wiener

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
