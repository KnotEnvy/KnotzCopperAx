"""Seraphine swept locks and braid (Wave C2 r5, iter 12): alpha-tested strand cards over the solid under-mass.

Six rounds of sculpted-solid hair read as a segmented shell (board C2 r9). This module provides
  1. make_atlas(out_dir)     -- the strand texture atlas (1024 x 1024, 8 strips of 128 px: dense lock strips with
                                tapered split tips, medium strips with ragged edges, wispy hairline strips), written as
                                PNG albedo (RGBA, alpha = coverage), tangent-space normal, ORM. Pure numpy (no Blender
                                slot): `python blender/seraphine_hair_cards.py atlas [out_dir]`.
  2. design_cards(...)       -- card layout (numpy only): two full-length interleaved lock fans riding the under-mass,
                                restrained hairline/temple locks and an explicit strand-UV braid.
  3. card_mesh(cards)        -- ribbons (3 verts across, cupped) with UVs into the atlas strips and lock-local normals
                                with per-lock cylindrical roll and lengthwise fibre variation).
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
    base = pal.get("hair", _srgb(150, 54, 16)) * rng.uniform(0.84, 1.14) * np.array([rng.uniform(.97,1.03), rng.uniform(.94,1.06), 1.0])
    hi = pal.get("hair_hi", _srgb(236, 150, 78))
    dark = pal.get("hair_dark", _srgb(74, 22, 6))
    rows = np.arange(H)[:, None]
    cols = np.arange(W)[None, :] + 0.5
    v = rows / (H - 1.0)
    if kind == "dense":
        n, b_end, b_fade, e_fade, t_rng, conv = 62, 0.80, 0.18, 8.0, (1.1, 2.8), 0.12
    elif kind == "medium":
        n, b_end, b_fade, e_fade, t_rng, conv = 50, 0.72, 0.24, 10.0, (1.1, 2.6), 0.16
    else:
        n, b_end, b_fade, e_fade, t_rng, conv = 11, 0.10, 0.22, 24.0, (2.6, 4.8), 0.34
    alpha_s = np.zeros((H, W))
    height = np.zeros((H, W))
    col_acc = np.zeros((H, W, 3))
    cov_acc = np.zeros((H, W))
    cx = W * 0.5
    for i in range(n):
        x0 = rng.uniform(-0.04, 1.04) * W
        amp = rng.uniform(0.6, 1.8) if kind != "wispy" else rng.uniform(3.0, 10.0)
        lam = rng.uniform(0.28, 0.9)
        ph = rng.uniform(0, 2 * math.pi)
        thick = rng.uniform(*t_rng)
        end = rng.uniform(0.88, 1.0) if kind != "wispy" else rng.uniform(0.45, 0.84)
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
    e = e_fade * (1 + 0.12 * nz2[:, None])      # torn lateral edges
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
    band = np.exp(-((v - rng.uniform(.23,.67) - 0.05 * nz[None, :]) / .085) ** 2) * (0.35 + 0.65 * st)
    rgb = rgb * shade[..., None]
    rgb = rgb + (hi - rgb) * (0.055 * band)[..., None]
    rgb = rgb + (hi * 0.8 - rgb) * (0.025 * np.clip((v - 0.8) / 0.2, 0, 1))[..., None]
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
    gold = pal.get("gold", _srgb(212, 156, 64)) if pal else _srgb(212, 156, 64)
    gcol = gold[None, None, :] * (0.86 + 0.18 * (1 - bump) - 0.10 * np.clip((rad - 0.6) / 0.4, 0, 1))[..., None]
    # Incised circular border on the sun-disc UV footprint (disc radius is ~.49
    # of this patch). A shaded gold mid-tone survives the three-quarter key.
    engraving = np.exp(-((rad - .425) / .015)**2)
    gcol *= (1 - .36*engraving)[..., None]
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
    edge = np.sin(np.pi * ((np.arange(res)[None, :] % W + .5) / W)) ** .25
    occ = (0.76 + 0.24 * np.clip(v / 0.15, 0, 1)) * (0.66 + 0.34 * edge) * (0.90 + 0.10 * cov)
    rough = 0.93 + 0.035 * (1 - cov) + 0.03 * np.sin(np.arange(res)[None, :] * 0.37 + v * 9.0)
    metal = np.zeros_like(occ)
    rough = np.where(gold_patch, 0.47 + 0.04 * np.sin(np.arange(res)[None, :] * 0.61 + v * 23.0), rough)
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
    """Outermost surface, traced INWARD: the scalp and lock masses can be disconnected.

    Tracing outward from the head centre stopped at the first air gap, leaving most
    cards underneath the locks. Only scattered rectangular patches then showed.
    """
    dirs = np.asarray(dirs, float)
    t = np.full(len(dirs), r_max)
    done = np.zeros(len(dirs), bool)
    for _ in range(240):
        d = dist_fn(c + dirs * t[:, None])
        done |= d <= 0.00008
        if done.all():
            break
        t = np.where(done, t, np.maximum(t - np.clip(d * 0.75, 0.00006, 0.008), 0.02))
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
        w = np.full(n, width) * np.interp(np.linspace(0, 1, n), [0, 0.14, 0.62, 0.88, 1.0], [0.82, 1.0, 1.0, 0.68, 0.12])
        return dict(path=P, normal=N, width=w, strip=strip, flip=bool(rng.rand() < 0.5), kind=kind,
                    scalp=(dist_fn, grad_fn, hc), clearance=lift)

    # Dense strand foundation sits below the separated locks. Its UVs stay in the
    # opaque part of the strip: gaps reveal matte fibres, never the body atlas's
    # bright scalp rim. It replaces the hidden decimated solid support at export.
    for lk in locks:
        c = lock_card(lk["root_dir"], lk["g_dir"], lk["width"]*1.32, .0025*s, 1.0, 12,
                      int(rng.choice(KIND_IDX["dense"])), kind="underlay")
        c["width"] = np.full(12, lk["width"]*1.32) * np.interp(np.linspace(0,1,12),[0,.10,.8,1],[.75,1,1,.55])
        c["uv_opaque"] = True
        cards.append(c)
    # Two narrower locks per support lane; same triangle budget as coarse 16-row
    # ribbons, but a consistent strand scale across the crown and temples.
    for lk in locks:
        for split in (-1, 1):
            rd = _rot_az(lk["root_dir"], math.radians(split*4 + rng.uniform(-.5,.5)))
            cards.append(lock_card(rd, lk["g_dir"], lk["width"]*.63, (.0032 + .00035*split)*s, 1.0, 12,
                                   rng.choice(KIND_IDX["dense"]), bow=split*.001*s))
    # ---- layer A': interleaved narrower cards between the A roots at the same height (denser shingle, fewer flat
    #      plates showing their full width)
    for lk in locks:
        sx = 1.0 if lk["root_dir"][0] >= 0 else -1.0
        rd = _rot_az(lk["root_dir"], math.radians(-sx * 7.0 + rng.uniform(-1.5, 1.5)))
        az = math.atan2(rd[0], -rd[1])
        el = math.asin(float(rd[2]))
        rd = _dir(az, el - math.radians(6.0 if abs(az) < 1.3 else 2.0))
        cards.append(lock_card(rd, lk["g_dir"], lk["width"] * rng.uniform(0.55, 0.65), 0.0043 * s, 1.0, 12,
                               rng.choice(KIND_IDX["dense"]), bow=rng.uniform(-0.002, 0.002) * s, kind="lock"))
    # ---- hairline wisps: short narrow cards from the hairline ring, flowing back into the mass
    # Bridge the upper/back seam where the first fan's tapered tips meet the plait.
    # These continue the same swept flow; their roots lie under the crown fan.
    for sx in (-1, 1):
        for az, el, target in ((92, 65, 48), (112, 36, 26)):
            cards.append(lock_card(_dir(math.radians(sx * az), math.radians(el)),
                                   _dir(math.pi, math.radians(target)), .042 * s, .0040 * s,
                                   1.0, 12, int(rng.choice(KIND_IDX["dense"])), kind="lock"))
    el_fn = hairline_el or (lambda az: math.radians(30.0 - 26.0 * _smooth((abs(az) - 22.0) / 50.0) -
                                                    18.0 * _smooth((abs(az) - 105.0) / 50.0)))
    for az in list(np.arange(-70, 71, 14.0)):
        a = abs(az)
        if 84.0 < a < 114.0:            # the ear
            continue
        el = el_fn(az) + math.radians(rng.uniform(-1.5, 1.5))
        if a < 26.0:                    # the sun-disc medallion sits here: wisps start above the band, not over it
            el = max(el, math.radians(33.0))
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
        wid = np.full(len(P), rng.uniform(0.0105, 0.0125) * s) * np.interp(np.linspace(0, 1, len(P)), [0, 0.2, .7, 1], [0.4, 1.0, .5, .01])
        cards.append(dict(path=P, normal=N, width=wid, strip=int(rng.choice(KIND_IDX["dense"])), flip=bool(rng.rand() < 0.5),
                          kind="tendril"))
    # ---- nape wisps under the gather
    for az in (126, 150, -126, -150):
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
        # The band is fitted after the braid has joined the groom (caller).

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


def medallion_geom(dist_fn, grad_fn, med, s=1.0, n_rays=16, r_disc=0.0160, ray_len=(0.0140, 0.0090),
                   ray_base=0.0040, ray_tip=0.00040, lift_skin=0.0040, lift_band=0.0100, lift_hair=0.0100):
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
    lifts = []

    def lift(el):
        d = el - el_band
        L = lift_skin + (lift_band - lift_skin) * _smooth((d + 0.070) / 0.050)       # skin -> on the band (-4..-1 deg)
        L = L + (lift_hair - lift_band) * _smooth((d - 0.045) / 0.070)             # band -> over the cards (+2.5..+6.5)
        return L * s

    def add(x, y, raise_mm=0.0):
        Pt = f + side * x + up * y
        d = _norm(Pt - hc)
        el = math.asin(float(np.clip(d[2], -1, 1)))
        V.append(d)
        lifts.append(lift(el) + raise_mm)
        N.append(d)
        UV.append((u0 + (u1 - u0) * (0.5 + 0.5 * x / R_max), v0 + (v1 - v0) * (0.5 + 0.5 * y / R_max)))
        return len(V) - 1

    rd, r1 = r_disc * s, r_disc * s * 0.48
    c = add(0.0, 0.0, 0.0030 * s)
    ring1 = [add(r1 * math.cos(a), r1 * math.sin(a), 0.0026 * s) for a in np.linspace(0, 2 * math.pi, n_rays, endpoint=False)]
    bevel = [add((rd - .0015*s) * math.cos(a), (rd - .0015*s) * math.sin(a), .0023*s)
             for a in np.linspace(0, 2 * math.pi, n_rays, endpoint=False)]
    ring2 = [add(rd * math.cos(a), rd * math.sin(a), 0.0) for a in np.linspace(0, 2 * math.pi, n_rays, endpoint=False)]
    for i in range(n_rays):
        j = (i + 1) % n_rays
        T.append((c, ring1[i], ring1[j]))
        Q.append((ring1[i], bevel[i], bevel[j], ring1[j]))
        Q.append((bevel[i], ring2[i], ring2[j], bevel[j]))
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
    rays = np.array(V)
    V = hc + rays * (scalp_ray(dist_fn, hc, rays) + np.array(lifts))[:, None]
    # Gold needs its actual convex/bevel normals, rather than the scalp normals
    # used to unify the hair. Otherwise the real disc still shades as a flat decal.
    NN = np.zeros_like(V)
    faces = list(T) + [(q[0], q[1], q[2]) for q in Q] + [(q[0], q[2], q[3]) for q in Q]
    for face in faces:
        i, j, k = face
        normal = np.cross(V[j] - V[i], V[k] - V[i])
        if np.dot(normal, rays[list(face)].mean(0)) < 0:
            normal = -normal
        NN[list(face)] += normal
    NN /= np.maximum(np.linalg.norm(NN, axis=1, keepdims=True), 1e-12)
    return dict(kind="medallion", verts=V, tris=np.array(T, np.int64), quads=np.array(Q, np.int64), uv=np.array(UV),
                normal=NN)


def braid_geometry(strands, ties):
    """Continuous interlaced sweeps with longitudinal strand UVs, sharing the lock atlas.

    Eight-sided sections avoid decimated scallops; no baked body surface or white
    alpha edges at the scalp. Gold wraps use the existing metallic atlas patch.
    """
    out = []
    for ci, strand in enumerate(strands):
        raw = np.asarray(strand["path"])
        arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(raw,axis=0),axis=1))]
        n = max(12, int(math.ceil(arc[-1] / (.0075 if strand["tag"]=="french" else .0095)))+1)
        # Match longitudinal sampling to the real curved strand, not the plait axis.
        P = _resample(raw, n)
        R = np.interp(np.linspace(0,arc[-1],n), arc, strand["R"])
        T,N,Sd = _frames(P, strand["normal"])
        # French scalp root grows smoothly out of the groom.
        if strand["tag"] == "french":
            R *= np.interp(np.linspace(0,1,n), [0,.12,1], [.18,1,1])
        V,NN,UV,Q = [],[],[],[]
        u0,u1 = strip_uv(ci % 4, False)
        sides=8 if strand["tag"]=="french" else 6
        for j in range(n):
            for k in range(sides+1):
                a=2*math.pi*k/sides
                normal=_norm(Sd[j]*math.cos(a)/.58 + N[j]*math.sin(a)/.43)
                V.append(P[j] + R[j]*(Sd[j]*.58*math.cos(a)+N[j]*.43*math.sin(a)))
                NN.append(normal)
                # Central opaque portion of the dense strip; no torn tube edges.
                UV.append((u0+(u1-u0)*(.12+.76*k/sides), 1-(.16+.55*j/(n-1))))
        for j in range(n-1):
            for k in range(sides):
                i=j*(sides+1)+k
                Q.append((i,i+1,i+sides+2,i+sides+1))
        out.append(dict(kind="braid",verts=np.array(V),normal=np.array(NN),uv=np.array(UV),
                        quads=np.array(Q),tris=np.empty((0,3),np.int64),moving=strand["tag"]=="free"))
    # One compact gold cuff at nape and tail, with rolled/chamfered rims.
    u0,u1,v0,v1=gold_uv_rect()
    for key in ("top", "bottom"):
        c,t,r=ties[key]; t=_norm(t)
        side=_norm(np.cross(t, [1,0,0])); up=_norm(np.cross(t,side))
        V,NN,UV,Q=[],[],[],[]
        height=.014 if key=="top" else .011
        for j,(z,radius) in enumerate(((-height,.86),(-height+.002,1), (height-.002,1),(height,.86))):
            for k in range(24):
                a=k*2*math.pi/24; rad=side*math.cos(a)+up*math.sin(a)
                V.append(c+t*z+rad*r*radius)
                NN.append(_norm(rad+t*((-.35 if j==0 else .35) if j in (0,3) else 0)))
                UV.append((u0+(u1-u0)*(.1+.8*k/24),v0+(v1-v0)*(.1+.8*j/3)))
        for j in range(3):
            for k in range(24):
                Q.append((j*24+k,j*24+(k+1)%24,(j+1)*24+(k+1)%24,(j+1)*24+k))
        out.append(dict(kind="wrap",verts=np.array(V),normal=np.array(NN),uv=np.array(UV),
                        quads=np.array(Q),tris=np.empty((0,3),np.int64),moving=True))
    return out


def band_geom(dist_fn, med, s=1.0, groom=None):
    """Bevelled band fitted onto actual groom triangles, including the crown braid."""
    hc = np.asarray(med["hc"])
    ring = np.asarray(med["ring"])
    V, NN, Q, UV, lifts = [], [], [], [], []
    u0, u1, v0, v1 = gold_uv_rect()
    for p in ring:
        d = _norm(p - hc)
        up = _norm(np.array([0, 0, 1.0]) - d * d[2])
        for z, lift in ((-0.0028, 0.0014), (0.0028, 0.0014), (0.0023, 0.0030), (-0.0023, 0.0030)):
            ray = _norm(p + up * z * s - hc)
            V.append(ray)
            lifts.append(lift * s)
            NN.append(_norm(ray + up * (0.35 if z > 0 else -0.35)))
            UV.append(((u0 + u1) / 2, v0 + (v1-v0) * (0.25 if lift < 0.002 else 0.75)))
    for i in range(len(ring)):
        for j in range(4):
            Q.append((4*i+j, 4*i+(j+1)%4, 4*((i+1)%len(ring))+(j+1)%4, 4*((i+1)%len(ring))+j))
    rays = np.array(V)
    radii = scalp_ray(dist_fn, hc, rays)
    if groom:
        vertices,quads,_,_,_,tri = card_mesh(groom)
        triangles=np.concatenate([quads[:,[0,1,2]],quads[:,[0,2,3]],tri])
        A=vertices[triangles[:,0]]; E1=vertices[triangles[:,1]]-A; E2=vertices[triangles[:,2]]-A
        tv=hc-A; qv=np.cross(tv,E1)
        # Moller-Trumbore radial hit on the visible geometry; no SDF-only floating ring.
        for j,ray in enumerate(rays):
            pv=np.cross(np.broadcast_to(ray,E2.shape),E2)
            det=np.einsum('ij,ij->i',E1,pv)
            inv=np.divide(1.,det,out=np.zeros_like(det),where=np.abs(det)>1e-10)
            u=np.einsum('ij,ij->i',tv,pv)*inv
            v=(qv@ray)*inv
            t=np.einsum('ij,ij->i',E2,qv)*inv
            hit=(np.abs(det)>1e-10)&(u>=0)&(v>=0)&(u+v<=1)&(t>0)&(t<.3)
            if hit.any():radii[j]=max(radii[j],float(t[hit].max()))
    shaped = radii.reshape(-1,4)
    shaped = np.maximum.reduce([shaped, np.roll(shaped,1,axis=0), np.roll(shaped,-1,axis=0)])
    radii = shaped.ravel()
    V = hc + rays * (radii + np.array(lifts))[:, None]
    return dict(kind="medallion", verts=V, normal=np.array(NN), uv=np.array(UV),
                quads=np.array(Q), tris=np.empty((0, 3), np.int64))


def card_mesh(cards, n_across=3, cup=0.0012):
    """Ribbons: n_across verts across each path sample (centre vert cupped `cup` outward along the normal).
    Returns verts (N,3), quads (M,4), uv per vert (N,2), normals per vert (N,3), card id per vert."""
    V, Q, UV, NN, ID = [], [], [], [], []
    TRI = []
    projections = {}
    rolls = {}
    base = 0
    for ci, c in enumerate(cards):
        if "verts" in c:
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
        if c.get("uv_opaque"):
            u0,u1 = u0+(u1-u0)*.10, u0+(u1-u0)*.90
        v_span = 0.835 if c["strip"] in GOLD_STRIPS else 1.0     # r13: wispy tips stop above the gold patch
        xs = np.linspace(-0.5, 0.5, n_across)
        for j in range(n):
            for a, x in enumerate(xs):
                bulge = cup * (1 - (2 * x) ** 2)
                V.append(P[j] + Sd[j] * (x * w[j]) + N[j] * bulge)
                v = .16 + .55*j/(n-1.0) if c.get("uv_opaque") else v_span*j/(n-1.0)
                UV.append((u0 + (u1 - u0) * (x + 0.5), 1.0 - v))
                phase = ci * 2.39996
                roll = 0 if c.get("uv_opaque") else x * .72 + .10 * math.sin(j / max(n-1,1) * 2*math.pi + phase)
                rolls[len(V)-1] = (Sd[j] * roll + T[j] * (.045 * math.sin(phase + j*.37)))
                NN.append(_norm(N[j] + rolls[len(V)-1]))
                ID.append(ci)
        if "scalp" in c:
            dist_fn, grad_fn, hc = c["scalp"]
            # Fit BOTH edges to the outer surface. A tangent-plane ribbon otherwise
            # cuts through convex locks or sticks out as a pale plate at the temple.
            along = np.repeat(np.linspace(0, 1, n), n_across)
            lateral = np.tile(xs, n)
            clearance = c["clearance"] * np.interp(along, [0, .10, .85, 1], [.40, 1, 1, .45])
            clearance += cup * (1 - (2*lateral)**2) * np.sin(np.pi * along)**.5
            group = projections.setdefault(id(dist_fn), (dist_fn, grad_fn, hc, [], []))
            group[3].extend(range(base, base + n * n_across))
            group[4].extend(clearance)
        for j in range(n - 1):
            for a in range(n_across - 1):
                i0 = base + j * n_across + a
                i1 = i0 + 1
                i2 = i0 + n_across + 1
                i3 = i0 + n_across
                Q.append((i0, i1, i2, i3))
        base += n * n_across
    V, NN = np.array(V), np.array(NN)
    # One vectorised field query for all cards (hundreds of tiny SDF calls cost minutes).
    for dist_fn, grad_fn, hc, ids, clearance in projections.values():
        rays = V[ids] - hc
        rays /= np.linalg.norm(rays, axis=1, keepdims=True)
        radii = scalp_ray(dist_fn, hc, rays)
        V[ids] = hc + rays * (radii + np.array(clearance))[:, None]
        # A radial base avoids contact-gradient discontinuities. Add each lock's
        # own cylindrical roll/longitudinal phase: a common radial field made the
        # entire groom share one smooth highlight in r11.
        NN[ids] = np.array([_norm(ray + rolls.get(i, 0)) for i, ray in zip(ids, rays)])
    return (V, np.array(Q, np.int64), np.array(UV), NN, np.array(ID, np.int32),
            np.array(TRI, np.int64).reshape(-1, 3))


# ============================================================================ bpy side
def build_card_object(name, cards, arm=None, n_across=3, cup=0.0012):
    import bpy
    from lib import meshutil
    V, Q, UV, NN, ID, TRI = card_mesh(cards, n_across, cup)
    # A curved/projected quad may be concave: orienting its average face normal
    # still leaves one exported triangle inward. Split FIRST and orient each
    # triangle (r4: 15 inward triangles, including the visible temple wedge).
    triangles = np.concatenate([Q[:, [0, 1, 2]], Q[:, [0, 2, 3]], TRI])
    ob = meshutil.mesh_from_numpy(name, V, tris=triangles)
    me = ob.data
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", UV[lv].astype(np.float32).ravel())
    meshutil.add_float_attr(ob, "card_id", ID.astype(np.float32))
    # Orient every triangle to its intended outward normal before export.
    _orient_faces(ob, NN)
    oriented = np.array([tuple(p.vertices) for p in me.polygons], np.int64)
    cross = np.cross(V[oriented[:, 1]] - V[oriented[:, 0]], V[oriented[:, 2]] - V[oriented[:, 0]])
    inward = int(np.count_nonzero(np.sum(cross * NN[oriented].mean(1), axis=1) < -1e-10))
    if inward:
        raise RuntimeError(f"{name}: {inward} inward hair triangles after orientation")
    # custom lock-local normals -> individual swept locks keep their relief (re-applied after strip_for_export: reapply_normals)
    _NORMALS[ob.name] = NN.astype(np.float32)
    reapply_normals(ob)
    if arm is not None:
        from lib import skin
        moving = np.array([cards[int(i)].get("moving", False) for i in ID])
        bones = ["head"] + [b.name for b in arm.data.bones if b.name.startswith("hair_")]
        tie_z = arm.data.bones["hair_1"].head_local.z
        def fixed_head(P):
            return np.maximum((~moving).astype(float), np.clip((P[:,2] - tie_z) / .025, 0, 1))
        skin.skin(ob, arm, method="sdf", allowed=bones, power=3.0, overrides=[(fixed_head, "head")])
    return ob, dict(tris=meshutil.tri_count(ob), cards=len(cards), verts=len(V), inward_triangles=inward,
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
