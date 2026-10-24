// Wind-animated instanced grass (shared by any stage). Tufts of curved tapered blades; chunked along X so frustum
// culling works; per-instance colour variation; dark roots → sun-caught tips; backlit translucency toward the sun;
// bends away from up to 4 "pushers" (actors) via grassPushers.
//
//   createGrass(rng, { x0, x1, z0, z1, density (tufts/m²), densityFn(x, z) → 0..1, height: [a, b], blades, width,
//                      base, tip, dry, burnt (hex colours), chunk (m), quality, castShadow, receiveShadow (default true) }) → THREE.Group
//   grassPushers.value[i].set(x, z, radius, strength)   (unused slots: radius 0)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchStandard } from './shaderlib.js';

export const grassPushers = { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] };

function tuftGeometry(rng, blades, width, segs = 3, form = -1) {
  const parts = [];
  for (let b = 0; b < blades; b++) {
    const h = (0.55 + rng.next() * 0.45) * (form === 0 ? .64 : form === 1 ? 1.18 : 1);
    const lean = form === 0 ? .9 + rng.next()*.5 : form === 1 ? (rng.next()-.5)*.22 : (rng.next()-.5)*.9, yaw = rng.next() * Math.PI * 2;
    const ox = (rng.next() - 0.5) * 0.28, oz = (rng.next() - 0.5) * 0.28;
    const w = width * (0.7 + rng.next() * 0.6) * (form === 0 ? 1.3 : form === 1 ? .48 : .85);
    const pos = [], uv = [], idx = [];
    const tag = rng.next();
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const bend = lean * t * t;
      const hw = w * (1 - t * 0.92) * 0.5;
      const y = h * t * (1 - Math.abs(bend) * 0.25);
      const x = Math.sin(bend) * h * 0.6;
      pos.push(x - hw, y, 0, x + hw, y, 0); uv.push(tag, t, tag, t);
    }
    for (let s = 0; s < segs; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.rotateY(yaw); g.translate(ox, 0, oz);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

let _mat = null;
export function grassMaterial(o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  patchStandard(m, {
    key: 'kcaGrass',
    uniforms: {
      kGBase: { value: new THREE.Color(o.base || '#2e2c16') }, kGTip: { value: new THREE.Color(o.tip || '#a08a48') },
      kGDry: { value: new THREE.Color(o.dry || '#b09060') }, kGPush: grassPushers,
      kGOpt2: { value: new THREE.Vector4(o.wind ?? 1, o.translucency ?? 0.6, 0, 0) },
    },
    vertHead: 'uniform vec4 kGPush[4]; uniform vec4 kGOpt2;',
    fragHead: 'uniform vec3 kGBase; uniform vec3 kGTip; uniform vec3 kGDry; uniform vec4 kGOpt2;',
    normalMain: 'objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.75));',
    bump: 'normal = normalize(vNormal); // same up-biased normal on both faces (no double-side flip)',
    vertMain: `
  {
    float h = uv.y;
    vec3 off = kWindOffset(vKW, h, 1.0) * kGOpt2.x;
    for (int i = 0; i < 4; i++) {
      vec4 pu = kGPush[i];
      if (pu.z <= 0.0) continue;
      vec2 d = vKW.xz - pu.xy;
      float l = length(d);
      float k = (1.0 - smoothstep(pu.z * 0.3, pu.z, l)) * pu.w * h;
      off.xz += (d / max(l, 1e-3)) * k * 0.45;
      off.y -= k * 0.25;
    }
    #ifdef USE_INSTANCING
      off = inverse(mat3(instanceMatrix)) * off;
    #endif
    transformed += off;
  }`,
    albedo: `
  float h = vKUv.y;
  vec3 c = mix(kGBase, kGTip, pow(h, 0.9));
  c = mix(c, kGDry * (0.7 + 0.5 * h), step(0.78, vKUv.x) * 0.7);
  c *= mix(0.35, 1.0, smoothstep(0.0, 0.45, h));
  diffuseColor.rgb *= c;`,
    fragEnd: `
  #ifdef USE_FOG
  {
    vec3 vd = normalize(vFogWorld - cameraPosition);
    float bl = pow(max(dot(vd, kFogB.xyz), 0.0), 3.0) * kFogC.w;
    outgoingLight += diffuseColor.rgb * kFogC.rgb * bl * vKUv.y * kGOpt2.y;
  }
  #endif`,
  });
  return m;
}

export function createGrass(rng, o = {}) {
  const low = o.quality && o.quality.name === 'low';
  const g = new THREE.Group(); g.name = 'grass';
  const variants = [0, 1, 2].map(i => tuftGeometry(rng, o.blades ?? 9, o.width ?? 0.045, 3, o.distinctForms ? i : -1));
  const mat = o.material || grassMaterial(o);
  const chunk = o.chunk ?? 16;
  const density = (o.density ?? 3) * (low ? 0.5 : 1);
  const [ha, hb] = o.height || [0.35, 0.8];
  const tint = new THREE.Color(), base = new THREE.Color(1, 1, 1);
  const tints = (o.tints || ['#ffffff', '#e8e0c8', '#f0d8b0', '#c8c8a0', '#b0a078']).map((c) => new THREE.Color(c));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let cx = o.x0; cx < o.x1; cx += chunk) {
    const area = chunk * (o.z1 - o.z0);
    const n = Math.round(area * density);
    const per = [[], [], []];
    for (let i = 0; i < n; i++) {
      const x = cx + rng.next() * chunk, z = o.z0 + rng.next() * (o.z1 - o.z0);
      const d = o.densityFn ? o.densityFn(x, z) : 1;
      if (d <= 0 || rng.next() > d) continue;
      per[Math.floor(rng.next() * 3)].push([x, z, d]);
    }
    per.forEach((list, vi) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(variants[vi], mat, list.length);
      list.forEach(([x, z, d], i) => {
        const k = (ha + rng.next() * (hb - ha)) * (0.6 + 0.4 * d);
        e.set(0, rng.next() * Math.PI * 2, 0); q.setFromEuler(e);
        m4.compose(p.set(x, o.y ? o.y(x, z) : 0, z), q, s.set(k * (0.8 + rng.next() * 0.5), k, k * (0.8 + rng.next() * 0.5)));
        im.setMatrixAt(i, m4);
        tint.copy(tints[Math.floor(rng.next() * tints.length)]).lerp(base, rng.next() * 0.3);
        im.setColorAt(i, tint);
      });
      im.castShadow = !!o.castShadow; im.receiveShadow = o.receiveShadow !== false;
      im.computeBoundingSphere();
      im.name = 'grassChunk';
      g.add(im);
    });
  }
  return g;
}
