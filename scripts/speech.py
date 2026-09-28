# Scores for the speech clean-up measurements, from the outputs scripts/speech.mjs writes.
#   python scripts/speech.py fetch [PER_SPEAKER]          VoiceBank+DEMAND training subset (tuning data)
#   python scripts/speech.py score vbdemand|vbtrain SYSTEM...  PESQ, STOI, SI-SDR, DNSMOS, musical noise
#   python scripts/speech.py resample vbdemand|vbtrain RATE   the noisy inputs at RATE, for SET@RATE (scored at 16 kHz)
#   SHARD=K/N python scripts/speech.py score ...           only the files the runner's SHARD K/N took
#   python scripts/speech.py score vbclean|vbhum50|vbhum60 SYSTEM...  PESQ, STOI, SI-SDR against the clean speech
#   python scripts/speech.py score rooms SYSTEM...          DNSMOS, noise floor, speech level
#   python scripts/speech.py score noise SYSTEM...          stationary noise alone: musical noise, noise reduction
#   python scripts/speech.py score vbreverb|vbreverb-train|vbreverb-dry SYSTEM...  reverberant speech (dry takes in:
#                                                           vbreverb-dry) against the dry takes, DNSMOS as below
# Python 3.9+, numpy, scipy, pesq 0.0.4, pystoi 0.4.1, onnxruntime; DNSMOS: sig_bak_ovr.onnx from
# microsoft/DNS-Challenge at 82f1b17e77 (DNSMOS/DNSMOS/, CC BY 4.0) in ~/.cache/audiojs/neural/dnsmos/.
#
# The scoring is @audio/neural-denoise's scripts/accuracy.py, so the rows compare with its table:
#   all at 16 kHz (scipy.signal.resample_poly(x, 1, 3));
#   PESQ: ITU-T P.862.2 wideband MOS-LQO (python-pesq, the ITU reference C); STOI: Taal et al., IEEE TASLP 19(7),
#   2011 (pystoi, extended=False); SI-SDR: Le Roux et al., ICASSP 2019, eq. 3, zero-mean, dB;
#   DNSMOS P.835 (Reddy, Gopal, Cutler, ICASSP 2022) as dnsmos_local.py at 82f1b17e77 computes it, non-personalized:
#   9.01 s windows at a 1 s hop, short clips tiled, SIG/BAK/OVRL polynomial fits averaged over windows.
# Added here:
#   musical noise, the log kurtosis ratio (Uemura et al., IWAENC 2008; Miyazaki et al., IEEE TASLP 20(7), 2012):
#     ln(kurt(out) / kurt(in)) of the power spectral values |X(k,l)|^2 in noise-only frames, kurt = E[x^2] / E[x]^2
#     over those values (for Gaussian noise E[x^2]/E[x]^2 = 2). A gain that scales the noise leaves it at 0;
#     isolated surviving peaks, musical noise, raise it. 512-point Hann frames, 128 hop, 94 Hz to 7.9 kHz; a frame is
#     noise-only where the clean reference sits 40 dB under its loudest frame.
#   vbreverb sets: DNSMOS reads absolute level, so each output is scored at its input's loudness (ITU-R BS.1770-4
#     integrated, pyloudnorm), as audio's bench/speech.py does: a dereverberator lowers the level by what it takes.
#   rooms: the noise floor, RMS of the quietest 500 ms at a 50 ms hop (ACX Check's measure; audio's `check acx`
#     notes a floor under -90 dB as dead silence), and the speech level change, mean power of the loudest half of
#     50 ms frames, against the raw input.
import os, sys, glob, csv, json, numpy as np, onnxruntime as ort
from multiprocessing import Pool
from scipy.signal import resample_poly
from scipy.io import wavfile

DATA = os.path.expanduser('~/.cache/audiojs/data')
CACHE = os.environ.get('AUDIO_NEURAL_CACHE') or os.path.expanduser('~/.cache/audiojs/neural')
SETS = {'vbdemand': ('vbdemand', 'clean_testset_wav', 'noisy_testset_wav'),
        'vbtrain': ('vbdemand-train', 'clean', 'noisy'),
        'vbclean': ('vbdemand', 'clean_testset_wav', 'clean_testset_wav'),
        'vbhum50': ('vbdemand', 'clean_testset_wav', None), 'vbhum60': ('vbdemand', 'clean_testset_wav', None),
        'vbreverb': ('vbreverb', 'test-clean', 'test-reverb'), 'vbreverb-train': ('vbreverb', 'train-clean', 'train-reverb'),
        'vbreverb-dry': ('vbreverb', 'test-clean', 'test-clean')}
OUT = {'vbclean': 'out-clean', 'vbhum50': 'out-hum50', 'vbhum60': 'out-hum60', 'vbreverb-train': 'out-train', 'vbreverb-dry': 'out-dry'}
P_SIG = np.poly1d([-0.08397278, 1.22083953, 0.0052439])
P_BAK = np.poly1d([-0.13166888, 1.60915514, -0.39604546])
P_OVR = np.poly1d([-0.06766283, 1.11546468, 0.04602535])
_sess = None

# VoiceBank+DEMAND training subset (Valentini-Botinhao 2017, CC BY 4.0, doi:10.7488/ds/2117) by HTTP range requests,
# not the 5 GB of zips: the zips' central directories, then each chosen member. The 28-speaker training set shares no
# speaker (the test set is p232, p257) and no noise recording with the test set.
ZIPS = {'clean': '245452b6-6235-44b6-a6f9-e7eb19797769', 'noisy': 'ecb5a102-bb00-46d3-8af5-40c79823b837'}
BITSTREAM = 'https://datashare.ed.ac.uk/server/api/core/bitstreams/%s/content'

def _get(url, a=None, b=None):
    import urllib.request
    req = urllib.request.Request(url)
    if a is not None: req.add_header('Range', f'bytes={a}-{b}')
    with urllib.request.urlopen(req, timeout=120) as r: return r.read(), r.headers

def _central(url):
    import struct
    n = int(_get(url, 0, 0)[1]['Content-Range'].split('/')[1]); tail = _get(url, n - 65536, n - 1)[0]
    e = tail.rfind(b'PK\x05\x06'); cnt, cdsize, cdoff = struct.unpack('<HII', tail[e + 10:e + 20])
    cd = _get(url, cdoff, cdoff + cdsize - 1)[0]; ents, o = {}, 0
    while o < len(cd) and cd[o:o + 4] == b'PK\x01\x02':
        meth, = struct.unpack('<H', cd[o + 10:o + 12]); csz, usz = struct.unpack('<II', cd[o + 20:o + 28])
        nl, xl, cl = struct.unpack('<HHH', cd[o + 28:o + 34]); loff, = struct.unpack('<I', cd[o + 42:o + 46])
        ents[os.path.basename(cd[o + 46:o + 46 + nl].decode())] = (meth, csz, usz, loff); o += 46 + nl + xl + cl
    return ents

def _member(url, ent):
    import struct, zlib
    meth, csz, usz, loff = ent
    nl, xl = struct.unpack('<HH', _get(url, loff, loff + 29)[0][26:30])
    d = _get(url, loff + 30 + nl + xl, loff + 30 + nl + xl + csz - 1)[0]
    out = zlib.decompress(d, -15) if meth == 8 else d
    assert len(out) == usz; return out

def fetch(per=18):
    """per evenly spaced utterances of each of the 28 speakers into ~/.cache/audiojs/data/vbdemand-train/{clean,noisy}."""
    from concurrent.futures import ThreadPoolExecutor
    out = os.path.join(DATA, 'vbdemand-train'); cds = {k: _central(BITSTREAM % v) for k, v in ZIPS.items()}
    spk = {}
    for n in sorted(n for n in cds['noisy'] if n.endswith('.wav')): spk.setdefault(n.split('_')[0], []).append(n)
    pick = [L[int(i * len(L) / per)] for s, L in sorted(spk.items()) for i in range(per)]
    for k in ZIPS: os.makedirs(os.path.join(out, k), exist_ok=True)
    def one(n):
        for k in ZIPS:
            f = os.path.join(out, k, n)
            if not os.path.exists(f):
                open(f + '.part', 'wb').write(_member(BITSTREAM % ZIPS[k], cds[k][n])); os.replace(f + '.part', f)
    with ThreadPoolExecutor(8) as ex: list(ex.map(one, pick))
    print(f'{len(pick)} utterances of {len(spk)} speakers in {out}')

def dnsmos(x16):
    global _sess
    if _sess is None:
        so = ort.SessionOptions(); so.intra_op_num_threads = 1; so.inter_op_num_threads = 1
        _sess = ort.InferenceSession(os.path.join(CACHE, 'dnsmos', 'sig_bak_ovr.onnx'), so)
    fs, need = 16000, int(9.01 * 16000)
    a = x16.astype(np.float64)
    while len(a) < need: a = np.append(a, a)
    s = []
    for i in range(int(np.floor(len(a) / fs) - 9.01) + 1):
        seg = a[int(i * fs): int((i + 9.01) * fs)]
        if len(seg) == need: s.append(_sess.run(None, {'input_1': seg.astype('float32')[None]})[0][0])
    s = np.array(s)
    return float(np.mean(P_SIG(s[:, 0]))), float(np.mean(P_BAK(s[:, 1]))), float(np.mean(P_OVR(s[:, 2])))

def sisdr(ref, est):
    ref = ref - ref.mean(); est = est - est.mean()
    t = np.dot(est, ref) / np.dot(ref, ref) * ref
    return float(10 * np.log10(np.dot(t, t) / np.dot(est - t, est - t)))

def power_frames(x, N=512, hop=128):
    w = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / N)
    n = 1 + max(0, (len(x) - N) // hop)
    idx = np.arange(N)[None, :] + hop * np.arange(n)[:, None]
    return np.abs(np.fft.rfft(x[idx] * w, axis=1)) ** 2

def kurt_ratio(ref16, inp16, out16):
    """ln of the kurtosis ratio of the power spectral values in noise-only frames (bins 3..253 of 512 at 16 kHz)."""
    e = power_frames(ref16).sum(1); quiet = e < e.max() * 1e-4
    if quiet.sum() < 8: return float('nan')
    k = lambda P: np.mean(P ** 2) / np.mean(P) ** 2
    Pi, Po = power_frames(inp16)[quiet, 3:254], power_frames(out16)[quiet, 3:254]
    return float(np.log(k(Po) / k(Pi))) if Po.sum() > 0 else float('nan')

def read_f32(p): return np.fromfile(p, dtype=np.float32).astype(np.float64)
def read_wav(p): return wavfile.read(p)[1].astype(np.float64) / 32768

def to16(x, rate):                                 # resample_poly by the reduced ratio 16000/rate
    from math import gcd
    g = gcd(16000, rate); return resample_poly(x, 16000 // g, rate // g)

def resample(setname, rate):
    """The set's noisy inputs at another rate (48 kHz → RATE by resample_poly) into <set dir>/rate<RATE>/<name>.f32."""
    from math import gcd
    d, _, ndir = SETS[setname]; d = os.path.join(DATA, d); os.makedirs(f'{d}/rate{rate}', exist_ok=True); g = gcd(rate, 48000)
    for p in sorted(glob.glob(f'{d}/{ndir}/*.wav')):
        f = f'{d}/rate{rate}/{os.path.basename(p)[:-4]}.f32'
        if not os.path.exists(f): resample_poly(read_wav(p), rate // g, 48000 // g).astype(np.float32).tofile(f)

def vb(args):
    from pesq import pesq
    from pystoi import stoi
    setname, system, name = args
    base, _, rate = setname.partition('@'); rate = int(rate or 48000)   # SET@RATE: processed at RATE, scored at 16 kHz
    d, cdir, ndir = SETS[base]; d = os.path.join(DATA, d); out = os.path.join(d, OUT.get(base, 'out') if rate == 48000 else f'out@{rate}')
    ref = read_wav(f'{d}/{cdir}/{name}.wav')
    inp = read_wav(f'{d}/{ndir}/{name}.wav') if ndir else read_f32(f'{out}/raw/{name}.f32')
    if system in ('noisy', 'raw'): est = inp if rate == 48000 else read_f32(f'{d}/rate{rate}/{name}.f32')
    else: est = read_f32(f'{out}/{system}/{name}.f32')
    r, i, e = resample_poly(ref, 1, 3), resample_poly(inp, 1, 3), to16(est, rate)
    n = min(len(r), len(e)); r, i, e = r[:n], i[:n], e[:n]
    assert abs(len(est) * 16000 / rate - n) < 2, (system, name)
    noisy = base in ('vbdemand', 'vbtrain')        # clean in: how much is left of it; hum: PESQ tells
    if base.startswith('vbreverb'):
        import pyloudnorm as pyln
        m = pyln.Meter(48000); li, lo = m.integrated_loudness(inp), m.integrated_loudness(est)
        sig, bak, ovr = dnsmos(to16(est * 10 ** ((li - lo) / 20) if np.isfinite(lo) else est, rate))
    else: sig, bak, ovr = dnsmos(e) if noisy else (float('nan'),) * 3
    return dict(name=name, pesq=pesq(16000, r, e, 'wb'), stoi=stoi(r, e, 16000, extended=False), sisdr=sisdr(r, e),
                sig=sig, bak=bak, ovrl=ovr, kurt=kurt_ratio(r, i, e) if noisy else float('nan'))

def floor(x, fs=48000):
    w, h = fs // 2, fs // 20
    return 10 * np.log10(max(min(np.mean(x[i:i + w] ** 2) for i in range(0, len(x) - w, h)), 1e-20))

def speech(x, fs=48000):
    h = fs // 20; p = np.sort([np.mean(x[i:i + h] ** 2) for i in range(0, len(x) - h, h)])
    return 10 * np.log10(np.mean(p[len(p) // 2:]) + 1e-20)

def room(args):
    system, name = args
    d = os.path.join(DATA, 'spoken')
    raw = read_f32(f'{d}/{name}.f32'); x = raw if system == 'raw' else read_f32(f'{d}/out/{system}/{name}.f32')
    sig, bak, ovr = dnsmos(resample_poly(x, 1, 3))
    return dict(name=name, sig=sig, bak=bak, ovrl=ovr, floor=floor(x), rawfloor=floor(raw), dspeech=speech(x) - speech(raw))

def noise_only(args):
    # stationary noise alone: after 2 s (the trackers have converged), the log kurtosis ratio of the power spectral
    # values, out over in, and the noise reduction
    system, name = args
    d = os.path.join(DATA, 'vbdemand', 'out-noise')
    x = resample_poly(read_f32(f'{d}/raw/{name}.f32'), 1, 3)[32000:]; y = resample_poly(read_f32(f'{d}/{system}/{name}.f32'), 1, 3)[32000:]
    k = lambda P: np.mean(P ** 2) / np.mean(P) ** 2
    Pi, Po = power_frames(x)[:, 3:254], power_frames(y)[:, 3:254]
    return dict(name=name, kurt=float(np.log(k(Po) / k(Pi))), nr=float(10 * np.log10(Pi.mean() / Po.mean())))

def summary(system, rows, keys):
    m = {k: np.nanmean([r[k] for r in rows]) for k in keys}
    return f'{system:22s} n={len(rows):3d} ' + '  '.join(f'{k} {m[k]:.3f}' for k in keys)

def score(setname, systems):
    with Pool(4) as pool:
        for system in systems:
            if setname == 'noise':
                rows = [noise_only((system, n)) for n in ['white', 'pink']]
                print(f'{system:22s} ' + '  '.join(f"{r['name']}: log kurtosis ratio {r['kurt']:+.2f}, noise down {r['nr']:.1f} dB" for r in rows), flush=True)
                continue
            if setname == 'rooms':
                d = os.path.join(DATA, 'spoken'); names = sorted(os.path.basename(p)[:-4] for p in glob.glob(f'{d}/*.f32'))
                rows = pool.map(room, [(system, n) for n in names])
                # floors of files whose raw pauses are digital silence say nothing about the denoiser
                live = [r['floor'] for r in rows if r['rawfloor'] > -90]; dead = sum(f < -90 for f in live)
                print(summary(system, rows, ['sig', 'bak', 'ovrl', 'dspeech']) +
                      f'  floor {min(live):.0f} to {max(live):.0f} (median {np.median(live):.0f}) dBFS over {len(live)} files with room tone, {dead} of them under -90', flush=True)
            else:
                base, _, rate = setname.partition('@')
                d = os.path.join(DATA, SETS[base][0]); os.makedirs(f'{d}/scores', exist_ok=True)
                out = os.path.join(d, f'out@{rate}' if rate else OUT.get(base, 'out'), system)   # a shard's outputs score as they are
                k, n = map(int, os.environ.get('SHARD', '0/1').split('/'))   # as the runner's SHARD/N
                names = [os.path.basename(p)[:-4] for i, p in enumerate(sorted(glob.glob(f'{d}/{SETS[base][1]}/*.wav'))) if i % n == k]
                names = [m for m in names if system in ('noisy', 'raw') or os.path.exists(f'{out}/{m}.f32')]
                rows = pool.map(vb, [(setname, system, n) for n in names], chunksize=8)
                print(summary(system, rows, ['pesq', 'stoi', 'sisdr', 'sig', 'bak', 'ovrl', 'kurt']), flush=True)
            out = os.path.join(DATA, SETS.get(setname.partition('@')[0], ('spoken',))[0], 'scores', f'{setname}-{system}.csv')
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, 'w', newline='') as fh:
                w = csv.DictWriter(fh, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)

if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else ''
    if what == 'fetch':
        fetch(int(sys.argv[2]) if len(sys.argv) > 2 else 18)
    elif what == 'resample': resample(sys.argv[2], int(sys.argv[3]))
    elif what == 'score': score(sys.argv[2], sys.argv[3:])
    else: print('usage: python scripts/speech.py fetch [PER_SPEAKER] | resample vbdemand|vbtrain RATE | score vbdemand|vbtrain|vbclean|vbhum50|vbhum60|rooms|noise|vbdemand@RATE|vbtrain@RATE SYSTEM...')
