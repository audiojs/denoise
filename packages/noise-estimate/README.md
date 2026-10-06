# @audio/noise-estimate

> Noise power-spectral-density estimation — the noise floor that spectral denoisers subtract, kept off a program's held notes.

Stateful estimators over STFT magnitude frames. Feed them per-frame; read `.psd` (a `Float64Array` of `N/2+1` bins) whenever you need the current noise estimate.

```js
import { minStats } from '@audio/noise-estimate'
import { stftAnalyse } from '@audio/stft'

let est = minStats(1024, { D: 96 })          // half = frameSize/2
stftAnalyse(signal, mag => est.update(mag), { frameSize: 2048 })
let noisePsd = est.psd                        // drive Wiener / MMSE / OM-LSA gain
```

## `minStats(half, opts?)`

Minimum Statistics (Martin 2001): the minimum of the recursively smoothed periodogram over the last `D` frames, times the bias compensation B<sub>min</sub> that makes it estimate the noise power rather than its lower tail. `opts`: `D` (window frames, default 96: 1.1 s at hop 512, 44.1 kHz), `alpha` (smoothing, 0.7), `bias` (default B<sub>min</sub>(D, α), Martin 2001 eq. 17: 3.44 for the defaults; the window's mean caps it either way), `partials` (with `fs` and `hop`: see [`partials`](#partialsbins-opts)). Returns `{ psd, bias, partials, update(mag) }`.

Once the window holds `D` frames, the estimate never exceeds their mean. B<sub>min</sub> is Gaussian noise's ratio of mean to minimum; a steady line (a whine, a pilot tone, a carrier) hardly swings, its minimum is its mean, and B<sub>min</sub> put it 5–7 dB over (6.5 dB in `@audio/denoise-wiener`'s 1.5 s window at 44.1 kHz, where the line then came through 6 dB louder than on its learned profile). The noise holds no more power than its bin: the window's mean caps it, and where the bin swings as noise or speech does, the minimum governs. Before the window is full the minimum alone counts: over fewer frames B<sub>min</sub>(D) runs over the Gaussian bias of that window, and the mean would undercut it everywhere.

The smoother starts as the mean of the frames so far, and its values enter the minimum once its memory, ⌈1/(1−α)⌉ frames (4 at α 0.7), is full; until then that mean is the estimate. Frames of digital silence are skipped: neither a warm-up from zero nor an edited-out pause becomes the window's minimum. Before 2.2.0 the smoother started on the first frame's periodogram, which swings over 2 degrees of freedom rather than the smoothed 2(1+α)/(1−α) B<sub>min</sub> is for: 1 % of bins started 20 dB low and the minimum held them there for D frames (on white noise in a 1.5 s window at 48 kHz, 2.6 % of bins 10 dB under over the first window; now 0.09 %). On white Gaussian noise through 2048/512 Hann frames the estimate's mean is 0.4–0.7 dB under the noise power for D 48–96 and α 0.7–0.95 (the cap takes 0.03–0.35 dB of it, where P<sub>min</sub>·B<sub>min</sub> spreads over the mean).

## `imcra(half, opts?)`

Improved Minima Controlled Recursive Averaging (Cohen 2003): recursive averaging of the noisy power, frozen by the speech presence probability, with that probability from two iterations of time–frequency smoothing and minimum tracking. As the paper (eqs. 7, 10–12, 14–29, Table I), with Cohen's own `omlsa.m` for what it leaves open; `scripts/reference.py` in [@audio/denoise](https://github.com/audiojs/denoise) is written from the paper and reproduces `omlsa.m` to the last bit on VoiceBank frames (but for near-empty bins, where `omlsa.m`'s absolute 1e-10 floors bind), and test.js holds this code to it.

`opts`: `fs` and `hop` (the frame step: Table I's constants are for 8 ms frames and are rescaled to it, the decision-directed α among them, so time constants and the ~1 s minimum window hold in seconds; without them the constants apply per frame), `alpha` (α<sub>s</sub>, 0.9), `alphaD` (α<sub>d</sub>, 0.85), `beta` (1.47), `bMin` (1.66), `gamma0` (4.6), `gamma1` (3), `zeta0` (1.67), `w` (1), `U` (8), `V` (15 frames of 8 ms), `alphaDD` (0.92 per 8 ms) and `xiMin` (−25 dB) for the decision-directed a priori SNR, `partials` ([`partials`](#partialsbins-opts)). Until 2.2.0 `alphaDD` applied per frame, whatever the frame: its memory ran 1.8× longer at 48 kHz (10.7 ms steps) than at 44.1 kHz (5.8 ms).

Returns `{ psd, xi, xi0, gamma, v, gain, p, frames, update(mag, spp?) }`: per frame, on the updated noise estimate, the a priori SNR ξ (`xi0`: on the previous estimate, what the speech presence probability used), the a posteriori SNR γ, v = γξ/(1+ξ), the LSA gain G<sub>H1</sub> and the speech presence probability p. `spp` (a number or per-bin array) replaces p. Digital silence is skipped. On white Gaussian noise the estimate's mean is within 0.4 dB of the noise power at 16, 44.1 and 48 kHz.

## `partials(bins, opts?)`

A program's partials kept out of a tracked noise. Minimum statistics and IMCRA take whatever holds a bin for about a second as noise: a held note, a sustained vowel, a chord's partials were learned, and the gain built on the estimate took them down. `update(y2, psd)`, each frame after the tracker's own update, reads where a partial stands and there holds `psd` at what the bin held before the partial came:

- P, |Y|² smoothed over 30 ms, and F, its morphological opening across frequency (the least over ±4 bins, then the largest of that over ±4): a peak narrower than 9 bins is taken off, the floor between partials stays (the inverse harmonic mask of Nelke, Naylor & Vary, ICASSP 2015).
- A partial: P over 6 F (7.8 dB) within ±1 bin (vibrato, a glide) for 0.3 s running, and 10 dB over the bin's noise memory. It and its Hann main lobe (±2 bins) are held; a held bin stays held while the tracker reads it 6 dB over its memory, for the tracker still holds what the partial left after it ends.
- The memory: the tracker's estimate averaged over the bin's free frames (neither peaked nor held), per eighth of `T` (60 s), the least of the last eight.

A line steady from the take's start (hum, a fan's whine, an engine) has no free frame and no memory: it stays noise. One that starts mid-take is held as a partial until its bin has had no free frame for `T`, then it is learned, as is a note held longer. A note sounding from the first frame is learned until its bin is once free of it: nothing tells it from a line there. On Gaussian noise alone nothing is held, and the estimate is the tracker's to the bit. Returns `{ flag, lines, mem, update }`: `flag`, the bins held this frame; `lines`, the bins with no free frame in the window that have peaked for `T`/8 running or more (the lines of a noise bed, or a note sounding since the take began); `mem`, the memory. `opts`: `dt` (the frame step, s) and `T`.

`minStats` and `imcra` take it as `partials: true` (or its options) with `fs` and `hop`; their estimators then carry it as `.partials`. Off by default here; `@audio/denoise-omlsa`, `-wiener` and `-spectral` turn it on. The 0.3 s, the 10 dB and the 60 s were chosen on VoiceBank+DEMAND training speech, four music recordings and VocalSet long tones (scripts/broadband.mjs in [@audio/denoise](https://github.com/audiojs/denoise)): held from 54 ms on, the guard also held down a noise rising under a voice's harmonics (PESQ −0.015); without the 10 dB rise over the memory, a noise's own peaks were held as partials; a 10 s window let a song's repeated chords be learned (Slakh mixes cut six times as much).

## `noiseProfile(data, opts?)`

One-shot baseline: averages |X|² over a quiet segment (`opts.from`/`opts.to` samples). Returns a `Float64Array` PSD. Use when you can point at a known noise-only region.

## `known(profile, opts?)`

A noise known rather than tracked: `profile` (a `noiseProfile`) is held, and each `update(mag)` gives what `imcra` gives on it: ξ, decision-directed on G<sub>H1</sub> (`alphaDD` 0.92 per 8 ms, rescaled to the frame step given `fs` and `hop` as `imcra`'s; `xiMin` −25 dB), γ, v and G<sub>H1</sub>, so a gain written for `imcra` (OM-LSA's) runs on a learned noise unchanged. `xi0` is `xi`; `p` stays 0. Digital silence is skipped.

## References

R. Martin, "Noise power spectral density estimation based on optimal smoothing and minimum statistics", IEEE Trans. Speech Audio Process. 9(5), 2001 · R. Martin, "Bias compensation methods for minimum statistics noise power spectral density estimation", Signal Processing 86, 2006 (M(D), Table 5) · I. Cohen, "Noise spectrum estimation in adverse environments: improved minima controlled recursive averaging", IEEE Trans. Speech Audio Process. 11(5), 2003 · I. Cohen, `omlsa.m`, [israelcohen.com/software](https://israelcohen.com/software/) · C. M. Nelke, P. A. Naylor, P. Vary, "Wind noise short term power spectrum estimation using pitch adaptive inverse binary masks", ICASSP 2015.

## Notes

STFT via [`@audio/stft`](https://github.com/audiojs/stft); pairs with [`@audio/vad`](https://github.com/audiojs/denoise/tree/main/packages/vad)'s `spp()`. Also re-exported from [`@audio/denoise`](https://github.com/audiojs/denoise). MIT.
