# @audio/denoise-deplosive [![npm](https://img.shields.io/npm/v/@audio/denoise-deplosive)](https://www.npmjs.com/package/@audio/denoise-deplosive) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-plosive — detect short low-frequency bursts ('p', 'b' attacks on close mics)

```
npm install @audio/denoise-deplosive
```

```js
import deplosive from '@audio/denoise-deplosive'
```

Splits the signal into an LF band (`< crossover`) and its exact complement; ducks the LF band when its energy spikes above `triggerRatio`× the high band (a plosive signature). With no plosive present the output equals the input sample-for-sample — no crossover coloration.

```js
deplosive(data, { triggerRatio: 4, attack: 0.005, release: 0.08 })
```

| Param | Default | |
|---|---|---|
| `triggerRatio` | `4` | LF/high energy ratio that opens the duck |
| `attenuation` | `-18` | dB cut on the LF band when triggered |
| `crossover` | `200` | Hz — LF/high split point |
| `attack` | `0.005` | s |
| `release` | `0.08` | s |

**Use when:** mic plosives (`p`, `b`, `t`) producing low-frequency thuds.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
