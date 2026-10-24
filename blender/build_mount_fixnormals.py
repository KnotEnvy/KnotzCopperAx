"""Post-bake normal-map repair for the mount GLBs (system Python + Pillow + numpy; NOT a Blender script).

Why (r3): Cycles' selected-to-active NORMAL bake returns inverted tangent-space normals (z < 0) wherever the cage ray
hits the back of a HI surface (fine feathers lying flat inside the extrusion band). three.js then lights those texels
from behind -> sharp pale-blue "discs" on the Cluckhorn's cream flank (they survived albedo/metal/env/normalScale=0
tests because normalScale keeps mapN.z). This clamps every texel to a front-facing normal: z<0 -> flat, 0<=z<ZMIN
blended toward flat, then renormalised; the PNG in public/assets/textures is rewritten and the webp image embedded in
the GLB (EXT_texture_webp, image named <asset>_normal) is replaced in place (buffer views re-packed, 4-byte aligned).

Usage: python blender/build_mount_fixnormals.py mount_cluckhorn [mount_emberdrake ...]
"""
import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZMIN = 0.45


def fix_normal(arr):
    n = arr[..., :3].astype(np.float32) / 255.0 * 2.0 - 1.0
    z = n[..., 2]
    w = np.clip((ZMIN - z) / ZMIN, 0.0, 1.0)[..., None]          # 0 at z>=ZMIN, 1 at z<=0
    n = n * (1.0 - w) + np.array([0.0, 0.0, 1.0], np.float32) * w
    n[..., 2] = np.maximum(n[..., 2], 0.05)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-8
    bad = int((z < 0).sum())
    return np.clip((n + 1.0) * 0.5 * 255.0 + 0.5, 0, 255).astype(np.uint8), bad


def patch_glb(path, image_name, data):
    f = open(path, "rb").read()
    jl = struct.unpack("<I", f[12:16])[0]
    J = json.loads(f[20:20 + jl])
    bl = struct.unpack("<I", f[20 + jl:24 + jl])[0]
    B = f[28 + jl:28 + jl + bl]
    img = next(i for i in J["images"] if i.get("name") == image_name)
    target = img["bufferView"]
    views = J["bufferViews"]
    order = sorted(range(len(views)), key=lambda i: views[i].get("byteOffset", 0))
    out = bytearray()
    for i in order:
        v = views[i]
        chunk = data if i == target else B[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]
        while len(out) % 4:
            out += b"\0"
        v["byteOffset"] = len(out)
        v["byteLength"] = len(chunk)
        out += chunk
    while len(out) % 4:
        out += b"\0"
    J["buffers"][0]["byteLength"] = len(out)
    js = json.dumps(J, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, "wb") as fo:
        fo.write(struct.pack("<III", 0x46546C67, 2, total))
        fo.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        fo.write(struct.pack("<II", len(out), 0x004E4942) + bytes(out))
    return total


def run(asset):
    png = os.path.join(ROOT, "public", "assets", "textures", asset + "_normal.png")
    glb = os.path.join(ROOT, "public", "assets", "models", asset + ".glb")
    arr = np.asarray(Image.open(png).convert("RGB"))
    fixed, bad = fix_normal(arr)
    Image.fromarray(fixed).save(png, optimize=True)
    buf = io.BytesIO()
    Image.fromarray(fixed).save(buf, "WEBP", quality=92, method=6)
    total = patch_glb(glb, asset + "_normal", buf.getvalue())
    print(f"[fixnormals] {asset}: {bad} inverted texels repaired; glb {total / 1e6:.2f} MB")


if __name__ == "__main__":
    for a in sys.argv[1:] or ["mount_cluckhorn", "mount_emberdrake", "mount_cinderwyrm"]:
        run(a)
