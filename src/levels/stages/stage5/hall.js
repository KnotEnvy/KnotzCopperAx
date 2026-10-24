// Stage 5 hall dressing: back wall + the throne arena's apse, coiled-serpent pillars, witchfire braziers (fire kit in
// emerald + analytic pools), adder banners, guardian statues, doors, bone piles, the throne, the relic altar with the
// stolen COPPER AX (weapon_copperax.glb) hovering in a gold shaft, and the chained Queen + consort above the arena.
import * as THREE from 'three';
import { createFireKit } from '../../../render/fire.js';
import { patchMaterial, S5 } from './shading.js';
import { WALL_Z, APSE_Z, PILLAR_Z, BRAZIER_Z, DOORS, STATUES, STATUE_Z, THRONE, ALTAR, RELIC, BONES, CAPTIVES, pillarXs } from './layout.js';

const APSE = { x0: 44, x1: 60 };
const WITCH = { red: '#06301a', orange: '#10a040', yellow: '#5cff74', core: '#e4ffd8' };

export async function buildHall(ctx, kit, { low = false } = {}) {
  const { game, group } = ctx;
  const fires = [];
  const fx = createFireKit({ colors: WITCH, quality: ctx.quality });
  // instanced placement split into 16 m x-buckets so frustum culling drops off-screen pillars/banners/bones
  const place = kit.place.bind(kit);
  kit = Object.assign(Object.create(kit), {
    place(g, name, items, opts) {
      const by = new Map();
      for (const it of items) { const k = Math.floor((it.x || 0) / 16); if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
      let last = null;
      for (const list of by.values()) last = place(g, name, list, opts) || last;
      return last;
    },
  });

  // ---------------------------------------------------------------- walls
  const walls = [], doorWalls = [], far = [];
  for (let x = -24; x <= 88; x += 8) {
    if (x > APSE.x0 && x < APSE.x1) continue;
    const it = { x, y: 0, z: WALL_Z };
    if (DOORS.some((d) => d.x === x)) doorWalls.push(it);
    else if (x < -8 || x > 72) far.push(it); else walls.push(it);
  }
  kit.place(group, 'wall', walls, { castShadow: false });
  kit.place(group, 'wall_lo', far);
  kit.place(group, 'wall_door', doorWalls);
  kit.place(group, 'wall', [48, 56].map((x) => ({ x, y: 0, z: APSE_Z })));
  // apse returns (short wall modules turned to face into the arena)
  kit.place(group, 'wall', [
    { x: APSE.x0 - 1.5, y: 0, z: (WALL_Z + APSE_Z) / 2 + 1.5, ry: Math.PI / 2, sx: 0.42 },
    { x: APSE.x1 + 1.5, y: 0, z: (WALL_Z + APSE_Z) / 2 + 1.5, ry: -Math.PI / 2, sx: 0.42 },
  ]);

  // ---------------------------------------------------------------- pillars + braziers
  const px = pillarXs().filter((x) => Math.abs(x - THRONE.x) > 1);
  kit.place(group, 'pillar', px.filter((x) => x > -14 && x < 78).map((x, i) => ({ x, y: 0, z: PILLAR_Z, ry: (i % 2 ? 0.08 : -0.08) })), { castShadow: true });
  kit.place(group, 'pillar_lo', px.filter((x) => x <= -14 || x >= 78).map((x) => ({ x, y: 0, z: PILLAR_Z })));
  const braz = px.filter((x) => x > -14 && x < 78).map((x) => ({ x, y: 0, z: BRAZIER_Z }));
  braz.push({ x: THRONE.x - 5.4, y: 0.0, z: THRONE.z - 0.6 }, { x: THRONE.x + 5.4, y: 0.0, z: THRONE.z - 0.6 });
  braz.push({ x: ALTAR.x - 3.3, y: 0, z: ALTAR.z + 0.4, s: 0.75 }, { x: ALTAR.x + 3.3, y: 0, z: ALTAR.z + 0.4, s: 0.75 });
  kit.place(group, 'brazier', braz, { castShadow: true });
  braz.forEach((b, i) => {
    const s = b.s || 1, y = 1.55 * s;
    fx.flame([b.x, y, b.z], { height: 1.25 * s, width: 0.8 * s, intensity: 4.2, seed: i * 0.37, soot: false });
    fx.glow([b.x, y + 0.5 * s, b.z], { size: 2.6 * s, color: '#3cff70', intensity: 0.5 });
    fires.push({ x: b.x, y: y + 0.55, z: b.z, i: 0.75 * s, seed: i * 1.7 });
  });

  // ---------------------------------------------------------------- banners (between pillars, in front of the jambs)
  const ban = [];
  for (let x = -16; x <= 80; x += 8) {
    if (DOORS.some((d) => d.x === x)) continue;
    if (x > APSE.x0 && x < APSE.x1) continue;
    for (const sx of [-2.35, 2.35]) ban.push({ x: x + sx, y: 7.0, z: WALL_Z + 2.08, ry: 0 });
  }
  for (const x of [48, 56]) for (const sx of [-2.35, 2.35]) ban.push({ x: x + sx, y: 7.2, z: APSE_Z + 2.08 });
  const bannerMesh = kit.place(group, 'banner', ban);

  // ---------------------------------------------------------------- doors
  const doors = DOORS.map((d, i) => {
    const L = kit.mesh('door_L'), R = kit.mesh('door_R');
    L.position.set(d.x - 1.28, 0, WALL_Z + 1.15); R.position.set(d.x + 1.28, 0, WALL_Z + 1.15);
    group.add(L, R);
    // witchfire deep in the passage (revealed when the doors burst)
    fx.flame([d.x, 0.9, WALL_Z + 0.2], { height: 0.9, width: 0.8, intensity: 3.5, seed: 3 + i, soot: false });
    return { x: d.x, L, R, open: 0, target: 0, v: 0 };
  });

  // ---------------------------------------------------------------- statues (come alive in the gallery)
  kit.place(group, 'plinth', STATUES.map((x) => ({ x, y: 0, z: STATUE_Z })));
  const statues = STATUES.map((x, i) => {
    const m = kit.mesh('statue'); m.position.set(x, 0.9, STATUE_Z); m.rotation.y = (i % 2 ? -0.18 : 0.18);
    m.castShadow = true; group.add(m);
    return { x, z: STATUE_Z, m, state: 0, t: 0 };
  });

  // ---------------------------------------------------------------- bones
  kit.place(group, 'bones', [
    { x: BONES.x, y: 0, z: BONES.z, s: 1.25 }, { x: 7.2, y: 0, z: -4.6, ry: 1.2, s: 0.9 }, { x: -3.4, y: 0, z: -4.9, ry: 2.7, s: 0.7 },
    { x: 13.4, y: 0, z: -5.2, ry: 0.5, s: 0.6 }, { x: 28.6, y: 0, z: 2.6, ry: 2.2, s: 0.6 }, { x: 38.8, y: 0, z: -4.4, ry: 4.1, s: 0.8 },
    { x: 46.5, y: 0, z: -4.4, ry: 0.9, s: 0.7 }, { x: 58.4, y: 0, z: -4.6, ry: 3.1, s: 0.8 }, { x: 66, y: 0, z: -4.4, ry: 5.2, s: 0.8 },
  ]);

  // ---------------------------------------------------------------- throne + altar + relic
  const throne = kit.mesh('throne'); throne.position.set(THRONE.x, 0, THRONE.z); throne.castShadow = true; group.add(throne);
  const altar = kit.mesh('altar'); altar.position.set(ALTAR.x, 0, ALTAR.z); group.add(altar);
  const relic = new THREE.Group(); relic.position.set(RELIC.x, RELIC.y, RELIC.z); group.add(relic);
  try {
    const r = game.assets && game.assets.instance ? await game.assets.instance('weapon_copperax', {}).catch(() => null) : null;
    if (r && r.root) {
      const bb = new THREE.Box3().setFromObject(r.root); const sz = bb.getSize(new THREE.Vector3());
      const k = 2.6 / Math.max(sz.x, sz.y, sz.z, 0.01);
      r.root.scale.setScalar(k);
      r.root.position.set(0, -((bb.min.y + bb.max.y) / 2) * k, 0);
      r.root.rotation.z = Math.PI;               // blade-up, haft down (hovering like an offering)
      r.root.traverse((o) => { if (o.isMesh && o.material) { const m = o.material = o.material.clone(); if (m.emissive) { m.emissive.set('#ff9a3a'); m.emissiveIntensity = 0.55; } } });
      relic.add(r.root);
    }
  } catch (e) { console.warn('[stage5] relic', e); }
  fx.glow([RELIC.x, RELIC.y, RELIC.z + 0.2], { size: 4.2, color: '#ffb048', intensity: 0.9 });
  fx.glow([RELIC.x, RELIC.y, RELIC.z + 0.2], { size: 1.6, color: '#fff0c0', intensity: 1.2 });
  // gold shaft of light falling on the altar (additive cone, soft edges)
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: { s5Time: S5.s5Time },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float s5Time;
      void main(){ float e = sin(vUv.x * 3.14159); float a = pow(e, 3.0) * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        a *= 0.8 + 0.2 * sin(vUv.x * 40.0 + s5Time * 0.7 + vUv.y * 6.0);
        gl_FragColor = vec4(vec3(1.0, 0.68, 0.3) * a * 0.22, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.2, 9, 20, 1, true), shaftMat);
  shaft.position.set(ALTAR.x, 7.3, ALTAR.z + 0.2); group.add(shaft);

  // ---------------------------------------------------------------- captives on chains
  const chainMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#77777c', metalness: 0.85, roughness: 0.42 }), { key: 'chain' });
  const link = new THREE.TorusGeometry(0.06, 0.017, 6, 10);
  const linkMats = [];
  // captives are story focal points hanging in the gloom: soft key lift + emerald rim so they read against the hall
  const captiveMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.75 }), {
    key: 'captive',
    surface: /* glsl */`
      float fr = pow(1.0 - clamp(dot(s5N, s5V), 0.0, 1.0), 2.5);
      float key = clamp(dot(s5N, normalize(vec3(-0.4, 0.5, 0.8))) * 0.6 + 0.4, 0.0, 1.0);
      s5Emit = diffuseColor.rgb * key * 0.55 + vec3(0.25, 0.9, 0.45) * fr * 0.35;
      if (vS5Mask > 0.2 && vS5Mask < 0.37) { metalnessFactor = 0.8; roughnessFactor = 0.35; }`,
    vertPars: 'varying float vS5Mask;\n',
    vertMain: '#ifdef USE_COLOR_ALPHA\n vS5Mask = color.a;\n#else\n vS5Mask = 0.0;\n#endif\n',
    extraPars: 'varying float vS5Mask;\n',
  });
  const captives = CAPTIVES.map((c, ci) => {
    const pivot = new THREE.Group(); pivot.position.set(c.x, 14, c.z); group.add(pivot);
    const body = kit.mesh(ci === 0 ? 'captive_queen' : 'captive_consort');
    body.material = captiveMat;
    body.position.set(0, c.y - 14, 0); body.rotation.y = ci === 0 ? 0.25 : -0.25; body.castShadow = true;
    pivot.add(body);
    const n = Math.ceil((14 - 2.4) / 0.1);
    for (let k = 0; k < n; k++) linkMats.push({ c: ci, y: -k * 0.1 - 0.05, twist: k % 2 });
    return { ...c, pivot, body, lower: 0, target: 0, seed: ci * 2.3 };
  });
  const chains = new THREE.InstancedMesh(link, chainMat, linkMats.length);
  chains.frustumCulled = false; group.add(chains);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
  const linkS = new THREE.Vector3(1, 1.5, 1), hideS = new THREE.Vector3(1e-4, 1e-4, 1e-4);
  const layoutChains = () => {
    linkMats.forEach((L, i) => {
      const c = captives[L.c];
      const wristY = c.y - c.lower * (c.y - 2.45);
      v.set(0, L.y, 0).applyQuaternion(c.pivot.quaternion).add(c.pivot.position);
      e.set(0, L.twist ? Math.PI / 2 : 0, c.pivot.rotation.z); q.setFromEuler(e);
      m4.compose(v, q, 14 + L.y > wristY + 0.04 ? linkS : hideS); chains.setMatrixAt(i, m4);
    });
    chains.instanceMatrix.needsUpdate = true;
  };

  const fire = fx.build(); if (fire) group.add(fire);

  const update = (dt, t) => {
    if (fx.update) fx.update(dt, t);
    relic.rotation.y = t * 0.5; relic.position.y = RELIC.y + Math.sin(t * 1.3) * 0.12;
    S5.s5Relic.value.set(RELIC.x, relic.position.y, RELIC.z + 0.6, 3.2 * (0.92 + 0.08 * Math.sin(t * 2.1)));
    for (const c of captives) {
      c.lower += (c.target - c.lower) * Math.min(1, dt * 0.6);
      c.body.position.y = c.y - 14 - c.lower * (c.y - 2.45);
      c.pivot.rotation.z = Math.sin(t * 0.7 + c.seed) * 0.018 * (1 - c.lower);
      c.body.rotation.x = Math.sin(t * 0.9 + c.seed) * 0.03;
    }
    layoutChains();
    for (const d of doors) {
      if (d.target > d.open) { d.v += dt * 30; d.open = Math.min(d.target, d.open + d.v * dt); if (d.open >= d.target) d.v = 0; }
      const a = d.open * 1.75 - Math.max(0, d.open - 0.95) * 0.3;
      d.L.rotation.y = -a; d.R.rotation.y = a;
    }
    for (const s of statues) {
      if (s.state === 1) { s.t += dt; s.m.position.x = s.x + Math.sin(s.t * 60) * 0.025 * Math.min(1, s.t * 2); }
    }
  };
  update(0, 0);
  return { fires, doors, statues, captives, relic, throne, altar, update, bannerMesh };
}
