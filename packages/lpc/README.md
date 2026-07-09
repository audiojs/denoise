# @audio/lpc

> Linear predictive coding — model a signal as an autoregressive process, then predict, extrapolate, or fill gaps from it.

The Levinson-Durbin solution to the Yule-Walker equations, plus the AR-prediction tools that classical audio restoration is built on. Pure math, no dependencies.

```js
import { lpc, arExtrapolate, arInterpolate } from '@audio/lpc'

let { a, e } = lpc(window, 16)          // AR(16) coefficients a[], residual variance e
let filled = arExtrapolate(context, a, 32)   // project 32 samples forward (de-clip)
```

## `lpc(x, p)` / `arFit(x, p)`

LPC analysis of order `p` over window `x` (`lpc` is the conventional alias). Returns `{ a: Float64Array(p+1), e }` — `a[0] === 1`, `e` is the residual variance. Internally `levinson(autocorr(x, p), p)`.

## `autocorr(x, p)` · `levinson(R, p)`

The two stages, exposed separately: biased autocorrelation `R[0..p]`, and the Levinson-Durbin Toeplitz solve. Call directly when you already have an autocorrelation, or want the reflection-coefficient path.

## `arPredict(a, hist)`

One-step prediction `x̂[n] = -∑ a[k]·x[n−k]` from a history buffer.

## `arExtrapolate(context, a, m)`

Project `m` samples forward from `context` under model `a`. Used to reconstruct clipped regions from their un-clipped neighbourhood.

## `arInterpolate(x, gap, a)`

Least-squares fill of missing indices `gap` (sorted) inside `x`, in place, under model `a` — the interpolator behind de-click / de-crackle. Gauss-Seidel, converges well past audible accuracy for short bursts.

## Notes

Foundation for LPC vocoders and formant tracking (Markel & Gray 1976); restoration methods follow Godsill & Rayner (1998). Used by [`@audio/denoise`](https://github.com/audiojs/denoise)'s declick/decrackle/declip. MIT.
