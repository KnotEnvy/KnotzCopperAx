"""Brann r19 face: canonical Tier-A donor edits, continuous shading and a painted face tile.

Run via tools/blender-run.mjs only. No donor, rig, other part or public asset is written.
"""
import argparse
import json
import math
import os
import struct
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import brann_team as T

CONFIG = {
    "iteration": 5,
    "seed": 1901,
    "role": "face",
    "tile": "face",
    "tile_px": 576,
    "gutter_px": 8,
    "smooth_steps": 45,
    "smooth_strength": .27,
    "eye_x": .03388,
    "eye_z": 1.81864,
    "eye_paint_z": 1.8242,
    "eye_recess": .0005,
    "eye_vertical_scale": .63,
    "brow_forward": .002,
    "cheek_fill": .013,
    "cheekbone_recede": .003,
    "cheek_mid_fill": .0045,
    "upper_lid_forward": .004,
    "boundary_fade_m": .015,
    "mls_steps": 3,
    "mls_neighbors": 28,
    "mls_radius": .012,
    "mls_strength": .65,
    "mls_max_step_m": .001,
    "jaw_widen": .010,
    "nose_narrow": .13,
    "mouth_z": 1.7402,
    "mouth_flatten": 0.,
    "lip_vertical_scale": .66,
    "skin_srgb": [159, 94, 60],
    "skin_repaint": .94,
    "skin_roughness": .77,
    "sclera_srgb": [131, 123, 105],
    "iris_srgb": [66, 40, 23],
    "brow_srgb": [31, 23, 20],
    "brow_paint_base_z": 1.837,
    "eye_paint_half_width": .015,
    "eye_paint_half_height": .0042,
    "eye_iris_radius": [.0061, .0059],
    "eye_catchlight": 0.,
    "feature_brow_mass": .006,
    "feature_nose_bridge": .0035,
    "feature_lip_upper": .0018,
    "feature_lip_lower": .0023,
    "lip_upper_srgb": [120, 58, 42],
    "lip_lower_srgb": [151, 77, 56],
    "mouth_half_width": .033,
    "plane_paint_strength": 1.65,
    "scar_width": .0029,
    "scar_lighten": .16,
    "preserve_hairline_z": [1.888, 1.906],
    "preview_rim_scale": .14,
    "scars": {
        "left_brow": [[.034, 1.836], [.0355, 1.861]],
        "right_cheek": [[-.062, 1.803], [-.036, 1.773]],
    },
}


def log(stage, start):
    print(f"[brann-face] stage {stage} done in {time.time()-start:.1f}s", flush=True)


def gauss(x, z, cx, cz, rx, rz):
    return np.exp(-.5 * (((x-cx)/rx)**2 + ((z-cz)/rz)**2))


def smoothstep(a, b, x):
    v = np.clip((x-a)/(b-a), 0, 1)
    return v*v*(3-2*v)


def srgb_lightness(rgb):
    rgb = np.clip(np.asarray(rgb), 0, 1)
    linear = np.where(rgb <= .04045, rgb/12.92, ((rgb+.055)/1.055)**2.4)
    y = linear@np.array([.2126, .7152, .0722])
    return np.where(y > (6/29)**3, 116*np.cbrt(y)-16, (29/3)**3*y)


def welded_arrays(D):
    _, first = np.unique(D.pos_id, return_index=True)
    return D.P[first].copy(), D.pos_id[D.F], first


def boundary_fade(D, cfg):
    """A physical-distance fade holds the entire face chart boundary and its donor shading."""
    P, F, _ = welded_arrays(D)
    facev = np.unique(F[D.faces("face")])
    outside = np.unique(F[np.flatnonzero(D.region != "face")])
    boundary = np.intersect1d(facev, outside)
    fade = np.zeros(len(P), float)
    for start in range(0, len(facev), 128):
        ids = facev[start:start+128]
        distance = np.sqrt(((P[ids, None]-P[boundary][None])**2).sum(2).min(1))
        fade[ids] = smoothstep(0, cfg["boundary_fade_m"], distance)
    return fade[D.pos_id]


def smooth_face_quadrics(D, P, cfg):
    """Normal-direction local quadratic fairing preserves shape without Laplacian shrinkage.

    A smoothly weighted least-squares surface removes the irregular donor triangulation's
    shallow ridges. It changes welded positions only, retains every triangle and weight,
    and leaves the boundary and flat central chin stationary.
    """
    F = D.pos_id[D.F[D.faces("face")]]
    facev = np.unique(F)
    _, first = np.unique(D.pos_id, return_index=True)
    fade = boundary_fade(D, cfg)[first]
    original = P.copy()
    chin = (1-smoothstep(1.725, 1.737, original[:, 2]))*(1-smoothstep(.018, .028, abs(original[:, 0])))
    strength = fade*(1-.96*chin)
    for _ in range(cfg["mls_steps"]):
        tris = P[F]
        cross = np.cross(tris[:, 1]-tris[:, 0], tris[:, 2]-tris[:, 0])
        normal = np.zeros_like(P)
        for j in range(3):
            np.add.at(normal, F[:, j], cross)
        normal /= np.linalg.norm(normal, axis=1).clip(1e-10)[:, None]
        out = P.copy()
        for vi in facev:
            if strength[vi] < .001:
                continue
            delta = P[facev]-P[vi]
            distance = (delta*delta).sum(1)
            near = np.argpartition(distance, cfg["mls_neighbors"]-1)[:cfg["mls_neighbors"]]
            n = normal[vi]
            t1 = np.cross(n, [0, 0, 1] if abs(n[2]) < .8 else [1, 0, 0])
            t1 /= max(np.linalg.norm(t1), 1e-10)
            t2 = np.cross(n, t1)
            scale = cfg["mls_radius"]
            q = delta[near]/scale
            x, y, z = q@t1, q@t2, q@n
            basis = np.c_[x*x, x*y, y*y, x, y, np.ones(len(x))]
            weights = np.exp(-distance[near]/scale**2)*np.clip(normal[facev[near]]@n, 0, 1)**3
            root = np.sqrt(weights)
            coeff = np.linalg.lstsq(basis*root[:, None], z*root, rcond=1e-5)[0]
            step = np.clip(coeff[-1]*scale, -cfg["mls_max_step_m"], cfg["mls_max_step_m"])
            out[vi] += n*step*cfg["mls_strength"]*strength[vi]
        P = out
    return P


def build_face(D, cfg):
    """Smooth fields on welded positions; pin every position shared by another role."""
    P, F, first = welded_arrays(D)
    old = P.copy()
    face_ids = D.faces("face")
    facev = np.unique(F[face_ids])
    free = np.zeros(len(P), bool)
    free[facev] = True
    free[D.face_pinned_positions()] = False
    scalp = np.unique(F[D.faces("scalp")])
    # Leave scalp entirely stationary: hair roots are being built against the same donor.
    free[scalp] = False
    edges = np.unique(np.sort(np.concatenate([F[:, :2], F[:, 1:], F[:, [2, 0]]]), axis=1), axis=0)
    a, b = edges[:, 0], edges[:, 1]
    degree = np.bincount(np.r_[a, b], minlength=len(P)).clip(1)
    x, y, z = old.T
    for _ in range(cfg["smooth_steps"]):
        sums = np.zeros_like(P)
        np.add.at(sums, a, P[b])
        np.add.at(sums, b, P[a])
        avg = sums/degree[:, None]
        P[free] += cfg["smooth_strength"]*(avg[free]-P[free])
    # Original-space masks ensure split copies and left/right receive identical fields.
    front = 1-smoothstep(-.035, .002, y)
    ax = abs(x)
    eye = gauss(ax, z, cfg["eye_x"], cfg["eye_z"], .017, .016)*front
    P[:, 1] += cfg["eye_recess"]*eye
    P[:, 2] += (cfg["eye_z"]-z)*(1-cfg["eye_vertical_scale"])*eye
    brow = gauss(ax, z, .035, 1.846, .025, .008)*front
    P[:, 1] -= cfg["brow_forward"]*brow
    # Fill the carved buccal hollow and widen the lower mandibular angle.
    cheek = gauss(ax, z, .053, 1.774, .021, .027)*front
    P[:, 1] -= cfg["cheek_fill"]*cheek
    cheekbone = gauss(ax, z, .060, 1.809, .015, .010)*front
    P[:, 1] += cfg["cheekbone_recede"]*cheekbone
    P[:, 1] -= cfg["cheek_mid_fill"]*gauss(ax, z, .055, 1.788, .017, .010)*front
    P[:, 1] -= cfg["upper_lid_forward"]*gauss(ax, z, cfg["eye_x"], 1.832, .013, .006)*front
    jaw = gauss(ax, z, .057, 1.745, .019, .027)*(1-smoothstep(-.018, .018, y))
    P[:, 0] += np.sign(x)*cfg["jaw_widen"]*jaw
    nose = gauss(x, z, 0, 1.790, .018, .026)*front
    P[:, 0] -= x*cfg["nose_narrow"]*nose
    # A straight bridge removes the ball-shaped domal tip without erasing the nose.
    bridge = gauss(x, z, 0, 1.796, .011, .023)*front
    target_y = -.096 + (z-1.79)*.22
    P[:, 1] += (target_y-P[:, 1])*.24*bridge
    mouth = gauss(x, z, 0, cfg["mouth_z"], .029, .010)*front
    P[:, 1] += cfg["mouth_flatten"]*mouth
    P[:, 2] += (cfg["mouth_z"]-z)*(1-cfg["lip_vertical_scale"])*mouth
    # Broad, flat chin plane rather than a cleft or two rounded chin lobes.
    chin = gauss(x, z, 0, 1.716, .024, .011)*front
    P[:, 1] += (-.086-P[:, 1])*.35*chin
    P[~free] = old[~free]
    delta = P-old
    delta *= boundary_fade(D, cfg)[first, None]
    # Conservative guard beneath the interface's 25 mm maximum.
    length = np.linalg.norm(delta, axis=1)
    P = old + delta*np.minimum(1, .024/np.maximum(length, 1e-10))[:, None]
    P = smooth_face_quadrics(D, P, cfg)
    if cfg["iteration"] >= 5:
        P = define_face_features(D, P, cfg)
    return P[D.pos_id], face_ids


def define_face_features(D, P, cfg):
    """Broad smooth pads restore authored landmarks after the donor's noisy relief is removed."""
    _, first = np.unique(D.pos_id, return_index=True)
    fade = boundary_fade(D, cfg)[first]
    x, y, z = P.T.copy()
    ax = abs(x)
    front = 1-smoothstep(-.032, -.004, y)
    weight = fade*front
    bx = np.clip((ax-.012)/.050, 0, 1)
    ridge_z = cfg["brow_paint_base_z"]+.008*np.sin(bx*math.pi*.85)+.002
    ridge = np.exp(-.5*((z-ridge_z)/.009)**2)*np.exp(-.5*((ax-.034)/.025)**2)
    dy = -cfg["feature_brow_mass"]*ridge
    dy -= .0018*gauss(x, z, 0, 1.851, .012, .012)
    # A narrow central bridge and wider lower tip/alae, joined by a continuous falloff.
    dy -= cfg["feature_nose_bridge"]*gauss(x, z, 0, 1.799, .009, .024)
    dy -= .0018*gauss(x, z, 0, 1.779, .011, .005)
    dy -= .0012*gauss(ax, z, .013, 1.775, .005, .005)
    # Two upper-lip lobes and one lower-lip roll; do not reopen the donor mouth cavity.
    dy -= cfg["feature_lip_upper"]*gauss(ax, z, .009, cfg["mouth_z"]+.0032, .008, .0028)
    dy -= cfg["feature_lip_lower"]*gauss(x, z, 0, cfg["mouth_z"]-.0031, .022, .0033)
    # Fill the near-ear recess, while easing back the arch above its dark overhang.
    dy -= .0035*gauss(ax, z, .069, 1.798, .014, .013)
    dy += .0020*gauss(ax, z, .070, 1.815, .012, .006)
    P[:, 1] += dy*weight
    return smooth_face_quadrics(D, P, dict(cfg, mls_steps=1, mls_strength=.40, mls_max_step_m=.0007))


def corner_normals(D, P):
    """Area-weighted normals on position welds, including seam triangles, never UV splits."""
    tris = P[D.F]
    cross = np.cross(tris[:, 1]-tris[:, 0], tris[:, 2]-tris[:, 0])
    sums = np.zeros((D.pos_id.max()+1, 3), np.float64)
    for j in range(3):
        np.add.at(sums, D.pos_id[D.F[:, j]], cross)
    sums /= np.linalg.norm(sums, axis=1).clip(1e-12)[:, None]
    normals = sums[D.pos_id[D.F]]
    fade = boundary_fade(D, CONFIG)[D.F][..., None]
    normals = normals*fade+D.NC*(1-fade)
    return normals/np.linalg.norm(normals, axis=2).clip(1e-12)[..., None]


def reuv_face(D, fidx, cfg):
    """Expand the donor's connected, non-overlapping chart: preserve its seam exactly."""
    old = D.UV[fidx]
    lo, hi = old.min(axis=(0, 1)), old.max(axis=(0, 1))
    inset = cfg["gutter_px"]/cfg["tile_px"]
    return inset+(old-lo)/(hi-lo)*(1-2*inset)


def rasterize(D, P, fidx, UV, cfg):
    res = cfg["tile_px"]
    world = np.zeros((res, res, 3), np.float64)
    oldworld = np.zeros_like(world)
    source = np.zeros((res, res, 2), np.float64)
    cov = np.zeros((res, res), bool)
    for fi, uv in zip(fidx, UV):
        q = uv*res
        lo = np.floor(q.min(0)).astype(int).clip(0, res-1)
        hi = np.ceil(q.max(0)).astype(int).clip(0, res-1)
        xx, yy = np.meshgrid(np.arange(lo[0], hi[0]+1)+.5, np.arange(lo[1], hi[1]+1)+.5)
        (ax, ay), (bx, by), (cx, cy) = q
        den = (by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
        if abs(den) < 1e-12:
            continue
        w0 = ((by-cy)*(xx-cx)+(cx-bx)*(yy-cy))/den
        w1 = ((cy-ay)*(xx-cx)+(ax-cx)*(yy-cy))/den
        w2 = 1-w0-w1
        mask = (w0 >= -1e-7)&(w1 >= -1e-7)&(w2 >= -1e-7)
        w = np.stack([w0, w1, w2], -1)
        sl = np.s_[lo[1]:hi[1]+1, lo[0]:hi[0]+1]
        world[sl][mask] = (w@P[D.F[fi]])[mask]
        oldworld[sl][mask] = (w@D.P[D.F[fi]])[mask]
        source[sl][mask] = (w@D.UV[fi])[mask]
        cov[sl][mask] = True
    return world, oldworld, source, cov


def read_image(path):
    import bpy
    im = bpy.data.images.load(path, check_existing=False)
    im.colorspace_settings.name = "Non-Color"
    w, h = im.size
    a = np.empty(w*h*4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[..., :3]


def sample_image(im, uv):
    h, w = im.shape[:2]
    q = uv*np.array([w, h])-.5
    i = np.floor(q).astype(int)
    f = q-i
    x0, y0 = i[..., 0].clip(0, w-1), i[..., 1].clip(0, h-1)
    x1, y1 = (i[..., 0]+1).clip(0, w-1), (i[..., 1]+1).clip(0, h-1)
    a, b = f[..., 0, None], f[..., 1, None]
    return (im[y0, x0]*(1-a)+im[y0, x1]*a)*(1-b)+(im[y1, x0]*(1-a)+im[y1, x1]*a)*b


def inner_distance(cov, steps=30):
    mask = cov.copy()
    distance = np.zeros(cov.shape, float)
    for _ in range(steps):
        distance += mask
        mask &= np.roll(mask, 1, 0)&np.roll(mask, -1, 0)&np.roll(mask, 1, 1)&np.roll(mask, -1, 1)
    return distance


def segment_distance(x, z, endpoints):
    a, b = np.array(endpoints)
    dx, dz = b-a
    t = np.clip(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz), 0, 1)
    return np.hypot(x-a[0]-t*dx, z-a[1]-t*dz), t


def paint_face(D, P, fidx, UV, cfg, out):
    from lib import pipeline
    world, oldworld, srcuv, cov = rasterize(D, P, fidx, UV, cfg)
    transferred = sample_image(read_image(os.path.join(T.DONOR_DIR, "brann_albedo.png")), srcuv)
    x, y, z = world.transpose(2, 0, 1)
    ax = abs(x)
    front = 1-smoothstep(-.034, -.006, y)
    distance = inner_distance(cov)
    seam = smoothstep(2, 23, distance)*front
    # Start from donor transfer, replace its low-resolution hatch brows/iris/old scars inside the chart.
    skin = np.zeros_like(transferred)+np.array(cfg["skin_srgb"])/255
    warm = gauss(x, z, 0, 1.781, .023, .026)+.5*gauss(ax, z, .046, 1.795, .028, .026)
    skin += warm[..., None]*np.array([.025, -.004, -.011])
    # Broad colour variation, never beard/stubble or painted cheek hollows.
    variation = .005*(np.sin(x*137+z*93)+.5*np.sin(x*271-z*181))
    skin += variation[..., None]*np.array([1., .6, .3])
    albedo = transferred*(1-seam[..., None]*cfg["skin_repaint"])+skin*seam[..., None]*cfg["skin_repaint"]
    orm = sample_image(read_image(os.path.join(T.DONOR_DIR, "brann_orm.png")), srcuv)
    target_orm = np.zeros_like(orm)+[.95, cfg["skin_roughness"], 0]
    orm = orm*(1-seam[..., None])+target_orm*seam[..., None]
    # Neutral tangent normal eliminates the donor's coarse bake/cage spikes and faceted cheek planes.
    donor_normal = sample_image(read_image(os.path.join(T.DONOR_DIR, "brann_normal.png")), srcuv)
    normal = donor_normal*(1-seam[..., None])+(np.zeros_like(albedo)+[.5, .5, 1.])*seam[..., None]

    def over(mask, color):
        nonlocal albedo
        m = np.clip(mask*seam, 0, 1)[..., None]
        albedo = albedo*(1-m)+np.asarray(color)*m

    if cfg["iteration"] >= 5:
        # Authored planes remain gentle enough to read as skin, with no beard band.
        strength = cfg["plane_paint_strength"]
        over(gauss(ax, z, .048, 1.807, .022, .009)*.48*strength, skin+np.array([.070, .044, .023]))
        over(gauss(ax, z, .056, 1.787, .019, .009)*.38*strength, skin*np.array([.82, .79, .77]))
        over(gauss(ax, z, .062, 1.749, .015, .014)*.28*strength, skin*np.array([.84, .82, .80]))
        over(gauss(ax, z, .071, 1.854, .013, .024)*.45*strength, skin*np.array([.81, .80, .79]))
        over(gauss(x, z, 0, 1.800, .0065, .027)*.55*strength, skin+np.array([.073, .045, .023]))
        over(gauss(ax, z, .013, 1.797, .0045, .022)*.48*strength, skin*np.array([.80, .77, .74]))
        over(gauss(x, z, 0, 1.779, .009, .004)*.42, skin+np.array([.055, .023, .012]))
        # Erase the donor's near-ear dark bake wherever it belongs to the face chart.
        blotch = gauss(ax, z, .072, 1.801, .013, .014)
        over(blotch*.98, skin)
        orm[..., 0] = orm[..., 0]*(1-blotch*seam)+.99*blotch*seam
        normal = normal*(1-(blotch*seam)[..., None])+np.array([.5,.5,1.])*(blotch*seam)[..., None]

    ez, ex = cfg["eye_paint_z"], cfg["eye_x"]
    # Upper orbital shadow is broad and muted; the opening is a shallow almond with level pupils.
    shadow = gauss(ax, z, ex, ez+.005, .0175, .006)*.20
    over(shadow, skin*.59)
    tx = (ax-ex)/cfg["eye_paint_half_width"]
    arch = np.maximum(0, 1-tx*tx)**.65
    height = cfg["eye_paint_half_height"]*arch
    eye_center = ez+.0004*(ax-ex)/.0145
    eye_mask = (1-smoothstep(.93, 1.04, abs(tx)))*(1-smoothstep(height-.00035, height+.00035, abs(z-eye_center)))
    # The socket reads as one dark eye shape; sclera is warm and quiet, never white dots.
    over(eye_mask, np.array(cfg["sclera_srgb"])/255)
    ir = np.sqrt(((ax-ex)/cfg["eye_iris_radius"][0])**2+((z-ez)/cfg["eye_iris_radius"][1])**2)
    iris = eye_mask*(1-smoothstep(.90, 1.04, ir))
    over(iris, np.array(cfg["iris_srgb"])/255)
    pupil = eye_mask*(1-smoothstep(.43, .53, ir))
    over(pupil, np.array([17, 14, 12])/255)
    # Small restrained catchlight: no white, oversized googly iris highlights.
    glint = np.exp(-(((ax-ex+.0011)/.00052)**2+((z-ez-.001)/.00045)**2))*eye_mask*cfg["eye_catchlight"]
    over(glint, np.array([203, 190, 161])/255)
    upper = np.exp(-((z-eye_center-height)/.00085)**2)*(1-smoothstep(.88, 1.06, abs(tx)))
    lower = np.exp(-((z-eye_center+height)/.00046)**2)*(1-smoothstep(.88, 1.06, abs(tx)))
    over(upper*.96, np.array([43, 26, 20])/255)
    over(lower*.5, np.array([105, 61, 39])/255)
    # Solid tapered brows, 6-9 mm thick; inner ends lower for the heavy-browed scowl.
    bx = (ax-.012)/.050
    bz = cfg["brow_paint_base_z"] + .008*np.sin(np.clip(bx, 0, 1)*math.pi*.85)
    thickness = .0038*(1-.65*np.clip(bx, 0, 1)**2)
    brow = (smoothstep(-.06, .015, bx)*(1-smoothstep(.90, 1.03, bx)))*np.exp(-((z-bz)/thickness)**4)
    over(brow, np.array(cfg["brow_srgb"])/255)
    # Closed, shaped lips: cupid's bow, full lower roll, corner definition and philtrum.
    mx = x/cfg["mouth_half_width"]
    mouth_arch = np.sqrt(np.maximum(0, 1-mx*mx))
    lipcenter = cfg["mouth_z"]+.0006*(1-np.minimum(abs(mx),1))-.0010*np.minimum(abs(mx),1)**2
    upper_height = .0032*mouth_arch+.0012*np.exp(-((ax-.008)/.0045)**2)
    lower_height = .0045*mouth_arch
    lip_side = 1-smoothstep(.90, 1.03, abs(mx))
    above = z-lipcenter
    upper_lip = smoothstep(-.0002,.0004,above)*(1-smoothstep(upper_height-.0005,upper_height+.0005,above))*lip_side
    below = lipcenter-z
    lower_lip = smoothstep(-.0002,.0004,below)*(1-smoothstep(lower_height-.0005,lower_height+.0005,below))*lip_side
    over(upper_lip*.88, np.array(cfg["lip_upper_srgb"])/255)
    over(lower_lip*.90, np.array(cfg["lip_lower_srgb"])/255)
    over(np.exp(-((z-lipcenter+.0024)/.0011)**2)*lip_side*.22, skin+np.array([.025,-.005,-.005]))
    line = np.exp(-((z-lipcenter)/.00085)**2)*lip_side
    over(line*.95, np.array([74,34,26])/255)
    corners = gauss(ax,z,cfg["mouth_half_width"]*.96,cfg["mouth_z"]-.001,.0018,.0014)
    over(corners*.65,np.array([88,44,31])/255)
    under_lip = gauss(x,z,0,cfg["mouth_z"]-.0065,.023,.0017)
    over(under_lip*.44,skin*np.array([.69,.66,.64]))
    philtrum = gauss(x,z,0,cfg["mouth_z"]+.012,.0018,.005)
    over(philtrum*.32,skin*np.array([.77,.73,.71]))
    over(gauss(ax,z,.0035,cfg["mouth_z"]+.011,.0013,.0045)*.26,skin+np.array([.045,.026,.014]))
    # EXACTLY two painted marks. Positive X = anatomical LEFT, negative X = RIGHT.
    scar_masks = {}
    for name, endpoints in cfg["scars"].items():
        dist, t = segment_distance(x, z, endpoints)
        broken = .82+.18*np.sin(t*47+2.1)*np.sin(t*83)
        width = cfg["scar_width"]*.5*(.75+.25*np.sin(t*math.pi))
        m = np.exp(-((dist/(width*broken+1e-10))**4))*smoothstep(0, .08, t)*(1-smoothstep(.92, 1, t))
        scar_masks[name] = m*seam
        over(m*.96, skin+np.array([cfg["scar_lighten"], cfg["scar_lighten"]*.93, cfg["scar_lighten"]*.86]))
    # The face chart also contains the donor's painted scalp fringe: keep that identity boundary.
    hair_dark = 1-smoothstep(.15, .29, transferred.mean(axis=2))
    hairline = smoothstep(*cfg["preserve_hairline_z"], z)*hair_dark
    albedo = albedo*(1-hairline[..., None])+transferred*hairline[..., None]
    donor_orm = sample_image(read_image(os.path.join(T.DONOR_DIR, "brann_orm.png")), srcuv)
    orm = orm*(1-hairline[..., None])+donor_orm*hairline[..., None]
    normal = normal*(1-hairline[..., None])+donor_normal*hairline[..., None]
    tile_dir = os.path.join(out, "tiles")
    os.makedirs(tile_dir, exist_ok=True)
    for name, arr in (("albedo", albedo), ("orm", orm), ("normal", normal)):
        padded = pipeline.dilate(arr.astype(np.float32), cov, px=12)
        pipeline.save_png(padded, os.path.join(tile_dir, f"face_{name}.png"), name=f"r19_face_{name}", colorspace="sRGB" if name == "albedo" else "Non-Color")
    # Explicit donor transfer evidence, useful for reviewing seam colour or later repainting.
    scratch = os.path.join(T.TEAM, "face")
    pipeline.save_png(pipeline.dilate(transferred.astype(np.float32), cov, 12), os.path.join(scratch, "donor_transfer.png"), name="face_donor_transfer")
    np.savez_compressed(os.path.join(scratch, "paint_probe.npz"), world=world, coverage=cov, seam=seam,
                        left_brow=scar_masks["left_brow"], right_cheek=scar_masks["right_cheek"])
    seam_sel = cov&(distance <= 2)
    seam_diff = float(np.max(abs(albedo[seam_sel]-transferred[seam_sel])))
    skin_color = np.array(cfg["skin_srgb"])/255
    scar_color = skin_color+np.array([cfg["scar_lighten"], cfg["scar_lighten"]*.93, cfg["scar_lighten"]*.86])
    clean = cov&(seam > .9)&(scar_masks["left_brow"] < .01)&(scar_masks["right_cheek"] < .01)
    chin_skin = clean&(abs(x) < .025)&(z > 1.709)&(z < 1.731)
    cheek_skin = clean&(abs(x) > .030)&(abs(x) < .060)&(z > 1.773)&(z < 1.797)
    lightness = srgb_lightness(albedo)
    chin_cheek_delta = float(abs(np.median(lightness[chin_skin])-np.median(lightness[cheek_skin]))) if chin_skin.any() and cheek_skin.any() else None
    return {"coverage": round(float(cov.mean()), 4), "gutter_px": cfg["gutter_px"],
            "seam_max_srgb_delta": seam_diff, "scar_sides": "left brow +X; right cheek -X",
            "seam_max_Lstar_delta": float(abs(lightness[seam_sel]-srgb_lightness(transferred[seam_sel])).max()),
            "sclera_Lstar": round(float(srgb_lightness(np.array(cfg["sclera_srgb"])/255)), 2),
            "scar_nominal_Lstar_above_skin": round(float(srgb_lightness(scar_color)-srgb_lightness(skin_color)), 2),
            "clean_chin_cheek_median_Lstar_delta": None if chin_cheek_delta is None else round(chin_cheek_delta, 2),
            "normal": "neutral tangent; geometric smooth normals; no donor bake spikes"}


def measurements(D, P, fidx, UV, cfg):
    F = D.pos_id[D.F[fidx]]
    tris = P[D.F[fidx]]
    normal = np.cross(tris[:, 1]-tris[:, 0], tris[:, 2]-tris[:, 0])
    areas = np.linalg.norm(normal, axis=1)
    normal /= areas.clip(1e-12)[:, None]
    edges = np.sort(np.concatenate([F[:, :2], F[:, 1:], F[:, [2, 0]]]), axis=1)
    owners = np.tile(np.arange(len(F)), 3)
    order = np.lexsort((edges[:, 1], edges[:, 0]))
    edges, owners = edges[order], owners[order]
    same = np.all(edges[1:] == edges[:-1], axis=1)
    i, j = owners[:-1][same], owners[1:][same]
    centers = tris.mean(1)
    # Crease exclusions are semantic and reported explicitly; no angle-based rejection.
    cx, cy, cz = centers.T
    crease = ((abs(abs(cx)-cfg["eye_x"]) < .019)&(abs(cz-cfg["eye_z"]) < .012))
    crease |= (abs(cx) < .035)&(abs(cz-cfg["mouth_z"]) < .008)
    crease |= (abs(cx) < .022)&(abs(cz-1.77) < .011)
    keep = ~crease[i]&~crease[j]
    angles = np.degrees(np.arccos(np.clip((normal[i]*normal[j]).sum(1), -1, 1)))
    du, dv = UV[:, 1]-UV[:, 0], UV[:, 2]-UV[:, 0]
    area2 = abs(du[:, 0]*dv[:, 1]-du[:, 1]*dv[:, 0]).sum()*.5
    density = math.sqrt(area2/(areas.sum()*.5))*cfg["tile_px"]
    bd, _ = D.texel_density(["body"])
    result = {"face_tris": len(fidx), "face_extra_tris": 0,
              "face_density_px_per_m": round(density, 2), "body_density_px_per_m": round(bd, 2),
              "face_density_x_body": round(density/bd, 3),
              "dihedral_p95_deg": round(float(np.percentile(angles[keep], 95)), 3),
              "dihedral_p95_all_deg": round(float(np.percentile(angles, 95)), 3),
              "dihedral_samples_outside_creases": int(keep.sum()),
              "crease_exclusions": "eye +/-19 x12 mm; mouth +/-35 x8 mm; nostrils +/-22 x11 mm"}
    # Surface-window measurements in metres. Windows are anatomical, fixed in the rest pose.
    points = P[D.verts_of("face")]
    x, y, z = points.T
    ax = abs(x)
    brow = (ax > .020)&(ax < .050)&(z > 1.839)&(z < 1.855)
    globe = (abs(ax-cfg["eye_x"]) < .004)&(abs(z-cfg["eye_paint_z"]) < .003)
    lid = (abs(ax-cfg["eye_x"]) < .010)&(z > cfg["eye_paint_z"]+.0033)&(z < cfg["eye_paint_z"]+.008)
    cheek = (z > 1.790)&(z < 1.811)&(y < -.035)
    jaw = (z > 1.725)&(z < 1.749)&(y < -.015)
    chin = (z > 1.710)&(z < 1.726)&(y < -.081)&(ax < .026)
    width = lambda mask: float(np.ptp(x[mask]))
    result["form"] = {
        "eyeball_behind_brow_mm": round(float(y[globe].min()-y[brow].min())*1000, 2),
        "brow_past_upper_lid_mm": round(float(y[lid].min()-y[brow].min())*1000, 2),
        "eye_painted_opening_mm": [cfg["eye_paint_half_height"]*2000, cfg["eye_paint_half_width"]*2000],
        "pupil_height_delta_mm": 0.0,
        "pupil_distance_mm": cfg["eye_x"]*2000,
        "mouth_width_mm": cfg.get("mouth_half_width", .031)*2000,
        "jaw_width_mm": round(width(jaw)*1000, 2),
        "cheekbone_width_mm": round(width(cheek)*1000, 2),
        "jaw_x_cheekbone": round(width(jaw)/width(cheek), 3),
        "flat_chin_width_mm": round(width(chin)*1000, 2),
        "cheek_hollow_depth_mm_R_L": cheek_hollow_depth(D, P, fidx),
        "scar_projected_lengths_mm": {k: round(float(np.linalg.norm(np.diff(v, axis=0)[0]))*1000, 2) for k, v in cfg["scars"].items()},
        "measurement_method": "canonical rest-space profile/front surface windows; painted aperture/pupils from CONFIG, not an image-space silhouette fit",
    }
    print("[brann-face] measurements "+json.dumps(result), flush=True)
    return result


def cheek_hollow_depth(D, P, fidx):
    """Front-surface profile at x=+/-55 mm, recessed depth vs cheekbone-to-jaw chord."""
    tri = P[D.F[fidx]]
    a, b, c = (tri[:, j][:, [0, 2]] for j in range(3))
    den = (b[:, 1]-c[:, 1])*(a[:, 0]-c[:, 0])+(c[:, 0]-b[:, 0])*(a[:, 1]-c[:, 1])
    den[np.abs(den) < 1e-12] = 1e-12
    depths = []
    for x in (-.055, .055):
        ys = []
        for z in np.linspace(1.754, 1.805, 30):
            w0 = ((b[:, 1]-c[:, 1])*(x-c[:, 0])+(c[:, 0]-b[:, 0])*(z-c[:, 1]))/den
            w1 = ((c[:, 1]-a[:, 1])*(x-c[:, 0])+(a[:, 0]-c[:, 0])*(z-c[:, 1]))/den
            w2 = 1-w0-w1
            hit = (w0 >= 0)&(w1 >= 0)&(w2 >= 0)
            ys.append((w0*tri[:, 0, 1]+w1*tri[:, 1, 1]+w2*tri[:, 2, 1])[hit].min())
        depths.append(round(float(max(np.array(ys)-np.linspace(ys[0], ys[-1], len(ys))))*1000, 3))
    return depths


def patch_preview(path, cfg):
    """The shared preview gives face the default rim; match donor .14 without editing shared code."""
    raw = open(path, "rb").read()
    size = struct.unpack_from("<I", raw, 12)[0]
    gltf = json.loads(raw[20:20+size])
    for material in gltf.get("materials", []):
        if material.get("name") in ("M_hero_brann", "M_hero_brann.001", "M_hero_brann_face"):
            material.setdefault("extras", {})["kcaRimScale"] = cfg["preview_rim_scale"]
    data = json.dumps(gltf, separators=(",", ":")).encode()
    data += b" "*((-len(data))%4)
    tail = raw[20+size:]
    head = struct.pack("<III", 0x46546C67, 2, 20+len(data)+len(tail))+struct.pack("<II", len(data), 0x4E4F534A)
    open(path, "wb").write(head+data+tail)
    print("[brann-face] matched own preview materials (including donor suffix .001) to donor rim .14", flush=True)


def main():
    argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--release", action="store_true")
    ap.add_argument("--out", default=os.path.join(T.PARTS_DIR, "face"))
    ap.add_argument("--preview-out", default=os.path.join(T.TEAM, "face", "preview", str(CONFIG["iteration"])))
    ap.add_argument("--patch-preview", help="Match the scratch face material rim to donor .14 for a fair engine comparison")
    args = ap.parse_args(argv)
    if args.patch_preview:
        patch_preview(args.patch_preview, CONFIG)
        return
    start = time.time()
    D = T.Donor()
    P, fidx = build_face(D, CONFIG)
    N = corner_normals(D, P)[fidx]
    UV = reuv_face(D, fidx, CONFIG)
    vidx = np.flatnonzero(np.linalg.norm(P-D.P, axis=1) > 1e-8)
    T.save_edits(args.out, vidx=vidx, P_new=P[vidx], fidx=fidx, UV=UV, N=N,
                 meta={"role": "face", "author": "GPT-6.1 Sol", "tier": "A", "notes": "Welded smooth donor edits; neutral detail normal; closed mouth, deep sockets, solid brows and two painted anatomical scars."})
    log("reshape + smooth shading + re-UV", start)
    report = measurements(D, P, fidx, UV, CONFIG)
    report["paint"] = paint_face(D, P, fidx, UV, CONFIG, args.out)
    log("transfer + paint + dilate", start)
    report["audit"] = T.audit_edits(D, T.load_edits(args.out))
    report["config"] = CONFIG
    T.save_json(os.path.join(T.TEAM, "face", "measurements.json"), report)
    if not report["audit"]["ok"]:
        raise RuntimeError(report["audit"])
    log("audit", start)
    if args.preview:
        import build_hero_brann_team as preview
        original_argv = sys.argv
        try:
            sys.argv = [__file__, "--", "--preview-role", "face", "--out", args.preview_out]
            preview.main()
            patch_preview(os.path.join(args.preview_out, "hero_brann.glb"), CONFIG)
        finally:
            sys.argv = original_argv
        log("preview assembly", start)


if __name__ == "__main__":
    main()
