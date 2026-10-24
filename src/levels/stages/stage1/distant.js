// Far parallax layers for Ashen Wilds: three painted ridge silhouettes stepping toward the horizon haze, the
// distant BURNING KEEP (towers, curtain walls, glowing windows, crown fires) with leaning smoke columns, and
// horizon fire glows. Silhouettes are unlit, un-fogged vertex-coloured shapes (painter-controlled values: each
// layer lighter and closer to the sky than the one in front), so the far distance always reads as flat painted
// planes behind the lit 3D mid-ground.
import * as THREE from 'three';
import { rngFrom, fbm2 } from './geo.js';

function ridge({ z, x0 = -520, x1 = 640, base = -30, h0, h1, freq, seed, top, bottom, step = 3, dip = null, crag = 0, trees = 0, treeH = [2, 5], rim = null }) {
  const pos = [], col = [], idx = [];
  const cT = new THREE.Color(top), cB = new THREE.Color(bottom), c = new THREE.Color();
  const cR = rim ? new THREE.Color(rim) : null;
  const rng = rngFrom(seed * 131 + 7);
  const hAt = (x) => {
    const n = fbm2(x * freq, seed, seed, 5);
    const peak = Math.pow(fbm2(x * freq * 0.35, seed * 2.1, seed + 5, 3), 2.2);
    let h = h0 + (h1 - h0) * (n * 0.55 + peak * 0.9);
    // rocky breaks: ridged high-frequency noise gives crags and shoulders instead of a smooth blob outline
    if (crag) { const r = 1 - Math.abs(fbm2(x * freq * 5.5, seed + 3.3, seed + 9, 3) * 2 - 1); h += (Math.pow(r, 3) - 0.3) * crag; }
    // a saddle where the setting sun sits (keeps the disc visible over the camera's scroll range)
    if (dip) h = h0 * 0.5 + (h - h0 * 0.5) * (1 - dip[2] * Math.exp(-(((x - dip[0]) / dip[1]) ** 2)));
    return h;
  };
  let i = 0;
  for (let x = x0; x <= x1; x += step) {
    const h = hAt(x);
    pos.push(x, base, z, x, h, z);
    c.copy(cB); col.push(c.r, c.g, c.b);
    c.copy(cB).lerp(cT, 0.92); col.push(c.r, c.g, c.b);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    i++;
  }
  // skyline fringe: clumps of dead trees / burnt pines along the crest (silhouette detail at every scroll position)
  let v = pos.length / 3;
  const tri = (ax, ay, bx, by, cx, cy, ca, cb) => {
    pos.push(ax, ay, z + 0.5, bx, by, z + 0.5, cx, cy, z + 0.5);
    col.push(ca.r, ca.g, ca.b, ca.r, ca.g, ca.b, cb.r, cb.g, cb.b);
    idx.push(v, v + 1, v + 2); v += 3;
  };
  if (trees > 0) {
    const cTop = new THREE.Color().copy(cB).lerp(cT, 0.97);
    const cTip = cR ? new THREE.Color().copy(cTop).lerp(cR, 0.35) : cTop;
    for (let x = x0; x <= x1; x += 1.2 + rng.next() * 3.2) {
      const clump = fbm2(x * 0.02, seed + 1.7, seed + 2, 2);
      if (clump < 1 - trees || (dip && Math.abs(x - dip[0]) < dip[1] * 0.35)) continue;
      const hy = hAt(x) - 0.3, th = treeH[0] + rng.next() * (treeH[1] - treeH[0]) * (0.6 + clump * 0.6);
      const lean = (rng.next() - 0.5) * 0.35 * th, w = th * (0.06 + rng.next() * 0.05);
      if (rng.next() < 0.55) { // conifer (burnt pine)
        const bw = th * (0.22 + rng.next() * 0.12);
        tri(x - bw, hy + th * 0.15, x + bw, hy + th * 0.15, x + lean * 0.3, hy + th, cTop, cTip);
        tri(x - w, hy, x + w, hy, x, hy + th * 0.3, cTop, cTop);
      } else { // dead broadleaf: trunk + two forks
        tri(x - w, hy, x + w, hy, x + lean, hy + th, cTop, cTip);
        const fy = hy + th * (0.45 + rng.next() * 0.2), fl = th * (0.35 + rng.next() * 0.25);
        tri(x + lean * 0.45 - w * 0.5, fy, x + lean * 0.45 + w * 0.5, fy, x + lean * 0.45 - fl * 0.7, fy + fl, cTop, cTip);
        tri(x + lean * 0.6 - w * 0.4, fy + th * 0.1, x + lean * 0.6 + w * 0.4, fy + th * 0.1, x + lean + fl * 0.6, fy + th * 0.1 + fl * 0.8, cTop, cTip);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function keepGeometry(rng) {
  const parts = [];
  const box = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); parts.push(g); };
  const cyl = (r, h, x, y, z, s = 10) => { const g = new THREE.CylinderGeometry(r, r * 1.06, h, s); g.translate(x, y + h / 2, z); parts.push(g); };
  // Keep the eave ring on the tower after shortening a damaged roof. Tilting a
  // scaled cone around its centre left a visible strip of sky below both roofs.
  const cone = (r, h, x, y, z, broken = false) => {
    const height = broken ? h * 0.55 : h;
    const g = new THREE.ConeGeometry(r, height, 10);
    if (broken) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + (p.getY(i) + height / 2) * 0.3); }
    g.translate(x, y + height / 2 - 0.12, z); parts.push(g);
  };
  const crenel = (x0, x1, y, z, d = 1.2) => { for (let x = x0; x < x1; x += 1.6) box(0.9, 1.0, d, x, y, z); };
  // hill mound
  const mound = new THREE.SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2); mound.scale(70, 7, 24); mound.translate(0, 0, 0); parts.push(mound);
  // curtain walls
  box(46, 9, 2.2, 0, 4, 0); crenel(-23, 23, 13, 0);
  box(2.2, 8, 16, -22, 4, -7); box(2.2, 8, 16, 22, 4, -7);
  // donjon
  box(11, 21, 10, 3, 6, -6); crenel(-2.2, 8.6, 27, -1.2, 1.4);
  box(4, 5, 4, 6.5, 27, -6); cone(3.2, 5, 6.5, 32, -6, true);
  // towers
  cyl(3.4, 17, -22, 3, 0); cone(4.1, 7, -22, 20, 0);
  cyl(3.0, 15, 22, 3, 0); crenel(19.5, 24.8, 18, 0, 1.6);
  cyl(2.6, 22, -8, 3, -9); cone(3.2, 6, -8, 25, -9, true);
  // broken wall stub and gate
  box(8, 5, 2.4, 34, 3, 2); box(5, 12, 5, 12, 3, 1.5); crenel(9.8, 14.4, 15, 1.5, 1.5);
  const g = new THREE.BufferGeometry();
  const merged = [];
  for (const p of parts) { const q = p.index ? p.toNonIndexed() : p; q.deleteAttribute('uv'); q.deleteAttribute('normal'); merged.push(q); }
  let n = 0; for (const p of merged) n += p.getAttribute('position').count;
  const pos = new Float32Array(n * 3); let o = 0;
  for (const p of merged) { pos.set(p.getAttribute('position').array, o); o += p.getAttribute('position').array.length; p.dispose(); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

export function buildDistant(ctx, farFx) {
  const rng = rngFrom(77);
  const grp = new THREE.Group(); grp.name = 'distant';
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  // far → near: lighter and closer to the horizon colour the farther it is
  // far → near: cool blue-violet crests (the scene's cool counter-colour) whose feet sink into the blood-red horizon
  // haze; each nearer layer is darker, with crags and a burnt-forest skyline so no ridge reads as a flat shape.
  // C1 r5: distance loses contrast/chroma into cool smoke; reserve the hot red for fire/sky.
  const layers = [
    { z: -420, h0: 14, h1: 62, freq: 0.006, seed: 3, top: '#8b6a76', bottom: '#9a747a', dip: [155, 70, 0.85], crag: 5, trees: 0.25, treeH: [3, 7] },
    { z: -300, h0: 8, h1: 26, freq: 0.011, seed: 7, top: '#695967', bottom: '#85656e', dip: [120, 50, 0.7], crag: 3.5, trees: 0.45, treeH: [3, 7], rim: '#c0402a' },
    { z: -165, h0: 1, h1: 11, freq: 0.02, seed: 11, top: '#4d414f', bottom: '#655160', crag: 2, trees: 0.6, treeH: [2.5, 6], rim: '#8a2e2a' },
  ];
  for (const L of layers) { const m = new THREE.Mesh(ridge(L), mat); m.name = 'ridge'; m.renderOrder = -900; m.frustumCulled = false; grp.add(m); }
  // the keep on the middle ridge
  // on its own promontory between the near and middle ridges: large, low enough to clear the HUD, and right of
  // centre on the first screen so the landmark reads from the start and drifts toward centre by the boss.
  const kx = 57, kz = -212, ky = 1.5, S = 0.85;
  const W = (x, y, z) => [kx + x * S, ky + y * S, kz + z * S];
  const keepGrp = new THREE.Group(); keepGrp.position.set(kx, ky, kz); keepGrp.scale.setScalar(S); grp.add(keepGrp);
  // Pre-hazed stone sits ABOVE the near ridge value; distant fires lose their
  // white-hot window contrast along with the architecture.
  const keepMat = new THREE.MeshBasicMaterial({ color: '#a18a99', fog: false });
  const keep = new THREE.Mesh(keepGeometry(rng), keepMat);
  keep.name = 'keep'; keep.frustumCulled = false; keep.renderOrder = -890;
  keepGrp.add(keep);
  // glowing windows / breaches
  const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.72, 0.38, 0.21), fog: false, toneMapped: false });
  const win = [];
  const wq = (x, y, w = 0.8, h = 1.6) => { const g = new THREE.PlaneGeometry(w, h); g.translate(x, y, 5.1); win.push(g); };
  for (let i = 0; i < 5; i++) wq(-1 + i * 1.9 + rng.next() * 0.3, 14 + (i % 2) * 5, 0.8, 1.8);
  for (let i = 0; i < 4; i++) wq(-21 + (i % 2) * 1.6, 8 + i * 2.6, 0.7, 1.3);
  wq(21.5, 12, 0.9, 1.6); wq(-8, 19, 0.7, 1.4); wq(12, 9, 2.2, 2.6);
  for (let i = 0; i < 8; i++) wq(-18 + i * 5 + rng.next() * 2, 9.5 + rng.next() * 1.5, 0.6, 0.9);
  const wg = new THREE.BufferGeometry();
  { let n = 0; const list = win.map((g) => g.toNonIndexed()); for (const g of list) n += g.getAttribute('position').count; const pos = new Float32Array(n * 3); let o = 0; for (const g of list) { pos.set(g.getAttribute('position').array, o); o += g.getAttribute('position').array.length; } wg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); }
  const wm = new THREE.Mesh(wg, winMat); wm.frustumCulled = false; wm.renderOrder = -880; keepGrp.add(wm);
  // crown fires + smoke columns + horizon glows (far kit: un-fogged, pre-hazed colours)
  const fires = [[3, 27.5, -1], [-22, 20.5, 0], [22, 18.5, 0], [-8, 25, -9], [12, 15, 1.5]];
  for (const [x, y, z] of fires) {
    for (let i = 0; i < 3; i++) farFx.flame(W(x + (rng.next() - 0.5) * 3, y - 0.5, z + 5), { height: (4 + rng.next() * 4) * S, width: 3.5 * S, intensity: 0.95, soot: false });
    farFx.glow(W(x, y + 2, z + 8), { size: 26 * S, color: '#ff4a14', intensity: 0.25, flicker: 0.1 });
  }
  // perf-1650 r3: ~0.6× the puffs (slightly bigger, denser) — overlapping far puffs were the S1 cast overdraw p95
  farFx.smoke(W(3, 30, -2), { puffs: 18, rise: 95, size: [9, 46], life: 34, drift: 1.4, opacity: 0.78, warm: 0.5, dark: 0.55, base: 3 });
  farFx.smoke(W(-22, 22, 0), { puffs: 13, rise: 70, size: [7, 33], life: 30, drift: 1.6, opacity: 0.66, warm: 0.45, dark: 0.5, base: 2 });
  farFx.smoke(W(22, 20, 0), { puffs: 11, rise: 60, size: [6, 28], life: 28, drift: 1.5, opacity: 0.6, warm: 0.45, dark: 0.5, base: 2 });
  // other distant fires along the horizon (burning farmsteads)
  for (const [x, z] of [[-70, -250], [110, -240], [170, -300], [-150, -310]]) {
    farFx.glow([x, 6, z], { size: 30, color: '#ff5a1a', intensity: 0.4, flicker: 0.2 });
    farFx.smoke([x, 6, z], { puffs: 9, rise: 50, size: [5.5, 26], life: 26, drift: 1.4, opacity: 0.54, warm: 0.5, dark: 0.45, base: 2 });
  }
  ctx.group.add(grp);
  return grp;
}
