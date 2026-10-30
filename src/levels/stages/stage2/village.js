// Stage 2 — the village on the shell: stilt huts on the dome (stage-1 hut builder, intact + weathered, reed thatch),
// a boardwalk behind the belt, ladders, rope bridges between hut platforms, paper lanterns (swing with the sway),
// prayer-flag lines (wind flutter), barrels/crates, a low log rail along the near lip that is ABSENT over the ring-out
// zones (marked by red warning posts, banners and bells), hanging lake-weed along the lip, moss/fern tufts.
// Everything static is merged per material; lanterns/flags/props are instanced.
import * as THREE from 'three';
import * as M from '../../../render/materials.js';
import { patchStandard } from '../../../render/shaderlib.js';
import { buildHut } from '../stage1/huts.js';
import { timber, tube, panel, merge, xform, rngFrom, V3, fbm2 } from '../stage1/geo.js';
import { shellH, rimZ } from './shell.js';

// r4: few, small stilt huts on the FAR slope of the crest (stilts lashed down to the costal plates), spaced ~16 m so
// the shell crest and the open water beyond it stay visible between them.
export const HUTS = [
  { x: -2.5, z: -6.1, yaw: 0.08, w: 3.8, d: 3.0, seed: 21 },
  { x: 16.5, z: -6.1, yaw: -0.06, w: 4.2, d: 3.2, seed: 3 },
  { x: 34.5, z: -6.1, yaw: 0.1, w: 3.8, d: 3.0, seed: 7 },
  { x: 53.0, z: -6.1, yaw: -0.12, w: 4.4, d: 3.2, seed: 13 },
  { x: 73.0, z: -6.1, yaw: 0.06, w: 3.8, d: 3.0, seed: 19 },
  { x: 88.0, z: -6.1, yaw: -0.1, w: 3.6, d: 2.9, seed: 29 },
];
// env-r33: one add-on family per hut (silhouette / support / use, not hue): roof proportions + a supported, lashed
// side structure on the gable end `side` (+1 = +x). 'frame' = tall steep roof + drying frame of hanging bundles,
// 'leanto' = low shed roof on posts over a side deck with reed bundles + firewood, 'netrack' = posted rack with a
// drying net + fish bar, 'awning' = side deck with a plank awning, crates and a barrel. Families repeat at most twice,
// mirrored and with different roofs, never as a duplicated row.
// Sides face away from the neck root (it rides 7 m right of the camera focus): at the per-screen cameras (x 4.8, 22.8,
// 40.8, 58-66) every add-on stays left of that root, so the head-to-shell join remains visible past the huts. The first
// hut's drying frame goes on its OUTER side: on +x it stood right behind the stage-start spawn (x 1-4.5) and filled the
// bright lake strip behind the heroes' heads.
export const HUT_FAMILY = [
  { kind: 'frame', side: -1, wallH: 1.7, rise: 1.8, ov: 0.5 },
  { kind: 'leanto', side: 1, wallH: 1.6, rise: 1.05, ov: 0.7 },
  { kind: 'awning', side: 1, wallH: 1.45, rise: 0.95, ov: 0.8 },
  { kind: 'netrack', side: 1, wallH: 1.55, rise: 1.25, ov: 0.55 },
  { kind: 'leanto', side: 1, wallH: 1.6, rise: 1.15, ov: 0.65 },
  { kind: 'frame', side: -1, wallH: 1.65, rise: 1.6, ov: 0.55 },
];

const lerp = (a, b, t) => a + (b - a) * t;

/** Catenary-ish sag from a to b (Vector3), n points. */
function sagLine(a, b, sag, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(a.clone().lerp(b, t).add(V3(0, -sag * 4 * t * (1 - t), 0))); }
  return pts;
}

export function buildVillage(ctx, { ringZones, lightSpots }) {
  const { group } = ctx;
  const q = ctx.quality || {};
  const rng = rngFrom(4242);
  const mats = {
    wood: M.wood({ color: '#4a4034', color2: '#6e604e', charColor: '#2a241e', char: 0, emberIntensity: 0 }),
    daub: M.daub({ color: '#857a62', color2: '#a0957a', soot: '#4a4a3a' }),
    thatch: M.thatch({ color: '#4f5145', color2: '#74705a', burnt: '#4a4a30', emberIntensity: 0 }),
    red: M.wood({ color: '#6a1c16', color2: '#8e2a1e', charColor: '#2a0e0a', char: 0, emberIntensity: 0 }),
  };
  const woodG = [], redG = [], ropeG = [];
  const wmask = () => [0, 0, 0, 1];
  const T = (a, b, r, o = {}) => woodG.push(timber(a, b, { r, r2: r * 0.9, rng, mask: wmask, sides: 5, ...o }));
  const plank = (x, y, z, w, d, yaw = 0, th = 0.06) => woodG.push(xform(panel(w, th, d), { pos: [x, y, z], rot: [0, yaw, (rng.next() - 0.5) * 0.03] }));
  const rope = (pts, r = 0.025) => ropeG.push(tube(pts, pts.map(() => r), { sides: 4, cap: false }));
  const lanterns = [], flagLines = [], props = [];
  const platforms = [];

  // ---- stilt huts
  for (const h of HUTS) {
    const hw = (h.w ?? 5) / 2 + 0.6, hd = (h.d ?? 3.7) / 2 + 0.6;
    const cs = Math.cos(h.yaw), sn = Math.sin(h.yaw);
    const corner = (u, v) => [h.x + u * cs + v * sn, h.z - u * sn + v * cs];
    let top = -9;
    for (const [u, v] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]]) { const [x, z] = corner(u, v); top = Math.max(top, shellH(x, z)); }
    // r4: low fishing shacks perched over the far slope (roofs stay at the horizon line, under the head)
    const floor = Math.max(0.2, top * 0.3) + 0.2 + rng.next() * 0.2;
    // stilts + cross braces
    const posts = [];
    for (const [u, v] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, -hd], [0, hd]]) {
      const [x, z] = corner(u * 0.95, v * 0.95);
      const g = shellH(x, z) - 0.2;
      T(V3(x, g, z), V3(x, floor, z), 0.12);
      posts.push([x, g, z]);
    }
    for (let i = 0; i < 4; i += 1) {
      const a = posts[i], b = posts[(i + 1) % 4];
      if (i === 1 || i === 3) continue;
      T(V3(a[0], lerp(a[1], floor, 0.3), a[2]), V3(b[0], lerp(b[1], floor, 0.85), b[2]), 0.06);
    }
    // platform (planks across the hut's short axis) with an apron in front
    for (let u = -hw; u <= hw; u += 0.3) {
      const [x, z] = corner(u, 0.25);
      plank(x, floor + 0.03, z, 0.27, hd * 2 + 0.5, h.yaw);
    }
    platforms.push({ x: h.x, z: h.z, y: floor, front: corner(0, hd + 0.3), hw, yaw: h.yaw });
    const HF = HUT_FAMILY[HUTS.indexOf(h) % HUT_FAMILY.length];
    const r = buildHut({ wallH: HF.wallH, rise: HF.rise, ov: HF.ov, ...h, y: floor + 0.06, mats, burning: 0, char: 0, collapse: 0 }, rng);
    group.add(r.group);
    // eave lanterns (front corners) + door glow
    for (const s of [-1, 1]) {
      const [x, z] = corner(s * ((h.w ?? 5) / 2 + 0.2), (h.d ?? 3.7) / 2 + 0.55);
      lanterns.push({ x, y: floor + 2.0, z, len: 0.5, s: 0.9 });
    }
    lightSpots.push(new THREE.Vector3(...[corner(0, hd + 1.2)[0], floor + 1.6, corner(0, hd + 1.2)[1]]));
    // ladder down to the dome
    const [lx, lz] = corner(hw * 0.4, hd + 0.2);
    const gy = shellH(lx, lz + 1.0);
    const lb = V3(lx, gy, lz + 1.0), lt = V3(lx, floor, lz);
    for (const o of [-0.25, 0.25]) T(lb.clone().add(V3(o * cs, 0, -o * sn)), lt.clone().add(V3(o * cs, 0.5, -o * sn)), 0.04);
    for (let t = 0.12; t < 1; t += 0.14) { const p = lb.clone().lerp(lt, t); T(p.clone().add(V3(-0.27 * cs, 0, 0.27 * sn)), p.clone().add(V3(0.27 * cs, 0, -0.27 * sn)), 0.025); }
    // Lash the shack to seam stakes; spare fishing line rests on the apron.
    for (const side of [-1, 1]) {
      const [sx, sz] = corner(side * (hw + 0.55), hd - 0.25);
      const sy = shellH(sx, sz);
      T(V3(sx, sy - 0.08, sz), V3(sx, sy + 0.4, sz), 0.055);
      const [tx, tz] = corner(side * hw * 0.9, hd * 0.9);
      rope(sagLine(V3(sx, sy + 0.28, sz), V3(tx, floor + 0.32, tz), 0.06, 5), 0.028);
    }
    const [cx, cz] = corner(-hw * 0.65, hd + 0.1);
    const coil = [];
    for (let k = 0; k <= 100; k++) {
      const a = k / 100 * Math.PI * 6, r = 0.13 + k / 100 * 0.22;
      coil.push(V3(cx + Math.cos(a) * r, floor + 0.085, cz + Math.sin(a) * r * 0.8));
    }
    rope(coil, 0.023);
    // barrels/crates on the platform or under it
    if (rng.next() < 0.8) props.push({ kind: rng.next() < 0.5 ? 'barrel' : 'crate', x: corner(-hw * 0.7, hd)[0], y: floor + 0.06, z: corner(-hw * 0.7, hd)[1], yaw: rng.next() * 3, s: 0.8 + rng.next() * 0.3 });
  }

  // ---- rope bridges between neighbouring platforms (front row → back row and along the rows)
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]];
  for (const [ia, ib] of pairs) {
    const A = platforms[ia], B = platforms[ib];
    if (!A || !B) continue;
    const a = V3(A.x, A.y + 0.05, A.z), b = V3(B.x, B.y + 0.05, B.z);
    const dir = b.clone().sub(a); const L = dir.length(); dir.normalize();
    a.addScaledVector(dir, A.hw * 0.9); b.addScaledVector(dir, -B.hw * 0.9);
    const n = Math.max(6, Math.round(a.distanceTo(b) / 0.34));
    const sag = 0.35 + L * 0.03;
    const deck = sagLine(a, b, sag, n);
    const side = V3(-dir.z, 0, dir.x).normalize();
    const yaw = Math.atan2(-dir.z, dir.x);
    for (let i = 1; i < deck.length - 1; i++) if (rng.next() > 0.06) { const p = deck[i]; woodG.push(xform(panel(0.22, 0.04, 0.8), { pos: [p.x, p.y, p.z], rot: [0, yaw, (rng.next() - 0.5) * 0.12] })); }
    for (const s of [-0.42, 0.42]) {
      rope(deck.map((p) => p.clone().addScaledVector(side, s)), 0.02);
      const hand = sagLine(a.clone().addScaledVector(side, s).add(V3(0, 0.9, 0)), b.clone().addScaledVector(side, s).add(V3(0, 0.9, 0)), sag * 0.85, n);
      rope(hand, 0.022);
      for (let i = 2; i < n - 1; i += 3) rope([deck[i].clone().addScaledVector(side, s), hand[i]], 0.012);
      T(a.clone().addScaledVector(side, s).add(V3(0, -0.1, 0)), a.clone().addScaledVector(side, s).add(V3(0, 1.1, 0)), 0.06);
      T(b.clone().addScaledVector(side, s).add(V3(0, -0.1, 0)), b.clone().addScaledVector(side, s).add(V3(0, 1.1, 0)), 0.06);
    }
    // flag line along the handrail of every other bridge
    if ((ia + ib) % 2 === 0) flagLines.push({ a: a.clone().add(V3(0, 1.7, 0)), b: b.clone().add(V3(0, 1.7, 0)), sag: sag * 0.6 });
  }

  // ---- r4: no continuous boardwalk (it walled off the crest). Lantern poles lashed to the far vertebral edge, a few
  // crates/barrels roped down on the crest behind the lane.
  const BW = { z1: -4.1 };
  for (let x = -9; x < 76; x += 8 + rng.next() * 3) {
    const z = BW.z1, g = shellH(x, z) - 0.1;
    T(V3(x, g, z), V3(x, g + 3.3, z), 0.075);
    T(V3(x, g + 3.15, z), V3(x + 0.9, g + 3.25, z + 0.25), 0.045);
    rope([V3(x - 0.5, shellH(x - 0.5, z + 0.3) + 0.05, z + 0.3), V3(x, g + 1.1, z)], 0.02);
    rope([V3(x + 0.5, shellH(x + 0.5, z - 0.4) + 0.05, z - 0.4), V3(x, g + 1.1, z)], 0.02);
    lanterns.push({ x: x + 0.85, y: g + 3.22, z: z + 0.25, len: 0.55, s: 1 });
    lightSpots.push(new THREE.Vector3(x + 0.85, g + 2.5, z + 0.6));
    if (rng.next() < 0.6) {
      const px = x + 1.4 + rng.next() * 1.4, pz = -2.95;
      props.push({ kind: 'crate', x: px, y: shellH(px, pz) + 0.03, z: pz, yaw: rng.next() * 0.4, s: 0.85 + rng.next() * 0.3 });
      if (rng.next() < 0.6) props.push({ kind: 'barrel', x: px + 0.9, y: shellH(px + 0.9, pz) + 0.03, z: pz + 0.05, yaw: rng.next() * 3, s: 0.9 });
    }
  }
  // prayer flags strung between the boardwalk poles and the huts' ridges (the village skyline)
  for (let i = 0; i < 0; i++) {   // r4: no ridge-top flag lines (they curtained the sky strip that holds the head)
    const A = platforms[i], B = platforms[i + 1];
    if (!A || !B || Math.abs(A.x - B.x) > 20) continue;
    flagLines.push({ a: V3(A.x, A.y + 4.2, A.z), b: V3(B.x, B.y + 4.2, B.z), sag: 0.9 });
  }

  // ---- near lip: low log rail on stubby posts, broken off at the ring-out zones (red warning posts + bells)
  const inZone = (x) => ringZones.some((z) => x > z.x0 - 0.2 && x < z.x1 + 0.2);
  const railZ = (x) => Math.min(rimZ(x) - 0.75, 2.95);
  for (let x = -12; x < 69; x += 2.9) {
    const x2 = x + 2.9;
    if (inZone(x) || inZone(x2)) continue;
    const z1 = railZ(x), z2 = railZ(x2), b1 = shellH(x, z1) - 0.12, b2 = shellH(x2, z2) - 0.12;
    T(V3(x, b1, z1), V3(x, b1 + 0.72, z1), 0.07, { sharpen: 0.08 });
    woodG.push(timber(V3(x, b1 + 0.5, z1 + 0.02), V3(x2, b2 + 0.5, z2 + 0.02), { r: 0.085, r2: 0.08, rng, mask: wmask, sides: 6, bow: 0.01 }));
    if (rng.next() < 0.5) rope(sagLine(V3(x, b1 + 0.7, z1), V3(x2, b2 + 0.7, z2), 0.12, 6), 0.018);
  }
  for (const zn of ringZones) {
    for (const [x, s] of [[zn.x0, -1], [zn.x1, 1]]) {
      const z = rimZ(x) - 0.16, base = shellH(x, 2.8) - 0.12;
      redG.push(timber(V3(x, base - 0.25, z), V3(x, base + 0.35, z), { r: 0.09, r2: 0.08, rng, mask: wmask, sides: 6 }));
      redG.push(timber(V3(x, base + 0.26, z), V3(x - s * 0.32, base + 0.3, z), { r: 0.045, rng, mask: wmask, sides: 5 }));

      // The warning posts mark the drop by themselves. Cross-lane pennants and snapped
      // rail ends formerly occupied the boss camera-to-fighter sightline.

    }
  }

  // ---- env-r33 VARIANTS: four supported, lashed add-on families (one per hut, seeded table), plus spreader feet and
  // lashings for every stilt. Rear/side only: everything stays at z <= -4.6 (lane edge -2.4) and below the eaves, so
  // the open belt and the head/neck view over the huts are unchanged. Merged into the existing wood/rope meshes;
  // thatch roofs/bundles and nets add exactly two draws (villageThatchX, villageNets). Low: fewer lashing turns,
  // coarser nets. Deterministic: own rng (3303) so the original village rng stream (lanterns, props) is untouched.
  const vr = rngFrom(3303);
  const lowQ = q.name === 'low';
  const TV = (a, b, r, o = {}) => woodG.push(timber(a, b, { r, r2: r * 0.9, rng: vr, mask: wmask, sides: 5, ...o }));
  const plankV = (x, y, z, w, d, yaw, th = 0.06) => woodG.push(xform(panel(w, th, d), { pos: [x, y, z], rot: [0, yaw, (vr.next() - 0.5) * 0.03] }));
  const thatchG = [], netG = [];
  const stats = { feet: 0, lashings: 0, families: [] };
  const footAt = (x, z, yaw) => {
    const y = shellH(x, z), sl = (shellH(x, z + 0.2) - shellH(x, z - 0.2)) / 0.4, sx = (shellH(x + 0.2, z) - shellH(x - 0.2, z)) / 0.4;
    woodG.push(xform(panel(0.5, 0.08, 0.32), { pos: [x, y + 0.025, z], rot: [-Math.atan(sl) * Math.cos(yaw), yaw, Math.atan(sx)] }));
    stats.feet++;
    return y;
  };
  // rope lashing: n turns of a thin rope ring round a member at p (axis dir), radius r
  const lash = (p, dir, r, n = 2) => {
    if (lowQ) n = 1;
    const seg = lowQ ? 5 : 7;
    const d = dir.clone().normalize(), a = Math.abs(d.y) < 0.9 ? V3(0, 1, 0).cross(d).normalize() : V3(1, 0, 0).cross(d).normalize(), b = d.clone().cross(a);
    for (let k = 0; k < n; k++) {
      const c = p.clone().addScaledVector(d, (k - (n - 1) / 2) * 0.055), pts = [];
      for (let i = 0; i <= seg; i++) { const t = i / seg * Math.PI * 2; pts.push(c.clone().addScaledVector(a, Math.cos(t) * (r + 0.02)).addScaledVector(b, Math.sin(t) * (r + 0.02))); }
      ropeG.push(tube(pts, pts.map(() => 0.017), { sides: 3, cap: false }));
      stats.lashings++;
    }
  };
  const post = (x, z, yTop, r, yaw) => { const g = footAt(x, z, yaw); TV(V3(x, g + 0.02, z), V3(x, yTop, z), r); lash(V3(x, g + 0.12, z), V3(0, 1, 0), r); return g; };
  // lumpy thatch sheet across 4 corners (p00 p10 = top edge, p01 p11 = bottom edge) + a rolled eave; uv = metres
  const thatchSheet = (p00, p10, p01, p11, seed) => {
    const cell = lowQ ? 0.42 : 0.28, Lu = p00.distanceTo(p10), Lv = p00.distanceTo(p01), nu = Math.max(4, Math.ceil(Lu / cell)), nv = Math.max(3, Math.ceil(Lv / cell));
    const nrm = p10.clone().sub(p00).cross(p01.clone().sub(p00)).normalize(); if (nrm.y < 0) nrm.negate();
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      const p = p00.clone().lerp(p10, u).lerp(p01.clone().lerp(p11, u), v);
      const lump = (fbm2(u * Lu * 1.1 + seed, v * Lv * 1.2, 5, 3) - 0.5) * 0.09 + 0.05;
      p.addScaledVector(nrm, lump); if (j === nv) p.y -= (fbm2(u * Lu * 3 + seed, 1, 9, 2) - 0.5) * 0.12;
      pos.push(p.x, p.y, p.z); uv.push(u * Lu, v * Lv);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + nu + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    M.addMask(g); thatchG.push(g);
    const eave = []; for (let i = 0; i <= nu; i++) eave.push(p01.clone().lerp(p11, i / nu).addScaledVector(nrm, 0.02));
    thatchG.push(tube(eave, eave.map(() => 0.075), { sides: 6, rng: vr, jitter: 0.25, cap: false }));
  };
  // reed / fish bundle: lumpy tube in thatch, tied with two lashings
  const bundle = (a, b, r) => {
    const pts = [], rad = [];
    for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push(a.clone().lerp(b, t)); rad.push(r * (0.75 + 0.35 * Math.sin(t * Math.PI)) * (0.9 + vr.next() * 0.2)); }
    thatchG.push(tube(pts, rad, { sides: lowQ ? 5 : 7, rng: vr, jitter: 0.2, cap: true }));
    const d = b.clone().sub(a); lash(a.clone().lerp(b, 0.22), d, r * 0.8, 1); lash(a.clone().lerp(b, 0.78), d, r * 0.8, 1);
  };
  // fishing net hung over a bar a→b: front + back drapes, sagging between ties, ragged hem (uv = metres)
  const netDrape = (a, b, hang, seed) => {
    const L = a.distanceTo(b), nu = Math.max(5, Math.ceil(L / (lowQ ? 0.4 : 0.22))), nv = lowQ ? 4 : 7;
    const along = b.clone().sub(a).normalize(), out = V3(0, 1, 0).cross(along).normalize();
    for (const side of [1, -1]) {
      const pos = [], uv = [], idx = [];
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        const hem = hang * (0.72 + 0.38 * fbm2(u * L * 0.9 + seed + side, 3, 17, 3));
        const p = a.clone().lerp(b, u);
        p.y -= v * hem + Math.sin(u * Math.PI) * 0.12 * v;
        p.addScaledVector(out, side * (0.035 + v * 0.16 + Math.sin(u * L * 2.1 + seed) * 0.05 * v));
        pos.push(p.x, p.y, p.z); uv.push(u * L, v * hem);
      }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a0 = j * (nu + 1) + i, b0 = a0 + nu + 1; idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      M.addMask(g); netG.push(g);
    }
  };
  // spreader feet + lashings under every existing stilt (the six per hut built above)
  for (const h of HUTS) {
    const hw = (h.w ?? 5) / 2 + 0.6, hd = (h.d ?? 3.7) / 2 + 0.6, cs = Math.cos(h.yaw), sn = Math.sin(h.yaw);
    for (const [u, v] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, -hd], [0, hd]]) {
      const x = h.x + u * 0.95 * cs + v * 0.95 * sn, z = h.z - u * 0.95 * sn + v * 0.95 * cs;
      footAt(x, z, h.yaw); if (!lowQ) lash(V3(x, shellH(x, z) + 0.1, z), V3(0, 1, 0), 0.12);
    }
  }
  HUTS.forEach((h, hi) => {
    const F = HUT_FAMILY[hi % HUT_FAMILY.length], s = F.side, P = platforms[hi];
    const w = h.w ?? 5, d = h.d ?? 3.7, wallH = F.wallH, floor = P.y, base = floor + 0.06;
    const cs = Math.cos(h.yaw), sn = Math.sin(h.yaw);
    const W = (u, y, v) => V3(h.x + u * cs + v * sn, y, h.z - u * sn + v * cs);
    const hw = w / 2 + 0.6;
    stats.families.push(F.kind);
    if (F.kind === 'leanto') {
      // shed roof on the gable end: wall plate under the main gable, two posts on spreader feet, deck at floor level
      const L = 2.0 + vr.next() * 0.4, u0 = s * (w / 2 + 0.05), u1 = s * (w / 2 + L), vb = -d / 2 - 0.1, vf = d / 2 + 0.0;
      const yHi = base + wallH - 0.42, yLo = base + 0.78;
      TV(W(u0, yHi, vb - 0.2), W(u0, yHi, vf + 0.2), 0.07);                                    // wall plate
      for (const v of [vb, vf]) { const p = W(u1, 0, v); post(p.x, p.z, yLo + 0.05, 0.085, h.yaw); }
      TV(W(u1, yLo, vb - 0.25), W(u1, yLo, vf + 0.25), 0.075);                                 // outer beam
      for (const v of [vb, vf]) lash(W(u1, yLo, v), V3(0, 1, 0), 0.085);
      for (const v of [vb, 0, vf]) TV(W(u0, yHi + 0.05, v), W(u1 + s * 0.3, yLo - 0.06, v), 0.045);   // rafters
      for (let u = u0 + s * 0.15; s * (u1 - u) > -0.1; u += s * 0.3) plankV(W(u, floor + 0.03, 0).x, floor + 0.03, W(u, floor + 0.03, 0).z, 0.27, d + 0.2, h.yaw);
      thatchSheet(W(u0 + s * 0.02, yHi + 0.16, vf + 0.25), W(u0 + s * 0.02, yHi + 0.16, vb - 0.25), W(u1 + s * 0.42, yLo - 0.02, vf + 0.25), W(u1 + s * 0.42, yLo - 0.02, vb - 0.25), hi * 7.1);
      // under it: stacked reed bundles + a firewood rick against the wall
      for (let k = 0; k < (lowQ ? 2 : 4); k++) { const y = floor + 0.17 + (k > 1 ? 0.26 : 0); const uu = u0 + s * (0.35 + (k % 2) * 0.45 + (k > 1 ? 0.22 : 0)); bundle(W(uu, y, vb + 0.25), W(uu, y + 0.03, vf - 0.35), 0.13); }
      for (let k = 0; k < 5; k++) TV(W(u1 - s * 0.45, floor + 0.12 + (k % 3) * 0.13, vb + 0.4 + Math.floor(k / 3) * 0.13), W(u1 - s * 0.45, floor + 0.12 + (k % 3) * 0.13, vb + 1.3 + Math.floor(k / 3) * 0.13), 0.06);
    } else if (F.kind === 'netrack') {
      // drying rack beside the hut on the shell: two posts with braces + guy ropes, a net over the top bar, fish bar
      const ua = s * (hw + 0.7), ub = s * (hw + 3.1), v = -0.55;
      const pa = W(ua, 0, v), pb = W(ub, 0, v);
      const ga = shellH(pa.x, pa.z), gb = shellH(pb.x, pb.z), top = Math.max(ga, gb) + 2.25;
      post(pa.x, pa.z, top + 0.12, 0.08, h.yaw); post(pb.x, pb.z, top + 0.12, 0.08, h.yaw);
      const A = V3(pa.x, top, pa.z), B = V3(pb.x, top, pb.z);
      TV(A.clone().addScaledVector(B.clone().sub(A).normalize(), -0.2), B.clone().addScaledVector(B.clone().sub(A).normalize(), 0.2), 0.055);
      lash(A, B.clone().sub(A), 0.06); lash(B, B.clone().sub(A), 0.06);
      for (const [p, g] of [[pa, ga], [pb, gb]]) {                                            // raking braces to feet behind
        const back = W(0, 0, v - 1.0); const bx = p.x + (back.x - W(0, 0, v).x), bz = p.z + (back.z - W(0, 0, v).z);
        const gy = footAt(bx, bz, h.yaw); TV(V3(bx, gy + 0.03, bz), V3(p.x, top - 0.45, p.z), 0.05); lash(V3(p.x, top - 0.45, p.z), V3(0, 1, 0), 0.08);
      }
      netDrape(A.clone().lerp(B, 0.06), A.clone().lerp(B, 0.82), 1.15, hi * 3.3);
      const lo = top - 0.95;                                                                  // lower bar with hanging fish bundles
      TV(V3(pa.x, lo, pa.z), V3(pb.x, lo, pb.z), 0.035);
      for (let k = 0; k < (lowQ ? 3 : 5); k++) { const t = 0.2 + k * 0.14, c = V3(pa.x, lo, pa.z).lerp(V3(pb.x, lo, pb.z), t); bundle(c.clone().add(V3(0, -0.06, 0.06)), c.clone().add(V3(0.02, -0.5 - vr.next() * 0.15, 0.08)), 0.055); }
      rope(sagLine(A.clone(), W(ua - s * 0.9, shellH(W(ua - s * 0.9, 0, v - 0.6).x, W(ua - s * 0.9, 0, v - 0.6).z) + 0.05, v - 0.6), 0.04, 4), 0.016);
    } else if (F.kind === 'frame') {
      // tall-roof hut with a drying frame at the gable: two poles, three bars of hanging reed / fish bundles
      const ua = s * (w / 2 + 0.35), ub = s * (w / 2 + 2.05), v = -d / 2 + 0.2;
      const pa = W(ua, 0, v), pb = W(ub, 0, v);
      const top = Math.max(shellH(pa.x, pa.z), shellH(pb.x, pb.z)) + 2.6;
      post(pa.x, pa.z, top, 0.07, h.yaw); post(pb.x, pb.z, top, 0.07, h.yaw);
      for (const [k, y] of [[0, top - 0.1], [1, top - 0.85], [2, top - 1.6]]) {
        const A = V3(pa.x, y, pa.z), B = V3(pb.x, y, pb.z);
        TV(A, B, 0.035); lash(A, V3(0, 1, 0), 0.07, 1); lash(B, V3(0, 1, 0), 0.07, 1);
        const n = lowQ ? 2 : 3 + (k % 2);
        for (let i = 0; i < n; i++) { const c = A.clone().lerp(B, (i + 0.6) / (n + 0.2)); bundle(c.clone().add(V3(0, -0.04, 0.05)), c.clone().add(V3(0.03, -0.55 - vr.next() * 0.12, 0.07)), 0.07); }
      }
      TV(V3(pa.x, top - 2.0, pa.z), V3(pb.x, top - 0.2, pb.z), 0.04);                            // diagonal brace
    } else if (F.kind === 'awning') {
      // side deck on two extra stilts, a plank awning on posts lashed to the wall plate, crates and a barrel
      const u0 = s * hw, u1 = s * (hw + 2.3), vb = -d / 2 - 0.3, vf = d / 2 + 0.2;
      const yW = base + wallH + 0.25, yO = floor + 1.55;
      for (const v of [vb, vf]) { const p = W(u1, 0, v); post(p.x, p.z, yO + 0.06, 0.08, h.yaw); lash(W(u1, floor - 0.05, v), V3(0, 1, 0), 0.08); }
      TV(W(u1, floor - 0.05, vb - 0.15), W(u1, floor - 0.05, vf + 0.15), 0.07);                    // deck bearer
      for (let u = u0 + s * 0.12; s * (u1 - u) > -0.12; u += s * 0.3) plankV(W(u, floor + 0.03, (vb + vf) / 2).x, floor + 0.03, W(u, floor + 0.03, (vb + vf) / 2).z, 0.27, vf - vb + 0.3, h.yaw);
      TV(W(s * (w / 2 + 0.05), yW, vb - 0.2), W(s * (w / 2 + 0.05), yW, vf + 0.2), 0.065);
      TV(W(u1, yO, vb - 0.3), W(u1, yO, vf + 0.3), 0.07);
      for (const v of [vb, vf]) { lash(W(u1, yO, v), V3(0, 1, 0), 0.08); TV(W(u1, yO - 0.55, v), W(u1 - s * 0.6, yO, v), 0.04); }
      for (let v = vb - 0.25; v < vf + 0.3; v += 0.31) woodG.push(xform(panel(u1 - u0 + 0.5, 0.045, 0.29), { pos: [W((u0 + u1) / 2 + s * 0.12, 0, v).x, (yW + yO) / 2 + 0.07, W((u0 + u1) / 2 + s * 0.12, 0, v).z], rot: [0, h.yaw, Math.atan2(yO - yW, Math.abs(u1 - u0)) * s + (vr.next() - 0.5) * 0.04] }));
      for (const [du, dv, kind] of [[0.55, -0.4, 'crate'], [1.2, -0.55, 'barrel'], [0.6, 0.35, 'crate']]) { const p = W(u0 + s * du, 0, dv); props.push({ kind, x: p.x, y: floor + 0.06, z: p.z, yaw: vr.next() * 3, s: 0.78 + vr.next() * 0.2 }); }
      rope(sagLine(W(u1, yO + 0.05, vb), W(u1, yO + 0.05, vf), 0.15, 6), 0.016);
    }
  });
  // assemble the two new material groups (the wood / rope additions merge into villageWood / ropes below)
  if (thatchG.length) { const g = merge(thatchG); const m = new THREE.Mesh(g, mats.thatch); m.castShadow = true; m.receiveShadow = true; m.name = 'villageThatchX'; group.add(m); }
  if (netG.length) {
    const nm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.3, transparent: true, depthWrite: false });
    patchStandard(nm, {
      key: 'kcaNetX',
      // knotted diamond mesh (12 cm): anti-aliased cords carry the alpha (gaps show what is behind), and the pattern
      // filters to a uniform ~45 % veil with distance instead of shimmering
      albedo: /* glsl */`
      vec2 g = vKUv / 0.12; vec2 dd = vec2(g.x + g.y, g.x - g.y) * 0.7071;
      vec2 f = abs(fract(dd) - 0.5); vec2 fw = max(fwidth(dd), vec2(1e-4));
      float cord = max(1.0 - smoothstep(0.0, 1.4 * fw.x + 0.06, 0.5 - f.x), 1.0 - smoothstep(0.0, 1.4 * fw.y + 0.06, 0.5 - f.y));
      float far = clamp(max(fw.x, fw.y) * 2.5, 0.0, 1.0);
      cord = mix(cord, 0.45, far);
      float tone = texture2D(kNoise, vKUv * 0.35).r;
      diffuseColor.rgb *= vec3(0.17, 0.145, 0.105) * (0.75 + 0.45 * tone);
      diffuseColor.a = clamp(cord * 0.92, 0.0, 1.0);`,
    });
    const m = new THREE.Mesh(merge(netG), nm); m.castShadow = false; m.receiveShadow = true; m.renderOrder = 1; m.name = 'villageNets'; group.add(m);
  }

  // ---- assemble static meshes
  const addMesh = (list, mat, name) => { const g = merge(list); if (!g) return null; const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.name = name; group.add(m); return m; };
  addMesh(woodG, mats.wood, 'villageWood');
  addMesh(redG, mats.red, 'ringoutPosts');
  const ropeMat = new THREE.MeshStandardMaterial({ color: '#7a6c4e', roughness: 0.95 });
  // env-r33 fix (inherited): merge() leaves its input list intact, so the later flagRopes merge re-merged EVERY rope and the
  // whole rope set was drawn twice (13 056 duplicate triangles on the donor). splice: 'ropes' takes the list, 'flagRopes'
  // then holds only the prayer-flag lines. Same pixels, half the rope cost.
  addMesh(ropeG.splice(0), ropeMat, 'ropes');

  // ---- flags (instanced quads; the vertex shader flutters them)
  const flags = [];
  const palette = ['#c8902c', '#2e7a78', '#a8321e', '#d8d2c0', '#3c6a3a', '#284a78'];
  for (const L of flagLines) {
    const n = Math.max(3, Math.round(L.a.distanceTo(L.b) / 0.55));
    const pts = sagLine(L.a, L.b, L.sag, n);
    const d = L.b.clone().sub(L.a).normalize();
    rope(pts, 0.008);
    for (let i = 1; i < n; i++) flags.push({ p: pts[i], yaw: Math.atan2(-d.z, d.x), c: L.red ? (i % 2 ? '#a8241a' : '#e0d8c4') : palette[(i + flags.length) % palette.length], k: rng.next() });
  }
  addMesh(ropeG.splice(0), ropeMat, 'flagRopes');
  if (flags.length) {
    const fg = new THREE.PlaneGeometry(0.25, 0.28, 3, 1); fg.translate(0, -0.15, 0);
    const fm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
    patchStandard(fm, {
      key: 'kcaFlag2',
      vertMain: /* glsl */`
      {
        float ph = kTime * 3.1 + vKW.x * 0.9 + vKW.z * 0.4;
        float u = uv.x;
        float amp = (1.0 - uv.y) * 0.12 + 0.03;
        transformed.z += sin(ph + u * 2.4) * amp * (0.6 + 0.4 * sin(kTime * 0.7 + vKW.x));
        transformed.x += sin(ph * 0.8) * 0.02 * (1.0 - uv.y);
      }`,
      albedo: /* glsl */`
      { float fr = texture2D(kNoise, vKUv * vec2(1.0, 2.0) + vKW.xz * 0.1).r; diffuseColor.rgb *= 0.75 + 0.35 * fr; }`,
    });
    const im = new THREE.InstancedMesh(fg, fm, flags.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), col = new THREE.Color();
    flags.forEach((f, i) => {
      qq.setFromEuler(new THREE.Euler(0, f.yaw, (f.k - 0.5) * 0.2));
      m4.compose(f.p, qq, V3(1, 1, 1));
      im.setMatrixAt(i, m4); im.setColorAt(i, col.set(f.c));
    });
    im.castShadow = true; im.name = 'prayerFlags';
    group.add(im);
  }

  // ---- props (instanced): barrels + crates
  const barrelG = new THREE.LatheGeometry([...Array(9)].map((_, i) => { const t = i / 8; return new THREE.Vector2(0.27 + Math.sin(t * Math.PI) * 0.05, t * 0.78); }), 10);
  const crateG = new THREE.BoxGeometry(0.62, 0.6, 0.62); crateG.translate(0, 0.3, 0);
  for (const g of [barrelG, crateG]) M.addMask(g);
  const hoopG = new THREE.TorusGeometry(0.31, 0.018, 4, 14); hoopG.rotateX(Math.PI / 2); M.addMask(hoopG);
  const mk = (geo, mat, list, name, extra) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length * (extra ? extra.length : 1));
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion();
    let k = 0;
    for (const p of list) {
      qq.setFromEuler(new THREE.Euler(0, p.yaw, 0));
      if (extra) for (const y of extra) { m4.compose(V3(p.x, p.y + y * p.s, p.z), qq, V3(p.s, p.s, p.s)); im.setMatrixAt(k++, m4); }
      else { m4.compose(V3(p.x, p.y, p.z), qq, V3(p.s, p.s, p.s)); im.setMatrixAt(k++, m4); }
    }
    im.castShadow = true; im.receiveShadow = true; im.name = name; group.add(im);
  };
  const barrels = props.filter((p) => p.kind === 'barrel'), crates = props.filter((p) => p.kind === 'crate');
  mk(barrelG, mats.wood, barrels, 'barrels');
  mk(crateG, mats.wood, crates, 'crates');
  mk(hoopG, M.metal({ color: '#3a3632', rust: '#4a2a18', rustAmount: 0.5 }), barrels, 'barrelHoops', [0.14, 0.64]);

  // ---- lanterns: paper body (emissive), wooden cap, halo sprites; CPU-swung each frame with the sway
  const bodyG = new THREE.LatheGeometry([...Array(9)].map((_, i) => { const t = i / 8; return new THREE.Vector2(0.04 + Math.sin(t * Math.PI) * 0.17, -t * 0.42); }), 10);
  const capG = new THREE.CylinderGeometry(0.1, 0.12, 0.06, 8); capG.translate(0, 0.0, 0);
  const lanMat = new THREE.MeshStandardMaterial({ color: '#e0a060', emissive: '#ff9a40', emissiveIntensity: 2.4, roughness: 0.8 });
  const lanRed = new THREE.MeshStandardMaterial({ color: '#c04030', emissive: '#ff4a2a', emissiveIntensity: 2.2, roughness: 0.8 });
  const capMat = new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 0.9 });
  const warm = lanterns.filter((l) => !l.red), red = lanterns.filter((l) => l.red);
  const imW = new THREE.InstancedMesh(bodyG, lanMat, warm.length), imR = new THREE.InstancedMesh(bodyG, lanRed, Math.max(1, red.length));
  const imC = new THREE.InstancedMesh(capG, capMat, lanterns.length);
  imR.count = red.length;
  for (const im of [imW, imR, imC]) { im.name = 'lanterns'; group.add(im); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
  // halos (additive points)
  const hp = new Float32Array(lanterns.length * 3), hc = new Float32Array(lanterns.length * 3);
  lanterns.forEach((l, i) => { const c = new THREE.Color(l.red ? '#ff4a30' : '#ffa050'); hc.set([c.r, c.g, c.b], i * 3); });
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.BufferAttribute(hp, 3)); hg.setAttribute('color', new THREE.BufferAttribute(hc, 3));
  const haloMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 900 }, uI: { value: 1.2 } }]),
    vertexShader: /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute vec3 color; varying vec3 vC; uniform float uScale;
void main() { vC = color; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition; gl_PointSize = 1.7 * uScale / max(1.0, -mvPosition.z);
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */`
#include <common>
#include <fog_pars_fragment>
varying vec3 vC; uniform float uI;
void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-r * r * 5.0) * (1.0 - r); if (a <= 0.0) discard;
  gl_FragColor = vec4(vC * a * uI, 1.0);
  #include <fog_fragment>
  gl_FragColor.rgb *= a;
}`,
  });
  const halos = new THREE.Points(hg, haloMat); halos.frustumCulled = false; halos.name = 'lanternHalos'; group.add(halos);
  lanterns.forEach((l, i) => { l.ph = rng.next() * 6.28; l.i = i; });
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), eu = new THREE.Euler(), off = new THREE.Vector3(), one = V3(1, 1, 1);
  const swing = (t, tilt) => {
    let iw = 0, ir = 0;
    for (const l of lanterns) {
      const ax = tilt * 0.8 + Math.sin(t * 1.1 + l.ph) * 0.06, az = Math.sin(t * 0.8 + l.ph * 1.7) * 0.05 - tilt * 0.3;
      eu.set(ax, 0, az); qq.setFromEuler(eu);
      off.set(0, -l.len, 0).applyQuaternion(qq);
      const px = l.x + off.x, py = l.y + off.y, pz = l.z + off.z;
      m4.compose(V3(px, py, pz), qq, V3(l.s, l.s, l.s));
      if (l.red) imR.setMatrixAt(ir++, m4); else imW.setMatrixAt(iw++, m4);
      imC.setMatrixAt(l.i, m4);
      hp[l.i * 3] = px; hp[l.i * 3 + 1] = py - 0.2 * l.s; hp[l.i * 3 + 2] = pz;
    }
    imW.instanceMatrix.needsUpdate = true; imR.instanceMatrix.needsUpdate = true; imC.instanceMatrix.needsUpdate = true;
    hg.attributes.position.needsUpdate = true;
  };
  swing(0, 0);
  void one; void q;
  return { swing, lanterns, platforms, mats, boardwalk: BW, variants: stats };
}
