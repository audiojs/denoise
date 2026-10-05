# Wind for scripts/lowend.js dewind: recorded and generated wind, and the scores of what dewind made of speech under it.
#   python scripts/wind.py fetch          the wind below into ~/.cache/audiojs/data/wind/{real,sc}/*.f32 (48 kHz float32)
#   python scripts/wind.py score DIR [test]   PESQ, STOI, DNSMOS of the outputs `node scripts/lowend.js dewind --out DIR`
#                                             wrote, per wind and speech-to-wind ratio, against VoiceBank's clean takes
#                                             (training subset; `test`: the test set)
# Python 3.9+, numpy, scipy, pesq, pystoi, onnxruntime (as scripts/speech.py, whose scoring this is); ffmpeg for fetch.
#
# Recorded: twelve recordings of wind on a microphone from freesound.org, all CC0, their 128 kb/s previews decoded to
# 48 kHz mono, the first 90 s, high-passed at 20 Hz (2nd-order Butterworth: a recorder's input high-pass, subsonic
# rumble out). Six tune (the first of each pair below), six test:
#   151853 carroll27 "Wind.aif", 170439 Argande102 "Wind on microphone", 207443 HabloFame "Wind.wav",
#   239485 Daphne_in_Wonderland "Bass wind in the mic 3.wav", 397641 omnomducks "Low bass wind sound.wav",
#   592387 cribbler "Wind in microphone", 611197 klankbeeld "wind in ears.wav", 623003 ownache "wind_01.mp3",
#   718030 JoMungus "Wind blowing on a microphone", 760989 mathiaslyhne1 "4. Wind in mic",
#   117773 klangfabrik "roaring wind.aiff" (also ESC-50's), 20108 cognito perceptu "air over mic.wav"
# Generated: the SC-Wind-Noise-Generator (Mirabilii, Lodermeyer, Czwielong, Becker & Habets, "Simulating wind noise
# with airflow speed-dependent characteristics", IWAENC 2022; github.com/audiolabs/SC-Wind-Noise-Generator, MIT, at
# ff9e74c), a Weibull wind-speed profile driving an AR(5) spectrum and GARCH gusts fitted to measured wind: twelve 20 s
# draws at 48 kHz, seeds 1–12 (gustiness 3 + seed mod 8), 1–6 tune, 7–12 test; `spectrum.lsf2poly` replaced by the
# standard LSF-to-LPC conversion below.
import os, sys, types, subprocess, urllib.request, numpy as np
from scipy.signal import butter, sosfilt

DATA = os.path.expanduser('~/.cache/audiojs/data')
OUT = os.path.join(DATA, 'wind')
REAL = {'151853': '151/151853_2094213', '170439': '170/170439_3145349', '207443': '207/207443_3702088',
        '239485': '239/239485_667113', '397641': '397/397641_2479682', '592387': '592/592387_3728489',
        '611197': '611/611197_1648170', '623003': '623/623003_9541584', '718030': '718/718030_11865776',
        '760989': '760/760989_4977295', '117773': '117/117773_181941', '20108': '20/20108_57789'}
SC = 'https://raw.githubusercontent.com/audiolabs/SC-Wind-Noise-Generator/ff9e74c40329c11d6437a01e1c9b164ac228c944/sc_wind_noise_generator.py'

def lsf2poly(lsf):
    lsf = np.sort(np.asarray(lsf, float)); z = np.exp(1j * lsf)
    rQ, rP = z[0::2], z[1::2]
    Q, P = np.poly(np.concatenate((rQ, rQ.conj()))), np.poly(np.concatenate((rP, rP.conj())))
    if len(lsf) % 2: P = np.convolve(P, [1, 0, -1])
    else: P, Q = np.convolve(P, [1, -1]), np.convolve(Q, [1, 1])
    return np.real(0.5 * (P + Q))[:-1]

def fetch():
    os.makedirs(os.path.join(OUT, 'real'), exist_ok=True); os.makedirs(os.path.join(OUT, 'sc'), exist_ok=True)
    hp = butter(2, 20, 'highpass', fs=48000, output='sos')
    for sid, path in REAL.items():
        dst = os.path.join(OUT, 'real', sid + '.f32')
        if os.path.exists(dst): continue
        mp3 = urllib.request.urlopen(f'https://cdn.freesound.org/previews/{path}-hq.mp3', timeout=120).read()
        x = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', 'pipe:', '-ac', '1', '-ar', '48000', '-t', '90', '-f', 'f32le', 'pipe:'],
                           input=mp3, capture_output=True, check=True).stdout
        sosfilt(hp, np.frombuffer(x, np.float32).astype(np.float64)).astype(np.float32).tofile(dst); print(dst)
    for m in ['spectrum', 'sounddevice', 'soundfile', 'matplotlib', 'matplotlib.pyplot']: sys.modules.setdefault(m, types.ModuleType(m))
    sys.modules['spectrum'].lsf2poly = lsf2poly
    gen = types.ModuleType('scw'); exec(urllib.request.urlopen(SC, timeout=120).read().decode(), gen.__dict__)
    for seed in range(1, 13):
        dst = os.path.join(OUT, 'sc', f'sc{seed}.f32')
        if os.path.exists(dst): continue
        x, _ = gen.WindNoiseGenerator(fs=48000, duration=20, generate=True, gustiness=3 + seed % 8, short_term_var=True, start_seed=seed).generate_wind_noise()
        x.astype(np.float32).tofile(dst); print(dst)

def score(out, test):
    from multiprocessing import Pool
    from collections import defaultdict
    with Pool(int(os.environ.get('J', 6)), initializer=_init, initargs=(test,)) as pool:
        rows = pool.map(_one, sorted(os.path.join(out, f) for f in os.listdir(out) if f.endswith('.f32')))
    acc = defaultdict(list)
    for r in rows: acc[(r[0], r[1])].append(r[2:]); acc[('all', '')].append(r[2:])
    print(f'{out}: wind SWR | PESQ STOI SIG BAK OVRL')
    for k in sorted(acc, key=lambda k: (k[0] == 'all', k[0], -int(k[1] or 0))):
        print(f'{k[0]:9s} {k[1]:>4s} | ' + ' '.join(f'{m:.3f}' for m in np.nanmean(np.array(acc[k]), 0)))

_ref = None
def _init(test):
    global _ref
    _ref = os.path.join(DATA, 'vbdemand/clean_testset_wav' if test else 'vbdemand-train/clean')

def _one(p):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from speech import dnsmos, to16, read_wav
    from pesq import pesq
    from pystoi import stoi
    src, swr, name = os.path.basename(p)[:-4].split('_', 2)
    r, e = to16(read_wav(os.path.join(_ref, name + '.wav')), 48000), to16(np.fromfile(p, np.float32).astype(np.float64), 48000)
    try: q = pesq(16000, r, e, 'wb')
    except Exception: q = float('nan')
    return (src, swr, q, stoi(r, e, 16000, extended=False), *dnsmos(e))

if __name__ == '__main__':
    if sys.argv[1:2] == ['fetch']: fetch()
    elif sys.argv[1:2] == ['score']: score(sys.argv[2], sys.argv[3:4] == ['test'])
    else: print(__doc__ or open(__file__).read().split('\nimport')[0])
