"""Standalone post for the relief map (ui-flow r7): reads progress/tmp/map_{beauty,normal,depth}.npy written by build_ui_map.py and writes
the ink-outlined, hatched, parchment-graded map as PNG.   <bundled python> blender/ui_map_post.py [out.png] [key=value ...]
(key=value overrides post parameters, e.g. ink_gain=2.4 hatch=.5 n0=.8)"""
import os
import sys
import time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from lib import mapkit as MK, mappost  # noqa: E402

ROOT = os.path.dirname(HERE)
tmp = os.path.join(ROOT, 'progress', 'tmp')
out = next((a for a in sys.argv[1:] if '=' not in a), os.path.join(tmp, 'map_post.png'))
P = {k: float(v) for k, v in (a.split('=') for a in sys.argv[1:] if '=' in a)}
t0 = time.time()
b = np.load(os.path.join(tmp, 'map_beauty.npy')).astype(np.float32)
n = np.load(os.path.join(tmp, 'map_normal.npy'))
d = np.load(os.path.join(tmp, 'map_depth.npy'))
H_, W_ = b.shape[:2]
res = mappost.post(b, n, d, W_, H_, P)
MK.save_png(out, (res * 255 + .5).astype(np.uint8))
print('wrote', out, f'{W_}x{H_}', round(time.time() - t0, 1), 's')
