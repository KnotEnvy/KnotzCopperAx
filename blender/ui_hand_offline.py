"""Slot-free build of the select-screen skeletal hand (ui-flow r8): the SAME SDF as blender/build_ui_skeletal_hand.py (its build() is
imported with a stubbed bpy), meshed with OpenVDB (importable in Blender's bundled python without bpy), shaded entirely in numpy from
the distance field (ambient occlusion from SDF cone samples, cavity/ridge curvature from the SDF Laplacian, joint-gap grime), and
written as a GLB with COLOR_0 - so it needs no Blender process (and so no Blender slot, which the enemy-art release builds hold for
an hour).

    <bundled python> blender/ui_hand_offline.py [out.glb] [h=0.0125]
"""
import os
import sys
import json
import math
import struct
import time
import types
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
bpy = types.ModuleType("bpy")
bpy.data = types.SimpleNamespace(materials=None, objects=None, images=None)
bpy.context = types.SimpleNamespace()
class _Any:
    def __getattr__(self, k): return object
bpy.types = _Any(); bpy.props = _Any(); bpy.ops = _Any()
sys.modules["bpy"] = bpy; sys.modules["bmesh"] = types.ModuleType("bmesh")
mu = types.ModuleType("mathutils")
for _n in ("Vector", "Matrix", "Quaternion", "Euler", "Color"):
    setattr(mu, _n, type(_n, (), {}))
sys.modules["mathutils"] = mu
import numpy as np
spec = importlib.util.spec_from_file_location("hand", os.path.join(HERE, "build_ui_skeletal_hand.py"))
HM = importlib.util.module_from_spec(spec); spec.loader.exec_module(HM)
from lib import sdf

OUT = next((a for a in sys.argv[1:] if not a.startswith("h=")), os.path.join(ROOT, "public", "assets", "models", "ui_skeletal_hand.glb"))
HH = float(next((a[2:] for a in sys.argv[1:] if a.startswith("h=")), "0.0125"))


def srgb2lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def main():
    t0 = time.time()
    S = HM.build()
    v, q, t = sdf.polygonize(S, HH, log=lambda m: print(m))
    tris = np.concatenate([np.stack([q[:, 0], q[:, 1], q[:, 2]], 1), np.stack([q[:, 0], q[:, 2], q[:, 3]], 1), t], 0) if len(t) else \
        np.concatenate([np.stack([q[:, 0], q[:, 1], q[:, 2]], 1), np.stack([q[:, 0], q[:, 2], q[:, 3]], 1)], 0)
    P = v.astype(np.float64)
    # --- refine: two projection steps onto the zero level set (removes the voxel stair-step), then SDF-gradient normals
    def grad(p, e=0.003):
        g = np.stack([S.dist(p + np.array([e, 0, 0])) - S.dist(p - np.array([e, 0, 0])),
                      S.dist(p + np.array([0, e, 0])) - S.dist(p - np.array([0, e, 0])),
                      S.dist(p + np.array([0, 0, e])) - S.dist(p - np.array([0, 0, e]))], -1)
        return g / (np.linalg.norm(g, axis=1, keepdims=True) + 1e-12)
    for _ in range(2):
        d0 = S.dist(P); n0 = grad(P)
        P = P - n0 * np.clip(d0, -HH, HH)[:, None] * 0.9
    N = grad(P)
    print("refined", time.time() - t0)
    # --- ambient occlusion from the SDF (cone samples along the normal)
    ao_occ = np.zeros(len(P)); wsum = 0.0
    for h_, w_ in ((0.012, 1.0), (0.03, 0.85), (0.055, 0.65), (0.09, 0.5), (0.14, 0.35)):
        d = S.dist(P + N * h_)
        ao_occ += w_ * np.clip(h_ - d, 0.0, None) / h_
        wsum += w_
    ao = np.clip(1.0 - 1.15 * ao_occ / wsum, 0.0, 1.0)
    ao = ao * ao * (3 - 2 * ao)
    # --- curvature from the SDF Laplacian at two scales (convex > 0)
    def lap(e):
        d0 = S.dist(P)
        s = 0.0
        for ax in np.eye(3):
            s = s + S.dist(P + ax * e) + S.dist(P - ax * e)
        return (s - 6 * d0) / (e * e)
    c_small = np.tanh(lap(0.022) / 30.0); c_big = np.tanh(lap(0.05) / 20.0)
    print("shaded", time.time() - t0)
    # --- colour (same recipe as build_ui_skeletal_hand.colorize, mesh curvature -> SDF curvature)
    stain = sdf.fbm(P[:, 0], P[:, 1], P[:, 2], 4, 3.5, seed=11)
    jd = np.ones(len(P))
    for c, r in HM.JOINTS:
        qd = np.linalg.norm(P - c[None, :], axis=1) / r
        jd = np.minimum(jd, np.clip(qd, 0.0, 1.0))
    jg = jd * jd * (3 - 2 * jd)
    tt = np.clip(0.40 + 0.34 * c_small + 0.16 * c_big + 0.07 * (stain - 0.5) + 0.12 * jg, 0.0, 1.0)
    fore = np.clip((-P[:, 1] - 0.95) / 0.9, 0.0, 1.0)
    tt = tt * (0.40 + 0.60 * ao) - 0.28 * fore
    tt = np.clip(tt, 0.0, 1.0)[:, None]
    dark = np.array([0.12, 0.085, 0.05]); mid = np.array([0.56, 0.50, 0.40]); hi = np.array([0.82, 0.76, 0.62])
    col = np.where(tt < 0.5, dark + (mid - dark) * (tt / 0.5), mid + (hi - mid) * ((tt - 0.5) / 0.5))
    col = srgb2lin(np.clip(col, 0, 1)).astype(np.float32)
    # --- glTF frame: Blender (x, y, z) -> glTF (x, z, -y)
    G = np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1).astype(np.float32)
    GN = np.stack([N[:, 0], N[:, 2], -N[:, 1]], 1).astype(np.float32)
    idx = tris.astype(np.uint32)
    write_glb(OUT, G, GN, col, idx)
    print(f"[hand] {len(idx)} tris {len(G)} verts -> {OUT} ({os.path.getsize(OUT)/1e6:.2f} MB) in {time.time()-t0:.0f}s")


def write_glb(path, G, GN, C, idx):
    def pad(b, ch=b"\0"):
        return b + ch * ((-len(b)) % 4)
    pos, nrm, col, ind = G.tobytes(), GN.tobytes(), C.tobytes(), idx.tobytes()
    binb = pad(pos) + pad(nrm) + pad(col) + pad(ind)
    o1, o2, o3 = len(pad(pos)), len(pad(pos)) + len(pad(nrm)), len(pad(pos)) + len(pad(nrm)) + len(pad(col))
    js = {
        "asset": {"version": "2.0", "generator": "ui_hand_offline.py"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "ui_skeletal_hand"}],
        "meshes": [{"name": "ui_skeletal_hand", "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2}, "indices": 3, "material": 0}]}],
        "materials": [{"name": "bone", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.0, "roughnessFactor": 0.62}}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(G), "type": "VEC3", "min": G.min(0).tolist(), "max": G.max(0).tolist()},
            {"bufferView": 1, "componentType": 5126, "count": len(G), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": len(G), "type": "VEC3"},
            {"bufferView": 3, "componentType": 5125, "count": int(idx.size), "type": "SCALAR"}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
            {"buffer": 0, "byteOffset": o1, "byteLength": len(nrm), "target": 34962},
            {"buffer": 0, "byteOffset": o2, "byteLength": len(col), "target": 34962},
            {"buffer": 0, "byteOffset": o3, "byteLength": len(ind), "target": 34963}],
        "buffers": [{"byteLength": len(binb)}],
    }
    jb = pad(json.dumps(js, separators=(",", ":")).encode(), b" ")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(jb) + 8 + len(binb)))
        f.write(struct.pack("<I4s", len(jb), b"JSON")); f.write(jb)
        f.write(struct.pack("<I4s", len(binb), b"BIN\0")); f.write(binb)


if __name__ == "__main__":
    main()
