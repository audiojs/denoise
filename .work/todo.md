# noise-reduction — implementation plan

Order = build dependency + real-world impact. Tick top-down. See `methods.md` for full catalog.

## Phase 0 — Shared infrastructure

Reuse from `pitch-shift` where possible (don't duplicate). All STFT-based methods depend on this.

- [ ] `util.js` — `hannWindow`, `makeStreamBufs`, `writer`, dB/lin
- [ ] `stft.js` — frame/window/FFT/OLA/ISTFT (port from pitch-shift, audit fit)
- [ ] `ar.js` — Levinson-Durbin AR fit + LS interpolation for missing samples
- [ ] `noise.js` — `noiseProfile`, `minimumStatistics`, `imcra` estimators
- [ ] `vad.js` — energy + flatness + harmonic VAD; SPP for OM-LSA
- [ ] `quality.js` — SNR, segSNR, LSD, noise-floor reduction (test-only)
- [ ] `test.js` — harness, fixtures (clean speech + injected noise types)

## Phase 1 — Core denoise (v0.1, ~90% real cleanup)

Order: foundational → composes → specialized.

- [ ] `gate.js` — look-ahead noise gate, hysteresis, attack/hold/release
- [ ] `dehum.js` — adaptive notch cascade @ 50/60 Hz + harmonics
- [ ] `specsub.js` — Berouti over-subtraction + spectral floor (baseline broadband)
- [ ] `wiener.js` — MMSE-LSA + Minimum Statistics (transparent broadband)
- [ ] `omlsa.js` — OM-LSA + IMCRA (non-stationary noise)
- [ ] `declick.js` — AR + LS interpolation (Godsill-Rayner)
- [ ] `decrackle.js` — continuous-threshold AR interpolation
- [ ] `declip.js` — AR extrapolation + A-SPADE
- [ ] `dewind.js` — LPC-null post-filter + adaptive HPF
- [ ] `deplosive.js` — LF transient detector + local attenuation
- [ ] `deesser.js` — dynamic-EQ sibilance cut (5–9 kHz)
- [ ] `debreath.js` — VAD-inverse gate
- [ ] `dereverb.js` — Lebart late-reverb spectral subtraction
- [ ] `denoise.js` — content-aware auto-selector dispatching to above
- [ ] `index.js` — re-export all
- [ ] README — API + per-method usage, plots

## Phase 2 — Tier 2 (v0.2)

- [ ] `subspace.js` — truncated-SVD denoise (short signals)
- [ ] `wavelet.js` — VisuShrink + BayesShrink shrinkage
- [ ] `mouthDeclick.js` — mouth-tuned click detector
- [ ] `spectralRepair.js` — STFT-region inpaint / attenuate / pattern
- [ ] `nmf.js` — supervised NMF (with noise template)
- [ ] `hpss.js` — harmonic-percussive split
- [ ] `wpe.js` — single-channel Weighted Prediction Error dereverb
- [ ] `ambienceMatch.js` — PSD/LTAS match between clips

## Phase 3 — Out of scope (separate packages)

- `neural-denoise` — RNNoise / DTLN / DeepFilterNet (onnx/wasm)
- `stem-separate` — Demucs / MelBand-RoFormer
- Dialogue Isolate — neural source separation
