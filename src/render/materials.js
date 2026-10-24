// Shared stylized-PBR materials library (look-dev). All are MeshStandardMaterial with injected procedural shading
// (render/shaderlib.js patchStandard), so they keep three's lighting, soft shadows, IBL and the game-wide fog.
// "Painterly" = large-scale warm/cool colour drift + hand-tuned value breakup + derivative bump (heights in metres).
//
//   ground(o)   world-XZ layered terrain: field grass-soil, dry verge, burnt patches (with ember specks), and an
//               optional dirt ROAD band along X (zCenter, halfWidth) with wheel ruts, pebbles and reflective puddles.
//   rock(o)     world triplanar stone: two-tone strata, dark crevices, dust/ash/moss on up-facing surfaces.
//   wood(o)     timber along uv.v (metres) with grain; kmask.r = char, kmask.g = ember glow in the char cracks.
//   bark(o)     gnarled bark ridges along uv.v; kmask like wood.
//   thatch(o)   straw courses (uv.u across, uv.v down-slope, metres); kmask.r = burnt, kmask.g = embers.
//   daub(o)     wattle-and-daub / plaster with soot streaks rising from the base; kmask.r = soot.
//   cloth(o), metal(o)  simple variation materials for props.
// Geometry for wood/bark/thatch/daub MUST carry a vec4 `kmask` attribute (see addMask()).
import * as THREE from 'three';
import { patchStandard } from './shaderlib.js';

const lin = (c) => new THREE.Color(c);
const u3 = (c) => ({ value: lin(c) });

/** Ensure geometry has a kmask attribute (default fill). */
export function addMask(geo, fill = [0, 0, 0, 1]) {
  if (geo.getAttribute('kmask')) return geo;
  const n = geo.getAttribute('position').count, a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a.set(fill, i * 4);
  geo.setAttribute('kmask', new THREE.BufferAttribute(a, 4));
  return geo;
}

const PAINT = /* glsl */`
vec3 kPaint(vec3 c, vec3 wp, float amt) {
  float t = texture2D(kNoise, wp.xz * 0.021 + wp.y * 0.013).r;
  return c * mix(vec3(1.0), mix(vec3(1.07, 0.99, 0.9), vec3(0.92, 0.98, 1.08), t), amt);
}
float kFlick(vec3 wp) { return 0.55 + 0.45 * sin(kTime * 3.1 + wp.x * 3.7 + wp.z * 2.3) * sin(kTime * 1.7 + wp.y * 5.1 + wp.x); }
`;

// ------------------------------------------------------------------ ground
export function ground(o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: o.rough ?? 0.94, metalness: 0, envMapIntensity: o.env ?? 0.6 });
  const road = o.road || null;
  const uniforms = {
    kRoad: { value: new THREE.Vector4(road ? road.z : 0, road ? road.halfWidth : -10, road ? (road.soft ?? 0.35) : 0.1, road ? (road.rut ?? 0.7) : 0) },
    kGOpt: { value: new THREE.Vector4(o.puddles ?? 0.6, o.burn ?? 1, o.embers ?? 1, o.bump ?? 1) },
    kRoadC: u3(o.roadColor || '#8a7c6a'), kRoadD: u3(o.rutColor || '#4a3e34'),
    kField: u3(o.field || '#5a5430'), kField2: u3(o.field2 || '#6e5a34'), kVerge: u3(o.verge || '#8a7446'),
    kBurnt: u3(o.burnt || '#2a2220'), kEmberC: { value: new THREE.Color(o.emberColor || '#ff6a1a').multiplyScalar(o.emberIntensity ?? 3) },
  };
  return patchStandard(m, {
    key: 'kcaGround', uniforms,
    fragHead: `uniform vec4 kRoad; uniform vec4 kGOpt; uniform vec3 kRoadC; uniform vec3 kRoadD; uniform vec3 kField; uniform vec3 kField2;
uniform vec3 kVerge; uniform vec3 kBurnt; uniform vec3 kEmberC;
float kgPuddle = 0.0, kgRut = 0.0, kgRoad = 0.0, kgBurn = 0.0, kgH = 0.0;
${PAINT}`,
    albedo: `
  vec2 p = vKW.xz;
  // Pixel footprint (m/px): fine detail fades out before it can alias into per-pixel speckle at game distance.
  float kfp = max(length(fwidth(p)), 1e-5);
  float fine = 1.0 - smoothstep(0.004, 0.011, kfp);
  float midF = 1.0 - smoothstep(0.02, 0.06, kfp);
  vec4 nL = kN(p * 0.013);
  vec4 nM = kN(p * 0.061 + 0.31);
  vec4 nF = kN(p * 0.29 + 0.57);
  vec4 nX = kN(p * 1.37 + 0.13);
  float wob = (nL.r - 0.5) * 1.7 + (nM.g - 0.5) * 0.55;
  float dz = abs(p.y - kRoad.x + wob);
  kgRoad = 1.0 - smoothstep(kRoad.y - kRoad.z, kRoad.y + kRoad.z, dz + (nF.b - 0.5) * 0.6 * midF);
  float rutD = abs(dz - kRoad.w + (nM.r - 0.5) * 0.18);
  kgRut = exp(-rutD * rutD / 0.07) * kgRoad;
  vec3 field = mix(kField, kField2, smoothstep(0.3, 0.72, nM.g));
  field = mix(field, kVerge, smoothstep(0.42, 0.78, nF.r) * 0.45);
  field = mix(field, kVerge * 1.08, smoothstep(0.56, 0.8, nL.r) * 0.5);
  field *= 0.82 + 0.32 * smoothstep(0.2, 0.8, nM.a);
  kgBurn = smoothstep(0.52, 0.72, nL.g * 0.62 + nM.r * 0.38) * kGOpt.y;
  field = mix(field, kBurnt, kgBurn * (0.8 + 0.2 * nF.g));
  // road: broad painterly value shapes (wheel-worn centre, ash drifts, ruts) — no sub-pixel noise
  vec3 rc = mix(kRoadC, kRoadC * 0.84, smoothstep(0.3, 0.8, nF.g) * midF);
  rc = mix(rc, kRoadC * 1.1, smoothstep(0.55, 0.9, nM.b) * 0.5);
  float peb = (1.0 - smoothstep(0.1, 0.22, nX.a)) * kgRoad * smoothstep(0.4, 0.65, nF.r) * fine;
  rc = mix(rc, kRoadC * 1.18, peb * 0.35);
  rc = mix(rc, kRoadD, kgRut * 0.6);
  // r3 belt breakup — reads at game distance (all terms >= ~10 cm, faded by footprint):
  // raised cart-track crowns beside each rut (lighter, catch the key), long ash drifts streaked along the road
  // toward the verges, and scattered charcoal/debris flecks (burnt thatch, splinters) in dark clusters.
  float crown = exp(-pow(abs(dz - kRoad.w) - 0.34, 2.0) / 0.018) * kgRoad * (0.55 + 0.45 * nM.g);
  rc = mix(rc, kRoadC * 1.22, crown * 0.45);
  vec4 nD = kN(vec2(p.x * 0.045, p.y * 0.55) + 0.19);
  float drift = smoothstep(0.58, 0.8, nD.r * 0.8 + nF.a * 0.2) * smoothstep(0.35, 1.25, dz) * kgRoad;
  rc = mix(rc, vec3(0.2, 0.195, 0.215), drift * 0.55);
  vec4 nB = kN(p * 2.3 + 0.41);
  float deb = (1.0 - smoothstep(0.08, 0.16, nB.g)) * smoothstep(0.55, 0.8, nM.a) * midF;
  rc = mix(rc, kRoadD * 0.55, deb * 0.8 * kgRoad);
  field = mix(field, kBurnt, deb * 0.6 * (1.0 - kgRoad));
  float verge = kgRoad * (1.0 - kgRoad) * 4.0;
  vec3 col = mix(field, rc, kgRoad);
  col = mix(col, kVerge * 0.8, verge * 0.3 * mix(0.5, nF.b, midF));
  // puddles: soft-edged pools in the ruts, ringed by darker wet soil (no hard decal edges)
  float pz = nM.b * 0.75 + nL.b * 0.35;
  float wet = smoothstep(0.52, 0.72, pz) * smoothstep(0.15, 0.7, kgRut) * kGOpt.x * kgRoad;
  kgPuddle = smoothstep(0.64, 0.8, pz) * smoothstep(0.35, 0.85, kgRut) * kGOpt.x * kgRoad;
  col *= mix(1.0, 0.86 + 0.28 * nX.b, fine);
  col *= 0.94 + 0.12 * nF.b * midF;
  col = kPaint(col, vKW, 1.0);
  col = mix(col, col * 0.62, wet);
  col = mix(col, col * 0.32, kgPuddle);
  kgH = (nF.b * 0.02 * midF + nX.b * 0.01 * fine + peb * 0.01 + crown * 0.02 + deb * 0.012 - kgRut * 0.05 + (1.0 - kgRoad) * nM.r * 0.03) * (1.0 - kgPuddle) * kGOpt.w;
  kgPuddle = max(kgPuddle, wet * 0.35);
  diffuseColor.rgb *= col;`,
    rough: `roughnessFactor = mix(roughnessFactor, 0.26, kgPuddle); roughnessFactor = mix(roughnessFactor, 0.78, kgRut * 0.35);`,
    bump: `normal = kBump(-vViewPosition, normal, kgH, 1.0, faceDirection);`,
    emissive: `
  // smouldering ground: soft glowing beds in the burnt patches (radial falloff, no hard edges), kept off the road
  vec4 nE = kN(vKW.xz * 0.37 + 0.71);
  float em = pow(smoothstep(0.7, 1.0, nE.r), 3.0) * smoothstep(0.62, 0.98, kgBurn) * kGOpt.z * 0.55;
  float offRoad = smoothstep(kRoad.y + 0.6, kRoad.y + 1.6, kRoad.x - vKW.z); // only BEHIND the belt, never the foreground bank
  totalEmissiveRadiance += kEmberC * em * (0.6 + 0.4 * kFlick(vKW)) * offRoad;`,
  });
}

// ------------------------------------------------------------------ rock
export function rock(o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: o.rough ?? 0.9, metalness: 0, envMapIntensity: o.env ?? 0.8, flatShading: !!o.flat });
  return patchStandard(m, {
    key: 'kcaRock',
    uniforms: { kRockA: u3(o.color || '#5a534c'), kRockB: u3(o.color2 || '#7a6e62'), kRockTop: u3(o.top || '#6a6040'), kRockOpt: { value: new THREE.Vector4(o.topAmount ?? 0.6, o.scale ?? 1, o.bump ?? 1, 0) } },
    fragHead: `uniform vec3 kRockA; uniform vec3 kRockB; uniform vec3 kRockTop; uniform vec4 kRockOpt; float krH = 0.0;\n${PAINT}`,
    albedo: `
  vec3 wn = normalize(vKN);
  vec4 t1 = kTri(vKW, wn, 0.35 * kRockOpt.y);
  vec4 t2 = kTri(vKW, wn, 1.6 * kRockOpt.y);
  float strata = texture2D(kNoise, vec2(vKW.x * 0.02, vKW.y * 0.9 * kRockOpt.y)).g;
  vec3 c = mix(kRockA, kRockB, smoothstep(0.3, 0.75, t1.r * 0.7 + strata * 0.3));
  c *= 0.72 + 0.5 * t2.b;
  float crev = smoothstep(0.62, 0.35, t1.a);
  c *= 0.55 + 0.45 * crev;
  float topm = smoothstep(0.5, 0.85, wn.y + (t2.g - 0.5) * 0.6);
  c = mix(c, kRockTop * (0.8 + 0.4 * t2.r), topm * kRockOpt.x);
  krH = (t1.a * 0.06 + t2.b * 0.02 + strata * 0.02) * kRockOpt.z;
  diffuseColor.rgb *= kPaint(c, vKW, 1.0);`,
    bump: `normal = kBump(-vViewPosition, normal, krH, 1.0, faceDirection);`,
  });
}

// ------------------------------------------------------------------ wood / bark (uv.v along the grain in metres)
function woody(o, kind) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: o.rough ?? 0.88, metalness: 0, envMapIntensity: o.env ?? 0.5 });
  const bark = kind === 'bark';
  return patchStandard(m, {
    key: bark ? 'kcaBark' : 'kcaWood', useMask: true,
    uniforms: {
      kWoodA: u3(o.color || (bark ? '#3a3029' : '#6a4e36')), kWoodB: u3(o.color2 || (bark ? '#5a4c40' : '#8a6a48')),
      kChar: u3(o.charColor || '#161211'), kWEmber: { value: new THREE.Color(o.emberColor || '#ff5a14').multiplyScalar(o.emberIntensity ?? 4) },
      kWOpt: { value: new THREE.Vector4(o.char ?? 0, o.embers ?? 1, o.bump ?? 1, o.grain ?? 1) },
    },
    fragHead: `uniform vec3 kWoodA; uniform vec3 kWoodB; uniform vec3 kChar; uniform vec3 kWEmber; uniform vec4 kWOpt; float kwH = 0.0; float kwCrack = 0.0; float kwCh = 0.0;\n${PAINT}`,
    albedo: `
  vec2 g = vec2(vKUv.x, vKUv.y);
  float gr = texture2D(kNoise, vec2(g.x * ${bark ? '3.0' : '1.4'}, g.y * ${bark ? '0.09' : '0.05'}) * kWOpt.w).b;
  float gr2 = texture2D(kNoise, vec2(g.x * ${bark ? '9.0' : '5.0'}, g.y * 0.35) + 0.4).b;
  vec3 c = mix(kWoodA, kWoodB, smoothstep(0.25, 0.8, gr * 0.7 + gr2 * 0.3));
  ${bark ? 'c *= 0.55 + 0.65 * smoothstep(0.3, 0.75, gr);' : 'c *= 0.8 + 0.3 * gr2;'}
  kwCh = clamp(vKM.r + kWOpt.x, 0.0, 1.0);
  // Alligatored char: longitudinal splits along the grain + short transverse checks (iso-lines of two stretched
  // noises, anti-aliased with fwidth), dark blocks between them with a grey ash bloom. Embers live ONLY in the
  // thin fissures (kwCrack), never as broad cell blotches.
  float cA = texture2D(kNoise, vec2(g.x * 2.4, g.y * 0.22) + 0.21).r;
  float cB = texture2D(kNoise, vec2(g.x * 0.7, g.y * 1.9) + 0.63).g;
  float lA = 1.0 - smoothstep(0.0, max(0.022, fwidth(cA) * 1.2), abs(cA - 0.5));
  float lB = (1.0 - smoothstep(0.0, max(0.02, fwidth(cB) * 1.2), abs(cB - 0.5))) * smoothstep(0.3, 0.6, texture2D(kNoise, g * vec2(1.3, 0.8) + 0.4).b);
  kwCrack = max(lA, lB * 0.85) * smoothstep(0.45, 0.85, kwCh);
  float ash = smoothstep(0.45, 0.8, texture2D(kNoise, vec2(g.x * 1.1, g.y * 0.4) + 0.11).b);
  vec3 chr = kChar * (0.75 + 0.5 * gr2) + vec3(0.06, 0.058, 0.062) * ash * 0.6;
  c = mix(c, chr, smoothstep(0.0, 0.7, kwCh));
  c = mix(c, kChar * 0.35, kwCrack);
  kwH = (${bark ? 'gr * 0.05 + gr2 * 0.015' : 'gr * 0.012 + gr2 * 0.006'}) - kwCrack * 0.012 * kwCh;
  kwH *= kWOpt.z;
  diffuseColor.rgb *= kPaint(c, vKW, 0.8);`,
    rough: `roughnessFactor = mix(roughnessFactor, 0.97, kwCh);`,
    bump: `normal = kBump(-vViewPosition, normal, kwH, 1.0, faceDirection);`,
    emissive: `
  float hot = smoothstep(0.35, 0.75, texture2D(kNoise, vKUv * vec2(0.9, 0.3) + kTime * vec2(0.0, 0.012)).r);
  totalEmissiveRadiance += kWEmber * kwCrack * (0.15 + 0.85 * hot) * vKM.g * kWOpt.y * kFlick(vKW);`,
  });
}
export const wood = (o = {}) => woody(o, 'wood');
export const bark = (o = {}) => woody(o, 'bark');

// ------------------------------------------------------------------ thatch (uv.u across the slope, uv.v down the slope, metres)
export function thatch(o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, envMapIntensity: o.env ?? 0.45, side: THREE.DoubleSide });
  return patchStandard(m, {
    key: 'kcaThatch', useMask: true,
    uniforms: {
      kThA: u3(o.color || '#7a6644'), kThB: u3(o.color2 || '#9a8458'), kThBurnt: u3(o.burnt || '#1c1612'),
      kThEmber: { value: new THREE.Color(o.emberColor || '#ff6418').multiplyScalar(o.emberIntensity ?? 5) },
      kThOpt: { value: new THREE.Vector4(o.course ?? 0.32, o.embers ?? 1, o.bump ?? 1, 0) },
    },
    fragHead: `uniform vec3 kThA; uniform vec3 kThB; uniform vec3 kThBurnt; uniform vec3 kThEmber; uniform vec4 kThOpt; float ktH = 0.0; float ktB = 0.0; float ktS = 0.0;\n${PAINT}`,
    albedo: `
  vec2 g = vKUv;
  float strand = texture2D(kNoise, vec2(g.x * 2.6, g.y * 0.12)).b;
  float strand2 = texture2D(kNoise, vec2(g.x * 7.0, g.y * 0.3) + 0.5).b;
  float course = fract(g.y / kThOpt.x + (texture2D(kNoise, vec2(g.x * 0.15, 0.3)).r - 0.5) * 0.6);
  float lip = smoothstep(0.55, 1.0, course);
  vec3 c = mix(kThA, kThB, smoothstep(0.3, 0.8, strand * 0.6 + strand2 * 0.4));
  c *= (0.55 + 0.6 * strand2 * strand) * (1.0 - lip * 0.28);
  float moss = texture2D(kNoise, g * 0.07 + 0.2).g;
  c = mix(c, c * vec3(0.72, 0.78, 0.6), smoothstep(0.55, 0.8, moss) * 0.5);
  ktB = clamp(vKM.r + (texture2D(kNoise, g * 0.2).r - 0.5) * 0.35 * step(0.01, vKM.r), 0.0, 1.0);
  c = mix(c, kThBurnt * (0.7 + 0.6 * strand), smoothstep(0.15, 0.75, ktB));
  ktS = strand;
  ktH = (strand * 0.03 + strand2 * 0.012 - lip * 0.035) * kThOpt.z;
  diffuseColor.rgb *= kPaint(c, vKW, 0.8);`,
    bump: `normal = kBump(-vViewPosition, normal, ktH, 1.0, faceDirection);`,
    emissive: `
  float eg = smoothstep(0.35, 0.65, ktB) * (1.0 - smoothstep(0.75, 1.0, ktB)) * vKM.g;
  float sp = smoothstep(0.62, 0.85, texture2D(kNoise, vKUv * vec2(1.3, 0.5) + kTime * vec2(0.0, -0.02)).r);
  totalEmissiveRadiance += kThEmber * eg * (0.25 + sp * 1.4) * kThOpt.y * kFlick(vKW);`,
  });
}

// ------------------------------------------------------------------ wattle & daub / plaster (uv.v = height in metres)
export function daub(o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, envMapIntensity: o.env ?? 0.5 });
  return patchStandard(m, {
    key: 'kcaDaub', useMask: true,
    uniforms: { kDaA: u3(o.color || '#7a6a55'), kDaB: u3(o.color2 || '#958270'), kSoot: u3(o.soot || '#221c18'), kDaOpt: { value: new THREE.Vector4(o.bump ?? 1, 0, 0, 0) } },
    fragHead: `uniform vec3 kDaA; uniform vec3 kDaB; uniform vec3 kSoot; uniform vec4 kDaOpt; float kdH = 0.0;\n${PAINT}`,
    albedo: `
  vec2 g = vKUv;
  vec4 n1 = texture2D(kNoise, g * 0.35);
  vec4 n2 = texture2D(kNoise, g * 1.6 + 0.3);
  vec3 c = mix(kDaA, kDaB, smoothstep(0.3, 0.75, n1.r * 0.6 + n2.b * 0.4));
  c *= 0.85 + 0.2 * n2.g;
  float streak = texture2D(kNoise, vec2(g.x * 0.9, g.y * 0.08)).b;
  float soot = clamp(vKM.r * (0.6 + streak * 0.8) + smoothstep(0.7, 0.9, streak) * 0.25, 0.0, 1.0);
  c = mix(c, kSoot, soot);
  float crack = smoothstep(0.55, 0.7, texture2D(kNoise, g * 0.45 + 0.6).a);
  c *= 1.0 - crack * 0.25;
  kdH = (n1.r * 0.02 + n2.b * 0.006 - crack * 0.006) * kDaOpt.x;
  diffuseColor.rgb *= kPaint(c, vKW, 0.8);`,
    bump: `normal = kBump(-vViewPosition, normal, kdH, 1.0, faceDirection);`,
  });
}

// ------------------------------------------------------------------ simple variation materials
export function cloth(o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  return patchStandard(m, {
    key: 'kcaCloth', uniforms: { kClA: u3(o.color || '#6a2a22'), kClB: u3(o.color2 || '#4a1c18') },
    fragHead: `uniform vec3 kClA; uniform vec3 kClB;\n${PAINT}`,
    albedo: `float w = texture2D(kNoise, vKUv * vec2(6.0, 6.0)).b; float big = texture2D(kNoise, vKUv * 0.6).r;
  diffuseColor.rgb *= kPaint(mix(kClA, kClB, smoothstep(0.3, 0.7, big)) * (0.85 + 0.25 * w), vKW, 0.6);`,
  });
}

export function metal(o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: o.metalness ?? 0.85, envMapIntensity: o.env ?? 1 });
  return patchStandard(m, {
    key: 'kcaMetal', uniforms: { kMeA: u3(o.color || '#6a625a'), kMeRust: u3(o.rust || '#5a3018'), kMeOpt: { value: new THREE.Vector4(o.rustAmount ?? 0.3, 0, 0, 0) } },
    fragHead: `uniform vec3 kMeA; uniform vec3 kMeRust; uniform vec4 kMeOpt; float kmR = 0.0;`,
    albedo: `vec4 t = kTri(vKW, normalize(vKN), 1.3); kmR = smoothstep(0.55, 0.8, t.r * 0.7 + t.b * 0.3) * kMeOpt.x;
  diffuseColor.rgb *= mix(kMeA * (0.8 + 0.3 * t.g), kMeRust, kmR);`,
    rough: `roughnessFactor = mix(roughnessFactor, 0.9, kmR);`,
    bump: `metalnessFactor = mix(metalnessFactor, 0.1, kmR);`,
  });
}
