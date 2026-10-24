"""KnotzCopperAx procedural SDF sculpting core (numpy + OpenVDB meshing).

Blender coordinates throughout: Z up, character faces -Y, character's LEFT is +X.

A `Sculpt` is an ordered list of CSG ops applied to an accumulator distance field:
    add(prim, k, mat)   smooth union (k = blend radius in metres, 0 = hard min)
    sub(prim, k)        smooth subtraction
    paint(prim, chan)   no geometry; writes a soft mask channel (evaluated at mesh vertices only)
Every primitive exposes `d(X, Y, Z)` over broadcastable arrays and an AABB, so evaluation is culled to
each op's bounding box. `polygonize()` evaluates the field in narrow-band chunks and meshes it with
OpenVDB (convertToPolygons), which returns watertight quad meshes.
"""
import math
import time
import numpy as np

FAR = 1.0e3
F32 = np.float32
# evaluation context: lets a Snapshot reuse its owner's accumulator instead of re-evaluating every body op
# (identity-matched on the coordinate arrays, so warped/transformed lookups fall back to a full evaluation)
_CTX = None


# ----------------------------------------------------------------------------- vector helpers
def V(*a):
    if len(a) == 1:
        return np.asarray(a[0], dtype=np.float64)
    return np.asarray(a, dtype=np.float64)


def norm(v):
    v = np.asarray(v, dtype=np.float64)
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-12 else v * 0.0


def lerp(a, b, t):
    return V(a) + (V(b) - V(a)) * t


def basis(axis, ref=(0.0, -1.0, 0.0)):
    """3x3 matrix whose COLUMNS are an orthonormal frame: col0 along `axis`, col1 = `ref` made orthogonal."""
    e0 = norm(axis)
    r = V(ref) - e0 * float(np.dot(V(ref), e0))
    if np.linalg.norm(r) < 1e-6:
        alt = V(0, 0, 1) if abs(e0[2]) < 0.9 else V(1, 0, 0)
        r = alt - e0 * float(np.dot(alt, e0))
    e1 = norm(r)
    e2 = np.cross(e0, e1)
    return np.stack([e0, e1, e2], axis=1)


def rot(rx=0.0, ry=0.0, rz=0.0):
    """Rotation matrix from XYZ euler degrees (applied X then Y then Z)."""
    rx, ry, rz = (math.radians(a) for a in (rx, ry, rz))
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def axis_angle(axis, deg):
    a = norm(axis)
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    x, y, z = a
    return np.array([[c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
                     [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
                     [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])


def _local(X, Y, Z, c, M):
    dx, dy, dz = X - c[0], Y - c[1], Z - c[2]
    lx = M[0, 0] * dx + M[1, 0] * dy + M[2, 0] * dz
    ly = M[0, 1] * dx + M[1, 1] * dy + M[2, 1] * dz
    lz = M[0, 2] * dx + M[1, 2] * dy + M[2, 2] * dz
    return lx, ly, lz


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


# ----------------------------------------------------------------------------- noise
_RNG = np.random.RandomState(20260922)
_TAB = (_RNG.rand(4096) * 2.0 - 1.0).astype(np.float64)


def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    return _TAB[(h ^ (h >> 13)) & 4095]


def vnoise(X, Y, Z, seed=0):
    """Smooth value noise in [-1, 1] over broadcastable arrays."""
    X, Y, Z = np.broadcast_arrays(np.asarray(X, float), np.asarray(Y, float), np.asarray(Z, float))
    fx, fy, fz = np.floor(X), np.floor(Y), np.floor(Z)
    ix, iy, iz = fx.astype(np.int64), fy.astype(np.int64), fz.astype(np.int64)
    tx, ty, tz = X - fx, Y - fy, Z - fz
    ux = tx * tx * tx * (tx * (tx * 6 - 15) + 10)
    uy = ty * ty * ty * (ty * (ty * 6 - 15) + 10)
    uz = tz * tz * tz * (tz * (tz * 6 - 15) + 10)
    out = 0.0
    for dz in (0, 1):
        wz = uz if dz else (1 - uz)
        for dy in (0, 1):
            wy = uy if dy else (1 - uy)
            for dx in (0, 1):
                wx = ux if dx else (1 - ux)
                out = out + _hash(ix + dx, iy + dy, iz + dz, seed) * wx * wy * wz
    return out


def fbm(X, Y, Z, octaves=4, freq=1.0, lac=2.03, gain=0.5, seed=0):
    amp, tot, s = 1.0, 0.0, 0.0
    for o in range(octaves):
        s = s + amp * vnoise(X * freq, Y * freq, Z * freq, seed + o * 17)
        tot += amp
        amp *= gain
        freq *= lac
    return s / tot


# ----------------------------------------------------------------------------- primitives
class Prim:
    lo = None
    hi = None

    def d(self, X, Y, Z):
        raise NotImplementedError

    def bounds(self):
        return self.lo, self.hi


class Sphere(Prim):
    def __init__(self, c, r):
        self.c, self.r = V(c), float(r)
        self.lo, self.hi = self.c - self.r, self.c + self.r

    def d(self, X, Y, Z):
        c = self.c
        return np.sqrt((X - c[0]) ** 2 + (Y - c[1]) ** 2 + (Z - c[2]) ** 2) - self.r


class Ellipsoid(Prim):
    """Ellipsoid with radii r (local x,y,z) and frame M (columns = local axes in world)."""

    def __init__(self, c, r, M=None):
        self.c, self.r = V(c), V(r)
        self.M = np.eye(3) if M is None else np.asarray(M, float)
        ext = np.sqrt(((self.M * self.r[None, :]) ** 2).sum(axis=1))
        self.lo, self.hi = self.c - ext, self.c + ext

    def d(self, X, Y, Z):
        lx, ly, lz = _local(X, Y, Z, self.c, self.M)
        rx, ry, rz = self.r
        k0 = np.sqrt((lx / rx) ** 2 + (ly / ry) ** 2 + (lz / rz) ** 2)
        k1 = np.sqrt((lx / (rx * rx)) ** 2 + (ly / (ry * ry)) ** 2 + (lz / (rz * rz)) ** 2)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


class RoundCone(Prim):
    """Capsule from a (radius ra) to b (radius rb). Optional elliptic cross-section: squash=(s1, s2) scales
    the section along frame axes col1/col2 (col1 = `ref` orthogonalised, default forward -Y)."""

    def __init__(self, a, b, ra, rb=None, squash=(1.0, 1.0), ref=(0.0, -1.0, 0.0)):
        self.a, self.b = V(a), V(b)
        self.ra = float(ra)
        self.rb = float(ra if rb is None else rb)
        self.L = float(np.linalg.norm(self.b - self.a))
        self.M = basis(self.b - self.a if self.L > 1e-9 else (0, 0, 1), ref)
        self.s1, self.s2 = float(squash[0]), float(squash[1])
        r = max(self.ra, self.rb) * max(self.s1, self.s2, 1.0)
        self.lo = np.minimum(self.a, self.b) - r
        self.hi = np.maximum(self.a, self.b) + r

    def d(self, X, Y, Z):
        u, v, w = _local(X, Y, Z, self.a, self.M)
        if self.s1 != 1.0:
            v = v / self.s1
        if self.s2 != 1.0:
            w = w / self.s2
        L = max(self.L, 1e-6)
        r1, r2 = self.ra, self.rb
        l2 = L * L
        rr = r1 - r2
        a2 = l2 - rr * rr
        il2 = 1.0 / l2
        y = u * L
        z = y - l2
        x2 = (v * v + w * w) * l2 * l2
        y2 = y * y * l2
        z2 = z * z * l2
        k = math.copysign(1.0, rr) * rr * rr * x2 if rr != 0 else 0.0 * x2
        d1 = np.sqrt(x2 + z2) * il2 - r2
        d2 = np.sqrt(x2 + y2) * il2 - r1
        d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - r1
        res = np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))
        sm = min(self.s1, self.s2, 1.0)
        return res * sm if sm != 1.0 else res


def Capsule(a, b, r, **kw):
    return RoundCone(a, b, r, r, **kw)


class RoundBox(Prim):
    def __init__(self, c, half, M=None, r=0.0):
        self.c, self.h = V(c), V(half)
        self.M = np.eye(3) if M is None else np.asarray(M, float)
        self.r = float(r)
        ext = np.sqrt(((self.M * self.h[None, :]) ** 2).sum(axis=1)) + 1e-4
        self.lo, self.hi = self.c - ext, self.c + ext

    def d(self, X, Y, Z):
        lx, ly, lz = _local(X, Y, Z, self.c, self.M)
        r = self.r
        qx = np.abs(lx) - self.h[0] + r
        qy = np.abs(ly) - self.h[1] + r
        qz = np.abs(lz) - self.h[2] + r
        out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2)
        return out + np.minimum(np.maximum(qx, np.maximum(qy, qz)), 0.0) - r


class Torus(Prim):
    """Torus in the local XY plane of frame M (local Z = axis). squash scales the tube along the axis."""

    def __init__(self, c, R, r, M=None, squash=1.0):
        self.c, self.R, self.r = V(c), float(R), float(r)
        self.M = np.eye(3) if M is None else np.asarray(M, float)
        self.sq = float(squash)
        e = self.R + self.r * max(1.0, self.sq)
        self.lo, self.hi = self.c - e, self.c + e

    def d(self, X, Y, Z):
        lx, ly, lz = _local(X, Y, Z, self.c, self.M)
        q = np.sqrt(lx * lx + ly * ly) - self.R
        lz = lz / self.sq
        return (np.sqrt(q * q + lz * lz) - self.r) * min(1.0, self.sq)


class HalfSpace(Prim):
    """Solid on the side opposite to n: d = dot(p - c, n). Unbounded (use only inside Inter/Clip wrappers)."""

    def __init__(self, c, n):
        self.c, self.n = V(c), norm(n)
        self.lo, self.hi = V(-FAR, -FAR, -FAR), V(FAR, FAR, FAR)

    def d(self, X, Y, Z):
        return (X - self.c[0]) * self.n[0] + (Y - self.c[1]) * self.n[1] + (Z - self.c[2]) * self.n[2]


class Chain(Prim):
    """Union of round cones through points with per-point radii (tubes, lips, lids, straps, veins)."""

    def __init__(self, pts, radii, squash=(1.0, 1.0), ref=(0.0, -1.0, 0.0), k=0.0, margin=0.03):
        pts = [V(p) for p in pts]
        if np.isscalar(radii):
            radii = [radii] * len(pts)
        self.segs = [RoundCone(pts[i], pts[i + 1], radii[i], radii[i + 1], squash=squash, ref=ref)
                     for i in range(len(pts) - 1)]
        self.k = k
        self.margin = max(float(margin), 2.0 * k + 0.012)   # per-segment cull margin (exact inside it)
        self.lo = np.min([s.lo for s in self.segs], axis=0)
        self.hi = np.max([s.hi for s in self.segs], axis=0)

    def d(self, X, Y, Z):
        if len(self.segs) <= 3:
            out = None
            for s in self.segs:
                ds = s.d(X, Y, Z)
                out = ds if out is None else smin(out, ds, self.k)
            return out
        m = self.margin
        X, Y, Z = np.asarray(X, float), np.asarray(Y, float), np.asarray(Z, float)
        grid = (X.ndim == 3 and X.shape[1] == 1 and X.shape[2] == 1 and Y.ndim == 3 and Y.shape[0] == 1
                and Y.shape[2] == 1 and Z.ndim == 3 and Z.shape[0] == 1 and Z.shape[1] == 1)
        if grid:   # axis-aligned grid from eval_block: slice each segment's box
            xs, ys, zs = X[:, 0, 0], Y[0, :, 0], Z[0, 0, :]
            out = np.full((len(xs), len(ys), len(zs)), FAR)
            for s in self.segs:
                i0, i1 = np.searchsorted(xs, s.lo[0] - m), np.searchsorted(xs, s.hi[0] + m, "right")
                j0, j1 = np.searchsorted(ys, s.lo[1] - m), np.searchsorted(ys, s.hi[1] + m, "right")
                k0, k1 = np.searchsorted(zs, s.lo[2] - m), np.searchsorted(zs, s.hi[2] + m, "right")
                if i0 >= i1 or j0 >= j1 or k0 >= k1:
                    continue
                ds = s.d(xs[i0:i1, None, None], ys[None, j0:j1, None], zs[None, None, k0:k1])
                sub = out[i0:i1, j0:j1, k0:k1]
                sub[...] = smin(sub, ds, self.k)
            return out
        X, Y, Z = np.broadcast_arrays(X, Y, Z)
        shp = X.shape
        x, y, z = X.ravel(), Y.ravel(), Z.ravel()
        out = np.full(x.shape, FAR)
        for s in self.segs:
            idx = np.nonzero((x >= s.lo[0] - m) & (x <= s.hi[0] + m) & (y >= s.lo[1] - m) & (y <= s.hi[1] + m) &
                             (z >= s.lo[2] - m) & (z <= s.hi[2] + m))[0]
            if len(idx) == 0:
                continue
            out[idx] = smin(out[idx], s.d(x[idx], y[idx], z[idx]), self.k)
        return out.reshape(shp)


# ----------------------------------------------------------------------------- wrappers
class Offset(Prim):
    def __init__(self, p, r):
        self.p, self.r = p, float(r)
        self.lo, self.hi = p.lo - max(self.r, 0), p.hi + max(self.r, 0)

    def d(self, X, Y, Z):
        return self.p.d(X, Y, Z) - self.r


class Shell(Prim):
    def __init__(self, p, t):
        self.p, self.t = p, float(t)
        self.lo, self.hi = p.lo - self.t, p.hi + self.t

    def d(self, X, Y, Z):
        return np.abs(self.p.d(X, Y, Z)) - self.t


class Inter(Prim):
    """Smooth intersection of prims; bbox = intersection of bounded children."""

    def __init__(self, *prims, k=0.0):
        self.prims, self.k = prims, float(k)
        self.lo = np.max([p.lo for p in prims], axis=0)
        self.hi = np.min([p.hi for p in prims], axis=0)

    def d(self, X, Y, Z):
        out = self.prims[0].d(X, Y, Z)
        for p in self.prims[1:]:
            out = smax(out, p.d(X, Y, Z), self.k)
        return out


class Union(Prim):
    def __init__(self, *prims, k=0.0):
        self.prims, self.k = prims, float(k)
        self.lo = np.min([p.lo for p in prims], axis=0) - k
        self.hi = np.max([p.hi for p in prims], axis=0) + k

    def d(self, X, Y, Z):
        out = self.prims[0].d(X, Y, Z)
        for p in self.prims[1:]:
            out = smin(out, p.d(X, Y, Z), self.k)
        return out


class Diff(Prim):
    """a minus b (smooth)."""

    def __init__(self, a, b, k=0.0):
        self.a, self.b, self.k = a, b, float(k)
        self.lo, self.hi = a.lo, a.hi

    def d(self, X, Y, Z):
        return smax(self.a.d(X, Y, Z), -self.b.d(X, Y, Z), self.k)


class MirrorX(Prim):
    """Evaluate child at (-X, Y, Z): the mirrored copy of a part authored on one side."""

    def __init__(self, p):
        self.p = p
        self.lo = V(-p.hi[0], p.lo[1], p.lo[2])
        self.hi = V(-p.lo[0], p.hi[1], p.hi[2])

    def d(self, X, Y, Z):
        return self.p.d(-X, Y, Z)


class SymX(Prim):
    """Part authored on +X plus its mirror, smooth-unioned across the midline with blend k
    (k=0 -> plain union; a V-crease appears where the halves meet at x=0)."""

    def __init__(self, p, k=0.02):
        self.p, self.k = p, float(k)
        m = max(abs(p.lo[0]), abs(p.hi[0])) + self.k
        self.lo = V(-m, p.lo[1] - self.k, p.lo[2] - self.k)
        self.hi = V(m, p.hi[1] + self.k, p.hi[2] + self.k)

    def d(self, X, Y, Z):
        if np.ndim(X) and np.size(X) > 1 and self.p.lo[0] > self.k + 1e-4:
            # halves far apart: cheap exact path
            return self.p.d(np.abs(X), Y, Z)
        return smin(self.p.d(X, Y, Z), self.p.d(-X, Y, Z), self.k)


class Displace(Prim):
    """d + amp * fbm(p * freq). Keep amp small relative to features (field stays ~Lipschitz)."""

    def __init__(self, p, amp, freq, octaves=3, seed=0):
        self.p, self.amp, self.freq, self.oct, self.seed = p, float(amp), float(freq), octaves, seed
        self.lo, self.hi = p.lo - abs(amp), p.hi + abs(amp)

    def d(self, X, Y, Z):
        base = self.p.d(X, Y, Z)
        return base + self.amp * fbm(X, Y, Z, self.oct, self.freq, seed=self.seed)


class Warp(Prim):
    """Evaluate child at warped coordinates p + fn(p) (fn returns dx,dy,dz); bbox padded by `pad`."""

    def __init__(self, p, fn, pad=0.02):
        self.p, self.fn = p, fn
        self.lo, self.hi = p.lo - pad, p.hi + pad

    def d(self, X, Y, Z):
        dx, dy, dz = self.fn(X, Y, Z)
        return self.p.d(X + dx, Y + dy, Z + dz)


class Slab(Prim):
    """Infinite slab |dot(p - c, n)| <= half (use inside Inter/Bounded)."""

    def __init__(self, c, n, half):
        self.c, self.n, self.half = V(c), norm(n), float(half)
        self.lo, self.hi = V(-FAR, -FAR, -FAR), V(FAR, FAR, FAR)

    def d(self, X, Y, Z):
        return np.abs((X - self.c[0]) * self.n[0] + (Y - self.c[1]) * self.n[1] + (Z - self.c[2]) * self.n[2]) - self.half


class Bounded(Prim):
    """Declare a tight AABB for an expensive/unbounded prim (the shape must lie inside it)."""

    def __init__(self, p, lo, hi):
        self.p, self.lo, self.hi = p, V(lo), V(hi)

    def d(self, X, Y, Z):
        return self.p.d(X, Y, Z)


def box_dist(x, y, z, lo, hi):
    """Unsigned distance from points to an AABB (0 inside). A valid LOWER bound of the distance to anything
    contained in the box, used for ops culled by their bounds so far-away points still see a finite,
    correctly-oriented field (projection / collision never get stuck on FAR with a zero gradient)."""
    dx = np.maximum(np.maximum(lo[0] - x, x - hi[0]), 0.0)
    dy = np.maximum(np.maximum(lo[1] - y, y - hi[1]), 0.0)
    dz = np.maximum(np.maximum(lo[2] - z, z - hi[2]), 0.0)
    return np.sqrt(dx * dx + dy * dy + dz * dz)


def _far_fallback(d, x, y, z, ops):
    """Replace FAR entries by the min distance to the AABBs of the 'add' ops (lower bound, continuous)."""
    far = d >= FAR * 0.5
    if not far.any():
        return d
    idx = np.nonzero(far)[0]
    fb = np.full(len(idx), FAR)
    for op in ops:
        if op.kind == "add" and op.prim.hi[0] - op.prim.lo[0] < FAR:
            bd = box_dist(x[idx], y[idx], z[idx], op.lo, op.hi)
            # a box that CONTAINS the point but still returned FAR is uninformative (e.g. a big Bounded
            # gear region): skip it, otherwise the point sits on a zero-gradient plateau
            fb = np.minimum(fb, np.where(bd > 0.0, bd + 0.004, FAR))
    d = d.copy()
    d[idx] = fb
    return d


class Snapshot(Prim):
    """Frozen copy of a Sculpt's geometry ops, usable as a primitive (e.g. Offset(snapshot, 7 mm) for
    armour/boots/straps that conform exactly to the body)."""

    def __init__(self, sculpt):
        self.ops = [op for op in sculpt.ops if op.kind in ("add", "sub", "inter")]
        self.lo, self.hi = sculpt.bounds()
        self.n_ops = len(sculpt.ops)      # the owner's accumulator equals this field at op index n_ops
        self.cache, self.cache_tag = None, None

    def d(self, X, Y, Z):
        c = _CTX
        if (c is not None and self.cache is not None and self.cache_tag is c["tag"] and X is c["X"]
                and Y is c["Y"] and Z is c["Z"]):
            return self.cache[c["sel"]]
        X, Y, Z = np.broadcast_arrays(X, Y, Z)
        shp = X.shape
        x, y, z = X.ravel(), Y.ravel(), Z.ravel()
        d = np.full(x.shape, FAR)
        for op in self.ops:
            if op.kind == "inter":
                d = smax(d, op.prim.d(x, y, z), op.k)
                continue
            m = ((x >= op.lo[0]) & (x <= op.hi[0]) & (y >= op.lo[1]) & (y <= op.hi[1]) &
                 (z >= op.lo[2]) & (z <= op.hi[2]))
            idx = np.nonzero(m)[0]
            if len(idx) == 0:
                continue
            dp = np.broadcast_to(op.prim.d(x[idx], y[idx], z[idx]), idx.shape)
            if op.kind == "add":
                d[idx] = smin(d[idx], dp, op.k)
            else:
                d[idx] = smax(d[idx], -dp, op.k)
        return d.reshape(shp)


class Func(Prim):
    """Arbitrary callable field with explicit bounds."""

    def __init__(self, fn, lo, hi):
        self.fn, self.lo, self.hi = fn, V(lo), V(hi)

    def d(self, X, Y, Z):
        return self.fn(X, Y, Z)


# ----------------------------------------------------------------------------- sculpt
class Op:
    __slots__ = ("kind", "prim", "k", "mat", "chan", "soft", "value", "lo", "hi", "tag")

    def __init__(self, kind, prim, k=0.0, mat=None, chan=None, soft=0.0, value=1.0, tag=None):
        self.kind, self.prim, self.k, self.mat = kind, prim, float(k), mat
        self.chan, self.soft, self.value, self.tag = chan, float(soft), float(value), tag
        margin = 2.0 * self.k + 0.012 + self.soft
        self.lo = prim.lo - margin
        self.hi = prim.hi + margin


class Sculpt:
    def __init__(self, materials=("skin",), default_mat="skin"):
        self.ops = []
        self.materials = list(materials)
        self.default_mat = self.materials.index(default_mat)
        self.paint_channels = []
        self.snaps = []

    def mat_id(self, name):
        if name is None:
            return None
        if name not in self.materials:
            self.materials.append(name)
        return self.materials.index(name)

    def add(self, prim, k=0.0, mat=None, tag=None):
        self.ops.append(Op("add", prim, k, self.mat_id(mat), tag=tag))
        return prim

    def sub(self, prim, k=0.0, mat=None, tag=None):
        self.ops.append(Op("sub", prim, k, self.mat_id(mat), tag=tag))
        return prim

    def inter(self, prim, k=0.0):
        """Global (smooth) intersection: evaluated everywhere, keep prims cheap (half-spaces...)."""
        op = Op("inter", prim, k)
        op.lo, op.hi = V(-FAR, -FAR, -FAR), V(FAR, FAR, FAR)
        self.ops.append(op)
        return prim

    def snapshot(self):
        sn = Snapshot(self)
        self.snaps.append(sn)
        return sn

    def _snap_index(self, tag):
        by = {}
        for sn in self.snaps:
            sn.cache, sn.cache_tag = None, tag
            by.setdefault(sn.n_ops, []).append(sn)
        return by

    def paint(self, prim, chan, soft=0.004, value=1.0, mode="max"):
        if chan not in self.paint_channels:
            self.paint_channels.append(chan)
        self.ops.append(Op("paint", prim, 0.0, None, chan=chan, soft=soft, value=value, tag=mode))
        return prim

    def paint_mat(self, prim, mat):
        """Hard material override inside prim (no geometry change)."""
        self.ops.append(Op("pmat", prim, 0.0, self.mat_id(mat)))
        return prim

    def extend(self, other):
        for op in other.ops:
            if op.mat is not None:
                op.mat = self.mat_id(other.materials[op.mat])
            if op.kind == "paint" and op.chan not in self.paint_channels:
                self.paint_channels.append(op.chan)
            self.ops.append(op)

    def bounds(self):
        los = [op.prim.lo for op in self.ops if op.kind == "add"]
        his = [op.prim.hi for op in self.ops if op.kind == "add"]
        return np.min(los, axis=0), np.max(his, axis=0)

    # -- grid evaluation (geometry only) -------------------------------------------------------
    def eval_block(self, x0, h, shape):
        nx, ny, nz = shape
        D = np.full(shape, FAR, dtype=F32)
        xs = x0[0] + h * np.arange(nx)
        ys = x0[1] + h * np.arange(ny)
        zs = x0[2] + h * np.arange(nz)
        x1 = x0 + h * (np.array(shape) - 1)
        global _CTX
        tag = object()
        snaps = self._snap_index(tag)
        for oi, op in enumerate(self.ops):
            for sn in snaps.get(oi, ()):
                sn.cache = D.copy()
            if op.kind == "inter":
                dI = np.broadcast_to(op.prim.d(xs[:, None, None], ys[None, :, None], zs[None, None, :]), D.shape)
                D[...] = smax(D, dI, op.k)
                continue
            if op.kind not in ("add", "sub"):
                continue
            lo, hi = op.lo, op.hi
            if (lo > x1).any() or (hi < x0).any():
                continue
            i0 = max(0, int(math.floor((lo[0] - x0[0]) / h)))
            i1 = min(nx, int(math.ceil((hi[0] - x0[0]) / h)) + 1)
            j0 = max(0, int(math.floor((lo[1] - x0[1]) / h)))
            j1 = min(ny, int(math.ceil((hi[1] - x0[1]) / h)) + 1)
            k0 = max(0, int(math.floor((lo[2] - x0[2]) / h)))
            k1 = min(nz, int(math.ceil((hi[2] - x0[2]) / h)) + 1)
            if i0 >= i1 or j0 >= j1 or k0 >= k1:
                continue
            X = xs[i0:i1, None, None]
            Y = ys[None, j0:j1, None]
            Z = zs[None, None, k0:k1]
            _CTX = {"X": X, "Y": Y, "Z": Z, "sel": (slice(i0, i1), slice(j0, j1), slice(k0, k1)), "tag": tag}
            try:
                d = op.prim.d(X, Y, Z)
            finally:
                _CTX = None
            d = np.broadcast_to(d, (i1 - i0, j1 - j0, k1 - k0))
            sub = D[i0:i1, j0:j1, k0:k1]
            if op.kind == "add":
                sub[...] = smin(sub, d, op.k)
            else:
                sub[...] = smax(sub, -d, op.k)
        return D

    # -- point evaluation (distance + material + paint masks) -------------------------------------
    def eval_points(self, P, want_mat=True):
        P = np.asarray(P, dtype=np.float64)
        n = len(P)
        d = np.full(n, FAR)
        mat = np.full(n, self.default_mat, dtype=np.int32)
        paints = {c: np.zeros(n) for c in self.paint_channels}
        X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
        global _CTX
        tag = object()
        snaps = self._snap_index(tag)
        for oi, op in enumerate(self.ops):
            for sn in snaps.get(oi, ()):
                sn.cache = d.copy()
            if not want_mat and op.kind in ("paint", "pmat"):
                continue
            if op.kind == "inter":
                d = smax(d, op.prim.d(X, Y, Z), op.k)
                continue
            m = ((X >= op.lo[0]) & (X <= op.hi[0]) & (Y >= op.lo[1]) & (Y <= op.hi[1]) &
                 (Z >= op.lo[2]) & (Z <= op.hi[2]))
            idx = np.nonzero(m)[0]
            if len(idx) == 0:
                continue
            xi, yi, zi = X[idx], Y[idx], Z[idx]
            _CTX = {"X": xi, "Y": yi, "Z": zi, "sel": idx, "tag": tag}
            try:
                dp = op.prim.d(xi, yi, zi)
            finally:
                _CTX = None
            dp = np.broadcast_to(dp, idx.shape)
            if op.kind == "add":
                if op.mat is not None:
                    win = dp < d[idx] + 1e-5
                    mat[idx[win]] = op.mat
                d[idx] = smin(d[idx], dp, op.k)
            elif op.kind == "sub":
                if op.mat is not None:
                    win = -dp > d[idx] - 1e-5
                    mat[idx[win]] = op.mat
                d[idx] = smax(d[idx], -dp, op.k)
            elif op.kind == "pmat":
                win = dp <= 0
                mat[idx[win]] = op.mat
            else:  # paint
                soft = max(op.soft, 1e-6)
                w = np.clip(1.0 - np.maximum(dp, 0.0) / soft, 0.0, 1.0)
                w = w * w * (3 - 2 * w) * op.value
                ch = paints[op.chan]
                if op.tag == "sub":
                    ch[idx] = np.clip(ch[idx] - w, 0, 1)
                elif op.tag == "add":
                    ch[idx] = np.clip(ch[idx] + w, 0, 1)
                else:
                    ch[idx] = np.maximum(ch[idx], w)
        if not want_mat and n <= 200000:
            # point queries (project / grad / collide): far points see a finite lower bound, never FAR
            d = _far_fallback(d, X, Y, Z, self.ops)
        return d, mat, paints

    def dist(self, P):
        return self.eval_points(P, want_mat=False)[0]

    def grad(self, P, e=0.0015):
        P = np.asarray(P, float)
        g = np.zeros_like(P)
        for a in range(3):
            o = np.zeros(3)
            o[a] = e
            g[:, a] = (self.dist(P + o) - self.dist(P - o)) / (2 * e)
        n = np.linalg.norm(g, axis=1, keepdims=True)
        return g / np.maximum(n, 1e-9)

    def project(self, P, offset=0.0, iters=10, max_step=0.06, tol=2e-4):
        """Move points onto the iso-surface d = offset (along the gradient). Steps are clamped so blended /
        bound-culled fields (which are only distance *bounds*) can never fling a point away."""
        P = np.array(P, float)
        for _ in range(iters):
            d = self.dist(P) - offset
            if np.all(np.abs(d) < tol):
                break
            step = np.clip(d, -max_step, max_step)
            P -= self.grad(P) * step[:, None]
        return P


# ----------------------------------------------------------------------------- meshing
def polygonize(sculpt, h, lo=None, hi=None, chunk=40, coarse=4, adaptivity=0.0, log=print):
    """Narrow-band chunked evaluation + OpenVDB meshing. Returns (verts Nx3 float32, quads Mx4, tris Kx3)."""
    import openvdb as vdb
    t0 = time.time()
    if lo is None:
        lo, hi = sculpt.bounds()
    lo = V(lo) - 4 * h
    hi = V(hi) + 4 * h
    n = np.ceil((hi - lo) / h).astype(int) + 1
    band = 3.0 * h
    # coarse pass: decides which chunks contain surface / are fully inside
    hc = h * coarse
    nc = np.ceil((hi - lo) / hc).astype(int) + 2
    Dc = sculpt.eval_block(lo, hc, tuple(nc))
    t1 = time.time()
    grid = vdb.FloatGrid(float(band))
    thr = hc * 1.9 + 0.004
    nch = np.ceil(n / chunk).astype(int)
    done = inside = 0
    for ci in range(nch[0]):
        for cj in range(nch[1]):
            for ck in range(nch[2]):
                i0 = np.array([ci, cj, ck]) * chunk
                i1 = np.minimum(i0 + chunk, n)
                w0 = lo + i0 * h
                w1 = lo + (i1 - 1) * h
                c0 = np.maximum(np.floor((w0 - lo) / hc).astype(int) - 1, 0)
                c1 = np.minimum(np.ceil((w1 - lo) / hc).astype(int) + 2, nc)
                sub = Dc[c0[0]:c1[0], c0[1]:c1[1], c0[2]:c1[2]]
                if sub.size == 0 or sub.min() > thr:
                    continue
                if sub.max() < -thr:
                    grid.fill(tuple(int(v) for v in i0), tuple(int(v) for v in (i1 - 1)), float(-band), True)
                    inside += 1
                    continue
                D = sculpt.eval_block(w0, h, tuple(int(v) for v in (i1 - i0)))
                np.clip(D, -band, band, out=D)
                grid.copyFromArray(np.ascontiguousarray(D, dtype=F32), tuple(int(v) for v in i0), 0.0)
                done += 1
    t2 = time.time()
    pts, tris, quads = grid.convertToPolygons(0.0, float(adaptivity))
    pts = (lo[None, :] + np.asarray(pts, np.float64) * h).astype(F32)
    tris = np.asarray(tris, np.int64)
    quads = np.asarray(quads, np.int64)
    # orientation: make normals point outward (positive signed volume)
    vol = _signed_volume(pts, quads, tris)
    if vol < 0:
        quads = quads[:, ::-1].copy()
        tris = tris[:, ::-1].copy()
    log(f"[sdf] polygonize h={h*1000:.2f}mm grid={tuple(n)} chunks={done} inside={inside} "
        f"coarse={t1-t0:.1f}s fine={t2-t1:.1f}s mesh={time.time()-t2:.1f}s -> {len(pts)} verts {len(quads)} quads {len(tris)} tris")
    return pts, quads, tris


def _signed_volume(pts, quads, tris):
    P = pts.astype(np.float64)
    vol = 0.0
    if len(quads):
        a, b, c, d = P[quads[:, 0]], P[quads[:, 1]], P[quads[:, 2]], P[quads[:, 3]]
        vol += np.einsum("ij,ij->i", a, np.cross(b, c)).sum() + np.einsum("ij,ij->i", a, np.cross(c, d)).sum()
    if len(tris):
        a, b, c = P[tris[:, 0]], P[tris[:, 1]], P[tris[:, 2]]
        vol += np.einsum("ij,ij->i", a, np.cross(b, c)).sum()
    return vol / 6.0
