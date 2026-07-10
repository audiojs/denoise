# @audio/denoise-repair

> Spectral repair — interpolate short time×frequency gaps and holes (De-Slop; iZotope RX class)

Replaces time×frequency holes by interpolating the spectrogram across each region:
log-magnitude interpolated between the last clean frame before and first clean frame
after, phase advanced coherently from the leading context (phase-vocoder style).
Full-band regions repair dropouts/gaps; band-limited regions repair chirps/beeps/holes
without touching surrounding content.

```js
import repair from '@audio/denoise-repair'

let repaired = repair(data, { regions: [{ at: 1.2, duration: 0.05, from: 0, to: 3000 }] })
```

`repair(data: Float32Array, opts: {regions: Array<{at, duration, from=0, to=fs/2}> (seconds/Hz, required), frameSize=2048, hopSize=512, fs=44100}) → Float32Array`

## Install

```
npm i @audio/denoise-repair
```
