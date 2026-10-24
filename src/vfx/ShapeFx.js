// ShapeFx: GPU-instanced designed effect quads (analytic shapes + one cached authored contact flame), one draw call per
// pool. Each instance is a quad oriented one of three ways and shaded by an analytic shape whose evolution is
// driven by its life progress t (0..1) and 4 shape params that ease from p0 → p1 over life.
//
//   pool.emit({
//     shape: 'glow'|'ring'|'star'|'slash'|'line'|'crack'|'bolt'|'flame'|'ripple'|'flare'|'dustring'|'disc'|'burst'|'orb'|'shard'|'lick'|'spike'|'contact'|'combustion'|'cutarc',
//     mode:  'billboard' (camera-facing, rot/spin) | 'plane' (world plane: normal, default ground [0,1,0]) |
//            'axial' (long axis = dir, width faces the camera: slashes, speed lines, bolts, flame tongues),
//     pos: [x,y,z], vel?, drag?, gravity?,
//     size: [w, h] metres (axial: [length, width]), grow: [s0, s1] (scale over life), growY: [s0, s1] (defaults grow),
//     ease: 'out'|'in'|'inout'|'linear'|'back'  (for grow + params),
//     dir: [x,y,z] (axial long axis / plane "right"), normal: [x,y,z] (plane), rot, spin,
//     life, hold (s: t frozen at 0 = hitstop sync), delay (s: hidden until),
//     color: [c0, c1] (hex|Color|[r,g,b,a]), intensity, alpha: [a0, a1] (default [1, 0] for hex colours),
//     p0: [a,b,c,d], p1: [a,b,c,d] (shape params, see FRAG), seed, occ (0 additive … 0.9 mostly solid; DEF_OCC) })
//
// contact/combustion/cutarc use designed HDR colours in the normal-blended pool for a stable dark contour.
// Pools: new ShapePool({ additive: true }) → emissive HDR (vfx.shape);  { additive: false, lit: true } → albedo lit by
// the stage lights (vfx.shapeLit: dust rings, crack stains).
import * as THREE from 'three';
import { contactFlame } from './hitArt.js';
import { NOISE, LIT, FOG_ADDITIVE, litUniforms } from './glsl.js';

export const SHAPE_IDS = { glow: 0, ring: 1, star: 2, slash: 3, line: 4, crack: 5, bolt: 6, flame: 7, ripple: 8, flare: 9, dustring: 10, disc: 11, burst: 12, orb: 13, shard: 14, lick: 15, spike: 16, contact: 17, combustion: 18, cutarc: 19 };
const MODE_IDS = { billboard: 0, plane: 1, axial: 2 };
const EASE = [
  (t) => 1 - (1 - t) ** 3,                                   // out
  (t) => t * t * t,                                          // in
  (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2), // inout
  (t) => t,                                                  // linear
  (t) => { const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; }, // back
];
const EASE_IDS = { out: 0, in: 1, inout: 2, linear: 3, back: 4 };
// Default occlusion (premultiplied 'over' amount, 0..0.9) per shape: silhouettes that must read on pale bodies
// cover more; big soft/ground shapes stay nearly additive.
const DEF_OCC = { glow: 0.2, ring: 0.1, star: 0.6, slash: 0.6, line: 0.5, crack: 0.3, bolt: 0.5, flame: 0.12, ripple: 0.1, flare: 0.3, disc: 0, burst: 0.55, orb: 0.15, shard: 0.7 };
// Default shape params per shape (p0 when not given).
const DEF_P = {
  glow: [2.2, 0.6, 0, 0], ring: [0.2, 0.25, 0.5, 1], star: [8, 22, 1, 0.6], slash: [0.35, 0.22, 0.5, 1],
  line: [0.35, 1, 1, 0], crack: [1, 0.06, 0.6, 7], bolt: [0.35, 0.05, 0.08, 0], flame: [0.6, 0.6, 1.5, 0.8],
  ripple: [0.3, 0.05, 0.12, 0.6], flare: [0.08, 0.2, 0, 0], dustring: [0.3, 0.15, 0, 0.5], disc: [2, 0, 0, 0],
  burst: [7, 0.42, 0.12, 0], orb: [0.6, 0.5, 2.0, 0.5], shard: [0.4, 0.5, 0, 0], lick: [0.7, 0.5, 1, 0], spike: [0.2, 0.1, 0, 0], contact: [0, 0, 0, 0], combustion: [0.65, 0.5, 1, 0], cutarc: [0.36, 0.28, 0, 0],
};

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec3 iAx;
attribute vec3 iAy;
attribute vec4 iCol;
attribute vec4 iPar;   // shape, t, mode, seed
attribute vec4 iPar2;  // shape params
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vPar;
varying vec4 vPar2;
varying vec3 vN;
varying vec3 vViewPos;
#include <fog_pars_vertex>
vec3 vfxUnit(vec3 v) { return v * inversesqrt(max(dot(v, v), 1e-12)); }
void main() {
  vUv = uv; vCol = iCol; vPar = iPar; vPar2 = iPar2;
  vec2 c = position.xy * 2.0;
  int mode = int(iPar.z + 0.5);
  vec4 mvPosition;
  if (mode == 0) {
    mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    float cs = cos(iAx.z), sn = sin(iAx.z);
    vec2 q = vec2(c.x * iAx.x, c.y * iAx.y);
    mvPosition.xy += vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
    vN = vec3(0.0, 0.0, 1.0);
  } else {
    vec3 ax = iAx, ay = iAy;
    if (mode == 2) {
      vec3 wc = (modelMatrix * vec4(iPos, 1.0)).xyz;
      vec3 toCam = vfxUnit(cameraPosition - wc);
      vec3 d = vfxUnit(iAx + vec3(1e-6));
      vec3 side = cross(d, toCam);
      float sl = length(side);
      side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
      ay = side * iAy.x;
    }
    mvPosition = modelViewMatrix * vec4(iPos + ax * c.x + ay * c.y, 1.0);
    vN = vfxUnit(normalMatrix * vfxUnit(cross(ax, ay) + vec3(0.0, 1e-5, 0.0)));
    if (vN.z < 0.0) vN = -vN;
  }
  vViewPos = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = (lit) => /* glsl */`
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vPar;
varying vec4 vPar2;
varying vec3 vN;
varying vec3 vViewPos;
uniform sampler2D uContactFlame;
#include <common>
${lit ? '#include <lights_pars_begin>' : ''}
#include <fog_pars_fragment>
${NOISE}
${lit ? LIT : ''}
vec3 vfxUnit(vec3 v) { return v * inversesqrt(max(dot(v, v), 1e-12)); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  float ang = atan(p.y, p.x);
  vec2 cs = vec2(cos(ang), sin(ang));
  float t = vPar.y, seed = fract(vPar.w), occ = floor(vPar.w) * 0.1;
  vec4 P = vPar2;
  int s = int(vPar.x + 0.5);
  float a = 0.0, hot = 0.0;
  vec3 designed = vec3(-1.0);
  if (s == 0) {            // GLOW  P: falloff, core
    a = pow(max(0.0, 1.0 - d), P.x); hot = pow(max(0.0, 1.0 - d), P.x * 4.0) * P.y;
  } else if (s == 1) {     // RING  P: radius, thickness, breakup, inner softness
    float dr = d - P.x;
    float band = dr > 0.0 ? 1.0 - smoothstep(0.0, P.y * 0.3, dr) : pow(smoothstep(-P.y, 0.0, dr), 1.0 + P.w);
    float n = vfxFbm(cs * 2.2 + seed * 13.0 + vec2(d * 1.5, 0.0));
    band *= mix(1.0, smoothstep(t * 0.85 - 0.15, t * 0.85 + 0.2, n), P.z);
    a = band * smoothstep(1.0, 0.94, d);
    hot = (1.0 - smoothstep(0.0, P.y * 0.18, abs(dr + P.y * 0.04))) * (1.0 - t) * 0.25;
  } else if (s == 2) {     // STAR  P: rays, sharpness, length, core
    float ph = ang * P.x * 0.5 + seed * 6.2831;
    float r = abs(cos(ph));
    float len = mix(0.5, 1.0, step(0.0, cos(ph))) * P.z * mix(0.85, 1.0, vfxH11(floor(ph / 3.14159 + 0.5) + seed * 7.0));
    float ray = pow(r, P.y * (1.0 + d * 5.0)) * smoothstep(len, len * 0.15, d);
    float core = pow(max(0.0, 1.0 - d / (0.32 * P.z + 0.04)), 2.0) * P.w;
    a = max(ray, core); hot = core + ray * smoothstep(len * 0.7, 0.0, d);
  } else if (s == 3) {     // SLASH (axial; x along the swing)  P: bow, thickness, tail, hot edge
    // At t=0 (impact, held through hitstop) the arc is already drawn to its middle; the head then runs out
    // and the tail chases it (wipe-off), so the slash reads on the very first frame.
    float tt = 1.0 - pow(1.0 - t, 2.0);
    float hp = mix(0.25, 1.2, tt);
    float tp = mix(-1.15, 1.0, pow(t, 0.75)) - P.z * 0.3;
    float yc = P.x * (1.0 - p.x * p.x) - P.x * 0.5;
    float th = P.y * pow(max(0.0, 1.0 - p.x * p.x), 0.7) + 0.004;
    float dy = p.y - yc;
    float prof = dy > 0.0 ? 1.0 - smoothstep(0.0, th * 0.3, dy) : pow(smoothstep(-th, 0.0, dy), 1.6);
    float along = smoothstep(tp, tp + 0.55, p.x) * (1.0 - smoothstep(hp - 0.04, hp, p.x));
    a = prof * along * smoothstep(1.0, 0.8, abs(p.x));
    hot = (1.0 - smoothstep(0.0, th * 0.35, abs(dy - th * 0.08))) * along * P.w;
  } else if (s == 4) {     // LINE (axial; head at +x)  P: thickness, head heat, taper
    float w = P.x * mix(1.0, p.x * 0.5 + 0.5, P.z) * (1.0 - p.x * p.x * 0.3) + 0.003;
    a = (1.0 - smoothstep(w * 0.25, w, abs(p.y))) * smoothstep(-1.0, -0.3, p.x) * smoothstep(1.0, 0.75, p.x);
    hot = a * smoothstep(0.1, 0.85, p.x) * P.y;
  } else if (s == 5) {     // CRACK (plane)  P: extent, line width, stain, branches
    float N = P.w;
    float wob = (vfxFbm(p * 2.3 + seed * 5.0) - 0.5) + (vfxNoise(p * 9.0 + seed * 3.0) - 0.5) * 0.35;
    float sector = ((ang + wob * 0.9 + seed * 6.2831) / 6.2831853 + 0.5) * N;
    float idx = floor(sector), f = fract(sector) - 0.5;
    float bl = mix(0.35, 1.0, vfxH11(idx + seed * 17.0)) * P.x;
    float dist = abs(f) * 6.2831853 / N * d;
    float wd = P.y * max(0.0, 1.0 - d / max(bl, 1e-3));
    float crack = (1.0 - smoothstep(wd * 0.35, wd, dist)) * step(d, bl) * smoothstep(0.04, 0.1, d);
    float N2 = N * 2.0 + 1.0;
    float sec2 = ((ang + wob * 0.9 + 0.3) / 6.2831853 + 0.5) * N2;
    float bl2 = mix(0.15, 0.55, vfxH11(floor(sec2) + seed * 3.0)) * P.x;
    float d2 = abs(fract(sec2) - 0.5) * 6.2831853 / N2 * d;
    float wd2 = P.y * 0.6 * max(0.0, 1.0 - d / max(bl2, 1e-3));
    float crack2 = (1.0 - smoothstep(wd2 * 0.35, wd2, d2)) * step(d, bl2) * step(0.12, d);
    float cr = max(crack, crack2);
    float stain = pow(max(0.0, 1.0 - d / (0.5 * P.x + 0.05)), 1.4) * P.z * (0.7 + 0.3 * vfxFbm(p * 5.0 + seed));
    a = max(cr, stain); hot = cr * (1.0 - d) * 0.5;
  } else if (s == 6) {     // BOLT (axial)  P: amplitude, thickness, glow width, flicker
    float env = sqrt(max(0.0, 1.0 - p.x * p.x));
    float sd = seed * 31.0 + floor(t * 14.0) * 7.13;
    float off = (vfxFbm(vec2(p.x * 2.4, sd)) - 0.5) * 2.2 * P.x * env + (vfxNoise(vec2(p.x * 11.0, sd + 3.0)) - 0.5) * 0.4 * P.x * env;
    float dy = abs(p.y - off);
    float core = 1.0 - smoothstep(P.y * 0.45, P.y, dy);
    float glow = exp(-dy / max(P.z, 1e-3)) * 0.4;
    a = max(core, glow) * smoothstep(1.0, 0.92, abs(p.x));
    a *= 1.0 - P.w * (0.5 - 0.5 * vfxH11(floor(t * 30.0) + seed));
    hot = core;
  } else if (s == 7) {     // FLAME tongue (base → tip along the long axis)  P: width, turbulence, scroll, core
    if (int(vPar.z + 0.5) == 2) p = vec2(-p.y, p.x);   // axial: long axis is x
    float yy = p.y * 0.5 + 0.5;
    float tt = t * P.z + seed * 10.0;
    float n = vfxFbm(vec2(p.x * 1.8 + seed * 3.0, yy * 2.6 - tt * 2.5));
    float x = p.x + (n - 0.5) * P.y * yy * 1.5;
    float w = P.x * pow(max(0.0, 1.0 - yy), 0.6) * smoothstep(-0.05, 0.2, yy);
    float body = 1.0 - smoothstep(w * 0.45, w, abs(x));
    body *= 1.0 - smoothstep(0.45, 1.0, yy + (n - 0.5) * 0.6);
    a = body; hot = body * (1.0 - smoothstep(0.0, 0.6, yy)) * (1.0 - smoothstep(0.0, w * 0.55, abs(x))) * P.w;
  } else if (s == 8) {     // RIPPLE  P: radius, thickness, echo spacing, echo strength
    float r0 = 1.0 - smoothstep(0.0, P.y, abs(d - P.x));
    float r1 = 1.0 - smoothstep(0.0, P.y * 0.7, abs(d - (P.x - P.z)));
    float r2 = 1.0 - smoothstep(0.0, P.y * 0.5, abs(d - (P.x - 2.0 * P.z)));
    float inner = (0.5 + 0.5 * sin((d - P.x) * 70.0)) * smoothstep(P.x, P.x - 3.0 * P.z, d) * step(0.0, P.x - d) * 0.12;
    a = (r0 + (r1 * 0.55 + r2 * 0.3) * P.w + inner * P.w) * smoothstep(1.0, 0.9, d);
    hot = r0 * 0.6;
  } else if (s == 9) {     // FLARE (anamorphic)  P: thickness, core
    float line = exp(-abs(p.y) / max(P.x, 1e-3)) * pow(max(0.0, 1.0 - abs(p.x)), 1.6);
    float core = exp(-(p.x * p.x) / max(P.y * P.y, 1e-4) - (p.y * p.y) * 3.0);
    a = line + core; hot = core + line * 0.4;
  } else if (s == 10) {    // DUST RING (plane, lit)  P: radius, thickness, dissolve, fill
    float n = vfxFbm(cs * 2.6 + seed * 9.0 + vec2(d * 2.8, 0.0));
    float dr = d - P.x;
    float band = exp(-dr * dr / max(P.y * P.y, 1e-4));
    float fill = smoothstep(P.x, 0.0, d) * P.w * 0.45;
    float n2 = vfxNoise(p * 7.0 + seed * 5.0);
    float dens = (band + fill) * smoothstep(0.3, 0.75, n * 0.8 + n2 * 0.35);
    dens *= smoothstep(P.z, P.z + 0.3, n + 0.2 * band);
    a = clamp(dens, 0.0, 1.0) * smoothstep(1.0, 0.85, d);
  } else if (s == 12) {    // BURST: angular comic impact polygon (straight-edged spikes of random length), hollowing
    //                         from the centre out over life (never a white blob).  P: spikes, valley radius, rim, hollow
    float N = max(3.0, floor(P.x + 0.5));
    float sec = (ang / 6.2831853 + 0.5) * N;
    float id = floor(sec), f = fract(sec);
    float L = mix(0.55, 1.0, vfxH11(id + floor(seed * 97.0)));
    // Intersect the viewing ray with an actual polygon edge. Interpolating polar radii makes flower petals.
    float a0 = (id + (f < 0.5 ? 0.0 : 0.5)) / N * 6.2831853 - 3.14159265;
    float a1 = a0 + 3.14159265 / N;
    float valley = P.y * 0.98, peak = L * 0.98;
    vec2 v0 = vec2(cos(a0), sin(a0)) * (f < 0.5 ? valley : peak);
    vec2 v1 = vec2(cos(a1), sin(a1)) * (f < 0.5 ? peak : valley);
    vec2 ev = v1 - v0;
    float R = (v0.x * v1.y - v0.y * v1.x) / max(0.001, cs.x * ev.y - cs.y * ev.x);
    float edge = R - d;
    float fill = smoothstep(0.0, 0.012, edge);
    float hole = smoothstep(P.w * R - 0.015, P.w * R + 0.05, d);
    float rim = 1.0 - smoothstep(0.0, P.z, edge);
    a = fill * hole * mix(0.55, 1.0, rim);
    hot = rim * fill * hole * 0.7;
  } else if (s == 13) {    // ORB: fireball / energy sphere with a noisy churning limb.  P: radius, turbulence, speed, core
    float n = vfxFbm(p * 2.2 + vec2(seed * 11.0, -t * P.z * 3.0));
    float r = P.x * (0.85 + (n - 0.5) * P.y);
    float body = 1.0 - smoothstep(r * 0.7, r, d);
    float halo = exp(-max(0.0, d - r * 0.8) * 9.0) * 0.35;
    a = max(body, halo) * smoothstep(1.0, 0.9, d);
    hot = (1.0 - smoothstep(0.0, r * 0.75, d)) * P.w * (0.8 + 0.4 * n);
  } else if (s == 14) {    // SHARD: tapered mineral splinter, with a darker split face
    float width = mix(0.7, 0.0, smoothstep(-0.65, 0.95, p.x));
    float sd = max(abs(p.y) - width, max(-0.88 - p.x, p.x - 0.95));
    a = 1.0 - smoothstep(-0.025, 0.005, sd);
    a *= mix(0.48, 1.0, smoothstep(-0.03, 0.03, p.y + p.x * 0.18));
    hot = 0.0;
  } else if (s == 15) {    // Authored cubic flame with a hooked crown, forked licks and nested contact core.
    vec2 f = vec2(-p.y, p.x);
    f.x += sin(f.y * 4.0 - t * 7.0 + seed * 3.0) * t * 0.12;
    vec4 ink = texture2D(uContactFlame, f * 0.5 + 0.5);
    a = ink.a;
    designed = pow(ink.rgb, vec3(2.2)) * 1.35;
  } else if (s == 16) {    // SPIKE: asymmetric swept nib; dark copper contour and a narrow hot interior.
    float u = p.x * 0.5 + 0.5;
    float bend = P.x * sin(u * 3.14159265);
    float width = pow(max(0.0, 1.0 - u), 1.6) * smoothstep(0.0, 0.12, u) * 0.82;
    float sd = width - abs(p.y - bend);
    float aa = max(fwidth(sd), 0.006);
    a = smoothstep(-aa, aa, sd);
    float inset = smoothstep(0.01, 0.12 + P.y, sd);
    designed = vCol.rgb * mix(0.24, 1.3, inset);
  } else if (s == 17) {    // CONTACT: copper contour + tiny hot kernel; P.x selects compact boss/repeat contacts.
    float sd = length(p * vec2(1.0, 1.15)) - 0.21;
    for (int i = 0; i < 6; i++) {
      float j = float(i);
      if (P.x > 0.5 && i >= 3) break;
      float angle = j * (P.x > 0.5 ? 2.0944 : 1.0472) + sin(j * 2.9) * 0.18;
      vec2 axis = vec2(cos(angle), sin(angle));
      float along = dot(p, axis), across = dot(p, vec2(-axis.y, axis.x));
      float len = P.x > 0.5 ? 0.52 : 0.72 + 0.23 * sin(j * 2.3 + 1.6);
      float width = P.x > 0.5 ? 0.065 : 0.15 + 0.065 * cos(j * 1.7);
      float nib = max(abs(across) - width * (1.0 - along / len), max(-along, along - len));
      sd = min(sd, nib);
    }
    float aa = max(fwidth(sd), 0.004);
    a = 1.0 - smoothstep(-aa, aa, sd);
    float rim = smoothstep(0.012, 0.065, -sd);
    vec3 copper = vec3(0.075, 0.009, 0.003);
    vec3 amber = mix(vec3(1.25, 0.16, 0.008), vec3(3.1, 1.7, 0.48), smoothstep(0.0, 0.16, -sd));
    designed = mix(copper, amber, rim);
    float kernel = 1.0 - smoothstep(0.07, 0.18, length(p * vec2(0.85, 1.1)));
    designed = mix(designed, P.x > 0.5 ? vec3(2.4, 1.8, 0.9) : vec3(6.0, 5.4, 4.2), kernel);
  } else if (s == 18) {    // COMBUSTION: advected flame volume; lobes, inner gradient and holes evolve independently.
    vec2 f = vec2(-p.y, p.x);
    float h = f.y * 0.5 + 0.5;
    float phase = t * 5.8 + seed * 15.0;
    // Smooth advected contours: avoid a texture/grid threshold turning the flame into rectangular holes.
    float wave = sin(h * 12.0 - phase * 2.1 + sin(f.x * 7.0 + phase));
    float bend = sin(h * 5.4 - phase * 1.3) * (0.03 + h * 0.21);
    float root = smoothstep(0.015, 0.14, h);
    float width = pow(max(0.0, 0.96 - h), 0.72) * 0.48 * root;
    float edge = width + wave * 0.035 - abs(f.x - bend);
    // Forked, curling side tongues have different heights and phases.
    float sideA = sin(h * 4.5 + phase * 0.35) * 0.23 - 0.2;
    float sideB = sin(h * 5.8 - phase * 0.45) * 0.24 + 0.18;
    float wa = pow(max(0.0, 0.73 - h), 0.8) * 0.25 * root;
    float wb = pow(max(0.0, 0.84 - h), 0.9) * 0.22 * root;
    edge = max(edge, max(wa - abs(f.x - sideA), wb - abs(f.x - sideB)));
    float hole = 0.5 + 0.5 * sin(f.x * 17.0 + h * 13.0 + phase * 3.0) * sin(f.x * 8.0 - h * 21.0 - phase * 4.0);
    float erode = smoothstep(0.28, 1.0, t) * 0.68;
    a = smoothstep(-0.012, 0.022, edge) * smoothstep(erode, erode + 0.17, hole);
    a *= 1.0 - smoothstep(0.94, 1.0, h);
    float heat = clamp(edge / max(0.07, width), 0.0, 1.0) * (1.0 - h * 0.52);
    vec3 red = vec3(0.38, 0.009, 0.001);
    vec3 orange = vec3(1.65, 0.22, 0.006);
    vec3 gold = vec3(3.1, 1.5, 0.22);
    designed = mix(red, orange, smoothstep(0.0, 0.32, heat));
    designed = mix(designed, gold, smoothstep(0.35, 0.83, heat));
    designed = mix(designed, vec3(3.8, 3.2, 1.7), smoothstep(0.84, 1.0, heat));
    designed *= 0.8 + 0.2 * sin(h * 11.0 - phase + f.x * 5.0);
  } else if (s == 19) {    // CUTARC: swept blade crescent with copper edge, graded belly and fine incandescent seam.
    float u = p.x * 0.5 + 0.5;
    float curve = sin(u * 3.14159) * P.x - 0.15;
    float width = pow(max(0.0, sin(u * 3.14159)), 0.8) * P.y;
    float edge = width - abs(p.y - curve);
    float aa = max(fwidth(edge), 0.006);
    a = smoothstep(-aa, aa, edge);
    float belly = smoothstep(0.01, max(0.03, width * 0.8), edge);
    designed = mix(vec3(0.12, 0.009, 0.003), vCol.rgb * 2.4, belly);
    float seam = exp(-abs(p.y - curve - width * 0.4) * 55.0) * sin(u * 3.14159);
    designed += vec3(2.8, 1.8, 0.65) * seam;
  } else {                 // DISC  P: falloff
    a = pow(max(0.0, 1.0 - d), P.x);
  }
  a *= vCol.a;
  if (a < 0.002) discard;
  ${lit ? `
  vec3 col = vCol.rgb * mix(1.0, 0.3, clamp(hot, 0.0, 1.0)) * vfxIrradiance(vfxUnit(vN), vViewPos);
  if (s >= 17 && designed.x >= 0.0) col = designed;
  gl_FragColor = vec4(col, a);` : `
  float mx = max(vCol.r, max(vCol.g, vCol.b));
  // r2: hot zones brighten IN HUE first and only the innermost core goes white (h²), so weights/elements keep colour.
  float hh = clamp(hot, 0.0, 1.0);
  // r3: coloured cores — the white lift is capped so no motif blows out to a pure-white disc.
  vec3 col = mix(vCol.rgb * (1.0 + 0.45 * hh), vec3(mx * 1.1), hh * hh * 0.06);
  if (designed.x >= 0.0) col = designed * (s == 15 ? max(vCol.r, 0.0) : 1.0);
  gl_FragColor = vec4(col * a, a * occ);`}
  ${lit ? '#include <fog_fragment>' : FOG_ADDITIVE}
}`;

const _v = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();

export class ShapePool {
  constructor({ capacity = 400, additive = true, lit = false, name = 'shapes', renderOrder } = {}) {
    this.cap = capacity; this.n = 0;
    this.additive = additive; this.lit = lit && !additive;
    const N = capacity;
    const f = (k) => new Float32Array(N * k);
    Object.assign(this, {
      pos: f(3), vel: f(3), ax: f(3), ay: f(3), w: f(1), h: f(1), g0: f(1), g1: f(1), gy0: f(1), gy1: f(1),
      age: f(1), life: f(1), hold: f(1), delay: f(1), c0: f(4), c1: f(4), p0: f(4), p1: f(4), ease: f(1),
      shape: f(1), mode: f(1), seed: f(1), occ: f(1), rot: f(1), spin: f(1), drag: f(1), grav: f(1),
    });
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const ia = (k) => new THREE.InstancedBufferAttribute(new Float32Array(N * k), k).setUsage(THREE.DynamicDrawUsage);
    this.attrs = { iPos: ia(3), iAx: ia(3), iAy: ia(3), iCol: ia(4), iPar: ia(4), iPar2: ia(4) };
    for (const k in this.attrs) geo.setAttribute(k, this.attrs[k]);
    geo.instanceCount = 0;
    this.geo = geo;
    const uniforms = this.lit ? litUniforms() : THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    uniforms.uContactFlame = { value: contactFlame() };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG(this.lit), uniforms, lights: this.lit,
      transparent: true, depthWrite: false, depthTest: true, fog: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    // premultiplied: per-instance `occ` (0 = pure additive … 1 = solid over) so shaped impacts read on any background
    if (additive) { this.material.blending = THREE.CustomBlending; this.material.blendSrc = THREE.OneFactor; this.material.blendDst = THREE.OneMinusSrcAlphaFactor; }
    else { this.material.blending = THREE.NormalBlending; }
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder ?? (additive ? 19 : 9);
    this.mesh.name = name;
    this._c = new THREE.Color();
  }

  _color(v, out, o, k) {
    if (Array.isArray(v)) { out[o] = v[0] * k; out[o + 1] = v[1] * k; out[o + 2] = v[2] * k; out[o + 3] = v[3] ?? 1; return; }
    if (v && v.isColor) this._c.copy(v); else this._c.set(v ?? 0xffffff);
    out[o] = this._c.r * k; out[o + 1] = this._c.g * k; out[o + 2] = this._c.b * k; out[o + 3] = 1;
  }

  emit(o) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    const P = o.pos || [0, 0, 0], V = o.vel || [0, 0, 0];
    this.pos[i * 3] = P.x ?? P[0]; this.pos[i * 3 + 1] = P.y ?? P[1]; this.pos[i * 3 + 2] = P.z ?? P[2];
    this.vel[i * 3] = V.x ?? V[0]; this.vel[i * 3 + 1] = V.y ?? V[1]; this.vel[i * 3 + 2] = V.z ?? V[2];
    const mode = MODE_IDS[o.mode || 'billboard'] ?? 0;
    this.mode[i] = mode;
    const sz = Array.isArray(o.size) ? o.size : [o.size ?? 1, o.size ?? 1];
    this.w[i] = sz[0]; this.h[i] = sz[1];
    const g = o.grow || [1, 1], gy = o.growY || g;
    this.g0[i] = g[0]; this.g1[i] = g[1]; this.gy0[i] = gy[0]; this.gy1[i] = gy[1];
    // Basis: plane → ax (right) / ay (in-plane "up"); axial → ax = dir.
    if (mode === 1) {
      const nrm = o.normal || [0, 1, 0];
      _w.set(nrm.x ?? nrm[0], nrm.y ?? nrm[1], nrm.z ?? nrm[2]).normalize();
      if (o.dir) _v.set(o.dir.x ?? o.dir[0], o.dir.y ?? o.dir[1], o.dir.z ?? o.dir[2]);
      else _v.set(1, 0, 0);
      _v.addScaledVector(_w, -_v.dot(_w));
      if (_v.lengthSq() < 1e-6) _v.set(0, 0, 1).addScaledVector(_w, -_w.z);
      _v.normalize(); _u.crossVectors(_w, _v).normalize(); // ay = n × ax
      this.ax.set([_v.x, _v.y, _v.z], i * 3); this.ay.set([_u.x, _u.y, _u.z], i * 3);
    } else if (mode === 2) {
      const d = o.dir || [1, 0, 0];
      _v.set(d.x ?? d[0], d.y ?? d[1], d.z ?? d[2]).normalize();
      this.ax.set([_v.x, _v.y, _v.z], i * 3); this.ay.set([0, 0, 0], i * 3);
    }
    this.age[i] = 0; this.life[i] = Math.max(0.01, o.life ?? 0.3);
    this.hold[i] = o.hold ?? 0; this.delay[i] = o.delay ?? 0;
    const col = Array.isArray(o.color) && (typeof o.color[0] !== 'number' || o.color.length === 2) ? o.color : [o.color, o.color];
    const k = o.intensity ?? 1;
    this._color(col[0], this.c0, i * 4, k); this._color(col[1] ?? col[0], this.c1, i * 4, k);
    if (o.alpha) { this.c0[i * 4 + 3] = o.alpha[0]; this.c1[i * 4 + 3] = o.alpha[1]; }
    else if (!Array.isArray(col[1])) this.c1[i * 4 + 3] = 0;
    const sh = o.shape || 'glow';
    const dp = DEF_P[sh] || DEF_P.glow;
    const p0 = o.p0 || dp, p1 = o.p1 || p0;
    for (let c = 0; c < 4; c++) { this.p0[i * 4 + c] = p0[c] ?? dp[c]; this.p1[i * 4 + c] = p1[c] ?? p0[c] ?? dp[c]; }
    this.ease[i] = EASE_IDS[o.ease || 'out'] ?? 0;
    this.shape[i] = SHAPE_IDS[sh] ?? 0;
    this.seed[i] = (o.seed ?? ((this._sn = (this._sn || 0) + 1) * 0.618034)) % 1;
    this.occ[i] = Math.round(Math.min(0.9, Math.max(0, o.occ ?? DEF_OCC[sh] ?? 0.3)) * 10);
    this.rot[i] = o.rot ?? 0; this.spin[i] = o.spin ?? 0;
    this.drag[i] = o.drag ?? 0; this.grav[i] = o.gravity ?? 0;
    return i;
  }

  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const [a, k] of [[this.pos, 3], [this.vel, 3], [this.ax, 3], [this.ay, 3], [this.c0, 4], [this.c1, 4], [this.p0, 4], [this.p1, 4]]) for (let c = 0; c < k; c++) a[i * k + c] = a[j * k + c];
    for (const a of [this.w, this.h, this.g0, this.g1, this.gy0, this.gy1, this.age, this.life, this.hold, this.delay, this.ease, this.shape, this.mode, this.seed, this.occ, this.rot, this.spin, this.drag, this.grav]) a[i] = a[j];
  }

  update(dt) {
    if (dt > 0) {
      for (let i = 0; i < this.n; i++) {
        this.age[i] += dt;
        if (this.age[i] >= this.delay[i] + this.hold[i] + this.life[i]) { this._kill(i); i--; continue; }
        if (this.age[i] < this.delay[i]) continue;
        const o = i * 3;
        if (this.drag[i] > 0) { const k = Math.exp(-this.drag[i] * dt); this.vel[o] *= k; this.vel[o + 1] *= k; this.vel[o + 2] *= k; }
        this.vel[o + 1] -= this.grav[i] * dt;
        this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      }
    }
    const A = this.attrs;
    const P = A.iPos.array, AX = A.iAx.array, AY = A.iAy.array, C = A.iCol.array, R = A.iPar.array, R2 = A.iPar2.array;
    let m = 0;
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i] - this.delay[i];
      if (age < 0) continue;
      const t = Math.min(1, Math.max(0, (age - this.hold[i]) / this.life[i]));
      const e = EASE[this.ease[i]](t);
      const s = this.g0[i] + (this.g1[i] - this.g0[i]) * e, sy = this.gy0[i] + (this.gy1[i] - this.gy0[i]) * e;
      const o3 = i * 3, o4 = i * 4, w3 = m * 3, w4 = m * 4;
      P[w3] = this.pos[o3]; P[w3 + 1] = this.pos[o3 + 1]; P[w3 + 2] = this.pos[o3 + 2];
      const hw = this.w[i] * 0.5 * s, hh = this.h[i] * 0.5 * sy;
      const mode = this.mode[i];
      if (mode === 0) { AX[w3] = hw; AX[w3 + 1] = hh; AX[w3 + 2] = this.rot[i] + this.spin[i] * age; }
      else if (mode === 1) {
        const r = this.rot[i] + this.spin[i] * age, cr = Math.cos(r), sr = Math.sin(r);
        for (let c = 0; c < 3; c++) {
          const x = this.ax[o3 + c], y = this.ay[o3 + c];
          AX[w3 + c] = (x * cr + y * sr) * hw; AY[w3 + c] = (-x * sr + y * cr) * hh;
        }
      } else { AX[w3] = this.ax[o3] * hw; AX[w3 + 1] = this.ax[o3 + 1] * hw; AX[w3 + 2] = this.ax[o3 + 2] * hw; AY[w3] = hh; AY[w3 + 1] = 0; AY[w3 + 2] = 0; }
      for (let c = 0; c < 4; c++) {
        C[w4 + c] = this.c0[o4 + c] + (this.c1[o4 + c] - this.c0[o4 + c]) * t;
        R2[w4 + c] = this.p0[o4 + c] + (this.p1[o4 + c] - this.p0[o4 + c]) * e;
      }
      R[w4] = this.shape[i]; R[w4 + 1] = t; R[w4 + 2] = mode; R[w4 + 3] = this.seed[i] + this.occ[i];
      m++;
    }
    this.geo.instanceCount = m;
    for (const k in A) { const a = A[k]; a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, m) * a.itemSize); a.needsUpdate = true; }
  }

  clear() { this.n = 0; this.geo.instanceCount = 0; }
  dispose() { this.geo.dispose(); this.material.dispose(); }
}
