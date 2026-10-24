// Green food (roast meat): restores one life bar (16 HP), capped at the hero's 3 bars (DESIGN §7).
// bonus-camp r8: a glossy roast haunch on the bone — caramel-glazed lathe with scored crosshatch and char, a twine wrap,
// a trimmed shank ring, a cream bone with a double knuckle — lying tilted on its belly, with a slow steam wisp and a soft
// warm halo. Same pop / flip / squash / hover rig as the pot (_kit.js).
import * as THREE from 'three';
import { BWF, CELL_ROUGH, TAU, clamp, lerp, smooth, hash2, waveCols, waveRow, waveFast, makeCanvas, toTexture, spacedProfile, bodyPart, trimPart, mergeParts, makeRig, createAnimator } from './_kit.js';

const CTRL = [[0, 0], [0.05, 0.005], [0.095, 0.03], [0.125, 0.075], [0.137, 0.13], [0.13, 0.19], [0.11, 0.25], [0.088, 0.305], [0.066, 0.355], [0.05, 0.4], [0.042, 0.435], [0.04, 0.455], [0, 0.457]];
const SCALE = 1.0;
const LIE = 0.46; // the bone end is raised this many radians off the ground

let cache = null;

function paintAtlas() {
  const W = 256, H = 256, BW = Math.round(W * BWF);
  const cA = makeCanvas(W, H), cE = makeCanvas(W, H), cR = makeCanvas(W, H);
  if (!cA) return null;
  const ctxo = { willReadFrequently: true };
  const gA = cA.getContext('2d', ctxo), gE = cE.getContext('2d', ctxo), gR = cR.getContext('2d', ctxo);
  const iA = gA.createImageData(W, H), iE = gE.createImageData(W, H), iR = gR.createImageData(W, H);
  const dA = iA.data, dE = iE.data, dR = iR.data;
  const WC = waveCols(W, BW);
  for (let py = 0; py < H; py++) {
    const v = 1 - (py + 0.5) / H; // 0 = fat end … 1 = shank
    const WR1 = waveRow(v * 0.6, 3), WR2 = waveRow(v * 0.6 + 4, 9);
    for (let px = 0; px < W; px++) {
      const o = (py * W + px) * 4;
      if (px >= BW + 4) {
        const k = clamp(Math.floor(v * 4), 0, 3);
        dA[o] = dA[o + 1] = dA[o + 2] = 255; dA[o + 3] = 255;
        dR[o] = 0; dR[o + 1] = Math.round(CELL_ROUGH[k] * 255); dR[o + 2] = 0; dR[o + 3] = 255;
        if (k === 1) { dE[o] = 64; dE[o + 1] = 52; dE[o + 2] = 34; } else { dE[o] = dE[o + 1] = dE[o + 2] = 0; } // bone/ivory: a warm floor so cool stage ambient can't turn it blue
        dE[o + 3] = 255;
        continue;
      }
      const u = px / BW;
      const n1 = waveFast(WC, WR1, px), n2 = waveFast(WC, WR2, px), sp = hash2(px, py, 5);
      // caramel roast: charred at the fat end, amber in the belly, paler toward the shank
      let r = lerp(160, 214, smooth(0.0, 0.5, v)), g = lerp(72, 122, smooth(0.0, 0.5, v)), b = lerp(28, 46, smooth(0.0, 0.5, v));
      const cook = 0.5 + 0.5 * n1;
      r *= 0.78 + 0.34 * cook; g *= 0.74 + 0.36 * cook; b *= 0.7 + 0.4 * cook;
      let rough = 0.3, glow = 1;
      if (n2 > 0.5) { const k = smooth(0.5, 0.8, n2); r *= 1 - 0.38 * k; g *= 1 - 0.45 * k; b *= 1 - 0.4 * k; rough = lerp(rough, 0.72, k); glow = 0.2; }   // char
      else if (n2 < -0.3) { const k = smooth(-0.3, -0.65, n2); r = lerp(r, 248, k * 0.6); g = lerp(g, 168, k * 0.6); b = lerp(b, 76, k * 0.6); rough = lerp(rough, 0.14, k); } // rendered-fat sheen
      // scored diamonds across the belly: pale cuts where the crust splits (soft-edged, so no dotted aliasing)
      if (v > 0.14 && v < 0.7) {
        const a = ((u * 8 + v * 4) % 1 + 1) % 1, c = ((u * 8 - v * 4) % 1 + 1) % 1;
        const d = Math.min(Math.min(a, 1 - a), Math.min(c, 1 - c));
        const cut = 1 - smooth(0.02, 0.085, d);
        if (cut > 0) { r = lerp(r, 236, cut * 0.42); g = lerp(g, 178, cut * 0.42); b = lerp(b, 96, cut * 0.42); rough = lerp(rough, 0.5, cut); glow = lerp(glow, 0.6, cut); }
      }
      if (sp > 0.985) { r += 50; g += 32; b += 14; }
      dA[o] = r; dA[o + 1] = g; dA[o + 2] = b; dA[o + 3] = 255;
      dE[o] = 60 * glow; dE[o + 1] = 20 * glow; dE[o + 2] = 2; dE[o + 3] = 255; // faint ember warmth so a night camp never crushes it to black
      dR[o] = 0; dR[o + 1] = Math.round(clamp(rough, 0, 1) * 255); dR[o + 2] = 0; dR[o + 3] = 255;
    }
  }
  gA.putImageData(iA, 0, 0); gE.putImageData(iE, 0, 0); gR.putImageData(iR, 0, 0);
  return { map: toTexture(cA, true), emissiveMap: toTexture(cE, true), roughnessMap: toTexture(cR, false) };
}

function assets() {
  if (cache) return cache;
  const prof = spacedProfile(CTRL, 30);
  const parts = [bodyPart(new THREE.LatheGeometry(prof, 18))];
  const ring = (R, tube, y, col, cell) => { const g = new THREE.TorusGeometry(R, tube, 5, 14); g.rotateX(Math.PI / 2); g.translate(0, y, 0); return trimPart(g, col, cell); };
  parts.push(ring(0.0715, 0.0058, 0.34, '#d2b078', 2));                  // twine wrap
  parts.push(ring(0.0755, 0.0052, 0.322, '#c29c62', 2));
  parts.push(ring(0.0415, 0.0085, 0.452, '#f0d9a4', 1));                 // trimmed shank ring
  const bone = new THREE.CylinderGeometry(0.0165, 0.0195, 0.17, 8); bone.translate(0, 0.53, 0);
  parts.push(trimPart(bone, '#f1e6cc', 1));
  for (const s of [-1, 1]) { const k = new THREE.SphereGeometry(0.031, 9, 7); k.translate(0, 0.625, s * 0.0205); parts.push(trimPart(k, '#f5ecd6', 1)); }
  let geo = mergeParts(parts);
  // lie down: the fat end on the ground, the bone raised, centred over the pivot
  geo.rotateZ(-(Math.PI / 2 - LIE)); geo.scale(SCALE, SCALE, SCALE);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(-(bb.min.x + bb.max.x) * 0.5 + 0.02, -bb.min.y, 0);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const tex = paintAtlas();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0,
    map: tex && tex.map, emissive: 0xffffff, emissiveMap: tex && tex.emissiveMap, emissiveIntensity: 1.0, roughnessMap: tex && tex.roughnessMap,
  });
  if (!tex) { mat.emissive.set(0x2a0c00); mat.emissiveIntensity = 0.5; }
  mat.userData.shared = true;
  cache = { geo, mat, cy: geo.boundingBox.max.y * 0.5, top: geo.boundingBox.max.y };
  return cache;
}

function build() {
  const { geo, mat, cy } = assets();
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'roast_haunch';
  return makeRig(mesh, { cy, halo: { color: '#b4e070', opacity: 0.26, size: 0.8, dy: 0.02 } });
}

const animate = createAnimator({
  hover: 0.03, bob: 0.012, bobRate: 2.4, idleSpin: 0.85, airSpin: 6, flipMin: 0.6, sway: 0.24, squash: 0.5, shadowR: 0.3,
  fxEvery: 15, fxFree: true,
  fx(game, pk, p) { if (game.vfx) game.vfx.spawn('loot_fx', { mode: 'steam', kind: 'food', pos: { x: p.x, y: p.y + (cache ? cache.top * 0.9 : 0.3) * p.scale, z: p.z }, lite: !!pk.campLoot }); },
  pop(game, pk, pos) { game.vfx.spawn('loot_fx', { mode: 'pop', kind: 'food', pos }); },
  land(game, pk, speed) { const v = pk.view.position; game.vfx.spawn('loot_fx', { mode: 'land', kind: 'food', pos: { x: v.x, y: v.y, z: v.z }, power: speed }); },
});

export default {
  id: 'food',
  glint: '#8fff9a',
  score: 50,
  ownFx: true,
  build,
  animate,
  onCollect(game, hero, pickup) {
    if (hero.heal) hero.heal(16);
    if (game.session) game.session.addScore(hero.playerIndex, 50, 'food');
    if (game.vfx && pickup) {
      const v = pickup.view.position;
      game.vfx.spawn('loot_fx', { mode: 'collect', kind: 'food', pos: { x: v.x, y: v.y + 0.18, z: v.z }, hero });
    }
    return true;
  },
};
