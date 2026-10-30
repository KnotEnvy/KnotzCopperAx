// Stage 4 castle layout: places the Blender stone kit (instanced per module), the far keep across the water court,
// torches/braziers (fire kit flames + analytic torch pools), adder banners, drawbridge + chains, portcullises, doors,
// statues and gargoyles. Returns handles for the set pieces (setpieces.js).
import * as THREE from 'three';
import { createFireKit } from '../../../render/fire.js';
import { patchMaterial, kitMaterial, setWeatherSources } from './shading.js';
import { WATER_Y, WALL_Z, WIDE_X, FAR_WALL_Z, GATE_X, COURT_X, STAIRS, INNER_X } from './layout.js';

const OZ = WALL_Z - 1.5;            // module origin z so facade fronts land on WALL_Z
const MOAT_BASE = -4.8;             // outer wall modules stand in the moat (walkway ≈ 4.2, merlons ≈ 5.4–6.5)
const GATE_BASE = -0.8;
const PI = Math.PI;

// A separate material on the existing serpent instances only. The local-height mask covers the
// donor's stepped plinth (top at y=1); the hood/head/neck/coil and every other kit draw keep their
// original response. Compose with kitMaterial rather than copying its weather/mask implementation.
function pedestalMaterial() {
  const m = kitMaterial({ glow: 0.6 });
  const compile = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (sh, renderer) => {
    compile.call(m, sh, renderer);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vS4PlinthY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvS4PlinthY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vS4PlinthY;')
      .replace('#include <lights_physical_fragment>', `
        float s4Plinth = 1.0 - smoothstep(0.99, 1.045, vS4PlinthY);
        float s4PlinthWear = s4n(vS4World.xz * 1.7 + 23.0);
        roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.76 + 0.12 * s4PlinthWear), s4Plinth);
        s4WetM *= 1.0 - 0.42 * s4Plinth;
        s4Mirror *= 1.0 - 0.7 * s4Plinth;
        #include <lights_physical_fragment>`);
  };
  m.customProgramCacheKey = () => key + ':plinth-r33-satin';
  return m;
}


// ---------------------------------------------------------------------------------------------- adder banner
function bannerTexture() {
  const W = 256, H = 704;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#3a0d18'); grd.addColorStop(0.5, '#4a1020'); grd.addColorStop(1, '#2a0812');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // borders
  g.strokeStyle = '#b08a3a'; g.lineWidth = 7; g.strokeRect(14, 10, W - 28, H - 110);
  g.lineWidth = 2; g.strokeRect(26, 22, W - 52, H - 134);
  // coiled adder sigil: spiral body + reared hooded head (gold)
  g.save(); g.translate(W / 2, 300);
  g.strokeStyle = '#d4a848'; g.lineCap = 'round';
  for (let i = 0; i < 180; i++) {
    const t = i / 180, a = t * PI * 4.2 + PI * 0.5, r = 88 * (1 - t) + 14;
    const t2 = (i + 1) / 180, a2 = t2 * PI * 4.2 + PI * 0.5, r2 = 88 * (1 - t2) + 14;
    g.lineWidth = 20 * (1 - t) + 7;
    g.beginPath(); g.moveTo(Math.cos(a) * r, Math.sin(a) * r); g.lineTo(Math.cos(a2) * r2, Math.sin(a2) * r2); g.stroke();
  }
  g.fillStyle = '#d4a848';
  g.beginPath(); g.moveTo(0, -205); g.bezierCurveTo(52, -200, 58, -140, 22, -110); g.lineTo(-22, -110); g.bezierCurveTo(-58, -140, -52, -200, 0, -205); g.fill();   // hood
  g.lineWidth = 16; g.beginPath(); g.moveTo(0, -112); g.quadraticCurveTo(-30, -60, 0, -20); g.stroke();                                                         // neck
  g.fillStyle = '#1a0408'; g.beginPath(); g.ellipse(-11, -172, 5, 8, 0.3, 0, PI * 2); g.ellipse(11, -172, 5, 8, -0.3, 0, PI * 2); g.fill();
  g.strokeStyle = '#c03020'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -140); g.lineTo(0, -120); g.moveTo(0, -120); g.lineTo(-6, -110); g.moveTo(0, -120); g.lineTo(6, -110); g.stroke();
  g.restore();
  // torn swallow-tail bottom
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.moveTo(0, H); g.lineTo(0, H - 80); for (let x = 0; x <= W; x += 16) g.lineTo(x, H - 90 + Math.sin(x * 0.7) * 10); g.lineTo(W, H - 80); g.lineTo(W, H);
  g.lineTo(W / 2, H - 170 + 40); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(W / 2, H - 150); g.lineTo(W / 2 - 60, H); g.lineTo(W / 2 + 60, H); g.closePath(); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

function bannerMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 });
  return patchMaterial(m, {
    key: 'banner',
    extraPars: '',
    surface: 's4WetM = 0.7; s4Mirror = 0.05; roughnessFactor = 0.45; diffuseColor.rgb *= 0.8;',
  });
}

function bannerGeo(w, h) {
  const g = new THREE.PlaneGeometry(w, h, 6, 16);
  g.translate(0, -h / 2, 0);
  return g;
}

// ---------------------------------------------------------------------------------------------- chain
const LINK = new THREE.TorusGeometry(0.075, 0.022, 5, 10);
LINK.scale(1, 1.6, 1);

export async function buildCastle(ctx, kit, { low = false } = {}) {
  const { group, quality } = ctx;
  const P = (name, items, o) => kit.place(group, name, items, o);
  const torches = [];
  const fx = createFireKit({ quality });

  // ---- outer (moat) wall: corner tower, wall run, gatehouse, corner tower
  // far keep across the water court: skyline tuned for the default framing (walls ~70 %, spires 85-100 % of frame)
  const FK = FAR_WALL_Z;
  P('wall', [
    { x: 18, y: MOAT_BASE, z: OZ }, { x: 38, y: MOAT_BASE, z: OZ },
    // courtyard back wall (ground level)
    { x: 44, y: 0, z: OZ }, { x: 60, y: 0, z: OZ }, { x: 99, y: 0, z: OZ }, { x: 107, y: 0, z: OZ },
    // upper ward behind the stair
    { x: 62, y: STAIRS.rise, z: STAIRS.z1 - 1 - 1.5 }, { x: 78, y: STAIRS.rise, z: STAIRS.z1 - 1 - 1.5 },
  ]);
  P('wall_door', [{ x: 52, y: 0, z: OZ }, { x: 81, y: 0, z: OZ }]);
  P('tower', [
    { x: WIDE_X, y: MOAT_BASE, z: -9.6 }, { x: COURT_X - 1.5, y: MOAT_BASE, z: -9.6 },
    { x: STAIRS.x0 - 0.5, y: 0, z: -10.2, s: 0.8 }, { x: STAIRS.x1 + 0.5, y: 0, z: -10.2, s: 0.8 },
  ]);
  // the keep: spired towers + a great gatehouse facade (silhouettes against the storm sky on every flash)
  P('tower_spire', [
    { x: 70, y: STAIRS.rise, z: -34, s: 1.3 },
  ]);
  P('gatehouse', [
    { x: GATE_X, y: GATE_BASE, z: OZ },
    { x: INNER_X, y: 0, z: OZ },
    { x: 70, y: STAIRS.rise, z: STAIRS.z1 - 1 - 1.5, s: 0.66 },
  ]);
  // far keep (low-LOD kit variants: it sits 90-120 m away)
  P('wall_lo', [-44, -36, -28, -20, -12, -4, 4, 12, 20, 28, 36, 44].map((x) => ({ x, y: -6, z: FK })));
  P('tower_lo', [{ x: -40, y: -6, z: FK - 2, s: 0.95 }, { x: 24, y: -6, z: FK - 2, s: 0.9 }, { x: 48, y: -6, z: FK - 2, s: 1.0 }]);
  P('tower_spire_lo', [{ x: -24, y: -6, z: FK - 2.5, s: 0.95 }, { x: 8, y: -6, z: FK - 2.5, s: 1.0 }, { x: 36, y: -6, z: FK - 3, s: 0.85 },
    { x: -8, y: -6, z: FK - 20, s: 1.45 }, { x: -32, y: -6, z: FK - 26, s: 1.2 }, { x: 18, y: -6, z: FK - 24, s: 1.25 }, { x: 56, y: STAIRS.rise - 2, z: -40, s: 1.6 }]);
  P('gatehouse_lo', [{ x: -8, y: -6, z: FK - 1, s: 1.0 }]);
  P('sigil', [
    { x: GATE_X, y: GATE_BASE + 9.9, z: WALL_Z + 0.1 },
    { x: INNER_X, y: 9.9, z: WALL_Z + 0.1 },
    { x: 70, y: STAIRS.rise + 9.9 * 0.66, z: STAIRS.z1 - 1 + 0.1, s: 0.66 },
  ]);

  // ---- portcullises (animated): outer gate + inner gate
  const portOuter = kit.mesh('portcullis'); portOuter.position.set(GATE_X, GATE_BASE, WALL_Z - 0.5); group.add(portOuter);
  const portInner = kit.mesh('portcullis'); portInner.position.set(INNER_X, 0, WALL_Z - 0.5); group.add(portInner);
  const portUpper = kit.mesh('portcullis'); portUpper.scale.setScalar(0.66); portUpper.position.set(70, STAIRS.rise, STAIRS.z1 - 1 - 0.33); group.add(portUpper);

  // ---- doors (burst open)
  const doors = [];
  for (const dx of [52, 81]) {
    const L = kit.mesh('door_L'); L.position.set(dx - 1.45, 0, WALL_Z - 0.95); group.add(L);
    const R = kit.mesh('door_R'); R.position.set(dx + 1.45, 0, WALL_Z - 0.95); group.add(R);
    doors.push({ x: dx, L, R, open: 0, target: 0, v: 0 });
  }

  // ---- statues + gargoyles + braziers
  P('serpent', [
    { x: 48.4, y: 0, z: -5.4, s: 1.0, ry: 0.25 }, { x: 55.6, y: 0, z: -5.4, s: 1.0, ry: -0.25 },
    { x: INNER_X - 5.6, y: 0, z: -5.2, s: 1.4, ry: 0.2 }, { x: INNER_X + 5.6, y: 0, z: -5.2, s: 1.4, ry: -0.2 },
    { x: 14, y: 0, z: -2.9, s: 0.85, ry: 0.1 },
  ], { material: pedestalMaterial() });
  const garg = [
    { x: 12, y: 3.0, z: WALL_Z - 0.05 }, { x: 22.5, y: 4.4, z: WALL_Z - 0.05 }, { x: 33.5, y: 4.4, z: WALL_Z - 0.05 },
    { x: 44, y: 5.2, z: WALL_Z - 0.05 }, { x: 60, y: 5.2, z: WALL_Z - 0.05 }, { x: 99, y: 5.2, z: WALL_Z - 0.05 },
  ];
  P('gargoyle', garg);
  // the one that comes alive (own material → own eye glow)
  const gMat = kitMaterial({ glow: 0.3 });
  const gargoyle = kit.mesh('gargoyle', gMat); gargoyle.position.set(56.5, 5.2, WALL_Z - 0.05); group.add(gargoyle);

  const braziers = [
    [45.5, -5.4], [58.5, -5.4], [INNER_X - 3.4, -5.6], [INNER_X + 3.4, -5.6], [70, STAIRS.z1 - 3, STAIRS.rise],
    [50, 5.6], [INNER_X + 7.5, 5.6], [3.5, -2.8], [GATE_X - 4.6, -2.9], [GATE_X + 4.6, -2.9],
  ];
  // fire deep in the gate passages: warm light behind the portcullis bars (they silhouette as they rise)
  for (const [x, y0] of [[GATE_X, GATE_BASE], [INNER_X, 0]]) {
    for (const sx of [-1.7, 1.7]) fx.flame([x + sx, y0 + 2.6, WALL_Z - 4.2], { height: 0.7, width: 0.4, intensity: 5, soot: false });
    fx.glow([x, y0 + 2.4, WALL_Z - 4.0], { size: 5, color: '#ff8a38', intensity: 0.5 });
    torches.push({ x, y: y0 + 2.8, z: WALL_Z - 3.6, i: 5, seed: x * 0.7 });
  }
  P('brazier', braziers.map(([x, z, y]) => ({ x, y: y || 0, z, s: 1.1, ry: x })));
  for (const [x, z, y] of braziers) {
    const by = (y || 0) + 1.62;
    fx.flame([x, by, z], { height: 1.1, width: 0.7, intensity: 4.5, sootOpacity: 0.18, sootPuffs: 3 });
    fx.sparks([x, by + 0.2, z], { count: low ? 6 : 12, rise: 3, spread: 0.8, radius: 0.6 });
    torches.push({ x, y: by + 0.5, z, i: 3.2, seed: x });
  }

  // ---- wall sconce torches
  const sconces = [
    [11.5, 2.8], [16.5, 2.8], [21.2, 3.2], [34.8, 3.2], [37, 2.8],
    [42, 3.1], [48, 3.1], [56, 3.1], [62, 3.1], [78.5, 3.1], [85, 3.1], [93, 3.1], [97, 3.1], [103, 3.1],
  ];
  const bracket = new THREE.BoxGeometry(0.08, 0.08, 0.5); bracket.translate(0, 0, 0.25);
  const cage = new THREE.CylinderGeometry(0.13, 0.07, 0.34, 6, 1, true);
  const stick = new THREE.CylinderGeometry(0.035, 0.03, 0.55, 5);
  const iron = new THREE.MeshStandardMaterial({ color: '#1c1c20', metalness: 0.7, roughness: 0.4 });
  const wood = new THREE.MeshStandardMaterial({ color: '#2a1c12', roughness: 0.8 });
  const mk = (geo, mat, off) => {
    const im = new THREE.InstancedMesh(geo, mat, sconces.length); const m4 = new THREE.Matrix4();
    sconces.forEach(([x, y], i) => { m4.makeTranslation(x + off[0], y + off[1], WALL_Z + off[2]); im.setMatrixAt(i, m4); });
    group.add(im); return im;
  };
  mk(bracket, iron, [0, -0.2, 0]); mk(cage, iron, [0, 0.12, 0.52]); mk(stick, wood, [0, -0.05, 0.52]);
  for (const [x, y] of sconces) {
    fx.flame([x, y + 0.35, WALL_Z + 0.52], { height: 0.75, width: 0.42, intensity: 5, soot: false });
    torches.push({ x, y: y + 0.6, z: WALL_Z + 0.9, i: 2.4, seed: x * 1.3 });
  }
  // env-r33 static kit weathering sources: soot plumes above every wall sconce and the four braziers standing by the
  // back walls; wet stains below the gargoyle spouts (the living one included: its stain stays when it leaps away)
  setWeatherSources({
    soot: [...sconces.map(([x, y]) => ({ x, y: y + 0.62, z: WALL_Z + 0.52, k: 1 })),
      ...[[45.5, -5.4], [58.5, -5.4], [INNER_X - 3.4, -5.6], [INNER_X + 3.4, -5.6]].map(([x, z]) => ({ x, y: 2.75, z, k: 0.8 }))],
    drips: [...garg, { x: 56.5, y: 5.2, z: WALL_Z - 0.05 }].map((g) => ({ x: g.x, y: g.y + 0.15, z: g.z, k: 0.85 })),
  });
  // windows glowing in the far keep (tiny warm glows) + far fires
  for (const [x, y, z, s] of [[-8, 14, FK - 21, 2.4], [-8, 20, FK - 21, 1.8], [-32, 11, FK - 27, 1.8], [18, 12, FK - 25, 1.8], [8, 4.5, FK + 1.4, 1.2], [-24, 4.5, FK + 1.2, 1.2], [-8, 1.5, FK + 1.6, 2.2]]) fx.glow([x, y, z], { size: s, color: '#ff9a40', intensity: 0.9, flicker: 0.3 });
  const fire = fx.build(); if (fire) group.add(fire);

  // ---- banners (adder sigil)
  const btex = bannerTexture();
  const bmat = bannerMaterial(btex);
  const bl = [
    [13.5, 5.2, 1.4, 3.9], [20.5, 5.2, 1.4, 3.9], [GATE_X - 4.2, 6.6, 1.5, 4.3], [GATE_X + 4.2, 6.6, 1.5, 4.3],
    [46.5, 6.8, 1.6, 4.6], [57.5, 6.8, 1.6, 4.6], [INNER_X - 4.2, 7.4, 1.7, 5], [INNER_X + 4.2, 7.4, 1.7, 5], [101, 6.8, 1.6, 4.6],
  ];
  const banners = [];
  const bpole = new THREE.CylinderGeometry(0.04, 0.04, 1, 6); bpole.rotateZ(PI / 2);
  for (const [x, y, w, h] of bl) {
    const m = new THREE.Mesh(bannerGeo(w, h), bmat); m.position.set(x, y, WALL_Z + 0.12); group.add(m);
    const pole = new THREE.Mesh(bpole, iron); pole.scale.set(w + 0.3, 1, 1); pole.position.set(x, y + 0.02, WALL_Z + 0.14); group.add(pole);
    m.userData.base = m.geometry.attributes.position.array.slice();
    banners.push(m);
  }

  // ---- drawbridge (hinged at the gate sill; raised = covering the lower arch) + chains to the gate winches
  const DB = { w: 4.7, l: 4.5, t: 0.24 };
  const deck = new THREE.Group();
  const plankGeo = new THREE.BoxGeometry(1, 1, 1);
  const plankMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), {
    key: 'plank',
    surface: /* glsl */`
      vec2 p = vS4World.xz; float h = s4h(vec2(floor(vS4World.x / 0.39 + 0.5), 1.0));
      float grainL = s4n(vec2(vS4World.x * 30.0, (vS4World.z + vS4World.y) * 2.2)) * 0.6 + s4n(vec2(vS4World.x * 90.0, (vS4World.z + vS4World.y) * 5.0)) * 0.4;
      diffuseColor.rgb = mix(vec3(0.05, 0.032, 0.02), vec3(0.085, 0.056, 0.034), h) * (0.7 + 0.6 * grainL);
      float top = smoothstep(0.5, 0.9, s4N.y);
      s4WetM = 0.7 + 0.3 * top; s4Mirror = 0.12 * top; roughnessFactor = mix(0.7, 0.32, top);`,
  });
  const n = 12;
  const planks = new THREE.InstancedMesh(plankGeo, plankMat, n + 3);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const x = -DB.w / 2 + (i + 0.5) * DB.w / n;
    m4.makeScale(DB.w / n - 0.025, DB.t, DB.l - ((i * 7) % 3) * 0.04).setPosition(x, -DB.t / 2, DB.l / 2); planks.setMatrixAt(i, m4);
  }
  for (let k = 0; k < 3; k++) { m4.makeScale(DB.w, 0.08, 0.14).setPosition(0, 0.02, 0.6 + k * 1.6); planks.setMatrixAt(n + k, m4); }
  deck.add(planks);
  const ironBands = new THREE.Mesh(new THREE.BoxGeometry(DB.w + 0.1, 0.1, 0.12), iron);
  ironBands.position.set(0, 0.0, DB.l - 0.08); deck.add(ironBands);
  const hinge = new THREE.Group();
  hinge.position.set(GATE_X, -0.1, WALL_Z + 0.15);
  hinge.add(deck);
  group.add(hinge);
  const chainN = 40;
  const chains = new THREE.InstancedMesh(LINK, iron, chainN * 2);
  chains.frustumCulled = false;
  group.add(chains);
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  const s1 = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  const bridge = {
    hinge, deck, lower: 0,             // 0 = raised, 1 = lowered
    set(k) {
      this.lower = k;
      hinge.rotation.x = -(1 - k) * PI / 2;
      hinge.updateMatrixWorld(true);
      for (let s = 0; s < 2; s++) {
        const sx = s ? 1 : -1;
        tmpA.set(GATE_X + sx * (DB.w / 2 - 0.15), 5.6, WALL_Z + 0.1);                   // winch slots above the arch
        tmpB.set(sx * (DB.w / 2 - 0.15), 0.05, DB.l - 0.2); deck.localToWorld(tmpB);
        const L = tmpA.distanceTo(tmpB);
        const sag = Math.max(0, 0.3 * (1 - k * 0.6));
        for (let i = 0; i < chainN; i++) {
          const t = (i + 0.5) / chainN;
          const p = tmpA.clone().lerp(tmpB, t); p.y -= Math.sin(t * PI) * sag * (L / 6);
          dir.copy(tmpB).sub(tmpA).normalize();
          q.setFromUnitVectors(up, dir);
          e.setFromQuaternion(q); e.y += (i % 2) * PI / 2; q.setFromEuler(e);
          const visible = t * L < L;
          m4.compose(p, q, visible ? s1 : new THREE.Vector3(0, 0, 0));
          chains.setMatrixAt(s * chainN + i, m4);
        }
      }
      chains.instanceMatrix.needsUpdate = true;
    },
  };
  bridge.set(0);

  // ---- gate passage pier (foreground framing element as the camera passes into the courtyard)
  const pierMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), {
    key: 'pier',
    surface: /* glsl */`
      vec2 p = vec2(vS4World.x + vS4World.z, vS4World.y); float row = floor(p.y / 0.55); float rh = s4h(vec2(row, 2.0));
      float px = p.x / 0.95 + rh * 3.0; vec2 f = vec2(fract(px) * 0.95, fract(p.y / 0.55) * 0.55); vec2 e = min(f, vec2(0.95, 0.55) - f);
      float j = 1.0 - smoothstep(0.015, 0.05, min(e.x, e.y));
      diffuseColor.rgb = mix(vec3(0.05, 0.05, 0.058), vec3(0.075, 0.072, 0.078), s4h(vec2(floor(px), row))) * (0.8 + 0.4 * s4fbm(p * 4.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.008), j);
      s4WetM = 0.8; s4Mirror = 0.1; roughnessFactor = mix(0.45, 0.85, j);`,
  });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(1.7, 10, 1.9), pierMat);
  pier.position.set(COURT_X, 5 - 0.0, 5.6);
  group.add(pier);
  const pierCap = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.35, 2.3), pierMat); pierCap.position.set(COURT_X, 0.17, 5.6); group.add(pierCap);

  // ---- background mist banks over the water court (soft cards, fogged)
  const mistMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uTime; uniform float uFlash; varying vec2 vUv; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){ float a = n(vec2(vW.x*0.08 + uTime*0.05, vW.z*0.1)) * 0.6 + n(vec2(vW.x*0.2 - uTime*0.08, vUv.y*3.0)) * 0.4;
        a *= smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.4, vUv.y) * smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
        gl_FragColor = vec4(vec3(0.08, 0.1, 0.16) * (1.0 + uFlash * 5.0), a * 0.45); }`,
    transparent: true, depthWrite: false,
  });
  for (const [x, z, w, h] of [[-20, -30, 70, 5], [-10, -55, 110, 9], [0, -75, 140, 14]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mistMat); m.position.set(x, WATER_Y + h * 0.35, z); group.add(m);
  }

  const t0 = { t: 0 };
  // banners flap in the storm wind (CPU cloth-ish wave; 9 small meshes, 119 verts each).
  // perf-1650 r4: computed in each banner's onBeforeRender, once per sim time — so only banners that survive frustum
  // culling pay (2–4 of 9 on screen) and only once per RENDERED frame (it ran every sim step: 9 banners × 1.6 steps per
  // frame at 30–60 fps = the #1 stage-4 sim cost, castle.update 56 % of all S4 sim time in the realtime bench profile).
  // Attributes set here upload on the next frame (≤ 16 ms cloth lag, invisible).
  const flap = (m, b, t) => {
    const a = m.geometry.attributes.position; const base = m.userData.base;
    // perf-1650: analytic normals of the displaced sheet (was computeVertexNormals() per banner per frame — the
    // stage's #1 JS allocator, ~150 KB/frame). n = t_x × t_y with t_x = (1, 0, dz/dx), t_y = (dx/dy, 1, dz/dy).
    const nA = m.geometry.attributes.normal, na = nA.array, sway = Math.sin(t * 2.3 + b) * 0.07;
    for (let i = 0; i < a.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const k = Math.min(1, -y / 4.5), dk = -y / 4.5 < 1 ? -1 / 4.5 : 0;
      const A = t * 3.1 + y * 1.6 + b * 1.7 + x * 0.8, B = t * 7.3 + y * 3.1 + b;
      const w = Math.sin(A) * 0.16 + Math.sin(B) * 0.05;
      a.array[i * 3 + 2] = base[i * 3 + 2] + (w + 0.12) * k * k + 0.02;
      a.array[i * 3] = x + sway * k * k;
      const cA = Math.cos(A);
      const zx = cA * 0.128 * k * k;
      const zy = (cA * 0.256 + Math.cos(B) * 0.155) * k * k + (w + 0.12) * 2 * k * dk;
      const xy = sway * 2 * k * dk;
      const nx = -zx, ny = zx * xy - zy, il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      na[i * 3] = nx * il; na[i * 3 + 1] = ny * il; na[i * 3 + 2] = il;
    }
    a.needsUpdate = true; nA.needsUpdate = true;
  };
  banners.forEach((m, b) => {
    m.userData.flapT = -1;
    m.onBeforeRender = () => { if (m.userData.flapT === t0.t) return; m.userData.flapT = t0.t; flap(m, b, t0.t); };
  });
  return {
    torches, portOuter, portInner, portUpper, doors, gargoyle, gargoyleMat: gMat, bridge, banners, mistMat, pier,
    update(dt, t) {
      t0.t = t;
      mistMat.uniforms.uTime.value = t;
    },
  };
}
