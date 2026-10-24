// Mount fire VFX (mounts agent; ENGINE_API §8): the Emberdrake FIRE BREATH cone and the Cinderwyrm fireball.
//   vfx.spawn('mount_fire', { type: 'breath', from, to, k, gy })     ONE sim tick of the breath stream: `from` = mouth,
//        `to` = far end of the hitbox reach (world {x,y,z}); k = 0..1 intensity (ramp in/out). Layers, back → front:
//        flickering flame-cone ENVELOPE (tip in the jaws, wide ragged base at the reach), hot white-yellow CORE jet,
//        rolling orange BILLOWS (churning orbs, yellow → red), licking TONGUES curling up off the top edge, ground
//        fire licks + warm floor glow under the far half, EMBERS, dark SMOKE tail, a warm point-light pulse.
//   { type: 'breath_start', from, to, gy }   ignition flash in the jaws + a ground SCORCH decal with a burning rim
//   { type: 'breath_end', from, to }         last gasp: smoke puffing from the jaws, lingering embers
//   { type: 'ball', pos, dir, gy, body }     one tick of a fireball in flight: body = the FireballMesh (shaped comet,
//                                            see makeFireballMesh) + heat halo, floor glow, tongues, embers, smoke, light
//   { type: 'ball_burst', pos, dir, gy, body, target } impact, in LAYERS (the foe stays visible): white-hot core flash, a
//                                            soft BLAST billows (open middle, alpha-eroded edges:
//                                            _mount_fireball.js), fire billows, sparks, embers, thin rising smoke, ground fire,
//                                            scorch + warm light, shake
//   (no type) = hit spark route (`hit.spark: 'mount_fire'`): hit_spark(fire) + flames licking the target's body.
// All counts scale with vfx.scale (quality=low halves). Budget: ~60 live shape quads while breathing (1 draw call).
import * as THREE from 'three';
import { sparkSpray, embers, smoke, coreGlow, cnt } from './_lib.js';
import { NOISE, FOG_ADDITIVE } from '../glsl.js';
import { makeFireballMesh, fireballAttach, fireballTick, fireballHide, fireballExplode, FIREBALL_R, FIREBALL_LEN } from './_mount_fireball.js';
export { makeFireballMesh, fireballAttach, fireballTick, fireballHide, FIREBALL_R, FIREBALL_LEN };

// ---------------------------------------------------------------- FlameCone: the breath's shaped body
// Unit open tube along +X (x 0..1, radius 1), shaped in the vertex shader (uR0 at the jaws → uR1 at the reach,
// licking wobble). Fragment: two scrolling fbm layers erode the silhouette (edges + far end dissolve into tongues),
// view-facing term = the hot core, heat → colour ramp (white-yellow / orange / red / soot) with premultiplied
// 'over' alpha so it reads on pale ground instead of washing to cream.
const CONE_VERT = /* glsl */`
uniform float uTime, uLen, uR0, uR1;
varying vec2 vUv;
varying float vFacing;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  float x = position.x;
  float r = mix(uR0, uR1, pow(x, 0.7));
  float ang = uv.y * 6.2831853;
  r *= 1.0 + 0.16 * x * sin(x * 11.0 - uTime * 16.0 + ang * 2.0) + 0.1 * x * sin(x * 5.0 - uTime * 9.0 - ang * 3.0);
  vec3 p = vec3(x * uLen, position.y * r, position.z * r);
  p.y += x * x * 0.25 * uR1;                           // heat lifts the far end a little
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 n = normalize(normalMatrix * vec3(0.0, position.y, position.z));
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;
const CONE_FRAG = /* glsl */`
uniform float uTime, uK, uReach, uSeed, uI;
varying vec2 vUv;
varying float vFacing;
#include <common>
#include <fog_pars_fragment>
${NOISE}
vec3 fireRamp(float h) {
  vec3 soot = vec3(0.10, 0.035, 0.02), red = vec3(0.78, 0.09, 0.015), ora = vec3(1.0, 0.34, 0.03), yel = vec3(1.0, 0.66, 0.16), hot = vec3(1.0, 0.93, 0.7);
  if (h < 0.22) return mix(soot, red, h / 0.22);
  if (h < 0.48) return mix(red, ora, (h - 0.22) / 0.26);
  if (h < 0.76) return mix(ora, yel, (h - 0.48) / 0.28);
  return mix(yel, hot, (h - 0.76) / 0.24);
}
void main() {
  float u = vUv.x, f = vFacing;
  // streaks stretched along the flow (licking streams) + a finer churn layer, both racing outward
  float n1 = vfxFbm(vec2(u * 2.4 - uTime * 3.6, vUv.y * 10.0) + uSeed);
  float n2 = vfxFbm(vec2(u * 8.0 - uTime * 8.0, vUv.y * 14.0 + 5.0) + uSeed * 1.7);
  float n = clamp((n1 * 0.6 + n2 * 0.4 - 0.5) * 1.8 + 0.5, 0.0, 1.0);
  // erosion: silhouette edges and the far end break up into licking tongues
  float dens = f * 1.55 - (1.0 - n) * (0.95 + u * 0.95);
  dens = smoothstep(0.0, 0.36, dens);
  dens = max(dens, (1.0 - smoothstep(0.0, 0.16, u)) * smoothstep(0.25, 0.6, f));  // solid jet at the jaws
  float reach = 1.0 - smoothstep(uReach - 0.16, uReach, u + (n - 0.5) * 0.28);
  float a = dens * reach * smoothstep(0.0, 0.035, u) * smoothstep(0.08, 0.68, f) * uK;
  if (a < 0.004) discard;
  float heat = clamp(f * f * (1.05 - u * 0.9) + (n - 0.5) * 0.9 - (1.0 - dens) * 0.3, 0.0, 1.0);
  vec3 col = fireRamp(heat) * mix(0.45, 1.7, heat * heat) * uI;
  float occ = mix(0.9, 0.3, heat);
  gl_FragColor = vec4(col * a, a * occ);
  ${FOG_ADDITIVE}
}`;
let _coneGeo = null;
function coneGeo() {
  if (_coneGeo) return _coneGeo;
  const SX = 20, SA = 18, pos = [], uv = [], idx = [];
  for (let i = 0; i <= SX; i++) for (let j = 0; j <= SA; j++) {
    const x = i / SX, a = (j / SA) * Math.PI * 2;
    pos.push(x, Math.cos(a), Math.sin(a)); uv.push(x, j / SA);
  }
  for (let i = 0; i < SX; i++) for (let j = 0; j < SA; j++) {
    const a = i * (SA + 1) + j, b = a + SA + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0, 0), 1.2);
  return (_coneGeo = g);
}
/** A beast's breath cone (one per beast; add it under the beast's body so stage prewarm links its program — it hides
 *  itself after its first draw and moves into the VFX group on the first breath). */
export function makeFlameCone() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, fog: true, transparent: true, depthWrite: false, side: THREE.FrontSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uK: { value: 0 }, uReach: { value: 1 }, uSeed: { value: 0 }, uI: { value: 1 }, uLen: { value: 3 }, uR0: { value: 0.08 }, uR1: { value: 0.7 } }]),
  });
  const m = new THREE.Mesh(coneGeo(), mat);
  m.name = 'mount_flame_cone'; m.frustumCulled = false; m.renderOrder = 16; m.castShadow = false; m.receiveShadow = false;
  m.onAfterRender = () => { if (!m.userData.live) m.visible = false; };
  m.userData.seed = Math.random() * 10;
  return m;
}
const _q = new THREE.Quaternion(), _x = new THREE.Vector3(1, 0, 0), _d = new THREE.Vector3();
function driveCone(vfx, cone, F, ux, uy, uz, L, reach, k, owner) {
  if (cone.parent !== vfx.group) { if (cone.parent) cone.parent.remove(cone); vfx.group.add(cone); }
  const U = cone.material.uniforms;
  cone.position.set(F.x, F.y, F.z);
  cone.quaternion.copy(_q.setFromUnitVectors(_x, _d.set(ux, uy, uz)));
  U.uLen.value = L; U.uR0.value = 0.07; U.uR1.value = 0.1 + 0.62;
  U.uK.value = Math.min(1, k * 1.15); U.uReach.value = reach; U.uTime.value = vfx.game.time || 0; U.uSeed.value = cone.userData.seed;
  cone.visible = true; cone.userData.live = true; cone.userData.tick = vfx.game.tick | 0;
  if (!cone.userData.watch || !vfx.emitters.includes(cone.userData.watch)) {
    cone.userData.watch = vfx.emitter(30, () => {
      U.uTime.value = vfx.game.time || 0;
      if ((vfx.game.tick | 0) - cone.userData.tick > 1 || (owner && owner.removed)) {
        cone.visible = false; cone.userData.live = false; cone.userData.watch = null;
        if (owner && owner.removed && cone.parent) cone.parent.remove(cone);
        return false;
      }
      return true;
    });
  }
}

// Fireball bodies (comet in flight + soft impact billows) live in _mount_fireball.js.

const HOT = [1.0, 0.82, 0.45], YEL = [1.0, 0.52, 0.07], ORA = [0.95, 0.24, 0.015], RED = [0.6, 0.04, 0.005];
const c = (rgb, a) => [rgb[0], rgb[1], rgb[2], a];
// Time-coherent seed so noise FLOWS instead of re-rolling every frame (flame shape: seed shifts the scroll phase).
const flow = (vfx, speed, off = 0) => { const s = ((vfx.game.time || 0) * speed + off) % 1; return s < 0 ? s + 1 : s; };

function breath(vfx, o) {
  const r = vfx.rng, k = Math.max(0.05, o.k ?? 1), F = o.from, T = o.to, gy = o.gy ?? 0, tick = vfx.game.tick | 0;
  const dx = T.x - F.x, dy = T.y - F.y, dz = T.z - F.z, L = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / L, uy = dy / L, uz = dz / L, f = dx >= 0 ? 1 : -1;
  const Lk = L * (0.3 + 0.7 * Math.min(1, k * 1.25));           // the stream shoots out, then holds full reach
  const at = (s, up = 0, side = 0) => [F.x + ux * s, F.y + uy * s + up, F.z + uz * s + side];
  const half = (s) => 0.1 + 0.62 * (s / L);                       // cone half-width at distance s

  // 1. CONE: the shaped flame body (FlameCone mesh owned by the beast: eroded-noise tube, white-hot core → orange →
  //    red → sooty edges, tongues licking off its rim and dissolving at the reach). One draw call, bounded overdraw.
  if (o.cone) driveCone(vfx, o.cone, F, ux, uy, uz, L, Lk / L, k, o.owner);
  // jaws: small bright licks right at the mouth so the stream visibly LEAVES the jaws
  for (let i = 0; i < (o.cone ? 1 : 2); i++) vfx.shape.emit({ shape: 'orb', pos: at(r.range(0.02, 0.4), r.range(-0.05, 0.05)), size: [0.42 + i * 0.12, 0.42 + i * 0.12], life: 0.05, rot: r.range(0, 6.28),
    color: [c(HOT, 1), c(YEL, 0.5)], intensity: 0.8 * k, p0: [0.6, 0.8, 4, 0.9], seed: r.range(0, 1), occ: 0.5 });
  vfx.shape.emit({ shape: 'glow', pos: at(0.15), size: [0.7 * k + 0.15, 0.55 * k + 0.12], life: 0.05, color: [c(HOT, 1), c(YEL, 0)], intensity: 1.0, p0: [2.2, 0.8] });
  // 3. BILLOWS: churning fire orbs rolling down the cone, yellow → orange → red, growing and rising.
  for (let i = 0, N = cnt(vfx, o.cone ? 1 : 2); i < N; i++) {
    const v0 = (Lk / 0.26) * r.range(0.8, 1.08), lat = r.range(-1, 1);
    vfx.shape.emit({ shape: 'orb', pos: at(r.range(0.05, 0.25)), vel: [ux * v0, uy * v0 + r.range(-0.4, 0.9), uz * v0 + lat * 1.4], drag: 3, gravity: -2.2,
      size: [0.95, 0.95], grow: [0.22, 1.45], ease: 'out', life: r.range(0.34, 0.44), rot: r.range(0, 6.28), spin: r.range(-3, 3),
      color: [c(YEL, 1), c(RED, 0)], intensity: 0.5 * k, p0: [0.62, 0.7, 2.5, 0.5], p1: [0.72, 1.2, 2.5, 0.0], seed: r.range(0, 1), occ: 0.5 });
  }
  // 4. TONGUES licking off the upper edge (and a few below), tilting further up the farther out they are = curl.
  for (let i = 0, N = (tick & 1) ? cnt(vfx, 1) : 0; i < N; i++) {
    const s = r.range(0.3, 1.0) * Lk, q = s / L, top = r.range(0, 1) < 0.75 ? 1 : -1;
    const w = half(s) * r.range(0.35, 0.8);
    const tx = ux * (1 - q * 0.55), ty = top > 0 ? uy + 0.35 + q * 1.1 : uy - 0.25, len = (0.55 + q * 0.6) * r.range(0.8, 1.2);
    const n = Math.hypot(tx, ty) || 1;
    const p = at(s, top * w, r.range(-0.3, 0.3));
    vfx.shape.emit({ shape: 'orb', pos: [p[0] + tx / n * len * 0.25, p[1] + ty / n * len * 0.25, p[2]],
      vel: [ux * 3.5, 1.4, 0], drag: 2, size: [0.5 + q * 0.2, 0.5 + q * 0.2], grow: [0.4, 1.15], ease: 'out', life: r.range(0.16, 0.24),
      color: [c(ORA, 1), c(RED, 0)], intensity: 0.7 * k, p0: [0.7, 0.7, 2.2, 0.5], seed: r.range(0, 1), occ: 0.4 });
  }
  // 5. GROUND: fire licks pooling under the far half + a warm glow on the floor (every other tick).
  if ((tick & 1) === 0 && k > 0.4) {
    const s = r.range(0.55, 1.0) * Lk, p = at(s), h = r.range(0.45, 0.85) * k;
    vfx.shape.emit({ shape: 'orb', pos: [p[0], gy + 0.15, p[2] + r.range(-0.35, 0.35)], vel: [f * 1.2, 0.9, 0],
      size: [h * 0.65, h * 0.65], grow: [0.3, 1.05], ease: 'out', life: r.range(0.16, 0.24), color: [c(YEL, 1), c(RED, 0)], intensity: 0.55, p0: [0.65, 0.8, 2.5, 0.5], seed: r.range(0, 1) });
  }
  if (tick % 3 === 0) {
    const p = at(Lk * 0.72);
    vfx.shape.emit({ shape: 'glow', mode: 'plane', pos: [p[0], gy + 0.03, p[2]], dir: [1, 0, 0], size: [Lk * 1.15, 1.6], life: 0.09,
      color: [c(ORA, 1), c(ORA, 0.4)], intensity: 0.42 * k, p0: [1.4, 0.3] });
  }
  // 6. EMBERS + sparks flung out of the stream.
  for (let i = 0, N = cnt(vfx, 2); i < N; i++) {
    const s = r.range(0.2, 1) * Lk, sp = r.range(3, 8);
    vfx.add.emit({ pos: at(s, r.range(-0.2, 0.3)), vel: [ux * sp, r.range(0.8, 4), r.range(-1.8, 1.8)], life: r.range(0.45, 0.9),
      size: [r.range(0.03, 0.05), 0.012], color: ['#ffe2a0', '#ff4a10'], intensity: 3.4, shape: 'ember', gravity: 3, drag: 1.1 });
  }
  if (r.range(0, 1) < 0.5) {
    const sp = r.range(9, 14);
    vfx.add.emit({ pos: at(0.3), vel: [ux * sp, uy * sp + r.range(0, 2), r.range(-1.5, 1.5)], life: r.range(0.18, 0.3), size: [0.03, 0.01],
      color: ['#fff0c0', '#ff7020'], intensity: 3.2, shape: 'streak', stretch: 0.02, gravity: 4, drag: 2 });
  }
  // 7. SMOKE tail off the far end (lit, dark, rising).
  if (r.range(0, 1) < 0.55 * vfx.scale + 0.1) {
    const p = at(Lk * r.range(0.8, 1.05), half(Lk) * 0.5);
    vfx.alpha.emit({ pos: p, vel: [ux * r.range(1, 2.2), r.range(1, 1.8), r.range(-0.3, 0.3)], life: r.range(0.9, 1.4), size: [0.45, 1.5],
      color: [[0.11, 0.085, 0.07, 0.6], [0.07, 0.06, 0.06, 0]], shape: 'smoke', drag: 1.3, gravity: -0.3, rot: r.range(0, 6.28), spin: r.range(-0.8, 0.8), fadeIn: 0.2 });
  }
  // 8. LIGHT: warm pulse washing the floor and the foes at the business end.
  if (vfx.light && tick % 3 === 0) {
    const p = at(Lk * 0.78);
    vfx.light({ x: p[0], y: Math.max(gy + 0.7, p[1] - 0.2), z: p[2] + 0.5 }, { color: 0xff7a28, intensity: (4.5 + r.range(0, 1.5)) * k, distance: 2.6, life: 0.12 });
  }
}

function breathStart(vfx, o) {
  const r = vfx.rng, F = o.from, T = o.to, gy = o.gy ?? 0;
  const L = Math.hypot(T.x - F.x, T.y - F.y) || 1, f = T.x >= F.x ? 1 : -1;
  const cx = F.x + (T.x - F.x) * 0.72, cz = F.z + (T.z - F.z) * 0.72;
  // Ignition: a hot flash in the jaws.
  coreGlow(vfx, F, { size: 0.9, color: '#fff0c8', tail: '#ff9030', intensity: 1.6, life: 0.12, core: 0.8 });
  // Scorch: dark lit stain appearing as the fire reaches the ground, with a slow-dying burning rim.
  vfx.shapeLit.emit({ shape: 'disc', mode: 'plane', pos: [cx, gy + 0.025, cz], dir: [1, 0, 0], size: [L * 1.05, 1.5], delay: 0.18, life: 3.4, ease: 'in',
    color: [[0.045, 0.032, 0.026, 0.8], [0.045, 0.032, 0.026, 0]], p0: [1.3, 0, 0, 0] });
  vfx.shape.emit({ shape: 'dustring', mode: 'plane', pos: [cx, gy + 0.03, cz], dir: [1, 0, 0], size: [L * 1.1, 1.6], delay: 0.22, life: 1.6, ease: 'out',
    color: [c(ORA, 1), c(RED, 0)], intensity: 0.55, p0: [0.55, 0.14, 0.0, 0.25], p1: [0.72, 0.1, 0.85, 0.1], seed: r.range(0, 1) });
  vfx.shape.emit({ shape: 'crack', mode: 'plane', pos: [cx + f * 0.2, gy + 0.035, cz], size: [1.6, 1.6], rot: r.range(0, 6.28), delay: 0.25, life: 1.4,
    color: ['#ff8a30', '#a02008'], alpha: [1, 0], intensity: 0.7, p0: [0.5, 0.03, 0, 6], p1: [0.9, 0.04, 0, 6], seed: r.range(0, 1) });
}

function breathEnd(vfx, o) {
  const F = o.from, T = o.to, f = T.x >= F.x ? 1 : -1;
  smoke(vfx, { x: F.x + f * 0.2, y: F.y - 0.1, z: F.z }, { n: 4, color: [0.12, 0.1, 0.09], alpha: 0.5, size: [0.2, 0.8], rise: [0.5, 1.1], spread: 0.12, life: [0.8, 1.3] });
  embers(vfx, { x: F.x + (T.x - F.x) * 0.6, y: F.y + (T.y - F.y) * 0.6, z: F.z }, { n: 6, dir: f, speed: [0.5, 2], up: [0.5, 2], gravity: 1.2, life: [0.6, 1.1] });
}

function ball(vfx, o) {
  const r = vfx.rng, p = o.pos, d = o.dir >= 0 ? 1 : -1, tick = vfx.game.tick | 0, gy = o.gy ?? 0;
  if (!o.body) {
    // fallback (no FireballMesh): churning orb + trailing flame quad
    vfx.shape.emit({ shape: 'orb', pos: [p.x, p.y, p.z], size: [1.0, 1.0], life: 0.034, rot: r.range(0, 6.28), color: [c(YEL, 1), c(ORA, 0.8)], intensity: 1.25,
      p0: [0.58, 0.9, 5, 1.0], seed: flow(vfx, 0.6), occ: 0.35 });
    vfx.shape.emit({ shape: 'flame', mode: 'axial', pos: [p.x - d * 0.7, p.y + 0.04, p.z], dir: [-d, 0.06, 0], size: [1.9, 1.1], life: 0.034,
      color: [c(YEL, 1), c(RED, 0.5)], intensity: 1.1, p0: [0.75, 1.1, 2, 0.5], seed: flow(vfx, 0.5, 0.3), occ: 0.25 });
  }
  // heat halo just around the head (thin, so the shaped body carries the read) + warm pool of light on the floor under it
  if (!o.body) vfx.shape.emit({ shape: 'glow', pos: [p.x + d * 0.05, p.y, p.z], size: [1.35, 1.35], life: 0.034, color: [c(ORA, 1), c(RED, 0)], intensity: 0.3, p0: [2.4, 0.2] });
  vfx.shape.emit({ shape: 'glow', mode: 'plane', pos: [p.x - d * 0.35, gy + 0.03, p.z], dir: [1, 0, 0], size: [2.6, 1.3], life: 0.034,
    color: [c(ORA, 1), c(RED, 0.3)], intensity: 0.55, p0: [1.6, 0.3] });
  // Wake: sparse licking tongues shed off the tail, ember drips, a thin rising dark smoke thread.
  // Soft comet tail and embers carry the wake; axial flame quads read as loose paper scraps.
  if (r.range(0, 1) < 0.8 * vfx.scale + 0.2) vfx.add.emit({ pos: [p.x - d * r.range(0.15, 0.45), p.y + r.range(-0.15, 0.2), p.z], vel: [-d * r.range(0.5, 2), r.range(-0.5, 1.5), r.range(-0.8, 0.8)], life: r.range(0.4, 0.8),
    size: [0.04, 0.012], color: ['#ffe0a0', '#ff4010'], intensity: 3.4, shape: 'ember', gravity: 4, drag: 1.2 });
  if ((tick % 3) === 0) vfx.alpha.emit({ pos: [p.x - d * 0.40, p.y + 0.15, p.z], vel: [-d * 0.3, r.range(0.7, 1.2), 0], life: r.range(0.16, 0.24), size: [0.12, 0.32],
    color: [[0.06, 0.05, 0.045, 0.5], [0.05, 0.045, 0.045, 0]], shape: 'smoke', drag: 1.2, rot: r.range(0, 6.28), spin: r.range(-0.6, 0.6), fadeIn: 0.25 });
  if (vfx.light && tick % 4 === 0) vfx.light({ x: p.x, y: Math.max(gy + 0.5, p.y - 0.3), z: p.z + 0.4 }, { color: 0xff7a28, intensity: 5.5, distance: 2.6, life: 0.1 });
}

// IMPACT = layers, none of which is an opaque ball (the struck foe stays readable through all of it):
//   1 white-hot core flash (additive, < 0.1 s)      2 soft eroded billows wrapping the chest, with an open middle
//   3 small fire billows flung outward             4 sparks + embers                5 thin lit SMOKE that rises and thins
//   6 ground fire + scorch decal (burning rim) + floor glow + a brief warm light on the floor
function ballBurst(vfx, o) {
  const r = vfx.rng, d = o.dir >= 0 ? 1 : -1, gy = o.gy ?? 0, t = o.target, b = o.pos;
  // centre on the struck foe's near side (the projectile detonates up to ~0.9 m short of his centre)
  const p = t ? { x: t.x, y: t.y + 0.1, z: t.z + 0.12 } : b;
  // The projectile supplies a chest snapshot. Resolve its actor for this short cosmetic attachment so the
  // launch reaction cannot leave a ring hanging behind the victim. No damage/collision state is changed.
  const victim = t && vfx.game.world.actors.find((a) => a.pos && a.kind !== 'mount' && a.kind !== 'projectile'
    && Math.abs(a.pos.x - t.x) < 0.02 && Math.abs(a.pos.z - t.z) < 0.02);
  if (o.body) fireballExplode(vfx, o.body, p, r.range(0, 10), victim, d);
  else {
    // No borrowed body (debug/effect showcase): small ignition, no paper-star fallback.
    coreGlow(vfx, p, { size: 0.65, color: '#fff3b0', tail: '#ff7a16', intensity: 3.6, life: 0.065, core: 0.5 });
    for (let i = 0, N = cnt(vfx, 6); i < N; i++) {
      const a = i / N * Math.PI * 2;
      vfx.shape.emit({ shape: 'orb', pos: [p.x + Math.cos(a) * 0.4, p.y + Math.sin(a) * 0.35, p.z],
        vel: [Math.cos(a), Math.sin(a) + 0.5, 0], size: [0.65, 0.65], grow: [0.7, 1.2], life: 0.3,
        color: ['#ff8a12', '#c02006'], alpha: [0.6, 0], intensity: 0.7, occ: 0.6, p0: [0.6, 0.9, 3, 0.15] });
    }
  }
  // 4. sparks + embers
  sparkSpray(vfx, p, { x: d, y: 0.4, z: 0 }, { n: 20, speed: [6, 12], cone: 0.85, up: 0.6, color: ['#fff0c0', '#ff5010'], floor: gy });
  embers(vfx, p, { n: 34, dir: d, speed: [0.8, 4.0], up: [2.0, 6], spread: 1.6, life: [0.55, 1.1], intensity: 4.2, size: [0.035, 0.012] });
  // Soft neutral wisps live in the private blast; existing particles supply the ember-only linger.
  // Overlapping matte char lobes form a filled, uneven stain: no emissive ring or crack glyph.
  const charAngle = r.range(0, 6.28);
  // Preserve the four cosmetic draws formerly used by the ring/crack, including later shots.
  for (let i = 0; i < 4; i++) r.range(0, 1);
  for (const [x, z, w, h] of [[0, 0, 2.0, 1.25], [-0.48, 0.12, 1.1, 0.8], [0.45, -0.18, 0.85, 0.95]]) {
    vfx.shapeLit.emit({ shape: 'disc', mode: 'plane', pos: [p.x + x, gy + 0.025, p.z + z],
      size: [w, h], rot: charAngle, life: 3.2, ease: 'in',
      color: [[0.018, 0.017, 0.016, 0.75], [0.018, 0.017, 0.016, 0]], p0: [1.1, 0, 0, 0] });
  }
  const cam = vfx.game.cameraRig;
  if (cam && cam.shake) cam.shake(0.18);
  if (vfx.light) {
    // Existing capped light pool: at the chest, close to the skin, instead of under the victim's feet.
    const chest = victim && victim.modelRoot && victim.modelRoot.getObjectByName('chest');
    const warm = new THREE.Vector3(p.x, p.y, p.z);
    if (chest) chest.getWorldPosition(warm);
    warm.z += 0.6;
    vfx.light(warm, { color: 0xff8d32, intensity: 6, distance: 2.6, life: 0.3 });
  }
}

function hitLicks(vfx, o) {
  if (o.moveId === 'beast_fireball') return; // blast owns all flames: no flat hit-lick scraps
  vfx.spawn('hit_spark', { ...o, element: 'fire', type: undefined });   // the fireball's blast IS the impact (no comic spikes)
  const t = o.target, r = vfx.rng;
  if (!t || !t.pos) return;
  const H = t.height || 1.8, gy = t.pos.y || 0;
  for (let i = 0, N = cnt(vfx, 2); i < N; i++) {
    const h = r.range(0.35, 0.6);
    vfx.shape.emit({ shape: 'orb', pos: [t.pos.x + r.range(-0.25, 0.25), gy + r.range(0.3, 0.8) * H, t.pos.z + 0.2], vel: [r.range(-0.4, 0.4), 1.2, 0],
      size: [h, h], grow: [0.4, 1.1], ease: 'out', life: r.range(0.18, 0.28), delay: i * 0.05, color: [c(YEL, 1), c(RED, 0)], intensity: 0.65, p0: [0.6, 0.8, 2.5, 0.4], seed: r.range(0, 1) });
  }
  if (o.knockdown) smoke(vfx, { x: t.pos.x, y: gy + H * 0.5, z: t.pos.z }, { n: 3, color: [0.1, 0.09, 0.08], alpha: 0.5, size: [0.3, 1.0], rise: [0.8, 1.4], spread: 0.25, life: [0.8, 1.2] });
}

const TYPES = { breath, breath_start: breathStart, breath_end: breathEnd, ball, ball_burst: ballBurst };

export default {
  id: 'mount_fire',
  spawn(vfx, o = {}) { return (TYPES[o.type] || hitLicks)(vfx, o); },
};
