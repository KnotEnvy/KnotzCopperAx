// Stage-local registration for the two breakables that were outside both the castle lighting
// and the combatant key. Their existing wood grain, braces/caps, painted clay, normals and
// PBR values are preserved. Only these instances receive the existing stage torch/sky response.
import { EV } from '../../../core/EventBus.js';
import { patchMaterial } from './shading.js';

export function lightBreakables(game) {
  const scope = game.bus.scope(), actors = new Map(), materials = new Map();
  function clone(source) {
    let mat = materials.get(source);
    if (mat) return mat;
    mat = patchMaterial(source.clone(), {
      key: 'breakable-r33', cold: 2.4, pool: 0.75,
      // Retain the authored roughness/metalness and all texture channels. Low wet sheen only;
      // the additional diffuse term is directional storm-sky light, never pigment/emission.
      surface: 's4WetM = 0.18; s4Mirror = 0.0;',
    });
    mat.name = 's4_breakable_' + (source.name || source.id);
    mat.userData.s4Prop = true;
    materials.set(source, mat);
    return mat;
  }
  function attach(actor) {
    if (!actor || actor.kind !== 'prop' || !['crate', 'urn'].includes(actor.typeId) || !actor.model || actors.has(actor)) return;
    const parts = [];
    actor.model.traverse(mesh => {
      if (!mesh.isMesh || !mesh.material || mesh.userData.ownsMaterial) return;
      const source = mesh.material;
      if (!(Array.isArray(source) ? source : [source]).every(m => m.isMeshStandardMaterial)) return;
      mesh.material = Array.isArray(source) ? source.map(clone) : clone(source);
      parts.push({ mesh, source, local: mesh.material });
    });
    if (parts.length) actors.set(actor, parts);
  }
  function detach(actor) {
    const parts = actors.get(actor);
    if (!parts) return;
    for (const { mesh, source, local } of parts) if (mesh.material === local) mesh.material = source;
    actors.delete(actor);
  }
  scope.on(EV.SPAWN, ({ actor }) => attach(actor));
  scope.on(EV.DESPAWN, ({ actor }) => detach(actor));
  for (const actor of game.world.actors) attach(actor);
  return {
    dispose() {
      scope.dispose();
      for (const actor of actors.keys()) detach(actor);
      for (const mat of materials.values()) mat.dispose();
      materials.clear(); // Maps/textures/geometries still belong to the shared prop cache.
    },
  };
}
