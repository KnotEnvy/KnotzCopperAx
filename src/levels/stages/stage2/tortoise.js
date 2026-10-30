// Stage 2 — Old Shellfather's close, backward-looking head and neck.
// The broad costal deck meets a keratin nuchal hood and a continuous skin fold; the old detached carapace-quarter mesh is hidden. The head sits below the
// HUD, in the open span between huts. The wading foreleg stays in far water below the deck.
import * as THREE from 'three';
import { patchStandard } from '../../../render/shaderlib.js';
import { shellMaterial } from './shell.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const TORTOISE = {
  // The neck regards the passengers from the far rim. Keep its hood rooted in the
  // broad costal surface across the scrolling composition, with only a small breathing heave.
  far: { ox: 7, z: -12, S: 3.8, yaw: -120 },
  near: { ox: 7, z: -12, S: 3.8, yaw: -120 },
  waterZ: -0.15,                                           // rig-space (model units) lake line, see the Blender script
  span: [4, 64],
  turn: { neck_1: [0, 0], neck_2: [-8, 0], neck_3: [-8, -10], head: [-5, -45] },   // [pitch, yaw] deg per bone (−pitch = up)
  rim: { color: '#ffdca0', intensity: 0.32 },
  haze: { color: '#d0d6c8', amount: 0.1, start: 40, range: 300 },
  tint: [0.92, 0.85, 0.7], sat: 1.3, legTint: [0.95, 0.92, 0.84],
  leg: { S: 2.8, period: 9, shoulder: [2.2, -3.6, 2.2], dx0: 5.0, dx1: 3.0, z: -14, peak: -1.5 },
};

function tortoiseMaterial(T, { wet = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.72, metalness: 0, envMapIntensity: 0.22 });
  m.fog = !!wet;             // the far head does its own haze
  const U = {
    kTRim: { value: new THREE.Vector4(...new THREE.Color(T.rim.color).toArray(), T.rim.intensity) },
    kTHaze: { value: new THREE.Vector4(...new THREE.Color(T.haze.color).toArray(), wet ? 0 : T.haze.amount) },
    kTHz: { value: new THREE.Vector2(T.haze.start, T.haze.range) },
    kTTint: { value: new THREE.Vector4(...T.tint, T.sat) },
    kTEye: { value: 1 },
  };
  patchStandard(m, {
    key: wet ? 'kcaShellfatherLeg4' : 'kcaShellfather4', uniforms: U,
    vertHead: 'attribute float aGlow; varying float vGlow;',
    vertMain: 'vGlow = aGlow;',
    fragHead: 'varying float vGlow; float kTWet; uniform vec4 kTRim, kTHaze, kTTint; uniform vec2 kTHz; uniform float kTEye;',
    albedo: /* glsl */`
    {
      vec4 n = kTri(vKW * 0.35, vKN, 1.0), n2 = kTri(vKW * 1.9, vKN, 1.0);
      vec3 c = diffuseColor.rgb * (0.86 + 0.28 * n.r * n2.g + 0.1 * (n2.b - 0.5));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(vec3(0.0), mix(vec3(l), c, kTTint.w)) * kTTint.rgb;
      ${wet ? 'kTWet = 1.0; c *= 0.95;' : 'kTWet = 0.0;'}
      diffuseColor.rgb = c;
    }`,
    rough: 'roughnessFactor = mix(roughnessFactor, 0.42, kTWet); roughnessFactor = mix(roughnessFactor, 0.1, step(0.2, vGlow));',
    emissive: 'totalEmissiveRadiance += (vec3(1.0, 0.55, 0.12) * min(vGlow, 0.6) * 0.7 + vec3(1.0, 0.97, 0.9) * smoothstep(0.85, 0.98, vGlow) * 0.3) * kTEye;',
    fragEnd: /* glsl */`
    {
      float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
      outgoingLight += kTRim.rgb * kTRim.a * pow(1.0 - ndv, 2.4) * (0.35 + 0.65 * diffuseColor.r * 2.0);
      float hz = clamp((length(vViewPosition) - kTHz.x) / kTHz.y, 0.0, 1.0) * kTHaze.a;
      outgoingLight = mix(outgoingLight, kTHaze.rgb, hz);
    }`,
  });
  m.userData.U = U;
  return m;
}

function prepGeometry(geo) {
  // COLOR_0 is rgba (a = eye glow); split the alpha into aGlow so the opaque colour path stays rgb
  const c = geo.getAttribute('color');
  if (!c) { geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count), 1)); return; }
  if (c.itemSize === 4) {
    const n = c.count, rgb = new Float32Array(n * 3), glow = new Float32Array(n);
    for (let i = 0; i < n; i++) { rgb[i * 3] = c.getX(i); rgb[i * 3 + 1] = c.getY(i); rgb[i * 3 + 2] = c.getZ(i); glow[i] = c.getW(i); }
    geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  } else geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(c.count), 1));
}

function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,236,190,1)'); gr.addColorStop(0.18, 'rgba(255,170,60,0.85)'); gr.addColorStop(0.5, 'rgba(255,120,30,0.22)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// A nuchal hood continuous with the broad costal deck. Back skirt sinks into the deck;
// its arched leading edge overhangs the neck root, leaving the throat visible below.
function buildNuchalHood() {
  const vertices = [], scutes = [], indices = [];
  const rows = 24, sides = 32;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, z = -2.7 + t * 2.85;
    const width = 1.7 - t * 0.84;
    for (let i = 0; i <= sides; i++) {
      const u = i / sides * 2 - 1;
      const arch = Math.sqrt(Math.max(0, 1 - u * u));
      const y = -0.1 + Math.sin(t * Math.PI / 2) * (0.18 + arch * 0.62);
      vertices.push(u * width, y, z);
      scutes.push(u * width * 5 + 2.5, z * 5 - 3.5);
      if (j < rows && i < sides) {
        const a = j * (sides + 1) + i, b = a + sides + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setAttribute('aSc', new THREE.Float32BufferAttribute(scutes, 2));
  g.setIndex(indices); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, shellMaterial({ worldSc: true }));
  mesh.name = 'shellfatherNuchalHood'; mesh.receiveShadow = true;
  return mesh;
}

// A continuous folded dermal lip bridges the neck and the keratin hood. Its back
// sinks into the hood; wrinkles taper across it instead of separate armour segments.
function buildNuchalCollar() {
  const pos = [], uv = [], idx = [], sides = 72, rows = 24;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, z = -0.24 + t * 0.54;
    for (let i = 0; i <= sides; i++) {
      const a = -Math.PI * 0.16 + i / sides * Math.PI * 1.32;
      const fold = Math.sin(t * Math.PI) * (0.032 + 0.009 * Math.sin(a * 11 + t * 3));
      const crease = 0.008 * Math.sin(t * 19 + Math.sin(a * 7) * 0.7) * Math.sin(t * Math.PI);
      const rx = 0.88 - t * 0.07 + fold + crease, ry = 0.73 - t * 0.035 + fold + crease;
      pos.push(Math.cos(a) * rx, Math.sin(a) * ry - 0.02, z);
      uv.push(a * 0.85, z);
      if (j < rows && i < sides) {
        const k = j * (sides + 1) + i;
        idx.push(k, k + 1, k + sides + 1, k + 1, k + sides + 2, k + sides + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({color:'#454431', roughness:0.86, side:THREE.DoubleSide, envMapIntensity:0.15});
  patchStandard(mat, {
    key:'kcaNuchalSkin8',
    fragHead:'float kSkinH;',
    albedo: `
      vec4 n = kN(vKUv * vec2(1.2, 2.0));
      float folds = sin(vKUv.y * 38.0 + sin(vKUv.x * 7.0) * 0.5);
      diffuseColor.rgb *= 0.82 + n.g * 0.3 + folds * 0.07;
      kSkinH = folds * 0.0015 + (n.b - 0.5) * 0.002;
    `,
    bump:'normal = kBump(-vViewPosition, normal, kSkinH, 1.0, faceDirection);',
  });
  const skin = new THREE.Mesh(g, mat);
  skin.name = 'shellfatherCollar'; skin.receiveShadow = true;
  return skin;
}

export async function buildTortoise(ctx, { splash } = {}) {
  const { game, group } = ctx;
  const res = game.assets && game.assets.instance ? await game.assets.instance('env_stage2_tortoise', { cloneMaterials: false }).catch(() => null) : null;
  const root = res && res.root;
  if (!root || res.source === 'placeholder') return null;
  const T = TORTOISE;
  const headMat = tortoiseMaterial(T), legMat = tortoiseMaterial({ ...T, tint: T.legTint || T.tint }, { wet: true });
  let legMesh = null, neckMesh = null;
  const bones = {};
  root.traverse((o) => {
    if (o.isMesh) { prepGeometry(o.geometry); o.material = headMat; o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; }
    if (o.name === 'tortoise_neck') neckMesh = o;
    if (o.name === 'tortoise_leg') legMesh = o;
    if (o.name === 'tortoise_rim') o.visible = false;
    if (o.isBone) bones[o.name] = o;
  });
  const neckG = new THREE.Group(); neckG.name = 'shellfatherNeck';
  neckG.scale.setScalar(T.far.S);
  if (legMesh) {
    legMesh.removeFromParent();
    try { const g0 = legMesh.geometry.clone(); for (const k of Object.keys(g0.attributes)) if (k !== 'position' && k !== 'color' && k !== 'aGlow') g0.deleteAttribute(k); const g = mergeVertices(g0, 1e-3); g.computeVertexNormals(); legMesh.geometry = g; } catch (e) { /* keep as authored */ }
    legMesh.material = legMat;
  }
  neckG.add(root);
  neckG.add(buildNuchalHood());
  neckG.add(buildNuchalCollar());
  group.add(neckG);
  const rest = {};
  for (const k of Object.keys(bones)) rest[k] = bones[k].quaternion.clone();

  // eye glow sprite (the eye facing the camera). Eye centre in the head bone's space, from the rest pose.
  neckG.updateMatrixWorld(true);
  const eyeLocal = [];
  if (bones.head) {
    const inv = bones.head.matrixWorld.clone().invert();
    const rootW = root.matrixWorld;
    for (const s of [-1, 1]) eyeLocal.push(new THREE.Vector3(0.5 * s, 0.7, 2.47).applyMatrix4(rootW).applyMatrix4(inv));
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sprite.name = 'shellfatherEyeGlow';
  sprite.renderOrder = 5;
  group.add(sprite);

  // Far-side wading leg: its entire stroke stays below the deck, behind the playable belt.
  let leg = null;
  if (legMesh) {
    const pivot = new THREE.Group(); pivot.name = 'shellfatherLeg';
    legMesh.position.set(0, 0, 0); legMesh.rotation.set(0, 0, 0); legMesh.scale.setScalar(T.leg.S);
    legMesh.castShadow = false;
    pivot.add(legMesh); group.add(pivot);
    leg = { pivot, mesh: legMesh, prevY: -9, foot: new THREE.Vector3(), xs: null, cyc: -1 };
  }

  const q = new THREE.Quaternion(), e = new THREE.Euler(), cp = new THREE.Vector3();
  const mBasis = new THREE.Matrix4(), vX = new THREE.Vector3(), vY = new THREE.Vector3(), vZ = new THREE.Vector3();
  let lift = 0, liftT = 0, liftTarget = 0, blinkT = 3, blink = 0;

  const api = {
    neckG, bones, T, leg,
    headWorld: new THREE.Vector3(),
    reveal(seconds = 3.5) { liftTarget = 1; liftT = seconds; },
    lower() { liftTarget = 0; },
    /** focusX = camera focus x; camera = the THREE camera (for the eye glow). */
    update(dt, t, sway, focusX = 0, camera = null) {
      // ---- head placement (per camera focus): far + in profile early, closer + turned toward the camera later
      const u = sm(T.span[0], T.span[1], focusX);
      const F = T.far, N = T.near;
      lift += (liftTarget - lift) * Math.min(1, dt / Math.max(0.4, liftT * 0.35));
      const S = lerp(F.S, N.S, u);
      neckG.scale.setScalar(S);
      // Small breath motion preserves the overlap between the hood skirt and the deck.
      const heave = Math.sin(t * 0.42) * 0.06;
      neckG.position.set(focusX + lerp(F.ox, N.ox, u), -1.0 - T.waterZ * S + heave, lerp(F.z, N.z, u));
      neckG.rotation.y = (lerp(F.yaw, N.yaw, u) + Math.sin(t * 0.13) * 1.5 + (sway || 0) * 8) * DEG;
      const br = Math.sin(t * 0.42) * 0.5 + Math.sin(t * 0.23 + 1.3) * 0.5;
      for (const [name, [p, y]] of Object.entries(T.turn)) {
        const b = bones[name]; if (!b) continue;
        const k = name === 'head' ? 1.4 : 1;
        const pitch = (p + br * 1.2 * k - lift * (name === 'neck_2' ? 3 : name === 'head' ? -3 : 0)) * DEG;
        const yaw = (y + Math.sin(t * 0.17 + k) * 2.5 * k) * DEG;
        e.set(pitch, 0, yaw); q.setFromEuler(e);
        b.quaternion.copy(rest[name]).multiply(q);
      }
      neckG.updateMatrixWorld(true);
      if (bones.head) bones.head.getWorldPosition(api.headWorld);
      // ---- blink every 3–7 s (lids are geometry; the glow shuts off + the sprite squashes)
      blinkT -= dt;
      if (blinkT < 0) { blink = 0.22; blinkT = 3 + ((Math.sin(t * 12.9898) * 43758.5453) % 1 + 1) % 1 * 4; }
      blink = Math.max(0, blink - dt);
      const open = blink > 0 ? Math.abs(blink - 0.11) / 0.11 : 1;
      headMat.userData.U.kTEye.value = 0.15 + 0.85 * open;
      if (bones.head && eyeLocal.length && camera) {
        const a = eyeLocal[0].clone().applyMatrix4(bones.head.matrixWorld), b = eyeLocal[1].clone().applyMatrix4(bones.head.matrixWorld);
        const eye = a.distanceToSquared(camera.position) < b.distanceToSquared(camera.position) ? a : b;
        const toCam = cp.copy(camera.position).sub(eye); const D = toCam.length();
        sprite.position.copy(eye).addScaledVector(toCam, 2.2 / D);
        const s = neckG.scale.x * (T.eyeGlow || 0.10) * (0.8 + 0.2 * Math.sin(t * 2.1));
        sprite.scale.set(s, s * (0.12 + 0.88 * open), 1);
        sprite.material.opacity = 0.2 * open;
      }
      // ---- far-side leg stroke
      if (leg) {
        const L = T.leg, P = L.period;
        const cyc = Math.floor(t / P), ph = (t / P) % 1;
        if (cyc !== leg.cyc) { leg.cyc = cyc; leg.xs = focusX; }
        const xs = focusX;
        // foot path: rise at the right edge, rake back toward the frame centre skimming the surface, plunge
        let fx, fy;
        if (ph < 0.12) { const s = sm(0, 0.12, ph); fx = xs + L.dx0 + 0.6; fy = lerp(-4.5, L.peak, s); }
        else if (ph < 0.56) { const s = sm(0.12, 0.56, ph); fx = xs + lerp(L.dx0, L.dx1, s); fy = L.peak - 0.45 * Math.sin(s * Math.PI) + 0.12 * Math.sin(ph * 40); }
        else if (ph < 0.66) { const s = sm(0.56, 0.66, ph); fx = xs + L.dx1 - 0.6 * s; fy = lerp(L.peak, -5.0, s); }
        else { fx = xs + L.dx1; fy = -6; }
        const sh = vX.set(fx + L.shoulder[0], fy + L.shoulder[1], L.z + L.shoulder[2]);
        leg.foot.set(fx, fy, L.z);
        // orient: local −Y (leg axis) → shoulder→foot, local +Z (claws) → world −X (raking back) tilted toward camera
        vY.copy(sh).sub(leg.foot).normalize();                     // local +Y = foot → shoulder
        vZ.set(-1, -0.1, 0.4).addScaledVector(vY, -vY.dot(vZ.set(-1, -0.1, 0.4))).normalize();
        const vx2 = new THREE.Vector3().crossVectors(vY, vZ).normalize();
        mBasis.makeBasis(vx2, vY, vZ);
        leg.pivot.quaternion.setFromRotationMatrix(mBasis);
        const len = 1.37 * L.S;   // GLB leg spans y 0.40 .. -1.37 (claw tips) in model units
        leg.pivot.position.copy(leg.foot).addScaledVector(vY, len);
        leg.pivot.visible = fy > -5.5;
        // splashes crossing the surface
        const wy = -1.0;
        if (splash && leg.prevY < wy + 0.1 && fy >= wy + 0.1) splash(fx, wy + 0.1, L.z, 1.2);
        if (splash && leg.prevY > wy + 0.1 && fy <= wy + 0.1) splash(fx, wy + 0.1, L.z, 1.3);
        if (splash && ph > 0.14 && ph < 0.56 && fy < 0.6 && Math.floor(t * 5) !== Math.floor((t - dt) * 5)) splash(fx + 0.8, wy + 0.1, L.z - 0.3, 0.9);
        leg.prevY = fy;
      }
    },
  };
  return api;
}
