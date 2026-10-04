# Measure @audio/vad through its two users, desilence and debreath: what they take from speech, clean and in noise,
# what they leave of a breath, what they do to music. Prints the README's tables (a few minutes).
#   python scripts/vad.py [test|train] [DESILENCE_JS DEBREATH_JS]     other kernels: an older version, to compare
# test: VoiceBank+DEMAND's test set (Valentini-Botinhao 2017, CC BY 4.0: 824 pairs, 48 kHz) and ten Spoken Wikipedia
# narrations (~/.cache/audiojs/data/spoken, 60 s each, CC BY-SA); train: the training subset (scripts/speech.py fetch)
# and ten other narrations (spoken-train), on which the defaults were chosen. Music: repair/*.f32 (scripts/repair.js:
# Vibe Ace, Brahms' Hungarian Dance No. 5, the Nutcracker's first 60 s, the trumpet loop) and the VocalSet "Caro mio
# ben" excerpts sung straight (Wilkins et al. 2018, CC BY 4.0) of singers f1, f7, m2, m8.
#
# References, per 10 ms frame of the clean take (the op decides on the noisy one, where there is one):
#   level, dB under the clip's 99th-percentile frame; the floor, its 10th percentile
#   speech: within 35 dB of the loudest frame (gaps under 60 ms bridged) and 10 dB over the floor
#   voiced: speech whose normalized autocorrelation peaks at 0.6 or more over 2.5-16.7 ms lags (60-400 Hz) in 40 ms
#     of the 50-1000 Hz band, within 40 dB of the loudest frame, in runs of 30 ms or more
#   word edges: speech within 100 ms of voicing that is not voiced: consonants, a word's onset and decay
# desilence cuts a frame that falls outside its kept spans; debreath, one whose energy it lowers by over 3 dB.
# Breaths: Gaussian noise through three wide resonances (500, 1500, 2500 Hz; bandwidths 300, 400, 500 Hz) under a
# 350 ms Hann envelope, its loudest 10 ms 35 or 25 dB under the narration's, put in each pause long enough to end G s
# before the next phrase (a pause: 10 ms frames within 6 dB of the floor). Music: frames within 30 dB of the loudest.
import os, sys, glob, json, subprocess, tempfile, numpy as np
from multiprocessing import Pool
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt, lfilter

DATA = os.path.expanduser('~/.cache/audiojs/data')
HERE = os.path.dirname(os.path.abspath(__file__))
SET = sys.argv[1] if len(sys.argv) > 1 else 'test'
KERNELS = sys.argv[2:4]

def wav(p):
    fs, x = wavfile.read(p)
    return (x / 32768 if x.dtype == np.int16 else x).astype(np.float32), fs

def frames(x, fs):
    n = fs // 100; m = len(x) // n
    return x[:m * n].reshape(m, n).astype(np.float64), m

def runs(b):
    out, i, m = [], 0, len(b)
    while i < m:
        if not b[i]: i += 1; continue
        j = i
        while j < m and b[j]: j += 1
        out.append((i, j)); i = j
    return out

def bridge(b, gap):
    b = b.copy(); idx = np.where(b)[0]
    for p, q in zip(idx[:-1], idx[1:]):
        if 1 < q - p <= gap: b[p:q] = True
    return b

def reference(x, fs):
    X, m = frames(x, fs)
    lv = 10 * np.log10((X ** 2).sum(1) + 1e-20); lv -= np.percentile(lv, 99); fl = max(np.percentile(lv, 10), -60)
    speech = bridge(lv > -35, 6) & (lv > fl + 10)
    b = sosfiltfilt(butter(4, [50, 1000], 'bandpass', fs=fs, output='sos'), x.astype(np.float64))
    W, lo, hi = int(0.04 * fs), int(fs / 400), int(fs / 60); per = np.zeros(m)
    for k in range(m):
        c = k * (fs // 100) + fs // 200; s = b[max(0, c - W // 2):c + W // 2]
        if len(s) < W or np.dot(s, s) < 1e-12: continue
        s = s - s.mean(); ac = np.fft.irfft(np.abs(np.fft.rfft(s, 2 * W)) ** 2)[:hi + 1]
        per[k] = (ac / ac[0] * W / (W - np.arange(hi + 1)))[lo:hi + 1].max()
    v = (per >= 0.6) & (lv > -40) & (lv > fl + 10)
    voiced = np.zeros(m, bool)
    for i, j in runs(v):
        if j - i >= 3: voiced[i:j] = True
    idx = np.where(voiced)[0]; near = np.full(m, 10 ** 6)
    if len(idx):
        j = np.searchsorted(idx, np.arange(m)); at = lambda q: np.abs(np.arange(m) - idx[np.clip(q, 0, len(idx) - 1)])
        near = np.minimum(at(j - 1), at(j))
    return dict(lv=lv, fl=fl, speech=speech, voiced=voiced & speech, edge=speech & ~voiced & (near <= 10), m=m)

def ops(xs, fs):
    """desilence's kept spans and debreath's gain per 10 ms frame, from scripts/vad.mjs, 8 node processes at a time"""
    with tempfile.TemporaryDirectory() as d:
        paths = []
        for i, x in enumerate(xs): p = f'{d}/{i}.f32'; np.asarray(x, np.float32).tofile(p); paths.append(p)
        parts = [paths[i::8] for i in range(8) if paths[i::8]]
        def job(k):
            l, o = f'{d}/l{k}.json', f'{d}/o{k}.json'; json.dump(parts[k], open(l, 'w'))
            return subprocess.Popen(['node', f'{HERE}/vad.mjs', str(fs), l, o, *KERNELS])
        for p in [job(k) for k in range(len(parts))]: assert p.wait() == 0
        res = [json.load(open(f'{d}/o{k}.json')) for k in range(len(parts))]
        out = [None] * len(paths)
        for k, r in enumerate(res):
            for j, v in enumerate(r): out[k + 8 * j] = v
        return out

def cut(o, m):
    keep = np.zeros(m, bool)
    for s in o['kept']: keep[int(round(s['start'] * 100)):int(round(s['end'] * 100))] = True
    g = np.full(m, 0.0); g[:min(m, len(o['gain']))] = o['gain'][:m]
    return ~keep, g < -3

def speech_row(label, refs, outs, dur):
    a = {k: [0, 0] for k in ('dv', 'de', 'bv', 'be')}; rm = 0
    for r, o in zip(refs, outs):
        dc, bc = cut(o, r['m'])
        for k, cls, c in (('dv', 'voiced', dc), ('de', 'edge', dc), ('bv', 'voiced', bc), ('be', 'edge', bc)):
            a[k][0] += r[cls].sum(); a[k][1] += (r[cls] & c).sum()
        kept = sum(s['end'] - s['start'] for s in o['kept']); rm += r['m'] / 100 - kept
    p = {k: 100 * b / max(n, 1) for k, (n, b) in a.items()}
    print(f"| {label} | {p['dv']:.2f} % | {p['de']:.2f} % | {rm:.0f} of {dur:.0f} s | {p['bv']:.2f} % | {p['be']:.2f} % |", flush=True)

def breath(n, fs, rng):
    w = rng.standard_normal(n); y = np.zeros(n)
    for f, bw in ((500, 300), (1500, 400), (2500, 500)):
        R = np.exp(-np.pi * bw / fs); y += lfilter([1 - R], [1, -2 * R * np.cos(2 * np.pi * f / fs), R * R], w)
    return y * np.sin(np.pi * np.arange(n) / n) ** 2

def pauses(r):
    return [(i / 100, j / 100) for i, j in runs(r['lv'] < r['fl'] + 6) if i > 0 and j < r['m']]

if __name__ == '__main__':
    vb = 'vbdemand-train/clean' if SET == 'train' else 'vbdemand/clean_testset_wav'
    sp = 'spoken-train' if SET == 'train' else 'spoken'
    cl = sorted(glob.glob(f'{DATA}/{vb}/*.wav'))
    clean = [wav(p)[0] for p in cl]
    noisy = [wav(p.replace('/clean/', '/noisy/').replace('clean_testset_wav', 'noisy_testset_wav'))[0] for p in cl]
    narr = [np.fromfile(p, np.float32) for p in sorted(glob.glob(f'{DATA}/{sp}/*.f32'))]
    with Pool() as pool: refs = pool.starmap(reference, [(x, 48000) for x in clean + narr])
    rv, rn = refs[:len(clean)], refs[len(clean):]
    dv, dn = sum(len(x) for x in clean) / 48000, sum(len(x) for x in narr) / 48000

    print(f'\nSpeech: frames cut ({SET})\n\n| | desilence: voiced | word edges | removed | debreath: voiced | word edges |\n|---|---:|---:|---:|---:|---:|')
    speech_row(f'VoiceBank+DEMAND, {len(cl)} noisy', rv, ops(noisy, 48000), dv)
    speech_row('the same, clean', rv, ops(clean, 48000), dv)
    speech_row(f'{len(narr)} narrations', rn, ops(narr, 48000), dn)

    print(f'\nBreaths put into the narrations\' pauses, 350 ms, ending G before the next phrase: debreath median dB, share turned down 6 dB or more; desilence share removed\n\n| G | -35 dB | -25 dB |\n|---|---|---|')
    for G in (0.05, 0.15, 0.3, 0.5):
        cells = []
        for L in (-35, -25):
            xs, spans = [], []
            for fi, (x, r) in enumerate(zip(narr, rn)):
                y = x.astype(np.float64).copy(); X, m = frames(x, 48000); top = np.percentile((X ** 2).sum(1), 99); sp_ = []
                rng = np.random.default_rng(fi)
                for a, b in pauses(r):
                    if b - a < 0.35 + G + 0.15: continue
                    n = int(0.35 * 48000); s = breath(n, 48000, rng); e = max((s[i:i + 480] ** 2).sum() for i in range(0, n - 480, 240))
                    i0 = int((b - G - 0.35) * 48000); y[i0:i0 + n] += s * np.sqrt(top * 10 ** (L / 10) / e); sp_.append((i0, i0 + n, s * np.sqrt(top * 10 ** (L / 10) / e)))
                xs.append(y.astype(np.float32)); spans.append(sp_)
            outs = ops(xs, 48000); att, took = [], []
            for y, o, sp_ in zip(xs, outs, spans):
                g = 10 ** (np.repeat(np.asarray(o['gain']), 480) / 20)
                for i0, i1, s in sp_:
                    gg = g[i0:i1] if i1 <= len(g) else np.ones(i1 - i0)
                    att.append(10 * np.log10(((gg * s) ** 2).sum() / (s ** 2).sum()))
                    k = sum(max(0, min(i1 / 48000, q['end']) - max(i0 / 48000, q['start'])) for q in o['kept'])
                    took.append(1 - k / ((i1 - i0) / 48000))
            att = np.array(att)
            cells.append(f'{np.median(att):.1f} dB, {100 * np.mean(att <= -6):.0f} %; {100 * np.mean(took):.0f} % ({len(att)})')
        print(f'| {G} s | {cells[0]} | {cells[1]} |', flush=True)

    print('\nMusic: frames within 30 dB of the loudest cut by desilence / turned down 3 dB or more by debreath\n\n| | desilence | debreath |\n|---|---:|---:|')
    rep = [(nm, np.fromfile(f'{DATA}/repair/{nm}.f32', np.float32)[:44100 * 60]) for nm in ('vibeace', 'brahms', 'nutcracker', 'trumpet')]
    sung = [(f'sung {s}', wav(glob.glob(f'{DATA}/vocalset/FULL/*/excerpts/straight/{s}_caro_straight.wav')[0])[0]) for s in ('f1', 'f7', 'm2', 'm8')]
    for nm, x in rep + sung:
        X, m = frames(x, 44100); lv = 10 * np.log10((X ** 2).sum(1) + 1e-20); loud = lv > np.percentile(lv, 99) - 30
        dc, bc = cut(ops([x], 44100)[0], m)
        print(f'| {nm} | {100 * (loud & dc).sum() / loud.sum():.2f} % | {100 * (loud & bc).sum() / loud.sum():.2f} % |', flush=True)
