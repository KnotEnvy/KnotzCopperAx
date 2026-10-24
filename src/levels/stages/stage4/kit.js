// Stage 4 stone kit loader: env_stage4_kit.glb (blender/build_env_stage4_kit.py) → one BufferGeometry per module,
// placed with InstancedMesh (one draw per module type). Module frames (glTF): x along the wall, +z = camera side,
// y up, origin on the base line; facades' fronts sit at local z = +1.5.
import * as THREE from 'three';
import { kitMaterial } from './shading.js';

export const KIT_NAMES = ['wall', 'wall_door', 'door_L', 'door_R', 'tower', 'tower_spire', 'gatehouse', 'portcullis', 'brazier', 'serpent', 'gargoyle', 'sigil', 'wall_lo', 'tower_lo', 'tower_spire_lo', 'gatehouse_lo'];

export async function loadKit(game) {
  const geos = {};
  try {
    const res = game.assets && game.assets.instance ? await game.assets.instance('env_stage4_kit', { cloneMaterials: false }).catch(() => null) : null;
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
  } catch (e) { console.warn('[stage4] kit', e); }
  const ok = Object.keys(geos).length > 0;
  if (!ok) console.warn('[stage4] env_stage4_kit.glb missing — proxy boxes');
  const mat = kitMaterial({ glow: 0.6 });
  const fallback = (n) => {
    const s = { wall: [8, 11, 3], wall_door: [8, 11, 3], tower: [6.4, 17, 6.4], tower_spire: [6.4, 26, 6.4], gatehouse: [12, 14, 4], portcullis: [5.6, 7.9, 0.2], brazier: [1.2, 1.5, 1.2], serpent: [1.8, 3.5, 1.8], gargoyle: [0.9, 1.5, 1.2], sigil: [2.6, 2.6, 0.4], door_L: [1.4, 2.5, 0.12], door_R: [1.4, 2.5, 0.12] }[n] || [1, 1, 1];
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
      im.name = 's4_' + name;
      group.add(im);
      return im;
    },
    /** Single mesh (animated pieces). */
    mesh(name, material = mat) {
      const m = new THREE.Mesh(geo(name), material);
      m.name = 's4_' + name;
      return m;
    },
  };
}
