# PESQ and STOI of the speech takes scripts/debleed.js wrote (the cohost and click material), against the wanted voice:
#   python scripts/debleed.py [tune|test]
# Python 3.9+, numpy, scipy, pesq 0.0.4, pystoi 0.4.1. As scripts/speech.py scores: at 16 kHz
# (scipy.signal.resample_poly 1:3), PESQ the ITU-T P.862.2 wideband MOS-LQO (python-pesq), STOI Taal et al., IEEE TASLP
# 19(7), 2011 (pystoi, extended=False). Rows per path (static, moving) and system; columns by the bleed's level.
import os, sys, glob, numpy as np
from scipy.signal import resample_poly
from pesq import pesq
from pystoi import stoi

half = sys.argv[1] if len(sys.argv) > 1 else 'test'
OUT = os.path.expanduser(f'~/.cache/audiojs/data/debleed/out/{half}')
rd = lambda p: resample_poly(np.fromfile(p, dtype=np.float32).astype(np.float64), 1, 3)

for cond in sorted(os.listdir(OUT)):
    base = os.path.join(OUT, cond)
    print(f'\n{half}, {cond} path: PESQ / STOI, speech wanted (cohost, click), at a bleed of −30, −18, −6 dB\n')
    print('| | −30 dB | −18 dB | −6 dB |\n|---|---|---|---|')
    for sys_ in ['input'] + sorted(d for d in os.listdir(base) if d not in ('clean', 'input')):
        cells = []
        for g in ['-30', '-18', '-6']:
            ps, st = [], []
            for f in sorted(glob.glob(os.path.join(base, 'clean', f'*{g}-*.f32'))):
                c, y = rd(f), rd(os.path.join(base, sys_, os.path.basename(f)))
                ps.append(pesq(16000, c, y, 'wb')); st.append(stoi(c, y, 16000, extended=False))
            cells.append(f'{np.mean(ps):.2f} / {np.mean(st):.3f}')
        print(f'| {sys_} | ' + ' | '.join(cells) + ' |')
