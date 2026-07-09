# @audio/denoise-debreath [![npm](https://img.shields.io/npm/v/@audio/denoise-debreath)](https://www.npmjs.com/package/@audio/denoise-debreath) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-breath — VAD-driven downward attenuation during non-speech regions

```
npm install @audio/denoise-debreath
```

```js
import debreath from '@audio/denoise-debreath'
```

VAD-driven inverse gate. Uses energy + spectral flatness with a percentile-based noise floor; attenuates frames classified as non-speech with smooth attack/release.

```js
debreath(data, { range: -10 })                                // -10 dB on non-speech (default -12)
```

**Use when:** breath, mouth noise, hiss in pauses on a voiceover.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
