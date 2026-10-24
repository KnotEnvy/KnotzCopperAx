"""Conforming costume pieces built as SDF ops on top of a body Sculpt.

Pattern: take `snap = S.snapshot()` of the finished body, then
    piece = Bounded(Inter(Offset(snap, thickness), <region prim>), lo, hi)
so leather/armour follows the anatomy exactly and fuses into one watertight mesh with the body
(no floating shells, no z-fighting, deforms with the skin). Regions are slabs, half-spaces or tubes
around surface-projected paths. Materials are tagged per op ('leather', 'bronze', ...).
"""
import math
import numpy as np

from .sdf import (V, norm, basis, rot, Sphere, Ellipsoid, RoundCone, Capsule, RoundBox, Torus, HalfSpace,
                  Chain, Inter, Union, Offset, Slab, Bounded, Displace, SymX)
from .anatomy import resample


def _box(pts, pad):
    P = np.array([V(p) for p in pts])
    return P.min(axis=0) - pad, P.max(axis=0) + pad


def project_path(S, pts, step=0.008, offset=0.0):
    P, _ = resample(pts, step=step * 2)
    P = S.project(P, offset=offset)
    P, _ = resample(P, step=step)
    return S.project(P, offset=offset)


def stud(S, p, r=0.004, mat="bronze", k=0.0008):
    S.add(Sphere(p, r), k, mat=mat)


def studs_on(S, pts, r=0.004, mat="bronze", lift=0.0):
    P = S.project(np.array([V(p) for p in pts]), offset=lift)
    for p in P:
        stud(S, p, r, mat)
    return P


# ----------------------------------------------------------------------------- limbs
def bracer(S, snap, L, side, ai, t0=0.40, t1=0.975, thick=0.0075, plate=True, lacing=True):
    el, wr = L["elbow_" + side], L["wrist_" + side]
    b, ub, fb = ai["forearm_axis"], ai["forearm_u"], ai["forearm_f"]
    Lf = float(np.linalg.norm(wr - el))
    at = lambda t, ang=0.0, rad=0.0: el + b * (t * Lf) + (ub * math.cos(ang) + fb * math.sin(ang)) * rad
    lo, hi = _box([el, wr], 0.1)
    c = at((t0 + t1) / 2)
    half = Lf * (t1 - t0) / 2
    S.add(Bounded(Inter(Offset(snap, thick), Slab(c, b, half), k=0.003), lo, hi), 0.0, mat="leather")
    # rolled rims at both ends
    for t in (t0 + 0.012, t1 - 0.012):
        S.add(Bounded(Inter(Offset(snap, thick + 0.0028), Slab(at(t), b, 0.0055), k=0.002), lo, hi), 0.0015,
              mat="leather_dark")
    if plate:
        pc = at(0.66)
        reg = Inter(Offset(snap, thick + 0.0045), Slab(pc, b, Lf * 0.22), HalfSpace(at(0.66, 0, 0.022), -ub), k=0.004)
        S.add(Bounded(reg, lo, hi), 0.001, mat="bronze")
        # raised ridge down the plate + rivets
        ridge = project_path(S, [at(0.47, 0, 0.1), at(0.66, 0, 0.1), at(0.85, 0, 0.1)])
        S.add(Chain(list(ridge), 0.0032), 0.002, mat="bronze")
        pts = []
        for t in (0.47, 0.6, 0.73, 0.86):
            for a in (-0.95, 0.95):
                pts.append(at(t, a, 0.1))
        studs_on(S, pts, 0.0034)
    if lacing:
        # X lacing on the inner side
        ts = np.linspace(t0 + 0.05, t1 - 0.05, 6)
        for i in range(len(ts) - 1):
            for sgn in (1, -1):
                a0, a1 = math.pi + sgn * 0.35, math.pi - sgn * 0.35
                cord = project_path(S, [at(ts[i], a0, 0.1), at(ts[i + 1], a1, 0.1)], step=0.004, offset=0.0006)
                S.add(Chain(list(cord), 0.0019), 0.001, mat="leather_dark")


def boot(S, snap, L, side, li, top=0.45, thick=0.009):
    an, kn = L["ankle_" + side], L["knee_" + side]
    ball, toe = L["ball_" + side], L["toe_" + side]
    lo, hi = _box([an, kn * 0 + V(an[0], an[1], top + 0.03), ball, toe, an + V(0, 0.1, -0.1)], 0.11)
    lo[2] = -0.05
    # smooth hull filling calf valleys so the shaft reads as stiff leather, not painted-on muscle
    b = li["b"]
    hull = RoundCone(an + V(0, 0.004, 0.0), an - b * ((top + 0.02 - an[2]) / max(1e-6, -b[2])) + V(0, 0.012, 0),
                     0.047, 0.07, squash=(1.12, 0.95))
    shaft = Inter(Union(Offset(snap, thick), hull, k=0.03), HalfSpace(V(0, 0, top), V(0, 0, 1)), k=0.004)
    S.add(Bounded(shaft, lo, hi), 0.0, mat="leather")
    # folded cuff at the top
    S.add(Bounded(Inter(Offset(Union(snap, hull, k=0.03), thick + 0.006), Slab(V(0, 0, top - 0.024), V(0, 0, 1), 0.024),
                        k=0.004), lo, hi), 0.002, mat="leather_dark")
    # straps with buckles
    sx = 1 if side == "L" else -1
    for z, tilt in ((0.17, 0.12), (0.30, -0.08)):
        n = norm(V(0, tilt, 1))
        S.add(Bounded(Inter(Offset(Union(snap, hull, k=0.03), thick + 0.0045), Slab(V(0, 0, z), n, 0.0095), k=0.002),
                      lo, hi), 0.0015, mat="leather_dark")
        bp = S.project(np.array([V(an[0] + sx * 0.08, an[1], z)]), offset=0.0)[0]
        nrm = S.grad(bp[None])[0]
        S.add(RoundBox(bp + nrm * 0.002, V(0.004, 0.013, 0.012), basis(nrm, V(0, 0, 1)), r=0.003), 0.001, mat="bronze")
    # thick sole + heel block, flat at the ground
    sole = Inter(Offset(snap, thick + 0.006), HalfSpace(V(0, 0, 0.028), V(0, 0, 1)), k=0.003)
    S.add(Bounded(sole, lo, hi), 0.0015, mat="sole")
    # toe cap seam
    S.inter(HalfSpace(V(0, 0, 0.0), V(0, 0, -1)))


# ----------------------------------------------------------------------------- torso pieces
def belt(S, snap, L, z=1.035, half=0.036, thick=0.012, buckle=True):
    lo, hi = V(-0.3, -0.3, z - 0.1), V(0.3, 0.3, z + 0.1)
    n = norm(V(0, 0.18, 1))
    S.add(Bounded(Inter(Offset(snap, thick), Slab(V(0, 0, z), n, half), k=0.003), lo, hi), 0.0, mat="leather_dark")
    # stitched edge rolls
    for dz in (-half + 0.004, half - 0.004):
        S.add(Bounded(Inter(Offset(snap, thick + 0.002), Slab(V(0, 0, z + dz), n, 0.0035), k=0.0015), lo, hi), 0.001,
              mat="leather_dark")
    # studs all round
    pts = []
    for i in range(18):
        a = (i + 0.5) / 18 * 2 * math.pi
        if abs(math.sin(a) + 1) < 0.15:     # skip the buckle zone (front = -Y)
            continue
        pts.append(V(0.3 * math.cos(a), 0.3 * math.sin(a), z + 0.3 * math.sin(a) * -0.18))
    studs_on(S, pts, 0.0048, lift=thick)
    info = {}
    if buckle:
        fc = S.project(np.array([V(0, -0.3, z + 0.054)]), offset=0.0)[0]
        nrm = S.grad(fc[None])[0]
        M = basis(V(1, 0, 0), V(0, 0, 1))
        M = np.stack([V(1, 0, 0), norm(np.cross(nrm, V(1, 0, 0))), nrm], axis=1)
        plate = RoundBox(fc + nrm * 0.004, V(0.05, 0.043, 0.008), M, r=0.007)
        S.add(plate, 0.002, mat="bronze")
        S.add(Torus(fc + nrm * 0.012, 0.03, 0.0045, M), 0.002, mat="bronze")        # raised ring
        S.add(Sphere(fc + nrm * 0.004, 0.018), 0.004, mat="bronze")                # central boss
        S.sub(Torus(fc + nrm * 0.013, 0.021, 0.0016, M), 0.001)                     # engraved inner ring
        info["buckle"] = fc
    return info


def strap(S, snap, pts, width=0.05, thick=0.0065, mat="leather", edge=True):
    P = project_path(S, pts, step=0.01)
    lo, hi = _box(P, width + 0.03)
    tube = Chain(list(P), width * 0.5)
    S.add(Bounded(Inter(Offset(snap, thick), tube, k=0.0025), lo, hi), 0.001, mat=mat)
    if edge:   # stitch lines along both edges (tiny grooves) are left to the normal/detail bake
        pass
    return P


def medallion(S, p_raw, r=0.042, mat="bronze"):
    p = S.project(np.array([V(p_raw)]), offset=0.0)[0]
    nrm = S.grad(p[None])[0]
    e0 = norm(V(1, 0, 0) - nrm * nrm[0])
    e1 = np.cross(nrm, e0)
    M = np.stack([e0, e1, nrm], axis=1)
    S.add(Ellipsoid(p + nrm * 0.002, V(r, r, 0.009), M), 0.003, mat=mat)
    S.add(Torus(p + nrm * 0.0075, r * 0.86, 0.0042, M), 0.002, mat=mat)
    S.add(Sphere(p + nrm * 0.004, r * 0.36), 0.003, mat=mat)
    # knot motif: 3 interleaved loops engraved
    for i in range(3):
        a = i * 2 * math.pi / 3
        c = p + nrm * 0.012 + (e0 * math.cos(a) + e1 * math.sin(a)) * r * 0.42
        S.sub(Torus(c, r * 0.26, 0.0014, M), 0.0008)
    return p, nrm


def torc(S, L, R=0.088, r=0.0078, tilt=18.0, z=None, gap=0.5):
    """Twisted bronze neck ring with knob terminals (open at the front)."""
    c = V(0, 0.018, (z if z is not None else L["neck"][2] + 0.012))
    M = rot(tilt, 0, 0)
    pts_a, pts_b = [], []
    n = 90
    for i in range(n + 1):
        u = gap / 2 + (2 * math.pi - gap) * i / n
        # ring param: front = -Y (u=0 at front)
        rad = V(math.sin(u), -math.cos(u), 0)
        ring = c + M @ (rad * R)
        tang = M @ V(math.cos(u), math.sin(u), 0)
        nrm_ = M @ rad
        up = np.cross(tang, nrm_)
        w = u * 7
        pts_a.append(ring + (nrm_ * math.cos(w) + up * math.sin(w)) * r * 0.55)
        pts_b.append(ring - (nrm_ * math.cos(w) + up * math.sin(w)) * r * 0.55)
    S.add(Chain(pts_a, r * 0.62), 0.001, mat="bronze")
    S.add(Chain(pts_b, r * 0.62), 0.001, mat="bronze")
    for u in (gap / 2, 2 * math.pi - gap / 2):
        rad = V(math.sin(u), -math.cos(u), 0)
        S.add(Sphere(c + M @ (rad * R) + M @ V(0, -1, 0) * 0.004, r * 1.45), 0.002, mat="bronze")


def scalp_cap(S, snap_head, H, thick=0.007, front_z=0.062, back_z=-0.12, exclude=(), noise=0.0022, k_edge=0.006,
              k_exclude=0.008):
    """Hair mass over the cranium above a hairline plane (material 'hair'). exclude: prims kept bare (ears).
    noise: amplitude of the surface wobble (hero-seraphine C1, additive: 0 = a clean smooth cap under sculpted
    clump hair, where the wobble read as a lumpy clay cap). k_edge / k_exclude (hero-seraphine C1 r6, additive):
    blend radii of the hairline cut and the ear cut-outs -- larger = the cap rolls into the skin instead of ending
    in a `thick`-high cliff (the r5 cap edge read as a rigid helmet rim above a bald band)."""
    from .sdf import Diff
    c1 = H(0, -0.095, front_z)
    c2 = H(0, 0.115, back_z)
    d1 = c2 - c1
    nrm = norm(np.cross(V(1, 0, 0), d1))        # points up/back
    lo, hi = H(-0.12, -0.13, -0.2), H(0.12, 0.14, 0.13)
    base = Offset(snap_head, thick)
    if noise > 0:
        base = Displace(base, noise, 90.0, 2, seed=7)
    cap = Inter(base, HalfSpace(c1, -nrm), k=k_edge)
    for ex in exclude:
        cap = Diff(cap, ex, k=k_exclude)
    S.add(Bounded(cap, lo, hi), 0.004, mat="hair")


# ----------------------------------------------------------------------------- kilt (separate sculpt)
def kilt_sculpt(L, materials, top_z=1.055, hem_z=0.64, r_top=0.178, r_hem=0.272, squash=0.84, n_strips=12,
                thick=0.0036, seed=5, front_flap=True, flap_mat="leather_dark",
                strip_mats=("leather_dark", "leather", "leather")):
    """Pteruges-style kilt: layered strips on an elliptic frustum + bronze studs + front/back flaps.
    strip_mats cycles per strip (e.g. ("cloth",) = a cloth/tartan kilt, the default = mixed leather strips).
    Returns (Sculpt, info) - meshed separately from the body and skinned to kilt_* chains."""
    from .sdf import Sculpt, Shell
    rng = np.random.RandomState(seed)
    S = Sculpt(materials=materials, default_mat="leather")
    info = {"strips": []}
    for i in range(n_strips):
        a_c = (i + 0.5) / n_strips * 2 * math.pi           # 0 = front (-Y)
        layer = i % 2
        rt = r_top + 0.004 * layer
        rh = r_hem + 0.008 * layer + rng.uniform(-0.004, 0.004)
        hz = hem_z + rng.uniform(-0.02, 0.012) - 0.01 * layer
        a_half = math.pi / n_strips * (1.12 if layer else 0.98)
        cone = RoundCone(V(0, 0.012, top_z + 0.05), V(0, 0.022, hz - 0.06), rt - 0.012, rh + 0.02,
                         squash=(squash, 1.0))
        shell = Shell(cone, thick)
        # angular wedge: two planes through the vertical axis
        d0 = V(math.sin(a_c - a_half), -math.cos(a_c - a_half), 0)
        d1 = V(math.sin(a_c + a_half), -math.cos(a_c + a_half), 0)
        n0 = norm(np.cross(V(0, 0, 1), d0)) * -1.0
        n1 = norm(np.cross(V(0, 0, 1), d1))
        wedge_c = V(0, 0.015, 0)
        reg = Inter(shell, HalfSpace(wedge_c, n0), HalfSpace(wedge_c, n1),
                    HalfSpace(V(0, 0, hz), V(0, 0, -1)), HalfSpace(V(0, 0, top_z), V(0, 0, 1)), k=0.006)
        mid = V(math.sin(a_c), -math.cos(a_c), 0)
        lo = V(-0.34, -0.34, hz - 0.03)
        hi = V(0.34, 0.34, top_z + 0.03)
        S.add(Bounded(reg, lo, hi), 0.0, mat=strip_mats[i % len(strip_mats)])
        # studs down the strip
        for zz in np.linspace(hz + 0.05, top_z - 0.08, 3):
            f = (top_z + 0.05 - zz) / (top_z + 0.05 - (hz - 0.06))
            rr = (rt - 0.012) + ((rh + 0.02) - (rt - 0.012)) * f
            p = V(0, 0.012 + 0.01 * f, zz) + V(mid[0] * rr, mid[1] * rr * squash, 0)
            S.add(Sphere(p + V(mid[0], mid[1], 0) * thick * 0.6, 0.0052), 0.001, mat="bronze")
        info["strips"].append((a_c, hz))
    if front_flap:
        for side, ac, depth in (("F", 0.0, 0.07), ("B", math.pi, 0.05)):
            mid = V(math.sin(ac), -math.cos(ac), 0)
            cone = RoundCone(V(0, 0.012, top_z + 0.05), V(0, 0.022, hem_z - 0.12), r_top - 0.006, r_hem + 0.028,
                             squash=(squash, 1.0))
            shell = Shell(cone, thick * 1.2)
            flap_w = 0.075
            reg = Inter(shell, Slab(V(0, 0, 0), V(1, 0, 0), flap_w), HalfSpace(V(0, 0, 0), -mid),
                        HalfSpace(V(0, 0, hem_z - depth), V(0, 0, -1)), HalfSpace(V(0, 0, top_z), V(0, 0, 1)), k=0.01)
            S.add(Bounded(reg, V(-0.12, -0.36, hem_z - depth - 0.03), V(0.12, 0.36, top_z + 0.03)), 0.002,
                  mat=flap_mat)
            if side == "F":
                zz = hem_z + 0.07
                f = (top_z + 0.05 - zz) / (top_z + 0.05 - (hem_z - 0.12))
                rr = (r_top - 0.006) + ((r_hem + 0.028) - (r_top - 0.006)) * f
                p = V(0, 0.012 + 0.01 * f - rr * squash - thick * 1.4, zz)
                M = np.stack([V(1, 0, 0), V(0, 0, 1), V(0, -1, 0)], axis=1)
                S.add(RoundBox(p + V(0, -0.003, 0), V(0.034, 0.042, 0.0045), M, r=0.004), 0.002, mat="bronze")
                S.add(Sphere(p + V(0, -0.004, 0), 0.014), 0.003, mat="bronze")
                S.sub(Torus(p + V(0, -0.008, 0), 0.024, 0.0015, M), 0.001)
    return S, info


# ----------------------------------------------------------------------------- fur (SDF clumps)
def fur_band(S, ring_fn, n=40, rows=2, length=(0.06, 0.09), width=(0.018, 0.026), droop=0.7, seed=5, mat="fur",
             k=0.005, row_dz=-0.018, row_out=0.006, core=None, curl=0.35, tip_shape=(1.0, 0.82, 0.55, 0.26),
             roll=0.0):
    """Fluffy fur trim as smooth-unioned tapered clumps (chunky stylised pelt, reads at game distance).
    ring_fn(a) -> (point, outward_normal) for a in [0, 2pi) (a=0 front). Each row is staggered and hangs
    lower/outward; clumps curl downward (gravity) with a random lateral lean. core=(prim, k) optional roll."""
    rng = np.random.RandomState(seed)
    if core is not None:
        S.add(core[0], core[1], mat=mat)
    down = V(0, 0, -1)
    if roll > 0:   # continuous lumpy pelt roll under the clumps so the band reads as one mass of fur
        ring = []
        rr = []
        for i in range(97):
            a = i / 96 * 2 * math.pi
            p, nrm = ring_fn(a)
            ring.append(V(p) + V(nrm) * roll * 0.35 + down * roll * 0.25)
            rr.append(roll * (0.85 + 0.3 * rng.rand()))
        S.add(Chain(ring, rr, margin=0.03), k * 1.5, mat=mat)
    for r in range(rows):
        for i in range(n):
            a = (i + 0.5 * (r % 2) + rng.uniform(-0.25, 0.25)) / n * 2 * math.pi
            p, nrm = ring_fn(a)
            p = V(p) + down * (row_dz * r) + V(nrm) * (row_out * r)
            nrm = norm(V(nrm))
            L = rng.uniform(*length) * (1.0 - 0.12 * r)
            w = rng.uniform(*width)
            tang = norm(np.cross(V(0, 0, 1), nrm))
            d = norm(nrm * (1 - droop) + down * droop + tang * rng.uniform(-0.3, 0.3))
            pts, rad = [p - nrm * 0.006], [w * 0.85]
            q, v = pts[0].copy(), d
            for j in range(4):
                v = norm(v + down * curl * 0.35 + nrm * 0.04)
                q = q + v * (L / 4)
                pts.append(q.copy())
                rad.append(w * tip_shape[j])
            S.add(Chain(pts, rad, squash=(0.7, 1.0), ref=tuple(nrm)), k, mat=mat)


def ellipse_ring(c, rx, ry, z, tilt_y=0.0):
    """ring_fn for an elliptic loop around the body (waist, boot tops, collars). a=0 -> front (-Y)."""
    c = V(c)

    def fn(a):
        p = V(c[0] + math.sin(a) * rx, c[1] - math.cos(a) * ry, z + tilt_y * -math.cos(a))
        nrm = norm(V(math.sin(a) / rx, -math.cos(a) / ry, 0.0))
        return p, nrm
    return fn
