// Breakable stave barrel (bulged lathe body + three iron hoops). Default loot: two magic pots.
import * as THREE from 'three';
import { makeProp, woodTexture, std } from './_breakable.js';

export default makeProp({
  id: 'barrel', hp: 18, height: 1.0, radius: 0.38, loot: ['pot', 'pot'], pitch: 0.65, debris: 18, chunk: [0.06, 0.15],
  build() {
    const H = 0.98, N = 12, prof = [];
    for (let i = 0; i <= N; i++) { const t = i / N; prof.push(new THREE.Vector2(0.3 + Math.sin(t * Math.PI) * 0.07, t * H)); }
    prof.unshift(new THREE.Vector2(0, 0)); prof.push(new THREE.Vector2(0, H));
    const body = new THREE.LatheGeometry(prof, 16);
    const tex = woodTexture([88, 56, 32]); tex.rotation = Math.PI / 2; tex.repeat.set(3, 1);
    const wood = std({ map: tex, roughness: 0.88, color: '#c4a88e' });
    const iron = std({ color: '#2e2a28', roughness: 0.4, metalness: 0.8 });
    const hoops = [];
    for (const t of [0.12, 0.5, 0.88]) { const r = 0.3 + Math.sin(t * Math.PI) * 0.07 + 0.012; const g = new THREE.CylinderGeometry(r, r, 0.06, 16, 1, true); g.translate(0, t * H, 0); hoops.push(g.toNonIndexed()); }
    let n = 0; for (const g of hoops) n += g.attributes.position.count;
    const hg = new THREE.BufferGeometry();
    for (const [k, s] of [['position', 3], ['normal', 3], ['uv', 2]]) { const out = new Float32Array(n * s); let o = 0; for (const g of hoops) { out.set(g.attributes[k].array, o); o += g.attributes[k].array.length; } hg.setAttribute(k, new THREE.BufferAttribute(out, s)); }
    const iron2 = iron; iron2.side = THREE.DoubleSide;
    return { parts: [{ geo: body, mat: wood }, { geo: hg, mat: iron2 }] };
  },
});
