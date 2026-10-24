"""The realm of KnotzCopperAx as a heightfield + painted albedo (ui-flow r7). Pure numpy (see mapkit.py for the space).

terrain()  -> dict of 1601x901 float32 fields (map space, 1 sample per map unit): Z height, F land distance-ish, masks.
paint(T, tw, th) -> th x tw x 3 sRGB albedo (float 0..1) with biomes, shores, rivers, lake, roads, ash, farmland, snow.
"""
import math
import numpy as np
from .mapkit import (vnoise, fbm, ridged, smoothstep, mix, seg_dist, catmull, resize, blur, hexc)

W, H = 1600, 900
LOC = {0: (110, 790), 1: (270, 640), 2: (585, 505), 3: (880, 270), 4: (1170, 480), 5: (1396, 306)}
CAMPS = [(160, 730), (420, 600), (725, 400), (1040, 395), (1280, 360)]
LAKE = (585, 522, 176, 84)
KEEP = (1170, 482)
THRONE = (1400, 252)
VILLAGE = (270, 640)
PEAKS = [(900, 292, 212, 108), (815, 312, 168, 94), (990, 314, 162, 90), (730, 346, 118, 78), (1072, 346, 118, 74), (860, 352, 126, 68), (945, 356, 116, 64), (655, 372, 72, 56)]
RIVER = [(950, 345), (985, 395), (962, 470), (1000, 540), (1040, 605), (1075, 660), (1120, 722), (1156, 782), (1186, 870)]
STREAM = [(588, 600), (578, 652), (606, 712), (598, 790), (602, 880)]


def leg_points(a, b, n=26):
    A, B, C = LOC[a], LOC[b], CAMPS[a]
    P1 = ((A[0] + C[0]) / 2 + 20, (A[1] + C[1]) / 2 + 26)
    P2 = (2 * C[0] - P1[0], 2 * C[1] - P1[1])
    pts = []
    for t in np.linspace(0, 1, n):
        pts.append(((1 - t) ** 2 * A[0] + 2 * (1 - t) * t * P1[0] + t * t * C[0], (1 - t) ** 2 * A[1] + 2 * (1 - t) * t * P1[1] + t * t * C[1]))
    for t in np.linspace(0, 1, n)[1:]:
        pts.append(((1 - t) ** 2 * C[0] + 2 * (1 - t) * t * P2[0] + t * t * B[0], (1 - t) ** 2 * C[1] + 2 * (1 - t) * t * P2[1] + t * t * B[1]))
    return pts


def road_points():
    out = []
    for a in range(5):
        out += leg_points(a, a + 1)
    return out


def grid(step=1.0):
    xs = np.arange(0, W + 1, step, dtype=np.float32); ys = np.arange(0, H + 1, step, dtype=np.float32)
    return np.meshgrid(xs, ys)


def land_field(X, Y):
    rho = np.sqrt(((X - 760) / 720) ** 2 + ((Y - 470) / 380) ** 2)
    a = np.arctan2((Y - 470) / 380, (X - 760) / 720)
    r = 1 + 0.10 * np.sin(3 * a + 0.5) + 0.06 * np.sin(7 * a + 1.3) + 0.024 * np.sin(13 * a + 2.0)
    rag = 60 * (fbm(X / 260, Y / 260, 3, seed=3) - .5) + 20 * (fbm(X / 58, Y / 58, 3, seed=4) - .5)
    F = (r - rho) * 330 + rag
    f2 = (1 - np.hypot((X - 215) / 178, (Y - 748) / 88)) * 88 + rag * .5
    f3 = (1 - np.hypot((X - 1390) / 160, (Y - 262) / 130)) * 130 + rag * .5
    f4 = (1 - np.hypot((X - 1480) / 96, (Y - 725) / 62)) * 62 + rag * .4
    F = np.maximum(np.maximum(F, f2), np.maximum(f3, f4))
    bt = 1 - np.hypot((X - 800) / 430, (Y - 28) / 168) + 0.06 * (fbm(X / 120, Y / 120, 3, seed=9) - .5)
    bb = 1 - np.hypot((X - 800) / 372, (Y - 906) / 168) + 0.06 * (fbm(X / 120, Y / 120, 3, seed=10) - .5)
    F = np.minimum(F, np.minimum(-bt * 260, -bb * 260))
    return F.astype(np.float32)


def forest_mask(X, Y, F, Z):
    return smoothstep(.55, .67, fbm(X / 150, Y / 120, 4, seed=66)) * smoothstep(8, 22, F) * (1 - smoothstep(34, 58, Z))


def ash_mask(X, Y, F):
    vd = np.hypot(X - 270, (Y - 640) / .75)
    return (1 - smoothstep(60, 150, vd + 40 * (fbm(X / 120, Y / 100, 4, seed=61) - .5))) * smoothstep(-5, 18, F)


def terrain(step=1.0):
    X, Y = grid(step)
    T = {'X': X, 'Y': Y}
    F = land_field(X, Y); T['F'] = F
    land = smoothstep(-3, 5, F)
    inland = smoothstep(0, 70, F)
    rolling = fbm(X / 190, Y / 170, 4, seed=7) - .5
    z = 3 + 11 * inland + 16 * rolling * inland
    z += 12 * np.clip(fbm(X / 330, Y / 300, 3, seed=19) - .52, 0, 1) * 5 * inland            # broad uplands
    # --- Eaglespine: sharp ridged massif with domain warp
    Xw = X + 34 * (fbm(X / 90, Y / 90, 3, seed=11) - .5); Yw = Y + 34 * (fbm(X / 90, Y / 90, 3, seed=12) - .5)
    rid = ridged(X / 46, Y / 46, 4, seed=21)
    zm = np.zeros_like(X)
    for px, py, h, s in PEAKS:
        d = np.hypot((Xw - px), (Yw - py) * 1.3) / s
        zm = np.maximum(zm, h * np.clip(1 - d, 0, 1) ** 1.55)
    d, _ = seg_dist(Xw, Yw * 1.0, [(740, 350), (830, 318), (905, 300), (990, 322), (1070, 350)])
    zm = np.maximum(zm, 76 * np.clip(1 - d / 82, 0, 1) ** 1.2)
    zm = zm * (0.62 + 0.62 * rid) + 12 * np.clip(zm / 50, 0, 1) * (fbm(X / 13, Y / 13, 2, seed=31) - .4)
    z = np.maximum(z, z * .25 + zm)
    # --- foothills around the range and a few free hills
    for hx, hy, hr, hh in [(700, 355, 70, 22), (1070, 350, 60, 20), (430, 335, 100, 28), (360, 470, 70, 18), (1015, 640, 70, 20), (790, 760, 80, 16), (1290, 640, 80, 24), (1310, 520, 60, 22), (470, 760, 70, 17), (1190, 700, 70, 18)]:
        z += hh * np.clip(1 - np.hypot((X - hx) / hr, (Y - hy) / (hr * .7)), 0, 1) ** 1.4 * (.75 + .5 * fbm(X / 30, Y / 30, 2, seed=33))
    # --- Throne of Coils: black crag
    tc = np.clip(1 - np.hypot((Xw - THRONE[0]) / 82, (Yw - THRONE[1]) / 60), 0, 1)
    zt = 84 * tc ** 1.2 * (.7 + .55 * ridged(X / 30, Y / 30, 3, seed=41)) + 12 * tc
    z = np.maximum(z, z * .3 + zt)
    # --- Serpent Keep: plateau + moat ring
    kd = np.hypot((X - KEEP[0]) / 1.0, (Y - KEEP[1]) / 0.72) + 7 * (fbm(X / 40, Y / 40, 2, seed=70) - .5)
    plateau = 20 * np.clip(1 - kd / 135, 0, 1) ** 0.7
    z = np.maximum(z, plateau * 1.0 + (1 - smoothstep(60, 135, kd)) * 0)
    z = mix(z, 19.0, 1 - smoothstep(70, 90, kd))
    moat = smoothstep(82, 90, kd) * (1 - smoothstep(98, 108, kd))
    z = mix(z, 2.0, moat)
    T['moat'] = moat.astype(np.float32); T['kd'] = kd.astype(np.float32)
    # --- Ashen Wilds: scorched plain
    vd = np.hypot((X - VILLAGE[0]) / 1.0, (Y - VILLAGE[1]) / 0.75)
    z = mix(z, 9.0 + 2 * rolling, 1 - smoothstep(90, 125, vd))
    T['vd'] = vd.astype(np.float32)
    # --- lake with a tortoise wallow
    lk = 1 - np.hypot((X - LAKE[0]) / LAKE[2], (Y - LAKE[1]) / LAKE[3]) + 0.08 * (fbm(X / 40, Y / 40, 3, seed=51) - .5)
    T['lk'] = lk.astype(np.float32)
    z = mix(z, -3.5, smoothstep(0.0, 0.1, lk))
    # --- rivers
    rp = catmull(RIVER, 10); sp = catmull(STREAM, 10)
    dr, pr = seg_dist(X, Y, rp); ds, ps = seg_dist(X, Y, sp)
    wr = 2.6 + 3.2 * pr; ws = 2.0 + 1.6 * ps
    rv = 1 - smoothstep(wr * .8, wr * 1.7, dr); sv = 1 - smoothstep(ws * .8, ws * 1.7, ds)
    z = mix(z, np.minimum(z, -1.6), np.maximum(rv, sv))
    T['river'] = np.maximum(rv, sv).astype(np.float32); T['dr'] = dr; T['wr'] = wr
    T['ds'] = ds; T['ws'] = ws
    # --- sea
    z = mix(-9.0, z, land)
    T['Z'] = z.astype(np.float32); T['land'] = land.astype(np.float32); T['rid'] = rid
    T['zm'] = zm.astype(np.float32); T['zt'] = zt.astype(np.float32)
    rd, _ = seg_dist(X, Y, road_points()); T['road_d'] = rd
    return T


def height_at(T, x, y):
    """Terrain height under map point (x, y) (nearest sample)."""
    Z = T['Z']; h, w = Z.shape
    return float(Z[int(np.clip(round(y * (h - 1) / H), 0, h - 1)), int(np.clip(round(x * (w - 1) / W), 0, w - 1))])


def slope_of(Z):
    gy, gx = np.gradient(Z)
    return np.hypot(gx, gy)


# ------------------------------------------------------------------------------------------------ albedo painting
C = lambda h: np.array(hexc(h), np.float32)
PAL = dict(
    grassA=C('#b8ae6c'), grassB=C('#a4a45e'), grassC=C('#c9b878'), dry=C('#c9b070'), forest=C('#7f8a4a'), forest2=C('#68763e'),
    rock=C('#a2937c'), rock2=C('#7a6a5c'), snow=C('#f6f2e6'), sand=C('#e3d09a'), seaA=C('#b3cfc7'), seaB=C('#8db6b0'),
    lakeA=C('#7fb0ab'), lakeB=C('#4f8a8e'), ash=C('#4a3f38'), ash2=C('#2f2824'), ember=C('#e8641c'), road=C('#d8bf86'),
    black=C('#2b2530'), parch=C('#e9d7a8'), field1=C('#cdbb68'), field2=C('#9fa656'), scorch=C('#6b4c36'),
)


def _stack(*ch):
    return np.stack(ch, -1)


def paint(T, tw=3200, th=1800, seed=5):
    """Albedo for the terrain, resolution tw x th (planar-mapped over the 1600x900 map)."""
    rs = lambda a: resize(a, tw, th)
    xs = (np.arange(tw, dtype=np.float32) + .5) * W / tw; ys = (np.arange(th, dtype=np.float32) + .5) * H / th
    X, Y = np.meshgrid(xs, ys)
    Z = rs(T['Z']); F = rs(T['F']); lk = rs(T['lk']); rv = rs(T['river'])
    slope = rs(slope_of(T['Z'])) * 1.0
    nA = fbm(X / 120, Y / 100, 4, seed=61); nB = fbm(X / 26, Y / 26, 3, seed=62); nC = fbm(X / 6, Y / 6, 2, seed=63)
    # ---- land base
    base = mix(PAL['grassA'], PAL['grassB'], smoothstep(.35, .65, nA)[..., None])
    base = mix(base, PAL['dry'], (smoothstep(.55, .8, fbm(X / 210, Y / 160, 3, seed=64)) * .8)[..., None])
    base = base * (0.93 + 0.14 * nB[..., None]) * (0.97 + 0.06 * nC[..., None])
    # grass tick specks: tiny darker flecks
    fleck = smoothstep(.72, .8, fbm(X / 2.2, Y / 2.2, 2, seed=65))
    base = base * (1 - .09 * fleck[..., None])
    # elevation: uplands drier / greyer
    up = smoothstep(14, 36, Z)
    base = mix(base, PAL['dry'] * .96, (up * .55)[..., None])
    # forest floor mask (trees are meshes on top; the floor darkens to green)
    forest = forest_mask(X, Y, F, Z)
    base = mix(base, mix(PAL['forest'], PAL['forest2'], nB[..., None]), (forest * .85)[..., None])
    # rock on steep ground and high ground; snow high
    rockm = smoothstep(.4, 1.0, slope * 1.4) * smoothstep(6, 30, Z)
    strata = .5 + .5 * np.sin(Z * .9 + 4 * fbm(X / 30, Y / 30, 2, seed=67))
    rock = mix(PAL['rock'], PAL['rock2'], (.35 + .5 * nB * (.6 + .4 * strata))[..., None])
    base = mix(base, rock, (rockm * .95)[..., None])
    rid = rs(T['rid'])
    snow = smoothstep(122, 152, Z + 14 * (nB - .5) + 12 * (rid - .5)) * (1 - smoothstep(.7, 1.3, slope * 1.1) * .45)
    base = mix(base, PAL['snow'], snow[..., None])
    # ---- Throne: charred obsidian crag + purple/green stain
    tz = smoothstep(18, 60, rs(T['zt']))
    td = np.hypot((X - 1400) / 1.0, (Y - 255) / .7)
    char = (1 - smoothstep(75, 160, td)) * smoothstep(-5, 25, F)
    base = mix(base, mix(PAL['black'], PAL['rock2'] * .6, (nB * .6)[..., None]), np.clip(char * .85 + tz * .8, 0, 1)[..., None])
    # ---- Ashen Wilds: ash + scorch + embers
    vd = np.hypot(X - 270, (Y - 640) / .75)
    ash = ash_mask(X, Y, F)
    base = mix(base, mix(PAL['ash'], PAL['scorch'], (nB * .8)[..., None]), (ash * .92)[..., None])
    embers = smoothstep(.78, .86, fbm(X / 4.5, Y / 4.5, 2, seed=68)) * ash * (1 - smoothstep(30, 90, vd))
    base = mix(base, PAL['ember'], (embers * .85)[..., None])
    # ---- farmland (r8): each patch is a quilt of 3-5 irregular plots - own furrow angle + pitch, own crop colour (wheat / green crop /
    # plough / fallow), soft furrows, a dark hedgerow between plots - instead of one uniform stripe pattern
    crops = [mix(PAL['field1'], C('#e0c860'), .5), PAL['field2'], C('#8a6a44'), C('#b3a85c'), C('#7e9448'), C('#c9b070')]
    rf = np.random.RandomState(404)
    for fx, fy, fw, fh, ang in [(480, 770, 100, 44, .15), (1040, 700, 110, 50, -.2), (700, 700, 90, 36, .05), (1290, 700, 86, 50, .3), (440, 360, 70, 36, -.1), (1330, 560, 66, 46, .2)]:
        u = (X - fx) * math.cos(ang) + (Y - fy) * math.sin(ang); v = -(X - fx) * math.sin(ang) + (Y - fy) * math.cos(ang)
        inside = 1 - smoothstep(.82, 1.0, np.maximum(np.abs(u) / fw, np.abs(v) / fh)) * 1.0
        inside = inside * (smoothstep(6, 20, F) * (1 - rv)) * (1 - ash)
        if not (inside > .01).any():
            continue
        wu = u + 9 * (fbm(X / 40, Y / 40, 2, seed=405) - .5); wv = v + 7 * (fbm(X / 33 + 5, Y / 33, 2, seed=406) - .5)
        cu = [rf.uniform(-.55, -.25), rf.uniform(.0, .3), rf.uniform(.45, .7)][:rf.randint(2, 4)]
        cv = rf.uniform(-.15, .25)
        pid = np.zeros_like(u, dtype=np.int32); hedge = np.zeros_like(u)
        for k, c_ in enumerate(cu):
            pid += (wu / fw > c_).astype(np.int32)
            hedge = np.maximum(hedge, 1 - smoothstep(.0, 1.6, np.abs(wu - c_ * fw)))
        pid = pid * 2 + (wv / fh > cv).astype(np.int32)
        hedge = np.maximum(hedge, 1 - smoothstep(.0, 1.6, np.abs(wv - cv * fh)))
        col = np.zeros(u.shape + (3,), np.float32)
        for k in range(int(pid.max()) + 1):
            m = pid == k
            if not m.any():
                continue
            a2 = rf.uniform(0, math.pi); pitch = rf.uniform(5.5, 9.5)
            fur = .5 + .5 * np.sin((u * math.cos(a2) + v * math.sin(a2)) * (2 * math.pi / pitch) + 1.2 * np.sin(u * .05))
            fur = smoothstep(.25, .75, fur) * rf.uniform(.35, .75)
            c0 = np.array(crops[rf.randint(len(crops))], np.float32)
            plot = c0[None, None, :] * (1 - .22 * fur[..., None]) * rf.uniform(.92, 1.06)
            col = np.where(m[..., None], plot, col)
        col = mix(col, PAL['conifer'] if 'conifer' in PAL else C('#4a6334'), (hedge * .8)[..., None])
        base = mix(base, col * (.95 + .1 * nB[..., None]), (inside * .9)[..., None])
    # ---- road (pale dirt under the ink route)
    rd = rs(T['road_d'])
    roadm = 1 - smoothstep(2.4, 4.2, rd + 1.6 * (nC - .5))
    roadm *= (1 - smoothstep(-5, 5, -(F))) * (1 - rv) * (1 - snow)
    base = mix(base, PAL['road'], (roadm * .9)[..., None])
    # ---- shores
    sand = (1 - smoothstep(4, 15, F + 4 * (nB - .5))) * smoothstep(-6, 1, F)
    base = mix(base, PAL['sand'], (sand * .9)[..., None])
    # ---- lake / rivers / moat / sea
    lkm = smoothstep(-.01, .02, lk)
    depth = smoothstep(.02, .55, lk)
    lakec = mix(PAL['lakeA'], PAL['lakeB'], depth[..., None])
    lakec = lakec * (.93 + .12 * fbm(X / 18, Y / 7, 3, seed=69)[..., None])
    base = mix(base, lakec, lkm[..., None])
    # wake / foam rings around the wading tortoise
    tr = np.hypot((X - 562) / 1.0, (Y - 520) / .5)
    foam = np.zeros_like(tr)
    for rr, wd, a in [(112, 3.2, .75), (132, 2.4, .5), (156, 2.0, .32), (182, 1.6, .2)]:
        foam += np.exp(-((tr - rr - 6 * (nB - .5)) / wd) ** 2) * a
    base = mix(base, np.array([.93, .96, .92], np.float32), (np.clip(foam, 0, .8) * lkm * (lk > .05))[..., None])
    rvm = smoothstep(.15, .6, rv)
    base = mix(base, mix(PAL['lakeA'], PAL['lakeB'], .35), (rvm * (1 - lkm))[..., None])
    moat = smoothstep(.2, .7, rs(T['moat']))
    base = mix(base, PAL['lakeB'], (moat * .9)[..., None])
    sea = 1 - smoothstep(-6, 1.5, F)
    # coast-parallel lines in the sea (engraver's water lining)
    lines = (np.abs(np.sin((-F * .16) + 1.2 * (nA - .5))) < .1) & (F < -3) & (F > -75)
    seac = mix(PAL['seaA'], PAL['seaB'], smoothstep(0, 100, -F)[..., None] * .8)
    seac = seac * (1 - (lines.astype(np.float32) * (1 - smoothstep(0, 75, -F)) * .22)[..., None])
    base = mix(base, seac, (sea * (1 - lkm * 0))[..., None])
    # engraver's wave glyphs in open water (small ~ strokes, darker teal ink)
    rw = np.random.RandomState(77); ink = np.zeros((th, tw), np.float32); sx_, sy_ = tw / W, th / H; n_ = 0; tries = 0
    while n_ < 520 and tries < 30000:
        tries += 1
        x = rw.uniform(60, W - 60); y = rw.uniform(60, H - 60)
        fv = F[int(y * sy_), int(x * sx_)]
        if fv > -28 or fv < -430:
            continue
        n_ += 1; Lg = 11 + rw.rand() * 13
        for k in range(26):
            t = k / 25; px = x + (t - .5) * Lg * 2; py = y + 2.6 * math.sin(t * 2 * math.pi * 1.5 + .3)
            ix, iy = int(px * sx_), int(py * sy_)
            if 1 <= ix < tw - 1 and 1 <= iy < th - 1:
                ink[iy - 1:iy + 2, ix - 1:ix + 2] += .45
    ink = np.clip(ink, 0, 1) * sea
    base = base * (1 - .34 * ink[..., None])
    return np.clip(base, 0, 1).astype(np.float32)
