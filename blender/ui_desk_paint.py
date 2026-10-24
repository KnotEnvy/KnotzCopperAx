"""Oak desk top for the map interlude (ui-flow r7): horizontal planks with real grain, bevelled seams, knots, nail heads, scratches,
ring stains and ink spatter, lit by a lamp pool from the upper left (baked). Pure numpy: run with Blender's bundled python, no Blender slot.

    ~/.local/opt/blender-5.2.1-linux-x64/5.2/python/bin/python3.13 blender/ui_desk_paint.py [out.png] [W H]
      -> public/assets/ui/desk.png  (then node tools/ui-art-encode.mjs for .webp)
"""
import os
import sys
import math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from lib.mapkit import fbm, vnoise, smoothstep, mix, blur, save_png, hexc  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'public', 'assets', 'ui', 'desk.png')
W = int(sys.argv[2]) if len(sys.argv) > 3 else 1920
Hh = int(sys.argv[3]) if len(sys.argv) > 3 else 1080
rs = np.random.RandomState(7)
Y, X = np.mgrid[0:Hh, 0:W].astype(np.float32)

PL = 232                      # plank height (px)
row = np.floor(Y / PL).astype(np.int32)
v = (Y - row * PL) / PL       # 0..1 across the plank
# each plank: own tint, own grain phase, own x offset (so seams don't line up)
tint = np.array([[0.92, 0.86, 0.80], [1.02, 0.98, 0.94], [0.86, 0.80, 0.76], [1.06, 1.0, 0.92], [0.94, 0.9, 0.84], [0.88, 0.84, 0.78]], np.float32)
ti = tint[row % len(tint)]
off = (row * 411.0 % 977.0).astype(np.float32)
Xp = X + off
# long grain: noise stretched along x, warped by a slow field; cathedral-like arcs from a second warp
warp = fbm(Xp / 600, Y / 90, 3, seed=3) - .5
g1 = fbm(Xp / 340, (Y + warp * 120) / 5.2, 5, seed=11)
g2 = fbm(Xp / 90, (Y + warp * 40) / 2.1, 3, seed=12)
ring = .5 + .5 * np.sin((Y + warp * 160 + 60 * fbm(Xp / 500, Y / 200, 2, seed=14)) * .21)
grain = 0.55 * g1 + 0.25 * g2 + 0.2 * ring
# pores: short dark dashes
pores = smoothstep(.72, .85, fbm(Xp / 22, Y / 1.4, 2, seed=15))
base_lo = np.array(hexc('#2c1709'), np.float32); base_hi = np.array(hexc('#6a3e1c'), np.float32)
col = mix(base_lo, base_hi, np.clip(grain * 1.25 - .12, 0, 1)[..., None]) * ti
col *= (1 - .32 * pores)[..., None]
# knots
for _ in range(7):
    kx, ky = rs.rand() * W, rs.rand() * (Hh - 40) + 20
    r = 14 + rs.rand() * 20
    d = np.hypot((X - kx) / 1.9, (Y - ky))
    kn = np.exp(-(d / r) ** 2)
    rings = .5 + .5 * np.sin(d * (.5 + .4 * rs.rand()))
    col = col * (1 - .55 * kn[..., None] * (.5 + .5 * rings[..., None]))
# seams (dark gap with a lit bevel above)
sd = np.minimum(v, 1 - v) * PL
seam = np.exp(-(sd / 2.2) ** 2)
col *= (1 - .85 * seam)[..., None]
bev = np.exp(-(((v * PL) - 5.5) / 2.0) ** 2)
col = col + (bev[..., None] * np.array([.14, .09, .04], np.float32))
# butt joints (vertical seams) at random x per plank
for r_ in range(int(Hh / PL) + 1):
    jx = (rs.rand() * W * .8 + W * .1)
    m = (row == r_)
    seamv = np.exp(-(np.abs(X - jx) / 1.8) ** 2) * m
    col *= (1 - .8 * seamv)[..., None]
    for k in range(2):
        for dy in (PL * .2, PL * .8):
            n = np.hypot(X - (jx + (-14 if k else 14)), Y - (r_ * PL + dy)) < 2.4
            col[n] = col[n] * .35 + np.array([.12, .1, .09], np.float32) * .65
# scratches + gouges
for _ in range(60):
    x0, y0 = rs.rand() * W, rs.rand() * Hh; a = rs.rand() * math.pi; ln = 20 + rs.rand() * 90
    t = np.linspace(0, 1, int(ln))
    for tt in t:
        px, py = int(x0 + math.cos(a) * ln * tt), int(y0 + math.sin(a) * ln * tt)
        if 0 <= px < W and 0 <= py < Hh:
            col[py, px] = col[py, px] * .78 + np.array([.55, .38, .2], np.float32) * .22
# ring stains (cup rings) and ink spatter
for _ in range(3):
    cx, cy = rs.rand() * W, rs.rand() * Hh; R = 60 + rs.rand() * 30
    d = np.abs(np.hypot(X - cx, Y - cy) - R)
    col *= (1 - .2 * np.exp(-(d / 2.5) ** 2) * (.5 + .5 * fbm(X / 30, Y / 30, 2, seed=17)))[..., None]
for _ in range(40):
    cx, cy = rs.rand() * W, rs.rand() * Hh; R = 1 + rs.rand() * 3.2
    d = np.hypot(X - cx, Y - cy) < R
    col[d] = col[d] * .25 + np.array([.04, .03, .06], np.float32) * .75
# wide worn polish: slight sheen streaks
col *= (0.94 + .12 * fbm(X / 900, Y / 300, 2, seed=19))[..., None]
# baked lamp pool: warm, centred up-left of the paper, falling to a dark vignette (the paper stands in the middle; the lamp is off-sheet)
lx, ly = W * 0.22, Hh * 0.06
dl = np.hypot((X - lx) / (W * .78), (Y - ly) / (Hh * 1.1))
pool = np.clip(1.25 - dl, 0, 1) ** 1.35
light = 0.34 + 0.95 * pool
col = col * light[..., None] * np.array([1.0, .88, .70], np.float32) + (pool ** 3)[..., None] * np.array([.12, .06, .015], np.float32)
dv = np.hypot((X - W / 2) / (W * .62), (Y - Hh / 2) / (Hh * .66))
col *= (1 - .55 * smoothstep(.55, 1.15, dv))[..., None]
col = np.clip(col, 0, 1)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
save_png(OUT, (col ** (1 / 1.0) * 255 + .5).astype(np.uint8))
print('wrote', OUT)
