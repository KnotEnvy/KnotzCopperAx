"""Seraphine r30 fix round, HEAD role (face + hair). Owner: the r30 HEAD fixer. numpy only (asset venv), no Blender slot.

FACE (texture side). `face_finish(maps, pos, cov)` is a DROP-IN replacement for seraphine_r29_texture.face_finish: the release
compositor's skin_finish calls it in the same place (after the skin grade, before the eye islands + dilation). `pos/cov` are
the r29 raster of the FROZEN body (UV-attached), so every mask below is authored in the frozen frame and the paint rides
on the surface when head_delta.npz moves the vertices. Changes vs r29 (board r24, all four seats):
  - pale-blue smear: it was the specular of the showcase back light (Showcase.js rim #9ec4ff x3.2, from behind-left) at
    grazing Fresnel on .63-rough skin (light-off + roughness A/B in progress/shots/hero-seraphine/r30-fix/head/diag_r29*).
    Fix = matte face skin: ORM roughness .82 on the head (lips .55, paint .86); no normal-map or tangent fault was found.
  - normal-map bake spikes in the face chart (green crescent at each nostril, hard patches at the lip corners/chin)
    flattened -> no dark "nostril blob" from the bake.
  - brows lighter (warm brown), higher and arched (+2.5 mm on top of the +2 mm sculpt lift), thinner tail.
  - one clean dark upper lash line + soft lower lash shadow; lid crease softer.
  - lips: no dark slit (the r29 lip line read as a slack, open mouth), a soft closed mouth line, a lit lower lip with a
    soft shadow below it, a defined upper-lip vermilion (cupid's bow) and corners that turn up.
  - war paint: the two swipes per cheek blended into the skin (softer edges, 75 % opacity); warm blush + soft contour.
  - nostrils: the dark albedo at the alae lifted to a soft shadow.

HAIR: see build_hair() (r29 hair module CONFIG/construction reused; back mane rebuilt as overlapping wavy locks, closed
crown, clumped strand texture).
"""
import os
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

R30 = ROOT / "progress/tmp/seraphine_r30/head"
FACE = {
    "rough_head": .88, "rough_lips": .55, "rough_paint": .86,
    "brow_rgb": [84, 48, 30], "brow_lift": .0025, "brow_opacity": .80,
    "lash_rgb": [24, 13, 10], "lip_rgb": [172, 76, 62], "lip_line_rgb": [118, 58, 46], "lip_line_opacity": .25,
    "paint_rgb": [172, 70, 38], "paint_opacity": .74,
    "blush_rgb": [190, 104, 80], "blush_opacity": .20,
}


def _smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def _linear(rgb):
    rgb = np.clip(rgb, 0, 1)
    return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)


def _srgb(rgb):
    rgb = np.maximum(rgb, 0)
    return np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - .055)


def face_finish(maps, pos, cov, skin_rgb=(177, 125, 88)):
    """Drop-in for seraphine_r29_texture.face_finish (same signature + return dict)."""
    from scipy.spatial import cKDTree
    import seraphine_r29_body as body
    # Masks are authored in the r29 FROZEN frame: re-raster that body (same UVs under the vertex contract) so the paint
    # lands on the same texels whether the caller rastered r29 or the r30 body (head_delta + arm edits).
    import seraphine_r29_texture as TX
    zf = np.load(ROOT / "progress/tmp/seraphine_r29/frozen/body/body.npz")
    pos29, _, cov29, _, _ = TX.raster({k: zf[k] for k in ("P", "F", "UV", "N")}, width=cov.shape[1], height=cov.shape[0])
    pos = np.where(cov29[..., None], pos29, pos)
    x, y, z = pos.transpose(2, 0, 1); ax = np.abs(x)
    alb = _linear(maps["albedo"][..., :3]); orm = maps["orm"]; nrm = maps["normal"]
    base = body.load_base(); p = np.load(ROOT / "progress/tmp/seraphine_r29/frozen/body/body.npz")["P"]
    dist, idx = cKDTree(p[:len(base["P"])]).query(pos[cov], k=4)
    wts = 1 / np.maximum(dist, .0001); wts /= wts.sum(1, keepdims=True)

    def semantic(ids):
        a = np.zeros(cov.shape, np.float32)
        a[cov] = (wts * np.isin(base["vset"][idx], ids)).sum(1)
        return a

    eye = semantic([2, 3]); front = _smooth((-y - .065) / .025) * cov
    head = _smooth((z - 1.49) / .02) * cov

    def blend(col, mask):
        nonlocal alb
        m = np.clip(mask, 0, 1)[..., None]
        alb = alb * (1 - m) + _linear(np.array(col) / 255) * m

    skin = _linear(np.array(skin_rgb) / 255)
    # 0. normal-map bake spikes on the face front (nostril crescents, lip-corner / chin patches): flatten, keep the
    #    lid rims (eye semantic set) and anything off the face front.
    n = nrm[..., :3] * 2 - 1
    dev = np.linalg.norm(n[..., :2], axis=-1)
    spike = (dev > .30) & (front > .3) & (eye < .2) & (z > 1.53) & (z < 1.68)
    from scipy.ndimage import binary_dilation, gaussian_filter
    spike = binary_dilation(spike, iterations=3) & cov & (eye < .2)
    k = np.clip(gaussian_filter(spike.astype(np.float32), 1.2) * 1.6, 0, 1)
    n = n * (1 - k[..., None]) + np.array([0., 0., 1.]) * k[..., None]      # lerp toward flat (never inward)
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    nrm[..., :3] = (n + 1) / 2
    # 1. clean the old cosmetics (brows, lid paint, three-stripe paint, lips, dark nostril albedo) to the graded skin,
    #    keeping the tile's tonal breakup.
    reset = (((z > 1.655) & (z < 1.695) & (ax > .006) & (ax < .074)) |
             ((z > 1.590) & (z < 1.642) & (ax > .026)) |
             ((z > 1.560) & (z < 1.600) & (ax < .036)) |
             ((z > 1.596) & (z < 1.612) & (ax < .022) & (-y > .128)))
    reset = reset & (front > .5)
    lum = alb @ np.array([.2126, .7152, .0722])
    rel = np.clip(lum / max(float(np.median(lum[cov & (head > .5) & (front > .5)])), 1e-4), .85, 1.12)
    alb[reset] = skin * rel[reset][:, None]
    # 2. brows: lighter warm brown, higher, arched, tapered tail, hair-stroke breakup
    dx = ax - .0323; dz = z - 1.6502 - FACE["brow_lift"]
    arch = .018 + .0075 * np.exp(-((dx - .008) / .015) ** 2) - .009 * _smooth((dx - .019) / .016)
    thick = .0026 - .0016 * _smooth((dx - .006) / .024)
    brow = np.exp(-((dz - arch) / thick) ** 4) * _smooth((dx + .021) / .006) * _smooth((.037 - dx) / .010) * front
    hairs = .74 + .26 * (.5 + .5 * np.sin(ax * 2400 + (z - 1.65) * 1700))
    blend(FACE["brow_rgb"], brow * hairs * FACE["brow_opacity"])
    # 3. eyes: one clean dark upper lash line (follows the lifted lid; UV-attached), soft lower lash shadow, soft crease
    dz0 = z - 1.6502
    near = (np.abs(dx) < .032) & (np.abs(dz0) < .024)
    rim = np.exp(-((eye - .23) / .20) ** 2) * _smooth((eye - .035) / .075) * near * front
    upper = _smooth((dz0 + .001) / .0025)
    blend(FACE["lash_rgb"], rim * upper * .94)
    blend([96, 58, 44], rim * (1 - upper) * .45 * _smooth((dx + .018) / .015))
    almond = np.sqrt(np.maximum(0, 1 - (dx / .015) ** 2))
    lidz = 1.649 + .006 * almond + .09 * dx
    lid = np.exp(-((z - lidz) / .0013) ** 2) * _smooth((.017 - np.abs(dx)) / .004) * front
    blend(FACE["lash_rgb"], lid * .96)
    crease = np.exp(-((z - lidz - .0045) / .0016) ** 2) * _smooth((.019 - np.abs(dx)) / .006) * front
    blend([120, 74, 50], crease * .30)
    wing = np.exp(-((dz0 - (.002 + (dx - .020) * .30)) / .0015) ** 2)
    wing *= _smooth((dx - .018) / .005) * _smooth((.032 - dx) / .010) * front
    blend([36, 19, 14], wing * .62)
    # 4. warm blush high on the cheekbone + soft contour below it (no hollow read)
    cheek = np.exp(-((ax - .050) / .021) ** 2 - ((z - 1.617) / .016) ** 2) * front
    blend(FACE["blush_rgb"], cheek * FACE["blush_opacity"])
    contour = np.exp(-((ax - .062) / .022) ** 2 - ((z - 1.590) / .016) ** 2) * front
    alb *= 1 - contour[..., None] * np.array([.035, .05, .055])
    # 5. war paint: the same two swipes per cheek, feathered into the skin
    t = (ax - .031) / .040
    paint = np.zeros_like(z)
    for off in (0, .014):
        zc = 1.616 - off + .015 * t
        edge = .0055 * (1 - .35 * np.clip(t, 0, 1))
        band = np.exp(-np.abs((z - zc) / edge) ** 2.4) * _smooth((t + .02) / .18) * _smooth((1.05 - t) / .30) * front
        band *= .80 + .20 * np.sin(ax * 1730 + z * 2270) ** 2
        paint = np.maximum(paint, band)
    blend(FACE["paint_rgb"], paint * FACE["paint_opacity"])
    # 6. lips: closed soft line, defined vermilion with a cupid's bow, lit lower lip, soft shadow below
    mouthz = 1.5825 + .0012 * (ax / .024) ** 2 - .0006 * _smooth(ax / .02)
    bow = .0010 * np.exp(-((ax - .0055) / .0035) ** 2) - .0006 * np.exp(-(ax / .0022) ** 2)
    upperlip = .0042 + bow
    lipheight = np.where(z > mouthz, upperlip, .0058)
    lip = np.exp(-((z - mouthz) / lipheight) ** 4) * _smooth((.025 - ax) / .006) * front * _smooth((-y - .122) / .012)
    blend(FACE["lip_rgb"], lip * .95)
    lipline = np.exp(-((z - mouthz) / .0008) ** 2) * _smooth((.024 - ax) / .006) * lip
    blend(FACE["lip_line_rgb"], lipline * FACE["lip_line_opacity"])
    roll = np.exp(-((z - 1.5788) / .0019) ** 2) * np.exp(-(x / .016) ** 2) * lip
    blend([214, 140, 112], roll * .30)
    under = np.exp(-((z - 1.5700) / .0022) ** 2) * np.exp(-(x / .016) ** 2) * front * _smooth((-y - .12) / .012)
    alb *= 1 - under[..., None] * .05
    # 6b. nostrils: the openings/interiors read as a dark blob (deep cavities + baked occlusion): lift them to a soft
    #     warm shadow and drop their AO so only the real cavity shading remains
    nos = np.exp(-((ax - .0090) / .0060) ** 2 - ((z - 1.6035) / .0040) ** 2) * _smooth((-y - .128) / .006) * cov
    blend([150, 98, 72], nos * .55)
    orm[..., 0] = np.maximum(orm[..., 0], nos * .95)
    # 7. matte face skin (the smear fix) on the whole head, lips satin, paint matte; AO floor on the face front (the baked
    #    cheek/jaw occlusion read as a deep hollow at yaw 35) except the lid/lip cavities
    ao = orm[..., 0]
    cavity = np.clip(eye * 3, 0, 1) + _smooth((.006 - np.abs(z - 1.5825)) / .004) * _smooth((.026 - ax) / .006)
    floor = .90 * front * head * (1 - np.clip(cavity, 0, 1))
    ao[:] = np.maximum(ao, floor)
    r = orm[..., 1]
    r[:] = r * (1 - head) + FACE["rough_head"] * head
    r[:] = r * (1 - lip) + FACE["rough_lips"] * lip
    r[:] = r * (1 - paint) + FACE["rough_paint"] * paint
    maps["albedo"][..., :3] = np.clip(_srgb(alb), 0, 1)
    return {"method": "r30 head: symmetric surface-space masks (frozen frame, UV-attached); matte head skin .82 (back-light "
                      "smear fix); face normal spikes flattened; higher lighter brows; clean lash line; closed lips with a "
                      "lit lower lip; two feathered swipes", "select_grade": "unchanged",
            "spike_texels_flattened": int(spike.sum())}


def preview_skin_tile(out_dir=R30 / "tiles"):
    """Run the r29 compositor's skin_finish with this face_finish (no Blender) -> final skin tile PNGs for review."""
    from PIL import Image
    import seraphine_r29_texture as TX
    TX.face_finish = face_finish
    m, _ = TX.load_maps("body", "skin")
    m, rep = TX.skin_finish(m)
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    for k, a in m.items():
        data = np.uint8(np.clip(a[::-1], 0, 1) * 255 + .5)[..., :3]
        Image.fromarray(data).save(out_dir / f"skin_{k}_final_preview.png")
    return rep


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--preview-skin":
        import json
        print(json.dumps(preview_skin_tile(), indent=1, default=str))


# ============================================================================================ HAIR (r30)
HAIR = {
    "seed": 30030,
    # back mane: ONE layer of 13 wavy lens locks, widths ~1.8:1, neighbours alternate in depth (6 mm) so they overlap like
    # feathers without z-fighting; the wave phase drifts slowly across the back (hair flows together, locks never cross)
    "inner": {"xs": [-.130, -.108, -.084, -.058, -.031, -.004, .023, .050, .076, .100, .121, .136, .146],
              "w": [.030, .040, .046, .050, .052, .049, .052, .048, .044, .040, .034, .028, .024],
              "bottom": [1.29, 1.23, 1.19, 1.17, 1.20, 1.16, 1.185, 1.17, 1.21, 1.24, 1.27, 1.30, 1.33]},
    "outer": {"xs": [], "w": [], "bottom": []},
    "waves": 3.5, "wave_amp": .015, "rows": 24, "sides": 14,
    "crown_lift": .0115, "crown_reach": (.82, .70),
}


def _wave_path(H, A, x, bottom, i, layer, crown, S, C):
    """Crown -> occiput -> back, with `waves` lateral S-undulations (x and depth alternate) and a tapered tip."""
    rng = np.random.default_rng(HAIR["seed"] + 31 * i + 7 * layer)
    ph = 0.9 + x * 7.0 + rng.uniform(-.35, .35); amp = HAIR["wave_amp"] * rng.uniform(.85, 1.15)
    layer = layer + .65 * (i % 2)                       # alternate depth: odd locks sit 6 mm proud of their neighbours
    zs = np.array([1.714, 1.66, 1.60, 1.54, 1.48, 1.42, 1.36, 1.30, 1.24, bottom])
    zs = zs[zs >= bottom - 1e-6]
    if zs[-1] != bottom: zs = np.r_[zs, bottom]
    top = (1.714 - zs) / max(1.714 - bottom, 1e-3)
    wx = amp * np.sin(top * HAIR["waves"] * np.pi + ph) * np.minimum(1, top * 3)
    wy = .6 * amp * np.cos(top * HAIR["waves"] * np.pi + ph) * np.minimum(1, top * 3)
    yb = .108 + .022 * np.sin(np.clip((1.714 - zs) / .32, 0, 1) * np.pi * .5) + layer * .009
    yb = np.where(zs < 1.40, yb - (1.40 - zs) * .10, yb)
    path = [[.015 + .004 * (i - 4) * .8, -.043 + .006 * i, crown - .006],
            [x * .40, .006 + .005 * i, crown + .010 - abs(x) * .05]]
    for k, zz in enumerate(zs):
        xx = (x * (.66 + .34 * _smooth((1.71 - zz) / .27)) + wx[k])          # hug the skull at the top, widen to the shoulders * (1 - .12 * max(0, (1.30 - zz) / .15))
        path.append([xx, yb[k] + wy[k], zz])
    path = np.array(path, float)
    path[0] = S.cast(np.array([C]), A.unit(path[0] - C)[None], -.002)[0]
    for j in [1, 2]:
        d = A.unit(path[j] - C); fit = S.cast(np.array([C]), d[None], .003)[0]
        path[j] = fit + d * ((.013 if j == 1 else .017) + layer * .006)
    return path


def build_locks_r30(B, S, C, crown):
    import seraphine_r29_hair as H
    A = H.A
    pieces, guides = [], []
    for layer, key in ((0, "inner"), (1, "outer")):
        cfg = HAIR[key]
        for i, (x, w, bottom) in enumerate(zip(cfg["xs"], cfg["w"], cfg["bottom"])):
            path = _wave_path(H, A, x, bottom, i, layer, crown, S, C)
            n = len(path)
            normals = np.array([[0, -.3, 1], [0, .2, 1]] + [[x * 4, 1, .5 if k == 0 else .1] for k in range(n - 2)])
            width = np.r_[w * .45, w * .80, np.full(n - 3, w) * (1 - .25 * np.linspace(0, 1, n - 3) ** 2), .001]
            thick = np.r_[.004, .009, np.full(n - 3, .010 - .002 * layer), .001]
            m, curve, across, nn = H.lock_mesh(path, width, thick, normals, rows=HAIR["rows"], sides=HAIR["sides"])
            pieces.append(m); guides.append((curve, across, nn, w))
    # front sweeps + temple sweeps: the r29 forms (they read fine at the select/stage cameras) — reuse via the r29 builder
    r29_locks, r29_guides = _r29_front_and_temple(H, A, B, S, C, crown)
    pieces += r29_locks; guides += r29_guides
    # closed crown: a larger, more lifted continuous crown mass over all row roots (no scalp gaps)
    theta = np.linspace(-np.pi, np.pi, 41); tt = np.linspace(.02, 1, 12)[:, None]
    a0, a1 = HAIR["crown_reach"]
    end = a0 + a1 * (1 - np.cos(theta)) / 2
    ph = tt * end[None]; th = np.broadcast_to(theta, ph.shape)
    cp, dd = H.scalp_points(S, C, th, ph, .003)
    lift = HAIR["crown_lift"] + .003 * np.cos(th - .4) * np.sin(ph) + .002 * np.sin(ph * 2)
    cp += dd * lift[:, :, None]
    uv = np.stack(np.meshgrid(np.linspace(0, 1, len(theta)), np.linspace(1, 0, len(tt))), -1)
    pieces.append(A.grid(cp, H.hair_uv(uv), dd))
    return A.join(*pieces), guides


def _r29_front_and_temple(H, A, B, S, C, crown):
    """The r29 forehead + temple sweeps (copied verbatim from seraphine_r29_hair.build_locks, minus the back mane)."""
    pieces, guides = [], []
    for side in [-1, 1]:
        for layer in range(2):
            path = np.array([[.023, -.074, crown - .004], [side * .018, -.108, crown + .002 - layer * .008],
                             [side * .050, -.120, 1.742 - layer * .012], [side * .079, -.118, 1.711 - layer * .012],
                             [side * .101, -.086, 1.677 - layer * .010], [side * .111, -.039, 1.623 - layer * .012],
                             [side * .109, -.008, 1.562 - layer * .020]])
            normals = np.array([[0, -.5, 1], [0, -.8, .7], [side * .2, -1, .4], [side * .5, -1, .2], [side * .8, -.7, .1],
                                [side * 1., -.4, 0], [side * 1., -.4, 0]])
            width = np.array([.010, .029, .035, .032, .027, .020, .001]) * (1 if layer == 0 else .81)
            path[:, 0] += side * layer * .009; path[:, 1] += layer * .004
            path[0] = S.cast(np.array([C]), A.unit(path[0] - C)[None], -.002)[0]
            m, curve, across, n = H.lock_mesh(path, width, .007, normals, rows=21, sides=12)
            pieces.append(m); guides.append((curve, across, n, .027))
    for side in [-1, 1]:
        for layer in range(2):
            shift = .041 * layer
            path = np.array([[side * .024, -.018, crown - .008], [side * .063, -.024 + shift * .4, 1.760],
                             [side * .095, -.029 + shift, 1.726], [side * .110, -.019 + shift, 1.679],
                             [side * .112, .008 + shift, 1.622], [side * .129, .015 + shift, 1.543],
                             [side * .145, .039 + shift, 1.451], [side * .132, .063 + shift, 1.357],
                             [side * .110, .055 + shift, 1.264 + layer * .024]])
            normals = np.array([[side * .3, 0, 1], [side * .7, 0, .7]] + [[side, 0, .1]] * 7)
            path[0] = S.cast(np.array([C]), A.unit(path[0] - C)[None], -.002)[0]
            width = np.array([.012, .032, .043, .046, .047, .043, .039, .029, .001])
            m, curve, across, n = H.lock_mesh(path, width, .008, normals, rows=23, sides=12)
            pieces.append(m); guides.append((curve, across, n, .041))
    return pieces, guides


def make_tiles_r30(out):
    """Groom tile: clumped strand flow (irregular clump widths, soft gaps, low-contrast fine strands, a soft sheen band)
    instead of the r29 regular 91/217/411-cycle parallel stripes (the board's 'corrugated ribbing'). Same lane layout."""
    import seraphine_r29_hair as H
    A = H.A
    from PIL import Image
    from scipy.ndimage import gaussian_filter
    size = 2048; rng = np.random.default_rng(HAIR["seed"])
    y, x = np.mgrid[0:size, 0:size]; u = x / (size - 1); v = 1 - y / (size - 1)
    # clump id field: irregular widths along u (cumulative random widths), each clump with its own value/flow offset
    widths = rng.uniform(.010, .034, 200); edges = np.cumsum(widths); edges = edges[edges < 1.2]
    flow = .010 * np.sin(v * 9.0 + 1.3) + .006 * np.sin(v * 23 + .4)
    uu = u + flow
    cid = np.searchsorted(edges, uu % 1.0)
    lo = np.r_[0, edges][np.minimum(cid, len(edges) - 1)]; hi = edges[np.minimum(cid, len(edges) - 1)]
    t = np.clip((uu % 1.0 - lo) / np.maximum(hi - lo, 1e-4), 0, 1)
    cval = rng.uniform(-.09, .09, len(edges) + 1)[cid]
    body = 1 - .22 * (1 - np.sin(np.pi * t) ** .6)            # soft rounded clump, darker only at the clump edges
    fine = .010 * np.sin((uu * 640 + 3 * np.sin(v * 31 + cid)) * 2 * np.pi) + .010 * rng.normal(size=(size, size))
    fine = gaussian_filter(fine, (2.5, .6))
    sheen = .10 * np.exp(-((v - .72 - .03 * np.sin(u * 14)) / .06) ** 2)
    val = (body + cval + fine + sheen)
    col = np.array(H.CONFIG['palette']['hair']); rgb = np.clip(col[None, None] * val[:, :, None], 0, 255)
    alpha = np.full((size, size), 255.)
    fringe = (u >= .70) & (u <= .86); U = np.clip((u - .70) / .16, 0, 1); V = np.clip((v - .05) / .90, 0, 1)
    width = .48 * (.1 + .9 * np.minimum(1, V * 4))
    edge = np.abs(U - .5) - width + .012 * np.sin(V * 43 + U * 15)
    strandcut = .045 * np.sin(U * 240 + V * 21) + .02 * np.sin(U * 490 + V * 8)
    alpha[fringe] = np.clip((-.015 - edge[fringe] + strandcut[fringe]) / .018 + .5, 0, 1)[...] * 255
    dark = (u > .88) & (u < .93); rgb[dark] *= .94
    gold = u >= .94; rgb[gold] = np.array(H.CONFIG['palette']['gold']) * (1 + .04 * np.sin(v[gold, None] * 80))
    alpha[gold] = 255
    rough = np.clip(.70 + .06 * cval / .09 - .08 * sheen / .10, .57, .82); metal = np.zeros_like(rough)
    rough[gold] = .4; metal[gold] = .85
    orm = np.stack([np.ones_like(rough) * 255, rough * 255, metal * 255], -1)
    # normals: clump roundness across u only (no regular ribbing)
    dxn = -.35 * np.cos(np.pi * t) * (np.sin(np.pi * t) ** .3) + 2 * np.gradient(fine, axis=1) * size / 40
    norm = A.unit(np.stack([dxn, np.zeros_like(dxn), np.ones_like(dxn)], -1)); normal = (norm + 1) * 127.5
    outd = Path(out) / 'tiles'; outd.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.uint8(np.dstack([rgb, alpha])), 'RGBA').save(outd / 'groom_albedo.png')
    Image.fromarray(np.uint8(orm)).save(outd / 'groom_orm.png'); Image.fromarray(np.uint8(normal)).save(outd / 'groom_normal.png')


def build_hair(out=R30 / "parts" / "hair"):
    """r29 hair builder with the r30 back mane, crown and tile. Body = r29 frozen (the cranium is untouched by head_delta)."""
    import seraphine_r29_team as T
    import seraphine_r29_hair as H
    H.build_locks = build_locks_r30
    H.make_tiles = make_tiles_r30
    B = T.load_body(frozen=True)
    R = T.Rig()
    T.TEAM = str(R30)                              # build_report.json -> progress/tmp/seraphine_r30/head/hair/
    (R30 / "hair").mkdir(parents=True, exist_ok=True)
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    H.build(B, R, out)


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "--hair":
    build_hair()
