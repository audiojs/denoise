# @audio/noise-estimate

> Noise power-spectral-density estimation — the noise floor that spectral denoisers subtract.

Stateful estimators over STFT magnitude frames. Feed them per-frame; read `.psd` (a `Float64Array` of `N/2+1` bins) whenever you need the current noise estimate.

```js
import { minStats } from '@audio/noise-estimate'
import { stftAnalyse } from '@audio/stft'

let est = minStats(1024, { D: 96 })          // half = frameSize/2
stftAnalyse(signal, mag => est.update(mag), { frameSize: 2048 })
let noisePsd = est.psd                        // drive Wiener / MMSE / OM-LSA gain
```

## `minStats(half, opts?)`

Minimum Statistics (Martin 2001): the minimum of the recursively smoothed periodogram over the last `D` frames, times the bias compensation B<sub>min</sub> that makes it estimate the noise power rather than its lower tail. `opts`: `D` (window frames, default 96: 1.1 s at hop 512, 44.1 kHz), `alpha` (smoothing, 0.7), `bias` (default B<sub>min</sub>(D, α), Martin 2001 eq. 17: 3.44 for the defaults; the window's mean caps it either way). Returns `{ psd, bias, update(mag) }`.

Once the window holds `D` frames, the estimate never exceeds their mean. B<sub>min</sub> is Gaussian noise's ratio of mean to minimum; a steady line (a whine, a pilot tone, a carrier) hardly swings, its minimum is its mean, and B<sub>min</sub> put it 5–7 dB over (6.5 dB in `@audio/denoise-wiener`'s 1.5 s window at 44.1 kHz, where the line then came through 6 dB louder than on its learned profile). The noise holds no more power than its bin: the window's mean caps it, and where the bin swings as noise or speech does, the minimum governs. Before the window is full the minimum alone counts: over fewer frames B<sub>min</sub>(D) runs over the Gaussian bias of that window, and the mean would undercut it everywhere.

The smoother starts as the mean of the frames so far, and its values enter the minimum once its memory, ⌈1/(1−α)⌉ frames (4 at α 0.7), is full; until then that mean is the estimate. Frames of digital silence are skipped: neither a warm-up from zero nor an edited-out pause becomes the window's minimum. Before 2.2.0 the smoother started on the first frame's periodogram, which swings over 2 degrees of freedom rather than the smoothed 2(1+α)/(1−α) B<sub>min</sub> is for: 1 % of bins started 20 dB low and the minimum held them there for D frames (on white noise in a 1.5 s window at 48 kHz, 2.6 % of bins 10 dB under over the first window; now 0.09 %). On white Gaussian noise through 2048/512 Hann frames the estimate's mean is 0.4–0.7 dB under the noise power for D 48–96 and α 0.7–0.95 (the cap takes 0.03–0.35 dB of it, where P<sub>min</sub>·B<sub>min</sub> spreads over the mean).

## `imcra(half, opts?)`

Improved Minima Controlled Recursive Averaging (Cohen 2003): recursive averaging of the noisy power, frozen by the speech presence probability, with that probability from two iterations of time–frequency smoothing and minimum tracking. As the paper (eqs. 7, 10–12, 14–29, Table I), with Cohen's own `omlsa.m` for what it leaves open; `scripts/reference.py` in [@audio/denoise](https://github.com/audiojs/denoise) is written from the paper and reproduces `omlsa.m` to the last bit on VoiceBank frames (but for near-empty bins, where `omlsa.m`'s absolute 1e-10 floors bind), and test.js holds this code to it.

`opts`: `fs` and `hop` (the frame step: Table I's constants are for 8 ms frames and are rescaled to it, the decision-directed α among them, so time constants and the ~1 s minimum window hold in seconds; without them the constants apply per frame), `alpha` (α<sub>s</sub>, 0.9), `alphaD` (α<sub>d</sub>, 0.85), `beta` (1.47), `bMin` (1.66), `gamma0` (4.6), `gamma1` (3), `zeta0` (1.67), `w` (1), `U` (8), `V` (15 frames of 8 ms), `alphaDD` (0.92 per 8 ms) and `xiMin` (−25 dB) for the decision-directed a priori SNR. Until 2.2.0 `alphaDD` applied per frame, whatever the frame: its memory ran 1.8× longer at 48 kHz (10.7 ms steps) than at 44.1 kHz (5.8 ms).

Returns `{ psd, xi, xi0, gamma, v, gain, p, frames, update(mag, spp?) }`: per frame, on the updated noise estimate, the a priori SNR ξ (`xi0`: on the previous estimate, what the speech presence probability used), the a posteriori SNR γ, v = γξ/(1+ξ), the LSA gain G<sub>H1</sub> and the speech presence probability p. `spp` (a number or per-bin array) replaces p. Digital silence is skipped. On white Gaussian noise the estimate's mean is within 0.4 dB of the noise power at 16, 44.1 and 48 kHz.

## `noiseProfile(data, opts?)`

One-shot baseline: averages |X|² over a quiet segment (`opts.from`/`opts.to` samples). Returns a `Float64Array` PSD. Use when you can point at a known noise-only region.

## `known(profile, opts?)`

A noise known rather than tracked: `profile` (a `noiseProfile`) is held, and each `update(mag)` gives what `imcra` gives on it: ξ, decision-directed on G<sub>H1</sub> (`alphaDD` 0.92 per 8 ms, rescaled to the frame step given `fs` and `hop` as `imcra`'s; `xiMin` −25 dB), γ, v and G<sub>H1</sub>, so a gain written for `imcra` (OM-LSA's) runs on a learned noise unchanged. `xi0` is `xi`; `p` stays 0. Digital silence is skipped.

## References

R. Martin, "Noise power spectral density estimation based on optimal smoothing and minimum statistics", IEEE Trans. Speech Audio Process. 9(5), 2001 · R. Martin, "Bias compensation methods for minimum statistics noise power spectral density estimation", Signal Processing 86, 2006 (M(D), Table 5) · I. Cohen, "Noise spectrum estimation in adverse environments: improved minima controlled recursive averaging", IEEE Trans. Speech Audio Process. 11(5), 2003 · I. Cohen, `omlsa.m`, [israelcohen.com/software](https://israelcohen.com/software/).

## Notes

STFT via [`@audio/stft`](https://github.com/audiojs/stft); pairs with [`@audio/vad`](https://github.com/audiojs/denoise/tree/main/packages/vad)'s `spp()`. Also re-exported from [`@audio/denoise`](https://github.com/audiojs/denoise). MIT.
