"""Humanoid landmarks + armature builder implementing docs/ARCHITECTURE.md section 2 exactly.

Blender space: Z up, character faces -Y, character's left = +X (the glTF exporter turns this into
Y up / facing +Z). Rest pose = A-pose (arms ~40 deg below horizontal, palms down, legs straight),
feet on Z=0, `root` at the origin.

`landmarks(P)` turns a proportions dict into joint positions + hand frames. The SAME landmarks drive the
anatomy sculpt (lib/anatomy.py) so the skeleton always sits exactly inside the mesh.
"""
import math
import numpy as np

from .sdf import V, norm, axis_angle

# Default proportions (metres / degrees). Heroes override what they need.
DEFAULT = dict(
    height=1.80, head_h=0.235,
    shoulder_x=0.19, shoulder_z=1.46, clav_in_x=0.022,
    hip_x=0.092, hip_joint_z=0.90, pelvis_z=0.945,
    knee_z=0.49, ankle_z=0.085, foot_len=0.26, stance_x=0.10,
    spine_z=1.05, chest_z=1.23, neck_z=1.475, head_base_z=1.585,
    upperarm=0.31, forearm=0.27, hand=0.19,
    arm_down=40.0, arm_fwd=6.0, elbow_bend=10.0,
    mane_len=0.0, kilt=False, kilt_len=0.30, kilt_r=0.19,
    back_socket=True,
)


def landmarks(P):
    p = dict(DEFAULT)
    p.update(P)
    L = {"P": p}
    H = p["height"]
    L["head_top"] = V(0, 0.005, H)
    L["chin"] = V(0, -0.085, H - p["head_h"])
    L["pelvis"] = V(0, 0.01, p["pelvis_z"])
    L["spine"] = V(0, 0.012, p["spine_z"])
    L["chest"] = V(0, 0.005, p["chest_z"])
    L["neck"] = V(0, 0.02, p["neck_z"])
    L["head"] = V(0, 0.008, p["head_base_z"])
    # legs
    for s, sx in (("L", 1), ("R", -1)):
        hip = V(sx * p["hip_x"], 0.0, p["hip_joint_z"])
        knee = V(sx * (p["stance_x"] - 0.004), -0.012, p["knee_z"])
        ankle = V(sx * (p["stance_x"] + 0.004), 0.018, p["ankle_z"])
        ball = V(sx * (p["stance_x"] + 0.012), 0.018 - 0.60 * p["foot_len"], 0.028)
        tip = V(sx * (p["stance_x"] + 0.016), 0.018 - 0.90 * p["foot_len"], 0.024)
        L["hip_" + s], L["knee_" + s], L["ankle_" + s], L["ball_" + s], L["toe_" + s] = hip, knee, ankle, ball, tip
    # arms (A-pose). Direction: down by arm_down, forward by arm_fwd.
    for s, sx in (("L", 1), ("R", -1)):
        sh = V(sx * p["shoulder_x"], 0.012, p["shoulder_z"])
        clav = V(sx * p["clav_in_x"], -0.04, p["shoulder_z"] + 0.005)
        a = math.radians(p["arm_down"])
        f = math.radians(p["arm_fwd"])
        d_up = norm(V(sx * math.cos(a) * math.cos(f), -math.sin(f), -math.sin(a)))
        elbow = sh + d_up * p["upperarm"]
        # elbow bend: rotate forearm direction toward forward (-Y) about the axis perpendicular to both
        ax = norm(np.cross(d_up, V(0, -1, 0)))
        d_fo = axis_angle(ax, p["elbow_bend"]) @ d_up
        wrist = elbow + d_fo * p["forearm"]
        # hand frame: h along hand, t = thumb side (forward), n = palm normal (down / out of palm)
        h = d_fo
        t = norm(V(0, -1, 0) - h * float(np.dot(V(0, -1, 0), h)))
        n = norm(np.cross(h, t))
        if n[2] > 0:
            n = -n
        knuck = wrist + h * (0.52 * p["hand"])
        L.update({"clav_" + s: clav, "shoulder_" + s: sh, "elbow_" + s: elbow, "wrist_" + s: wrist,
                  "knuckle_" + s: knuck, "hand_h_" + s: h, "hand_t_" + s: t, "hand_n_" + s: n,
                  "arm_up_" + s: d_up, "arm_fo_" + s: d_fo})
        # grip centre (inside the fist, palm side), blade direction = thumb side
        grip = wrist + h * (0.44 * p["hand"]) + n * 0.034
        L["grip_" + s] = grip
    return L


# ----------------------------------------------------------------------------- armature
def build_armature(L, name="rig", hair_chain=0, kilt_chain=0, extra=None):
    """Create the contract armature. Returns the armature object (in OBJECT mode)."""
    import bpy
    p = L["P"]
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones

    def bone(nm, head, tail, parent=None, connect=False, roll_z=None, deform=True):
        b = eb.new(nm)
        b.head = tuple(head)
        b.tail = tuple(tail)
        if roll_z is not None:
            b.align_roll(tuple(norm(roll_z)))
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        b.use_deform = deform
        return b

    fwd = V(0, -1, 0)
    bone("root", V(0, 0, 0), V(0, -0.25, 0), deform=False, roll_z=V(0, 0, 1))
    bone("hips", L["pelvis"], L["spine"], "root", roll_z=fwd)
    bone("spine", L["spine"], L["chest"], "hips", True, roll_z=fwd)
    bone("chest", L["chest"], L["neck"], "spine", True, roll_z=fwd)
    bone("neck", L["neck"], L["head"], "chest", True, roll_z=fwd)
    bone("head", L["head"], L["head_top"], "neck", True, roll_z=fwd)
    for s in ("L", "R"):
        bone("clavicle_" + s, L["clav_" + s], L["shoulder_" + s], "chest", roll_z=V(0, 0, 1))
        up = L["hand_n_" + s] * -1.0
        bone("upperarm_" + s, L["shoulder_" + s], L["elbow_" + s], "clavicle_" + s, True, roll_z=up)
        bone("forearm_" + s, L["elbow_" + s], L["wrist_" + s], "upperarm_" + s, True, roll_z=up)
        bone("hand_" + s, L["wrist_" + s], L["knuckle_" + s], "forearm_" + s, True, roll_z=up)
        # socket: head at grip centre, +Y (bone axis) = blade direction (thumb side),
        # local X = edge direction (along the hand), local Z = flat normal
        g = L["grip_" + s]
        t = L["hand_t_" + s]
        h = L["hand_h_" + s]
        bone("socket_hand_" + s, g, g + t * 0.12, "hand_" + s, roll_z=np.cross(h, t), deform=False)
        bone("thigh_" + s, L["hip_" + s], L["knee_" + s], "hips", roll_z=fwd)
        bone("shin_" + s, L["knee_" + s], L["ankle_" + s], "thigh_" + s, True, roll_z=fwd)
        bone("foot_" + s, L["ankle_" + s], L["ball_" + s], "shin_" + s, True, roll_z=V(0, 0, 1))
        bone("toe_" + s, L["ball_" + s], L["toe_" + s], "foot_" + s, True, roll_z=V(0, 0, 1))
    if p.get("back_socket", True):
        c = V(-0.17, 0.165, p["shoulder_z"] + 0.14)
        dirb = norm(V(0.36, 0.02, -0.93))
        bone("socket_back", c, c + dirb * 0.15, "chest", roll_z=V(0, 1, 0), deform=False)
    if hair_chain:
        pts = L.get("hair_chain_pts")
        par = "head"
        for i in range(hair_chain):
            nm = f"hair_{i+1}"
            bone(nm, pts[i], pts[i + 1], par, i > 0, roll_z=V(0, 1, 0))
            par = nm
    if kilt_chain:
        for side, pts in L["kilt_chain_pts"].items():
            par = "hips"
            for i in range(kilt_chain):
                nm = f"kilt_{side}_{i+1}"
                bone(nm, pts[i], pts[i + 1], par, i > 0, roll_z=V(0, 0, 1) if side in "FB" else V(0, -1, 0))
                par = nm
    if extra:
        for (nm, head, tail, parent, connect) in extra:
            bone(nm, head, tail, parent, connect)
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.show_in_front = True
    return ob


CONTRACT_BONES = ["root", "hips", "spine", "chest", "neck", "head",
                  "clavicle_L", "upperarm_L", "forearm_L", "hand_L", "socket_hand_L",
                  "clavicle_R", "upperarm_R", "forearm_R", "hand_R", "socket_hand_R",
                  "thigh_L", "shin_L", "foot_L", "toe_L", "thigh_R", "shin_R", "foot_R", "toe_R"]
