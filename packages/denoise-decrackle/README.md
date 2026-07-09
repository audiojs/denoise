# @audio/denoise-decrackle [![npm](https://img.shields.io/npm/v/@audio/denoise-decrackle)](https://www.npmjs.com/package/@audio/denoise-decrackle) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-crackle — continuous-stream version of de-click for vinyl-style noise

```
npm install @audio/denoise-decrackle
```

```js
import decrackle from '@audio/denoise-decrackle'
```

Continuous AR-residual outlier detection with MAD-based threshold. Suited to high-rate impulse noise.

```js
decrackle(data, { threshold: 3 })
```

**Use when:** shellac / 78 RPM crackle; persistent low-amplitude clicks.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
