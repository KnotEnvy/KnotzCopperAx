// Stage 2 — beyond the shell: the far shores (three ridge layers: jagged cliffs, forested headlands, pale peaks),
// sea stacks with wind-bent pines standing in the lake, drifting fog banks (camera-facing soft noise cards) and low
// mist over the water. Everything here lives in the "world" group that the stage sways against the shell.
import * as THREE from 'three';
import * as M from '../../../render/materials.js';
import { shared } from '../../../render/shaderlib.js';
import { rngFrom, fbm2, merge, xform } from '../stage1/geo.js';

const ridgeH = ({ base, height, seed, jag = 1, cliff = 0 }) => (x) => {
  let h = fbm2(x * 0.012, seed, seed, 4) * height + fbm2(x * 0.05, seed * 2, seed + 3, 3) * height * 0.25 * jag;
  if (cliff) h += Math.max(0, Math.sin(x * 0.021 + seed) * 1.6 - 0.6) * cliff;
  return base + h;
};

function ridgeStrip({ x0, x1, z, base, height, seg = 240, seed = 1, jag = 1, depth = 30, cliff = 0 }) {
  // a thick silhouette band: front face + top, heights from layered noise with cliff steps
  const pos = [], idx = [];
  const H = ridgeH({ base, height, seed, jag, cliff });
  for (let i = 0; i <= seg; i++) {
    const x = x0 + (i / seg) * (x1 - x0), h = H(x);
    pos.push(x, base - 30, z, x, h, z + (fbm2(x * 0.03, 7, seed, 2) - 0.5) * 6, x, h - 2, z - depth);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 3, b = a + 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function seaStack(rng, h, r) {
  const g = new THREE.CylinderGeometry(r * 0.75, r, h, 9, 8, false);
  g.translate(0, h / 2, 0);
  const p = g.getAttribute('position');
  const s = rng.next() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x), t = y / h;
    const k = 1 + (fbm2(a * 1.3 + s, y * 0.12, 3, 3) - 0.5) * 0.7 - Math.max(0, t - 0.85) * 1.5 + (t < 0.12 ? (0.12 - t) * 2 : 0);
    p.setXYZ(i, x * k, y + (t > 0.98 ? (fbm2(x, z, 5, 2) - 0.5) * r * 0.4 : 0), z * k);
  }
  g.computeVertexNormals();
  return M.addMask(g);
}

function pine(rng, h) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.08 * h / 6, 0.16 * h / 6, h, 5); trunk.translate(0, h / 2, 0); parts.push(trunk);
  const lean = (rng.next() - 0.5) * 0.3;
  for (let i = 0; i < 4; i++) {
    const t = 0.35 + i * 0.17, w = (1 - t) * h * 0.45 + 0.3;
    const c = new THREE.ConeGeometry(w, h * 0.3, 6); c.translate(lean * t * h, t * h + h * 0.1, 0); parts.push(c);
  }
  return merge(parts.map((g) => M.addMask(g.toNonIndexed ? g : g)));
}

const FOG_V = /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute vec4 aB;     // centre x, y, z, size
attribute vec4 aC;     // aspect, seed, opacity, drift speed
uniform float kTime;
varying vec2 vUv; varying vec2 vS;
void main() {
  vUv = uv; vS = aC.yz;
  vec3 c = aB.xyz + vec3(-aC.w * kTime, 0.0, 0.0);
  c.x = mod(c.x + 150.0, 330.0) - 150.0;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 wp = c + right * position.x * aB.w * aC.x + vec3(0.0, 1.0, 0.0) * position.y * aB.w;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FOG_F = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D kNoise; uniform float kTime; uniform vec3 uColor, uLit;
varying vec2 vUv; varying vec2 vS;
void main() {
  vec2 p = vUv - 0.5;
  float n = texture2D(kNoise, vUv * vec2(0.9, 0.5) + vS.x + vec2(kTime * 0.004, 0.0)).r * 0.6 + texture2D(kNoise, vUv * 2.1 + vS.x * 3.0 - vec2(kTime * 0.006, 0.0)).g * 0.4;
  float edge = smoothstep(0.5, 0.12, length(p * vec2(1.0, 1.6)));
  float a = edge * smoothstep(0.3, 0.75, n) * vS.y;
  if (a < 0.004) discard;
  vec3 col = mix(uColor, uLit, smoothstep(0.1, 0.5, vUv.y) * 0.6 + n * 0.2);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}`;

export function buildFogBanks(list, o = {}) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const ig = new THREE.InstancedBufferGeometry();
  ig.index = geo.index; ig.setAttribute('position', geo.getAttribute('position')); ig.setAttribute('uv', geo.getAttribute('uv'));
  const aB = new Float32Array(list.length * 4), aC = new Float32Array(list.length * 4);
  list.forEach((f, i) => { aB.set([f.x, f.y, f.z, f.size], i * 4); aC.set([f.aspect ?? 2.6, f.seed ?? i * 0.37, f.opacity ?? 0.5, f.drift ?? 0.6], i * 4); });
  ig.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
  ig.setAttribute('aC', new THREE.InstancedBufferAttribute(aC, 4));
  ig.instanceCount = list.length;
  const mat = new THREE.ShaderMaterial({
    vertexShader: FOG_V, fragmentShader: FOG_F, transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(o.color || '#a8b8b4') }, uLit: { value: new THREE.Color(o.lit || '#e8e4d4') } }]),
  });
  mat.uniforms.kTime = shared.uTime; mat.uniforms.kNoise = shared.uNoise;
  const m = new THREE.Mesh(ig, mat);
  m.frustumCulled = false; m.renderOrder = 1; m.name = o.name || 'fogBanks';
  return m;
}

export function buildDistant(ctx, world) {
  const rng = rngFrom(777);
  const q = ctx.quality || {};
  const rockNear = M.rock({ color: '#3e4a48', color2: '#5a6662', top: '#4a5e3a', topAmount: 0.7 });
  const farMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, metalness: 0 });
  // three shore layers (the far one is the palest; depth grade + haze do the rest)
  const L1 = new THREE.Mesh(M.addMask(ridgeStrip({ x0: -260, x1: 360, z: -150, base: -2, height: 34, seed: 3, jag: 1.4, cliff: 18 })), rockNear);
  const L2 = new THREE.Mesh(ridgeStrip({ x0: -380, x1: 480, z: -260, base: 0, height: 70, seed: 9, jag: 1, cliff: 20 }), farMat('#52625e'));
  const L3 = new THREE.Mesh(ridgeStrip({ x0: -520, x1: 640, z: -420, base: 0, height: 130, seed: 17, jag: 0.8, depth: 60 }), farMat('#7a8a88'));
  for (const m of [L1, L2, L3]) { m.receiveShadow = false; m.castShadow = false; world.add(m); }
  L1.name = 'shoreCliffs'; L2.name = 'shoreHills'; L3.name = 'shorePeaks';
  const H1 = ridgeH({ base: -2, height: 34, seed: 3, jag: 1.4, cliff: 18 });
  // forest fringe on the near shore (dark cone clusters, one merged mesh)
  const pines = [], stacks = [];
  const pineV = [pine(rng, 7), pine(rng, 9), pine(rng, 5.5)];
  for (let x = -240; x < 350; x += 3 + rng.next() * 5) {
    const g = pineV[Math.floor(rng.next() * 3)].clone();
    const s = 0.8 + rng.next() * 0.9;
    xform(g, { pos: [x, H1(x) - 1.5, -150 - 2 - rng.next() * 10], scale: s });
    pines.push(g);
  }
  // sea stacks standing in the lake (with pines), a torii-like gate on one
  const SPOTS = [[-30, -70, 26, 5], [18, -95, 38, 7], [52, -62, 20, 4.2], [96, -88, 44, 8], [130, -58, 18, 4], [-70, -110, 34, 6], [72, -125, 30, 7]];
  for (const [x, z, h, r] of SPOTS) {
    stacks.push(xform(seaStack(rng, h, r), { pos: [x, -3, z] }));
    const n = 2 + Math.floor(rng.next() * 4);
    for (let i = 0; i < n; i++) pines.push(xform(pineV[i % 3].clone(), { pos: [x + (rng.next() - 0.5) * r * 1.1, h - 3.4, z + (rng.next() - 0.5) * r], scale: 0.6 + rng.next() * 0.5 }));
  }
  const stackMesh = new THREE.Mesh(merge(stacks), rockNear); stackMesh.name = 'seaStacks'; world.add(stackMesh);
  const pineMat = new THREE.MeshStandardMaterial({ color: '#1e2e26', roughness: 1 });
  const pineMesh = new THREE.Mesh(merge(pines), pineMat); pineMesh.name = 'pines'; world.add(pineMesh);
  // r4: fog banks sit BEHIND the tortoise head band (z < -150) so they backlight it instead of veiling it
  // fog banks: over the lake between the stacks, hugging the far shore, and low mist over the near water
  const banks = [];
  for (let i = 0; i < (q.name === 'low' ? 18 : 30); i++) banks.push({ x: -120 + rng.next() * 300, y: 2 + rng.next() * 10, z: -150 - rng.next() * 80, size: 18 + rng.next() * 26, aspect: 2.2 + rng.next() * 1.6, opacity: 0.35 + rng.next() * 0.3, drift: 0.4 + rng.next() * 0.5 });
  for (let i = 0; i < 12; i++) banks.push({ x: -150 + rng.next() * 330, y: 10 + rng.next() * 16, z: -160 - rng.next() * 60, size: 40 + rng.next() * 30, aspect: 3, opacity: 0.5, drift: 0.25 });
  const lowMist = [];
  for (let i = 0; i < (q.name === 'low' ? 10 : 18); i++) lowMist.push({ x: -40 + rng.next() * 150, y: -0.4, z: 5.5 + rng.next() * 5, size: 3 + rng.next() * 2.5, aspect: 4.5, opacity: 0.22 + rng.next() * 0.12, drift: 0.9 });
  const fog = buildFogBanks(banks); world.add(fog);
  const mist = null; void lowMist;   // near-water mist cards washed out the fight belt (r1) — height fog covers it
  return { fog, mist };
}
