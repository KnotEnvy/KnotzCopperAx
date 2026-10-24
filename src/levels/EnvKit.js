// EnvKit: helpers for stage builders (ctx.kit in stage.build). Everything adds to ctx.group (the renderer's
// envGroup, torn down between stages) and uses instancing/merging to stay inside the draw-call budget.
//   ground(ctx, o) · hills(ctx, o) · scatter(ctx, geo, mat, o) · rocks(ctx, o) · deadTrees(ctx, o) · grass(ctx, o)
//   hut(ctx, o) · flicker(ctx, o) → updater · embers(ctx, o) → updater · mat(color, o) · updaters(list) → update fn
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noiseTexture, normalFromNoise } from '../assets/proceduralTextures.js';

export function mat(color, { rough = 0.85, metal = 0, map = null, normalMap = null, emissive = null, emissiveIntensity = 1, flat = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, map, normalMap, flatShading: flat });
  if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emissiveIntensity; }
  return m;
}

/** Big textured ground strip covering the whole stage (plus margins). */
/** The cached procedural textures ground() uses (perf-1650: lets a stage prefetch them before its build). */
export function groundTextures({ scale = 6, seed = 2, contrast = 1.05, colorA = '#3a2a20', colorB = '#6a4a34', normalStrength = 1.1 } = {}) {
  return { map: noiseTexture({ size: 512, scale, octaves: 5, seed, contrast, colorA, colorB }), nrm: normalFromNoise({ size: 256, scale: 16, octaves: 4, seed: seed + 3, strength: normalStrength }) };
}

export function ground(ctx, { x0 = -30, x1 = 120, z0 = -40, z1 = 12, colorA = '#3a2a20', colorB = '#6a4a34', scale = 6, seed = 2, repeat = 0.12, normalStrength = 1.1, rough = 0.95, contrast = 1.05 } = {}) {
  const w = x1 - x0, d = z1 - z0;
  const map = noiseTexture({ size: 512, scale, octaves: 5, seed, contrast, colorA, colorB }).clone();
  map.repeat.set(w * repeat, d * repeat); map.needsUpdate = true;
  const nrm = normalFromNoise({ size: 256, scale: 16, octaves: 4, seed: seed + 3, strength: normalStrength }).clone();
  nrm.repeat.set(w * repeat * 2, d * repeat * 2); nrm.needsUpdate = true;
  const g = new THREE.PlaneGeometry(w, d, 1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(x0 + w / 2, 0, z0 + d / 2);
  const m = new THREE.Mesh(g, mat('#ffffff', { rough, map, normalMap: nrm }));
  m.receiveShadow = true;
  m.name = 'ground';
  ctx.group.add(m);
  return m;
}

/** Jagged silhouette ridge (far background layer; fog gives depth). */
export function hills(ctx, { x0 = -80, x1 = 200, z = -60, base = 0, height = 10, jag = 0.5, color = '#2a1c1a', seed = 1, step = 3 } = {}) {
  const r = ctx.rng || { next: Math.random };
  const shape = new THREE.Shape();
  shape.moveTo(x0, base - 5);
  let h = height * 0.6;
  for (let x = x0; x <= x1; x += step) {
    h += (r.next() - 0.5) * height * jag;
    h = Math.max(height * 0.2, Math.min(height * 1.3, h * 0.97 + height * 0.03));
    shape.lineTo(x, base + h + Math.sin(x * 0.05 + seed) * height * 0.3);
  }
  shape.lineTo(x1, base - 5);
  const g = new THREE.ShapeGeometry(shape);
  g.translate(0, 0, z);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, fog: true }));
  m.name = 'hills';
  ctx.group.add(m);
  return m;
}

/** Instanced scatter. o: { count, x0, x1, z0, z1, scale:[a,b], yaw, tilt, y, avoidBand: [zMin,zMax] } */
export function scatter(ctx, geo, material, { count = 50, x0 = -10, x1 = 100, z0 = -20, z1 = 8, scale = [0.6, 1.4], yaw = true, tilt = 0, y = 0, avoidBand = null, castShadow = true, receiveShadow = true, name = 'scatter' } = {}) {
  const r = ctx.rng || { next: Math.random, range: (a, b) => a + Math.random() * (b - a) };
  const im = new THREE.InstancedMesh(geo, material, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < count * 3 && n < count; i++) {
    const x = x0 + r.next() * (x1 - x0), z = z0 + r.next() * (z1 - z0);
    if (avoidBand && z > avoidBand[0] && z < avoidBand[1]) continue;
    const k = scale[0] + r.next() * (scale[1] - scale[0]);
    e.set((r.next() - 0.5) * tilt, yaw ? r.next() * Math.PI * 2 : 0, (r.next() - 0.5) * tilt);
    q.setFromEuler(e); p.set(x, y, z); s.set(k, k * (0.8 + r.next() * 0.4), k);
    m4.compose(p, q, s);
    im.setMatrixAt(n++, m4);
  }
  im.count = n;
  im.castShadow = castShadow; im.receiveShadow = receiveShadow;
  im.name = name;
  ctx.group.add(im);
  return im;
}

export function rocks(ctx, o = {}) {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const n = 1 + Math.sin(v.x * 7.1) * 0.12 + Math.cos(v.y * 5.3 + v.z * 3.7) * 0.14; v.multiplyScalar(n); v.y = Math.max(v.y, -0.15); pos.setXYZ(i, v.x, v.y * 0.7, v.z); }
  g.computeVertexNormals();
  const m = mat(o.color || '#5a4a40', { rough: 0.95, flat: true, map: noiseTexture({ size: 128, scale: 6, seed: 9, colorA: '#8a8078', colorB: '#ffffff' }) });
  return scatter(ctx, g, m, { tilt: 0.4, name: 'rocks', ...o });
}

export function deadTrees(ctx, o = {}) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.08, 0.2, 4, 7); trunk.translate(0, 2, 0); parts.push(trunk);
  const branch = (y, a, len, tilt) => { const b = new THREE.CylinderGeometry(0.03, 0.07, len, 5); b.translate(0, len / 2, 0); b.rotateZ(tilt); b.rotateY(a); b.translate(0, y, 0); parts.push(b); };
  branch(2.6, 0, 1.4, 0.9); branch(3.1, 2.2, 1.1, 0.8); branch(2.0, 4.1, 1.2, 1.0); branch(3.5, 1.1, 0.8, 0.6);
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  return scatter(ctx, g, mat(o.color || '#1f1714', { rough: 1 }), { scale: [0.8, 1.6], tilt: 0.15, name: 'deadTrees', ...o });
}

export function grass(ctx, o = {}) {
  const g = new THREE.ConeGeometry(0.06, 0.55, 3, 1, true);
  g.translate(0, 0.27, 0);
  const blades = [];
  for (let i = 0; i < 5; i++) { const b = g.clone(); b.rotateZ((Math.random() - 0.5) * 0.6); b.translate((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25); blades.push(b.toNonIndexed()); }
  const tuft = mergeGeometries(blades);
  const m = mat(o.color || '#6a5a2a', { rough: 1 });
  m.side = THREE.DoubleSide;
  return scatter(ctx, tuft, m, { count: 400, scale: [0.6, 1.4], castShadow: false, name: 'grass', ...o });
}

/** Simple timber hut (optionally burning: emissive windows + flicker). */
export function hut(ctx, { x = 0, z = -8, w = 4, d = 3.5, h = 2.6, yaw = 0, burning = false, wall = '#4a3526', roof = '#2a1f18' } = {}) {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(wall, { rough: 0.95, map: noiseTexture({ size: 128, scale: 12, seed: 4, colorA: '#7a6a5a', colorB: '#ffffff' }) }));
  body.position.y = h / 2; body.castShadow = body.receiveShadow = true;
  const roofG = new THREE.CylinderGeometry(0.01, w * 0.8, h * 0.8, 4, 1); roofG.rotateY(Math.PI / 4); roofG.scale(1, 1, d / w);
  const r = new THREE.Mesh(roofG, mat(roof, { rough: 1 })); r.position.y = h + h * 0.4; r.castShadow = true;
  grp.add(body, r);
  if (burning) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.3, h * 0.35), mat('#000000', { emissive: '#ff6a20', emissiveIntensity: 6 }));
    win.position.set(0, h * 0.5, d / 2 + 0.01); grp.add(win);
  }
  grp.position.set(x, 0, z); grp.rotation.y = yaw;
  ctx.group.add(grp);
  return grp;
}

/** Flickering point light (keep ≤ 2 per stage). Returns an updater(dt, t). */
export function flicker(ctx, { pos = [0, 2, 0], color = '#ff8a3a', intensity = 20, distance = 12, speed = 9 } = {}) {
  const l = new THREE.PointLight(color, intensity, distance, 2);
  l.position.fromArray(pos);
  ctx.group.add(l);
  const seed = Math.random() * 100;
  return (dt, t) => { l.intensity = intensity * (0.75 + 0.25 * Math.sin(t * speed + seed) * Math.sin(t * speed * 1.7 + seed * 2)); };
}

/** Drifting embers emitted through game.vfx (cosmetic). Returns an updater(dt, t). */
export function embers(ctx, { rate = 30, x0 = -10, x1 = 10, z0 = -6, z1 = 3, y = 0.2, color = '#ff8a30', follow = true } = {}) {
  let acc = 0;
  return (dt) => {
    const vfx = ctx.game.vfx; if (!vfx) return;
    acc += dt * rate * vfx.scale;
    const cam = ctx.game.cameraRig;
    const cx = follow && cam ? cam.focus.x : 0;
    while (acc >= 1) {
      acc -= 1;
      const r = vfx.rng;
      vfx.add.emit({ pos: [cx + r.range(x0, x1), y + r.range(0, 2), r.range(z0, z1)], vel: [r.range(0.5, 2.5), r.range(0.4, 1.6), r.range(-0.3, 0.3)], life: r.range(1.5, 3.5), size: [0.035, 0.01], color: ['#ffd090', color], intensity: 4, shape: 'soft', drag: 0.3, gravity: -0.15 });
    }
  };
}

/** Combine several updaters into one env.update. */
export const updaters = (list) => (dt, t) => { for (const u of list) u(dt, t); };
