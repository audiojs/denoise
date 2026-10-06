# Noise for scripts/detect.js, and the scores of what each reducer made of the noisy speech it routes.
#   python scripts/detect.py fetch              DEMAND recordings of kinds in neither VoiceBank+DEMAND set into
#                                               ~/.cache/audiojs/data/demand/<KIND>/ch01.wav (48 kHz, channel 1)
#   python scripts/detect.py score tune|test    PESQ, STOI, DNSMOS of the takes `node scripts/detect.js SET reduce`
#                                               wrote, per noise, and omlsa − wiener paired per noise: mean ± 1.96 s/√n
# Python 3.9+, numpy, scipy, pesq, pystoi, onnxruntime (as scripts/speech.py, whose scoring this is).
#
# DEMAND (Thiemann, Ito & Vincent, "The Diverse Environments Multi-channel Acoustic Noise Database", ICA 2013;
# zenodo.org/records/1227121, CC BY-SA 3.0): DWASHING (washing machine), NFIELD (sports field), NPARK (city park),
# NRIVER (creek), OHALLWAY (office hallway), 5 min each; VoiceBank+DEMAND took its training noises and its test noises
# (bus, cafe, living room, office, public square) from the other kinds.
import os, sys, io, json, zipfile, urllib.request, numpy as np
from multiprocessing import Pool

DATA = os.path.expanduser('~/.cache/audiojs/data')
KINDS = ['DWASHING', 'NFIELD', 'NPARK', 'NRIVER', 'OHALLWAY']

def fetch():
    for k in KINDS:
        dst = os.path.join(DATA, 'demand', k, 'ch01.wav')
        if os.path.exists(dst): continue
        z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(f'https://zenodo.org/records/1227121/files/{k}_48k.zip?download=1', timeout=600).read()))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'wb').write(z.read(f'{k}/ch01.wav')); print(dst)

def _one(a):
    d, system, m = a
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from speech import dnsmos, to16, read_f32
    from pesq import pesq
    from pystoi import stoi
    r, e = to16(read_f32(f"{d}/clean/{m['id']}.f32"), m['fs']), to16(read_f32(f"{d}/{system}/{m['id']}.f32"), m['fs'])
    n = min(len(r), len(e)); r, e = r[:n], e[:n]
    try: q = pesq(16000, r, e, 'wb')
    except Exception: q = float('nan')
    return (q, stoi(r, e, 16000, extended=False), *dnsmos(e))

def score(setname):
    d = os.path.join(DATA, 'detect', setname); meta = json.load(open(f'{d}/meta.json'))
    S, K = ['noisy', 'wiener', 'omlsa', 'dewind'], ['PESQ', 'STOI', 'SIG', 'BAK', 'OVRL']
    with Pool(int(os.environ.get('J', 6))) as pool:
        v = {s: np.array(pool.map(_one, [(d, s, m) for m in meta], chunksize=4)) for s in S}
    cls = [m['cls'].replace('speech, ', '').replace('speech + ', '') for m in meta]
    noise = [f"{c}: {m['type']}" for c, m in zip(cls, meta)]
    print(f'{d}: per noise and kind, PESQ STOI SIG BAK OVRL of ' + ', '.join(S) + '; then omlsa − wiener')
    for k in sorted(set(noise)) + sorted(set(cls)) + ['all']:
        i = np.array([k in ('all', n, c) for n, c in zip(noise, cls)])
        print(f'{k:28s} {i.sum():4d} | ' + ' | '.join(' '.join(f'{x:.3f}' for x in np.nanmean(v[s][i], 0)) for s in S) + ' | ' +
              ' '.join(f'{np.nanmean(x):+.3f}±{1.96 * np.nanstd(x) / np.sqrt(i.sum()):.3f}' for x in (v['omlsa'][i] - v['wiener'][i]).T))

if __name__ == '__main__':
    if sys.argv[1:2] == ['fetch']: fetch()
    elif sys.argv[1:2] == ['score']: score(sys.argv[2])
    else: print(open(__file__).read().split('\nimport')[0])
