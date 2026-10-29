// Stage 3 — feather kit: a painted feather atlas (canvas), a merged-feather geometry builder and the feather material
// (vertex-shader wingbeat bend, wind flutter, footstep ruffle). Every layer of the eagle (back, sides, wings, tail) is ONE
// merged BufferGeometry of real feather cards (curved, cupped, tip-lifted, overlapping shingle-wise), so the plumage
// reads as a coherent umber mantle with selected satin ridges, directional vanes and quiet overlapping edges.
//
//   featherAtlas() → CanvasTexture (4×2 slots: contour, covert, greater covert, secondary, primary, tail, gold hackle, edge)
//   buildFeathers(list, { nv }) → BufferGeometry   list item: { p, d, n, len, wid, type, tint, flut, lift, cup, arch, twist,
//                                                             taper, curl, ao }   (taper/curl/ao: r32 fix, optional)
//   featherMaterial({ wing, feet, key }) → MeshStandardMaterial with userData.U = { uWing, uWing2, uFeet, uS3 }
//
// r32 fix (board r3 consensus: "rigid repeated shingles / plank rows, no shaft, no overlap occlusion"):
//   atlas    plumage slots 0-6 repainted: pointed-oval / spatulate tips with unequal vanes, a dark (not pale) broken edge,
//            finer slanted barbs, a deeper under-tip gradient. Slot 7 (the ring-out warning lip) keeps its exact spec.
//   geometry per-card `taper` (geometric tip narrowing), `curl` (cubic tip droop/rise) and `ao` = { v0 } (the emergence
//            line under the next row, packed into the low bits of the per-card random channel aF.z; the colour attribute
//            stays the plain tint). Defaults reproduce the release cards exactly; lip cards keep raw aF.z.
//   material fragment-only: a narrow contact-shadow band where each card emerges from under the next row (darkening
//            only, never on the lip slot), analytic rachis ridge + slanted barb grooves (mip-faded) perturbing the shading
//            normal through a derivative cotangent frame, one vane per feather darkened (≤ 1), glossier rachis.
//            The VERTEX shader (wingbeat / flutter / foot ruffle) is byte-identical to the release.
import * as THREE from 'three';
import { patchStandard } from '../../../render/shaderlib.js';

export const FT = { contour: 0, covert: 1, greater: 2, secondary: 3, primary: 4, tail: 5, gold: 6, edge: 7 };

// ---------------------------------------------------------------- atlas
// r32: palette values are pigments, not rendered L*. Stage lighting supplies the lit spine.
// The only pale slot is the actual ring-out warning lip; no body-lane substitute.
const CONFIG = {
  seed: 12345, slotWidth: 256, slotHeight: 512,
  fringeWidth: 2.0, fringeAlpha: 0.3, lipFringeWidth: 4.0, lipFringeAlpha: 0.62,
  // r32 fix: plumage edges are a thin DARK break (contour/covert/greater/hackle) or a faint translucent vane edge
  // (flight/tail feathers, alpha 0.16 of the existing fringe pigment); never a pale outline around every card.
  edgeWidth: 1.6, edgeDarkAlpha: 0.18, edgeLightAlpha: 0.14,
  barbCount: 150, fixBarbCount: 210, splitCount: 4, taper: 0.08, asymmetry: 0.07, sweep: 0.025,
  roughRoot: 0.88, roughTip: 0.79, roughVariation: 0.02,
  rim: '#c8ab82', rimI: 0.13, sheen: 0.08, envMapIntensity: 0.45,
  // r32 fix: fragment relief (slopes, in card-width units) and darkening-only vane split
  relief: { shaft: 0.16, shaftWidth: 0.075, barb: 0.05, barbFreq: 22, barbSlant: 0.6, cup: 0.06, groove: 0.35 },
  vaneDark: 0.035, shaftGloss: 0.04,
  // contact band around the emergence line v0 (fragment, darkening only); the contour slot (spine lane / back) keeps a
  // lighter band so the walkable lane does not lose value, the flank/scapular/wing slots a deeper one
  occlusion: { darkContour: 0.8, dark: 0.64, below: 0.1, above: 0.1 },
  specs: [
    // base (buried), mid, tip, narrow fringe, shaft, bars, silhouette, width   (pigments unchanged from the release)
    { base: '#20170f', mid: '#49321f', tip: '#66482e', fringe: '#795c40', shaft: '#302419', bars: 0, shape: 'round', w: 0.46, shoulder: 0.48, tipPow: 1.9, tipExp: 0.7, stops: [0.25, 0.47, 0.84] },
    { base: '#1e160f', mid: '#493420', tip: '#694b31', fringe: '#7c5f41', shaft: '#32271b', bars: 0, shape: 'round', w: 0.44, shoulder: 0.46, tipPow: 1.85, tipExp: 0.7, stops: [0.2, 0.45, 0.87] },
    { base: '#1b130d', mid: '#3e2c1c', tip: '#59402b', fringe: '#6e533b', shaft: '#2c2016', bars: 0, shape: 'round', w: 0.4, shoulder: 0.5, tipPow: 2.0, tipExp: 0.65 },
    { base: '#211a14', mid: '#392d23', tip: '#2a2018', fringe: '#514031', shaft: '#211a13', bars: 5, barC: '#51463a', shape: 'long', w: 0.36, shoulder: 0.78, tipPow: 2.2, tipExp: 0.55 },
    { base: '#1c1611', mid: '#282019', tip: '#17120e', fringe: '#3b3026', shaft: '#19130f', bars: 0, shape: 'primary', w: 0.3 },
    { base: '#281f17', mid: '#443629', tip: '#241a12', fringe: '#65523e', shaft: '#281e15', bars: 4, barC: '#695b49', shape: 'tail', w: 0.4, shoulder: 0.82, tipPow: 2.4, tipExp: 0.5 },
    { base: '#372511', mid: '#72502c', tip: '#926b3c', fringe: '#a37d4a', shaft: '#49351f', bars: 0, shape: 'lance', w: 0.4 },
    { base: '#4a3420', mid: '#9a7248', tip: '#e0c08c', fringe: '#fff0d0', shaft: '#6a4a2a', bars: 0, shape: 'round', w: 0.46 },
  ],
};
const SLOT_W = CONFIG.slotWidth, SLOT_H = CONFIG.slotHeight, SPECS = CONFIG.specs;

// release profile (kept for the warning lip, slot 7)
function halfW(shape, t, W) {
  switch (shape) {
    case 'round': return t < 0.36 ? W * (0.68 + 0.32 * t / 0.36) : W * Math.pow(Math.max(0, 1 - ((t - 0.36) / 0.64) ** 1.6), 0.65);
    case 'lance': return W * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.04)), 0.85) * (1 - 0.25 * t);
    case 'long': return t < 0.85 ? W * (0.75 + 0.25 * Math.min(1, t / 0.3)) : W * Math.sqrt(Math.max(0, 1 - ((t - 0.85) / 0.15) ** 2));
    case 'tail': return t < 0.86 ? W * (0.8 + 0.2 * Math.min(1, t / 0.25)) : W * Math.sqrt(Math.max(0, 1 - ((t - 0.86) / 0.14) ** 2));
    default: return W;
  }
}
// r32 fix profile: a shoulder, then a pointed-oval / spatulate tip (tipPow/tipExp per slot), not a blunt shovel
function halfWFix(spec, t, W) {
  const sh = spec.shoulder ?? 0.3, pw = spec.tipPow ?? 1.5, ex = spec.tipExp ?? 0.8;
  const tip = () => W * Math.pow(Math.max(0, 1 - Math.pow((t - sh) / (1 - sh), pw)), ex);
  switch (spec.shape) {
    case 'round': return t < sh ? W * (0.66 + 0.34 * t / sh) : tip();
    case 'lance': return W * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.06)), 0.95) * (1 - 0.32 * t);
    case 'long': return t < sh ? W * (0.72 + 0.28 * Math.min(1, t / 0.25)) : tip();
    case 'tail': return t < sh ? W * (0.78 + 0.22 * Math.min(1, t / 0.25)) : tip();
    default: return W;
  }
}

function outline(spec, rnd, cx, W, fix) {
  const bend = (rnd() - 0.5) * W * (fix ? 0.22 : 0.16);
  const C = (t) => cx + bend * t * t;
  const N = 48, left = [], right = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let hl, hr;
    if (spec.shape === 'primary') {
      // asymmetric flight feather: narrow outer vane, broad inner vane with an emargination (the eagle's "fingers")
      const tip = t > 0.9 ? Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2)) : 1;
      hl = W * 0.34 * (0.7 + 0.3 * Math.min(1, t / 0.2)) * tip;
      const em = fix ? 1 - 0.55 * THREE.MathUtils.smoothstep(t, 0.48, 0.64) : (t < 0.5 ? 0.9 + 0.1 * Math.min(1, t / 0.2) : 1 - 0.55 * Math.min(1, (t - 0.5) / 0.12));
      hr = W * (fix ? (0.9 + 0.1 * Math.min(1, t / 0.2)) * em : em) * tip * (t > 0.62 ? 0.8 : 1);
    } else if (fix) { const hw = halfWFix(spec, t, W); hl = hw * (1 - 0.12 * t); hr = hw * (1 + 0.06 * t); }
    else { const hw = halfW(spec.shape, t, W); hl = hw * (1 - 0.045 * t); hr = hw * (1 + 0.025 * t); }
    left.push([C(t) - hl, 0]); right.push([C(t) + hr, 0]);
  }
  return { C, N, left, right };
}

// release painter, used ONLY for the ring-out warning lip (slot 7): same spec, fringe, shape and strokes as the release
function drawFeatherLip(g, x0, y0, spec, rnd) {
  const W = SLOT_W * spec.w, cx = x0 + SLOT_W / 2, H = SLOT_H * 0.97, yb = y0 + SLOT_H - 4;
  const Y = (t) => yb - t * H;
  const { C, N, left, right } = outline(spec, rnd, cx, W, false);
  for (let i = 0; i <= N; i++) { left[i][1] = Y(i / N); right[i][1] = Y(i / N); }
  g.save();
  g.beginPath();
  g.moveTo(left[0][0], left[0][1]);
  for (const p of left) g.lineTo(p[0], p[1]);
  for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
  g.closePath();
  g.clip();
  const gr = g.createLinearGradient(0, yb, 0, yb - H);
  gr.addColorStop(0, spec.base); gr.addColorStop(0.45, spec.mid); gr.addColorStop(0.9, spec.tip); gr.addColorStop(1, spec.tip);
  g.fillStyle = gr; g.fillRect(x0, y0, SLOT_W, SLOT_H);
  for (let i = 0; i < CONFIG.barbCount; i++) {
    const t = rnd() * 0.97;
    const side = rnd() < 0.5 ? -1 : 1;
    const len = W * (0.9 + 0.3 * rnd());
    const light = rnd() < 0.5;
    // Tiny darkening of the lip barbs removes sub-byte canvas raster variation; fringe stays approved.
    g.strokeStyle = light ? 'rgba(171,142,104,0.10)' : 'rgba(10,8,6,0.16)';
    g.lineWidth = 1 + rnd() * 1.5;
    g.beginPath(); g.moveTo(C(t), Y(t)); g.quadraticCurveTo(C(t) + side * len * 0.5, Y(t + 0.025), C(t) + side * len, Y(t + 0.07 + 0.03 * rnd())); g.stroke();
  }
  g.strokeStyle = spec.fringe;
  g.lineWidth = CONFIG.lipFringeWidth;
  g.globalAlpha = CONFIG.lipFringeAlpha;
  g.beginPath();
  let started = false;
  for (let i = 0; i <= N; i++) { const t = i / N; if (t < 0.55) continue; const p = left[i]; if (!started) { g.moveTo(p[0], p[1]); started = true; } else g.lineTo(p[0], p[1]); }
  for (let i = N; i >= 0; i--) { const t = i / N; if (t < 0.55) continue; const p = right[i]; g.lineTo(p[0], p[1]); }
  g.stroke();
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < CONFIG.splitCount; i++) {
    const t = 0.35 + rnd() * 0.55, side = rnd() < 0.5 ? -1 : 1;
    const hw = side < 0 ? C(t) - left[Math.round(t * N)][0] : right[Math.round(t * N)][0] - C(t);
    g.lineWidth = 1.5 + rnd() * 1.5;
    g.beginPath(); g.moveTo(C(t) + side * hw * 1.05, Y(t + 0.025)); g.lineTo(C(t) + side * hw * (0.78 + 0.1 * rnd()), Y(t)); g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  const sh = g.createLinearGradient(0, yb, 0, yb - H * 0.5);
  sh.addColorStop(0, 'rgba(0,0,0,0.4)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh; g.fillRect(x0, yb - H * 0.5, SLOT_W, H * 0.5);
  g.strokeStyle = spec.shaft; g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    g.lineWidth = 3.0 - i * 0.8;
    g.beginPath(); g.moveTo(C(0), yb); g.quadraticCurveTo(cx, Y(0.5), C(0.95 - i * 0.1), Y(0.95 - i * 0.1)); g.stroke();
  }
  g.restore();
}

// r32 fix painter (plumage slots 0-6). Same pigments; what changes is FORM: pointed/spatulate unequal vanes, a deeper
// under-tip gradient (the zone that emerges from under the next row), a dark broken edge, slanted barbs following the
// vane, a dark groove either side of the rachis and a narrower rachis stroke. Luminance can only go down (no new
// colours lighter than the slot's tip pigment; the pale fringe is gone).
function drawFeatherFix(g, x0, y0, spec, rnd, slot) {
  const W = SLOT_W * spec.w, cx = x0 + SLOT_W / 2, H = SLOT_H * 0.97, yb = y0 + SLOT_H - 4;
  const Y = (t) => yb - t * H;
  const { C, N, left, right } = outline(spec, rnd, cx, W, true);
  for (let i = 0; i <= N; i++) { left[i][1] = Y(i / N); right[i][1] = Y(i / N); }
  const flight = slot === FT.secondary || slot === FT.primary || slot === FT.tail;
  g.save();
  g.beginPath();
  g.moveTo(left[0][0], left[0][1]);
  for (const p of left) g.lineTo(p[0], p[1]);
  for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
  g.closePath();
  g.clip();
  // base → base → mid → tip (stop positions per slot; the lane's contour slot shows more of its card after the double
  // row step, so its tip pigment starts earlier while its buried base region grows: slot mean stays below the release)
  const st = spec.stops || [0.18, 0.45, 0.88];
  const gr = g.createLinearGradient(0, yb, 0, yb - H);
  gr.addColorStop(0, spec.base); gr.addColorStop(st[0], spec.base); gr.addColorStop(st[1], spec.mid); gr.addColorStop(st[2], spec.tip); gr.addColorStop(1, spec.tip);
  g.fillStyle = gr; g.fillRect(x0, y0, SLOT_W, SLOT_H);
  // one vane a touch darker (the barbs on the shaded side of the rachis), a slight outer-vane cool
  g.fillStyle = 'rgba(8,6,4,0.07)';
  g.beginPath(); g.moveTo(C(0), Y(0)); for (let i = 0; i <= N; i++) g.lineTo(C(i / N), Y(i / N)); for (let i = N; i >= 0; i--) g.lineTo(left[i][0], left[i][1]); g.closePath(); g.fill();
  // bars (chevrons following the barb angle)
  if (spec.bars) {
    g.strokeStyle = spec.barC; g.globalAlpha = 0.26;
    for (let b = 0; b < spec.bars; b++) {
      const t = 0.22 + b * (0.62 / spec.bars);
      g.lineWidth = SLOT_H * 0.028 * (0.8 + 0.4 * rnd());
      g.beginPath(); g.moveTo(cx - W, Y(t - 0.06)); g.lineTo(cx, Y(t)); g.lineTo(cx + W, Y(t - 0.06)); g.stroke();
    }
    g.globalAlpha = 1;
  }
  // barbs: fine lines from the rachis slanting toward the tip, denser and more regular than the release
  for (let i = 0; i < CONFIG.fixBarbCount; i++) {
    const t = 0.04 + rnd() * 0.94;
    const side = i % 2 === 0 ? -1 : 1;
    const len = W * (1.0 + 0.25 * rnd());
    const light = rnd() < 0.45;
    g.strokeStyle = light ? (slot === FT.greater ? 'rgba(171,142,104,0.08)' : 'rgba(171,142,104,0.09)') : 'rgba(10,8,6,0.15)';
    g.lineWidth = 0.8 + rnd() * 1.2;
    const slant = flight ? 0.11 : 0.085;
    g.beginPath(); g.moveTo(C(t), Y(t)); g.quadraticCurveTo(C(t) + side * len * 0.5, Y(t + slant * 0.4), C(t) + side * len, Y(t + slant + 0.02 * rnd())); g.stroke();
  }
  // edge: dark break on body plumage; faint translucent vane edge on flight/tail feathers (distal part only)
  g.lineWidth = CONFIG.edgeWidth;
  g.strokeStyle = flight ? spec.fringe : 'rgba(10,8,6,1)';
  g.globalAlpha = flight ? CONFIG.edgeLightAlpha : CONFIG.edgeDarkAlpha;
  const from = flight ? 0.6 : 0.4;
  g.beginPath();
  let started = false;
  for (let i = 0; i <= N; i++) { const t = i / N; if (t < from) continue; const p = left[i]; if (!started) { g.moveTo(p[0], p[1]); started = true; } else g.lineTo(p[0], p[1]); }
  for (let i = N; i >= 0; i--) { const t = i / N; if (t < from) continue; const p = right[i]; g.lineTo(p[0], p[1]); }
  g.stroke();
  g.globalAlpha = 1;
  // vane splits (the edge breaks that make a feather read as a feather); slightly deeper on flight feathers
  g.globalCompositeOperation = 'destination-out';
  const splits = flight ? 5 : 4;
  for (let i = 0; i < splits; i++) {
    const t = 0.4 + rnd() * 0.52, side = rnd() < 0.5 ? -1 : 1;
    const hw = side < 0 ? C(t) - left[Math.round(t * N)][0] : right[Math.round(t * N)][0] - C(t);
    g.lineWidth = 1.4 + rnd() * 1.6;
    g.beginPath(); g.moveTo(C(t) + side * hw * 1.05, Y(t + 0.03)); g.lineTo(C(t) + side * hw * (0.74 + 0.12 * rnd()), Y(t)); g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  // darker overlap shadow near the base (buried under the previous row)
  const sh = g.createLinearGradient(0, yb, 0, yb - H * 0.55);
  sh.addColorStop(0, 'rgba(0,0,0,0.42)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh; g.fillRect(x0, yb - H * 0.55, SLOT_W, H * 0.55);
  // rachis: a dark groove either side, a narrow tapering shaft stroke (the highlight comes from the fragment relief)
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(8,6,4,0.35)';
  for (const sgn of [-1, 1]) { g.lineWidth = 2.2; g.beginPath(); g.moveTo(C(0) + sgn * 3.2, yb); g.quadraticCurveTo(cx + sgn * 3.2, Y(0.5), C(0.93) + sgn * 1.6, Y(0.93)); g.stroke(); }
  g.strokeStyle = spec.shaft;
  for (let i = 0; i < 3; i++) {
    g.lineWidth = 2.6 - i * 0.7;
    g.beginPath(); g.moveTo(C(0), yb); g.quadraticCurveTo(cx, Y(0.5), C(0.96 - i * 0.08), Y(0.96 - i * 0.08)); g.stroke();
  }
  g.restore();
}

let atlas = null;
export function featherAtlas() {
  if (atlas) return atlas;
  const cv = document.createElement('canvas');
  cv.width = SLOT_W * 4; cv.height = SLOT_H * 2;
  const g = cv.getContext('2d');
  const stream = (seed) => { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  const rnd = stream(CONFIG.seed);
  // Restore the approved lip random sequence, independent of the new plumage painter.
  // Original slots consume one bend, six draws per barb, four per split and one per bar.
  const rndLip = stream(CONFIG.seed);
  const lipSkip = FT.edge * (1 + 6 * CONFIG.barbCount + 4 * CONFIG.splitCount) + SPECS.slice(0, FT.edge).reduce((n, spec) => n + spec.bars, 0);
  for (let i = 0; i < lipSkip; i++) rndLip();
  SPECS.forEach((spec, i) => (i === FT.edge ? drawFeatherLip : drawFeatherFix)(g, (i % 4) * SLOT_W, Math.floor(i / 4) * SLOT_H, spec, i === FT.edge ? rndLip : rnd, i));
  atlas = new THREE.CanvasTexture(cv);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  return atlas;
}

// ---------------------------------------------------------------- geometry
const _T = new THREE.Vector3(), _N = new THREE.Vector3(), _B = new THREE.Vector3(), _P = new THREE.Vector3(), _Q = new THREE.Vector3();

/**
 * Merge feather cards. p = base position, d = tip direction, n = surface normal (up), len/wid in metres,
 * lift = tip rise per metre (shingle overlap), cup = cross curvature, arch = lengthwise bow, twist = roll (rad).
 * r32 fix (all optional, defaults = release cards): taper = geometric tip narrowing (width × (1 − taper·v²)),
 * curl = cubic tip rise(+)/droop(−) per metre, ao = { v0 } the emergence line (fraction of the card that the next row
 * covers): packed with the card random into aF.z = floor(rand·64)/64 + round(v0·63)/63/64 for every card except the
 * warning lip (slot 7 keeps aF.z = rand, byte-identical). The fragment decodes it for a narrow contact shadow.
 * Attributes: position, normal, uv (atlas), color (tint), aF = (v, flutter, rand[+v0], len), aP = base position.
 */
export function buildFeathers(list, { nv = 5, nu = 3 } = {}) {
  const per = nu * nv;
  const n = list.length;
  const pos = new Float32Array(n * per * 3), nor = new Float32Array(n * per * 3), uv = new Float32Array(n * per * 2);
  const col = new Float32Array(n * per * 3), aF = new Float32Array(n * per * 4), aP = new Float32Array(n * per * 3);
  const idx = [];
  let o = 0;
  list.forEach((f, k) => {
    _T.fromArray(f.d).normalize();
    _N.fromArray(f.n);
    _N.addScaledVector(_T, -_N.dot(_T)).normalize();
    _B.crossVectors(_T, _N).normalize();
    if (f.twist) { _N.applyAxisAngle(_T, f.twist); _B.applyAxisAngle(_T, f.twist); }
    const slot = f.type || 0, sc = slot % 4, sr = Math.floor(slot / 4);
    const u0 = sc / 4, v0 = (1 - sr) / 2;
    const lift = f.lift ?? 0.1, cup = f.cup ?? 0.25, arch = f.arch ?? 0.03;
    const taper = f.taper ?? CONFIG.taper, curl = f.curl ?? 0, ao = f.ao || null;
    const rand = f.rand ?? (((Math.imul(k + 1, 2654435761) ^ CONFIG.seed) >>> 0) / 4294967296);
    // slot 7 (the ring-out warning lip) keeps the raw random; every other card packs its emergence line v0 (0 = none)
    const randPacked = slot === FT.edge ? rand : Math.floor(rand * 64) / 64 + (ao ? Math.min(62, Math.round(ao.v0 * 63)) : 0) / 63 / 64;
    const asym = (rand - 0.5) * CONFIG.asymmetry, sweep = f.sweep ?? (rand - 0.5) * CONFIG.sweep;
    const tint = f.tint || [1, 1, 1];
    for (let j = 0; j < nv; j++) {
      const v = j / (nv - 1);
      for (let i = 0; i < nu; i++) {
        const u = i / (nu - 1), a = u * 2 - 1;
        const h = -cup * a * a * f.wid * 0.35 + lift * v * v * f.len + arch * Math.sin(Math.PI * v) * f.len + curl * v * v * v * f.len;
        // Tapered, swept cards retain a broad buried root. Alpha supplies the fine vane outline.
        const vane = 1 - taper * v * v;
        const across = a * f.wid * 0.5 * vane * (1 + a * asym) + sweep * f.len * v * v;
        _P.fromArray(f.p).addScaledVector(_T, v * f.len).addScaledVector(_B, across).addScaledVector(_N, h);
        // Analytic normal includes cup, arch, taper, sweep and curl (same nu/nv as donor).
        const wa = f.wid * 0.5 * vane * (1 + 2 * a * asym);
        const wv = -a * f.wid * taper * v * (1 + a * asym) + 2 * sweep * f.len * v;
        const ha = -cup * a * f.wid * 0.7;
        const hv = (2 * lift * v + Math.PI * arch * Math.cos(Math.PI * v) + 3 * curl * v * v) * f.len;
        _Q.copy(_N).addScaledVector(_B, -ha / wa).addScaledVector(_T, (ha * wv / wa - hv) / f.len).normalize();
        pos.set([_P.x, _P.y, _P.z], o * 3); nor.set([_Q.x, _Q.y, _Q.z], o * 3);
        uv.set([u0 + u * 0.25, v0 + (0.004 + v * 0.992) * 0.5], o * 2);
        col.set(tint, o * 3);
        aF.set([v, f.flut ?? 0.2, randPacked, f.len], o * 4);
        aP.set(f.p, o * 3);
        o++;
      }
    }
    const b = k * per;
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a0 = b + j * nu + i, a1 = a0 + 1, c0 = a0 + nu, c1 = c0 + 1;
      idx.push(a0, a1, c1, a0, c1, c0);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aF', new THREE.BufferAttribute(aF, 4));
  g.setAttribute('aP', new THREE.BufferAttribute(aP, 3));
  // perf-1650 r3: draw the feather cards FRONT-TO-BACK for the stage camera (above, +Z): alpha-tested cards still get
  // the early depth REJECT, so layers hidden under nearer feathers stop shading (S3 opaque overdraw was ~2.2 layers of
  // shingled feathers drawn in authoring order). Only the index order changes; depth test decides what is visible.
  const per6 = (nu - 1) * (nv - 1) * 6, VX = 0, VY = 0.35, VZ = 1, order = new Array(n), key = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let d = 0; for (let v = k * per; v < (k + 1) * per; v++) d += pos[v * 3] * VX + pos[v * 3 + 1] * VY + pos[v * 3 + 2] * VZ;
    key[k] = d / per; order[k] = k;
  }
  order.sort((a, b) => key[b] - key[a]);
  const idx2 = new Array(idx.length);
  order.forEach((k, r) => { for (let t = 0; t < per6; t++) idx2[r * per6 + t] = idx[k * per6 + t]; });
  g.setIndex(n * per > 65535 ? new THREE.Uint32BufferAttribute(idx2, 1) : new THREE.Uint16BufferAttribute(idx2, 1));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- material
// Wing bend: every wing vertex rotates about the chord axis (local X) at the root by θ(s), s = local z (span).
// θ(s) = uWing.x (dihedral) + uWing.y (beat amp) · sin(uWing.z (phase) − lag·k) · (0.55 + 0.45k) + uWing2.x · k² (tip curl)
export const WING_GLSL = /* glsl */`
uniform vec4 uWing; uniform vec4 uWing2;
float s3WingAng(float s) {
  float k = clamp(s / uWing.w, 0.0, 1.3);
  return uWing.x + uWing.y * sin(uWing.z - uWing2.y * k) * (0.55 + 0.45 * k) + uWing2.x * k * k;
}
`;

// r32 fix: fragment-only vane relief. Slot-local uv (su across the vane 0..1, sv root→tip) → analytic height slopes
// (rachis ridge with a groove either side, slanted barb grooves that fade when their period drops under ~2 px, a fine
// cup) → shading normal through a derivative cotangent frame (no tangent attribute, no vertex change).
const RELIEF_TOKENS = { SW: CONFIG.relief.shaftWidth.toFixed(4), GROOVE: (CONFIG.relief.shaftWidth * 3.2).toFixed(4), GROOVEK: CONFIG.relief.groove.toFixed(3), SLANT: CONFIG.relief.barbSlant.toFixed(3),
  BFREQ: CONFIG.relief.barbFreq.toFixed(1), BARB: CONFIG.relief.barb.toFixed(3), SHAFT: CONFIG.relief.shaft.toFixed(3), CUP: CONFIG.relief.cup.toFixed(3) };
const RELIEF_GLSL = Object.entries(RELIEF_TOKENS).reduce((src, [k, v]) => src.replaceAll('%' + k + '%', v), /* glsl */`
float s3Shaft = 0.0;
vec2 s3SlotUv() { return vec2(fract(vKUv.x * 4.0), fract(vKUv.y * 2.0)); }
vec3 s3Relief(vec3 N, vec2 suv) {
  float ds = (suv.x - 0.5) / %SW%;
  float ridge = exp(-ds * ds);
  // ridge slope (peak ±0.707 at ds = ±1/√2) and a wider groove either side of it
  float dRidge = -ds * exp(0.5 - ds * ds);
  float dg = ds / %GROOVE%;
  float dGroove = dg * exp(0.5 - dg * dg) * %GROOVEK%;
  float side = sign(suv.x - 0.5);
  float bphase = (suv.x - side * %SLANT% * suv.y) * %BFREQ% * 6.2831853;
  float bw = fwidth(bphase) * 0.159155;            // barb cycles per pixel (any view direction)
  float bfade = 1.0 - smoothstep(0.12, 0.3, bw);
  float dBarb = cos(bphase) * %BARB% * bfade * (1.0 - ridge);
  float dhdu = %SHAFT% * (dRidge + dGroove) * 1.414 + dBarb - %CUP% * (suv.x - 0.5) * 2.0;
  float dhdv = -side * %SLANT% * dBarb;
  vec3 vp = -vViewPosition;
  vec3 dp1 = dFdx(vp), dp2 = dFdy(vp);
  vec2 duv1 = dFdx(suv), duv2 = dFdy(suv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-12);
  return normalize(N - (T * dhdu + B * dhdv) * invmax);
}
`);

export function featherMaterial({ wing = false, feet = false, key = 'kcaS3Feather', map = featherAtlas(), rim = CONFIG.rim, rimI = CONFIG.rimI, sheen = CONFIG.sheen } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: CONFIG.roughRoot, metalness: 0, envMapIntensity: CONFIG.envMapIntensity });
  const U = {
    uWing: { value: new THREE.Vector4(0, 0, 0, 20) },
    uWing2: { value: new THREE.Vector4(0, 0.9, 0, 0) },
    uFeet: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 1, 0)) },
    uS3: { value: new THREE.Vector4(0, 1, 0, 0) },           // x = gust strength, y = flutter scale
    uS3Rim: { value: new THREE.Vector4(...new THREE.Color(rim).toArray(), rimI) },
  };
  const defines = {};
  if (wing) defines.S3_WING = 1;
  if (feet) defines.S3_FEET = 1;
  patchStandard(m, {
    key: key + (wing ? 'W' : '') + (feet ? 'F' : ''), uniforms: U, defines,
    vertHead: `attribute vec4 aF; attribute vec3 aP; uniform vec4 uFeet[8]; uniform vec4 uS3; varying float vS3v; varying float vS3r;\n${WING_GLSL}`,
    normalMain: `
    #ifdef S3_WING
    { float th = s3WingAng(position.z); float c = cos(th), s = sin(th);
      objectNormal = vec3(objectNormal.x, objectNormal.y * c + objectNormal.z * s, -objectNormal.y * s + objectNormal.z * c); }
    #endif`,
    vertMain: /* glsl */`
    {
      float fv = aF.x;
      vS3v = fv; vS3r = aF.z;
      float ph = kTime * 10.0 + aF.z * 6.283 + aP.x * 1.3 + aP.z * 0.7;
      float gust = texture2D(kNoise, vec2(aP.x * 0.035 + kTime * 0.45, aP.z * 0.06 + aF.z * 0.2)).r;
      float amp = aF.y * uS3.y * (0.3 + 0.7 * smoothstep(0.35, 0.8, gust) * (0.6 + uS3.x));
      float lift = amp * (sin(ph) * 0.65 + sin(ph * 2.37 + 1.0) * 0.35) * 0.06;
      #ifdef S3_FEET
      float ruf = 0.0;
      for (int i = 0; i < 8; i++) { vec4 f = uFeet[i]; ruf += f.w * smoothstep(f.z, f.z * 0.25, length(aP.xz - f.xy)); }
      ruf = min(ruf, 1.2);
      lift += ruf * (0.16 + 0.07 * sin(kTime * 31.0 + aF.z * 40.0));
      #endif
      transformed.y += lift * fv * fv * aF.w;
      transformed.x -= abs(lift) * fv * fv * aF.w * 0.25;
      #ifdef S3_WING
      { float sp = transformed.z; float th = s3WingAng(sp); float c = cos(th), s = sin(th);
        float y = transformed.y;
        transformed.y = y * c + sp * s; transformed.z = -y * s + sp * c; }
      #endif
    }`,
    fragHead: `varying float vS3v; varying float vS3r; uniform vec4 uS3Rim;\n${RELIEF_GLSL}`,
    // per-feather pigment jitter (release) + one vane darker than the other (which vane: per feather). Darkening only.
    albedo: /* glsl */`
    diffuseColor.rgb *= 0.9 + 0.2 * vS3r;
    { vec2 suv = s3SlotUv();
      float ds = (suv.x - 0.5) / ${CONFIG.relief.shaftWidth.toFixed(4)};
      s3Shaft = exp(-ds * ds);
      // slot 7 = the ring-out warning lip: untouched pigment (no vane split, no contact shadow)
      float lip = step(0.75, vKUv.x) * (1.0 - step(0.5, vKUv.y));
      float vane = mix(suv.x, 1.0 - suv.x, step(0.5, fract(vS3r * 7.31)));
      float v0 = fract(vS3r * 64.0);
      float contour = (1.0 - step(0.25, vKUv.x)) * step(0.5, vKUv.y);   // slot 0 = contour (spine lane / back)
      float dark = mix(${CONFIG.occlusion.dark.toFixed(3)}, ${CONFIG.occlusion.darkContour.toFixed(3)}, contour);
      float occ = mix(dark, 1.0, smoothstep(v0 - ${CONFIG.occlusion.below.toFixed(3)}, v0 + ${CONFIG.occlusion.above.toFixed(3)}, vS3v));
      diffuseColor.rgb *= mix((1.0 - ${CONFIG.vaneDark.toFixed(3)} * smoothstep(0.38, 0.62, vane)) * occ, 1.0, lip); }`,
    rough: `roughnessFactor = mix(${CONFIG.roughRoot.toFixed(3)}, ${CONFIG.roughTip.toFixed(3)}, smoothstep(0.3, 1.0, vS3v)) + (vS3r - 0.5) * ${CONFIG.roughVariation.toFixed(3)} - ${CONFIG.shaftGloss.toFixed(3)} * s3Shaft;`,
    bump: 'normal = s3Relief(normal, s3SlotUv());',
    fragEnd: /* glsl */`
    {
      vec3 nn = normalize(normal); vec3 vv = normalize(vViewPosition);
      float ndv = abs(dot(nn, vv));
      // Quiet satin on sun-facing vanes only; pigment bounds the response, with no additive albedo floor.
      float sun = smoothstep(-0.05, 0.6, dot(normalize(vKN), normalize(vec3(-0.42, 0.3, -0.9))));
      float tip = smoothstep(0.35, 1.0, vS3v);
      outgoingLight += uS3Rim.rgb * uS3Rim.a * pow(1.0 - ndv, 3.0) * tip * sun * diffuseColor.rgb;
      outgoingLight += uS3Rim.rgb * ${sheen.toFixed(3)} * pow(1.0 - ndv, 1.5) * tip * sun * diffuseColor.rgb;
    }`,
  });
  m.userData.U = U;
  return m;
}

/** Solid under-layer (hull / wing membrane) that shares the feathers' wing bend so no gaps open when it beats. */
export function underMaterial({ wing = false, color = '#24170e', key = 'kcaS3Under' } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.4 });
  const U = { uWing: { value: new THREE.Vector4(0, 0, 0, 20) }, uWing2: { value: new THREE.Vector4(0, 0.9, 0, 0) } };
  patchStandard(m, {
    key: key + (wing ? 'W' : ''), uniforms: U, defines: wing ? { S3_WING: 1 } : {},
    vertHead: WING_GLSL,
    normalMain: `
    #ifdef S3_WING
    { float th = s3WingAng(position.z); float c = cos(th), s = sin(th);
      objectNormal = vec3(objectNormal.x, objectNormal.y * c + objectNormal.z * s, -objectNormal.y * s + objectNormal.z * c); }
    #endif`,
    vertMain: `
    #ifdef S3_WING
    { float sp = transformed.z; float th = s3WingAng(sp); float c = cos(th), s = sin(th); float y = transformed.y;
      transformed.y = y * c + sp * s; transformed.z = -y * s + sp * c; }
    #endif`,
  });
  m.userData.U = U;
  return m;
}
