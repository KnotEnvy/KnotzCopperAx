"""Stage5 r32 single board-driven FIX: carved serpent pillar / throne forms (scratch only).

Run only via tools/blender-run.mjs. Input is the clean LIVE supplemental env_stage5_forms_r32.glb (hash
locked); the three modules pillar / pillar_lo / throne are rebuilt with the retained column support
(shaft, base, capital, rings) and throne dais / seat / cushion / bronze copied byte-exact from it. The donor
kit is read ONLY for the stone palette (convex blends of its own stone vertex colours; never brightened,
crevices darkened by baked occlusion). Output is a compact 3-node GLB (same node names, order, identity
transforms, COLOR_0 categorical alpha masks) plus isolated module GLBs, sheets, audit and report JSON.

  --preview all|pillar|throne   geometry + clay / vertex / game-scale sheets (coarse voxels)
  --fast                        finer voxels, no sheets
  --release                     one final export (refuses to overwrite) + release-resolution sheets
  --out <dir>                   must be inside progress/tmp/env-r32-stage5-fix-forms
"""
import argparse
import copy
import json
import math
import sys
import time
from pathlib import Path

CONFIG = {
    'seed': 3261,
    'supplement_sha256': 'e4d8b5645cf33d94d202c27b29f560ee5a3f415c3aeeac334edced67d6cda286',
    'donor_sha256': '9744a71bf38fc9ff85b34442ee71a33c9f1dc91dd200b7a07c599623ef9d944b',
    'budgets': {'pillar': 18000, 'pillar_lo': 7000, 'throne': 20000, 'combined': 45000},
    'targets': {'pillar_form': 13500, 'pillar_lo_form': 4650, 'throne_form': 17000},
    'voxel': {'preview': .030, 'fast': .024, 'release': .018},
    'voxel_lo': {'preview': .034, 'fast': .030, 'release': .026},
    'crease_deg': 27.0,
    'max_discarded_island_vertices': 60,
    'ao': {'rays': 20, 'max_dist': .55, 'strength': .58, 'floor_scale': .85, 'palette_n': 8},
    'pillar': {
        'turns': 2.35, 'end_angle': -math.pi * .5 + .12, 'bottom': .98, 'rise': 2.77,
        'path_radius': 1.005, 'path_drop': .11, 'tail_radius': .18, 'coil_radius': .465, 'radius_exp': .38,
        'tail_taper': .10,
        # carved cross-section (u outward, w up) in units of the body radius: flat belly plate, two outer
        # flank planes, crown plane, top plane; the inner planes are buried in the shaft
        'profile': [(-0.70, -0.78), (0.50, -0.80), (0.98, -0.18), (0.86, 0.42), (0.46, 0.90), (-0.20, 0.98),
                    (-0.80, 0.55), (-0.92, -0.20)],
        # two staggered rows of broad flat scales: on the crown plane and on the upper flank
        'scale_uw': ((0.72, 0.68), (0.97, 0.05)), 'scale_start': .14, 'scale_pitch': .50, 'scale_len': .27,
        'scale_w': .17, 'scale_thick': .03, 'scale_tilt_deg': 8.0,
        'joint_start': .12, 'joint_pitch': .42, 'joint_uw': (-0.10, -0.80),
        'coil_chips': 5, 'chip_uw': (0.98, -0.18),
        # neck: carved symmetric profile (flat throat plate underneath, dorsal ridge toward the column)
        'neck_points': [(.07, -1.33, 3.93), (.02, -1.78, 4.13), (0, -2.12, 4.33)],
        'neck_radii': [.44, .41, .38, .34],
        'neck_profile': [(-.55, -.80), (.55, -.80), (.98, -.15), (.70, .55), (0, .95), (-.70, .55), (-.98, -.15)],
        'neck_joints': (.30, .55, .80),
        'hood_root': (0, -1.30, 4.12), 'hood_root_half': (.48, .52, .42),
        'hood': {'center': (0, -1.90, 4.62), 'radii': (1.22, .19, .68), 'taper_x': .42, 'taper_z': 3.90,
                 'facet_deg': 22.0, 'back_deg': 10.0, 'centre_w': .40, 'rim': .14, 'field_depth': .05,
                 'field_x0': .46,
                 'spine': {'proud': .06, 'half_y': .08, 'z': 4.62, 'half_z': .60, 'top_w': .26, 'bot_w': .14},
                 'rib_root': 4.02, 'rib_deg': (36, 62), 'rib_in': .06, 'rib_margin': .07, 'rib_w': .028,
                 'chip_deg': (64, 118, 150), 'chip_half': (.10, .10, .08)},
        'head': {'center': (0, -2.15, 4.63), 'scale': 1.3, 'forward': (0, -1, -.15)},
    },
    'throne': {
        'slab': {'center': (0, 1.22, 2.375), 'half': (1.30, .28, 1.375), 'chamfer': .30},
        'hood': {'center': (0, 1.22, 3.70), 'radii': (1.05, .28, .46), 'taper_x': .36, 'taper_z': 3.25,
                 'facet_deg': 18.0, 'back_deg': 8.0, 'centre_w': .30, 'rim': .12, 'field_depth': .04,
                 'field_x0': .35,
                 'spine': {'proud': .05, 'half_y': .08, 'z': 3.72, 'half_z': .38, 'top_w': .20, 'bot_w': .10},
                 'rib_root': 3.30, 'rib_deg': (40,), 'rib_in': .05, 'rib_margin': .06, 'rib_w': .025,
                 'chip_deg': (), 'chip_half': (.08, .08, .06)},
        'panel': {'z': 2.60, 'half_x': 1.06, 'depth': .10, 'half_z': .95},
        'relief_path': [(-.80, 1.58), (-.72, 1.90), (-.30, 2.15), (.30, 2.42), (.66, 2.70), (.52, 3.00),
                        (0, 3.22), (-.40, 3.40), (-.36, 3.62)],
        'relief_front': [0, 0, .5, 1, .5, 0, -1, -.5, 0],
        # relief profile (u sideways, w out of the panel): buried flat back, two sloped faces, a ridge apex
        'relief_profile': [(-1.0, -.25), (1.0, -.25), (.78, .45), (0, 1.0), (-.78, .45)],
        'relief_r': .13, 'relief_sink': .03, 'relief_cross': .035,
        'relief_joint_start': .12, 'relief_joint_pitch': .42, 'relief_joint_depth': .02,
        'head': {'center': (0, 1.00, 3.78), 'scale': 1.0, 'forward': (0, -.94, -.34)},
        'arm': {'body': [(1.20, 1.12, 2.25), (1.40, .62, 1.92), (1.44, .05, 1.80), (1.36, -.60, 1.78)],
                'body_radii': [.26, .25, .23, .21],
                'tail': [(1.14, 1.14, 1.50), (1.52, .60, 1.12), (1.46, -.22, 1.02), (1.36, -.52, 1.40)],
                'tail_radii': [.22, .19, .15, .11],
                'head_center': (1.34, -.72, 1.80), 'head_forward': (-.06, -1, -.14), 'head_scale': .72},
        'slab_chips': [(-1.22, .94, 3.10), (1.08, .94, 3.60), (-.62, .94, 1.80)],
    },
    'preview': {'resolution': (520, 620), 'yaw': (0, 35, 90), 'pitch': 8, 'game_px_per_m': 72.5},
}

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'blender'))
SCRATCH = ROOT / 'progress/tmp/env-r32-stage5-fix-forms'

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402
from mathutils.kdtree import KDTree  # noqa: E402
from lib import meshutil, pipeline, preview  # noqa: E402
from env_stage5_r32_forms import Glb, digest, subset, concatenate, connected_face_groups  # noqa: E402
from build_env_stage5_r32 import clean_form, to_blender, to_gltf  # noqa: E402  (module import only; main is guarded)
from env_stage5_r32_fix_forms import (pillar_sculpt, throne_sculpt, sdf_split_arrays, bake_vertex_ao,  # noqa: E402
                                      write_forms_glb)

MASKS = np.array([0, .25, .5, .75, 1.0])


def log(message):
    print('[stage5-fix] ' + message, flush=True)


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__)
    modes = ap.add_mutually_exclusive_group()
    modes.add_argument('--preview', choices=('all', 'pillar', 'throne'))
    modes.add_argument('--fast', action='store_true')
    modes.add_argument('--release', action='store_true')
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--base-glb', type=Path, default=SCRATCH / 'baseline/env_stage5_forms_r32.glb',
                    help='the live supplement (hash locked)')
    ap.add_argument('--donor-glb', type=Path, default=SCRATCH / 'baseline/env_stage5_kit.glb',
                    help='donor kit, read only for the stone palette (hash locked)')
    ap.add_argument('--config', type=Path, help='JSON overrides for CONFIG')
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = ap.parse_args(argv)
    args.out = args.out.resolve()
    if not args.out.is_relative_to(SCRATCH.resolve()):
        ap.error('--out must be inside progress/tmp/env-r32-stage5-fix-forms')
    if not (args.preview or args.fast or args.release):
        ap.error('select --preview, --fast or --release explicitly')
    return args


def configure(path):
    cfg = copy.deepcopy(CONFIG)

    def merge(a, b):
        for k, v in b.items():
            if k not in a:
                raise ValueError('unknown CONFIG key: ' + k)
            if isinstance(v, dict):
                merge(a[k], v)
            else:
                a[k] = v
    if path:
        merge(cfg, json.loads(path.read_text()))
    return cfg


# ----------------------------------------------------------------------------- retained support
def pillar_support(attrs, tris):
    """Column support = every face outside the serpent's connected component (the largest island).

    The donor-era height rule (y < .805 = base) would swallow the r32 coil's lowest triangles; the serpent is one
    welded island that only penetrates the shaft, so the complement is exactly the shaft / base / capital / rings.
    """
    C = attrs['COLOR_0']
    groups = connected_face_groups(attrs, tris)
    snake = max(groups, key=len)
    faces = np.ones(len(tris), bool)
    faces[snake] = False
    masks = np.round(C[np.unique(tris[snake]), 3] * 4) / 4
    assert set(masks.tolist()) <= {0.0, 1.0}, 'serpent island must be stone + glow only'
    assert not np.isclose(C[np.unique(tris[faces]), 3], 1, atol=.01).any(), 'glow vertices belong to the serpent'
    return faces


def donor_pillar_replaced(attrs, tris):
    """Donor-kit faces the first build replaced (its height / mask rule): the palette source only."""
    P, C = attrs['POSITION'], attrs['COLOR_0']
    support = (np.all(np.isclose(C[tris, 3], .25, atol=.01) | np.isclose(C[tris, 3], .75, atol=.01), axis=1) |
               np.all(P[tris, 1] < .805, axis=1) | np.all(P[tris, 1] > 10.39, axis=1))
    return ~support


def throne_support(attrs, tris):
    P, C = attrs['POSITION'], attrs['COLOR_0']
    seat = np.zeros(len(tris), bool)
    for faces in connected_face_groups(attrs, tris):
        verts = P[np.unique(tris[faces])]
        lo, hi = verts.min(axis=0), verts.max(axis=0)
        if np.allclose(lo, (-1.25, .9, -1.3), atol=.0001) and np.allclose(hi, (1.25, 1.5, .2), atol=.0001):
            seat[faces] = True
    assert seat.sum() == 44, 'seat block must be the complete 44-triangle box'
    return (np.all(np.isclose(C[tris, 3], .25, atol=.01) | np.isclose(C[tris, 3], .5, atol=.01) |
                   np.isclose(C[tris, 3], .75, atol=.01), axis=1) | seat)


# ----------------------------------------------------------------------------- palette + paint
class Palette:
    """Donor stone colours of the replaced faces (KD-tree in Blender space) + the donor glow colour."""

    def __init__(self, donor_attrs, donor_tris, replaced_faces, n):
        src = np.unique(donor_tris[replaced_faces])
        src = src[np.isclose(donor_attrs['COLOR_0'][src, 3], 0, atol=.01)]
        self.P = to_blender(donor_attrs['POSITION'][src])
        self.C = donor_attrs['COLOR_0'][src, :3]
        self.n = n
        self.kd = KDTree(len(src))
        for i, p in enumerate(self.P):
            self.kd.insert(p, i)
        self.kd.balance()
        glow = donor_attrs['COLOR_0'][donor_attrs['COLOR_0'][:, 3] > .98, :3]
        self.glow = np.median(glow, axis=0) if len(glow) else np.array([.2623, 1.0, .1441])
        self.rgb_min, self.rgb_max = self.C.min(axis=0), self.C.max(axis=0)

    def lookup(self, P):
        C = np.zeros((len(P), 3))
        for i, p in enumerate(P):
            hits = self.kd.find_n(p, self.n)
            w = np.array([1 / max(h[2], .025) ** 2 for h in hits])
            C[i] = np.average(self.C[[h[1] for h in hits]], axis=0, weights=w)
        return C


def paint(P, N, palette, eyes, bvh, cfg):
    """Convex donor-stone blend, darkened in crevices by baked occlusion; glow only on the eye bulges."""
    a = cfg['ao']
    rgb = palette.lookup(P)
    ao = bake_vertex_ao(P, N, bvh, rays=a['rays'], max_dist=a['max_dist'])
    factor = 1 - a['strength'] * ao
    rgb = np.maximum(rgb * factor[:, None], palette.rgb_min * a['floor_scale'])
    C = np.concatenate([rgb, np.zeros((len(P), 1))], axis=1).astype(np.float32)
    eye_mask = np.zeros(len(P), bool)
    for head in eyes:
        for e in head['eyes']:
            eye_mask |= np.linalg.norm(P - np.asarray(e), axis=1) < head['eye_r']
    C[eye_mask, :3] = palette.glow
    C[eye_mask, 3] = 1.0
    return C, {'eye_vertices': int(eye_mask.sum()), 'ao_mean': float(ao.mean()), 'ao_max': float(ao.max()),
               'stone_rgb_min': rgb[~eye_mask].min(axis=0).tolist(), 'stone_rgb_max': rgb[~eye_mask].max(axis=0).tolist(),
               'palette_rgb_min': palette.rgb_min.tolist(), 'palette_rgb_max': palette.rgb_max.tolist()}


def bvh_of(parts):
    """BVH over (positions, triangles) parts in Blender space."""
    verts, polys, off = [], [], 0
    for P, T in parts:
        verts.extend([tuple(map(float, p)) for p in P])
        polys.extend([(int(a) + off, int(b) + off, int(c) + off) for a, b, c in T])
        off += len(P)
    return BVHTree.FromPolygons(verts, polys, all_triangles=True)


# ----------------------------------------------------------------------------- forms
def discarded_islands(ob):
    """Every island except the largest (what clean_form will drop): vertex count, centre, size.

    Slivers of a few voxels (chip corners, scale tips cut by a plane) are expected; anything larger means a
    designed part lost its root and the build must stop instead of silently shipping without it.
    """
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    pending, islands = set(bm.verts), []
    while pending:
        first = pending.pop()
        group, stack = {first}, [first]
        while stack:
            v = stack.pop()
            for e in v.link_edges:
                o = e.other_vert(v)
                if o in pending:
                    pending.remove(o)
                    group.add(o)
                    stack.append(o)
        islands.append(group)
    islands.sort(key=len, reverse=True)
    out = []
    for g in islands[1:]:
        P = np.array([v.co[:] for v in g])
        out.append({'vertices': len(g), 'centre': P.mean(axis=0).round(3).tolist(),
                    'size': (P.max(axis=0) - P.min(axis=0)).round(3).tolist()})
    bm.free()
    return out


def make_form(name, S, meta, target, h, cfg, support_b, palette):
    t0 = time.monotonic()
    ob = pipeline.sculpt_mesh(S, name + '_form', h, attrs=False, face_mats=False)
    discarded = discarded_islands(ob)
    big = [d for d in discarded if d['vertices'] > cfg['max_discarded_island_vertices']]
    if big:
        raise RuntimeError(f'{name}: detached geometry would be discarded by cleanup: {big}')
    hygiene = clean_form(ob)
    hygiene['discarded_islands'] = discarded
    raw = meshutil.tri_count(ob)
    meshutil.decimate(ob, target, symmetry=False)
    meshutil.triangulate(ob)
    hygiene['after_decimation'] = clean_form(ob)
    me = ob.data
    me.calc_loop_triangles()
    P = meshutil.get_verts(ob)
    T = np.array([t.vertices[:] for t in me.loop_triangles], np.int64)
    bpy.data.objects.remove(ob, do_unlink=True)
    P2, N2, T2, splits = sdf_split_arrays(S, P, T, cfg['crease_deg'])
    bvh = bvh_of([(P2, T2), support_b])
    heads = [meta[k] for k in ('head',) if k in meta] + meta.get('arm_eyes', [])
    C2, paint_report = paint(P2, N2, palette, heads, bvh, cfg)
    attrs = {'POSITION': to_gltf(P2).astype(np.float32), 'NORMAL': to_gltf(N2).astype(np.float32), 'COLOR_0': C2}
    report = {'voxel_m': h, 'raw_triangles': int(raw), 'triangles': int(len(T2)), 'vertices': int(len(P2)),
              'crease_splits': int(splits), 'cleanup': hygiene, 'paint': paint_report,
              'sculpt': {k: v for k, v in meta.items() if k not in ('head', 'arm_eyes')},
              'seconds': round(time.monotonic() - t0, 1)}
    log(f'{name}: {raw} raw -> {len(T2)} tris, {len(P2)} verts ({splits} crease splits) in {report["seconds"]}s')
    return attrs, T2, report


def build_pillar(cfg, supp, donor, h, h_lo):
    attrs, tris = supp.mesh('pillar')
    support_faces = pillar_support(attrs, tris)
    support = subset(attrs, tris, support_faces)
    assert len(support[1]) == 2212, len(support[1])
    support_b = (to_blender(support[0]['POSITION']), support[1])
    d_attrs, d_tris = donor.mesh('pillar')
    palette = Palette(d_attrs, d_tris, donor_pillar_replaced(d_attrs, d_tris), cfg['ao']['palette_n'])
    S, meta = pillar_sculpt(cfg, detail=True)
    hi_attrs, hi_T, hi_rep = make_form('pillar', S, meta, cfg['targets']['pillar_form'], h, cfg, support_b, palette)
    S_lo, meta_lo = pillar_sculpt(cfg, detail=False)
    lo_attrs, lo_T, lo_rep = make_form('pillar_lo', S_lo, meta_lo, cfg['targets']['pillar_lo_form'], h_lo, cfg,
                                       support_b, palette)
    high = concatenate([support, (hi_attrs, hi_T)])
    low = concatenate([support, (lo_attrs, lo_T)])
    report = {'retained_support_triangles': int(len(support[1])), 'high': hi_rep, 'low': lo_rep}
    return high, low, report


def build_throne(cfg, supp, donor, h):
    attrs, tris = supp.mesh('throne')
    support_faces = throne_support(attrs, tris)
    support = subset(attrs, tris, support_faces)
    assert len(support[1]) == 968, len(support[1])
    support_b = (to_blender(support[0]['POSITION']), support[1])
    d_attrs, d_tris = donor.mesh('throne')
    palette = Palette(d_attrs, d_tris, ~throne_support(d_attrs, d_tris), cfg['ao']['palette_n'])
    S, meta = throne_sculpt(cfg)
    f_attrs, f_T, rep = make_form('throne', S, meta, cfg['targets']['throne_form'], h, cfg, support_b, palette)
    result = concatenate([support, (f_attrs, f_T)])
    rep['retained_dais_seat_triangles'] = int(len(support[1]))
    rep['seat_anchor_gltf'] = [0, 1.65, .2]
    return result, rep


# ----------------------------------------------------------------------------- audit
def preservation_audit(supp, donor, candidate, replacements, cfg):
    report = {'supplement_sha256': digest(supp.path), 'donor_sha256': digest(donor.path),
              'candidate_sha256': digest(candidate.path), 'candidate_bytes': len(candidate.raw),
              'nodes_identical': candidate.doc['nodes'] == supp.doc['nodes'],
              'scenes_identical': candidate.doc['scenes'] == supp.doc['scenes'],
              'mesh_names_identical': [m['name'] for m in candidate.doc['meshes']] == [m['name'] for m in supp.doc['meshes']],
              'materials': candidate.doc.get('materials'), 'textures': candidate.doc.get('textures'),
              'images': candidate.doc.get('images'), 'extensions_used': candidate.doc.get('extensionsUsed'),
              'primitives_per_mesh': [len(m['primitives']) for m in candidate.doc['meshes']],
              'modules': {}, 'total_triangles': 0, 'supplement_total_triangles': 0}
    assert report['nodes_identical'] and report['scenes_identical'] and report['mesh_names_identical']
    assert not report['materials'] and not report['textures'] and not report['images'] and not report['extensions_used']
    assert report['primitives_per_mesh'] == [1, 1, 1]
    for node in supp.doc['nodes']:
        name = node['name']
        before, bt = supp.mesh(name)
        after, at = candidate.mesh(name)
        d_attrs, d_tris = donor.mesh(name)
        masks = after['COLOR_0'][:, 3]
        err = np.abs(masks[:, None] - MASKS).min(axis=1)
        amin, amax = after['POSITION'].min(axis=0), after['POSITION'].max(axis=0)
        dmin, dmax = d_attrs['POSITION'].min(axis=0), d_attrs['POSITION'].max(axis=0)
        rule = pillar_support if name != 'throne' else throne_support
        sup_before = subset(before, bt, rule(before, bt))
        n_sup = len(sup_before[1])
        support_identical = (np.array_equal(after['POSITION'][:len(sup_before[0]['POSITION'])], sup_before[0]['POSITION']) and
                             np.array_equal(after['NORMAL'][:len(sup_before[0]['POSITION'])], sup_before[0]['NORMAL']) and
                             np.array_equal(after['COLOR_0'][:len(sup_before[0]['POSITION'])], sup_before[0]['COLOR_0']) and
                             np.array_equal(at[:n_sup], sup_before[1]))
        stone = np.isclose(masks, 0, atol=.001)
        d_stone = np.isclose(d_attrs['COLOR_0'][:, 3], 0, atol=.01)
        detail = {'supplement_triangles': int(len(bt)), 'candidate_triangles': int(len(at)),
                  'candidate_vertices': int(len(after['POSITION'])),
                  'retained_support_triangles': int(n_sup), 'support_payload_identical': bool(support_identical),
                  'bounds_min': amin.tolist(), 'bounds_max': amax.tolist(),
                  'donor_bounds_min': dmin.tolist(), 'donor_bounds_max': dmax.tolist(),
                  'fits_donor_envelope': bool(np.all(amin >= dmin - .005) and np.all(amax <= dmax + .005)),
                  'mask_categories': sorted(set(MASKS[np.abs(masks[:, None] - MASKS).argmin(axis=1)].tolist())),
                  'mask_max_quantization_error': float(err.max()),
                  'stone_rgb_min': after['COLOR_0'][stone, :3].min(axis=0).tolist(),
                  'stone_rgb_max': after['COLOR_0'][stone, :3].max(axis=0).tolist(),
                  'donor_stone_rgb_min': d_attrs['COLOR_0'][d_stone, :3].min(axis=0).tolist(),
                  'donor_stone_rgb_max': d_attrs['COLOR_0'][d_stone, :3].max(axis=0).tolist(),
                  'glow_vertices': int(np.isclose(masks, 1, atol=.001).sum()),
                  'normals_unit': bool(np.allclose(np.linalg.norm(after['NORMAL'], axis=1), 1, atol=1e-3)),
                  'finite': bool(all(np.isfinite(after[k]).all() for k in after))}
        detail['stone_not_brighter_than_donor'] = bool(np.all(np.array(detail['stone_rgb_max']) <= np.array(detail['donor_stone_rgb_max']) + 1e-6))
        assert detail['fits_donor_envelope'], (name, amin, amax, dmin, dmax)
        assert detail['support_payload_identical'], name
        assert err.max() <= 1e-5, (name, err.max())   # retained support keeps the donor u16 quantization
        assert detail['stone_not_brighter_than_donor'], name
        assert detail['normals_unit'] and detail['finite'], name
        assert len(at) <= cfg['budgets'][name], (name, len(at))
        report['modules'][name] = detail
        report['total_triangles'] += len(at)
        report['supplement_total_triangles'] += len(bt)
    assert report['total_triangles'] <= cfg['budgets']['combined']
    return report


# ----------------------------------------------------------------------------- sheets
def as_object(name, attrs, tris):
    ob = meshutil.mesh_from_numpy(name, to_blender(attrs['POSITION']), tris=tris)
    meshutil.add_color_attr(ob, 'Col', np.asarray(attrs['COLOR_0'], np.float32))
    ob.data.normals_split_custom_set_from_vertices(to_blender(attrs['NORMAL']).tolist())
    return ob


def draw_preview(replacements, out, cfg, selection):
    meshutil.clear_scene()
    pv = cfg['preview']
    res = tuple(pv['resolution'])
    ppm = pv['game_px_per_m']
    for name in ('pillar', 'pillar_lo', 'throne'):
        if selection not in ('all', name.split('_')[0]):
            continue
        attrs, tris = replacements[name]
        ob = as_object(name, attrs, tris)
        points = meshutil.get_verts(ob)
        lo, hi = points.min(axis=0), points.max(axis=0)
        center, size = (lo + hi) / 2, float((hi - lo).max())
        views = [dict(target=center, dist=size * 2, yaw=yaw, pitch=pv['pitch'], ortho=size * 1.13) for yaw in pv['yaw']]
        for channel in ('SINGLE', 'VERTEX'):
            preview.setup_workbench(channel)
            preview.render_views(str(out / f'{name}_{channel.lower()}.png'), views, res=res)
        # game-scale tiles: the belt camera's ~72 px/m at 1600x900, front / 35 deg, plus a 2x detail crop
        if name.startswith('pillar'):
            target, pitch = (0, 0, 3.4), 5
        else:
            target, pitch = (0, 0, 2.3), 5
        game = [dict(target=target, dist=20, yaw=yaw, pitch=pitch, ortho=res[1] / ppm) for yaw in (0, 35)]
        game += [dict(target=(target[0], target[1], target[2] + (1.2 if name.startswith('pillar') else .6)),
                      dist=20, yaw=0, pitch=pitch, ortho=res[1] / ppm * .5)]
        for channel in ('SINGLE', 'VERTEX'):
            preview.setup_workbench(channel)
            preview.render_views(str(out / f'{name}_game_{channel.lower()}.png'), game, res=res)
        bpy.data.objects.remove(ob, do_unlink=True)


# ----------------------------------------------------------------------------- main
def main():
    args = parse_args()
    cfg = configure(args.config)
    args.out.mkdir(parents=True, exist_ok=True)
    supp, donor = Glb(args.base_glb), Glb(args.donor_glb)
    assert digest(args.base_glb) == cfg['supplement_sha256'], 'unexpected supplement hash'
    assert digest(args.donor_glb) == cfg['donor_sha256'], 'unexpected donor hash'
    target = args.out / 'env_stage5_forms_r32.glb'
    if args.release and target.exists():
        raise RuntimeError('release already exists; refusing another release export')
    mode = 'release' if args.release else 'preview' if args.preview else 'fast'
    h, h_lo = cfg['voxel'][mode], cfg['voxel_lo'][mode]
    t0 = time.monotonic()
    meshutil.clear_scene()
    want = {'pillar', 'throne'} if not args.preview or args.preview == 'all' else {args.preview}
    reports, replacements = {}, {}
    if 'pillar' in want:
        high, low, reports['pillar'] = build_pillar(cfg, supp, donor, h, h_lo)
        replacements['pillar'], replacements['pillar_lo'] = high, low
        log('stage pillar + pillar_lo done')
    else:
        replacements['pillar'], replacements['pillar_lo'] = supp.mesh('pillar'), supp.mesh('pillar_lo')
    if 'throne' in want:
        replacements['throne'], reports['throne'] = build_throne(cfg, supp, donor, h)
        log('stage throne done')
    else:
        replacements['throne'] = supp.mesh('throne')
    for name, (_, tris) in replacements.items():
        assert len(tris) <= cfg['budgets'][name], (name, len(tris))
    sha, nbytes = write_forms_glb(supp.doc, replacements, target)
    candidate = Glb(target)
    audit = preservation_audit(supp, donor, candidate, replacements, cfg)
    audit['partial_preview'] = sorted({'pillar', 'throne'} - want)
    for node in supp.doc['nodes']:
        candidate.isolate(node['name'], args.out / 'modules' / (node['name'] + '.glb'))
    (args.out / 'preservation-audit.json').write_text(json.dumps(audit, indent=2) + '\n')
    report = {'mode': mode, 'config': cfg, 'candidate': str(target), 'candidate_sha256': sha, 'candidate_bytes': nbytes,
              'supplement': str(args.base_glb.resolve()), 'donor_palette': str(args.donor_glb.resolve()),
              'parts': reports, 'triangles': {n: int(len(t)) for n, (_, t) in replacements.items()},
              'total_triangles': audit['total_triangles'], 'seconds': round(time.monotonic() - t0, 1)}
    (args.out / 'build-report.json').write_text(json.dumps(report, indent=2) + '\n')
    log(f'stage export done: {audit["total_triangles"]} tris, {nbytes} bytes, SHA256 {sha}')
    if args.preview or args.release:
        draw_preview(replacements, args.out, cfg, args.preview or 'all')
        log('stage sheets done')
    log(f'{mode} complete in {time.monotonic() - t0:.1f}s: {target}')


if __name__ == '__main__':
    main()
