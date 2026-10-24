"""Landmark builders for the relief map (see mapprops.py / build_ui_map.py). All geometry is authored in WORLD units around a
base point (x east, y NORTH = away from the camera, z up); `c.W(x, y)` converts a map point to the world position on the terrain."""
import math
import numpy as np
from . import mapkit as MK, mapworld as MW
from .mapkit import to_world

CT, ST = MK.CT, MK.ST
P = MK.hexc


def jit(rs, col, a=.04):
    return tuple(np.clip(np.array(col) + (rs.rand(3) - .5) * a, 0, 1))


def stick(b, p0, p1, r0, r1, col, n=5):
    b.tube([p0, p1], [r0, r1], n=n, col=col, jit=0.02)


def rot2(x, y, a):
    return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)


def house(c, B, dx, dy, w, d, h, yaw, wall, roof, rs, burnt=False, rh=None, dz=0.0):
    b = c.flat
    px, py = rot2(dx, dy, 0)
    X, Y, Z = B[0] + px, B[1] + py, B[2] + dz
    wc = jit(rs, wall, .05)
    b.box((X, Y, Z), (w, d, h), yaw, wc)
    rh = rh if rh is not None else w * .5
    if burnt:
        # charred lower wall, caved-in roof: one slab left, bare rafters, soot
        b.box((X, Y, Z), (w + .3, d + .3, h * .35), yaw, P('#3b2c24'), jit=.02)
        b.gable((X, Y, Z + h), w, d, rh * .55, yaw, jit_col(rs, roof), overhang=1.2)
        for k in range(4):
            a = yaw + (k - 1.5) * .5
            ox, oy = rot2((k - 1.5) * w * .28, 0, yaw)
            stick(b, (X + ox, Y + oy, Z + h), (X + ox * 1.1 + math.cos(a) * 3, Y + oy * 1.1 + math.sin(a) * 3, Z + h + rh * (.9 + .4 * rs.rand())), .9, .5, P('#2b1d16'))
    else:
        b.gable((X, Y, Z + h), w, d, rh, yaw, jit_col(rs, roof), overhang=1.6)
    # door + window (dark inserts on the south/front face)
    fx, fy = rot2(0, -d / 2 - .1, yaw)
    b.box((X + fx, Y + fy, Z), (w * .2, .5, h * .55), yaw, P('#3a2418'))
    wx, wy = rot2(-w * .3, -d / 2 - .1, yaw)
    b.box((X + wx, Y + wy, Z + h * .45), (w * .16, .5, h * .24), yaw, P('#33211a'))


def jit_col(rs, col):
    return jit(rs, col, .06)


def flame(c, B, dx, dy, dz, s, rs):
    e = c.emit
    for k, (sx, sy, r, hh, col) in enumerate([(0, 0, 5.2, 24, '#e8501a'), (-3.5, 1.5, 3.4, 15, '#f07a1e'), (3.4, -1, 3.0, 17, '#ee6a1c'), (0, 0, 3.0, 17, '#ffc238'), (0.4, 0, 1.6, 11, '#fff0a0')]):
        e.cone((B[0] + dx + sx * s, B[1] + dy + sy * s, B[2] + dz), r * s, hh * s * (.85 + .3 * rs.rand()), 6, P(col), jit=.0, cap=False)
    c.lights.append((B[0] + dx + 800, 450 - (B[1] + dy) * CT, B[2] + dz + 14 * s, 26000 * s, (1.0, .52, .2), 6))


def smoke(c, B, dx, dy, dz, n, s, rs, drift=(6, 2), col=(.30, .24, .22)):
    for i in range(n):
        r = (5 + i * 2.5) * s
        c.smoke.ellipsoid((B[0] + dx + drift[0] * i * s, B[1] + dy + drift[1] * i * s, B[2] + dz + i * 13 * s), r, r, r * .9, jit(rs, col, .04), nu=7, nv=5, jit=.02, noise=.2)


# =========================================================================================== Ashen Wilds (burning village)
def village(c):
    rs = np.random.RandomState(101)
    x0, y0 = MW.VILLAGE; B = c.W(x0, y0)
    wall = P('#c7ae82'); roof = P('#4a3428')
    K = 1.3
    H = [(-52, 10, 30, 22, 16, .12), (-6, -2, 36, 26, 21, -.06), (42, 12, 30, 22, 15, .2), (78, -12, 26, 18, 13, -.3), (-30, 40, 24, 18, 12, .05), (24, 44, 22, 16, 11, .3), (-84, -16, 22, 16, 11, -.2)]
    for i, (dx, dy, w, d, h, yaw) in enumerate(H):
        house(c, B, dx * K, dy * K, w * K, d * K, h * K, yaw, wall, roof, rs, burnt=True)
    for dx, dy, dz, s in [(-8, -2, 22, 1.5), (46, 12, 17, 1.15), (-52, 10, 18, 1.0), (22, 44, 12, .8), (-84, -16, 12, .7)]:
        flame(c, B, dx * K, dy * K, dz * K, s * 1.45, rs)
    smoke(c, B, -8 * K, 0, 50, 7, 1.4, rs); smoke(c, B, 46 * K, 10, 38, 6, 1.2, rs); smoke(c, B, -52 * K, 10, 34, 5, 1.1, rs); smoke(c, B, 24 * K, 44 * K, 28, 5, 1.0, rs)
    # broken watchtower
    tx, ty = B[0] - 108, B[1] + 2
    c.flat.cyl((tx, ty, B[2] - 1), 9, 58, 8, P('#bfa57a'), rtop=7.5)
    for k in range(7):
        a = k * .9; hh = 3 + rs.rand() * 7
        c.flat.box((tx + math.cos(a) * 6, ty + math.sin(a) * 6, B[2] + 57), (4, 3.4, hh), a, P('#6a5240'))
    c.flat.box((tx, ty - 8.6, B[2] + 20), (3, .8, 9), 0, P('#2a1a14'))
    flame(c, (tx, ty, B[2] + 40), 0, 0, 0, .5, rs)
    # split fence + barrels + a toppled cart
    for i in range(10):
        fx = B[0] - 76 + i * 14; fy = B[1] - 34 - 3 * math.sin(i * .8)
        stick(c.flat, (fx, fy, B[2]), (fx, fy, B[2] + 9 - (i % 3) * 3), 1.3, 1.0, P('#5a3d2a'))
    c.flat.box((B[0] - 30, B[1] - 34.5, B[2] + 4), (150, 1.2, 1.2), 0, P('#5a3d2a'), base=False)
    for dx, dy in [(66, 18), (72, 26), (-28, -24)]:
        c.flat.cyl((B[0] + dx, B[1] + dy, B[2]), 4.2, 7, 8, P('#7a5636'))
    c.flat.box((B[0] + 14, B[1] - 26, B[2] + 1), (18, 9, 5), .5, P('#6b4a30'))
    for dx, dy in [(2, -22), (-12, -18)]:
        stick(c.flat, (B[0] + dx, B[1] + dy, B[2]), (B[0] + dx + 9, B[1] + dy + 3, B[2] + 11), 1.4, 1.4, P('#4a3424'))
    # rubble
    for _ in range(26):
        a = rs.rand() * 6.28; r = 20 + rs.rand() * 75
        c.flat.box((B[0] + math.cos(a) * r * 1.3, B[1] + math.sin(a) * r * .8, B[2]), (2 + rs.rand() * 5, 2 + rs.rand() * 4, 1.5 + rs.rand() * 3), rs.rand() * 3, jit(rs, P('#4d3c30'), .06))


# =========================================================================================== Shellback Crossing
def tortoise(c):
    """r8: moved to maptort.py (one continuous carapace with integrated scutes, scaled limbs, articulated head, village on a turfed mound)."""
    from . import maptort
    return maptort.tortoise(c)


# =========================================================================================== Eaglespine
def eagle(c, sx, sy, z, s, yaw, rs):
    """Flying eagle seen from above-behind: (sx, sy) = where it should APPEAR on the map, z = altitude (so its shadow lands lower)."""
    gy = sy + z * ST
    wx, wy, wz = to_world(sx, gy, z)
    f = c.flat
    body = P('#5a3a1e'); wingc = P('#6e4726'); dark = P('#3d2614')
    def L(x, y, zz=0.0):
        a, b = rot2(x * s, y * s, yaw)
        return (wx + a, wy + b, wz + zz * s)
    for m in (-1, 1):
        # each wing = inner panel + 5 fingered primaries + dihedral
        inner = [L(m * 3, 6), L(m * 22, 3, 2), L(m * 24, -9, 2), L(m * 3, -12)]
        f.add(inner, [(0, 1, 2, 3)] if m > 0 else [(3, 2, 1, 0)], wingc, jit=.03)
        for k in range(6):
            t = k / 5
            x0, y0 = 22 + 0 * t, 3 - t * 12
            tipx, tipy = 40 - t * 6, 5 - t * 21
            q = [L(m * x0, y0 + 2, 2), L(m * tipx, tipy + 3.2, 5), L(m * (tipx + 1.2), tipy - 1.2, 5), L(m * x0, y0 - 3.4, 2)]
            f.add(q, [(0, 1, 2, 3)] if m > 0 else [(3, 2, 1, 0)], jit_col(rs, wingc if k % 2 else dark), jit=.02)
        # leading-edge covert band
        f.add([L(m * 3, 6), L(m * 22, 3, 2), L(m * 23, .5, 2), L(m * 3, 2.5)], [(0, 1, 2, 3)] if m > 0 else [(3, 2, 1, 0)], P('#8a5e34'), jit=.02)
    f.ellipsoid(L(0, 0, 0), 4.0 * s, 10.5 * s, 3.4 * s, body, nu=7, nv=5, jit=.02, rot=yaw)
    hp = L(0, 12.5, .8)
    f.ellipsoid(hp, 3.2 * s, 3.6 * s, 3.0 * s, P('#f4ead0'), nu=7, nv=5, jit=.0, rot=yaw)
    bp = L(0, 16.4, .2)
    f.cone((bp[0], bp[1], bp[2]), 1.8 * s, 3.4 * s, 4, P('#e0a830'), yaw=yaw, jit=.0)
    # banded tail fan
    tail = [L(-5, -10), L(5, -10), L(8, -23), L(-8, -23)]
    f.add(tail, [(0, 1, 2, 3)], P('#e9dcc0'), jit=.02)
    f.add([L(-5, -17), L(5, -17), L(6, -19), L(-6, -19)], [(0, 1, 2, 3)], dark, jit=.0)
    f.add([L(-7, -21), L(7, -21), L(8, -23), L(-8, -23)], [(0, 1, 2, 3)], dark, jit=.0)


def eagles(c):
    rs = np.random.RandomState(303)
    eagle(c, 770, 212, 105, 1.15, 0.5, rs)
    eagle(c, 1032, 228, 86, .9, -0.7, rs)
    eagle(c, 902, 196, 70, .72, 0.1, rs)


# =========================================================================================== Serpent Keep
def keep(c):
    rs = np.random.RandomState(404)
    B = c.W(*MW.KEEP); B = (B[0], B[1], 19.0)
    f = c.flat
    stone = P('#dccfaa'); stone2 = P('#cdbf98'); roof = P('#7a4e3e'); slate = P('#5b5262')
    WX, WY, WH = 132, 78, 26
    # curtain wall (4 sides) with merlons
    f.box((B[0], B[1] - WY / 2, B[2]), (WX, 6, WH), 0, stone)
    f.box((B[0], B[1] + WY / 2, B[2]), (WX, 6, WH), 0, stone2)
    f.box((B[0] - WX / 2, B[1], B[2]), (6, WY, WH), 0, stone2)
    f.box((B[0] + WX / 2, B[1], B[2]), (6, WY, WH), 0, stone2)
    for sgn in (-1, 1):
        for i in range(-6, 7):
            f.box((B[0] + i * 9.4, B[1] + sgn * WY / 2, B[2] + WH), (5, 6, 5), 0, stone)
        for i in range(-3, 4):
            f.box((B[0] + sgn * WX / 2, B[1] + i * 10, B[2] + WH), (6, 5, 5), 0, stone)
    # corner towers + conical roofs
    for sx_, sy_ in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        tx, ty = B[0] + sx_ * WX / 2, B[1] + sy_ * WY / 2
        f.cyl((tx, ty, B[2] - 1), 12, 48, 10, stone, rtop=11.2)
        for k in range(8):
            a = k / 8 * 6.28
            f.box((tx + math.cos(a) * 11.4, ty + math.sin(a) * 11.4, B[2] + 47), (4.6, 4.6, 5), a, stone)
        f.cone((tx, ty, B[2] + 47), 14.5, 22, 10, roof, jit=.03)
        f.box((tx + 1, ty - 11.6, B[2] + 30), (3, .8, 8), 0, P('#2c1a14'))
    # gatehouse (south = toward camera)
    gx, gy = B[0], B[1] - WY / 2 - 6
    f.box((gx, gy, B[2] - 1), (34, 18, 40), 0, stone)
    f.box((gx - 9, gy, B[2] + 39), (8, 18, 6), 0, stone); f.box((gx + 9, gy, B[2] + 39), (8, 18, 6), 0, stone); f.box((gx, gy, B[2] + 39), (6, 18, 6), 0, stone)
    f.box((gx, gy - 9.4, B[2] - 1), (15, 1.2, 26), 0, P('#1d1009'))
    f.cone((gx, gy - 9.5, B[2] + 24), 7.5, 4, 12, P('#1d1009'), cap=False, squash=.1)
    for k in range(-2, 3):
        f.box((gx + k * 3, gy - 10.4, B[2] + 1), (.6, .5, 22), 0, P('#6a5238'))
    for dx_ in (-14, 14):
        f.cyl((gx + dx_, gy - 2, B[2] + 38), 5.5, 26, 8, stone2)
        f.cone((gx + dx_, gy - 2, B[2] + 64), 7.5, 14, 8, roof)
    # keep (donjon) + its roof + banners
    kx, ky = B[0], B[1] + 12
    f.box((kx, ky, B[2]), (46, 36, 68), 0, stone)
    for sgn in (-1, 1):
        f.box((kx + sgn * 17, ky - 18.4, B[2] + 68), (10, 3, 5), 0, stone); f.box((kx, ky - 18.4, B[2] + 68), (10, 3, 5), 0, stone)
    f.cone((kx, ky, B[2] + 68), 36, 36, 4, roof, yaw=math.pi / 4, jit=.03)
    for row in range(3):
        for col in range(3):
            f.box((kx - 14 + col * 14, ky - 18.2, B[2] + 14 + row * 17), (5, .7, 8), 0, P('#2a1a14'))
    f.box((kx, ky - 18.3, B[2]), (8, .7, 14), 0, P('#2a1a14'))
    stick(f, (kx, ky, B[2] + 100), (kx, ky, B[2] + 120), .9, .7, P('#4a3020'))
    f.add([(kx, ky - .5, B[2] + 119), (kx + 18, ky - .5, B[2] + 114), (kx, ky - .5, B[2] + 108)], [(0, 1, 2)], P('#3d6a2e'))
    f.add([(kx, ky - .6, B[2] + 117), (kx + 12, ky - .6, B[2] + 114), (kx, ky - .6, B[2] + 111)], [(0, 1, 2)], P('#a8261a'))
    # drawbridge + chains
    f.box((gx, gy - 36, B[2] - 4), (14, 34, 2), 0, P('#7a5636'))
    for sgn in (-1, 1):
        stick(f, (gx + sgn * 6, gy - 11, B[2] + 20), (gx + sgn * 6, gy - 52, B[2] - 3), .5, .5, P('#2a2420'))
    # inner outbuildings in the bailey
    for dx, dy, w, d, h, yaw in [(-44, 8, 20, 16, 12, .1), (46, 6, 22, 15, 11, -.1), (-30, -20, 16, 12, 9, 0), (34, -20, 16, 12, 9, .0)]:
        house(c, B, dx, dy, w, d, h, yaw, P('#d4c49c'), P('#7a4e3e'), rs)
    # besieging camp: dark pavilions with serpent banners
    for dx, dy in [(-120, -92), (112, -96), (-150, -34), (150, -40)]:
        b0 = c.W(MW.KEEP[0] + dx, MW.KEEP[1] + (-dy) * .6)
        f.gable((b0[0], b0[1], b0[2]), 18, 16, 14, .1 * dx / 40, P('#6b5a64'), overhang=0, jit=.02)
        stick(f, (b0[0], b0[1], b0[2]), (b0[0], b0[1], b0[2] + 34), .5, .4, P('#2a2420'))
        f.add([(b0[0], b0[1], b0[2] + 34), (b0[0] + 10, b0[1], b0[2] + 31), (b0[0], b0[1], b0[2] + 28)], [(0, 1, 2)], P('#3d6a2e'))


# =========================================================================================== Throne of Coils
def throne(c):
    rs = np.random.RandomState(505)
    B = c.W(*MW.THRONE); z0 = B[2] - 6
    f = c.flat; obs = P('#2a2530'); obs2 = P('#3d3248')
    HS = 168.0
    r_of = lambda t: 22 * (1 - t) ** .9 + 3.2
    # the spire: a twisted stack of tapering prisms (a thorned obsidian needle)
    segs = 21
    for i in range(segs):
        t0 = i / segs; t1 = (i + 1) / segs
        f.cone((B[0], B[1], z0 + t0 * HS), r_of(t0), HS / segs + .6, 6, jit_col(rs, obs if i % 2 else obs2), yaw=i * .46, rtop=r_of(t1), jit=.025, cap=False)
    for k in range(26):
        t = .12 + .8 * rs.rand(); a = rs.rand() * 6.28; r = r_of(t) * .9
        p0 = (B[0] + math.cos(a) * r, B[1] + math.sin(a) * r, z0 + t * HS)
        ln = 11 + 12 * rs.rand()
        stick(f, p0, (p0[0] + math.cos(a) * ln, p0[1] + math.sin(a) * ln, p0[2] + 7 + 9 * rs.rand()), 2.1, .2, P('#1e1a24'), 4)
    # crag shards behind and beside the foot of the spire (the front stays open so the serpent reads)
    for k in range(9):
        a = math.radians(rs.rand() * 210 - 15) if k < 7 else math.radians(180 + rs.rand() * 40)
        r = 42 + 30 * rs.rand()
        f.cone((B[0] + math.cos(a) * r * 1.2, B[1] + abs(math.sin(a)) * r * .9, z0 - 4), 13 + 8 * rs.rand(), 30 + 36 * rs.rand(), 5, jit_col(rs, obs2), rtop=2.5, jit=.03, yaw=a)
    # glowing rune cracks spiralling up the needle
    for k in range(3):
        pts = []
        for i in range(30):
            t = .06 + .86 * i / 29; a = 6.3 * t * 1.6 + k * 2.1
            r = r_of(t) * .985
            pts.append((B[0] + math.cos(a) * r, B[1] + math.sin(a) * r, z0 + t * HS))
        c.glow.tube(pts, .6, n=4, col=P('#b8ff60'), jit=0)
    # the serpent: three lazy turns up the spire (wide pitch so the black needle shows between coils), head crowning it, facing the road
    def scales(t, k):
        band = 0.5 + 0.5 * math.sin(t * 190)
        belly = .45 < k < .9
        col = np.array(P('#c7c07a')) * (0.9 + .1 * band) if belly else np.array(P('#4e7a3a')) * (0.78 + .3 * band)
        return tuple(np.clip(col, 0, 1))
    N = 120; pts = []
    for i in range(N):
        t = i / (N - 1); tt = t * .82
        a = 2 * math.pi * 3.1 * t + .6; r = r_of(tt) + 4.6
        pts.append((B[0] + math.cos(a) * r, B[1] + math.sin(a) * r * .95, z0 + 14 + t * (HS * .8)))
    rad = [5.6 - 2.2 * (i / (N - 1)) for i in range(N)]
    c.smooth.tube(pts, rad, n=9, col=P('#4e7a3a'), jit=0, colfn=scales)
    # slack coils piled at the foot of the crag
    pts2 = []
    for i in range(70):
        t = i / 69; a = 2 * math.pi * 1.35 * t + 3.4; r = 52 - 12 * t
        pts2.append((B[0] + math.cos(a) * r, B[1] + math.sin(a) * r * .92 - 10, z0 + 8 + 5 * math.sin(t * 8)))
    c.smooth.tube(pts2, [8.0] * 70, n=9, col=P('#4e7a3a'), jit=0, colfn=scales)
    top = pts[-1]
    hd = (top[0] - 6, top[1] - 7, top[2] + 10)
    c.smooth.ellipsoid(hd, 12, 15, 8.5, P('#4e7a3a'), nu=9, nv=6, jit=.02)
    c.smooth.ellipsoid((hd[0], hd[1] - 14, hd[2] - 2), 7, 8, 4.2, P('#5d8b44'), nu=7, nv=5, jit=.02)
    for sgn in (-1, 1):
        c.glow.ellipsoid((hd[0] + sgn * 6.8, hd[1] - 7, hd[2] + 5.2), 3.0, 3.0, 3.0, P('#d8ff6a'), nu=6, nv=4, jit=0)
        f.cone((hd[0] + sgn * 3.4, hd[1] - 19.5, hd[2] - 3), 1.2, 7, 4, P('#f3ead2'), rtop=0, jit=0)
    stick(f, (hd[0], hd[1] - 21, hd[2] - 3), (hd[0] - 5, hd[1] - 32, hd[2] - 3), .6, .2, P('#a8261a'), 4)
    stick(f, (hd[0], hd[1] - 21, hd[2] - 3), (hd[0] + 5, hd[1] - 32, hd[2] - 3), .6, .2, P('#a8261a'), 4)
    c.lights.append((MW.THRONE[0], MW.THRONE[1] + 36, B[2] + 90, 200000, (.62, 1.0, .35), 9))
    for k in range(7):   # low shards flanking the road side of the crag
        a = math.radians(205 + k * 21 + rs.rand() * 8); r = 50 + 22 * rs.rand()
        f.cone((B[0] + math.cos(a) * r * 1.25, B[1] + math.sin(a) * r * .9, z0 - 6), 9 + 6 * rs.rand(), 14 + 18 * rs.rand(), 5, jit_col(rs, obs2), rtop=2, jit=.03, yaw=a)


# =========================================================================================== small things
def ruin(c):
    rs = np.random.RandomState(606)
    B = c.W(850, 452); f = c.flat
    stone = P('#d3c298')
    f.cyl((B[0], B[1], B[2] - 1), 10, 32, 8, stone, rtop=9)
    for k in range(7):
        a = k * .95; f.box((B[0] + math.cos(a) * 8, B[1] + math.sin(a) * 8, B[2] + 31), (4.6, 3.6, 3 + rs.rand() * 8), a, jit(rs, stone))
    f.box((B[0], B[1] - 10, B[2] + 14), (4, .8, 9), 0, P('#2a1a14'))
    for dx, dy, h in [(-36, 4, 14), (26, -6, 11), (-22, -16, 6), (40, 6, 8)]:
        f.cyl((B[0] + dx, B[1] + dy, B[2] - 1), 4.4, h, 7, stone, rtop=3.8)
    f.box((B[0] + 26, B[1] - 10, B[2]), (24, 5, 4), .4, P('#c3b186'))
    for _ in range(18):
        a = rs.rand() * 6.28; r = 14 + rs.rand() * 40
        f.box((B[0] + math.cos(a) * r, B[1] + math.sin(a) * r * .8, B[2]), (2 + rs.rand() * 4, 2 + rs.rand() * 3, 1 + rs.rand() * 3), rs.rand() * 3, jit(rs, P('#bfae84'), .06))


def stones(c):
    rs = np.random.RandomState(707)
    B = c.W(1060, 668); f = c.flat; n = 7
    for i in range(n):
        a = i / n * 6.28; r = 30
        h = 14 + 6 * rs.rand()
        f.box((B[0] + math.cos(a) * r * 1.2, B[1] + math.sin(a) * r, B[2] - 1), (6.5, 3.6, h), a + 1.57 + (rs.rand() - .5) * .3, jit(rs, P('#a9a08c'), .05))
    f.box((B[0], B[1], B[2]), (14, 8, 3), .2, P('#8e8674'))
    f.box((B[0] + 5, B[1] + 14, B[2]), (22, 3.6, 3), 0, P('#a49c88'))


def camps(c):
    rs = np.random.RandomState(808)
    for (x, y), tone in zip(MW.CAMPS[1:4], ['#e9d6a0', '#e0caa0', '#e8d3a8']):
        B = c.W(x, y); f = c.flat
        f.gable((B[0], B[1], B[2]), 16, 13, 13, .25, P(tone), overhang=0, jit=.03)
        f.box((B[0] + 1, B[1] - 6.7, B[2]), (5, .5, 7), .25, P('#4a3424'))
        stick(f, (B[0] + 9, B[1] + 2, B[2]), (B[0] + 9, B[1] + 2, B[2] + 24), .5, .4, P('#4a3020'))
        f.add([(B[0] + 9, B[1] + 2, B[2] + 24), (B[0] + 17, B[1] + 2, B[2] + 21), (B[0] + 9, B[1] + 2, B[2] + 18)], [(0, 1, 2)], P('#a8261a'))
        f.cyl((B[0] - 12, B[1] - 8, B[2]), 3.4, 1.4, 7, P('#4a4038'))
        c.emit.cone((B[0] - 12, B[1] - 8, B[2] + 1.2), 2.2, 6, 5, P('#f08a20'), cap=False)
        c.lights.append((x - 12, y + 10, B[2] + 10, 4000, (1, .6, .25), 3))
        smoke(c, B, -12, -8, 8, 3, .35, rs, drift=(2, 1), col=(.6, .58, .55))
        for a_ in range(5):
            f.box((B[0] - 12 + math.cos(a_ * 1.26) * 5.6, B[1] - 8 + math.sin(a_ * 1.26) * 5.6, B[2]), (2.4, 1.4, 1.2), a_, P('#6a6054'))


def hamlets(c):
    rs = np.random.RandomState(909)
    from .mapprops import HAMLETS
    for hx, hy in HAMLETS:
        B = c.W(hx, hy); n = 3 + rs.randint(2)
        for i in range(n):
            a = i / n * 6.28 + rs.rand(); r = 10 + rs.rand() * 20
            roof = [P('#a5502e'), P('#b8793c'), P('#9a6a44'), P('#8a5a3a')][rs.randint(4)]
            house(c, (B[0] + math.cos(a) * r * 1.5, B[1] + math.sin(a) * r * .8, B[2]), 0, 0, 16 + 8 * rs.rand(), 13 + 4 * rs.rand(), 9 + 5 * rs.rand(), rs.rand() * 3, P('#ecdcb2'), roof, rs)
        for k in range(3):
            c.smooth.ellipsoid((B[0] + 16 + k * 6, B[1] - 14 - 3 * k, B[2] + 2.6), 4.4, 4, 3.2, P('#d8bf64'), nu=7, nv=4, jit=.04)
        c.smoke.ellipsoid((B[0] + 4, B[1] + 8, B[2] + 24), 4, 4, 4, (.7, .68, .64), nu=6, nv=4)
        c.smoke.ellipsoid((B[0] + 9, B[1] + 10, B[2] + 33), 6, 6, 5, (.72, .70, .66), nu=6, nv=4)
    # windmill in the east farmland
    B = c.W(1110, 725); f = c.flat
    f.cone((B[0], B[1], B[2]), 11, 36, 8, P('#e6d6aa'), rtop=7)
    f.cone((B[0], B[1], B[2] + 36), 9, 12, 8, P('#a14a2e'))
    hub = (B[0], B[1] - 7.5, B[2] + 38)
    for k in range(4):
        a = k * math.pi / 2 + .5
        stick(f, hub, (hub[0] + math.cos(a) * 28, hub[1] - .5, hub[2] + math.sin(a) * 28), .9, .7, P('#6a4a30'))
        px, pz = math.cos(a) * 17, math.sin(a) * 17
        qx, qz = -math.sin(a) * 6, math.cos(a) * 6
        f.add([(hub[0] + px + qx, hub[1] - .8, hub[2] + pz + qz), (hub[0] + px * 1.6 + qx, hub[1] - .8, hub[2] + pz * 1.6 + qz), (hub[0] + px * 1.6, hub[1] - .8, hub[2] + pz * 1.6), (hub[0] + px, hub[1] - .8, hub[2] + pz)], [(0, 1, 2, 3)], P('#efe2bd'))


def boulders(c):
    rs = np.random.RandomState(1001)
    n = 0
    for _ in range(900):
        x = 40 + rs.rand() * 1500; y = 60 + rs.rand() * 780
        if c.at('F', x, y) < 14 or c.at('lk', x, y) > -.15 or c.at('dr', x, y) < c.at('wr', x, y) * 1.8 + 3:
            continue
        sl = c.gz(x + 4, y) - c.gz(x - 4, y), c.gz(x, y + 4) - c.gz(x, y - 4)
        zz = c.gz(x, y)
        if not (zz > 24 or math.hypot(*sl) > 4 or rs.rand() < .06):
            continue
        if MW.ash_mask(np.array([x]), np.array([y]), np.array([c.at('F', x, y)]))[0] > .5 and rs.rand() < .6:
            continue
        if np.hypot(x - 1170, (y - 482) / .72) < 125 or np.hypot(x - 270, (y - 640) / .75) < 120:
            continue
        B = c.W(x, y); s = .6 + rs.rand() * 1.1
        c.flat.ellipsoid((B[0], B[1], B[2] + 1), 5 * s, 4 * s, 3 * s, jit(rs, P('#a8977a'), .08), nu=6, nv=4, noise=.35)
        n += 1
        if n > 190:
            break


def island(c):
    rs = np.random.RandomState(1100)
    B = c.W(1480, 725); f = c.flat
    for dx, dy, h, bend in [(-34, -4, 34, 6), (30, 8, 30, -5), (4, 16, 26, 4), (-8, -18, 28, -4)]:
        pts = [(B[0] + dx + bend * (t ** 2), B[1] + dy, B[2] + t * h) for t in np.linspace(0, 1, 6)]
        f.tube(pts, [2.0, 1.8, 1.6, 1.4, 1.2, 1.0], n=5, col=P('#6e5030'), jit=.02)
        tipx, tipy, tipz = pts[-1]
        for k in range(7):
            a = k / 7 * 6.28 + rs.rand() * .3
            e = (tipx + math.cos(a) * 17, tipy + math.sin(a) * 17, tipz - 6)
            f.tube([(tipx, tipy, tipz), (tipx + math.cos(a) * 9, tipy + math.sin(a) * 9, tipz + 3), e], [1.6, 1.4, .3], n=3, col=jit(rs, P('#6f8a3c'), .1), jit=.0)
    for dx, dy in [(-12, -26), (-2, -30), (10, -24), (-20, -10), (22, -16), (14, -34)]:
        yaw = (rs.rand() - .5) * .5
        f.box((B[0] + dx, B[1] + dy, B[2]), (5, 1.8, 8 + rs.rand() * 3), yaw, P('#cfc6ae'))
        f.ellipsoid((B[0] + dx, B[1] + dy, B[2] + 8.6), 2.5, 0.9, 2.0, P('#cfc6ae'), nu=6, nv=3, jit=.02)
    stick(f, (B[0] + 0, B[1] - 8, B[2]), (B[0], B[1] - 8, B[2] + 17), 0.9, .9, P('#5a4028')); stick(f, (B[0] - 5, B[1] - 8, B[2] + 11), (B[0] + 5, B[1] - 8, B[2] + 11), .8, .8, P('#5a4028'))


def ship(c):
    rs = np.random.RandomState(1201)
    # the landing: a jetty and a ship at anchor
    B = to_world(176, 842, -9 + 1.0); f = c.flat
    f.ellipsoid((B[0], B[1], B[2] + 1.5), 38, 12, 8, P('#a97f4c'), nu=12, nv=6, jit=.02)
    f.box((B[0], B[1], B[2] + 5.5), (60, 16, 1.2), 0, P('#c9a870'), jit=.02)
    for dx in range(-28, 30, 6):
        f.box((B[0] + dx, B[1], B[2] + 4.5), (.7, 17, 1), 0, P('#8a6a40'))
    stick(f, (B[0], B[1], B[2] + 5), (B[0], B[1], B[2] + 64), 1.6, 1.0, P('#5a4028'))
    stick(f, (B[0] + 12, B[1], B[2] + 5), (B[0] + 12, B[1], B[2] + 48), 1.2, .8, P('#5a4028'))
    f.add([(B[0] - 1, B[1], B[2] + 60), (B[0] + 20, B[1] - 3, B[2] + 48), (B[0] + 20, B[1] - 3, B[2] + 18), (B[0] - 1, B[1], B[2] + 16)], [(0, 1, 2, 3)], P('#f4e8c4'))
    f.add([(B[0] + 13, B[1], B[2] + 44), (B[0] + 28, B[1] - 3, B[2] + 36), (B[0] + 28, B[1] - 3, B[2] + 15), (B[0] + 13, B[1], B[2] + 14)], [(0, 1, 2, 3)], P('#e8d8ae'))
    f.add([(B[0] - 1, B[1], B[2] + 64), (B[0] - 13, B[1], B[2] + 61), (B[0] - 1, B[1], B[2] + 58)], [(0, 1, 2)], P('#a8261a'))
    # jetty
    J = to_world(118, 802, 4.0)
    f.box((J[0] + 8, J[1] - 12, J[2]), (11, 52, 1.4), -.2, P('#8a6a40'))
    for k in range(5):
        for sgn in (-1, 1):
            f.cyl((J[0] + 8 + sgn * 5.4 - 3 * k * .2, J[1] - 36 + k * 11, J[2] - 6), 1.0, 8, 5, P('#4a3424'))


def seaserpent(c):
    B = to_world(1470, 848, -9.0); sm = c.smooth
    pts = []
    for i in range(80):
        t = i / 79; x = -72 + t * 140
        h = max(0.0, math.sin(t * 3 * math.pi)) ** .8 * 17
        pts.append((B[0] + x, B[1] + 4 * math.sin(t * 9), B[2] + h - 2))
    sm.tube(pts, [4.6] * 80, n=8, col=P('#6f9a7c'), jit=0, colfn=lambda t, k: tuple(np.array(P('#6f9a7c')) * (.84 + .2 * (.5 + .5 * math.sin(t * 120)))))
    top = pts[-1]
    sm.ellipsoid((top[0] + 8, top[1], top[2] + 6), 10, 6, 5, P('#7aa88a'), nu=8, nv=5)
    for sgn in (-1, 1):
        c.glow.ellipsoid((top[0] + 11, top[1] + sgn * 4, top[2] + 9), 1.3, 1.3, 1.3, P('#fff0a0'), nu=5, nv=3, jit=0)
    for i in range(0, 80, 6):
        stick(c.flat, pts[i], (pts[i][0], pts[i][1], pts[i][2] + 7), 1.2, .2, P('#4f7a5c'), 3)


BUILD = [('village', village), ('tortoise', tortoise), ('eagles', eagles), ('keep', keep), ('throne', throne), ('ruin', ruin), ('stones', stones), ('camps', camps),
         ('hamlets', hamlets), ('boulders', boulders), ('island', island), ('ship', ship), ('seaserpent', seaserpent)]
