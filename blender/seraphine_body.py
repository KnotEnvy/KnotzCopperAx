"""Seraphine r24 body/outfit: deterministic donor-frame edits and parts.

Run with Blender's bundled Python (no Blender slot needed). Export previews
through build_hero_seraphine_team.py and the shared blender-run wrapper.
"""
import argparse
import json
import os
import runpy
import struct
import sys
import zlib

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seraphine_team as T


CONFIG = {
    "seed": 24,
    "out": os.path.join(T.PARTS_DIR, "body"),
    "retarget": {
        "thigh": {"len": 1.045, "w": .87, "d": .90},
        "shin": {"len": 1.035, "w": .85, "d": .88},
        "upperarm": {"w": .88, "d": .88},
        "forearm": {"w": .94, "d": .94},
        "clavicle": {"len": .90},
        "spine": {"len": .90, "w": .94, "d": .97},
        "chest": {"len": .91, "w": .98},
        "neck": {"len": .98},
        "head": {"len": 1.07, "w": 1.07, "d": 1.07},
    },
    "greave": {
        "z": [0., .10, .16, .23, .32, .40, .47, .52, .58],
        "rx": [.054, .053, .047, .049, .059, .059, .057, .062, .080],
        "ry": [.064, .058, .048, .049, .062, .061, .058, .065, .082],
        "excess_keep": .12,
        "max_move": .028,
    },
    "knee_disc": {"radius": .019, "z": .478, "sides": 32, "thickness": .0016},
    "pauldron": {"enabled": True, "pull": .010, "t_start": -.080, "t_end": .150},
}


def build_retarget(D, out):
    bones = {}
    for name, scale in CONFIG["retarget"].items():
        for bone in ([name + "_L", name + "_R"] if name in
                     ("thigh", "shin", "upperarm", "forearm", "clavicle") else [name]):
            bones[bone] = dict(scale)
    spec = {"bones": bones, "ground": True,
            "notes": "r24 v1: long legs, slim limbs, narrow clavicles, short torso, uniformly enlarged head; flat donor soles."}
    T.save_json(os.path.join(out, "retarget.json"), spec)
    report = T.retarget_report(D, spec)
    T.save_json(os.path.join(T.TEAM, "body", "retarget_report.json"), report)
    print(json.dumps(report, indent=2))
    return spec


def smoothstep(a, b, x):
    t = np.clip((x-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def smooth_normals(M, P):
    tri = P[M.F]
    fn = np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0])
    sums = np.zeros((M.pos_id.max()+1, 3))
    for k in range(3):
        np.add.at(sums, M.pos_id[M.F[:, k]], fn)
    sums /= np.maximum(np.linalg.norm(sums, axis=1, keepdims=True), 1e-12)
    return sums[M.pos_id[M.F]]


def build_greaves(D, P):
    """Compress fused plate protrusions onto a soft tapered leather silhouette.

    Positive radial derivative preserves shell ordering; all welded UV copies
    receive exactly the same map. Feet and their flat floor remain untouched.
    """
    M = D.mesh["body"]
    cfg = CONFIG["greave"]
    for side in ("L", "R"):
        vi = M.verts_of("leg_"+side)
        z = M.P[vi, 2]
        a, b = D.joints["foot_"+side], D.joints["shin_"+side]
        t = np.clip((z-a[2])/(b[2]-a[2]), 0, 1)
        c = a[None] + t[:, None]*(b-a)[None]
        rad = M.P[vi, :2]-c[:, :2]
        rx = np.interp(z, cfg["z"], cfg["rx"])
        ry = np.interp(z, cfg["z"], cfg["ry"])
        r = np.sqrt((rad[:, 0]/rx)**2+(rad[:, 1]/ry)**2)
        target = np.where(r>1, 1+(r-1)*cfg["excess_keep"], r)
        amt = smoothstep(.105, .155, z)*(1-smoothstep(.505, .565, z))
        delta = rad*(target/np.maximum(r, 1e-9)-1)[:, None]*amt[:, None]
        delta *= np.minimum(1, cfg["max_move"]/np.maximum(np.linalg.norm(delta, axis=1), 1e-9))[:, None]
        P[vi, :2] += delta
    return P


def build_pauldron(D, P):
    """D1: pull the existing three lames onto the deltoid with a C1 mask.

    No deletion, no hole and no boundary seam: a smooth displacement covers
    owned torso/arm vertices and vanishes before the pinned neck boundary.
    """
    if not CONFIG["pauldron"]["enabled"]:
        return P
    cfg = CONFIG["pauldron"]
    M = D.mesh["body"]
    sh = D.joints["upperarm_L"]
    axis = D.joints["forearm_L"]-sh
    axis /= np.linalg.norm(axis)
    up = np.array([0., 0, 1])-axis*axis[2]
    up /= np.linalg.norm(up)
    rel = M.P-sh
    t = rel@axis
    rad = rel-t[:, None]*axis
    r = np.linalg.norm(rad, axis=1)
    h = rad@up
    mask = (smoothstep(cfg["t_start"], -.025, t)*(1-smoothstep(.095, cfg["t_end"], t))*
            smoothstep(-.008, .030, h)*smoothstep(.090, .125, M.P[:, 0]))
    owned = np.zeros(len(P), bool)
    owned[M.verts_of("torso", "arm_L")] = True
    mask *= owned
    pull = cfg["pull"]*mask*smoothstep(.030, .055, r)
    P -= rad/np.maximum(r[:, None], 1e-9)*pull[:, None]
    return P


def build_skirt_drop(D, out):
    # An empty, correctly shaped PART explicitly replaces the separate tassets.
    T.save_part(out, "drop_skirt", P=np.zeros((0, 3)), F=np.zeros((0, 3), int),
                UV=np.zeros((0, 3, 2)), N=np.zeros((0, 3, 3)),
                W=np.zeros((0, len(D.bones))), bones=D.bones, tile="donor_body",
                meta={"role": "body", "mesh": "body", "replaces": ["skirt"],
                      "notes": "D2: drop 2800-triangle tasset skirt; retain leggings and crimson sash."})


def transfer_surface_weights(points, D, regions, allowed):
    """Closest donor TRIANGLE barycentrics (not nearest vertices), numpy only.

    A closest point is either the perpendicular plane projection inside the
    triangle or a point on one of its three edges. Chunking bounds memory.
    """
    M = D.mesh["body"]
    fi = M.faces(*regions)
    faces = M.F[fi]
    tri = M.P[faces]
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    ab, ac = b-a, c-a
    aa, bb, cc = (ab*ab).sum(1), (ab*ac).sum(1), (ac*ac).sum(1)
    den = np.maximum(aa*cc-bb*bb, 1e-20)
    result = np.zeros((len(points), len(D.bones)), np.float32)
    for start in range(0, len(points), 96):
        p = points[start:start+96, None, :]
        rel = p-a[None]
        d, e = (rel*ab[None]).sum(2), (rel*ac[None]).sum(2)
        u, v = (d*cc-e*bb)/den, (e*aa-d*bb)/den
        bary = np.stack([1-u-v, u, v], 2)
        hit = a[None]+u[..., None]*ab[None]+v[..., None]*ac[None]
        dist = ((p-hit)**2).sum(2)
        dist[(bary<0).any(2)] = np.inf
        for i, j in ((0, 1), (1, 2), (2, 0)):
            edge = tri[:, j]-tri[:, i]
            t = np.clip(((p-tri[None, :, i])*edge[None]).sum(2)/
                        np.maximum((edge*edge).sum(1), 1e-20), 0, 1)
            hit = tri[None, :, i]+t[..., None]*edge[None]
            ds = ((p-hit)**2).sum(2)
            use = ds<dist
            edge_bary = np.zeros_like(bary)
            edge_bary[:, :, i], edge_bary[:, :, j] = 1-t, t
            bary[use], dist[use] = edge_bary[use], ds[use]
        k = dist.argmin(1)
        weights = np.einsum("ni,nik->nk", bary[np.arange(len(p)), k], M.Wn[faces[k]])
        result[start:start+len(p)] = weights
    result[:, ~np.array([bone in allowed for bone in D.bones])] = 0
    assert (result.sum(1)>1e-8).all(), "closest donor surface has no allowed influence"
    result /= result.sum(1, keepdims=True)
    return result


def build_sash(D, out):
    """Shorten the two donor crimson tails to mid-thigh; keep buried roots.

    Nearest donor surface weights retain the existing blended kilt chains, restricted
    to hips + kilt_* per the sash allow-list (the donor also used thigh_L).
    Sharing the donor_body group with the zero-triangle skirt replacement also
    avoids the shared preview builder's empty-object path.
    """
    M = D.mesh["body"]
    fi = M.faces("sash_tails")
    vi, inv = np.unique(M.F[fi], return_inverse=True)
    P = M.P[vi].copy()
    bend = 1-smoothstep(.95, 1.015, P[:, 2])
    P[:, 2] += (1.015-P[:, 2])*.36*bend
    full = M.P.copy()
    full[vi] = P
    allowed = [b for b in D.bones if b=="hips" or b.startswith("kilt_")]
    weights = transfer_surface_weights(P, D, ["sash_tails"], allowed)
    T.save_part(out, "sash_mid_thigh", P=P, F=inv.reshape(-1, 3),
                UV=M.UV[fi], N=smooth_normals(M, full)[fi], W=weights,
                bones=D.bones, tile="donor_body",
                meta={"role": "body", "mesh": "body", "replaces": ["sash_tails"],
                      "notes": "Two crimson tails shortened to mid-thigh, root positions pinned; nearest donor triangle barycentric weights restricted to hips+kilt_*; donor UVs."})


def front_hit(M, P, side, x, z):
    """Exact nearest surface ray in the XZ plane, plus donor barycentric weights."""
    fi = M.faces("leg_"+side)
    tri = P[M.F[fi]]
    a = tri[:, 0, [0, 2]]
    b = tri[:, 1, [0, 2]]-a
    c = tri[:, 2, [0, 2]]-a
    v = np.array([x, z])-a
    den = b[:, 0]*c[:, 1]-b[:, 1]*c[:, 0]
    valid = np.abs(den)>1e-12
    den = np.where(valid, den, 1)
    u = (v[:, 0]*c[:, 1]-v[:, 1]*c[:, 0])/den
    w = (b[:, 0]*v[:, 1]-b[:, 1]*v[:, 0])/den
    valid &= (u>=-1e-7)&(w>=-1e-7)&(u+w<=1+1e-7)
    bary = np.stack([1-u-w, u, w], 1)
    y = (bary*tri[:, :, 1]).sum(1)
    y[~valid] = np.inf
    k = y.argmin()
    if not np.isfinite(y[k]):
        raise RuntimeError(f"ray missed {side} {x} {z}")
    return float(y[k]), bary[k]@M.Wn[M.F[fi[k]]]


def build_knee_discs(D, P, out):
    M = D.mesh["body"]
    cfg = CONFIG["knee_disc"]
    points, faces, weights, uvv = [], [], [], []
    for side in ("L", "R"):
        n, r = cfg["sides"], cfg["radius"]
        cx = D.joints["shin_"+side][0]
        o = len(points)
        ring = [(cx, cfg["z"])] + [(cx+r*np.cos(t), cfg["z"]+r*np.sin(t))
                                           for t in np.arange(n)*2*np.pi/n]
        for layer in range(2):
            for i, (x, z) in enumerate(ring):
                y, weight = front_hit(M, P, side, x, z)
                y -= .0002 if layer else cfg["thickness"]+(.001 if i==0 else 0)
                points.append([x, y, z])
                # Surface transfer restricted to the shin, per the part contract.
                keep = np.array([b=="shin_"+side for b in D.bones])
                weight[~keep] = 0
                weight /= max(weight.sum(), 1e-9)
                weights.append(weight)
                uvv.append([.5+(x-cx)/r*.10, .957+(z-cfg["z"])/r*.020])
        for i in range(n):
            a, b = o+1+i, o+1+(i+1)%n
            c, d = a+n+1, b+n+1
            faces.extend([(o, a, b), (o+n+1, d, c), (a, c, d), (a, d, b)])
    pp, ff = np.array(points), np.array(faces)
    tri = pp[ff]
    volume = np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum()/6
    if volume<0:
        ff = ff[:, ::-1]
        tri = pp[ff]
    fn = np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0])
    normal = np.zeros_like(pp)
    for j in range(3):
        np.add.at(normal, ff[:, j], fn)
    normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-9)
    T.save_part(out, "bronze_knee_discs", P=pp, F=ff, UV=np.array(uvv)[ff],
                N=normal[ff], W=np.array(weights), bones=D.bones, tile="outfit",
                meta={"role": "body", "mesh": "body", "replaces": [],
                      "notes": "38mm bronze discs on edited shin surface; closed thickness 1.6mm, gap .2mm, nearest-surface weights restricted to own shin."})


def write_png(path, array):
    """Minimal lossless RGB PNG writer; bundled Python needs no PIL."""
    array = np.asarray(np.clip(array, 0, 255), np.uint8)
    h, w, channels = array.shape
    assert channels == 3
    def chunk(tag, payload):
        return struct.pack(">I", len(payload))+tag+payload+struct.pack(">I", zlib.crc32(tag+payload)&0xffffffff)
    raw = b"".join(b"\x00"+row.tobytes() for row in array)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))+
                chunk(b"IDAT", zlib.compress(raw, 9))+chunk(b"IEND", b""))


def build_outfit_tile(out):
    """Two cylindrical greave/boot charts, small bronze sample lane at the top.

    Brown leather L*~38, warm wrap L*~47, bronze L*~62. The diagonal wrap
    changes phase at front/back; no copied reference pixels or donor plate bake.
    """
    h, w = 896, 640
    y, x = np.mgrid[0:h, 0:w]
    u, v = (x+.5)/w, 1-(y+.5)/h
    theta = np.where(u<.5, (u-.18)/.29, (u-.68)/.29)
    z = np.clip((v-.035)/.86, 0, 1)*.565
    phase = np.mod(z/.090 + theta, 1)
    edge = np.minimum(phase, 1-phase)
    wraps = (phase<.22)&(z>.11)&(z<.49)
    bootphase = np.mod(z/.040+theta, 1)
    wraps |= (z<.11)&(bootphase<.20)
    albedo = np.zeros((h, w, 3), float)+[84, 54, 35]
    albedo += (4*np.sin(theta*23)+2*np.sin(z*820+theta*11))[..., None]
    albedo[wraps] = np.array([137, 96, 59])+4*np.sin(z[wraps]*1200)[:, None]
    seam = (edge<.020)&(z>.11)&(z<.49)
    albedo[seam] = [61, 39, 25]
    # Bronze lane v .94-.985 is reserved for knee discs.
    albedo[v>.925] = [197, 149, 78]
    orm = np.zeros((h, w, 3))+[255, 207, 0]
    orm[wraps] = [255, 219, 0]
    orm[v>.925] = [255, 150, 135]
    normal = np.zeros((h, w, 3))+[128, 128, 255]
    for kind, array in (("albedo", albedo), ("orm", orm), ("normal", normal)):
        write_png(os.path.join(out, "tiles", "outfit_"+kind+".png"), array)


def outfit_uv(M, P):
    fi = np.flatnonzero(np.isin(M.region, ["leg_L", "leg_R"]) &
                        (M.P[M.F, 2].max(1)<.565))
    uv = np.zeros((len(fi), 3, 2))
    for i, face in enumerate(fi):
        p = P[M.F[face]]
        side = "L" if M.region[face] == "leg_L" else "R"
        cx = .097 if side == "L" else -.097
        # Seam at the inner/rear side, unwrapped per triangle to avoid huge spans.
        theta = (np.arctan2(p[:, 0]-cx, -(p[:, 1]-.006))/(2*np.pi)) % 1
        if theta.max()-theta.min()>.5:
            theta[theta>.5] -= 1
        uv[i, :, 0] = (.18 if side == "L" else .68)+.29*theta
        uv[i, :, 1] = .035+.86*p[:, 2]/.565
    return fi, uv


def build_outfit(D, out):
    M = D.mesh["body"]
    P = build_pauldron(D, build_greaves(D, M.P.copy()))
    # All aliases of a welded position get the same edited coordinate.
    _, first, inv = np.unique(M.pos_id, return_index=True, return_inverse=True)
    P = P[first][inv]
    pin = np.isin(M.pos_id, D.pinned_positions("body"))
    P[pin] = M.P[pin]
    vi = np.flatnonzero(np.linalg.norm(P-M.P, axis=1)>1e-8)
    fi, uv = outfit_uv(M, P)
    T.save_edits(out, vidx=vi, P_new=P[vi], fidx=fi, UV=uv,
                 N=smooth_normals(M, P)[fi], tile="outfit",
                 meta={"role": "body", "notes": "Slim fused greave shells into leather wraps, preserve topology and weights; flat feet unchanged. D1 pauldron pulled 10mm onto deltoid." if CONFIG["pauldron"]["enabled"] else "Slim fused greave shells into leather wraps, preserve topology and weights; flat feet unchanged."})
    build_outfit_tile(out)
    build_skirt_drop(D, out)
    build_sash(D, out)
    build_knee_discs(D, P, out)
    bone_sets = {}
    for name in ("sash_mid_thigh", "bronze_knee_discs"):
        part = T.load_part(out, name)
        used = [bone for j, bone in enumerate(part["bones"]) if part["W"][:, j].max()>1e-8]
        allowed = ((lambda bone: bone=="hips" or bone.startswith("kilt_")) if name=="sash_mid_thigh"
                   else (lambda bone: bone in ("shin_L", "shin_R")))
        assert all(allowed(bone) for bone in used), (name, used)
        assert np.allclose(part["W"].sum(1), 1), name
        bone_sets[name] = used
    E = T.load_edits(out)
    report = T.audit_edits(D, E, "body")
    report["new_part_bones"] = bone_sets
    T.save_json(os.path.join(T.TEAM, "body", "outfit_audit.json"), report)
    print("[seraphine-body] outfit", json.dumps(report), flush=True)
    if not report["ok"]:
        raise RuntimeError(report)
    T.save_json(os.path.join(out, "outfit_tile_layout.json"), {
        "size": [640, 896], "origin": "bottom-left",
        "charts": {"left_lower_leg": {"u": [.035, .47], "v": [.035, .895]},
                   "right_lower_leg": {"u": [.535, .97], "v": [.035, .895]},
                   "bronze_discs": {"u": [.40, .60], "v": [.937, .977]}},
        "notes": "Body-authored deterministic leather and wrap pattern; exact donor-frame fidx chart coords in edits.npz. Bronze sample is shared by both discs. Pack without shrinking. Donor leggings and vest remain the texture role's surface charts."
    })


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=CONFIG["out"])
    ap.add_argument("--retarget-only", action="store_true")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--release", action="store_true")
    ap.add_argument("--export-preview", metavar="DIR")
    ap.add_argument("--qa-out", metavar="DIR")
    argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else sys.argv[1:]
    args = ap.parse_args(argv)
    D = T.Donor()
    build_retarget(D, args.out)
    if not args.retarget_only:
        build_outfit(D, args.out)
    if args.export_preview:
        import build_hero_seraphine_team as B
        original = B.build_objects
        def preview_objects(groups, arm, donor):
            # Local preview-only repairs: shared assembler still owns all mesh,
            # joint and material construction. Authored tile PNGs stay 640x896;
            # resample only their in-memory preview images to POT for validator.
            groups = {key: g for key, g in groups.items() if len(g["F"])}
            objects, extras = original(groups, arm, donor)
            scaled = set()
            for ob in objects:
                for mat in ob.data.materials:
                    if mat.name != "M_sera_body_outfit":
                        continue
                    for node in mat.node_tree.nodes:
                        if node.type == "TEX_IMAGE" and node.image and node.image.name not in scaled:
                            node.image.scale(1024, 1024)
                            scaled.add(node.image.name)
            return objects, extras
        B.build_objects = preview_objects
        sys.argv = [__file__, "--", "--preview-role", "body", "--out", args.export_preview]
        B.main()
        if args.qa_out:
            sys.argv = [__file__, "--", "--glb", os.path.join(args.export_preview, "hero_seraphine.glb"),
                        "--out", args.qa_out]
            runpy.run_path(os.path.join(T.ROOT, ".claude/skills/kca-model-builder/scripts/qa_model.py"), run_name="__main__")


if __name__ == "__main__":
    main()
