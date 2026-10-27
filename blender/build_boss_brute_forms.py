"""Boss-only C2 r18 anatomy and costume. The regular ogre and its rig are untouched."""
import math
import bmesh
import numpy as np
import build_enemy_ogre as BO
from lib import anatomy, gear, charkit, rig
from lib.sdf import (V, norm, basis, rot, Sculpt, Sphere, Ellipsoid, Capsule, Chain, HalfSpace,
                     Inter, Union, Diff, Bounded, Offset, RoundCone, RoundBox, Torus, Slab, Displace, SymX)
from lib.charkit import trace_in
MATERIALS = BO.MATERIALS
STYLE = dict(BO.STYLE, traps=1.45, neck=1.55, fat=2.2, waist=1.65, nose_w=1.8, skull_w=1.06)
BELT_Z = BO.BELT_Z
WRIST_CUT_T = BO.WRIST_CUT_T
LEG_GAP_TOP = BO.LEG_GAP_TOP
forearm_frame = BO.forearm_frame
HEAD_BOX = (V(-0.28, -0.46, 1.70), V(0.28, 0.17, 2.27))


def boss_landmarks():
    # B17 boss rig predates the regular ogre's taller C1-r3 neck/head. Keep the
    # shipped boss's rest rig rather than inheriting that unrelated enemy change.
    p=dict(BO.OGRE,height=1.94,head_h=.26,neck_z=1.645,head_base_z=1.78,head_dy=-.07)
    L=rig.landmarks(p)
    for key,f in (("neck",.45),("head",1),("head_top",1),("chin",1)):
        L[key]=L[key]+V(0,p["head_dy"]*f,0)
    return L


def bare_foot(S, L, side):
    anatomy.foot(S, L, side)
    b = L["ball_" + side]
    S.add(Ellipsoid(b + V(0, 0.015, 0.005), V(0.083, 0.105, 0.047)), 0.025, mat="skin")
    for i in range(4):
        x = (i - 1.5) * 0.041
        p = b + V(x, -0.075 + abs(i-1.2)*0.007, -0.003)
        S.add(Ellipsoid(p, V(0.021, 0.047-abs(i-1)*0.004, 0.027)), 0.004, mat="skin")
        S.add(Ellipsoid(p + V(0, -0.022, 0.023), V(0.014, 0.016, 0.004)), 0.001, mat="nail")
    for i in range(3):
        S.sub(Capsule(b + V((i-1)*0.041, -0.14, 0), b + V((i-1)*0.041, -0.075, 0), 0.0035), 0.002)


def paint_swirl(S, L, H):
    # Broad brush spirals and claw stripes: pale paint on red MOG; disabled by GOR's palette.
    for side in (1, -1):
        pts = []
        for t in np.linspace(0, 2.8*math.pi, 45):
            rad = 0.012 + 0.009*t
            pts.append(V(side*(0.20+rad*math.cos(t)), -0.45, 1.56+rad*math.sin(t)))
        pts = S.project(np.array(pts), offset=0.0)
        S.paint(Chain(list(pts), 0.014), "swirl", soft=0.007)
    for x in (-0.12, 0, 0.12):
        pts=S.project(np.array([V(x-0.07,-0.5,1.36),V(x,-0.55,1.22),V(x+0.055,-0.5,1.09)]), offset=0.0)
        S.paint(Chain(list(pts),0.021), "swirl", soft=0.009)
    for side in ("L", "R"):
        sh = L["shoulder_"+side]
        S.paint(Torus(sh + V(0,-0.06,-0.03), 0.079, 0.015, basis(V(0,-1,0))[:,[1,2,0]]),"swirl",soft=0.012)
    S.paint(Chain([H(-0.07,-0.09,0.03),H(-0.03,-0.125,-0.03),H(0,-0.14,-0.10)],0.009),"swirl",soft=0.006)


def costume(S, snap, L):
    # Crossed narrow harness front AND back. Bare belly and pectorals remain visible.
    for sy in (-1, 1):
        for sx in (-1, 1):
            raw = [V(sx*.20,sy*.07,1.68),V(sx*.17,sy*.28,1.52),V(sx*.08,sy*.32,1.39),
                   V(-sx*.10,sy*.34,1.23),V(-sx*.24,sy*.20,1.04)]
            gear.strap(S,snap,raw,width=.060,thick=.014,mat="leather_dark")
        for sx in (-1,1):
            p=trace_in(S,V(sx*.13,0,1.46),V(0,sy,0),r=.65)
            S.add(Torus(p+V(0,sy*.015,0),.034,.010,basis(V(0,sy,0))[:,[1,2,0]]),.002,mat="iron")
    # Spiked forged bracers, lower forearm only; upper arm and the hand stay bare.
    for side in ("L","R"):
        el,wr,b,lf=forearm_frame(L,side)
        c=el+b*lf*.66
        region=Inter(Offset(snap,.022),Slab(c,b,lf*.235),Sphere(c,.22),k=.003)
        S.add(Bounded(region,c-.25,c+.25),.001,mat="iron")
        for f in (.45,.83):
            q=el+b*lf*f
            S.add(Bounded(Inter(Offset(snap,.029),Slab(q,b,.012),Sphere(q,.20)),q-.23,q+.23),.002,mat="leather_dark")
        outward=norm(V(1 if side=="L" else -1,-.4,.1))
        for f in (.43,.63,.82):
            q=trace_in(S,el+b*lf*f,outward,r=.30)
            S.add(RoundCone(q-outward*.008,q+outward*.060,.019,.003),.004,mat="iron")
            S.add(Sphere(q+V(0,-.025,0),.009),.002,mat="bronze")
    # Short dark breeches under the independently skinned pelt flaps.
    br=Inter(Offset(snap,.007),Slab(V(0,0,.84),V(0,0,1),.15))
    S.add(Bounded(br,V(-.5,-.5,.68),V(.5,.5,1.01)),0,mat="leather_dark")
    # Rag wrapped SHINS: toes and insteps are exposed.
    for side in ("L","R"):
        an,kn=L["ankle_"+side],L["knee_"+side]
        c=(an+kn)*.5
        boot=Inter(Offset(snap,.014),Slab(V(0,0,.27),V(0,0,1),.115),Sphere(c,.24))
        S.add(Bounded(boot,an-.3,kn+.2),0,mat="rope")
        for j in range(5):
            z=.17+j*.045
            cut=Inter(Offset(snap,.023),Slab(V(an[0],an[1],z),norm(V(0,.30*(-1)**j,1)),.009),Sphere(c,.25))
            S.add(Bounded(cut,an-.3,kn+.2),.001,mat="hide_dark")
    S.inter(HalfSpace(V(0,0,0),V(0,0,-1)))


def wide_belt(S, snap, L):
    z=1.015
    S.add(Bounded(Inter(Offset(snap,.027),Slab(V(0,0,z),V(0,.1,1),.043)),V(-.55,-.55,.92),V(.55,.55,1.12)),0,mat="leather_dark")
    c=trace_in(S,V(0,0,z),V(0,-1,0),r=.7)+V(0,-.012,0)
    M=basis(V(0,-1,0))[:,[1,2,0]]
    S.add(Ellipsoid(c,V(.065,.023,.065)),.003,mat="bronze")
    S.add(Torus(c+V(0,-.018,0),.052,.007,M),.002,mat="bronze")
    S.add(Sphere(c+V(0,-.023,0),.025),.002,mat="bronze")
    for a in np.linspace(0,2*math.pi,10,endpoint=False):
        S.add(Sphere(c+V(math.sin(a)*.044,-.022,math.cos(a)*.044),.005),.001,mat="iron")
    for sx in (-1,1):
        for i in range(5):
            q=trace_in(S,V(sx*(.10+i*.045),0,z),V(0,-1,0),r=.7)
            S.add(Sphere(q+V(0,-.004,0),.007),.001,mat="bronze")


def hand_sculpt(L, side):
    S=Sculpt(materials=MATERIALS,default_mat="skin")
    el,wr,b,lf=forearm_frame(L,side)
    S.add(RoundCone(el+b*.08,wr-b*.06,.112,.067),.05,mat="skin")
    HL=dict(L,P=dict(L["P"],hand=.48))
    hi=anatomy.hand(S,HL,side,"grip" if side=="R" else "relaxed",STYLE,grip_r=BO.GRIP_R)
    for nm,pts in hi["fingers"].items():
        rr=np.array(anatomy.FINGERS[nm][3])*2.4*1.22
        S.add(Chain(pts,list(rr)),.002,mat="skin")
        for p,r in zip(pts[:3],rr[:3]):
            S.add(Sphere(p,r*1.06),.002,mat="skin")
    # Thumb and nails stay articulated and visible. Never cover knuckles with a wrap.
    anatomy.hand_details(S,HL,side)
    if side=="R":
        g,t=L["grip_R"],L["hand_t_R"]
        S.sub(Capsule(g-t*.12,g+t*.12,BO.GRIP_R*.98),.001)
    S.inter(HalfSpace(el+b*lf*BO.HAND_CUT_T,-b))
    return S


def war_skirt(kp):
    S=BO.war_skirt(kp)
    # Separate F/B/L/R pelt panels retain the four existing spring chains.
    rng=np.random.RandomState(1818)
    for side,ang,w in (("F",0,.14),("B",math.pi,.18),("L",math.pi/2,.13),("R",-math.pi/2,.13)):
        d=V(math.sin(ang),-math.cos(ang),0)
        v=V(math.cos(ang),math.sin(ang),0)
        for row in range(2):
            for i in range(9):
                t=((i+.42*(row%2))-4)/4*w*.84
                z=.92-row*.085+rng.uniform(-.026,.026)
                rad=(kp["r_top"]+(1-z)*.08)*(kp["squash"] if side in ("F","B") else 1)
                p=V(0,kp["cy"],z)+d*(rad+.016+row*.006)+v*t
                ln=rng.uniform(.14,.27)
                lean=rng.uniform(-.045,.045)
                width=rng.uniform(.024,.038)
                pts=[p-d*.008,p+d*.018+v*lean*.25+V(0,0,-ln*.28),
                     p+d*.025+v*lean*.70+V(0,0,-ln*.65),
                     p+d*.014+v*lean+V(0,0,-ln)]
                S.add(Chain(pts,[width*.8,width,width*.56,.0018],squash=(.48,1),ref=tuple(d)),.002,mat="fur")
    return S


def body_sculpt(L):
    S = Sculpt(materials=MATERIALS, default_mat="skin")
    info = {"arms": {}, "legs": {}}
    T = anatomy.torso(S, L, STYLE)
    # Giant masses: pot belly and lowered trapezius clear of the projected head.
    anatomy.E(S, T, (0, -0.06, 1.18), (0.232, 0.212, 0.225), k=0.08)                   # belly
    anatomy.E(S, T, (0, -0.03, 1.07), (0.15, 0.13, 0.1), k=0.07)                    # lower belly
    anatomy.E(S, T, (0, 0.06, 1.55), (0.15, 0.1, 0.1), k=0.07)                      # upper-back hump
    anatomy.E(S, T, (0.085, 0.045, 1.63), (0.075, 0.07, 0.075), k=0.06, sym=True)    # traps up the neck
    anatomy.E(S, T, (0.14, 0.03, 1.2), (0.07, 0.09, 0.1), k=0.07, sym=True)         # flanks
    anatomy.E(S, T, (0.1, -0.1, 1.42), (0.085, 0.06, 0.07), k=0.05, sym=True)       # slab pecs
    # C1 r4 (board r3: "smooth matte-plastic capsule"): readable big forms -- squared pec slabs with a shadowed
    # lower border, deltoid caps, a belly that hangs over a navel crease, a sternum groove
    anatomy.E(S, T, (0.105, -0.13, 1.45), (0.09, 0.045, 0.058), M=rot(0, 0, 8), k=0.03, sym=True)
    S.sub(SymX(Capsule(T(0.04, -0.17, 1.355), T(0.17, -0.12, 1.385), 0.014)), 0.03)     # under-pec shadow line
    S.sub(Capsule(T(0, -0.185, 1.38), T(0, -0.17, 1.5), 0.012), 0.025)                    # sternum groove
    anatomy.E(S, T, (0, -0.17, 1.15), (0.18, 0.12, 0.15), k=0.05)                          # belly front mass
    S.sub(Capsule(T(-0.12, -0.2, 1.0), T(0.12, -0.2, 1.0), 0.016), 0.04)                  # belly overhang crease
    S.sub(Ellipsoid(T(0, -0.225, 1.08), (0.011, 0.02, 0.016)), 0.012)                     # navel
    for s in ("L", "R"):
        info["arms"][s] = anatomy.arm(S, L, s, STYLE)
        info["legs"][s] = anatomy.leg(S, L, s, STYLE)
        bare_foot(S, L, s)
        sh, el, wr = L["shoulder_" + s], L["elbow_" + s], L["wrist_" + s]
        a = norm(el - sh)
        b = norm(wr - el)
        S.add(RoundCone(sh + a * 0.06, el - a * 0.03, 0.105, 0.082), 0.05)            # bulk upper arm
        sxs = 1 if s == "L" else -1
        S.add(Ellipsoid(sh + a * 0.07 + V(sxs * 0.035, -0.01, 0.01), V(0.075, 0.08, 0.085)), 0.035)   # deltoid cap
        S.add(Ellipsoid(sh + a * 0.2 + V(0, -0.045, 0), V(0.05, 0.05, 0.075)), 0.035)               # biceps
        S.add(RoundCone(el + b * 0.08, wr - b * 0.06, 0.112, 0.067), 0.05)           # popeye forearm
        hp, kn = L["hip_" + s], L["knee_" + s]
        S.add(RoundCone(hp + V(0, 0, -0.04), kn + V(0, 0, 0.05), 0.12, 0.085), 0.06)  # tree-trunk thigh
        an = L["ankle_" + s]
        S.add(RoundCone(kn + V(0, 0.01, -0.04), an + V(0, 0, 0.08), 0.078, 0.06), 0.05)
    HL = dict(L, P=dict(L["P"], head_h=0.405, head_dy=-0.155, height=2.10))
    info["head"] = anatomy.head(S, HL, STYLE)
    H = info["head"]["H"]
    BO.ogre_face(S, L, info["head"])
    # A broad flattened nose and down-facing nostrils, above the projecting jaw.
    S.add(Ellipsoid(H(0,-.107,-.060),H.r(.035,.025,.023)),.012,mat="skin")
    for sx in (-1,1):
        S.add(Ellipsoid(H(sx*.029,-.101,-.067),H.r(.016,.019,.017)),.009,mat="skin")
        S.sub(Ellipsoid(H(sx*.023,-.119,-.080),H.r(.008,.012,.007)),.002)
    # A few large warts catch light; small mottling remains in the atlas normal.
    raw=[]
    for sx in (-1,1):
        raw.extend([V(sx*x,-.50,z) for x,z in ((.30,1.58),(.38,1.49),(.22,1.63),(.17,1.17),(.10,1.30))])
    raw.extend([H(.074,-.17,-.045),H(-.08,-.17,-.065),H(.06,-.15,.03)])
    pp=S.project(np.array(raw),offset=-.002)
    anchors=np.array([L[n] for n in ("hips","spine","chest","neck","head","shoulder_L","shoulder_R","elbow_L","elbow_R")])
    for i,p in enumerate(pp):
        # Bound-culled fields can leave a projected sample detached. Do not add
        # isolated floating warts outside the boss rig's 0.75m final-scale reach.
        if np.min(np.linalg.norm(anchors-p,axis=1))>.43 or abs(float(S.dist(p[None])[0]))>.006:
            continue
        S.add(Sphere(p,.008+(i%3)*.0025),.003,mat="skin")
    for s, ai in info["arms"].items():
        anatomy.arm_details(S, L, s, STYLE, ai)
    BO.war_paint(S, L, H)
    paint_swirl(S, L, H)
    # C1 r4: subtle warty hide relief (bakes into the normal map) on torso/limbs, never the face
    snap0 = S.snapshot()
    S.add(Bounded(Displace(Offset(snap0, -0.0016), 0.0028, 26.0, 3, seed=77), V(-0.9, -0.5, 0.05),
                  V(0.9, 0.5, float(L["neck"][2]) - 0.02)), 0.0025, mat="skin")
    snap = S.snapshot()
    for s in ("L", "R"):
        el, wr, b, Lf = forearm_frame(L, s)
        c = el + b * Lf * WRIST_CUT_T
        S.sub(Bounded(Inter(HalfSpace(c, -b), Sphere(wr, 0.26)), wr - 0.26, wr + 0.26))
    # Place the navel on the NEW belly surface rather than buried inside it.
    q=trace_in(S,V(0,0,1.12),V(0,-1,0),r=.65)
    S.sub(Ellipsoid(q+V(0,-.006,0),V(.013,.020,.016)),.005)
    snap=S.snapshot()
    costume(S, snap, L)
    snap2 = S.snapshot()
    wide_belt(S, snap2, L)
    anatomy.separate_legs(S, L, top_z=LEG_GAP_TOP, gap=0.02)
    info["kilt"] = BO.kilt_params(S)
    return S, info



def clean_degenerate(ob):
    """Drop collapsed decimation triangles before UV/bake/export; keep all valid faces."""
    bm=bmesh.new();bm.from_mesh(ob.data)
    dead=[f for f in bm.faces if f.calc_area()<=5e-11]
    if dead:
        bmesh.ops.delete(bm,geom=dead,context="FACES_ONLY")
        bm.to_mesh(ob.data);ob.data.update()
    bm.free()
    return len(dead)
