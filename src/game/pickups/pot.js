// Magic pot: +1 pot (tiers unlock at the hero's thresholds, DESIGN §2).
// bonus-camp r8: a hand-thrown clay flask, cobalt-glazed over a raw clay foot (wavy glaze line with drips), a gold-ringed
// Algiz rune painted on two sides (the only strongly glowing thing on it), gold bands, hemp cord with a glowing gem
// charm, a cork and a crimson wax seal. Lit like an object; a soft halo + a slow twinkle say "grab me". Pop-arc, flip,
// squash and settle come from _kit.js (def.animate).
import * as THREE from 'three';
import { BWF, STRIP_U, CELL_ROUGH, TAU, clamp, lerp, smooth, hash2, waveCols, waveRow, waveFast, makeCanvas, toTexture, spacedProfile, profileLength, profileY, profileR, profileVAtY,
  bodyPart, trimPart, mergeParts, makeRig, createAnimator } from './_kit.js';

const H_POT = 0.468;        // total height (cork + wax included), metres
const CY = 0.205;           // body centre (flip pivot)
const CTRL = [[0, 0], [0.056, 0], [0.071, 0.006], [0.074, 0.02], [0.088, 0.036], [0.116, 0.07], [0.134, 0.115], [0.138, 0.16], [0.126, 0.205], [0.098, 0.245],
  [0.066, 0.278], [0.048, 0.305], [0.042, 0.33], [0.045, 0.352], [0.058, 0.372], [0.064, 0.386], [0.058, 0.394], [0.04, 0.397], [0, 0.397]];
const GLAZE_TOP = 0.389;    // the rim is left raw

let cache = null; // { geo, mat }

function paintAtlas(prof) {
  const W = 512, H = 512, BW = Math.round(W * BWF);
  const cA = makeCanvas(W, H), cE = makeCanvas(W, H), cR = makeCanvas(W, H);
  if (!cA) return null;
  const ctxo = { willReadFrequently: true };
  const gA = cA.getContext('2d', ctxo), gE = cE.getContext('2d', ctxo), gR = cR.getContext('2d', ctxo);
  const iA = gA.createImageData(W, H), iE = gE.createImageData(W, H), iR = gR.createImageData(W, H);
  const dA = iA.data, dE = iE.data, dR = iR.data;
  // glaze line (metres): wavy, with a few drips that run down the foot
  const drips = [0.11, 0.37, 0.62, 0.88];
  const glazeLine = (u) => {
    let g = 0.056 + 0.011 * Math.sin(u * TAU * 3 + 0.7) + 0.006 * Math.sin(u * TAU * 7 + 2);
    for (const d of drips) { const x = (u - d) / 0.014; g -= 0.024 * Math.exp(-x * x); }
    return g;
  };
  const WC = waveCols(W, BW), GL = new Float32Array(W);
  for (let x = 0; x < W; x++) GL[x] = glazeLine(x / BW);
  for (let py = 0; py < H; py++) {
    const v = 1 - (py + 0.5) / H, y = profileY(prof, v), WR = waveRow(y);
    for (let px = 0; px < W; px++) {
      const o = (py * W + px) * 4;
      if (px >= BW + 8) { // ---- trim strip cells
        const k = clamp(Math.floor(v * 4), 0, 3);
        dA[o] = dA[o + 1] = dA[o + 2] = 255; dA[o + 3] = 255;
        dR[o] = 0; dR[o + 1] = Math.round(CELL_ROUGH[k] * 255); dR[o + 2] = 0; dR[o + 3] = 255;
        if (k === 3) { dE[o] = 120; dE[o + 1] = 215; dE[o + 2] = 255; } else { dE[o] = dE[o + 1] = dE[o + 2] = 0; }
        dE[o + 3] = 255;
        continue;
      }
      const n1 = waveFast(WC, WR, px), sp = hash2(px, py);
      const gl = GL[px];
      let r, g, b, er = 0, eg = 0, eb = 0, rough;
      if (y < gl || y > GLAZE_TOP) { // raw clay
        r = 178 + n1 * 12; g = 110 + n1 * 9; b = 72 + n1 * 7;
        if (sp > 0.965) { r *= 0.62; g *= 0.62; b *= 0.62; }
        if (y < gl && y > gl - 0.006) { r *= 0.85; g *= 0.85; b *= 0.85; } // fired line at the glaze edge
        rough = 0.88;
      } else { // cobalt glaze
        const tt = clamp((y - 0.05) / 0.34, 0, 1);
        const dy = (y - gl) / 0.011, pool = dy > 4 ? 1 : 1 - 0.3 * Math.exp(-dy * dy); // glaze pools thick at the run-off line
        r = (lerp(28, 62, tt) + n1 * 6) * pool; g = (lerp(66, 128, tt) + n1 * 9) * pool; b = (lerp(168, 250, tt) + n1 * 10) * pool;
        if (sp > 0.988) { r += 60; g += 70; b += 40; } // glaze specks
        // faint inner glow: strongest round the shoulder and neck (the potion sloshing inside), none at the foot
        const e = smooth(0.09, 0.36, y) * 0.55 + 0.13;
        er = 14 * e; eg = 70 * e; eb = 210 * e;
        rough = 0.27 + 0.05 * n1;
      }
      dA[o] = r; dA[o + 1] = g; dA[o + 2] = b; dA[o + 3] = 255;
      dE[o] = er; dE[o + 1] = eg; dE[o + 2] = eb; dE[o + 3] = 255;
      dR[o] = 0; dR[o + 1] = Math.round(clamp(rough, 0, 1) * 255); dR[o + 2] = 0; dR[o + 3] = 255;
    }
  }
  gA.putImageData(iA, 0, 0); gE.putImageData(iE, 0, 0); gR.putImageData(iR, 0, 0);

  // ---- painted decoration: two rune medallions (opposite sides) + a shoulder row of gold beads
  const arc = profileLength(prof), pxY = H / arc;
  const rowOfY = (y) => (1 - profileVAtY(prof, y)) * H;
  const mY = 0.153, mV = profileVAtY(prof, mY), rB = profileR(prof, mV);
  const pxX = BW / (TAU * rB), Sy = pxY / pxX, R = 0.072 * pxX;
  const rune = (g, col, glow) => {
    g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = col; g.lineWidth = R * 0.2;
    if (glow) { g.shadowColor = glow; g.shadowBlur = R * 0.45; }
    g.beginPath(); g.moveTo(0, R * 0.56); g.lineTo(0, -R * 0.6); g.moveTo(0, -R * 0.06); g.lineTo(-R * 0.44, -R * 0.5); g.moveTo(0, -R * 0.06); g.lineTo(R * 0.44, -R * 0.5); g.stroke();
    g.shadowBlur = 0; g.fillStyle = col; g.beginPath(); g.arc(0, R * 0.56, R * 0.1, 0, TAU); g.fill(); // foot dot
  };
  const drawMedal = (g, cx, cy, kind) => {
    g.save(); g.translate(cx, cy); g.scale(1, Sy);
    if (kind === 'a') {
      const d = g.createRadialGradient(0, -R * 0.2, 0, 0, 0, R); d.addColorStop(0, '#1a3aa8'); d.addColorStop(1, '#0a1a60');
      g.fillStyle = d; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
      g.lineWidth = R * 0.17; g.strokeStyle = '#e6b44c'; g.beginPath(); g.arc(0, 0, R * 1.02, 0, TAU); g.stroke();
      g.lineWidth = R * 0.05; g.strokeStyle = '#fbe3a0'; g.beginPath(); g.arc(0, 0, R * 1.1, 0, TAU); g.stroke();
      g.lineWidth = R * 0.04; g.strokeStyle = '#6a4712'; g.beginPath(); g.arc(0, 0, R * 0.93, 0, TAU); g.stroke();
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; g.fillStyle = '#e9c060'; g.beginPath(); g.arc(Math.cos(a) * R * 1.32, Math.sin(a) * R * 1.32, R * 0.06, 0, TAU); g.fill(); }
      rune(g, '#d6f6ff', '#5cc8ff');
    } else if (kind === 'e') {
      g.fillStyle = 'rgb(20,62,190)'; g.globalAlpha = 0.5; g.beginPath(); g.arc(0, 0, R * 0.95, 0, TAU); g.fill(); g.globalAlpha = 1;
      g.lineWidth = R * 0.17; g.strokeStyle = 'rgb(58,40,8)'; g.beginPath(); g.arc(0, 0, R * 1.02, 0, TAU); g.stroke();
      rune(g, 'rgb(150,232,255)', 'rgb(70,170,255)');
    } else { // roughness: the painted disc is a touch glossier
      g.fillStyle = 'rgb(0,52,0)'; g.beginPath(); g.arc(0, 0, R * 1.1, 0, TAU); g.fill();
    }
    g.restore();
  };
  for (const uu of [0.25, 0.75]) {
    const cx = uu * BW, cy = rowOfY(mY);
    drawMedal(gA, cx, cy, 'a'); drawMedal(gE, cx, cy, 'e'); drawMedal(gR, cx, cy, 'r');
  }
  const bandY = 0.236, br = rowOfY(bandY);
  for (let i = 0; i < 14; i++) {
    const cx = (i + 0.5) / 14 * BW;
    gA.fillStyle = '#e8c064'; gA.beginPath(); gA.arc(cx, br, 5, 0, TAU); gA.fill();
    gE.fillStyle = 'rgb(40,28,6)'; gE.beginPath(); gE.arc(cx, br, 4, 0, TAU); gE.fill();
  }
  return { map: toTexture(cA, true), emissiveMap: toTexture(cE, true), roughnessMap: toTexture(cR, false) };
}

function torus(R, tube, y, tubular = 18, radial = 5) {
  const g = new THREE.TorusGeometry(R, tube, radial, tubular); g.rotateX(Math.PI / 2); g.translate(0, y, 0); return g;
}

function assets() {
  if (cache) return cache;
  const prof = spacedProfile(CTRL, 36);
  const body = new THREE.LatheGeometry(prof, 20);
  const parts = [bodyPart(body)];
  // gold bands framing the rune belt
  parts.push(trimPart(torus(0.1285, 0.0058, 0.205, 20), '#e2ac3e', 0), trimPart(torus(0.1195, 0.005, 0.075, 20), '#c9922e', 0));
  // hemp cord round the neck + glowing charm gem
  parts.push(trimPart(torus(0.0455, 0.0056, 0.336, 12), '#d8b878', 2), trimPart(torus(0.0485, 0.0056, 0.352, 12), '#c9a86a', 2));
  const strand = new THREE.CylinderGeometry(0.0026, 0.0026, 0.03, 4); strand.rotateZ(-0.14); strand.translate(0.0505, 0.3255, 0);
  parts.push(trimPart(strand, '#b99a5c', 2));
  const gem = new THREE.IcosahedronGeometry(0.0165, 0); gem.scale(0.85, 1.2, 0.85); gem.translate(0.0545, 0.302, 0);
  parts.push(trimPart(gem, '#ffffff', 3));
  // cork + wax seal (with two drips)
  const cork = new THREE.CylinderGeometry(0.037, 0.031, 0.03, 10); cork.translate(0, 0.409, 0);
  parts.push(trimPart(cork, '#b98a55', 2));
  const wax = new THREE.LatheGeometry(spacedProfile([[0.05, 0.413], [0.055, 0.42], [0.051, 0.432], [0.043, 0.445], [0.03, 0.457], [0.014, 0.465], [0, 0.469]], 9), 12);
  parts.push(trimPart(wax, '#b3152c', 0));
  for (const [a, len] of [[0.9, 0.02], [3.6, 0.014]]) { // wax runs over the lip
    const dr = new THREE.SphereGeometry(0.0072, 6, 5); dr.scale(1, len / 0.0072 * 0.5, 1); dr.translate(Math.cos(a) * 0.0655, 0.394 - len * 0.2, Math.sin(a) * 0.0655);
    parts.push(trimPart(dr, '#a01226', 0));
  }
  const geo = mergeParts(parts);
  const tex = paintAtlas(prof);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0,
    map: tex && tex.map, emissive: 0xffffff, emissiveMap: tex && tex.emissiveMap, emissiveIntensity: 1.7, roughnessMap: tex && tex.roughnessMap,
  });
  if (!tex) { mat.emissive.set(0x0a2470); mat.emissiveIntensity = 0.5; } // no DOM: plain vertex-coloured fallback
  mat.userData.shared = true;
  cache = { geo, mat };
  return cache;
}

function build() {
  const { geo, mat } = assets();
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'magic_pot';
  return makeRig(mesh, { cy: CY, halo: { color: '#4f9bff', opacity: 0.4, size: 0.66, dy: 0.02 } });
}

const animate = createAnimator({
  stageScale: 1.15, hover: 0.07, bob: 0.02, bobRate: 3.1, idleSpin: 1.15, airSpin: 9, flipMin: 0.55, sway: 0.34, squash: 0.85, shadowR: 0.2,
  fxEvery: 78,
  fx(game, pk, p) { if (game.vfx) game.vfx.spawn('loot_fx', { mode: 'glint', kind: 'pot', pos: p, s: p.scale }); },
  pop(game, pk, pos) { game.vfx.spawn('loot_fx', { mode: 'pop', kind: 'pot', pos }); },
  land(game, pk, speed) { const v = pk.view.position; game.vfx.spawn('loot_fx', { mode: 'land', kind: 'pot', pos: { x: v.x, y: v.y, z: v.z }, power: speed }); },
});

export default {
  id: 'pot',
  glint: '#8fc8ff',
  score: 100,
  ownFx: true,      // (Pickup.js) this pickup draws its own ambient glint + collect flash (loot_fx) instead of the generic sparkle
  height: H_POT,
  build,
  animate,
  onCollect(game, hero, pickup) {
    if (hero.addPots) hero.addPots(1);
    if (game.session) game.session.addScore(hero.playerIndex, 100, 'pot');
    if (game.vfx && pickup) {
      const v = pickup.view.position;
      game.vfx.spawn('loot_fx', { mode: 'collect', kind: 'pot', pos: { x: v.x, y: v.y + 0.2 + (pickup.model && pickup.model.userData.rig ? pickup.model.userData.rig.lift.position.y : 0), z: v.z }, hero });
    }
    return true;
  },
};
