# @audio/denoise-declip [![npm](https://img.shields.io/npm/v/@audio/denoise-declip)](https://www.npmjs.com/package/@audio/denoise-declip) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-clip — restore samples that have been hard-clipped at ±threshold

```
npm install @audio/denoise-declip
```

```js
import declip from '@audio/denoise-declip'
```

Detects runs of samples at ±`clipLevel`, fits AR on the un-clipped neighbourhood, extrapolates a sign-constrained interpolation.

```js
declip(data, { clipLevel: 0.95 })                              // explicit threshold
declip(data)                                                   // auto-detects clip level
```

| Param | Default | |
|---|---|---|
| `clipLevel` | auto | Detected from histogram of \|x\| > 0.5 |
| `order` | `100` | AR model order |
| `maxRun` | `order/2` | Longest run that gets restored |

**Use when:** hard digital clipping with short clip runs.<br>
**Not for:** sustained clipping covering many cycles (use sparsity-based methods).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
