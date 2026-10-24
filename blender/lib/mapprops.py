"""Props + post-process for build_ui_map.py: trees, settlements, landmarks (added as builders), ink/hatch/grade post."""
import math
import numpy as np
from . import mapkit as MK, mapworld as MW
from .mapkit import to_world, Batch, smoothstep, mix, fbm, blur, resize
from . import mapland as ML

TERRAIN_KEYS = ['Z', 'F', 'lk', 'river', 'dr', 'wr', 'ds', 'ws', 'road_d', 'moat', 'rid', 'zm', 'zt', 'kd', 'vd', 'land']
CT, ST = MK.CT, MK.ST


class Ctx:
    def __init__(self, T, MATS, only=None):
        self.T = T; self.M = MATS; self.only = only
        self.flat = Batch(1); self.smooth = Batch(2); self.smoke = Batch(3); self.emit = Batch(4); self.glow = Batch(5)
        self.lights = []; self.rs = np.random.RandomState(11); self.n = {}
        self.Z = T['Z']; self.hh, self.ww = self.Z.shape

    def want(self, name):
        return self.only is None or name in self.only

    def idx(self, x, y):
        return (np.clip(np.round(np.asarray(y) * (self.hh - 1) / MK.H).astype(int), 0, self.hh - 1), np.clip(np.round(np.asarray(x) * (self.ww - 1) / MK.W).astype(int), 0, self.ww - 1))

    def at(self, key, x, y):
        i, j = self.idx(x, y)
        return self.T[key][i, j]

    def gz(self, x, y):
        return self.at('Z', x, y)

    def W(self, x, y, dz=0.0):
        """World position of a map point sitting on the terrain (+dz)."""
        return to_world(x, y, float(self.gz(x, y)) + dz)

    def stats(self):
        return {k: v for k, v in self.n.items()}

    def finish(self):
        import bpy
        for name, b, mat, smooth in (('props_flat', self.flat, 'flat', False), ('props_smooth', self.smooth, 'smooth', True), ('props_smoke', self.smoke, 'smoke', True),
                                     ('props_emit', self.emit, 'emit', False), ('props_glow', self.glow, 'glow', True)):
            if b.n:
                ob = b.to_object(name, self.M[mat], smooth=smooth)
                self.n[name] = int(len(b.arrays()[1]))
                if name in ('props_smoke',):
                    ob.visible_shadow = False
        for (x, y, z, e, col, r) in self.lights:
            li = bpy.data.lights.new('l', 'POINT'); li.energy = e; li.color = col; li.shadow_soft_size = r
            lo = bpy.data.objects.new('l', li); lo.location = to_world(x, y, z); bpy.context.scene.collection.objects.link(lo)


# ------------------------------------------------------------------------------------------------ palettes
P = lambda h: MK.hexc(h)
CONIFER = [P('#5b6b3a'), P('#4e6a3c'), P('#66703e'), P('#44593a'), P('#6e7a44')]
OAK = [P('#8a9a4c'), P('#7a9048'), P('#96a050'), P('#6f8844'), P('#a0a24e'), P('#b39a42')]
TRUNK = P('#6a4a30')


def stick(b, p0, p1, r0, r1, col, n=5):
    b.tube([p0, p1], [r0, r1], n=n, col=col, jit=0.02)


_PATCH = [1.0, 1.0, 1.0]       # per-grove tone drift (C2: groves no longer read as one repeated stamp)


def _lean(rs, amp=.16):
    return (rs.rand() - .5) * 2 * amp, (rs.rand() - .5) * 2 * amp


def conifer(c, x, y, s, rs):
    """r8: five silhouettes (broad fir, tall spruce, umbrella pine, narrow cypress, scrubby juniper), each with its own lean, width,
    tier count and tone - groves no longer repeat one stamp."""
    b = c.flat; px, py, pz = c.W(x, y, -0.5)
    col = tuple(np.clip(np.array(CONIFER[rs.randint(len(CONIFER))]) * np.array(_PATCH), 0, 1))
    lx, ly = _lean(rs, .2); wv = .72 + .7 * rs.rand(); kind = rs.rand()
    shade = lambda i, n: tuple(np.clip(np.array(col) * (0.9 + 0.16 * i / max(1, n - 1)) * (.96 + .08 * rs.rand()), 0, 1))
    if kind < .30:                                           # broad fir, 3 tiers
        b.cyl((px, py, pz), 1.3 * s, 6 * s, 5, TRUNK, jit=0.02)
        for i, (r, h, z0) in enumerate([(7.4, 12, 3), (5.9, 11, 9.5), (4.0, 10, 15.5)]):
            b.cone((px + lx * z0 * s, py + ly * z0 * s, pz + z0 * s), r * s * wv, h * s, 6, shade(i, 3), yaw=rs.rand() * 3, jit=0.035, cap=(i == 0))
    elif kind < .52:                                         # tall spruce, 5 slim tiers
        b.cyl((px, py, pz), 1.1 * s, 7 * s, 5, TRUNK, jit=0.02)
        for i in range(5):
            z0 = 3 + i * 5.6; r = (6.0 - i * 1.05) * wv * .85
            b.cone((px + lx * z0 * s, py + ly * z0 * s, pz + z0 * s), r * s, 8.4 * s, 6, shade(i, 5), yaw=rs.rand() * 3, jit=0.03, cap=(i == 0))
    elif kind < .68:                                         # umbrella pine: bare trunk, flat layered crown
        h = (14 + 5 * rs.rand()) * s
        b.tube([(px, py, pz), (px + lx * h * .8, py + ly * h * .8, pz + h)], [1.5 * s, .9 * s], n=5, col=TRUNK, jit=.02)
        for k, (dx, dy, dz, r) in enumerate([(0, 0, 0, 8.5), (-5.5, 2, -2.5, 6.2), (5.2, -2.4, -2, 6.6)]):
            b.ellipsoid((px + lx * h * .8 + dx * s * wv, py + ly * h * .8 + dy * s, pz + h + dz * s), r * s * wv, r * .9 * s, 2.8 * s, shade(k, 3), nu=7, nv=4, jit=0.03, noise=.12)
    elif kind < .84:                                         # narrow cypress / poplar column
        h = (22 + 8 * rs.rand()) * s
        b.cyl((px, py, pz), 1.0 * s, 3 * s, 5, TRUNK, jit=0.02)
        b.ellipsoid((px + lx * h * .4, py + ly * h * .4, pz + h * .5 + 3 * s), 3.6 * s * wv, 3.6 * s * wv, h * .5, shade(1, 3), nu=6, nv=6, jit=0.03, noise=.1)
    else:                                                    # scrubby juniper: low, wide, lumpy
        for k in range(3):
            a_ = rs.rand() * 6.28; rr = 3.2 * s
            b.ellipsoid((px + math.cos(a_) * rr, py + math.sin(a_) * rr, pz + 3.2 * s), 4.8 * s * wv, 4.4 * s, 3.6 * s, shade(k, 3), nu=6, nv=4, jit=0.03, noise=.2)


def oak(c, x, y, s, rs):
    """r8: oak (random lobes), tall poplar, birch (pale trunk, small bright lobes) and shrub, each leaning / scaled differently."""
    b = c.flat; px, py, pz = c.W(x, y, -0.5)
    col = tuple(np.clip(np.array(OAK[rs.randint(len(OAK))]) * np.array(_PATCH), 0, 1))
    lx, ly = _lean(rs, .16); wv = .75 + .65 * rs.rand(); kind = rs.rand()
    tone = lambda f: tuple(np.clip(np.array(col) * f * (.97 + .06 * rs.rand()), 0, 1))
    if kind < .50:                                           # round oak: 3-6 randomly placed lobes
        h = (7 + 2.5 * rs.rand()) * s
        b.tube([(px, py, pz), (px + lx * h, py + ly * h, pz + h)], [1.6 * s, 1.0 * s], n=5, col=TRUNK, jit=.02)
        n = rs.randint(3, 7)
        for k in range(n):
            a_ = rs.rand() * 6.28; rr = (1 + 4.2 * rs.rand()) * s * wv; r = (4.0 + 3.4 * rs.rand()) * s
            dz = (3 + 6.5 * rs.rand() + (2 if k == n - 1 else 0)) * s
            b.ellipsoid((px + lx * h + math.cos(a_) * rr, py + ly * h + math.sin(a_) * rr, pz + h * .75 + dz), r, r, r * .8, tone(.9 + .12 * dz / (9 * s)), nu=6, nv=4, jit=0.03, noise=.2)
    elif kind < .68:                                         # tall poplar: stacked narrow lobes
        for k in range(3):
            b.ellipsoid((px + lx * (6 + k * 6) * s, py + ly * (6 + k * 6) * s, pz + (9 + k * 6.5) * s), 3.7 * s * wv, 3.5 * s * wv, 5.2 * s, tone(.88 + .1 * k), nu=6, nv=4, jit=0.03, noise=.12)
        b.cyl((px, py, pz), 1.2 * s, 8 * s, 5, TRUNK, jit=0.02)
    elif kind < .84:                                         # birch: pale trunk + small yellow-green lobes
        h = (9 + 3 * rs.rand()) * s
        b.tube([(px, py, pz), (px + lx * h, py + ly * h, pz + h)], [1.0 * s, .6 * s], n=5, col=P('#d9d0b8'), jit=.01)
        for k in range(4):
            a_ = rs.rand() * 6.28
            b.ellipsoid((px + lx * h + math.cos(a_) * 2.6 * s, py + ly * h + math.sin(a_) * 2.6 * s, pz + h + (rs.rand() * 5 - 1) * s), 3.7 * s * wv, 3.7 * s, 3.2 * s, tone(1.1), nu=6, nv=4, jit=0.03, noise=.2)
    else:                                                    # shrub
        for k in range(3):
            a_ = rs.rand() * 6.28
            b.ellipsoid((px + math.cos(a_) * 2.6 * s, py + math.sin(a_) * 2.6 * s, pz + 2.6 * s), 4.0 * s * wv, 3.8 * s, 2.8 * s, tone(.92), nu=6, nv=4, jit=0.03, noise=.25)


def deadtree(c, x, y, s, rs):
    b = c.flat; px, py, pz = c.W(x, y, -0.5); col = P('#4a3a2c')
    stick(b, (px, py, pz), (px + .6 * s, py, pz + 15 * s), 1.4 * s, .5 * s, col)
    for a, hz, ln in [(0.6, 8, 8), (2.4, 11, 7), (4.2, 6, 6), (5.4, 13, 5)]:
        stick(b, (px, py, pz + hz * s), (px + math.cos(a) * ln * s, py + math.sin(a) * ln * s, pz + (hz + ln * .7) * s), .7 * s, .2 * s, col, 4)


def keepout(c, x, y):
    """True where a tree must not stand (map-space arrays x, y)."""
    T = c.T
    ok = c.at('F', x, y) > 12
    ok &= c.at('lk', x, y) < -0.2
    ok &= c.at('dr', x, y) > c.at('wr', x, y) * 1.9 + 4
    ok &= c.at('ds', x, y) > c.at('ws', x, y) * 1.9 + 4
    ok &= c.at('road_d', x, y) > 11
    ok &= c.at('kd', x, y) > 124
    ok &= c.at('Z', x, y) < 78
    ok &= np.hypot(x - 1400, (y - 252) / .75) > 70
    ok &= np.hypot(x - 850, (y - 452) / .75) > 48
    ok &= np.hypot(x - 1060, (y - 668) / .75) > 52
    for hx, hy in HAMLETS:
        ok &= np.hypot(x - hx, (y - hy) / .75) > 46
    for fx, fy, fw, fh in FIELDS:
        ok &= ~((np.abs(x - fx) < fw * 1.1) & (np.abs(y - fy) < fh * 1.1))
    for cx, cy in MP_CAMPS:
        ok &= np.hypot(x - cx, y - cy) > 24
    return ok


HAMLETS = [(392, 296), (640, 352), (985, 636), (1318, 624), (760, 775), (300, 420)]
FIELDS = [(480, 770, 100, 44), (1040, 700, 110, 50), (700, 700, 90, 36), (1290, 700, 86, 50), (440, 360, 70, 36), (1330, 560, 66, 46)]
MP_CAMPS = MW.CAMPS[1:4]


def trees(c):
    rs = np.random.RandomState(23)
    xs, ys = np.meshgrid(np.arange(36, 1570, 8.5), np.arange(60, 860, 8.0))
    xs = xs + (rs.rand(*xs.shape) - .5) * 7; ys = ys + (rs.rand(*ys.shape) - .5) * 6.5
    xs = xs.ravel(); ys = ys.ravel()
    F = c.at('F', xs, ys); Z = c.at('Z', xs, ys)
    fm = MW.forest_mask(xs, ys, F, Z)
    ash = MW.ash_mask(xs, ys, F)
    p = np.where(fm > .2, .42 + .58 * fm, .05 + .045 * fbm(xs / 70, ys / 60, 2, seed=77)) * (1 - ash * .9)
    take = (rs.rand(len(xs)) < p) & keepout(c, xs, ys)
    cnt = [0, 0, 0]
    order = np.argsort(ys[take])
    for x, y, f_, z_, a_ in zip(xs[take][order], ys[take][order], fm[take][order], Z[take][order], ash[take][order]):
        s = .66 + .78 * rs.rand() ** 1.3 + (.45 if rs.rand() < .07 else 0)
        dr = fbm(np.array([x / 85.0]), np.array([y / 85.0]), 2, seed=131)[0] - .5
        _PATCH[0], _PATCH[1], _PATCH[2] = 1 + .30 * dr, 1 + .18 * dr + .05 * (rs.rand() - .5), 1 - .22 * dr
        if a_ > .3 and rs.rand() < .8:
            deadtree(c, x, y, s, rs); cnt[2] += 1
        elif z_ > 28 or rs.rand() < .3 + .35 * f_ * (1 if y < 520 else .4) or (f_ > .5 and rs.rand() < .55):
            conifer(c, x, y, s * (1.05 if z_ > 28 else 1), rs); cnt[0] += 1
        else:
            oak(c, x, y, s, rs); cnt[1] += 1
    # burnt stumps around the village
    for _ in range(26):
        a = rs.rand() * 6.28; r = 85 + rs.rand() * 70; x = 270 + math.cos(a) * r * 1.5; y = 640 + math.sin(a) * r * .75
        if c.at('F', x, y) > 10 and c.at('lk', x, y) < -.2 and c.at('road_d', x, y) > 10:
            deadtree(c, x, y, .8 + .5 * rs.rand(), rs); cnt[2] += 1
    c.n['trees'] = cnt


BUILDERS = [('trees', trees)] + ML.BUILD


def build_all(c):
    for name, fn in BUILDERS:
        if c.want(name):
            fn(c)
    c.finish()


