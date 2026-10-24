"""Seraphine hair CARDS (Wave C2 r3, iter 10): alpha-tested strand cards over the solid under-mass.

Six rounds of sculpted-solid hair read as a segmented shell (board C2 r9). This module provides
  1. make_atlas(out_dir)     -- the strand texture atlas (1024 x 1024, 8 strips of 128 px: dense lock strips with
                                tapered split tips, medium strips with ragged edges, wispy hairline strips), written as
                                PNG albedo (RGBA, alpha = coverage), tangent-space normal, ORM. Pure numpy (no Blender
                                slot): `python blender/seraphine_hair_cards.py atlas [out_dir]`.
  2. design_cards(...)       -- card layout (numpy only): two shingled layers of lock cards riding the under-mass,
                                hairline wisps, temple tendrils resting on the cheek, nape wisps.
  3. card_mesh(cards)        -- ribbons (3 verts across, cupped) with UVs into the atlas strips and SCALP normals
                                (so the cards shade like one hair volume, not like paper).
  4. build_card_object(...)  -- bpy: mesh object + UVs + custom normals + 'head' vertex group + armature bind;
     card_material(...)      -- bpy: Principled with alpha -> Math GREATER_THAN cutoff -> Alpha (the 5.2 glTF exporter
                                emits alphaMode MASK + alphaCutoff from that node pattern), double sided.
  5. patch_glb(path, ...)    -- post-export safety net: forces alphaMode MASK / alphaCutoff / doubleSided on the card
                                material in the GLB JSON chunk (pure python).
"""
import os
import sys
import math
import json
import struct
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TEX_DIR = os.path.join(ROOT, "public", "assets", "textures")
ATLAS_RES = 1024
STRIPS = 8
STRIP_W = ATLAS_RES // STRIPS
# strip kinds (index -> (n_strands, backing_end, backing_fade, edge_fade_px, tip_split))
#   dense : solid lock body, strands separate only in the last ~30 %
#   medium: solid to 55 %, ragged lateral edges, longer split tips
#   wispy : few strands, no solid body -> hairline / tendrils
STRIP_KIND = ["dense", "dense", "dense", "dense", "medium", "medium", "wispy", "wispy"]
KIND_IDX = {k: [i for i, s in enumerate(STRIP_KIND) if s == k] for k in ("dense", "medium", "wispy")}
# r13: the sun-disc medallion is geometry in the card mesh; its metallic gold lives in a patch across the bottom of the
# two wispy strips (rows >= GOLD_ROW0 of strips 6-7; wispy strands end by 0.84 so the patch has a clear margin).
GOLD_ROW0 = 0.875
GOLD_STRIPS = (6, 7)


# ============================================================================ atlas
def _srgb(r, g, b):
    return (np.array([r, g, b], float) / 255.0) ** 2.2


def _png(path, arr):
    """8-bit PNG writer (RGB or RGBA), no dependencies."""
    arr = np.asarray(arr)
    h, w = arr.shape[:2]
    ch = arr.shape[2]
    ctype = 6 if ch == 4 else 2
    raw = b"".join(b"\x00" + arr[i].astype(np.uint8).tobytes() for i in range(h))

    def chunk(t, b):
        return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xffffffff)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0)) +
           chunk(b"IDAT", zlib.compress(raw, 7)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return path


def _noise1(n, freq, rng):
    """Smooth 1-D noise in [-1, 1] (random Fourier sum)."""
    t = np.linspace(0, 1, n)
    out = np.zeros(n)
    for k in range(1, 6):
        out += rng.uniform(-1, 1) * np.sin(2 * math.pi * (freq * k * t + rng.uniform(0, 1))) / k
    return out / np.abs(out).max()


def _strip(kind, rng, H=ATLAS_RES, W=STRIP_W, pal=None):
    """One atlas strip. Rows 0..H-1 = root..tip. Returns alpha (H,W), albedo (H,W,3 linear), height (H,W),
    strand coverage (H,W)."""
    pal = pal or {}
    base = pal.get("hair", _srgb(150, 54, 16))
    hi = pal.get("hair_hi", _srgb(236, 150, 78))
    dark = pal.get("hair_dark", _srgb(74, 22, 6))
    rows = np.arange(H)[:, None]
    cols = np.arange(W)[None, :] + 0.5
    v = rows / (H - 1.0)
    if kind == "dense":
        n, b_end, b_fade, e_fade, t_rng, conv = 50, 0.62, 0.26, 24.0, (1.8, 4.6), 0.22
    elif kind == "medium":
        n, b_end, b_fade, e_fade, t_rng, conv = 36, 0.46, 0.30, 16.0, (1.8, 4.2), 0.28
    else:
        n, b_end, b_fade, e_fade, t_rng, conv = 11, 0.10, 0.22, 24.0, (2.6, 4.8), 0.34
    alpha_s = np.zeros((H, W))
    height = np.zeros((H, W))
    col_acc = np.zeros((H, W, 3))
    cov_acc = np.zeros((H, W))
    cx = W * 0.5
    for i in range(n):
        x0 = rng.uniform(-0.04, 1.04) * W
        amp = rng.uniform(1.5, 6.5) if kind != "wispy" else rng.uniform(3.0, 10.0)
        lam = rng.uniform(0.28, 0.9)
        ph = rng.uniform(0, 2 * math.pi)
        thick = rng.uniform(*t_rng)
        end = rng.uniform(0.62, 1.0) if kind != "wispy" else rng.uniform(0.45, 0.84)
        start = 0.0 if kind != "wispy" else rng.uniform(0.0, 0.15)
        val = rng.choice([0.62, 0.8, 0.95, 1.05, 1.18, 1.32], p=[0.1, 0.22, 0.28, 0.2, 0.13, 0.07])
        xc = cx + (x0 - cx) * (1 - conv * v) + amp * np.sin(2 * math.pi * v / lam + ph) + \
            2.0 * np.sin(2 * math.pi * v * 3.1 + ph * 1.7) * v
        # taper: full thickness to 70 % of its length, then to a point
        u = np.clip((v - start) / max(end - start, 1e-3), 0, 1)
        th = thick * np.clip(1.25 - 1.25 * np.clip((u - 0.7) / 0.3, 0, 1) ** 1.3, 0.25, 1.0)
        if kind == "wispy":     # r13: strands grow in from nothing (hairline roots on skin read as cut paper otherwise)
            th = th * np.clip(u / 0.16, 0, 1) ** 0.6
        else:                   # r13: dense / medium strands taper in over the first 5 % too (root fade, see backing)
            th = th * np.clip(u / 0.05, 0, 1) ** 0.5
        th = np.where((v >= start) & (v <= end), th, 0.0)
        dx = np.abs(cols - xc)
        cov = np.clip(th * 0.5 + 0.5 - dx, 0, 1) * (th > 0)
        prof = np.sqrt(np.clip(1 - (dx / np.maximum(th * 0.5, 0.3)) ** 2, 0, 1)) * (th * 0.5)
        c = base * val
        col_acc += c[None, None, :] * cov[..., None]
        cov_acc += cov
        alpha_s = 1 - (1 - alpha_s) * (1 - cov)
        height = np.maximum(height, prof)
    # solid backing: opaque body of the lock, ragged lower edge + ragged lateral edges
    nz = _noise1(W, 2.5, rng)
    nz2 = _noise1(H, 6.0, rng)
    b_edge = b_end + 0.10 * nz[None, :] + 0.03 * nz2[:, None]
    backing = np.clip(1 - (v - b_edge) / b_fade, 0, 1) ** 1.2
    lat = np.minimum(cols, W - cols)
    e = e_fade * (1 + 0.7 * nz2[:, None] + 0.35 * _noise1(H, 22.0, rng)[:, None])      # torn lateral edges
    backing = backing * np.clip(lat / np.maximum(e, 1.0), 0, 1) ** 0.8
    # r13: the root end dissolves into strands over the first ~6 % (ragged), so a card root on skin is not a cut edge
    root_in = np.clip((v - 0.004 - 0.02 * (0.5 + 0.5 * nz[None, :])) / 0.055, 0, 1) ** 0.7
    backing = backing * root_in
    if kind == "wispy":
        backing *= 0.0
    # backing colour: darker, streaked (so even the solid body shows strand direction)
    st = 0.5 + 0.5 * np.sin(cols * 0.9 + 3.0 * nz[None, :] * 4.0 + v * 7.0)
    st2 = 0.5 + 0.5 * np.sin(cols * 2.3 + 1.3 + v * 3.0)
    bcol = (dark * 0.55 + base * 0.45)[None, None, :] * (0.72 + 0.22 * st + 0.08 * st2)[..., None]
    cov_n = np.clip(cov_acc, 0, 1)
    scol = col_acc / np.maximum(cov_acc, 1e-6)[..., None]
    alpha = np.maximum(backing, alpha_s)
    w_s = np.clip(cov_n, 0, 1)
    rgb = scol * w_s[..., None] + bcol * (1 - w_s)[..., None]
    # along-length shading: roots in shadow, a painted sheen band a third of the way down, tips a touch warmer
    shade = 0.62 + 0.38 * np.clip(v / 0.22, 0, 1) ** 0.8
    band = np.exp(-((v - 0.36 - 0.05 * nz[None, :]) / 0.075) ** 2) * (0.55 + 0.45 * st)
    rgb = rgb * shade[..., None]
    rgb = rgb + (hi - rgb) * (0.26 * band)[..., None]
    rgb = rgb + (hi * 0.8 - rgb) * (0.12 * np.clip((v - 0.8) / 0.2, 0, 1))[..., None]
    # dilate colour under zero alpha (mip bleed): fall back to the backing colour
    rgb = np.where(alpha[..., None] > 0.02, rgb, bcol * shade[..., None])
    height = height + 0.8 * backing * (0.5 + 0.5 * st)
    return alpha, rgb, height, cov_n


def make_atlas(out_dir=TEX_DIR, res=ATLAS_RES, seed=3, pal=None, prefix="seraphine_hair"):
    rng = np.random.RandomState(seed)
    W = res // STRIPS
    alpha = np.zeros((res, res))
    rgb = np.zeros((res, res, 3))
    height = np.zeros((res, res))
    cov = np.zeros((res, res))
    for k, kind in enumerate(STRIP_KIND):
        a, c, h, cv = _strip(kind, rng, res, W, pal)
        alpha[:, k * W:(k + 1) * W] = a
        rgb[:, k * W:(k + 1) * W] = c
        height[:, k * W:(k + 1) * W] = h
        cov[:, k * W:(k + 1) * W] = cv
    # r13: metallic gold patch for the medallion across the bottom of the wispy strips (alpha 1, metal 1, hammered)
    r0 = int(round(GOLD_ROW0 * res))
    c0, c1 = GOLD_STRIPS[0] * W, (GOLD_STRIPS[-1] + 1) * W
    gy, gx = np.mgrid[r0:res, c0:c1]
    py = (gy - r0) / max(res - 1 - r0, 1) * 2 - 1
    px = (gx - c0) / max(c1 - c0 - 1, 1) * 2 - 1
    rad = np.sqrt(px * px + py * py)
    grng = np.random.RandomState(seed + 101)
    bump = np.zeros_like(rad)
    for _ in range(26):        # hammered facets: shallow round dents
        bx, by, br = grng.uniform(-1, 1), grng.uniform(-1, 1), grng.uniform(0.10, 0.22)
        bump += np.clip(1 - ((px - bx) ** 2 + (py - by) ** 2) / (br * br), 0, 1) ** 1.5 * grng.uniform(0.4, 1.0)
    bump = np.clip(bump, 0, 1.2)
    gold = pal.get("gold", _srgb(236, 190, 98)) if pal else _srgb(236, 190, 98)
    gcol = gold[None, None, :] * (0.86 + 0.18 * (1 - bump) - 0.10 * np.clip((rad - 0.6) / 0.4, 0, 1))[..., None]
    rgb[r0:res, c0:c1] = np.clip(gcol, 0, 1)
    alpha[r0:res, c0:c1] = 1.0
    height[r0:res, c0:c1] = 1.6 * (1 - bump)                   # px-ish height for the normal (dents go in)
    cov[r0:res, c0:c1] = 1.0
    gold_patch = np.zeros((res, res), bool)
    gold_patch[r0:res, c0:c1] = True
    # tangent-space normal from the strand height field (px units): +X = +u, +Y = +v (v up = toward the root row 0)
    hs = height.copy()
    hs = (hs + np.roll(hs, 1, 0) + np.roll(hs, -1, 0) + np.roll(hs, 1, 1) + np.roll(hs, -1, 1)) / 5.0
    dhx = (np.roll(hs, -1, 1) - np.roll(hs, 1, 1)) * 0.5
    dhy = (np.roll(hs, -1, 0) - np.roll(hs, 1, 0)) * 0.5
    k = 0.9
    nx, ny, nz = -dhx * k, dhy * k, np.ones_like(hs)
    nl = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / nl, ny / nl, nz / nl], -1) * 0.5 + 0.5
    v = (np.arange(res) / (res - 1.0))[:, None]
    occ = (0.58 + 0.42 * np.clip(v / 0.3, 0, 1)) * (0.86 + 0.14 * cov)
    rough = 0.90 + 0.06 * (1 - cov) + 0.03 * np.sin(np.arange(res)[None, :] * 0.37 + v * 9.0)
    metal = np.zeros_like(occ)
    rough = np.where(gold_patch, 0.34 + 0.08 * np.sin(np.arange(res)[None, :] * 0.61 + v * 23.0), rough)
    occ = np.where(gold_patch, 1.0, occ)
    metal = np.where(gold_patch, 1.0, metal)
    orm = np.stack([occ, np.clip(rough, 0.3, 0.98), metal], -1)
    os.makedirs(out_dir, exist_ok=True)
    srgb = np.clip(rgb, 0, 1) ** (1 / 2.2)
    alb = np.concatenate([srgb, alpha[..., None]], -1)
    paths = dict(albedo=_png(os.path.join(out_dir, prefix + "_albedo.png"), np.round(alb * 255)),
                 normal=_png(os.path.join(out_dir, prefix + "_normal.png"), np.round(np.clip(nrm, 0, 1) * 255)),
                 orm=_png(os.path.join(out_dir, prefix + "_orm.png"), np.round(np.clip(orm, 0, 1) * 255)))
    # preview: the albedo over a mid-grey (what alpha test keeps at cutoff 0.4), tiled next to the raw alpha
    prev = np.where(alpha[..., None] >= 0.4, srgb, 0.35)
    _png(os.path.join(out_dir, prefix + "_preview.png"), np.round(np.concatenate([prev, np.repeat(alpha[..., None], 3, -1)], 1) * 255))
    return paths


# ============================================================================ card layout (numpy only)
def _norm(a):
    a = np.asarray(a, float)
    return a / max(float(np.linalg.norm(a)), 1e-12)


def _dir(az, el):
    return np.array([math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)])


def _slerp(a, b, t):
    a, b = _norm(a), _norm(b)
    om = math.acos(max(-1.0, min(1.0, float(np.dot(a, b)))))
    if om < 1e-5:
        return a
    return (math.sin((1 - t) * om) * a + math.sin(t * om) * b) / math.sin(om)


def _resample(P, n):
    P = np.asarray(P, float)
    d = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    if d[-1] < 1e-9:
        return np.repeat(P[:1], n, 0)
    t = np.linspace(0, d[-1], n)
    return np.stack([np.interp(t, d, P[:, a]) for a in range(3)], 1)


def _frames(P, nrm_hint):
    T = np.gradient(P, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    N = np.asarray(nrm_hint, float)
    if N.ndim == 1:
        N = np.tile(N, (len(P), 1))
    N = N - T * np.sum(N * T, axis=1, keepdims=True)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    Sd = np.cross(T, N)
    Sd /= np.maximum(np.linalg.norm(Sd, axis=1, keepdims=True), 1e-9)
    return T, N, Sd


def _lift_out(dist_fn, grad_fn, P, clearance, iters=6):
    """Push points outward until the combined field (body + under-mass) is >= clearance."""
    P = np.array(P, float)
    for _ in range(iters):
        d = dist_fn(P) - clearance
        bad = d < -1e-4
        if not bad.any():
            break
        P[bad] -= grad_fn(P[bad]) * d[bad][:, None]
    return P


def scalp_ray(dist_fn, c, dirs, r_max=0.3):
    dirs = np.asarray(dirs, float)
    t = np.zeros(len(dirs))
    done = np.zeros(len(dirs), bool)
    for _ in range(200):
        d = dist_fn(c + dirs * t[:, None])
        done |= d >= 0
        if done.all():
            break
        t = np.where(done, t, np.minimum(t + np.maximum(-d, 0.0008), r_max))
    return t


def design_cards(dist_fn, grad_fn, skin_dist, skin_grad, hc, locks, tendrils, gather_dir, s=1.0, seed=11,
                 hairline_el=None, medallion=None):
    """Card dicts: path (n x 3), normal hint (n x 3), width (n,), strip (int), flip (bool), kind.
    dist_fn / grad_fn: body + under-mass field (cards ride on it); skin_dist / skin_grad: body only (tendrils rest on
    the cheek). locks: list of dict(root_dir, g_dir, width, n) from the under-mass design (already mirrored).
    tendrils: list of (points n x 3) in world space (already mirrored). hc: head centre; s: head scale."""
    rng = np.random.RandomState(seed)
    cards = []

    def lock_card(root_dir, g_dir, width, lift, length_f, n, strip, bow=0.0, kind="lock"):
        ts = np.linspace(0, length_f, n)
        dirs = np.array([_slerp(root_dir, g_dir, t) for t in ts])
        rr = scalp_ray(dist_fn, hc, dirs)
        P = hc + dirs * (rr + lift)[:, None]
        T, N, Sd = _frames(P, dirs)
        if bow:
            P = P + Sd * (bow * np.sin(math.pi * ts / max(length_f, 1e-3)))[:, None]
        P = _lift_out(dist_fn, grad_fn, P, lift * 0.85)
        N = grad_fn(P)
        w = np.full(n, width) * np.interp(np.linspace(0, 1, n), [0, 0.15, 0.75, 1.0], [0.70, 1.0, 1.0, 0.82])
        return dict(path=P, normal=N, width=w, strip=strip, flip=bool(rng.rand() < 0.5), kind=kind)

    # ---- layer A: one wide card per designed lock, riding the under-mass (the lock's own strand read)
    for lk in locks:
        rd = _rot_az(lk["root_dir"], math.radians(rng.uniform(-1.5, 1.5)))
        cards.append(lock_card(rd, lk["g_dir"], lk["width"] * 0.92, 0.0016 * s, 1.0, 8,
                               rng.choice(KIND_IDX["dense"]), bow=rng.uniform(-0.002, 0.002) * s))
    # ---- layer A': interleaved narrower cards between the A roots at the same height (denser shingle, fewer flat
    #      plates showing their full width)
    for lk in locks:
        sx = 1.0 if lk["root_dir"][0] >= 0 else -1.0
        rd = _rot_az(lk["root_dir"], math.radians(-sx * 7.0 + rng.uniform(-1.5, 1.5)))
        cards.append(lock_card(rd, lk["g_dir"], lk["width"] * rng.uniform(0.62, 0.74), 0.0022 * s, rng.uniform(0.85, 1.0), 8,
                               rng.choice(KIND_IDX["dense"]), bow=rng.uniform(-0.002, 0.002) * s, kind="lock"))
    # ---- layer B: a half-offset shingle of narrower cards (between the A roots), a little higher, shorter -> the
    #      tapered tips end mid-crown / mid-side so the mass breaks into strands without crossing flows
    for lk in locks:
        sx = 1.0 if lk["root_dir"][0] >= 0 else -1.0
        rd = _rot_az(lk["root_dir"], math.radians(sx * 7.5 + rng.uniform(-1.5, 1.5)))
        rd = _slerp(rd, lk["g_dir"], rng.uniform(0.02, 0.06))
        cards.append(lock_card(rd, lk["g_dir"], lk["width"] * rng.uniform(0.50, 0.62), rng.uniform(0.0036, 0.0046) * s,
                               rng.uniform(0.62, 0.82), 7, rng.choice(KIND_IDX["medium"]),
                               bow=rng.uniform(-0.002, 0.002) * s, kind="lock2"))
    # ---- hairline wisps: short narrow cards from the hairline ring, flowing back into the mass
    el_fn = hairline_el or (lambda az: math.radians(30.0 - 26.0 * _smooth((abs(az) - 22.0) / 50.0) -
                                                    18.0 * _smooth((abs(az) - 105.0) / 50.0)))
    for az in list(np.arange(-150, 151, 8.0)):
        a = abs(az)
        if 84.0 < a < 114.0:            # the ear
            continue
        el = el_fn(az) + math.radians(rng.uniform(-1.5, 1.5))
        if a < 26.0:                    # the sun-disc medallion sits here: wisps start above the band, not over it
            el = max(el, math.radians(44.0))
        rd = _dir(math.radians(az + rng.uniform(-2, 2)), el)
        gd = _slerp(rd, gather_dir, 0.30 + rng.uniform(-0.05, 0.08))
        wid = rng.uniform(0.010, 0.016) * s
        kind = "wispy"      # r13: wispy strips only (root taper) -- a medium strip's solid backing is a cut edge on skin
        c = lock_card(rd, gd, wid, 0.0008 * s, 1.0, 6, rng.choice(KIND_IDX[kind]), kind="hairline")
        cards.append(c)
    # ---- temple tendrils: thin wispy cards resting on the cheek in front of the ears
    for pts in tendrils:
        P = _resample(np.asarray(pts, float), 10)
        for _ in range(6):
            dd = skin_dist(P) - 0.0016 * s
            bad = dd < 0
            if not bad.any():
                break
            P[bad] -= skin_grad(P[bad]) * dd[bad][:, None]
        N = skin_grad(P)
        wid = np.full(len(P), rng.uniform(0.0105, 0.0125) * s) * np.interp(np.linspace(0, 1, len(P)), [0, 0.2, 1], [0.6, 1.0, 0.75])
        cards.append(dict(path=P, normal=N, width=wid, strip=int(rng.choice(KIND_IDX["wispy"])), flip=bool(rng.rand() < 0.5),
                          kind="tendril"))
    # ---- nape wisps under the gather
    for az in (118, 132, 146, 160, 172, -118, -132, -146, -160, -172):
        a = abs(az)
        el = -4.0 - 16.0 * _smooth((a - 118.0) / 54.0) + rng.uniform(-2, 2)
        rd = _dir(math.radians(az), math.radians(el))
        gd = _slerp(rd, _dir(math.pi, math.radians(-30.0)), 0.55)
        kind = "wispy" if a > 150 else "medium"
        cards.append(lock_card(rd, gd, rng.uniform(0.018, 0.026) * s, 0.0014 * s, 1.0, 6, rng.choice(KIND_IDX[kind]),
                               kind="nape"))
    # ---- r13: the rayed sun-disc medallion as geometry (see medallion_geom)
    if medallion is not None:
        cards.append(medallion_geom(dist_fn, grad_fn, medallion, s=s))
    return cards


def _smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def _rot_az(d, a):
    """Rotate a direction about the vertical axis by a (radians)."""
    c, s_ = math.cos(a), math.sin(a)
    return np.array([c * d[0] - s_ * d[1], s_ * d[0] + c * d[1], d[2]])


def strip_uv(k, flip, pad_px=2, res=ATLAS_RES):
    w = res // STRIPS
    u0, u1 = (k * w + pad_px) / res, ((k + 1) * w - pad_px) / res
    return (u1, u0) if flip else (u0, u1)


def gold_uv_rect(res=ATLAS_RES, pad_px=10):
    """(u0, u1, v0, v1) of the medallion gold patch in Blender UV convention (v = 1 at image row 0)."""
    W = res // STRIPS
    r0 = int(round(GOLD_ROW0 * res))
    u0 = (GOLD_STRIPS[0] * W + pad_px) / res
    u1 = ((GOLD_STRIPS[-1] + 1) * W - pad_px) / res
    v_top = 1.0 - (r0 + pad_px) / (res - 1.0)
    v_bot = 1.0 - (res - 1 - pad_px) / (res - 1.0)
    return u0, u1, v_bot, v_top


def medallion_geom(dist_fn, grad_fn, med, s=1.0, n_rays=16, r_disc=0.0130, ray_len=(0.0170, 0.0120),
                   ray_base=0.0040, ray_tip=0.00040, lift_skin=0.0030, lift_band=0.0008, lift_hair=0.0060):
    """The rayed sun-disc medallion (reference seraphine_hair_circlet.png): a slightly convex hammered disc on the band
    centre + alternating long / short pointed rays, wrapped onto the head: every vertex is ray-cast from the head
    centre against the body + under-mass field (which includes the band) and lifted by an elevation-dependent clearance
    (on the skin below the band, resting ON the band, above the hair cards over the under-mass). UVs map into the
    atlas gold patch. Returns dict(kind="medallion", verts, tris, quads, uv, normal)."""
    f, fn, up, side, hc = (np.asarray(med[k], float) for k in ("f", "fn", "up", "side", "hc"))
    el_band = math.asin(float(np.clip(_norm(f - hc)[2], -1, 1)))
    u0, u1, v0, v1 = gold_uv_rect()
    R_max = (r_disc + max(ray_len)) * s * 1.08
    V, N, UV, T, Q = [], [], [], [], []

    def lift(el):
        d = el - el_band
        L = lift_skin + (lift_band - lift_skin) * _smooth((d + 0.070) / 0.050)       # skin -> on the band (-4..-1 deg)
        L = L + (lift_hair - lift_band) * _smooth((d - 0.045) / 0.070)             # band -> over the cards (+2.5..+6.5)
        return L * s

    def add(x, y, raise_mm=0.0):
        Pt = f + side * x + up * y
        d = _norm(Pt - hc)
        r = float(scalp_ray(dist_fn, hc, d[None, :])[0])
        el = math.asin(float(np.clip(d[2], -1, 1)))
        P = hc + d * (r + lift(el) + raise_mm)
        V.append(P)
        N.append(d)
        UV.append((u0 + (u1 - u0) * (0.5 + 0.5 * x / R_max), v0 + (v1 - v0) * (0.5 + 0.5 * y / R_max)))
        return len(V) - 1

    rd, r1 = r_disc * s, r_disc * s * 0.48
    c = add(0.0, 0.0, 0.0017 * s)
    ring1 = [add(r1 * math.cos(a), r1 * math.sin(a), 0.0011 * s) for a in np.linspace(0, 2 * math.pi, n_rays, endpoint=False)]
    ring2 = [add(rd * math.cos(a), rd * math.sin(a), 0.0) for a in np.linspace(0, 2 * math.pi, n_rays, endpoint=False)]
    for i in range(n_rays):
        j = (i + 1) % n_rays
        T.append((c, ring1[i], ring1[j]))
        Q.append((ring1[i], ring2[i], ring2[j], ring1[j]))
    for i in range(n_rays):
        a = (i + 0.5) * 2 * math.pi / n_rays
        ln = ray_len[i % 2] * s
        ca, sa = math.cos(a), math.sin(a)
        bx, by = (rd - 0.0012 * s) * ca, (rd - 0.0012 * s) * sa     # base tucked under the disc rim
        tx, ty = (rd + ln) * ca, (rd + ln) * sa
        hb, ht = ray_base * s * 0.5, ray_tip * s * 0.5
        b0 = add(bx - sa * hb, by + ca * hb, -0.0004 * s)
        b1 = add(bx + sa * hb, by - ca * hb, -0.0004 * s)
        t1 = add(tx + sa * ht, ty - ca * ht, 0.0)
        t0 = add(tx - sa * ht, ty + ca * ht, 0.0)
        Q.append((b0, b1, t1, t0))
    V = np.array(V)
    NN = grad_fn(V)
    return dict(kind="medallion", verts=V, tris=np.array(T, np.int64), quads=np.array(Q, np.int64), uv=np.array(UV),
                normal=NN)


def card_mesh(cards, n_across=3, cup=0.0012):
    """Ribbons: n_across verts across each path sample (centre vert cupped `cup` outward along the normal).
    Returns verts (N,3), quads (M,4), uv per vert (N,2), normals per vert (N,3), card id per vert."""
    V, Q, UV, NN, ID = [], [], [], [], []
    TRI = []
    base = 0
    for ci, c in enumerate(cards):
        if c.get("kind") == "medallion":
            for p, uv, n in zip(c["verts"], c["uv"], c["normal"]):
                V.append(np.asarray(p, float))
                UV.append(tuple(uv))
                NN.append(np.asarray(n, float))
                ID.append(ci)
            for q in c["quads"]:
                Q.append(tuple(int(i) + base for i in q))
            for t in c["tris"]:
                TRI.append(tuple(int(i) + base for i in t))
            base += len(c["verts"])
            continue
        P = np.asarray(c["path"], float)
        n = len(P)
        T, N, Sd = _frames(P, c["normal"])
        w = np.asarray(c["width"], float)
        u0, u1 = strip_uv(c["strip"], c["flip"])
        v_span = 0.835 if c["strip"] in GOLD_STRIPS else 1.0     # r13: wispy tips stop above the gold patch
        xs = np.linspace(-0.5, 0.5, n_across)
        for j in range(n):
            for a, x in enumerate(xs):
                bulge = cup * (1 - (2 * x) ** 2)
                V.append(P[j] + Sd[j] * (x * w[j]) + N[j] * bulge)
                UV.append((u0 + (u1 - u0) * (x + 0.5), 1.0 - v_span * j / (n - 1.0)))
                NN.append(N[j])
                ID.append(ci)
        for j in range(n - 1):
            for a in range(n_across - 1):
                i0 = base + j * n_across + a
                i1 = i0 + 1
                i2 = i0 + n_across + 1
                i3 = i0 + n_across
                Q.append((i0, i1, i2, i3))
        base += n * n_across
    return (np.array(V), np.array(Q, np.int64), np.array(UV), np.array(NN), np.array(ID, np.int32),
            np.array(TRI, np.int64).reshape(-1, 3))


# ============================================================================ bpy side
def build_card_object(name, cards, arm=None, n_across=3, cup=0.0012):
    import bpy
    from lib import meshutil
    V, Q, UV, NN, ID, TRI = card_mesh(cards, n_across, cup)
    ob = meshutil.mesh_from_numpy(name, V, quads=Q, tris=TRI if len(TRI) else None)
    me = ob.data
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", UV[lv].astype(np.float32).ravel())
    meshutil.add_float_attr(ob, "card_id", ID.astype(np.float32))
    # make the quads' winding follow the normal (export is double sided, but shadows / back faces are cleaner)
    _orient_faces(ob, NN)
    # custom (scalp) normals -> the cards shade as one volume (re-applied after strip_for_export: reapply_normals)
    _NORMALS[ob.name] = NN.astype(np.float32)
    reapply_normals(ob)
    if arm is not None:
        from lib import skin
        W = np.ones((len(V), 1))
        skin.write_groups(ob, ["head"], W)
        skin.bind(ob, arm)
    return ob, dict(tris=meshutil.tri_count(ob), cards=len(cards), verts=len(V),
                    medallion=bool(any(c.get("kind") == "medallion" for c in cards)))


_NORMALS = {}


def reapply_normals(ob):
    NN = _NORMALS.get(ob.name)
    if NN is not None:
        ob.data.normals_split_custom_set_from_vertices(NN.tolist())
        ob.data.update()


def _orient_faces(ob, NN):
    import bmesh
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    flip = []
    for f in bm.faces:
        n = np.mean([NN[v.index] for v in f.verts], axis=0)
        if float(np.dot(np.array(f.normal), n)) < 0:
            flip.append(f)
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    bm.to_mesh(me)
    bm.free()
    me.update()


def card_material(name, albedo_path, normal_path, orm_path, cutoff=0.4):
    """Principled: albedo RGB + alpha (alpha -> Math GREATER_THAN cutoff -> Alpha => glTF alphaMode MASK), normal
    map, ORM (R occlusion via the glTF Material Output group, G roughness, B metal). Double sided."""
    import bpy
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = False
    for attr, val in (("blend_method", "CLIP"), ("alpha_threshold", cutoff), ("shadow_method", "CLIP"),
                      ("surface_render_method", "DITHERED")):
        try:
            setattr(m, attr, val)
        except Exception:
            pass
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bs.outputs[0], out.inputs["Surface"])
    imgs = {}
    for key, path, cs in (("albedo", albedo_path, "sRGB"), ("normal", normal_path, "Non-Color"), ("orm", orm_path, "Non-Color")):
        im = bpy.data.images.load(path, check_existing=True)
        im.colorspace_settings.name = cs
        im.alpha_mode = "STRAIGHT"
        imgs[key] = im
    ta = nt.nodes.new("ShaderNodeTexImage")
    ta.image = imgs["albedo"]
    nt.links.new(ta.outputs["Color"], bs.inputs["Base Color"])
    gt = nt.nodes.new("ShaderNodeMath")
    gt.operation = "GREATER_THAN"
    gt.inputs[1].default_value = float(cutoff)
    nt.links.new(ta.outputs["Alpha"], gt.inputs[0])
    nt.links.new(gt.outputs[0], bs.inputs["Alpha"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = imgs["normal"]
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = 0.8
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bs.inputs["Normal"])
    to = nt.nodes.new("ShaderNodeTexImage")
    to.image = imgs["orm"]
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bs.inputs["Metallic"])
    grp = bpy.data.node_groups.get("glTF Material Output")
    if grp is None:
        grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        try:
            grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        except Exception:
            grp.inputs.new("NodeSocketFloat", "Occlusion")
    gn = nt.nodes.new("ShaderNodeGroup")
    gn.node_tree = grp
    nt.links.new(sep.outputs["Red"], gn.inputs["Occlusion"])
    bs.inputs["IOR"].default_value = 1.5
    return m


def patch_glb(path, material_name, cutoff=0.4, double_sided=True, specular=0.3, extras=None):
    """Force alphaMode MASK (+ cutoff, doubleSided) on `material_name` in a GLB (JSON chunk rewrite) and add
    KHR_materials_specular specularFactor (three: MeshPhysicalMaterial.specularIntensity -> caps the grazing-angle
    Fresnel that turned the thin cards into mirrors of the fill light). Returns the material entry (or None)."""
    with open(path, "rb") as f:
        buf = f.read()
    assert buf[:4] == b"glTF"
    total = struct.unpack("<I", buf[8:12])[0]
    off = 12
    chunks = []
    while off < total:
        ln, ty = struct.unpack("<II", buf[off:off + 8])
        chunks.append([ty, buf[off + 8:off + 8 + ln]])
        off += 8 + ln
    js = json.loads(chunks[0][1].decode("utf-8"))
    found = None
    for mdef in js.get("materials", []):
        if mdef.get("name") == material_name:
            mdef["alphaMode"] = "MASK"
            mdef["alphaCutoff"] = float(cutoff)
            mdef["doubleSided"] = bool(double_sided)
            if specular is not None:
                ext = mdef.setdefault("extensions", {})
                ext["KHR_materials_specular"] = {"specularFactor": float(specular)}
                used = js.setdefault("extensionsUsed", [])
                if "KHR_materials_specular" not in used:
                    used.append("KHR_materials_specular")
            if extras:      # -> GLTFLoader material.userData (characterLook reads kcaRimScale etc.)
                mdef.setdefault("extras", {}).update(extras)
            found = mdef
    if found is None:
        return None
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    chunks[0][1] = jb
    body = b"".join(struct.pack("<II", len(c[1]), c[0]) + c[1] for c in chunks)
    out = b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body
    with open(path, "wb") as f:
        f.write(out)
    return found


def glb_material_info(path):
    with open(path, "rb") as f:
        buf = f.read()
    ln = struct.unpack("<I", buf[12:16])[0]
    js = json.loads(buf[20:20 + ln].decode("utf-8"))
    return [dict(name=m.get("name"), alphaMode=m.get("alphaMode", "OPAQUE"), alphaCutoff=m.get("alphaCutoff"),
                 doubleSided=m.get("doubleSided", False)) for m in js.get("materials", [])]


if __name__ == "__main__":
    if sys.argv[1:] and sys.argv[1] == "atlas":
        out = sys.argv[2] if len(sys.argv) > 2 else TEX_DIR
        print(make_atlas(out))
    elif sys.argv[1:] and sys.argv[1] == "glbinfo":
        print(json.dumps(glb_material_info(sys.argv[2]), indent=1))
    else:
        print(__doc__)
