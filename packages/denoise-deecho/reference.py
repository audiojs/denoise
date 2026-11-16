# Independent references for deecho's tests, from numpy and scipy, and the fixture test.js compares the package with.
#   python reference.py            writes reference.json
# Python 3.9+, numpy, scipy.
#
#   signal()     a voice-like take in arithmetic only (Park-Miller uniforms, integer pitch periods, two resonators, linear
#                envelopes), so test.js makes the same doubles: a pulse every 100-159 samples at 16 kHz, each period drawn
#                from a second Park-Miller sequence (multiplier 48271) so the pulses never repeat a pattern (a sound that
#                repeats is periodic, and deecho leaves a periodic sound).
#   echoes       made by scipy.signal.lfilter: y = x + g (z^-D / (1 - f z^-D)) x summed over the lines, the echo model
#                deecho undoes; a fractional delay by the ideal band-limited delay, multiplying the spectrum by
#                e^(-i w D) over a zero padded FFT (Laakso et al., IEEE SPM 13(1), 1996: the ideal fractional delay).
#   inverse      what deecho's removal must give: lfilter with the echo's transfer function upside down for whole
#                delays, the spectrum divided by it for a fractional one.
import os, json, numpy as np
from functools import reduce
from scipy.signal import lfilter

FS = 16000

def signal(n=4 * FS):
    seed, pitch, x, y1, y2, z1, z2, nxt = 1, 7, np.zeros(n), 0.0, 0.0, 0.0, 0.0, 0
    syl = [(1600, 12000), (16000, 26000), (30000, 44000), (48000, 60000)]
    for i in range(n):
        g = 0.0
        for _ in range(12):
            seed = seed * 16807 % 2147483647
            g += seed / 2147483647
        e = 0.0
        if i == nxt:
            pitch = pitch * 48271 % 2147483647
            nxt = i + 100 + pitch % 60
            for s, t in syl:
                if s <= i < t:
                    e = min(1.0, (i - s) / 800, (t - i) / 800)
        y = e + 1.8 * y1 - 0.9 * y2; y2 = y1; y1 = y            # a formant near 820 Hz
        z = y + 0.9 * z1 - 0.72 * z2; z2 = z1; z1 = z            # and one near 2.6 kHz
        x[i] = 0.05 * z + (g - 6) * 0.002
    return x

def lines(D, g, f):
    # one delay line's echo, g z^-D / (1 - f z^-D), as lfilter's (b, a)
    b = np.zeros(D + 1); b[D] = g
    a = np.zeros(D + 1); a[0] = 1; a[D] = -f
    return b, a

def echo(x, echoes):
    y = x.copy()
    for D, g, f in echoes:
        b, a = lines(D, g, f); y += lfilter(b, a, x)
    return y

def inverse(y, echoes):
    # H = 1 + sum_i b_i / a_i = (prod a + sum_i b_i prod_{j != i} a_j) / prod a, so x = lfilter(prod a, that numerator, y);
    # polynomials in z^-1, lowest power first
    A = [lines(*e)[1] for e in echoes]; B = [lines(*e)[0] for e in echoes]
    prod = reduce(np.convolve, A, np.array([1.0])); top = prod
    for i in range(len(echoes)):
        t = reduce(np.convolve, [A[j] for j in range(len(echoes)) if j != i], B[i])
        n = max(len(top), len(t)); top = np.pad(top, (0, n - len(top))) + np.pad(t, (0, n - len(t)))
    return lfilter(prod, top, y)

def ideal(x, D, g, f, invert=False):
    # the ideal band-limited echo of one line at a fractional delay, over a zero padded FFT
    M = 1 << int(np.ceil(np.log2(len(x) + 64 * D)))
    X = np.fft.rfft(x, M); w = 2 * np.pi * np.arange(M // 2 + 1) / M; z = np.exp(-1j * w * D)
    H = 1 + g * z / (1 - f * z)
    return np.fft.irfft(X / H if invert else X * H, M)[:len(x)]

if __name__ == '__main__':
    step = 97
    g9 = lambda a: [float(f'{v:.9g}') for v in a]
    x = signal()
    cases = {
        'single': [(1234, 0.5, 0.0)],                    # one copy, 77 ms
        'repeating': [(2000, 0.45, 0.45)],               # each copy 0.45 of the one before, 125 ms
        'delay': [(1600, 0.667, 0.35)],                  # a delay effect: wet 0.4 over dry 0.6, feedback 0.35, 100 ms
        'two': [(1100, 0.4, 0.0), (2903, 0.25, 0.0)],    # two copies, 69 and 181 ms
        'long': [(12000, 0.4, 0.0)],                     # 750 ms
    }
    out = {'about': 'reference.py: echoes made and undone by scipy.signal.lfilter, a fractional one by the ideal band-limited delay',
           'fs': FS, 'step': step, 'rms': float(np.sqrt(np.mean(x ** 2))), 'x': g9(x[::step]), 'cases': {}}
    for name, ec in cases.items():
        y = echo(x, ec)
        out['cases'][name] = {'echoes': [{'delay': D / FS, 'gain': g, 'feedback': f} for D, g, f in ec],
                              'y': g9(y[::step]), 'inverse': g9(inverse(y, ec)[::step])}
    D, g = 1500.37, 0.4                                  # 93.77 ms, a fraction of a sample past a whole one
    y = ideal(x, D, g, 0.0)
    out['cases']['fractional'] = {'echoes': [{'delay': D / FS, 'gain': g, 'feedback': 0.0}],
                                  'y': g9(y[::step]), 'inverse': g9(ideal(y, D, g, 0.0, invert=True)[::step])}
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print(f'{os.path.normpath(path)}: {os.path.getsize(path)} bytes')
