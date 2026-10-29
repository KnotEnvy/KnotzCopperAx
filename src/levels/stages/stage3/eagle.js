// Stage 3 — the colossal eagle (hero creature, ~22 m beak to tail, ~55 m span). Eagle-local space = world space at
// rest: it flies toward +X, the fight belt is its broad back (x −8.8..4.6, |z| ≤ 2.2), the far wing (−Z) rises behind
// the belt as a huge feathered backdrop, the near wing (+Z) sweeps back under the lower frame, the tail fan cocks up at
// the left edge and the neck + head (Blender env_stage3_eagle.glb) rise at the right edge.
//
// Everything but the head is procedural feather geometry (./feathers.js): body contour feathers shingled over a
// superellipse hull, 6 covert rows + alula + secondaries + splayed primaries per wing, 12 barred rectrices. The wings
// bend in the vertex shader (uWing), feathers flutter in the wind, the back ruffles under footsteps (uFeet).
//
//   const eagle = await buildEagle(ctx, { ringZones })
//   eagle.deckY(x, z) → rest height of the walkable feather surface (eagle-local)
//   eagle.update(dt, t, { feet, bank, gust }) → pose (heave/roll/pitch applied to eagle.group)
//   eagle.screech() · eagle.look(yaw, pitch) · eagle.group · eagle.heave / eagle.roll / eagle.pitch
//
// r32 fix (board r3 consensus: rigid repeated shingles / plank rows). Same hull, same card roots grid and RNG stream,
// same 92 warning-lip cards (byte-identical entries). What changed is the FORM of every other card: feather TRACTS
// (nape hackles → spine contour → big scapulars over the wing roots → flank coverts → longer rump feathers) set
// length/width/taper/cup/lift per region, coherent flocks (value-noise field over the hull) bend neighbouring feathers
// together, rows run as chevrons (roots lag toward the flanks) with per-flock stagger so no straight row boundary
// survives, and every card carries its emergence line for the fragment contact shadow (darkening only). The wing gets six staggered covert
// rows with undulating offsets/lengths, a diagonal outboard flow (marginals sweep most), cup/twist/curl, an alula, and
// the same primaries/secondaries silhouette (secondaries get cup/twist/lift variation so the edge-on far wing is not a stair).
import * as THREE from 'three';
import { patchStandard } from '../../../render/shaderlib.js';
import { FT, buildFeathers, featherMaterial, underMaterial } from './feathers.js';
import { rngFrom } from '../stage1/geo.js';

export const EAGLE = {
  x0: -10.2, x1: 7.2,
  // half width W(x) and spine height top(x) along the body
  W: [[-10.2, 1.2], [-9, 2.2], [-6.5, 3.2], [-2, 3.7], [2, 3.75], [4.5, 3.3], [6.2, 2.5], [7.2, 1.7]],
  top: [[-10.2, -0.75], [-9.2, -0.42], [-8, -0.14], [-6, -0.03], [0, 0], [4, 0.02], [6, 0.18], [7.2, 0.35]],
  H: 2.5, e: 0.6, thick: 0.07,
  walk: { x0: -8.8, x1: 4.6 },
  wing: {
    L: 22, root: [3.4, -0.52, 3.35], chordRoot: 8.4,
    near: { sweep: 50, dihedral: 0.03, amp: 0.17 },
    far: { sweep: 12, dihedral: 0.05, amp: 0.19 },
  },
  tail: { base: [-9.7, -0.62, 0], len: 6.4, spread: 42, cock: 14 },
  head: { base: [4.85, -0.55, -0.4], scale: 0.82, yaw: -52, pitch: 0, lean: 0.3 },   // r2: neck reared back + turned toward the camera so the beak stays in the tighter frame
  beat: { period: 4.4, heave: 0.2, roll: 0.9, pitch: 0.6 },
};

// r32 construction controls. EAGLE above remains the collision/anatomy/motion contract.
const CONFIG = {
  seed: 3303,
  body: { step: 0.34, spacing: 0.31, len: 0.84, wid: 0.54,
    groupLength: 0.12, groupWidth: 0.08, rootStagger: 0.07, flow: 0.07,
    lift: 0.065, liftVariation: 0.02, cup: 0.23, arch: 0.015, twist: 0.08 },
  wing: { shade: 0.61, shadeVariation: 0.12, groupLength: 0.17, groupWidth: 0.1, rootStagger: 0.24, flow: 0.1,
    rowTones: [1.03, 0.99, 0.94, 0.9], covertCup: 0.22, covertArch: 0.012 },
  // r32 fix: tract/flock form controls (body) and the staggered covert rows (wing). All tints ≤ 1 (darkening only).
  fix: {
    body: {
      flock: { cellX: 1.05, cellS: 0.85, lenAmp: 0.14, twistAmp: 0.06, cupAmp: 0.05, yawAmp: 0.07, stagger: 0.08 },
      chevron: 0.14,            // rows lag toward the flanks (m at the flank)
      taper: { nape: 0.25, spine: 0.2, scap: 0.18, flank: 0.2, rump: 0.22 },
      lenMul: { nape: -0.12, scap: 0.72, flank: 0.12, rump: 0.22 },
      widMul: { nape: -0.06, scap: 0.28, flank: 0.0, rump: -0.12 },
      lift: { spine: 0.04, nape: 0.07, scap: 0.09, flank: 0.075, rump: 0.065 },
      lane: { phi: [0.45, 0.7], x0: [-4.4, -3.6], len: 0.55, wid: 0.12 },   // every other row skipped on the spine; feathers grow
            hue: { nape: [1.0, 0.95, 0.88], spine: [1.0, 1.0, 1.0], scap: [0.95, 0.955, 0.97], flank: [0.985, 0.975, 0.965], rump: [0.98, 0.97, 0.96] },
      mottle: 0.03,
    },
    wing: {
      rows: [
        { off: 0.12, len: 1.0, wid: 0.9, type: FT.covert, y: 0.19, sp: 0.42, toF: 0.86, cup: 0.18, out: 0.42 },
        { off: 0.45, len: 1.25, wid: 1.0, type: FT.covert, y: 0.165, sp: 0.46, toF: 0.84, cup: 0.2, out: 0.36 },
        { off: 0.85, len: 1.65, wid: 1.15, type: FT.covert, y: 0.14, sp: 0.52, toF: 0.8, cup: 0.22, out: 0.3 },
        { off: 1.3, len: 2.0, wid: 1.3, type: FT.covert, y: 0.115, sp: 0.6, to: 4.2, cup: 0.24, out: 0.24 },
        { off: 1.85, len: 2.5, wid: 1.45, type: FT.greater, y: 0.09, sp: 0.7, to: 3.0, cup: 0.26, out: 0.18 },
        { off: 2.6, len: 3.2, wid: 1.65, type: FT.greater, y: 0.06, sp: 0.82, to: 1.6, cup: 0.28, out: 0.12 },
      ],
      rowTones: [1.03, 1.0, 0.97, 0.94, 0.91, 0.9],
      offWave: 0.06, lenWave: 0.1, lenJitter: 0.06, twistAmp: 0.03, curl: -0.006, taper: 0.12,
    },
  },
};

const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (x, a, b) => THREE.MathUtils.smoothstep(x, a, b);
function table(tb, x) {
  if (x <= tb[0][0]) return tb[0][1];
  for (let i = 1; i < tb.length; i++) if (x <= tb[i][0]) { const [x0, y0] = tb[i - 1], [x1, y1] = tb[i]; const t = (x - x0) / (x1 - x0); return lerp(y0, y1, t * t * (3 - 2 * t)); }
  return tb[tb.length - 1][1];
}
const W = (x) => table(EAGLE.W, x), TOP = (x) => table(EAGLE.top, x);
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
/** Hull point at spine x, cross angle phi (0 = top, ±π/2 = the flanks). */
export function hullP(x, phi, out = new THREE.Vector3()) {
  const w = W(x), e = EAGLE.e;
  return out.set(x, TOP(x) + EAGLE.H * (spow(Math.cos(phi), e) - 1), w * spow(Math.sin(phi), e));
}
/** Walkable rest height (feather surface) at eagle-local (x, z). */
export function deckY(x, z) {
  const w = W(x), q = Math.min(0.999, Math.abs(z) / w);
  const s = Math.pow(q, 1 / EAGLE.e), c = Math.sqrt(Math.max(0, 1 - s * s));
  return TOP(x) + EAGLE.H * (Math.pow(c, EAGLE.e) - 1) + EAGLE.thick;
}

// ---------------------------------------------------------------- deterministic flock field (r32 fix)
// Smooth value noise on a lattice (hash of integer cell + seed), range −1..1. Used so neighbouring feathers share
// length / twist / cup / yaw offsets (flocks), instead of each card drawing its own uncorrelated jitter.
function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (lerp(lerp(a, b, u), lerp(c, d, u), v) - 0.5) * 2;
}

// ---------------------------------------------------------------- body (hull + contour feathers)
function buildBody(rng, ringZones) {
  const nx = 90, nphi = 48, PH = 2.5;
  const pos = [], idx = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= nx; i++) {
    const x = lerp(EAGLE.x0, EAGLE.x1, i / nx);
    for (let j = 0; j <= nphi; j++) { hullP(x, lerp(-PH, PH, j / nphi), v); v.y -= 0.03; pos.push(v.x, v.y, v.z); }
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < nphi; j++) { const a = i * (nphi + 1) + j, b = a + nphi + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setIndex(idx); hull.computeVertexNormals();

  // contour feathers, shingled: rows along x (tips toward the tail), stepped by arc length around the hull
  const list = [];
  const dx = CONFIG.body.step, C = CONFIG.body, FX = CONFIG.fix.body, FL = FX.flock;
  const n0 = new THREE.Vector3(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  let col = 0;
  for (let x = EAGLE.x1 - 0.2; x > EAGLE.x0 + 0.25; x -= dx, col++) {
    // arc-length table around the cross-section
    const N = 160, arc = [0], phis = [];
    for (let k = 0; k <= N; k++) phis.push(lerp(-2.0, 2.0, k / N));
    for (let k = 1; k <= N; k++) { hullP(x, phis[k - 1], p1); hullP(x, phis[k], p2); arc.push(arc[k - 1] + p1.distanceTo(p2)); }
    const total = arc[N], mid = arc[N / 2];
    const neckT = THREE.MathUtils.smoothstep(x, 4.4, 6.4);
    const tailT = THREE.MathUtils.smoothstep(-x, 8.4, 9.8);
    const sp = C.spacing * (1 - 0.3 * tailT);
    const stag = (col % 2) * sp * 0.5;
    for (let s = -mid + stag + (rng.next() - 0.5) * 0.06; s < total - mid; s += sp) {
      const a = s + mid;
      let k = 1; while (k < N && arc[k] < a) k++;
      const t = (a - arc[k - 1]) / Math.max(1e-6, arc[k] - arc[k - 1]);
      const phi = lerp(phis[k - 1], phis[k], t);
      hullP(x, phi, p0);
      // surface normal by finite differences
      hullP(x + 0.05, phi, p1); hullP(x, phi + 0.02, p2);
      const tx = p1.clone().sub(p0), tp = p2.clone().sub(p0);
      n0.crossVectors(tp, tx).normalize(); if (n0.y < -0.2 && Math.abs(phi) < 1) n0.negate();
      if (n0.dot(new THREE.Vector3(0, Math.cos(phi), Math.sin(phi))) < 0) n0.negate();
      const side = Math.sin(phi);
      const flank = Math.abs(phi) > 0.95;
      const d = [-1, -0.05, side * (0.18 + 0.25 * Math.abs(side))];
      const near = p0.z > 0;
      const lip = near && p0.z > 2.25 && p0.z < 3.1 && ringZones.some((zn) => x > zn.x0 - 0.3 && x < zn.x1 + 0.3);
      let type = flank ? FT.covert : FT.contour, len = C.len * (1 - 0.3 * tailT), wid = C.wid * (1 - 0.3 * tailT);
      if (neckT > rng.next() * 0.9 + 0.1 && Math.abs(phi) < 1.4) { type = FT.gold; len *= 1.15; wid *= 0.85; }
      if (lip) { type = FT.edge; len *= 1.12; }
      // Keep the RNG stream/card counts stable. The old cream lane is now the same umber family.
      const rl = rng.next();
      // Correlated small flocks of coverts, offset between rows: breaks the brick grid without thinning coverage.
      const flow = Math.sin(x * 1.35 + p0.z * 0.85) * Math.cos(p0.z * 1.1 - x * 0.25);
      len *= 1 + C.groupLength * flow;
      wid *= 1 + C.groupWidth * Math.sin(x * 1.1 + p0.z * 1.6 + 0.7);
      // scapulars: big overlapping feathers over the wing roots
      if (Math.abs(phi) > 0.55 && Math.abs(phi) < 1.15 && x > -3.6 && x < 3.8) { len *= 1.55; wid *= 1.3; }
      const r = rng.next();
      const patch = 0.94 + 0.04 * Math.sin(x * 0.9 + p0.z * 1.3) + 0.025 * Math.sin(x * 2.3 - p0.z * 0.7);
      const shade = (0.56 + 0.14 * r) * patch;
      const warm = type === FT.gold ? [0.86, 0.81, 0.74]
        : [1.02 * shade, 0.97 * shade, 0.9 * shade];
      const r2 = rng.next();
      // Rows stay dense; roots track the unchanged hull after their small longitudinal stagger.
      const rootX = p0.x + (r2 - 0.5) * 0.14 + C.rootStagger * flow;
      if (lip) {
        // ring-out warning lip: the release card, byte for byte (root, direction, size, tint, flutter, no occlusion)
        const root = hullP(rootX, phi);
        list.push({ p: root.toArray(), d: [d[0], d[1], d[2] + (r - 0.5) * 0.16 + C.flow * flow], n: n0.toArray(),
          len: len * (0.9 + 0.2 * r2), wid, type, tint: warm, rand: r,
          flut: 1.0,
          lift: C.lift + C.liftVariation * r, cup: C.cup, arch: C.arch,
          sweep: 0.02 * flow + (rl - 0.5) * 0.01, twist: (r - 0.5) * C.twist });
        continue;
      }
      // ---- r32 fix: tract + flock form for every other card (same root grid, same RNG draws above)
      const ax = Math.abs(phi);
      const wNape = sstep(x, 3.0, 4.8);
      const wScap = sstep(ax, 0.48, 0.64) * (1 - sstep(ax, 1.1, 1.28)) * sstep(x, -4.2, -3.2) * (1 - sstep(x, 3.4, 4.2)) * (1 - wNape);
      const wFlank = sstep(ax, 1.1, 1.5) * (1 - wNape);
      const wRump = (1 - sstep(x, -7.2, -4.6)) * (1 - wFlank * 0.5);
      const wSpine = Math.max(0, 1 - wNape - wScap - wFlank - wRump);
      const fa = vnoise(x / FL.cellX, a / FL.cellS, 11), fb = vnoise(x / (FL.cellX * 1.5) + 7.3, a / (FL.cellS * 1.4) + 2.1, 23), fc = vnoise(x / 1.8 - 3.1, a / 1.6 + 5.7, 37);
      // the walkable spine is seen at a grazing angle where the 0.34 m row step foreshortens to ~10 px whatever the
      // feather size: there every other row is skipped (all RNG draws above are already consumed, so the stream and the
      // lip cards are untouched) and the remaining feathers grow ~1.5× so each visible tip is a readable elongated oval.
      const LN = FX.lane;
      const laneT = (1 - sstep(ax, LN.phi[0], LN.phi[1])) * (1 - wNape) * sstep(x, LN.x0[0], LN.x0[1]);
      const laneRow = laneT > 0.5 || (laneT > 0.15 && fa > 0.1);
      if (laneRow && col % 2 === 1) continue;
      const laneK = laneRow ? 1 : 0;
      const mix = (tb) => tb.spine * wSpine + tb.nape * wNape + tb.scap * wScap + tb.flank * wFlank + tb.rump * wRump;
      // base size from the unmodified release family (already carries groupLength/groupWidth flow)
      let L2 = C.len * (1 - 0.3 * tailT) * (1 + C.groupLength * flow), W2 = C.wid * (1 - 0.3 * tailT) * (1 + C.groupWidth * Math.sin(x * 1.1 + p0.z * 1.6 + 0.7));
      if (type === FT.gold) { L2 *= 1.15; W2 *= 0.85; }
      L2 *= 1 + FX.lenMul.nape * wNape + FX.lenMul.scap * wScap + FX.lenMul.flank * wFlank + FX.lenMul.rump * wRump;
      W2 *= 1 + FX.widMul.nape * wNape + FX.widMul.scap * wScap + FX.widMul.flank * wFlank + FX.widMul.rump * wRump;
      L2 *= (0.9 + 0.2 * r2) * (1 + FL.lenAmp * fa) * (1 + LN.len * laneK);
      W2 *= (1 + 0.06 * fb) * (1 + LN.wid * laneK);
      let type2 = type;
      if (type !== FT.gold && wScap > 0.6) type2 = FT.greater;                      // scapulars: the long-tapered slot
      const taper = mix({ spine: FX.taper.spine, nape: FX.taper.nape, scap: FX.taper.scap, flank: FX.taper.flank, rump: FX.taper.rump });
      const lift = mix({ spine: FX.lift.spine, nape: FX.lift.nape, scap: FX.lift.scap, flank: FX.lift.flank, rump: FX.lift.rump }) + C.liftVariation * r;
      const cup = C.cup + 0.1 * wScap - 0.05 * wNape + FL.cupAmp * fb;
      const arch = (C.arch + 0.02 * wScap + 0.008 * fc) * (1 - 0.4 * laneK);
      const curl = 0.01 * wRump - 0.008 * wScap - 0.006 * wFlank + 0.005 * fc;
      // flow: chevron outward from the spine (release), plus coherent flock yaw and tract yaw (nape splays, rump converges)
      const yaw = (r - 0.5) * 0.16 + C.flow * flow + FL.yawAmp * fa + side * (0.14 * wNape - 0.1 * wRump);
      const d2 = [d[0], d[1], d[2] + yaw];
      const twist = (r - 0.5) * C.twist * 0.6 + FL.twistAmp * fb - side * 0.06 * wFlank + side * 0.04 * wScap;
      // rows as chevrons: roots lag toward the flanks; flocks stagger the row line further
      const rootX2 = rootX - FX.chevron * Math.pow(Math.min(1, ax / 1.5), 1.5) * (1 - wNape) + FL.stagger * fb;
      // lane rows keep a brick offset: with the odd columns gone, every second remaining column shifts half a spacing
      const phi2 = phi + (laneK && Math.floor(col / 2) % 2 === 1 ? 0.5 * sp * 4 / total : 0);
      const root2 = hullP(rootX2, phi2);
      // contact shadow: the next row's tips cover this card up to v0 = 1 − step/len (double step on the lane)
      const v0 = Math.max(0.3, Math.min(0.8, 1 - dx * (1 + laneK) / L2));
      // darkening-only pigment: tract hue × flock mottle on the release tint (gold hackles keep their identity tint)
      let tint2 = warm;
      if (type !== FT.gold) {
        const hue = [0, 1, 2].map((c) => FX.hue.spine[c] * wSpine + FX.hue.nape[c] * wNape + FX.hue.scap[c] * wScap + FX.hue.flank[c] * wFlank + FX.hue.rump[c] * wRump);
        const mot = 1 - FX.mottle * (0.5 + 0.5 * fc);
        tint2 = [warm[0] * hue[0] * mot, warm[1] * hue[1] * mot, warm[2] * hue[2] * mot];
      }
      list.push({ p: root2.toArray(), d: d2, n: n0.toArray(),
        len: L2, wid: W2, type: type2, tint: tint2, rand: r,
        flut: 0.08 + 0.25 * Math.abs(side) + 0.2 * tailT,
        lift, cup, arch, curl, taper,
        sweep: 0.02 * flow + (rl - 0.5) * 0.01 + 0.012 * fa, twist,
        ao: { v0 } });
    }
  }
  return { hull, feathers: buildFeathers(list, { nv: 5 }), count: list.length };
}

// ---------------------------------------------------------------- wing (local: span +z, chord −x from the leading edge)
function buildWing(rng) {
  const L = EAGLE.wing.L, sw = L * 0.5, FW = CONFIG.fix.wing;
  const le = (s) => -0.1 * s - 0.9 * Math.pow(Math.max(0, s - sw) / (L - sw), 2) * 2;
  const list = [];
  const push = (p, d, len, wid, type, o = {}) => {
    const r = rng.next();
    const shade = (CONFIG.wing.shade + CONFIG.wing.shadeVariation * r) * (o.tone ?? 1);
    const jl = 0.88 + 0.24 * rng.next();
    d = [d[0], d[1], d[2] + (rng.next() - 0.5) * 0.12];
    len *= o.jitter === false ? 1 : jl;
    list.push({ p, d, n: [0, 1, 0], len, wid, type, tint: [shade, shade * 0.95, shade * 0.88], rand: r, flut: o.flut ?? 0.15,
      lift: o.lift ?? 0.06, cup: o.cup ?? 0.22, arch: o.arch ?? 0.025, twist: o.twist ?? (r - 0.5) * 0.1,
      taper: o.taper, curl: o.curl, ao: o.ao, sweep: o.sweep });
  };
  // primaries: 10 from the hand, fanning from backward (inner) to outward (outer); outer 6 separated "fingers".
  // fix: curved tapered vanes (arch + rising tip curl + stronger outer twist), same roots/lengths/silhouette.
  for (let i = 0; i < 10; i++) {
    const k = i / 9;
    const bz = lerp(sw, L * 0.8, k);
    const bx = le(bz) - 1.3 + 0.35 * k;
    const a = THREE.MathUtils.degToRad(lerp(14, 78, Math.pow(k, 0.9)));
    const len = lerp(6.2, 8.8, Math.pow(k, 0.7)) * (i === 9 ? 0.86 : 1);
    push([bx, 0.0 + i * 0.012, bz], [-Math.cos(a), 0.0, Math.sin(a)], len, i > 3 ? 1.05 : 1.5, FT.primary,
      { flut: 0.35 + 0.3 * k, lift: 0.05 + 0.05 * k, cup: 0.12, arch: 0.04, twist: -0.2 * k, curl: 0.01 + 0.01 * k, taper: 0.14, ao: { v0: 0.3 } });
  }
  // secondaries + tertials along the arm (tips form the scalloped trailing edge); fix: undulating lengths and twist
  let si = 0;
  for (let s = 0.2; s < sw + 0.4; s += 0.78, si++) {
    const k = s / sw;
    const len = (lerp(6.0, 5.0, k) + (s < 1.6 ? 0.8 : 0)) * (1 + 0.06 * Math.sin(s * 1.5));
    push([le(s) - 2.4, 0.04, s], [-1, 0, 0.14 + 0.2 * k], len, s < 2.0 ? 1.85 : 1.75, FT.secondary,
      { flut: 0.2, lift: 0.035 + 0.005 * Math.sin(s * 0.5), cup: 0.22 + 0.02 * Math.sin(s * 0.45 + 1), arch: 0.03, twist: 0.03 * Math.sin(s * 0.6 + 0.4), curl: 0.006, taper: 0.12, ao: { v0: 0.42 } });
  }
  // covert rows (fix): marginal ×2 → lesser ×2 → median → greater, leading-edge rows on top. Each row's chord offset
  // and feather length undulate along the span (coherent groups of 3–5 feathers), alternate rows sit half a step
  // over, tips cup/twist/curl, and every card carries the overlap occlusion of the row in front of it.
  const rows = FW.rows;
  rows.forEach((r, ri) => {
    const to = r.to !== undefined ? sw + r.to : L * r.toF;
    const nextOff = ri + 1 < rows.length ? rows[ri + 1].off : 2.4 + 0.5;    // the secondaries lie behind the greater coverts
    for (let s = 0.1 + (ri % 2) * r.sp * 0.5; s < to; s += r.sp * (0.8 + 0.4 * rng.next())) {
      const hand = Math.max(0, (s - sw) / (L - sw));
      const f = 1 - 0.45 * hand;
      const wave = Math.sin(s * 1.6 + ri * 1.15) * 0.7 + Math.sin(s * 0.5 + ri * 0.9) * 0.3;
      const wave2 = Math.sin(s * 1.1 + ri * 2.3 + 1.0);
      const tone = FW.rowTones[ri] * (0.96 + 0.04 * Math.sin(s * 0.7 + ri * 0.4));
      const length = r.len * f * (1 + FW.lenWave * wave + FW.lenJitter * (rng.next() - 0.5));
      const width = r.wid * f * (1 + CONFIG.wing.groupWidth * Math.sin(s * 0.85 + 0.8));
      const off = r.off * f * (1 + FW.offWave * Math.sin(s * 0.55 + ri * 1.7));
      const v0 = Math.max(0.3, Math.min(0.8, 1 - (nextOff - r.off) * f / length));
      push([le(s) - off + (rng.next() - 0.5) * 0.2 + CONFIG.wing.rootStagger * 0.6 * wave, r.y * f + 0.035 * Math.sin(s * 0.85 + 0.6), s],
        [-1, 0, r.out + 0.3 * hand + 0.1 * (s / L) + CONFIG.wing.flow * wave], length, width, r.type,
        { flut: 0.1 + 0.2 * hand, lift: 0.018 + 0.006 * wave2, cup: r.cup + 0.02 * wave2, arch: CONFIG.wing.covertArch + 0.008 * Math.abs(wave2),
          twist: FW.twistAmp * wave2 + (rng.next() - 0.5) * 0.03, curl: FW.curl, taper: FW.taper, tone, ao: { v0 }, jitter: false });
    }
  });
  // alula (fix): three small stiff feathers at the wrist, on top of the marginal coverts
  for (let i = 0; i < 3; i++) {
    const k = i / 2, bz = sw + 0.3 + 0.55 * i;
    const a = THREE.MathUtils.degToRad(lerp(22, 40, k));
    push([le(bz) - 0.35 - 0.15 * i, 0.24, bz], [-Math.cos(a), 0.02, Math.sin(a)], 1.7 + 0.35 * i, 0.72, FT.greater,
      { flut: 0.12, lift: 0.08, cup: 0.2, arch: 0.02, twist: -0.08, taper: 0.25, ao: { v0: 0.4 } });
  }
  // primary coverts over the base of the primaries
  for (let i = 0; i < 9; i++) {
    const k = i / 8, bz = lerp(sw - 0.4, L * 0.84, k);
    const a = THREE.MathUtils.degToRad(lerp(15, 70, k));
    push([le(bz) - 0.9 + 0.4 * k, 0.2, bz], [-Math.cos(a), 0, Math.sin(a)], 2.6 - 0.5 * k, 1.2, FT.greater,
      { flut: 0.2, lift: 0.07, cup: 0.24, arch: 0.02, twist: -0.06 - 0.08 * k, taper: 0.16, curl: -0.005, ao: { v0: 0.45 } });
  }
  const feathers = buildFeathers(list, { nv: 6 });
  // membrane under-layer: fills LE → greater coverts / primary bases so no gaps open while beating
  const ns = 40, nc = 6, pos = [], idx = [];
  for (let i = 0; i <= ns; i++) {
    const s = (i / ns) * L * 0.84;
    const hand = Math.max(0, (s - sw) / (L - sw));
    const ch = lerp(5.0, 2.2, hand);
    for (let j = 0; j <= nc; j++) { const c = j / nc; pos.push(le(s) + 0.1 - c * ch, -0.06 - 0.12 * Math.sin(Math.PI * c), s); }
  }
  for (let i = 0; i < ns; i++) for (let j = 0; j < nc; j++) { const a = i * (nc + 1) + j, b = a + nc + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const mem = new THREE.BufferGeometry();
  mem.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); mem.setIndex(idx); mem.computeVertexNormals();
  return { feathers, membrane: mem, count: list.length };
}

// ---------------------------------------------------------------- tail (local: fan toward −x)
function buildTail(rng) {
  const T = EAGLE.tail, list = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1) - 0.5;
    const a = THREE.MathUtils.degToRad(T.spread) * k * 2;
    const r = rng.next();
    // fix: curved tapered rectrices (arch + slight rising curl + coherent twist), same fan roots/lengths
    list.push({ p: [0.2, 0.02 * Math.abs(k) * 8, k * 1.0], d: [-Math.cos(a), 0, Math.sin(a)], n: [0, 1, 0], len: T.len * (1 - 0.1 * Math.abs(k) * 2), wid: 1.3,
      type: FT.tail, tint: [0.9 + 0.2 * r, 0.88 + 0.2 * r, 0.86 + 0.2 * r], rand: r, flut: 0.3, lift: 0.03, cup: 0.14, arch: 0.035, curl: 0.01,
      twist: (r - 0.5) * 0.12 + k * 0.08, taper: 0.12, ao: { v0: 0.35 } });
  }
  // upper tail coverts (2 rows) + rump feathers overlapping the fan base
  for (let row = 0; row < 2; row++) for (let i = 0; i < 9; i++) {
    const k = i / 8 - 0.5, a = THREE.MathUtils.degToRad(T.spread * 0.7) * k * 2, r = rng.next();
    list.push({ p: [0.9 - row * 0.9, 0.16 + 0.1 * (1 - row), k * 2.0], d: [-Math.cos(a), 0, Math.sin(a)], n: [0, 1, 0], len: (2.6 - row * 0.6) * (1 + 0.1 * Math.sin(i * 1.7 + row)), wid: 1.0,
      type: FT.covert, tint: [0.9 + 0.2 * r, 0.86 + 0.2 * r, 0.8 + 0.2 * r], rand: r, flut: 0.2, lift: 0.06, cup: 0.25 + 0.05 * Math.sin(i * 2.1), arch: 0.02,
      twist: (r - 0.5) * 0.1 + k * 0.06, taper: 0.18, curl: -0.006, ao: { v0: 0.55 } });
  }
  return { feathers: buildFeathers(list, { nv: 6 }) };
}

// ---------------------------------------------------------------- head material (Blender vertex colour + masks)
function headMaterial(rimColor = '#ffd9a0') {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8, metalness: 0, envMapIntensity: 0.7 });
  const U = { uHRim: { value: new THREE.Vector4(...new THREE.Color(rimColor).toArray(), 0.9) }, uEye: { value: 1 } };
  patchStandard(m, {
    key: 'kcaS3Head', uniforms: U,
    vertHead: 'attribute float aGlow; varying float vGlow;',
    vertMain: 'vGlow = aGlow;',
    fragHead: 'varying float vGlow; uniform vec4 uHRim; uniform float uEye;',
    albedo: 'vec4 n = kTri(vKW * 0.9, vKN, 1.0); diffuseColor.rgb *= 0.9 + 0.2 * n.r;',
    rough: 'float bk = smoothstep(0.15, 0.3, vGlow) * (1.0 - smoothstep(0.35, 0.45, vGlow)); roughnessFactor = mix(roughnessFactor, 0.32, bk); roughnessFactor = mix(roughnessFactor, 0.08, step(0.45, vGlow));',
    emissive: 'totalEmissiveRadiance += (vec3(1.0, 0.62, 0.12) * smoothstep(0.4, 0.55, vGlow) * (1.0 - step(0.9, vGlow)) * 1.6 + vec3(1.0, 0.97, 0.92) * step(0.9, vGlow) * 3.0) * uEye;',
    fragEnd: `{ float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
      outgoingLight += uHRim.rgb * uHRim.a * pow(1.0 - ndv, 2.6) * (0.4 + diffuseColor.r * 2.2); }`,
  });
  m.userData.U = U;
  return m;
}

function prepHeadGeometry(geo) {
  const c = geo.getAttribute('color');
  const n = geo.getAttribute('position').count;
  const glow = new Float32Array(n);
  if (c && c.itemSize === 4) {
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { rgb[i * 3] = c.getX(i); rgb[i * 3 + 1] = c.getY(i); rgb[i * 3 + 2] = c.getZ(i); glow[i] = c.getW(i); }
    geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  }
  geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
}

// ---------------------------------------------------------------- assemble
export async function buildEagle(ctx, { ringZones = [] } = {}) {
  const { game } = ctx;
  const rng = rngFrom(CONFIG.seed);
  const group = new THREE.Group(); group.name = 'eagle';
  const pose = new THREE.Group(); pose.name = 'eaglePose';   // heave/roll/pitch
  group.add(pose);

  const body = buildBody(rng, ringZones);
  const deckMat = featherMaterial({ feet: true, key: 'kcaS3Deck' });
  const hullMat = underMaterial({ color: '#1e130b' });
  const hull = new THREE.Mesh(body.hull, hullMat); hull.name = 'eagleHull'; hull.receiveShadow = true;
  hull.renderOrder = 1;   // perf-1650 r3: the solid hull under the feather coat draws AFTER the feathers (early-z rejects the covered hull: S3 opaque overdraw)
  const deck = new THREE.Mesh(body.feathers, deckMat); deck.name = 'eagleBackFeathers'; deck.receiveShadow = true; deck.castShadow = false;
  deck.frustumCulled = false;
  pose.add(hull, deck);

  // wings
  const wingGeo = buildWing(rng);
  const wings = [];
  for (const side of ['near', 'far']) {
    const cfg = EAGLE.wing[side], sgn = side === 'near' ? 1 : -1;
    const g = new THREE.Group(); g.name = `wing_${side}`;
    g.position.set(EAGLE.wing.root[0], EAGLE.wing.root[1], EAGLE.wing.root[2] * sgn);
    if (sgn < 0) g.scale.z = -1;
    g.rotation.y = THREE.MathUtils.degToRad(cfg.sweep) * (sgn > 0 ? -1 : 1);
    const fm = featherMaterial({ wing: true, key: 'kcaS3Wing' + side });
    const um = underMaterial({ wing: true, color: '#3e2818', key: 'kcaS3Mem' + side });
    const fmesh = new THREE.Mesh(wingGeo.feathers, fm); fmesh.frustumCulled = false; fmesh.receiveShadow = side === 'near';
    const mmesh = new THREE.Mesh(wingGeo.membrane, um); mmesh.frustumCulled = false;
    g.add(mmesh, fmesh);
    pose.add(g);
    wings.push({ side, g, cfg, U: [fm.userData.U, um.userData.U] });
  }

  // tail
  const tail = buildTail(rng);
  const tailG = new THREE.Group(); tailG.name = 'tail';
  tailG.position.fromArray(EAGLE.tail.base);
  tailG.rotation.z = -THREE.MathUtils.degToRad(EAGLE.tail.cock);    // fan tips rise toward −x
  const tailMat = featherMaterial({ key: 'kcaS3Tail' });
  const tailMesh = new THREE.Mesh(tail.feathers, tailMat); tailMesh.frustumCulled = false;
  tailG.add(tailMesh); pose.add(tailG);

  // neck + head (Blender)
  let head = null, jaw = null, neckRoot = null;
  const headMat = headMaterial();
  try {
    const res = game.assets && game.assets.instance ? await game.assets.instance('env_stage3_eagle', { cloneMaterials: false }).catch(() => null) : null;
    if (res && res.root && res.source !== 'placeholder') {
      neckRoot = new THREE.Group(); neckRoot.name = 'eagleNeck';
      neckRoot.position.fromArray(EAGLE.head.base);
      neckRoot.scale.setScalar(EAGLE.head.scale);
      neckRoot.rotation.y = THREE.MathUtils.degToRad(EAGLE.head.yaw);
      neckRoot.rotation.z = EAGLE.head.lean || 0;
      res.root.traverse((o) => {
        if (o.isMesh) { prepHeadGeometry(o.geometry); o.material = headMat; o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; }
        if (o.name === 'eagle_head') head = o;
        if (o.name === 'eagle_jaw') jaw = o;
      });
      neckRoot.add(res.root);
      pose.add(neckRoot);
    }
  } catch (e) { console.warn('[stage3] eagle head', e); }
  const head0 = head ? head.quaternion.clone() : null;
  const jaw0 = jaw ? jaw.quaternion.clone() : null;

  // ---- animation state
  const B = EAGLE.beat;
  let phase = 0, glide = 0;
  const look = { yaw: 0, pitch: 0, ty: 0, tp: 0, next: 2.5 };
  let screechT = -1;
  const qa = new THREE.Quaternion(), eu = new THREE.Euler();
  const api = {
    group, pose, wings, head, jaw, neckRoot, deckMat, headMat,
    heave: 0, roll: 0, pitch: 0, beat: 0, counts: { back: body.count, wing: wingGeo.count },
    deckY,
    screech(d = 1.1) { screechT = 0; look.tp = -14; look.ty = 12; look.next = d + 1.2; if (game.bus) game.bus.emit('stage3:screech', {}); },
    look(yaw, pitch) { look.ty = yaw; look.tp = pitch; look.next = 3; },
    /** feet: array of [x, z, radius, amount]; bank: extra roll (rad, + = near side down); flap: 0..1.4 beat strength */
    update(dt, t, { feet = [], bank = 0, flap = 1, gust = 0 } = {}) {
      // slow powerful beats with glide stretches (amplitude eases 0.35..1)
      glide = 0.5 + 0.5 * Math.sin(t * 0.21 + 1.3);
      const amp = flap * (0.4 + 0.6 * glide);
      phase += (dt * Math.PI * 2 / B.period) * (0.8 + 0.3 * glide);
      const s = Math.sin(phase);
      api.beat = s * amp;
      // body rises on the downstroke (s falling)
      api.heave = -B.heave * Math.cos(phase) * amp + 0.06 * Math.sin(t * 0.37);
      api.roll = THREE.MathUtils.degToRad(B.roll) * Math.sin(t * 0.29 + 0.4) + bank;
      api.pitch = THREE.MathUtils.degToRad(B.pitch) * Math.sin(phase + 0.9) * amp + THREE.MathUtils.degToRad(0.4) * Math.sin(t * 0.17);
      pose.position.y = api.heave;
      pose.rotation.set(api.roll, 0, api.pitch);
      for (const w of wings) {
        const dih = w.cfg.dihedral + (w.side === 'far' ? 1 : -1) * bank * 0.35;
        for (const U of w.U) {
          U.uWing.value.set(dih, w.cfg.amp * amp, phase, EAGLE.wing.L);
          U.uWing2.value.set(0.1 + 0.07 * Math.sin(phase - 1.4) * amp, 0.95, 0, 0);
        }
      }
      tailG.rotation.x = 0.05 * Math.sin(t * 0.43) + bank * 0.4;
      tailG.rotation.z = -THREE.MathUtils.degToRad(EAGLE.tail.cock) + 0.04 * Math.sin(t * 0.61 + 1);
      // feet ruffle + wind
      const uf = deckMat.userData.U.uFeet.value;
      for (let i = 0; i < 8; i++) { const f = feet[i]; if (f) uf[i].set(f[0], f[1], f[2], f[3]); else uf[i].set(0, 0, 1, 0); }
      for (const U of [deckMat.userData.U, tailMat.userData.U, wings[0].U[0], wings[1].U[0]]) U.uS3.value.set(gust, 1, 0, 0);
      // head: glances, screeches
      look.next -= dt;
      if (look.next <= 0) { look.ty = (Math.random() - 0.4) * 34; look.tp = (Math.random() - 0.5) * 12; look.next = 2.5 + Math.random() * 3.5; }
      const kk = 1 - Math.exp(-dt * 2.2);
      look.yaw += (look.ty - look.yaw) * kk; look.pitch += (look.tp - look.pitch) * kk;
      let jawA = 0;
      if (screechT >= 0) {
        screechT += dt;
        const k = screechT < 0.18 ? screechT / 0.18 : Math.max(0, 1 - (screechT - 0.8) / 0.35);
        jawA = 0.42 * k;
        if (screechT > 1.2) screechT = -1;
      }
      if (head && head0) {
        eu.set(0, THREE.MathUtils.degToRad(look.yaw), THREE.MathUtils.degToRad(-look.pitch) + 0.03 * Math.sin(phase + 2));
        head.quaternion.copy(head0).multiply(qa.setFromEuler(eu));
      }
      if (jaw && jaw0) { eu.set(0, 0, -jawA); jaw.quaternion.copy(jaw0).multiply(qa.setFromEuler(eu)); }
      if (neckRoot) neckRoot.rotation.z = (EAGLE.head.lean || 0) + 0.03 * Math.sin(phase + 1.6) * amp;
    },
    /** World-space rest→posed height of the deck (walk plane). */
    groundAt(x, z) {
      const y = deckY(x, z);
      return api.heave + y * Math.cos(api.roll) - z * Math.sin(api.roll) + x * Math.sin(api.pitch);
    },
  };
  ctx.group.add(group);
  return api;
}
