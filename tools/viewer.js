// KnotzCopperAx — standalone GLB inspector (served by Vite at /tools/viewer.html).
//
//   /tools/viewer.html?model=/assets/models/hero_brann.glb&weapon=/assets/models/weapon_grudgebrand.glb
//        &pose=rest|apose|lunge|armsup|crouch|twist|ready  &view=front|three-quarter|side|back|game|face|hand|weapon
//        &turntable=0|1  [&yaw=deg] [&zoom=1] [&exposure=1] [&bones=1] [&wire=1] [&channel=albedo|normal|rough|metal|ao]
//        [&bg=studio|dusk] [&capture=1 (set by tools/capture.mjs)] [&grey=1 (greyscale value check)]
//        [&lgrip=-0.14 (weapon-local Y of the left-hand grip point for two-hand poses)]
//
// Two-hand poses (ready): after FK, the left arm is solved by 2-bone IK so socket_hand_L sits on the weapon grip
// at lgrip with the same socket convention as the right hand (mirrored fists, thumbs toward the blade).
// __KCA.viewer.probe() samples the rendered (tone-mapped sRGB) pixels at named body points -> value groups
// (skin / cloth / leather / hair) for the colour-blocking check.
//
// window.__KCA = { ready, setManualClock(bool), advance(ms), info(), viewer: { setPose, setView, model } }
// so `node tools/capture.mjs --url "/tools/viewer.html?..."` works exactly like on the game.
//
// TEST-POSE CONVENTION (identical to src/anim/retarget.js, but self-contained — no import):
//   character space: +X = forward (facing), +Y = up, +Z = character's RIGHT (right-handed).
//   model space (glTF rest): +Z = forward, +Y = up, +X = character's LEFT.  char→model = Ry(−90°): (x,y,z)→(−z,y,x).
//   A pose entry is [x,y,z] degrees (Euler 'XYZ' about CHARACTER axes at rest), or {twist: deg} = rotation about the
//   bone's own rest direction (forearm/hand pronation tests), or {axis:[x,y,z], deg} in character space.
//   Per bone:  local = Qparent_rest⁻¹ · R · Qbone_rest   (FK: children follow).  Signs: +Z raises a hanging limb
//   forward / tips the torso back (forward lean = −Z, knee bend = −Z on the shin); +Y turns left; +X on a LEFT limb
//   abducts it (a RIGHT limb abducts with −X).  hips: [x,y,z] metres for a 1 m hip height (scaled by the rig's).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const Q = new URLSearchParams(location.search);
const P = {
  model: Q.get('model') || '/assets/models/hero_brann.glb',
  weapon: Q.get('weapon') || '',
  weaponL: Q.get('weaponL') || '',
  pose: Q.get('pose') || 'rest',
  view: Q.get('view') || 'three-quarter',
  turntable: Q.get('turntable') === '1',
  capture: Q.get('capture') === '1',
  bones: Q.get('bones') === '1',
  wire: Q.get('wire') === '1',
  exposure: parseFloat(Q.get('exposure') || '1'),
  yaw: parseFloat(Q.get('yaw') || '0'),
  zoom: parseFloat(Q.get('zoom') || '1'),
  bg: Q.get('bg') || 'studio',
  channel: Q.get('channel') || '',
  grey: Q.get('grey') === '1',
  lgrip: parseFloat(Q.get('lgrip') || '-0.14'),     // overridden by the weapon's `grip_offhand` node unless &lgrip is given
  lgripFromUrl: Q.has('lgrip'),
};

const errors = [];
const errEl = document.getElementById('err');
function reportError(msg) {
  errors.push(String(msg).slice(0, 500));
  errEl.textContent = errors.slice(-4).join('\n');
}
window.addEventListener('error', (e) => reportError(e.message || e));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason && (e.reason.stack || e.reason.message) || e.reason));

// ------------------------------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(P.capture ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = P.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
if (P.grey) renderer.domElement.style.filter = 'grayscale(1)';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.enabled = !P.capture;

function gradientTexture(stops, w = 4, h = 512, radial = false) {
  const c = document.createElement('canvas');
  c.width = radial ? h : w; c.height = h;
  const g = c.getContext('2d');
  const grad = radial ? g.createRadialGradient(h / 2, h / 2, 0, h / 2, h / 2, h / 2) : g.createLinearGradient(0, 0, 0, h);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const BG = {
  studio: [[0, '#4a4f58'], [0.55, '#2b2e34'], [1, '#141518']],
  dusk: [[0, '#5b3a3a'], [0.5, '#2c2226'], [1, '#121015']],
};
scene.background = gradientTexture(BG[P.bg] || BG.studio);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.42;

// key / fill / rims — neutral look-dev rig (warm key, cool fill, strong rims for silhouette)
const key = new THREE.DirectionalLight(0xfff0dc, 2.7);
key.position.set(-2.6, 4.6, 3.8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.025;
key.shadow.radius = 3;
const fill = new THREE.DirectionalLight(0xc8d8ff, 0.7);
fill.position.set(3.5, 1.6, 3.0);
const rimA = new THREE.DirectionalLight(0xffe2c4, 2.4);
rimA.position.set(2.8, 3.8, -4.0);
const rimB = new THREE.DirectionalLight(0xb8ccff, 1.3);
rimB.position.set(-3.2, 2.6, -3.4);
const rig = new THREE.Group();
rig.add(key, key.target, fill, fill.target, rimA, rimA.target, rimB, rimB.target);
scene.add(rig);

const groundTex = gradientTexture([[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']], 4, 512, true);
const ground = new THREE.Mesh(new THREE.CircleGeometry(4.5, 96),
  new THREE.MeshStandardMaterial({ color: 0x34373d, roughness: 0.93, metalness: 0, alphaMap: groundTex, transparent: true, depthWrite: false }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.renderOrder = -1;
scene.add(ground);
// shadow catcher (opaque shadow only) so the fading ground doesn't wash the contact shadow out
const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(4.5, 96), new THREE.ShadowMaterial({ opacity: 0.55 }));
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = 0.001;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

// ------------------------------------------------------------------------------------------ rig helpers
const Yax = new THREE.Vector3(0, 1, 0);
const C2M = new THREE.Quaternion().setFromAxisAngle(Yax, -Math.PI / 2);
const M2C = C2M.clone().invert();
const DEG = Math.PI / 180;
const charToModel = (v) => new THREE.Vector3(-v[2], v[1], v[0]);

const POSES = {
  rest: {},
  apose: {},
  lunge: {
    hips: [0.10, -0.30, 0.0],
    rot: {
      hips: [0, 12, 0], spine: [0, -6, -12], chest: [0, -8, -8], neck: [0, 0, 6], head: [0, 4, 12],
      thigh_L: [4, 0, 70], shin_L: [0, 0, -80], foot_L: [0, 0, 10],
      thigh_R: [-4, 0, -35], shin_R: [0, 0, -25], foot_R: [0, 0, 32],
      clavicle_R: [0, 0, 8], upperarm_R: [-15, 0, 72], forearm_R: [0, 0, 28], hand_R: [0, 0, -10],
      upperarm_L: [25, 0, -30], forearm_L: [0, 0, 45],
    },
  },
  armsup: {
    rot: {
      clavicle_L: [18, 0, 0], clavicle_R: [-18, 0, 0],
      upperarm_L: [125, 0, 6], upperarm_R: [-125, 0, 6], forearm_L: [0, 0, 18], forearm_R: [0, 0, 18],
      chest: [0, 0, 6], head: [0, 0, 10],
    },
  },
  crouch: {
    hips: [-0.06, -0.52, 0.0],
    rot: {
      thigh_L: [10, 0, 100], thigh_R: [-10, 0, 100], shin_L: [0, 0, -118], shin_R: [0, 0, -118],
      foot_L: [0, 0, 18], foot_R: [0, 0, 18], spine: [0, 0, -28], chest: [0, 0, -12], neck: [0, 0, 12], head: [0, 0, 24],
      upperarm_L: [-15, 0, 42], upperarm_R: [15, 0, 42], forearm_L: [0, 0, 55], forearm_R: [0, 0, 55],
    },
  },
  twist: {
    rot: {
      hips: [0, -10, 0], spine: [0, 24, 0], chest: [0, 30, 0], neck: [0, 12, 0], head: [0, 12, 0],
      upperarm_R: [-10, 0, 48], forearm_R: [0, 0, 50], hand_R: { twist: -60 },
      upperarm_L: [20, 0, 30], forearm_L: [0, 0, 70], hand_L: { twist: 75 },
      thigh_L: [0, -10, 12], shin_L: [0, 0, -14],
    },
  },
  ready: {  // two-handed front guard: both arms solved by IK onto the grip (see twoHandIK)
    // grip = right-hand grip point, char space, metres from the hips bone (1 m hip height); blade = direction
    twoHand: { grip: [0.30, 0.24, -0.02], blade: [0.55, 0.83, -0.08] },
    hips: [0.0, -0.06, 0.0],
    rot: {
      hips: [0, 18, 0], spine: [0, -6, -6], chest: [0, -10, -4], head: [0, -12, 4],
      thigh_L: [6, 8, 22], shin_L: [0, 0, -26], thigh_R: [-6, -4, -12], shin_R: [0, 0, -18], foot_R: [0, 0, 10],
      clavicle_R: [0, 0, 6], upperarm_R: [-10, 0, 30], forearm_R: [0, 0, 60],
      clavicle_L: [0, 0, 6], upperarm_L: [10, 0, 30], forearm_L: [0, 0, 60],
    },
  },
};

class Rig {
  constructor(root) {
    this.root = root;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    this.bones = new Map();
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.name || o === root || this.bones.has(o.name)) return;
      m.multiplyMatrices(inv, o.matrixWorld).decompose(p, q, s);
      this.bones.set(o.name, { o, restQ: o.quaternion.clone(), restP: o.position.clone(), modelQ: q.clone(), modelP: p.clone() });
    });
    const hips = this.bones.get('hips');
    this.hipHeight = hips ? hips.modelP.y : 1.0;
  }
  parentModelQ(o) {
    const pe = o.parent && this.bones.get(o.parent.name);
    return pe && o.parent !== this.root ? pe.modelQ : new THREE.Quaternion();
  }
  childDir(name) {
    const e = this.bones.get(name);
    let best = null;
    for (const c of e.o.children) {
      const ce = this.bones.get(c.name);
      if (ce && !c.name.startsWith('socket')) { best = ce; break; }
    }
    const d = new THREE.Vector3();
    if (best) d.copy(best.modelP).sub(e.modelP);
    else d.set(0, 1, 0).applyQuaternion(e.modelQ);
    return d.normalize();
  }
  reset() {
    for (const e of this.bones.values()) { e.o.quaternion.copy(e.restQ); e.o.position.copy(e.restP); }
  }
  apply(pose) {
    this.reset();
    const rot = Object.assign({}, pose.rot || {});
    // kilt panels follow the thighs (stand-in for the runtime secondary-motion springs)
    const tz = (n) => (rot[n] && Array.isArray(rot[n]) ? rot[n] : [0, 0, 0]);
    const L = tz('thigh_L'), R = tz('thigh_R');
    const fwd = Math.max(L[2], R[2], 0), back = Math.min(L[2], R[2], 0);
    const kilt = { F: [0, 0, fwd * 0.72], B: [0, 0, back * 0.72 + Math.max(0, Math.min(L[2], R[2])) * 0.35],
      L: [L[0] * 0.6, 0, L[2] * 0.4], R: [R[0] * 0.6, 0, R[2] * 0.4] };
    for (const side of ['F', 'B', 'L', 'R']) {
      const nm = `kilt_${side}_1`;
      if (this.bones.has(nm) && !rot[nm]) rot[nm] = kilt[side];
    }
    const order = [];
    this.root.traverse((o) => { if (this.bones.has(o.name)) order.push(o.name); });
    for (const name of order) {
      const spec = rot[name];
      if (!spec) continue;
      const e = this.bones.get(name);
      const R = new THREE.Quaternion();
      if (Array.isArray(spec)) {
        R.setFromEuler(new THREE.Euler(spec[0] * DEG, spec[1] * DEG, spec[2] * DEG, 'XYZ'));
        R.premultiply(C2M).multiply(M2C);
      } else if (spec.twist !== undefined) {
        R.setFromAxisAngle(this.childDir(name), spec.twist * DEG);
      } else if (spec.axis) {
        R.setFromAxisAngle(charToModel(spec.axis).normalize(), spec.deg * DEG);
      }
      const qp = this.parentModelQ(e.o);
      e.o.quaternion.copy(qp.clone().invert().multiply(R).multiply(e.modelQ));
    }
    if (pose.hips && this.bones.has('hips')) {
      const e = this.bones.get('hips');
      const d = charToModel(pose.hips).multiplyScalar(this.hipHeight / 1.0);
      d.applyQuaternion(this.parentModelQ(e.o).clone().invert());
      e.o.position.copy(e.restP).add(d);
    }
    this.root.updateMatrixWorld(true);
  }
}

// socket convention (same as src/anim/retarget.js SOCKET_CONVENTION): at rest the weapon's +Y (blade) points
// forward (+Z model), its +Z up (+Y model), its +X to the character's right (−X model), whatever the socket axes.
const SOCKET_CONV = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));

// ------------------------------------------------------------------------------------------ two-hand IK
const _wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const _wp = (o) => o.getWorldPosition(new THREE.Vector3());
function setWorldQ(o, q) { o.quaternion.copy(_wq(o.parent).invert().multiply(q)); o.updateMatrixWorld(true); }

function solveArm(rig, side, T, Qw) {
  // 2-bone IK: socket_hand_<side> onto T with the socket convention matching weapon world orientation Qw
  const B = (n) => rig.bones.get(n);
  const up = B('upperarm_' + side), fo = B('forearm_' + side), ha = B('hand_' + side), so = B('socket_hand_' + side);
  if (!up || !fo || !ha || !so) return null;
  const Qso = Qw.clone().multiply(SOCKET_CONV.clone().invert()).multiply(so.modelQ);
  const Qha = Qso.clone().multiply(so.o.quaternion.clone().invert());
  const offH = _wp(so.o).sub(_wp(ha.o)).applyQuaternion(_wq(ha.o).invert());
  const W = T.clone().sub(offH.applyQuaternion(Qha));
  const S = _wp(up.o), E = _wp(fo.o), W0 = _wp(ha.o);
  const a = E.distanceTo(S), b = W0.distanceTo(E);
  const toW = W.clone().sub(S);
  const reach = toW.length() / (a + b);
  const d = Math.min(toW.length(), (a + b) * 0.999);
  const dir = toW.normalize();
  // elbow pole: down, back and out (model +X = character LEFT)
  const sx = side === 'L' ? 1 : -1;
  const pole = new THREE.Vector3(0.75 * sx, -1.0, -0.35).applyQuaternion(_wq(rig.root)).normalize();
  pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(a * a - x * x, 0));
  const Ed = S.clone().add(dir.clone().multiplyScalar(x)).add(pole.multiplyScalar(h));
  const Wd = S.clone().add(dir.clone().multiplyScalar(d));
  const q1 = new THREE.Quaternion().setFromUnitVectors(E.clone().sub(S).normalize(), Ed.clone().sub(S).normalize());
  setWorldQ(up.o, q1.multiply(_wq(up.o)));
  const E2 = _wp(fo.o), W2 = _wp(ha.o);
  const q2 = new THREE.Quaternion().setFromUnitVectors(W2.clone().sub(E2).normalize(), Wd.clone().sub(E2).normalize());
  setWorldQ(fo.o, q2.multiply(_wq(fo.o)));
  // pronation / supination: the forearm absorbs the twist of the hand about the forearm axis (clamped +-100 deg)
  const delta = _wq(fo.o).invert().multiply(Qha).multiply(ha.restQ.clone().invert());
  const ax = ha.o.position.clone().normalize();
  const pr = ax.clone().multiplyScalar(ax.dot(new THREE.Vector3(delta.x, delta.y, delta.z)));
  const tw = new THREE.Quaternion(pr.x, pr.y, pr.z, delta.w).normalize();
  let ang = 2 * Math.acos(Math.min(1, Math.abs(tw.w)));
  if (ang > 1e-4) {
    const sgn = Math.sign(tw.w) * Math.sign(pr.dot(ax)) || 1;
    ang = Math.min(ang, 100 * DEG);
    fo.o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax, sgn * ang));
    fo.o.updateMatrixWorld(true);
  }
  setWorldQ(ha.o, Qha);
  // wrist strain = hand rotation away from its rest pose relative to the forearm
  const strain = ha.o.quaternion.angleTo(ha.restQ);
  return { miss: _wp(so.o).distanceTo(T), reach, strain };
}

function twoHandIK(rig, weapon, spec) {
  // Place the weapon from spec (grip point + blade direction in char space), then solve BOTH arms onto the grip:
  // right hand at the grip origin, left hand at weapon-local y = lgrip. The roll of the sword about its own axis is
  // searched so the two wrists stay closest to their rest orientation (no candy-wrapper twists).
  const hipsE = rig.bones.get('hips');
  if (!weapon || !hipsE || !spec) return null;
  rig.root.updateMatrixWorld(true);
  const mq = _wq(rig.root);
  const c2w = (v) => charToModel(v).applyQuaternion(mq);
  const scl = rig.hipHeight / 1.0;
  const T_R = _wp(hipsE.o).add(c2w(spec.grip).multiplyScalar(scl));
  const Y = c2w(spec.blade).normalize();
  const T_L = T_R.clone().add(Y.clone().multiplyScalar(P.lgrip));
  const ref = Math.abs(Y.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const X0 = new THREE.Vector3().crossVectors(Y, ref).normalize();
  const Z0 = new THREE.Vector3().crossVectors(X0, Y).normalize();
  const arms = ['clavicle_L', 'upperarm_L', 'forearm_L', 'hand_L', 'clavicle_R', 'upperarm_R', 'forearm_R', 'hand_R']
    .map((n) => rig.bones.get(n)).filter(Boolean);
  const fk = arms.map((e) => e.o.quaternion.clone());
  const restore = () => { arms.forEach((e, i) => e.o.quaternion.copy(fk[i])); rig.root.updateMatrixWorld(true); };
  const QwFor = (deg) => {
    const c = Math.cos(deg * DEG), s_ = Math.sin(deg * DEG);
    const X = X0.clone().multiplyScalar(c).add(Z0.clone().multiplyScalar(-s_));
    const Z = new THREE.Vector3().crossVectors(X, Y);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  };
  // the grip is symmetric under a half-turn about the blade axis, and the socket convention is NOT mirrored
  // (+X = character right for both hands), so the left fist may hold the grip "flipped" (Qw * Ry(180)).
  const flipQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  let best = null;
  for (let deg = 0; deg < 360; deg += 10) {
    const Qw = QwFor(deg);
    for (const flip of [false, true]) {
      restore();
      const r = solveArm(rig, 'R', T_R, Qw), l = solveArm(rig, 'L', T_L, flip ? Qw.clone().multiply(flipQ) : Qw);
      if (!r || !l) return null;
      const cost = r.strain + l.strain;
      if (!best || cost < best.cost) best = { deg, flip, cost };
    }
  }
  restore();
  const Qw = QwFor(best.deg);
  const r = solveArm(rig, 'R', T_R, Qw), l = solveArm(rig, 'L', T_L, best.flip ? Qw.clone().multiply(flipQ) : Qw);
  rig.root.updateMatrixWorld(true);
  const f = (v) => +v.toFixed(3);
  return { roll: best.deg, flipL: best.flip, missR: f(r.miss), missL: f(l.miss), reachR: f(r.reach), reachL: f(l.reach),
    strainR: f(r.strain / DEG), strainL: f(l.strain / DEG) };
}

function applyPose(name) {
  const pose = POSES[name] || POSES.rest;
  state.rig.apply(pose);
  state.ik = pose.twoHand ? twoHandIK(state.rig, state.weapons[0], pose.twoHand) : null;
}

// ------------------------------------------------------------------------------------------ value probe
// named points (bone lerps + model-space offsets in metres; model +Z = forward, +X = character left)
const PROBES = [
  ['skin', 'upperarm', ['upperarm_R', 'forearm_R', 0.45], [0, 0, 0]],
  ['skin', 'face', ['head', 'head', 0], [-0.03, 0.08, 0.09]],
  ['skin', 'calf', ['shin_R', 'foot_R', 0.12], [0, 0, 0]],
  ['cloth', 'kilt_hi', ['thigh_R', 'shin_R', 0.22], [0, 0, 0]],
  ['cloth', 'kilt_lo', ['thigh_R', 'shin_R', 0.42], [0, 0, 0.03]],
  ['leather', 'bracer', ['forearm_R', 'hand_R', 0.5], [0, 0, 0]],
  ['leather', 'boot_top', ['shin_R', 'foot_R', 0.55], [0, 0, 0]],
  ['leather', 'boot', ['shin_R', 'foot_R', 0.72], [0, 0, 0]],
  ['leather', 'belt', ['hips', 'hips', 0], [-0.17, 0.05, 0.0]],
  ['hair', 'mane_crown', ['head', 'head', 0], [0, 0.15, -0.06]],
  ['hair', 'mane_back', ['neck', 'neck', 0], [0, -0.02, -0.16]],
];
function probe(list = PROBES, r = 3) {
  renderOnce();
  const cv = renderer.domElement;
  const c2 = document.createElement('canvas');
  c2.width = cv.width; c2.height = cv.height;
  const g = c2.getContext('2d', { willReadFrequently: true });
  g.drawImage(cv, 0, 0);
  const ray = new THREE.Raycaster();
  const targets = [state.model, ...state.weapons];
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const out = [];
  const mq = _wq(state.model);
  for (const [group, name, [b0, b1, t], off] of list) {
    const e0 = state.rig.bones.get(b0), e1 = state.rig.bones.get(b1);
    if (!e0 || !e1) continue;
    const Pw = _wp(e0.o).lerp(_wp(e1.o), t).add(new THREE.Vector3(...off).applyQuaternion(mq));
    const ndc = Pw.clone().project(camera);
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const hit = ray.intersectObjects(targets, true)[0];
    const px = Math.round((ndc.x * 0.5 + 0.5) * cv.width), py = Math.round((0.5 - ndc.y * 0.5) * cv.height);
    const d = g.getImageData(px - r, py - r, 2 * r + 1, 2 * r + 1).data;
    let R = 0, G = 0, Bc = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; Bc += d[i + 2]; n++; }
    const rgb = [R / n, G / n, Bc / n].map((v) => Math.round(v));
    const Y = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const Lstar = Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;       // perceptual lightness 0..100
    out.push({ group, name, px: [px, py], rgb, L: +Lstar.toFixed(1), hitDist: hit ? +hit.point.distanceTo(Pw).toFixed(3) : null });
  }
  const groups = {};
  for (const o of out) (groups[o.group] ||= []).push(o.L);
  // median per group (small parts: one probe may land on a stud / trim)
  const med = (v) => { const a = [...v].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const groupL = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, +med(v).toFixed(1)]));
  return { points: out, groupL };
}

// ------------------------------------------------------------------------------------------ load
const loader = new GLTFLoader();
const state = { model: null, rig: null, weapons: [], t: 0, manual: false, fps: 0, stats: {} };
const holder = new THREE.Group();
scene.add(holder);

function prepMeshes(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (P.wire) m.wireframe = true;
      if (P.channel) debugChannel(m);
    }
  });
}

function debugChannel(m) {
  const ch = P.channel;
  const mk = (map, colorSpace) => {
    const b = new THREE.MeshBasicMaterial({ map });
    if (map) map.colorSpace = colorSpace;
    return b;
  };
  let alt = null;
  if (ch === 'albedo') alt = mk(m.map, THREE.SRGBColorSpace);
  else if (ch === 'normal') alt = mk(m.normalMap, THREE.NoColorSpace);
  else if (ch === 'rough' || ch === 'metal' || ch === 'ao') {
    const tex = ch === 'ao' ? m.aoMap : m.roughnessMap;
    const comp = { rough: 'g', metal: 'b', ao: 'r' }[ch];
    alt = new THREE.ShaderMaterial({
      uniforms: { t: { value: tex } }, vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `uniform sampler2D t; varying vec2 vUv; void main(){ float v = texture2D(t, vUv).${comp}; gl_FragColor = vec4(vec3(v),1.); }`,
    });
  }
  if (alt) Object.assign(m, { __alt: alt });
}

function useDebugMaterials(root) {
  root.traverse((o) => { if (o.isMesh && o.material.__alt) { o.material = o.material.__alt; } });
}

function modelStats(gltf, root) {
  let tris = 0, skinned = 0;
  const texs = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) skinned++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
      const t = m[k];
      if (t && t.image) texs.set(t.uuid, { slot: k, w: t.image.width, h: t.image.height });
    }
  });
  const box = new THREE.Box3().setFromObject(root, true);
  return { tris: Math.round(tris), skinnedMeshes: skinned, textures: [...texs.values()],
    bbox: { min: box.min.toArray().map((v) => +v.toFixed(3)), max: box.max.toArray().map((v) => +v.toFixed(3)) },
    height: +(box.max.y - box.min.y).toFixed(3) };
}

async function loadAll() {
  const gltf = await loader.loadAsync(P.model);
  const model = gltf.scene;
  prepMeshes(model);
  // a prop (weapon GLB: grip at the origin, no skin) stands on its lowest point instead of sinking into the floor
  let skinnedRoot = false;
  model.traverse((o) => { if (o.isSkinnedMesh) skinnedRoot = true; });
  if (!skinnedRoot) model.position.y = -new THREE.Box3().setFromObject(model, true).min.y + 0.002;
  holder.add(model);
  state.model = model;
  state.rig = new Rig(model);
  state.stats = modelStats(gltf, model);
  state.stats.bones = [...state.rig.bones.keys()].length;
  for (const [url, sock] of [[P.weapon, 'socket_hand_R'], [P.weaponL, 'socket_hand_L']]) {
    if (!url) continue;
    const wg = await loader.loadAsync(url);
    const w = wg.scene;
    prepMeshes(w);
    const se = state.rig.bones.get(sock);
    if (!se) { reportError('no ' + sock + ' in model'); continue; }
    w.quaternion.copy(se.modelQ.clone().invert().multiply(SOCKET_CONV));
    se.o.add(w);
    state.weapons.push(w);
    state.stats.weapon = modelStats(wg, w);
    const off = w.getObjectByName('grip_offhand');
    if (off && sock === 'socket_hand_R') {
      state.stats.weapon.nodes = ['grip_main', 'grip_offhand', 'blade_tip'].filter((n) => w.getObjectByName(n));
      if (!P.lgripFromUrl) P.lgrip = off.position.y;
    }
  }
  if (P.channel) { useDebugMaterials(model); for (const w of state.weapons) useDebugMaterials(w); }
  if (P.bones) {
    const sh = new THREE.SkeletonHelper(model);
    scene.add(sh);
  }
  applyPose(P.pose);
  setView(P.view);
}

// ------------------------------------------------------------------------------------------ views
function boneWorld(name) {
  const e = state.rig && state.rig.bones.get(name);
  const v = new THREE.Vector3();
  if (e) e.o.getWorldPosition(v);
  return v;
}

function setView(view) {
  P.view = view;
  const model = state.model;
  holder.rotation.set(0, (P.yaw || 0) * DEG, 0);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder, true);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  let target = c.clone(), fitH = size.y * 1.12, az = 0, pitch = 4, fov = 30;
  switch (view) {
    case 'front': az = 0; break;
    case 'three-quarter': az = 35; break;
    case 'side': az = -90; break;
    case 'back': az = 180; break;
    case 'face': target = boneWorld('head').add(new THREE.Vector3(0, 0.09, 0.02)); fitH = 0.40; az = 22; pitch = 2; fov = 24; break;
    case 'face-front': target = boneWorld('head').add(new THREE.Vector3(0, 0.09, 0.02)); fitH = 0.40; az = 0; pitch = 2; fov = 24; break;
    case 'bust': target = boneWorld('chest').add(new THREE.Vector3(0, 0.25, 0)); fitH = 0.95; az = 25; pitch = 3; break;
    case 'hand': target = boneWorld('hand_R').lerp(boneWorld('socket_hand_R'), 0.5); fitH = 0.34; az = -55; pitch = 20; fov = 24; break;
    case 'hand-l': target = boneWorld('hand_L').lerp(boneWorld('socket_hand_L'), 0.5); fitH = 0.34; az = 55; pitch = 20; fov = 24; break;
    case 'weapon': fitH = Math.max(size.y, size.z) * 1.1; az = 14; pitch = 6; break;          // show the flat of the blade
    case 'game': break;
    default: az = parseFloat(view) || 35;
  }
  if (view === 'game') {
    // gameplay framing: actor faces +X (screen right), camera ~16 m in front and ~5.6 m up, FOV 32
    holder.rotation.y = Math.PI / 2 + (P.yaw || 0) * DEG;
    camera.fov = 32;
    camera.position.set(0, 5.6, 16.0);
    controls.target.set(0, 1.15, 0);
    camera.lookAt(controls.target);
    ground.scale.setScalar(3);
    shadowCatcher.scale.setScalar(3);
  } else {
    camera.fov = fov;
    const d = (fitH / P.zoom) * 0.5 / Math.tan((fov * DEG) / 2);
    const a = az * DEG, p = pitch * DEG;
    camera.position.set(target.x + Math.sin(a) * Math.cos(p) * d, target.y + Math.sin(p) * d, target.z + Math.cos(a) * Math.cos(p) * d);
    controls.target.copy(target);
    camera.lookAt(target);
  }
  camera.near = 0.02; camera.far = 200;
  camera.updateProjectionMatrix();
  // keep the key-light shadow frustum tight around the model
  const r = Math.max(size.x, size.y, size.z) * 0.75 + 0.3;
  const cam = key.shadow.camera;
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 0.1; cam.far = 30;
  cam.updateProjectionMatrix();
  for (const l of [key, fill, rimA, rimB]) { l.target.position.copy(c); }
  rig.position.set(c.x, 0, c.z);
}

// ------------------------------------------------------------------------------------------ loop + hooks
const hud = document.getElementById('hud');
if (P.capture) hud.classList.add('hidden');
let lastT = performance.now(), frames = 0, fpsT = lastT;

function update() {
  if (P.turntable && state.model) {
    const base = P.view === 'game' ? Math.PI / 2 : 0;
    holder.rotation.y = base + (P.yaw || 0) * DEG + (state.t / 8000) * Math.PI * 2;
  }
  controls.update();
}

function renderOnce() {
  update();
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - fpsT > 1000) { state.fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
  if (!P.capture && state.model) {
    const s = state.stats;
    hud.textContent = `${P.model}\ntris ${s.tris}  bones ${s.bones}  height ${s.height} m\n` +
      `textures ${s.textures.map((t) => `${t.slot}:${t.w}`).join(' ')}\npose ${P.pose}  view ${P.view}  calls ${renderer.info.render.calls}`;
  }
}

function loop() {
  requestAnimationFrame(loop);
  if (state.manual) return;
  const now = performance.now();
  state.t += now - lastT;
  lastT = now;
  renderOnce();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const ready = (async () => {
  try {
    await loadAll();
  } catch (e) {
    reportError('load failed: ' + (e && (e.stack || e.message) || e));
    throw e;
  }
  await renderer.compileAsync(scene, camera);
  renderOnce();
  loop();
  return true;
})();

window.__KCA = {
  ready,
  setManualClock(b) { state.manual = !!b; lastT = performance.now(); },
  async advance(ms) { state.t += ms; renderOnce(); await new Promise((r) => requestAnimationFrame(() => r())); },
  info() {
    const i = renderer.info;
    return { fps: +state.fps.toFixed(1), drawCalls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries,
      textures: i.memory.textures, actors: 1, errors: errors.slice(), model: state.stats, pose: P.pose, view: P.view,
      ik: state.ik };
  },
  viewer: {
    setPose(name) { P.pose = name; applyPose(name); setView(P.view); renderOnce(); },
    probe,
    get ik() { return state.ik; },
    setView(v) { setView(v); renderOnce(); },
    poses: Object.keys(POSES),
    get model() { return state.model; },
    get rig() { return state.rig; },
  },
};
