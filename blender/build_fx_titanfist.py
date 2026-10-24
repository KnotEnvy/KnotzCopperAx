"""Titan fist (Brann T4 'Mountain's Wrath') - a colossal stone fist + forearm, knuckles DOWN (it smashes the ground).

The r1 prop was merged boxes that read as a stone tower at gameplay distance. This one is an SDF sculpt with real
fist anatomy seen from the gameplay camera (the curled fingers face the viewer): 4 separate fingers with knuckle
bumps and 3 phalanges each (proximal = flat striking face at the bottom, middle = the front wall, distal tucked into
the palm), a thumb wrapped across the index + middle fingers, the heel of the hand, a tapered wrist + forearm with a
stone cuff, chipped/eroded stone surface (fbm displacement).

Blender coords: Z up the forearm, -Y toward the camera (glTF: +Y up, +Z toward camera), knuckles at z ~= 0,
1 unit = 1 m at instance scale 1 (the spell scales it ~3x). Geometry only (the game assigns its lit vein material and
box-projects UVs).  Run:  blender -b --factory-startup -P blender/build_fx_titanfist.py
Output: public/assets/models/fx_titan_fist.glb
"""
import os
import sys
import importlib

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy
from lib import sdf, meshutil, pipeline
for _m in (sdf, meshutil, pipeline):
    importlib.reload(_m)
from lib.sdf import V, Sculpt, Sphere, Ellipsoid, Capsule, RoundCone, Union, Displace

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "assets", "models", "fx_titan_fist.glb")


def build():
    meshutil.clear_scene()
    parts = []
    # back of the hand / palm mass
    parts.append(Ellipsoid(V(0.0, 0.08, 0.78), V(0.80, 0.50, 0.56)))
    parts.append(Ellipsoid(V(-0.1, 0.12, 0.45), V(0.72, 0.42, 0.34)))           # heel of the hand -> knuckle base
    # fingers: index (+X, thumb side) .. pinky
    fingers = [(0.54, 1.00, 0.158), (0.19, 1.06, 0.162), (-0.16, 1.00, 0.158), (-0.50, 0.84, 0.140)]
    for x, f, r in fingers:
        K = V(x, 0.16, 0.20)                            # knuckle (lowest point: the striking face)
        A = V(x, 0.16 - 0.52 * f, 0.17)                 # proximal phalanx runs forward along the bottom
        B = V(x * 1.02, 0.16 - 0.60 * f, 0.60 * f)      # middle phalanx climbs the front wall
        C = V(x * 0.95, -0.14, 0.74)                    # distal tucks back into the palm
        parts.append(Sphere(K + V(0, 0.02, -0.02), r * 1.28))   # knuckle bump
        parts.append(Capsule(K, A, r * 1.05))
        parts.append(Sphere(A, r * 1.12))                       # PIP joint
        parts.append(Capsule(A, B, r))
        parts.append(Sphere(B, r * 1.02))
        parts.append(Capsule(B, C, r * 0.92))
    # thumb: CMC on the index side -> MCP -> wrapped across the front of the index/middle middle phalanges
    parts.append(Ellipsoid(V(0.72, 0.02, 0.86), V(0.24, 0.30, 0.34)))
    parts.append(Capsule(V(0.74, -0.08, 0.84), V(0.66, -0.52, 0.64), 0.19))
    parts.append(Sphere(V(0.66, -0.52, 0.64), 0.2))
    parts.append(Capsule(V(0.66, -0.52, 0.64), V(0.16, -0.72, 0.46), 0.17))
    parts.append(Ellipsoid(V(0.14, -0.72, 0.46), V(0.17, 0.13, 0.15)))
    # wrist + forearm + stone cuff
    parts.append(RoundCone(V(0.0, 0.12, 1.05), V(0.0, 0.2, 2.1), 0.56, 0.52))
    parts.append(RoundCone(V(0.0, 0.2, 2.1), V(0.0, 0.34, 5.8), 0.6, 0.82))
    parts.append(RoundCone(V(0.0, 0.2, 2.15), V(0.0, 0.22, 2.55), 0.72, 0.74))       # cuff
    parts.append(RoundCone(V(0.0, 0.24, 3.4), V(0.0, 0.25, 3.62), 0.76, 0.77))       # second band
    body = Union(*parts, k=0.035)
    S = Sculpt(materials=("stone",), default_mat="stone")
    S.add(Displace(body, 0.028, 2.6, octaves=3, seed=7), 0.0, "stone")
    ob = pipeline.sculpt_mesh(S, "fx_titan_fist", 0.022, attrs=False)
    meshutil.decimate(ob, 9000, symmetry=False)
    meshutil.triangulate(ob)
    print("tris", meshutil.tri_count(ob))
    meshutil.select_only([ob], ob)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_materials="NONE", export_texcoords=False)
    print("WROTE", OUT)


build()
