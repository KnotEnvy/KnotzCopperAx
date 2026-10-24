"""Hair / fur as sculpted clump meshes (no alpha cards -> no sorting problems).

sweep_lock() builds one tapered lock with a lens-shaped cross-section and a per-lock UV ("lockuv":
u across the lock, v root->tip) that the bake shaders use for strand grooves.
drape_locks() integrates many locks at once from roots on the scalp, following a flow field + gravity
and colliding with the body SDF (so hair lies on the traps/shoulders instead of passing through).
"""
import math
import numpy as np

from .sdf import V, norm


def _frames(P, nrm_hint):
    T = np.gradient(P, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    N = nrm_hint - T * np.sum(nrm_hint * T, axis=1, keepdims=True)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    B = np.cross(T, N)
    return T, N, B


def sweep_lock(P, width, thick, nrm_hint, n_around=6, lens=0.75, twist=0.0):
    """P (n,3) path; width/thick (n,); nrm_hint (n,3). Returns verts (m,3), faces list, loop uvs list."""
    P = np.asarray(P, float)
    n = len(P)
    T, N, B = _frames(P, np.asarray(nrm_hint, float))
    verts, faces, uvs = [], [], []
    ring_idx = []
    for i in range(n - 1):
        ang0 = twist * i / max(1, n - 1)
        ids = []
        for j in range(n_around):
            a = 2 * math.pi * j / n_around + ang0
            ca, sa = math.cos(a), math.sin(a)
            # lens profile: flatter on top, sharper edges
            x = ca * width[i] * 0.5
            y = math.copysign(abs(sa) ** lens, sa) * thick[i] * 0.5
            ids.append(len(verts))
            verts.append(P[i] + B[i] * x + N[i] * y)
        ring_idx.append(ids)
    tip = len(verts)
    verts.append(P[-1])
    for i in range(n - 2):
        v0 = i / (n - 1)
        v1 = (i + 1) / (n - 1)
        for j in range(n_around):
            j1 = (j + 1) % n_around
            a, b, c, d = ring_idx[i][j], ring_idx[i][j1], ring_idx[i + 1][j1], ring_idx[i + 1][j]
            faces.append((a, b, c, d))
            u0, u1 = j / n_around, (j + 1) / n_around
            uvs.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    last = ring_idx[-1]
    vl = (n - 2) / (n - 1)
    for j in range(n_around):
        j1 = (j + 1) % n_around
        faces.append((last[j], last[j1], tip))
        uvs.append([(j / n_around, vl), ((j + 1) / n_around, vl), ((j + 0.5) / n_around, 1.0)])
    # root cap (fan, buried in the scalp)
    first = ring_idx[0]
    faces.append(tuple(reversed(first)))
    uvs.append([((k + 0.5) / n_around, 0.0) for k in reversed(range(n_around))])
    return np.array(verts), faces, uvs


def resample_path(P, n):
    P = np.asarray(P, float)
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, P[:, k]) for k in range(3)], axis=1)


def drape_locks(sculpt, roots, dirs, lengths, steps=24, clearance=0.012, gravity=0.55, stiff=0.82,
                flow=None, seed=1, curl=0.0, outward=None, gravity_ramp=None, clear_ramp=None, hug=0.0):
    """Vectorised lock integration. roots/dirs (m,3), lengths (m,). Returns list of (steps+1,3) paths.
    gravity_ramp(dist_m) -> 0..1 scales gravity by distance travelled (hair hugs the scalp first, then falls);
    clear_ramp(dist_m) -> extra clearance by distance travelled."""
    rng = np.random.RandomState(seed)
    m = len(roots)
    P = np.array(roots, float)
    v = np.array([norm(d) for d in dirs])
    ds = np.asarray(lengths, float) / steps
    clear0 = np.broadcast_to(np.asarray(clearance, float), (m,)).copy()
    clear = clear0.copy()
    paths = [P.copy()]
    g = V(0, 0, -1)
    for s in range(steps):
        t = (s + 1) / steps
        dist = ds * (s + 1)
        f = flow(P, t) if flow is not None else 0.0
        gw = gravity * (gravity_ramp(dist) if gravity_ramp is not None else 1.0)
        if np.ndim(gw):
            gw = np.asarray(gw)[:, None]
        if clear_ramp is not None:
            clear = clear0 + clear_ramp(dist)
        v = norm_rows(v * stiff + (1 - stiff) * (g * gw + f))
        if curl:
            side = np.cross(v, V(0, 0, 1))
            v = norm_rows(v + side * curl * math.sin(t * 6.0) * 0.2)
        P_prev = P.copy()
        P = P + v * ds[:, None]
        if hug > 0:
            # hug phase: attract onto the offset surface (a straight tangent would leave a curved skull)
            hg = dist < hug
            if hg.any():
                Q = P[hg]
                for _ in range(2):
                    dq = sculpt.dist(Q) - clear[hg]
                    Q = Q - sculpt.grad(Q) * dq[:, None]
                P[hg] = Q
                vn = P[hg] - P_prev[hg]
                v[hg] = norm_rows(vn)
        # collide: push outside body + clearance
        for _ in range(2):
            d = sculpt.dist(P) - clear
            bad = d < 0
            if bad.any():
                gr = sculpt.grad(P[bad])
                P[bad] -= gr * d[bad][:, None]
                # remove velocity component into the body
                vb = v[bad]
                into = np.sum(vb * gr, axis=1)
                vb = vb - gr * np.minimum(into, 0)[:, None]
                v[bad] = norm_rows(vb)
        paths.append(P.copy())
    return [np.array([p[i] for p in paths]) for i in range(m)]


def norm_rows(a):
    return a / np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-9)


class LockSet:
    """Accumulates locks into one mesh (with lockuv + per-vertex 'along' parameter + lock id)."""

    def __init__(self):
        self.verts, self.faces, self.uvs, self.along, self.lock_id = [], [], [], [], []
        self.dims = []          # per lock (mean perimeter, length) in metres -> UV texel density
        self.n = 0

    def add(self, P, width, thick, nrm_hint, n_around=6, lens=0.75, twist=0.0):
        P = np.asarray(P, float)
        length = float(np.linalg.norm(np.diff(P, axis=0), axis=1).sum())
        w, t = np.asarray(width, float), np.asarray(thick, float)
        perim = float(np.mean(math.pi * np.sqrt((w * w + t * t) / 2.0)))     # ellipse perimeter approx
        self.dims.append((max(perim, 1e-4), max(length, 1e-4)))
        v, f, uv = sweep_lock(P, width, thick, nrm_hint, n_around, lens, twist)
        base = sum(len(x) for x in self.verts)
        self.verts.append(v)
        self.faces.extend([tuple(i + base for i in face) for face in f])
        self.uvs.extend(uv)
        n = len(P)
        al = np.repeat(np.arange(n - 1) / (n - 1), n_around)
        self.along.append(np.concatenate([al, [1.0]]))
        self.lock_id.append(np.full(len(v), self.n))
        self.n += 1

    def to_object(self, name, collection=None):
        import bpy
        V_ = np.concatenate(self.verts).astype(np.float32)
        me = bpy.data.meshes.new(name)
        me.from_pydata(V_.tolist(), [], self.faces)
        me.update()
        uvl = me.uv_layers.new(name="lockuv")
        flat = [c for face in self.uvs for uv in face for c in uv]
        uvl.data.foreach_set("uv", np.array(flat, np.float32))
        me.shade_smooth()
        a = me.attributes.new("along", "FLOAT", "POINT")
        a.data.foreach_set("value", np.concatenate(self.along).astype(np.float32))
        b = me.attributes.new("lock_id", "FLOAT", "POINT")
        b.data.foreach_set("value", np.concatenate(self.lock_id).astype(np.float32))
        ob = bpy.data.objects.new(name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        return ob


def taper_profile(n, w0, w_mid, tip_frac=0.45, root_frac=0.12):
    t = np.linspace(0, 1, n)
    w = np.full(n, w_mid)
    r = t < root_frac
    w[r] = w0 + (w_mid - w0) * (t[r] / root_frac)
    tt = np.clip((t - (1 - tip_frac)) / tip_frac, 0, 1)
    w = w * (1 - tt ** 1.6 * 0.94)
    return w


def tuft_ring(sculpt, centers, normals, down, length=(0.04, 0.07), width=(0.018, 0.03), thick=0.006,
              seed=3, n_seg=5, n_around=5, droop=0.7):
    """Short fur clumps rooted at points with outward normals, pointing mostly `down`."""
    rng = np.random.RandomState(seed)
    out = []
    for c, nrm in zip(centers, normals):
        L = rng.uniform(*length)
        w = rng.uniform(*width)
        d0 = norm(nrm * (1 - droop) + V(down) * droop + rng.normal(0, 0.18, 3))
        pts = [c - nrm * 0.004]
        p = pts[0].copy()
        v = d0
        for i in range(n_seg):
            v = norm(v + V(down) * 0.25 + nrm * 0.05)
            p = p + v * (L / n_seg)
            pts.append(p.copy())
        P = np.array(pts)
        wid = taper_profile(len(P), w * 0.8, w, tip_frac=0.6, root_frac=0.15)
        th = taper_profile(len(P), thick, thick, tip_frac=0.6, root_frac=0.15)
        out.append((P, wid, th, np.tile(nrm, (len(P), 1))))
    return out


def groom(sculpt, head_c, roots_dir, region_fn, n=110, seed=11, flow_fn=None, length_fn=None, width=(0.05, 0.072),
          thick=(0.012, 0.018), steps=26, gravity=0.75, stiff=0.86, hug=0.12, clearance=0.006, clear_add=0.016,
          wave=0.012, wave_len=0.19):
    """Stylised clump groom (heroes' manes, beards, horse tails...).
    Roots: golden-spiral directions from head_c filtered by region_fn(dir) and projected onto the sculpt.
    flow_fn(root, normal) -> initial tangent direction; length_fn(root_dir) -> lock length (m).
    Clumps hug the surface for `hug` metres (gravity ramps in afterwards), keep `clearance` from the body
    (growing by `clear_add` further along), and get a gentle lateral S-wave.
    Returns list of dict(path (k,3), width, thick, root_dir)."""
    rng = np.random.RandomState(seed)
    golden = math.pi * (3 - math.sqrt(5))
    cand = []
    N = n * 6
    for i in range(N):
        z = 1 - 2 * (i + 0.5) / N
        r = math.sqrt(max(0, 1 - z * z))
        a = i * golden
        d = V(math.cos(a) * r, math.sin(a) * r, z)
        if region_fn(d):
            cand.append(d)
    cand = np.array(cand)
    if len(cand) > n:
        cand = cand[np.linspace(0, len(cand) - 1, n).astype(int)]
    P0 = sculpt.project(head_c + cand * 0.2, offset=0.0)
    Ng = sculpt.grad(P0)
    roots, dirs, lens, clear = [], [], [], []
    for p, g, d in zip(P0, Ng, cand):
        f = flow_fn(p, g) if flow_fn else V(0, 1, -0.3)
        f = f - g * np.dot(f, g)
        f = norm(f) if np.linalg.norm(f) > 1e-6 else norm(np.cross(g, V(1, 0, 0)))
        roots.append(p - g * 0.003)
        dirs.append(norm(f + g * 0.06))
        lens.append((length_fn(d) if length_fn else 0.4) * rng.uniform(0.9, 1.08))
        clear.append(clearance * rng.uniform(0.8, 1.4))

    def flow(Pp, t):
        return np.zeros_like(Pp)
    paths = drape_locks(sculpt, np.array(roots), np.array(dirs), np.array(lens), steps=steps,
                        clearance=np.array(clear), gravity=gravity, stiff=stiff, flow=flow,
                        gravity_ramp=lambda dist: np.clip((dist - hug) / 0.08, 0.0, 1.0),
                        clear_ramp=lambda dist: clear_add * np.clip((dist - hug) / 0.15, 0.0, 1.0), hug=hug)
    out = []
    for i, path in enumerate(paths):
        path = np.array(path)
        if wave > 0:   # lateral S-wave in the plane perpendicular to the lock and the scalp normal
            T = np.gradient(path, axis=0)
            T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
            side = np.cross(T, np.tile(Ng[i], (len(path), 1)))
            side /= np.maximum(np.linalg.norm(side, axis=1, keepdims=True), 1e-9)
            sl = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
            ph = rng.uniform(0, 2 * math.pi)
            amp = wave * np.clip(sl / 0.12, 0, 1)
            path = path + side * (amp * np.sin(sl / wave_len * 2 * math.pi + ph))[:, None]
        out.append(dict(path=path, width=rng.uniform(*width), thick=rng.uniform(*thick), root_dir=cand[i],
                        normal=Ng[i]))
    return out


# ============================================================================ sculpted clump hair (SDF)
def _side_vectors(path, normal):
    T = np.gradient(np.asarray(path, float), axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    Sd = np.cross(T, np.tile(normal, (len(path), 1)))
    Sd /= np.maximum(np.linalg.norm(Sd, axis=1, keepdims=True), 1e-9)
    return T, Sd


def clump_sculpt(clumps, mat="hair", materials=("hair",), detail="hi", nseg=22, grooves=3, split_tips=True,
                 tip_r=0.0011, k_clump=0.0035, k_mass=0.007, seed=5, tip_frac=0.55, root_frac=0.15,
                 root_thick=0.75):
    """Heavy stylised hair as ONE watertight SDF volume (manes, beards, horse tails, fur ruffs).

    Each clump from groom() becomes a flattened, tapering tube (width across the flow, thickness off the scalp)
    smooth-unioned into the mass, so roots fuse into a solid cap while tips separate into points.
    detail='hi' splits each clump into `grooves` sub-strands (fine grooves for the normal bake) and forks the
    last third of every clump into two diverging tips; detail='lo' keeps one smooth tube per clump but the same
    silhouette (forked tips included), for the game mesh. Returns (Sculpt, meta) where meta holds per-clump
    resampled paths for path_attrs()."""
    from .sdf import Sculpt, Chain, Union
    rng = np.random.RandomState(seed)
    S = Sculpt(materials=list(materials), default_mat=mat)
    meta = []
    for ci, c in enumerate(clumps):
        P = resample_path(c["path"], nseg)
        T, Sd = _side_vectors(P, c["normal"])
        w, t = float(c["width"]), float(c["thick"])
        # root_thick < 0.75 tapers each clump INTO the scalp (blunt roots read as flaps lifting off the crown)
        thick = taper_profile(nseg, t * root_thick, t, tip_frac=tip_frac, root_frac=root_frac)
        width = taper_profile(nseg, w * 0.8, w, tip_frac=tip_frac * 0.9, root_frac=root_frac)
        thick = np.maximum(thick, tip_r * 2)
        width = np.maximum(width, tip_r * 2)
        ref = Sd[len(P) // 3]
        parts = []
        fork_at = int(nseg * rng.uniform(0.58, 0.72)) if split_tips else nseg
        spread = rng.uniform(0.12, 0.22)

        def tube(Q, wid, thk):
            sq = float(np.clip(np.mean(wid[:max(2, len(wid) // 2)] / thk[:max(2, len(thk) // 2)]), 1.0, 4.0))
            r = np.maximum(thk * 0.5, tip_r)
            return Chain(list(Q), list(r), squash=(sq, 1.0), ref=tuple(ref), margin=0.02)

        def strands(Q, wid, thk, lo_ok=True):
            if detail == "lo" or grooves <= 1:
                return [tube(Q, wid, thk)]
            out = []
            m = len(Q)
            _, SdQ = _side_vectors(Q, c["normal"])
            for g in range(grooves):
                off = (g - (grooves - 1) / 2) / grooves               # -1/3 .. 1/3 of the width
                jitter = rng.uniform(-0.12, 0.12)
                Qg = Q + SdQ * (wid * (off + jitter / grooves))[:, None]
                Qg = Qg + np.gradient(Q, axis=0) * 0.0                # keep the flow
                out.append(tube(Qg, wid / grooves * 1.35, thk * rng.uniform(0.82, 1.0)))
            return out

        base_n = fork_at + 1
        parts += strands(P[:base_n], width[:base_n], thick[:base_n])
        if split_tips and fork_at < nseg - 2:
            tail = P[fork_at:]
            u = np.linspace(0, 1, len(tail))
            for sgn in (1, -1):
                drift = Sd[fork_at:] * (sgn * w * spread * u ** 1.3)[:, None]
                Qt = tail + drift
                parts += strands(Qt, width[fork_at:] * 0.66, thick[fork_at:] * 0.84)
        S.add(Union(*parts, k=k_clump) if len(parts) > 1 else parts[0], k_mass)
        meta.append(dict(path=P, side=Sd, tangent=T, width=w, thick=t, id=ci))
    return S, meta


def path_attrs(X, meta, chunk=6000):
    """Per-point attributes from the nearest clump path sample: along (0 root..1 tip), lock_id, lateral
    (-1..1 across the clump), flow tangent (3). Used by the hair painters and for root->head skin overrides."""
    X = np.asarray(X, float)
    Pp = np.concatenate([m["path"] for m in meta])
    Tt = np.concatenate([m["tangent"] for m in meta])
    Sd = np.concatenate([m["side"] for m in meta])
    al = np.concatenate([np.linspace(0, 1, len(m["path"])) for m in meta])
    lid = np.concatenate([np.full(len(m["path"]), m["id"], float) for m in meta])
    wid = np.concatenate([np.full(len(m["path"]), m["width"], float) for m in meta])
    n = len(X)
    out = dict(along=np.empty(n), lock_id=np.empty(n), lateral=np.empty(n), flow=np.empty((n, 3)))
    P2 = (Pp ** 2).sum(1)
    for i in range(0, n, chunk):
        x = X[i:i + chunk]
        d2 = (x ** 2).sum(1)[:, None] - 2 * x @ Pp.T + P2[None, :]
        j = np.argmin(d2, axis=1)
        out["along"][i:i + chunk] = al[j]
        out["lock_id"][i:i + chunk] = lid[j]
        out["lateral"][i:i + chunk] = np.clip(np.sum((x - Pp[j]) * Sd[j], axis=1) / (wid[j] * 0.5), -1, 1)
        out["flow"][i:i + chunk] = Tt[j]
    return out


def _slerp(a, b, t):
    a, b = norm(a), norm(b)
    om = math.acos(max(-1.0, min(1.0, float(np.dot(a, b)))))
    if om < 1e-5:
        return a
    return (math.sin((1 - t) * om) * a + math.sin(t * om) * b) / math.sin(om)


def scalp_radius(sculpt, c, dirs, r_max=0.3):
    """Distance from an interior point c along each unit direction to the first surface exit (ray march)."""
    dirs = np.asarray(dirs, float)
    t = np.zeros(len(dirs))
    done = np.zeros(len(dirs), bool)
    for _ in range(200):
        d = sculpt.dist(c + dirs * t[:, None])
        done |= d >= 0
        if done.all():
            break
        t = np.where(done, t, np.minimum(t + np.maximum(-d, 0.0008), r_max))
    return t


def groom_swept(sculpt, head_c, region_fn, exit_fn, length_fn, n=64, seed=11, width=(0.06, 0.09),
                thick=(0.02, 0.03), clearance=0.4, clear_add=0.01, arc_steps=10, fall_steps=22, fall_bend=0.3,
                wave=0.012, wave_len=0.2):
    """Designed (not simulated) groom for swept-back manes / tails: every clump first ARCS over the scalp from its
    root direction to exit_fn(root_dir) (a direction on the head, e.g. the nape), hugging the skull at
    `clearance` x its thickness, then FALLS under gravity with body collision for the rest of length_fn(root_dir).
    So no clump can ever flop over the face, whatever the proportions. Roots: golden-spiral directions from head_c
    filtered by region_fn(dir). Returns groom()-compatible clump dicts (path, width, thick, root_dir, normal)."""
    rng = np.random.RandomState(seed)
    golden = math.pi * (3 - math.sqrt(5))
    cand = []
    N = n * 8
    # hero-seraphine C1 r6 (additive): clearance may be a (lo, hi) range -> per-clump jitter, so neighbouring clumps
    # ride at different heights and read as overlapping masses instead of fusing into one smooth shell
    clear_rng = clearance if isinstance(clearance, (tuple, list)) else None
    for i in range(N):
        z = 1 - 2 * (i + 0.5) / N
        r = math.sqrt(max(0, 1 - z * z))
        a = i * golden
        d = V(math.cos(a) * r, math.sin(a) * r, z)
        if region_fn(d):
            cand.append(d)
    cand = np.array(cand)
    if len(cand) > n:
        cand = cand[np.linspace(0, len(cand) - 1, n).astype(int)]
    m = len(cand)
    W = rng.uniform(*width, size=m)
    TH = rng.uniform(*thick, size=m)
    LEN = np.array([length_fn(d) for d in cand]) * rng.uniform(0.9, 1.08, size=m)
    ts = np.linspace(0, 1, arc_steps + 1)
    DIRS = np.array([[_slerp(d0, exit_fn(d0), t) for t in ts] for d0 in cand])          # (m, k, 3)
    rr = scalp_radius(sculpt, head_c, DIRS.reshape(-1, 3)).reshape(m, -1)
    CL = rng.uniform(clear_rng[0], clear_rng[1], size=m) if clear_rng else np.full(m, float(clearance))
    lift = (TH * CL)[:, None] + clear_add * ts[None, :] ** 1.5
    ARC = head_c + DIRS * (rr + lift)[..., None]
    ARC[:, 0] = head_c + DIRS[:, 0] * (rr[:, 0] + TH * 0.15)[:, None]
    arc_len = np.linalg.norm(np.diff(ARC, axis=1), axis=2).sum(axis=1)
    rest = np.maximum(LEN - arc_len, 0.02)
    ds = rest / fall_steps
    P = ARC[:, -1].copy()
    v = norm_rows(ARC[:, -1] - ARC[:, -2])
    clear = TH * 0.55 + clear_add
    g = V(0, 0, -1)
    falls = []
    for k in range(fall_steps):
        v = norm_rows(v * (1 - fall_bend) + g * fall_bend)
        P = P + v * ds[:, None]
        for _ in range(3):
            dd = sculpt.dist(P) - clear
            bad = dd < 0
            if not bad.any():
                break
            gr = sculpt.grad(P[bad])
            P[bad] -= gr * dd[bad][:, None]
            vb = v[bad]
            v[bad] = norm_rows(vb - gr * np.minimum(np.sum(vb * gr, axis=1), 0)[:, None])
        clear = clear + clear_add * 0.35 / fall_steps
        falls.append(P.copy())
    FALL = np.stack(falls, axis=1)
    NRM = sculpt.grad(ARC[:, 0])
    out = []
    for i in range(m):
        path = np.concatenate([ARC[i], FALL[i]])
        nrm = NRM[i]
        if wave > 0:
            T = np.gradient(path, axis=0)
            T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
            side = np.cross(T, np.tile(nrm, (len(path), 1)))
            side /= np.maximum(np.linalg.norm(side, axis=1, keepdims=True), 1e-9)
            sl = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
            ph = rng.uniform(0, 2 * math.pi)
            amp = wave * np.clip((sl - arc_len[i] * 0.7) / 0.12, 0, 1)
            path = path + side * (amp * np.sin(sl / wave_len * 2 * math.pi + ph))[:, None]
        out.append(dict(path=path, width=float(W[i]), thick=float(TH[i]), root_dir=cand[i], normal=nrm))
    return out
