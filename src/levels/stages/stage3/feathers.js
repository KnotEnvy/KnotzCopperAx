// Stage 3 — feather kit: a painted feather atlas (canvas), a merged-feather geometry builder and the feather material
// (vertex-shader wingbeat bend, wind flutter, footstep ruffle). Every layer of the eagle (back, sides, wings, tail) is ONE
// merged BufferGeometry of real feather cards (curved, cupped, tip-lifted, overlapping shingle-wise), so the plumage
// reads as layered feathers with real edges catching the golden-hour rim — never a fur texture on a flat plane.
//
//   featherAtlas() → CanvasTexture (4×2 slots: contour, covert, greater covert, secondary, primary, tail, gold hackle, edge)
//   buildFeathers(list, { nv }) → BufferGeometry   list item: { p, d, n, len, wid, type, tint, flut, lift, cup, arch, twist }
//   featherMaterial({ wing, feet, key }) → MeshStandardMaterial with userData.U = { uWing, uWing2, uFeet, uS3 }
import * as THREE from 'three';
import { patchStandard } from '../../../render/shaderlib.js';

export const FT = { contour: 0, covert: 1, greater: 2, secondary: 3, primary: 4, tail: 5, gold: 6, edge: 7 };

// ---------------------------------------------------------------- atlas
const SLOT_W = 256, SLOT_H = 512;
const SPECS = [
  // base (hidden, overlapped), mid, tip, fringe, shaft, bars, shape, width
  { base: '#1c120a', mid: '#4a2e18', tip: '#7a5230', fringe: '#c89a5a', shaft: '#2a1a0e', bars: 0, shape: 'round', w: 0.46 },     // contour
  { base: '#1a1009', mid: '#50331c', tip: '#835a34', fringe: '#d8b078', shaft: '#2a1a0e', bars: 0, shape: 'round', w: 0.44 },     // covert
  { base: '#160d07', mid: '#3e2614', tip: '#6a4626', fringe: '#b88a52', shaft: '#241408', bars: 0, shape: 'round', w: 0.4 },      // greater covert
  { base: '#231a14', mid: '#3a2c22', tip: '#2a1e16', fringe: '#6a5646', shaft: '#1a120c', bars: 5, barC: '#5e5048', shape: 'long', w: 0.36 },   // secondary
  { base: '#1a1410', mid: '#241a14', tip: '#120c08', fringe: '#3e3028', shaft: '#0e0a06', bars: 0, shape: 'primary', w: 0.3 },   // primary
  { base: '#2a2018', mid: '#4a3c30', tip: '#1e140c', fringe: '#8a7866', shaft: '#1a120a', bars: 4, barC: '#8c8276', shape: 'tail', w: 0.4 },    // tail
  { base: '#5a3814', mid: '#b07a30', tip: '#e8b860', fringe: '#ffe0a0', shaft: '#7a5020', bars: 0, shape: 'lance', w: 0.4 },    // gold hackle
  { base: '#4a3420', mid: '#9a7248', tip: '#e0c08c', fringe: '#fff0d0', shaft: '#6a4a2a', bars: 0, shape: 'round', w: 0.46 },    // edge (ring-out lip)
];

function halfW(shape, t, W) {
  switch (shape) {
    case 'round': return t < 0.42 ? W * (0.6 + 0.4 * t / 0.42) : W * Math.sqrt(Math.max(0, 1 - ((t - 0.42) / 0.58) ** 2.2));
    case 'lance': return W * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.04)), 0.85) * (1 - 0.25 * t);
    case 'long': return t < 0.85 ? W * (0.75 + 0.25 * Math.min(1, t / 0.3)) : W * Math.sqrt(Math.max(0, 1 - ((t - 0.85) / 0.15) ** 2));
    case 'tail': return t < 0.86 ? W * (0.8 + 0.2 * Math.min(1, t / 0.25)) : W * Math.sqrt(Math.max(0, 1 - ((t - 0.86) / 0.14) ** 2));
    default: return W;
  }
}

function drawFeather(g, x0, y0, spec, rnd) {
  const W = SLOT_W * spec.w, cx = x0 + SLOT_W / 2, H = SLOT_H * 0.97, yb = y0 + SLOT_H - 4;
  const Y = (t) => yb - t * H;
  const N = 48;
  const left = [], right = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let hl, hr;
    if (spec.shape === 'primary') {
      // asymmetric flight feather: narrow outer vane, broad inner vane with an emargination (the eagle's "fingers")
      const tip = t > 0.9 ? Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2)) : 1;
      hl = W * 0.34 * (0.7 + 0.3 * Math.min(1, t / 0.2)) * tip;
      hr = W * (t < 0.5 ? 0.9 + 0.1 * Math.min(1, t / 0.2) : 1 - 0.55 * Math.min(1, (t - 0.5) / 0.12)) * tip * (t > 0.62 ? 0.8 : 1);
    } else { hl = hr = halfW(spec.shape, t, W); }
    left.push([cx - hl, Y(t)]); right.push([cx + hr, Y(t)]);
  }
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
  // bars (chevrons following the barb angle)
  if (spec.bars) {
    g.strokeStyle = spec.barC; g.globalAlpha = 0.5;
    for (let b = 0; b < spec.bars; b++) {
      const t = 0.22 + b * (0.62 / spec.bars);
      g.lineWidth = SLOT_H * 0.03 * (0.8 + 0.4 * rnd());
      g.beginPath(); g.moveTo(cx - W, Y(t - 0.05)); g.lineTo(cx, Y(t)); g.lineTo(cx + W, Y(t - 0.05)); g.stroke();
    }
    g.globalAlpha = 1;
  }
  // barbs: fine lines angled from the rachis toward the tip, alternating light/dark
  for (let i = 0; i < 150; i++) {
    const t = rnd() * 0.97;
    const side = rnd() < 0.5 ? -1 : 1;
    const len = W * (0.9 + 0.3 * rnd());
    const light = rnd() < 0.5;
    g.strokeStyle = light ? 'rgba(255,236,200,0.10)' : 'rgba(0,0,0,0.16)';
    g.lineWidth = 1 + rnd() * 1.5;
    g.beginPath(); g.moveTo(cx, Y(t)); g.lineTo(cx + side * len, Y(t + 0.07 + 0.03 * rnd())); g.stroke();
  }
  // pale fringe along the exposed tip edge
  g.strokeStyle = spec.fringe; g.lineWidth = 11; g.globalAlpha = 0.85;
  g.beginPath();
  let started = false;
  for (let i = 0; i <= N; i++) { const t = i / N; if (t < 0.55) continue; const p = left[i]; if (!started) { g.moveTo(p[0], p[1]); started = true; } else g.lineTo(p[0], p[1]); }
  for (let i = N; i >= 0; i--) { const t = i / N; if (t < 0.55) continue; const p = right[i]; g.lineTo(p[0], p[1]); }
  g.stroke();
  g.globalAlpha = 1;
  // vane splits (the edge breaks that make a feather read as a feather)
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 5; i++) {
    const t = 0.35 + rnd() * 0.55, side = rnd() < 0.5 ? -1 : 1;
    const hw = side < 0 ? cx - left[Math.round(t * N)][0] : right[Math.round(t * N)][0] - cx;
    g.lineWidth = 3 + rnd() * 3;
    g.beginPath(); g.moveTo(cx + side * hw * 1.05, Y(t + 0.035)); g.lineTo(cx + side * hw * (0.55 + 0.2 * rnd()), Y(t)); g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  // darker overlap shadow near the base + rachis
  const sh = g.createLinearGradient(0, yb, 0, yb - H * 0.5);
  sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh; g.fillRect(x0, yb - H * 0.5, SLOT_W, H * 0.5);
  g.strokeStyle = spec.shaft; g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    g.lineWidth = 6 - i * 2;
    g.beginPath(); g.moveTo(cx, yb); g.quadraticCurveTo(cx + W * 0.04, Y(0.5), cx, Y(0.95 - i * 0.1)); g.stroke();
  }
  g.restore();
}

let atlas = null;
export function featherAtlas() {
  if (atlas) return atlas;
  const cv = document.createElement('canvas');
  cv.width = SLOT_W * 4; cv.height = SLOT_H * 2;
  const g = cv.getContext('2d');
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  SPECS.forEach((spec, i) => drawFeather(g, (i % 4) * SLOT_W, Math.floor(i / 4) * SLOT_H, spec, rnd));
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
 * Attributes: position, normal, uv (atlas), color (tint), aF = (v, flutter, rand, len), aP = base position.
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
    const lift = f.lift ?? 0.1, cup = f.cup ?? 0.25, arch = f.arch ?? 0.03, rand = f.rand ?? Math.random();
    const tint = f.tint || [1, 1, 1];
    for (let j = 0; j < nv; j++) {
      const v = j / (nv - 1);
      for (let i = 0; i < nu; i++) {
        const u = i / (nu - 1), a = u * 2 - 1;
        const h = -cup * a * a * f.wid * 0.35 + lift * v * v * f.len + arch * Math.sin(Math.PI * v) * f.len;
        _P.fromArray(f.p).addScaledVector(_T, v * f.len).addScaledVector(_B, a * f.wid * 0.5).addScaledVector(_N, h);
        _Q.copy(_N).addScaledVector(_B, cup * a * 0.7).addScaledVector(_T, -lift * 2 * v).normalize();
        pos.set([_P.x, _P.y, _P.z], o * 3); nor.set([_Q.x, _Q.y, _Q.z], o * 3);
        uv.set([u0 + u * 0.25, v0 + (0.004 + v * 0.992) * 0.5], o * 2);
        col.set(tint, o * 3);
        aF.set([v, f.flut ?? 0.2, rand, f.len], o * 4);
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

export function featherMaterial({ wing = false, feet = false, key = 'kcaS3Feather', map = featherAtlas(), rim = '#ffd89a', rimI = 0.55, sheen = 0.25 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.78, metalness: 0, envMapIntensity: 0.6 });
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
    fragHead: 'varying float vS3v; varying float vS3r; uniform vec4 uS3Rim;',
    albedo: 'diffuseColor.rgb *= 0.9 + 0.2 * vS3r;',
    rough: `roughnessFactor = mix(0.86, 0.55, smoothstep(0.4, 1.0, vS3v));`,
    fragEnd: /* glsl */`
    {
      vec3 nn = normalize(normal); vec3 vv = normalize(vViewPosition);
      float ndv = abs(dot(nn, vv));
      // keratin sheen + warm rim on exposed tips: the layered edges catch the low sun
      outgoingLight += uS3Rim.rgb * uS3Rim.a * pow(1.0 - ndv, 3.0) * (0.3 + 0.7 * vS3v) * (0.4 + diffuseColor.r * 2.0);
      outgoingLight += uS3Rim.rgb * ${sheen.toFixed(3)} * pow(1.0 - ndv, 1.5) * smoothstep(0.55, 1.0, vS3v) * diffuseColor.rgb;
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
