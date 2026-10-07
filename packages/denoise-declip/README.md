# @audio/denoise-declip [![npm](https://img.shields.io/npm/v/@audio/denoise-declip)](https://www.npmjs.com/package/@audio/denoise-declip) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

De-clip: each side's rail found where the sound was cut flat, or where lossy coding spread the cut into a band, or soft saturation's curve fitted blind by maximum likelihood and inverted, every clipped sample rebuilt three times, AR (Janssen) and sparse (A-SPADE) over 93 and 186 ms, the three blended by weights cross-validated region by region; unclipped sound untouched

```
npm install @audio/denoise-declip
```

```js
import declip from '@audio/denoise-declip'
```

Finds where a sound was cut and rebuilds what the cut took off. A hard clip piles every sample it cuts onto one level, its rail. Each side's rail is the sound's extreme there, taken when the samples within 0.1 % of it outnumber those in the next 0.1 % below tenfold and most of them sit in runs: the top-bin test of FFmpeg's `adeclip` (1000 bins, ratio 10), made relative to the rail so it holds at any level (and never finer than one step of a 16- or 24-bit grid), and per side, so one rail or two different ones are found. A loud peak is one sample; a limiter's ceiling is touched by single samples or by arches, and a sine's top is an arch, which fill the band below about as densely.

Lossy coding (MP3, AAC, Opus) leaves no flat top: it spreads the rail into a band, the coder's noise around the level the runs were cut at, a mode of the amplitude density with mass on both sides of it. A waveform's own peaks, a sine's top, a limiter's ceiling, only approach a level from below. So, where no side has a flat rail, each side's band is its highest mode standing 4 times over the density 2–6 % of the extreme below it (at 1, 2 and 4 times that scale, for coarser coders), with samples over it reaching 3 of its spreads σ (the RMS of the samples over the mode) and beyond; the sound is cut again 6σ under the mode and rebuilt as a clip there (κ = 6 chosen on VoiceBank and MUSDB18 training material through LAME at 128 kbit/s: 0.6 dB over 4 on average, speech +0.9, music −0.1; 5 and 8 within 0.2 on speech).

Soft saturation, a valve, transistor or tape stage driven hot, leaves no rail and no band: a memoryless curve bends the peaks over toward a ceiling. Where neither is found, the curve is fitted blind, by maximum likelihood, the sound before it taken for locally AR Gaussian: for a curve f, z = f⁻¹(x) is the sound it bent, and the likelihood is AR(24)'s of z per window of 46 ms, the variance profiled out, times the Jacobian of f⁻¹ (a Wiener system, a linear sound then a memoryless curve, inverted blindly; Taleb, Solé-Casals & Jutten 2001 invert one by its output's independence). Two shapes, each of unit slope at 0, with a ceiling per side and a knee k: c·tanh((|x|/c)^k)^(1/k), tanh at k = 1, an exponential approach to the ceiling; and x/(1 + (|x|/c)^k)^(1/k), an algebraic one, as arctan's. It reads the 48 windows of the highest peaks, a quarter of them first to screen, and takes a curve that gains over 0.02 nats a sample against the sound as it is and bends the loudest peak to half its slope or less. A band the recording left empty (a lowpass, a codec's) would make a curve's new harmonics there cost more than they should, so each window's fit keeps a white floor 70 dB under its power. The sound is then inverted, z = f⁻¹(x), where the curve keeps over 1/40 of its slope (its noise and the fit's error raised at most 32 dB); above, z is unknown and held at least at f⁻¹ there: a clip, rebuilt as one. A limiter is no curve: its gain moves over milliseconds and keeps each wave's shape, and undoing it is an expander's work, not a repair's. Sound with no rail, no band and no curve comes back bit-exact: none of 1736 clean recordings, as they are, peak-normalized, or driven 12 dB into a lookahead limiter, shows one (VoiceBank+DEMAND's 1328 utterances, MUSDB18's 144 mixtures whole, the survey's ten SQAM excerpts, the four pieces whole, ten Spoken Wikipedia narrations, 100 VocalSet takes, 120 GuitarSet takes, 20 Slakh mixes), nor do sines from 50 Hz to 5 kHz. The most any gains is 0.01 nats a sample, VocalSet's sung long tones, whose curve leaves the loudest peak 0.6–0.9 of its slope; MUSDB18's mixtures, as they are and limited, 10⁻⁴. On the tuning material of the comparison below, saturation to 10 dB SDR gains 0.07–0.23 nats a sample on speech and 0.5–1.1 on music, its peaks bent to 1/17 of their slope or less; the slope's limit, 40, was chosen there: against 10 and 20, up to 9 dB more on its tanh-saturated mixtures, the same on its speech and under curves outside the two (arctan, a side's ceiling apart, hiss after the curve). The screen costs about a tenth of a second on clean sound; a fit, a few seconds.

Every sample at a rail is then rebuilt three times, each rebuild held at least as far out as the sample was recorded (a clip only ever lowers a sample). AR: per window of 186 ms, AR(256) fitted under its taper, every unknown solved at once by exact least squares ([`lpc`](https://github.com/audiojs/denoise/tree/main/packages/lpc)'s `arFill`), refitted and solved again until the fill moves by under 1 %, at most 8 times (Janssen, Veldhuis & Vries 1986). Sparse: A-SPADE (Kitić, Bertin & Gribonval 2015) as the declipping survey's code runs it (Záviška, Rajmic, Ozerov & Rencker 2021), the fewest DFT lines that agree with what was recorded, per block of 93 ms and per block of 186 ms: the long block resolves a held note's partials (a held chord clipped to 1 dB, half a second: 11.6 → 14.2 dB), the short one follows speech and attacks. No one of the three wins everywhere, so they are blended, region by region, by weights chosen by cross-validation (Stone 1974; stacked regressions, Breiman 1996): the clipped sound is clipped once more, at the level that takes as large a share of what the first clip left as the first took of the whole; each method rebuilds that; the weights, on a grid of tenths over the three, are those whose blend lies nearest what is known there (the samples the second clip hid, and the bounds of those the first took), read per 93 ms over ±1 s. A blend of consistent rebuilds is consistent; each rebuild runs only where its weight is not 0. Samples off the rails come back bit-exact; a sound over 30 s is rebuilt in pieces crossfaded over 2 s.

```js
declip(data, { fs: 44100 })                                    // each side's rail (or band, or curve) found; none: untouched
declip(data, { fs: 44100, clipLevel: 0.95 })                   // a known rail, ±0.95
```

| Param | Default | |
|---|---|---|
| `clipLevel` | auto | the rail, ± this; omitted or 0: found per side (a rail, a band, or a curve) |
| `order` | `256` | AR order of the AR rebuild; `512` takes it on dense music up to 2 dB closer, in about 3× the time |
| `fs` | `44100` | sample rate, Hz |

`node scripts/declip.js` clips speech (audio-lena) and music ("Vibe Ace", Brahms, the trumpet loop, as `repair`), 6 s of each, peak-normalized and cut at the level that leaves the clipped sound 1–20 dB from the original (the input SDR of the declipping survey), and measures the SDR after, dB, declip (finding the rails itself) · FFmpeg `adeclip` at its defaults:

| input SDR | 1 dB | 3 dB | 7 dB | 10 dB | 15 dB | 20 dB |
|---|---:|---:|---:|---:|---:|---:|
| speech | 8.5 · 1.1 | 10.9 · 5.0 | 24.1 · 12.1 | 31.7 · 16.9 | 38.2 · 24.0 | 42.8 · 30.5 |
| "Vibe Ace" | 8.4 · 1.6 | 13.8 · 5.0 | 19.7 · 10.3 | 24.4 · 14.0 | 31.4 · 19.9 | 36.3 · 24.6 |
| Brahms | 7.2 · 0.6 | 13.4 · 3.9 | 19.3 · 10.2 | 23.1 · 14.4 | 29.2 · 19.8 | 35.9 · 23.8 |
| trumpet | 6.6 · 1.3 | 16.7 · 4.1 | 31.4 · 10.4 | 42.8 · 14.8 | 46.2 · 21.4 | 59.7 · 25.0 |

0.3.0 (the AR rebuild and the 93 ms sparse one), 1–20 dB: speech 8.4 / 10.9 / 24.2 / 31.9 / 38.3 / 42.6, "Vibe Ace" 6.9 / 13.1 / 19.1 / 22.7 / 31.4 / 36.2, Brahms 6.9 / 12.7 / 18.9 / 22.8 / 29.2 / 35.8, the trumpet 6.1 / 16.8 / 31.4 / 44.7 / 46.5 / 60.3: the long blocks gain up to 1.7 dB on the music, the trumpet at 10 dB loses 1.9. On the survey's own test, its ten SQAM excerpts (solo instruments and an ensemble, 44.1 kHz) clipped by its `clip_sdr.m`, mean ΔSDR over the clipped samples, dB, and PEAQ's ODG (Kabal's implementation as the survey ran it, ported in [audio](https://github.com/audiojs/audio)'s `bench/rx/peaq.py`: the survey's grades of its clipped inputs to within 0.0015), beside the means it publishes for its leading methods (code and results: [declipping2020_codes](https://github.com/rajmic/declipping2020_codes); PEAQ with the reliable samples replaced, as declip keeps them):

| input SDR | 1 dB | 3 dB | 5 dB | 7 dB | 10 dB | 15 dB | 20 dB | mean ΔSDR | mean ODG |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| declip | 9.7 | 14.0 | 15.6 | 16.7 | 18.5 | 20.5 | 22.1 | 16.7 | −1.84 |
| declip 0.3.0 | 8.3 | 13.2 | 14.8 | 15.8 | 17.6 | 19.7 | 21.9 | 15.9 | −1.95 |
| social sparsity, PEW (Siedenburg, Kowalski & Dörfler 2014) | 12.2 | 15.0 | 16.6 | 17.7 | 19.0 | 21.2 | 22.2 | 17.7 | −1.60 |
| A-SPADE | 11.9 | 13.9 | 15.1 | 16.0 | 17.3 | 19.4 | 20.3 | 16.3 | −2.40 |
| S-SPADE | 11.4 | 13.7 | 15.0 | 15.6 | 17.1 | 19.3 | 19.9 | 16.0 | −2.59 |
| ℓ1, parabola-weighted | 9.9 | 13.0 | 14.8 | 16.0 | 17.4 | 19.6 | 21.0 | 16.0 | −1.66 |
| NMF (Bilen, Ozerov & Pérez 2018) | 5.1 | 12.2 | 14.3 | 16.2 | 18.0 | 20.6 | 22.0 | 15.5 | −1.46 |
| Janssen (AR) | −0.9 | −1.3 | 0.6 | 3.5 | 7.9 | 17.0 | 19.6 | 6.6 | −2.28 |
| iZotope RX 12 De-clip, tuned (below) | 0.8 | 5.4 | 8.2 | 9.7 | 11.5 | 14.0 | 15.8 | 9.4 | −2.26 |

On the mean ΔSDR 2nd of the 7 (0.3.0: 5th), 1.0 dB behind social sparsity; from 3 dB up ahead of both SPADEs and ℓ1 at every level, of NMF but at 15 dB (0.1), behind social sparsity by 0.15–1.05 dB; at 1 dB behind A-SPADE by 2.2 and social sparsity by 2.5. On ODG 4th, behind NMF, social sparsity and ℓ1 by 0.18–0.38, at 3–7 dB by up to 0.7. The blend misjudges some held tones: the clarinet clipped to 15 dB comes back 17.1 dB, its 186 ms sparse rebuild alone 22.1 (the second clip scores a fill's overshoot inside the first clip's runs as nothing, only its bound being known there). On VoiceBank speech (below) it is 0.3.0 within 0.1 dB at every level.

Against iZotope RX 12 Advanced De-clip (VST3 hosted by Pedalboard, output aligned to the input; [audio](https://github.com/audiojs/audio)'s `bench/rx/declip.mjs`, 2026-10), through `audio`'s `declip()`. Test: the ten SQAM excerpts; "other music", four MUSDB18 test mixtures and "Vibe Ace", Brahms, the trumpet and the Sugar Plum Fairy (6 s each); speech, 16 VoiceBank clean test utterances. Each clipped at the level leaving it 1–20 dB from the original and scaled so its rails sit at 0 dBFS; asym: the positive rail at the 15 dB level, the negative at the 7 dB level; down: the 7 dB clip turned down 6 dB; MP3: the 7 dB clip through LAME at 128 kbit/s; soft: tanh(g·x), g giving 10 dB (analog saturation, no rail); atan: (2/π)·arctan(π/2·g·x) likewise, a softer knee outside both of declip's curves. RX at its defaults (threshold −1.02 dBFS, quality Low, post-limiter on), and tuned per condition and kind on other material (four MUSDB18 training mixtures, ten VoiceBank training utterances): asymmetric thresholds at each side's peak plus an offset (−0.07 to −6 dB) × quality, post-limiter off; its best: −0.07 dB on flat rails (High; Low or Medium on some speech conditions), High at −2 dB on MP3, −2 (music) and −4 (speech) on soft, −2 and −6 on atan. Mean ΔSDR, dB, RX default · RX tuned · declip:

| condition | SQAM | other music | speech |
|---|---:|---:|---:|
| 1 dB | −0.8 · 0.8 · 9.7 | −0.8 · −0.6 · 6.2 | −0.8 · −0.4 · 5.8 |
| 3 dB | −1.4 · 5.4 · 14.0 | −1.6 · 1.5 · 10.4 | −1.5 · 2.3 · 8.7 |
| 5 dB | −1.9 · 8.2 · 15.6 | −2.2 · 3.5 · 12.0 | −2.1 · 4.7 · 10.0 |
| 7 dB | −2.4 · 9.7 · 16.7 | −2.6 · 4.8 · 12.8 | −2.6 · 7.0 · 10.5 |
| 10 dB | −3.2 · 11.5 · 18.5 | −3.2 · 6.3 · 14.5 | −3.5 · 8.2 · 10.1 |
| 15 dB | −4.3 · 14.0 · 20.5 | −3.9 · 8.3 · 14.5 | −4.8 · 10.7 · 12.2 |
| 20 dB | −5.1 · 15.8 · 22.1 | −4.4 · 9.4 · 15.6 | −5.9 · 11.4 · 13.0 |
| asym | −1.4 · 12.0 · 18.4 | −0.9 · 6.4 · 14.2 | −2.1 · 10.5 · 12.0 |
| down | 0.0 · 9.7 · 16.7 | 0.0 · 4.8 · 12.8 | 0.0 · 6.8 · 10.5 |
| MP3 | −2.0 · 7.1 · 11.7 | −2.2 · 3.5 · 9.2 | −2.2 · 5.2 · 9.5 |
| soft | −0.8 · 0.6 · 40.0 (0.4.0: 0.0; its level given: 1.6) | −0.7 · 0.2 · 39.9 (0.0; 2.0) | −1.0 · 2.2 · 20.0 (0.0; 5.1) |
| atan | −0.0 · 0.2 · 16.7 | −0.0 · 0.0 · 17.0 | −0.0 · 1.1 · 17.3 |

Perceptually the same order: PEAQ ODG on the music, PESQ (wideband, 16 kHz) on speech, input · RX tuned · declip: 7 dB, SQAM −3.75 · −2.44 · −1.74, other music −3.65 · −2.72 · −1.85, speech 2.10 · 3.42 · 3.85; 20 dB −2.35 · −0.39 · −0.18, −1.29 · −0.23 · −0.12, 3.69 · 4.50 · 4.56; MP3 −3.49 · −3.27 · −2.78, −3.60 · −3.21 · −2.77, 2.10 · 3.05 · 3.74; soft −2.86 · −2.84 · 0.11, −2.51 · −2.40 · 0.16, 3.12 · 3.41 · 4.60 (0.4.0, its level given: −2.75, −2.21, 3.85); atan −2.87 · −2.86 · −0.88, −2.50 · −2.46 · −0.32, 3.20 · 3.22 · 4.49. RX at its defaults takes SDR off everywhere: its post-limiter holds the restored peaks to 0 dBFS, and its threshold finds nothing on rails under −1 dBFS (down). On the unclipped recordings peak-normalized to 0 dBFS, and through a lookahead limiter 12 dB over a −0.2 dBFS ceiling, declip changes no sample; RX changes them (SDR to its input, median: defaults 59–68 dB, 43–49 limited; tuned 77–94, 58–74). On soft saturation 0.4.0 found no rail and returned it untouched; given the level RX's tuned threshold sits at, `declip({ clipLevel })` gained 1.6–5.1 dB. 0.5.0 fits the curve itself (on all 34 takes of each: 0.07–2.2 nats a sample under tanh, 0.05–1.3 under arctan, the peaks bent to 1/24 and 1/9 of their slope or less): under tanh, one of its curves, 20–40 dB; under arctan, outside both, 16.7–17.3; RX tuned 0.0–2.2 on either. The other conditions' 340 clipped takes each have a rail or a band, found as 0.4.0 finds them, so 0.5.0 takes 0.4.0's path there and its numbers are 0.4.0's (asym, rendered again: the same to the sample).

Under curves outside its two and the noise a real chain adds after the curve, `declip` alone (`node bench/rx/declip.mjs curves`, the same test material), SDR in → out, dB, SQAM · other music · speech: x/√(1 + x²) to 10 dB, 29.7 · 28.7 · 28.3; tanh with the negative ceiling at 0.7, 22.8 · 23.0 · 23.1; a biased tanh, tanh(x + 0.3) − tanh(0.3) (even harmonics, a valve's), 13.0 · 12.6 · 14.8; tanh to 20 dB, 50.4 · 63.4 · 26.1; to 30 dB, 35.6 · 34.7 · 30.0 (speech bent so little is left as it is); tanh to 10 dB, then hiss 60 dB under full scale, 22.4 · 22.1 · 23.0. Hiss draws the fitted ceiling outward, a biased curve is fitted by an unbiased one: still well over the input, short of the curves it fits exactly.

Rails are found at the 20 dB level clipped asymmetrically (with the 10 dB level below), on one side only, then turned down to 0.4, quantized to 16 bits plain or dithered, and on a 16-bit converter driven 2.5 dB over (rails at 32767 and −32768): 13 dB or more of SDR gained in each; through MP3 and AAC at 128 kbit/s, bands: speech 18.0 → 25.2 and 19.9 → 31.6, "Vibe Ace" 18.3 → 25.1 and 19.8 → 28.7, Brahms 18.2 → 24.8 and 19.6 → 28.0, the trumpet 18.1 → 24.9 and 19.3 → 26.9 dB (0.3.0: untouched). The unclipped material through it, as it is, peak-normalized, at 16 bits and through a lookahead limiter 12 dB over its ceiling: not a sample changed; nor in any of VoiceBank+DEMAND's 824 clean test utterances. The third rebuild costs time: 1.2–2.1× 0.3.0's side by side (0.3.0: about 7 s per second of sound averaged over the six levels, most of it at 1–3 dB), the AR rebuild's early stop giving some back (speech clipped to 3 dB: 0.8×).

**Use when:** digital clipping: a converter overdriven, a mix bounced too hot, a plug-in's hard clip; at any level, on either side or both; also after it went through MP3, AAC or Opus; soft saturation, a valve, transistor or tape stage driven hot, found by itself.<br>
**Not for:** a limiter's or a compressor's work (a gain that moves, no curve: left as it is); saturation with memory (tape's hysteresis, a stage whose bias shifts with the level), where a curve fitted to the whole take is only near; clipping that has since been resampled or heavily filtered.

---

Part of [@audio/denoise](https://github.com/audiojs/denoise) — the denoise family umbrella. This README is generated from the umbrella docs.

MIT © [audiojs](https://github.com/audiojs)
