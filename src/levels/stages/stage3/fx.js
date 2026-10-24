// Stage 3 — loose feathers: a pooled burst of real feather cards (atlas contour/edge slots) torn from the eagle's back
// by heavy hits, knockdowns, landings and ring-outs. They tumble, flutter and are swept back (−X) by the slipstream.
//   const fx = createLooseFeathers(group, { count }) ; fx.burst(x, y, z, n, power) ; fx.update(dt)
import * as THREE from 'three';
import { featherAtlas, buildFeathers, FT } from './feathers.js';

export function createLooseFeathers(group, { count = 90 } = {}) {
  const geo = buildFeathers([
    { p: [0, 0, -0.22], d: [0, 0, 1], n: [0, 1, 0], len: 0.44, wid: 0.3, type: FT.contour, lift: 0.05, cup: 0.3, rand: 0.5 },
  ], { nv: 4 });
  const mat = new THREE.MeshStandardMaterial({ map: featherAtlas(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.8, color: '#e8d8c0' });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'looseFeathers'; mesh.frustumCulled = false; mesh.count = count;
  const P = [];
  const d = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    P.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 1 });
    d.position.set(0, -999, 0); d.scale.setScalar(0.001); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix); mesh.setColorAt(i, new THREE.Color(1, 1, 1));
  }
  const col = new THREE.Color();
  let next = 0;
  group.add(mesh);
  return {
    mesh,
    burst(x, y, z, n = 5, power = 1, tint = null) {
      for (let k = 0; k < n; k++) {
        const idx = next, q = P[idx]; next = (next + 1) % count;
        q.life = 2.2 + Math.random() * 1.6;
        q.p.set(x + (Math.random() - 0.5) * 0.6, y + 0.2 + Math.random() * 0.6, z + (Math.random() - 0.5) * 0.6);
        q.v.set((Math.random() - 0.7) * 3 * power, (1.5 + Math.random() * 3.5) * power, (Math.random() - 0.5) * 3 * power);
        q.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        q.w.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
        q.s = 0.8 + Math.random() * 0.8;
        col.set(tint || '#ffffff').multiplyScalar(0.8 + Math.random() * 0.4);
        mesh.setColorAt(idx, col);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    update(dt) {
      for (let i = 0; i < count; i++) {
        const q = P[i];
        if (q.life <= 0) continue;
        q.life -= dt;
        // flutter: drag toward a slow fall + slipstream sweeping everything back toward the tail
        q.v.x += (-9 - q.v.x) * Math.min(1, dt * 1.4);
        q.v.y += (-1.4 - q.v.y) * Math.min(1, dt * 2.2) + Math.sin(q.life * 9 + i) * dt * 4;
        q.v.z *= 1 - Math.min(1, dt * 1.5);
        q.p.addScaledVector(q.v, dt);
        q.r.x += q.w.x * dt; q.r.y += q.w.y * dt; q.r.z += q.w.z * dt;
        d.position.copy(q.p); d.rotation.copy(q.r); d.scale.setScalar(q.life > 0 ? q.s * Math.min(1, q.life * 2) : 0.001);
        if (q.life <= 0) d.position.y = -999;
        d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
