// Stage 3 — the flight world: everything that streams PAST the eagle (it flies +X at `speed`, so the world scrolls −X).
//   cloud sea far below (shader plane, lit crowns / slate troughs, scrolling), cumulus puffs in 4 parallax layers
//   (far towers, mid banks, under-the-eagle, fast wisps), stone spires rising out of the clouds (instanced, recycled),
//   wind streaks + speed lines around the bird, the ring-out edge flow, the stone ARCH set piece, the Serpent Keep on the
//   horizon (approaches with stage progress) and a low sun flare.
//   env-r32: the air is cool blue-grey (colours come from stage3.js COLORS) and the stone is cool desaturated grey
//   (was warm sandstone, part of the r2 one-beige-band read); the sun flare is dimmer so the warm accent stays sparse.
//
//   const sky = buildSky(ctx, { sunDir, colors, low }) ; sky.update(dt, t, cam, { speed, progress, bank })
//   sky.arch.start(onPass)  → the arch sweeps over the eagle (≈ 6 s); sky.arch.active; sky.arch.overhead (0..1)
import * as THREE from 'three';
import { noiseTexture, patchStandard } from '../../../render/shaderlib.js';
import { rngFrom } from '../stage1/geo.js';

const C = (h) => new THREE.Color(h);

// ---------------------------------------------------------------- textures
function cumulusTexture() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  let s = 77;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  // puffy blob cluster, R = density, G = "height" (lit top vs shadowed base)
  const img = g.createImageData(S, S);
  const blobs = [];
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.28;
    blobs.push([0.5 + Math.cos(a) * r * 1.2, 0.56 + Math.sin(a) * r * 0.55 - rnd() * 0.08, 0.1 + rnd() * 0.14]);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let d = 0;
    for (const [bx, by, br] of blobs) { const dd = ((u - bx) ** 2 + (v - by) ** 2) / (br * br); d += Math.exp(-dd * 1.6); }
    d = Math.min(1, d * 0.7) * Math.min(1, (1 - v) * 3.0) * Math.min(1, v * 6) * Math.min(1, u * 6, (1 - u) * 6);
    const k = (y * S + x) * 4;
    img.data[k] = 255; img.data[k + 1] = Math.round((1 - v) * 255); img.data[k + 2] = 255; img.data[k + 3] = Math.round(Math.pow(d, 1.2) * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; return t;
}

function glowTexture(stops) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- cloud sea
function cloudSea(o) {
  const U = {
    uNoise: { value: noiseTexture() }, uOff: { value: 0 }, uTime: { value: 0 },
    uLit: { value: C(o.colors.seaLit) }, uShade: { value: C(o.colors.seaShade) }, uHaze: { value: C(o.colors.haze) },
    uSunDir: { value: new THREE.Vector3(...o.sunDir).normalize() }, uSunC: { value: C(o.colors.sun) }, uCam: { value: new THREE.Vector3() },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: U, fog: false, depthWrite: true,
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    // perf-1650 r3: the two transparent billow-crown SHELLS (+5 m, +10 m) are composited in this ONE pass — each shell
    // sample is taken where the view ray crosses that shell's plane (same parallax as the old stacked planes), and its
    // normal/lighting is only evaluated where the crown is present. Was 3 full-coverage layers (S3 overdraw +1.4).
    fragmentShader: /* glsl */`
      uniform sampler2D uNoise; uniform float uOff; uniform float uTime;
      uniform vec3 uLit, uShade, uHaze, uSunDir, uSunC, uCam;
      varying vec3 vW;
      float n(vec2 p) { return texture2D(uNoise, p).r; }
      float height(vec2 p, float fd) { return n(p * 0.0021) * 0.55 + n(p * 0.0063 + vec2(0.3, uTime * 0.002)) * 0.3 + texture2D(uNoise, p * 0.019).g * 0.15 * fd; }
      vec3 shade(vec3 w, vec2 p, float h, vec3 vdir) {
        float hx = n((p + vec2(9.0, 0.0)) * 0.0021) * 0.55 + n((p + vec2(9.0, 0.0)) * 0.0063 + vec2(0.3, uTime * 0.002)) * 0.3;
        float hz = n((p + vec2(0.0, 9.0)) * 0.0021) * 0.55 + n((p + vec2(0.0, 9.0)) * 0.0063 + vec2(0.3, uTime * 0.002)) * 0.3;
        vec3 nrm = normalize(vec3((h - hx) * 60.0, 1.0, (h - hz) * 60.0));
        float sunL = clamp(dot(nrm, normalize(uSunDir + vec3(0.0, 0.25, 0.0))), 0.0, 1.0);
        float lit = smoothstep(0.35, 0.8, h) * 0.6 + sunL * 0.55;
        vec3 col = mix(uShade, uLit, clamp(lit, 0.0, 1.0));
        // silver lining toward the sun + forward scatter
        float fwd = pow(clamp(dot(vdir, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0), 6.0);
        col += uSunC * fwd * 0.5 * smoothstep(0.4, 0.9, h);
        return col;
      }
      void main() {
        vec3 vdir = normalize(vW - uCam);
        float dist = length(vW - uCam);
        // billowing cumulus field: large rolls + medium puffs + fine detail (fine octaves fade with distance)
        vec2 p = vec2(vW.x + uOff, vW.z);
        float h = height(p, 1.0 - smoothstep(150.0, 700.0, dist));
        vec3 col = shade(vW, p, h, vdir);
        // deep troughs glimpse the canyon floor haze
        col = mix(col * 0.72, col, smoothstep(0.18, 0.4, h));
        // shell layers: each higher shell keeps only the billow crowns → volumetric cumulus tops
        float rise = 1.0 / max(-vdir.y, 0.02);
        for (int i = 1; i <= 2; i++) {
          float L = float(i);
          vec3 w = vW - vdir * (5.0 * L * rise);
          vec2 q = vec2(w.x + uOff, w.z);
          float hl = height(q, 1.0 - smoothstep(150.0, 700.0, length(w - uCam)));
          float th = 0.34 + L * 0.13;
          float a = smoothstep(th, th + 0.09, hl);
          if (a <= 0.0) continue;
          vec3 cl = shade(w, q, hl, vdir);
          cl = mix(cl * 0.72, cl, smoothstep(0.18, 0.4, hl));
          cl = mix(cl, uLit * 1.08, 0.25 * L);
          col = mix(col, cl, a);
        }
        float hz2 = smoothstep(120.0, 1500.0, dist);
        col = mix(col, uHaze, hz2 * 0.92);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const g = new THREE.PlaneGeometry(6000, 3000, 1, 1); g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, m); mesh.position.set(0, o.seaY, -1300); mesh.name = 'cloudSea0'; mesh.frustumCulled = false; mesh.renderOrder = -6;
  const meshes = [mesh];
  return { meshes, U };
}

// ---------------------------------------------------------------- billboard cloud puffs (instanced, camera facing)
function puffLayer(o, tex, cfg, rng) {
  const n = cfg.count;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aC = new Float32Array(n * 4), aS = new Float32Array(n * 4);
  const items = [];
  for (let i = 0; i < n; i++) {
    const it = { x: rng.range(-cfg.range, cfg.range), y: rng.range(cfg.y[0], cfg.y[1]), z: rng.range(cfg.z[0], cfg.z[1]),
      w: rng.range(cfg.size[0], cfg.size[1]), seed: rng.next() };
    it.h = it.w * rng.range(cfg.aspect[0], cfg.aspect[1]);
    items.push(it);
    aS.set([it.x, it.y, it.z, 0], i * 4);
    aC.set([it.w, it.h, it.seed, rng.range(cfg.alpha[0], cfg.alpha[1])], i * 4);
  }
  const iS = new THREE.InstancedBufferAttribute(aS, 4); iS.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aS', iS); geo.setAttribute('aC', new THREE.InstancedBufferAttribute(aC, 4));
  geo.instanceCount = n;
  const U = {
    uTex: { value: tex }, uLit: { value: C(o.colors.puffLit) }, uShade: { value: C(o.colors.puffShade) }, uHaze: { value: C(o.colors.haze) },
    uSunC: { value: C(o.colors.sun) }, uSunDir: { value: new THREE.Vector3(...o.sunDir).normalize() }, uFade: { value: new THREE.Vector2(cfg.fade[0], cfg.fade[1]) },
    uStretch: { value: cfg.stretch || 1 }, uAlpha: { value: cfg.alpha1 ?? 1 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      attribute vec4 aS; attribute vec4 aC; uniform float uStretch;
      varying vec2 vUv; varying float vSeed; varying float vA; varying float vDist; varying vec3 vDir;
      void main() {
        vec3 c = aS.xyz;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 wp = c + right * position.x * aC.x * uStretch + up * (position.y - 0.25) * aC.y;
        vUv = vec2(position.x + 0.5, position.y); vSeed = aC.z; vA = aC.w;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vDist = -mv.z; vDir = normalize(wp - cameraPosition);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex; uniform vec3 uLit, uShade, uHaze, uSunC, uSunDir; uniform vec2 uFade; uniform float uAlpha;
      varying vec2 vUv; varying float vSeed; varying float vA; varying float vDist; varying vec3 vDir;
      void main() {
        vec2 uv = vUv; if (vSeed > 0.5) uv.x = 1.0 - uv.x;
        vec4 t = texture2D(uTex, uv);
        float a = t.a * vA * uAlpha;
        if (a < 0.03) discard;   // perf-1650 r3: was 0.01 (invisible fringe fragments = S3 overdraw)
        float top = t.g;
        vec3 col = mix(uShade, uLit, smoothstep(0.15, 0.85, top + (t.a - 0.5) * 0.3));
        float fwd = pow(clamp(dot(vDir, normalize(uSunDir)), 0.0, 1.0), 8.0);
        col += uSunC * fwd * (1.0 - t.a) * 1.4;                          // sun-lit rims (thin edges glow toward the sun)
        col = mix(col, uHaze, smoothstep(uFade.x, uFade.y, vDist));
        a *= smoothstep(4.0, 16.0, vDist);                              // never smear the lens
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false; mesh.name = 'puffs_' + cfg.name; mesh.renderOrder = cfg.order || 0;
  return {
    mesh, U,
    update(dt, speed, camX) {
      const v = speed * (cfg.speedMul || 1);
      for (let i = 0; i < n; i++) {
        const it = items[i];
        it.x -= v * dt;
        if (it.x < camX - cfg.range) { it.x += cfg.range * 2; it.y = rng.range(cfg.y[0], cfg.y[1]); it.z = rng.range(cfg.z[0], cfg.z[1]); }
        aS[i * 4] = it.x; aS[i * 4 + 1] = it.y; aS[i * 4 + 2] = it.z;
      }
      iS.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- stone spires
function spireGeometry(rng, H, R) {
  const seg = 18, rows = 44;
  const pos = [], col = [], idx = [];
  // env-r32: cool weathered grey stone. Hue only: each band keeps the old sandstone band's linear luminance or less
  // (0.96-0.97 x donor; a scene-pass +20 % lift was rejected: never brighten an albedo for contrast). Separation from
  // the eagle comes from light, the distance haze below and fog depthGrade, not from the albedo.
  const bands = [C('#6a6162'), C('#8d8687'), C('#544e50'), C('#a49f9f'), C('#625c5f')];
  const ph = [rng.next() * 6, rng.next() * 6, rng.next() * 6];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, y = -H * 0.35 + t * H;
    // hoodoo profile: stacked bulging tiers with overhanging ledges, a broken crown
    const tier = 1 + 0.14 * Math.sin(t * 22 + ph[0]) + 0.1 * Math.sign(Math.sin(t * 9 + ph[1])) * Math.pow(Math.abs(Math.sin(t * 9 + ph[1])), 0.3);
    const taper = (1 - 0.5 * t) * (t > 0.9 ? Math.max(0.35, 1 - (t - 0.9) * 6) : 1);
    const band = bands[Math.floor(t * 9 + rng.next() * 0.3) % bands.length];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const nz = (0.8 + 0.3 * Math.sin(a * 2 + t * 5 + ph[2]) + 0.12 * Math.sin(a * 5 - t * 13) + 0.05 * Math.sin(a * 11 + t * 31)) * tier;
      const r = R * taper * nz;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      const lit = 0.75 + 0.25 * Math.cos(a - 2.4);
      col.push(band.r * lit, band.g * lit, band.b * lit);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  // flat-ish crown with a grass/shrub cap tint
  const cy = -H * 0.35 + H, ci = pos.length / 3;
  pos.push(0, cy + 0.6, 0); col.push(0.28, 0.31, 0.26);
  const top0 = rows * (seg + 1);
  for (let i = 0; i < seg; i++) idx.push(ci, top0 + i + 1, top0 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function spires(o, rng, low) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  // env-r32 aerial perspective: the scene fog starts too far out (it must not veil the keep finale), so the spires take
  // their own view-distance haze toward the cloud-sea haze colour (rgb, max share): near ones keep form, far ones go pale
  const hz = C(o.colors.haze);
  const uSpHaze = { value: new THREE.Vector4(hz.r, hz.g, hz.b, 0.6) };
  // sandstone strata + weathering streaks, triplanar (keeps the silhouettes chunky, the surfaces detailed)
  patchStandard(mat, {
    key: 'kcaS3Spire', uniforms: { uSpHaze }, fragHead: 'uniform vec4 uSpHaze;',
    fragEnd: 'outgoingLight = mix(outgoingLight, uSpHaze.rgb, (1.0 - exp(-length(vViewPosition) / 350.0)) * uSpHaze.w);',
    albedo: /* glsl */`
      vec4 n1 = kTri(vKW * 0.02, vKN, 1.0), n2 = kTri(vKW * 0.09, vKN, 1.0);
      float strata = sin(vKW.y * 0.55 + n1.r * 6.0) * 0.5 + 0.5;
      float streak = smoothstep(0.55, 0.8, texture2D(kNoise, vec2(vKW.x * 0.03 + vKW.z * 0.03, vKW.y * 0.004)).g);
      diffuseColor.rgb *= (0.78 + 0.34 * strata) * (0.85 + 0.3 * n2.g) * (1.0 - 0.3 * streak);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.23, 0.18), smoothstep(0.75, 0.95, vKN.y) * 0.8);`,
    bump: 'normal = kBump(vKW, normal, kTri(vKW * 0.035, vKN, 1.0).r * 2.0 + sin(vKW.y * 0.55) * 0.3, 0.7, 1.0);',
  });
  const variants = [spireGeometry(rng, 150, 14), spireGeometry(rng, 120, 10), spireGeometry(rng, 170, 18)];
  const per = low ? 6 : 9;
  const meshes = [], items = [];
  const dummy = new THREE.Object3D();
  const place = (it, first) => {
    const far = rng.next();
    it.z = far < 0.2 ? rng.range(-70, -100) : far < 0.65 ? rng.range(-110, -220) : rng.range(-240, -440);
    it.x = first ? rng.range(-260, 320) : 320 + rng.range(0, 160);
    it.y = o.seaY - rng.range(-10, 50) + (it.z > -105 ? -20 : 0);
    it.s = rng.range(0.7, 1.25) * (it.z > -105 ? 0.75 : 1);
    it.ry = rng.next() * 6.28;
  };
  variants.forEach((geo, vi) => {
    const m = new THREE.InstancedMesh(geo, mat, per); m.name = 'spires' + vi; m.frustumCulled = false; m.castShadow = false;
    meshes.push(m);
    for (let i = 0; i < per; i++) { const it = { m, i }; place(it, true); items.push(it); }
  });
  const upd = (dt, speed, camX) => {
    for (const it of items) {
      it.x -= speed * dt;
      if (it.x < camX - 320) place(it, false);
      dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, it.ry, 0); dummy.scale.setScalar(it.s); dummy.updateMatrix();
      it.m.setMatrixAt(it.i, dummy.matrix);
    }
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  };
  return { meshes, update: upd };
}

// ---------------------------------------------------------------- wind streaks / speed lines
function streaks(o, rng, cfg) {
  const n = cfg.count;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aS = new Float32Array(n * 4), aC = new Float32Array(n * 4);
  const items = [];
  for (let i = 0; i < n; i++) {
    const it = {}; spawn(it, true); items.push(it);
    aC.set([it.len, it.wid, rng.next(), it.a], i * 4);
  }
  function spawn(it, first) {
    const b = cfg.boxes[Math.floor(rng.next() * cfg.boxes.length)];
    it.x = first ? rng.range(-cfg.range, cfg.range) : cfg.range + rng.range(0, 20);
    it.y = rng.range(b.y[0], b.y[1]); it.z = rng.range(b.z[0], b.z[1]);
    it.len = rng.range(cfg.len[0], cfg.len[1]); it.wid = rng.range(cfg.wid[0], cfg.wid[1]); it.a = rng.range(cfg.alpha[0], cfg.alpha[1]);
    it.v = rng.range(cfg.speed[0], cfg.speed[1]);
  }
  const iS = new THREE.InstancedBufferAttribute(aS, 4); iS.setUsage(THREE.DynamicDrawUsage);
  const iC = new THREE.InstancedBufferAttribute(aC, 4); iC.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aS', iS); geo.setAttribute('aC', iC); geo.instanceCount = n;
  const U = { uColor: { value: C(cfg.color) }, uAlpha: { value: 1 } };
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */`
      attribute vec4 aS; attribute vec4 aC; varying vec2 vUv; varying float vA;
      void main() {
        vec3 c = aS.xyz;
        vec3 fwd = vec3(-1.0, 0.0, 0.0);
        vec3 toCam = normalize(cameraPosition - c);
        vec3 side = normalize(cross(fwd, toCam));
        vec3 wp = c + fwd * position.x * aC.x + side * position.y * aC.y;
        vUv = vec2(position.x, position.y + 0.5); vA = aC.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv; varying float vA;
      void main() {
        float a = smoothstep(0.0, 0.25, vUv.x) * (1.0 - smoothstep(0.35, 1.0, vUv.x)) * (1.0 - abs(vUv.y * 2.0 - 1.0));
        gl_FragColor = vec4(uColor * a * vA * uAlpha, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false; mesh.name = 'streaks_' + cfg.name; mesh.renderOrder = 8;
  return {
    mesh, U,
    update(dt, speedMul, camX) {
      for (let i = 0; i < n; i++) {
        const it = items[i];
        it.x -= it.v * speedMul * dt;
        if (it.x + it.len < camX - cfg.range) { spawn(it, false); aC.set([it.len, it.wid, rng.next(), it.a], i * 4); }
        aS[i * 4] = it.x; aS[i * 4 + 1] = it.y; aS[i * 4 + 2] = it.z;
      }
      iS.needsUpdate = true; iC.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- the arch
function archGeometry(rng) {
  // a natural sandstone arch bridging the flight path: pillars at z −48 / +48, span crown at y ≈ 34
  const seg = 14, rows = 60;
  const pos = [], col = [], idx = [], uv = [];
  const bands = [C('#7c6a66'), C('#a08f88'), C('#625552'), C('#b9aba4')];   // env-r32: cool grey stone (was sandstone)
  const cl = (t) => { const a = Math.PI * t; return [-48 * Math.cos(a), -80 + 114 * Math.pow(Math.max(0, Math.sin(a)), 0.35)]; };
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, a = Math.PI * t;
    // centre line: an arch in the y–z plane
    const [cz, cy] = cl(t);
    const r = 11 * (1 - 0.35 * Math.sin(a)) + 1.6 * Math.sin(t * 29.0) + 0.4 * Math.sin(t * 61.0);
    const [z0, y0] = cl(Math.max(0, t - 0.01)), [z1, y1] = cl(Math.min(1, t + 0.01));
    const tz = z1 - z0, ty = y1 - y0, tl = Math.hypot(tz, ty) || 1;
    const nz = -ty / tl, ny = tz / tl;
    const band = bands[Math.floor(cy * 0.12 + 20) % bands.length];
    for (let i = 0; i <= seg; i++) {
      // Continuous eroded cross-section, including the duplicated seam. Consume the original RNG
      // sample to preserve downstream deterministic construction; never jitter vertices independently.
      rng.next();
      const b = ((i % seg) / seg) * Math.PI * 2;
      const rr = r * (0.91 + 0.10 * Math.sin(b * 3 + t * 13) + 0.035 * Math.sin(b * 5 - t * 21));
      const ox = Math.cos(b) * rr * 1.25, on = Math.sin(b) * rr;
      pos.push(ox, cy + ny * on, cz + nz * on);
      uv.push(i / seg, t);
      const lit = 0.7 + 0.3 * Math.max(0, Math.sin(b));
      col.push(band.r * lit, band.g * lit, band.b * lit);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // Average both sides of the duplicated UV seam so the major form has continuous normals.
  const n = g.attributes.normal, v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let j = 0; j <= rows; j++) {
    const lo = j * (seg + 1), hi = lo + seg;
    v.fromBufferAttribute(n, lo).add(w.fromBufferAttribute(n, hi)).normalize();
    n.setXYZ(lo, v.x, v.y, v.z); n.setXYZ(hi, v.x, v.y, v.z);
  }
  return g;
}

// Same opaque arch draw, same pigments. Local-space strata stay attached during the sweep.
function archMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  patchStandard(mat, {
    key: 'kcaS3ArchStoneR32',
    vertHead: 'varying vec3 vArchP;', vertMain: 'vArchP = position;',
    fragHead: 'varying vec3 vArchP;',
    albedo: /* glsl */`
      vec4 stone = kTri(vArchP * 0.055, vKN, 1.0);
      float bed = sin(vArchP.y * 0.72 + stone.r * 3.0 + vArchP.z * 0.09);
      float seam = smoothstep(0.55, 0.92, bed);
      // Weathering only darkens the approved vertex pigments: multiplier is in [0.7568, 1].
      diffuseColor.rgb *= (0.88 + 0.12 * stone.g) * (1.0 - 0.14 * seam);`,
    rough: 'roughnessFactor = 0.82 + 0.15 * kTri(vArchP * 0.055, vKN, 1.0).g;',
    bump: /* glsl */`
      float grain = kTri(vArchP * 0.055, vKN, 1.0).r;
      float relief = grain * 0.24 + sin(vArchP.y * 0.72 + grain * 3.0 + vArchP.z * 0.09) * 0.22;
      normal = kBump(-vViewPosition, normal, relief, 0.22, faceDirection);`,
  });
  return mat;
}

// ---------------------------------------------------------------- serpent keep (horizon goal)
function keepGroup() {
  const g = new THREE.Group(); g.name = 'serpentKeep';
  const rock = new THREE.MeshStandardMaterial({ color: '#4a3a40', roughness: 1, flatShading: true });
  const wall = new THREE.MeshStandardMaterial({ color: '#3a3444', roughness: 0.9, flatShading: true });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 3.2, 1.2), fog: true });
  const crag = new THREE.Mesh(new THREE.ConeGeometry(70, 190, 9, 4), rock);
  // Present the existing crag as a broad foundation; all five tower feet intersect it.
  // The inverted taper descends into the cloud bank; topology, materials and draws stay unchanged.
  crag.rotation.z = Math.PI; crag.scale.set(0.82, 0.72, 0.55); crag.position.y = -40; g.add(crag);
  const towers = [[0, 60, 9, 70], [-24, 40, 6, 50], [22, 44, 6, 56], [-40, 25, 5, 36], [38, 28, 5, 40]];
  for (const [x, y, r, h] of towers) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, h, 8), wall); t.position.set(x, y, 0); g.add(t);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.2, h * 0.5, 8), wall); roof.position.set(x, y + h * 0.75, 0); g.add(roof);
    for (let k = 0; k < 3; k++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.25, r * 0.5), glow); w.position.set(x + (k - 1) * r * 0.4, y + h * 0.2 - k * 5, r * 0.9); g.add(w); }
  }
  // the serpent coil wrapped round the great tower
  const pts = [];
  for (let i = 0; i <= 60; i++) { const t = i / 60, a = t * Math.PI * 7; pts.push(new THREE.Vector3(Math.cos(a) * 11, 20 + t * 85, Math.sin(a) * 11)); }
  const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 2.6, 6), new THREE.MeshStandardMaterial({ color: '#2a4a3a', roughness: 0.6 }));
  g.add(coil);
  const head = new THREE.Mesh(new THREE.ConeGeometry(4.5, 14, 6), coil.material); head.position.set(11, 108, 0); head.rotation.z = -1.2; g.add(head);
  return g;
}

// ---------------------------------------------------------------- assemble
export function buildSky(ctx, o) {
  const { group } = ctx;
  const low = !!o.low;
  const rng = rngFrom(7707);
  const root = new THREE.Group(); root.name = 'stage3Sky';
  group.add(root);
  const sea = cloudSea(o); for (const m of sea.meshes) root.add(m);
  const tex = cumulusTexture();
  const layers = [
    puffLayer(o, tex, { name: 'far', count: low ? 18 : 30, range: 700, y: [-70, 30], z: [-420, -900], size: [110, 260], aspect: [0.45, 0.7], alpha: [0.75, 1], fade: [300, 1400], speedMul: 1, order: -4 }, rng),
    puffLayer(o, tex, { name: 'mid', count: low ? 16 : 21, range: 260, y: [-60, -18], z: [-70, -300], size: [40, 90], aspect: [0.4, 0.6], alpha: [0.7, 1], fade: [150, 700], speedMul: 1, order: -3 }, rng),
    // env-r32: the under-the-eagle banks drift right behind the fighters; 0.8 so they stay a soft mid plane, not a pale veil
    puffLayer(o, tex, { name: 'under', count: low ? 10 : 18, range: 90, y: [-34, -14], z: [-40, 16], size: [18, 40], aspect: [0.35, 0.55], alpha: [0.55, 0.9], alpha1: 0.8, fade: [80, 400], speedMul: 1, order: -2 }, rng),
    puffLayer(o, tex, { name: 'wisps', count: 0, range: 70, y: [-12, 3], z: [-34, -12], size: [14, 28], aspect: [0.14, 0.24], alpha: [0.1, 0.24], fade: [60, 300], speedMul: 1.1, stretch: 2.2, order: -1 }, rng),
  ];
  for (const l of layers) root.add(l.mesh);
  const sp = spires(o, rng, low); for (const m of sp.meshes) root.add(m);
  const lines = [
    streaks(o, rng, { name: 'wind', count: low ? 40 : 80, range: 34, speed: [55, 95], len: [5, 14], wid: [0.03, 0.09], alpha: [0.18, 0.45], color: '#e6ecf6',
      boxes: [{ y: [-4.5, -1.4], z: [3.2, 8] }, { y: [0.6, 7], z: [-8, -18] }, { y: [2.5, 6], z: [-2, 2] }, { y: [-6, -2], z: [-4, 2] }] }),
    streaks(o, rng, { name: 'lip', count: low ? 10 : 18, range: 14, speed: [30, 50], len: [2, 5], wid: [0.02, 0.05], alpha: [0.35, 0.7], color: '#ffe8c4',
      boxes: [{ y: [-0.55, 0.05], z: [2.75, 3.4] }] }),
  ];
  for (const l of lines) root.add(l.mesh);

  // arch
  const arch = { mesh: new THREE.Mesh(archGeometry(rng), archMaterial()), active: false, x: 400, overhead: 0, onPass: null, passed: false };
  arch.mesh.name = 'stoneArch'; arch.mesh.visible = false; arch.mesh.frustumCulled = false; root.add(arch.mesh);
  arch.start = (onPass) => { arch.active = true; arch.passed = false; arch.x = 260; arch.onPass = onPass || null; arch.mesh.visible = true; };

  // keep
  const keep = keepGroup(); root.add(keep);

  // sun flare (anamorphic streak + glow), follows the camera along the sun direction
  const flareT = glowTexture([[0, 'rgba(255,248,225,1)'], [0.12, 'rgba(255,214,150,0.8)'], [0.4, 'rgba(255,170,90,0.18)'], [1, 'rgba(255,140,60,0)']]);
  // env-r32: dimmer (was 0.85 / 0.4) — the gold glow covered the top-left third of the frame
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareT, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.45 }));
  const streak = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareT, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.18 }));
  flare.renderOrder = 9; streak.renderOrder = 9; root.add(flare, streak);
  const sunDir = new THREE.Vector3(...o.sunDir).normalize();

  let dist = 0;
  return {
    root, sea, layers, spires: sp, arch, keep, lines,
    update(dt, t, cam, { speed = 30, progress = 0, streakMul = 1 } = {}) {
      dist += speed * dt;
      sea.U.uOff.value = dist; sea.U.uTime.value = t;
      const camX = cam ? cam.position.x : 0;
      if (cam) sea.U.uCam.value.copy(cam.position);
      for (const l of layers) l.update(dt, speed, camX);
      sp.update(dt, speed, camX);
      for (const l of lines) l.update(dt, streakMul, camX);
      // arch sweep
      if (arch.active) {
        arch.x -= speed * 1.25 * dt;
        arch.mesh.position.set(arch.x, 0, -6);
        arch.overhead = Math.max(0, 1 - Math.abs(arch.x - camX) / 45);
        if (!arch.passed && arch.x < camX + 2) { arch.passed = true; if (arch.onPass) arch.onPass(); }
        if (arch.x < camX - 300) { arch.active = false; arch.mesh.visible = false; arch.overhead = 0; }
      }
      // Keep: stage progress drives only this visual backdrop. The old high/far transform projected
      // the tower tops above the belt camera. Lower, smaller architecture approaches the open sky
      // just left of the eagle head, with its crag rooted in the cloud sea. Nearer depth naturally
      // reduces the existing fog; no overlay, added light, camera or progression change.
      const p = THREE.MathUtils.smoothstep(progress, 0, 1);
      keep.position.set(THREE.MathUtils.lerp(700, 55, p), THREE.MathUtils.lerp(-80, -60, p), THREE.MathUtils.lerp(-1500, -240, p));
      keep.scale.setScalar(THREE.MathUtils.lerp(0.7, 0.5, p));
      if (cam) {
        flare.position.copy(cam.position).addScaledVector(sunDir, 400); flare.scale.setScalar(150);
        streak.position.copy(flare.position); streak.scale.set(900, 26, 1);
      }
    },
  };
}
