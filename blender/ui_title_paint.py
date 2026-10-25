"""Title / menu backdrop (ui-flow r8, throne + ridges + trees repainted in r9): a painted, layered dusk matching the logo's crimson + copper - ember-lit clouds, a low sun
glowing behind the thorned Serpent Throne, receding ridges in atmospheric haze, the burning village and the Keep, a copper axe planted in
the foreground, dead trees. Pure numpy (Blender's bundled python, no Blender slot):

    ~/.local/opt/blender-5.2.1-linux-x64/5.2/python/bin/python3.13 blender/ui_title_paint.py [out.png] [W H]
      -> progress/tmp/title_backdrop.png   (then: node tools/ui-art-encode.mjs <png> public/assets/ui/title_backdrop.webp 80)
The centre column (banner + wordmark + menu) is kept calm: the focal throne/sun sit right of centre, the village left.
"""
import os
import sys
import math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from lib.mapkit import fbm, ridged, smoothstep, mix, blur, save_png, hexc  # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'progress', 'tmp', 'title_backdrop.png')
W = int(sys.argv[2]) if len(sys.argv) > 3 else 1920
H = int(sys.argv[3]) if len(sys.argv) > 3 else 1080
S = W / 1920.0
rs = np.random.RandomState(31)
Y, X = np.mgrid[0:H, 0:W].astype(np.float32)
X1, Y1 = X / S, Y / S                       # authoring coordinates (1920x1080)
c3 = lambda h: np.array(hexc(h), np.float32)

HOR = 705.0                                  # horizon (glow) line
SUN = (1495.0, 612.0)

# ------------------------------------------------------------------------------------------------ sky
t = np.clip(Y1 / HOR, 0, 1)
sky_top, sky_mid, sky_low, sky_hor = c3('#07030a'), c3('#2a0b18'), c3('#8a2414'), c3('#f08a30')
sky = np.where(t[..., None] < .5, mix(sky_top, sky_mid, np.clip(t / .5, 0, 1)[..., None] ** 1.1),
               np.where(t[..., None] < .82, mix(sky_mid, sky_low, np.clip((t - .5) / .32, 0, 1)[..., None]), mix(sky_low, sky_hor, np.clip((t - .82) / .18, 0, 1)[..., None] ** 1.4)))
# sun glow: wide warm bloom + hard-ish disc
d = np.hypot(X1 - SUN[0], (Y1 - SUN[1]) * 1.15)
glow = np.exp(-(d / 460.0) ** 1.2) * 1.05 + np.exp(-(d / 130.0) ** 1.6) * .7
sky = sky + np.array([1.0, .52, .16], np.float32)[None, None, :] * glow[..., None]
disc = 1 - smoothstep(118, 126, d)
sky = mix(sky, mix(c3('#ffb040'), c3('#ffe6a0'), np.clip(1 - d / 120.0, 0, 1)[..., None] ** 2), (disc * .95)[..., None])
# clouds: long horizontal bands, edge-lit from below by the horizon glow
cn = fbm(X1 / 520 + 3, Y1 / 70, 5, seed=21)
cn2 = fbm(X1 / 260 + 9, Y1 / 44, 4, seed=22)
dens = smoothstep(.46, .74, cn * .75 + cn2 * .35 + (1 - t) * .16 - .08) * smoothstep(.10, .45, t)
under = np.clip(dens - np.roll(dens, -7, axis=0), -1, 1)                    # >0 where the cloud's lower edge faces the glow
under = blur(np.clip(under, 0, 1), 3) * 3.2
warm_near = np.exp(-(np.hypot(X1 - SUN[0], Y1 - SUN[1]) / 900.0) ** 1.3)
cloud_col = mix(c3('#1a0714'), c3('#6a2230'), (t * .9)[..., None]) + np.array([1.0, .5, .18], np.float32)[None, None, :] * (under * (.35 + .9 * warm_near))[..., None]
cloud_col = cloud_col + np.array([1.0, .45, .15], np.float32)[None, None, :] * (dens * warm_near * .22)[..., None]
img = mix(sky, cloud_col, (dens * .82)[..., None])
# C2 r14 (board r13 "cheap radial god-ray burst over banded sunset gradients"): the CSS burst (a regular conic wedge ring centred on the banner) is gone. The
# rays now come from the SUN that lights the throne: irregular shafts (angle noise, varied width / strength), broken by the cloud bands they pass behind,
# fading with distance, drawn before the ridges so the land occludes them.
ang = np.arctan2(-(Y1 - SUN[1]), X1 - SUN[0])
rdist = np.hypot(X1 - SUN[0], Y1 - SUN[1])
a1_ = fbm(ang * 5.0 + 11.0, np.full_like(ang, 1.7), 4, seed=61)
a2_ = fbm(ang * 17.0 + 3.0, np.full_like(ang, 4.3), 3, seed=62)
shaft = smoothstep(.50, .80, a1_ * .72 + a2_ * .42 - .02)
shaft = shaft * (.45 + .75 * smoothstep(.35, .75, fbm(ang * 40.0, np.full_like(ang, 9.1), 2, seed=63)))
rfade = np.exp(-(rdist / 1150.0) ** 1.25) * smoothstep(150.0, 330.0, rdist)
rays = shaft * rfade * (1 - dens * .65) * smoothstep(.0, .22, t)
img = img + np.array([1.0, .52, .18], np.float32)[None, None, :] * (rays * .24)[..., None]

# ------------------------------------------------------------------------------------------------ ridges (r9: varied crests, no repeated sawtooth)
XS = (np.arange(W, dtype=np.float32) / S)[None, :]


def _n1(x, y, oct, seed):   # smooth 1-D noise along the ridge line
    return fbm(x, np.full_like(x, y), oct, seed=seed)[0]


def _r1(x, y, oct, seed):
    return ridged(x, np.full_like(x, y), oct, seed=seed)[0]


def prof_massif(base, amp, seed):
    """Far range: a few tall irregular summits with jagged flanks only where a low-frequency envelope allows it, saddles between."""
    big = _n1(XS / 700 + seed, 1.3, 3, seed)
    env = smoothstep(.40, .70, _n1(XS / 420 + seed * 2, 4.1, 2, seed + 3))
    jag = _r1(XS / 170 + seed, seed * 1.7, 4, seed + 7)
    h = .70 * big + .62 * env * jag ** 1.4 + .10 * _n1(XS / 55 + seed, .5, 3, seed + 9)
    return base - amp * (h - .20)


def prof_mesa(base, amp, seed):
    """Middle range: broken plateaus and cliffs - terraced steps, not teeth."""
    t = _n1(XS / 430 + seed, 2.2, 3, seed)
    terr = smoothstep(.34, .44, t) * .42 + smoothstep(.50, .60, t) * .33 + smoothstep(.64, .74, t) * .25
    cliff = .08 * _r1(XS / 70 + seed, 1.1, 3, seed + 4)
    return base - amp * (terr + cliff + .16 * (t - .5))


def prof_rolling(base, amp, seed, tilt=0.0, crag=0.0):
    """Near range: low rolling hills, with optional craggy outcrops."""
    h = _n1(XS / 260 + seed, 3.3, 4, seed) * .8 + .35 * _n1(XS / 70 + seed, 6.0, 3, seed + 5)
    if crag:
        h = h + crag * smoothstep(.55, .75, _n1(XS / 300 + seed * 3, 7.7, 2, seed + 8)) * _r1(XS / 110 + seed, 2.9, 2, seed + 2)
    return base - amp * (h - .45) + tilt * (XS[0] - 960) / 960.0


def layer(img, prof, col_top, col_bot, haze, haze_col, rim=0.0, seed=0, strata=1.0):
    yy = Y1
    ph = prof[None, :]
    m = smoothstep(-1.1, 1.1, yy - ph)                                       # 1 below the ridge
    kk = max(3, int(70 * S)); pad = np.pad(prof, (kk, kk), mode='edge')
    ph_s = (np.convolve(pad, np.ones(kk) / kk, mode='same')[kk:-kk])[None, :]    # smoothed crest: colour gradient must not follow steep flanks (vertical streaks)
    depth = np.clip((yy - ph_s) / 260.0, 0, 1)
    col = mix(col_top, col_bot, depth[..., None] ** .8)
    # atmospheric haze: lighter and warmer toward the crest, stronger on the distant ranges
    hz = (haze * (1 - depth ** .45))[..., None]
    col = mix(col, haze_col, np.clip(hz, 0, 1))
    # surface texture: broad strata + rock grain, varying per layer
    col = col * (1 - .10 * strata + strata * .20 * fbm(X1 / (36 + 12 * seed), Y1 / (7 + 2 * seed), 3, seed=seed + 40)[..., None])
    if rim > 0:
        k = 3 + 2 * seed
        up = np.clip(m - np.roll(m, k, axis=0), 0, 1)                         # lit crest = upper edge of the mask
        edge = blur(up, 2) * 1.6 + blur(up, 7) * .6
        pg = np.gradient(np.convolve(np.pad(prof, (6, 6), mode='edge'), np.ones(13) / 13, mode='same')[6:-6]) * S   # d(crest y)/dx, per authoring px
        facing = np.clip(np.sign(SUN[0] - XS[0]) * pg * 2.4, 0, 1)                                        # lit only where the slope faces the sun
        edge = edge * (.10 + 1.15 * facing)[None, :]
        patch = .40 + .85 * fbm(X1 / 210 + seed, np.full_like(X1, seed * 1.3), 2, seed=seed + 60)   # the rim light breaks up along the crest
        col = col + np.array([1.0, .5, .16], np.float32)[None, None, :] * (edge * rim * patch * (.20 + warm_x(X1)))[..., None]
    return mix(img, col, m[..., None])


def warm_x(x):
    return np.exp(-(np.abs(x - SUN[0]) / 750.0) ** 1.4) * .9


def treeline(img, prof, col, n, hmin, hmax, seed):
    """Distant conifers / scrub stippled along a ridge crest (they break the clean cutout edge)."""
    r = np.random.RandomState(seed)
    m = np.zeros((H, W), np.float32)
    for _ in range(n):
        x = r.uniform(0, 1920); h = r.uniform(hmin, hmax); w = h * r.uniform(.22, .38)
        yb = float(prof[min(W - 1, int(x * S))]) + 3
        x0, x1, y0, y1 = int(max(0, x - w - 2) * S), int(min(1920, x + w + 2) * S), int(max(0, yb - h - 2) * S), int(min(1080, yb + 4) * S)
        if x1 <= x0 or y1 <= y0:
            continue
        xs_, ys_ = X1[y0:y1, x0:x1], Y1[y0:y1, x0:x1]
        tt = np.clip((yb - ys_) / h, 0, 1.0)
        tier = (1 - tt) * (.55 + .45 * np.abs(np.sin(tt * 9.0 + x)))            # ragged tiers
        mm = (np.abs(xs_ - x) < w * tier) & (ys_ <= yb) & (ys_ >= yb - h)
        m[y0:y1, x0:x1] = np.maximum(m[y0:y1, x0:x1], mm.astype(np.float32))
    return mix(img, col, blur(m, max(1, int(S)))[..., None])


p_far = prof_massif(655, 330, 3); p_far2 = prof_massif(705, 210, 9)
p_mid = prof_mesa(790, 150, 7)
p_near = prof_rolling(850, 96, 11, crag=.45)
p_low = prof_rolling(925, 76, 17, tilt=-14, crag=.35)
img = layer(img, p_far, c3('#3c141e'), c3('#24101a'), .46, c3('#cc5c2a'), rim=.30, seed=1, strata=1.0)      # most hazed: lightest, weakest rim
img = treeline(img, p_far, c3('#5a2024'), 90, 5, 11, 101)
img = layer(img, p_far2, c3('#2e111b'), c3('#180b14'), .28, c3('#b44e28'), rim=.34, seed=2, strata=1.1)
mist = smoothstep(.45, .8, fbm(X1 / 380, Y1 / 34, 4, seed=51)) * np.exp(-((Y1 - 752) / 34.0) ** 2)
img = mix(img, c3('#e08a50'), (mist * .26 * (.5 + warm_x(X1)))[..., None])
img = layer(img, p_mid, c3('#22101a'), c3('#0f0710'), .16, c3('#8a3824'), rim=.28, seed=3, strata=1.3)
img = treeline(img, p_mid, c3('#1a0a12'), 70, 9, 20, 102)
# ------------------------------------------------------------------------------------------------ Serpent Keep (small, on the 2nd ridge) + the burning village (left)
def block(img, x0, x1, y0, y1, col, soft=1.0):
    m = ((X1 >= x0) & (X1 <= x1) & (Y1 >= y0) & (Y1 <= y1)).astype(np.float32)
    return mix(img, col, (blur(m, max(1, int(soft * S))))[..., None])


def tri(img, cx, y_base, hw, h, col):
    m = ((Y1 <= y_base) & (Y1 >= y_base - h) & (np.abs(X1 - cx) < hw * (1 - (y_base - Y1) / h))).astype(np.float32)
    return mix(img, col, blur(m, max(1, int(S)))[..., None])


keepc = c3('#190a12')
kx = 1190
base_y = float(p_mid[int(kx * S)]) + 10.0
img = block(img, kx - 120, kx + 120, base_y + 4, base_y + 70, keepc, 18)
img = block(img, kx - 70, kx + 70, base_y - 44, base_y + 8, keepc)
for tx in (-70, -35, 0, 35, 70):
    img = block(img, kx + tx - 9, kx + tx + 9, base_y - 74 + (tx == 0) * -26, base_y - 40, keepc)
    img = tri(img, kx + tx, base_y - 74 + (tx == 0) * -26, 13, 20, keepc)
for tx in range(-66, 70, 14):
    img = block(img, kx + tx, kx + tx + 7, base_y - 52, base_y - 44, keepc)
# lit windows
for wx, wy in [(-45, 28), (-10, 28), (22, 28), (50, 28), (0, 60)]:
    img = block(img, kx + wx, kx + wx + 3, base_y - wy, base_y - wy + 6, c3('#ffb04a'), .6)

# burning village on ridge 3 (left of centre, away from the wordmark)
vx0 = 120
vcol = c3('#120709')
VB = float(p_mid[int((vx0 + 150) * S)]) + 8.0
img = block(img, vx0 - 110, vx0 + 400, VB - 4, VB + 70, vcol, 20)
for k, (dx, w, h, ry) in enumerate([(0, 58, 36, 0), (74, 48, 30, 0), (136, 66, 42, 0), (214, 44, 28, 0), (268, 56, 34, 0), (-62, 36, 26, 0)]):
    bx = vx0 + dx
    by = VB + 3 * math.sin(k * 2.1)
    img = block(img, bx, bx + w, by - h, by + 6, vcol)
    img = tri(img, bx + w / 2, by - h, w * .62, 24 + (k % 3) * 6, vcol)
    # ragged burnt roofline: bites out of the roof
    for j in range(3):
        img = block(img, bx + w * (.2 + .3 * j), bx + w * (.2 + .3 * j) + 8, by - h - 12, by - h - 2, mix(vcol, c3('#2b1420'), .5), .5)
    if k in (0, 2, 4):
        fx_, fy_ = bx + w * .5 + (k - 2) * 4, by - h - 10
        flame = np.exp(-(np.hypot((X1 - fx_) / 14.0, (Y1 - fy_ + 12) / 30.0)) ** 1.8)
        flame2 = np.exp(-(np.hypot((X1 - fx_) / 6.0, (Y1 - fy_ + 6) / 16.0)) ** 1.8)
        glow2 = np.exp(-(np.hypot(X1 - fx_, Y1 - fy_) / 70.0)) * .35
        img = img + np.array([1.0, .45, .1], np.float32)[None, None, :] * (flame * 1.1 + glow2)[..., None] + np.array([1.0, .85, .35], np.float32)[None, None, :] * (flame2 * .9)[..., None]
        # rising smoke
        sm = smoothstep(.5, .8, fbm((X1 - fx_) / 26 + 7, (Y1 - fy_) / 40, 3, seed=61 + k)) * np.exp(-((X1 - fx_ - (fy_ - Y1) * .25) / np.maximum(22 + (fy_ - Y1) * .1, 8)) ** 2) * (Y1 < fy_) * np.exp(-(fy_ - Y1) / 170.0)
        img = mix(img, c3('#2a1620'), (sm * .55)[..., None])

img = layer(img, p_near, c3('#1a0c14'), c3('#0b060d'), .06, c3('#7a2c1e'), rim=.34, seed=5, strata=1.2)
img = treeline(img, p_near, c3('#100710'), 60, 12, 26, 103)
# ------------------------------------------------------------------------------------------------ trees: rim-lit, hazed, varied (r9)
def tree(img, x, y, h, lean, depth=0.0, kind='dead', seed=0):
    """depth 0 = near (crisp, dark, strong rim) .. 1 = far (hazed toward the ridge colour, soft). Twigs thin out; limbs taper."""
    r = np.random.RandomState(seed)
    segs = []

    def grow(px, py, ang, ln, wd, d):
        qx, qy = px + math.cos(ang) * ln, py - math.sin(ang) * ln
        segs.append((px, py, qx, qy, wd))
        if d <= 0 or ln < 4:
            return
        for k in range(r.randint(2, 4)):
            grow(qx, qy, ang + r.uniform(-.9, .9) + lean * .15, ln * r.uniform(.55, .80), wd * .64, d - 1)
    if kind == 'pine':
        trunk = h; segs.append((x, y, x + lean * 8, y - trunk, h * .02))
        for k in range(7):
            yy_ = y - trunk * (.24 + .105 * k); wd = h * (.30 - .036 * k) * r.uniform(.85, 1.1)
            for sg in (-1, 1):
                segs.append((x + lean * 8 * (k / 7), yy_, x + sg * wd, yy_ + wd * .5, h * .012))
    else:
        grow(x, y, math.pi / 2 + lean, h * .40, h * .062, 6 if depth < .6 else 5)
        # a few long low limbs
        for _ in range(2):
            grow(x, y - h * r.uniform(.12, .22), math.pi / 2 + r.choice([-1, 1]) * r.uniform(.8, 1.2), h * .26, h * .022, 3)
    m = np.zeros((H, W), np.float32)
    for (ax, ay, bx, by, wd) in segs:
        x0, x1 = int(max(0, min(ax, bx) - wd - 3) * S), int(min(1920, max(ax, bx) + wd + 3) * S)
        y0, y1 = int(max(0, min(ay, by) - wd - 3) * S), int(min(1080, max(ay, by) + wd + 3) * S)
        if x1 <= x0 or y1 <= y0:
            continue
        xs, ys = X1[y0:y1, x0:x1], Y1[y0:y1, x0:x1]
        dx, dy = bx - ax, by - ay; l2 = dx * dx + dy * dy + 1e-6
        tt = np.clip(((xs - ax) * dx + (ys - ay) * dy) / l2, 0, 1)
        dd = np.hypot(xs - (ax + dx * tt), ys - (ay + dy * tt))
        w_ = np.maximum(wd * (1 - .50 * tt) * .6, .85)
        m[y0:y1, x0:x1] = np.maximum(m[y0:y1, x0:x1], 1 - smoothstep(w_, w_ + 1.3, dd))
    b = max(0, int(depth * 1.2 * S))
    mb = blur(m, b) if b else m
    # colour: near = almost black; far = pulled toward the haze colour of the ridge behind
    near_c, far_c = c3('#0a0409'), c3('#2a0f18')
    col = mix(near_c, far_c, depth * .75)
    # warm rim on the side facing the sun: mask minus its shifted copy
    sh = int(max(1, 2.5 * S)) * (1 if x < SUN[0] else -1)
    mt = (blur(m, 1) > .75).astype(np.float32)            # only limbs thick enough to hold a highlight (twigs stay pure silhouette)
    rim = np.clip(mt - np.roll(mt, sh, axis=1), 0, 1)
    out = mix(img, col, (np.clip(mb * 1.25, 0, 1) * (1 - .10 * depth))[..., None])
    out = out + np.array([1.0, .5, .16], np.float32)[None, None, :] * (blur(rim, 1) * (.50 - .3 * depth) * (.35 + warm_x(np.float32(x))))[..., None]
    return out



for (tx, th_, ln, dp, kd, sd) in [(60, 300, .12, .12, 'dead', 1), (330, 190, -.10, .25, 'dead', 2), (470, 150, .0, .38, 'pine', 3), (600, 118, .08, .5, 'dead', 5),
                                  (1130, 108, -.12, .55, 'dead', 6), (1290, 92, .0, .62, 'pine', 8), (1052, 66, .1, .72, 'pine', 10), (225, 150, .1, .3, 'dead', 7)]:
    img = tree(img, tx, float(p_near[int(tx * S)]) + 6, th_, ln, dp, kd, sd)
# ------------------------------------------------------------------------------------------------ the Throne of Coils (C2 r1)
# A real lit asset: blender/build_ui_throne.py renders the obsidian throne, the two scaled cobras, the dais, banners and braziers with
# Cycles (transparent film) into progress/tmp/throne_rgba.npy (+ throne_keys.json = projected brazier / axe points).  It is composited
# here, then the fire (painted witchfire tongues + bloom), a glow on the copper axe relic and low violet mist at the dais foot are added.
import json
TF = (1110.0, 395.0, 750.0)            # frame top-left x, y and width (authoring px); the frame is 1.10 : 1
TH = TF[2] / 1.10
FR_NPY = os.environ.get('KCA_THRONE_NPY') or os.path.join(ROOT, 'progress', 'tmp', 'throne_rgba.npy')
FR_KEY = os.environ.get('KCA_THRONE_KEY') or os.path.join(ROOT, 'progress', 'tmp', 'throne_keys.json')


def resample(a, w, h):
    """Area-ish resize of an HxWxC float array to (h, w): gaussian pre-blur by the scale factor, then bilinear."""
    hh, ww = a.shape[:2]
    f = max(ww / w, hh / h)
    if f > 1.2:
        a = np.stack([blur(a[..., c], .42 * f) for c in range(a.shape[2])], -1)
    ys = (np.arange(h) + .5) * hh / h - .5
    xs = (np.arange(w) + .5) * ww / w - .5
    y0 = np.clip(np.floor(ys).astype(int), 0, hh - 2); x0 = np.clip(np.floor(xs).astype(int), 0, ww - 2)
    fy = np.clip(ys - y0, 0, 1)[:, None, None]; fx = np.clip(xs - x0, 0, 1)[None, :, None]
    return (a[y0][:, x0] * (1 - fy) * (1 - fx) + a[y0][:, x0 + 1] * (1 - fy) * fx + a[y0 + 1][:, x0] * fy * (1 - fx) + a[y0 + 1][:, x0 + 1] * fy * fx)


def witchfire(img, cx, cy, unit, seed):
    """Painted green witchfire: layered turbulent tongues (hot pale core -> saturated green edge), additive, with its own bloom."""
    r_ = np.random.RandomState(seed)
    hgt = 3.9 * unit; wid = 2.2 * unit
    x0, x1 = int(max(0, cx - wid * 1.6)), int(min(W, cx + wid * 1.6)); y0, y1 = int(max(0, cy - hgt * 1.5)), int(min(H, cy + unit * 1.0))
    if x1 <= x0 or y1 <= y0:
        return img
    yy_, xx_ = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    acc = np.zeros(yy_.shape, np.float32); core = np.zeros(yy_.shape, np.float32)
    for t in range(15):
        bx = cx + r_.uniform(-.62, .62) * wid * .5 * (1 if t else 0)
        h_ = hgt * r_.uniform(.45, 1.0) * (1.25 if t == 0 else 1)
        w_ = wid * r_.uniform(.20, .34)
        lean = r_.uniform(-.30, .30) * wid
        u = np.clip((cy - yy_) / h_, 0, 1.15)
        sh = lean * u * u + .12 * wid * np.sin(u * 7 + t * 1.9) * u
        wy = w_ * np.clip(np.sin(np.clip(u * 3.0, 0, np.pi / 2)) , 0, 1) * np.clip(1 - u, 0, 1) ** .75
        nz = (fbm(xx_ / (unit * .35) + t * 3.1, yy_ / (unit * .6) - t, 3, seed=seed + t) - .5) * .9
        dx = np.abs(xx_ - bx - sh + nz * wy * .8) / np.maximum(wy, 1e-3)
        m = smoothstep(1.0, .35, dx) * (u < 1.0) * (yy_ <= cy + unit * .3) * smoothstep(0, .08, u + .04)
        acc = np.maximum(acc, m * (.85 - .35 * u))
        core = np.maximum(core, smoothstep(.62, .1, dx) * (u < .62) * (yy_ <= cy + unit * .3) * (1 - u))
    hot = np.array([.82, 1.0, .55], np.float32); mid_ = np.array([.14, 1.0, .12], np.float32); edge = np.array([.03, .62, .06], np.float32)
    col = mix(edge, mid_, np.clip(acc * 1.5 - .1, 0, 1)[..., None])
    col = mix(col, hot, np.clip(core * 1.1, 0, 1)[..., None])
    img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - np.clip(acc * .55, 0, 1)[..., None] * .6) + col * (acc * 1.25)[..., None]
    # bloom
    gy0, gy1, gx0, gx1 = int(max(0, cy - hgt * 2.2)), int(min(H, cy + hgt * .8)), int(max(0, cx - hgt * 1.6)), int(min(W, cx + hgt * 1.6))
    Yg, Xg = np.mgrid[gy0:gy1, gx0:gx1].astype(np.float32)
    gl = np.exp(-(np.hypot((Xg - cx) * 1.1, (Yg - (cy - hgt * .45)) * .85) / (hgt * .62)) ** 1.3)
    img[gy0:gy1, gx0:gx1] += np.array([.10, .62, .08], np.float32) * (gl * .42)[..., None] + np.array([.2, .9, .18], np.float32) * (np.exp(-(np.hypot(Xg - cx, Yg - (cy - hgt * .3)) / (hgt * .22)) ** 1.6) * .35)[..., None]
    return img


def witch_glow(img, cx, cy, unit, seed):
    """C2 r11: the witchfire itself is now Blender-rendered (layered translucent tongues in the asset); this only adds the screen-space bloom
    halo around it and a few rising green motes."""
    r_ = np.random.RandomState(seed)
    hgt = 3.9 * unit
    gy0, gy1, gx0, gx1 = int(max(0, cy - hgt * 2.4)), int(min(H, cy + hgt * .6)), int(max(0, cx - hgt * 1.8)), int(min(W, cx + hgt * 1.8))
    Yg, Xg = np.mgrid[gy0:gy1, gx0:gx1].astype(np.float32)
    gl = np.exp(-(np.hypot((Xg - cx) * 1.1, (Yg - (cy - hgt * .5)) * .8) / (hgt * .70)) ** 1.3)
    img[gy0:gy1, gx0:gx1] += np.array([.16, .48, .12], np.float32) * (gl * .30)[..., None] + np.array([.40, .85, .30], np.float32) * (np.exp(-(np.hypot(Xg - cx, Yg - (cy - hgt * .35)) / (hgt * .24)) ** 1.6) * .16)[..., None]      # r15: lower saturation
    for _ in range(14):                                                      # motes
        mx = cx + r_.normal(0, .5) * unit * 1.2; my = cy - r_.uniform(.9, 3.6) * unit * 1.35
        rad = r_.uniform(.9, 2.2) * max(S, .6); a_ = r_.uniform(.35, .95)
        x0, x1, y0, y1 = int(max(0, mx - 8)), int(min(W, mx + 8)), int(max(0, my - 8)), int(min(H, my + 8))
        if x1 > x0 and y1 > y0:
            yy2, xx2 = np.mgrid[y0:y1, x0:x1].astype(np.float32)
            img[y0:y1, x0:x1] += np.array([.55, 1.0, .40], np.float32) * (a_ * np.exp(-(np.hypot(xx2 - mx, yy2 - my) / rad) ** 2))[..., None]
    return img


if os.path.exists(FR_NPY):
    tf = np.load(FR_NPY).astype(np.float32)
    kj = json.load(open(FR_KEY)) if os.path.exists(FR_KEY) else None
    fw, fh = int(round(TF[2] * S)), int(round(TH * S))
    tf = resample(tf, fw, fh)
    tf = np.clip(tf, 0, None)
    tx0, ty0 = int(TF[0] * S), int(TF[1] * S)
    cx0, cy0 = max(0, -tx0), max(0, -ty0)
    cx1, cy1 = min(fw, W - tx0), min(fh, H - ty0)
    # a dusk atmosphere pass over the asset: far parts of the frame (high up / outward) sink into the haze
    al = tf[..., 3:4]
    yy_f = (np.arange(fh, dtype=np.float32) / fh)[:, None, None]
    hz = c3('#6a2a3e')[None, None, :] * .55
    tf_rgb = tf[..., :3]
    seg_ = (tf_rgb * 1.0) + hz * al * (.10 + .10 * np.clip(1 - yy_f, 0, 1))
    reg = img[ty0 + cy0:ty0 + cy1, tx0 + cx0:tx0 + cx1]
    a_ = al[cy0:cy1, cx0:cx1]
    img[ty0 + cy0:ty0 + cy1, tx0 + cx0:tx0 + cx1] = seg_[cy0:cy1, cx0:cx1] + reg * (1 - a_)
    # C2 r13: the witchfire is its own render layer (blender/build_ui_throne.py: _flames.npy). It is ADDED to the plate (never alpha-over), softened over
    # three radii (sharp tongues + a mid halo + a wide bloom) so no tongue prints an opaque, hard-edged cut-out over the dusk.
    FL_NPY = FR_NPY.replace('.npy', '_flames.npy')
    if os.path.exists(FL_NPY):
        fl = np.clip(resample(np.load(FL_NPY).astype(np.float32), fw, fh), 0, None)[..., :3]
        soft = fl * .52
        for sg_, wt_ in ((2.0, .26), (6.5, .20), (16.0, .10)):      # r15: flame layer ~20% lower in luma so the copper relic is the brightest read
            soft = soft + np.stack([blur(fl[..., c_], max(1, int(round(sg_ * S)))) for c_ in range(3)], -1) * wt_
        soft = soft * float(os.environ.get('KCA_FLAME_GAIN', '0.50'))      # r15: the flames sit below the relic in luma (board r14 'witchfire pulls focus from the relic')
        img[ty0 + cy0:ty0 + cy1, tx0 + cx0:tx0 + cx1] += soft[cy0:cy1, cx0:cx1]
    if kj:
        for k_, br in enumerate(kj['braziers']):
            fire_fn = witch_glow if kj.get('flames') == 'rendered' else witchfire
            img = fire_fn(img, (TF[0] + br['x'] * TF[2]) * S, (TF[1] + br['y'] * TH) * S, br['unit'] * TF[2] * S, 40 + k_ * 9)
        ax_ = kj['axe']
        axx, axy = (TF[0] + ax_['x'] * TF[2]) * S, (TF[1] + ax_['y'] * TH) * S
        x0_, x1_, y0_, y1_ = int(max(0, axx - 90 * S)), int(min(W, axx + 90 * S)), int(max(0, axy - 70 * S)), int(min(H, axy + 70 * S))
        Yg, Xg = np.mgrid[y0_:y1_, x0_:x1_].astype(np.float32)
        img[y0_:y1_, x0_:x1_] += np.array([1.0, .45, .14], np.float32) * (np.exp(-(np.hypot(Xg - axx, Yg - axy) / (34 * S)) ** 1.4) * (.07 if kj.get('flames') == 'rendered' else .32))[..., None]
    # low violet-ember mist at the dais foot, over the asset's base, drifting in two layers
    fy0 = int((TF[1] + TH * .62) * S)
    mist_y = (Y1 - (TF[1] + TH * .83)) / 60.0
    for lay, (sc_, amp, col_) in enumerate(((1.0, .34, '#7a3a52'), (.55, .22, '#a85a46'))):
        mn = fbm(X1 / (300 * sc_) + lay * 7, Y1 / (46 * sc_), 4, seed=300 + lay)
        band = np.exp(-(mist_y + .15 * lay) ** 2) * smoothstep(.30, .75, mn)
        band = band * smoothstep(TF[0] - 40, TF[0] + 140, X1) * (1 - 0)
        img = mix(img, c3(col_)[None, None, :] * 1.0, (band * amp)[..., None])

img = tree(img, 150, float(p_low[int(150 * S)]) + 10, 330, .10, 0.0, 'dead', 21)
img = layer(img, p_low, c3('#170a12'), c3('#09040a'), .05, c3('#6a2a1e'), rim=.20, seed=4, strata=1.2)

# ------------------------------------------------------------------------------------------------ foreground: crags + a copper axe planted in the earth
yy = Y1
fg = 950 + 35 * (fbm(np.arange(W, dtype=np.float32)[None, :] / S / 90, np.full((1, W), 4.5, np.float32), 4, seed=77)[0] - .5) * 2
fgm = smoothstep(-1.5, 1.5, yy - fg[None, :])
fgc = mix(c3('#120810'), c3('#050205'), np.clip((yy - 950) / 130, 0, 1)[..., None])
fgc = fgc * (.85 + .3 * fbm(X1 / 18, Y1 / 7, 3, seed=78)[..., None])
rimfg = np.exp(-np.clip(yy - fg[None, :], 0, 30) / 3.0) * (yy >= fg[None, :])
fgc = fgc + np.array([1.0, .5, .16], np.float32)[None, None, :] * (rimfg * .3 * (.3 + warm_x(X1)))[..., None]
img = mix(img, fgc, fgm[..., None])
img = layer(img, np.full(W, 1100, np.float32), c3('#050205'), c3('#050205'), 0, c3('#000000'))      # no-op guard (keeps the bottom black)

# ------------------------------------------------------------------------------------------------ embers + grade
sp = np.zeros((H, W), np.float32)
for _ in range(220):
    ex, ey = rs.uniform(0, 1920), rs.uniform(300, 1060) if rs.rand() < .8 else rs.uniform(0, 300)
    r_ = rs.uniform(.8, 2.6); a_ = rs.uniform(.35, 1.0) * (1 - abs(ey - 760) / 760 * .6)
    x0, x1, y0, y1 = int(max(0, ex - 8) * S), int(min(1920, ex + 8) * S), int(max(0, ey - 8) * S), int(min(1080, ey + 8) * S)
    if x1 <= x0 or y1 <= y0:
        continue
    sp[y0:y1, x0:x1] += a_ * np.exp(-(np.hypot(X1[y0:y1, x0:x1] - ex, Y1[y0:y1, x0:x1] - ey) / r_) ** 2)
img = img + np.array([1.0, .58, .2], np.float32)[None, None, :] * (np.clip(sp, 0, 1.2) * .9)[..., None]
# painterly breakup + grain + vignette; keep the centre column calmer (it sits under the banner / wordmark / menu)
paint = fbm(X1 / 6, Y1 / 6, 3, seed=88) - .5
img = img * (1 + .05 * paint[..., None])
grain = (np.random.RandomState(9).rand(H, W).astype(np.float32) - .5) * .035
img = img + grain[..., None]
vig = 1 - .42 * np.clip(np.hypot((X1 - 960) / 1180.0, (Y1 - 520) / 760.0), 0, 1.2) ** 2.2
img = img * vig[..., None]
centre = np.exp(-((X1 - 960) / 330.0) ** 2) * np.exp(-((Y1 - 330) / 330.0) ** 2) * .22      # darken a soft pocket behind the wordmark
img = img * (1 - centre)[..., None]
print("nan", int(np.isnan(img).sum()))
img = np.nan_to_num(img)
img = np.clip(img, 0, 1.6)
img = 1 - np.exp(-img * 1.25)                                                                  # soft filmic shoulder
img = np.clip(img, 0, 1)
# C2 r14: ordered-free TPDF dither (two uniform fields, +-1 LSB) before the 8-bit quantise so the long sunset gradients cannot band; the encode step keeps
# quality >= 92 for the same reason.
dr = np.random.RandomState(19)
dith = (dr.rand(H, W).astype(np.float32) + dr.rand(H, W).astype(np.float32) - 1.0)
q8 = np.clip(np.floor(img * 255 + .5 + dith[..., None] * 1.0), 0, 255).astype(np.uint8)
save_png(OUT, q8)
print('wrote', OUT, W, H)
