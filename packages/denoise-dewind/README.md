# @audio/denoise-dewind [![npm](https://img.shields.io/npm/v/@audio/denoise-dewind)](https://www.npmjs.com/package/@audio/denoise-dewind) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-wind / de-rumble — adaptive high-pass that opens wider when low-frequency

```
npm install @audio/denoise-dewind
```

```js
import dewind from '@audio/denoise-dewind'
```

Adaptive high-pass. Cutoff slides between `cutoffMin` and `cutoffMax` based on the LF/MF energy ratio.

```js
dewind(data, { cutoffMin: 60, cutoffMax: 250 })
```

| Param | Default | |
|---|---|---|
| `cutoffMin` | `60` | Hz — minimum cutoff (LF mostly clean) |
| `cutoffMax` | `250` | Hz — maximum cutoff (heavy rumble) |
| `order` | `2` | HP sections (each 12 dB/oct) |
| `Q` | `0.707` | Butterworth-ish |
| `blockSize` | `1024` | Coefficient update interval (samples) |

**Use when:** intermittent wind buffeting, handling thumps, low-frequency room modes — the adaptive cutoff opens on gusts and closes between them (measured: beats `wiener` on gusty wind at ~1/10 the CPU).<br>
**Not for:** continuous rumble under speech — a time-domain cutoff can't separate overlapping spectra; use `wiener`/`omlsa` there (measured ~9 dB vs ~1 dB SNR gain). An LPC-null post-filter was evaluated and rejected: voiced speech is as AR-predictable as wind, so nulling wind poles whitens vowels too (LSD improves, SNR and speech level degrade).

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
