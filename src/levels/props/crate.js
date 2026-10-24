// Breakable supply crate (plank box with corner battens + iron corner caps). Default loot: a magic pot.
import * as THREE from 'three';
import { makeProp, woodTexture, std } from './_breakable.js';

export default makeProp({
  id: 'crate', hp: 14, height: 0.82, radius: 0.42, loot: 'pot', pitch: 0.75, debris: 18, chunk: [0.06, 0.16],
  build() {
    const S = 0.8, map = woodTexture([96, 64, 38]);
    const wood = std({ map, roughness: 0.9, color: '#c8b09a' });
    const batten = std({ map, roughness: 0.92, color: '#7a6250' });
    const iron = std({ color: '#3a3430', roughness: 0.45, metalness: 0.75 });
    const box = new THREE.BoxGeometry(S * 0.96, S * 0.96, S * 0.96); box.translate(0, S * 0.48, 0);
    // battens: 12 edge strips merged into one geometry
    const parts = [];
    const b = 0.09, L = S;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const g = new THREE.BoxGeometry(b, L, b); g.translate(sx * (S / 2 - b / 2 + 0.01), L / 2, sz * (S / 2 - b / 2 + 0.01)); parts.push(g); }
    for (const sy of [0, 1]) for (const sz of [-1, 1]) { const g = new THREE.BoxGeometry(L, b, b); g.translate(0, sy * (S - b) + b / 2, sz * (S / 2 - b / 2 + 0.012)); parts.push(g); }
    for (const sy of [0, 1]) for (const sx of [-1, 1]) { const g = new THREE.BoxGeometry(b, b, L); g.translate(sx * (S / 2 - b / 2 + 0.012), sy * (S - b) + b / 2, 0); parts.push(g); }
    // diagonal brace on the front/back faces
    for (const sz of [-1, 1]) { const g = new THREE.BoxGeometry(S * 1.2, b * 0.8, b * 0.5); g.rotateZ(Math.PI / 4); g.translate(0, S / 2, sz * (S / 2 + 0.02)); parts.push(g); }
    const caps = [];
    for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) { const g = new THREE.BoxGeometry(0.13, 0.13, 0.13); g.translate(sx * (S / 2 - 0.05), sy ? S - 0.05 : 0.05, sz * (S / 2 - 0.05)); caps.push(g); }
    const merge = (list) => { const m = mergeList(list); return m; };
    return { parts: [{ geo: box, mat: wood }, { geo: merge(parts), mat: batten }, { geo: merge(caps), mat: iron }] };
  },
});

function mergeList(list) {
  // tiny non-indexed merge (avoids importing BufferGeometryUtils for a handful of boxes)
  const geos = list.map((g) => g.toNonIndexed());
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return m;
}
