"""Stage5 r32 PART EDIT. Run only via tools/blender-run.mjs; writes scratch only.

Donor payloads are copied, never re-exported. Only pillar/pillar_lo/throne may
change. Coordinates at the GLB boundary are Y-up; sculpting is Blender Z-up.
No import of build_env_stage5_kit.py (its unguarded main would overwrite public).
"""
import argparse
import copy
import json
import math
import sys
import time
from pathlib import Path

CONFIG = {
    'seed': 3205,
    'donor_sha256': '9744a71bf38fc9ff85b34442ee71a33c9f1dc91dd200b7a07c599623ef9d944b',
    'budgets': {'pillar': 18000, 'pillar_lo': 7000, 'throne': 20000, 'kit': 180000},
    'targets': {'pillar_form': 11900, 'pillar_lo_form': 4650, 'throne_form': 14000},
    'voxel': {'preview': .040, 'fast': .034, 'release': .026},
    'pillar': {'samples': 106, 'turns': 2.35, 'end_angle': -math.pi * .5 + .12,
               'tail_radius': .18, 'coil_radius': .465, 'path_radius': 1.005,
               'bottom': .98, 'rise': 2.77, 'wear_depth': .004, 'wear_frequency': 3.2,
               'hood_width': 1.035, 'hood_ribs': 3,
               'face_center': (0, -2.10, 4.91), 'face_scale': 1.30,
               'band_root_radius': .80},
    'throne': {'hood_width': 1.40, 'hood_height': .84, 'relief_width': .48,
               'face_center': (0, .83, 3.60), 'face_scale': 1.20},
    'preview': {'resolution': (520, 620), 'yaw': (0, 35, 90), 'pitch': 8},
}

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'blender'))

import bpy
import bmesh
import numpy as np
from mathutils.kdtree import KDTree
from lib import meshutil, pipeline, preview
from env_stage5_r32_forms import (Glb, digest, subset, concatenate, connected_face_groups,
                                  pillar_sculpt, throne_sculpt)


def log(message):
    print('[stage5-r32] ' + message, flush=True)


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__)
    modes = ap.add_mutually_exclusive_group()
    modes.add_argument('--preview', choices=('all', 'pillar', 'throne'), help='geometry + clay/vertex sheets')
    modes.add_argument('--fast', action='store_true', help='coarser geometry; no release')
    modes.add_argument('--release', action='store_true', help='one final export')
    ap.add_argument('--out', type=Path, required=True, help='scratch directory (public is refused)')
    ap.add_argument('--base-glb', type=Path, default=ROOT / 'progress/tmp/env-r32-stage5-kit/baseline/env_stage5_kit.glb')
    ap.add_argument('--config', type=Path, help='JSON overrides for CONFIG')
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = ap.parse_args(argv)
    args.out = args.out.resolve()
    allowed = (ROOT / 'progress/tmp/env-r32-stage5-kit').resolve()
    if not args.out.is_relative_to(allowed):
        ap.error('--out must be inside progress/tmp/env-r32-stage5-kit')
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


def to_blender(points):
    return np.asarray(points)[:, [0, 2, 1]] * (1, -1, 1)


def to_gltf(points):
    return np.asarray(points)[:, [0, 2, 1]] * (1, 1, -1)


def as_object(name, attrs, tris):
    ob = meshutil.mesh_from_numpy(name, to_blender(attrs['POSITION']), tris=tris)
    meshutil.add_color_attr(ob, 'Col', np.asarray(attrs['COLOR_0'], np.float32))
    ob.data.normals_split_custom_set_from_vertices(to_blender(attrs['NORMAL']).tolist())
    return ob


def geometry_arrays(ob):
    me = ob.data
    me.calc_loop_triangles()
    P = np.empty((len(me.vertices), 3), np.float32)
    me.vertices.foreach_get('co', P.ravel())
    N = pipeline.vertex_normals(ob)
    T = np.array([t.vertices[:] for t in me.loop_triangles], np.int32)
    C = np.empty((len(me.vertices), 4), np.float32)
    me.color_attributes['Col'].data.foreach_get('color', C.ravel())
    return {'POSITION': to_gltf(P), 'NORMAL': to_gltf(N), 'COLOR_0': C}, T


def clean_form(ob):
    """Discard polygonizer internal bubbles; retain exactly one rooted carved surface."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bm.verts.ensure_lookup_table()
    pending, islands = set(bm.verts), []
    while pending:
        first = pending.pop()
        group, stack = {first}, [first]
        while stack:
            v = stack.pop()
            for edge in v.link_edges:
                other = edge.other_vert(v)
                if other in pending:
                    pending.remove(other)
                    group.add(other)
                    stack.append(other)
        islands.append(group)
    islands.sort(key=len, reverse=True)
    removed = sum(len(g) for g in islands[1:])
    if removed:
        bmesh.ops.delete(bm, geom=[v for g in islands[1:] for v in g], context='VERTS')
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return {'islands_before': len(islands), 'removed_internal_vertices': removed}


def paint_from_donor(ob, donor_attrs, donor_faces, cfg, part):
    """Convex interpolation of existing stone RGB, never an albedo lift.

    The alpha channel remains the kit's five categorical material masks, not
    transparency. Tiny eye patches are painted on attached cheek geometry.
    """
    source = np.unique(donor_faces)
    source = source[np.isclose(donor_attrs['COLOR_0'][source, 3], 0, atol=.01)]
    donor_P = to_blender(donor_attrs['POSITION'][source])
    donor_C = donor_attrs['COLOR_0'][source]
    kd = KDTree(len(source))
    for i, p in enumerate(donor_P):
        kd.insert(p, i)
    kd.balance()
    P = meshutil.get_verts(ob)
    C = np.zeros((len(P), 4), np.float32)
    for i, p in enumerate(P):
        hits = kd.find_n(p, 4)
        weights = np.array([1 / max(h[2], .025) ** 2 for h in hits])
        C[i, :3] = np.average(donor_C[[h[1] for h in hits], :3], axis=0, weights=weights)
    # Donor eye colour is inherited, with a smaller attached footprint.
    eyes = donor_attrs['COLOR_0'][donor_attrs['COLOR_0'][:, 3] > .98, :3]
    head = cfg[part]
    eye_P = (P - head['face_center']) / head['face_scale']
    eye_mask = ((np.abs(np.abs(eye_P[:, 0]) - .235) < .045) &
                (np.abs(eye_P[:, 1] + .18) < .05) &
                (np.abs(eye_P[:, 2] - .065) < .025))
    if len(eyes):
        C[eye_mask, :3] = np.median(eyes, axis=0)
        C[eye_mask, 3] = 1.0
    meshutil.add_color_attr(ob, 'Col', C)
    for a in list(ob.data.attributes):
        if a.name.startswith('p_') or a.name == 'mat_id':
            ob.data.attributes.remove(a)
    for f in ob.data.polygons:
        f.use_smooth = True
    return {'donor_stone_rgb_min': donor_C[:, :3].min(axis=0).tolist(),
            'donor_stone_rgb_max': donor_C[:, :3].max(axis=0).tolist(),
            'new_stone_rgb_min': C[~eye_mask, :3].min(axis=0).tolist(),
            'new_stone_rgb_max': C[~eye_mask, :3].max(axis=0).tolist(),
            'eye_vertices': int(eye_mask.sum())}


def make_form(name, sculpt, target, h, donor_attrs, donor_faces, cfg):
    t0 = time.monotonic()
    ob = pipeline.sculpt_mesh(sculpt, name + '_form', h, attrs=False, face_mats=False)
    hygiene = clean_form(ob)
    meshutil.decimate(ob, target, symmetry=False)
    meshutil.triangulate(ob)
    hygiene['after_decimation'] = clean_form(ob)
    paint = paint_from_donor(ob, donor_attrs, donor_faces, cfg, name)
    log(f'{name} form {meshutil.tri_count(ob)} tris in {time.monotonic() - t0:.1f}s')
    return ob, {'cleanup': hygiene, 'paint': paint}


def build_pillar(cfg, donor, h):
    attrs, tris = donor.mesh('pillar')
    P, C = attrs['POSITION'], attrs['COLOR_0']
    # Keep support faces by material + world height, never by fragile vertex indices.
    support_faces = (np.all(np.isclose(C[tris, 3], .25, atol=.01) |
                            np.isclose(C[tris, 3], .75, atol=.01), axis=1) |
                     np.all(P[tris, 1] < .805, axis=1) |
                     np.all(P[tris, 1] > 10.39, axis=1))
    support, support_T = subset(attrs, tris, support_faces)
    SP, SC = support['POSITION'], support['COLOR_0']
    rad = np.linalg.norm(SP[:, [0, 2]], axis=1)
    roots = (np.isclose(SC[:, 3], .25, atol=.01) & (SP[:, 1] > 5) &
             (rad < .875))
    # Repair donor rings floating above a tapering shaft: bury only inner lips.
    SP[roots, 0] *= cfg['pillar']['band_root_radius'] / rad[roots]
    SP[roots, 2] *= cfg['pillar']['band_root_radius'] / rad[roots]
    # Recompute normals only on the edited lips' triangles, retaining support normals elsewhere.
    edited_faces = np.any(roots[support_T], axis=1)
    if edited_faces.any():
        normals = np.cross(SP[support_T[:, 1]] - SP[support_T[:, 0]],
                           SP[support_T[:, 2]] - SP[support_T[:, 0]])
        normals /= np.maximum(np.linalg.norm(normals, axis=1)[:, None], 1e-12)
        for t, n in zip(support_T[edited_faces], normals[edited_faces]):
            support['NORMAL'][t] = n
    snake, detail = make_form('pillar', pillar_sculpt(cfg), cfg['targets']['pillar_form'],
                              h, attrs, tris[~support_faces], cfg)
    high = concatenate([(support, support_T), geometry_arrays(snake)])
    lo_snake = meshutil.duplicate(snake, 'pillar_lo_form')
    meshutil.decimate(lo_snake, cfg['targets']['pillar_lo_form'], symmetry=False)
    meshutil.triangulate(lo_snake)
    detail['low_cleanup'] = clean_form(lo_snake)
    # Repaint after LOD collapse: categorical alpha must never interpolate into unrelated materials.
    paint_from_donor(lo_snake, attrs, tris[~support_faces], cfg, 'pillar')
    low = concatenate([(support, support_T), geometry_arrays(lo_snake)])
    for ob in (snake, lo_snake):
        bpy.data.objects.remove(ob, do_unlink=True)
    detail.update(retained_support_triangles=len(support_T), repaired_band_root_vertices=int(roots.sum()))
    detail['support_colour_values_preserved'] = True
    return high, low, detail


def build_throne(cfg, donor, h):
    attrs, tris = donor.mesh('throne')
    # The donor sculpture is basalt above the seat; dais, cushion and bronze stay exact.
    P, C = attrs['POSITION'], attrs['COLOR_0']
    # The seat block uses basalt too. Select complete closed seat geometry by its semantic AABB.
    seat = np.zeros(len(tris), bool)
    for faces in connected_face_groups(attrs, tris):
        verts = P[np.unique(tris[faces])]
        lo, hi = verts.min(axis=0), verts.max(axis=0)
        if (np.allclose(lo, (-1.25, .9, -1.3), atol=.0001) and
                np.allclose(hi, (1.25, 1.5, .2), atol=.0001)):
            seat[faces] = True
    assert seat.sum() == 44, 'seat block selection must retain the complete donor box'
    # All dais faces are obsidian/metal/matte; snake feet are stone and must be replaced.
    support_faces = (np.all(np.isclose(C[tris, 3], .25, atol=.01) |
                            np.isclose(C[tris, 3], .5, atol=.01) |
                            np.isclose(C[tris, 3], .75, atol=.01), axis=1) | seat)
    support = subset(attrs, tris, support_faces)
    back, detail = make_form('throne', throne_sculpt(cfg), cfg['targets']['throne_form'],
                             h, attrs, tris[~support_faces], cfg)
    result = concatenate([support, geometry_arrays(back)])
    bpy.data.objects.remove(back, do_unlink=True)
    detail['retained_dais_seat_triangles'] = len(support[1])
    # Corner arrays are identical; reindexing retained vertices is harmless.
    for semantic in ('POSITION', 'NORMAL', 'COLOR_0'):
        assert np.array_equal(support[0][semantic][support[1]], attrs[semantic][tris[support_faces]])
    detail['dais_seat_all_triangle_corners_identical'] = True
    detail['seat_anchor_gltf'] = [0, 1.65, .2]
    return result, detail


def draw_preview(replacements, out, cfg, selection):
    meshutil.clear_scene()
    for name in ('pillar', 'throne'):
        if selection not in ('all', name):
            continue
        attrs, tris = replacements[name]
        ob = as_object(name, attrs, tris)
        points = meshutil.get_verts(ob)
        lo, hi = points.min(axis=0), points.max(axis=0)
        center, size = (lo + hi) / 2, float((hi - lo).max())
        views = [dict(target=center, dist=size * 2, yaw=yaw,
                      pitch=cfg['preview']['pitch'], ortho=size * 1.13)
                 for yaw in cfg['preview']['yaw']]
        for channel in ('SINGLE', 'VERTEX'):
            preview.setup_workbench(channel)
            preview.render_views(str(out / f'{name}_{channel.lower()}.png'), views,
                                 res=tuple(cfg['preview']['resolution']))
        # Dedicated belt-visible sculpture crop as the full pillar's upper shaft dominates sheets.
        if name == 'pillar':
            views = [dict(target=(0, -.65, 3.0), dist=12, yaw=yaw, pitch=7, ortho=5.9)
                     for yaw in (0, 35, 90)]
            preview.setup_workbench('SINGLE')
            preview.render_views(str(out / 'pillar_coil_detail.png'), views,
                                 res=tuple(cfg['preview']['resolution']))
        bpy.data.objects.remove(ob, do_unlink=True)


def preservation_audit(donor, candidate, replacements):
    report = {'donor_sha256': digest(donor.path), 'candidate_sha256': digest(candidate.path),
              'donor_binary_prefix_identical': candidate.binary[:len(donor.binary)] == donor.binary,
              'nodes_identical': candidate.doc['nodes'] == donor.doc['nodes'],
              'materials_identical': candidate.doc.get('materials') == donor.doc.get('materials'),
              'modules': {}, 'total_triangles': 0, 'donor_total_triangles': 0}
    for node in donor.doc['nodes']:
        name = node['name']
        before, bt = donor.mesh(name)
        after, at = candidate.mesh(name)
        unchanged = name not in replacements
        fields = {k: bool(np.array_equal(before[k], after.get(k))) for k in before}
        masks = after['COLOR_0'][:, 3]
        allowed = np.array([0, .25, .5, .75, 1])
        mask_error = np.abs(masks[:, None] - allowed).min(axis=1)
        detail = {'changed': not unchanged, 'donor_triangles': len(bt), 'candidate_triangles': len(at),
                  'attributes_identical': fields, 'indices_identical': bool(np.array_equal(bt, at)),
                  'primitive_count': len(candidate.doc['meshes'][node['mesh']]['primitives']),
                  'bounds_min': after['POSITION'].min(axis=0).tolist(),
                  'bounds_max': after['POSITION'].max(axis=0).tolist(),
                  'mask_categories': sorted(set(allowed[np.abs(masks[:, None] - allowed).argmin(axis=1)].tolist())),
                  'mask_max_quantization_error': float(mask_error.max())}
        if not unchanged:
            dmin, dmax = before['POSITION'].min(axis=0), before['POSITION'].max(axis=0)
            amin, amax = after['POSITION'].min(axis=0), after['POSITION'].max(axis=0)
            detail['fits_donor_envelope'] = bool(np.all(amin >= dmin - .005) and
                                                np.all(amax <= dmax + .005))
            assert detail['fits_donor_envelope'], (name, amin, amax, dmin, dmax)
        if unchanged:
            assert all(fields.values()) and detail['indices_identical'], name
            assert candidate.doc['meshes'][node['mesh']] == donor.doc['meshes'][node['mesh']]
            detail['max_position_delta_m'] = 0.0
            detail['surviving_triangles_match'] = len(bt)
        assert mask_error.max() <= .003, (name, mask_error.max())
        report['modules'][name] = detail
        report['total_triangles'] += len(at)
        report['donor_total_triangles'] += len(bt)
    assert report['nodes_identical'] and report['materials_identical'] and report['donor_binary_prefix_identical']
    return report


def main():
    args = parse_args()
    cfg = configure(args.config)
    args.out.mkdir(parents=True, exist_ok=True)
    donor = Glb(args.base_glb)
    assert digest(args.base_glb) == cfg['donor_sha256'], 'unexpected donor hash'
    target = args.out / 'env_stage5_kit.glb'
    if args.release and target.exists():
        raise RuntimeError('release already exists; refusing another release export')
    mode = 'release' if args.release else 'preview' if args.preview else 'fast'
    t0 = time.monotonic()
    meshutil.clear_scene()
    high, low, pillar_report = build_pillar(cfg, donor, cfg['voxel'][mode])
    log('stage pillar + pillar_lo done')
    throne, throne_report = build_throne(cfg, donor, cfg['voxel'][mode])
    replacements = {'pillar': high, 'pillar_lo': low, 'throne': throne}
    for name, (_, tris) in replacements.items():
        assert len(tris) <= cfg['budgets'][name], (name, len(tris))
    donor.replace(replacements, target)
    candidate = Glb(target)
    audit = preservation_audit(donor, candidate, replacements)
    assert audit['total_triangles'] <= cfg['budgets']['kit']
    for node in donor.doc['nodes']:
        candidate.isolate(node['name'], args.out / 'modules' / (node['name'] + '.glb'))
    (args.out / 'preservation-audit.json').write_text(json.dumps(audit, indent=2) + '\n')
    report = {'mode': mode, 'config': cfg, 'candidate': str(target), 'donor': str(args.base_glb.resolve()),
              'parts': {'pillar': pillar_report, 'throne': throne_report},
              'total_triangles': audit['total_triangles'], 'seconds': round(time.monotonic() - t0, 2)}
    (args.out / 'build-report.json').write_text(json.dumps(report, indent=2) + '\n')
    log(f'stage export done: {audit["total_triangles"]} tris, SHA256 {audit["candidate_sha256"]}')
    if args.preview:
        draw_preview(replacements, args.out, cfg, args.preview)
    log(f'{mode} complete in {time.monotonic() - t0:.1f}s: {target}')


if __name__ == '__main__':
    main()
