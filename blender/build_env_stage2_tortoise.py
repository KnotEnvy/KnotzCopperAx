"""Stage 2 hero asset: Old Shellfather's head + neck (skinned, 4 bones) and a front leg (rigid), for Shellback Crossing.

Authored at 1/10 scale (1 Blender unit = 10 m in game; the stage scales the GLB x10). Blender coords: Z up, the
tortoise faces -Y (glTF +Z). The neck emerges from the shell at the origin and rises forward to a blunt, heavy-lidded
head with a hooked keratin beak; skin is pebbly scales that grow into big plates on the crown, deep wrinkle folds
bunch at the neck base, a loose dewlap hangs under the throat; moss and pale lichen grow on up-facing surfaces.
The leg is a scaled elephantine column (origin at the shoulder, hanging -Z) with big armour scales on its front.

Vertex colour COLOR_0 (linear): rgb = painted albedo (AO + seams baked in), a = eye glow mask.
Bones (neck mesh): neck_1 -> neck_2 -> neck_3 -> head (the stage sways them).
Run:  blender -b --factory-startup -P blender/build_env_stage2_tortoise.py [-- --fast]
Out:  public/assets/models/env_stage2_tortoise.glb
"""
import os
import sys
import importlib
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy
import numpy as np
from lib import sdf, meshutil, pipeline
for _m in (sdf, meshutil, pipeline):
    importlib.reload(_m)
from lib.sdf import V, Sculpt, Sphere, Ellipsoid, Capsule, RoundCone, Union, Chain, Func, Displace, Bounded

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "assets", "models", "env_stage2_tortoise.glb")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FAST = "--fast" in ARGV
H = 0.02 if FAST else 0.0125


# ----------------------------------------------------------------------------- cellular (scale/plate) pattern
def cells(X, Y, Z, s, seed=0):
    """Jittered-grid voronoi: returns (edge distance F2-F1 in units, cell id hash). s = cell size."""
    px, py, pz = X / s, Y / s, Z / s
    ix, iy, iz = np.floor(px), np.floor(py), np.floor(pz)
    f1 = np.full(X.shape, 1e9)
    f2 = np.full(X.shape, 1e9)
    cid = np.zeros(X.shape)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                cx, cy, cz = ix + dx, iy + dy, iz + dz
                h = sdf._hash(cx.astype(np.int64), cy.astype(np.int64), cz.astype(np.int64), seed)
                h2 = sdf._hash(cx.astype(np.int64), cy.astype(np.int64), cz.astype(np.int64), seed + 17)
                h3 = sdf._hash(cx.astype(np.int64), cy.astype(np.int64), cz.astype(np.int64), seed + 31)
                qx, qy, qz = cx + 0.15 + 0.7 * h, cy + 0.15 + 0.7 * h2, cz + 0.15 + 0.7 * h3
                d = np.sqrt((px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2)
                nearer = d < f1
                f2 = np.where(nearer, f1, np.minimum(f2, d))
                cid = np.where(nearer, h, cid)
                f1 = np.where(nearer, d, f1)
    return (f2 - f1) * s * 0.5, cid


def smooth01(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# neck spine (Blender coords). Joint positions double as bone heads.
# r5: a MASSIVE, near-horizontal neck (a wading tortoise's) that leaves the body under the carapace's front rim,
# carrying a broad blunt head (heavy hooded brow, huge lidded amber eye, wide hooked beak, sagging jowls).
NECK = [V(0, 1.0, -0.2), V(0, 0.3, 0.0), V(0, -0.3, 0.12), V(0, -0.85, 0.25), V(0, -1.35, 0.4), V(0, -1.75, 0.52)]
NECK_R = [0.66, 0.64, 0.58, 0.52, 0.47, 0.44]
HEAD_C = V(0, -2.2, 0.62)
EYE = (0.5, -2.47, 0.7)            # |x|, y, z of the eyeball centre
EYE_R = 0.15
HEAD_PTS = [V(0, -2.25, 0.62), V(0, -3.1, 0.52)]
WATER_Z = -0.15                     # lake surface in rig space (the stage places the rig so this lands on the water)


def hc(dx, dy, dz):
    return HEAD_C + V(dx, dy, dz)


def neck_param(X, Y, Z):
    """Arc-length parameter along the neck polyline (+ head extension) and the distance to it."""
    pts = NECK + HEAD_PTS
    P = np.stack([X, Y, Z], -1)
    best = np.full(X.shape, 1e9)
    s = np.zeros(X.shape)
    acc = 0.0
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        L = float(np.linalg.norm(ab))
        t = np.clip(((P - a) @ ab) / (L * L), 0, 1)
        q = a + t[..., None] * ab
        d = np.linalg.norm(P - q, axis=-1)
        m = d < best
        best = np.where(m, d, best)
        s = np.where(m, acc + t * L, s)
        acc += L
    return s, best


_cum = [0.0]
for _i in range(len(NECK) - 1):
    _cum.append(_cum[-1] + float(np.linalg.norm(NECK[_i + 1] - NECK[_i])))
S_HEAD = _cum[-1] - 0.05      # arc length where the neck becomes the head


def skin_field(base, seam_amp, scale_fn, seed):
    """Wrap `base` with a scale/plate relief: grooves along voronoi seams (+d = pushed in) and a slight dome per scale."""
    def fn(X, Y, Z):
        X, Y, Z = np.broadcast_arrays(X, Y, Z)
        d = base.d(X, Y, Z)
        near = np.abs(d) < 0.06
        if not np.any(near):
            return d
        x, y, z = X[near], Y[near], Z[near]
        sz, amp = scale_fn(x, y, z)
        e, _ = cells(x, y, z, sz, seed)
        groove = 1.0 - smooth01(0.0, 0.16 * sz, e)
        dome = smooth01(0.1 * sz, 0.45 * sz, e)
        out = d.copy()
        out[near] = d[near] + seam_amp * amp * sz * (groove * 0.9 - dome * 0.25)
        return out
    return Bounded(Func(fn, base.lo - 0.05, base.hi + 0.05), base.lo - 0.05, base.hi + 0.05)


def neck_scale(x, y, z):
    """(scale size, relief amount): small pebbles in the neck folds, big armour plates on the crown/cheeks."""
    s, _ = neck_param(x, y, z)
    head = smooth01(S_HEAD - 0.1, S_HEAD + 0.15, s)
    crown = smooth01(-0.05, 0.2, z - HEAD_C[2]) * head
    size = 0.04 + 0.1 * crown + 0.03 * head * (1 - crown)
    amp = 0.3 + 0.6 * head
    return size, amp


def build_head():
    S = Sculpt(materials=("skin", "beak", "eye", "claw"), default_mat="skin")
    parts = []
    parts.append(Chain(NECK, NECK_R, squash=(0.92, 1.0), ref=(0, 0, 1), k=0.05))
    # sagging throat skin: two heavy dewlap rolls under the neck + jowls hanging off the jaw corners
    parts.append(Ellipsoid(hc(0, 1.15, -0.72), V(0.46, 0.55, 0.36)))
    parts.append(Ellipsoid(hc(0, 0.6, -0.64), V(0.44, 0.5, 0.36)))
    # cranium: broad blunt dome, flat armoured crown, heavy cheeks, deep lower jaw
    parts.append(Ellipsoid(HEAD_C, V(0.62, 0.72, 0.5)))
    parts.append(Ellipsoid(hc(0, 0.05, 0.38), V(0.5, 0.58, 0.15)))
    parts.append(Ellipsoid(hc(0, -0.6, -0.07), V(0.46, 0.36, 0.4)))                       # snout
    for sx in (-1, 1):
        parts.append(Ellipsoid(hc(sx * 0.42, -0.1, -0.17), V(0.27, 0.5, 0.34)))            # cheeks
        parts.append(Ellipsoid(hc(sx * 0.4, 0.38, -0.52), V(0.28, 0.42, 0.32)))            # jowls
    parts.append(Ellipsoid(hc(0, -0.15, -0.44), V(0.57, 0.72, 0.22)))                     # lower jaw
    body = Union(*parts, k=0.12)

    # deep transverse wrinkle folds around the neck (dark creases between puffy rolls) + oblique creases;
    # they bunch toward the shell, sag into the jowls and fade on the crown
    def folds(X, Y, Z):
        X, Y, Z = np.broadcast_arrays(X, Y, Z)
        d = body.d(X, Y, Z)
        near = np.abs(d) < 0.14
        if not np.any(near):
            return d
        x, y, z = X[near], Y[near], Z[near]
        s, _ = neck_param(x, y, z)
        crownm = smooth01(0.1, 0.35, z - HEAD_C[2]) * smooth01(S_HEAD - 0.2, S_HEAD + 0.2, s)
        w = (0.55 + 0.45 * smooth01(S_HEAD * 0.8, 0.2, s)) * (1 - crownm) * smooth01(S_HEAD + 0.9, S_HEAD + 0.3, s)
        ang = np.arctan2(x, z - 0.1 * s)
        ph = s * 17.0 + 1.1 * np.sin(ang * 3.0 + s * 3.0) + 0.6 * sdf.fbm(x, y, z, 2, 3.0, seed=8)
        crease = np.exp(-(np.abs(np.sin(ph)) / 0.2) ** 2)
        roll = np.abs(np.cos(ph)) ** 0.7
        ph2 = s * 29.0 + ang * 5.0
        crease2 = np.exp(-(np.abs(np.sin(ph2)) / 0.18) ** 2) * smooth01(0.3, 0.7, sdf.fbm(x, y, z, 2, 2.5, seed=12))
        out = d.copy()
        out[near] = d[near] + w * (0.055 * crease - 0.02 * roll + 0.018 * crease2)
        return out
    folded = Bounded(Func(folds, body.lo - 0.08, body.hi + 0.08), body.lo - 0.08, body.hi + 0.08)
    skin = skin_field(folded, 0.22, neck_scale, 5)
    S.add(Displace(skin, 0.008, 8.0, octaves=2, seed=3), 0.0, "skin")

    # beak: wide hooked keratin sheath overhanging the lower beak; the gape runs far back under the eye
    upper = Union(Ellipsoid(hc(0, -0.78, -0.1), V(0.41, 0.27, 0.34)),
                  RoundCone(hc(0, -0.93, -0.12), hc(0, -1.0, -0.4), 0.2, 0.08), k=0.1)
    S.add(upper, 0.07, "beak")
    S.add(Ellipsoid(hc(0, -0.66, -0.47), V(0.37, 0.31, 0.13)), 0.06, "beak")                # lower beak
    S.sub(Ellipsoid(hc(0, -0.42, -0.3), V(0.61, 0.7, 0.024)), 0.015)                        # gape line
    S.sub(Ellipsoid(hc(0, -0.93, -0.34), V(0.2, 0.12, 0.04)), 0.02)                       # gape under the hook
    for sx in (-1, 1):
        S.sub(Sphere(hc(sx * 0.11, -0.97, 0.1), 0.045), 0.015)                              # nostrils
        E = V(sx * EYE[0], EYE[1], EYE[2])
        S.sub(Sphere(E + V(-sx * 0.02, 0, 0), EYE_R + 0.05), 0.03)                          # socket
        S.add(Sphere(E, EYE_R), 0.0, "eye")                                               # eyeball
        # heavy hooded brow overhanging the eye
        S.add(Capsule(E + V(-sx * 0.1, 0.22, 0.15), E + V(-sx * 0.01, -0.2, 0.13), 0.085), 0.1, "skin")
        # heavy upper lid (covers the top third) + its fold, thinner lower lid, a crease fanning back
        S.add(Capsule(E + V(sx * 0.03, 0.13, 0.085), E + V(sx * 0.04, -0.13, 0.08), 0.085), 0.03, "skin")
        S.add(Capsule(E + V(sx * 0.0, 0.15, 0.17), E + V(sx * 0.02, -0.12, 0.165), 0.05), 0.03, "skin")
        S.add(Capsule(E + V(sx * 0.02, 0.12, -0.1), E + V(sx * 0.03, -0.12, -0.095), 0.055), 0.025, "skin")
        S.sub(Capsule(E + V(sx * 0.0, 0.2, -0.02), E + V(-sx * 0.02, 0.36, -0.05), 0.02), 0.01)
    S.paint_mat(Union(Ellipsoid(hc(0, -0.78, -0.1), V(0.43, 0.29, 0.36)), RoundCone(hc(0, -0.93, -0.12), hc(0, -1.0, -0.4), 0.22, 0.1),
                      Ellipsoid(hc(0, -0.66, -0.475), V(0.39, 0.33, 0.15)), k=0.05), "beak")
    for sx in (-1, 1):
        S.paint_mat(Sphere(V(sx * EYE[0], EYE[1], EYE[2]), EYE_R + 0.008), "eye")
    return S


# carapace front: the shell the players stand on, seen from its front quarter out in the lake (r5). The front rim
# (nuchal + marginal scutes) overhangs the neck root; bold growth-ring scutes; the dark body/plastron sits recessed.
CAR_C, CAR_R = V(0, 2.9, -0.6), V(2.8, 3.7, 2.6)
RIM_Z0, RIM_TILT = 0.74, 0.2        # rim plane: z = RIM_Z0 - RIM_TILT * y (+ scallops)
N_MARG = 11                          # marginal scutes per half


def rim_plane(X, Y, Z):
    ang = np.arctan2(np.abs(X), -(Y - CAR_C[1]))            # 0 at the front centre, pi at the back
    sc = np.abs(np.sin(ang * N_MARG * 0.5))
    return RIM_Z0 - RIM_TILT * Y + 0.05 * (1 - sc) - 0.05 + 0.1 * smooth01(0.35, 0.0, ang), ang


def rim_cells(X, Y, Z):
    """(edge distance, cell id, is marginal) for the carapace scute lattice."""
    zp, ang = rim_plane(X, Y, Z)
    h = Z - zp
    e, cid = cells(X * 0.9, Y, Z * 1.1, 1.05, 77)
    marg = h < 0.42
    seg = ang * N_MARG / np.pi
    em = np.minimum(np.abs(seg - np.round(seg)) * np.pi / N_MARG * 2.4, 0.42 - h)
    em = np.minimum(em, h + 0.02)
    e = np.where(marg, em, np.minimum(e, np.abs(h - 0.42)))
    cid = np.where(marg, (np.round(seg) * 0.137) % 1.0, cid)
    return e, cid, marg


def build_rim():
    S = Sculpt(materials=("skin", "beak", "eye", "claw"), default_mat="beak")
    ell = Ellipsoid(CAR_C, CAR_R)

    def car(X, Y, Z):
        X, Y, Z = np.broadcast_arrays(X, Y, Z)
        d = ell.d(X, Y, Z)
        zp, _ = rim_plane(X, Y, Z)
        d = sdf.smax(d, zp - Z, 0.12)
        near = np.abs(d) < 0.08
        if np.any(near):
            e, _c, marg = rim_cells(X[near], Y[near], Z[near])
            groove = 1.0 - smooth01(0.0, 0.07, e)
            dome = smooth01(0.05, 0.4, e)
            d[near] = d[near] + 0.05 * groove - 0.05 * dome
        return d
    lo, hi = CAR_C - CAR_R - 0.1, CAR_C + CAR_R + 0.1
    hi = V(hi[0], 3.6, hi[2])
    S.add(Func(car, lo, hi), 0.0, "beak")
    body = Ellipsoid(CAR_C + V(0, 0.1, -0.1), V(2.45, 3.25, 1.35))
    S.add(Displace(body, 0.03, 3.0, octaves=2, seed=5), 0.05, "skin")
    return S


def build_leg():
    """Close-range foreleg (r5): a thick scaled column bending at the wrist into a broad spade foot; big overlapping
    armour scales down the front, smooth leathery hide behind, five heavy pale hooked claws."""
    S = Sculpt(materials=("skin", "beak", "eye", "claw"), default_mat="skin")
    col = Chain([V(0, 0.05, 0.1), V(0, 0, -0.35), V(0, -0.1, -0.8), V(0, -0.16, -1.08)], [0.32, 0.29, 0.25, 0.25], squash=(0.82, 1.0), ref=(0, -1, 0), k=0.06)
    foot = Ellipsoid(V(0, -0.24, -1.17), V(0.34, 0.34, 0.12))
    body = Union(col, foot, k=0.07)

    def leg_scale(x, y, z):
        front = smooth01(0.02, -0.18, y)             # big armour scales on the front (-Y) face
        return 0.045 + 0.075 * front, 0.4 + 0.6 * front
    S.add(Displace(skin_field(body, 0.12, leg_scale, 9), 0.003, 9.0, octaves=2, seed=4), 0.0, "skin")
    for x in (-0.22, -0.11, 0.0, 0.11, 0.22):
        c = RoundCone(V(x, -0.44, -1.17), V(x * 1.3, -0.72, -1.3), 0.075, 0.02)
        S.add(c, 0.025, "claw")
        S.paint_mat(RoundCone(V(x, -0.48, -1.18), V(x * 1.3, -0.73, -1.3), 0.085, 0.028), "claw")
    return S


# ----------------------------------------------------------------------------- vertex paint
def srgb(h):
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def mix(a, b, t):
    t = np.asarray(t)[:, None] if np.ndim(t) == 1 else t
    return a * (1 - t) + b * t


def paint(ob, S, kind):
    """COLOR_0 rgb = albedo with AO + crevice darkening baked in; a = emissive mask (0.5 = amber iris glow,
    1.0 = eye catchlight)."""
    me = ob.data
    P = meshutil.get_verts(ob)
    N = pipeline.vertex_normals(ob)
    n = len(P)
    occ = np.zeros(n)
    for dk, wk in ((0.012, 0.45), (0.035, 0.35), (0.09, 0.2)):
        f = S.dist(P + N * dk)
        occ += wk * np.clip((dk - f) / dk, 0, 1)
    ao = np.clip(1.0 - occ * 1.5, 0.18, 1.0)
    crevice = np.clip((0.012 - S.dist(P + N * 0.012)) / 0.012, 0, 1)      # sharp crease darkening
    X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
    nz = N[:, 2]
    noise = sdf.fbm(X, Y, Z, 3, 6.0, seed=11)
    fine = sdf.fbm(X, Y, Z, 2, 30.0, seed=13)
    if kind == "head":
        s, _ = neck_param(X, Y, Z)
        sz, _a = neck_scale(X, Y, Z)
        head = smooth01(S_HEAD - 0.1, S_HEAD + 0.15, s)
    else:
        s = np.zeros(n)
        sz = 0.045 + 0.075 * smooth01(0.02, -0.18, Y)
        head = np.zeros(n)
    e, cid = cells(X, Y, Z, sz, 5 if kind == "head" else 9)
    seam = 1.0 - smooth01(0.0, 0.2 * sz, e)
    # leathery grey-tan hide (distinct from the olive-horn carapace): paler on the throat and under the jaw,
    # darker weathered slate on the crown plates and the leg armour
    hide = srgb("#6a6250") * (0.84 + 0.3 * noise)[:, None]
    hide = mix(hide, srgb("#a8946c"), smooth01(-0.1, -0.7, nz) * 0.8)
    plates = srgb("#4a4538") * (0.78 + 0.45 * cid)[:, None]
    platew = head * smooth01(-0.2, 0.5, nz) if kind == "head" else smooth01(0.0, -0.2, Y)
    col = mix(hide, plates, platew * 0.9)
    col = col * (1 - 0.55 * seam * (0.4 + 0.6 * platew))[:, None]
    col = col * (0.92 + 0.16 * fine)[:, None]
    col = col * (1 - 0.6 * crevice)[:, None]
    # sparse moss + pale lichen only where the hide meets the shell and on the crown (an ancient beast)
    mossn = sdf.fbm(X, Y, Z, 4, 4.0, seed=23)
    moss = smooth01(0.45, 0.9, nz) * smooth01(0.52, 0.66, mossn + 0.1 * seam)
    moss *= (smooth01(0.8, 0.2, s) + 0.5 * head) if kind == "head" else smooth01(-0.5, 0.0, Z)
    col = mix(col, srgb("#4f6a2c") * (0.8 + 0.4 * noise)[:, None], moss * 0.85)
    lich = smooth01(0.68, 0.75, sdf.fbm(X, Y, Z, 3, 9.0, seed=41)) * (1 - moss) * smooth01(-0.2, 0.5, nz)
    col = mix(col, srgb("#b3b9a0"), lich * 0.45)
    if kind == "leg":
        col = col * (1 - 0.4 * smooth01(-0.55, -0.85, Z))[:, None]
    glow = np.zeros(n)
    if "mat_id" in me.attributes:
        mid = np.zeros(n, np.float32)
        me.attributes["mat_id"].data.foreach_get("value", mid)
        beak = np.abs(mid - 1) < 0.5
        eye = np.abs(mid - 2) < 0.5
        claw = np.abs(mid - 3) < 0.5
        # beak: near-black keratin, worn pale horn toward the cutting edge and the hook tip, fine growth striations
        bk = srgb("#2a2420") * (0.8 + 0.4 * noise)[:, None]
        Zr, Yr = Z - HEAD_C[2], Y - HEAD_C[1]
        edge = np.clip(smooth01(-0.19, -0.27, Zr) + smooth01(-0.95, -1.08, Yr), 0, 1) * (Zr > -0.31)
        edge = np.maximum(edge, smooth01(-0.4, -0.33, Zr) * (Zr < -0.3))
        bk = mix(bk, srgb("#6e604a"), edge * 0.45)
        bk = bk * (0.85 + 0.3 * (0.5 + 0.5 * np.sin(Z * 110.0 + fine * 3)))[:, None]
        col[beak] = bk[beak]
        # eye: amber iris ring, round black pupil, dark limbal ring, one fixed catchlight (upper front)
        sx = np.sign(X)
        E = np.stack([sx * EYE[0], np.full(n, EYE[1]), np.full(n, EYE[2])], -1)
        o = (P - E) / np.maximum(np.linalg.norm(P - E, axis=1)[:, None], 1e-6)
        look = np.stack([sx * 0.9, np.full(n, -0.42), np.full(n, 0.05)], -1)
        look /= np.linalg.norm(look[0])
        c = np.sum(o * look, axis=1)                                        # 1 at the pupil centre
        pupil = smooth01(0.945, 0.965, c)
        iris = smooth01(0.8, 0.84, c)
        ic = mix(srgb("#e0a238") * (0.8 + 0.3 * fine)[:, None], srgb("#7a3e10"), smooth01(0.92, 0.75, c) * 0.6)
        ec = mix(srgb("#15100c"), ic, iris)
        ec = mix(ec, srgb("#050403"), pupil)
        hl = np.stack([sx * 0.62, np.full(n, -0.55), np.full(n, 0.56)], -1)
        hl /= np.linalg.norm(hl[0])
        catch = smooth01(0.985, 0.995, np.sum(o * hl, axis=1))
        ec = mix(ec, np.ones(3), catch)
        col[eye] = ec[eye]
        glow[eye] = np.maximum(iris * (1 - pupil) * 0.5, catch)[eye]
        ao[eye] = np.maximum(ao[eye], 0.75)
        # claws: pale horn, darker at the root
        ck = mix(srgb("#3a3228"), srgb("#d6c49a"), smooth01(-0.46, -0.66, Y))
        col[claw] = ck[claw]
    col = col * ao[:, None]
    meshutil.add_color_attr(ob, "Col", np.concatenate([col, glow[:, None]], axis=1).astype(np.float32))


def paint_rim(ob, S):
    """Carapace front: bold stepped growth-ring bands per scute (umber rim -> olive -> ochre -> tan -> pale core, thin
    dark growth lines), black seams, moss in the upper seams, wet dark band + barnacles at the waterline; the recessed
    body under the rim is dark wet hide."""
    me = ob.data
    P = meshutil.get_verts(ob)
    N = pipeline.vertex_normals(ob)
    n = len(P)
    occ = np.zeros(n)
    for dk, wk in ((0.03, 0.4), (0.1, 0.35), (0.3, 0.25)):
        f = S.dist(P + N * dk)
        occ += wk * np.clip((dk - f) / dk, 0, 1)
    ao = np.clip(1.0 - occ * 1.4, 0.15, 1.0)
    X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
    nz = N[:, 2]
    noise = sdf.fbm(X, Y, Z, 3, 3.0, seed=11)
    fine = sdf.fbm(X, Y, Z, 2, 18.0, seed=13)
    e, cid, marg = rim_cells(X, Y, Z)
    size = np.where(marg, 0.21, 0.42)
    t = np.clip(e / size, 0, 1)                      # 0 at the seam, 1 at the scute centre
    t = t + 0.04 * (noise - 0.5)
    stops = [(0.0, "#0a0806"), (0.06, "#2a1a0c"), (0.26, "#5f5a26"), (0.46, "#a8702a"), (0.66, "#c89a58"), (0.84, "#d8b070")]
    col = np.tile(srgb(stops[0][1]), (n, 1))
    for a, h in stops[1:]:
        col = np.where((t >= a)[:, None], srgb(h)[None, :], col)
    lines = np.exp(-((np.mod(t * 14.0, 1.0) - 0.5) / 0.09) ** 2) * (t > 0.08)
    col = col * (1 - 0.28 * lines)[:, None]
    col = col * (0.85 + 0.3 * cid)[:, None] * (0.9 + 0.2 * fine)[:, None]
    seam = 1.0 - smooth01(0.0, 0.05, e)
    mossn = sdf.fbm(X, Y, Z, 4, 2.0, seed=23)
    moss = seam * smooth01(0.2, 0.7, nz) * smooth01(0.45, 0.6, mossn) + smooth01(0.6, 0.75, mossn) * smooth01(0.6, 0.9, nz) * 0.5
    col = mix(col, srgb("#4c7a2a") * (0.8 + 0.4 * noise)[:, None], np.clip(moss, 0, 1) * 0.8)
    wet = smooth01(WATER_Z + 0.35, WATER_Z + 0.02, Z)
    col = mix(col, srgb("#16201a"), wet * 0.75)
    barn = smooth01(0.62, 0.7, sdf.fbm(X, Y, Z, 2, 14.0, seed=31)) * smooth01(WATER_Z + 0.5, WATER_Z + 0.15, Z) * smooth01(WATER_Z - 0.05, WATER_Z + 0.08, Z)
    col = mix(col, srgb("#c8c4b2"), barn * 0.8)
    if "mat_id" in me.attributes:
        mid = np.zeros(n, np.float32)
        me.attributes["mat_id"].data.foreach_get("value", mid)
        hide = np.abs(mid) < 0.5
        hc_ = srgb("#3e3a30") * (0.8 + 0.4 * noise)[:, None]
        col[hide] = hc_[hide]
    col = col * ao[:, None]
    meshutil.add_color_attr(ob, "Col", np.concatenate([col, np.zeros((n, 1))], axis=1).astype(np.float32))


def preview(objs, out):
    from lib import preview as pv
    importlib.reload(pv)
    pv.setup_workbench("VERTEX")
    views = [dict(target=(0, -2.5, 0.65), dist=4.5, yaw=-38, pitch=6, lens=60),
             dict(target=(0, 0.2, 0.5), dist=14.0, yaw=-70, pitch=6, lens=50),
             dict(target=(4.0, -0.2, -0.65), dist=3.4, yaw=-30, pitch=6, lens=50)]
    pv.render_views(out, views, res=(640, 640))


# ----------------------------------------------------------------------------- rig
BONES = [("neck_1", 1, 2), ("neck_2", 2, 3), ("neck_3", 3, 4), ("head", 5, None)]


def rig_neck(ob):
    arm_data = bpy.data.armatures.new("tortoise_rig")
    arm = bpy.data.objects.new("tortoise_rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    prev = None
    for name, a, b in BONES:
        eb = arm_data.edit_bones.new(name)
        eb.head = tuple(NECK[a])
        eb.tail = tuple(NECK[b]) if b is not None else (0.0, -2.8, 0.62)
        if prev:
            eb.parent = prev
            eb.use_connect = False
        prev = eb
    bpy.ops.object.mode_set(mode="OBJECT")
    # weights by arc length along the spine: joints at the bone heads, 0.18 unit blends
    P = meshutil.get_verts(ob)
    s, _ = neck_param(P[:, 0], P[:, 1], P[:, 2])
    cum = [0.0]
    pts = NECK + HEAD_PTS
    for i in range(len(pts) - 1):
        cum.append(cum[-1] + float(np.linalg.norm(pts[i + 1] - pts[i])))
    joints = [cum[2], cum[3], cum[5]]           # neck_1|neck_2, neck_2|neck_3, neck_3|head
    bw = 0.18
    t = [smooth01(j - bw, j + bw, s) for j in joints]
    W = [1 - t[0], t[0] * (1 - t[1]), t[1] * (1 - t[2]), t[2]]
    for (name, _, _), w in zip(BONES, W):
        meshutil.vertex_group_from_weights(ob, name, w)
    mod = ob.modifiers.new("arm", "ARMATURE")
    mod.object = arm
    ob.parent = arm
    return arm


def mesh_from(S, name, target, lo=None, hi=None, h=None):
    t0 = time.time()
    ob = pipeline.sculpt_mesh(S, name, h or H, lo, hi, attrs=True, face_mats=False)
    meshutil.decimate(ob, target, symmetry=True)
    meshutil.triangulate(ob)
    print(name, "tris", meshutil.tri_count(ob), f"{time.time() - t0:.1f}s", flush=True)
    return ob


def main():
    meshutil.clear_scene()
    Sh = build_head()
    neck = mesh_from(Sh, "tortoise_neck", 18000 if FAST else 34000, h=0.026 if FAST else 0.017)
    paint(neck, Sh, "head")
    Sl = build_leg()
    leg = mesh_from(Sl, "tortoise_leg", 8000 if FAST else 16000)
    paint(leg, Sl, "leg")
    Sr = build_rim()
    rim = mesh_from(Sr, "tortoise_rim", 12000 if FAST else 22000, h=0.05 if FAST else 0.032)
    paint_rim(rim, Sr)
    for ob in (neck, leg, rim):
        me = ob.data
        for a in list(me.attributes):
            if a.name.startswith("p_") or a.name == "mat_id":
                me.attributes.remove(a)
        for p in me.polygons:
            p.use_smooth = True
    if "--preview" in ARGV:
        leg.location = (4.0, 0, 0)
        preview([neck, leg, rim], os.path.join(ROOT, "progress", "tmp", "stage2_tortoise_preview.png"))
    arm = rig_neck(neck)
    leg.location = (4.0, 0, 0)      # side by side in the file; the stage places each node itself
    meshutil.select_only([arm, neck, leg, rim], arm)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    kw = dict(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
              export_skins=True, export_animations=False, export_texcoords=False, export_normals=True,
              export_materials="NONE", export_def_bones=False, export_rest_position_armature=True,
              export_influence_nb=4)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="ACTIVE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    print("WROTE", OUT, os.path.getsize(OUT), flush=True)


main()
