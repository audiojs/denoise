# Measure @audio/denoise-dereverb: how much of a room's late reverberation it takes off a voice and how much of the
# voice it takes with it, and what it does where there is nothing to take (a dry voice, a sung one, music).
#   python scripts/dereverb.py build                       the rooms and takes below, once (~/.cache/audiojs/data/dereverb/)
#   python scripts/dereverb.py [SET] [KERNEL] [STRENGTH]   SET: test (default) | train; KERNEL: a dereverb.js (default
#                                                          the package's); prints the README's rows
# Python 3.9+, numpy, scipy, pesq 0.0.4, pystoi 0.4.1, pyloudnorm, onnxruntime; SRMR by srmrpy (github.com/jfsantos/
# SRMRpy, with github.com/detly/gammatone), skipped when absent; DNSMOS as scripts/speech.py loads it; node.
#
# Rooms: the MIT IR Survey (Traer & McDermott, PNAS 2016; 271 responses, 32 kHz, resampled to 48 kHz), each aligned to
# its direct peak (2 ms kept before it) and split at direct + 50 ms: early (the voice as the room colours it, the
# target) and late (what dereverb should take). Those whose early part is under 12 dB over the late one (a tail to
# hear), 19 of them spread by T60 (Schroeder T20, 500 Hz–1 kHz octave): even-numbered for tuning, odd for testing.
# Takes: VoiceBank clean speech (Valentini-Botinhao 2017, CC BY 4.0, doi:10.7488/ds/2117), 48 kHz:
#   short: 42 utterances, 1.6–5.9 s, room i % 19 for the i-th, a 0.4 s tail after each (training: every 12th of the 504
#     in vbdemand-train/clean, 28 speakers; test: every 20th of the 824 test utterances, speakers p232 and p257);
#   long: one speaker's ten utterances 0.3 s apart in one room, 25–60 s (training: 8 speakers, 8 rooms; test: p232 and
#     p257, two takes each, 4 rooms): a take as it is edited, the fit has the whole of it.
# Scores, over each set:
#   voice lost, tail taken: STFT bins (2048, hop 512) where the early part is 10 dB over the late one, the output's
#     power there against the early part's; where the late part is 10 dB over the early one, against the late part's.
#   PESQ (ITU-T P.862.2 wideband) and STOI (Taal et al. 2011) against the dry take, at 16 kHz; SRMR (Falk, Zheng & Chan,
#     IEEE TASLP 18(7), 2010), reverberation's modulation signature, higher is drier; DNSMOS P.835 SIG, BAK, OVRL at
#     the input's loudness (ITU-R BS.1770), as scripts/speech.py scores vbreverb.
#   dry: the dry takes through it: the share returned untouched (bit for bit), PESQ against themselves.
#   spoken, sung and music, through it as they are: the share untouched, SI-SDR, the level change per octave; 44.1 kHz:
#     VocalSet (Wilkins et al., ISMIR 2018; its 20 spoken and 20 straight-tone sung excerpts), the music
#     scripts/repair.js reads (~/.cache/audiojs/data/repair/: Vibe Ace, Brahms, the Nutcracker, a trumpet loop; the
#     first minute), the MUSDB18 test set's previews (Rafii et al. 2017; musdb/test-mono as @audio/neural-denoise's
#     scripts/accuracy.py writes them, the odd-numbered 25) and GuitarSet's microphone takes (Xi et al., ISMIR 2018;
#     every 18th from the 10th, the first 30 s), when present.
import os, sys, glob, subprocess, tempfile, numpy as np
from multiprocessing import Pool
from scipy.signal import resample_poly, fftconvolve, butter, sosfiltfilt
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.expanduser('~/.cache/audiojs/data'); OUT = os.path.join(DATA, 'dereverb')
FS, PRE, EARLY, TAIL = 48000, 96, 2400, 19200                    # 48 kHz; 2 ms before the direct peak; 50 ms; 0.4 s
OCT = [(63, 125), (125, 250), (250, 500), (500, 1000), (1000, 2000), (2000, 4000), (4000, 8000)]

def rwav(p):
    fs, x = wavfile.read(p); x = x / 32768. if x.dtype == np.int16 else x.astype(np.float64)
    return (x if x.ndim == 1 else x[:, 0]).astype(np.float64), fs
def rf32(p): return np.fromfile(p, np.float32).astype(np.float64)
def wf32(p, x): np.asarray(x, np.float32).tofile(p)

def response(p):
    h, fs = rwav(p); h = resample_poly(h, 3, 2); k = int(np.argmax(np.abs(h))); h = h[max(0, k - PRE):]
    return h / np.abs(h).max()
def t60(h):
    v = sosfiltfilt(butter(4, [354, 1414], 'bandpass', fs=FS, output='sos'), h)
    e = np.cumsum(v[::-1] ** 2)[::-1]; e = 10 * np.log10(e / e[0] + 1e-30); a, b = np.argmax(e < -5), np.argmax(e < -25)
    return -60 / np.polyfit(np.arange(a, b) / FS, e[a:b], 1)[0] if b > a else np.nan
def ratio(h): return 10 * np.log10(np.sum(h[:PRE + EARLY] ** 2) / np.sum(h[PRE + EARLY:] ** 2))

def rooms(parity):
    c = []
    for p in sorted(glob.glob(f'{DATA}/mit-ir/Audio/*.wav')):
        if int(os.path.basename(p)[1:4]) % 2 != parity: continue
        h = response(p); r, t = ratio(h), t60(h)
        if r < 12 and np.isfinite(t): c.append((p, t))
    c.sort(key=lambda v: v[1]); return [c[int(i * len(c) / 19)] for i in range(19)]

def place(x, room, path):
    h = response(room); he = h.copy(); he[PRE + EARLY:] = 0; n = len(x) + TAIL; xp = np.zeros(n); xp[:len(x)] = x
    ye, yl = (fftconvolve(xp, k)[PRE:PRE + n] for k in (he, h - he)); g = np.sqrt(np.sum(xp ** 2) / np.sum(ye ** 2))
    for k, v in [('dry', xp), ('early', ye * g), ('late', yl * g), ('rev', (ye + yl) * g)]: wf32(f'{path}.{k}.f32', v)

def build():
    for name, parity, src, step in [('train', 0, f'{DATA}/vbdemand-train/clean', 12), ('test', 1, f'{DATA}/vbdemand/clean_testset_wav', 20)]:
        R = rooms(parity); d = f'{OUT}/{name}'; os.makedirs(d, exist_ok=True); files = sorted(glob.glob(src + '/*.wav'))
        for i, p in enumerate(files[::step]): place(rwav(p)[0], R[i % 19][0], f'{d}/{os.path.basename(p)[:-4]}')
        spk = sorted(set(os.path.basename(p)[:4] for p in files))
        takes = [(s, 0) for s in spk[1::3][:8]] if name == 'train' else [(s, k) for s in spk for k in (0, 1)]
        for i, (s, k) in enumerate(takes):
            us = [p for p in files if os.path.basename(p).startswith(s)][k * 10:k * 10 + 10]
            x = np.concatenate([np.concatenate([rwav(p)[0], np.zeros(int(0.3 * FS))]) for p in us])
            place(x, R[(i * 19) // len(takes)][0], f'{d}/long-{s}-{k}')
        print(f'{name}: rooms T60 {R[0][1]:.2f}–{R[-1][1]:.2f} s, {len(glob.glob(d + "/*.rev.f32"))} takes in {d}')

# the kernel over f32 files, one node process: dereverb(x, { fs, strength })
RUN = """import { readFileSync, writeFileSync } from 'node:fs'
let [kernel, fs, strength, ...files] = process.argv.slice(1), dereverb = (await import(kernel)).default
for (let i = 0; i < files.length; i += 2) {
  let b = readFileSync(files[i]), x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
  let y = dereverb(x, { fs: +fs, strength: +strength }); writeFileSync(files[i + 1], Buffer.from(y.buffer, y.byteOffset, y.byteLength))
}"""
def through(kernel, fs, strength, xs):
    with tempfile.TemporaryDirectory() as t:
        files = []
        for i, x in enumerate(xs): wf32(f'{t}/{i}.in', x); files += [f'{t}/{i}.in', f'{t}/{i}.out']
        subprocess.run(['node', '--input-type=module', '-e', RUN, kernel, str(fs), str(strength), *files], check=True)
        return [rf32(f'{t}/{i}.out') for i in range(len(xs))]

def stft(x, N=2048, hop=512):
    w = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / N); xp = np.concatenate([np.zeros(N), x, np.zeros(N)])
    idx = np.arange(N)[None, :] + hop * np.arange((len(xp) - N) // hop + 1)[:, None]
    return np.fft.rfft(xp[idx] * w, axis=1)
def split(early, late, out):
    pe, pl, po = (np.abs(stft(z)) ** 2 for z in (early, late, out)); live = pe + pl > max(pe.max(), pl.max()) * 1e-5
    f = np.fft.rfftfreq(2048, 1 / FS); sp, rv = (pe > 10 * pl) & live, (pl > 10 * pe) & live
    return [[po[sp & m].sum(), pe[sp & m].sum(), po[rv & m].sum(), pl[rv & m].sum()] for m in [f[None] >= 0] + [(f[None] >= a) & (f[None] < b) for a, b in OCT]]
def sisdr(r, e):
    r, e = r - r.mean(), e - e.mean(); t = np.dot(e, r) / np.dot(r, r) * r; n = np.dot(e - t, e - t)
    return 10 * np.log10(np.dot(t, t) / n) if n > 0 else np.inf

def score(a):
    path, out, dry_out = a
    from pesq import pesq; from pystoi import stoi; import pyloudnorm as pyln
    sys.path.insert(0, HERE); from speech import dnsmos
    dry, early, late, rev = (rf32(f'{path}.{k}.f32') for k in ('dry', 'early', 'late', 'rev'))
    r16 = lambda z: resample_poly(z, 1, 3); m = pyln.Meter(FS); li, lo = m.integrated_loudness(rev), m.integrated_loudness(out)
    try: from srmrpy import srmr; s = float(srmr(r16(out), 16000, fast=False, norm=False)[0])
    except ImportError: s = np.nan
    r = dict(split=split(early, late, out), pesq=pesq(16000, r16(dry), r16(out), 'wb'), stoi=stoi(r16(dry), r16(out), 16000),
             srmr=s, dns=dnsmos(r16(out * 10 ** ((li - lo) / 20))))
    if dry_out is not None: r.update(dry_same=float(np.array_equal(np.float32(dry), np.float32(dry_out))), dry_pesq=pesq(16000, r16(dry), r16(dry_out), 'wb'))
    return r

def db(a, b): return 10 * np.log10(max(a, 1e-30) / max(b, 1e-30))
def rows(label, R):
    S = np.sum([r['split'] for r in R], 0); m = lambda k: np.mean([r[k] for r in R])
    print(f"| {label} | {db(S[0][0], S[0][1]):+.2f} | {db(S[0][2], S[0][3]):+.1f} | {m('pesq'):.2f} | {m('stoi'):.3f} | {m('srmr'):.2f} | "
          + ' | '.join(f'{v:.2f}' for v in np.mean([r['dns'] for r in R], 0)) + (f" | {m('dry_same'):.0%} | {m('dry_pesq'):.2f} |" if 'dry_same' in R[0] else ' | – | – |'))
    print('|   per octave, voice lost | ' + ' | '.join(f'{db(s[0], s[1]):+.2f}' for s in S[1:]) + ' |')
    print('|   per octave, tail taken | ' + ' | '.join(f'{db(s[2], s[3]):+.1f}' for s in S[1:]) + ' |')

def bands(z, fs):
    P = np.abs(np.fft.rfft(z)) ** 2; f = np.fft.rfftfreq(len(z), 1 / fs); return np.array([P[(f >= a) & (f < b)].sum() for a, b in OCT])

def music(kernel, strength):
    v, w = (sorted(glob.glob(f'{DATA}/vocalset/FULL/*/excerpts/{k}/*.wav')) for k in ('spoken', 'straight'))
    sets = {f'spoken (VocalSet, {len(v)})': [rwav(p)[0] for p in v], f'sung (VocalSet, {len(w)})': [rwav(p)[0] for p in w]}
    for n in ['vibeace', 'brahms', 'nutcracker', 'trumpet']:
        p = f'{DATA}/repair/{n}.f32'
        if os.path.exists(p): sets[n] = [rf32(p)[:44100 * 60]]
    m = sorted(glob.glob(f'{DATA}/musdb/test-mono/*.f32'))[1::2]
    if m: sets[f'MUSDB18 previews ({len(m)})'] = [rf32(p) for p in m]
    g = sorted(glob.glob(f'{DATA}/guitarset/audio_mono-mic/*.wav'))[9::18]
    if g: sets[f'GuitarSet ({len(g)})'] = [rwav(p)[0][:44100 * 30] for p in g]
    print('\n| through it as it is | untouched | SI-SDR dB | ' + ' | '.join(f'{a}–{b}' for a, b in OCT) + ' |')
    print('|---|---|---|' + '---|' * len(OCT))
    for k, xs in sets.items():
        ys = through(kernel, 44100, strength, xs); bi, bo = sum(bands(x, 44100) for x in xs), sum(bands(y, 44100) for y in ys)
        same = np.mean([np.array_equal(np.float32(x), np.float32(y)) for x, y in zip(xs, ys)])
        print(f'| {k} | {same:.0%} | {np.median([sisdr(x, y) for x, y in zip(xs, ys)]):.1f} | ' + ' | '.join(f'{db(o, i):+.2f}' for o, i in zip(bo, bi)) + ' |')

if __name__ == '__main__':
    if sys.argv[1:2] == ['build']: build(); sys.exit()
    name = sys.argv[1] if len(sys.argv) > 1 else 'test'
    kernel = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(HERE, '..', 'packages', 'denoise-dereverb', 'dereverb.js')
    strength = float(sys.argv[3]) if len(sys.argv) > 3 else 1
    paths = sorted(p[:-8] for p in glob.glob(f'{OUT}/{name}/*.rev.f32'))
    revs, drys = [rf32(p + '.rev.f32') for p in paths], [rf32(p + '.dry.f32') for p in paths]
    outs, douts = through(kernel, FS, strength, revs), through(kernel, FS, strength, drys)
    with Pool(8) as pool: R0, R = pool.map(score, [(p, x, None) for p, x in zip(paths, revs)]), pool.map(score, list(zip(paths, outs, douts)))
    print(f'{os.path.relpath(kernel)}, strength {strength:g}, {name} set\n')
    print('| takes | voice lost dB | tail taken dB | PESQ | STOI | SRMR | SIG | BAK | OVRL | dry: untouched | dry: PESQ |')
    print('|---|---|---|---|---|---|---|---|---|---|---|')
    for label, keep in [('short', lambda p: 'long-' not in p), ('long', lambda p: 'long-' in p)]:
        for tag, RR in [('input', R0), ('output', R)]: rows(f'{label}, {tag}', [r for p, r in zip(paths, RR) if keep(p)])
    music(kernel, strength)
