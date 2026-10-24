"""Procedural bake materials for HI meshes.

Two layers:
1. numpy "painters" (per material kind) compute macro colour / roughness / metal / emissive at every face
   corner of a HI mesh from geometry (curvature, height, normals), sculpt paint masks (p_* attributes),
   landmarks and noise. Stored as CORNER colour attributes 'c_base' (rgb linear) and 'c_prm'
   (r = roughness, g = metallic, b = emissive), so colours never bleed across material boundaries.
2. node trees add micro detail (pores, leather grain, hammered metal, hair strands) as colour modulation and
   Bump (captured by the NORMAL bake), and AO nodes for the 'ao' pass.
Pass switching (set_pass) relinks each material's output: albedo | prm | ao | normal | emit.

Palette values are LINEAR (convert from sRGB with srgb()).
"""
import math
import numpy as np
import bpy

from . import sdf, meshutil
from .pipeline import curvature, vertex_normals


def srgb(r, g, b):
    c = np.array([r, g, b], float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smooth01(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    """Per-vertex lerp: a, b (3,) or (n,3); t scalar or (n,)."""
    t = np.asarray(t, float)
    if t.ndim == 1:
        t = t[:, None]
    return np.asarray(a, float) + (np.asarray(b, float) - np.asarray(a, float)) * t


# ============================================================================ painting context
class Ctx:
    """Per-vertex data handed to painters (only the vertices of one material are passed)."""

    def __init__(self, P, N, curv_f, curv_b, paints, attrs, L, extra):
        self.P, self.N, self.cf, self.cb = P, N, curv_f, curv_b
        self.paints, self.attrs, self.L, self.x = paints, attrs, L, extra
        self.n = len(P)

    def paint(self, name):
        return self.paints.get(name, np.zeros(self.n))

    def attr(self, name, default=0.0):
        return self.attrs.get(name, np.full(self.n, default))

    def noise(self, freq, octaves=3, seed=0):
        P = self.P
        return sdf.fbm(P[:, 0], P[:, 1], P[:, 2], octaves, freq, seed=seed)

    @property
    def cav(self):          # concavity 0..1 (fine + broad)
        return np.clip(np.maximum(-self.cf, 0) * 0.7 + np.maximum(-self.cb, 0) * 0.6, 0, 1)

    @property
    def ridge(self):
        return np.clip(np.maximum(self.cf, 0) * 0.8 + np.maximum(self.cb, 0) * 0.4, 0, 1)


def out(n, rgb, rough, metal=0.0, emit=0.0):
    rgb = np.broadcast_to(np.asarray(rgb, float), (n, 3)).copy()
    r = np.broadcast_to(np.asarray(rough, float), (n,)).copy()
    m = np.broadcast_to(np.asarray(metal, float), (n,)).copy()
    e = np.broadcast_to(np.asarray(emit, float), (n,)).copy()
    return rgb, r, m, e


# ============================================================================ painters
def p_skin(c, pal):
    base = pal.get("skin", srgb(170, 112, 80))
    warm = pal.get("skin_warm", srgb(186, 96, 74))
    cool = pal.get("skin_cool", srgb(120, 92, 78))
    rgb = np.tile(base, (c.n, 1))
    n1 = c.noise(9.0, 3, 11)
    n2 = c.noise(38.0, 2, 12)
    rgb *= (1.0 + 0.07 * n1 + 0.035 * n2)[:, None]
    # warm SSS zones: blush masks, ridges on thin skin (ears, nose, knuckles), concavities go red
    blush = np.clip(c.paint("blush") + 0.5 * c.paint("warm"), 0, 1)
    rgb = mix(rgb, warm, 0.55 * blush)
    rgb = mix(rgb, rgb * np.array([1.06, 0.74, 0.66]), 0.8 * c.cav * (1 - 0.75 * np.clip(c.paint("scar") * 1.5, 0, 1)))
    rgb = mix(rgb, rgb * np.array([1.10, 1.06, 0.98]), 0.35 * c.ridge)
    # painterly value gradient: lighter up top, a little darker & cooler toward the feet
    z = c.P[:, 2]
    top = smooth01(z, c.x.get("z_knee", 0.5), c.x.get("z_chest", 1.4))
    rgb *= (0.86 + 0.16 * top)[:, None]
    rgb = mix(rgb, cool, 0.12 * (1 - top))
    # stubble (cool, darker, speckled), lips, scars
    st = c.paint("stubble")
    speck = smooth01(c.noise(700.0, 1, 13), -0.1, 0.5)
    rgb = mix(rgb, cool * 0.62, st * (0.42 + 0.3 * speck))
    lips = c.paint("lips")
    rgb = mix(rgb, pal.get("lips", srgb(150, 78, 66)), 0.75 * lips)
    scar = c.paint("scar")
    rgb = mix(rgb, pal.get("scar", srgb(206, 150, 128)), 0.7 * np.clip(scar * 1.2, 0, 1))
    # painted brow hair: fine strands along x (the sculpted brow sits on top; this gives a hairy, soft edge)
    bp = c.paint("browpaint")
    if bp.any():
        strands = 0.5 + 0.5 * np.sin(c.P[:, 0] * 900.0 + 40.0 * c.P[:, 2] + 3.0 * c.noise(120.0, 2, 14))
        rgb = mix(rgb, pal.get("brow", srgb(30, 24, 22)), np.clip(bp * (0.55 + 0.4 * strands), 0, 0.92))
    # war paint / tattoo channel (optional)
    tat = c.paint("tattoo")
    if tat.any():
        rgb = mix(rgb, pal.get("tattoo", srgb(40, 50, 70)), 0.85 * tat)
    rough = pal.get("skin_rough", 0.56) - 0.1 * c.paint("oily") + 0.08 * st - 0.14 * lips - 0.06 * scar + 0.04 * n2 + 0.2 * bp
    return out(c.n, rgb, np.clip(rough, 0.25, 0.9))


def p_eye(c, pal):
    ex = c.x["eyes"]            # list of eye centres
    er = c.x["eye_r"]
    fwd = np.asarray(c.x.get("eye_fwd", (0.0, -1.0, 0.0)), float)
    P = c.P
    idx = np.argmin(np.stack([np.linalg.norm(P - e, axis=1) for e in ex]), axis=0)
    C = np.array(ex)[idx]
    d = P - C
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    # slight inward convergence so the gaze is focused, not wall-eyed
    f = np.tile(fwd, (c.n, 1))
    f[:, 0] += np.where(C[:, 0] > 0, -0.04, 0.04)
    f /= np.linalg.norm(f, axis=1, keepdims=True)
    cosang = np.sum(d * f, axis=1)
    ang = np.degrees(np.arccos(np.clip(cosang, -1, 1)))
    ir, pr = c.x.get("iris_deg", 33.0), c.x.get("pupil_deg", 12.5)
    sclera = pal.get("sclera", srgb(222, 212, 200))
    rgb = np.tile(sclera, (c.n, 1))
    rgb = mix(rgb, srgb(196, 130, 118), smooth01(ang, 45, 80) * 0.7)       # pink toward the corners
    # iris: radial streaks, darker limbal ring, lighter collarette
    iris = pal.get("iris", srgb(96, 128, 142))
    t = np.clip(ang / ir, 0, 1)
    # angular coordinate around the gaze axis
    up = np.array([0.0, 0.0, 1.0])
    e1 = np.cross(f, up)
    e1 /= np.maximum(np.linalg.norm(e1, axis=1, keepdims=True), 1e-9)
    e2 = np.cross(e1, f)
    phi = np.arctan2(np.sum(d * e2, axis=1), np.sum(d * e1, axis=1))
    streak = 0.5 + 0.5 * np.sin(phi * 37.0 + 3.0 * sdf.fbm(np.cos(phi) * 3, np.sin(phi) * 3, t * 4, 2, 1.0, seed=5))
    icol = iris * (0.75 + 0.45 * streak)[:, None]
    icol = mix(icol, iris * 1.7 + srgb(40, 30, 10) * 0.3, smooth01(t, 0.55, 0.3) * 0.5)     # collarette
    icol = mix(icol, iris * 0.25, smooth01(t, 0.78, 1.0))                                    # limbal ring
    in_iris = ang < ir
    rgb[in_iris] = icol[in_iris]
    rgb[ang < pr] = srgb(8, 8, 10)
    rgb = mix(rgb, rgb * 0.55, 0.7 * smooth01(ang, ir, ir + 6) * (ang < ir + 8))        # soft shadow ring
    ls = float(c.x.get("lid_shadow", 0.0))    # hero-seraphine C2 r2 (additive, default 0): upper-lid shadow on the ball
    if ls > 0:
        rgb = mix(rgb, rgb * 0.45, ls * smooth01(d[:, 2], 0.12, 0.50))
    return out(c.n, rgb, 0.07)


def p_nail(c, pal):
    rgb = np.tile(pal.get("nail", srgb(196, 146, 124)), (c.n, 1))
    rgb = mix(rgb, srgb(230, 205, 190), 0.35 * c.ridge)
    return out(c.n, rgb, 0.32)


def p_hairmass(c, pal, base_key="hair"):
    base = pal.get(base_key, srgb(34, 31, 36))
    rgb = np.tile(base, (c.n, 1))
    n1 = c.noise(30.0, 3, 21)
    rgb *= (1.0 + 0.2 * n1)[:, None]
    rgb = mix(rgb, rgb * 0.6, c.cav)
    hi = pal.get(base_key + "_hi", pal.get("hair_hi", srgb(78, 72, 80)))
    rgb = mix(rgb, hi, pal.get(base_key + "_hi_amt", 0.35) * c.ridge)
    return out(c.n, rgb, pal.get(base_key + "_rough", 0.48))


def p_brow(c, pal):
    return p_hairmass(c, pal, "brow")


def p_locks(c, pal, kind="hair"):
    """Lock meshes: attrs 'along' (0 root .. 1 tip), 'lock_id'."""
    along = c.attr("along")
    lid = c.attr("lock_id")
    rnd = np.sin(lid * 12.9898 + 78.233) * 43758.5453
    rnd = rnd - np.floor(rnd)
    if kind == "fur":
        root = pal.get("fur_root", srgb(58, 46, 38))
        mid = pal.get("fur", srgb(128, 110, 92))
        tip = pal.get("fur_tip", srgb(206, 196, 178))
        rgb = mix(mix(root, mid, smooth01(along, 0.0, 0.45)), tip, smooth01(along, 0.55, 1.0) * 0.85)
        rgb *= (0.8 + 0.4 * rnd)[:, None]
        rough = 0.82
    else:
        root = pal.get("hair", srgb(30, 28, 33))
        tip = pal.get("hair_tip", srgb(62, 50, 46))
        rgb = mix(np.tile(root, (c.n, 1)), tip, smooth01(along, 0.5, 1.0) * 0.6)
        rgb *= (0.78 + 0.44 * rnd)[:, None]
        # painted sheen band on the top of the head (stylised anisotropic highlight)
        band = np.exp(-((c.P[:, 2] - c.x.get("hair_band_z", 1.86)) / 0.03) ** 2) * np.clip(c.N[:, 2] + 0.3, 0, 1)
        rgb = mix(rgb, pal.get("hair_hi", srgb(96, 92, 104)), 0.35 * band)
        rgb = mix(rgb, rgb * 0.5, smooth01(along, 0.12, 0.0) * 0.8)       # roots in shadow
        rough = 0.42
    return out(c.n, rgb, rough)


def p_mane(c, pal, key="hair"):
    """SDF clump hair (lib/hair.clump_sculpt + path_attrs): per-clump value jitter, fine strand streaks across each
    clump, darker clump edges/roots (depth), and a painted Kajiya-Kay style sheen along the flow so the mass reads
    as glossy black hair under any light."""
    along, lid, lat = c.attr("along"), c.attr("lock_id"), c.attr("lateral")
    F = np.stack([c.attr("flow_x"), c.attr("flow_y"), c.attr("flow_z", 1.0)], axis=1)
    F /= np.maximum(np.linalg.norm(F, axis=1, keepdims=True), 1e-9)
    rnd = np.sin(lid * 12.9898 + 78.233) * 43758.5453
    rnd = rnd - np.floor(rnd)
    root = pal.get(key, srgb(30, 28, 33))
    tip = pal.get(key + "_tip", srgb(62, 50, 46))
    hi = pal.get(key + "_hi", srgb(104, 98, 112))
    rgb = mix(np.tile(root, (c.n, 1)), tip, smooth01(along, 0.45, 1.0) * 0.55)
    rgb *= (0.84 + 0.32 * rnd)[:, None]
    wob = c.noise(26.0, 2, 41)
    streak = 0.5 + 0.5 * np.sin(lat * 7.0 * math.pi + wob * 4.0 + rnd * 6.0)
    fine = 0.5 + 0.5 * np.sin(lat * 9.0 * math.pi + wob * 3.0 + rnd * 2.0)
    rgb *= (0.84 + 0.16 * streak + 0.06 * fine)[:, None]
    Ld = np.array([0.30, -0.55, 0.78])
    Ld /= np.linalg.norm(Ld)
    Vw = np.array([0.0, -1.0, 0.25])
    Vw /= np.linalg.norm(Vw)
    Hh = Ld + Vw
    Hh /= np.linalg.norm(Hh)
    th = np.sum(F * Hh, axis=1)
    kk = np.sqrt(np.clip(1 - th * th, 0, 1)) ** 60
    lit = np.clip(c.N @ Ld + 0.25, 0, 1)
    rgb = mix(rgb, hi, np.clip(pal.get(key + "_sheen", 0.55) * kk * lit * (0.55 + 0.45 * streak), 0, 1))
    rgb *= (1 - 0.32 * smooth01(np.abs(lat), 0.55, 1.0))[:, None]                 # clump edges tuck into shade
    rgb *= (0.62 + 0.38 * smooth01(along, 0.0, 0.14))[:, None]                    # roots in shadow
    rgb = mix(rgb, rgb * 0.6, c.cav * 0.8)
    r0 = pal.get(key + "_rough", 0.44)
    rough = r0 + 0.12 * (1 - streak) + 0.08 * along
    return out(c.n, rgb, np.clip(rough, 0.3, 0.9))


def p_leather(c, pal, key="leather"):
    base = pal.get(key, srgb(122, 80, 52))
    worn = pal.get(key + "_worn", base * np.array([1.9, 1.75, 1.6]))
    rgb = np.tile(base, (c.n, 1))
    n1 = c.noise(7.0, 3, 31)
    n2 = c.noise(55.0, 2, 32)
    rgb *= (1.0 + 0.16 * n1 + 0.06 * n2)[:, None]
    wear = np.clip(c.ridge * 1.3 + 0.25 * smooth01(n2, 0.3, 0.8), 0, 1)
    rgb = mix(rgb, worn, 0.42 * wear)       # r2: 0.55 + a light grime lifted boots to mid-brown (same value as skin)
    rgb = mix(rgb, rgb * 0.5, 0.75 * c.cav)
    grime = smooth01(-c.P[:, 2], -c.x.get("z_knee", 0.5), -0.1) * 0.25
    rgb = mix(rgb, srgb(24, 19, 16), grime)
    rough = 0.62 + 0.12 * n1 - 0.12 * wear
    return out(c.n, rgb, np.clip(rough, 0.3, 0.9))


def p_leather_dark(c, pal):
    return p_leather(c, pal, "leather_dark")


def p_fur_mass(c, pal):
    root = pal.get("fur_root", srgb(58, 46, 38))
    mid = pal.get("fur", srgb(128, 110, 92))
    tip = pal.get("fur_tip", srgb(206, 196, 178))
    n1 = c.noise(40.0, 3, 41)
    rgb = mix(np.tile(mid, (c.n, 1)), tip, smooth01(c.ridge + 0.3 * n1, 0.1, 0.8) * 0.8)
    rgb = mix(rgb, root, smooth01(c.cav + 0.2 * n1, 0.05, 0.6))
    return out(c.n, rgb, 0.85)


def p_metal(c, pal, key="bronze"):
    base = pal.get(key, srgb(206, 142, 74) if key == "bronze" else srgb(120, 120, 126))
    patina = pal.get(key + "_patina", srgb(74, 134, 112) if key == "bronze" else srgb(92, 58, 40))
    n1 = c.noise(18.0, 3, 51)
    n2 = c.noise(90.0, 2, 52)
    rgb = np.tile(base, (c.n, 1)) * (1.0 + 0.1 * n1 + 0.05 * n2)[:, None]
    pat = np.clip(smooth01(c.cav, 0.05, 0.5) + 0.35 * smooth01(n1, 0.35, 0.8), 0, 1) * pal.get(key + "_patina_amt", 0.9)
    rgb = mix(rgb, patina, pat)
    rgb = mix(rgb, np.minimum(base * 1.35, 1.0), 0.6 * c.ridge * (1 - pat))
    metal = 1.0 - 0.85 * pat
    rough = 0.34 + 0.12 * n1 - 0.16 * c.ridge + 0.4 * pat
    return out(c.n, rgb, np.clip(rough, 0.12, 0.9), metal)


def p_iron(c, pal):
    return p_metal(c, pal, "iron")


def tartan(u, v, base, sett):
    """Woven tartan: warp and weft stripe patterns averaged (twill). sett = (period, [(offset, width, rgb), ...])
    in metres; u/v in metres (around the body, height)."""
    period, stripes = sett

    def axis(t):
        col = np.tile(np.asarray(base, float), (len(t), 1))
        f = np.mod(t, period)
        for off, w, rgb in stripes:
            d = np.abs(np.mod(f - off + period / 2, period) - period / 2)
            m = smooth01(w * 0.5 - d, -0.0012, 0.0012)
            col = mix(col, rgb, m)
        return col
    return 0.5 * (axis(u) + axis(v))


def p_cloth(c, pal):
    base = pal.get("cloth", srgb(118, 32, 26))
    n1 = c.noise(10.0, 3, 61)
    sett = pal.get("tartan")
    if sett is not None:
        P = c.P
        u = np.arctan2(P[:, 0], -(P[:, 1] - 0.015)) * 0.22            # arc length around the hips
        rgb = tartan(u, P[:, 2], base, sett) * (1.0 + 0.12 * n1)[:, None]
    else:
        rgb = np.tile(base, (c.n, 1)) * (1.0 + 0.18 * n1)[:, None]
    rgb = mix(rgb, rgb * 0.45, c.cav)
    rgb = mix(rgb, np.minimum(base * 1.5, 1), 0.3 * c.ridge)
    return out(c.n, rgb, 0.86)


def p_sole(c, pal):
    rgb = np.tile(pal.get("sole", srgb(44, 32, 26)), (c.n, 1))
    rgb = mix(rgb, srgb(92, 80, 68), 0.45 * c.ridge)
    return out(c.n, rgb, 0.85)


def p_emissive(c, pal):
    """Glowing runes / embers: dark base, emissive mask in c_prm.b."""
    rgb = np.tile(pal.get("rune", srgb(255, 120, 40)), (c.n, 1))
    return out(c.n, rgb, 0.4, 0.0, 1.0)


PAINTERS = {"skin": p_skin, "eye": p_eye, "nail": p_nail, "brow": p_brow, "hair": p_hairmass, "leather": p_leather,
            "leather_dark": p_leather_dark, "fur": p_fur_mass, "bronze": p_metal, "iron": p_iron, "cloth": p_cloth,
            "sole": p_sole, "rune": p_emissive,
            "mane": p_mane, "locks": lambda c, pal: p_locks(c, pal, "hair"), "furlocks": lambda c, pal: p_locks(c, pal, "fur")}

# micro-detail recipe per material kind (node side)
MICRO = {"skin": "pores", "eye": "none", "nail": "none", "brow": "strands_world", "hair": "strands_world",
         "leather": "grain", "leather_dark": "grain", "fur": "strands_world", "bronze": "hammered",
         "iron": "hammered", "cloth": "weave", "sole": "grain", "rune": "none", "locks": "strands_uv", "mane": "strands_uv",
         "furlocks": "strands_uv_fine", "mail": "chainmail",
         # hero-seraphine C1 (additive): clean stylised clump hair -- one gentle strand set, no noise phase
         "mane_soft": "strands_uv_soft",
         # hero-seraphine C1 r6 (additive): sculpted clump hair with no node-side strand ribbing at all
         "mane_clean": "none",
         # enemies-art-1 C1 r5 (additive): cross-weave cloth kinds (opt-in via a build's KINDS map)
         "homespun": "weave_cyl", "burlap": "burlap_cyl"}
# hero-gorrim (additive): 'chainmail' = riveted ring lattice around the vertical body axis (rows along Z, rings
# staggered every other row), node-side so it stays crisp at any mesh resolution. Tunables (metres) below.
MAIL = dict(pitch_u=0.0086, pitch_v=0.0062, ring=0.36, wire=0.13, axis_y=0.0, radius=0.2)


def paint_mesh(ob, materials, L, pal, extra=None, painters=None, lock_kind=None):
    """Paint 'c_base' / 'c_prm' CORNER colour attributes on a HI mesh.
    materials: slot names in order (face material_index -> name). lock_kind: 'locks'|'furlocks' for lock meshes."""
    painters = dict(PAINTERS, **(painters or {}))
    me = ob.data
    P = meshutil.get_verts(ob)
    N = vertex_normals(ob)
    cf, cb = curvature(ob)
    nv = len(P)
    paints = {}
    attrs = {}
    for a in me.attributes:
        if a.domain == "POINT" and a.data_type == "FLOAT" and a.name not in ("mat_id",):
            v = np.empty(nv, np.float32)
            a.data.foreach_get("value", v)
            if a.name.startswith("p_"):
                paints[a.name[2:]] = v.astype(float)
            else:
                attrs[a.name] = v.astype(float)
    ls = np.empty(len(me.polygons), np.int32)
    lt = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    fm = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("material_index", fm)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    lf = np.repeat(np.arange(len(ls)), lt)
    lm = fm[lf]
    col = np.zeros((len(lv), 4), np.float32)
    prm = np.zeros((len(lv), 4), np.float32)
    col[:, 3] = 1
    prm[:, 3] = 1
    ex = dict(extra or {})
    for mi in np.unique(lm):
        name = lock_kind or (materials[mi] if mi < len(materials) else "skin")
        fn = painters.get(name, p_skin)
        sel_loops = np.nonzero(lm == mi)[0]
        vids, inv = np.unique(lv[sel_loops], return_inverse=True)
        c = Ctx(P[vids], N[vids], cf[vids], cb[vids], {k: v[vids] for k, v in paints.items()},
                {k: v[vids] for k, v in attrs.items()}, L, ex)
        rgb, r, m, e = fn(c, pal)
        col[sel_loops, :3] = np.clip(rgb[inv], 0, 1)
        prm[sel_loops, 0] = r[inv]
        prm[sel_loops, 1] = m[inv]
        prm[sel_loops, 2] = e[inv]
    for nm, arr in (("c_base", col), ("c_prm", prm)):
        if nm in me.color_attributes:
            me.color_attributes.remove(me.color_attributes[nm])
        a = me.color_attributes.new(nm, "FLOAT_COLOR", "CORNER")
        a.data.foreach_set("color", arr.ravel())


# ============================================================================ node trees
class NB:
    def __init__(self, mat):
        self.m = mat
        self.nt = mat.node_tree
        self.x = -1400

    def n(self, kind, **props):
        node = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        node.location = (self.x, 0)
        self.x += 120
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)

    def math(self, op, a, b=None, clamp=False):
        m = self.n("ShaderNodeMath", operation=op, use_clamp=clamp)
        self._in(m.inputs[0], a)
        if b is not None:
            self._in(m.inputs[1], b)
        return m.outputs[0]

    def _in(self, sock, v):
        if isinstance(v, (int, float)):
            sock.default_value = v
        else:
            self.link(v, sock)

    def vmath(self, op, a, b=None):
        m = self.n("ShaderNodeVectorMath", operation=op)
        self._in_v(m.inputs[0], a)
        if b is not None:
            self._in_v(m.inputs[1], b)
        return m.outputs[0]

    def _in_v(self, sock, v):
        if isinstance(v, (tuple, list)):
            sock.default_value = v
        elif isinstance(v, (int, float)):
            sock.default_value = (v, v, v)
        else:
            self.link(v, sock)


def _micro(nb, recipe, obj_co, uv):
    """Returns (height_socket_or_None, albedo_mult_socket_or_None, rough_add_socket_or_None, bump_dist)."""
    if recipe == "none":
        return None, None, None, 0.0
    if recipe == "pores":
        vor = nb.n("ShaderNodeTexVoronoi", feature="F1")
        vor.inputs["Scale"].default_value = 300.0     # r2: 520 aliased into a fishnet grid at 2K body density
        nb.link(obj_co, vor.inputs["Vector"])
        noi = nb.n("ShaderNodeTexNoise")
        noi.inputs["Scale"].default_value = 90.0
        noi.inputs["Detail"].default_value = 4.0
        nb.link(obj_co, noi.inputs["Vector"])
        h = nb.math("ADD", nb.math("MULTIPLY", vor.outputs["Distance"], 0.7), nb.math("MULTIPLY", noi.outputs["Fac"], 0.5))
        alb = nb.math("ADD", nb.math("MULTIPLY", noi.outputs["Fac"], 0.12), 0.94)
        return h, alb, None, 0.0001
    if recipe == "grain":
        vor = nb.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
        vor.inputs["Scale"].default_value = 260.0
        nb.link(obj_co, vor.inputs["Vector"])
        noi = nb.n("ShaderNodeTexNoise")
        noi.inputs["Scale"].default_value = 26.0
        noi.inputs["Detail"].default_value = 6.0
        noi.inputs["Roughness"].default_value = 0.62
        nb.link(obj_co, noi.inputs["Vector"])
        crease = nb.math("POWER", nb.math("ABSOLUTE", nb.math("SUBTRACT", noi.outputs["Fac"], 0.5)), 0.5)
        h = nb.math("ADD", nb.math("MULTIPLY", nb.math("MINIMUM", vor.outputs["Distance"], 0.12), 3.0),
                    nb.math("MULTIPLY", crease, 0.8))
        alb = nb.math("ADD", nb.math("MULTIPLY", vor.outputs["Distance"], 0.9), 0.88)
        return h, nb.math("MINIMUM", alb, 1.05), None, 0.0006
    if recipe == "hammered":
        vor = nb.n("ShaderNodeTexVoronoi", feature="SMOOTH_F1")
        vor.inputs["Scale"].default_value = 90.0
        nb.link(obj_co, vor.inputs["Vector"])
        noi = nb.n("ShaderNodeTexNoise")
        noi.inputs["Scale"].default_value = 300.0
        nb.link(obj_co, noi.inputs["Vector"])
        h = nb.math("ADD", vor.outputs["Distance"], nb.math("MULTIPLY", noi.outputs["Fac"], 0.15))
        rough = nb.math("MULTIPLY", nb.math("SUBTRACT", noi.outputs["Fac"], 0.5), 0.18)
        return h, None, rough, 0.00045
    if recipe in ("weave_cyl", "burlap_cyl"):
        # enemies-art-1 C1 r5 (additive): CROSS weave in cylindrical object coords (warp = arc length round the
        # vertical axis, weft = height), so the threads run round curved garments instead of the single-axis
        # 'weave' bands that moire into wood-grain rings on surfaces facing +-X. burlap = coarser + slubbed.
        period = 0.0032 if recipe == "weave_cyl" else 0.0065
        sep = nb.n("ShaderNodeSeparateXYZ")
        nb.link(obj_co, sep.inputs[0])
        u = nb.math("MULTIPLY", nb.math("ARCTAN2", sep.outputs["X"], sep.outputs["Y"]), 0.16)
        k = 2 * math.pi / period
        noi = nb.n("ShaderNodeTexNoise")
        noi.inputs["Scale"].default_value = 60.0 if recipe == "weave_cyl" else 28.0
        nb.link(obj_co, noi.inputs["Vector"])
        jit = nb.math("MULTIPLY", nb.math("SUBTRACT", noi.outputs["Fac"], 0.5), 1.6)
        weft = nb.math("SINE", nb.math("ADD", nb.math("MULTIPLY", sep.outputs["Z"], k), jit))
        warp = nb.math("SINE", nb.math("ADD", nb.math("MULTIPLY", u, k), jit))
        h = nb.math("ADD", nb.math("MULTIPLY", nb.math("ADD", weft, warp), 0.25), 0.5)
        if recipe == "burlap_cyl":
            h = nb.math("ADD", h, nb.math("MULTIPLY", noi.outputs["Fac"], 0.35))
        return h, None, None, 0.0003 if recipe == "weave_cyl" else 0.0006
    if recipe == "weave":
        wav = nb.n("ShaderNodeTexWave", wave_type="BANDS")
        wav.inputs["Scale"].default_value = 420.0
        nb.link(obj_co, wav.inputs["Vector"])
        return wav.outputs["Fac"], None, None, 0.0003
    if recipe in ("strands_uv", "strands_uv_fine"):
        sep = nb.n("ShaderNodeSeparateXYZ")
        nb.link(uv, sep.inputs[0])
        k = 13.0 if recipe == "strands_uv" else 7.0
        noi = nb.n("ShaderNodeTexNoise")
        noi.inputs["Scale"].default_value = 3.0
        nb.link(uv, noi.inputs["Vector"])
        ph = nb.math("ADD", nb.math("MULTIPLY", sep.outputs["X"], k * 2 * math.pi),
                     nb.math("MULTIPLY", noi.outputs["Fac"], 5.0))
        s = nb.math("SINE", ph)
        # second, finer strand set: along the flow only (a Y term here cross-hatched the locks into a
        # perforated / snakeskin look)
        ph2 = nb.math("ADD", nb.math("MULTIPLY", sep.outputs["X"], k * 2.7 * 2 * math.pi),
                      nb.math("MULTIPLY", noi.outputs["Fac"], 3.0))
        s2 = nb.math("SINE", ph2)
        h = nb.math("ADD", nb.math("MULTIPLY", s, 0.65), nb.math("MULTIPLY", s2, 0.25))
        alb = nb.math("ADD", nb.math("MULTIPLY", h, 0.1), 1.0)
        return h, alb, None, 0.0006 if recipe == "strands_uv" else 0.0012
    if recipe == "strands_uv_soft":
        # hero-seraphine C1 (additive): smooth stylised hair. A single low-amplitude strand set along the
        # clump flow (the strands_uv noise phase + second set read as dotted noise on wide clean clumps).
        sep = nb.n("ShaderNodeSeparateXYZ")
        nb.link(uv, sep.inputs[0])
        s = nb.math("SINE", nb.math("MULTIPLY", sep.outputs["X"], 8.0 * 2 * math.pi))
        alb = nb.math("ADD", nb.math("MULTIPLY", s, 0.035), 1.0)
        return s, alb, None, 0.00022
    if recipe == "chainmail":
        sep = nb.n("ShaderNodeSeparateXYZ")
        nb.link(obj_co, sep.inputs[0])
        ny = nb.math("MULTIPLY", nb.math("SUBTRACT", sep.outputs["Y"], MAIL["axis_y"]), -1.0)
        ang = nb.math("ARCTAN2", sep.outputs["X"], ny)
        u = nb.math("MULTIPLY", ang, MAIL["radius"] / MAIL["pitch_u"])
        v = nb.math("MULTIPLY", sep.outputs["Z"], 1.0 / MAIL["pitch_v"])
        row = nb.math("FLOOR", v)
        odd = nb.math("FLOORED_MODULO", row, 2.0)
        u2 = nb.math("ADD", u, nb.math("MULTIPLY", odd, 0.5))
        fu = nb.math("SUBTRACT", nb.math("FRACT", u2), 0.5)
        fv = nb.math("MULTIPLY", nb.math("SUBTRACT", nb.math("FRACT", v), 0.5), MAIL["pitch_v"] / MAIL["pitch_u"])
        d = nb.math("SQRT", nb.math("ADD", nb.math("MULTIPLY", fu, fu), nb.math("MULTIPLY", fv, fv)))
        dev = nb.math("ABSOLUTE", nb.math("SUBTRACT", d, MAIL["ring"]))
        ring = nb.math("SUBTRACT", 1.0, nb.math("MINIMUM", nb.math("DIVIDE", dev, MAIL["wire"]), 1.0))
        h = nb.math("POWER", ring, 0.6)
        alb = nb.math("ADD", nb.math("MULTIPLY", h, 0.7), 0.42)
        rough = nb.math("MULTIPLY", nb.math("SUBTRACT", 0.6, h), 0.35)
        return h, alb, rough, 0.0009
    if recipe == "strands_world":
        wav = nb.n("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Z")
        wav.inputs["Scale"].default_value = 60.0
        wav.inputs["Distortion"].default_value = 6.0
        wav.inputs["Detail"].default_value = 3.0
        nb.link(obj_co, wav.inputs["Vector"])
        alb = nb.math("ADD", nb.math("MULTIPLY", wav.outputs["Fac"], 0.3), 0.85)
        return wav.outputs["Fac"], alb, None, 0.0006
    return None, None, None, 0.0


def bake_material(name, kind, ao_small=0.025, ao_large=0.22, emissive_boost=1.0):
    """Bake-source material for one sculpt material kind (see MICRO)."""
    m = bpy.data.materials.get(name)
    if m is not None:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    nb = NB(m)
    tc = nb.n("ShaderNodeTexCoord")
    uvm = nb.n("ShaderNodeUVMap")
    uvm.uv_map = "lockuv"
    ab = nb.n("ShaderNodeAttribute", attribute_name="c_base", attribute_type="GEOMETRY")
    ap = nb.n("ShaderNodeAttribute", attribute_name="c_prm", attribute_type="GEOMETRY")
    sp = nb.n("ShaderNodeSeparateColor")
    nb.link(ap.outputs["Color"], sp.inputs["Color"])
    height, alb_mult, rough_add, bdist = _micro(nb, MICRO.get(kind, "none"), tc.outputs["Object"], uvm.outputs["UV"])
    albedo = ab.outputs["Color"]
    if alb_mult is not None:
        mm = nb.n("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        mm.inputs["Factor"].default_value = 1.0
        nb.link(albedo, mm.inputs[6])
        cmb = nb.n("ShaderNodeCombineColor")
        for i in range(3):
            nb.link(alb_mult, cmb.inputs[i])
        nb.link(cmb.outputs[0], mm.inputs[7])
        albedo = mm.outputs[2]
    rough = sp.outputs["Red"]
    if rough_add is not None:
        rough = nb.math("ADD", rough, rough_add, clamp=True)
    metal = sp.outputs["Green"]
    emit = sp.outputs["Blue"]
    outn = nb.n("ShaderNodeOutputMaterial")
    outn.name = "OUT"
    # albedo pass
    e_alb = nb.n("ShaderNodeEmission")
    e_alb.name = "P_albedo"
    nb.link(albedo, e_alb.inputs["Color"])
    # prm pass
    cmb = nb.n("ShaderNodeCombineColor")
    nb.link(rough, cmb.inputs[0])
    nb.link(metal, cmb.inputs[1])
    nb.link(emit, cmb.inputs[2])
    e_prm = nb.n("ShaderNodeEmission")
    e_prm.name = "P_prm"
    nb.link(cmb.outputs[0], e_prm.inputs["Color"])
    # ao pass: R = small-radius AO (cavities), G = large (crevices, armpits, under hair)
    a1 = nb.n("ShaderNodeAmbientOcclusion", samples=16)
    a1.inputs["Distance"].default_value = ao_small
    a2 = nb.n("ShaderNodeAmbientOcclusion", samples=16)
    a2.inputs["Distance"].default_value = ao_large
    cao = nb.n("ShaderNodeCombineColor")
    nb.link(a1.outputs["AO"], cao.inputs[0])
    nb.link(a2.outputs["AO"], cao.inputs[1])
    e_ao = nb.n("ShaderNodeEmission")
    e_ao.name = "P_ao"
    nb.link(cao.outputs[0], e_ao.inputs["Color"])
    # normal pass: principled with bump
    bs = nb.n("ShaderNodeBsdfPrincipled")
    bs.name = "P_normal"
    if height is not None:
        bump = nb.n("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 1.0
        bump.inputs["Distance"].default_value = bdist
        nb.link(height, bump.inputs["Height"])
        nb.link(bump.outputs["Normal"], bs.inputs["Normal"])
        # AO nodes should see the bumped normal too (tiny effect, keeps passes consistent)
    # preview pass (look-dev renders in Blender): full principled
    bsp = nb.n("ShaderNodeBsdfPrincipled")
    bsp.name = "P_look"
    nb.link(albedo, bsp.inputs["Base Color"])
    nb.link(rough, bsp.inputs["Roughness"])
    nb.link(metal, bsp.inputs["Metallic"])
    if height is not None:
        nb.link(bump.outputs["Normal"], bsp.inputs["Normal"])
    m["kca_kind"] = kind
    set_material_pass(m, "look")
    return m


def set_material_pass(m, name):
    nt = m.node_tree
    outn = nt.nodes.get("OUT")
    src = nt.nodes.get("P_" + name)
    if outn is None or src is None:
        return
    for l in list(outn.inputs["Surface"].links):
        nt.links.remove(l)
    nt.links.new(src.outputs[0], outn.inputs["Surface"])


def set_pass(objects, name):
    seen = set()
    for ob in objects:
        for m in ob.data.materials:
            if m and m.name not in seen:
                seen.add(m.name)
                set_material_pass(m, name)


def assign_bake_materials(ob, names, prefix="bk_", kinds=None):
    """One bake material per slot name (kind = name unless remapped)."""
    from .pipeline import restore_face_mats
    ob.data.materials.clear()
    for nm in names:
        kind = (kinds or {}).get(nm, nm)
        m = bpy.data.materials.get(prefix + nm)
        if m is None:
            m = bake_material(prefix + nm, kind)
        ob.data.materials.append(m)
    restore_face_mats(ob)
