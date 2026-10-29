// Stage 5's low scene light leaves ordinary breakables outside both the hall shader and the character key.
// Give ONLY crate/urn materials a restrained, neutral overhead key. Keep their source textures, tint, PBR values,
// hitboxes and gameplay intact. Clones belong to this stage; never patch the sharedKind material cache.
import * as THREE from 'three';
import { EV } from '../../../core/EventBus.js';

const PARS = /* glsl */`
uniform vec3 s5PropKey;
uniform vec3 s5PropDir;
`;
const LIGHT = /* glsl */`
{
  vec3 propN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 propV = normalize((vec4(normalize(vViewPosition), 0.0) * viewMatrix).xyz);
  vec3 propH = s5PropDir + propV;
  propH *= inversesqrt(max(dot(propH, propH), 1e-8));
  float propNL = max(dot(propN, s5PropDir), 0.0);
  float propSh = mix(7.0, 65.0, pow(1.0 - roughnessFactor, 2.0));
  float propSpec = pow(max(dot(propN, propH), 0.0), propSh) * (propSh + 8.0) / 25.0;
  reflectedLight.directDiffuse += material.diffuseColor * s5PropKey * (0.08 + 0.92 * propNL);
  reflectedLight.directSpecular += material.specularColorBlended * s5PropKey * propSpec * propNL;
}
`;

export function lightBreakables(game) {
  const scope = game.bus.scope(), actors = new Map(), materials = new Map();
  const uniforms = {
    s5PropKey: { value: new THREE.Color('#c7c0b6').multiplyScalar(2.0) },
    s5PropDir: { value: new THREE.Vector3(-0.6, 0.75, 0.65).normalize() },
  };
  function clone(source) {
    let mat = materials.get(source);
    if (mat) return mat;
    mat = source.clone();
    mat.name = 's5_breakable_' + (source.name || source.id);
    mat.userData.s5Prop = true;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + PARS)
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + LIGHT);
    };
    mat.customProgramCacheKey = () => 's5:breakable-key:v1';
    materials.set(source, mat);
    return mat;
  }
  function attach(actor) {
    if (!actor || actor.kind !== 'prop' || !['crate', 'urn'].includes(actor.typeId) || !actor.model || actors.has(actor)) return;
    const parts = [];
    actor.model.traverse((mesh) => {
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
