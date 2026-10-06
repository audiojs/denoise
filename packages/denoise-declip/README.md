# @audio/denoise-declip [![npm](https://img.shields.io/npm/v/@audio/denoise-declip)](https://www.npmjs.com/package/@audio/denoise-declip) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-clip: each side's rail found where the sound was cut flat, every clipped sample rebuilt twice, sparse (A-SPADE) and AR (Janssen), the two blended by a weight cross-validated region by region; unclipped sound untouched

```
npm install @audio/denoise-declip
```

```js
import declip from '@audio/denoise-declip'
```

Finds where a sound was cut flat and rebuilds what the cut took off. A hard clip piles every sample it cuts onto one level, its rail. Each side's rail is the sound's extreme there, taken when the samples within 0.1 % of it outnumber those in the next 0.1 % below tenfold and most of them sit in runs: the top-bin test of FFmpeg's `adeclip` (1000 bins, ratio 10), made relative to the rail so it holds at any level (and never finer than one step of a 16- or 24-bit grid), and per side, so one rail or two different ones are found. A loud peak is one sample; a limiter's ceiling is touched by single samples or by arches, and a sine's top is an arch, which fill the band below about as densely: sound with no rail comes back bit-exact.

Every sample at a rail is then rebuilt twice, each rebuild held at least as far out as the sample was recorded (a clip only ever lowers a sample). Sparse: A-SPADE (Kitić, Bertin & Gribonval 2015) as the declipping survey's code runs it (Záviška, Rajmic, Ozerov & Rencker 2021), per block of 93 ms the fewest DFT lines that agree with what was recorded. AR: per window of 186 ms, AR(256) fitted under its taper, every unknown solved at once by exact least squares ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arFill`), refitted and solved again, 8 times (Janssen, Veldhuis & Vries 1986). The sparse one wins on tonal music and on heavy clipping, the AR one on speech and on mild clipping, and neither everywhere, so the two are blended, region by region, by a weight chosen by cross-validation: the clipped sound is clipped once more, at the level that takes as large a share of what the first clip left as the first took of the whole; both rebuild that; the weight is the one whose blend lies nearest what is known there (the samples the second clip hid, and the bounds of those the first took), read per 93 ms over ±1 s. A blend of two consistent rebuilds is consistent; each rebuild runs only where its weight is not 0. Samples off the rails come back bit-exact; a sound over 30 s is rebuilt in pieces crossfaded over 2 s.

```js
declip(data, { fs: 44100 })                                    // each side's rail found; none: untouched
declip(data, { fs: 44100, clipLevel: 0.95 })                   // a known rail, ±0.95
```

| Param | Default | |
|---|---|---|
| `clipLevel` | auto | the rail, ± this; omitted or 0: found per side |
| `order` | `256` | AR order of the AR rebuild; `512` takes it on dense music up to 2 dB closer, in about 3× the time |
| `fs` | `44100` | sample rate, Hz |

`node scripts/declip.js` clips speech (audio-lena) and music ("Vibe Ace", Brahms, the trumpet loop, as `repair`), 6 s of each, peak-normalized and cut at the level that leaves the clipped sound 1–20 dB from the original (the input SDR of the declipping survey), and measures the SDR after, dB, declip (finding the rails itself) · FFmpeg `adeclip` at its defaults:

| input SDR | 1 dB | 3 dB | 7 dB | 10 dB | 15 dB | 20 dB |
|---|---:|---:|---:|---:|---:|---:|
| speech | 8.4 · 1.1 | 10.9 · 5.0 | 24.2 · 12.1 | 31.9 · 16.9 | 38.3 · 24.0 | 42.6 · 30.5 |
| "Vibe Ace" | 6.9 · 1.6 | 13.1 · 5.0 | 19.1 · 10.3 | 22.7 · 14.0 | 31.4 · 19.9 | 36.2 · 24.6 |
| Brahms | 6.9 · 0.6 | 12.7 · 3.9 | 18.9 · 10.2 | 22.8 · 14.4 | 29.2 · 19.8 | 35.8 · 23.8 |
| trumpet | 6.1 · 1.3 | 16.8 · 4.1 | 31.4 · 10.4 | 44.7 · 14.8 | 46.5 · 21.4 | 60.3 · 25.0 |

0.2.0 (the AR rebuild alone), 1–20 dB: speech 2.3 / 11.6 / 24.2 / 31.2 / 37.7 / 42.4, "Vibe Ace" 3.8 / 9.3 / 15.6 / 19.7 / 26.5 / 32.9, Brahms 1.5 / 8.5 / 16.1 / 20.0 / 26.4 / 34.0, the trumpet 2.9 / 15.1 / 31.4 / 45.6 / 46.1 / 58.8: the blend gains 3–6 dB at 1 dB, up to 4.9 above it on the music, and loses 0.7 on speech at 3 dB and 0.9 on the trumpet at 10. On the survey's own test, its ten SQAM excerpts (solo instruments and an ensemble, 44.1 kHz) clipped by its `clip_sdr.m`, mean ΔSDR over the clipped samples, dB, beside the means it publishes for its leading methods (code and results: [declipping2020_codes](https://github.com/rajmic/declipping2020_codes)):

| input SDR | 1 dB | 3 dB | 5 dB | 7 dB | 10 dB | 15 dB | 20 dB | mean |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| declip | 8.3 | 13.2 | 14.8 | 15.8 | 17.6 | 19.7 | 21.9 | 15.9 |
| social sparsity, PEW (Siedenburg, Kowalski & Dörfler 2014) | 12.2 | 15.0 | 16.6 | 17.7 | 19.0 | 21.2 | 22.2 | 17.7 |
| A-SPADE | 11.9 | 13.9 | 15.1 | 16.0 | 17.3 | 19.4 | 20.3 | 16.3 |
| S-SPADE | 11.4 | 13.7 | 15.0 | 15.6 | 17.1 | 19.3 | 19.9 | 16.0 |
| ℓ1, parabola-weighted | 9.9 | 13.0 | 14.8 | 16.0 | 17.4 | 19.6 | 21.0 | 16.0 |
| NMF (Bilen, Ozerov & Pérez 2018) | 5.1 | 12.2 | 14.3 | 16.2 | 18.0 | 20.6 | 22.0 | 15.5 |
| Janssen (AR) | −0.9 | −1.3 | 0.6 | 3.5 | 7.9 | 17.0 | 19.6 | 6.6 |

At 10–20 dB ahead of both SPADEs and ℓ1, behind social sparsity by 0.3–1.5 dB and NMF by 0.1–0.9; at 3–7 dB behind A-SPADE by 0.2–0.7, at 1 dB by 3.6, where the blend leans on its sparse rebuild, which grows its sparsity faster than the survey's (8× fewer iterations) in blocks half as long; on the mean, 5th of the 7, within 0.1 dB of S-SPADE and ℓ1. 0.2.0 averaged 13.2 there (1 dB: 4.9, 20 dB: 19.8). VoiceBank+DEMAND's clean test set, every 20th utterance clipped to 3, 10 and 20 dB: declip 11.5, 20.4 and 33.1 dB (0.2.0 at 10 and 20: 19.8 and 32.4), `adeclip` 5.1, 16.0 and 28.2.

Rails are found at the 20 dB level clipped asymmetrically (with the 10 dB level below), on one side only, then turned down to 0.4, quantized to 16 bits plain or dithered, and on a 16-bit converter driven 2.5 dB over (rails at 32767 and −32768): 13 dB or more of SDR gained in each. The unclipped material through it, as it is, peak-normalized, at 16 bits and through a lookahead limiter 12 dB over its ceiling: not a sample changed; nor in any of VoiceBank+DEMAND's 824 clean test utterances. It takes about 7 s per second of sound averaged over the six levels, most of it at 1–3 dB (0.2.0: 3; `adeclip`: 11–15; on the trumpet, its runs short: 2, 0.7 and 2).

**Use when:** digital clipping: a converter overdriven, a mix bounced too hot, a plug-in's hard clip; at any level, on either side or both.<br>
**Not for:** clipping that has since been through lossy coding or resampling (the plateau is no longer flat, and no rail is found); soft saturation, tape or tube, which has no rail.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
