# @audio/denoise-dereverb [![npm](https://img.shields.io/npm/v/@audio/denoise-dereverb)](https://www.npmjs.com/package/@audio/denoise-dereverb) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-reverb: late reverberation off speech by weighted prediction error (WPE, Nakatani et al. 2010), recursive

```
npm install @audio/denoise-dereverb
```

```js
import dereverb from '@audio/denoise-dereverb'
```

Late reverberation off speech by weighted prediction error, WPE (Nakatani et al. 2010), in its recursive form (Yoshioka & Nakatani 2012). In each STFT bin, what the frames 30 to 130 ms back predict of the current one is the room's tail, and is subtracted. The prediction is fitted with each frame weighted by its inverse power, so it takes what the room adds, not the speech's own correlation. A linear filter per bin: no decay time to estimate, no gain floor, no musical noise. It adapts within about a second; each frame leaves through the filter a quarter second later has learned (`lookahead`), so a take's first words are cleaned too.

```js
dereverb(data, { fs: 48000 })
```

| Param | Default | |
|---|---|---|
| `lookahead` | `0.25` | s the filter learns past each frame before it leaves; the latency grows by it (0: the frame's alone, 32 to 46 ms) |

**Use when:** speech in a room, one microphone.<br>
**Not for:** music or anything holding a steady pitch: a steady tone is predictable, and taken (a held note with vibrato loses 13 dB). Noise: denoise first.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
