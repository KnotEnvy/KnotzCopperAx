"""Shellback Crossing (ui-flow r8): the giant tortoise as ONE continuous sculpted carapace (vertebral / costal / marginal scutes
as pillowed plates between carved grooves, growth rings, moss at the rim, a flared lip), thick scaled legs with claws, a wrinkled
neck and an articulated head (brow, lids, beak, lower jaw, cheek scales) - with the harbour village seated on a turfed mound
on its back. Pure numpy + mapkit.Batch (same conventions as mapland.py: world units, X east, Y north, Z up)."""
import math
import numpy as np
from . import mapkit as MK
from .mapkit import to_world, smoothstep

P = MK.hexc
CT = MK.CT


def _mix(a, b, t):
    t = np.asarray(t)[..., None] if np.ndim(t) else t
    return a + (b - a) * t


def _cr(pts, n):
    """Catmull-Rom through 3-D points -> n samples per span."""
    pts = [np.asarray(p, float) for p in pts]
    Q = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(1, len(Q) - 2):
        p0, p1, p2, p3 = Q[i - 1], Q[i], Q[i + 1], Q[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return np.array(out)


def _interp(vals, m):
    return np.interp(np.linspace(0, len(vals) - 1, m), np.arange(len(vals)), vals)


def ribbed(b, pts, radii, col_a, col_b, rs, n=10, per_span=5, ridges=9, depth=.10, scale_rows=None):
    """A thick limb / neck: Catmull-Rom path, radii modulated by skin folds, banded scale colour (rows of plates)."""
    path = _cr(pts, per_span); m = len(path)
    rad = _interp(radii, m) * (1 + depth * np.sin(np.linspace(0, ridges * math.pi * 2, m)))
    rows = scale_rows or ridges

    def colfn(t, k):
        row = int(t * rows * 1.0); cell = (row * 7 + int(k * 6 + (row % 2) * .5)) % 5
        tone = (cell / 5.0) * .5 + .25
        shade = .78 + .22 * (0.5 + 0.5 * math.sin(t * rows * math.pi * 2))
        c = np.array(col_a) * (1 - tone) + np.array(col_b) * tone
        return tuple(np.clip(c * shade * (0.82 + 0.3 * k if k < .5 else 1.12 - 0.3 * (k - .5)), 0, 1))
    b.tube(path, rad, n=n, col=col_a, jit=.0, colfn=colfn)


def dome_z(u, v, SZ, zr):
    r = np.sqrt(u * u + v * v)
    return zr + (SZ - zr) * np.clip(1 - r ** 2.6, 0, 1) ** 0.55


def carapace(c, B, SX, SY, SZ, cz, zr, rs):
    f = c.smooth
    NR, NP = 78, 260
    # rows concentrate toward the rim where the grooves and the lip live
    t = np.linspace(0, 1, NR)
    rho = 0.025 + 0.995 * (1 - (1 - t) ** 1.25)
    rho = np.concatenate([rho, [1.03, 1.06]])
    ph = np.linspace(0, 2 * math.pi, NP, endpoint=False)
    R, PH = np.meshgrid(rho, ph, indexing='ij')
    U, V = R * np.cos(PH), R * np.sin(PH)
    X, Y = U * SX, V * SY                                   # offsets in world units
    # --- scute layout: 5 vertebral + 8 costal seeds (Voronoi), a ring groove, 26 marginal plates
    vx = np.array([-.66, -.33, 0, .33, .66]) * SX * .96
    seeds = [(x, 0.0) for x in vx] + [(x, s * .43 * SY) for x in np.array([-.5, -.17, .17, .5]) * SX * .96 for s in (-1, 1)]
    seeds = np.array([(x + rs.uniform(-3, 3), y + rs.uniform(-2, 2)) for x, y in seeds])
    D = np.stack([np.hypot(X - sx, Y - sy) for sx, sy in seeds], 0)
    order = np.sort(D, 0); idx = np.argmin(D, 0)
    d1, d2 = order[0], order[1]
    vor_edge = (d2 - d1) * 0.5
    ring_r = 0.80
    rad_w = np.sqrt((SX * np.cos(PH)) ** 2 + (SY * np.sin(PH)) ** 2)      # world length of one unit of rho
    ring_edge = np.abs(R - ring_r) * rad_w
    NM = 26
    q = (PH / (2 * math.pi) * NM + .31) % 1.0
    arc_edge = np.minimum(q, 1 - q) * (2 * math.pi / NM) * np.maximum(R, .2) * rad_w
    marg = R > ring_r
    edge = np.where(marg, np.minimum(arc_edge, ring_edge), np.minimum(vor_edge, ring_edge))
    edge = np.where(R > 1.0, 0.0, edge)
    cell = np.where(marg, 20 + np.floor(PH / (2 * math.pi) * NM + .31).astype(int) % NM, idx)
    # --- height: tabletop dome + pillowed plates - grooves + a flared lip
    h = dome_z(U, V, SZ, zr)
    groove = 1 - smoothstep(0.0, 3.0, edge)
    pillow = smoothstep(0.0, 11.0, edge)
    bumpn = (MK.fbm(X / 18 + 7, Y / 18, 3, seed=5) - .5)
    h = h + 2.7 * pillow - 1.9 * groove + 1.2 * bumpn * smoothstep(0, 4, edge)
    h = h + np.where(marg, 1.6 * np.clip((R - ring_r) / .12, 0, 1), 0)
    # flared lip + skirt that tucks under (so the rim reads as a thick shell edge, not a sliced dome)
    lip = np.clip((R - 1.0) / .06, 0, 1)
    h = np.where(R > 1.0, zr + 1.0 - 7.5 * lip ** 1.2, h)
    Xo = np.where(R > 1.0, U * SX * (1 + .06 * lip * (1 - lip) * 3 - .0), X)
    # --- colour: plate tones, areola lighter, growth rings, groove darkening, algae / moss toward the lip, sun-bleached crown
    tones = [P('#8d7c4a'), P('#7e7046'), P('#96824e'), P('#6f6a40'), P('#85774a'), P('#9a8a56'), P('#7a6c3e')]
    base = np.array(tones)[(cell * 5 + 3) % len(tones)]
    seedx = np.array([s[0] for s in seeds]); seedy = np.array([s[1] for s in seeds])
    dloc = np.where(marg, edge, d1)
    rings = 0.5 + 0.5 * np.sin(np.where(marg, ring_edge * 1.7 + arc_edge * .0, d1 * 0.62) + cell * 1.3)
    col = base * (1 - .11 * rings[..., None])
    col = col * (0.86 + 0.26 * (1 - smoothstep(0, 16, np.where(marg, edge * 1.6, d1)))[..., None])      # lighter areola
    col = col * (0.50 + 0.50 * smoothstep(0.0, 4.2, edge))[..., None]                                         # dark grooves
    col = col * (0.92 + 0.16 * MK.fbm(X / 6, Y / 6, 3, seed=9)[..., None])
    moss = np.clip((1 - np.clip((h - zr) / (SZ - zr), 0, 1)) * 1.1 - .2, 0, 1) * (0.5 + MK.fbm(X / 14, Y / 14, 3, seed=11))
    col = _mix(col, np.array(P('#5c7a3c')), np.clip(moss * .62, 0, .7))
    col = _mix(col, np.array(P('#c2b078')), (np.clip((h - (SZ - 9)) / 9, 0, 1) * .28))
    col = np.where((R > 1.0)[..., None], np.array(P('#4e4128')) * .85, col)
    # --- assemble the polar grid
    verts = np.stack([B[0] + Xo, B[1] + Y, B[2] + cz + h], -1)
    nr, npp = R.shape
    vid = lambda i, j: i * npp + (j % npp)
    faces = [(vid(i, j), vid(i, j + 1), vid(i + 1, j + 1), vid(i + 1, j)) for i in range(nr - 1) for j in range(npp)]
    faces = [(a, d, cc, b_) for a, b_, cc, d in faces]                  # outward-facing
    f.add(verts.reshape(-1, 3), faces, col.reshape(-1, 3).astype(np.float32))
    # underside: a dark plastron plate so the shell is closed seen from the lake side
    th = np.linspace(0, 2 * math.pi, 48, endpoint=False)
    ring = np.stack([B[0] + np.cos(th) * SX * 1.03, B[1] + np.sin(th) * SY * 1.03, np.full(48, B[2] + cz + zr - 6.5)], 1)
    f.add(np.vstack([ring, [[B[0], B[1], B[2] + cz + zr - 6.5]]]), [(i, (i + 1) % 48, 48) for i in range(48)], P('#3a3020'))

    def top(dx, dy):
        """shell surface height at a world offset from the tortoise centre (plate pillow averaged in)."""
        u, v = dx / SX, dy / SY
        return B[2] + cz + float(dome_z(np.array(u), np.array(v), SZ, zr)) + 1.1
    return top


def limbs(c, B, SX, SY, cz, rs):
    f = c.smooth
    skin_a = P('#8f8b52'); skin_b = P('#b1aa68'); toe = P('#e6d6a6')
    legs = [(-72, 46, -1), (-50, -63, -1), (58, 52, 1), (84, -44, 1)]     # (x, y, +1 front/-1 back)
    for lx, ly, fb in legs:
        ox, oy = lx * 1.30, ly * 1.34        # r9: out to / past the shell rim so the legs read (they were tucked under it)
        pts = [(B[0] + lx * .86, B[1] + ly * .86, B[2] + cz + 5), (B[0] + lx, B[1] + ly, B[2] + cz - 4),
               (B[0] + ox * 1.0, B[1] + oy * 1.0, B[2] + 5), (B[0] + ox * 1.02 + fb * 3, B[1] + oy * 1.04, B[2] - 2)]
        ribbed(f, pts, [21, 22, 20.5, 23], skin_a, skin_b, rs, n=10, per_span=5, ridges=6, depth=.07, scale_rows=8)
        # broad foot pad + four claws fanning toward the camera
        fx, fy = B[0] + ox * 1.02 + fb * 3, B[1] + oy * 1.04
        f.ellipsoid((fx, fy - 4, B[2] - 1.0), 28, 23, 8.5, P('#837f4a'), nu=12, nv=6, jit=.02)
        for k, t in enumerate((-12, -4, 4, 12)):
            ang = -math.pi / 2 + t * .028
            c.flat.cone((fx + t * 1.35, fy - 22, B[2] + 2.0), 5.2, 15, 6, toe, yaw=0, rtop=.2, squash=1.0)
    # tail: a short tapering stub with plates, from the shell's trailing edge
    ribbed(f, [(B[0] - 100, B[1] + 2, B[2] + cz + 6), (B[0] - 124, B[1] + 3, B[2] + cz + 1), (B[0] - 146, B[1] + 8, B[2] + cz - 3)], [11, 8, 2.2], skin_a, skin_b, rs, n=8, per_span=4, ridges=4, depth=.08)


def head(c, B, cz, rs):
    f, fl = c.smooth, c.flat
    skin_a = P('#929054'); skin_b = P('#b7ae6a'); dark = P('#6a6a3e'); bone = P('#6e5f3a')
    z0 = B[2] + cz
    HS = 1.02                                                       # C2: slimmer, smaller head (r9 board: chunky)
    neck = [(B[0] + 84, B[1] - 4, z0 + 8), (B[0] + 112, B[1] - 8, z0 + 3), (B[0] + 134, B[1] - 13, z0 + 7), (B[0] + 152, B[1] - 18, z0 + 15), (B[0] + 166, B[1] - 22, z0 + 21)]
    ribbed(f, neck, [19, 15.0, 13.5, 12.5, 12.5], skin_a, skin_b, rs, n=12, per_span=6, ridges=13, depth=.07, scale_rows=14)
    hx, hy, hz = B[0] + 184, B[1] - 25, z0 + 22

    def at(dx, dy, dz):
        return (hx + dx * HS, hy + dy * HS, hz + dz * HS)

    def E(dx, dy, dz, rx, ry, rz, col, nu=10, nv=6, jit=.02):
        f.ellipsoid(at(dx, dy, dz), rx * HS, ry * HS, rz * HS, col, nu=nu, nv=nv, jit=jit)
    E(0, 0, 0, 22, 15, 13.5, skin_a, 16, 10)                                    # skull
    E(14, -1, 4, 14, 12.5, 8, skin_b, 10, 6)                                   # crown
    E(22, -1, -5.5, 20, 10.5, 8, skin_a, 12, 7)                                  # upper jaw / snout
    E(17, -1, -12.0, 19, 9.5, 4.6, dark, 10, 6)                                 # lower jaw
    fl.cone(at(38, -1, -3.5), 8 * HS, -13 * HS, 7, bone, yaw=0, rtop=.4, squash=.8, cap=False)    # hooked horn beak
    fl.box(at(21, -12.0, -7.2), (30 * HS, 1.4, 1.2), 0, P('#30281a'), base=False)               # mouth line
    for k, (ox, oy, oz, rr) in enumerate([(-9, -15.0, -4, 3.6), (-3, -16.4, -8, 3.3), (-12, -13.2, 3, 3.2), (-7, -16.0, 1, 3.0)]):
        E(ox, oy, oz, rr * 1.2, rr * .6, rr, jit_(rs, skin_b), 6, 4, .03)         # cheek / tympanum scales
    for sgn in (-1, 1):
        ey = sgn * 13.6
        E(11, ey, 4.0, 6.0, 4.8, 6.0, P('#b88a30'), 12, 8, 0)                     # r9: round eye: thin amber iris ring
        E(12.4, ey + sgn * 1.6, 4.2, 4.6, 3.6, 4.7, P('#140c08'), 10, 7, 0)       # large dark glossy pupil (was a square amber block)
        E(11, sgn * 12.6, 9.0, 8.4, 4.0, 3.2, skin_b, 9, 5)                       # heavy upper lid
        E(10, sgn * 8.2, 11.6, 9.0, 3.4, 2.2, dark, 9, 5)                         # brow ridge hugging the skull
        E(35, sgn * 4.0, -1.2, 1.5, 1.5, 1.3, P('#2a2010'), 5, 4, 0)              # nostril
    for k, (ox, oy, rr) in enumerate([(-6, 0, 5.2), (3, -4, 4.6), (3, 4, 4.6), (12, 0, 4.0), (-10, -7, 3.8), (-10, 7, 3.8)]):
        E(ox, oy, 12.8 - abs(oy) * .28, rr * 1.2, rr, rr * .45, jit_(rs, skin_b if k % 2 else skin_a), 7, 4, .04)    # crown plates
    E(-4, -5, -14, 15, 10, 5.5, skin_b, 10, 6)                                     # throat / dewlap


def jit_(rs, col, a=.05):
    return tuple(np.clip(np.array(col) + (rs.rand(3) - .5) * a, 0, 1))


def tortoise(c):
    from . import mapland as ML
    rs = np.random.RandomState(202)
    bx, by = 548, 522
    B = to_world(bx, by, -3.5)
    SX, SY, SZ = 114, 78, 47
    cz, zr = 19.0, 9.0
    top = carapace(c, B, SX, SY, SZ, cz, zr, rs)
    limbs(c, B, SX, SY, cz, rs)
    head(c, B, cz, rs)
    # --- the village seated on the carapace crown: a turfed, stone-kerbed mound with a harbour town, a tower and a few trees
    mz = top(0, 0)
    f, fl = c.smooth, c.flat
    f.ellipsoid((B[0] - 2, B[1] + 2, mz - 4.5), 58, 37, 8.5, P('#8a8d4f'), nu=22, nv=7, jit=.03, noise=.04)
    for k in range(36):
        a = k / 36 * 2 * math.pi
        px, py = B[0] - 2 + math.cos(a) * 56.5, B[1] + 2 + math.sin(a) * 35.5
        fl.box((px, py, mz - 4.2), (8.4, 5.4, 6.0 + (k % 3) * .6), a + math.pi / 2, jit_(rs, P('#a99d86'), .07))
    wall = P('#eadbb4'); roofs = [P('#b5532e'), P('#9e4a30'), P('#a86a3a'), P('#c4633a')]
    layout = [(-24, 5, 17, 12, 10, .15), (2, -12, 21, 14, 12, -.1), (25, 3, 15, 11, 9, .22), (-9, 20, 15, 10, 9, -.3), (13, 19, 12, 9, 8, .1), (-40, -7, 12, 9, 8, .4), (40, -12, 12, 10, 8, -.35), (-5, 2, 12, 10, 9, .0)]
    tz = mz + 1.5
    for i, (dx, dy, w, d, h, yaw) in enumerate(layout):
        ML.house(c, (B[0], B[1], 0), dx * 1.1, dy * 1.1, w * 1.2, d * 1.2, h * 1.2, yaw, wall, roofs[i % 4], rs, dz=tz)
    c.flat.cyl((B[0] - 12, B[1] - 2, tz), 6, 30, 8, P('#e4d4a8'), rtop=5.2)
    c.flat.cone((B[0] - 12, B[1] - 2, tz + 30), 8, 15, 8, P('#a14a2e'), cap=True)
    ML.stick(c.flat, (B[0] - 12, B[1] - 2, tz + 44), (B[0] - 12, B[1] - 2, tz + 55), .6, .5, P('#4a3020'))
    c.flat.add([(B[0] - 12, B[1] - 2, tz + 54), (B[0] - 3, B[1] - 2, tz + 51), (B[0] - 12, B[1] - 2, tz + 48)], [(0, 1, 2)], P('#a8261a'))
    for dx, dy in [(-52, 12), (50, 8), (-34, 27), (30, 28), (12, -27), (-2, 29)]:
        c.flat.cyl((B[0] + dx, B[1] + dy, tz - 1), 1.0, 5, 5, P('#6a4a30'))
        c.flat.cone((B[0] + dx, B[1] + dy, tz + 2), 5, 12, 6, P('#5a6e3c'), cap=False)
    for dx, dy in [(-24, 5), (25, 3), (2, -12)]:
        ML.smoke(c, (B[0], B[1], 0), dx - 5, dy, tz + 14, 3, .55, rs, drift=(3, 1), col=(.72, .70, .66))
    for dx, dy in [(-8, -26), (22, -22), (-34, -4)]:
        c.glow.ellipsoid((B[0] + dx, B[1] + dy, tz + 4), 1.6, 1.6, 1.6, P('#ffd070'), nu=5, nv=3, jit=0)
    # a rowing boat tied up at the lakeside foreleg, so the beast reads at scale
    bxw, byw, bzw = B[0] + 100, B[1] - 66, B[2] + .5
    f.ellipsoid((bxw, byw, bzw + 1.2), 17, 6, 3.4, P('#7a5636'), nu=10, nv=5, jit=.02)
    c.flat.box((bxw, byw, bzw + 3), (22, 6.4, .8), 0, P('#a8895a'))
    return top
