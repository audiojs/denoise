# @audio/denoise-desilence [![npm](https://img.shields.io/npm/v/@audio/denoise-desilence)](https://www.npmjs.com/package/@audio/denoise-desilence) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

VAD-driven silence handling for speech: remove, shorten (Smart Speed), split, trim

```
npm install @audio/denoise-desilence
```

```js
import desilence, { segments, split, project } from '@audio/denoise-desilence'
```

Runs [`@audio/vad`](https://github.com/audiojs/denoise/tree/main/packages/vad)'s frame-level speech decision once over the mono mix (voicing, and the sound over a tracked noise floor next to it: noise, breaths and room tone between phrases are pause, a quiet word in noise is not), folds it into time segments (bridging gaps shorter than `merge`), then edits the *silence* between and around speech. Three modes: `remove` cuts every pause longer than `minSilence` down to a `pad`-second buffer on each side; `shorten` compresses any pause longer than `maxSilence` to that target, trimmed from the middle so the natural onset/offset survives — the technique behind Overcast's "Smart Speed" (Marco Arment, [2015](https://overcast.fm/podcaster/2015/09/09/smart-speed)); `trim` only strips leading/trailing silence. Every cut is an equal-power crossfade, never a hard splice, so the result is click-free at any pause length.

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
| `frameSize` / `hopSize` | `vad()`'s: 3 periods of 75 Hz (2048 at 44.1/48 kHz) / a quarter of it | forwarded to `vad()` |
| `merge` | `0.15` | s — speech gaps shorter than this are bridged into one segment |

`threshold` trades away `vad()`'s decision for a plain absolute-dB gate on frame energy (1024-sample frames unless `frameSize` is given, no voicing check — an absolute level has no "is it speech" component to combine with). Leave it `null` for `vad()`'s tracked floor and voicing; set it when you know the true noise floor and want a fixed cutoff instead.

Runs once over the whole signal — like every whole-render kernel in this family (`denoise`, `dereverb`), it needs the full clip, not a block at a time. Multi-channel input analyses the mono mix; the same cuts and crossfade windows apply to every channel identically.

0.1 read silence under 11 dB over the input's 10th-percentile frame energy: under noise that percentile is the noise, and whole words went. Measured with `python scripts/vad.py` in [@audio/denoise](https://github.com/audiojs/denoise) (VoiceBank+DEMAND test set, ten Spoken Wikipedia narrations; defaults chosen on the training subset and ten other narrations), `shorten` at its defaults, 0.1.1 → 0.2.0, frames cut:

| | voiced | word edges | removed |
|---|---:|---:|---:|
| VoiceBank+DEMAND, 824 noisy | 3.89 → **0.00** % | 3.93 → **0.00** % | 290 → 21 of 2072 s |
| the same, clean | 0.00 → 0.03 % | 0.01 → 0.12 % | 167 → 126 s |
| 10 narrations | 0.00 → 0.00 % | 0.00 → 0.02 % | 50 → 52 of 600 s |

Breaths (350 ms of resonant noise) in the narrations' pauses ending 0.3 s before the next phrase: 56 → 75 % of each removed at −35 dB, 50 → 69 % at −25 dB. Music, frames within 30 dB of the loudest cut: Vibe Ace 10.5 → 0 %, Brahms 3.5 → 0.02 %, Nutcracker 16.8 → 0 %, sung (VocalSet m8) 25.3 → 0 %.

**What this does not do:** no ML VAD — `@audio/vad`'s decision is classical DSP (a likelihood ratio over a minimum-statistics floor, anchored on voicing). Whispered speech holds no voicing and reads as pause. No music-aware pause detection — a rest under `minSilence` in a musical passage looks identical to a speech pause and gets cut/shortened the same way; this is a speech tool, not a general silence-trimmer for mixed program audio.

**Use when:** podcast/voiceover "smart speed" playback prep, batch-trimming long pauses out of narration, splitting a take into per-line clips, or stripping room tone from the head/tail of a recording.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella.

MIT © [audiojs](https://github.com/audiojs)
