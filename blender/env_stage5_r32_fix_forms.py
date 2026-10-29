"""Stage5 r32 FIX helper: carved serpent forms for pillar / throne + a compact 3-node GLB writer.

Private to blender/fix_env_stage5_r32.py (the single board-driven geometry fix). Reads lib.sdf and the
original r32 helper; never modifies shared code or the first-build scripts.

Design (board r2 consensus: smooth inflated tubes / blunt masks):
  * coils  - CarvedHelix: the serpent body swept along the column helix with an 8-plane carved cross-section
             (flat belly plate, two outer flank planes, crown plane, dorsal top) so the coils read as chiselled
             stone; two staggered rows of broad flat scales on the crown and upper flank (jittered pitch),
             belly joints, and a few chisel chips rooted in the volume.
  * neck / armrests / relief - CarvedPath: the same idea along a polyline (polygon profile per segment,
             smooth joints), so nothing in the sculpture is an inflated round tube.
  * hood   - a cobra shield (round top, sides tapering to the neck) with a thick lens plan: centre plate,
             two angled front facets, rolled rim, recessed fields, a proud tapered spine plate, radial rib
             grooves and rim chips. Reused at a smaller scale as the throne's crest hood.
  * head   - faceted blocks: cranium, tilted brow visor, tapered muzzle with a sloping snout plane, open
             mouth slot, hinged lower jaw, two fangs, eye sockets with small glow bulges, nostrils.
  * throne - a chamfered slab with the crest hood + head pitched over the seat, a recessed framed panel with
             two broad intertwined ridge-carved serpent bodies (segmented), carved armrests with heads and
             grounded tail loops, selected broken edges.
Blender coordinates throughout: Z up, X along the wall, the camera side is -Y (glTF +Z).
"""
import copy
import hashlib
import json
import math
import struct
from pathlib import Path

import numpy as np

from lib.sdf import (FAR, Prim, Sculpt, V, Ellipsoid, Sphere, RoundCone, RoundBox, HalfSpace, Inter,
                     Bounded, rot, norm, smin)

TAU = math.tau


# ----------------------------------------------------------------------------- frames / profiles
def head_frame(forward, up=(0, 0, 1)):
    """Columns (right, back, up) of a frame whose local -Y is `forward` (the head builder's forward)."""
    f = norm(V(forward))
    u = V(up) - f * float(np.dot(V(up), f))
    u = norm(u)
    back = -f
    right = np.cross(back, u)
    return np.stack([right, back, u], axis=1)


def profile_normals(profile):
    """CCW polygon (u, w) -> (vertices, outward edge normals)."""
    prof = np.asarray(profile, float)
    e = np.roll(prof, -1, axis=0) - prof
    n = np.stack([e[:, 1], -e[:, 0]], axis=1)
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    return prof, n


def polygon_sdf(du, dw, Rr, pv, pn):
    """Signed distance to the polygon scaled by Rr (exact inside, a lower bound outside)."""
    d2 = np.full(np.broadcast(du, dw).shape, -FAR)
    for v, n in zip(pv, pn):
        np.maximum(d2, (du - v[0] * Rr) * n[0] + (dw - v[1] * Rr) * n[1], out=d2)
    return d2


# ----------------------------------------------------------------------------- carved helix body
class CarvedHelix(Prim):
    """Serpent body along the column helix with a convex polygonal (carved) cross-section.

    profile: CCW polygon in (u, w) unit coordinates (u = radial outward, w = up), scaled by the body
    radius R(t). The tail tapers to a point; the top end is a flat cut covered by the neck.
    """

    def __init__(self, c):
        self.turns, self.end = float(c['turns']), float(c['end_angle'])
        self.z0, self.rise = float(c['bottom']), float(c['rise'])
        self.pr, self.pr_drop = float(c['path_radius']), float(c['path_drop'])
        self.r0, self.r1, self.rexp = float(c['tail_radius']), float(c['coil_radius']), float(c['radius_exp'])
        self.tail_taper = float(c['tail_taper'])
        self.pv, self.pn = profile_normals(c['profile'])
        self.L = self.turns * TAU * (self.pr - self.pr_drop * .5)
        ext = self.pr + self.r1 * float(np.abs(self.pv).max()) + .05
        self.lo = V(-ext, -ext, self.z0 - self.r1 * 1.1)
        self.hi = V(ext, ext, self.z0 + self.rise + self.r1 * 1.1)

    def R(self, t):
        t = np.clip(t, 0, 1)
        base = self.r0 + (self.r1 - self.r0) * t ** self.rexp
        s = np.clip(t / self.tail_taper, 0, 1)
        return base * (s * s * (3 - 2 * s))

    def rr(self, t):
        return self.pr - self.pr_drop * (1 - np.clip(t, 0, 1))

    def angle(self, t):
        return self.end - (1 - t) * self.turns * TAU

    def point(self, t):
        a, rr = self.angle(t), float(self.rr(t))
        return V(math.cos(a) * rr, math.sin(a) * rr, self.z0 + t * self.rise)

    def frame(self, t):
        """(tangent, radial outward, up) at t."""
        a, rr = self.angle(t), float(self.rr(t))
        w = self.turns * TAU
        T = norm(V(-math.sin(a) * rr * w + math.cos(a) * self.pr_drop, math.cos(a) * rr * w + math.sin(a) * self.pr_drop,
                   self.rise))
        N = V(math.cos(a), math.sin(a), 0)
        U = norm(np.cross(N, T))
        N = norm(np.cross(T, U))
        return T, N, U

    def local(self, t, u, w):
        """World point of local cross-section coordinates (u, w) in units of R(t)."""
        _, N, U = self.frame(t)
        Rr = float(self.R(t))
        return self.point(t) + N * (u * Rr) + U * (w * Rr)

    def d(self, X, Y, Z):
        X, Y, Z = np.broadcast_arrays(np.asarray(X, float), np.asarray(Y, float), np.asarray(Z, float))
        th = np.arctan2(Y, X)
        r = np.hypot(X, Y)
        out = np.full(X.shape, FAR)
        for m in (0, -1, -2, -3):
            t = 1 - (self.end - th - TAU * m) / (self.turns * TAU)
            tc = np.clip(t, 0, 1)
            d2 = polygon_sdf(r - self.rr(tc), Z - (self.z0 + tc * self.rise), self.R(tc), self.pv, self.pn)
            over = np.maximum(-t, t - 1) * self.L
            np.minimum(out, np.maximum(d2, over), out=out)
        return out


class CarvedPath(Prim):
    """Polygon profile swept along a polyline with per-point radii; segments blend with smin(k).

    Local frame per segment: T along, U = `up` made orthogonal to T, N = T x U (flipped toward `u_ref` when
    given, so an asymmetric profile keeps its outer side pointing the right way). Interior joints are
    extended by the local radius so bends never open a wedge; the chain ends are flat cuts.
    """

    def __init__(self, pts, radii, profile, k=.04, up=(0, 0, 1), u_ref=None):
        pts = [V(p) for p in pts]
        if np.isscalar(radii):
            radii = [float(radii)] * len(pts)
        self.pv, self.pn = profile_normals(profile)
        self.k = float(k)
        self.segs = []
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            e = b - a
            L = float(np.linalg.norm(e))
            T = e / L
            U = V(up) - T * float(np.dot(V(up), T))
            if np.linalg.norm(U) < 1e-6:
                U = V(1, 0, 0) - T * float(T[0])
            U = norm(U)
            N = np.cross(T, U)
            if u_ref is not None and float(np.dot(N, V(u_ref))) < 0:
                N = -N
            ext0 = radii[i] if i > 0 else 0.0
            ext1 = radii[i + 1] if i + 1 < len(pts) - 1 else 0.0
            self.segs.append((a, T, N, U, L, float(radii[i]), float(radii[i + 1]), ext0, ext1))
        m = float(np.abs(self.pv).max()) * max(radii) + self.k + .02
        P = np.array(pts)
        self.lo, self.hi = P.min(axis=0) - m, P.max(axis=0) + m

    def frame_at(self, i, s):
        a, T, N, U, L, ra, rb, _, _ = self.segs[i]
        return a + T * s, T, N, U, ra + (rb - ra) * s / L

    def d(self, X, Y, Z):
        X, Y, Z = np.broadcast_arrays(np.asarray(X, float), np.asarray(Y, float), np.asarray(Z, float))
        out = np.full(X.shape, FAR)
        for a, T, N, U, L, ra, rb, ext0, ext1 in self.segs:
            dx, dy, dz = X - a[0], Y - a[1], Z - a[2]
            s = dx * T[0] + dy * T[1] + dz * T[2]
            u = dx * N[0] + dy * N[1] + dz * N[2]
            w = dx * U[0] + dy * U[1] + dz * U[2]
            sc = np.clip(s, 0, L)
            Rr = ra + (rb - ra) * sc / L
            d2 = polygon_sdf(u, w, Rr, self.pv, self.pn)
            over = np.maximum(-s - ext0, s - L - ext1)
            out = smin(out, np.maximum(d2, over), self.k)
        return out


# ----------------------------------------------------------------------------- faceted cobra head
def carved_head(S, c, s, M=None, eyes=True, open_mouth=True, fangs=True):
    """Articulated carved head (unit design scaled by s, frame M; forward = local -Y). Returns eye data."""
    c = V(c)
    M = np.eye(3) if M is None else np.asarray(M, float)

    def P(x, y, z):
        return c + M @ (V(x, y, z) * s)

    def box(center, half, r=0.0, Ml=None):
        return RoundBox(P(*center), V(*half) * s, M=M if Ml is None else M @ Ml, r=r * s)

    def ell(center, radii):
        return Ellipsoid(P(*center), V(*radii) * s, M=M)

    def hs(point, n):
        return HalfSpace(P(*point), M @ V(*n))

    # cranium block: flat top, side planes tapering toward the crown (viper skull, wide at the jaw)
    cranium = Inter(box((0, .02, .06), (.25, .24, .15), r=.05),
                    hs((.25, 0, .02), (.94, 0, .34)), hs((-.25, 0, .02), (-.94, 0, .34)))
    S.add(cranium, 0, 'stone')
    # two brow ridges over the eyes (tilted so their front edge drops), a nasal ridge down the muzzle
    for side in (-1, 1):
        S.add(box((side * .145, -.17, .165), (.13, .14, .04), r=.012, Ml=rot(rx=12, rz=side * -8)), .01, 'stone')
    S.add(box((0, -.31, .055), (.035, .22, .04), r=.01, Ml=rot(rx=-10)), .008, 'stone')
    # tapered muzzle wedge with a sloping snout plane
    taper = ((.20, -.21, 0), (.989, -.145, 0))
    muzzle = Inter(box((0, -.38, -.03), (.20, .18, .10), r=.03),
                   hs(taper[0], taper[1]), hs((-taper[0][0], taper[0][1], 0), (-taper[1][0], taper[1][1], 0)),
                   hs((0, -.24, .07), (0, -.42, .907)))
    S.add(muzzle, .012, 'stone')
    # throat block and hinged lower jaw
    S.add(box((0, -.08, -.19), (.21, .18, .10), r=.04), .02, 'stone')
    jaw = Inter(box((0, -.33, -.235), (.18, .19, .05), r=.02),
                hs((.18, -.21, 0), taper[1]), hs((-.18, -.21, 0), (-taper[1][0], taper[1][1], 0)))
    S.add(jaw, .01, 'stone')
    if open_mouth:
        S.sub(box((0, -.40, -.15), (.16, .22, .035)), 0)
    if fangs:
        for side in (-1, 1):
            S.add(RoundCone(P(side * .10, -.50, -.135), P(side * .10, -.51, -.265), .032 * s, .008 * s), 0, 'stone')
    for side in (-1, 1):
        S.sub(ell((side * .185, -.27, .07), (.07, .07, .06)), 0)
        if eyes:
            S.add(ell((side * .185, -.26, .065), (.04, .04, .036)), 0, 'stone')
        S.sub(Sphere(P(side * .065, -.545, -.02), .022 * s), 0)
    return {'eyes': [P(side * .185, -.26, .065).tolist() for side in (-1, 1)] if eyes else [], 'eye_r': .046 * s}


def scale_plate(p, T, nrm, length, width, thick, tilt_deg):
    """One carved scale: a thin flat plate on the surface, tilted so its free edge (toward the tail, -T)
    stands proud and its root end sinks flush; the free end is cut to a point (lozenge)."""
    th = math.radians(tilt_deg)
    Tt = norm(T * math.cos(th) - nrm * math.sin(th))
    nt = norm(nrm * math.cos(th) + T * math.sin(th))
    across = norm(np.cross(nt, Tt))
    M = np.stack([Tt, across, nt], axis=1)
    c = V(p) + nrm * (thick * .6)
    box = RoundBox(c, V(length * .5, width * .5, thick * .5), M=M, r=.008)
    tip = c - Tt * (length * .5)
    cuts = [HalfSpace(tip + across * (side * width * .5), M @ norm(V(-.75, side * 1.0, 0))) for side in (-1, 1)]
    return Inter(box, *cuts)


def _chip(S, rng, center, half, tilt=40.0):
    """One chisel chip: a randomly tilted hard box subtracted at an edge (rooted into existing volume)."""
    M = rot(*rng.uniform(-tilt, tilt, 3))
    S.sub(RoundBox(V(center), V(half), M=M, r=.012), 0)


# ----------------------------------------------------------------------------- cobra hood (shield)
def shield_prims(cx, cz, rx, rz, taper_x, taper_z, inset=0.0):
    """Outline of a cobra hood in the XZ plane: an elliptic top + two straight tapering sides down to the neck.
    Returns prims to intersect (a Y-infinite ellipsoid + two half-spaces) and an inside() test."""
    rx_i, rz_i = rx - inset, rz - inset
    prims = [Ellipsoid(V(cx, 0, cz), V(rx_i, 50.0, rz_i))]
    tests = []
    for side in (-1, 1):
        # side line from the widest point (side*rx, cz) down to (side*taper_x, taper_z)
        d = V(side * (taper_x - rx), 0, taper_z - cz)
        n = norm(V(side * abs(d[2]), 0, -abs(d[0])))        # outward: sideways and down
        c = V(side * rx, 0, cz) - n * inset
        prims.append(HalfSpace(c, n))
        tests.append((c, n))

    def inside(p):
        if ((p[0] - cx) / rx_i) ** 2 + ((p[2] - cz) / rz_i) ** 2 >= 1.0:
            return False
        return all(float(np.dot(V(p) - c, n)) < 0 for c, n in tests)
    return prims, inside


def cobra_hood(S, c, rng, meta, chips=True):
    """Carved cobra hood: lens-thick shield with centre plate, angled facets, rim, recessed fields, spine
    plate, radial rib grooves. c: a hood config dict (see CONFIG['pillar']['hood'])."""
    cx, cy, cz = c['center']
    rx, ry, rz = c['radii']
    phi, psi, cw = math.radians(c['facet_deg']), math.radians(c['back_deg']), c['centre_w']
    yf, yb = cy - ry, cy + ry
    n_l = V(-math.sin(phi), -math.cos(phi), 0)
    n_r = V(math.sin(phi), -math.cos(phi), 0)
    outline, _ = shield_prims(cx, cz, rx, rz, c['taper_x'], c['taper_z'])
    slab = Inter(*outline,
                 HalfSpace(V(0, yf, 0), V(0, -1, 0)), HalfSpace(V(-cw, yf, 0), n_l), HalfSpace(V(cw, yf, 0), n_r),
                 HalfSpace(V(0, yb, 0), V(0, 1, 0)),
                 HalfSpace(V(-cw, yb, 0), V(-math.sin(psi), math.cos(psi), 0)),
                 HalfSpace(V(cw, yb, 0), V(math.sin(psi), math.cos(psi), 0)))
    lo, hi = V(cx - rx, yf - .02, c['taper_z'] - .02), V(cx + rx, yb + .02, cz + rz + .02)
    S.add(Bounded(slab, lo, hi), 0, 'stone')
    # recessed fields in the side facets inside a rolled rim (floor parallel to each facet)
    inner, inside = shield_prims(cx, cz, rx, rz, c['taper_x'], c['taper_z'], inset=c['rim'])
    for side, n in ((-1, n_l), (1, n_r)):
        c_floor = V(side * cw, yf, 0) - n * c['field_depth']
        field = Inter(*inner, HalfSpace(c_floor, -n), HalfSpace(V(side * c['field_x0'], 0, 0), V(-side, 0, 0)))
        S.sub(Bounded(field, V(min(cx, side * rx + cx), yf - .4, lo[2]), V(max(cx, side * rx + cx), yf + .5, hi[2])), 0)
    # proud tapered spine plate on the centre plate
    sp = c['spine']
    plate = Inter(RoundBox(V(cx, yf - sp['proud'] + sp['half_y'], sp['z']), V(sp['top_w'], sp['half_y'], sp['half_z']), r=.02),
                  HalfSpace(V(cx + sp['bot_w'], 0, sp['z'] - sp['half_z']), norm(V(sp['half_z'] * 2, 0, -(sp['top_w'] - sp['bot_w'])))),
                  HalfSpace(V(cx - sp['bot_w'], 0, sp['z'] - sp['half_z']), norm(V(-sp['half_z'] * 2, 0, -(sp['top_w'] - sp['bot_w'])))))
    S.add(plate, 0, 'stone')
    # radial rib grooves (rays from the neck root) carved into each side field, aligned with its facet
    for side, n in ((-1, n_l), (1, n_r)):
        e_depth = -n
        e_side = norm(np.cross(V(0, 0, 1), e_depth))
        e_side = e_side * (1 if float(e_side[0]) * side > 0 else -1)
        for ang in c['rib_deg']:
            a = math.radians(ang)
            z_in = c['rib_root'] + cw / math.tan(a)
            start = V(cx + side * cw, yf, z_in) + e_side * c['rib_in']
            e_along = norm(e_side * math.sin(a) + V(0, 0, 1) * math.cos(a))
            s_end = 0.0
            for s in np.arange(0.0, 2.0, .01):
                if not inside(start + e_along * s):
                    break
                s_end = s
            s_end -= c['rib_margin']
            if s_end <= .12:
                continue
            mid = start + e_along * s_end * .5 - e_depth * .02
            e_across = np.cross(e_depth, e_along)
            S.sub(RoundBox(mid, V(c['rib_w'], .12, s_end * .5), M=np.stack([e_across, e_depth, e_along], axis=1), r=.01), 0)
    if chips:
        for ang in c['chip_deg']:
            a = math.radians(ang)
            x = cx + (rx - .04) * math.cos(a)
            z = cz + (rz - .04) * math.sin(a)
            y = yf + max(abs(x - cx) - cw, 0) * math.tan(phi)
            _chip(S, rng, (x, y, z), c['chip_half'])
            meta['chips'] += 1


# ----------------------------------------------------------------------------- pillar
def pillar_sculpt(cfg, detail=True):
    c = cfg['pillar']
    rng = np.random.default_rng(cfg['seed'])
    S = Sculpt(materials=('stone',), default_mat='stone')
    helix = CarvedHelix(c)
    S.add(helix, 0, 'stone')
    meta = {'scales': 0, 'belly_joints': 0, 'chips': 0}
    if detail:
        # two staggered rows of broad flat scales (crown plane / upper flank), jittered pitch: a designed
        # band of legible scales, not a zipper
        for row, (uw, phase) in enumerate(zip(c['scale_uw'], (0.0, 0.5))):
            t = c['scale_start'] + phase * c['scale_pitch'] / helix.L
            while t < .985:
                T, N, U = helix.frame(t)
                p = helix.local(t, uw[0], uw[1])
                nrm = norm(N * uw[0] + U * uw[1])
                S.add(scale_plate(p, T, nrm, c['scale_len'], c['scale_w'], c['scale_thick'], c['scale_tilt_deg']), 0, 'stone')
                meta['scales'] += 1
                t += c['scale_pitch'] * rng.uniform(.86, 1.16) / helix.L
        # belly joints across the flat belly plate (varied pitch, never a uniform rail)
        t = c['joint_start']
        while t < .97:
            T, N, U = helix.frame(t)
            p = helix.local(t, c['joint_uw'][0], c['joint_uw'][1])
            S.sub(RoundBox(p, V(.02, float(helix.R(t)) * .52, .045), M=np.stack([T, N, U], axis=1)), 0)
            meta['belly_joints'] += 1
            t += c['joint_pitch'] * rng.uniform(.88, 1.14) / helix.L
        # chisel chips at the outer edge, camera-facing half only
        done = 0
        while done < c['coil_chips']:
            t = rng.uniform(.25, .97)
            if math.sin(helix.angle(t)) > -.25:
                continue
            p = helix.local(t, c['chip_uw'][0], c['chip_uw'][1])
            _chip(S, rng, p, (.10, .08, .065))
            done += 1
        meta['chips'] += done
    # neck: a carved symmetric profile (flat throat underneath) from the helix end up into the head's throat
    end = helix.point(1.0)
    nk = [end] + [V(*p) for p in c['neck_points']]
    neck = CarvedPath(nk, c['neck_radii'], c['neck_profile'], k=.05, up=(0, 0, 1))
    S.add(neck, .10, 'stone')
    if detail:
        for i, s_frac in enumerate(c['neck_joints']):
            seg = min(int(s_frac * len(neck.segs)), len(neck.segs) - 1)
            s = (s_frac * len(neck.segs) - seg) * neck.segs[seg][4]
            p, T, N, U, r = neck.frame_at(seg, s)
            S.sub(RoundBox(p - U * (r * .80), V(.02, r * .6, .045), M=np.stack([T, N, U], axis=1)), 0)
            meta['belly_joints'] += 1
    # hood root block: fuses hood, neck and the retained shaft
    S.add(RoundBox(V(*c['hood_root']), V(*c['hood_root_half']), r=.12), .08, 'stone')
    cobra_hood(S, c['hood'], rng, meta, chips=detail)
    hd = c['head']
    meta['head'] = carved_head(S, hd['center'], hd['scale'], M=head_frame(hd['forward']), eyes=True)
    return S, meta


# ----------------------------------------------------------------------------- throne
def throne_sculpt(cfg):
    c = cfg['throne']
    rng = np.random.default_rng(cfg['seed'] + 7)
    S = Sculpt(materials=('stone',), default_mat='stone')
    meta = {'chips': 0, 'relief_joints': 0}
    sl = c['slab']
    yf = sl['center'][1] - sl['half'][1]
    slab = RoundBox(V(*sl['center']), V(*sl['half']), r=.035)
    ch = sl['chamfer']
    top, xw = sl['center'][2] + sl['half'][2], sl['half'][0]
    slab = Inter(slab, HalfSpace(V(-xw, 0, top - ch), norm(V(-1, 0, 1))), HalfSpace(V(xw, 0, top - ch), norm(V(1, 0, 1))))
    S.add(slab, 0, 'stone')
    # crest: a smaller cobra hood rising from the slab top, then the head pitched over the seat
    cobra_hood(S, c['hood'], rng, meta, chips=False)
    # recessed framed panel
    pn = c['panel']
    S.sub(RoundBox(V(0, yf, pn['z']), V(pn['half_x'], pn['depth'], pn['half_z']), r=.02), 0)
    floor_y = yf + pn['depth']
    # two broad intertwined ridge-carved serpent bodies rising into the crest (segmented relief)
    for side, pts in ((1, c['relief_path']), (-1, [(-x, z) for x, z in c['relief_path']])):
        pts3 = [V(x, floor_y + c['relief_sink'] - c['relief_front'][i] * side * c['relief_cross'], z)
                for i, (x, z) in enumerate(pts)]
        body = CarvedPath(pts3, c['relief_r'], c['relief_profile'], k=.03, up=(0, -1, 0))
        S.add(body, 0, 'stone')
        s_acc, pitch = c['relief_joint_start'], c['relief_joint_pitch']
        for i, seg in enumerate(body.segs):
            L = seg[4]
            while s_acc < L:
                p, T, N, U, r = body.frame_at(i, s_acc)
                S.sub(RoundBox(p + U * r, V(r * 1.3, c['relief_joint_depth'], .012), M=np.stack([N, U, T], axis=1)), 0)
                meta['relief_joints'] += 1
                s_acc += pitch * rng.uniform(.85, 1.15)
            s_acc -= L
    hd = c['head']
    meta['head'] = carved_head(S, hd['center'], hd['scale'], M=head_frame(hd['forward']), eyes=True)
    # carved armrests (helix profile, outer side outward) with heads, grounded by a tapering tail loop
    arm = c['arm']
    meta['arm_eyes'] = []
    for side in (-1, 1):
        body = [V(side * x, y, z) for x, y, z in arm['body']]
        S.add(CarvedPath(body, arm['body_radii'], cfg['pillar']['profile'], k=.04, up=(0, 0, 1), u_ref=(side, 0, 0)), .02, 'stone')
        tail = [V(side * x, y, z) for x, y, z in arm['tail']]
        S.add(CarvedPath(tail, arm['tail_radii'], cfg['pillar']['profile'], k=.04, up=(0, 0, 1), u_ref=(side, 0, 0)), .05, 'stone')
        hx, hy, hz = arm['head_center']
        fx, fy, fz = arm['head_forward']
        h = carved_head(S, (side * hx, hy, hz), arm['head_scale'], M=head_frame((side * fx, fy, fz)), eyes=True)
        meta['arm_eyes'].append(h)
        p = body[1] + V(side * (arm['body_radii'][1] * .95), 0, -.02)
        _chip(S, rng, p, (.08, .07, .05))
        meta['chips'] += 1
    for x, y, z in c['slab_chips']:
        _chip(S, rng, (x, y, z), (.11, .10, .08))
        meta['chips'] += 1
    return S, meta


# ----------------------------------------------------------------------------- normals from the field
def sdf_split_arrays(S, P, T, angle_deg, pull=.3):
    """Per-vertex normals from the sculpt field, split at carved creases.

    Faces are grouped around each vertex by their field normal (at the face centre); groups further apart
    than angle_deg become separate vertices. A group's normal is the field gradient sampled slightly inside
    each member face, so flat facets shade flat and curved coils shade smooth. Returns (P2, N2, T2, splits).
    """
    P = np.asarray(P, float)
    T = np.asarray(T, np.int64)
    FC = P[T].mean(axis=1)
    GN = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    GN /= np.maximum(np.linalg.norm(GN, axis=1, keepdims=True), 1e-12)
    NF = S.grad(FC)
    bad = np.linalg.norm(NF, axis=1) < .5                      # degenerate gradient: use the face normal
    NF[bad] = GN[bad]
    corner = (P[T] + pull * (FC[:, None, :] - P[T])).reshape(-1, 3)
    NC = S.grad(corner).reshape(-1, 3, 3)
    badc = np.linalg.norm(NC, axis=2) < .5
    NC[badc] = np.repeat(GN[:, None, :], 3, axis=1)[badc]
    cos_thr = math.cos(math.radians(angle_deg))
    nv = len(P)
    incident = [[] for _ in range(nv)]
    for f in range(len(T)):
        for k in range(3):
            incident[T[f, k]].append((f, k))
    newP, newN, T2 = [], [], np.empty_like(T)
    splits = 0
    for v in range(nv):
        groups = []
        for f, k in incident[v]:
            n = NF[f]
            best = None
            for g in groups:
                m = g[0] / (np.linalg.norm(g[0]) + 1e-12)
                if float(np.dot(m, n)) > cos_thr:
                    best = g
                    break
            if best is None:
                groups.append([n.copy(), NC[f, k].copy(), [(f, k)]])
            else:
                best[0] += n
                best[1] += NC[f, k]
                best[2].append((f, k))
        if not groups:
            continue
        splits += len(groups) - 1
        for g in groups:
            idx = len(newP)
            newP.append(P[v])
            n = g[1] if np.linalg.norm(g[1]) > 1e-6 else g[0]
            if np.linalg.norm(n) <= 1e-6:
                n = GN[g[2][0][0]]
            newN.append(norm(n))
            for f, k in g[2]:
                T2[f, k] = idx
    return np.asarray(newP, np.float32), np.asarray(newN, np.float32), T2.astype(np.int32), splits


# ----------------------------------------------------------------------------- vertex occlusion
def fibonacci_hemisphere(n):
    i = np.arange(n) + .5
    z = i / n
    r = np.sqrt(1 - z * z)
    phi = i * (math.pi * (3 - math.sqrt(5)))
    return np.stack([r * np.cos(phi), r * np.sin(phi), z], axis=1), z


def bake_vertex_ao(P, N, bvh, rays=20, max_dist=.5, bias=.006):
    """Cosine-weighted hemisphere occlusion per vertex against a BVH (0 open .. 1 buried)."""
    from mathutils import Vector
    dirs, cosw = fibonacci_hemisphere(rays)
    out = np.zeros(len(P))
    for i in range(len(P)):
        n = N[i]
        a = V(1, 0, 0) if abs(n[0]) < .8 else V(0, 1, 0)
        t = norm(np.cross(n, a))
        b = np.cross(n, t)
        o = Vector((P[i] + n * bias).tolist())
        occ = 0.0
        for d, w in zip(dirs, cosw):
            wd = t * d[0] + b * d[1] + n * d[2]
            hit = bvh.ray_cast(o, Vector(wd.tolist()), max_dist)
            if hit[0] is not None:
                occ += w * (1 - hit[3] / max_dist) ** .6
        out[i] = occ / cosw.sum()
    return out


# ----------------------------------------------------------------------------- compact GLB writer
def write_forms_glb(template_doc, replacements, path):
    """Three-node GLB with ONLY the replacement payloads (no stale donor buffers).

    nodes / scenes / asset are copied from the live supplement's JSON (same names, order and identity
    transforms); each mesh keeps one primitive with POSITION / NORMAL / COLOR_0 float32 + uint32 indices.
    """
    doc = {'asset': copy.deepcopy(template_doc['asset']), 'scene': template_doc['scene'],
           'scenes': copy.deepcopy(template_doc['scenes']), 'nodes': copy.deepcopy(template_doc['nodes']),
           'meshes': [], 'accessors': [], 'bufferViews': [], 'buffers': [{'byteLength': 0}]}
    binary = bytearray()

    def append(data, typ, component, bounds=False):
        data = np.ascontiguousarray(data)
        assert np.isfinite(data).all()
        binary.extend(b'\0' * (-len(binary) % 4))
        vi = len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': data.nbytes})
        binary.extend(data.tobytes())
        a = {'bufferView': vi, 'componentType': component, 'count': int(len(data)), 'type': typ}
        if bounds:
            a['min'] = [float(x) for x in data.min(axis=0)]
            a['max'] = [float(x) for x in data.max(axis=0)]
        doc['accessors'].append(a)
        return len(doc['accessors']) - 1

    for mi, tmesh in enumerate(template_doc['meshes']):
        node = next(n for n in doc['nodes'] if n['mesh'] == mi)
        attrs, tris = replacements[node['name']]
        prim = {'attributes': {}, 'mode': 4}
        prim['attributes']['POSITION'] = append(np.asarray(attrs['POSITION'], '<f4'), 'VEC3', 5126, bounds=True)
        prim['attributes']['NORMAL'] = append(np.asarray(attrs['NORMAL'], '<f4'), 'VEC3', 5126)
        prim['attributes']['COLOR_0'] = append(np.asarray(attrs['COLOR_0'], '<f4'), 'VEC4', 5126)
        prim['indices'] = append(np.asarray(tris, '<u4').reshape(-1), 'SCALAR', 5125)
        doc['meshes'].append({'name': tmesh['name'], 'primitives': [prim]})
    doc['buffers'][0]['byteLength'] = len(binary)
    raw = json.dumps(doc, separators=(',', ':'), sort_keys=True, ensure_ascii=True, allow_nan=False).encode()
    raw += b' ' * (-len(raw) % 4)
    binary.extend(b'\0' * (-len(binary) % 4))
    blob = (struct.pack('<4sII', b'glTF', 2, 28 + len(raw) + len(binary)) +
            struct.pack('<I4s', len(raw), b'JSON') + raw + struct.pack('<I4s', len(binary), b'BIN\0') + bytes(binary))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(blob)
    return hashlib.sha256(blob).hexdigest(), len(blob)
