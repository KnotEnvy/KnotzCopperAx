"""Hard-surface weapon helpers (bmesh blades + SDF hilts).

Weapon convention (docs/ARCHITECTURE.md §2): grip point at the local origin, blade along +Y in glTF
= +Z in Blender (the exporter converts), flat of the blade facing Blender ±Y (glTF ∓Z), edges along ±X.

blade_mesh()      exact cross-section profile swept along +Z with a width/thickness taper, fuller groove, point.
                  Returns the object plus per-vertex blade coords (s = along 0..1, u = across -1..1) for runes.
rune_strokes()    procedural, original glyph strokes placed along the fuller (angular staff-and-branch runes).
engrave()         displaces HI blade vertices inward along strokes + writes the 'p_rune' emissive mask.
nick_edges()      battle damage: small notches along the cutting edges.
"""
import math
import numpy as np
import bmesh
import bpy

from . import meshutil


def _profile(n_half, fuller_w, fuller_d, bevel=0.12):
    """Half-profile (x in [0,1] across, y thickness factor) from centre to edge; mirrored to a closed ring.
    Diamond-ish with a flat central fuller and a narrow secondary edge bevel."""
    xs = np.linspace(0.0, 1.0, n_half)
    ys = []
    for x in xs:
        base = 1.0 - x ** 1.35                     # lenticular/diamond
        if x > 1.0 - bevel:                        # secondary edge bevel (steeper)
            base = min(base, (1.0 - x) / bevel * (1.0 - (1.0 - bevel) ** 1.35))
        if x < fuller_w:                           # fuller: shallow round-bottomed groove
            f = 1.0 - (x / fuller_w) ** 2
            base = base - fuller_d * f
        ys.append(max(base, 0.0))
    return xs, np.array(ys)


def blade_mesh(name, z0, length, width_fn, thick_fn, n_half=9, stations=None, fuller=(0.0, 0.7, 0.22, 0.45),
               tip_frac=0.12, bevel=0.12):
    """Sweep a closed blade section along +Z from z0. width_fn(s)/thick_fn(s) give full width/thickness at
    s in [0,1] (0 = base, 1 = tip). fuller = (s_start, s_end, half-width fraction, depth fraction).
    bevel = fraction of the half-width taken by the steeper edge bevel (C2 hero weapons use ~0.25-0.3 for a bold,
    readable bevel plane; default 0.12 = the original narrow secondary bevel)."""
    if stations is None:
        stations = np.concatenate([np.linspace(0, 1 - tip_frac, 14), np.linspace(1 - tip_frac, 1, 5)[1:]])
    stations = np.asarray(stations, float)
    fs0, fs1, fw, fd = fuller
    bm = bmesh.new()
    rings = []
    coords = []      # (s, u) per vertex
    for s in stations[:-1]:
        # fuller fades in/out smoothly
        fade = np.clip((s - fs0) / 0.04, 0, 1) * np.clip((fs1 - s) / 0.08, 0, 1)
        xs, ys = _profile(n_half, fw, fd * fade, bevel=bevel)
        w, t = width_fn(s) * 0.5, thick_fn(s) * 0.5
        ring = []
        # +Y face from edge(+x) to edge(-x), then -Y face back (closed loop, edge vertices shared)
        pts = [(xs[i], ys[i]) for i in range(n_half - 1, -1, -1)] + [(-xs[i], ys[i]) for i in range(1, n_half)]
        pts += [(-xs[i], -ys[i]) for i in range(n_half - 2, 0, -1)] + [(xs[i], -ys[i]) for i in range(0, n_half - 1)]
        for (x, y) in pts:
            v = bm.verts.new((x * w, y * t, z0 + s * length))
            ring.append(v)
            coords.append((s, x))
        rings.append(ring)
    tip = bm.verts.new((0.0, 0.0, z0 + length))
    coords.append((1.0, 0.0))
    n = len(rings[0])
    for a, b in zip(rings[:-1], rings[1:]):
        for j in range(n):
            j1 = (j + 1) % n
            bm.faces.new((a[j], a[j1], b[j1], b[j]))
    last = rings[-1]
    for j in range(n):
        bm.faces.new((last[j], last[(j + 1) % n], tip))
    first = rings[0]
    bm.faces.new(list(reversed(first)))
    bm.normal_update()
    ob = meshutil.bm_to_object(bm, name)
    # flat shading on the bevel/edge breaks: auto-smooth by angle
    try:
        ob.data.set_sharp_from_angle(angle=math.radians(35))
    except Exception:
        pass
    return ob, np.array(coords)


def rune_strokes(seed=7, n=9, s0=0.10, s1=0.64, cell_u=0.16, aspect=1.9):
    """Original angular glyphs: a vertical staff plus 1-3 branches/hooks each, stacked along the fuller.
    Returns list of ((s_a, u_a), (s_b, u_b)) segments in blade coordinates (u across in units of half-width)."""
    rng = np.random.RandomState(seed)
    segs = []
    cell_s = (s1 - s0) / n
    h = cell_s * 0.72
    for i in range(n):
        sc = s0 + (i + 0.5) * cell_s
        top, bot = sc + h / 2, sc - h / 2
        w = cell_u
        kind = rng.randint(0, 6)
        segs.append(((bot, 0.0), (top, 0.0)))                       # staff
        if kind in (0, 3):
            segs.append(((top - h * 0.25, 0.0), (top, w)))
            segs.append(((top - h * 0.25, 0.0), (top, -w)))
        if kind in (1, 3, 5):
            segs.append(((sc, 0.0), (sc + h * 0.3, w)))
        if kind in (2, 4):
            segs.append(((bot + h * 0.2, -w), (top - h * 0.2, w)))
        if kind in (4, 5):
            segs.append(((bot, -w * 0.6), (bot + h * 0.3, 0.0)))
            segs.append(((bot, w * 0.6), (bot + h * 0.3, 0.0)))
        if kind == 0:
            segs.append(((bot + h * 0.35, 0.0), (bot, -w)))
    return segs


def seg_dist2d(p, a, b):
    p, a, b = np.asarray(p, float), np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    c = a + t[:, None] * ab
    return np.linalg.norm(p - c, axis=1)


def engrave(ob, coords, strokes, length, half_width_fn, width=0.0022, depth=0.0007):
    """Carve rune strokes into both flats of a dense HI blade and store the emissive mask 'p_rune'."""
    V = meshutil.get_verts(ob)
    s, u = coords[:, 0], coords[:, 1]
    hw = np.array([half_width_fn(x) for x in s])
    # metric coords: along (m), across (m)
    P2 = np.stack([s * length, u * hw], axis=1)
    d = np.full(len(V), 1e9)
    for (a, b) in strokes:
        A = np.array([a[0] * length, a[1] * half_width_fn(a[0])])
        B = np.array([b[0] * length, b[1] * half_width_fn(b[0])])
        d = np.minimum(d, seg_dist2d(P2, A, B))
    mask = np.clip(1.0 - (d - width * 0.5) / (width * 0.6), 0, 1)
    face = np.abs(u) < 0.5                             # only on the flats near the centre
    mask *= face
    sgn = np.sign(V[:, 1])
    V[:, 1] -= sgn * depth * mask
    meshutil.set_verts(ob, V)
    meshutil.add_float_attr(ob, "p_rune", mask)
    return mask


def nick_edges(ob, coords, seed=3, n=7, depth=0.004, width=0.012, length=1.0, s_range=(0.15, 0.85)):
    rng = np.random.RandomState(seed)
    V = meshutil.get_verts(ob)
    s, u = coords[:, 0], coords[:, 1]
    edge = np.abs(u) > 0.8
    for _ in range(n):
        sc = rng.uniform(*s_range)
        side = rng.choice([-1, 1])
        dd = np.abs(s - sc) * length
        w = np.clip(1 - dd / width, 0, 1) ** 1.5 * edge * (np.sign(u) == side) * ((np.abs(u) - 0.8) / 0.2)
        V[:, 0] -= side * depth * rng.uniform(0.5, 1.0) * w
    meshutil.set_verts(ob, V)


def notch_edges(ob, coords, notches, length):
    """Deliberate silhouette notches (C2 hero weapons): notches = [(s_centre, side +1|-1, depth m, half-width m)].
    A V-shaped bite into one cutting edge; the whole edge zone (|u| > 0.55) follows so the bevel stays coherent.
    Apply the SAME list to the HI and the LO blade (put LO stations at s_c and s_c +- half-width/length so the
    bite survives in the game mesh, not only in the normal map)."""
    V = meshutil.get_verts(ob)
    s, u = coords[:, 0], coords[:, 1]
    zone = np.clip((np.abs(u) - 0.55) / 0.45, 0, 1)
    for (sc, side, depth, hw) in notches:
        dd = np.abs(s - sc) * length
        w = np.clip(1.0 - dd / hw, 0, 1) * zone * (np.sign(u) == side)
        V[:, 0] -= side * depth * w
    meshutil.set_verts(ob, V)


def notch_stations(base, notches, length, frac=0.9):
    """Merge notch key stations (s_c - hw, s_c, s_c + hw) into a station array (sorted, unique, inside [0, 1])."""
    st = list(np.asarray(base, float))
    for (sc, _side, _depth, hw) in notches:
        d = hw / length
        st += [sc - d, sc, sc + d]
    st = np.unique(np.clip(np.array(st), 0.0, 1.0))
    return st
