"""Tiny numpy z-buffer rasterizer for quick mesh previews without Blender.
render(co, tris, view) -> HxWx3 uint8. view: dict(yaw deg, pitch deg, target, ortho half-height metres, res (W,H), colors per face (optional))"""
import numpy as np, math
from PIL import Image

def tris_from_loops(ls, lt, lv):
    T = []
    for k in range(1, int(lt.max()) - 1):
        m = lt > k + 1
        T.append(np.stack([lv[ls[m]], lv[ls[m] + k], lv[ls[m] + k + 1]], 1))
    F = []
    for k in range(1, int(lt.max()) - 1):
        m = lt > k + 1
        F.append(np.nonzero(m)[0])
    return np.concatenate(T), np.concatenate(F)

def render(co, tris, yaw=0.0, pitch=0.0, target=(0, 0, 0), ortho=0.15, res=(600, 700), fcol=None, light=(0.3, -0.6, 0.75), bg=(30, 30, 34)):
    W, H = res
    y, p = math.radians(yaw), math.radians(pitch)
    # camera looks along +Y (at the face which faces -Y) rotated by yaw about Z, pitch about X
    Rz = np.array([[math.cos(y), -math.sin(y), 0], [math.sin(y), math.cos(y), 0], [0, 0, 1]])
    Rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    R = Rx @ Rz
    P = (co - np.asarray(target)) @ R.T          # cam space: x right, z up, y depth (toward +y = away)
    sx = (P[:, 0] / (ortho * W / H) * 0.5 + 0.5) * W
    sy = (1 - (P[:, 2] / ortho * 0.5 + 0.5)) * H
    depth = P[:, 1]
    img = np.zeros((H, W, 3), np.float32); img[:] = np.array(bg) / 255
    zb = np.full((H, W), np.inf)
    A, B, C = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    N = np.cross(B - A, C - A); N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    L = np.asarray(light, float); L = R @ (L / np.linalg.norm(L))
    Nc = N @ R.T
    shade = np.clip(Nc @ L, 0, 1) * 0.75 + 0.25
    base = np.full((len(tris), 3), 0.78) if fcol is None else fcol
    col = base * shade[:, None]
    # painter-free: per-triangle bbox scan (vectorized per tri, python loop) -- only for ~<200k tris
    order = np.argsort(-depth[tris].mean(1))     # far to near
    xs = np.stack([sx[tris[:, 0]], sx[tris[:, 1]], sx[tris[:, 2]]], 1)
    ys = np.stack([sy[tris[:, 0]], sy[tris[:, 1]], sy[tris[:, 2]]], 1)
    zs = np.stack([depth[tris[:, 0]], depth[tris[:, 1]], depth[tris[:, 2]]], 1)
    front = Nc[:, 1] < 0
    for i in order:
        if not front[i]:
            continue
        x0, x1 = int(max(0, np.floor(xs[i].min()))), int(min(W - 1, np.ceil(xs[i].max())))
        y0, y1 = int(max(0, np.floor(ys[i].min()))), int(min(H - 1, np.ceil(ys[i].max())))
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, bx, cx), (ay, by, cy) = xs[i], ys[i]
        det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(det) < 1e-9:
            continue
        l1 = ((bx - gx) * (cy - gy) - (cx - gx) * (by - gy)) / det
        l2 = ((cx - gx) * (ay - gy) - (ax - gx) * (cy - gy)) / det
        l3 = 1 - l1 - l2
        inside = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
        if not inside.any():
            continue
        z = l1 * zs[i][0] + l2 * zs[i][1] + l3 * zs[i][2]
        sub = zb[y0:y1 + 1, x0:x1 + 1]
        m = inside & (z < sub)
        sub[m] = z[m]
        img[y0:y1 + 1, x0:x1 + 1][m] = col[i]
    return (np.clip(img, 0, 1) * 255).astype(np.uint8)

def save(path, *imgs):
    im = np.concatenate(imgs, axis=1)
    Image.fromarray(im).save(path)

def facecolors(ids):
    rng = np.random.RandomState(3)
    u = np.unique(ids)
    pal = {k: rng.uniform(0.3, 0.95, 3) for k in u}
    return np.array([pal[k] for k in ids])
