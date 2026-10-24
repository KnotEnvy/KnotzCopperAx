"""Stage 4 (Serpent Keep Gates) modular stone kit -> public/assets/models/env_stage4_kit.glb

Authored at GAME scale (1 Blender unit = 1 m). Blender coords: Z up, Blender -Y = the camera side (glTF +Z).
Architecture is real masonry geometry (individual chamfered ashlar blocks over a dark mortar core, so the joints read
as shadowed lines under torch light and the silhouettes are stepped/crenellated, never flat boxes). Organic pieces
(coiled cobra statue, gargoyle, adder sigil roundel) are SDF sculpts (blender/lib/sdf.py).

Objects (origin = base centre on the ground line z=0; facade fronts at y = -1.5 so modules line up in one wall row):
  wall        8 m curtain wall module: battered plinth, ashlar, arrow slit, corbelled parapet, 4 merlons   (x -4..4)
  wall_door   same module with a round-arched doorway (recess + fixed timber tympanum)                     (x -4..4)
  door_L/R    studded plank door leaves for wall_door (origin = hinge at the bottom outer corner)
  tower       round tower (r 3.2) with battered base, slits, corbel ring, crenellated top
  tower_spire round tower + conical slate roof with a spike finial (the keep's skyline)
  gatehouse   12 m gatehouse facade: pointed arch + voussoirs, deep passage, machicolations, bartizans
  portcullis  iron grid with spiked feet (origin = bottom centre; rises along +Z)
  sigil       carved adder-sigil roundel (coiled serpent in a ring), faces -Y
  serpent     coiled rearing cobra statue on a plinth, faces -Y, eyes = glow mask
  gargoyle    crouching winged gargoyle on a corbel, faces -Y (origin = back of the corbel)
  brazier     iron tripod brazier with a coal bed (glow mask)
COLOR_0 (linear): rgb = albedo with baked AO, a = mask: 0 stone, .25 iron, .5 wood, .75 slate roof, 1 glow.
Run:  blender -b --factory-startup -P blender/build_env_stage4_kit.py [-- --fast] [--preview] [--only a,b]
"""
import os
import sys
import math
import time
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy
import numpy as np
from lib import sdf, meshutil, pipeline
for _m in (sdf, meshutil, pipeline):
    importlib.reload(_m)
from lib.sdf import V, Sculpt, Sphere, Ellipsoid, RoundCone, Capsule, RoundBox, Torus, Chain, Union, Displace

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "assets", "models", "env_stage4_kit.glb")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FAST = "--fast" in ARGV
ONLY = None
if "--only" in ARGV:
    ONLY = set(ARGV[ARGV.index("--only") + 1].split(","))

M_STONE, M_IRON, M_WOOD, M_SLATE, M_GLOW = 0.0, 0.25, 0.5, 0.75, 1.0


def srgb(h):
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smooth01(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def rotz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


def rotx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def roty(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


# ----------------------------------------------------------------------------- palette (sRGB → linear)
STONE = [srgb(h) for h in ("#5e5d63", "#56575f", "#65636a", "#5c5652", "#515259", "#69676c")]
MORTAR = srgb("#1a1a20")
GRIME = srgb("#2e3430")
RECESS = srgb("#0d0d12")
IRON = srgb("#2a2a2e")
WOOD = srgb("#3b2a1e")
WOOD2 = srgb("#4a3424")
SLATE = srgb("#262a38")
COAL = srgb("#ff7a2a")


# ----------------------------------------------------------------------------- mesh builder
def _cbox_template():
    """Chamfered box topology: 24 points (3 per corner), 18 quads + 8 tris, outward winding."""
    pts, idx = [], {}
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                for ax in range(3):
                    idx[(sx, sy, sz, ax)] = len(pts)
                    pts.append((sx, sy, sz, ax))
    quads, tris = [], []
    cyc = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for ax in range(3):
        a1, a2 = [a for a in range(3) if a != ax]
        for s in (-1, 1):
            q = []
            for u, v in cyc:
                c = [0, 0, 0]
                c[ax], c[a1], c[a2] = s, u, v
                q.append(idx[(c[0], c[1], c[2], ax)])
            quads.append(q)
    for e in range(3):
        a1, a2 = [a for a in range(3) if a != e]
        for s1 in (-1, 1):
            for s2 in (-1, 1):
                def P(se, ax):
                    c = [0, 0, 0]
                    c[e], c[a1], c[a2] = se, s1, s2
                    return idx[(c[0], c[1], c[2], ax)]
                quads.append([P(-1, a1), P(1, a1), P(1, a2), P(-1, a2)])
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                tris.append([idx[(sx, sy, sz, 0)], idx[(sx, sy, sz, 1)], idx[(sx, sy, sz, 2)]])

    def geo(h, ch):
        P = []
        for sx, sy, sz, ax in pts:
            p = [sx * (h[0] - ch), sy * (h[1] - ch), sz * (h[2] - ch)]
            p[ax] = (sx, sy, sz)[ax] * h[ax]
            P.append(p)
        return np.array(P)
    G = geo((1, 1, 1), 0.2)

    def fix(f):
        a, b, c = G[f[0]], G[f[1]], G[f[2]]
        n = np.cross(b - a, c - a)
        return f if np.dot(n, G[f].mean(axis=0)) > 0 else f[::-1]
    return pts, [fix(q) for q in quads], [fix(t) for t in tris]


CB_PTS, CB_Q, CB_T = _cbox_template()
CB_SGN = np.array([[p[0], p[1], p[2]] for p in CB_PTS], float)
CB_AX = np.array([p[3] for p in CB_PTS])


class Builder:
    def __init__(self, name):
        self.name = name
        self.V, self.C, self.Q, self.T, self.QS, self.TS = [], [], [], [], [], []
        self.n = 0

    def add(self, verts, quads, tris, col, mask, smooth=False):
        verts = np.asarray(verts, float)
        k = len(verts)
        col = np.asarray(col, float)
        if col.ndim == 1:
            col = np.tile(col, (k, 1))
        rgba = np.concatenate([col, np.full((k, 1), mask)], axis=1)
        self.V.append(verts)
        self.C.append(rgba)
        for q in quads:
            self.Q.append([i + self.n for i in q])
            self.QS.append(smooth)
        for t in tris:
            self.T.append([i + self.n for i in t])
            self.TS.append(smooth)
        self.n += k

    def box(self, c, h, col, mask=M_STONE, ch=0.035, M=None):
        """Chamfered box: centre c, half extents h, optional 3x3 rotation M."""
        h = np.asarray(h, float)
        ch = float(min(ch, 0.45 * h.min()))
        P = CB_SGN * (h - ch)
        P[np.arange(24), CB_AX] = CB_SGN[np.arange(24), CB_AX] * h[CB_AX]
        if M is not None:
            P = P @ np.asarray(M).T
        self.add(P + np.asarray(c, float), CB_Q, CB_T, col, mask)

    def lathe(self, prof, seg, col, mask=M_STONE, c=(0, 0, 0), a0=0.0, a1=2 * math.pi, smooth=True, cap=False):
        """Surface of revolution around Z. prof = [(r, z), ...] bottom→top."""
        closed = abs((a1 - a0) - 2 * math.pi) < 1e-6
        ns = seg if closed else seg + 1
        ang = a0 + (a1 - a0) * np.arange(ns) / seg
        P = []
        for r, z in prof:
            for a in ang:
                P.append((c[0] + r * math.cos(a), c[1] + r * math.sin(a), c[2] + z))
        quads = []
        for i in range(len(prof) - 1):
            for j in range(seg):
                j1 = (j + 1) % ns if closed else j + 1
                a, b = i * ns + j, i * ns + j1
                quads.append([a, b, b + ns, a + ns])
        tris = []
        if cap:
            P.append((c[0], c[1], c[2] + prof[-1][1]))
            top = len(P) - 1
            base = (len(prof) - 1) * ns
            for j in range(seg):
                j1 = (j + 1) % ns if closed else j + 1
                tris.append([base + j, base + j1, top])
        self.add(np.array(P), quads, tris, col, mask, smooth)

    def pyramid(self, base_c, half, tip, col, mask):
        """Square pyramid (spikes, finials): base centre, half size (x, y), tip point."""
        bx, by, bz = base_c
        P = [(bx - half[0], by - half[1], bz), (bx + half[0], by - half[1], bz), (bx + half[0], by + half[1], bz),
             (bx - half[0], by + half[1], bz), tuple(tip)]
        self.add(np.array(P), [[3, 2, 1, 0]], [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]], col, mask)

    def build(self, smooth_all=None):
        verts = np.concatenate(self.V)
        ob = meshutil.mesh_from_numpy(self.name, verts, self.Q, self.T, smooth=False)
        flags = np.array(self.QS + self.TS, bool)
        me = ob.data
        if smooth_all is not None:
            flags[:] = smooth_all
        me.polygons.foreach_set("use_smooth", flags)
        # fix winding for any face the template/lathe got backwards is not needed (outward by construction)
        meshutil.add_color_attr(ob, "Col", np.concatenate(self.C).astype(np.float32))
        print(self.name, "tris", meshutil.tri_count(ob), flush=True)
        return ob


# ----------------------------------------------------------------------------- masonry helpers
class Rng:
    def __init__(self, seed):
        self.r = np.random.default_rng(seed)

    def u(self, a=0.0, b=1.0):
        return float(self.r.uniform(a, b))


def stone_col(R, z, wet_line=0.6, dark=1.0):
    c = STONE[int(R.u(0, len(STONE)))] * R.u(0.8, 1.12) * dark
    g = smooth01(wet_line + 1.6, wet_line - 0.4, z) * 0.75           # moat grime / algae band at the base
    return c * (1 - g) + GRIME * g


def ashlar(b, R, x0, x1, z0, z1, yf, depth=0.32, course=(0.42, 0.6), blen=(0.62, 1.35), skip=None, batter=None,
           gap=0.028, ao=None, dark=1.0, pro=0.05):
    """Front-face ashlar courses between x0..x1, z0..z1. Block fronts at yf (negative = toward camera) with jitter.
    batter(z) → extra outward (−y) offset for plinth courses. skip(x, z, hw, hh) → True to leave a hole."""
    z = z0
    while z < z1 - 0.08:
        hc = min(R.u(*course), z1 - z)
        if z1 - (z + hc) < 0.18:
            hc = z1 - z
        x = x0 - R.u(0.0, 0.7)
        off = batter(z + hc * 0.5) if batter else 0.0
        while x < x1 - 0.05:
            L = R.u(*blen)
            xa, xb = max(x, x0), min(x + L, x1)
            if x1 - xb < 0.25:
                xb = x1
            x = xb
            if xb - xa < 0.18:
                continue
            cx, cz = 0.5 * (xa + xb), z + hc * 0.5
            hw, hh = 0.5 * (xb - xa) - gap, 0.5 * hc - gap
            if skip and skip(cx, cz, hw, hh):
                continue
            p = R.u(0.0, pro)
            yfront = yf - off - p
            k = ao(cx, cz) if ao else 1.0
            b.box((cx, yfront + depth * 0.5, cz), (hw, depth * 0.5, hh), stone_col(R, cz, dark=dark) * k,
                  ch=R.u(0.025, 0.06))
        z += hc


def merlons(b, R, x0, x1, z0, h, yf, depth, period=2.0, width=1.25, phase=0.0):
    x = x0 + phase + (period - width) * 0.5
    while x + width <= x1 + 1e-6:
        cx = x + width * 0.5
        b.box((cx, yf + depth * 0.5, z0 + h * 0.5), (width * 0.5 - 0.02, depth * 0.5, h * 0.5), stone_col(R, 20) * 0.95, ch=0.05)
        b.box((cx, yf + depth * 0.5 - 0.04, z0 + h + 0.09), (width * 0.5 + 0.05, depth * 0.5 + 0.06, 0.09), stone_col(R, 20) * 1.05, ch=0.03)
        x += period


def core(b, x0, x1, y0, y1, z0, z1, col=MORTAR):
    b.box((0.5 * (x0 + x1), 0.5 * (y0 + y1), 0.5 * (z0 + z1)), (0.5 * (x1 - x0), 0.5 * (y1 - y0), 0.5 * (z1 - z0)), col, ch=0.01)


def arrow_slit(b, x, z0, z1, yf):
    """Dark recessed slit with a cross (reads as a black loophole)."""
    core(b, x - 0.22, x + 0.22, yf + 0.05, yf + 0.5, z0 - 0.1, z1 + 0.1, RECESS * 1.5)
    core(b, x - 0.07, x + 0.07, yf - 0.02, yf + 0.52, z0, z1, RECESS * 0.3)
    core(b, x - 0.3, x + 0.3, yf - 0.02, yf + 0.52, 0.5 * (z0 + z1) - 0.06, 0.5 * (z0 + z1) + 0.06, RECESS * 0.3)


# ----------------------------------------------------------------------------- architecture pieces
YF = -1.5          # facade front plane (camera side)
WALL_TOP = 9.0


def plinth_batter(zb):
    return lambda z: max(0.0, (zb - z)) * 0.22 if z < zb else 0.0


def curtain_wall(name, seed=3, door=False):
    b = Builder(name)
    R = Rng(seed)
    W = 4.0
    DW, DS = 1.45, 2.55                # doorway half width, spring height (round arch radius = DW)

    def door_hole(cx, cz, hw, hh):
        if not door:
            return False
        dx = abs(cx) - hw
        top = DS + math.sqrt(max(0.0, (DW + 0.55) ** 2 - min(abs(cx), DW + 0.55) ** 2))
        return dx < DW + 0.5 and cz - hh < top

    def slit_hole(cx, cz, hw, hh):
        return abs(cx) - hw < 0.3 and 4.7 < cz + hh and cz - hh < 6.5

    def skip(cx, cz, hw, hh):
        return door_hole(cx, cz, hw, hh) or (not door and slit_hole(cx, cz, hw, hh)) or (door and slit_hole(cx - 2.6, cz, hw, hh) and False)

    core(b, -W, W, YF + 0.06, 1.5, -3.0, WALL_TOP + 0.9)
    ashlar(b, R, -W, W, -3.0, 8.35, YF, skip=skip, batter=plinth_batter(1.0))
    # plinth cap course (a projecting string course at the batter top)
    for x in np.arange(-W, W - 0.01, 1.0):
        b.box((x + 0.5, YF - 0.06, 1.05), (0.49, 0.2, 0.1), stone_col(R, 1.5) * 1.05, ch=0.03)
    if not door:
        arrow_slit(b, 0.0, 4.9, 6.3, YF)
    else:
        # round-arched doorway: voussoirs, deep recess, fixed timber tympanum (leaves are separate objects)
        core(b, -DW, DW, YF + 0.02, YF + 0.95, 0.0, DS + DW, RECESS)
        nv = 13
        for i in range(nv):
            a = math.pi * (i + 0.5) / nv
            r = DW + 0.3
            cx, cz = -math.cos(a) * r, DS + math.sin(a) * r
            b.box((cx, YF - 0.02 + 0.2, cz), (0.29, 0.22, 0.17), stone_col(R, cz) * 1.08, ch=0.04, M=roty(-(math.pi / 2 - a)))
        b.box((0, YF - 0.06 + 0.2, DS + DW + 0.62), (0.2, 0.25, 0.32), stone_col(R, 5) * 1.15, ch=0.04)       # keystone
        for sx in (-1, 1):                                                                                    # jambs
            for z in np.arange(0.0, DS, 0.5):
                b.box((sx * (DW + 0.28), YF + 0.18, z + 0.25), (0.28, 0.22, 0.23), stone_col(R, z) * 1.02, ch=0.04)
        # tympanum: planks in the semicircle above the leaves
        for j in range(8):
            x0 = -DW + j * (2 * DW / 8)
            xm = x0 + DW / 8
            h = math.sqrt(max(0.0, DW ** 2 - xm ** 2))
            b.box((xm, YF + 0.82, DS + h * 0.5), (DW / 8 - 0.015, 0.05, h * 0.5), WOOD * R.u(0.75, 1.0), M_WOOD, ch=0.01)
        b.box((0, YF + 0.78, DS + 0.05), (DW, 0.07, 0.07), IRON, M_IRON, ch=0.01)
    # corbels + machicolation parapet
    for x in np.arange(-W + 0.5, W, 1.0):
        for k, (dz, dy) in enumerate(((8.45, 0.12), (8.7, 0.24), (8.93, 0.36))):
            b.box((x, YF - dy + 0.2, dz), (0.2, 0.2 + dy * 0.5, 0.12), stone_col(R, 8) * (0.9 + 0.05 * k), ch=0.03)
    ashlar(b, R, -W, W, 9.05, 10.2, YF - 0.42, depth=0.4, course=(0.36, 0.5), blen=(0.5, 1.0))
    b.box((0, YF - 0.42 + 0.2, 9.02), (W, 0.24, 0.05), MORTAR, ch=0.01)
    core(b, -W, W, YF - 0.3, 1.5, 8.35, 9.0)
    merlons(b, R, -W, W, 10.2, 1.05, YF - 0.42, 0.55)
    core(b, -W, W, YF + 0.2, 1.5, 9.0, 10.0, srgb("#26262e"))      # walkway behind the parapet
    return b.build()


def door_leaf(name, side):
    """Studded plank leaf 1.43 x 2.55 m. Origin = hinge (outer bottom corner); leaf extends toward x = -side*..."""
    b = Builder(name)
    R = Rng(11 if side < 0 else 12)
    w, h, t = 1.43, 2.55, 0.12
    d = -side                          # leaf extends from the hinge toward the doorway centre
    n = 5
    for i in range(n):
        x = d * (w * (i + 0.5) / n)
        b.box((x, 0, h * 0.5), (w / n * 0.5 - 0.012, t * 0.5, h * 0.5 - 0.01), (WOOD if i % 2 else WOOD2) * R.u(0.8, 1.05), M_WOOD, ch=0.012)
    for z in (0.45, 1.3, 2.15):
        b.box((d * w * 0.5, -t * 0.5 - 0.02, z), (w * 0.5, 0.02, 0.06), IRON, M_IRON, ch=0.008)
        for k in range(6):
            b.box((d * w * (k + 0.5) / 6, -t * 0.5 - 0.045, z), (0.028, 0.02, 0.028), IRON * 1.6, M_IRON, ch=0.01)
    b.box((d * (w - 0.25), -t * 0.5 - 0.05, 1.25), (0.05, 0.03, 0.14), IRON * 1.4, M_IRON, ch=0.01)        # ring pull boss
    return b.build()


def round_tower(name, spire=False, seed=5):
    b = Builder(name)
    R = Rng(seed)
    r0, top = 3.2, 15.0

    def radius(z):
        return r0 + (max(0.0, 1.0 - z) * 0.2 if z < 1.0 else 0.0)

    b.lathe([(r0 - 0.08, -3.0), (r0 - 0.08, top + 0.4)], 40, MORTAR, smooth=True)
    z = -3.0
    row = 0
    while z < top - 0.1:
        hc = min(R.u(0.45, 0.62), top - z)
        rz = radius(z + hc * 0.5)
        n = max(10, int(round(2 * math.pi * rz / 0.95)))
        dth = 2 * math.pi / n
        ph = (row % 2) * dth * 0.5 + R.u(-0.1, 0.1) * dth
        for i in range(n):
            th = ph + i * dth
            ny = -math.cos(th)                     # outward normal y (th = 0 → faces -Y = camera)
            if ny > 0.45:
                continue
            cz = z + hc * 0.5
            if abs(math.sin(th)) < 0.1 and 5.5 < cz < 7.2 or abs(math.sin(th) - 0.72) < 0.1 and 10.2 < cz < 11.8 and ny < 0:
                continue
            d = 0.32
            c = (math.sin(th) * (rz + d * 0.5 - 0.1 + R.u(0, 0.04)), -math.cos(th) * (rz + d * 0.5 - 0.1), cz)
            hw = rz * math.sin(dth * 0.5) - 0.03
            b.box(c, (hw, d * 0.5, hc * 0.5 - 0.028), stone_col(R, cz), ch=R.u(0.025, 0.055), M=rotz(th))
        z += hc
        row += 1
    for (th, z0, z1) in ((0.0, 5.6, 7.1), (math.asin(0.72), 10.3, 11.7)):
        c = np.array([math.sin(th), -math.cos(th), 0.0])
        M = rotz(th)
        for (hx, hz, dep) in ((0.22, 0.75, 0.5), (0.07, 0.72, 0.55), (0.3, 0.06, 0.55)):
            cc = c * (r0 + 0.05) + np.array([0, 0, 0.5 * (z0 + z1)])
            b.box(cc, (hx, dep * 0.5, hz), RECESS * (0.3 if hx < 0.25 else 1.2), ch=0.01, M=M)
    # corbel ring + crenellated parapet
    n = 26
    for i in range(n):
        th = i * 2 * math.pi / n
        if -math.cos(th) > 0.5:
            continue
        for k, (dz, dr) in enumerate(((top - 0.55, 0.15), (top - 0.3, 0.3), (top - 0.05, 0.45))):
            c = (math.sin(th) * (r0 + dr * 0.5), -math.cos(th) * (r0 + dr * 0.5), dz)
            b.box(c, (0.2, 0.2 + dr * 0.5, 0.12), stone_col(R, 12) * (0.9 + 0.05 * k), ch=0.03, M=rotz(th))
    rp = r0 + 0.5
    b.lathe([(rp - 0.1, top), (rp - 0.1, top + 1.3)], 40, MORTAR)
    b.lathe([(r0 - 0.1, top + 0.05), (rp, top + 0.05), (rp, top + 0.12)], 40, stone_col(R, 12) * 0.8)
    z = top + 0.12
    while z < top + 1.25:
        hc = min(0.42, top + 1.3 - z)
        nn = 30
        for i in range(nn):
            th = (i + 0.5 * (int(z * 7) % 2)) * 2 * math.pi / nn
            if -math.cos(th) > 0.45:
                continue
            c = (math.sin(th) * (rp + 0.1), -math.cos(th) * (rp + 0.1), z + hc * 0.5)
            b.box(c, (rp * math.sin(math.pi / nn) - 0.03, 0.2, hc * 0.5 - 0.025), stone_col(R, 13), ch=0.04, M=rotz(th))
        z += hc
    nm = 12
    for i in range(nm):
        th = (i + 0.5) * 2 * math.pi / nm
        if -math.cos(th) > 0.55:
            continue
        c = (math.sin(th) * (rp + 0.1), -math.cos(th) * (rp + 0.1), top + 1.3 + 0.5)
        b.box(c, (0.62, 0.25, 0.5), stone_col(R, 14) * 0.95, ch=0.05, M=rotz(th))
        b.box((c[0], c[1], top + 2.39), (0.68, 0.3, 0.09), stone_col(R, 14) * 1.05, ch=0.03, M=rotz(th))
    if spire:
        # conical slate roof in overlapping shingle bands + spike finial
        rt, zt, apex = rp + 0.25, top + 1.9, top + 10.5
        bands = 16
        for i in range(bands):
            t0, t1 = i / bands, (i + 1) / bands
            ra, rb = rt * (1 - t0) ** 1.08, rt * (1 - t1) ** 1.08
            za, zb = zt + (apex - zt) * t0, zt + (apex - zt) * t1
            shade = SLATE * (0.8 + 0.3 * ((i * 37) % 7) / 7)
            b.lathe([(ra + 0.1, za - 0.12), (ra + 0.06, za), (rb, zb + 0.05)], 36, shade, M_SLATE, smooth=False)
        b.pyramid((0, 0, apex - 0.2), (0.16, 0.16), (0, 0, apex + 2.4), IRON, M_IRON)
        b.lathe([(0.25, apex - 0.1), (0.3, apex + 0.05), (0.12, apex + 0.3)], 12, IRON, M_IRON)
    else:
        b.lathe([(0.0, top + 1.05), (rp - 0.1, top + 1.05)], 40, srgb("#22222a"))
    return b.build()


def pointed_top(x, W, spring):
    """Pointed (equilateral-ish) arch: returns the arch height at x (|x| <= W)."""
    Rr = W * 1.6
    cx = W - Rr                        # arc centre for the right half is at -(Rr - W) … mirrored
    ax = abs(x)
    return spring + math.sqrt(max(0.0, Rr * Rr - (ax - cx) ** 2))


def gatehouse(name, seed=9):
    b = Builder(name)
    R = Rng(seed)
    W, H = 6.0, 13.0
    GW, GS = 2.7, 3.6                  # gate half width, spring height
    apex = pointed_top(0.0, GW, GS)

    def hole(cx, cz, hw, hh):
        ax = abs(cx) - hw
        if ax > GW + 0.62:
            return False
        return cz - hh < pointed_top(min(max(ax, 0.0), GW), GW + 0.62, GS)

    core(b, -W, W, YF + 0.06, 2.5, -1.0, H + 0.8)
    ashlar(b, R, -W, W, -1.0, H - 1.4, YF, skip=hole, batter=plinth_batter(0.6), course=(0.5, 0.7), blen=(0.8, 1.6))
    # passage: dark recess + side walls + ribbed vault + inner doors
    core(b, -GW, GW, YF + 0.02, YF + 6.0, -0.2, apex + 0.1, RECESS)
    for sx in (-1, 1):
        for z in np.arange(0.0, GS + 1.2, 0.55):
            for yy in np.arange(0.4, 5.6, 1.1):
                b.box((sx * (GW - 0.1), YF + yy, z + 0.27), (0.12, 0.52, 0.25), stone_col(R, z, dark=0.35), ch=0.03)
    for yy in np.arange(0.6, 5.4, 1.2):
        for i in range(10):
            a = math.pi * (i + 0.5) / 10
            x = -math.cos(a) * (GW - 0.1)
            z = pointed_top(min(abs(x), GW), GW, GS) - 0.2
            b.box((x, YF + yy, z), (0.3, 0.15, 0.13), stone_col(R, 8, dark=0.3), ch=0.03)
    for j in range(10):                                                    # inner doors (far end, shut)
        xm = -GW + (j + 0.5) * (2 * GW / 10)
        top = pointed_top(min(abs(xm), GW), GW, GS) - 0.1
        b.box((xm, YF + 5.8, top * 0.5), (GW / 10 - 0.02, 0.06, top * 0.5), WOOD * R.u(0.4, 0.6), M_WOOD, ch=0.01)
    # portcullis slot lintel + voussoirs of the pointed arch
    Rr = GW * 1.6
    cxr = GW - Rr
    a_top = math.acos(min(1.0, (0 - cxr) / Rr))
    for side in (-1, 1):
        n = 9
        for i in range(n):
            a = a_top * (i + 0.5) / n
            px = cxr + Rr * math.cos(a)
            pz = GS + Rr * math.sin(a)
            nx, nz = math.cos(a), math.sin(a)
            c = (side * (px + nx * 0.34), YF + 0.2, pz + nz * 0.34)
            M = roty(side * (math.pi / 2 - a))
            b.box(c, (0.19, 0.24, 0.36), stone_col(R, pz) * 1.1, ch=0.045, M=M)
    b.box((0, YF + 0.15, apex + 0.5), (0.24, 0.28, 0.4), stone_col(R, 9) * 1.2, ch=0.05)       # keystone
    for sx in (-1, 1):
        for z in np.arange(-0.2, GS, 0.6):
            b.box((sx * (GW + 0.32), YF + 0.16, z + 0.3), (0.32, 0.24, 0.28), stone_col(R, z) * 1.06, ch=0.045)
    # string course + machicolation gallery over the gate, sigil recess panel
    for x in np.arange(-W, W - 0.01, 1.0):
        b.box((x + 0.5, YF - 0.08, H - 4.9), (0.49, 0.2, 0.12), stone_col(R, 8) * 1.05, ch=0.03)
    core(b, -1.55, 1.55, YF - 0.02, YF + 0.3, H - 4.7, H - 1.5, stone_col(R, 9) * 0.35)   # roundel recess
    for x in np.arange(-4.5, 4.51, 1.0):
        for k, (dz, dy) in enumerate(((H - 1.45, 0.15), (H - 1.2, 0.3), (H - 0.95, 0.48))):
            b.box((x, YF - dy + 0.2, dz), (0.21, 0.2 + dy * 0.5, 0.12), stone_col(R, 12) * (0.9 + 0.05 * k), ch=0.03)
    ashlar(b, R, -W, W, H - 0.9, H + 0.4, YF - 0.55, depth=0.45, course=(0.4, 0.5), blen=(0.5, 1.1))
    core(b, -W, W, YF - 0.45, 2.5, H - 1.4, H - 0.85)
    merlons(b, R, -W, W, H + 0.4, 1.2, YF - 0.55, 0.6, period=2.0, width=1.25)
    core(b, -W, W, YF + 0.1, 2.5, H - 0.8, H + 0.2, srgb("#26262e"))
    for sx in (-1, 1):                                                   # arrow slits flanking
        arrow_slit(b, sx * 4.2, 3.6, 5.2, YF)
        arrow_slit(b, sx * 4.2, 7.0, 8.4, YF)
    # bartizans: corbelled corner turrets with slate cones
    for sx in (-1, 1):
        cx, cy = sx * (W - 0.3), YF - 0.2
        for k in range(5):
            rr = 0.35 + k * 0.2
            b.lathe([(rr, H - 3.6 + k * 0.28), (rr + 0.2, H - 3.6 + (k + 1) * 0.28)], 16, stone_col(R, 10) * 0.9, c=(cx, cy, 0))
        rb = 1.25
        b.lathe([(rb, H - 2.2), (rb, H + 1.6)], 20, stone_col(R, 10) * 0.85, c=(cx, cy, 0), smooth=True)
        for zz in np.arange(H - 2.2, H + 1.6, 0.45):
            for i in range(14):
                th = (i + 0.5 * (int(zz * 5) % 2)) * 2 * math.pi / 14
                if -math.cos(th) > 0.5:
                    continue
                c = (cx + math.sin(th) * (rb + 0.1), cy - math.cos(th) * (rb + 0.1), zz + 0.22)
                b.box(c, (rb * math.sin(math.pi / 14) - 0.02, 0.13, 0.2), stone_col(R, 12), ch=0.03, M=rotz(th))
        b.lathe([(0.1, H + 1.3), (0.1, H + 1.6)], 8, RECESS, c=(cx, cy - rb, 0))
        for i in range(10):
            t0, t1 = i / 10, (i + 1) / 10
            ra, rb2 = (rb + 0.3) * (1 - t0), (rb + 0.3) * (1 - t1)
            b.lathe([(ra + 0.06, H + 1.6 + 4.2 * t0 - 0.08), (rb2, H + 1.6 + 4.2 * t1)], 20, SLATE * (0.85 + 0.2 * (i % 3) / 3), M_SLATE, c=(cx, cy, 0), smooth=False)
        b.pyramid((cx, cy, H + 5.7), (0.08, 0.08), (cx, cy, H + 7.0), IRON, M_IRON)
    return b.build()


def portcullis(name):
    b = Builder(name)
    GW, H = 2.85, 7.9
    xs = np.linspace(-GW + 0.2, GW - 0.2, 11)
    for x in xs:
        b.box((x, 0, H * 0.5 + 0.35), (0.07, 0.07, H * 0.5), IRON * 1.2, M_IRON, ch=0.02)
        b.pyramid((x, 0, 0.36), (0.075, 0.075), (x, 0, -0.1), IRON * 1.5, M_IRON)
        b.box((x, 0, 0.3), (0.07, 0.07, 0.06), IRON * 1.5, M_IRON, ch=0.01)  # base of the spike
    for z in np.arange(0.9, H, 0.72):
        b.box((0, -0.02, z), (GW - 0.1, 0.05, 0.055), IRON, M_IRON, ch=0.015)
        for x in xs:
            b.box((x, -0.08, z), (0.05, 0.03, 0.05), IRON * 1.7, M_IRON, ch=0.01)   # rivets
    return b.build()


def brazier(name):
    b = Builder(name)
    b.lathe([(0.0, 0.95), (0.3, 0.97), (0.52, 1.1), (0.62, 1.32), (0.66, 1.4), (0.6, 1.42)], 20, IRON * 1.1, M_IRON)
    b.lathe([(0.05, 1.33), (0.58, 1.33), (0.4, 1.46), (0.0, 1.52)], 14, COAL, M_GLOW, smooth=True)
    b.lathe([(0.1, 0.8), (0.14, 0.95)], 10, IRON, M_IRON)
    for i in range(3):
        a = i * 2 * math.pi / 3
        p0 = np.array([math.cos(a) * 0.12, math.sin(a) * 0.12, 0.9])
        p1 = np.array([math.cos(a) * 0.62, math.sin(a) * 0.62, 0.0])
        c = 0.5 * (p0 + p1)
        d = p1 - p0
        L = np.linalg.norm(d)
        ax = d / L
        # rotation taking +Z to ax
        z = np.array([0, 0, 1.0])
        v = np.cross(z, ax)
        s = np.linalg.norm(v)
        cth = np.dot(z, ax)
        vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        M = np.eye(3) + vx + vx @ vx * ((1 - cth) / (s * s + 1e-9))
        b.box(c, (0.04, 0.04, L * 0.5), IRON, M_IRON, ch=0.01, M=M)
        b.box(p1 + np.array([0, 0, 0.03]), (0.07, 0.07, 0.03), IRON, M_IRON, ch=0.01)
        # serpent-head finials on the rim
        hp = np.array([math.cos(a + 1.05) * 0.66, math.sin(a + 1.05) * 0.66, 1.43])
        b.pyramid(hp, (0.05, 0.05), hp + np.array([math.cos(a + 1.05) * 0.18, math.sin(a + 1.05) * 0.18, 0.12]), IRON * 1.3, M_IRON)
    return b.build()


# ----------------------------------------------------------------------------- SDF sculpts
def paint_sdf(ob, S, base_col, glow_mat=None, seed=1, grime=0.3):
    me = ob.data
    P = meshutil.get_verts(ob)
    X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
    n = len(P)
    Nn = pipeline.vertex_normals(ob)
    occ = np.zeros(n)
    for dist in (0.05, 0.14, 0.32):
        q = P + Nn * dist
        dd = S.dist(q)
        occ += np.clip((dist - dd) / dist, 0, 1) / 3.0
    ao = np.clip(1.0 - occ * 1.25, 0.25, 1.0)
    f1 = sdf.fbm(X, Y, Z, 4, 3.0, seed=seed)
    f2 = sdf.fbm(X, Y, Z, 3, 11.0, seed=seed + 5)
    col = np.tile(base_col, (n, 1)) * (0.78 + 0.4 * f1)[:, None] * (0.9 + 0.2 * f2)[:, None]
    down = smooth01(0.2, -0.8, Nn[:, 2])                    # undersides / drip shadows collect grime
    g = np.clip(down * grime + (1 - ao) * 0.4, 0, 1)
    col = col * (1 - g[:, None]) + GRIME[None, :] * g[:, None]
    col = col * ao[:, None]
    mask = np.zeros(n)
    if glow_mat is not None and "mat_id" in me.attributes:
        mid = np.zeros(n, np.float32)
        me.attributes["mat_id"].data.foreach_get("value", mid)
        gi = S.materials.index(glow_mat)
        gm = np.abs(mid - gi) < 0.5
        col[gm] = srgb("#ffb040")
        mask[gm] = M_GLOW
    meshutil.add_color_attr(ob, "Col", np.concatenate([col, mask[:, None]], axis=1).astype(np.float32))
    for a in list(me.attributes):
        if a.name.startswith("p_") or a.name == "mat_id":
            me.attributes.remove(a)
    for p in me.polygons:
        p.use_smooth = True


def sdf_mesh(S, name, target, h):
    t0 = time.time()
    ob = pipeline.sculpt_mesh(S, name, h, attrs=True, face_mats=False)
    meshutil.decimate(ob, target, symmetry=False)
    meshutil.triangulate(ob)
    print(name, "tris", meshutil.tri_count(ob), f"{time.time() - t0:.1f}s", flush=True)
    return ob


def serpent_statue():
    S = Sculpt(materials=("stone", "glow"), default_mat="stone")
    # plinth: stepped base + die + cornice
    S.add(RoundBox(V(0, 0, 0.12), V(0.95, 0.95, 0.12), r=0.03), 0.0)
    S.add(RoundBox(V(0, 0, 0.55), V(0.78, 0.78, 0.33), r=0.03), 0.0)
    S.add(RoundBox(V(0, 0, 0.93), V(0.88, 0.88, 0.07), r=0.03), 0.0)
    # coiled body: 2.3 turns spiralling up from the plinth top, tapering, then the rearing neck
    pts, rad = [], []
    turns = 2.3
    N = 70
    for i in range(N):
        t = i / (N - 1)
        a = -math.pi * 0.5 + t * turns * 2 * math.pi
        r = 0.6 - 0.22 * t
        pts.append(V(math.cos(a) * r, math.sin(a) * r, 1.2 + t * 0.55))
        rad.append(0.24 - 0.05 * t)
    last = pts[-1]
    neck = [last + V(-0.05, 0.05, 0.25), V(0.0, 0.1, 2.35), V(0.0, 0.0, 2.8), V(0.0, -0.12, 3.15)]
    pts += neck
    rad += [0.18, 0.16, 0.15, 0.14]
    body = Chain(pts, rad, k=0.06)
    S.add(Displace(body, 0.006, 22.0, octaves=2, seed=3), 0.08)
    # belly scutes: ridges on the rearing neck's front
    for i in range(9):
        z = 2.05 + i * 0.12
        S.add(Ellipsoid(V(0, -0.13 + (z - 2.0) * -0.02, z), V(0.12, 0.05, 0.035)), 0.02)
    # cobra hood: broad flattened shield behind the head
    S.add(Ellipsoid(V(0, 0.02, 3.05), V(0.46, 0.1, 0.42)), 0.12)
    S.sub(Ellipsoid(V(0, -0.12, 3.02), V(0.3, 0.06, 0.3)), 0.06)                    # hood hollow front
    # head: wedge skull pointing -Y and slightly down, heavy brow ridges, fangs
    S.add(Ellipsoid(V(0, -0.3, 3.3), V(0.19, 0.3, 0.13)), 0.08)
    S.add(Ellipsoid(V(0, -0.55, 3.25), V(0.14, 0.16, 0.09)), 0.06)
    for sx in (-1, 1):
        S.add(Capsule(V(sx * 0.12, -0.2, 3.4), V(sx * 0.1, -0.5, 3.35), 0.045), 0.04)   # brow ridge
        S.sub(Sphere(V(sx * 0.13, -0.42, 3.33), 0.05), 0.02)
        S.add(Sphere(V(sx * 0.125, -0.42, 3.33), 0.038), 0.0, "glow")
        S.add(RoundCone(V(sx * 0.07, -0.6, 3.2), V(sx * 0.065, -0.62, 3.06), 0.022, 0.004), 0.01)
    S.sub(Ellipsoid(V(0, -0.62, 3.2), V(0.12, 0.12, 0.018)), 0.01)                   # mouth line
    ob = sdf_mesh(S, "serpent", 9000 if FAST else 16000, 0.035 if FAST else 0.02)
    paint_sdf(ob, S, srgb("#5f606c"), glow_mat="glow", seed=4)
    return ob


def gargoyle():
    S = Sculpt(materials=("stone", "glow"), default_mat="stone")
    # corbel it crouches on (projects out of the wall toward -Y)
    S.add(RoundBox(V(0, -0.35, 0.0), V(0.42, 0.55, 0.14), r=0.03), 0.0)
    S.add(RoundBox(V(0, -0.1, -0.25), V(0.34, 0.32, 0.14), r=0.03), 0.0)
    # body: hunched chest, haunches, spine
    S.add(Ellipsoid(V(0, -0.55, 0.62), V(0.3, 0.28, 0.36)), 0.0)
    S.add(Ellipsoid(V(0, -0.3, 0.4), V(0.34, 0.3, 0.28)), 0.14)
    for sx in (-1, 1):
        S.add(Ellipsoid(V(sx * 0.26, -0.25, 0.3), V(0.14, 0.26, 0.2)), 0.08)                    # thighs
        S.add(Capsule(V(sx * 0.3, -0.36, 0.2), V(sx * 0.28, -0.6, 0.18), 0.07), 0.05)            # shins
        S.add(Capsule(V(sx * 0.2, -0.65, 0.66), V(sx * 0.2, -0.82, 0.2), 0.075), 0.06)           # forearms
        for k in (-1, 0, 1):
            S.add(RoundCone(V(sx * 0.2 + k * 0.045, -0.84, 0.18), V(sx * 0.2 + k * 0.05, -0.93, 0.14), 0.03, 0.01), 0.015)
            S.add(RoundCone(V(sx * 0.28 + k * 0.045, -0.62, 0.17), V(sx * 0.28 + k * 0.05, -0.72, 0.14), 0.03, 0.01), 0.015)
        # folded wings rising behind the shoulders: membrane slab + finger ridges
        S.add(Ellipsoid(V(sx * 0.34, -0.1, 0.95), V(0.1, 0.24, 0.5), M=sdf.rot(-18, sx * -20, 0)), 0.08)
        S.add(Capsule(V(sx * 0.3, -0.25, 0.8), V(sx * 0.46, 0.05, 1.48), 0.05), 0.04)
        S.add(RoundCone(V(sx * 0.46, 0.05, 1.48), V(sx * 0.42, 0.18, 1.64), 0.045, 0.01), 0.02)
        # horns: swept back
        S.add(RoundCone(V(sx * 0.12, -0.68, 1.08), V(sx * 0.24, -0.45, 1.3), 0.05, 0.012), 0.03)
        S.add(RoundCone(V(sx * 0.24, -0.45, 1.3), V(sx * 0.22, -0.28, 1.36), 0.014, 0.004), 0.01)
        # eyes (glow) under a heavy brow
        S.add(Capsule(V(sx * 0.02, -0.92, 1.05), V(sx * 0.15, -0.86, 1.07), 0.04), 0.03)
        S.sub(Sphere(V(sx * 0.09, -0.93, 0.99), 0.04), 0.015)
        S.add(Sphere(V(sx * 0.09, -0.925, 0.99), 0.03), 0.0, "glow")
        S.add(RoundCone(V(sx * 0.12, -0.9, 0.95), V(sx * 0.2, -0.72, 1.02), 0.04, 0.02), 0.04)   # cheek
    # head: snouted, jutting forward, open fanged maw
    S.add(Ellipsoid(V(0, -0.78, 0.98), V(0.17, 0.2, 0.16)), 0.1)
    S.add(Ellipsoid(V(0, -0.95, 0.92), V(0.11, 0.14, 0.09)), 0.06)
    S.sub(Ellipsoid(V(0, -1.04, 0.86), V(0.08, 0.1, 0.035)), 0.02)
    for sx in (-1, 1):
        S.add(RoundCone(V(sx * 0.05, -1.05, 0.9), V(sx * 0.05, -1.06, 0.83), 0.015, 0.003), 0.005)
    # spine ridge + tail curling over the corbel
    for i in range(6):
        S.add(RoundCone(V(0, -0.4 + i * 0.06, 0.95 - i * 0.1), V(0, -0.34 + i * 0.07, 1.02 - i * 0.1), 0.03, 0.006), 0.02)
    S.add(Chain([V(0, -0.1, 0.35), V(0.3, 0.05, 0.15), V(0.45, -0.3, 0.05), V(0.4, -0.55, 0.12)], [0.09, 0.07, 0.05, 0.02], k=0.03), 0.06)
    ob = sdf_mesh(S, "gargoyle", 6000 if FAST else 11000, 0.024 if FAST else 0.014)
    paint_sdf(ob, S, srgb("#5a5b66"), glow_mat="glow", seed=8, grime=0.45)
    return ob


def sigil():
    S = Sculpt(materials=("stone",), default_mat="stone")
    # roundel ring in the XZ plane (faces -Y), serpent coiled inside it, head at the centre rearing out
    ring = Torus(V(0, 0, 0), 1.25, 0.11, M=sdf.rot(90, 0, 0), squash=0.8)
    S.add(ring, 0.0)
    S.add(Torus(V(0, 0.05, 0), 1.05, 0.05, M=sdf.rot(90, 0, 0)), 0.0)
    pts, rad = [], []
    N = 60
    for i in range(N):
        t = i / (N - 1)
        a = math.pi * 0.5 + t * 2.1 * 2 * math.pi
        r = 0.92 * (1 - t) + 0.12
        pts.append(V(math.cos(a) * r, -0.08 - t * 0.12, math.sin(a) * r))
        rad.append(0.12 * (1 - t) + 0.07)
    S.add(Displace(Chain(pts, rad, k=0.03), 0.004, 25.0, octaves=2, seed=5), 0.03)
    S.add(Ellipsoid(V(0.0, -0.33, 0.2), V(0.16, 0.1, 0.13)), 0.05)
    S.add(Ellipsoid(V(0.0, -0.36, 0.05), V(0.1, 0.08, 0.14)), 0.04)
    for sx in (-1, 1):                                                             # fangs + tongue fork
        S.add(RoundCone(V(sx * 0.05, -0.42, -0.02), V(sx * 0.05, -0.42, -0.14), 0.018, 0.003), 0.01)
    S.add(RoundBox(V(0, 0.16, 0), V(1.3, 0.12, 1.3), r=0.02), 0.0)                  # backing slab
    ob = sdf_mesh(S, "sigil", 5000 if FAST else 9000, 0.03 if FAST else 0.018)
    paint_sdf(ob, S, srgb("#6a6a74"), seed=12, grime=0.35)
    return ob


# ----------------------------------------------------------------------------- main
def preview(obs, out):
    from lib import preview as pv
    importlib.reload(pv)
    pv.setup_workbench("VERTEX")
    views = []
    for ob in obs:
        mn = np.array([min(v[i] for v in ob.bound_box) for i in range(3)]) + np.array(ob.location)
        mx = np.array([max(v[i] for v in ob.bound_box) for i in range(3)]) + np.array(ob.location)
        c = 0.5 * (mn + mx)
        size = float(np.max(mx - mn))
        views.append(dict(target=tuple(c), dist=size * 1.9 + 1.0, yaw=-22, pitch=8, lens=50))
    pv.render_views(out, views, res=(420, 420))


LOD = {"wall": 2400, "tower": 4000, "tower_spire": 4500, "gatehouse": 5000}   # far-keep variants (<name>_lo)


def main():
    t0 = time.time()
    meshutil.clear_scene()
    makers = [
        ("wall", lambda: curtain_wall("wall")),
        ("wall_door", lambda: curtain_wall("wall_door", seed=4, door=True)),
        ("door_L", lambda: door_leaf("door_L", -1)),
        ("door_R", lambda: door_leaf("door_R", 1)),
        ("tower", lambda: round_tower("tower")),
        ("tower_spire", lambda: round_tower("tower_spire", spire=True, seed=6)),
        ("gatehouse", lambda: gatehouse("gatehouse")),
        ("portcullis", lambda: portcullis("portcullis")),
        ("brazier", lambda: brazier("brazier")),
        ("serpent", serpent_statue),
        ("gargoyle", gargoyle),
        ("sigil", sigil),
    ]
    obs = []
    x = 0.0
    for key, fn in makers:
        if ONLY and key not in ONLY:
            continue
        ob = fn()
        ob.name = key
        ob.data.name = key
        obs.append(ob)
        print("built", key, f"{time.time() - t0:.1f}s", flush=True)
        if key in LOD:
            lo = meshutil.duplicate(ob, key + "_lo")
            meshutil.decimate(lo, LOD[key], symmetry=False)
            meshutil.triangulate(lo)
            lo.name = key + "_lo"
            lo.data.name = key + "_lo"
            print(lo.name, "tris", meshutil.tri_count(lo), flush=True)
            obs.append(lo)
    if "--preview" in ARGV:
        # spread them out for the preview only
        for i, ob in enumerate(obs):
            ob.location = (i * 40.0, 0, 0)
        preview(obs, os.path.join(ROOT, "progress", "tmp", "stage4_kit_preview.png"))
        for ob in obs:
            ob.location = (0, 0, 0)
    if ONLY:
        print("ONLY set: not exporting", flush=True)
        return
    meshutil.select_only(obs, obs[0])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    kw = dict(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
              export_texcoords=False, export_normals=True, export_materials="NONE", export_animations=False)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="ACTIVE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    print("WROTE", OUT, os.path.getsize(OUT), f"{time.time() - t0:.1f}s", flush=True)


main()
