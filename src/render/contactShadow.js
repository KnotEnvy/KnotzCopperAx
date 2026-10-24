// Soft contact ("blob") shadow under actors. Grounds characters in addition to the real shadow map,
// shrinks/fades as the actor rises. Shared geometry + material; one draw call per actor.
import * as THREE from 'three';
import { radialTexture } from '../assets/proceduralTextures.js';

let geo = null, mat = null;
// Blob stretched along X and nudged away from the stage key light (sun from +X in every current preset), so the
// contact shadow agrees with the shadow-map shadow instead of reading as a centred decal. [sx, sz, offsetX]
export const SHADOW_STRETCH = [1.22, 0.86, -0.08];

export function createContactShadow(radius = 0.45, opacity = 0.55) {
  if (!geo) {
    geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    mat = new THREE.MeshBasicMaterial({
      map: radialTexture({ size: 128, inner: 0.0, outer: 1, power: 1.8, color: '0,0,0' }),
      transparent: true, depthWrite: false, opacity: 1, color: 0x000000, fog: false, // fog would tint the black blob pale blue
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
  }
  const m = new THREE.Mesh(geo, mat.clone());
  m.material.opacity = opacity;
  m.userData.baseOpacity = opacity;
  m.userData.radius = radius;
  m.userData.stretch = SHADOW_STRETCH;
  m.scale.set(radius * 2.6 * SHADOW_STRETCH[0], 1, radius * 2.6 * SHADOW_STRETCH[1]);
  m.position.x = SHADOW_STRETCH[2];
  m.renderOrder = -1;
  m.name = 'contactShadow';
  return m;
}

/** Update blob for actor height above ground (metres). */
export function updateContactShadow(m, heightAboveGround) {
  const k = 1 / (1 + Math.max(0, heightAboveGround) * 0.55);
  m.position.y = -heightAboveGround + 0.015;
  const sc = m.userData.radius * 2.6 * (0.55 + 0.45 * k), st = m.userData.stretch || SHADOW_STRETCH;
  m.scale.set(sc * st[0], 1, sc * st[1]);
  m.material.opacity = m.userData.baseOpacity * k;
}
