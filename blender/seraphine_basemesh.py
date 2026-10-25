"""Seraphine's head from the CC0 Blender Human Base Meshes bundle (docs/ASSET_SOURCES.md).

Two modes:
  export (inside Blender, factory startup, appends MESH data only, never runs scripts from the .blend):
    node tools/blender-run.mjs -- -b --factory-startup -P blender/seraphine_basemesh.py -- export
      -> ~/kca-assets/human-base-meshes/export/GEO-body_female_realistic.npz (cage + Catmull-Clark level 2 + face sets)
  fit (standalone, numpy + scipy; the scratch venv ~/kca-assets/venv/bin/python):
    python blender/seraphine_basemesh.py fit <out_dir> [--sdf H_MM] [--preview] [--params k=v ...]
      -> <out_dir>/head_fit.npz (deformed surface + landmarks), head_sdf.npz (signed-distance grid, world frame)
The build (build_hero_seraphine.py) calls `fit` itself when blender/out/seraphine_head_sdf_<h>.npz is missing.

Fit: the realistic female body's head + neck is scaled into Seraphine's head frame (eye centres on the old SDF
head's eye line), then deformed toward docs/refs/c2/heroes/seraphine_head.png with smooth proportional moves
(bigger almond eyes, cheekbones, firm chin, tucked jaw angle, narrower alae, fuller lips, slim neck), and
converted to a signed-distance grid: nearest surface samples (cKDTree) in a narrow band with exact point-triangle
distances, sign from the interpolated vertex normal, inside/outside labels cleaned by connected components.
"""
import sys, os, json, math, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
EXPORT_DIR = os.path.expanduser("~/kca-assets/human-base-meshes/export")
SRC = os.path.join(EXPORT_DIR, "GEO-body_female_realistic.npz")
BUNDLE = os.path.expanduser("~/kca-assets/human-base-meshes/extract/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend")


def tris_from_loops(ls, lt, lv):
    T, F = [], []
    for k in range(1, int(lt.max()) - 1):
        m = lt > k + 1
        T.append(np.stack([lv[ls[m]], lv[ls[m] + k], lv[ls[m] + k + 1]], 1))
        F.append(np.nonzero(m)[0])
    return np.concatenate(T), np.concatenate(F)


def export_from_bundle():
    """Inside Blender: append the female realistic body mesh data (and nothing else) and export it."""
    import bpy
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    os.makedirs(EXPORT_DIR, exist_ok=True)
    name = "GEO-body_female_realistic"
    with bpy.data.libraries.load(BUNDLE, link=False) as (data_from, data_to):
        assert name in data_from.meshes, "bundle mesh not found"
        data_to.meshes = [name]
    me = bpy.data.meshes[name]
    ob = bpy.data.objects.new("tmp_" + name, me)
    bpy.context.scene.collection.objects.link(ob)
    md = ob.modifiers.new("sub", "SUBSURF"); md.levels = 2; md.render_levels = 2
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = ob.evaluated_get(dg).to_mesh()
    out = {}
    for tag, m in (("", me), ("sub_", me2)):
        co = np.empty(len(m.vertices) * 3); m.vertices.foreach_get("co", co)
        ls = np.empty(len(m.polygons), np.int32); lt = np.empty(len(m.polygons), np.int32)
        m.polygons.foreach_get("loop_start", ls); m.polygons.foreach_get("loop_total", lt)
        lv = np.empty(len(m.loops), np.int32); m.loops.foreach_get("vertex_index", lv)
        nrm = np.empty(len(m.vertices) * 3); m.vertices.foreach_get("normal", nrm)
        out.update({tag + "co": co.reshape(-1, 3), tag + "loop_start": ls, tag + "loop_total": lt, tag + "loop_vert": lv,
                    tag + "normal": nrm.reshape(-1, 3)})
        a = m.attributes.get(".sculpt_face_set")
        if a is not None:
            v = np.empty(len(a.data), np.int32); a.data.foreach_get("value", v)
            out[tag + "attr_FACE__sculpt_face_set"] = v
    np.savez_compressed(SRC, **out)
    print("exported", SRC, "cage", len(me.vertices), "sub", len(me2.vertices))

# ---------------------------------------------------------------- parameters (world frame: face -Y, z up, metres)
PARAMS = dict(
    scale=0.92,                 # base head 0.223 m chin-crown -> 0.205 m
    eye_target=(0.0304, -0.0451, 1.6472),   # where the (right, +x) eye centre lands (old SDF head eye position)
    eye_scale=1.20,             # lids/aperture grow about the eye centre (C2 r3: 1.24 -> 1.20, less "startled")
    eye_r_mul=1.0,              # eyeball radius vs the scaled base socket sphere
    canthus_lift=0.0020,        # outer corners up (almond)
    cheek_out=0.0050,           # zygomatic push (outward + forward)
    chin_fwd=0.0035, chin_down=0.0030,
    jaw_in=0.0040,              # gonial angle tucked in (taper; v3: narrower lower face; C2 r3: 4 mm, softer jaw)
    nose_w=0.93,                # alae narrower
    lip_lower_fwd=-0.0010, lip_upper_fwd=0.0007,
    lip_corner=0.0015, philtrum_soft=0.0007,
    neck_slim=0.90,             # neck xy about its axis below the jaw
    skull_w=1.0,
    brow_soft=0.0020,           # brow ridge pushed back (soft natural brows; C2 r3: 2 mm, board r9 "heavy brow")
    lid_drop=0.0028,            # C2 r3: upper lid margin lowered over the iris (board r9: exposed round irises)
    sulcus_fill=0.0018,         # r4: firmer chin transition / lighter lower vermilion
    nostril_soft=0.0012,       # soften the continuous alar rim while retaining the downward nostril cavities
    lip_close=0.0022,           # morphological closing radius (m) in a box round the mouth: the base mesh's deep
                                # lip slit baked as a black line (fast build #1); the slit is filled to ~1.6 mm
)


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def falloff(P, c, r, axes=(1, 1, 1)):
    d = np.linalg.norm((P - c) * np.asarray(axes), axis=1)
    return 1 - smooth(d / r)


def move(P, c, r, vec, axes=(1, 1, 1)):
    w = falloff(P, c, r, axes)
    return P + w[:, None] * np.asarray(vec)


def scale_about(P, c, r, f, axes=(1, 1, 1)):
    w = falloff(P, c, r, axes)
    f = np.asarray(f, float)
    return P + w[:, None] * ((P - c) * (f - 1))


def load_base():
    d = np.load(SRC)
    co, ls, lt, lv = d["sub_co"], d["sub_loop_start"], d["sub_loop_total"], d["sub_loop_vert"]
    T, F = tris_from_loops(ls, lt, lv)
    fs = d["sub_attr_FACE__sculpt_face_set"][F]
    C = co[T].mean(1)
    keep = (C[:, 2] > 1.335) & (np.abs(C[:, 0]) < 0.095)       # head + neck (the shoulders are dropped)
    T, fs = T[keep], fs[keep]
    used = np.unique(T)
    remap = -np.ones(len(co), np.int64); remap[used] = np.arange(len(used))
    return co[used].astype(float), remap[T], fs, d["sub_normal"][used]


def base_landmarks(co, T, fs):
    """Landmarks in BASE coordinates from the sculpt face sets (2/3 eyes, 4/5 ears, 7/8 mouth, 22 jaw)."""
    L = {}
    for side, s in (("R", 2), ("L", 3)):
        v = np.unique(T[fs == s])
        N = vert_normals(co, T)[v]
        P = co[v]
        Q = P[(N[:, 1] > 0.2) | (np.abs(N[:, 1]) < 0.25)]
        A = np.c_[2 * Q, np.ones(len(Q))]; b = (Q ** 2).sum(1)
        x, *_ = np.linalg.lstsq(A, b, rcond=None)
        c = x[:3]; r = math.sqrt(float(x[3] + (c ** 2).sum()))
        L["eye_" + side] = c; L["eye_r"] = r
        L["lid_rim_" + side] = P[np.abs(N[:, 1]) < 0.25]
    for side, s in (("R", 4), ("L", 5)):
        L["ear_" + side] = co[np.unique(T[fs == s])].mean(0)
    cl = co[np.abs(co[:, 0]) < 0.0025]
    L["nose_tip"] = cl[np.argmin(cl[:, 1])]
    front = cl[(cl[:, 2] > 1.44) & (cl[:, 2] < 1.50)]
    fr = cl[cl[:, 1] < -0.105]                                        # front of the face (not the neck)
    L["chin"] = fr[np.argmin(fr[:, 2])]                               # lowest front point = under the chin
    # lip line: the local y maximum (the crease) between the two lip bulges
    zs = np.arange(1.455, 1.495, 0.001)
    prof = np.array([front[np.abs(front[:, 2] - z) < 0.0015][:, 1].min() if (np.abs(front[:, 2] - z) < 0.0015).any() else np.nan for z in zs])
    ok = ~np.isnan(prof)
    j = np.argmax(np.where(ok & (zs > 1.462) & (zs < 1.49), prof, -1))
    L["lip_line"] = np.array([0.0, prof[j], zs[j]])
    L["crown"] = co[np.argmax(co[:, 2])]
    zl = L["lip_line"][2]
    half = 0.012
    for x in np.arange(0.012, 0.045, 0.001):
        col = co[(np.abs(co[:, 0] - x) < 0.0012) & (np.abs(co[:, 2] - zl) < 0.009) & (co[:, 1] < -0.09)]
        if len(col) < 6:
            break
        yl = col[np.abs(col[:, 2] - zl) < 0.0015][:, 1]
        ya = col[np.abs(col[:, 2] - zl - 0.004) < 0.0015][:, 1]
        yb = col[np.abs(col[:, 2] - zl + 0.004) < 0.0015][:, 1]
        if not (len(yl) and len(ya) and len(yb)):
            continue
        crease = yl.min() - min(ya.min(), yb.min())
        if crease < 0.0006:
            break
        half = x
    L["mouth_half_w"] = half
    return L


def vert_normals(co, T):
    N = np.cross(co[T[:, 1]] - co[T[:, 0]], co[T[:, 2]] - co[T[:, 0]])
    VN = np.zeros_like(co)
    for k in range(3):
        np.add.at(VN, T[:, k], N)
    VN /= np.maximum(np.linalg.norm(VN, axis=1, keepdims=True), 1e-12)
    return VN


def fit(params):
    p = dict(PARAMS); p.update(params)
    co, T, fs, _ = load_base()
    Lb = base_landmarks(co, T, fs)
    k = p["scale"]
    eye_mid = (Lb["eye_R"] + Lb["eye_L"]) / 2
    tgt = np.asarray(p["eye_target"], float); tgt_mid = np.array([0.0, tgt[1], tgt[2]])
    off = tgt_mid - k * eye_mid
    W = co * k + off                                   # world frame
    def w(pt): return np.asarray(pt) * k + off
    eyeR, eyeL = w(Lb["eye_R"]), w(Lb["eye_L"])
    eye_r0 = Lb["eye_r"] * k
    nose, chin, lip, crown = w(Lb["nose_tip"]), w(Lb["chin"]), w(Lb["lip_line"]), w(Lb["crown"])
    earR, earL = w(Lb["ear_R"]), w(Lb["ear_L"])
    # ---- deformations (symmetric)
    for sx, ec in ((1, eyeR), (-1, eyeL)):
        W = scale_about(W, ec, 0.034, (p["eye_scale"],) * 3)
        outer = ec + np.array([sx * 0.017, -0.010, 0.0])
        W = move(W, outer, 0.014, (0, 0, p["canthus_lift"]))
        zyg = np.array([sx * 0.052, ec[1] - 0.012, ec[2] - 0.030])
        W = move(W, zyg, 0.024, (sx * p["cheek_out"] * 0.8, -p["cheek_out"] * 0.6, 0.0))
        gon = np.array([sx * 0.060, ec[1] + 0.028, chin[2] + 0.030])
        W = move(W, gon, 0.026, (-sx * p["jaw_in"], 0, 0))
        ala = np.array([sx * 0.012, nose[1] + 0.012, nose[2] - 0.004])
        W = scale_about(W, ala, 0.014, (p["nose_w"], 1, 1))
        brow = np.array([sx * 0.030, ec[1] - 0.019, ec[2] + 0.020])
        W = move(W, brow, 0.022, (0, p["brow_soft"], 0))
        if p.get("lid_drop", 0.0):      # upper lid margin down over the iris (front of the eye only)
            lidc = np.array([ec[0], ec[1] - 0.012, ec[2] + 0.0085])
            W = move(W, lidc, 0.015, (0, -0.6 * p["lid_drop"], -p["lid_drop"]), axes=(1.0, 0.6, 1.4))   # down + forward (stays off the ball)
    W = move(W, chin + np.array([0, 0.0, 0.006]), 0.022, (0, -p["chin_fwd"], -p["chin_down"]))
    W = move(W, lip + np.array([0, 0, -0.007]), 0.013, (0, -p["lip_lower_fwd"], 0), axes=(0.7, 1, 1))
    W = move(W, lip + np.array([0, 0, 0.006]), 0.012, (0, -p["lip_upper_fwd"], 0), axes=(0.7, 1, 1))
    for sx in (-1,1):
        W = move(W, lip + np.array([sx*.023,.001,0]), .009, (0,p["lip_corner"],.0006), axes=(1,.9,.7))
    W = move(W, lip + np.array([0,.002,.012]), .010, (0,-p["philtrum_soft"],0), axes=(.6,1,1))
    if p.get("sulcus_fill", 0.0):       # C2 r3: fill the mentolabial crease (baked as a dark under-lip slit)
        W = move(W, lip + np.array([0, 0.004, -0.012]), 0.009, (0, -p["sulcus_fill"], 0), axes=(0.8, 1, 1))
    if p["skull_w"] != 1.0:
        W = scale_about(W, np.array([0, eyeR[1] + 0.06, eyeR[2] + 0.04]), 0.13, (p["skull_w"], 1, 1))
    # neck slimming: xy about the neck axis, full below the chin bottom, fading over 2.5 cm up to the jaw
    zc = chin[2]
    ax = np.array([0.0, chin[1] + 0.075, 0.0])
    wneck = smooth((zc + 0.015 - W[:, 2]) / 0.03)
    W = W + (wneck * (p["neck_slim"] - 1))[:, None] * ((W - ax) * np.array([1, 1, 0]))
    eyeR = eyeR; eyeL = eyeL
    N = vert_normals(W, T)
    lm = dict(eye_R=eyeR.tolist(), eye_L=eyeL.tolist(), eye_r=eye_r0 * p["eye_scale"] * p["eye_r_mul"],
              nose_tip=nose.tolist(), chin=chin.tolist(), lip_line=lip.tolist(), crown=crown.tolist(),
              ear_R=earR.tolist(), ear_L=earL.tolist(), mouth_half_w=float(Lb["mouth_half_w"] * k), scale=k,
              offset=off.tolist(), params=p)
    return W, T, N, fs, lm


def closest_on_tri(P, A, B, C):
    """Closest points on triangles (A,B,C) to points P (all Nx3). Returns (points, barycentric)."""
    ab, ac, ap = B - A, C - A, P - A
    d1, d2 = np.einsum("ij,ij->i", ab, ap), np.einsum("ij,ij->i", ac, ap)
    bp = P - B
    d3, d4 = np.einsum("ij,ij->i", ab, bp), np.einsum("ij,ij->i", ac, bp)
    cp_ = P - C
    d5, d6 = np.einsum("ij,ij->i", ab, cp_), np.einsum("ij,ij->i", ac, cp_)
    vc = d1 * d4 - d3 * d2
    vb = d5 * d2 - d1 * d6
    va = d3 * d6 - d5 * d4
    n = len(P)
    u = np.zeros(n); v = np.zeros(n); done = np.zeros(n, bool)
    def setuv(m, uu, vv):
        mm = m & ~done
        u[mm] = np.broadcast_to(uu, (n,))[mm] if np.ndim(uu) else uu
        v[mm] = np.broadcast_to(vv, (n,))[mm] if np.ndim(vv) else vv
        done[mm] = True
    setuv((d1 <= 0) & (d2 <= 0), 0.0, 0.0)                                   # A
    setuv((d3 >= 0) & (d4 <= d3), 1.0, 0.0)                                  # B
    setuv((d6 >= 0) & (d5 <= d6), 0.0, 1.0)                                  # C
    t = d1 / np.where(np.abs(d1 - d3) < 1e-20, 1e-20, d1 - d3)
    setuv((vc <= 0) & (d1 >= 0) & (d3 <= 0), t, 0.0)                         # AB
    t = d2 / np.where(np.abs(d2 - d6) < 1e-20, 1e-20, d2 - d6)
    setuv((vb <= 0) & (d2 >= 0) & (d6 <= 0), 0.0, t)                         # AC
    den = (d4 - d3) + (d5 - d6)
    t = (d4 - d3) / np.where(np.abs(den) < 1e-20, 1e-20, den)
    setuv((va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0), 1 - t, t)         # BC
    den = va + vb + vc
    den = np.where(np.abs(den) < 1e-20, 1e-20, den)
    setuv(np.ones(n, bool), vb / den, vc / den)                              # inside
    bc = np.stack([1 - u - v, u, v], 1)
    return A + ab * u[:, None] + ac * v[:, None], bc


def sdf_grid(W, T, N, x0, h, shape, spacing=None):
    spacing = spacing or h * 0.6
    """Signed distance on a grid from a closed triangle mesh: nearest surface sample (cKDTree) + sign from the
    interpolated vertex normal, then the inside/outside labels are cleaned by connected components."""
    from scipy.spatial import cKDTree
    from scipy import ndimage
    A, B, C = W[T[:, 0]], W[T[:, 1]], W[T[:, 2]]
    NA, NB, NC = N[T[:, 0]], N[T[:, 1]], N[T[:, 2]]
    edge = np.maximum.reduce([np.linalg.norm(B - A, axis=1), np.linalg.norm(C - B, axis=1), np.linalg.norm(A - C, axis=1)])
    nsub = np.clip(np.ceil(edge / spacing).astype(int), 1, 6)
    pts, nrm, tri = [], [], []
    for n in np.unique(nsub):
        m = nsub == n
        bl = [(i / n, j / n) for i in range(n + 1) for j in range(n + 1 - i)]
        bl = np.array([(1 - a - b, a, b) for a, b in bl])
        Pm = (bl[:, 0, None, None] * A[m][None] + bl[:, 1, None, None] * B[m][None] + bl[:, 2, None, None] * C[m][None]).reshape(-1, 3)
        Nm = (bl[:, 0, None, None] * NA[m][None] + bl[:, 1, None, None] * NB[m][None] + bl[:, 2, None, None] * NC[m][None]).reshape(-1, 3)
        pts.append(Pm); nrm.append(Nm); tri.append(np.repeat(np.nonzero(m)[0][None], len(bl), 0).ravel())
    pts = np.concatenate(pts); nrm = np.concatenate(nrm); tri = np.concatenate(tri)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
    print(f"  surface samples {len(pts)}")
    tree = cKDTree(pts)
    t0 = time.time()

    def query(Q, ub=np.inf, exact=False):
        if not exact:
            d, j = tree.query(Q, workers=-1, distance_upper_bound=ub)
            ok = np.isfinite(d)
            jj = np.where(ok, j, 0)
            s = np.ones(len(Q))
            s[ok] = np.sign(np.einsum("ij,ij->i", Q[ok] - pts[jj[ok]], nrm[jj[ok]]))
            s[s == 0] = 1
            return np.where(ok, d, ub) * s
        d, j = tree.query(Q, k=4, workers=-1, distance_upper_bound=ub)
        best = np.full(len(Q), ub); bsign = np.ones(len(Q))
        for kk in range(4):
            ok = np.isfinite(d[:, kk])
            if not ok.any():
                continue
            ti = tri[np.where(ok, j[:, kk], 0)]
            cp, bc = closest_on_tri(Q, A[ti], B[ti], C[ti])
            dd = np.linalg.norm(Q - cp, axis=1)
            nn = bc[:, 0, None] * NA[ti] + bc[:, 1, None] * NB[ti] + bc[:, 2, None] * NC[ti]
            sg = np.sign(np.einsum("ij,ij->i", Q - cp, nn)); sg[sg == 0] = 1
            win = ok & (dd < best)
            best[win] = dd[win]; bsign[win] = sg[win]
        return best * bsign
    # coarse pass (stride 4) everywhere, then a narrow band at full resolution (thin-surface KD queries are slow
    # for far points, so only cells near the surface are queried finely)
    st = 4
    cs = tuple((n + st - 1) // st + 1 for n in shape)
    gx = x0[0] + h * st * np.arange(cs[0]); gy = x0[1] + h * st * np.arange(cs[1]); gz = x0[2] + h * st * np.arange(cs[2])
    X, Y, Z = np.meshgrid(gx, gy, gz, indexing="ij")
    Gc = query(np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)).reshape(cs).astype(np.float32)
    print(f"  coarse {cs} {time.time()-t0:.1f}s", flush=True)
    G = ndimage.zoom(Gc, st, order=1)[:shape[0], :shape[1], :shape[2]].astype(np.float32)
    band = h * st * 1.8 + 0.002
    m = np.abs(G) < band
    idx = np.nonzero(m.ravel())[0]
    print(f"  band cells {len(idx)} ({100*len(idx)/G.size:.1f}%)", flush=True)
    gx = x0[0] + h * np.arange(shape[0]); gy = x0[1] + h * np.arange(shape[1]); gz = x0[2] + h * np.arange(shape[2])
    ii, jj, kk = np.unravel_index(idx, shape)
    Q = np.stack([gx[ii], gy[jj], gz[kk]], 1)
    vals = np.empty(len(idx), np.float32)
    for a in range(0, len(idx), 500000):
        vals[a:a + 500000] = query(Q[a:a + 500000], ub=band * 2, exact=True)
        print(f"    {a + 500000}/{len(idx)} {time.time()-t0:.0f}s", flush=True)
    G.ravel()[idx] = vals
    print(f"  kd queries {time.time()-t0:.1f}s", flush=True)
    inside = G < 0
    lab, n = ndimage.label(inside)
    if n > 1:
        sizes = ndimage.sum(inside, lab, range(1, n + 1))
        big = 1 + int(np.argmax(sizes))
        bad = inside & (lab != big)
        G[bad] = np.abs(G[bad])
        print(f"  inside components {n}, flipped {int(bad.sum())} stray inside cells")
    outside = G >= 0
    lab, n = ndimage.label(outside)
    if n > 1:
        sizes = ndimage.sum(outside, lab, range(1, n + 1))
        big = 1 + int(np.argmax(sizes))
        bad = outside & (lab != big)
        G[bad] = -np.abs(G[bad])
        print(f"  outside components {n}, flipped {int(bad.sum())} enclosed outside cells")
    return G


def main():
    if sys.argv[1:] and sys.argv[1] == "export" or "--" in sys.argv and sys.argv[sys.argv.index("--") + 1:][:1] == ["export"]:
        export_from_bundle()
        return
    assert sys.argv[1] == "fit", __doc__
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    args = sys.argv[3:]
    params = {}
    sdf_h = None; preview = False
    i = 0
    while i < len(args):
        if args[i] == "--sdf":
            sdf_h = float(args[i + 1]) / 1000.0; i += 2
        elif args[i] == "--preview":
            preview = True; i += 1
        elif args[i] == "--params":
            i += 1
            while i < len(args) and not args[i].startswith("--"):
                kk, vv = args[i].split("=", 1)
                params[kk] = json.loads(vv); i += 1
        else:
            i += 1
    t0 = time.time()
    W, T, N, fs, lm = fit(params)
    print(f"fit {time.time()-t0:.1f}s verts {len(W)} tris {len(T)} eye_R {np.round(lm['eye_R'], 4)} eye_r {lm['eye_r']:.4f} "
          f"chin {np.round(lm['chin'], 4)} crown z {lm['crown'][2]:.4f} nose {np.round(lm['nose_tip'], 4)} lip {np.round(lm['lip_line'], 4)}")
    np.savez_compressed(os.path.join(out, "head_fit.npz"), co=W, tris=T, normals=N, faceset=fs, landmarks=json.dumps(lm))
    if preview:
        from lib import npview as nv
        tgt = (0, -0.02, lm["eye_R"][2] - 0.03)
        imgs = [nv.render(W, T, yaw=y, target=tgt, ortho=0.13, res=(420, 520), fcol=np.full((len(T), 3), (0.80, 0.62, 0.50))) for y in (0, 35, 90)]
        nv.save(os.path.join(out, "fit_preview.png"), *imgs)
        print("preview", os.path.join(out, "fit_preview.png"))
    if sdf_h:
        lo = W.min(0) - 0.012; hi = W.max(0) + 0.012
        lo[2] = max(lo[2], 1.47)                       # the base neck below the weld cut is never sampled
        shape = tuple(int(math.ceil((hi[a] - lo[a]) / sdf_h)) + 1 for a in range(3))
        print(f"sdf grid h={sdf_h*1000:.2f}mm shape {shape} ({np.prod(shape)/1e6:.1f} M cells) lo {lo.round(3)} hi {hi.round(3)}")
        t0 = time.time()
        G = sdf_grid(W, T, N, lo, sdf_h, shape)
        ns = float(lm["params"].get("nostril_soft", 0.0))
        if ns > 0:
            from scipy import ndimage
            nc = np.array(lm["nose_tip"]) + np.array([0, 0.009, -0.004])
            nr = np.array([0.027, 0.025, 0.015])
            b0 = np.maximum(0, ((nc - nr * 1.5 - lo) / sdf_h).astype(int))
            b1 = np.minimum(shape, ((nc + nr * 1.5 - lo) / sdf_h).astype(int) + 1)
            sl = tuple(slice(a, b) for a, b in zip(b0, b1))
            sub = G[sl]
            xyz = np.meshgrid(*[lo[a] + np.arange(b0[a], b1[a]) * sdf_h for a in range(3)], indexing="ij")
            w = smooth(1 - np.sqrt(sum(((xyz[a] - nc[a]) / nr[a]) ** 2 for a in range(3))))
            G[sl] = sub + w * (ndimage.gaussian_filter(sub, ns / sdf_h) - sub)
        lc = float(lm["params"].get("lip_close", 0.0))
        if lc > 0:          # closing (grey dilation - r) only round the mouth: fills slits narrower than ~2r
            from scipy import ndimage
            rc = max(1, int(round(lc / sdf_h)))
            ax = np.arange(-rc, rc + 1)
            fp = (ax[:, None, None] ** 2 + ax[None, :, None] ** 2 + ax[None, None, :] ** 2) <= rc * rc + 0.5
            lipz, lipy, mw = lm["lip_line"][2], lm["lip_line"][1], lm["mouth_half_w"]
            b0 = [max(0, int((v - lo[a]) / sdf_h)) for a, v in ((0, -mw - 0.010), (1, lo[1]), (2, lipz - 0.012))]
            b1 = [min(shape[a], int((v - lo[a]) / sdf_h) + 1) for a, v in ((0, mw + 0.010), (1, lipy + 0.016), (2, lipz + 0.012))]
            sub = G[b0[0]:b1[0], b0[1]:b1[1], b0[2]:b1[2]]
            # on an open surface max_ball(G) ~ G + r (minus a lattice error < 0.45 h); inside a slit it falls short
            # by up to r -> only that shortfall (beyond the lattice error) is filled, so open skin is untouched and
            # there is no ledge at the box edges
            short = (sub + rc * sdf_h) - ndimage.grey_dilation(sub, footprint=fp, mode="nearest")
            fill = np.maximum(short - 0.6 * sdf_h, 0.0).astype(np.float32)
            print(f"  lip closing r={rc*sdf_h*1000:.1f}mm box {sub.shape}: {(fill > 0).sum()} cells filled, "
                  f"max {fill.max()*1000:.2f} mm")
            G[b0[0]:b1[0], b0[1]:b1[1], b0[2]:b1[2]] = sub - fill
        np.savez_compressed(os.path.join(out, "head_sdf.npz"), G=np.clip(G, -0.04, 0.04).astype(np.float32), x0=lo, h=sdf_h,
                            landmarks=json.dumps(lm))
        print(f"sdf {time.time()-t0:.1f}s -> head_sdf.npz")


if __name__ == "__main__":
    main()
