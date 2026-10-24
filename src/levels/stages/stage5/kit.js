// Stage 5 hall kit loader: env_stage5_kit.glb (blender/build_env_stage5_kit.py) → one BufferGeometry per module,
// placed with InstancedMesh (one draw per module type). Module frames (glTF): x along the wall, +z = camera side,
// y up, origin on the base line; facades' fronts sit at local z = +1.5.
import * as THREE from 'three';
import { kitMaterial } from './shading.js';

export const KIT_NAMES = ['wall', 'wall_door', 'door_L', 'door_R', 'pillar', 'brazier', 'throne', 'altar', 'statue', 'plinth', 'bones', 'banner', 'captive_queen', 'captive_consort', 'ledge', 'wall_lo', 'pillar_lo'];

export async function loadKit(game) {
  const geos = {};
  try {
    const res = game.assets && game.assets.instance ? await game.assets.instance('env_stage5_kit', { cloneMaterials: false }).catch(() => null) : null;
    if (res && res.root && res.source !== 'placeholder') {
      res.root.updateMatrixWorld(true);
      res.root.traverse((o) => {
        if (!o.isMesh) return;
        let n = o.name;
        if (!KIT_NAMES.includes(n) && o.parent && KIT_NAMES.includes(o.parent.name)) n = o.parent.name;
        const g = o.geometry.clone();
        // bake any node transform except the placement (all kit objects are exported at the origin)
        g.applyMatrix4(o.matrixWorld);
        g.computeBoundingSphere(); g.computeBoundingBox();
        geos[n] = g;
      });
    }
  } catch (e) { console.warn('[stage5] kit', e); }
  const ok = Object.keys(geos).length > 0;
  if (!ok) console.warn('[stage5] env_stage5_kit.glb missing — proxy boxes');
  const mat = kitMaterial({ glow: 0.6 });
  const fallback = (n) => {
    const s = { wall: [8, 13, 3], wall_door: [8, 13, 3], pillar: [2.6, 11.2, 2.6], brazier: [1.2, 1.6, 1.2], throne: [7.6, 5, 4.6], altar: [5.2, 4.3, 3.2], statue: [1.2, 3, 0.8], plinth: [1.4, 0.9, 1.2], bones: [2.2, 0.5, 1.6], banner: [1.5, 4.4, 0.05], captive_queen: [0.5, 2.3, 0.4], captive_consort: [0.5, 2.3, 0.4], ledge: [8, 3.4, 1], door_L: [1.3, 3.9, 0.12], door_R: [1.3, 3.9, 0.12] }[n] || [1, 1, 1];
    const g = new THREE.BoxGeometry(s[0], s[1], s[2]); g.translate(0, s[1] / 2, 0);
    const c = new Float32Array(g.attributes.position.count * 4).fill(0.25); for (let i = 3; i < c.length; i += 4) c[i] = 0;
    g.setAttribute('color', new THREE.BufferAttribute(c, 4));
    return g;
  };
  const geo = (n) => geos[n] || (n.endsWith('_lo') && geos[n.slice(0, -3)]) || (geos[n] = fallback(n.replace(/_lo$/, '')));
  return {
    ok, geo, mat,
    /** Instanced placement. items: [{ x, y, z, ry (rad), s (uniform scale) | sx/sy/sz }] */
    place(group, name, items, { material = mat, castShadow = false, receiveShadow = true } = {}) {
      if (!items.length) return null;
      const im = new THREE.InstancedMesh(geo(name), material, items.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
      items.forEach((it, i) => {
        p.set(it.x || 0, it.y || 0, it.z || 0);
        e.set(it.rx || 0, it.ry || 0, it.rz || 0); q.setFromEuler(e);
        const k = it.s ?? 1; s.set(it.sx ?? k, it.sy ?? k, it.sz ?? k);
        m4.compose(p, q, s); im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = castShadow; im.receiveShadow = receiveShadow;
      im.name = 's5_' + name;
      group.add(im);
      return im;
    },
    /** Single mesh (animated pieces). */
    mesh(name, material = mat) {
      const m = new THREE.Mesh(geo(name), material);
      m.name = 's5_' + name;
      return m;
    },
  };
}
