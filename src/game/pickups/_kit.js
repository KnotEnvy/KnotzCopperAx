// Shared kit for the pickup models (pot.js, food.js). Private helper: files starting with `_` are not registered.
// bonus-camp r8 — the pickups are designed objects now, not flat emissive blobs:
//   * one merged mesh per pickup (a single draw call) with vertex colours + painted canvas maps
//     (albedo / emissive / roughness) — the glow lives ONLY in the painted rune, the gem and a faint inner-glow
//     gradient, so the body stays a lit, glazed object in every stage light instead of a blown-out blue blob;
//   * a rig  model > lift > tumble > spin > mesh  (+ a soft camera-facing halo sprite) driven from
//     def.animate(pickup, alpha) (Pickup.render hook): pop-in, arc flip that lands upright, landing squash + wobble,
//     settle, then a gentle hover/bob/spin with the periodic glint that says "ready to grab".
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRAVITY } from '../../core/config.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------- atlas layout
// Every pickup texture is a square atlas: the left BWF of the width is the body map (u wraps round the lathe),
// the right strip is 4 flat "cells" the trim parts sample with a constant UV (vertex colour supplies the hue):
//   cell 0 gloss (wax, gold)   1 satin (bone, coin)   2 matte (cork, cord)   3 GLOW (gem, emissive)
export const BWF = 0.875;
export const STRIP_U = 0.953;
export const CELL_ROUGH = [0.22, 0.72, 0.88, 0.34];

/** Deterministic 0..1 hash of a pixel. */
export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Smooth field in ~[-1,1], PERIODIC in u (so the lathe seam is invisible). */
export function wave(u, y, s = 0) {
  return Math.sin(u * TAU * 3 + y * 9.1 + s) * 0.5 + Math.sin(u * TAU * 5 - y * 17.3 + 1.3 + s * 2) * 0.3 + Math.sin(u * TAU * 11 + y * 31.7 + 2.1 - s) * 0.2;
}

/** Table form of wave(): per-column sin/cos of the u terms (once), per-row sin/cos of the y terms — no trig per pixel. */
export function waveCols(n, denom) {
  const t = { s1: new Float32Array(n), c1: new Float32Array(n), s2: new Float32Array(n), c2: new Float32Array(n), s3: new Float32Array(n), c3: new Float32Array(n) };
  for (let x = 0; x < n; x++) {
    const a = (x / denom) * TAU;
    t.s1[x] = Math.sin(a * 3); t.c1[x] = Math.cos(a * 3); t.s2[x] = Math.sin(a * 5); t.c2[x] = Math.cos(a * 5); t.s3[x] = Math.sin(a * 11); t.c3[x] = Math.cos(a * 11);
  }
  return t;
}
export function waveRow(y, s = 0) {
  const b1 = 9.1 * y + s, b2 = -17.3 * y + 1.3 + 2 * s, b3 = 31.7 * y + 2.1 - s;
  return { s1: Math.sin(b1), c1: Math.cos(b1), s2: Math.sin(b2), c2: Math.cos(b2), s3: Math.sin(b3), c3: Math.cos(b3) };
}
export function waveFast(C, R, x) { return 0.5 * (C.s1[x] * R.c1 + C.c1[x] * R.s1) + 0.3 * (C.s2[x] * R.c2 + C.c2[x] * R.s2) + 0.2 * (C.s3[x] * R.c3 + C.c3[x] * R.s3); }

export function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
export function toTexture(canvas, srgb = true) {
  if (!canvas) return null;
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------------------------- geometry
/** Smooth lathe profile from control points [r, y], resampled evenly by arc length (so v is arc length). */
export function spacedProfile(ctrl, n) {
  const curve = new THREE.CatmullRomCurve3(ctrl.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'centripetal');
  return curve.getSpacedPoints(n).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
}
export function profileLength(prof) { let s = 0; for (let i = 1; i < prof.length; i++) s += prof[i].distanceTo(prof[i - 1]); return s; }
/** y (metres) at profile fraction v (0 = first point). */
export function profileY(prof, v) {
  const N = prof.length - 1, f = clamp(v, 0, 1) * N, i = Math.min(N - 1, Math.floor(f)), t = f - i;
  return lerp(prof[i].y, prof[i + 1].y, t);
}
export function profileR(prof, v) {
  const N = prof.length - 1, f = clamp(v, 0, 1) * N, i = Math.min(N - 1, Math.floor(f)), t = f - i;
  return lerp(prof[i].x, prof[i + 1].x, t);
}
/** v (0..1 along the profile) at which the profile first reaches height y. */
export function profileVAtY(prof, y) {
  for (let i = 1; i < prof.length; i++) {
    if (prof[i].y >= y && prof[i].y > prof[i - 1].y) return (i - 1 + (y - prof[i - 1].y) / (prof[i].y - prof[i - 1].y)) / (prof.length - 1);
  }
  return 1;
}

const _white = new THREE.Color(1, 1, 1);
function nonIndexed(g) { return g.index ? g.toNonIndexed() : g; }
function setAttrs(g, color, uvFn) {
  const n = g.attributes.position.count, col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b;
    const [u, v] = uvFn(i); uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
/** The painted body: keeps the lathe's own UVs (u squeezed into the body region of the atlas). */
export function bodyPart(geo) {
  const g = nonIndexed(geo), uv = g.attributes.uv;
  return setAttrs(g, _white, (i) => [uv.getX(i) * BWF, uv.getY(i)]);
}
/** A trim part (cork, cord, bands, bone…): flat colour from `color`, surface response from strip `cell`. */
export function trimPart(geo, color, cell = 1) {
  const g = nonIndexed(geo);
  return setAttrs(g, new THREE.Color(color), () => [STRIP_U, (cell + 0.5) / 4]);
}
export function mergeParts(parts) {
  const geo = mergeGeometries(parts, false);
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  parts.forEach((p) => p.dispose());
  return geo;
}

/** Pixel fill for the atlas strip (right edge): cell rows for albedo / emissive / roughness canvases. */
export function stripFill(px, py, W, H, BW) {
  if (px < BW + 8) return null;
  const k = clamp(Math.floor((1 - (py + 0.5) / H) * 4), 0, 3);
  return k;
}

// ---------------------------------------------------------------------------------------------- halo sprite
let haloTex = null;
function haloTexture() {
  if (haloTex || typeof document === 'undefined') return haloTex;
  const c = makeCanvas(128, 128), g = c.getContext('2d');
  // steep falloff (a = (1 - r/0.85)^3): the part of the halo that dips below the ground (depth-clipped) is already ~0
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (let i = 0; i <= 16; i++) { const r = i / 16, a = Math.pow(Math.max(0, 1 - r / 0.85), 3); gr.addColorStop(r, `rgba(255,255,255,${a.toFixed(4)})`); }
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  haloTex = toTexture(c, true);
  return haloTex;
}
const haloMats = new Map();
export function haloMaterial(color, opacity) {
  const key = `${color}|${opacity}`;
  let m = haloMats.get(key);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: haloTexture(), color, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.userData.shared = true;
    haloMats.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------- rig + animation
/**
 * model > lift (hover/bob + squash, origin at the base) > tumble (origin at the body centre: flip/wobble) >
 * spin (own yaw) > mesh ; halo sprite hangs on tumble (faces the camera, follows the flip but not the yaw).
 */
export function makeRig(mesh, { cy, halo }) {
  const model = new THREE.Group(); model.name = 'pickup_model';
  const lift = new THREE.Group(), tumble = new THREE.Group(), spin = new THREE.Group();
  tumble.position.y = cy; mesh.position.y = -cy;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.userData.sharedGeometry = true; mesh.userData.sharedMaterial = true;
  spin.add(mesh); tumble.add(spin); lift.add(tumble); model.add(lift);
  let sprite = null;
  if (halo) {
    sprite = new THREE.Sprite(haloMaterial(halo.color, halo.opacity));
    sprite.scale.setScalar(halo.size); sprite.position.set(0, halo.dy ?? 0, 0); sprite.renderOrder = 2;
    sprite.userData.sharedMaterial = true;
    tumble.add(sprite);
  }
  model.userData.rig = { lift, tumble, spin, sprite, haloSize: halo ? halo.size : 0, cy, st: null };
  return model;
}

const _ax = new THREE.Vector3();
const timeToGround = (y, vy) => (vy + Math.sqrt(Math.max(0, vy * vy + 2 * GRAVITY * Math.max(0, y)))) / GRAVITY;
const easeOutBack = (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

// pickups share one small ambient budget: at most one twinkle every few ticks machine-wide, so a pile of pots
// (camp) sparkles like a treasure pile instead of a fireworks stall
const G = { last: -999 };

/**
 * def.animate(pickup, alpha) factory. cfg:
 *   hover, bob, bobRate, idleSpin, airSpin, flipMin (s of air needed for a flip), sway, squash (0..1), shadowR,
 *   fx: (game, pk, info) → void   ambient effect call (glint / steam), every `fxEvery` ticks (+ random)
 */
export function createAnimator(cfg) {
  const init = (pk, rig) => {
    const seed = (pk.id * 2654435761) >>> 0;
    const r1 = ((seed >>> 3) % 1000) / 1000, r2 = ((seed >>> 13) % 1000) / 1000;
    const st = {
      age: pk.age, landAge: -999, landV: 0, arc: null, spinA: r1 * TAU, spinW: cfg.idleSpin, hov: 0, ph: r2 * TAU,
      nextFx: pk.age + 30 + r1 * cfg.fxEvery, dir: (seed & 1) ? 1 : -1, popped: false,
    };
    if (pk.shadow && cfg.shadowR) pk.shadow.userData.radius = cfg.shadowR;
    const orig = pk.onLand;
    pk.onLand = function (speed) {
      st.landAge = this.age; st.landV = speed; st.arc = null;
      if (cfg.land && speed > 6 && !this.campLoot && this.game.vfx) { try { cfg.land(this.game, this, speed); } catch (e) { /* cosmetic */ } }
      return orig.call(this, speed);
    };
    rig.spin.rotation.y = st.spinA;
    if (cfg.pop && pk.pos.y > 0.4 && !pk.campLoot && pk.game.vfx) { try { const v = pk.view.position; cfg.pop(pk.game, pk, { x: v.x, y: v.y + (rig.cy || 0.2), z: v.z }); } catch (e) { /* cosmetic */ } }
    return st;
  };
  return function animate(pk, alpha) {
    const model = pk.model, rig = model && model.userData.rig; if (!rig) return;
    const st = rig.st || (rig.st = init(pk, rig));
    const age = pk.age + alpha;
    let dt = (age - st.age) / 60; st.age = age; if (!(dt > 0)) dt = 0; else if (dt > 0.1) dt = 0.1;
    const t = age / 60;
    model.rotation.y = 0; // (Pickup.render's real-time spin is replaced by the tick-driven one below: deterministic under the manual clock)

    // ---- airborne arc: one flip that ends exactly upright at touchdown (or a small sway for short hops)
    const air = pk.pos.y > 0.04 || pk.vel.y > 0.3;
    let tilt = 0;
    if (air) {
      const rem = timeToGround(pk.pos.y, pk.vel.y) + (1 - alpha) / 60;
      if (!st.arc) {
        const dirX = Math.abs(pk.vel.x) > 0.25 ? Math.sign(pk.vel.x) : st.dir;
        st.arc = { T0: Math.max(rem, 0.05), n: rem >= cfg.flipMin ? 1 : 0, dir: -dirX };
      }
      const a = st.arc, f = clamp(1 - rem / a.T0, 0, 1);
      tilt = a.n ? a.dir * TAU * a.n * f : a.dir * cfg.sway * Math.sin(Math.PI * f);
    } else st.arc = null;
    // landing wobble (decays fast)
    const tl = (age - st.landAge) / 60;
    let sq = 0;
    if (tl >= 0 && tl < 0.8) {
      const amp = clamp(st.landV / 15, 0.1, 0.45);
      sq = amp * Math.exp(-8 * tl) * Math.cos(24 * tl);
      tilt += -st.dir * cfg.sway * 0.55 * amp * Math.exp(-7 * tl) * Math.sin(20 * tl);
    }
    const yaw = pk.body.rotation.y;
    _ax.set(-Math.sin(yaw), 0, Math.cos(yaw));
    rig.tumble.quaternion.setFromAxisAngle(_ax, tilt);

    // ---- squash & stretch about the base
    let sy = 1 - sq * cfg.squash, sxz = 1 + sq * cfg.squash * 0.7;
    if (air) { const s = clamp(Math.abs(pk.vel.y) / 12, 0, 1) * cfg.squash * 0.2; sy += s; sxz -= s * 0.6; }
    // pop-in when it spills out
    const pop = age < 10 ? easeOutBack(clamp(age / 10, 0, 1)) : 1;
    const ps = lerp(0.25, 1, pop) * (pk.campLoot ? 1 : (cfg.stageScale || 1)); // (the camp scales the whole body ×1.4 already)
    rig.lift.scale.set(sxz * ps, sy * ps, sxz * ps);

    // ---- yaw spin: fast in the air (the rune flashes by), eases to the idle turn
    const wT = air ? cfg.airSpin * st.dir : cfg.idleSpin;
    st.spinW += (wT - st.spinW) * (1 - Math.exp(-(air ? 14 : 5) * dt));
    st.spinA += st.spinW * dt;
    rig.spin.rotation.y = st.spinA;

    // ---- ready hover: settled + collectable → lifts a hand's width and bobs
    const ready = !air && pk.grounded && pk.pickupDelay <= 0 && tl > 0.22;
    st.hov += ((ready ? 1 : 0) - st.hov) * (1 - Math.exp(-7 * dt));
    rig.lift.position.y = st.hov * (cfg.hover + cfg.bob * Math.sin(t * cfg.bobRate + st.ph));

    // ---- halo: breathes; a touch brighter when the pickup is ready
    if (rig.sprite) {
      const b = 1 + 0.09 * Math.sin(t * 2.6 + st.ph), k = 0.78 + 0.22 * st.hov;
      rig.sprite.scale.setScalar(rig.haloSize * b * k * (air ? 1.4 : 1)); // (a flying pot glows a little wider so it never goes dark against a night sky)
    }

    // ---- ambient effect (glint / steam)
    if (cfg.fx && st.hov > 0.85 && age >= st.nextFx) {
      const tick = pk.game.tick;
      if (cfg.fxFree || tick - G.last >= 9) {
        if (!cfg.fxFree) G.last = tick;
        const v = pk.view.position;
        try { cfg.fx(pk.game, pk, { x: v.x, y: v.y + rig.lift.position.y, z: v.z, scale: pk.body.scale.x }); } catch (e) { /* cosmetic */ }
        st.nextFx = age + cfg.fxEvery * (pk.campLoot ? 1.7 : 1) + hash2(pk.id, Math.floor(age)) * cfg.fxEvery * 0.8;
      } else st.nextFx = age + 4;
    }
  };
}
