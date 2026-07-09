# @audio/denoise-declick [![npm](https://img.shields.io/npm/v/@audio/denoise-declick)](https://www.npmjs.com/package/@audio/denoise-declick) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-click — detect impulsive transients via AR prediction residual, replace with

```
npm install @audio/denoise-declick
```

```js
import declick from '@audio/denoise-declick'
```

Detects impulses as AR-residual outliers (`> threshold·σ`); replaces each click region with an AR-LS interpolation (Janssen 1986 / Godsill-Rayner 1998).

```js
declick(data, { threshold: 4, order: 60 })
```

| Param | Default | |
|---|---|---|
| `threshold` | `4` | σ-multiple for click detection |
| `order` | `60` | AR model order |
| `guard` | `2` | Extra samples on each side of the detected click |
| `maxBurst` | `64` | Longest run repaired (longer → left as a real transient) |

**Use when:** vinyl pops, edit clicks, occasional impulse noise.<br>
**Not for:** dense crackle (use `decrackle`); long dropouts (use `arInterpolate` directly).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
