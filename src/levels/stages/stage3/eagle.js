// Stage 3 — the colossal eagle (hero creature, ~22 m beak to tail, ~55 m span). Eagle-local space = world space at
// rest: it flies toward +X, the fight belt is its broad back (x −8.8..4.6, |z| ≤ 2.2), the far wing (−Z) rises behind
// the belt as a huge feathered backdrop, the near wing (+Z) sweeps back under the lower frame, the tail fan cocks up at
// the left edge and the neck + head (Blender env_stage3_eagle.glb) rise at the right edge.
//
// Everything but the head is procedural feather geometry (./feathers.js): body contour feathers shingled over a
// superellipse hull, 4 covert rows + secondaries + splayed primaries per wing, 12 barred rectrices. The wings bend in
// the vertex shader (uWing), feathers flutter in the wind, the back ruffles under footsteps (uFeet).
//
//   const eagle = await buildEagle(ctx, { ringZones })
//   eagle.deckY(x, z) → rest height of the walkable feather surface (eagle-local)
//   eagle.update(dt, t, { feet, bank, gust }) → pose (heave/roll/pitch applied to eagle.group)
//   eagle.screech() · eagle.look(yaw, pitch) · eagle.group · eagle.heave / eagle.roll / eagle.pitch
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

const lerp = (a, b, t) => a + (b - a) * t;
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
  const dx = 0.34;
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
    const sp = 0.31 * (1 - 0.3 * tailT);
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
      let type = flank ? FT.covert : FT.contour, len = 0.84 * (1 - 0.3 * tailT), wid = 0.54 * (1 - 0.3 * tailT);
      if (neckT > rng.next() * 0.9 + 0.1 && Math.abs(phi) < 1.4) { type = FT.gold; len *= 1.15; wid *= 0.85; }
      if (lip) { type = FT.edge; len *= 1.12; }
      // r2 fight lane: pale cool down along the spine where the fighters stand (value separation from the dark
      // mantle around it) — soft-edged in z, faded out toward the tail rump and the neck base
      const laneX = THREE.MathUtils.smoothstep(x, -7.4, -5.6) * (1 - THREE.MathUtils.smoothstep(x, 2.6, 4.2));
      const lane = laneX * (1 - THREE.MathUtils.smoothstep(Math.abs(p0.z), 1.35, 2.35));
      const rl = rng.next();
      const down = !lip && type !== FT.gold && lane > 0.15 + 0.7 * rl;
      if (down) { type = FT.edge; len *= 0.9; wid *= 1.05; }
      // scapulars: big overlapping feathers over the wing roots
      if (Math.abs(phi) > 0.55 && Math.abs(phi) < 1.15 && x > -3.6 && x < 3.8) { len *= 1.55; wid *= 1.3; }
      const r = rng.next();
      const patch = 0.88 + 0.12 * Math.sin(x * 0.9 + p0.z * 1.3) + 0.08 * Math.sin(x * 2.3 - p0.z * 0.7);
      const shade = (0.5 + 0.26 * r) * patch * (0.92 + 0.16 * Math.sin(col * 1.7 + p0.z * 0.4));
      // mantle around the lane goes darker so the pale lane (and the fighters on it) pop
      const mantle = 1 - 0.32 * laneX * THREE.MathUtils.smoothstep(Math.abs(p0.z), 1.9, 2.9) * (1 - lane);
      const dv = 0.86 + 0.14 * r;
      const warm = type === FT.gold ? [1.05, 0.98, 0.9]
        : down ? [0.96 * dv, 0.97 * dv, 1.0 * dv]
        : [1.02 * shade * mantle, 0.97 * shade * mantle, 0.9 * shade * mantle];
      const r2 = rng.next();
      list.push({ p: [p0.x + (r2 - 0.5) * 0.14, p0.y, p0.z], d: [d[0], d[1], d[2] + (r - 0.5) * 0.3], n: n0.toArray(), len: len * (0.9 + 0.2 * r2), wid, type, tint: warm, rand: r,
        flut: lip ? 1.0 : down ? 0.14 : 0.08 + 0.25 * Math.abs(side) + 0.2 * tailT, lift: 0.085 + 0.03 * r, cup: 0.3, arch: 0.02, twist: (r - 0.5) * 0.12 });
    }
  }
  return { hull, feathers: buildFeathers(list, { nv: 5 }), count: list.length };
}

// ---------------------------------------------------------------- wing (local: span +z, chord −x from the leading edge)
function buildWing(rng) {
  const L = EAGLE.wing.L, sw = L * 0.5;
  const le = (s) => -0.1 * s - 0.9 * Math.pow(Math.max(0, s - sw) / (L - sw), 2) * 2;
  const list = [];
  const push = (p, d, len, wid, type, o = {}) => {
    const r = rng.next();
    const shade = (0.55 + 0.35 * r) * (o.tone ?? 1);
    const jl = 0.88 + 0.24 * rng.next();
    d = [d[0], d[1], d[2] + (rng.next() - 0.5) * 0.12];
    len *= jl;
    list.push({ p, d, n: [0, 1, 0], len, wid, type, tint: [shade, shade * 0.95, shade * 0.88], rand: r, flut: o.flut ?? 0.15,
      lift: o.lift ?? 0.06, cup: o.cup ?? 0.22, arch: o.arch ?? 0.025, twist: o.twist ?? (r - 0.5) * 0.1 });
  };
  // primaries: 10 from the hand, fanning from backward (inner) to outward (outer); outer 6 separated "fingers"
  for (let i = 0; i < 10; i++) {
    const k = i / 9;
    const bz = lerp(sw, L * 0.8, k);
    const bx = le(bz) - 1.3 + 0.35 * k;
    const a = THREE.MathUtils.degToRad(lerp(14, 78, Math.pow(k, 0.9)));
    const len = lerp(6.2, 8.8, Math.pow(k, 0.7)) * (i === 9 ? 0.86 : 1);
    push([bx, 0.0 + i * 0.012, bz], [-Math.cos(a), 0.0, Math.sin(a)], len, i > 3 ? 1.05 : 1.5, FT.primary,
      { flut: 0.35 + 0.3 * k, lift: 0.05 + 0.05 * k, cup: 0.12, arch: 0.04, twist: -0.18 * k });
  }
  // secondaries + tertials along the arm (tips form the scalloped trailing edge)
  for (let s = 0.2; s < sw + 0.4; s += 0.78) {
    const k = s / sw;
    const len = lerp(6.0, 5.0, k) + (s < 1.6 ? 0.8 : 0);
    push([le(s) - 2.4, 0.04, s], [-1, 0, 0.12 + 0.18 * k], len, 1.75, FT.secondary, { flut: 0.2, lift: 0.04 });
  }
  // covert rows: marginal → lesser → median → greater (leading-edge rows on top)
  const rows = [
    { off: 0.15, len: 1.3, wid: 1.05, type: FT.covert, y: 0.15, sp: 0.46, to: L * 0.86 },
    { off: 0.8, len: 1.8, wid: 1.3, type: FT.covert, y: 0.12, sp: 0.55, to: L * 0.8 },
    { off: 1.6, len: 2.4, wid: 1.5, type: FT.covert, y: 0.09, sp: 0.66, to: sw + 3.2 },
    { off: 2.5, len: 3.1, wid: 1.7, type: FT.greater, y: 0.06, sp: 0.8, to: sw + 1.6 },
  ];
  rows.forEach((r, ri) => {
    for (let s = 0.1 + (ri % 2) * r.sp * 0.5; s < r.to; s += r.sp * (0.8 + 0.4 * rng.next())) {
      const hand = Math.max(0, (s - sw) / (L - sw));
      const f = 1 - 0.45 * hand;
      const tone = [1.25, 1.0, 0.85, 0.75][ri] * (0.9 + 0.2 * Math.sin(s * 0.7 + ri));
      push([le(s) - r.off * f + (rng.next() - 0.5) * 0.25, r.y * f, s], [-1, 0, 0.25 * hand + 0.06], r.len * f, r.wid * f, r.type, { flut: 0.1 + 0.2 * hand, lift: 0.025, cup: 0.3, arch: 0.015, tone });
    }
  });
  // primary coverts over the base of the primaries
  for (let i = 0; i < 9; i++) {
    const k = i / 8, bz = lerp(sw - 0.4, L * 0.84, k);
    const a = THREE.MathUtils.degToRad(lerp(15, 70, k));
    push([le(bz) - 0.9 + 0.4 * k, 0.2, bz], [-Math.cos(a), 0, Math.sin(a)], 2.6 - 0.5 * k, 1.2, FT.greater, { flut: 0.2, lift: 0.07 });
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
    list.push({ p: [0.2, 0.02 * Math.abs(k) * 8, k * 1.0], d: [-Math.cos(a), 0, Math.sin(a)], n: [0, 1, 0], len: T.len * (1 - 0.1 * Math.abs(k) * 2), wid: 1.3,
      type: FT.tail, tint: [0.9 + 0.2 * r, 0.88 + 0.2 * r, 0.86 + 0.2 * r], rand: r, flut: 0.3, lift: 0.03, cup: 0.14, arch: 0.03, twist: (r - 0.5) * 0.12 });
  }
  // upper tail coverts (2 rows) + rump feathers overlapping the fan base
  for (let row = 0; row < 2; row++) for (let i = 0; i < 9; i++) {
    const k = i / 8 - 0.5, a = THREE.MathUtils.degToRad(T.spread * 0.7) * k * 2, r = rng.next();
    list.push({ p: [0.9 - row * 0.9, 0.16 + 0.1 * (1 - row), k * 2.0], d: [-Math.cos(a), 0, Math.sin(a)], n: [0, 1, 0], len: 2.6 - row * 0.6, wid: 1.0,
      type: FT.covert, tint: [0.9 + 0.2 * r, 0.86 + 0.2 * r, 0.8 + 0.2 * r], rand: r, flut: 0.2, lift: 0.06, cup: 0.25, arch: 0.02 });
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
  const rng = rngFrom(3303);
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
