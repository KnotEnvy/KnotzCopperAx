"""Quick look at progress/tmp/throne_rgba.npy over a flat dusk colour (bundled python): ui_throne_preview.py [out.png]"""
import os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from lib.mapkit import save_png
ROOT = os.path.dirname(HERE)
a = np.load(os.path.join(ROOT, 'progress', 'tmp', 'throne_rgba.npy')).astype(np.float32)
h, w = a.shape[:2]
y = np.linspace(0, 1, h)[:, None, None]
bg = np.array([.30, .10, .16], np.float32) * (1 - y) + np.array([.06, .03, .08], np.float32) * y
rgb = a[..., :3] + bg * (1 - a[..., 3:4])
rgb = 1 - np.exp(-np.clip(rgb, 0, 4) * 1.25)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'progress', 'tmp', 'throne_preview.png')
save_png(out, (rgb * 255 + .5).astype(np.uint8)); print(out, w, h)
