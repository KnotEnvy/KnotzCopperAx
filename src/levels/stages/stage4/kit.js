// Stage 4 stone kit loader: env_stage4_kit.glb (blender/build_env_stage4_kit.py) → one BufferGeometry per module,
// placed with InstancedMesh (one draw per module type). Module frames (glTF): x along the wall, +z = camera side,
// y up, origin on the base line; facades' fronts sit at local z = +1.5.
import * as THREE from 'three';
import { kitMaterial } from './shading.js';

// env-r33: castle ARCHITECTURE modules get a weathering material each (same program, per-material uniforms; draws
// unchanged: one InstancedMesh per module type either way). ledges = module-local y of the real drip edges measured on
// the donor GLB (progress/tmp/env-r33-scenes/tools/kit_ledges.mjs): wall/wall_door corbel underside 8.25 + plinth 1.0,
// tower/tower_spire machicolation 14.5, gatehouse 8.0 / 12.25 / 14.5. *_lo variants share their module's material.
// Statues, gargoyles, sigils, braziers, doors and portcullises keep the base kit material (props response).
export const KIT_LEDGES = { wall: [8.25, 1.0], wall_door: [8.25, 1.0], tower: [14.5], tower_spire: [14.5], gatehouse: [8.0, 12.25, 14.5] };

export const KIT_NAMES = ['wall', 'wall_door', 'door_L', 'door_R', 'tower', 'tower_spire', 'gatehouse', 'portcullis', 'brazier', 'serpent', 'gargoyle', 'sigil', 'wall_lo', 'tower_lo', 'tower_spire_lo', 'gatehouse_lo'];

// env-r33 structural supplement: env_stage4_r33_structure.glb (blender/build_env_stage4_r33_structure.py) holds COMPLETE
// replacement geometry for the nine structural modules below (mixed short/medium/long coursed ashlar over a recessed
// mortar core, same module frames, bounds and RGBA masks). It is loaded once beside the donor kit and overlaid by exact
// name; the donor GLB stays the source of every other module (serpent statues, gargoyles, sigils, braziers, doors,
// portcullis). All-or-nothing: if the supplement is missing or malformed the donor modules stay (with a warning).
export const STRUCT_ASSET = 'env_stage4_r33_structure';
export const STRUCT_NAMES = ['wall', 'wall_door', 'tower', 'tower_spire', 'gatehouse', 'wall_lo', 'tower_lo', 'tower_spire_lo', 'gatehouse_lo'];

function overlayStructure(res, geos) {
  if (!res || !res.root || res.source === 'placeholder') throw new Error(STRUCT_ASSET + '.glb unavailable');
  res.root.updateMatrixWorld(true);
  const rep = new Map();
  try {
    res.root.traverse((o) => {
      if (!o.isMesh) return;
      let n = o.name;
      if (!STRUCT_NAMES.includes(n) && o.parent && STRUCT_NAMES.includes(o.parent.name)) n = o.parent.name;
      if (!STRUCT_NAMES.includes(n) || rep.has(n)) throw new Error('unexpected structural module ' + n);
      const g = o.geometry.clone();   // the AssetLoader's cached source geometry stays untouched
      rep.set(n, g);
      g.applyMatrix4(o.matrixWorld);
      g.computeBoundingSphere(); g.computeBoundingBox();
      const c = g.getAttribute('color');
      if (!c || c.itemSize !== 4) throw new Error('structural module without RGBA mask: ' + n);
    });
    if (rep.size !== STRUCT_NAMES.length) throw new Error(`incomplete structural supplement (${rep.size}/${STRUCT_NAMES.length})`);
  } catch (e) { for (const g of rep.values()) g.dispose(); throw e; }
  // dispose only this call's replaced donor CLONES; the donor's cached source geometry is shared and stays alive
  for (const [n, g] of rep) { if (geos[n]) geos[n].dispose(); geos[n] = g; }
  return [...rep.keys()];
}

export async function loadKit(game) {
  const geos = {};
  const A = game.assets && game.assets.instance ? game.assets : null;
  // both GLBs fetch in parallel (no extra load latency)
  const supP = A ? A.instance(STRUCT_ASSET, { cloneMaterials: false }).catch(() => null) : Promise.resolve(null);
  try {
    const res = A ? await A.instance('env_stage4_kit', { cloneMaterials: false }).catch(() => null) : null;
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
  let structure = null;
  try { structure = overlayStructure(await supP, geos); } catch (e) { console.warn('[stage4] structural supplement not applied, donor modules kept:', e && e.message); }
  const mat = kitMaterial({ glow: 0.6 });
  const archMats = {};
  const matFor = (n) => { const b = n.replace(/_lo$/, ''); return KIT_LEDGES[b] ? (archMats[b] ||= kitMaterial({ glow: 0.6, arch: { ledges: KIT_LEDGES[b] } })) : mat; };
  const fallback = (n) => {
    const s = { wall: [8, 11, 3], wall_door: [8, 11, 3], tower: [6.4, 17, 6.4], tower_spire: [6.4, 26, 6.4], gatehouse: [12, 14, 4], portcullis: [5.6, 7.9, 0.2], brazier: [1.2, 1.5, 1.2], serpent: [1.8, 3.5, 1.8], gargoyle: [0.9, 1.5, 1.2], sigil: [2.6, 2.6, 0.4], door_L: [1.4, 2.5, 0.12], door_R: [1.4, 2.5, 0.12] }[n] || [1, 1, 1];
    const g = new THREE.BoxGeometry(s[0], s[1], s[2]); g.translate(0, s[1] / 2, 0);
    const c = new Float32Array(g.attributes.position.count * 4).fill(0.25); for (let i = 3; i < c.length; i += 4) c[i] = 0;
    g.setAttribute('color', new THREE.BufferAttribute(c, 4));
    return g;
  };
  const geo = (n) => geos[n] || (n.endsWith('_lo') && geos[n.slice(0, -3)]) || (geos[n] = fallback(n.replace(/_lo$/, '')));
  return {
    ok, geo, mat, matFor,
    /** names overlaid from the structural supplement (null = donor geometry for every module) */
    structure,
    /** Instanced placement. items: [{ x, y, z, ry (rad), s (uniform scale) | sx/sy/sz }] */
    place(group, name, items, { material = matFor(name), castShadow = false, receiveShadow = true } = {}) {
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
