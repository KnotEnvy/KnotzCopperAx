// Stage 5 floor: worn black-green obsidian slabs (2.4 m) framed by a border of small basalt setts (mixed scale),
// recessed seams with grime, fine glassy veins + conchoidal chips; env r32: rough worn surface (no mirror pools), a few
// worn-polish patches keep short soft reflections of the witchfire.
// The arena carries a bronze-inlaid coiled-serpent roundel; the gallery's near edge has COLLAPSED into a green-lit
// abyss (ring-outs); three arena CRACK ZONES glow and open into pits on demand (Morvane phase 2).
import * as THREE from 'three';
import { patchMaterial, S5 } from './shading.js';
import { GALLERY, EDGE_Z, CRACKS, ARENA } from './layout.js';

export const PITS = { s5Pit: { value: CRACKS.map((c) => new THREE.Vector4(c.x, c.z, c.r, 0)) } };

const FLOOR_PARS = /* glsl */`
uniform vec4 s5Pit[${CRACKS.length}];
uniform vec4 s5Gallery;   // x0, x1, edgeZ, roundel x
`;

const FLOOR_SURFACE = /* glsl */`
vec2 p = vS5World.xz;
// ---- collapsed gallery edge (the ledge kit covers the break)
if (p.x > s5Gallery.x && p.x < s5Gallery.y && p.y > s5Gallery.z + (s5n(vec2(p.x * 1.7, 0.0)) - 0.5) * 0.3) discard;
// ---- pits (phase 2): cracks glow for state 0..1, hole opens for state 1..2
float crackGlow = 0.0;
for (int i = 0; i < ${CRACKS.length}; i++) {
  vec4 P = s5Pit[i];
  if (P.w <= 0.0) continue;
  vec2 d = p - P.xy; float r = length(d);
  float a = atan(d.y, d.x);
  float jag = (s5n(vec2(a * 3.0, float(i) * 7.0)) - 0.5) * 0.5 * P.z;
  float hole = P.z * clamp(P.w - 1.0, 0.0, 1.0) + jag * step(1.0, P.w);
  if (r < hole) discard;
  float reach = P.z * (0.5 + 0.9 * min(P.w, 1.0)) * 1.4;
  float lines = abs(sin(a * 5.0 + s5n(d * 2.2) * 5.0 + float(i)));
  float web = (1.0 - smoothstep(0.0, 0.07, lines * (0.35 + r * 0.25))) * smoothstep(reach, reach * 0.4, r);
  float rim = smoothstep(0.35, 0.0, abs(r - hole)) * step(1.0, P.w);
  crackGlow = max(crackGlow, max(web * min(P.w * 1.5, 1.0), rim));
}
// ---- slab grid: 2.4 m obsidian slabs inside a 0.3 m border of basalt setts
float SL = 2.7;
vec2 g = p / SL + vec2(0.37, 0.21);
vec2 id = floor(g); vec2 f = fract(g) * SL;              // 0..SL inside the cell
float h1 = s5h(id), h2 = s5h(id + 17.3), h3 = s5h(id + 41.7);
float bw = 0.3;
float inSlab = step(bw, f.x) * step(f.x, SL) * step(bw, f.y);
vec2 e = min(f - bw, SL - f);
float edgeS = min(e.x, e.y);
vec2 sf = fract(f / bw); vec2 sid = floor((p + 0.37) / bw);
vec2 se = min(sf, 1.0 - sf) * bw;
float settEdge = min(se.x, se.y);
float wob = (s5n(p * 6.0) - 0.5) * 0.02;
float seam = inSlab > 0.5 ? 1.0 - smoothstep(0.008, 0.035, edgeS + wob) : 1.0 - smoothstep(0.01, 0.03, settEdge + wob);
float bev = inSlab > 0.5 ? 1.0 - smoothstep(0.02, 0.09, edgeS) : 1.0 - smoothstep(0.015, 0.05, settEdge);
vec2 edir = inSlab > 0.5 ? (e.x < e.y ? vec2(f.x - bw < SL - f.x ? -1.0 : 1.0, 0.0) : vec2(0.0, f.y - bw < SL - f.y ? -1.0 : 1.0))
                         : (se.x < se.y ? vec2(sign(sf.x - 0.5), 0.0) : vec2(0.0, sign(sf.y - 0.5)));
// veins: thin glassy flow lines through each slab; chips: conchoidal fractures
float vn = s5fbm(p * 0.9 + h1 * 11.0);
float vein = (1.0 - smoothstep(0.0, 0.025, abs(vn - 0.5))) * inSlab;
float chip = smoothstep(0.72, 0.8, s5fbm(p * 3.3 + h2 * 5.0)) * inSlab;
float scuff = s5fbm(p * 1.6 + 9.0);
// albedo
vec3 obs = mix(vec3(0.012, 0.018, 0.017), vec3(0.02, 0.026, 0.024), h1);
vec3 setts = mix(vec3(0.012, 0.012, 0.014), vec3(0.02, 0.019, 0.021), s5h(sid)) * (0.8 + 0.4 * s5n(p * 9.0));
vec3 alb = inSlab > 0.5 ? obs : mix(setts, obs, 0.6 * smoothstep(0.35, 0.95, s5h(sid + 7.1)));
alb += vec3(0.02, 0.05, 0.035) * vein;
alb = mix(alb, vec3(0.05, 0.055, 0.05), chip * 0.6);
alb = mix(alb, vec3(0.006, 0.007, 0.007), seam);
// dust / grime: collects near the walls and along seams, scuffed paths along the belt
float wallDust = smoothstep(-2.5, -7.0, p.y);
float dust = clamp(wallDust * 0.5 + seam * 0.4 + smoothstep(0.5, 0.9, scuff) * 0.22 + (1.0 - inSlab) * smoothstep(0.45, 0.75, s5n(p * 1.3 + 4.0)) * 0.45, 0.0, 1.0);
// ragged, MATTE grime margin creeping from the border into each slab (breaks the ruler-straight border edge; it must
// not catch the fire sheen — its specular is cut below)
float margin = inSlab * (1.0 - smoothstep(0.0, 0.22, edgeS - (s5n(p * 2.3 + h1 * 9.0) - 0.35) * 0.3));
alb = mix(alb, vec3(0.03, 0.029, 0.03), dust * 0.5);
// arena roundel: bronze ring + coiled serpent inlay around the arena centre
vec2 rc = p - vec2(s5Gallery.w, 0.2);
float rr = length(rc);
float ringA = 1.0 - smoothstep(0.03, 0.07, abs(rr - 3.9));
float ringB = 1.0 - smoothstep(0.02, 0.05, abs(rr - 3.55));
float ang = atan(rc.y, rc.x);
float spiral = 1.0 - smoothstep(0.05, 0.11, abs(fract((rr - ang / 6.2832 * 0.9) / 0.9) - 0.5) * 0.9);
spiral *= smoothstep(3.4, 3.2, rr) * smoothstep(0.4, 0.9, rr);
float scaleDots = step(0.5, fract(ang * 18.0 / 6.2832 + rr)) * ringA;
float inlay = max(max(ringA, ringB), spiral * 0.9);
alb = mix(alb, vec3(0.08, 0.055, 0.028) * (0.8 + 0.3 * scaleDots), inlay);
// normal: per-slab micro tilt, bevel toward seams, chips
vec3 nW = vec3((h2 - 0.5) * 0.03, 1.0, (h3 - 0.5) * 0.03);
// perf-1650 r3 (critics: "neon green grid"): the 0.5 bevel tilt turned every slab edge into a thin mirror of the green
// witchfire → 0.14 (the edge still turns, no longer a lit line)
nW.xz += edir * bev * (inSlab > 0.5 ? 0.14 : 0.06);
nW.xz += (vec2(s5n(p * 11.0), s5n(p * 11.0 + 3.3)) - 0.5) * (inSlab > 0.5 ? 0.02 + chip * 0.4 : 0.07);
// r32 single fix: cleaved stone terraces and sparse edge spalls. These are normal/roughness changes; preserve the
// approved slab albedo and dark seam calculation. Offset each slab's grain so no repeated stamp crosses the hall.
mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
vec3 bed = s5ng(p * 3.2 + vec2(h2, h3) * 13.0), grit = s5ng(turn * p * 9.5 + 17.0);
vec3 cleft = s5cleft(p * 1.8 + vec2(h2, h3) * 5.0);
float broken = smoothstep(0.46, 0.7, scuff) * inSlab;
float cut = (1.0 - smoothstep(0.006, 0.03, cleft.x)) * broken;
vec2 stoneSlope = bed.yz * 0.025 + transpose(turn) * grit.yz * 0.07;
stoneSlope += cleft.yz * (1.0 - smoothstep(0.015, 0.085, cleft.x)) * broken * 0.12;
float spall = inSlab * (1.0 - smoothstep(0.04, 0.24, edgeS)) * smoothstep(0.48, 0.76, grit.x);
nW.xz -= stoneSlope * (1.0 - seam) * (inSlab > 0.5 ? 1.0 : 0.35);
nW.xz += edir * spall * 0.13;
// A few short fractures start at the existing cut edge and die inside the slab; no full-cell vein stamp or bright
// outline. The fracture's core only darkens, while its rough lips tilt a little toward/away from the existing light.
float along = e.x < e.y ? f.y : f.x;
float scarD = along - (0.55 + 1.55 * h2 + 0.10 * sin(edgeS * 28.0 + h1 * 21.0));
float scarReach = (1.0 - smoothstep(0.12, 0.45 + h1 * 0.3, edgeS)) * inSlab * step(0.48, h3);
float scar = (1.0 - smoothstep(0.008, 0.028, abs(scarD))) * scarReach;
nW.xz += vec2(edir.y, edir.x) * sign(scarD) * (1.0 - smoothstep(0.012, 0.065, abs(scarD))) * scarReach * 0.075;
s5N = normalize(nW);
normal = normalize((viewMatrix * vec4(s5N, 0.0)).xyz);
diffuseColor.rgb = alb;
// env r32: WORN ROUGH obsidian. The near-mirror slabs (rough 0.06, mirror 0.9) turned the stage back light and the
// witchfire into repeated green-white glare pools, one per tilted slab. Slabs are now rough 0.72-0.86 with sparse
// irregular worn-polish patches (down to ~0.5) that keep a few short broken reflections near the braziers.
float wear = smoothstep(0.6, 0.84, s5fbm(p * 0.55 + h3 * 6.0)) * (1.0 - dust);
s5Wet = inSlab > 0.5 ? (0.2 + 0.45 * wear) * (1.0 - dust * 0.6) : 0.1;
// border setts: irregular — per-sett polish (some glassy like the slabs, most matte) under patchy grime, so the border
// band melts into the slabs in places instead of drawing an even dark grid line around every slab
float settPol = smoothstep(0.35, 0.95, s5h(sid + 7.1)) * (1.0 - smoothstep(0.3, 0.7, dust));
// Dust + chips can exceed the polish budget; keep mirror weights nonnegative (pow(0, negative) is undefined).
s5Mirror = inSlab > 0.5 ? max(0.3 * wear - dust * 0.2 - chip * 0.6, 0.0) * (1.0 - seam) : settPol * 0.08 * (1.0 - seam);
roughnessFactor = inSlab > 0.5 ? clamp(mix(0.74, 0.86, dust) - 0.24 * wear + chip * 0.06, 0.5, 0.92) : 0.84;
roughnessFactor = clamp(roughnessFactor + (scuff - 0.45) * 0.2 + spall * 0.12 + cut * 0.12 + (h2 - 0.5) * 0.08, 0.5, 0.96);
// perf-1650 look fix: every slab's bevel (normals tilted toward the seam) mirrored the green witchfire into a thin
// bright line and the rough sett border caught a broad sheen → the floor read as a neon grid. Bevels keep a quarter of
// the direct specular, the matte setts a third; the slab faces are unchanged.
s5SpecK = inSlab > 0.5 ? mix(1.0, 0.22, bev) : 0.5;   // env r32: 0.1 → 0.5: the setts share the (now broad, rough) sheen so the border is no dark grid either   // setts: the green fire sheen on the rough border WAS the grid
s5Mirror *= 1.0 - 0.95 * bev * inSlab;
// env r32: margin cut 0.8/0.45 → 0.3/0.25 — against the now evenly sheened slabs the old cut drew a wide dark grid
s5Mirror *= 1.0 - 0.8 * margin; s5SpecK *= 1.0 - 0.3 * margin;
alb *= 1.0 - 0.25 * margin; diffuseColor.rgb = alb;
diffuseColor.rgb *= (1.0 - 0.16 * spall) * (1.0 - 0.38 * scar) * (1.0 - 0.22 * cut);
metalnessFactor = inlay * 0.3;
if (inlay > 0.5) { roughnessFactor = 0.6; s5Mirror = 0.0; s5Wet = 0.2; }
s5Emit = vec3(0.25, 1.0, 0.45) * crackGlow * (1.6 + 0.6 * sin(s5Time * 5.0 + p.x));
`;

const ABYSS_V = /* glsl */`
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
const ABYSS_F = /* glsl */`
varying vec3 vW; uniform float s5Time; uniform float uGlow;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
void main() {
  vec2 p = vW.xz * 0.35;
  float a = n(p + vec2(0.0, s5Time * 0.05)) * 0.6 + n(p * 2.3 - s5Time * 0.08) * 0.4;
  float veins = smoothstep(0.62, 0.8, a);
  vec3 col = vec3(0.004, 0.012, 0.008) + vec3(0.06, 0.35, 0.14) * veins * uGlow + vec3(0.01, 0.05, 0.025) * a * uGlow;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function buildFloor(ctx, kit) {
  const { group } = ctx;
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0 }), {
    key: 'floor', surface: FLOOR_SURFACE, extraPars: FLOOR_PARS, laneK: 1,   // env r32: broad cool lane sheen (shading.js s5Lane)
    uniforms: { ...PITS, s5Gallery: { value: new THREE.Vector4(GALLERY.x0, GALLERY.x1, EDGE_Z, (ARENA.x0 + ARENA.x1) / 2) } },
  });
  const geo = new THREE.PlaneGeometry(130, 26, 1, 1); geo.rotateX(-Math.PI / 2); geo.translate(30, 0, -1);
  const floor = new THREE.Mesh(geo, mat);
  floor.receiveShadow = true; floor.name = 's5_floor';
  mat.userData.noPrepass = true; // perf-1650: its shader DISCARDS (gallery break, pits) → a depth pre-pass would hide the abyss
  group.add(floor);

  // abyss below the gallery break: ruined substructure (ledge kit) + a far green-veined depth
  const abyssMat = new THREE.ShaderMaterial({ vertexShader: ABYSS_V, fragmentShader: ABYSS_F, uniforms: { s5Time: S5.s5Time, uGlow: { value: 1 } }, fog: false });
  const ag = new THREE.PlaneGeometry(GALLERY.x1 - GALLERY.x0 + 8, 16); ag.rotateX(-Math.PI / 2);
  const abyss = new THREE.Mesh(ag, abyssMat);
  abyss.position.set((GALLERY.x0 + GALLERY.x1) / 2, -9, EDGE_Z + 8);
  group.add(abyss);
  const ledges = [];
  for (let x = GALLERY.x0 + 4; x < GALLERY.x1 + 3.9; x += 8) ledges.push({ x, y: 0, z: EDGE_Z, s: 1 });
  kit.place(group, 'ledge', ledges);
  // the far (camera-side) lip of the chasm, seen upside-down in perspective — dark basalt mass
  const far = new THREE.Mesh(new THREE.BoxGeometry(GALLERY.x1 - GALLERY.x0 + 8, 10, 1), new THREE.MeshBasicMaterial({ color: '#030504' }));
  far.position.set((GALLERY.x0 + GALLERY.x1) / 2, -5.5, EDGE_Z + 11);
  group.add(far);
  // witchfire haze welling up out of the chasm just past the lip (additive, fades upward; breaks along x)
  const hazeMat = new THREE.ShaderMaterial({
    uniforms: { s5Time: S5.s5Time },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec2 vUv; varying vec3 vW; uniform float s5Time;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){ float wisps = n(vec2(vW.x * 0.6, vW.y * 0.8 - s5Time * 0.4)) * 0.6 + n(vec2(vW.x * 1.7 + 3.0, vW.y * 1.5 - s5Time * 0.7)) * 0.4;
        float a = smoothstep(1.0, 0.0, vUv.y) * smoothstep(0.0, 0.15, vUv.y) * (0.35 + 0.9 * wisps);
        a *= smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
        gl_FragColor = vec4(vec3(0.08, 0.5, 0.2) * a * 0.55, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  for (const dz of [0.9, 2.2]) {
    const hz = new THREE.Mesh(new THREE.PlaneGeometry(GALLERY.x1 - GALLERY.x0 + 2, 4.2), hazeMat);
    hz.position.set((GALLERY.x0 + GALLERY.x1) / 2, -2.6 + dz * 0.3, EDGE_Z + dz); hz.renderOrder = 5;
    group.add(hz);
  }

  // pits (inner walls, visible only through the discarded floor hole)
  const pitMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#1a1e1c', roughness: 0.9, side: THREE.BackSide }), {
    key: 'pitwall',
    surface: /* glsl */`
      float depth = clamp(-vS5World.y / 7.0, 0.0, 1.0);
      float rough = s5fbm(vS5World.xy * 2.0 + vS5World.zx * 2.0);
      diffuseColor.rgb = vec3(0.04, 0.045, 0.043) * (0.6 + 0.8 * rough) * (1.0 - depth * 0.8);
      float strata = smoothstep(0.35, 0.5, fract(vS5World.y * 1.7 + rough * 0.8));
      diffuseColor.rgb *= 0.6 + 0.8 * strata;
      s5Emit = vec3(0.06, 0.45, 0.2) * (0.12 + pow(depth, 1.3) * 1.1) * (0.5 + 0.5 * rough) * (0.6 + 0.4 * strata)
             + vec3(0.2, 1.0, 0.4) * smoothstep(0.03, 0.0, abs(rough - 0.55)) * (0.3 + depth);
      roughnessFactor = 0.9;`,
  });
  const pits = CRACKS.map((c) => {
    const cg = new THREE.CylinderGeometry(1, 0.7, 8, 20, 4, true); cg.translate(0, -4, 0);
    const pos = cg.attributes.position;
    for (let i = 0; i < pos.count; i++) { const k = 1 + (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.12; pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); }
    cg.computeVertexNormals();
    const m = new THREE.Mesh(cg, pitMat);
    m.position.set(c.x, 0, c.z); m.visible = false; m.name = 's5_pit';
    group.add(m);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#2aff70', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.y = -6.5; m.add(glow);
    return m;
  });

  return {
    floor, mat, abyss, pits,
    /** state per crack zone: 0 intact, 0..1 cracks spreading, 1..2 hole opening (radius r * (state - 1)). */
    setPit(i, state) {
      const v = PITS.s5Pit.value[i]; if (!v) return;
      v.w = state;
      const open = Math.max(0, Math.min(1, state - 1));
      const m = pits[i]; m.visible = open > 0.01;
      const r = Math.max(0.01, CRACKS[i].r * open * 1.12);
      m.scale.set(r, 1, r);
    },
    pitState: (i) => PITS.s5Pit.value[i] ? PITS.s5Pit.value[i].w : 0,
  };
}
