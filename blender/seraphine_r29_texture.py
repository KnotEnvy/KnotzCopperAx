"""r29 two-sheet compositor. Role inputs are immutable; all corrections are copies.

Blender entry: pack_sheets(groups, objs, arm, fast, release).
No-slot entry: asset-venv/python -I blender/seraphine_r29_texture.py --prepare OUT.
Pixel work uses PIL/scipy in the asset venv, never Blender's colour management.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import seraphine_r29_team as T

TEAMDIR = Path(T.TEAM)      # r30 opt-in: KCA_SERAPHINE_TEAM (seraphine_r29_team); unset = progress/tmp/seraphine_r29
R30 = os.environ.get("KCA_SERAPHINE_TEXTURE_PROFILE") == "r30"   # opt-in r30 gear finish (round scales, bronze rim read)

CONFIG = {
    "out": str(TEAMDIR / "texture"),
    "res": 2048, "body_rim": .75, "groom_rim": .025,
    "dilation": 16, "groom_dilation": 20,
    "normal_gain": 2.15, "abdomen_normal_gain": 2.65,
    "ao_gain": 1.65, "cavity_tone": .22,
    "skin_roughness": .59,
    "scale_columns": 36, "scale_rows": 8,
    "skin_rgb": [177,125,88], "muscle_relief_gain": .8,
    # Value ladder: leather 23, hair 35, cloth 31, skin 56, bronze 64.5, fur 73.
    "gear_targets": {"bronze": 64.5, "leather": 23., "cloth": 31.,
                     "fur": 73., "gold": 65., "teal": 41.},
    "patches": {"scale": [.02,.56,.98,.98], "bronze": [.02,.435,.98,.535],
                "leather": [.02,.315,.98,.415], "cloth": [.02,.14,.98,.295],
                "fur": [.02,.065,.66,.12], "gold": [.70,.065,.98,.12],
                "teal": [.02,.015,.45,.045]},
}


def log(s):
    print("[seraphine-r29-texture] " + s, flush=True)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def smooth(x):
    x = np.clip(x, 0, 1)
    return x*x*(3-2*x)


def unit(x):
    return x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-12)


def linear(rgb):
    rgb=np.clip(rgb,0,1)
    return np.where(rgb <= .04045, rgb/12.92, ((rgb+.055)/1.055)**2.4)


def srgb(rgb):
    rgb = np.maximum(rgb, 0)
    return np.where(rgb <= .0031308, rgb*12.92, 1.055*rgb**(1/2.4)-.055)


def lstar(rgb):
    y = linear(rgb) @ np.array([.2126,.7152,.0722])
    return np.where(y > .008856, 116*np.cbrt(y)-16, 903.3*y)


def grade_value(rgb, mask, target):
    """Preserve hue and local relief while setting a material's median L*."""
    if not np.any(mask):
        return
    med = float(np.median(lstar(rgb[mask])))
    gain = ((target+16)/(med+16))**3
    rgb[mask] = np.clip(srgb(linear(rgb[mask])*gain), 0, 1)


def load_maps(role, tile):
    from PIL import Image
    directory = TEAMDIR
    directory /= "frozen/body/tiles" if role == "body" else f"parts/{role}/tiles"
    paths = {k: directory / f"{tile}_{k}.png" for k in ("albedo", "orm", "normal")}
    maps = {k: np.asarray(Image.open(p).convert("RGBA"), np.float32)[::-1].copy()/255
            for k,p in paths.items()}
    return maps, {str(p.relative_to(ROOT)): sha(p) for p in paths.values()}


def raster(part, width=1280, height=2048):
    """Position/normal interpolation in the existing UV frame; no mesh changes."""
    cov = np.zeros((height,width), bool)
    pos = np.zeros((height,width,3), np.float32)
    nor = np.zeros_like(pos)
    tangent=np.zeros_like(pos);bitangent=np.zeros_like(pos)
    for f, uv, normal in zip(part["F"], part["UV"], part["N"]):
        u = uv*np.array([width,height])-.5
        lo = np.maximum(np.floor(u.min(0)).astype(int), 0)
        hi = np.minimum(np.ceil(u.max(0)).astype(int), [width-1,height-1])
        if np.any(hi<lo):
            continue
        e, g = u[1]-u[0], u[2]-u[0]
        det = e[0]*g[1]-e[1]*g[0]
        if abs(det)<1e-10:
            continue
        yy,xx=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
        x,y=xx-u[0,0],yy-u[0,1]
        b=(x*g[1]-y*g[0])/det; c=(e[0]*y-e[1]*x)/det; a=1-b-c
        mask=(a>=-1e-5)&(b>=-1e-5)&(c>=-1e-5)
        iy,ix=yy[mask],xx[mask]
        bary=np.stack([a[mask],b[mask],c[mask]],-1)
        pos[iy,ix]=bary@part["P"][f]
        nor[iy,ix]=unit(bary@normal)
        dp=part["P"][f];du=uv[1]-uv[0];dv=uv[2]-uv[0]
        determinant=du[0]*dv[1]-du[1]*dv[0]
        tf=((dp[1]-dp[0])*dv[1]-(dp[2]-dp[0])*du[1])/determinant
        bf=(-(dp[1]-dp[0])*dv[0]+(dp[2]-dp[0])*du[0])/determinant
        nn=nor[iy,ix]
        tangent[iy,ix]=unit(tf-nn*(nn@tf)[:,None])
        bitangent[iy,ix]=unit(np.cross(nn,tangent[iy,ix]))*np.sign(np.einsum('ij,j->i',np.cross(nn,tangent[iy,ix]),bf))[:,None]
        cov[iy,ix]=True
    return pos,nor,cov,tangent,bitangent


def dilate(maps, cov, pixels, alpha=False):
    from scipy.ndimage import distance_transform_edt
    dist,idx=distance_transform_edt(~cov,return_indices=True)
    fill=(~cov)&(dist<=pixels)
    for key,a in maps.items():
        keep=a[...,3].copy()
        a[fill]=a[tuple(idx[:,fill])]
        if alpha and key == "albedo":
            a[...,3]=keep
    return int(fill.sum())


def face_finish(maps, pos, cov):
    """Symmetric world-space cosmetics tied to frozen facial surface landmarks."""
    from scipy.spatial import cKDTree
    import seraphine_r29_body as body
    x,y,z=pos.transpose(2,0,1); ax=np.abs(x)
    alb=linear(maps["albedo"][...,:3]); orm=maps["orm"]
    # Semantic lips/eyelids keep pigment on the actual anatomy, including side view.
    base=body.load_base(); p=np.load(TEAMDIR/"frozen/body/body.npz")["P"]
    dist,idx=cKDTree(p[:len(base["P"])]).query(pos[cov],k=4)
    weights=1/np.maximum(dist,.0001); weights/=weights.sum(1,keepdims=True)
    def semantic(ids):
        a=np.zeros(cov.shape,np.float32)
        a[cov]=(weights*np.isin(base["vset"][idx],ids)).sum(1)
        return a
    eye=semantic([2,3]); lips=semantic([7,8]); front=smooth((-y-.065)/.025)*cov
    def blend(col,mask):
        nonlocal alb
        m=np.clip(mask,0,1)[...,None]
        alb=alb*(1-m)+linear(np.array(col)/255)*m
    # Replace the old cosmetic regions on the outer surface; source tiles stay intact.
    reset=((z>1.662)&(z<1.689)&(ax>.010)&(ax<.072))|((z>1.595)&(z<1.640)&(ax>.029))|((z>1.568)&(z<1.600)&(ax<.034))
    reset*=front>.7
    alb[reset]=linear(np.array(CONFIG["skin_rgb"])/255)*(.98+.015*np.cos(x[reset]*150))[:,None]
    # Tapered brow arch with individual oblique hairs, narrower than the old bars.
    dx=ax-.0323; dz=z-1.6502
    arch=.018+.007*np.exp(-((dx-.010)/.016)**2)-.008*smooth((dx-.020)/.016)
    thick=.0028-.0017*smooth((dx-.008)/.024)
    brow=np.exp(-((dz-arch)/thick)**4)*smooth((dx+.022)/.006)*smooth((.038-dx)/.010)*front
    hairs=.72+.28*(.5+.5*np.sin(ax*2400+(z-1.65)*1700))
    blend([54,29,18],brow*hairs*.95)
    # Soft eyeliner at the upper lid and a restrained warm lower rim.
    near=(np.abs(dx)<.032)&(np.abs(dz)<.024)
    rim=np.exp(-((eye-.23)/.20)**2)*smooth((eye-.035)/.075)*near*front
    upper=smooth((dz+.001)/.0025)
    blend([27,15,12],rim*upper*.92)
    blend([91,54,40],rim*(1-upper)*.58*smooth((dx+.018)/.015))
    almond=np.sqrt(np.maximum(0,1-(dx/.015)**2))
    lidz=1.649+.006*almond+.09*dx
    lid=np.exp(-((z-lidz)/.0015)**2)*smooth((.017-np.abs(dx))/.004)*front
    blend([26,14,10],lid*.98)
    crease=np.exp(-((z-lidz-.004)/.0018)**2)*smooth((.020-np.abs(dx))/.006)*front
    blend([113,68,43],crease*.42)
    # Outer canthus liner, tapered, follows the upward outer corner.
    wing=np.exp(-((dz-(.002+(dx-.020)*.30))/.0017)**2)
    wing*=smooth((dx-.018)/.005)*smooth((.034-dx)/.012)*front
    blend([40,21,16],wing*.6)
    # Cheek colour and contour: broad soft plane shading, no drawn cheek lines.
    cheek=np.exp(-((ax-.053)/.023)**2-((z-1.614)/.018)**2)*front
    blend([182,102,75],cheek*.16)
    contour=np.exp(-((ax-.061)/.024)**2-((z-1.593)/.018)**2)*front
    alb*=1-contour[...,None]*np.array([.055,.075,.08])
    # Reinforce exactly the existing two swipes, with feathered broken edges.
    t=(ax-.031)/.040
    for off in (0,.014):
        zc=1.616-off+.015*t
        edge=.0053*(1-.4*np.clip(t,0,1))
        band=np.exp(-((z-zc)/edge)**4)*smooth((t+.02)/.15)*smooth((1.05-t)/.25)*front
        band*=.82+.18*np.sin(ax*1730+z*2270)**2
        blend([175,75,36],band*.97)
        orm[...,1]=orm[...,1]*(1-band)+.8*band
    mouthz=1.5825+.0015*(ax/.027)**2
    upperlip=.0035+.0014*np.exp(-((ax-.008)/.0045)**2)
    lipheight=np.where(z>mouthz,upperlip,.0055)
    lip=np.exp(-((z-mouthz)/lipheight)**4)*smooth((.028-ax)/.007)*front*smooth((-y-.122)/.012)
    blend([150,71,54],lip*.98)
    lipline=np.exp(-((z-mouthz)/.00095)**2)*smooth((.028-ax)/.007)*lip
    blend([80,33,28],lipline*.88)
    roll=np.exp(-((z-1.5792)/.0018)**2)*np.exp(-(x/.018)**2)*lip
    blend([206,127,96],roll*.48)
    orm[...,1]=orm[...,1]*(1-lip)+.49*lip
    maps["albedo"][...,:3]=np.clip(srgb(alb),0,1)
    return {"method":"symmetric surface-space masks and semantic eyelid/lip sets; two ochre swipes",
            "select_grade":"unchanged"}


def skin_finish(maps):
    frozen=TEAMDIR/"frozen/body/body.npz"
    z=np.load(frozen); part={k:z[k] for k in ("P","F","UV","N")}
    pos,nor,cov,tangent,bitangent=raster(part)
    x,y,h=pos.transpose(2,0,1)
    body=(1-smooth((h-1.47)/.05))*cov
    # Material correction toward the sheet's lower warm-tan range, never floor matching.
    colour=maps["albedo"][...,:3]
    sk=(colour[...,0]>.5)&(colour[...,1]>.36)&(colour[...,1]<.7)&(colour[...,2]<.55)
    factor=linear(np.array(CONFIG["skin_rgb"])/255)/linear(np.array([186,138,106])/255)
    colour[sk]=srgb(linear(colour[sk])*factor)
    ab=np.exp(-((h-1.16)/.13)**4)*np.exp(-(x/.13)**4)*smooth((-nor[...,1]-.1)/.5)*body
    gain=1+body*(CONFIG["normal_gain"]-1)+ab*(CONFIG["abdomen_normal_gain"]-CONFIG["normal_gain"])
    n=maps["normal"][...,:3]*2-1
    # Retain baked directions; amplification is bounded to avoid bake-ray spikes.
    n[...,:2]*=gain[...,None]
    # Reinforce the body's own sculpt field in its existing tangent frame. This
    # is surface relief (millimetres), not painted abs or new low-poly geometry.
    import seraphine_r29_body as source
    ids=cov&(h<1.48);p=pos[ids];nn=nor[ids];tt=tangent[ids];bb=bitangent[ids]
    J=T.Rig().joints;eps=.001
    field=lambda q:source.muscle_field(q,nn,J,amp=CONFIG["muscle_relief_gain"])
    relief=field(p)
    dtu=(field(p+eps*tt)-field(p-eps*tt))/(2*eps)
    dtv=(field(p+eps*bb)-field(p-eps*bb))/(2*eps)
    n[...,0][ids]-=np.clip(dtu,-.55,.55)
    n[...,1][ids]-=np.clip(dtv,-.55,.55)
    n=unit(n)
    maps["normal"][...,:3]=(n+1)/2
    ao=maps["orm"][...,0]
    maps["orm"][...,0]=np.clip(1-(1-ao)*(1+body*(CONFIG["ao_gain"]-1)),.42,1)
    sculpt_cavity=np.zeros(cov.shape,np.float32)
    sculpt_cavity[ids]=np.clip(-relief/.002,0,1)*.10
    maps["orm"][...,0]*=1-sculpt_cavity
    cavity=np.clip(1-ao,0,.30)*body
    maps["albedo"][...,:3]=srgb(linear(maps["albedo"][...,:3])*(1-CONFIG["cavity_tone"]*cavity[...,None]-sculpt_cavity[...,None]*.55))
    maps["orm"][...,1]=maps["orm"][...,1]*(1-body)+CONFIG["skin_roughness"]*body
    face=(__import__('seraphine_r30_head').face_finish if R30 else face_finish)(maps,pos,cov)   # r30 HEAD face finish (opt-in)
    # Eyeball islands remain in place. Warm whites, softened limbus, real catchlight.
    for x0 in (1008,1144):
        a=maps["albedo"][8:72,x0:x0+128,:3]
        lat=(63.5-np.arange(64)[:,None])/64*180; lon=(np.arange(128)[None,:]+.5)/128*360
        a[:]=[.84,.82,.79]
        rad=np.clip(lat/36,0,1)*np.ones((1,128)); iris=rad<1
        iriscol=np.stack([.52-.17*rad,.35-.13*rad,.14-.07*rad],-1)
        spokes=.93+.07*np.sin(np.radians(lon)*18+rad*6)
        a[iris]=(iriscol*spokes[...,None])[iris]
        limbus=np.exp(-((lat-34)/2.4)**2)*np.ones((1,128))
        a[:]=a*(1-limbus[...,None]*.5)
        a[(lat<11)*np.ones((1,128),bool)]=[.027,.016,.012]
        catch=(np.abs(lat-9)<3.5)&(np.abs(((lon-300+180)%360)-180)<24)
        a[catch]=[.99,.975,.94]
        cov[8:72,x0:x0+128]=True
    filled=dilate(maps,cov,CONFIG["dilation"])
    mask=cov&(h>1.0)&(h<1.48)
    report={"coverage_pct":float(cov.mean()*100),"normal_gain_body":CONFIG["normal_gain"],
            "normal_gain_abs":CONFIG["abdomen_normal_gain"],"ao_gain":CONFIG["ao_gain"],
            "skin_Lstar_median":float(np.median(lstar(maps["albedo"][...,:3])[mask])),
            "dilation_px":CONFIG["dilation"],"filled_px":filled,"face":face,
            "body_sha256":sha(frozen)}
    return maps,report


def gear_finish(maps):
    from scipy.ndimage import gaussian_filter
    h,w=maps["albedo"].shape[:2]; yy,xx=np.mgrid[:h,:w]
    u=(xx+.5)/w; v=(yy+.5)/h; report={}
    for name,(a,b,c,d) in CONFIG["patches"].items():
        mask=(u>=a-.004)&(u<=c+.004)&(v>=b-.004)&(v<=d+.004)
        if name=="scale":
            U=(u-a)/(c-a);V=(v-b)/(d-b)
            sy=(1-V)*CONFIG["scale_rows"];row=np.floor(sy)
            sx=U*CONFIG["scale_columns"]+.5*(row%2)
            fx=sx%1;fy=sy%1
            arc=.52+.45*np.sqrt(np.maximum(0,1-((fx-.5)/.51)**2))
            edge=fy-arc;inside=smooth(-edge/.045)
            # Rounded bellies and scalloped lower lips; narrow dark overlapping gaps.
            belly=.64+.14*(1-fy)+.08*np.sin((fx+.1)*np.pi)
            belly+=.06*np.sin(np.floor(sx)*2.4+row*1.7)
            val=.18*(1-inside)+belly*inside
            val+=.48*np.exp(-((edge+.022)/.035)**2)
            seam=np.exp(-(np.minimum(fx,1-fx)/.037)**2)
            val-=.40*seam
            maps["albedo"][mask,:3]=(np.array([.67,.48,.255])*val[...,None])[mask]
            relief=inside*(.40+.20*np.sin(fx*np.pi))+.12*np.exp(-((edge+.02)/.04)**2)-.14*seam
            gy,gx=np.gradient(gaussian_filter(relief,.7))
            normal=unit(np.stack([-gx*4,-gy*4,np.ones_like(gx)],-1))
            maps["normal"][mask,:3]=((normal+1)/2)[mask]
            maps["orm"][...,0][mask]=np.clip(.72+.28*inside-.12*seam,.5,1)[mask]
            maps["orm"][...,1][mask]=(.43+.055*(1-inside))[mask]
        target=CONFIG["gear_targets"].get(name,CONFIG["gear_targets"]["bronze"])
        grade_value(maps["albedo"][...,:3],mask,target)
        if name in ("scale","bronze","gold"):
            maps["orm"][...,2][mask]=.9
        report[name+"_Lstar_median"]=float(np.median(lstar(maps["albedo"][...,:3][mask])))
    # Patch colours already extend ~10px; extend to 16 without crossing patches.
    cov=np.zeros((h,w),bool)
    for a,b,c,d in CONFIG["patches"].values():
        cov|=(u>=a)&(u<=c)&(v>=b)&(v<=d)
    report["filled_px"]=dilate(maps,cov,CONFIG["dilation"])
    report["intentional_stacked_swatches"]=True
    report["dilation_px"]=CONFIG["dilation"]
    return maps,report


# ---- r30 fix round (opt-in KCA_SERAPHINE_TEXTURE_PROFILE=r30): the r29 gear_finish above stays the default.
CONFIG_R30 = {
    # Imbricated fish scales. U = torso angle over 2*pi (cups ~0.92 m round, brief ~1.05 m), V = 280/300 mm of height.
    # 42 columns ~ 22-25 mm wide; 25 rows ~ 11-12 mm pitch; a lower arc of one pitch => visible scale ~ 22-24 mm tall.
    "scale_columns": 42, "scale_rows": 25, "scale_circ_mm": 960., "scale_height_mm": 280.,
    "scale_rough": {"belly": .32, "tuck": .48, "lip": .27},
    "metal_rough": {"bronze": .32, "gold": .30},
    "metal_contrast": .55,           # bronze/gold: linear luminance (Y/Ymed)**contrast extra spread, median regraded after
    "bevel": {"u": .035, "v": .05},  # bronze patch: thin bright bevel at the plate edges (bracers/shin plates/pauldron rim)
}


def scale_cover(X_, Y_, k, cols):
    """Row-k scale nearest to (X_, Y_) in column/row units: returns (dx, dy, j) normalised to the arc radius."""
    off = .5 * (k % 2)
    j = np.floor(X_ - off)
    cx = j + .5 + off
    return (X_ - cx) / .5, (Y_ - k), j


def scale_tile(U, V, cols, rows, px_mm_u, px_mm_v):
    """Albedo tone, height (mm), AO, roughness for round overlapping scales; rows hang downward, upper rows on top."""
    from scipy.ndimage import gaussian_filter
    Xc = U * cols
    Yr = (1 - V) * rows                    # row units, increasing downward (toward the hem)
    k0 = np.floor(Yr)
    # The covering scale: row k0's lower arc if inside it, else row k0+1 (its hidden top runs under row k0).
    dx0, dy0, j0 = scale_cover(Xc, Yr, k0, cols)
    in0 = dx0 ** 2 + dy0 ** 2 <= 1
    k = np.where(in0, k0, k0 + 1)
    dx, dy, j = scale_cover(Xc, Yr, k, cols)
    q = np.sqrt(dx ** 2 + np.maximum(dy, 0) ** 2)
    e = np.clip(1 - q, 0, 1)                         # distance to own lower arc (arc radii)
    # Tuck: distance below the covering arcs of the row above (k-1); 0 right under their lip.
    dxa, dya, _ = scale_cover(Xc, Yr, k - 1, cols)
    qa = np.sqrt(dxa ** 2 + np.maximum(dya, 0) ** 2)
    tuck = np.clip(qa - 1, 0, None)
    frac = tuck / np.maximum(tuck + e, 1e-6)        # 0 = tucked top, 1 = own lip
    r_mm = .5 * CONFIG_R30["scale_circ_mm"] / cols  # arc radius in mm (~11.4)
    e_mm, tuck_mm = e * r_mm, tuck * r_mm
    rng = np.sin(j * 12.9898 + k * 78.233) * 43758.5453
    jitter = (rng - np.floor(rng)) - .5               # per-scale -0.5..0.5
    # Two values per scale: darker tucked top, lit domed belly; bright thin lip; narrow dark occlusion under the lip above.
    tone = .42 + .42 * smooth(frac / .85) + .06 * (1 - dx ** 2) + .07 * jitter
    lip = np.exp(-((e_mm - 1.1) / .7) ** 2)
    tone += .34 * lip
    occ = np.exp(-(tuck_mm / 1.5) ** 2)
    tone *= 1 - .60 * occ
    tone = .88 * np.tanh(tone / .88)                  # soft knee: the graded lips stay below channel clipping
    # Height (mm): tilted plate (tuck low -> lip high), cross dome, rounded lip edge; drops onto the scale below.
    h = .95 * smooth(frac) + .35 * (1 - dx ** 2) - .45 * (1 - smooth(e_mm / .9))
    h = gaussian_filter(h, (1.3, .7))
    gy, gx = np.gradient(h)                           # per pixel: axis0 = +V rows, axis1 = +U cols
    n = unit(np.stack([-gx * px_mm_u, -gy * px_mm_v, np.ones_like(gx)], -1))
    ao = np.clip(1 - .48 * occ - .14 * (1 - smooth(frac / .6)), .45, 1)
    sr = CONFIG_R30["scale_rough"]
    rough = sr["belly"] + (sr["tuck"] - sr["belly"]) * np.maximum(occ, 1 - smooth(frac / .5)) * .9 - (sr["belly"] - sr["lip"]) * lip
    return tone, n, ao, np.clip(rough, .2, .6)


def gear_finish_r30(maps):
    """r30 (opt-in KCA_SERAPHINE_TEXTURE_PROFILE=r30): round imbricated scales, metal value contrast + plate bevels,
    lower metal roughness. Same patches/UVs, same value targets (medians regraded to gear_targets)."""
    h, w = maps["albedo"].shape[:2]; yy, xx = np.mgrid[:h, :w]
    u = (xx + .5) / w; v = (yy + .5) / h; report = {"profile": "r30"}
    for name, (a, b, c, d) in CONFIG["patches"].items():
        mask = (u >= a - .004) & (u <= c + .004) & (v >= b - .004) & (v <= d + .004)
        U = (u - a) / (c - a); V = (v - b) / (d - b)
        if name == "scale":
            cols, rows = CONFIG_R30["scale_columns"], CONFIG_R30["scale_rows"]
            px_mm_u = (c - a) * w / CONFIG_R30["scale_circ_mm"]
            px_mm_v = (d - b) * h / CONFIG_R30["scale_height_mm"]
            tone, n, ao, rough = scale_tile(U, V, cols, rows, px_mm_u, px_mm_v)
            report["scale_Lstar_r29_p10_p50_p90"] = [float(np.percentile(lstar(maps["albedo"][..., :3][mask]), p)) for p in (10, 50, 90)]
            maps["albedo"][mask, :3] = (np.array([.67, .48, .255]) * tone[..., None])[mask]
            maps["normal"][mask, :3] = ((n + 1) / 2)[mask]
            maps["orm"][..., 0][mask] = ao[mask]
            maps["orm"][..., 1][mask] = rough[mask]
            report["scale_grid"] = {"columns": cols, "rows": rows, "px_per_mm_u": round(px_mm_u, 3), "px_per_mm_v": round(px_mm_v, 3)}
        elif name in ("bronze", "gold"):
            alb = maps["albedo"][..., :3]
            lin = linear(alb[mask]); Y = lin @ np.array([.2126, .7152, .0722]); Ym = float(np.median(Y))
            lin = lin * ((np.maximum(Y, 1e-5) / Ym) ** CONFIG_R30["metal_contrast"])[:, None]
            alb[mask] = np.clip(srgb(lin), 0, 1)
            if name == "bronze":
                bu, bv = CONFIG_R30["bevel"]["u"], CONFIG_R30["bevel"]["v"]
                du = np.minimum(U, 1 - U) / bu; dv = (1 - V) / bv      # 0 at the plate edge (U sides, V=1 rim)
                band = np.clip(np.minimum(du, dv), 0, None)
                bright = np.exp(-((band - .45) / .3) ** 2) * mask
                dark = np.exp(-((band - 1.25) / .25) ** 2) * mask
                g = 1 + .55 * bright - .30 * dark
                alb[...] = np.clip(srgb(linear(alb) * g[..., None]), 0, 1) * mask[..., None] + alb * (~mask)[..., None]
                # Bevel normal: tilt toward the edge so the rim catches the stage rim light.
                su = np.where(U < .5, -1, 1) * (du < dv) * np.exp(-(du / .9) ** 2)
                sv = (dv <= du) * np.exp(-(dv / .9) ** 2)
                nn = maps["normal"][..., :3] * 2 - 1
                nn = unit(nn + np.stack([su * .8, sv * .8, np.zeros_like(su)], -1))
                maps["normal"][mask, :3] = ((nn + 1) / 2)[mask]
                report["bronze_bevel"] = CONFIG_R30["bevel"]
            maps["orm"][..., 1][mask] = CONFIG_R30["metal_rough"][name]
        target = CONFIG["gear_targets"].get(name, CONFIG["gear_targets"]["bronze"])
        grade_value(maps["albedo"][..., :3], mask, target)
        if name in ("scale", "bronze", "gold"):
            maps["orm"][..., 2][mask] = .9
        L = lstar(maps["albedo"][..., :3][mask])
        report[name + "_Lstar_median"] = float(np.median(L))
        if name in ("scale", "bronze"):
            report[name + "_Lstar_p10_p90"] = [float(np.percentile(L, 10)), float(np.percentile(L, 90))]
    cov = np.zeros((h, w), bool)
    for a, b, c, d in CONFIG["patches"].values():
        cov |= (u >= a) & (u <= c) & (v >= b) & (v <= d)
    report["filled_px"] = dilate(maps, cov, CONFIG["dilation"])
    report["intentional_stacked_swatches"] = True
    report["dilation_px"] = CONFIG["dilation"]
    return maps, report


def groom_finish(maps):
    a=maps["albedo"]; hair=(maps["orm"][...,2]<.3)&(a[...,3]>.1)
    grade_value(a[...,:3],hair,35)
    # Keep the role's strand-group contrast, capped highlights and satin variation.
    L=lstar(a[...,:3]); high=hair&(L>52)
    if high.any():
        a[high,:3]=srgb(linear(a[high,:3])*(((52+16)/(L[high]+16))**3)[:,None])
    report={"hair_Lstar_median":float(np.median(lstar(a[...,:3][hair]))),
            "dilation_px":CONFIG["groom_dilation"],"alpha_unchanged":True}
    report["filled_px"]=dilate(maps,a[...,3]>.01,CONFIG["groom_dilation"],alpha=True)
    return maps,report


def prepare(out, fast=False):
    from PIL import Image
    out=Path(out); out.mkdir(parents=True,exist_ok=True)
    sources={}; tiles={}; report={"tiles":{},"source_hashes":{},"sheets":{}}
    for role,tile,finish in (("body","skin",skin_finish),("armour","gear",gear_finish_r30 if R30 else gear_finish),("hair","groom",groom_finish)):
        m,h=load_maps(role,tile); sources.update(h)
        m,report["tiles"][tile]=finish(m);tiles[tile]=m
        log(tile+" graded/dilated")
    for sheet in ("body","groom"):
        paths={}
        for k in ("albedo","orm","normal"):
            a=np.concatenate([tiles["skin"][k],tiles["gear"][k]],axis=1) if sheet=="body" else tiles["groom"][k]
            if sheet=="body":a[...,3]=1
            if fast:
                if k=="albedo":
                    a[...,:3]=linear(a[...,:3])
                a=a.reshape(1024,2,1024,2,4).mean((1,3))
                if k=="albedo":a[...,:3]=srgb(a[...,:3])
                if k=="normal":a[...,:3]=(unit(a[...,:3]*2-1)+1)/2
            data=np.uint8(np.clip(a[::-1],0,1)*255+.5)
            if k!="albedo" or sheet=="body":data=data[...,:3]
            path=out/f"{sheet}_{k}.png";Image.fromarray(data).save(path);paths[k]=str(path)
        report["sheets"][sheet]={"size":[1024,1024] if fast else [2048,2048],"maps":paths}
    for p,h in sources.items():
        if sha(ROOT/p)!=h:raise RuntimeError("Source tile changed during composite: "+p)
    report["source_hashes"]=sources
    (out/"composite_report.json").write_text(json.dumps(report,indent=2))
    return report


def join_buffers(chunks,arm,name,bones):
    from lib import meshutil,skin
    P=[];F=[];UV=[];N=[];W=[];offset=0
    for b,U in chunks:
        P.append(b["P"]);F.append(b["F"]+offset);UV.append(U);N.append(b["N"]);W.append(b["W"])
        offset+=len(b["P"])
    ob=meshutil.mesh_from_numpy(name,np.concatenate(P),tris=np.concatenate(F))
    uv=ob.data.uv_layers.new(name="UVMap");uv.data.foreach_set("uv",np.concatenate(UV).astype(np.float32).ravel())
    ob.data.normals_split_custom_set(np.concatenate(N).reshape(-1,3))
    skin.write_groups(ob,bones,np.concatenate(W));skin.bind(ob,arm)
    return ob


def density(b,U,ids):
    p=b["P"][b["F"][ids]];u=U[ids]
    a3=np.linalg.norm(np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0]),axis=1).sum()
    e=u[:,1]-u[:,0];f=u[:,2]-u[:,0]
    a2=np.abs(e[:,0]*f[:,1]-e[:,1]*f[:,0]).sum()
    return float(np.sqrt(a2/max(a3,1e-20))*2048)


def pack_sheets(groups,objs,arm,fast=False,release=False):
    import bpy
    from build_hero_seraphine_r29 import material_for
    t=time.monotonic();mode="release" if release else ("fast" if fast else "preview")
    out=Path(os.environ.get("KCA_SERAPHINE_R29_TEXTURE_OUT",CONFIG["out"]))/mode
    out.mkdir(parents=True,exist_ok=True)
    def hashes():
        return {str(key):{k:hashlib.sha256(np.ascontiguousarray(g[k]).tobytes()).hexdigest()
                for k in ("P","F","N","W","UV")} for key,g in groups.items()}
    before=hashes()
    if sha(TEAMDIR/"parts/body/body.npz")!=sha(TEAMDIR/"frozen/body/body.npz"):
        raise RuntimeError("Live body differs from frozen body; lead must reconcile")
    cmd=[str(Path.home()/"kca-assets/venv/bin/python"),"-I",str(Path(__file__)),"--prepare",str(out)]
    if fast and not release:cmd.append("--fast")
    subprocess.run(cmd,check=True)
    report=json.loads((out/"composite_report.json").read_text())
    chunks={"body":[],"groom":[]}
    for (mesh,tile,alpha,role),b in sorted(groups.items(),key=lambda kv:str(kv[0])):
        sheet,x0,y0,x1,y1=T.CONFIG["tiles"][tile]
        U=b["UV"]*np.array([x1-x0,y1-y0])/2048+np.array([x0,y0])/2048
        chunks[mesh].append((b,U))
        if tile=="skin":
            centres=b["P"][b["F"]].mean(1)
            face=(centres[:,2]>1.53)&(centres[:,1]<-.055)
            body=(centres[:,2]>.1)&(centres[:,2]<1.45)
            report["spatial_face_density_x_body"]=density(b,U,face)/density(b,U,body)
            measures=json.loads((TEAMDIR/"frozen/body/body_ckpt.json").read_text())["measures"]
            report["face_density_x_body"]=measures["px_per_m_face"]/measures["px_per_m_body"]
            report["face_density_method"]="authored face-chart versus body-chart area density; tile pixel density preserved by sheet translation"
            np.savez_compressed(out/"skin_uv_audit.npz",P=b["P"],F=b["F"],UV=U)
    bones=T.Rig().bones;final=[];specs={}
    for sheet in ("body","groom"):
        cfg=T.CONFIG["sheets"][sheet];name=cfg["material"]
        old=bpy.data.materials.get(name)
        if old:old.name=name+"_preview"
        mat=material_for(name,report["sheets"][sheet]["maps"],alpha=sheet=="groom",cutoff=.4)
        mat["kcaRimScale"]=CONFIG[sheet+"_rim"]
        specs[name]={"rim":CONFIG[sheet+"_rim"],"alpha":cfg.get("alpha"),"cutoff":.4,
                     "specular":cfg.get("specular"),"extras":cfg.get("extras",{}).copy()}
        ob=join_buffers(chunks[sheet],arm,T.MESH_NAMES[sheet],bones)
        ob.data.materials.append(mat);final.append(ob)
    for ob in objs:bpy.data.objects.remove(ob,do_unlink=True)
    assert before==hashes(),"Compositor changed source geometry/UV buffers"
    report.update(mode=mode,geometry_buffers_unchanged=True,source_geometry_hashes=before,
                  seconds=round(time.monotonic()-t,2),materials=specs)
    (out/"pack_report.json").write_text(json.dumps(report,indent=2))
    log(f"pack_sheets ready: {report['seconds']}s; face density {report['face_density_x_body']:.3f}x")
    return {"objects":final,"materials":specs,"report":report}


if __name__=="__main__":
    if len(sys.argv)>2 and sys.argv[1]=="--prepare":
        prepare(sys.argv[2],"--fast" in sys.argv)
    else:
        raise SystemExit("Usage: python -I seraphine_r29_texture.py --prepare OUT [--fast]")
