# Noise reduction — complete method catalog

Reference for the `noise-reduction` package. Organized three ways: by problem (what noise), by algorithm family, and by iZotope RX module (so we know which commercial behaviors map to which DSP). Final section proposes package scope.

"★" = recommended for the package. "☆" = nice-to-have. "∅" = out of scope for pure-DSP library (neural / licensed / commercial).

---

## 1. Taxonomy by noise type

What you're trying to remove drives which algorithm family applies.

| Noise class | Examples | Stationary? | Natural method family |
|---|---|---|---|
| Broadband hiss | tape, preamp, room tone, fan, HVAC | yes | spectral subtraction, Wiener, MMSE-LSA, gate |
| Quasi-stationary ambience | traffic rumble, AC, constant crowd | slow-varying | OM-LSA, IMCRA, minimum statistics |
| Non-stationary ambient | babble, kitchen noise, intermittent | no | OM-LSA, neural (∅), NMF-supervised |
| Tonal / mains hum | 50/60 Hz + harmonics, ground loop, whine | periodic | adaptive notch cascade, phase-locked subtraction |
| Impulsive | vinyl clicks, crackle, digital pops, edit clicks | transient | AR interpolation, median, wavelet threshold |
| Clipping | over-level saturation | static | AR extrapolation, SPADE, social sparsity |
| Wind / LF rumble | outdoor mic wind, handling noise, footsteps | non-stationary bursts | LPC-null post-filter, adaptive HPF |
| Plosives | 'p', 'b' in close-mic voice | short-time LF bursts | LF transient detector + attenuation |
| Sibilance | 's', 't', 'sh' harshness | short-time HF bursts | dynamic EQ / split-band compressor |
| Mouth noise | lip smacks, mouth clicks, saliva | short bursts | mouth-specific click detector + interpolation |
| Breath | between phrases | short, low-energy | VAD-inverse gate / level-based duck |
| Reverb / room | late reflections, excessive RT60 | convolutional | WPE, spectral late-reverb subtraction, cepstral |
| Bleed / crosstalk | drums in vocal mic, other sources | non-stationary | adaptive filter (reference), NMF, stem-sep |

---

## 2. Algorithm family catalog

Every known method, grouped by family. References in parentheses.

### 2.1 Gating / Expansion (time-domain amplitude)
- **★ Noise gate** — threshold + attack/hold/release (FFmpeg `agate`, classic)
- **★ Downward expander** — soft-ratio gate below threshold
- **Upward expander** — expand below threshold upward (restore dynamics)
- **Multi-band expander** — per-band gate (e.g. low-freq rumble gate only)
- **Look-ahead gate** — delay line so attack opens *before* transient
- **Hysteresis gate** — separate open/close thresholds, avoids chatter
- **Sidechain-keyed gate** — trigger from external signal

### 2.2 Spectral subtraction family (STFT magnitude)
- **★ Boll (1979)** — classic, subtract noise magnitude, inverse STFT with noisy phase
- **★ Over-subtraction + spectral floor (Berouti 1979)** — `α·N̂` with floor β to suppress musical noise
- **Power spectral subtraction** — subtract in |·|² domain
- **Magnitude spectral subtraction** — subtract in |·| domain
- **Multi-band spectral subtraction (Kamath-Loizou 2002)** — per-band α, gentler on speech
- **Non-linear spectral subtraction (Lockwood-Boudy)** — SNR-dependent α
- **Parametric α-β spectral subtraction** — continuous musical-noise control
- **Iterative spectral subtraction (IKF-style)** — refine estimate across iterations
- **Perceptually-weighted subtraction** — spectral gain shaped by masking threshold

### 2.3 Statistical estimators (STFT, Bayesian)
- **★ Wiener filter (classical)** — `G(k) = ξ / (ξ+1)`, ξ = a priori SNR
- **Parametric Wiener** — exponent on gain for tradeoff
- **★ MMSE-STSA (Ephraim-Malah 1984)** — short-time spectral amplitude, Bessel-function gain
- **★ MMSE-LSA (Ephraim-Malah 1985)** — log-spectral amplitude, transparent on speech
- **★ OM-LSA (Cohen 2002)** — Optimally Modified LSA with speech presence probability
- **Super-Gaussian MMSE (Martin 2005)** — Laplacian / Gamma priors instead of Gaussian
- **Bayesian MMSE-STSA (Chen-Loizou 2007)** — Chi / Gamma priors
- **Generalized Gamma MMSE (Erkelens)** — flexible speech prior
- **Weighted Euclidean MMSE (Loizou)** — perceptually weighted distortion
- **Phase-aware MMSE (Gerkmann 2014)** — joint amplitude+phase estimation
- **Complex-ratio mask (CRM)** — complex gain, precursor to neural methods

### 2.4 Noise PSD estimation (supporting — drives all statistical estimators)
- **★ Noise profile** — user selects quiet segment, average `|X|²`
- **Voice-activity-gated recursive averaging** — update only when VAD=noise
- **★ Minimum Statistics (Martin 2001)** — minima of smoothed spectrum in sliding window
- **MCRA (Cohen 2002)** — Minima Controlled Recursive Averaging
- **★ IMCRA (Cohen 2003)** — Improved MCRA, two-iteration smoothing
- **MMSE noise estimator (Gerkmann-Hendriks 2012)** — SPP-driven recursive update
- **Connected TF estimator** — exploits time-freq continuity

### 2.5 Voice Activity Detection (supporting)
- **Energy threshold** — simplest, frame RMS vs floor
- **ZCR + energy** — zero-crossing rate combined with energy
- **Spectral flatness / entropy** — tonal vs noise discrimination
- **Harmonic product spectrum** — periodicity test
- **ITU-T G.729 Annex B** — LP + spectral features
- **WebRTC VAD** — Gaussian mixture, 6-band
- **Silero VAD (∅)** — DNN, not pure DSP
- **Speech Presence Probability (SPP)** — soft VAD (drives OM-LSA, IMCRA)

### 2.6 Subspace / low-rank methods
- **★ Truncated SVD** — keep top-k singular values of Hankel matrix
- **Karhunen-Loève thresholding** — KLT basis, shrink low-variance components
- **Ephraim–Van Trees (1995)** — signal subspace speech enhancement
- **Generalized subspace for colored noise (Hu-Loizou)** — pre-whitening
- **GSVD-based (Jensen-Hansen)** — generalized SVD on signal+noise
- **Robust PCA** — `L + S` low-rank + sparse (noise as outliers)
- **Triangular decompositions (ULV, URV, VSV)** — rank-revealing alternatives

### 2.7 Wavelet / time-frequency thresholding
- **★ VisuShrink (Donoho-Johnstone 1994)** — universal threshold `σ√(2 log N)`, hard/soft
- **★ SureShrink** — Stein's Unbiased Risk Estimate, data-adaptive per level
- **BayesShrink** — per-subband Bayesian threshold
- **Translation-invariant (cycle-spin)** — avoids artefacts at shift-variance
- **Stationary Wavelet Transform (SWT)** — undecimated, better for audio
- **Wavelet packet denoising** — adaptive basis selection
- **Empirical Mode Decomposition (EMD)** — data-driven IMFs, threshold noisy modes
- **Block-thresholding** — shrink neighborhoods together (reduces artifacts)
- **Persistent empirical Wiener** — time-frequency-neighborhood aware

### 2.8 Adaptive filters (reference-based)
- **★ LMS (Widrow-Hoff)** — simplest adaptive, converges on reference correlation
- **★ NLMS (Normalized LMS)** — input-power-normalized step size
- **RLS (Recursive Least Squares)** — faster converge, higher cost
- **Adaptive Line Enhancer (ALE)** — no external reference, uses delayed version
- **Affine projection** — between LMS and RLS
- **Frequency-domain adaptive filter (FDAF)** — FFT-block LMS
- **Kalman filter** — optimal linear, handles time-varying noise statistics
- **Particle filter** — non-linear/non-Gaussian, rare for audio

### 2.9 Dictionary / source-model methods
- **★ NMF (Lee-Seung 1999)** — factorize |STFT|² ≈ W·H, non-negative
- **Supervised NMF** — pre-learn noise dictionary, fit speech online
- **Semi-supervised NMF** — partial dictionary learning
- **K-SVD** — sparse dictionary learning
- **Gaussian Mixture Model per class** — speech-vs-noise likelihood ratio
- **Hidden Markov Model enhancement (Ephraim 1992)** — state-dependent filtering
- **Codebook-constrained Wiener** — spectral envelope codebooks

### 2.10 Click / impulse removal
- **★ AR + LS interpolation (Godsill-Rayner 1998)** — detect via prediction residual, interpolate via least-squares on AR coefficients
- **AR + sinusoid model (Vaseghi-Rayner)** — add deterministic periodic basis
- **Sparse linear prediction (high-order)** — L1-regularized LP
- **Matched-filter detection → interpolation** — template for typical clicks
- **★ Median filter (1D, time-domain)** — simplest, destroys transients but removes isolated spikes
- **Hampel filter** — median with MAD threshold, keeps transients
- **Gabor regression (Wolfe-Godsill 2005)** — time-freq atom regression for missing data
- **Kalman smoother** — state-space missing-data interpolation
- **Bayesian burst removal** — MAP over click indicator + AR model
- **Wavelet-based detection** — high-frequency coefficients flag clicks
- **Cubic spline interpolation** — simple fallback baseline

### 2.11 De-clipping / clip restoration
- **★ AR extrapolation** — fit AR model to un-clipped context, predict into clipped region
- **★ A-SPADE / S-SPADE (Kitic 2015)** — analysis/synthesis Sparse Audio Declipper, consistency + sparsity
- **Consistent IHT (CIHT, Kitic 2013)** — iterative hard thresholding with consistency constraint
- **Social sparsity declipping (Siedenburg 2014)** — windowed group-Lasso, persistent empirical Wiener
- **Cosparse / analysis-based (Kitic-Jacques 2015)** — analysis dictionary sparsity
- **Dictionary-learned declipping** — K-SVD on clean data, reconstruct clipped
- **Perceptually-weighted (PSW-SPADE)** — masking-threshold weighted
- **Cubic / polynomial interpolation** — fill clipped region naively
- **Cosine / sinusoidal extrapolation** — for pure-tone clipping

### 2.12 Dehum / tonal removal
- **★ Static notch cascade** — biquad notches at 50/100/150… or 60/120/180… Hz
- **High-Q IIR notch** — per-harmonic, tunable Q
- **Comb filter** — single structure targeting fundamental + all harmonics
- **★ Adaptive notch (Lyon LMS)** — tracks drifting mains frequency
- **Phase-locked mains subtraction (Humbug-style)** — synthesize template, adaptive subtract
- **Goertzel-based tone tracking** — narrowband energy at suspected harmonics
- **Spectral masking at tonal peaks** — zero/attenuate peak bins in STFT
- **ANC against mains reference** — if separate reference signal available
- **PLL-locked notch** — phase-locked to detected fundamental, rejects harmonics together

### 2.13 Dereverberation
- **★ Cepstral mean subtraction (CMS)** — subtract long-term mean cepstrum
- **Late-reverb spectral subtraction (Lebart 2001)** — model late reverb as exponentially decaying noise
- **★ WPE (Nakatani 2010)** — Weighted Prediction Error, long-term LP in STFT
- **Multi-Channel Linear Prediction (MCLP)** — multi-mic extension of WPE
- **Blind MINT / inverse filtering** — invert estimated room response
- **Linear prediction residual excitation** — clean LP residual only
- **NMF-based dereverb** — reverb as a source to separate
- **Kalman dereverb** — state-space late reverb tracking
- **Spectral masking (late-reverb mask)** — time-freq gain tied to reverb energy estimate

### 2.14 Wind / rumble
- **★ Adaptive high-pass** — cutoff tracks detected wind energy
- **LPC-null post-filter (King-Atlas 2009)** — detect wind resonance via LPC, null it
- **Dual-mic coherence suppression** — wind is uncorrelated across mics
- **Band-limited energy VAD + attenuation** — detect LF-heavy bursts
- **Artificial bandwidth extension** — substitute damaged LF from HF content
- **Spectral-envelope reconstruction** — LPC-based envelope restore

### 2.15 Plosive removal
- **★ Low-freq transient detector + attenuation** — detect burst <250 Hz, attenuate locally
- **Dynamic HPF trigger** — HPF cutoff tracks plosive detection
- **Spectral pop detection + interpolation** — identify and replace plosive region
- **Linear-phase pop filter** — fixed HPF for always-on use

### 2.16 De-ess / sibilance
- **★ Split-band compressor** — HPF + compressor on sibilance band (5-9 kHz)
- **★ Dynamic EQ** — threshold-triggered bell cut
- **Spectral phase-linear de-ess** — STFT-based, no phase distortion
- **Transient-keyed de-ess** — only compress on detected sibilant transient
- **Sidechain-keyed de-ess** — detection on broader band, compression on narrow

### 2.17 Mouth / lip noise
- **★ Mouth-specific click detector** — wider than crackle, spectral signature in 1-4 kHz
- **Spectral click mask + interpolation** — STFT-domain region removal
- **Voice-model-aware interpolation** — fit LP to speech, fill from prediction

### 2.18 Breath control
- **★ VAD-inverse gating** — attenuate during detected non-speech
- **Spectral breath signature** — match breath noise template
- **Level-based auto-duck** — reduce gain during low-energy segments between phrases
- **ML breath detector (∅)** — iZotope's approach

### 2.19 Ambience / profile matching
- **★ Noise-floor match** — shape noise PSD of one clip to another
- **EQ match** — long-term average spectrum (LTAS) match, FIR or min-phase
- **Room tone generation** — synthesize ambience from profile (for fill)
- **Cross-fade ambience bed** — match + blend over edit boundaries

### 2.20 Neural / ML (∅ — reference only)
- **RNNoise (Valin 2018)** — GRU-based, tiny (~90k params)
- **NSNet / NSNet2 (Microsoft)** — reference baseline
- **DTLN (Westhausen-Meyer 2020)** — dual-signal LSTM
- **DeepFilterNet 1/2/3 (Schröter 2022-2023)** — two-stage deep filtering
- **DCCRN** — complex U-Net
- **PHASEN** — magnitude + phase streams
- **FullSubNet / FullSubNet+** — fullband+subband
- **Demucs / HT-Demucs (Défossez)** — stem separation
- **Spleeter (Deezer)** — stem separation
- **MelBand-RoFormer** — SotA stem separation
- **VoiceFixer (Liu 2022)** — speech restoration (denoise+declip+SR+dereverb)
- **StoRM / SGMSE+** — diffusion-based speech enhancement

---

## 3. iZotope RX 11 module → DSP method mapping

What each RX module is actually doing (based on iZotope docs + public reverse-engineering).

### Noise
| Module | Tier | Underlying DSP |
|---|---|---|
| Spectral De-noise | Std | multi-band OM-LSA / MMSE-LSA with noise profile |
| Voice De-noise | Std | ML speech denoise (DNN, real-time) |
| Dialogue Isolate | Adv | neural source separation (speech vs everything) |
| De-hum | Std | cascade notches + adaptive mains tracking |
| De-rustle | Adv | wind/handling noise, adaptive HPF + ML |
| De-wind | Adv | LPC-null post-filter + ML |

### Impulse / transient
| Module | Tier | Underlying DSP |
|---|---|---|
| De-click | Std | AR prediction + interpolation (Godsill-Rayner) |
| De-crackle | Std | continuous-crackle AR + thresholded interpolation |
| Mouth De-click | Std | mouth-tuned click detector + interpolation |
| De-plosive | Adv | LF transient detector + local attenuation |
| De-clip | Std | AR extrapolation + sparse reconstruction |

### Spatial / reverb
| Module | Tier | Underlying DSP |
|---|---|---|
| Dialogue De-reverb | Adv | WPE-like + spectral late-reverb subtraction |
| De-reverb | Std | spectral late-reverb subtraction (Lebart) |
| Center Extract | Adv | mid/side extraction |
| Ambience Match | Adv | noise-floor PSD match between clips |
| EQ Match | Std | long-term average spectrum match, FIR |

### Enhancement / repair
| Module | Tier | Underlying DSP |
|---|---|---|
| Spectral Repair | Std | STFT-domain inpainting (attenuate/replace/pattern) |
| Spectral De-ess | Std | STFT dynamic gain on sibilance band |
| Breath Control | Std | VAD-inverse gating on breath detector |
| Mouth De-click | Std | (above) |
| Voice De-plosive | Adv | (above) |
| Dialogue Contour | Adv | pitch editing (out of noise scope) |
| Music Rebalance | Std | neural stem separation (vocals/bass/drums/other) |
| Repair Assistant | Std | ML classifier + chain of de-* modules |
| Dialogue Match | Adv | ML sibilance/reverb/EQ matching |

### Generic tools (not noise-specific)
- EQ, Filter, De-click, Leveler, Loudness Control, Gain, Fade, Mixer, Channel Ops, Signal Generator, Batch Processor, Composite View

---

## 4. Proposed package scope

### Core (v0.1 — covers 90% of real-world noise cleanup)
| Export | Method | Covers |
|---|---|---|
| `gate` | Look-ahead noise gate | hiss between phrases, bleed silence |
| `specsub` | Berouti over-subtraction + floor | broadband noise baseline |
| `wiener` | MMSE-LSA with Minimum Statistics | transparent broadband denoise |
| `omlsa` | OM-LSA with IMCRA | non-stationary denoise |
| `dehum` | Adaptive notch cascade | mains hum, ground loops |
| `declick` | AR-LS interpolation (Godsill-Rayner) | clicks, pops, digital glitches |
| `decrackle` | Continuous threshold + AR interp | vinyl crackle |
| `declip` | AR extrapolation + A-SPADE | clipped peaks |
| `deesser` | Dynamic-EQ sibilance cut | harsh 's' sounds |
| `dewind` | LPC-null + adaptive HPF | wind, rumble, handling noise |
| `deplosive` | LF transient detect + duck | plosives |
| `debreath` | VAD-inverse gate | breath between phrases |
| `dereverb` | Lebart late-reverb subtraction | room tail |
| `denoise` | Content-aware auto-selector | dispatches to best of above |

### Supporting primitives
- `noiseProfile(data, {at, duration})` — extract noise PSD from quiet segment
- `minimumStatistics(stream)` — auto noise PSD estimator
- `imcra(stream)` — improved MCRA noise estimator
- `vad(data)` — energy+flatness+harmonic VAD (for gate, debreath)
- `spp(data)` — speech presence probability (for OM-LSA)
- `ltas(data)` — long-term average spectrum (for eqMatch, ambienceMatch)
- `matchProfile(a, ref)` — generic PSD matching (ambience/EQ match)

### Tier 2 (v0.2)
- `subspace` — truncated-SVD denoise (short signals)
- `wavelet` — VisuShrink / BayesShrink threshold
- `nmf` — supervised NMF separation (if noise template available)
- `mouthDeclick` — mouth-tuned click detector
- `hpss` — harmonic-percussive separation (noise = transients, or opposite)
- `wpe` — single-channel WPE dereverb
- `spectralRepair` — STFT-region inpaint / attenuate / pattern replace (RX Spectral Repair)

### Tier 3 (out of scope / external)
- Neural denoise — separate `neural-denoise` package consuming onnxruntime / wasm RNNoise
- Neural stem separation — separate `stem-separate` package
- Dialogue Isolate — neural, not pure DSP

### Shared infrastructure
- `util.js` — reuse `hannWindow`, `writer`, `makeStreamBufs` from time-stretch
- `stft.js` — same as time-stretch (frame/IFFT/OLA)
- `ar.js` — AR-model fitting (Levinson-Durbin), LS interpolation for missing samples
- `noise.js` — profile, MS, MCRA, IMCRA estimators
- `vad.js` — VAD + SPP
- `quality.js` — SNR, segSNR, LSD, PESQ-lite proxy, STOI-lite, noise-floor reduction

---

## 5. References

**Classical denoise**
- Boll, S. (1979). "Suppression of acoustic noise in speech using spectral subtraction." _IEEE Trans. ASSP_.
- Berouti, M. et al. (1979). "Enhancement of speech corrupted by acoustic noise." _ICASSP_.
- Kamath, S. & Loizou, P. (2002). "A multi-band spectral subtraction method." _ICASSP_.
- Ephraim, Y. & Malah, D. (1984). "Speech enhancement using MMSE STSA estimator." _IEEE Trans. ASSP_.
- Ephraim, Y. & Malah, D. (1985). "Speech enhancement using MMSE log-spectral amplitude estimator." _IEEE Trans. ASSP_.
- Cohen, I. (2003). "Noise spectrum estimation in adverse environments: IMCRA." _IEEE Trans. Speech Audio Processing_.
- Cohen, I. & Berdugo, B. (2002). "Speech enhancement for non-stationary noise environments." _Signal Processing_.
- Martin, R. (2001). "Noise power spectral density estimation based on optimal smoothing and minimum statistics." _IEEE Trans. Speech Audio Processing_.
- Gerkmann, T. & Hendriks, R. (2012). "Unbiased MMSE-based noise power estimation with low complexity and low tracking delay." _IEEE Trans. Audio, Speech, Language Processing_.

**Subspace**
- Ephraim, Y. & Van Trees, H. (1995). "A signal subspace approach for speech enhancement." _IEEE Trans. Speech Audio Processing_.
- Hu, Y. & Loizou, P. (2003). "A generalized subspace approach for enhancing speech corrupted by colored noise." _IEEE Trans. Speech Audio Processing_.

**Wavelet**
- Donoho, D. (1995). "De-noising by soft-thresholding." _IEEE Trans. Information Theory_.
- Donoho, D. & Johnstone, I. (1994). "Ideal spatial adaptation by wavelet shrinkage." _Biometrika_.
- Chang, S.G. et al. (2000). "Adaptive wavelet thresholding for image denoising and compression." _IEEE Trans. Image Processing_ (BayesShrink).

**Click / declip / restoration**
- Godsill, S. & Rayner, P. (1998). _Digital Audio Restoration — A Statistical Model-Based Approach_. Springer.
- Vaseghi, S. & Rayner, P. (1990). "Detection and suppression of impulsive noise in speech communication systems." _IEE Proc. I_.
- Wolfe, P. & Godsill, S. (2005). "Interpolation of missing data values for audio signal restoration using a Gabor regression model." _ICASSP_.
- Kitic, S. et al. (2015). "Sparsity and cosparsity for audio declipping: A flexible non-convex approach." _LVA/ICA_.
- Kitic, S. et al. (2013). "Consistent iterative hard thresholding for signal declipping." _ICASSP_.
- Siedenburg, K. et al. (2014). "Audio declipping with social sparsity." _ICASSP_.
- Záviška, P. et al. (2021). "A survey and evaluation of popular audio declipping methods." _IEEE/ACM TASLP_.

**Dereverberation**
- Nakatani, T. et al. (2010). "Speech dereverberation based on variance-normalized delayed linear prediction." _IEEE Trans. ASLP_ (WPE).
- Lebart, K., Boucher, J.-M. & Denbigh, P.N. (2001). "A new method based on spectral subtraction for speech dereverberation." _Acta Acustica_.

**Adaptive / NMF / HPSS**
- Widrow, B. & Stearns, S. (1985). _Adaptive Signal Processing_. Prentice-Hall.
- Lee, D. & Seung, S. (1999). "Learning the parts of objects by non-negative matrix factorization." _Nature_.
- Fitzgerald, D. (2010). "Harmonic/percussive separation using median filtering." _DAFx_.

**Neural**
- Valin, J.-M. (2018). "A hybrid DSP/deep learning approach to real-time full-band speech enhancement." _MMSP_ (RNNoise).
- Schröter, H. et al. (2022). "DeepFilterNet: A low complexity speech enhancement framework." _ICASSP_.
- Défossez, A. et al. (2021). "Hybrid spectrogram and waveform source separation." (Demucs).
