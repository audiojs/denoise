# @audio/denoise-desilence [![npm](https://img.shields.io/npm/v/@audio/denoise-desilence)](https://www.npmjs.com/package/@audio/denoise-desilence) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

VAD-driven silence handling for speech: remove, shorten (Smart Speed), split, trim

```
npm install @audio/denoise-desilence
```

```js
import desilence, { segments, split, project } from '@audio/denoise-desilence'
```

Runs [`@audio/vad`](https://github.com/audiojs/denoise/tree/main/packages/vad)'s frame-level speech/non-speech decision once over the mono mix, folds it into time segments (bridging gaps shorter than `merge`), then edits the *silence* between and around speech. Three modes: `remove` cuts every pause longer than `minSilence` down to a `pad`-second buffer on each side; `shorten` compresses any pause longer than `maxSilence` to that target, trimmed from the middle so the natural onset/offset survives — the technique behind Overcast's "Smart Speed" (Marco Arment, [2015](https://overcast.fm/podcaster/2015/09/09/smart-speed)); `trim` only strips leading/trailing silence. Every cut is an equal-power crossfade, never a hard splice, so the result is click-free at any pause length.

```js
let out = desilence(recording, { mode: 'shorten', fs: 44100 })
// out.data:     Float32Array (or Float32Array[] for multi-channel), same shape as input
// out.segments: [{ start, end }] — kept regions, input seconds
// out.removed:  seconds cut
// out.map:      input→output time breakpoints, read with project(map, t)

let { speech, silence } = segments(recording, { fs: 44100 })   // analysis only, no editing

let clips = split(recording, { fs: 44100, pad: 0.1 })          // one Float32Array per speech segment, "split by silence"

let outT = project(out.map, 12.4)                              // where did input t=12.4s land after cutting?
```

| Param | Default | |
|---|---|---|
| `fs` | `44100` | Sample rate, Hz |
| `mode` | `'shorten'` | `'shorten'` \| `'remove'` \| `'trim'` |
| `minSilence` | `0.5` | s — a pause shorter than this is never touched, in any mode but `trim` |
| `maxSilence` | `0.25` | s — `shorten` target: pauses collapse to this length |
| `pad` | `0.1` | s — `remove` target: silence kept on each side bordering speech |
| `threshold` | `null` | dB — absolute override for the VAD's adaptive floor (see below) |
| `fade` | `0.01` | s — equal-power crossfade length at every cut |
| `frameSize` / `hopSize` | `1024` / `512` | forwarded to `vad()` |
| `merge` | `0.15` | s — speech gaps shorter than this are bridged into one segment |

`threshold` trades away `vad()`'s energy+spectral-flatness decision for a plain absolute-dB gate on frame energy (same STFT frame grid, no flatness check — an absolute level has no "is it tonal" component to combine with). Leave it `null` for the adaptive per-file floor `vad()` computes; set it when you know the true noise floor and want a fixed cutoff instead.

Runs once over the whole signal — like every whole-render kernel in this family (`denoise`, `dereverb`), it needs the full clip, not a block at a time. Multi-channel input analyses the mono mix; the same cuts and crossfade windows apply to every channel identically.

**What this does not do:** no ML VAD — `@audio/vad`'s energy+flatness decision is classical DSP, tuned for close-miced narration, not far-field or noisy conference audio. No music-aware pause detection — a rest under `minSilence` in a musical passage looks identical to a speech pause and gets cut/shortened the same way; this is a speech tool, not a general silence-trimmer for mixed program audio.

**Use when:** podcast/voiceover "smart speed" playback prep, batch-trimming long pauses out of narration, splitting a take into per-line clips, or stripping room tone from the head/tail of a recording.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella.

MIT © [audiojs](https://github.com/audiojs)
