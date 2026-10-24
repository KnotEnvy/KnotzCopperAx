// Stage 2 — the village on the shell: stilt huts on the dome (stage-1 hut builder, intact + weathered, reed thatch),
// a boardwalk behind the belt, ladders, rope bridges between hut platforms, paper lanterns (swing with the sway),
// prayer-flag lines (wind flutter), barrels/crates, a low log rail along the near lip that is ABSENT over the ring-out
// zones (marked by red warning posts, banners and bells), hanging lake-weed along the lip, moss/fern tufts.
// Everything static is merged per material; lanterns/flags/props are instanced.
import * as THREE from 'three';
import * as M from '../../../render/materials.js';
import { patchStandard } from '../../../render/shaderlib.js';
import { buildHut } from '../stage1/huts.js';
import { timber, tube, panel, merge, xform, rngFrom, V3 } from '../stage1/geo.js';
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
    const r = buildHut({ wallH: 1.55, rise: 1.25, ...h, y: floor + 0.06, mats, burning: 0, char: 0, collapse: 0 }, rng);
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

  // ---- assemble static meshes
  const addMesh = (list, mat, name) => { const g = merge(list); if (!g) return null; const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.name = name; group.add(m); return m; };
  addMesh(woodG, mats.wood, 'villageWood');
  addMesh(redG, mats.red, 'ringoutPosts');
  const ropeMat = new THREE.MeshStandardMaterial({ color: '#7a6c4e', roughness: 0.95 });
  addMesh(ropeG, ropeMat, 'ropes');

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
  return { swing, lanterns, platforms, mats, boardwalk: BW };
}
