# Independent numpy references for the classical speech denoisers, written from the papers, and the fixtures
# test.js compares the packages with.
#   python scripts/reference.py            writes fixtures/reference.json
# Python 3.9+, numpy, scipy.
#
#   Imcra     Cohen, "Noise spectrum estimation in adverse environments: improved minima controlled recursive
#             averaging", IEEE TSAP 11(5), 2003: eqs. (7), (10)-(12), (14)-(29), Table I. What the paper leaves open
#             (initialisation, subwindow bookkeeping) follows Cohen's omlsa.m (israelcohen.com/software, omlsa.zip):
#             on 16 kHz VoiceBank frames this class and a line-by-line transliteration of omlsa.m give the same
#             noise track, speech presence and gains to the last bit, but for near-empty bins where omlsa.m's absolute
#             1e-10 floors bind (this class floors at 1e-30, scale-free); the transliteration is not redistributed (omlsa.m is
#             all rights reserved).
#   Omlsa     Cohen & Berdugo, "Speech enhancement for non-stationary noise environments", Signal Processing 81,
#             2001: eqs. (9), (15), (16), (18), (23)-(28), Table 1; P_min and the frame term's bookkeeping from omlsa.m.
#   dd_gain   Ephraim & Malah, IEEE TASSP 32(6), 1984, eq. (51): decision-directed a priori SNR; gains: Wiener
#             ξ/(1+ξ) (Scalart & Filho, ICASSP 1996), LSA (Ephraim & Malah, IEEE TASSP 33(2), 1985, eq. (20)).
#   minstats  Martin, IEEE TSAP 9(5), 2001: minimum of the smoothed periodogram over D frames times B_min, eq. (17),
#             capped at the window's mean.
#   specsub   Berouti, Schwartz & Makhoul, ICASSP 1979: power subtraction, over-subtraction α(SNR), floor β.
#   wpe       Nakatani, Yoshioka, Kinoshita, Miyoshi & Juang, IEEE TASLP 18(7), 2010: variance-normalized delayed
#             linear prediction, one channel, fitted over the whole take (eq. 13–15, iterated), with dereverb's λ floor
#             and silence rule; then the late power the past carries, shaped by its taps and scaled by the take's own
#             10th percentile, taken by Ephraim & Malah's LSA gain (1985).
#
# Time constants are quoted for Cohen's 8 ms frames (512 samples, 128 hop at 16 kHz) and rescaled to the actual
# frame step Δt as a^(Δt/8 ms); the minimum window keeps its length in seconds.
import os, json, numpy as np
from scipy.special import exp1

REF_DT = 128 / 16000

def hann(N):                                   # periodic Hann, as @audio/window 'hann' { periodic: true }
    return 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / N)

def frames(x, N, hop, first=None):
    """@audio/stft stftBatch framing: frames on the hop grid from `first` while they start before len(x), zero past
    the end. @audio/stft from 2.0.0 starts at hop - N, reading the input's mirror image x[-k] = x[k] before sample 0
    (first=None); up to 1.0.7 it started at 0 (first=0)."""
    first = hop - N if first is None else first
    P = -first; nF = (len(x) + P + hop - 1) // hop
    pad = np.zeros(P + nF * hop + N); pad[P:P + len(x)] = x
    for k in range(1, P + 1): pad[P - k] = x[k] if k < len(x) else 0
    idx = np.arange(N)[None, :] + hop * np.arange(nF)[:, None]
    return np.fft.rfft(pad[idx] * hann(N), axis=1)

def analysis(x, N, hop):
    """@audio/stft stftAnalyse framing: whole frames only."""
    n = (len(x) - N) // hop + 1
    idx = np.arange(N)[None, :] + hop * np.arange(n)[:, None]
    return np.fft.rfft(x[idx] * hann(N), axis=1)

def overlap_add(F, N, hop, L, first=None):
    """@audio/stft synthesis on the frames of `frames`: Hann synthesis window, sum of squared windows as norm,
    floored at its steady minimum; what falls before sample 0 is dropped."""
    P = N - hop if first is None else -first
    w = hann(N); fr = np.fft.irfft(F, n=N, axis=1) * w
    out = np.zeros(F.shape[0] * hop + N); nrm = np.zeros_like(out)
    for l in range(F.shape[0]): out[l * hop:l * hop + N] += fr[l]; nrm[l * hop:l * hop + N] += w * w
    out, nrm = out[P:P + L], nrm[P:P + L]
    n = np.maximum(nrm, min(np.sum(w[i::hop] ** 2) for i in range(hop)))
    return np.where(n > 1e-8, out / n, 0)

def conv_same(x, b):                           # MATLAB conv(b, x), central part: zero past the edges
    w = (len(b) - 1) // 2
    return np.convolve(x, b)[w:w + len(x)]

def mhann(n):                                  # MATLAB hanning(n): symmetric, no zero end points, normalized here
    h = 0.5 * (1 - np.cos(2 * np.pi * np.arange(1, n + 1) / (n + 1)))
    return h / h.sum()

def lsa(xi, v):                                # G_H1, Ephraim & Malah 1985 eq. (20)
    return xi / (1 + xi) * np.exp(0.5 * exp1(np.maximum(v, 1e-300)))

class Imcra:
    """update(|Y|^2) -> the noise estimate for this frame's gain (after this frame's update, as omlsa.m applies it)."""
    def __init__(self, K, dt=REF_DT, alpha_s=0.9, alpha_d=0.85, beta=1.47, Bmin=1.66, gamma0=4.6, gamma1=3,
                 zeta0=1.67, w=1, U=8, V=None, alpha_dd=0.92, xi_min=10 ** (-25 / 10)):
        r = dt / REF_DT
        self.K, self.a_s, self.a_d = K, alpha_s ** r, alpha_d ** r
        self.beta, self.Bmin, self.g0, self.g1, self.z0 = beta, Bmin, gamma0, gamma1, zeta0
        self.b = mhann(2 * w + 1); self.U = U; self.V = V or max(1, round(15 / r))
        self.a_dd, self.xi_min, self.n = alpha_dd, xi_min, 0

    def snr(self, Ya2):                        # decision-directed a priori SNR on the current estimate (32)
        gamma = Ya2 / np.maximum(self.lam, 1e-30)
        xi = np.maximum(self.a_dd * self.eta2 + (1 - self.a_dd) * np.maximum(gamma - 1, 0), self.xi_min)
        return gamma, xi, gamma * xi / (1 + xi)

    def update(self, Ya2):
        if not Ya2.any(): return self.lam if self.n else np.zeros(self.K)   # digital silence: skipped (omlsa.m too)
        b, K = self.b, self.K
        if self.n == 0: self.lam = Ya2.copy(); self.eta2 = np.ones(K)
        gamma, xi, v = self.snr(Ya2)
        Sf = conv_same(Ya2, b)                                                        # (14)
        if self.n == 0: self.S = Sf.copy(); self.St = Sf.copy(); self.lav = Ya2.copy()
        else: self.S = self.a_s * self.S + (1 - self.a_s) * Sf                        # (15)
        init = self.n < self.V - 1
        if init: self.Smin = self.S.copy(); self.SMact = self.S.copy()
        else: self.Smin = np.minimum(self.Smin, self.S); self.SMact = np.minimum(self.SMact, self.S)
        I = ((Ya2 < self.g0 * self.Bmin * self.Smin) & (self.S < self.z0 * self.Bmin * self.Smin)).astype(float)  # (18)-(21)
        cI = conv_same(I, b); Sft = self.St.copy(); nz = cI != 0
        Sft[nz] = conv_same(I * Ya2, b)[nz] / cI[nz]                                   # (26)
        if init: self.St = self.S.copy(); self.Smint = self.St.copy(); self.SMactt = self.St.copy()
        else:
            self.St = self.a_s * self.St + (1 - self.a_s) * Sft                       # (27)
            self.Smint = np.minimum(self.Smint, self.St); self.SMactt = np.minimum(self.SMactt, self.St)
        m = np.maximum(self.Smint, 1e-30); gm = Ya2 / self.Bmin / m; zt = self.S / self.Bmin / m   # (28)
        q = np.ones(K); p = np.zeros(K); mid = (gm > 1) & (gm < self.g1) & (zt < self.z0)
        q[mid] = (self.g1 - gm[mid]) / (self.g1 - 1)                                  # (29)
        p[mid] = 1 / (1 + q[mid] / (1 - q[mid]) * (1 + xi[mid]) * np.exp(-v[mid]))     # (7)
        p[(gm >= self.g1) | (zt >= self.z0)] = 1
        ad = self.a_d + (1 - self.a_d) * p                                            # (11)
        self.lav = ad * self.lav + (1 - ad) * Ya2                                     # (10)
        self.n += 1
        if self.n % self.V == 0:                                                      # U subwindows of V frames
            if self.n == self.V: self.SW = np.tile(self.S, (self.U, 1)); self.SWt = np.tile(self.St, (self.U, 1))
            else:
                self.SW = np.vstack([self.SW[1:], self.SMact]); self.Smin = self.SW.min(0); self.SMact = self.S.copy()
                self.SWt = np.vstack([self.SWt[1:], self.SMactt]); self.Smint = self.SWt.min(0); self.SMactt = self.St.copy()
        self.lam = self.beta * self.lav                                               # (12)
        self.p, self.xi0 = p, xi
        self.gamma, self.xi, self.v = self.snr(Ya2)                                   # on the updated estimate
        self.gH1 = lsa(self.xi, self.v); self.eta2 = self.gH1 ** 2 * self.gamma       # (33); 2001 eq. (18)
        return self.lam

class Omlsa:
    """gain(|Y|^2) -> G = max(G_H1, G_min)^p G_min^(1-p) (16) with G_H1 floored at G_min (G_min is the floor), p (9)
    with q = 1 - P_local P_global P_frame (23)-(28). As omlsa.m: P_local of 500 Hz-3.5 kHz set to P_min where its mean
    over 0-4 kHz is under 0.25, and p = 0 where q >= 0.9 (which makes the paper's q_max moot)."""
    def __init__(self, K, fs, N, dt=REF_DT, gmin_db=-25, alpha_zeta=0.7, w_local=1, w_global=15, zmin_db=-10,
                 zmax_db=-5, zpmin_db=0, zpmax_db=10, p_min=0.005, f_l=50, f_u=10000, q_fixed=None, **imcra):
        self.est = Imcra(K, dt=dt, **imcra)
        self.K, self.gmin, self.a_z = K, 10 ** (gmin_db / 20), alpha_zeta ** (dt / REF_DT)
        self.bl, self.bg = mhann(2 * w_local + 1), mhann(2 * w_global + 1)
        self.zmin, self.zmax, self.zpmin, self.zpmax, self.p_min = zmin_db, zmax_db, zpmin_db, zpmax_db, p_min
        self.kl = int(round(f_l / fs * N)); self.ku = min(int(round(f_u / fs * N)), K - 1)
        self.k2 = int(round(500 / fs * N)); self.k3 = int(round(3500 / fs * N))
        self.zeta = np.zeros(K); self.zf = 0; self.zm = None; self.q_fixed = q_fixed

    def P(self, z):                             # (25) on dB, floored at P_min
        d = np.where(z > 0, 10 * np.log10(np.maximum(z, 1e-300)), -100)
        return np.where(d <= self.zmin, self.p_min, np.where(d >= self.zmax, 1,
                        self.p_min + (d - self.zmin) / (self.zmax - self.zmin) * (1 - self.p_min)))

    def gain(self, Ya2):
        e = self.est
        if not Ya2.any(): return np.ones(self.K)                 # digital silence: skipped
        e.update(Ya2)
        if self.q_fixed is not None: q = np.full(self.K, self.q_fixed)
        else:
            self.zeta = self.a_z * self.zeta + (1 - self.a_z) * e.xi0                             # (23)
            prev = self.zf; self.zf = np.mean(self.zeta[self.kl:self.ku + 1])                      # (26)
            d = 10 * np.log10(self.zf) if self.zf > 0 else -100
            if d <= self.zmin: Pf = self.p_min                                                     # (27), Fig. 3
            elif self.zf >= prev: self.zm = min(max(d, self.zpmin), self.zpmax); Pf = 1
            elif d >= self.zm + self.zmax: Pf = 1
            elif d <= self.zm + self.zmin: Pf = self.p_min
            else: Pf = self.p_min + (d - self.zm - self.zmin) / (self.zmax - self.zmin) * (1 - self.p_min)
            Pl = self.P(conv_same(self.zeta, self.bl))                                              # (24), (25)
            if np.mean(Pl[2:self.k2 + self.k3 - 1]) < 0.25: Pl[self.k2:self.k3 + 1] = self.p_min
            q = 1 - Pl * self.P(conv_same(self.zeta, self.bg)) * Pf                                 # (28)
        p = np.where(q < 0.9, 1 / (1 + q / (1 - np.minimum(q, 0.9)) * (1 + e.xi) * np.exp(-e.v)), 0)  # (9)
        return np.maximum(e.gH1, self.gmin) ** p * self.gmin ** (1 - p)                           # (16), floored

def dd_gain(P, lam, alpha=0.98, xi_min=10 ** (-15 / 10), rule='mmse-lsa'):
    """ξ = α Â²(l−1)/λ(l−1) + (1−α) max(γ−1, 0), Â = G|Y|; the memory Â²/λ starts at 1 (omlsa.m, Loizou's logmmse.m)."""
    G = np.ones_like(P); eta2 = np.ones(P.shape[1])
    for l in range(len(P)):
        if not P[l].any(): continue                            # digital silence: skipped
        n = np.maximum(lam[l], 1e-30); gamma = P[l] / n
        xi = np.maximum(xi_min, alpha * eta2 + (1 - alpha) * np.maximum(gamma - 1, 0))
        g = xi / (1 + xi) if rule == 'wiener' else lsa(xi, xi * gamma / (1 + xi))
        G[l] = g; eta2 = g * g * gamma
    return G

# M(D): Martin 2006 Table 5, as VOICEBOX's v_estnoisem.m carries it, interpolated linearly in 1/√D
MD = [(1, 0), (2, 0.26), (5, 0.48), (8, 0.58), (10, 0.61), (15, 0.668), (20, 0.705), (30, 0.762), (40, 0.8), (60, 0.841),
      (80, 0.865), (120, 0.89), (140, 0.9), (160, 0.91), (180, 0.92), (220, 0.93), (260, 0.935), (300, 0.94)]

def bias_min(D, alpha):
    """Martin 2001 eq. (17): 1 + 2(D−1)(1−M(D))/(Q_eq − 2M(D)), Q_eq = 2(1+α)/(1−α)."""
    ds, ms = [d for d, _ in MD], [m for _, m in MD]
    m = ms[-1] if D >= ds[-1] else float(np.interp(1 / np.sqrt(D), [1 / np.sqrt(d) for d in ds][::-1], ms[::-1]))
    q = 2 * (1 + alpha) / (1 - alpha)
    return 1 + 2 * (D - 1) * (1 - m) / (q - 2 * m)

def minstats(P, D=96, alpha=0.7, bias=None):
    """Minimum of the smoothed periodogram over the last D non-silent frames, times B_min, and once there are D of them
    no more than their mean (a steady line's minimum is its mean: B_min would put it over). The smoother starts as the
    mean of the frames so far (α_l = min(α, l/(l+1))), and its values enter the minimum once its memory, ceil(1/(1−α))
    frames, is full; until then the estimate is that mean."""
    bias = bias_min(D, alpha) if bias is None else bias
    settle = int(np.ceil(1 / (1 - alpha)))
    out = np.zeros_like(P); S = np.zeros(P.shape[1]); n = 0; hist = []; mins = []; last = np.zeros(P.shape[1])
    for l, p in enumerate(P):
        if p.any():
            a = min(alpha, n / (n + 1)); S = a * S + (1 - a) * p; n += 1
            hist = (hist + [S])[-D:]; mins = (mins + [S if n > settle else None])[-D:]
            m = [h for h in mins if h is not None]
            if not m: last = S.copy()
            else:
                last = np.min(m, 0) * bias
                if len(hist) == D: last = np.minimum(last, np.mean(hist, 0))
        out[l] = last
    return out

def specsub(P, lam, alpha=None, beta=0.05, floor='noise'):
    """Berouti 1979: |Y|² − α N̂ where above the floor, else the floor, β N̂ (floor='noise') or β |Y|² ('noisy');
    α = 4 − 3/20 · SNR over −5..20 dB (the frame's noisy over noise power) unless fixed."""
    G = np.ones_like(P)
    for l in range(len(P)):
        y, n = P[l], lam[l]
        if not y.any(): continue                               # digital silence: skipped
        a = alpha if alpha is not None else min(4.75, max(1, 4 - 0.15 * 10 * np.log10(y.sum() / max(n.sum(), 1e-30))))
        c = y - a * n
        s = np.where(c > beta * n, c, beta * n) if floor == 'noise' else np.maximum(c, beta * y)
        G[l] = np.sqrt(np.where(y > 0, s / np.maximum(y, 1e-300), 0))
    return G

def wpe(F, D, K, iters=3):
    """WPE over the whole take, STFT frames F (T, bins): g = R⁻¹ r, R = Σ ȳȳᴴ/λ, r = Σ ȳ y*/λ, ȳ(t) = [y(t−D) …
    y(t−D−K+1)] (zero before the take), λ = |y|², then |d|² of the previous fit, d = y − gᴴȳ, floored 100 dB under the
    loudest bin (the loudest so far in the first fit); bins at or under the floor (digital silence) left out; R loaded
    by 10⁻⁶ of its mean diagonal. Returns g (bins, K) and ȳ (T, bins, K)."""
    T, B = F.shape; g = np.zeros((B, K), complex)
    Y = np.stack([np.concatenate([np.zeros((D + i, B), complex), F[:max(0, T - D - i)]])[:T] for i in range(K)], 2)
    P = np.abs(F) ** 2; run = np.maximum.accumulate(P.max(1))
    for it in range(iters):
        fl = (run if it == 0 else np.full(T, run[-1]))[:, None] * 1e-10 + 1e-30
        d = F - np.einsum('bk,tbk->tb', g.conj(), Y)
        w = np.where(P > fl, 1 / np.maximum(np.abs(d) ** 2, fl), 0)
        R = np.einsum('tb,tbi,tbj->bij', w, Y, Y.conj()); r = np.einsum('tb,tbi,tb->bi', w, Y, F.conj())
        tr = np.real(np.trace(R, axis1=1, axis2=2)); on = tr > 0
        R = R + np.eye(K)[None] * (tr / K * 1e-6)[:, None, None]
        g = np.zeros((B, K), complex); g[on] = np.linalg.solve(R[on], r[on][..., None])[..., 0]
    return g, Y

def histq(v, q, lo=-150.0, step=0.1, n=2000):
    """dereverb's percentile: the centre of the 0.1 dB bin (−150 to +50 dB, the ends clamped) where the cumulative count
    of v (dB) first reaches q of it; 0 for 20 values or fewer"""
    if v.size <= 20: return 0.0
    c = np.cumsum(np.bincount(np.clip(np.floor((v - lo) / step).astype(int), 0, n - 1), minlength=n))
    return 10 ** ((lo + (np.argmax(c >= q * v.size) + 0.5) * step) / 10)

def dereverb(x, fs, N, hop, first=None, strength=1.0, order=0.11, q=0.1, qdry=0.02, dry=-37.5, pauses=0.5, cap=2.0,
             gate=0.01, edges=(0, 250, 500, 1000, 2000, 4000), gmin=0.2, alpha_dd=0.85, xi_min=1e-3):
    """@audio/denoise-dereverb: wpe (D = N/hop) and its output d = y − gᴴȳ through the LSA gain (Ephraim & Malah 1985,
    eq. 20; ξ decision-directed, 1984, eq. 51, its memory Â²/λᵣ from 0) against λᵣ = strength·s(f)/(−ln 0.9)·u,
    u = Σₖ wₖ |y(t−D−k)|², wₖ = |gₖ|²/Σ|gⱼ|²; s per octave band the q-th percentile of |y|²/u over the cells that sound
    (over wpe's floor) with u over gate × the band's mean power, capped `cap` dB over the 0.5–4 kHz bands' geometric
    mean, interpolated over log2 f between the bands' centres; floored at gmin; no bin louder than it came. The take
    comes back as it came when the 0.5–4 kHz bands' qdry-th percentile is under `dry` dB, or when under `pauses` of its
    frames within 60 dB of the loudest (power over 0.5–4 kHz) are under half their mean."""
    dt = hop / fs; r = lambda v: int(np.floor(v + 0.5))                 # Math.round
    D, K = max(1, r(N / hop)), max(1, r(order / dt)); F = frames(x, N, hop, first)
    g, Y = wpe(F, D, K); B = F.shape[1]; P = np.abs(F) ** 2; fl = P.max() * 1e-10 + 1e-30
    w = np.abs(g) ** 2; e = w.sum(1, keepdims=True); w = np.where(e > 0, w / np.where(e > 0, e, 1), 0)
    u = np.einsum('bk,tbk->tb', w, np.abs(Y) ** 2); d = F - np.einsum('bk,tbk->tb', g.conj(), Y)
    f = np.arange(B) * fs / N; band = np.searchsorted(edges, f, 'right') - 1; nb = len(edges)
    v = [None] * nb
    for b in range(nb):
        m = band == b; pb, ub = P[:, m], u[:, m]; ok = (pb > fl) & (ub > gate * (pb.mean() if pb.size else 0))
        v[b] = 10 * np.log10(pb[ok] / ub[ok])
    gmean = lambda a: np.exp(np.mean(np.log(np.maximum(a, 1e-30))))
    s = np.array([histq(v[b], q) for b in range(nb)]); fall = gmean([histq(v[b], qdry) for b in (2, 3, 4)])
    em = P[:, (band >= 2) & (band < 5)].sum(1); on = em[em > em.max() * 1e-6]
    low = np.mean(on < 0.5 * on.mean()) if on.size else 1.0
    if 10 * np.log10(max(fall, 1e-30)) < dry or low < pauses: return x.astype(np.float32).astype(np.float64)
    s = np.minimum(s, gmean(s[2:5]) * 10 ** (cap / 10))
    cen = np.log2(np.sqrt(np.maximum(edges, 125) * np.append(edges[1:], fs / 2)))
    lam = strength / -np.log(0.9) * np.interp(np.log2(np.maximum(f, 1)), cen, s) * u
    a = alpha_dd ** (dt / REF_DT); eta = np.zeros(B); out = np.empty_like(F)
    for t in range(len(F)):
        G = np.ones(B); on = lam[t] > 0
        gm = np.abs(d[t, on]) ** 2 / lam[t, on]; xi = np.maximum(a * eta[on] + (1 - a) * np.maximum(gm - 1, 0), xi_min)
        G[on] = np.clip(xi / (1 + xi) * np.exp(0.5 * exp1(np.maximum(gm * xi / (1 + xi), 1e-300))), gmin, 1); eta[on] = G[on] ** 2 * gm
        out[t] = np.minimum(G * np.abs(d[t]), np.abs(F[t])) * np.exp(1j * np.angle(d[t]))
    return overlap_add(out, N, hop, len(x), first)

def signal(n=20000):
    """test.js's synthetic 'speech in noise' at 8 kHz, in arithmetic only so JS makes the same doubles: Park–Miller
    uniforms summed 12 at a time (Irwin–Hall, near Gaussian), noise ×3 from 1.5 s; four syllables of a 125 Hz pulse
    train through two resonators (poles 0.9∠±28°, 0.8∠±72°: formants near 600 Hz and 1.6 kHz), ramped over 50 ms."""
    seed = 1; x = np.zeros(n); y1 = y2 = z1 = z2 = 0.0
    seg = [(2000, 5000), (7000, 10000), (13000, 15000), (16500, 19000)]
    for i in range(n):
        g = 0.0
        for _ in range(12): seed = seed * 16807 % 2147483647; g += seed / 2147483647
        e = 0.0
        for s, t in seg:
            if s <= i < t and i % 64 == 0: e = min(1.0, (i - s) / 400, (t - i) / 400)
        y = e + 1.6 * y1 - 0.81 * y2; y2 = y1; y1 = y
        z = y + 0.5 * z1 - 0.64 * z2; z2 = z1; z1 = z
        x[i] = 0.1 * z + (g - 6) * (0.01 if i < 12000 else 0.03)
    return x.astype(np.float32).astype(np.float64)

def room(x):
    """test.js's room for dereverb: the direct sound plus a quarter of four parallel feedback combs (Schroeder, JAES
    10(3), 1962), delays 238, 297, 329, 350 samples, gains for T60 ≈ 0.4 s at 8 kHz; float64 in test.js's order."""
    y = np.zeros(len(x)); c = [np.zeros(len(x)) for _ in range(4)]
    for n in range(len(x)):
        s = 0.0
        for j, (d, gj) in enumerate([(238, 0.598), (297, 0.527), (329, 0.492), (350, 0.470)]):
            c[j][n] = x[n] + (gj * c[j][n - d] if n >= d else 0.0); s += c[j][n]
        y[n] = x[n] + 0.25 * s
    return y

if __name__ == '__main__':
    fs, N, hop, step = 8000, 256, 64, 40                  # 32 ms frames, 8 ms hop: Table I's own time base
    g = lambda a: [float(f'{v:.9g}') for v in a]           # 9 digits: far past the tolerance, a third of the size
    x = signal(); K = N // 2 + 1
    A = np.abs(analysis(x, N, hop)) ** 2; e = Imcra(K)
    lam = np.array([e.update(a).copy() for a in A])
    oo = dict(alphaDD=0.95, xiMin=10 ** (-18 / 10), gMin=-18)   # omlsa.m's values
    def batch(first):                                     # the four batch outputs on one framing of @audio/stft
        F = frames(x, N, hop, first); P = np.abs(F) ** 2
        o = Omlsa(K, fs, N, gmin_db=oo['gMin'], alpha_dd=oo['alphaDD'], xi_min=oo['xiMin']); G = np.array([o.gain(p) for p in P])
        ms = minstats(P, 96); ola = lambda G: g(overlap_add(F * G, N, hop, len(x), first)[::step])
        return {'omlsa': ola(G), 'wiener': ola(dd_gain(P, ms, rule='mmse-lsa')), 'wienerRule': ola(dd_gain(P, ms, rule='wiener')),
                'specsub': ola(specsub(P, ms)), 'dereverb': g(dereverb(xr, fs, N, hop, first)[::step])}
    xr = room(x[:7000]).astype(np.float32).astype(np.float64)   # dereverb's input: a syllable and the pause after it in a
                                                                # room, as test.js makes it (the whole signal's noise fills its pauses)
    out = {
        'about': 'scripts/reference.py: numpy references from the papers on its synthetic signal (8 kHz, 256/64 frames)',
        'fs': fs, 'frameSize': N, 'hopSize': hop, 'step': step, 'rms': float(np.sqrt(np.mean(x ** 2))),
        'imcra': {'frames': list(range(0, len(lam), 7)), 'bins': list(range(0, K, 8)),
                  'psd': [g(lam[l, ::8]) for l in range(0, len(lam), 7)]},
        'omlsaOpts': oo,
        # batch outputs by @audio/stft's first frame: hop - N from 2.0.0 (the input's mirror image before it), 0 before
        'batch': {'reflect': batch(None), 'zero': batch(0)},
        'biasMin': {f'{d}/{a}': bias_min(d, a) for d, a in [(96, 0.7), (48, 0.7), (96, 0.85), (200, 0.95), (3, 0.7)]},
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures', 'reference.json')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print(f'{os.path.normpath(path)}: {os.path.getsize(path)} bytes')
