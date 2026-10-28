// Per-character animation profiles (owner: anim). Read by the clip baker (bake-time IK goals) and RigPost
// (runtime grip lock, blade guard, springs, look-at, weight). A hero/enemy definition may override any field
// with `def.anim = { ... }` (shallow-merged per section).
//
//   grip:   { twoHand, off (weapon-local Y of the off-hand grip, m; negative = toward the pommel), flip ('auto'|bool) }
//   blade:  { R: length m along weapon +Y, L: length } — used by the blade-vs-body guard
//   weight: body mass feel (hips dip on landing / impact, spring sluggishness); 1 = Brann
//   look:   { yaw, pitch } max degrees for the look-at layer
//   springs: gain per chain family (0 disables) + stiffness multipliers
export const DEFAULT_PROFILE = {
  grip: { twoHand: false, off: -0.14, flip: 'auto' },
  blade: { R: 0.8, L: 0.8, pommel: 0.12 },
  weight: 1,
  look: { yaw: 38, pitch: 18 },
  breathe: 1,
  springs: { hair: 1, beard: 1, kilt: 1, cape: 1, tail: 1, stiff: 1 },
};

export const PROFILES = {
  brann: {
    grip: { twoHand: true, off: -0.15, flip: 'auto' },
    blade: { R: 1.26, pommel: 0.3 },   // weapon_grudgebrand.glb: tip y 1.265 (C2 r4 visual scale-up; was 1.065), pommel -0.36, grip_offhand y -0.14
    weight: 1.15,
    breathe: 1.3,
    springs: { hair: 0.55, kilt: 0.35, stiff: 1.55 }, // r18: heavy mane and overlapping tartan stay close to the body.
  },
  gorrim: {
    // Copper Ax haft runs weapon-local y -0.46..0.66 (head at +0.56): the lower hand sits near the butt.
    grip: { twoHand: true, off: -0.34, flip: 'auto' },
    blade: { R: 0.72, pommel: 0.46 },
    weight: 1.4,
    look: { yaw: 34, pitch: 16 },
    springs: { beard: 0.8, stiff: 1.2 },
  },
  seraphine: {
    grip: { twoHand: false },
    blade: { R: 1.0, L: 1.0, pommel: 0.1 },   // weapon_dawn/dusk.glb: tip y 0.936 (C2 r4 visual scale-up; was 0.796)
    weight: 0.8,
    look: { yaw: 44, pitch: 20 },
    // r18: gain blends toward the constrained tip; >1 extrapolates past it.
    // A firmer, smaller response keeps the plait behind her during arm sweeps.
    // C2 r24 (anim): hairHang/hairHangBack (opt-in, springs.js) hang the plait's target toward down, 10 deg behind her,
    // instead of turning it with the head's look-at yaw (r18: ~25 deg into depth while running, 43 deg peaks at stops).
    springs: { hair: 0.7, hairLimit: 15, stiff: 1.45, hairHang: 0.6, hairHangBack: 10 },
  },
  marauder: { blade: { R: 0.62, pommel: 0.12 }, weight: 1.1 },
  // enemies-art-2 r22 (anim): weapon_halberd.glb tip y 1.50, butt -0.65, grip_offhand -0.34 (two-handed holds in
  // clips/enemy_knight.js); the long tabard (kilt_F/B to mid-shin) swings slower and less so it stays off the legs.
  knight: {
    grip: { twoHand: true, off: -0.34, flip: 'auto' },
    blade: { R: 1.5, pommel: 0.65 },
    weight: 1.35,
    breathe: 0.8,
    look: { yaw: 30, pitch: 14 },
    springs: { kilt: 0.6, stiff: 1.35 },
  },
  // weapon_sword_bone.glb tip y 0.79; light frame, the short rag loincloth flaps a bit more.
  skeleton: {
    blade: { R: 0.8, pommel: 0.15 },
    weight: 0.8,
    breathe: 0.5,
    look: { yaw: 44, pitch: 20 },
    springs: { kilt: 1.15 },
  },
  dummy: { weight: 1.3, breathe: 0 },
};

const cache = new Map();
/** Resolved profile for a character id (and optional definition override `def.anim`). */
export function profileFor(character, defOverride = null) {
  const key = character || '_';
  if (!defOverride && cache.has(key)) return cache.get(key);
  const p = PROFILES[character] || {};
  const o = defOverride || {};
  const out = {};
  for (const k of Object.keys(DEFAULT_PROFILE)) {
    const d = DEFAULT_PROFILE[k];
    out[k] = (d && typeof d === 'object') ? { ...d, ...(p[k] || {}), ...(o[k] || {}) } : (o[k] ?? p[k] ?? d);
  }
  if (!defOverride) cache.set(key, out);
  return out;
}
