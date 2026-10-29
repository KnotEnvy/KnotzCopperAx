// Stage 5 hall kit loader: env_stage5_kit.glb (blender/build_env_stage5_kit.py) → one BufferGeometry per module,
// placed with InstancedMesh (one draw per module type). Module frames (glTF): x along the wall, +z = camera side,
// y up, origin on the base line; facades' fronts sit at local z = +1.5.
// env r32: env_stage5_forms_r32.glb (blender/package_env_stage5_r32.py: the clean r32 pillar, pillar_lo and throne,
// byte-exact from the r32 release) replaces those three modules BY NAME on the unchanged donor kit. Same names, frames,
// COLOR_0 masks and placements, so instance counts, draws and materials stay identical; the supplement root is never
// added to the scene. A missing or invalid supplement keeps all three donor modules. kit.source records what actually
// loaded (gated captures read it, so a silent fallback cannot pass as the new forms).
//   &s5forms=<same-origin path ending /assets/models/env_stage5_forms_r32.glb> (A/B + frozen-build routing) · &s5forms=0
import * as THREE from 'three';
import { kitMaterial } from './shading.js';

export const KIT_NAMES = ['wall', 'wall_door', 'door_L', 'door_R', 'pillar', 'brazier', 'throne', 'altar', 'statue', 'plinth', 'bones', 'banner', 'captive_queen', 'captive_consort', 'ledge', 'wall_lo', 'pillar_lo'];
export const FORMS_ID = 'env_stage5_forms_r32';
export const FORMS_NAMES = ['pillar', 'pillar_lo', 'throne'];
const FORMS_PATH = /^(\/_bench\/[A-Za-z0-9._-]+)?\/assets\/models\/env_stage5_forms_r32\.glb$/;

/** &s5forms → null (AssetLoader default path), false (donor only) or a validated same-origin path. */
function formsParam(game) {
  const q = game && game.params && game.params.raw;
  if (!q || !q.has('s5forms')) return null;
  const v = q.get('s5forms');
  if (v === '0' || v === 'false' || v === 'off') return false;
  try {
    const u = new URL(v, location.href);
    if (u.origin === location.origin && FORMS_PATH.test(u.pathname)) return u.pathname;
  } catch (e) { /* not a URL → default path */ }
  console.warn('[stage5] &s5forms ignored (same-origin …/assets/models/env_stage5_forms_r32.glb only):', v);
  return null;
}

const meshName = (o, names) => (!names.includes(o.name) && o.parent && names.includes(o.parent.name) ? o.parent.name : o.name);
const formsGeoOk = (g) => !!(g && g.index && g.index.count > 0 && g.attributes.position && g.attributes.position.itemSize === 3
  && g.attributes.normal && g.attributes.color && g.attributes.color.itemSize === 4);   // a = the kit material mask

export async function loadKit(game) {
  const geos = {};
  const A = game.assets && game.assets.instance && game.assets.url ? game.assets : null;
  const over = formsParam(game);
  // per-game copy of the manifest with the override entry (the shared default manifest and AssetLoader stay unchanged)
  if (A && typeof over === 'string') { const m = A.manifest || {}; A.manifest = { ...m, [FORMS_ID]: { ...(m[FORMS_ID] || {}), url: over } }; }
  const source = {
    donor: { id: 'env_stage5_kit', url: A ? A.url('env_stage5_kit') : null, status: 'none', modules: [] },
    forms: { id: FORMS_ID, url: over === false || !A ? null : A.url(FORMS_ID), override: over, status: over === false ? 'disabled' : 'none', replaced: [], ignored: [], tris: {} },
  };
  let fres = null;
  try {
    const [res, fr] = await Promise.all([
      A ? A.instance('env_stage5_kit', { cloneMaterials: false }).catch(() => null) : null,
      A && over !== false ? A.instance(FORMS_ID, { cloneMaterials: false }).catch(() => null) : null,
    ]);
    fres = fr;
    if (!res || !res.root || res.source === 'placeholder') source.donor.status = 'missing';
    else {
      source.donor.status = 'glb';
      res.root.updateMatrixWorld(true);
      res.root.traverse((o) => {
        if (!o.isMesh) return;
        const n = meshName(o, KIT_NAMES);
        const g = o.geometry.clone();
        // bake any node transform except the placement (all kit objects are exported at the origin)
        g.applyMatrix4(o.matrixWorld);
        g.computeBoundingSphere(); g.computeBoundingBox();
        geos[n] = g;
      });
      source.donor.modules = Object.keys(geos);
    }
  } catch (e) { console.warn('[stage5] kit', e); }
  const ok = Object.keys(geos).length > 0;
  if (!ok) console.warn('[stage5] env_stage5_kit.glb missing — proxy boxes');
  // ---- env r32 forms overlay: all three modules or none (never a new pillar beside an old pillar_lo)
  if (source.forms.status !== 'disabled') {
    try {
      if (!fres || !fres.root || fres.source === 'placeholder') source.forms.status = 'missing';
      else if (!ok) source.forms.status = 'skipped (no donor kit)';
      else {
        fres.root.updateMatrixWorld(true);
        const found = {};
        fres.root.traverse((o) => {
          if (!o.isMesh) return;
          const n = meshName(o, FORMS_NAMES);
          if (FORMS_NAMES.includes(n) && !found[n]) found[n] = o; else source.forms.ignored.push(o.name);
        });
        const bad = FORMS_NAMES.filter((n) => !found[n] || !formsGeoOk(found[n].geometry) || !geos[n]);
        if (bad.length) source.forms.status = 'invalid: ' + bad.join(',');
        else {
          const next = {};
          for (const n of FORMS_NAMES) {
            const g = found[n].geometry.clone();             // the cached GLTF geometry itself is never modified/disposed
            g.applyMatrix4(found[n].matrixWorld);            // same node-transform handling as the donor, exactly once
            g.computeBoundingSphere(); g.computeBoundingBox();
            next[n] = g;
          }
          for (const n of FORMS_NAMES) {                     // swap only once all three are ready
            geos[n].dispose();                               // the replaced donor clone (temporary, never drawn)
            geos[n] = next[n];
            source.forms.replaced.push(n);
            source.forms.tris[n] = next[n].index.count / 3;
          }
          source.forms.status = 'glb';
        }
      }
    } catch (e) { source.forms.status = 'error'; console.warn('[stage5] kit forms', e); }
  }
  fres = null;
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
    /** env r32: what actually loaded (donor modules, forms status/url/replaced/tris) — read by gated captures */
    source,
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
