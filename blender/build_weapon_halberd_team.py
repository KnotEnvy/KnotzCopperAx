"""Scratch-only r22 halberd fork. Run through tools/blender-run.mjs with --fast|--release --out <dir>.
Crescent axe, top spike, opposite back hook, langets and leather-wrapped haft; unchanged Sept grip nodes.
"""
import os
import sys
import math
import time
import bpy
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import skelknight_team as TEAM
import importlib
import numpy as np

import build_weapon_sword_bone as W
importlib.reload(W)
from lib import meshutil, shaders, pipeline, charkit
from lib.sdf import (V, norm, rot, basis, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace, Inter, Union, Diff,
                     RoundCone, RoundBox, Torus, Slab, Displace)

ROOT = os.path.dirname(HERE)
OUT_MODELS = TEAM.out_dir("knight", "knight", "out", "iter1")
OUT_TEX = os.path.join(OUT_MODELS, "textures")
KINDS = W.KINDS
PAINTERS = W.PAINTERS
CONFIG = dict(seed=22, tris=2800, atlas=1024)

AXE_Z = 1.14
TOP = 1.5
BUTT = -0.62


def cyl_y(c, r, half=0.1):
    """Infinite-ish cylinder along Y (2-D disc in the XZ blade plane once intersected with a slab)."""
    return Capsule(V(c[0], -half, c[2]), V(c[0], half, c[2]), r)


def halberd_sculpt():
    S = Sculpt(materials=W.MATS, default_mat="wood")
    # haft
    S.add(RoundCone(V(0, 0, BUTT + 0.04), V(0, 0, AXE_Z - 0.02), 0.019, 0.017), 0.0, mat="wood")
    # butt cap + spike
    S.add(RoundCone(V(0, 0, BUTT + 0.1), V(0, 0, BUTT + 0.03), 0.021, 0.024), 0.004, mat="iron")
    S.add(RoundCone(V(0, 0, BUTT + 0.03), V(0, 0, BUTT - 0.03), 0.02, 0.004), 0.004, mat="iron")
    # grips (main at origin, off hand at -0.34) with raised binding rings
    for zc in (0.0, -0.34):
        S.add(RoundCone(V(0, 0, zc - 0.07), V(0, 0, zc + 0.07), 0.0205, 0.0205), 0.003, mat="leather")
        for dz in (-0.075, 0.075):
            S.add(Torus(V(0, 0, zc + dz), 0.02, 0.0045), 0.002, mat="leather")
    # socket + langets (iron straps down the haft)
    S.add(RoundCone(V(0, 0, AXE_Z - 0.13), V(0, 0, AXE_Z + 0.16), 0.025, 0.022), 0.004, mat="iron")
    for z in (AXE_Z - 0.12, AXE_Z + 0.15):
        S.add(Torus(V(0, 0, z), 0.026, 0.006), 0.002, mat="iron")
    for sy in (1, -1):
        S.add(RoundBox(V(0, sy * 0.018, AXE_Z - 0.26), V(0.008, 0.004, 0.14), r=0.003), 0.003, mat="iron")
        for z in (AXE_Z - 0.36, AXE_Z - 0.2):
            S.add(Sphere(V(0, sy * 0.022, z), 0.005), 0.001, mat="iron")
    # axe blade: bearded crescent in the XZ plane, lens thickness toward the edge
    shape = Inter(cyl_y(V(0.045, 0, AXE_Z), 0.30), HalfSpace(V(0.012, 0, 0), V(-1, 0, 0)), k=0.004)
    shape = Diff(shape, Union(cyl_y(V(0.1, 0, AXE_Z + 0.33), 0.19), cyl_y(V(0.13, 0, AXE_Z - 0.34), 0.18)),
                 k=0.006)
    thick = Inter(HalfSpace(V(0.22, 0.0, 0), norm(V(0.055, 1, 0))), HalfSpace(V(0.22, 0.0, 0), norm(V(0.055, -1, 0))))
    blade = Inter(shape, Union(thick, Slab(V(0, 0, 0), V(0, 1, 0), 0.0028), k=0.002), Slab(V(0, 0, 0), V(0, 1, 0), 0.012))
    S.add(blade, 0.004, mat="steel")
    # dark 'fuller' band along the edge curve (raised ridge) + rivets
    for sy in (1, -1):
        S.add(Inter(Diff(cyl_y(V(-0.07, 0, AXE_Z), 0.215), cyl_y(V(-0.07, 0, AXE_Z), 0.2)), shape,
                    Slab(V(0, sy * 0.006, 0), V(0, 1, 0), 0.004), k=0.002), 0.003, mat="steel")
        for dz in (-0.07, 0.07):
            S.add(Sphere(V(0.04, sy * 0.01, AXE_Z + dz), 0.0075), 0.002, mat="iron")
    # hooked back spike
    pts = [V(-0.02, 0, AXE_Z + 0.01), V(-0.09, 0, AXE_Z + 0.0), V(-0.15, 0, AXE_Z - 0.03), V(-0.18, 0, AXE_Z - 0.08)]
    S.add(Chain(pts, [0.02, 0.016, 0.01, 0.0035], squash=(0.45, 1.0), ref=(0, 1, 0)), 0.006, mat="steel")
    # top spike (diamond section)
    z0 = AXE_Z + 0.15
    S.add(RoundCone(V(0, 0, z0), V(0, 0, TOP), 0.024, 0.002, squash=(0.42, 1.0), ref=(0, 1, 0)), 0.006,
          mat="steel")
    S.add(Ellipsoid(V(0, 0, z0 + 0.01), V(0.032, 0.02, 0.022)), 0.006, mat="iron")
    # tattered pennon under the head (flat, hangs on the -X side of the haft)
    pen = Inter(Slab(V(0, 0, 0), V(0, 1, 0), 0.0035), RoundBox(V(-0.1, 0, AXE_Z - 0.3), V(0.09, 0.02, 0.09),
                                                               r=0.01),
                Union(*[Ellipsoid(V(-0.1 + dx, 0, AXE_Z - 0.2 + dz), V(0.035, 0.1, 0.19))
                        for dx, dz in ((-0.07, -0.02), (-0.02, 0.02), (0.035, -0.04), (0.075, 0.0))], k=0.01),
                k=0.003)
    S.add(Displace(pen, 0.0015, 22.0, 2, seed=7), 0.004, mat="cloth")
    return S


PAL = dict(W.PAL, steel=shaders.srgb(68, 66, 64), rust_amt=0.30, wood=shaders.srgb(70, 46, 30),
           cloth=shaders.srgb(40, 38, 52))


def bake_weapon(S, name, lo, hi, tris, pal, nodes, fast=False, painters=None, h_hi=None, h_lo=0.0016,
                density=1.0):
    """SDF weapon -> HI (bake source) + LO (budget) -> smart UV -> albedo/prm/ao/normal bake -> GLB with nodes."""
    T0 = time.time()
    res = CONFIG["atlas"]
    pipeline.setup_cycles("AUTO")
    hi_ob = pipeline.sculpt_mesh(S, name + "_hi", h_hi or (0.0009 if fast else 0.0005), lo, hi)
    lo_ob = pipeline.lowpoly(S, name + "_lo", h_lo, tris, lo, hi, symmetry=False,
                             clean=lambda o: charkit.drop_islands(o, h_lo, min_verts=20))
    charkit.drop_islands(lo_ob, 0.0036, min_verts=20)
    lo_ob.data.validate()
    qa = charkit.geom_qa(lo_ob)
    charkit.smart_uv(lo_ob, 60.0, density)
    fill = pipeline.pack_atlas_shape([lo_ob], margin_px=4, res=res)
    shaders.assign_bake_materials(hi_ob, S.materials, prefix="wk_", kinds=KINDS)
    shaders.paint_mesh(hi_ob, S.materials, {}, pal, {}, painters=dict(PAINTERS, **(painters or {})))
    pipeline.set_ray_visibility(lo_ob, False)
    B = pipeline.Baker(res, [(lo_ob, [hi_ob], 0.004, 0.012)], shaders.set_pass, [lo_ob], [hi_ob])
    maps = B.run(passes=[("albedo", "EMIT", 4), ("prm", "EMIT", 2), ("ao", "EMIT", 32 if fast else 64),
                         ("normal", "NORMAL", 8)])
    tex = charkit.composite_maps(maps, OUT_TEX, name, tint=(0.5, 0.36, 0.3), dil=12)
    mat = pipeline.final_material("M_" + name, tex["albedo"], tex["normal"], tex["orm"])
    lo_ob.data.materials.clear()
    lo_ob.data.materials.append(mat)
    pipeline.strip_for_export(lo_ob)
    bpy.data.objects.remove(hi_ob, do_unlink=True)
    lo_ob.name = name
    empties = []
    for nm, p in nodes.items():
        e = bpy.data.objects.new(nm, None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.03
        bpy.context.scene.collection.objects.link(e)
        e.location = tuple(float(x) for x in p)
        e.parent = lo_ob
        empties.append(e)
    bpy.context.view_layer.update()
    out = os.path.join(OUT_MODELS, name + ".glb")
    TEAM.guard_out(out)
    pipeline.export_glb(out, [lo_ob] + empties, scene_name=name)
    TEAM.patch_extras(out, {"M_" + name: {"rim": 0.65}})
    rep = dict(asset=name, tris=meshutil.tri_count(lo_ob), uv_fill=fill, geom_qa=qa, seconds=time.time() - T0,
               mb=os.path.getsize(out) / 1e6, nodes={k: [float(x) for x in v] for k, v in nodes.items()})
    pipeline.write_json(TEAM.guard_out(os.path.join(OUT_MODELS, name + "_report.json")), rep)
    pipeline.log(f"DONE {out} {rep['tris']} tris {rep['seconds']:.0f}s qa={qa}")
    return rep


def p_halberd_steel(c, pal):
    """Blackened steel head with narrow bright worn crescent/spike edges."""
    rgb, rough, metal, emit = W.p_steel_rust(c, pal)
    wear = np.clip(c.ridge*1.35, 0, 1)
    edge = pal.get("steel_edge", shaders.srgb(190, 188, 178))
    rgb = shaders.mix(rgb, edge, 0.85*wear)
    return shaders.out(c.n, rgb, np.clip(rough, 0.25, 0.9), metal)


def p_pennant(c,pal):
    rgb=np.tile(pal["cloth"],(c.n,1))*(.94+.08*c.noise(45,2,233))[:,None]
    if pal["rank"]=="gold":
        # Purple field with a gold fly/hem and an embroidered chevron. Same original geometry and grips.
        P=c.P
        border=(P[:,0]<-.171)|(P[:,2]<AXE_Z-.378)
        chevron=np.abs(P[:,2]-(AXE_Z-.30)-.45*np.abs(P[:,0]+.10))<.006
        rgb=np.where((border|chevron)[:,None],pal["cloth_trim"],rgb)
    return shaders.out(c.n,rgb,.78,0.)


def main():
    global OUT_MODELS, OUT_TEX
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    modes = ap.add_mutually_exclusive_group()
    modes.add_argument("--fast", action="store_true")
    modes.add_argument("--release", action="store_true")
    ap.add_argument("--tiers", default="silver,red,gold")
    ap.add_argument("--out", default=TEAM.out_dir("knight", "knight", "out", "iter1"))
    a = ap.parse_args(argv)
    OUT_MODELS = TEAM.guard_out(os.path.abspath(a.out))
    OUT_TEX = TEAM.guard_out(os.path.join(OUT_MODELS, "textures"))
    os.makedirs(OUT_MODELS, exist_ok=True)
    os.makedirs(OUT_TEX, exist_ok=True)
    reports={}
    for tier in a.tiers.split(","):
        meshutil.clear_scene()
        S = halberd_sculpt()
        pal=TEAM.tier_pal("knight",tier,defaults=PAL)
        pal["rank"]=tier
        name="weapon_halberd" if tier=="silver" else "weapon_halberd_"+tier
        reports[tier]=bake_weapon(S,name,V(-0.24,-0.04,BUTT-.05),V(.36,.04,TOP+.02),CONFIG["tris"],pal,
                {"grip_main":V(0,0,0),"grip_offhand":V(0,0,-.34),"head_tip":V(.2,0,AXE_Z),
                 "blade_tip":V(0,0,TOP)},fast=a.fast,painters={"steel":p_halberd_steel,"cloth":p_pennant},
                 h_hi=.0009 if a.fast else .0006,density=1.0)
    pipeline.write_json(TEAM.guard_out(os.path.join(OUT_MODELS,"halberd_report.json")),reports)



if __name__ == "__main__":
    main()
