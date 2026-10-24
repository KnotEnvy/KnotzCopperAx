"""Stage 5 (Throne of Coils) hall kit -> public/assets/models/env_stage5_kit.glb

Game scale (1 Blender unit = 1 m). Blender Z up, Blender -Y = camera side (glTF +Z). Builder/ashlar helpers copied
from build_env_stage4_kit.py (masonry = real chamfered blocks over a dark mortar core -> recessed seams).
Objects (origin = base centre on the floor, fronts toward -Y):
  wall / wall_door  8 m obsidian-and-basalt hall wall (plinth, stepped-corbel niche with polished obsidian panel,
                    serpent-scale frieze, bronze inlay, cornice), door variant + door_L/door_R leaves
  pillar            colossal obsidian column (basalt base, bronze bands, capital) with a coiled serpent rearing out
  brazier           basalt pedestal + bronze bowl with serpent-head rim, witchfire coal bed (glow)
  throne            3-step dais, basalt seat, cobra-hood backrest with glowing eyes, serpent armrests
  altar             stepped altar with bronze fang cradle (relic hovers above it; relic = weapon_copperax.glb)
  statue / plinth   adder-guardian statue (cobra-hood helm, glaive) + its plinth (statues come alive)
  bones             bone pile (skulls, long bones, ribs)
  banner            tattered adder banner on an iron rod (solid cloth, geometric tatters, emblem in vertex colour)
  captive_queen / captive_consort   chained captives, origin = wrist shackles (hang them from chains)
  ledge             collapsed floor edge (broken obsidian slabs over a ruined basalt substructure) for the abyss
COLOR_0 (linear): rgb = albedo with baked AO; a = mask: 0 basalt stone, .25 metal (bronze/iron), .5 matte (bone,
cloth, skin, wood), .75 polished obsidian, 1 glow (rgb = emissive colour).
Run:  blender -b --factory-startup -P blender/build_env_stage5_kit.py [-- --fast] [--preview] [--only a,b]
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
OUT = os.path.join(ROOT, "public", "assets", "models", "env_stage5_kit.glb")
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
def sdf_mesh(S, name, target, h):
    t0 = time.time()
    ob = pipeline.sculpt_mesh(S, name, h, attrs=True, face_mats=False)
    meshutil.decimate(ob, target, symmetry=False)
    meshutil.triangulate(ob)
    print(name, "tris", meshutil.tri_count(ob), f"{time.time() - t0:.1f}s", flush=True)
    return ob




# ============================================================================= STAGE 5 content
M_STONE, M_METAL, M_MATTE, M_OBS, M_GLOW = 0.0, 0.25, 0.5, 0.75, 1.0
STONE = [srgb(h) for h in ("#46494a", "#404445", "#4b4c4f", "#43423f", "#3d4143", "#504f52")]   # green-grey basalt
MORTAR = srgb("#101312")
GRIME = srgb("#1c201c")
RECESS = srgb("#060807")
OBS = srgb("#141a19")          # polished obsidian (shader adds the mirror + green-violet sheen)
OBS2 = srgb("#1b2220")
BRONZE = srgb("#8a6a3c")       # aged bronze, mid-tone so it holds under witchfire
BRONZE_D = srgb("#5e4a2c")
IRON = srgb("#3a3a3e")
BONE = srgb("#a89a7e")
WOOD = srgb("#2e231c")
WITCH = srgb("#58ff8a")
EYE = srgb("#8cff6a")
GOLD = srgb("#e0a848")


def stone_col(R, z, wet_line=0.6, dark=1.0):
    """Basalt block colour: per-block shade, soot/grime band at the foot (overrides the stage-4 moat algae)."""
    c = STONE[int(R.u(0, len(STONE)))] * R.u(0.78, 1.14) * dark
    g = smooth01(1.4, -0.2, z) * 0.5
    return c * (1 - g) + GRIME * g


def rot_to(ax):
    """3x3 rotation taking +Z onto unit vector ax."""
    z = np.array([0, 0, 1.0])
    ax = np.asarray(ax, float) / np.linalg.norm(ax)
    v = np.cross(z, ax)
    s = np.linalg.norm(v)
    c = float(np.dot(z, ax))
    if s < 1e-8:
        return np.eye(3) if c > 0 else np.diag([1, -1, -1.0])
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * ((1 - c) / (s * s))


def rod(b, p0, p1, r, col, mask):
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    L = float(np.linalg.norm(d))
    b.box(0.5 * (p0 + p1), (r, r, L * 0.5), col, mask, ch=r * 0.4, M=rot_to(d))


# ----------------------------------------------------------------------------- hall wall
WALL_H = 13.0


def niche_hw(z):
    """Stepped-corbel niche half-width at height z (0 = closed)."""
    if z < 1.45 or z > 8.3:
        return 0.0
    if z < 6.4:
        return 1.45
    return max(0.0, 1.45 - math.ceil((z - 6.4) / 0.38) * 0.24)


def hall_wall(name, seed=3, door=False):
    b = Builder(name)
    R = Rng(seed)
    core(b, -4.0, 4.0, YF + 0.35, 1.0, 0.0, WALL_H)

    def in_door(cx, cz, hw, hh):
        return door and abs(cx) - hw < 1.35 and cz - hh < 3.9

    def skip(cx, cz, hw, hh):
        if in_door(cx, cz, hw, hh):
            return True
        for zz in (cz - hh, cz, cz + hh):
            w = niche_hw(zz)
            if w > 0 and abs(cx) - hw < w + 0.02:
                return True
        return False
    # plinth: heavy battered courses
    ashlar(b, R, -4, 4, 0, 1.3, YF - 0.05, depth=0.55, course=(0.38, 0.5), blen=(0.9, 1.9), batter=plinth_batter(1.3),
           dark=0.78, skip=lambda cx, cz, hw, hh: in_door(cx, cz, hw, hh))
    for sx in (-1, 1):                                              # plinth cap moulding (split around a door)
        x0, x1 = (-4.0, -1.35) if sx < 0 else (1.35, 4.0)
        if not door:
            x0, x1 = (-4.0, 0.0) if sx < 0 else (0.0, 4.0)
        b.box((0.5 * (x0 + x1), YF - 0.2, 1.37), (0.5 * (x1 - x0), 0.28, 0.07), stone_col(R, 5) * 1.12, ch=0.03)
    # main field
    ashlar(b, R, -4, 4, 1.45, 8.7, YF, depth=0.4, course=(0.46, 0.72), blen=(0.7, 1.6), skip=skip, pro=0.07)
    # pilaster halves at the module seams (neighbours complete them): proud, bigger blocks, bronze collar
    for sx in (-1, 1):
        z = 1.45
        while z < 8.6:
            hc = R.u(0.8, 1.1)
            b.box((sx * 3.55, YF - 0.22, z + hc * 0.5), (0.45, 0.26, hc * 0.5 - 0.03), stone_col(R, z) * 1.08, ch=0.05)
            z += hc
        b.box((sx * 3.55, YF - 0.3, 6.1), (0.47, 0.3, 0.09), BRONZE_D, M_METAL, ch=0.03)
    # niche: jamb stones (proud, lighter), polished obsidian panel set back, corbel steps
    zc = 1.45
    while zc < 8.3:
        w = niche_hw(zc + 0.2)
        if w <= 0:
            break
        hc = 0.38 if zc >= 6.4 else R.u(0.55, 0.8)
        for sx in (-1, 1):
            if door and zc < 3.9:
                continue
            b.box((sx * (w + 0.18), YF - 0.08, zc + hc * 0.5), (0.2, 0.3, hc * 0.5 - 0.025), stone_col(R, zc) * 1.18, ch=0.045)
        zc += hc
    z0 = 3.95 if door else 1.45
    b.box((0, YF + 0.5, 0.5 * (z0 + 8.3)), (1.46, 0.08, 0.5 * (8.3 - z0)), MORTAR, ch=0.01)
    zz = z0
    while zz < 8.25:                                                # obsidian slabs, fine horizontal seams
        h = min(R.u(0.9, 1.5), 8.3 - zz)
        w = min(niche_hw(zz + 0.01), niche_hw(min(zz + h - 0.01, 8.2)))
        if w > 0.05:
            b.box((0, YF + 0.4, zz + h * 0.5), (w - 0.02, 0.06, h * 0.5 - 0.012), OBS * R.u(0.85, 1.15), M_OBS, ch=0.012)
        zz += h
    # bronze serpent inlay line up the niche centre (thin, proud), ending in a glowing eye pair
    if not door:
        for sx in (-1, 1):
            b.box((sx * 0.12, YF + 0.32, 6.45), (0.05, 0.03, 0.03), EYE, M_GLOW, ch=0.01)
    if door:
        core(b, -1.3, 1.3, YF + 0.55, 1.0, 0.0, 3.9, RECESS)          # black passage
        b.box((0, YF - 0.05, 4.05), (1.65, 0.36, 0.17), stone_col(R, 4) * 1.2, ch=0.04)       # lintel
        for sx in (-1, 1):                                             # door jambs
            b.box((sx * 1.45, YF - 0.02, 1.95), (0.16, 0.34, 1.95), stone_col(R, 2) * 1.15, ch=0.04)
        b.box((0, YF - 0.25, 0.06), (1.5, 0.3, 0.06), stone_col(R, 0) * 0.9, ch=0.02)         # threshold
    # serpent-scale frieze (diamond scales in 3 offset rows) between bronze fillets
    b.box((0, YF - 0.12, 8.78), (4.0, 0.2, 0.06), BRONZE_D, M_METAL, ch=0.02)
    b.box((0, YF - 0.12, 9.72), (4.0, 0.2, 0.06), BRONZE_D, M_METAL, ch=0.02)
    b.box((0, YF + 0.05, 9.25), (4.0, 0.08, 0.42), MORTAR * 1.4, ch=0.01)
    Mr = roty(0.785)
    for row in range(3):
        z = 8.98 + row * 0.25
        off = 0.14 if row % 2 else 0.0
        x = -4.0 + off
        while x < 4.0:
            b.box((x, YF - 0.03, z), (0.1, 0.05, 0.1), stone_col(R, 9) * 1.1, ch=0.02, M=Mr)
            x += 0.28
    # cornice + upper courses (darker, into the gloom)
    b.box((0, YF - 0.3, 9.95), (4.0, 0.42, 0.14), stone_col(R, 10) * 1.1, ch=0.04)
    b.box((0, YF - 0.12, 10.15), (4.0, 0.26, 0.08), stone_col(R, 10), ch=0.03)
    ashlar(b, R, -4, 4, 10.25, WALL_H, YF + 0.05, depth=0.35, course=(0.55, 0.8), blen=(1.0, 2.0), dark=0.72)
    return b.build()


def door_leaf(name, side):
    """Iron-bound dark timber leaf, origin at the hinge (outer bottom corner); side -1 = left leaf."""
    b = Builder(name)
    R = Rng(40 + side)
    W, H = 1.28, 3.85
    for i in range(5):
        x0 = i * W / 5
        b.box((side * -(x0 + W / 10), 0, H * 0.5), (W / 10 - 0.012, 0.06, H * 0.5), WOOD * R.u(0.8, 1.2), M_MATTE, ch=0.015)
    for z in (0.5, 1.9, 3.3):
        b.box((side * -W * 0.5, -0.07, z), (W * 0.5, 0.015, 0.07), IRON, M_METAL, ch=0.008)
        for i in range(6):
            b.box((side * -(0.1 + i * 0.22), -0.09, z), (0.025, 0.02, 0.025), BRONZE, M_METAL, ch=0.01)
    b.box((side * -(W - 0.2), -0.1, 1.9), (0.05, 0.03, 0.12), BRONZE, M_METAL, ch=0.01)     # pull ring plate
    return b.build()


# ----------------------------------------------------------------------------- SDF painting (per material)
def paint5(ob, S, cols, seed=1, grime=0.3):
    """cols: {material: (rgb, mask)}. AO from the SDF, fbm variation, underside grime; glow stays flat."""
    me = ob.data
    P = meshutil.get_verts(ob)
    X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
    n = len(P)
    Nn = pipeline.vertex_normals(ob)
    occ = np.zeros(n)
    for dist in (0.04, 0.12, 0.3):
        dd = S.dist(P + Nn * dist)
        occ += np.clip((dist - dd) / dist, 0, 1) / 3.0
    ao = np.clip(1.0 - occ * 1.3, 0.22, 1.0)
    f1 = sdf.fbm(X, Y, Z, 4, 3.0, seed=seed)
    f2 = sdf.fbm(X, Y, Z, 3, 13.0, seed=seed + 5)
    mid = np.zeros(n, np.float32)
    if "mat_id" in me.attributes:
        me.attributes["mat_id"].data.foreach_get("value", mid)
    col = np.zeros((n, 3))
    mask = np.zeros(n)
    first = True
    for name, (rgb, mk) in cols.items():
        if name not in S.materials:
            continue
        gi = S.materials.index(name)
        m = np.abs(mid - gi) < 0.5
        if first:
            col[:] = rgb
            mask[:] = mk
            first = False
        col[m] = rgb
        mask[m] = mk
    glow = mask > 0.9
    var = (0.76 + 0.44 * f1)[:, None] * (0.88 + 0.24 * f2)[:, None]
    col = np.where(glow[:, None], col, col * var)
    down = smooth01(0.2, -0.8, Nn[:, 2])
    g = np.clip(down * grime + (1 - ao) * 0.45, 0, 1) * (~glow)
    col = col * (1 - g[:, None]) + GRIME[None, :] * g[:, None]
    col = np.where(glow[:, None], col, col * ao[:, None])
    meshutil.add_color_attr(ob, "Col", np.concatenate([col, mask[:, None]], axis=1).astype(np.float32))
    for a in list(me.attributes):
        if a.name.startswith("p_") or a.name == "mat_id":
            me.attributes.remove(a)
    for p in me.polygons:
        p.use_smooth = True


def cobra_head(S, c, s=1.0, mat="stone", hood=True, eyes=True, open_mouth=True, hoodw=0.55):
    """Cobra head facing -Y centred at c (hood behind it)."""
    c = np.asarray(c, float)

    def o(x, y, z):
        return V(c[0] + x * s, c[1] + y * s, c[2] + z * s)
    if hood:
        S.add(Ellipsoid(o(0, 0.3, -0.1), V(hoodw * s, 0.13 * s, 0.55 * s)), 0.12 * s, mat)
        S.sub(Ellipsoid(o(0, 0.12, -0.14), V(hoodw * 0.65 * s, 0.07 * s, 0.4 * s)), 0.05 * s)
        for i in range(4):                                             # hood ribs (carved)
            S.add(Capsule(o(-hoodw * 0.55 + i * hoodw * 0.37, 0.18, -0.45), o(-hoodw * 0.4 + i * hoodw * 0.27, 0.16, 0.25), 0.03 * s), 0.03 * s, mat)
    S.add(Ellipsoid(o(0, -0.05, 0.02), V(0.24 * s, 0.36 * s, 0.15 * s)), 0.08 * s, mat)
    S.add(Ellipsoid(o(0, -0.34, -0.02), V(0.16 * s, 0.18 * s, 0.1 * s)), 0.06 * s, mat)
    if open_mouth:
        S.sub(Ellipsoid(o(0, -0.4, -0.09), V(0.13 * s, 0.2 * s, 0.035 * s)), 0.015 * s)
        S.add(Ellipsoid(o(0, -0.22, -0.16), V(0.15 * s, 0.2 * s, 0.05 * s)), 0.04 * s, mat)   # lower jaw
    for sx in (-1, 1):
        S.add(Capsule(o(sx * 0.13, 0.05, 0.12), o(sx * 0.11, -0.3, 0.07), 0.05 * s), 0.04 * s, mat)   # brow ridge
        if eyes:
            S.sub(Sphere(o(sx * 0.15, -0.2, 0.06), 0.055 * s), 0.02 * s)
            S.add(Sphere(o(sx * 0.145, -0.2, 0.06), 0.042 * s), 0.0, "glow")
        S.add(RoundCone(o(sx * 0.08, -0.44, -0.07), o(sx * 0.075, -0.46, -0.2), 0.024 * s, 0.004 * s), 0.01 * s, mat)


# ----------------------------------------------------------------------------- pillar
def pillar():
    b = Builder("pillar_col")
    R = Rng(11)
    b.box((0, 0, 0.22), (1.3, 1.3, 0.22), stone_col(R, 0.5) * 0.9, ch=0.05)
    b.box((0, 0, 0.62), (1.12, 1.12, 0.18), stone_col(R, 1.0), ch=0.04)
    b.lathe([(1.0, 0.8), (1.04, 0.88), (1.0, 0.98), (0.9, 1.04), (0.86, 1.1)], 40, OBS2, M_OBS)
    prof = [(0.86 - 0.05 * (z / 11.0) ** 1.5, 1.1 + z) for z in np.linspace(0, 9.4, 12)]
    b.lathe(prof, 40, OBS, M_OBS)
    for zb in (1.25, 5.35, 9.0):
        b.lathe([(0.86, zb), (0.93, zb + 0.04), (0.94, zb + 0.16), (0.86, zb + 0.2)], 40, BRONZE, M_METAL)
    b.lathe([(0.82, 10.4), (1.0, 10.7), (1.18, 10.95)], 40, stone_col(R, 11), M_STONE)
    b.box((0, 0, 11.1), (1.3, 1.3, 0.16), stone_col(R, 11), ch=0.04)
    col = b.build()
    # the serpent: tail at the base, 2.4 turns up the shaft, neck rears off the front, head hangs over the belt
    S = Sculpt(materials=("stone", "glow"), default_mat="stone")
    turns = 2.4
    a_end = -math.pi * 0.5 + 0.35
    pts, rad = [], []
    N = 80
    for i in range(N):
        t = i / (N - 1)
        a = a_end - (1 - t) * turns * 2 * math.pi
        r_b = 0.15 + 0.26 * t ** 0.7
        rr = 0.86 + r_b - 0.07
        pts.append(V(math.cos(a) * rr, math.sin(a) * rr, 0.95 + t * 2.9))
        rad.append(r_b)
    last = pts[-1]
    pts += [last + V(-0.1, -0.35, 0.3), V(0.0, -1.5, 4.35), V(0.0, -1.78, 4.62)]
    rad += [0.4, 0.36, 0.32]
    S.add(Displace(Chain(pts, rad, k=0.05), 0.007, 20.0, octaves=2, seed=3), 0.06)
    for i in range(7):                                               # belly scutes on the rearing neck
        t = i / 6
        p = V(0.0, -1.25 - t * 0.5, 4.0 + t * 0.6)
        S.add(Ellipsoid(p + V(0, -0.2, -0.06), V(0.17, 0.06, 0.05)), 0.02)
    cobra_head(S, (0.0, -2.15, 4.78), s=1.4, hoodw=0.66)
    ob = sdf_mesh(S, "pillar_snake", 9000 if FAST else 12000, 0.04 if FAST else 0.028)
    paint5(ob, S, {"stone": (srgb("#52564f"), M_STONE), "glow": (EYE, M_GLOW)}, seed=4, grime=0.35)
    return meshutil.join([col, ob], "pillar")


# ----------------------------------------------------------------------------- brazier
def brazier(name):
    b = Builder(name)
    R = Rng(21)
    b.box((0, 0, 0.1), (0.5, 0.5, 0.1), stone_col(R, 2) * 0.9, ch=0.03)
    b.lathe([(0.34, 0.2), (0.3, 0.3), (0.22, 0.4), (0.2, 1.0), (0.26, 1.08), (0.3, 1.14)], 8, stone_col(R, 3), M_STONE, smooth=False)
    b.lathe([(0.2, 1.12), (0.42, 1.18), (0.62, 1.34), (0.7, 1.52), (0.66, 1.56)], 24, BRONZE, M_METAL)
    b.lathe([(0.0, 1.2), (0.3, 1.22), (0.63, 1.46), (0.45, 1.56), (0.0, 1.6)], 16, WITCH, M_GLOW)
    for i in range(6):
        a = i * math.pi / 3
        hp = np.array([math.cos(a) * 0.7, math.sin(a) * 0.7, 1.53])
        b.pyramid(hp, (0.06, 0.06), hp + np.array([math.cos(a) * 0.2, math.sin(a) * 0.2, 0.16]), BRONZE * 1.1, M_METAL)
        rod(b, (math.cos(a) * 0.24, math.sin(a) * 0.24, 1.1), (math.cos(a) * 0.55, math.sin(a) * 0.55, 1.32), 0.03, BRONZE_D, M_METAL)
    return b.build()


# ----------------------------------------------------------------------------- throne + altar
def throne():
    b = Builder("throne_dais")
    R = Rng(31)
    for i, (hw, hd) in enumerate(((3.8, 2.3), (3.1, 1.9), (2.4, 1.55))):
        z = i * 0.3
        x = -hw
        while x < hw - 0.05:                                          # each step = row of slabs (seams)
            L = min(R.u(0.9, 1.6), hw - x)
            b.box((x + L * 0.5, 0.3, z + 0.15), (L * 0.5 - 0.015, hd, 0.15), OBS * R.u(0.8, 1.2), M_OBS, ch=0.025)
            x += L
        b.box((0, 0.3 - hd - 0.01, z + 0.29), (hw, 0.03, 0.012), BRONZE_D, M_METAL, ch=0.005)   # bronze nosing
    b.box((0, 0.55, 1.2), (1.25, 0.75, 0.3), stone_col(R, 2) * 1.1, ch=0.06)                      # seat block
    b.box((0, 0.5, 1.55), (1.15, 0.7, 0.06), BRONZE_D, M_METAL, ch=0.02)
    b.box((0, 0.3, 1.64), (0.95, 0.5, 0.05), srgb("#3a1426"), M_MATTE, ch=0.02)                   # wine cushion
    dais = b.build()
    S = Sculpt(materials=("stone", "glow"), default_mat="stone")
    S.add(RoundBox(V(0, 1.2, 2.3), V(1.2, 0.22, 1.0), r=0.1), 0.0)
    cobra_head(S, (0.0, 0.95, 3.45), s=1.65, hoodw=0.8, open_mouth=True)
    for sx in (-1, 1):
        pts = [V(sx * 1.35, 1.1, 1.3), V(sx * 1.45, 0.6, 1.75), V(sx * 1.4, -0.1, 1.85), V(sx * 1.3, -0.45, 1.8)]
        S.add(Chain(pts, [0.22, 0.2, 0.18, 0.16], k=0.04), 0.08)
        cobra_head(S, (sx * 1.3, -0.62, 1.86), s=0.5, hood=False)
        S.add(Chain([V(sx * 1.35, 1.1, 1.3), V(sx * 1.55, 0.5, 1.0), V(sx * 1.45, -0.2, 0.95)], [0.2, 0.17, 0.12], k=0.04), 0.06)
    ob = sdf_mesh(S, "throne_back", 12000 if FAST else 16000, 0.04 if FAST else 0.03)
    paint5(ob, S, {"stone": (srgb("#4a4f4a"), M_STONE), "glow": (EYE, M_GLOW)}, seed=7, grime=0.3)
    return meshutil.join([dais, ob], "throne")


def altar():
    b = Builder("altar")
    R = Rng(51)
    tiers = ((2.6, 1.6, 0.45), (2.0, 1.25, 0.45), (1.5, 0.95, 0.45), (1.15, 0.75, 1.1))
    z = 0.0
    for i, (hw, hd, h) in enumerate(tiers):
        x = -hw
        while x < hw - 0.05:
            L = min(R.u(0.7, 1.3), hw - x)
            k = OBS * R.u(0.8, 1.2) if i == 3 else stone_col(R, z + 1) * 1.05
            b.box((x + L * 0.5, 0, z + h * 0.5), (L * 0.5 - 0.014, hd, h * 0.5 - 0.01), k, M_OBS if i == 3 else M_STONE, ch=0.03)
            x += L
        b.box((0, -hd - 0.01, z + h - 0.03), (hw, 0.03, 0.03), BRONZE_D, M_METAL, ch=0.01)
        z += h
    top = z
    b.box((0, 0, top + 0.08), (1.3, 0.85, 0.08), stone_col(R, 4) * 1.15, ch=0.03)
    for sx in (-1, 1):                                  # bronze fang cradle: two curved prongs bending inward
        prev = None
        for i in range(9):
            t = i / 8
            p = np.array([sx * (0.75 - 0.35 * t * t), 0.0, top + 0.2 + t * 1.6])
            if prev is not None:
                rod(b, prev, p, 0.075 * (1 - t * 0.6), BRONZE, M_METAL)
            prev = p
    b.lathe([(0.0, top + 0.16), (0.35, top + 0.18), (0.3, top + 0.3), (0.0, top + 0.32)], 16, GOLD, M_GLOW)
    return b.build()


# ----------------------------------------------------------------------------- statues
def guardian():
    S = Sculpt(materials=("stone", "glow"), default_mat="stone")
    for sx in (-1, 1):
        S.add(Capsule(V(sx * 0.2, 0.0, 1.0), V(sx * 0.28, -0.05, 0.55), 0.13), 0.06)          # thighs (stance)
        S.add(Capsule(V(sx * 0.28, -0.05, 0.55), V(sx * 0.32, 0.0, 0.1), 0.1), 0.05)          # greaves
        S.add(RoundBox(V(sx * 0.32, -0.08, 0.06), V(0.09, 0.16, 0.06), r=0.03), 0.03)         # boots
        S.add(Ellipsoid(V(sx * 0.36, 0.0, 1.62), V(0.2, 0.18, 0.13)), 0.05)                   # pauldrons
        S.add(Ellipsoid(V(sx * 0.36, 0.0, 1.55), V(0.22, 0.2, 0.08)), 0.03)
    S.add(RoundCone(V(0, 0, 0.95), V(0, 0.02, 1.2), 0.3, 0.26), 0.06)                           # hips / tasset
    for i in range(5):
        S.add(RoundBox(V(-0.24 + i * 0.12, -0.2, 0.82), V(0.05, 0.04, 0.2), r=0.02), 0.02)     # skirt plates
    S.add(Ellipsoid(V(0, 0.0, 1.42), V(0.3, 0.2, 0.3)), 0.08)                                   # cuirass
    S.add(Ellipsoid(V(0, -0.1, 1.45), V(0.22, 0.12, 0.2)), 0.05)
    S.add(Capsule(V(0.42, 0.0, 1.55), V(0.5, -0.1, 1.2), 0.08), 0.04)                           # right arm → glaive
    S.add(Capsule(V(0.5, -0.1, 1.2), V(0.48, -0.28, 1.35), 0.07), 0.04)
    S.add(Sphere(V(0.48, -0.3, 1.36), 0.08), 0.03)
    S.add(Capsule(V(-0.42, 0.0, 1.55), V(-0.5, 0.05, 1.22), 0.08), 0.04)                        # left hand on hip
    S.add(Capsule(V(-0.5, 0.05, 1.22), V(-0.3, -0.05, 1.05), 0.07), 0.04)
    S.add(Capsule(V(0.48, -0.3, 0.05), V(0.48, -0.3, 2.5), 0.035), 0.0)                         # glaive haft
    S.add(RoundCone(V(0.48, -0.3, 2.45), V(0.48, -0.3, 3.0), 0.09, 0.01, squash=(1.0, 0.3)), 0.02)
    S.add(Capsule(V(0.36, -0.3, 2.47), V(0.6, -0.3, 2.47), 0.03), 0.01)
    S.add(Sphere(V(0, -0.02, 1.9), 0.14), 0.05)                                                 # cobra-hood helm
    S.add(Ellipsoid(V(0, 0.08, 1.98), V(0.3, 0.07, 0.32)), 0.06)
    S.add(Ellipsoid(V(0, -0.08, 2.14), V(0.1, 0.16, 0.07)), 0.04)
    for sx in (-1, 1):
        S.sub(Sphere(V(sx * 0.055, -0.14, 1.9), 0.03), 0.01)
        S.add(Sphere(V(sx * 0.055, -0.135, 1.9), 0.024), 0.0, "glow")
    ob = sdf_mesh(S, "statue", 6000 if FAST else 10000, 0.024 if FAST else 0.016)
    paint5(ob, S, {"stone": (srgb("#6e7266"), M_STONE), "glow": (EYE, M_GLOW)}, seed=9, grime=0.4)
    return ob


def plinth():
    b = Builder("plinth")
    R = Rng(61)
    b.box((0, 0, 0.12), (0.72, 0.62, 0.12), stone_col(R, 0) * 0.85, ch=0.04)
    b.box((0, 0, 0.5), (0.58, 0.5, 0.28), stone_col(R, 1), ch=0.04)
    b.box((0, -0.505, 0.5), (0.36, 0.01, 0.18), OBS, M_OBS, ch=0.005)
    b.box((0, 0, 0.84), (0.66, 0.56, 0.06), stone_col(R, 2) * 1.12, ch=0.03)
    return b.build()


def bones():
    S = Sculpt(materials=("bone",), default_mat="bone")
    rng = np.random.default_rng(7)
    S.add(Ellipsoid(V(0, 0, -0.05), V(1.1, 0.8, 0.22)), 0.1)                                      # heaped core
    for i in range(26):                                                                           # long bones
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0, 0.9)
        c = np.array([math.cos(a) * r, math.sin(a) * r * 0.7, 0.1 + (1 - r) * 0.18 + rng.uniform(0, 0.06)])
        th = rng.uniform(0, 6.3)
        d = np.array([math.cos(th), math.sin(th), rng.uniform(-0.2, 0.2)])
        d /= np.linalg.norm(d)
        L = rng.uniform(0.2, 0.34)
        p0, p1 = c - d * L, c + d * L
        S.add(Capsule(V(*p0), V(*p1), 0.028), 0.01)
        S.add(Sphere(V(*p0), 0.048), 0.02)
        S.add(Sphere(V(*p1), 0.045), 0.02)
    for i in range(9):                                                                            # skulls
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.1, 0.85)
        c = V(math.cos(a) * r, math.sin(a) * r * 0.7 - 0.05, 0.2 + (1 - r) * 0.2)
        S.add(Sphere(c, 0.1), 0.02)
        S.add(Ellipsoid(c + V(0, -0.07, -0.06), V(0.06, 0.06, 0.05)), 0.03)
        for sx in (-1, 1):
            S.sub(Sphere(c + V(sx * 0.04, -0.09, 0.0), 0.028), 0.01)
    for i in range(4):                                                                            # rib cages
        c = np.array([rng.uniform(-0.7, 0.7), rng.uniform(-0.3, 0.4), 0.2])
        for k in range(4):
            S.add(Torus(V(c[0] + k * 0.06, c[1], c[2]), 0.14, 0.015, M=sdf.rot(0, 90, 0)), 0.01)
    ob = sdf_mesh(S, "bones", 4000 if FAST else 6000, 0.02 if FAST else 0.014)
    paint5(ob, S, {"bone": (BONE, M_MATTE)}, seed=13, grime=0.6)
    return ob


# ----------------------------------------------------------------------------- banner (solid cloth)
def banner():
    b = Builder("banner")
    W, H = 1.5, 4.4
    nx, nz = 30, 70
    th = 0.018
    rod(b, (-W * 0.5 - 0.2, 0, 0), (W * 0.5 + 0.2, 0, 0), 0.035, IRON, M_METAL)
    for sx in (-1, 1):
        b.pyramid((sx * (W * 0.5 + 0.2), 0, -0.05), (0.05, 0.05), (sx * (W * 0.5 + 0.34), 0, 0.0), BRONZE, M_METAL)
    rng = np.random.default_rng(3)
    cut = []
    for i in range(nx + 1):                  # bottom edge: 3 swallow-tail points + random tears (per column length)
        u = i / nx
        tri = 1.0 - abs(((u * 3) % 1.0) - 0.5) * 2
        cut.append(H - 0.7 * tri - (rng.uniform(0, 0.3) if rng.uniform() < 0.3 else 0.0))
    Vt, Q, C = [], [], []

    def colf(u, v):   # v = depth down from the rod (m)
        x = (u - 0.5) * W
        if u < 0.06 or u > 0.94 or v < 0.2:
            return BRONZE_D * 1.1
        dz = v - 1.55
        r = math.hypot(x, dz)
        ring = abs(r - 0.42) < 0.07
        sq = abs(x - 0.22 * math.sin((v - 1.9) * 4.0)) < 0.07 and 1.95 < v < 3.2
        head = math.hypot(x, dz + 0.1) < 0.11
        if ring or sq or head:
            return srgb("#b08a3c")
        s = 1.0 - 0.45 * max(0.0, (v - 3.0) / 1.4)
        return srgb("#4a2460") * (0.85 + 0.3 * math.sin(u * 40 + v * 3) ** 2) * s

    for side in (0, 1):
        y0 = -th if side == 0 else th
        start = len(Vt)
        for j in range(nz + 1):
            for i in range(nx + 1):
                u = i / nx
                v = 0.06 + (cut[i] - 0.06) * j / nz
                x = (u - 0.5) * W
                fold = 0.05 * math.sin(u * 13.0 + v * 0.8) + 0.03 * math.sin(u * 29.0) * (v / H) + 0.08 * (v / H) ** 2 * math.sin(u * 5)
                Vt.append((x, y0 + fold, -v))
                C.append(colf(u, v))
        for j in range(nz):
            for i in range(nx):
                a = start + j * (nx + 1) + i
                q = [a, a + 1, a + nx + 2, a + nx + 1]
                Q.append(q if side == 1 else q[::-1])
    NV = (nx + 1) * (nz + 1)
    for i in range(nx):                                   # bottom edge strip
        a, c2 = nz * (nx + 1) + i, nz * (nx + 1) + i + 1
        Q.append([a, c2, c2 + NV, a + NV])
    for j in range(nz):                                   # side strips
        for i in (0, nx):
            a, c2 = j * (nx + 1) + i, (j + 1) * (nx + 1) + i
            Q.append([a, c2, c2 + NV, a + NV] if i == 0 else [c2, a, a + NV, c2 + NV])
    b.add(np.array(Vt), Q, [], np.array(C), M_MATTE, smooth=True)
    return b.build()


# ----------------------------------------------------------------------------- captives (origin = wrist shackles)
def captive(name, queen=True):
    S = Sculpt(materials=("skin", "cloth", "metal", "hair"), default_mat="skin")
    for sx in (-1, 1):
        S.add(Capsule(V(sx * 0.05, 0, -0.06), V(sx * 0.13, 0.02, -0.36), 0.042), 0.02)       # forearms
        S.add(Capsule(V(sx * 0.13, 0.02, -0.36), V(sx * 0.2, 0.03, -0.64), 0.052), 0.02)     # upper arms
        S.add(Sphere(V(sx * 0.04, 0, -0.02), 0.045), 0.02)                                   # hands
        S.add(Torus(V(sx * 0.055, 0, -0.07), 0.05, 0.018), 0.0, "metal")                     # shackles
    S.add(Ellipsoid(V(0, -0.05, -0.72), V(0.1, 0.11, 0.125)), 0.03)                          # head, slumped fwd
    S.add(Capsule(V(0, 0.0, -0.8), V(0, 0.0, -0.9), 0.05), 0.03)
    if queen:
        S.add(Ellipsoid(V(0, 0.06, -0.8), V(0.12, 0.08, 0.3)), 0.04, "hair")
        S.add(Torus(V(0, -0.02, -0.64), 0.09, 0.016), 0.0, "metal")                          # crown band
        for k in range(5):
            a = -1.2 + k * 0.6
            S.add(RoundCone(V(math.sin(a) * 0.09, -0.02 - math.cos(a) * 0.045, -0.64), V(math.sin(a) * 0.1, -0.02 - math.cos(a) * 0.05, -0.55), 0.016, 0.003), 0.0, "metal")
        S.add(Ellipsoid(V(0, 0.0, -1.1), V(0.17, 0.11, 0.26)), 0.05, "cloth")
        S.add(RoundCone(V(0, 0.0, -1.3), V(0, 0.02, -2.15), 0.16, 0.3), 0.06, "cloth")      # gown
        S.sub(Ellipsoid(V(0, 0.0, -2.35), V(0.28, 0.24, 0.12)), 0.04)
        for k in range(6):
            a = k * math.pi / 3
            S.add(Capsule(V(math.cos(a) * 0.14, math.sin(a) * 0.1, -1.4), V(math.cos(a) * 0.28, math.sin(a) * 0.24, -2.12), 0.03), 0.04, "cloth")
        S.add(Capsule(V(-0.17, 0.0, -1.05), V(0.17, 0.0, -1.05), 0.02), 0.01, "metal")
    else:
        S.add(Ellipsoid(V(0, 0.0, -1.1), V(0.21, 0.13, 0.28)), 0.05, "cloth")
        S.add(RoundCone(V(0, 0.0, -1.3), V(0, 0.0, -1.62), 0.2, 0.23), 0.04, "cloth")
        for sx in (-1, 1):
            S.add(Capsule(V(sx * 0.1, 0.0, -1.55), V(sx * 0.12, 0.03, -2.0), 0.07), 0.03, "cloth")
            S.add(Capsule(V(sx * 0.12, 0.03, -2.0), V(sx * 0.13, 0.0, -2.3), 0.055), 0.02, "hair")
        S.add(Ellipsoid(V(0, -0.1, -0.78), V(0.08, 0.05, 0.07)), 0.03, "hair")
        S.add(Capsule(V(-0.2, 0.0, -1.3), V(0.2, 0.0, -1.3), 0.03), 0.01, "metal")
    ob = sdf_mesh(S, name, 5000 if FAST else 8000, 0.018 if FAST else 0.012)
    cloth = srgb("#7a2034") if queen else srgb("#34466e")
    paint5(ob, S, {"skin": (srgb("#b88a72"), M_MATTE), "cloth": (cloth, M_MATTE), "metal": (GOLD * 0.8 if queen else IRON * 1.5, M_METAL),
                   "hair": (srgb("#8a4a24") if queen else srgb("#2a2018"), M_MATTE)}, seed=17 if queen else 19, grime=0.2)
    return ob


# ----------------------------------------------------------------------------- collapsed floor edge (abyss lip)
def ledge():
    b = Builder("ledge")
    R = Rng(71)
    x = -4.0
    while x < 4.0:                                               # broken slabs: top at z=0, jagged front edge
        L = min(R.u(0.7, 1.5), 4.0 - x)
        front = -R.u(0.05, 0.55)
        tilt = R.u(-0.12, 0.05) if R.u() < 0.4 else 0.0
        b.box((x + L * 0.5, 0.5 * (front + 0.7), -0.09 + tilt * 0.3), (L * 0.5 - 0.02, 0.5 * (0.7 - front), 0.09), OBS * R.u(0.8, 1.2), M_OBS, ch=0.02, M=rotx(tilt))
        x += L
    ashlar(b, R, -4, 4, -3.2, -0.2, 0.25, depth=0.5, course=(0.3, 0.6), blen=(0.4, 1.4), dark=0.42, pro=0.35,
           skip=lambda cx, cz, hw, hh: R.u() < 0.3 + (-cz) * 0.12 + 0.25 * math.sin(cx * 1.3) ** 2)
    core(b, -4, 4, 0.2, 0.8, -3.4, -0.18, RECESS)
    for i in range(14):                                          # hanging / wedged broken chunks
        cx = R.u(-3.6, 3.6)
        b.box((cx, R.u(-0.2, 0.1), R.u(-2.6, -0.8)), (R.u(0.15, 0.4), R.u(0.12, 0.3), R.u(0.12, 0.3)), stone_col(R, 0) * 0.7, ch=0.03,
              M=rotz(R.u(0, 3)) @ rotx(R.u(-0.5, 0.5)))
    return b.build()


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
    pv.render_views(out, views, res=(360, 360))


LOD = {"wall": 3000, "pillar": 7000}


def main():
    t0 = time.time()
    meshutil.clear_scene()
    makers = [
        ("wall", lambda: hall_wall("wall")),
        ("wall_door", lambda: hall_wall("wall_door", seed=4, door=True)),
        ("door_L", lambda: door_leaf("door_L", -1)),
        ("door_R", lambda: door_leaf("door_R", 1)),
        ("pillar", pillar),
        ("brazier", lambda: brazier("brazier")),
        ("throne", throne),
        ("altar", altar),
        ("statue", guardian),
        ("plinth", plinth),
        ("bones", bones),
        ("banner", banner),
        ("captive_queen", lambda: captive("captive_queen", True)),
        ("captive_consort", lambda: captive("captive_consort", False)),
        ("ledge", ledge),
    ]
    obs = []
    for key, fn in makers:
        if ONLY and key not in ONLY:
            continue
        ob = fn()
        ob.name = key
        ob.data.name = key
        obs.append(ob)
        print("built", key, meshutil.tri_count(ob), f"{time.time() - t0:.1f}s", flush=True)
        if key in LOD:
            lo = meshutil.duplicate(ob, key + "_lo")
            meshutil.decimate(lo, LOD[key], symmetry=False)
            meshutil.triangulate(lo)
            lo.name = key + "_lo"
            lo.data.name = key + "_lo"
            obs.append(lo)
    if "--preview" in ARGV:
        for i, ob in enumerate(obs):
            ob.location = (i * 40.0, 0, 0)
        preview(obs, os.path.join(ROOT, "progress", "tmp", "stage5_kit_preview.png"))
        for ob in obs:
            ob.location = (0, 0, 0)
    if ONLY and "--export" not in ARGV:
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
