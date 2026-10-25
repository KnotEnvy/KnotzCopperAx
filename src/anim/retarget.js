// Retargeting: character-space clip authoring → bone-local quaternions for ANY rig that follows the §2
// rest-pose contract, whatever its per-bone local axes are.
//
// ─── AXIS CONVENTION (authoritative; docs/ENGINE_API.md §Clips repeats it) ───────────────────────────────
//  Character space (what clip keyframes are written in):   +X = forward (facing)   +Y = up   +Z = character's RIGHT
//  (Right-handed, so X × Y = Z. ARCHITECTURE.md's draft said "+Z = left"; that would be left-handed, so this is the fix.)
//  Model space (glTF, rest pose faces +Z):                    +Z = forward            +Y = up   +X = character's LEFT
//  char → model is a −90° rotation about Y:  (x, y, z)_char → (−z, y, x)_model
//
//  Keyframe rotations are Euler angles in DEGREES, order 'XYZ' (THREE.Euler: R = Rx·Ry·Rz), about CHARACTER axes
//  as they are at REST, applied at the joint (FK: children follow their parents). Handy signs:
//    about Z (lateral axis):  +Z swings a hanging limb FORWARD/UP (raise arm/thigh forward, elbow/forearm curl up)
//                             and tips the torso/head BACKWARD.  So a forward lean is −Z and a knee bend is −Z on the shin.
//    about Y (vertical):      +Y turns to the character's LEFT (counter-clockwise seen from above)
//    about X (forward axis):  +X rolls the top toward the character's RIGHT (torso side-bend right). A hanging
//                             LEFT arm with +X swings outward (abduct); a hanging RIGHT arm with −X swings outward.
//  Mirror L↔R (mirrorPose): swap _L/_R and negate X and Y (Z is unchanged).
//  Hips translation (hipsPos / key.hips) is in character space (metres on a reference rig whose hips are at 1.0 m).
//  It is scaled by (rig hip height / 1.0), so a "sit 0.5" means half the hip height on Brann and on Gorrim alike.
//
//  Math, per bone b with parent p (rest orientations measured in model space relative to the model root):
//    R      = C · Euler_char · C⁻¹              (C = char→model rotation)
//    local  = Qp_rest⁻¹ · R · Qb_rest           (= rest local when R = identity)
//  So the posed global is Qp_posed · Qp_rest⁻¹ · R · Qb_rest. When the parent is still at rest, the bone's
//  global orientation is just R applied to its rest orientation. That is identical on the placeholder rig
//  (identity bone axes) and on Blender GLBs (arbitrary bone axes, often with a scaled/rotated armature node).
import * as THREE from 'three';

export const DEG2RAD = Math.PI / 180;
const Y = new THREE.Vector3(0, 1, 0);
/** char → model rotation (Ry −90°). */
export const Q_C2M = new THREE.Quaternion().setFromAxisAngle(Y, -Math.PI / 2);
export const Q_M2C = Q_C2M.clone().invert();
/** Reference hip height for hips translation offsets (metres). */
export const REF_HIP_HEIGHT = 1.0;

/**
 * Weapon socket convention: in model space at rest, a weapon attached to socket_hand_* has its blade (+Y)
 * pointing FORWARD (+Z model), its local +Z pointing UP (+Y model) and its local +X toward the character's right.
 * attachToSocket() applies this regardless of how the GLB's socket bone is oriented.
 */
export const SOCKET_CONVENTION = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)),
);

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** Convert a character-space XYZ-degree Euler to a model-space quaternion. */
export function charEulerToModelQuat(x, y, z, out = new THREE.Quaternion()) {
  _e.set(x * DEG2RAD, y * DEG2RAD, z * DEG2RAD, 'XYZ');
  _q.setFromEuler(_e);
  return out.copy(Q_C2M).multiply(_q).multiply(Q_M2C);
}

/** Character-space vector → model-space vector. */
export const charToModel = (x, y, z, out = new THREE.Vector3()) => out.set(-z, y, x);
/** Model-space vector → character-space vector. */
export const modelToChar = (v, out = new THREE.Vector3()) => out.set(v.z, v.y, -v.x);

/**
 * Rest-pose info of a rig instance (captured once; cached on model.userData.rigInfo).
 * The model's current node transforms are taken as the rest pose, so call this before any animation.
 */
export class RigInfo {
  constructor(model) {
    model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    this.model = model;
    this.bones = new Map();
    const worldQ = new THREE.Quaternion(), worldP = new THREE.Vector3(), worldS = new THREE.Vector3();
    model.traverse((o) => {
      if (!(o.isBone || o.type === 'Bone' || o.isObject3D) || !o.name) return;
      if (this.bones.has(o.name) || o === model) return;
      _m.multiplyMatrices(inv, o.matrixWorld);
      _m.decompose(worldP, worldQ, worldS);
      const parent = o.parent;
      const pm = new THREE.Matrix4();
      if (parent && parent !== model) pm.multiplyMatrices(inv, parent.matrixWorld); else pm.identity();
      const pq = new THREE.Quaternion(), pp = new THREE.Vector3(), ps = new THREE.Vector3();
      pm.decompose(pp, pq, ps);
      this.bones.set(o.name, {
        node: o,
        isBone: !!o.isBone,
        restLocalQ: o.quaternion.clone(),
        restLocalP: o.position.clone(),
        restQ: worldQ.clone(),                      // model-space rest orientation
        restP: worldP.clone(),
        parentRestQInv: pq.clone().invert(),        // model-space parent rest orientation, inverted
        parentInvLinear: new THREE.Matrix3().setFromMatrix4(pm).invert(), // model → parent-local (for translations)
      });
    });
    const hips = this.bones.get('hips');
    this.hipHeight = hips ? hips.restP.y : REF_HIP_HEIGHT;
    this.hipScale = this.hipHeight / REF_HIP_HEIGHT;
    this.key = model.userData.rigKey || ('rig' + Math.random().toString(36).slice(2));
  }

  static of(model) {
    if (!model.userData.rigInfo) model.userData.rigInfo = new RigInfo(model);
    return model.userData.rigInfo;
  }

  has(name) { return this.bones.has(name); }

  /** Bone-local quaternion for a character-space rotation offset (degrees). */
  localQuat(name, x, y, z, out = new THREE.Quaternion()) {
    const b = this.bones.get(name);
    if (!b) return null;
    charEulerToModelQuat(x, y, z, _q2);
    return out.copy(b.parentRestQInv).multiply(_q2).multiply(b.restQ);
  }

  /** Bone-local position for a hips-style translation offset (character space, reference-rig metres). */
  localPos(name, dx, dy, dz, out = new THREE.Vector3()) {
    const b = this.bones.get(name);
    if (!b) return null;
    const s = this.hipScale;
    charToModel(dx * s, dy * s, dz * s, _v2);
    _v2.applyMatrix3(b.parentInvLinear);
    return out.copy(b.restLocalP).add(_v2);
  }

  /** Apply a static pose { bone: [x,y,z] } directly to the nodes (showcase / debugging). */
  applyPose(pose = {}, hips = null) {
    for (const [name, b] of this.bones) { b.node.quaternion.copy(b.restLocalQ); b.node.position.copy(b.restLocalP); }
    for (const name in pose) { const r = pose[name]; const q = this.localQuat(name, r[0], r[1], r[2]); if (q) this.bones.get(name).node.quaternion.copy(q); }
    if (hips) { const p = this.localPos('hips', hips[0], hips[1], hips[2]); if (p) this.bones.get('hips').node.position.copy(p); }
  }
}
const _q2 = new THREE.Quaternion();
const _v2 = new THREE.Vector3();

/** Mirror a pose object L↔R across the sagittal plane (negate X and Y rotations). */
export function mirrorPose(pose) {
  const out = {};
  for (const k in pose) {
    const m = k.endsWith('_L') ? k.slice(0, -2) + '_R' : k.endsWith('_R') ? k.slice(0, -2) + '_L' : k;
    const r = pose[k];
    out[m] = [-r[0], -r[1], r[2]];
  }
  return out;
}

/**
 * Attach a weapon (grip at origin, blade +Y) to a socket so it follows SOCKET_CONVENTION at rest, whatever the
 * socket bone's own orientation/scale in the GLB.
 */
export function attachToSocket(rigInfo, socketName, weapon) {
  const b = rigInfo.bones.get(socketName);
  if (!b) return false;
  // weapon local = Qsocket_rest⁻¹ · CONVENTION   (so model-space weapon orientation = CONVENTION at rest)
  weapon.quaternion.copy(b.restQ).invert().multiply(SOCKET_CONVENTION);
  // undo any armature scale so weapons are authored in metres
  const ws = new THREE.Vector3();
  const m = new THREE.Matrix4().copy(rigInfo.model.matrixWorld).invert().multiply(b.node.matrixWorld);
  m.decompose(new THREE.Vector3(), new THREE.Quaternion(), ws);
  weapon.scale.set(1 / (ws.x || 1), 1 / (ws.y || 1), 1 / (ws.z || 1));
  weapon.position.set(0, 0, 0);
  b.node.add(weapon);
  markEdgeDark(weapon);
  return true;
}

// C2 r3 (hero-weapons; board r2 "blades swallowed by the contact flash / lost against the brown ground"): the three hero
// weapons opt into the character look's pixel-width DARK silhouette rim (render/characterLook.js reads
// material.userData.kcaEdgeDark at patch time — a per-material uniform, no extra program). A thin blade, a horn or an
// ax bit then holds its outline against a bright flash core, pale skin and the ground at 12-15 px. `&edgedark=0` = off (A/B).
// C2 r5 (hero-weapons; board r4 "nothing reads as metal: copper only face-on to the key, grey-blue turned / in shadow"):
// the same four weapons also opt into the look's HUE-LOCKED METAL (characterLook.js kMetalTint: the lit colour of metal
// texels keeps the albedo's chroma at every angle, luminance floored at 0.5 x the albedo, hot highlights drift to white).
// `&metaltint=0` = off (A/B). Both are per-material uniforms: no extra program.
// C2 r6 (hero-weapons; board r5 6.92 "metals read as painted ceramic: one mid value, no dark body, no highlight"): the lock
// is tuned PER WEAPON for value range: a lower shadow floor (y), a contrast term (w, characterLook.js kMetalTint.w) and a
// per-material IBL scale (kMetalEnv: the violet sky's uniform reflection is what filled the heads with one pale value).
// A/B hooks: `&mtint=s,f,d,c` overrides the vec4 for all four weapons, `&menv=x` the IBL scale.
const HERO_WEAPON = /^weapon_(grudgebrand|dawn|dusk|copperax)$/;
const EDGE_DARK = 0.85;
const METAL_TINT = {                       // [strength, shadow floor, highlight desaturation, contrast]
  weapon_copperax: [1.0, 0.22, 0.12, 0.7],
  weapon_grudgebrand: [0.85, 0.3, 0.5, 0.45],
  weapon_dawn: [0.85, 0.24, 0.55, 0.6],
  weapon_dusk: [1.0, 0.15, 0.12, 0.7],       // C2 r11 (board r10 "Dusk in-band no light-to-dark range"): lower floor + contrast = a dark side (r8 [1, .30, .12, .35])
};
const METAL_ENV = { weapon_copperax: 0.4, weapon_grudgebrand: 0.6, weapon_dawn: 0.45, weapon_dusk: 0.45 };
function markEdgeDark(weapon) {
  const q = typeof location !== 'undefined' ? location.search : '';
  const edgeDark = !/[?&]edgedark=0(&|$)/.test(q), metalTint = !/[?&]metaltint=0(&|$)/.test(q);
  if (!edgeDark && !metalTint) return;
  let hero = null;
  weapon.traverse((o) => { if (HERO_WEAPON.test(o.name)) hero = o.name; });
  if (!hero) return;
  const mo = /[?&]mtint=([\d.,-]+)/.exec(q), eo = /[?&]menv=([\d.]+)/.exec(q);
  const tint = mo ? mo[1].split(',').map(Number) : METAL_TINT[hero];
  const env = eo ? Number(eo[1]) : METAL_ENV[hero];
  weapon.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      if (edgeDark) {
        m.userData.kcaEdgeDark = EDGE_DARK;
        if (m.userData.kcaEdgeDarkU) m.userData.kcaEdgeDarkU.value = EDGE_DARK;   // look already patched (re-attach)
      }
      if (metalTint) {
        // C2 r8: weapon-only finite key reflection, same program as other actors.
        const glint = [/[?&]wglint=0(&|$)/.test(q) ? 0 : 1,
          hero === 'weapon_grudgebrand' ? 1.265 : hero === 'weapon_copperax' ? 0.819 : 0.936,
          hero === 'weapon_copperax' ? 0.38 : 0.20, hero === 'weapon_copperax' ? 1 : 0];
        // Neutral steel multiplier preserves the baked shadow-side gradient.
        // The map still supplies the face-to-bevel gradient; assignment is idempotent on reattach.
        if (hero === 'weapon_grudgebrand') m.color.setScalar(1.0);
        if (hero === 'weapon_copperax') m.color.setScalar(0.70);
        // C2 r9: Dusk in play drifted periwinkle against the select violet: a violet-ward body multiplier (select re-sets its own colour).
        if (hero === 'weapon_dusk') m.color.setRGB(1.1, 0.8, 1.1);   // C2 r11: a touch lighter body (r9 1, .73, 1) so the deeper contrast keeps a violet mid
        // C2 r9: deeper knotwork channel walls at every distance (select read as surface linework).
        if (hero === 'weapon_copperax' && m.normalScale) m.normalScale.setScalar(1.6);
        // Swords: across-reflection scale, sabre curvature, highlight chroma retention, select centre offset.
        // C2 r11 Copper Ax (its own shader branch, characterLook.js): body ceiling x albedo, hotspot amplitude, hotspot width (m),
        // face value-structure depth. A/B hook `&axshape=a,b,c,d`.
        const axq = /[?&]axshape=([\d.,-]+)/.exec(q);
        const shape = hero === 'weapon_copperax' ? (axq ? axq[1].split(',').map(Number) : [1.3, 2.8, 0.05, 1.0])
          : hero === 'weapon_grudgebrand' ? [0.095, 0, 0.12, 0] : [0.066, 0.165, hero === 'weapon_dusk' ? 0.32 : 0.28, 0];
        m.userData.kcaWeaponShape = shape;
        if (m.userData.kcaWeaponShapeU) m.userData.kcaWeaponShapeU.value.fromArray(shape);
        m.userData.kcaWeaponGlint = glint;
        if (m.userData.kcaWeaponGlintU) m.userData.kcaWeaponGlintU.value.fromArray(glint);
        m.userData.kcaMetalTint = tint;
        if (m.userData.kcaMetalTintU) m.userData.kcaMetalTintU.value.fromArray(tint);
        m.userData.kcaMetalEnv = env;
        if (m.userData.kcaMetalEnvU) m.userData.kcaMetalEnvU.value = env;
      }
    }
  });
}
