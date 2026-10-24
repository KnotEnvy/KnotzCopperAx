"""Anatomical humanoid sculpting on top of lib/sdf.py.

All shapes are authored for a reference 1.95 m heroic male (Brann) in Blender space
(Z up, facing -Y, +X = character's left) and remapped through `Frame` to any landmarks set
from lib/rig.landmarks(), so other humanoids (marauders, knights, ogres...) reuse them with
different proportions and a `style` dict:
    muscle     overall muscle mass multiplier (1 = athletic, 1.25 = barbarian)
    chest, lats, traps, waist, delts, arm, forearm, neck   per-mass multipliers (1 = default) for silhouettes:
               V-taper = lats/delts/traps > 1 with waist < 1; ogre = waist > 1; lithe = all < 1
    defin      definition strength of grooves / separations (0..1.5)
    fat        belly / softness (0..1)
    brow, jaw, scowl   head character controls (1 = default)
Every function appends ops to a Sculpt `S` and returns useful points (eye centres etc.).

Technique notes
- big masses first with generous blends (k 3-5 cm), then muscle slabs (k 1.5-3 cm), then carved
  separations (sub, k ~1 cm) and finally surface-projected details (veins, tendons, clavicles) via
  `surf_chain`, which projects a polyline onto the CURRENT surface so details never float or sink.
"""
import math
import numpy as np

from .sdf import (V, norm, basis, rot, axis_angle, Sphere, Ellipsoid, RoundCone, Capsule, RoundBox,
                  Torus, HalfSpace, Chain, Inter, Union, Diff, SymX, Offset, Shell, Displace)


def surface_hit(S, P0, d, max_dist=0.3, iters=64):
    """Sphere-trace rays from points P0 along direction d onto the sculpt surface (robust placement of
    decals/scars/straps on faces with deep concavities, where gradient projection can land on the wrong fold)."""
    P = np.array(P0, float).reshape(-1, 3)
    d = norm(np.asarray(d, float))
    t = np.zeros(len(P))
    for _ in range(iters):
        dist = S.dist(P + d * t[:, None])
        if np.all(np.abs(dist) < 2e-5):
            break
        t = np.minimum(t + np.clip(dist, -0.02, 0.02) * 0.9, max_dist)
    return P + d * t[:, None]

REF = dict(pelvis_z=1.03, neck_z=1.60, shoulder_x=0.215, height=1.95, head_h=0.245)


class Frame:
    """Maps reference-body coordinates to the target proportions (torso region)."""

    def __init__(self, L):
        p = L["P"]
        self.L = L
        self.kx = p["shoulder_x"] / REF["shoulder_x"]
        self.kd = self.kx * 0.5 + 0.5 * (p["height"] / REF["height"])
        self.z0, self.z1 = p["pelvis_z"], p["neck_z"]
        self.kz = (self.z1 - self.z0) / (REF["neck_z"] - REF["pelvis_z"])

    def __call__(self, x, y, z):
        return V(x * self.kx, y * self.kd, self.z0 + (z - REF["pelvis_z"]) * self.kz)

    def r(self, rx, ry, rz):
        return V(rx * self.kx, ry * self.kd, rz * self.kz)

    def s(self, v):
        return v * (self.kx + self.kz) * 0.5


def E(S, T, c, r, M=None, k=0.02, mat=None, sym=False, sub=False):
    """Ellipsoid in torso-reference coordinates (optionally mirrored to both sides)."""
    prim = Ellipsoid(T(*c), T.r(*r), M)
    if sym:
        prim = SymX(prim)
    (S.sub if sub else S.add)(prim, k, mat)
    return prim


def resample(pts, r=None, step=0.008):
    """Densify a polyline (Catmull-Rom through the points) so projected chains hug curved surfaces."""
    P = np.array([V(p) for p in pts], float)
    if len(P) < 2:
        return P, r
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    n = max(2, int(math.ceil(seg.sum() / step)) + 1)
    Q = np.concatenate([P[:1] * 2 - P[1:2], P, P[-1:] * 2 - P[-2:-1]])
    out = []
    ts = np.linspace(0, len(P) - 1, n)
    for t in ts:
        i = min(int(t), len(P) - 2)
        u = t - i
        p0, p1, p2, p3 = Q[i], Q[i + 1], Q[i + 2], Q[i + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
                          (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    rr = None
    if r is not None and not np.isscalar(r):
        rr = list(np.interp(ts, np.arange(len(r)), r))
    elif r is not None:
        rr = r
    return np.array(out), rr


def groove(S, pts, r, cut, k=None, taper=1.6):
    """Carve a groove of depth `cut` along a polyline projected onto the current surface.
    Smooth subtraction deepens a cut by up to k/4, so k defaults to ~1.6 x cut."""
    if k is None:
        k = 1.6 * cut
    P, _ = resample(pts)
    P = S.project(P, offset=0.0)
    P, _ = resample(P, step=0.005)
    P = S.project(P, offset=0.0)
    N = S.grad(P)
    t = np.linspace(0.0, 1.0, len(P))
    fade = np.clip(np.sin(np.pi * t) * taper, 0.0, 1.0) if taper > 0 else np.ones_like(t)
    cuts = cut * fade
    P = P + N * (r - cuts + k * 0.2)[:, None]
    S.sub(Chain(list(P), r), k)
    return P


def surf_chain(S, pts, r, depth=0.0, k=0.003, mat=None, sub=False, sym=False):
    """Project a polyline onto the current surface, sink it by `depth`, add (or carve) a tube."""
    P, r = resample(pts, r)
    P = S.project(P, offset=-depth)
    P, r = resample(P, r, step=0.006)
    P = S.project(P, offset=-depth)
    if np.isscalar(r):
        r = [r] * len(P)
    prim = Chain(list(P), r)
    if sym:
        prim = SymX(prim)
    (S.sub if sub else S.add)(prim, k, mat)
    return P


# ============================================================================ TORSO / NECK
def torso(S, L, st):
    T = Frame(L)
    m = st.get("muscle", 1.0)
    df = st.get("defin", 1.0)
    fat = st.get("fat", 0.0)
    q = lambda v: v * (0.8 + 0.2 * m)        # muscle-scaled radius
    ch, lt, tr, wa = st.get("chest", 1.0), st.get("lats", 1.0), st.get("traps", 1.0), st.get("waist", 1.0)
    # --- core masses -------------------------------------------------------------------------
    E(S, T, (0, 0.012, 1.40), (q(0.172) * ch, 0.146 * (0.6 + 0.4 * ch), 0.21), k=0.0)  # rib cage
    E(S, T, (0, 0.05, 1.47), (q(0.165) * ch, 0.112, 0.13), k=0.04)               # upper back
    E(S, T, (0, -0.004, 1.19), ((0.136 + 0.02 * fat) * wa, 0.108 + 0.03 * fat, 0.15), k=0.05)  # abdomen
    E(S, T, (0, 0.03, 1.12), (0.142 * wa, 0.095, 0.11), k=0.05)                     # waist / lower back
    E(S, T, (0, 0.016, 1.003), (0.163 * (0.5 + 0.5 * wa), 0.118, 0.108), k=0.05)    # pelvis
    E(S, T, (0.07, 0.086, 0.958), (0.086, 0.07, 0.100), M=rot(0, -8, 0), k=0.035, sym=True)  # glutes
    E(S, T, (0.10, 0.06, 1.02), (0.06, 0.06, 0.07), k=0.04, sym=True)               # glute medius
    # --- lats (V-taper) + rear armpit ---------------------------------------------------------
    S.add(SymX(RoundCone(T(0.152 + 0.03 * (lt - 1), 0.048, 1.455), T(0.088 * wa, 0.06, 1.165), T.s(q(0.082) * lt),
                         T.s(0.036), squash=(1.2, 0.74))), 0.04)
    S.add(SymX(RoundCone(T(0.135, 0.075, 1.47), T(0.195, 0.04, 1.505), T.s(q(0.044) * lt), T.s(0.04))), 0.03)
    # --- trapezius -----------------------------------------------------------------------------
    S.add(SymX(RoundCone(T(0.034, 0.05, 1.70 + 0.02 * (tr - 1)), T(0.18, 0.026, 1.598), T.s(q(0.052) * tr),
                         T.s(0.044 * tr), squash=(1.0, 0.72), ref=(0, 0, 1))), 0.05)
    E(S, T, (0.078, 0.046, 1.648 + 0.015 * (tr - 1)), (q(0.062) * tr, 0.046 * tr, 0.05 * tr), M=rot(0, -18, 0),
      k=0.04, sym=True)                                                             # upper-trap slope
    E(S, T, (0, 0.096, 1.45), (q(0.11) * tr, 0.042 * tr, 0.155), k=0.045)          # mid/lower traps
    # erectors + soft spinal groove
    S.add(SymX(RoundCone(T(0.034, 0.108, 1.30), T(0.038, 0.10, 1.06), T.s(0.032), T.s(0.036))), 0.035)
    # --- pectorals: squarish slabs, top tilted back, outer edge rising to the armpit ------------
    # dome: big ellipsoid whose front cap protrudes, clipped by a rising plane = defined lower border
    pec = Inter(Ellipsoid(T(0.072, -0.052, 1.445), T.r(q(0.098) * ch, 0.108 * (0.7 + 0.3 * ch), 0.105), rot(0, 0, 12)),
                HalfSpace(T(0, 0, 1.372), V(0.406, 0, -1.0)), k=0.014)
    S.add(SymX(pec, 0.016), 0.03)
    S.add(SymX(RoundCone(T(0.12, -0.098, 1.475), T(0.195, -0.048, 1.515), T.s(q(0.035)), T.s(0.033))), 0.022)
    # --- abdominal wall: one rectus slab, carved into blocks -----------------------------------
    S.add(Ellipsoid(T(0, -0.086, 1.20), T.r(0.082, 0.032, 0.165)), 0.05)
    for i, z in enumerate((1.31, 1.243, 1.176)):
        S.add(SymX(Ellipsoid(T(0.039, -0.112 + 0.002 * i, z), T.r(0.034 - 0.0015 * i, 0.012, 0.03))), 0.02)
    S.add(SymX(Ellipsoid(T(0.035, -0.106, 1.095), T.r(0.034, 0.013, 0.048))), 0.025)
    # --- obliques + iliac crest V ---------------------------------------------------------------
    E(S, T, (0.124, -0.034, 1.14), (0.042, 0.072, 0.085), M=rot(0, 0, 14), k=0.035, sym=True)
    S.add(SymX(RoundCone(T(0.142, -0.03, 1.085), T(0.045, -0.106, 0.975), T.s(0.024), T.s(0.016))), 0.025)
    # --- neck ---------------------------------------------------------------------------------
    nb, hb = L["neck"], L["head"]
    nr = st.get("neck", 1.0)
    S.add(RoundCone(nb + V(0, 0.004, -0.03), hb + V(0, 0.016, 0.012), 0.086 * m ** 0.5 * nr, 0.062 * nr,
                    squash=(0.88, 1.08)), 0.045)
    for sx in (1, -1):   # sternocleidomastoid (soft: reads as mass, not tubes)
        S.add(Capsule(hb + V(sx * 0.05, 0.022, 0.03), T(sx * 0.024, -0.07, 1.592), 0.0135), 0.03)
    S.add(Sphere(hb + V(0, -0.044, -0.035), 0.0095), 0.016)                           # larynx
    # nipples (subtle) + navel
    S.add(SymX(Sphere(T(0.098, -0.141, 1.422), 0.0055)), 0.006)
    S.sub(Ellipsoid(T(0, -0.13, 1.162), (0.0065, 0.01, 0.0095)), 0.007)
    return T


def torso_details(S, L, st):
    """Surface-projected details (call after arms/neck exist)."""
    T = Frame(L)
    df = st.get("defin", 1.0)
    groove(S, [T(0, 0.2, 1.40), T(0, 0.2, 1.25), T(0, 0.2, 1.06)], 0.012, 0.003 * df)             # spine
    groove(S, [T(0, -0.2, 1.52), T(0, -0.2, 1.46), T(0, -0.2, 1.385)], 0.01, 0.0022 * df)         # sternum
    groove(S, [T(0, -0.2, 1.355), T(0, -0.2, 1.2), T(0, -0.2, 1.05)], 0.005, 0.0016 * df)         # linea alba
    for z in (1.277, 1.21, 1.143):
        groove(S, [T(-0.07, -0.2, z + 0.007), T(-0.035, -0.2, z + 0.002), T(0, -0.2, z), T(0.035, -0.2, z + 0.002),
                   T(0.07, -0.2, z + 0.007)], 0.004, 0.0013 * df)
    for sx in (1, -1):
        groove(S, [T(sx * 0.025, -0.2, 1.39), T(sx * 0.09, -0.2, 1.378), T(sx * 0.15, -0.15, 1.405)], 0.007,
               0.0032 * df)                                                         # under-pec line
        groove(S, [T(sx * 0.135, -0.2, 1.06), T(sx * 0.09, -0.2, 1.01), T(sx * 0.05, -0.2, 0.968)], 0.006,
               0.0022 * df)                                                         # iliac V
        for i, z in enumerate((1.40, 1.36, 1.322)):                              # serratus fingers (subtle)
            c = T(sx * (0.158 - 0.006 * i), -0.07 + 0.004 * i, z)
            surf_chain(S, [c + V(sx * 0.010, 0.014, 0.012), c - V(sx * 0.010, 0.014, 0.012)], 0.0075,
                       depth=0.0064, k=0.008)


# ============================================================================ ARMS
def _limb_frame(a_pt, b_pt, sx):
    a = norm(b_pt - a_pt)
    fwd = V(0, -1, 0)
    f = norm(fwd - a * np.dot(fwd, a))
    up = norm(np.cross(f, a)) * sx
    if up[2] < 0:
        up = -up
    return a, f, up


def arm(S, L, side, st):
    m = st.get("muscle", 1.0)
    df = st.get("defin", 1.0)
    sx = 1 if side == "L" else -1
    sh, el, wr = L["shoulder_" + side], L["elbow_" + side], L["wrist_" + side]
    a, f, up = _limb_frame(sh, el, sx)
    Lu = np.linalg.norm(el - sh)
    at = lambda t, ff=0.0, uu=0.0: sh + a * (t * Lu) + f * ff + up * uu
    M = np.stack([a, f, up], axis=1)
    dl, am = st.get("delts", 1.0), st.get("arm", 1.0)
    q0 = lambda v: v * (0.78 + 0.22 * m)
    q = lambda v: q0(v) * am
    qd = lambda v: q0(v) * dl
    # humerus core
    S.add(RoundCone(at(-0.02), el, q(0.056), 0.046 * am), 0.03)
    # deltoid: 3 heads + cap (capped shoulders are the heroic silhouette)
    S.add(Ellipsoid(at(0.14, 0.0, 0.024 * dl), (0.10 * (0.7 + 0.3 * dl), qd(0.072), qd(0.066)), M), 0.03)
    S.add(Ellipsoid(at(0.11, -0.034 * dl, 0.012), (0.085, qd(0.05), qd(0.054)), M), 0.025)
    S.add(Ellipsoid(at(0.13, 0.038 * dl, 0.012), (0.085, qd(0.05), qd(0.054)), M), 0.025)
    S.add(Ellipsoid(at(0.04, 0.0, 0.032 * dl), (0.055, qd(0.065), 0.05 * dl), M), 0.03)
    ins = [at(0.36, -0.09, 0.0), at(0.43, -0.03, 0.06), at(0.40, 0.05, 0.06), at(0.33, 0.09, 0.0)]
    # biceps (front), triceps (back, horseshoe), brachialis (outer, near elbow)
    S.add(Ellipsoid(at(0.56, -q(0.034), -0.004), (0.14, q(0.043), q(0.042)), M), 0.022)
    S.add(Ellipsoid(at(0.42, q(0.036), 0.004), (0.17, q(0.042), q(0.046)), M), 0.025)
    S.add(Ellipsoid(at(0.35, q(0.04), 0.026), (0.11, 0.03, 0.032), M), 0.02)
    S.add(Ellipsoid(at(0.74, -0.004, 0.034), (0.085, 0.03, 0.028), M), 0.02)
    info_grooves = [(ins, 0.008, 0.0022 * df), ([at(0.42, -0.006, 0.08), at(0.62, -0.004, 0.08), at(0.80, 0.0, 0.07)],
                                                0.005, 0.0018 * df)]
    # elbow (olecranon)
    S.add(Sphere(el + f * 0.03 + up * 0.004, 0.024), 0.022)
    # --- forearm (pronated: section wider along thumb axis)
    b, fb, ub = _limb_frame(el, wr, sx)
    Lf = np.linalg.norm(wr - el)
    atf = lambda t, ff=0.0, uu=0.0: el + b * (t * Lf) + fb * ff + ub * uu
    Mf = np.stack([b, fb, ub], axis=1)
    fa = st.get("forearm", 1.0)
    qf = lambda v: q0(v) * fa
    S.add(RoundCone(el, wr, qf(0.056), 0.033 * (0.6 + 0.4 * fa), squash=(1.18, 0.8)), 0.03)
    S.add(Ellipsoid(atf(0.27, -0.012, 0.018), (0.15, qf(0.058), qf(0.046)), Mf), 0.03)
    S.add(Ellipsoid(atf(0.30, 0.02, -0.014), (0.16, qf(0.05), qf(0.044)), Mf), 0.03)
    S.add(Ellipsoid(atf(0.12, -0.03, 0.022), (0.11, 0.034 * fa, 0.031 * fa), Mf), 0.03)
    return dict(forearm_axis=b, forearm_f=fb, forearm_u=ub, at=at, atf=atf, grooves=info_grooves)


def arm_details(S, L, side, st, info):
    at, atf = info["at"], info["atf"]
    for pts, r, cut in info["grooves"]:
        groove(S, pts, r, cut)
    # veins: meandering, barely raised
    surf_chain(S, [atf(0.98, -0.02, 0.02), atf(0.8, -0.012, 0.03), atf(0.62, -0.022, 0.04),
                   atf(0.42, -0.018, 0.045), atf(0.22, -0.034, 0.04)], 0.0022, depth=0.0013, k=0.0015)
    surf_chain(S, [at(0.95, -0.05, -0.01), at(0.78, -0.07, -0.006), at(0.6, -0.08, 0.0), at(0.42, -0.07, 0.01)],
               0.002, depth=0.0012, k=0.0015)


# ============================================================================ HANDS
FINGERS = {  # b offset along thumb axis, a = knuckle distance from wrist, segment lengths, joint radii
    "index": (0.0292, 0.098, (0.044, 0.026, 0.021), (0.0112, 0.0104, 0.0094, 0.0081)),
    "middle": (0.0096, 0.101, (0.047, 0.029, 0.022), (0.0115, 0.0107, 0.0096, 0.0083)),
    "ring": (-0.0106, 0.098, (0.045, 0.027, 0.021), (0.011, 0.0102, 0.0092, 0.0079)),
    "little": (-0.0292, 0.090, (0.035, 0.021, 0.019), (0.0098, 0.009, 0.0082, 0.0071)),
}
RELAXED = {"index": (18, 32, 16, 3), "middle": (22, 38, 18, 0), "ring": (26, 42, 20, -3), "little": (30, 46, 22, -7)}


def _wrap_joints(mcp, C, Rw, lens):
    """(a,c) plane: first phalanx reaches the wrap circle on its distal side, the rest walk around it."""
    mcp = np.asarray(mcp, float)
    C = np.asarray(C, float)
    l1 = lens[0]
    sol = None
    for deg in np.linspace(-10, 180, 1901):
        th = math.radians(deg)
        p = mcp + l1 * np.array([math.cos(th), math.sin(th)])
        if np.linalg.norm(p - C) <= Rw:
            sol = mcp + l1 * np.array([math.cos(math.radians(deg - 0.1)), math.sin(math.radians(deg - 0.1))])
            break
    if sol is None:   # unreachable: aim at the circle's distal tangent
        sol = C + Rw * norm(mcp - C + np.array([Rw, 0]))
    pts = [mcp, sol]
    ang = math.atan2(sol[1] - C[1], sol[0] - C[0])
    for l in lens[1:]:
        ang += 2 * math.asin(min(0.999, l / (2 * Rw)))
        pts.append(C + Rw * np.array([math.cos(ang), math.sin(ang)]))
    return pts


def hand(S, L, side, pose="relaxed", st=None, grip_r=0.0165):
    """Hand with 4 fingers + thumb. pose: 'relaxed' | 'grip' (power grip around the socket_hand axis)."""
    st = st or {}
    sc = L["P"]["hand"] / 0.20
    W = L["wrist_" + side]
    h, t, n = L["hand_h_" + side], L["hand_t_" + side], L["hand_n_" + side]
    P = lambda a, b, c: W + h * (a * sc) + t * (b * sc) + n * (c * sc)
    M = np.stack([h, t, n], axis=1)
    info = {"nails": [], "fingers": {}}
    # palm, heel, thenar, hypothenar, dorsum
    S.add(RoundBox(P(0.056, 0.0, 0.0015), V(0.046, 0.043, 0.0135) * sc, M, r=0.012 * sc), 0.012)
    S.add(Ellipsoid(P(0.016, 0.0, 0.0), V(0.028, 0.035, 0.017) * sc, M), 0.016)
    S.add(Ellipsoid(P(0.040, 0.027, 0.012), V(0.031, 0.018, 0.016) * sc, basis(h * 0.8 + t * 0.6, n)), 0.012)
    S.add(Ellipsoid(P(0.050, -0.034, 0.010), V(0.037, 0.013, 0.013) * sc, M), 0.012)
    S.add(Ellipsoid(P(0.062, 0.0, -0.007), V(0.046, 0.039, 0.0085) * sc, M), 0.012)
    grip_c = None
    if pose == "grip":
        g = L["grip_" + side]
        grip_c = (float(np.dot(g - W, h)) / sc, float(np.dot(g - W, n)) / sc)
    for nm, (b0, a0, lens, rads) in FINGERS.items():
        mcp_ac = (a0, -0.003)
        if pose == "grip":
            Rw = (grip_r / sc) + rads[1] * 1.02
            pts2 = _wrap_joints(mcp_ac, grip_c, Rw, lens)
            pts = [P(p[0], b0 * (1 - 0.05 * i), p[1]) for i, p in enumerate(pts2)]
        else:
            fm, fp, fd, spread = RELAXED[nm]
            ang = 0.0
            cur = np.array(mcp_ac, float)
            bdir = math.radians(spread)
            pts = [P(cur[0], b0, cur[1])]
            bb = b0
            for l, fl in zip(lens, (fm, fp, fd)):
                ang += math.radians(fl)
                step = np.array([math.cos(ang), math.sin(ang)]) * l
                cur = cur + step * math.cos(bdir)
                bb += l * math.sin(bdir)
                pts.append(P(cur[0], bb, cur[1]))
        r = [x * sc for x in rads]
        S.add(Chain(pts, r), 0.003)
        S.add(Sphere(pts[0] + h * 0.002 * sc - n * 0.0025 * sc, rads[0] * 0.92 * sc), 0.006)   # knuckle
        info["fingers"][nm] = pts
        # fingernail on the distal phalanx (dorsal side)
        dd = norm(pts[3] - pts[2])
        nd = norm(np.cross(t, dd))
        if np.dot(nd, -n) + 0.5 * np.dot(nd, -dd) < 0 and pose != "grip":
            nd = -nd
        if pose == "grip":
            # dorsal side of a curled distal segment = away from the grip centre
            gc = W + h * (grip_c[0] * sc) + n * (grip_c[1] * sc)
            mid = (pts[2] + pts[3]) * 0.5
            outv = mid - gc
            outv = outv - t * np.dot(outv, t)
            nd = norm(outv - dd * np.dot(outv, dd))
        nc = pts[2] + dd * (lens[2] * sc * 0.62) + nd * (rads[3] * sc * 0.80)
        S.add(Ellipsoid(nc, V(0.0088, 0.0066, 0.0021) * sc * (rads[3] / 0.0074), basis(dd, t)), 0.0016, mat="nail")
        info["nails"].append(nc)
    # thumb
    if pose == "grip":
        tj = [P(0.020, 0.027, 0.011), P(0.050, 0.047, 0.033), P(0.064, 0.041, 0.060), P(0.081, 0.031, 0.075)]
    else:
        tj = [P(0.020, 0.029, 0.009), P(0.055, 0.051, 0.021), P(0.083, 0.062, 0.024), P(0.106, 0.065, 0.022)]
    S.add(Chain(tj, [0.0142 * sc, 0.0124 * sc, 0.0112 * sc, 0.0094 * sc]), 0.006)
    S.add(Ellipsoid(tj[0] + (tj[1] - tj[0]) * 0.55 + n * 0.004, V(0.025, 0.015, 0.014) * sc,
                    basis(tj[1] - tj[0], n)), 0.01)
    dd = norm(tj[3] - tj[2])
    if pose == "grip":
        gc = W + h * (grip_c[0] * sc) + n * (grip_c[1] * sc)
        outv = (tj[2] + tj[3]) * 0.5 - gc
        nd = norm(outv - dd * np.dot(outv, dd))
    else:
        nd = norm(-n - dd * np.dot(-n, dd))
    nc = tj[2] + dd * 0.017 * sc + nd * 0.0074 * sc
    S.add(Ellipsoid(nc, V(0.0098, 0.0078, 0.0022) * sc, basis(dd, np.cross(nd, dd))), 0.0016, mat="nail")
    info["nails"].append(nc)
    info["thumb"] = tj
    if pose == "grip":
        g = L["grip_" + side]
        S.sub(Capsule(g - t * 0.09, g + t * 0.09, grip_r * 0.97), 0.0015)
    return info


def hand_details(S, L, side):
    sc = L["P"]["hand"] / 0.20
    W = L["wrist_" + side]
    h, t, n = L["hand_h_" + side], L["hand_t_" + side], L["hand_n_" + side]
    P = lambda a, b, c: W + h * (a * sc) + t * (b * sc) + n * (c * sc)
    for nm in ("index", "middle", "ring", "little"):     # extensor tendons: only near the knuckles
        b0, a0 = FINGERS[nm][0], FINGERS[nm][1]
        surf_chain(S, [P(a0 - 0.045, b0 * 0.8, -0.02), P(a0 - 0.012, b0, -0.02)],
                   0.0018 * sc, depth=0.0016, k=0.0012)


# ============================================================================ LEGS
def leg(S, L, side, st):
    m = st.get("muscle", 1.0)
    df = st.get("defin", 1.0)
    sx = 1 if side == "L" else -1
    hp, kn, an = L["hip_" + side], L["knee_" + side], L["ankle_" + side]
    a = norm(kn - hp)
    fwd = V(0, -1, 0)
    f = norm(fwd - a * np.dot(fwd, a))
    lat = norm(np.cross(a, f))
    if lat[0] * sx < 0:
        lat = -lat
    Lt = np.linalg.norm(kn - hp)
    at = lambda t, ff=0.0, ll=0.0: hp + a * (t * Lt) + f * ff + lat * ll
    M = np.stack([a, f, lat], axis=1)
    q = lambda v: v * (0.78 + 0.22 * m)
    # thigh core + quads + hamstrings + adductors
    S.add(RoundCone(at(-0.06, 0.0, 0.014), kn + a * -0.02, q(0.106), 0.064), 0.05)
    S.add(Ellipsoid(at(0.45, -0.02, q(0.056)), (0.26, q(0.07), q(0.062)), M), 0.035)       # vastus lateralis
    S.add(Ellipsoid(at(0.80, -0.035, -q(0.04)), (0.125, q(0.054), q(0.054)), M), 0.03)       # vastus medialis
    S.add(Ellipsoid(at(0.42, -q(0.052), 0.0), (0.27, q(0.048), q(0.052)), M), 0.035)       # rectus femoris
    S.add(Ellipsoid(at(0.24, 0.012, -q(0.056)), (0.22, 0.062, q(0.055)), M), 0.04)          # adductors
    S.add(Ellipsoid(at(0.52, q(0.055), 0.0), (0.28, q(0.056), q(0.058)), M), 0.04)         # hamstrings
    # knee: patella + condyles
    S.add(Ellipsoid(kn + f * 0.048 + a * -0.012, (0.026, 0.018, 0.031), basis(a, f)), 0.016)
    S.add(Sphere(kn + lat * 0.032 + f * 0.012, 0.036), 0.03)
    S.add(Sphere(kn - lat * 0.032 + f * 0.012, 0.038), 0.03)
    # shin + calf
    b = norm(an - kn)
    fb = norm(fwd - b * np.dot(fwd, b))
    latb = norm(np.cross(b, fb))
    if latb[0] * sx < 0:
        latb = -latb
    Ls = np.linalg.norm(an - kn)
    ats = lambda t, ff=0.0, ll=0.0: kn + b * (t * Ls) + fb * ff + latb * ll
    Ms = np.stack([b, fb, latb], axis=1)
    S.add(RoundCone(kn, an, 0.056, 0.038), 0.03)
    S.add(Ellipsoid(ats(0.30, 0.040, -0.02), (0.14, q(0.048), q(0.04)), Ms), 0.03)          # gastroc medial
    S.add(Ellipsoid(ats(0.27, 0.037, 0.022), (0.13, q(0.042), q(0.036)), Ms), 0.03)         # gastroc lateral
    S.add(Ellipsoid(ats(0.25, -0.028, 0.022), (0.19, 0.026, 0.024), Ms), 0.03)              # tibialis
    groove(S, [at(0.22, 0.2, 0.05), at(0.52, 0.2, 0.05), at(0.84, 0.2, 0.034)], 0.007, 0.0022 * df)
    groove(S, [at(0.35, 0.2, -0.05), at(0.6, 0.2, -0.05), at(0.84, 0.2, -0.04)], 0.006, 0.0018 * df)
    return dict(ats=ats, b=b, fb=fb, latb=latb, Ls=Ls, at=at)


def separate_legs(S, L, top_z, gap=0.010, k=0.003):
    """Guarantee the two legs are separate surfaces below `top_z` (keep it under a kilt/skirt/tabard): bulky
    inner thighs, knees or boot trims otherwise fuse in the SDF, and one fused triangle between the legs tears
    into a sheet in every run/kick/split. Call last, after boots and trims."""
    S.sub(RoundBox(V(0, 0, top_z * 0.5 - 0.02), V(gap * 0.5, 0.35, top_z * 0.5 + 0.02), r=gap * 0.25), k)


def foot(S, L, side):
    an, ball, toe = L["ankle_" + side], L["ball_" + side], L["toe_" + side]
    S.add(RoundCone(an, an + V(0, 0.035, -0.06), 0.036, 0.032), 0.02)
    S.add(RoundCone(an + V(0, 0.0, -0.045), ball, 0.032, 0.024, squash=(1.0, 1.35), ref=(0, 0, 1)), 0.02)
    S.add(RoundCone(ball, toe, 0.024, 0.018, squash=(1.0, 1.5), ref=(0, 0, 1)), 0.01)


# ============================================================================ HEAD
class HeadFrame:
    def __init__(self, L):
        p = L["P"]
        self.s = p["head_h"] / REF["head_h"]
        # enemies-art-3 (additive): optional P["head_dy"] shifts the head along Y (-Y = forward; ogre hunch)
        self.c = V(0, 0.012 + p.get("head_dy", 0.0), p["height"] - 0.102 * self.s)

    def __call__(self, x, y, z):
        return self.c + V(x, y, z) * self.s

    def r(self, *r):
        return V(*r) * self.s


HEAD_STYLE = dict(brow=1.0, jaw=1.0, scowl=1.0, cheek=1.0, chin=1.0, nose_len=1.0, nose_w=1.0, nose_bump=1.0,
                  lip=1.0, mouth_w=1.0, eye=1.0, squint=1.0, skull_w=1.0, skull_h=1.0, ear=1.0, fem=0.0)


def head(S, L, st):
    """Parametric heroic head (Blender space, faces -Y). Built the way a sculptor blocks a bust: skull and
    face planes first, then the brow bar, sockets with real eyeballs + lids, nose, muzzle and lips, jaw, ears.
    style keys (1 = heroic male default, see HEAD_STYLE): brow (ridge mass), jaw (width/squareness), scowl
    (inner-brow drop + lid tilt), cheek, chin, nose_len, nose_w, nose_bump (broken bridge), lip (fullness),
    mouth_w, eye (eyeball size), squint (lid closure), skull_w, skull_h, ear, fem (0..1 softens everything:
    smaller brow/jaw/nose, fuller lips, bigger eyes). Returns dict(H, eyes, eye_r, eye_fwd)."""
    g = dict(HEAD_STYLE)
    g.update({k: v for k, v in st.items() if k in HEAD_STYLE})
    fem = g["fem"]
    brow = g["brow"] * (1 - 0.55 * fem)
    jaw = g["jaw"] * (1 - 0.12 * fem)
    scowl = g["scowl"] * (1 - 0.7 * fem)
    cheek, chin, lip = g["cheek"], g["chin"] * (1 - 0.25 * fem), g["lip"] * (1 + 0.35 * fem)
    nl, nw, sq = g["nose_len"] * (1 - 0.1 * fem), g["nose_w"] * (1 - 0.2 * fem), g["squint"] * (1 - 0.6 * fem)
    mw = g["mouth_w"]
    H = HeadFrame(L)
    s = H.s
    sw, sh = g["skull_w"], g["skull_h"]
    # ---------------------------------------------------------------- skull
    S.add(Ellipsoid(H(0, 0.016, 0.0), H.r(0.077 * sw, 0.100, 0.093 * sh)), 0.0)
    S.add(Ellipsoid(H(0, 0.058, -0.028), H.r(0.066 * sw, 0.058, 0.066)), 0.03)            # occiput
    S.add(Ellipsoid(H(0, -0.050, 0.030), H.r(0.066 * sw, 0.040, 0.056 * sh)), 0.03)       # forehead
    for sx in (1, -1):
        S.sub(Ellipsoid(H(sx * 0.087 * sw, -0.034, 0.014), H.r(0.008, 0.022, 0.022)), 0.018)   # temples
    # ---------------------------------------------------------------- face planes
    S.add(Ellipsoid(H(0, -0.048, -0.050), H.r(0.060, 0.050, 0.060)), 0.028)                # maxilla / midface
    S.add(Ellipsoid(H(0, -0.044, -0.095), H.r(0.039 * jaw, 0.044, 0.037)), 0.022)           # lower face mass
    for sx in (1, -1):
        # mandible: ramus (below the ear) -> gonion (square corner) -> jaw line -> chin corner
        S.add(Chain([H(sx * 0.063, 0.018, -0.052), H(sx * 0.058 * jaw, 0.008, -0.104),
                     H(sx * 0.042 * jaw, -0.044, -0.124), H(sx * 0.022 * chin, -0.078, -0.134)],
                    [0.0090 * s, 0.0098 * s, 0.0090 * s, 0.0100 * s]), 0.014)
        S.add(Ellipsoid(H(sx * 0.051 * jaw, -0.014, -0.082), H.r(0.0080, 0.018, 0.023)), 0.014)  # masseter
        # cheekbones: high, wide, with the zygomatic arch running back to the ear
        S.add(Ellipsoid(H(sx * 0.052 * cheek, -0.062, -0.031), H.r(0.022, 0.016, 0.0125), rot(0, 0, sx * 24)), 0.011)
        S.add(RoundCone(H(sx * 0.058 * cheek, -0.056, -0.028), H(sx * 0.071, -0.008, -0.036), 0.0085 * s, 0.0065 * s),
              0.016)
        # buccal hollow under the cheekbone (lean, hard face)
        S.sub(Ellipsoid(H(sx * 0.055, -0.062, -0.070), H.r(0.011, 0.009, 0.014)), 0.018)
    S.add(RoundBox(H(0, -0.084, -0.1255), H.r(0.023 * chin, 0.0145, 0.0150), r=0.0105 * s), 0.013)  # square chin
    S.sub(Ellipsoid(H(0, -0.0990, -0.1255), H.r(0.0032, 0.0016, 0.0050)), 0.006)                 # soft cleft
    # ---------------------------------------------------------------- brow bar (heavy, casts the sockets in shade)
    by = 0.005 * (brow - 1)
    dz = 0.0035 * scowl
    S.add(Chain([H(-0.061, -0.072, 0.005), H(-0.034, -0.087 - by, 0.001), H(-0.012, -0.092 - by, -0.002 - dz),
                 H(0, -0.093 - by, -0.004 - dz), H(0.012, -0.092 - by, -0.002 - dz), H(0.034, -0.087 - by, 0.001),
                 H(0.061, -0.072, 0.005)],
                [0.008 * s, 0.012 * s * brow, 0.011 * s * brow, 0.0105 * s, 0.011 * s * brow, 0.012 * s * brow,
                 0.008 * s]), 0.012)
    for sx in (1, -1):   # procerus / corrugator knots of the scowl
        S.add(Ellipsoid(H(sx * 0.011, -0.100 - by, -0.006 - dz), H.r(0.008, 0.004, 0.005)), 0.006)
    # ---------------------------------------------------------------- eyes: sockets, eyeballs, lids
    eye_r = 0.0118 * s * g["eye"] * (1 + 0.08 * fem)
    eyes = []
    for sx in (1, -1):
        ec = H(sx * 0.0325, -0.0606, -0.0240)       # r2b: 1.6 mm deeper-set (eyes read proud/goggly)
        S.sub(Ellipsoid(H(sx * 0.0335, -0.080, -0.0225), H.r(0.0185, 0.017, 0.013)), 0.008 * s)   # socket
        S.add(Sphere(ec, eye_r), 0.0, mat="eye")
        S.add(Sphere(ec + V(0, -0.0068, 0) * s, 0.0072 * s * g["eye"]), 0.0012, mat="eye")          # cornea bulge
        eyes.append(ec)
    for sx, ec in zip((1, -1), eyes):
        tilt = 7.0 * scowl
        lid_t = 0.0017 * s
        # lids = a skin shell over the whole eyeball, opened by an almond aperture (outer corner a touch higher);
        # the scowl/squint plane lowers the upper lid over the top of the iris
        open_up = (0.0034 - 0.0024 * (sq - 1)) * s
        nU = rot(-16, sx * -tilt, 0) @ V(0, 0, -1)
        # aperture narrower than the eyeball and shallow in depth: it must not wrap round the sides of the ball
        # (r2: a 0.013-wide x 0.024-deep aperture opened the whole silhouette = round goggle eyes)
        ap = Ellipsoid(ec + V(0, -eye_r, 0.0003) * s, H.r(0.0122 * g["eye"], 0.018,
                                                           0.0050 * g["eye"] * (1.25 - 0.28 * sq)),
                       rot(0, sx * -6.0, 0))
        aperture = Inter(ap, HalfSpace(ec + V(0, 0, open_up), -nU))
        # mat='skin' is REQUIRED: an add with mat=None keeps the previous winner, and every lid point was 'eye'
        # after the eyeball op -> the whole lid shell rendered as sclera (r1/r2 'goggle' eyes)
        S.add(Diff(Sphere(ec, eye_r + lid_t), aperture), 0.0012, mat="skin")
        # hooded fold above the upper lid (tucked under the brow) and a soft lower-lid rim
        S.add(Inter(Sphere(ec + V(0, -0.0004, 0.0022) * s, eye_r + 0.0034 * s),
                    HalfSpace(ec + V(0, 0, open_up + 0.0046 * s), nU)), 0.0028, mat="skin")
        nD = rot(14, sx * tilt * 0.4, 0) @ V(0, 0, 1)
        S.add(Inter(Sphere(ec, eye_r + lid_t + 0.0004 * s), HalfSpace(ec + V(0, 0, -0.0068 * s), nD)), 0.0016,
              mat="skin")
        S.add(Ellipsoid(ec + V(0, -0.0048, -0.0128) * s, H.r(0.0090, 0.0018, 0.0022)), 0.005, mat="skin")  # under-eye
        S.add(Sphere(ec + V(-sx * 0.0128, -0.0030, -0.0014) * s, 0.0022 * s), 0.002, mat="skin")    # inner canthus
    # ---------------------------------------------------------------- nose (strong, straight, slightly broken)
    dzn = 0.032 * (1.0 - nl)            # nose_len < 1 lifts the tip / alae / nostrils (shorter nose)
    dzm = 0.75 * dzn                    # ... and the mouth follows most of the way (no long upper lip)

    def Hn(x, y, z):
        return H(x, y, z + dzn)

    def Hm(x, y, z):
        return H(x, y, z + dzm)
    tip = Hn(0, -0.1070 - 0.004 * (nl - 1), -0.070)
    # nasion: a clear dip between the brow bar and the bridge (a flat brow-to-tip bridge read as a long nose)
    S.sub(Ellipsoid(H(0, -0.0975, -0.0125), H.r(0.0115, 0.0045, 0.0075)), 0.008)
    S.add(RoundCone(H(0, -0.0885, -0.0195), tip + V(0, 0.0045, 0.0062) * s, 0.0074 * s * nw, 0.0092 * s * nw), 0.008)
    S.add(Sphere(Hn(0.0012, -0.0975, -0.0335), 0.0064 * s * g["nose_bump"]), 0.008)
    S.add(Sphere(tip, 0.0088 * s * (0.9 + 0.1 * nw)), 0.006)
    for sx in (1, -1):                  # domal tip-defining points: a shaped tip instead of a ball
        S.add(Sphere(tip + V(sx * 0.0040, -0.0020, -0.0004) * s, 0.0060 * s), 0.004)
    for sx in (1, -1):
        S.add(Ellipsoid(Hn(sx * 0.0100 * nw, -0.093, -0.050), H.r(0.0052, 0.011, 0.017)), 0.009)      # side walls
        ala = Hn(sx * 0.0160 * nw, -0.0945, -0.0765)
        S.add(Sphere(ala, 0.0066 * s * nw), 0.006)                                                  # alar wings
        S.sub(Capsule(ala + V(sx * 0.006, 0.001, 0.007) * s, ala + V(sx * 0.0085, 0.004, -0.004) * s, 0.0011 * s),
              0.002 * s)                                                                             # alar crease
        # nostrils open DOWNWARD (invisible from the front)
        S.sub(Ellipsoid(Hn(sx * 0.0080 * nw, -0.0985, -0.0845), H.r(0.0040, 0.0058, 0.0022), rot(-12, 0, sx * 18)),
              0.0014)
    # nasolabial folds
    for sx in (1, -1):
        S.add(RoundCone(Hn(sx * 0.0250, -0.0880, -0.074), Hm(sx * 0.0295, -0.0815, -0.1040), 0.0026 * s, 0.0020 * s),
              0.014)
    # ---------------------------------------------------------------- mouth: muzzle, bowed upper lip, full lower lip
    S.add(Ellipsoid(Hm(0, -0.0775, -0.1015), H.r(0.029 * mw, 0.0165, 0.024)), 0.02)
    uw = 0.0235 * mw
    for sx in (1, -1):
        S.add(Ellipsoid(Hm(sx * 0.0098 * mw, -0.0966, -0.0998), H.r(0.0128 * mw, 0.0044 * lip ** 0.5,
                                                                          0.0038 * lip ** 0.5),
                        rot(0, sx * 10, sx * -8)), 0.003)                                        # upper lip halves
        S.add(Ellipsoid(Hm(sx * 0.0085 * mw, -0.0950, -0.1076), H.r(0.0105 * mw, 0.0056 * lip, 0.0050 * lip),
                        rot(0, sx * -8, sx * 12)), 0.004)                                         # lower lip halves
        S.sub(Sphere(Hm(sx * (uw + 0.0004), -0.0910, -0.1044), 0.0015 * s), 0.0035)                   # corners
        S.add(Sphere(Hm(sx * (uw + 0.0036), -0.0868, -0.1050), 0.0026 * s), 0.008)                   # modiolus
    S.sub(Ellipsoid(Hm(0, -0.1000, -0.0928), H.r(0.0034, 0.0020, 0.0058)), 0.004)                 # philtrum groove
    S.add(Sphere(Hm(0, -0.0994, -0.1003), 0.0024 * s * lip), 0.004)                               # tubercle
    S.add(Ellipsoid(Hm(0, -0.0958, -0.1080), H.r(0.0110 * mw, 0.0058 * lip, 0.0054 * lip)), 0.004)   # lower lip
    S.sub(Chain([Hm(-uw + 0.0015, -0.0915, -0.1047), Hm(-0.012, -0.0994, -0.1037), Hm(0, -0.1022, -0.1034),
                 Hm(0.012, -0.0994, -0.1037), Hm(uw - 0.0015, -0.0915, -0.1047)], 0.0009 * s), 0.0010 * s)
    S.sub(Chain([Hm(-0.011, -0.0955, -0.1172), Hm(0, -0.0975, -0.1168), Hm(0.011, -0.0955, -0.1172)], 0.0022 * s),
          0.008 * s)                                                                                   # sulcus
    # ---------------------------------------------------------------- ears
    es = g["ear"]
    for sx in (1, -1):
        ear_c = H(sx * 0.079, 0.013, -0.033)
        Mear = rot(-14, 0, sx * -14)
        S.add(Ellipsoid(ear_c, H.r(0.011, 0.020 * es, 0.030 * es), Mear), 0.004)
        S.add(Torus(ear_c + V(sx * 0.003, 0, 0.002) * s, 0.0162 * s * es, 0.0036 * s,
                    basis(V(sx * 1, 0, 0), V(0, 0, 1))[:, [1, 2, 0]]), 0.002)
        S.sub(Ellipsoid(ear_c + V(sx * 0.0085, -0.002, -0.004) * s, H.r(0.005, 0.011, 0.014), Mear), 0.003)
        S.add(Sphere(ear_c + V(sx * 0.0015, -0.0105, -0.012) * s, 0.0046 * s), 0.003)                  # tragus
        S.add(Sphere(ear_c + V(sx * 0.001, -0.002, -0.028) * s, 0.0066 * s), 0.004)                    # lobe
    return dict(H=H, eyes=eyes, eye_r=eye_r, eye_fwd=(0.0, -1.0, 0.0), nose_dz=dzn, mouth_dz=dzm, lip=lip, mouth_w=mw)


def eyebrows(S, H, sx_list=(1, -1), scowl=1.0, thick=1.0):
    """Sculpted hair-mass brows on the brow ridge (material 'brow'): thick at the head, tapering."""
    out = []
    for sx in sx_list:
        raw = np.array([H(sx * 0.008, -0.103, -0.006 - 0.002 * scowl), H(sx * 0.02, -0.103, 0.0),
                        H(sx * 0.034, -0.099, 0.006), H(sx * 0.047, -0.091, 0.008), H(sx * 0.059, -0.078, 0.006)])
        pts = S.project(raw, offset=-0.0011)
        rr = np.array([0.0040, 0.0050, 0.0047, 0.0036, 0.0020]) * thick * H.s
        S.add(Chain(list(pts), list(rr), squash=(0.34, 1.0), ref=(0, -1, 0)), 0.0016, mat="brow")
        S.paint(Chain(list(pts), list(rr * 1.35)), "browpaint", soft=0.0022)
        out.append(pts)
    return out
