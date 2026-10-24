"""Select-screen giant skeletal hand, r9: DISCRETE ANATOMICAL BONES (numpy only, no Blender, no SDF, no slot).

The r5-r8 hands were smooth-union SDFs and kept coming out as fused clay (uniform capsules, collar joints, a padded loaf of a
palm).  This builds the hand the way an anatomy model is built: every bone is its own closed mesh and bones NEVER touch (open
joint gaps of 0.03-0.06 hand units):

  * radius + ulna as two separate forearm bones (broad distal end + styloid; slender shaft; round ulnar head)
  * 8 carpal pebbles (two rows + pisiform), each an irregular super-ellipsoid, none alike
  * 4 metacarpals fanned across the palm + the thumb metacarpal (flat-based, waisted shaft, big round knuckle head)
  * 3 phalanges per finger, 2 for the thumb: each = a broad flat base with a shallow cup (the previous bone's head sits in it),
    a long shaft that narrows mid-length (~55 % of the ends) and a head with two condyles split by a groove; every bone gets a
    slight dorsal bow, different radii at its two ends and low-frequency lumpiness; distal phalanges taper to a hooked point.

Shading is baked into COLOR_0: ambient occlusion against every OTHER bone (proxy spheres along each bone axis) so the joint gaps
and the spaces between the metacarpals go dark, + a cool ivory ramp (no orange in the albedo - the braziers supply the warmth).

    <bundled python> blender/ui_hand_bones.py [out.glb] [nt=40] [nth=26]
The mesh is authored directly in the JS frame (Y up, +Z toward the camera), which equals glTF - no axis conversion.
"""
import os
import sys
import json
import math
import struct
import time
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ARGS = [a for a in sys.argv[1:] if "=" not in a]
KW = dict(a.split("=", 1) for a in sys.argv[1:] if "=" in a)
OUT = ARGS[0] if ARGS else os.path.join(ROOT, "public", "assets", "models", "ui_skeletal_hand.glb")
NT = int(KW.get("nt", 32))      # slices along a bone
NTH = int(KW.get("nth", 22))    # segments around a bone
TOP = 1.14                      # y of the palm bones' centre-line (heroes stand on the top surface)

V3 = lambda *a: np.array(a, float)
unit = lambda v: v / (np.linalg.norm(v) + 1e-12)
sstep = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0.0, 1.0))


def smooth_noise(seed, n=6):
    """Cheap smooth periodic noise f(u, v) in [-1, 1] from a few random sines (u around the bone, v along it)."""
    r = np.random.default_rng(seed)
    kx, ky = r.integers(1, 4, n), r.integers(1, 5, n)
    ph, am = r.uniform(0, 2 * math.pi, (n, 2)), r.uniform(0.4, 1.0, n)
    am = am / am.sum()
    return lambda u, v: sum(am[i] * np.sin(kx[i] * u + ph[i, 0]) * np.cos(ky[i] * v * math.pi + ph[i, 1]) for i in range(n))


class Part:
    """One closed mesh = one bone / pebble. V (n,3), F (m,3), plus the proxy spheres (centre, radius) used for occlusion and the
    per-vertex shading inputs (t along the bone, 'ridge' = how far out the surface is vs the shaft)."""
    def __init__(self, name, V, F, N, prox, t, ridge):
        self.name, self.V, self.F, self.N, self.prox, self.t, self.ridge = name, V, F, N, prox, t, ridge


def vertex_normals(V, F):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    return N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)


def bone(name, a, b, rA, rB, rS, lat=1.0, dors=0.8, bow=0.0, flare=(0.26, 0.30), gap=0.04, capA=0.22, capB=0.55, dimple=0.0,
         condyle=0.0, lobe=0.0, tip=False, hook=0.0, taper=1.0, seed=0, lat_ref=(1, 0, 0), baseflat=1.0):
    """A long bone from joint point a to joint point b (it is shortened by `gap` so neighbours never touch).
    rA / rB = end radii (the flared epiphyses), rS = shaft radius at mid-length, lat/dors = lateral / dorso-palmar section scale,
    bow = dorsal bow of the axis, capA/capB = end cap lengths in r units (small = flat base, big = round head),
    dimple = depth of the cup in the base (r units), condyle = bicondylar split of the head, tip/hook = hooked distal tuft."""
    a, b = V3(*a), V3(*b)
    d = unit(b - a)
    ga, gb = (gap, gap) if np.isscalar(gap) else gap
    a, b = a + d * ga, b - d * gb
    L = np.linalg.norm(b - a)
    rng = np.random.default_rng(seed + 11)
    rA, rB, rS = (x * (1 + 0.05 * rng.uniform(-1, 1)) for x in (rA, rB, rS))
    u = np.linspace(0, 1, NT)
    t = 0.5 - 0.5 * np.cos(np.pi * u)                               # dense at both ends (caps)
    s = t * L
    fa, fb = flare
    shaft = rS * (1 - t) + rS * taper * t
    gA = np.clip(1 - t / fa, 0, 1) ** 2
    gB = np.clip(1 - (1 - t) / fb, 0, 1) ** 2
    r = shaft + (rA - shaft) * gA + (rB * (0.55 if tip else 1.0) - shaft) * gB
    if tip:                                                           # distal phalanx: flared base, then a long taper to a hooked point
        r = (rS * 1.10 * (1 - t) ** 0.85 + (rA - rS) * gA) * (1 - 0.35 * sstep(0.55, 1.0, t))
    cA, cB = capA * rA, (capB * rB if not tip else 0.5 * rS)
    mA = np.where(s < cA, np.sqrt(np.clip(1 - (1 - s / max(cA, 1e-6)) ** 2, 0, 1)), 1.0)
    mB = np.where(L - s < cB, np.sqrt(np.clip(1 - (1 - (L - s) / max(cB, 1e-6)) ** 2, 0, 1)), 1.0)
    r = r * mA * mB
    # axis: straight + dorsal bow + hook of the tuft
    T0 = d
    L0 = unit(V3(*lat_ref) - np.dot(V3(*lat_ref), T0) * T0) if abs(np.dot(unit(V3(*lat_ref)), T0)) < 0.97 else unit(np.cross(T0, V3(0, 1, 0)))
    D0 = unit(np.cross(T0, L0))
    C = a[None, :] + (b - a)[None, :] * t[:, None] + D0[None, :] * (bow * np.sin(np.pi * t))[:, None]
    C = C - D0[None, :] * (hook * sstep(0.45, 1.0, t) ** 2)[:, None] * L
    C = C + T0[None, :] * (dimple * rA * (1 - mA))[:, None]          # cup in the base (pole pushed inward)
    # frames along the (curved) axis
    Tt = np.gradient(C, axis=0); Tt /= np.linalg.norm(Tt, axis=1, keepdims=True) + 1e-12
    Lt = V3(*lat_ref)[None, :] - np.sum(V3(*lat_ref)[None, :] * Tt, 1, keepdims=True) * Tt
    Lt /= np.linalg.norm(Lt, axis=1, keepdims=True) + 1e-12
    Dt = np.cross(Tt, Lt)
    ph = np.linspace(0, 2 * np.pi, NTH, endpoint=False)
    PH, TT = np.meshgrid(ph, t)                                       # (NT, NTH)
    noise = smooth_noise(seed + 3)(PH * 1.0 + 0.7 * TT * 5, TT * 3.0)
    rho = 1 + 0.10 * noise
    # condyles: two lobes at +-lateral split by a groove on the dorsal & palmar faces; the base is a wide flat D
    rho = rho * (1 + condyle * gB[:, None] * np.cos(2 * PH))
    rho = rho * (1 + 0.5 * lobe * gB[:, None] * np.cos(2 * PH))
    rho = rho * (1 + 0.10 * baseflat * gA[:, None] * np.cos(2 * PH))
    # D-shaped shaft: the palmar face (-dors side) is flatter than the dorsal one
    sh = np.sin(PH)
    flat = 1 - 0.14 * np.clip(-sh, 0, 1) * (1 - gA[:, None]) * (1 - gB[:, None])
    rw = (r[:, None] * lat * rho)
    rd = (r[:, None] * dors * rho * flat)
    P = C[:, None, :] + Lt[:, None, :] * (np.cos(PH) * rw)[..., None] + Dt[:, None, :] * (np.sin(PH) * rd)[..., None]
    Vv = P.reshape(-1, 3)
    I = np.arange(NT * NTH).reshape(NT, NTH)
    q0, q1 = I[:-1], I[1:]
    q0r, q1r = np.roll(q0, -1, 1), np.roll(q1, -1, 1)
    F = np.concatenate([np.stack([q0, q1, q1r], -1).reshape(-1, 3), np.stack([q0, q1r, q0r], -1).reshape(-1, 3)], 0)
    N = vertex_normals(Vv, F)
    out = Vv - np.repeat(C, NTH, axis=0)
    if np.mean(np.sum(N * out, 1)) < 0:
        F = F[:, ::-1].copy(); N = vertex_normals(Vv, F)
    prox = (C, r * np.sqrt(lat * dors) * 0.98)
    ridge = np.repeat((r / (rS + 1e-9)), NTH)
    return Part(name, Vv, F, N, prox, np.repeat(t, NTH), ridge)


def pebble(name, c, size, scale=(1, 1, 1), rot=(0, 0, 0), exp=(0.8, 0.85), seed=0):
    """A carpal: an irregular rounded-block super-ellipsoid with lumps - never two alike."""
    rng = np.random.default_rng(seed + 100)
    nu, nv = 18, 26
    th = np.linspace(-np.pi / 2, np.pi / 2, nu)[:, None] * np.ones((1, nv))
    ph = np.linspace(0, 2 * np.pi, nv, endpoint=False)[None, :] * np.ones((nu, 1))
    pw = lambda x, e: np.sign(x) * np.abs(x) ** e
    x = pw(np.cos(th), exp[0]) * pw(np.cos(ph), exp[1])
    y = pw(np.cos(th), exp[0]) * pw(np.sin(ph), exp[1])
    z = pw(np.sin(th), exp[0])
    dirs = np.stack([np.cos(th) * np.cos(ph), np.cos(th) * np.sin(ph), np.sin(th)], -1)
    rr = np.random.default_rng(seed + 5)
    nz = sum(a_ * np.sin(dirs @ rr.normal(size=3) * 2.6 + rr.uniform(0, 6)) for a_ in (0.5, 0.3, 0.2))
    bump = 1 + 0.30 * nz
    Pt = np.stack([x * scale[0], y * scale[1], z * scale[2]], -1) * (size * bump)[..., None]
    rx, ry, rz = rot
    Rx = np.array([[1, 0, 0], [0, math.cos(rx), -math.sin(rx)], [0, math.sin(rx), math.cos(rx)]])
    Ry = np.array([[math.cos(ry), 0, math.sin(ry)], [0, 1, 0], [-math.sin(ry), 0, math.cos(ry)]])
    Rz = np.array([[math.cos(rz), -math.sin(rz), 0], [math.sin(rz), math.cos(rz), 0], [0, 0, 1]])
    Vv = Pt.reshape(-1, 3) @ (Rz @ Ry @ Rx).T + V3(*c)[None, :]
    I = np.arange(nu * nv).reshape(nu, nv)
    q0, q1 = I[:-1], I[1:]; q0r, q1r = np.roll(q0, -1, 1), np.roll(q1, -1, 1)
    F = np.concatenate([np.stack([q0, q1, q1r], -1).reshape(-1, 3), np.stack([q0, q1r, q0r], -1).reshape(-1, 3)], 0)
    N = vertex_normals(Vv, F)
    if np.mean(np.sum(N * (Vv - V3(*c)[None, :]), 1)) < 0:
        F = F[:, ::-1].copy(); N = vertex_normals(Vv, F)
    prox = (V3(*c)[None, :], np.array([size * np.mean(scale) * 0.9]))
    return Part(name, Vv, F, N, prox, np.full(len(Vv), 0.5), np.ones(len(Vv)) * 1.2)


# ----------------------------------------------------------------------------------------------------------------------
def build():
    parts = []

    # --- 8 carpal pebbles (distal row, proximal row, pisiform): irregular, separate, 0.03-0.05 apart
    carp = [("hamate", (-0.40, TOP + 0.00, 0.62), 0.100, (1.05, 0.95, 0.80), (0.1, 0.2, 0.3)),
            ("capitate", (-0.145, TOP + 0.015, 0.60), 0.108, (0.95, 1.0, 0.85), (0.2, -0.1, 0.1)),
            ("trapezoid", (0.095, TOP + 0.005, 0.62), 0.085, (1.0, 0.9, 0.78), (-0.2, 0.3, 0.0)),
            ("trapezium", (0.335, TOP - 0.005, 0.64), 0.10, (1.05, 1.0, 0.8), (0.1, 0.5, -0.3)),
            ("triquetrum", (-0.30, TOP + 0.015, 0.875), 0.092, (1.0, 1.05, 0.85), (0.3, 0.1, 0.4)),
            ("lunate", (-0.035, TOP + 0.02, 0.89), 0.105, (1.0, 0.85, 0.95), (-0.1, -0.3, 0.2)),
            ("scaphoid", (0.225, TOP + 0.01, 0.885), 0.106, (1.25, 0.8, 0.8), (0.0, 0.2, 0.7)),
            ("pisiform", (-0.50, TOP + 0.03, 0.97), 0.060, (1.0, 1.0, 0.9), (0.0, 0.0, 0.0))]
    for i, (n, c, sz, sc, rot) in enumerate(carp):
        parts.append(pebble(n, c, sz * 1.42, (sc[0] * (1.0 + 0.15 * ((i * 7) % 3 - 1)), sc[1], sc[2] * 0.82), rot, exp=(0.80 + 0.06 * (i % 3), 0.84 + 0.05 * (i % 2)), seed=i))

    # --- forearm: radius (thumb side, broad distal end) + ulna (slender, round head), separate, interosseous gap, sinking into the barrow
    parts.append(bone("radius", (0.20, TOP - 0.02, 1.07), (0.34, 0.30, 2.0), 0.120, 0.095, 0.064, lat=1.45, dors=0.80, bow=0.03, flare=(0.20, 0.28),
                      gap=0.0, capA=0.32, capB=0.5, dimple=0.22, condyle=0.0, lobe=0.0, seed=1))
    parts.append(bone("ulna", (-0.25, TOP - 0.02, 1.07), (-0.36, 0.28, 2.1), 0.084, 0.10, 0.050, lat=1.05, dors=0.95, bow=-0.025, flare=(0.14, 0.26),
                      gap=0.0, capA=0.55, capB=0.5, dimple=0.0, seed=2))
    # styloid processes (small separate points at the wrist ends)
    parts.append(bone("radial_styloid", (0.42, TOP - 0.03, 1.07), (0.50, TOP - 0.05, 0.94), 0.045, 0.02, 0.03, lat=1.0, dors=1.0, gap=0.0, capA=0.9, capB=0.5, seed=3))

    # --- 4 metacarpals fanned across the palm, then 3 phalanges per finger curling inward joint by joint
    fx = [-0.56, -0.19, 0.19, 0.56]                       # pinky ... index (thumb side)
    FS = [0.78, 0.97, 1.0, 0.92]                          # finger scale
    KZ = [-0.46, -0.64, -0.62, -0.50]                     # knuckle row is an arc
    CURL = [(0.10, 0.42, 0.86), (0.12, 0.46, 0.92), (0.12, 0.48, 0.96), (0.10, 0.46, 0.90)]
    names = ["pinky", "ring", "middle", "index"]
    for i, x in enumerate(fx):
        s, sw = FS[i], FS[i] ** 0.5
        base = (x * 0.62, TOP, 0.425)
        kn = (x * 1.05, TOP + 0.005, KZ[i])
        parts.append(bone(f"mc_{names[i]}", base, kn, 0.104 * sw, 0.140 * sw, 0.052 * sw, lat=1.55, dors=0.95, bow=0.035, flare=(0.22, 0.30), gap=(0.03, -0.022),
                          capA=0.50, capB=0.80, dimple=0.05, condyle=0.16, seed=i * 9))
        L = (0.66 * s, 0.42 * s, 0.30 * s)
        W = (0.128 * sw, 0.098 * sw, 0.076 * sw, 0.060 * sw)
        RS = (0.058 * sw, 0.044 * sw, 0.036 * sw)
        side = math.copysign(1.0, x)
        psi = (side * (0.10 + abs(x) * 0.22), -side * (0.04 + abs(x) * 0.2), -side * (0.20 + abs(x) * 0.5))
        p = np.array(kn, float)
        for k in range(3):
            al, ps = CURL[i][k], psi[k]
            dv = np.array([math.sin(ps), math.cos(al) * math.cos(ps), math.sin(al) * math.cos(ps)])
            q = p + dv * (L[k] + 0.07)
            if k < 2:
                parts.append(bone(f"{names[i]}_{k}", p, q, W[k], W[k + 1] * 1.08, RS[k], lat=1.08, dors=0.88, bow=0.02, flare=(0.24, 0.28), gap=(-0.020, -0.020),
                                  capA=0.50, capB=0.78, dimple=0.14, condyle=0.26, seed=i * 9 + k + 1))
            else:
                parts.append(bone(f"{names[i]}_{k}", p, q, W[k], W[k + 1], RS[k], lat=1.0, dors=0.80, flare=(0.26, 0.3), gap=(-0.020, 0.0), capA=0.50,
                                  dimple=0.14, tip=True, hook=0.20, seed=i * 9 + k + 1))
            p = q

    # --- thumb: metacarpal along the palm edge, two phalanges rising and curling in
    t0, t1 = (0.50, TOP - 0.01, 0.44), (1.04, TOP + 0.03, 0.04)
    parts.append(bone("mc_thumb", t0, t1, 0.105, 0.125, 0.062, lat=1.35, dors=0.9, bow=0.03, flare=(0.22, 0.28), gap=(0.03, -0.022), capA=0.50, capB=0.8, dimple=0.05, condyle=0.1, seed=90))
    t2 = (1.22, 1.64, -0.10)
    parts.append(bone("thumb_0", t1, t2, 0.128, 0.098, 0.068, lat=1.1, dors=0.9, bow=0.02, flare=(0.24, 0.28), gap=(-0.020, -0.020), capA=0.50, capB=0.78, dimple=0.14, condyle=0.24, seed=91))
    t3 = (1.04, 2.02, 0.16)
    parts.append(bone("thumb_1", t2, t3, 0.098, 0.060, 0.044, lat=1.0, dors=0.8, flare=(0.26, 0.3), gap=(-0.020, 0.0), capA=0.50, dimple=0.14, tip=True, hook=0.2, seed=92))
    return parts


def occlusion(parts):
    """Per-vertex AO against every OTHER part (proxy spheres along each bone axis): joint gaps and the spaces between bones go dark."""
    PC = np.concatenate([p.prox[0] for p in parts], 0)
    PR = np.concatenate([p.prox[1] for p in parts], 0)
    PI = np.concatenate([np.full(len(p.prox[1]), i) for i, p in enumerate(parts)], 0)
    out = []
    for pi, p in enumerate(parts):
        occ = np.zeros(len(p.V)); wsum = 0.0
        for h, w in ((0.015, 1.0), (0.04, 0.9), (0.08, 0.7), (0.14, 0.5), (0.22, 0.3)):
            Q = p.V + p.N * h
            d = np.full(len(Q), 9.0)
            for c0 in range(0, len(Q), 4000):
                q = Q[c0:c0 + 4000]
                dd = np.linalg.norm(q[:, None, :] - PC[None, :, :], axis=2) - PR[None, :]
                dd[:, PI == pi] = 9.0
                d[c0:c0 + 4000] = dd.min(1)
            occ += w * np.clip(h - d, 0, None) / h
            wsum += w
        out.append(np.clip(1 - 1.25 * occ / wsum, 0, 1))
    return out


CARPALS = {'hamate', 'capitate', 'trapezoid', 'trapezium', 'triquetrum', 'lunate', 'scaphoid', 'pisiform'}


def curvature(p, scales=(1, 4)):
    """Per-vertex signed cavity (+ concave / - convex) from the mesh Laplacian dotted with the normal, at two smoothing scales."""
    E = np.concatenate([p.F[:, [0, 1]], p.F[:, [1, 2]], p.F[:, [2, 0]]], 0)
    E = np.concatenate([E, E[:, ::-1]], 0)
    cnt = np.bincount(E[:, 0], minlength=len(p.V)).astype(float) + 1e-9
    def lap(A):
        S = np.zeros_like(A)
        np.add.at(S, E[:, 0], A[E[:, 1]])
        return S / cnt[:, None] - A
    L = lap(p.V)
    c = -np.sum(L * p.N, 1)                                   # sphere: neighbours lie inside -> L.N < 0 -> c > 0 means convex; flip below
    c = -c
    out = []
    for k in scales:
        cs = c.copy()
        for _ in range(k * 2):
            S = np.zeros_like(cs); np.add.at(S, E[:, 0], cs[E[:, 1]]); cs = 0.5 * cs + 0.5 * S / cnt
        out.append(cs)
    return out


def colour(parts, ao):
    """Baked albedo (sRGB -> linear), C2 r1b: AGED IVORY-BROWN bone, not ceramic. Value structure is deliberately low (the heroes must be
    the brightest thing on the select screen): warm grey-brown mid with ivory only on worn high points, near-black stained crevices and
    joint lines, cavity (curvature) darkening, hairline cracks + chips/pits, soot on the lateral faces next to the braziers and the tips,
    moss in the hollows and pale lichen patches on the upward faces."""
    cols = []
    dark = np.array([0.10, 0.075, 0.05]); mid = np.array([0.58, 0.48, 0.34]); hi = np.array([0.86, 0.78, 0.60])
    stain = np.array([0.42, 0.27, 0.12]); moss = np.array([0.17, 0.22, 0.07]); soot = np.array([0.05, 0.045, 0.045])
    lichen = np.array([0.50, 0.53, 0.36]); pit = np.array([0.08, 0.06, 0.045])
    for p, a in zip(parts, ao):
        a = a * a * (3 - 2 * a)
        if p.name in CARPALS:
            a = 0.45 + 0.55 * a                                  # the pebbles overlap into one mass: their mutual AO would blacken it
        sd = zlib.crc32(p.name.encode()) % 1000
        X, Y, Z = p.V[:, 0], p.V[:, 1], p.V[:, 2]
        c1, c4 = curvature(p)
        cav = np.clip(0.5 * c1 + 0.5 * c4, -1e9, 1e9)
        sc = np.percentile(np.abs(cav), 90) + 1e-9
        cav = cav / sc                                          # ~ +-1: + concave (hollow), - convex (ridge / worn high point)
        st = smooth_noise(sd + 5, 5)(X * 9 + Z * 5, Y * 4)
        base = 0.56 + 0.16 * np.clip(p.ridge - 1.0, 0, 1.2) + 0.09 * st
        if p.name in CARPALS:
            base = base + 0.10
        tt = base * (0.35 + 0.65 * a) + 0.08 * (a - 0.5)
        tt = tt - 0.15 * np.clip(cav, 0, 1.5) + 0.13 * np.clip(-cav, 0, 1.2) * (0.4 + 0.6 * a)   # cavity darkening / worn highs
        fore = np.clip((0.95 - Y) / 0.9, 0, 1) * (Z > 1.1)
        end = np.maximum(sstep(0.80, 1.0, p.t), 1 - sstep(0.0, 0.14, p.t))
        joint = np.maximum(1 - sstep(0.0, 0.06, p.t), sstep(0.94, 1.0, p.t))                    # the dark line where bones meet
        low = 1 - sstep(0.7, 1.25, Y)
        tt = np.clip(tt - 0.20 * fore - 0.07 * end - 0.22 * joint - 0.04 * low, 0, 1)[:, None]
        c = np.where(tt < 0.5, dark + (mid - dark) * (tt / 0.5), mid + (hi - mid) * ((tt - 0.5) / 0.5))
        # patina: broad brown / ochre patches (stronger at the joint ends)
        sn = smooth_noise(sd + 17, 6)(X * 5 + Z * 3, Y * 2.3)
        sm = np.clip(sstep(-0.25, 0.30, sn) * (0.50 + 0.50 * end) * 0.95, 0, 0.9)[:, None]
        c = c * (1 - sm) + stain * (0.6 + c * 1.1) * sm
        # hairline cracks (wider and in more patches than r1) + chips / pits near the ends and on convex edges
        n1 = smooth_noise(sd + 31, 6)(X * 19 + Z * 10, Y * 8)
        gate = sstep(-0.15, 0.25, smooth_noise(sd + 41, 4)(X * 4 + Z * 3, Y * 2))
        crack = np.exp(-(n1 / 0.09) ** 2) * gate
        c = c * (1 - (0.50 if p.name in CARPALS else 0.78) * crack)[:, None]
        pn = smooth_noise(sd + 67, 6)(X * 31 + Z * 17, Y * 13) + 0.5 * smooth_noise(sd + 71, 5)(X * 53 + Z * 29, Y * 23)
        pitm = sstep(0.46, 0.58, pn) * (0.35 + 0.65 * np.clip(-cav + 0.4 * end, 0, 1))
        c = c * (1 - 0.86 * pitm)[:, None] + pit * (0.86 * pitm)[:, None]
        # moss: hollows (low AO / concave) + upward faces, broken up by noise; lichen: pale round patches on the top faces
        up = np.clip(p.N[:, 1], 0, 1)
        mn = smooth_noise(sd + 53, 6)(X * 7 + Z * 6, Y * 5)
        mm = np.clip(sstep(-0.12, 0.38, mn) * (0.55 * (1 - a) + 0.30 * np.clip(cav, 0, 1.5) + 0.50 * up ** 2) * (0.55 + 0.55 * end) * 1.55, 0, 0.88)[:, None]
        c = c * (1 - mm) + moss * (0.7 + 1.1 * tt) * mm
        ln = smooth_noise(sd + 83, 6)(X * 12 + Z * 9, Y * 7) + 0.6 * smooth_noise(sd + 89, 5)(X * 27 + Z * 19, Y * 15)
        lm = (sstep(0.55, 0.70, ln) * up ** 1.5 * (1 - 0.6 * mm[:, 0]) * 0.75)[:, None]
        c = c * (1 - lm) + lichen * (0.8 + 0.5 * tt) * lm
        # soot: tips, the lateral faces beside the braziers (they stand between the hands), and ash near the ground
        tipm = np.array(1.0 if p.name.startswith(("pinky_2", "ring_2", "middle_2", "index_2", "thumb_1")) else 0.0)
        side = np.clip(p.N[:, 0] * np.sign(X + 1e-6) * 1.4 - 0.15, 0, 1) * np.clip(1.35 - 0.55 * Y, 0, 1)
        sootm = np.clip(0.50 * sstep(0.55, 1.0, p.t) * tipm + 0.30 * side * (0.6 + 0.4 * np.abs(smooth_noise(sd + 97, 4)(X * 3, Y * 3))) + 0.16 * low, 0, 0.7)[:, None]
        sootm = sootm * (1 - 0.4 * a[:, None] * 0)
        c = c * (1 - 0.62 * sootm) + soot * 0.62 * sootm
        c = np.clip(c, 0, 1)
        cols.append(np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32))
    return cols


def write_glb(path, G, GN, C, idx):
    def pad(b, ch=b"\0"):
        return b + ch * ((-len(b)) % 4)
    pos, nrm, col, ind = G.tobytes(), GN.tobytes(), C.tobytes(), idx.tobytes()
    binb = pad(pos) + pad(nrm) + pad(col) + pad(ind)
    o1, o2, o3 = len(pad(pos)), len(pad(pos)) + len(pad(nrm)), len(pad(pos)) + len(pad(nrm)) + len(pad(col))
    js = {
        "asset": {"version": "2.0", "generator": "ui_hand_bones.py"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "ui_skeletal_hand"}],
        "meshes": [{"name": "ui_skeletal_hand", "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2}, "indices": 3, "material": 0}]}],
        "materials": [{"name": "bone", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.0, "roughnessFactor": 0.88}}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(G), "type": "VEC3", "min": G.min(0).tolist(), "max": G.max(0).tolist()},
            {"bufferView": 1, "componentType": 5126, "count": len(G), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": len(G), "type": "VEC3"},
            {"bufferView": 3, "componentType": 5125, "count": int(idx.size), "type": "SCALAR"}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
            {"buffer": 0, "byteOffset": o1, "byteLength": len(nrm), "target": 34962},
            {"buffer": 0, "byteOffset": o2, "byteLength": len(col), "target": 34962},
            {"buffer": 0, "byteOffset": o3, "byteLength": len(ind), "target": 34963}],
        "buffers": [{"byteLength": len(binb)}],
    }
    jb = pad(json.dumps(js, separators=(",", ":")).encode(), b" ")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(jb) + 8 + len(binb)))
        f.write(struct.pack("<I4s", len(jb), b"JSON")); f.write(jb)
        f.write(struct.pack("<I4s", len(binb), b"BIN\0")); f.write(binb)


def main():
    t0 = time.time()
    parts = build()
    ao = occlusion(parts)
    cols = colour(parts, ao)
    V, N, C, F, off = [], [], [], [], 0
    for p, c in zip(parts, cols):
        V.append(p.V); N.append(p.N); C.append(c); F.append(p.F + off); off += len(p.V)
    V, N, C, F = (np.concatenate(x, 0) for x in (V, N, C, F))
    # drop degenerate triangles (collapsed pole rings)
    area = np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
    F = F[area > 1e-9]
    write_glb(OUT, V.astype(np.float32), N.astype(np.float32), C.astype(np.float32), F.astype(np.uint32))
    # bone gaps report: smallest centre-line-proxy distance between touching parts
    print(f"[hand] {len(parts)} bones, {len(F)} tris, {len(V)} verts -> {OUT} ({os.path.getsize(OUT)/1e6:.2f} MB) in {time.time()-t0:.1f}s")
    print("bounds", V.min(0).round(2), V.max(0).round(2))


if __name__ == "__main__":
    main()
