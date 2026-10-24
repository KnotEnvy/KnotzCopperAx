// Breakable clay urn (lathe-turned amphora with a painted frieze band and a lid). Default loot: meat (food).
import * as THREE from 'three';
import { makeProp, clayTexture, std } from './_breakable.js';

export default makeProp({
  id: 'urn', hp: 6, height: 0.95, radius: 0.32, loot: 'food', pitch: 1.25, debris: 20, chunk: [0.04, 0.1],
  build() {
    const prof = [[0.0, 0], [0.16, 0], [0.2, 0.03], [0.27, 0.16], [0.31, 0.36], [0.3, 0.52], [0.24, 0.68], [0.14, 0.78], [0.12, 0.84], [0.16, 0.88], [0.15, 0.9], [0.0, 0.9]];
    const body = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 18);
    const clay = std({ map: clayTexture(), roughness: 0.7, color: '#ffffff' });
    const lid = new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); lid.scale(1, 0.55, 1); lid.translate(0, 0.9, 0);
    const knob = new THREE.SphereGeometry(0.035, 8, 6); knob.translate(0, 0.98, 0);
    const lidMat = std({ color: '#2a201a', roughness: 0.55 });
    const lg = new THREE.BufferGeometry();
    const a = lid.toNonIndexed(), b = knob.toNonIndexed();
    const cat = (k, s) => { const out = new Float32Array(a.attributes[k].array.length + b.attributes[k].array.length); out.set(a.attributes[k].array); out.set(b.attributes[k].array, a.attributes[k].array.length); return new THREE.BufferAttribute(out, s); };
    lg.setAttribute('position', cat('position', 3)); lg.setAttribute('normal', cat('normal', 3)); lg.setAttribute('uv', cat('uv', 2));
    return { parts: [{ geo: body, mat: clay }, { geo: lg, mat: lidMat }] };
  },
});
