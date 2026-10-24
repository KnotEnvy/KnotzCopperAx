"""Post-process of the relief render (runs on plain numpy, outside Blender): ink outlines from normal + depth guide passes,
shadow hatching, cloud dapple, parchment grade, paper grain, fold creases, foxing, edge burn."""
import math
import numpy as np
from . import mapkit as MK
from .mapkit import smoothstep, mix, fbm, blur


def sobel(a):
    p = np.pad(a, [(1, 1), (1, 1)] + [(0, 0)] * (a.ndim - 2), mode='edge')
    gx = (p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])
    gy = (p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])
    return gx, gy


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def post(beauty_lin, normal, depth, RW, RH, P=None):
    P = P or {}
    sc = RW / 1600.0
    beauty = lin2srgb(beauty_lin.astype(np.float32))
    lum = beauty[..., 0] * .3 + beauty[..., 1] * .59 + beauty[..., 2] * .11
    # ---- ink: normal creases + depth silhouettes (hand-drawn wobble from a low-frequency warp of the sample position)
    gx, gy = sobel(normal); en = np.sqrt((gx ** 2 + gy ** 2).sum(-1))
    d = depth[..., 0]
    dx, dy = sobel(d); ed = np.hypot(dx, dy)
    e = smoothstep(P.get('n0', 2.4), P.get('n1', 3.8), en) * .8 + smoothstep(P.get('d0', 10.0), P.get('d1', 30.0), ed) * .95
    e = np.clip(e, 0, 1)
    yy, xx = np.mgrid[0:RH, 0:RW].astype(np.float32)
    e = np.clip(blur(e, max(1, int(round(0.7 * sc)))) * P.get('ink_gain', 1.1), 0, 1)
    ink = np.array(MK.hexc('#3a1f0e'), np.float32)
    out = beauty * (1 - e[..., None] * .88) + ink * (e[..., None] * .88)
    # ---- engraver's hatch (r8): SPARSE soft-edged lines whose angle changes patch to patch (three directions picked by a low-frequency
    # field, each line path wobbled), fading in the deepest shadow and breaking into patches - no regular lattice, so no moire when the
    # sheet is resampled to 1600x900. Line pitch 7 map px, width ~1.6 px, anti-aliased by a smooth triangle-wave profile.
    local = blur(lum, int(24 * sc))
    depth = (local * .95 - lum) / (local + 1e-3)
    shade = smoothstep(P.get('s0', .12), P.get('s1', .34), depth)
    deep = smoothstep(.34, .70, depth)
    amp = shade * (1 - .55 * deep)
    nxh, nyh = xx / sc, yy / sc
    reg = np.clip(np.floor(fbm(nxh / 85, nyh / 85, 2, seed=95) * 3.4 - .2), 0, 2)
    wob = (fbm(nxh / 34, nyh / 34, 2, seed=96) - .5) * 2.2
    pitch = P.get('pitch', 7.0)
    hatch = np.zeros_like(lum)
    for k, ang in enumerate((math.radians(38), math.radians(64), math.radians(112))):
        s_ = (nxh * math.cos(ang) + nyh * math.sin(ang) + wob * 3.0) / pitch
        tri = np.abs((s_ % 1.0) - .5) * 2.0                                   # 0 on the line centre .. 1 between lines
        line = 1 - smoothstep(.12, .30, tri)
        hatch += line * (reg == k)
    gate = smoothstep(.30, .55, fbm(nxh / 24, nyh / 24, 2, seed=97) + .35 * shade)
    out = out * (1 - (hatch * amp * gate * P.get('hatch', .42))[..., None])
    # ---- cloud dapple + paper grain + parchment grade
    nx, ny = xx / sc, yy / sc
    cloud = fbm(nx / 280, ny / 200, 3, seed=88)
    out = out * (0.93 + 0.14 * cloud[..., None])
    grain = fbm(nx / 1.5, ny / 1.5, 2, seed=89) - .5
    fibre = fbm(nx / 90, ny / 3.0, 3, seed=90) - .5
    out = out * (1 + .06 * grain[..., None] + .05 * fibre[..., None])
    gray = out.mean(-1, keepdims=True)
    out = mix(gray, out, P.get('sat', .78)) * np.array([1.05, .975, .85], np.float32) * P.get('exp', 1.12)
    # ---- sheet wear: fold creases (cross), foxing spots, burned/darkened margins, a lift highlight along the top-left
    u, v = nx / 1600.0, ny / 900.0
    crease = np.zeros_like(u)
    crease += np.exp(-((v - 0.5 + .006 * (fbm(nx / 200, ny / 200, 2, seed=91) - .5)) / .003) ** 2) * .3   # r8: vertical creases removed (read as seams)
    out = out * (1 - .16 * np.clip(crease, 0, 1))[..., None] + (np.clip(crease, 0, 1) * .05)[..., None] * 0
    fox = smoothstep(.76, .84, fbm(nx / 38, ny / 38, 3, seed=92)) * (.4 + .6 * smoothstep(.25, .6, fbm(nx / 500, ny / 400, 2, seed=93)))
    out = out * (1 - .22 * fox)[..., None] * np.array([1, .96, .86], np.float32)[None, None, :] ** fox[..., None]
    edge = np.minimum(np.minimum(u, 1 - u) * 1.0, np.minimum(v, 1 - v) * 1.78)
    burn = (1 - smoothstep(0.0, .06, edge + .02 * (fbm(nx / 60, ny / 60, 3, seed=94) - .5))) * P.get('burn', .38)
    out = out * (1 - burn)[..., None] * np.array([1, .9, .78], np.float32)[None, None, :] ** burn[..., None]
    return np.clip(out, 0, 1)
