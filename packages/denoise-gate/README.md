# @audio/denoise-gate [![npm](https://img.shields.io/npm/v/@audio/denoise-gate)](https://www.npmjs.com/package/@audio/denoise-gate) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Look-ahead noise gate with hysteresis

```
npm install @audio/denoise-gate
```

```js
import gate from '@audio/denoise-gate'
```

Look-ahead noise gate with hysteresis.

```js
gate(data, { threshold: -45, attack: 0.005, release: 0.1, hold: 0.05, lookahead: 0.005 })
```

**Use when:** silence enforcement; aggressive cut between phrases.<br>
**Not for:** continuous denoise — use `wiener`/`omlsa`.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
