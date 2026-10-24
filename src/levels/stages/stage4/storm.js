// Stage 4 storm: a painted storm-cloud backdrop behind the keep (own shader: churning blue-violet cloud banks, a
// faint moon-glow, cloud interiors lit from within at the bolt), forked LIGHTNING bolts (branching HDR ribbons that
// bloom) in front of the backdrop and behind the keep (so the towers silhouette), and the scene flash (a cold
// DirectionalLight that lights everything, the wet-surface sky sheen s4Flash, exposure kick, delayed thunder).
import * as THREE from 'three';
import { S4 } from './shading.js';

const SKY_V = /* glsl */`
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
const SKY_F = /* glsl */`
uniform float uTime; uniform vec4 uBolt; uniform float uFlash; uniform vec3 uMoon;
varying vec3 vW;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.02 + 3.7; a *= 0.5; } return s; }
void main() {
  vec2 p = vec2(vW.x, vW.y) * 0.012;
  float y = vW.y;
  float hz = smoothstep(-10.0, 160.0, y);
  vec3 col = mix(vec3(0.030, 0.036, 0.062), vec3(0.008, 0.009, 0.020), hz);
  // two cloud decks drifting against each other, billowy (abs-fbm ridges)
  float c1 = fbm(p * vec2(0.8, 1.6) + vec2(uTime * 0.012, 0.0));
  float c2 = fbm(p * vec2(1.7, 2.6) + vec2(-uTime * 0.02, 3.0) + c1 * 0.8);
  float dens = smoothstep(0.38, 0.72, c1 * 0.65 + c2 * 0.5);
  float rim = smoothstep(0.35, 0.55, c1 * 0.65 + c2 * 0.5) - dens * 0.8;
  vec3 cloudDark = vec3(0.012, 0.014, 0.026), cloudLit = vec3(0.09, 0.1, 0.17);
  // moon glow behind the clouds (upper right) edges the banks
  float md = length((vW.xy - uMoon.xy) * vec2(1.0, 1.2));
  float moon = exp(-md * 0.012) * 0.8 + exp(-md * 0.05) * 0.8;
  col = mix(col, cloudDark, dens * 0.85);
  col += cloudLit * rim * (0.25 + moon);
  col += vec3(0.06, 0.07, 0.12) * moon * (1.0 - dens * 0.8);
  // lightning: cloud interiors light up around the bolt, the whole deck flickers
  float bd = length((vW.xy - uBolt.xy) * vec2(0.8, 1.0));
  float glow = uBolt.w * (exp(-bd * 0.012) * 1.4 + exp(-bd * 0.05) * 2.0);
  vec3 fl = vec3(0.55, 0.62, 0.95);
  col += fl * glow * (0.35 + dens * 0.9 + rim * 1.2);
  col += fl * uFlash * (0.12 + 0.35 * dens + 0.3 * (1.0 - hz));
  // haze toward the horizon (ties into the fog colour)
  col = mix(col, vec3(0.05, 0.06, 0.1) * (1.0 + uFlash * 3.0), smoothstep(40.0, -10.0, y) * 0.7);
  gl_FragColor = vec4(col, 1.0);
}
`;

function boltGeometry(rng, x0, y0, x1, y1, z) {
  // midpoint-displacement main channel + 3-6 branches; ribbon quads in the XY plane
  const chans = [];
  const split = (a, b, d, out) => {
    if (d <= 0) { out.push(b); return; }
    const m = [(a[0] + b[0]) / 2 + (rng() - 0.5) * Math.abs(b[1] - a[1]) * 0.55, (a[1] + b[1]) / 2 + (rng() - 0.5) * 4];
    split(a, m, d - 1, out); split(m, b, d - 1, out);
  };
  const main = [[x0, y0]]; split([x0, y0], [x1, y1], 6, main);
  chans.push({ pts: main, w: 1.6 });
  const nb = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < nb; i++) {
    const k = 4 + Math.floor(rng() * (main.length * 0.6));
    const a = main[Math.min(k, main.length - 1)];
    const b = [a[0] + (rng() - 0.5) * 60, a[1] - 18 - rng() * 45];
    const pts = [a]; split(a, b, 4, pts);
    chans.push({ pts, w: 0.8 });
  }
  const pos = [], idx = [], wv = [];
  for (const c of chans) {
    const base = pos.length / 3;
    const P = c.pts;
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const w = c.w * (1 - 0.6 * i / P.length);
      pos.push(P[i][0] - dy * w, P[i][1] + dx * w, z, P[i][0] + dy * w, P[i][1] - dx * w, z);
      wv.push(-1, 1);
      if (i > 0) { const j = base + (i - 1) * 2; idx.push(j, j + 1, j + 3, j, j + 3, j + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(wv, 1));
  g.setIndex(idx);
  return g;
}

export function createStorm(ctx, { low = false, skyZ = -280 } = {}) {
  const { game, group } = ctx;
  let seed = 12345;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // backdrop: a huge curved card behind everything (fog off)
  const skyU = { uTime: { value: 0 }, uBolt: { value: new THREE.Vector4(0, 100, 0, 0) }, uFlash: { value: 0 }, uMoon: { value: new THREE.Vector3(160, 120, 0) } };
  const skyGeo = new THREE.CylinderGeometry(420, 420, 320, 48, 1, true, Math.PI * 0.62, Math.PI * 0.76);
  skyGeo.translate(0, 130, 0);
  const sky = new THREE.Mesh(skyGeo, new THREE.ShaderMaterial({ vertexShader: SKY_V, fragmentShader: SKY_F, uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false }));
  sky.position.set(40, -30, skyZ + 420);
  sky.renderOrder = -10;
  sky.userData.farPlane = true; // perf-1650: pure backdrop → Renderer early-z may draw it AFTER the opaques (it shaded every pixel first)
  sky.frustumCulled = false;
  group.add(sky);
  // bolts
  const boltMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 } },
    vertexShader: 'attribute float aW; varying float vW; void main(){ vW = aW; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float uI; varying float vW; void main(){ float c = 1.0 - abs(vW); float a = pow(c, 1.5) * uI; gl_FragColor = vec4(vec3(0.75, 0.82, 1.0) * a * 9.0 + vec3(1.0) * pow(c, 8.0) * uI * 12.0, a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  // perf-1650: a degenerate placeholder WITH the real attributes (not an empty geometry) — three bakes
  // "hasPositionAttribute" into the program key, so the prewarm linked a variant the first strike never used
  const boltGeo0 = new THREE.BufferGeometry();
  boltGeo0.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  boltGeo0.setAttribute('aW', new THREE.Float32BufferAttribute(new Float32Array(3), 1));
  const bolt = new THREE.Mesh(boltGeo0, boltMat);
  bolt.frustumCulled = false; bolt.visible = false; bolt.renderOrder = -5;
  group.add(bolt);
  // flash light: cold, from high above the keep, slightly toward the camera so the facades catch it
  const light = new THREE.DirectionalLight('#c4d0ff', 0);
  light.position.set(-12, 60, -20);
  const tgt = new THREE.Object3D(); group.add(tgt); light.target = tgt;
  group.add(light);

  const st = { next: 2.2, seq: null, flash: 0, t: 0, hold: 0 };
  const strike = ({ power = 1, x = null, near = false } = {}) => {
    const cx = (game.cameraRig && game.cameraRig.focus ? game.cameraRig.focus.x : 0);
    const bx = x ?? cx + (rng() - 0.5) * 140;
    const z = skyZ + 30;
    const g = boltGeometry(rng, bx + (rng() - 0.5) * 20, 190, bx + (rng() - 0.5) * 50, near ? -5 : 25 + rng() * 25, z);
    bolt.geometry.dispose(); bolt.geometry = g;
    skyU.uBolt.value.set(bx, 120, 0, 0);
    // envelope keys: [t, level]
    st.seq = { t: 0, power, keys: [[0, 0.3], [0.05, 0], [0.09, 1], [0.17, 0.25], [0.23, 0.8], [0.34, 0.35], [0.7, 0]] };
    const dist = near ? 0.15 : 0.5 + rng() * 1.4;
    if (game.audio && game.audio.play) try { game.audio.play('impact_storm', { volume: 0.35 * power + (near ? 0.3 : 0), pitch: 0.55 + rng() * 0.15, delay: dist, bus: 'sfx' }); } catch (e) { /* optional */ }
  };
  const env = (s) => {
    const k = s.keys;
    for (let i = 1; i < k.length; i++) if (s.t < k[i][0]) { const a = k[i - 1], b = k[i]; return a[1] + (b[1] - a[1]) * (s.t - a[0]) / (b[0] - a[0]); }
    return null;
  };
  return {
    sky, bolt, light, strike,
    get flash() { return st.flash; },
    update(dt, t) {
      st.t += dt;
      skyU.uTime.value = t;
      st.next -= dt;
      if (st.next <= 0 && st.hold <= 0) { strike({ power: 0.6 + rng() * 0.5 }); st.next = 4.5 + rng() * 7; }
      if (st.hold > 0) st.hold -= dt;
      let f = 0;
      if (st.seq) {
        st.seq.t += dt;
        const v = env(st.seq);
        if (v === null) st.seq = null; else f = v * st.seq.power;
      }
      st.flash = f;
      S4.s4Flash.value = f;
      skyU.uFlash.value = f;
      skyU.uBolt.value.w = f * 1.2;
      boltMat.uniforms.uI.value = Math.min(1, f * 1.4);
      bolt.visible = f > 0.05;
      light.intensity = f * (low ? 5 : 6);
      const cam = game.cameraRig;
      if (cam && cam.focus) { tgt.position.set(cam.focus.x, 0, 0); light.position.set(cam.focus.x - 14, 60, -18); }
      const r = game.renderer;
      if (r) r.exposureMul = 1 + f * 0.25;
    },
    /** Hold off the random strikes (set pieces script their own). */
    quiet(s) { st.hold = s; },
    dispose() { if (game.renderer) game.renderer.exposureMul = 1; bolt.geometry.dispose(); },
  };
}
