// Stage 3 — Eaglespine Skies (DESIGN §6, §10; GA "Fiend's Path" + "Eagle's Head"): the heroes fight ON THE BACK of a
// colossal golden eagle soaring through a canyon of cloud and stone spires in the cool high air of late afternoon.
//
// Composition (learned from stage 2: the creature must read in EVERY gameplay frame): the eagle IS the arena. All
// screens share the eagle's back, the camera holds a fixed 3/4 belt framing on it, so each frame shows the tail fan
// (left), the broad feathered back between the wing roots (the belt), the far wing rising behind the belt and beating,
// the near wing sweeping under the lower frame, and the neck + fierce head + hooked beak at the right edge (glancing
// around, screeching). The motion is the WORLD streaming past (cloud sea, cumulus layers, spires, wind streaks).
//
// Living platform: wingbeats heave/pitch the whole bird (groundAt follows), the back ruffles under footsteps, feathers
// flutter in the slipstream, loose feathers tear away on heavy hits. Ring-outs: the pale fluttering lip feathers mark
// the rump edges (near + far, behind the wings) — foes knocked over them fall away into the clouds (instant KO).
// Set pieces: screen 3 — the eagle screeches and banks steeply through a colossal stone arch; the last screen clears
// with the Serpent Keep looming on the horizon (the eagle delivers the heroes toward it; stage 4 = the keep gates).
import * as THREE from 'three';
import { EV } from '../../core/EventBus.js';
import { buildEagle, EAGLE } from './stage3/eagle.js';
import { buildSky } from './stage3/sky.js';
import { createRingOuts } from './stage3/ringout.js';
import { createLooseFeathers } from './stage3/fx.js';
import { createAmbient } from '../../render/particles.js';

// r2: camera in + down (critic: fighters were ~8% of frame) — heroes ~22% of frame height like stage 1; the head/beak
// stays in frame at the right, the far wing tips above the belt, the tail fan crops at the left edge.
const FRAMING = { fov: 32, distance: 13.4, height: 4.3, lookHeight: 1.6, lead: 0 };
const FOCUS_X = 0.9;                         // camera holds here: beak inside the right edge, tail fan cropped left
const LOCK = [FOCUS_X - 7, FOCUS_X + 7];     // midpoint = FOCUS_X (camera clamp), heroes clamped by the walls below
const WALK_X0 = -5.6;                        // tail-side wall (the rump beyond is only reachable as a ring-out)
export const RING_ZONES = [
  { x0: -8.9, x1: -4.3, side: 1 },           // rump, camera side (behind the near wing's trailing edge)
  { x0: -8.9, x1: -5.2, side: -1 },          // rump, far side
];
const SUN_DIR = [-0.42, 0.07, -0.9];         // low sun, upper-left behind the far wing (primaries backlit)
// env-r32 (board r2: "one beige-tan value band"): three value planes. The AIR is cool blue-grey (cloud sea, puffs,
// haze, spires); the warm light lives on the fighters (actor key/rim) and sparsely on cloud crowns toward the sun.
// `sun` here is only the sky shaders' forward scatter (cloud rims/crowns toward the sun), kept dim so it stays sparse.
const COLORS = {
  seaLit: '#aab6c8', seaShade: '#46526c', haze: '#7a8caa', sun: '#b8a084', puffLit: '#bcc6d6', puffShade: '#56627c',
};
// env-r32 stage-local eagle light response (never an albedo lift). The r32 feathers.js already carries a quiet,
// pigment-bound, sun-facing satin (rim .13 / sheen .08, was a gold .55 Fresnel that lifted the deck), so the feather
// rim is left as built (featherRim null: toning it again would dim it twice). The neck/head keeps the donor GLB and
// head material: its rim is neutralised + halved and `headTint` (every channel < 1, so it can only DARKEN the pale
// donor vertex colours) settles the golden nape toward the darker umber body.
const EAGLE_LOOK = { featherRim: null, headRim: { color: '#f0d6b4', k: 0.5 }, headTint: '#dcc8b4' };
function toneEagle(eagle) {
  if (!eagle || !eagle.group) return;
  const seen = new Set();
  const tone = (u, look) => {
    if (!look || !u || !u.value || seen.has(u)) return;
    const { color, k } = look;
    seen.add(u);
    const c = new THREE.Color(color);
    u.value.set(c.r, c.g, c.b, u.value.w * k);
  };
  eagle.group.traverse((o) => {
    const U = o.isMesh && o.material && o.material.userData ? o.material.userData.U : null;
    if (U && U.uS3Rim) tone(U.uS3Rim, EAGLE_LOOK.featherRim);
    if (U && U.uHRim) tone(U.uHRim, EAGLE_LOOK.headRim);
  });
  const hm = eagle.headMat, tint = EAGLE_LOOK.headTint && new THREE.Color(EAGLE_LOOK.headTint);
  if (hm && hm.color && tint && Math.max(tint.r, tint.g, tint.b) <= 1) hm.color.multiply(tint);
}
const SPEED = 34;                             // flight speed (m/s) the world streams past at
const wallX1 = (z) => 2.7 + 0.9 * THREE.MathUtils.smoothstep(Math.abs(z), 0.8, 2.0);   // neck-side wall: fights stay on the lit back

let active = null;

const bx = (x) => Math.max(WALK_X0 + 0.4, Math.min(2.3, x));
function drop(type, x, z, o = {}) { return { type, x: bx(x), z, delay: o.delay || 0, tier: o.tier, coop: o.coop, opts: { s3drop: true, ...(o.opts || {}) } }; }
function climb(type, z, o = {}) { return { type, x: WALK_X0 - 2.2, z, side: 'left', delay: o.delay || 0, tier: o.tier, coop: o.coop, opts: { enterFrom: { x: WALK_X0 + 0.9 + (o.dx || 0), z }, ...(o.opts || {}) } }; }

export default {
  id: 'stage3',
  number: 3,
  name: 'Eaglespine Skies',
  subtitle: 'STAGE 3',
  zBand: [-2.2, 2.2],
  extents: LOCK,
  playerStart: { x: -3, z: 0 },
  // env-r32 value plan (blueprint docs/notes/blueprints/stage3-env_r32.md): cool blue-grey sky/cloud sea (rendered L*
  // ~55-70) → muted cool stone spires → dark warm-umber eagle mass → softly lit spine → warm-keyed fighters. The sun sits
  // just inside the top-left corner, so the whole visible horizon takes `horizonSun` and `sunGlow` washes the frame:
  // both are cool/low now (the r2 peach wash). Scene lights are near-neutral (blue hemi/rim/env greyed the umber
  // feathers). With the r32 dark umber feather pigments the deck needs LIGHT, not albedo: the sun keeps the r2 high
  // elevation (it lights the horizontal spine, so the lane reads softly lit while the body stays dark) and the
  // actor-only key carries the fighters (restrained warm, more directional). The grade splits WARM darks / neutral
  // lights: the umber eagle sits in the shadow-mid band and keeps its chroma while the (unlit, already cool) sky stays
  // cool. No new lights, passes or albedo lifts.
  // r32 single fix: a broader, higher neutral-warm key lights upward spine normals; existing fill/hemi
  // retain dark flank detail. Pigments, feather rim/sheen and actor-only light response remain untouched.
  lighting: {
    base: 'sky-high',
    sky: { zenith: '#1a3060', top: '#4c6ea6', horizon: '#7a90b4', horizonSun: '#a0aaba', bottom: '#5a6a86', sunDir: SUN_DIR, sunColor: '#f0d0a0',
      sunDisc: '#fff2dc', sunDiscIntensity: 5, sunSize: 0.022, sunGlow: 0.4, hazeHeight: 0.2,
      clouds: { cover: 0.42, color: '#5a6a8a', lit: '#d8d4cc', scale: 1.1, speed: 0.01, opacity: 0.6, band: [-0.02, 0.04, 0.32, 0.7], stretch: [0.25, 1] } },
    sun: { color: '#ffe2c4', intensity: 5.0, dir: [-0.38, 0.88, 0.28], shadow: true, radius: 3, frustum: [-16, 16, 12, -12] },
    fill: { color: '#a8a0ac', intensity: 0.45, dir: [0.7, 0.35, 0.6] },
    hemi: { sky: '#a29a94', ground: '#4e3626', intensity: 0.65 },
    rim: { color: '#eadcc4', intensity: 1.0, dir: [-0.3, 0.45, -1] },
    fog: { color: '#7f90ae', near: 50, far: 1200, sun: { color: '#c8bca8', strength: 0.25, power: 8 },
      depthGrade: { start: 24, end: 220, dim: 0.0, desat: 0.4, tint: '#7f90b4' } },
    env: { intensity: 0.32 },
    exposure: 1.0,
    grade: { saturation: 1.12, contrast: 1.12, vibrance: 0.14, lift: [0.0, 0.0, 0.006], gamma: [1, 1, 1.0], gain: [1.0, 1.0, 1.0],
      shadowTint: [0.53, 0.48, 0.45], highlightTint: [0.52, 0.51, 0.49], split: 0.2 },
    bloom: { intensity: 0.9, threshold: 1.1, smoothing: 0.35, radius: 0.75 },
    vignette: { offset: 0.3, darkness: 0.45 },
    character: { rim: '#ffd8a8', intensity: 0.7, power: 3.0, floor: 0.06, base: 0.0, edge: 2.7, width: 2.5, maxNdv: 0.6,
      key: { color: '#ffe2c0', intensity: 3.4, wrap: 0.3, dir: [-0.62, 0.5, 0.6] }, ambient: '#a8aac0', ambientIntensity: 0.44 },
    wind: { dir: [-1, 0.05], strength: 1.2, gust: 1 },
  },
  async build(ctx) {
    const { game } = ctx;
    const q = ctx.quality || {};
    const low = q.name === 'low';
    const cam = game.cameraRig;
    if (cam && cam.setFraming) cam.setFraming(FRAMING);

    const sky = buildSky(ctx, { sunDir: SUN_DIR, colors: COLORS, low, seaY: -60 });
    const eagle = await buildEagle(ctx, { ringZones: RING_ZONES });
    toneEagle(eagle);
    const feathers = createLooseFeathers(ctx.group, { count: low ? 50 : 100 });
    const motes = createAmbient({ kind: 'dust', count: low ? 70 : 140, box: [30, 9, 14], offset: [0, 1.5, -2], quality: q, color: '#f2ece2', color2: '#c8bca8', size: 0.035, intensity: 0.5, velocity: [-14, 0.2, 0] });
    ctx.group.add(motes.object);

    const ring = createRingOuts(game, {
      zones: RING_ZONES,
      shake: (t) => cam && cam.shake && cam.shake(t),
      onFall: (a) => feathers.burst(a.pos.x, (a.groundY || 0) + 0.3, a.pos.z, 7, 1.2),
      onPunch: () => {},
    });

    // camera: fixed focus + roll (banking) carried by a permanent low-priority drama
    const camD = cam && cam.drama ? cam.drama({ focus: { x: FOCUS_X }, roll: 0, hold: null, in: 0.001, priority: -10 }) : null;

    // events: loose feathers on heavy hits / KOs, eagle cries
    const scope = game.bus.scope();
    scope.on(EV.HIT, (ev) => {
      const tgt = ev && ev.target;
      if (!tgt || !tgt.pos) return;
      if (ev.killed || (ev.level || 0) >= 2) feathers.burst(tgt.pos.x, (tgt.groundY || 0) + 0.1, tgt.pos.z, ev.killed ? 6 : 3, 0.9);
    });
    scope.on(EV.KNOCKDOWN, (ev) => { const a = ev && (ev.actor || ev.target); if (a && a.pos) feathers.burst(a.pos.x, (a.groundY || 0), a.pos.z, 4, 0.7); });

    const st = { t: 0, bank: 0, bankT: 0, bankHold: 0, progress: 0, progressTarget: 0, screechIn: 5, speedMul: 1, streakMul: 1, flap: 1, roll: 0 };
    const screech = (pitch = 0.82) => {
      eagle.screech();
      if (cam && cam.shake) cam.shake(0.12);
      if (game.audio && game.audio.play) try { game.audio.play('roar_stormroc', { volume: 0.7, pitch }); } catch (e) { /* optional */ }
    };
    const feet = [];
    const update = (dt) => {
      st.t += dt;
      const t = st.t;
      // bank sequence (arch): ease into a steep roll, hold while the arch sweeps over, level out
      if (st.bankT > 0) {
        st.bankT -= dt;
        const k = st.bankT;              // counts down from 7.5
        const target = k > 6.3 ? 0 : k > 1.6 ? 0.2 : 0;
        st.bank += (target - st.bank) * Math.min(1, dt * 1.6);
        st.speedMul += ((k > 1.6 && k < 6.8 ? 1.45 : 1) - st.speedMul) * Math.min(1, dt * 1.5);
      } else { st.bank += (0 - st.bank) * Math.min(1, dt * 1.5); st.speedMul += (1 - st.speedMul) * Math.min(1, dt); }
      st.streakMul = st.speedMul;
      st.progress += (st.progressTarget - st.progress) * Math.min(1, dt * 0.25);
      // footsteps ruffle the back
      feet.length = 0;
      const actors = game.world.actors.filter((a) => a.alive !== false && !a.removed && a.pos && (a.kind === 'hero' || a.kind === 'enemy') && !a._s3ringout);
      for (const a of actors) {
        if (feet.length >= 8) break;
        const sp = Math.hypot(a.vel.x, a.vel.z);
        const air = a.pos.y;
        const amt = air > 1.2 ? 0 : Math.min(1, 0.25 + sp * 0.18) * (1 - air / 1.2);
        feet.push([a.pos.x, a.pos.z, 0.95, amt]);
        // walls: the neck + tail ends of the back (the band clamps z)
        if (a.pos.x >= WALK_X0) a._s3in = 1;
        if (a.kind === 'enemy' && a.typeId === 'thief' && !a._s3esc && a._s3in && (a.pos.x > wallX1(a.pos.z) + 0.5 || a.pos.x < WALK_X0 - 0.8)) {
          // a fleeing thief escapes by leaping off the eagle (its behaviour runs for the screen edge)
          a._s3esc = { vy: 4, vx: a.pos.x > 0 ? 3 : -6, y: (a.groundY || 0) + a.pos.y, t: 0 };
          a.skipPhysics = true; a.boundsMode = 'none'; a.hurtable = false; a.solid = false;
          feathers.burst(a.pos.x, a.pos.y, a.pos.z, 3, 0.8);
        }
        if (a._s3esc) {
          const r = a._s3esc; r.t += dt; r.vy -= 14 * dt; r.y += r.vy * dt; a.pos.x += r.vx * dt; a.pos.z -= 2.5 * dt;
          a.pos.y = r.y - (a.groundY || 0);
          if (r.t > 1.6 && !a.removed) { a.remove(); game.bus.emit('ai:escape', { actor: a, stage: 'stage3' }); }
          continue;
        }
        if (!a.skipPhysics && !(a.kind === 'enemy' && a.typeId === 'thief')) {
          const x1 = wallX1(a.pos.z);
          if (a.pos.x > x1) { a.pos.x = x1; if (a.vel.x > 0) a.vel.x = 0; }
          const x0 = a._s3in || a.kind === 'hero' ? WALK_X0 : EAGLE.walk.x0;
          if (a.pos.x < x0) { a.pos.x = x0; if (a.vel.x < 0) a.vel.x = 0; }
        }
        // drop-in arrivals: foes leap down onto the back from above the frame
        if (a.kind === 'enemy' && a.spawnOpts && a.spawnOpts.s3drop && !a._s3arr) {
          a._s3arr = 1; a.pos.y = 8.5 + Math.random() * 1.5; a.vel.y = -3; a.grounded = false;
          try { if (a.fsm && a.fsm.go) a.fsm.go('fall'); } catch (e) { /* state optional */ }
        } else if (a._s3arr === 1 && a.grounded) {
          a._s3arr = 2;
          feathers.burst(a.pos.x, (a.groundY || 0), a.pos.z, 6, 1.1);
          if (cam && cam.shake) cam.shake(0.14);
        }
      }
      const gust = 0.5 + 0.5 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
      eagle.update(dt, t, { feet, bank: st.bank, flap: st.flap * (st.bankT > 0 && st.bankT < 6.3 ? 0.35 : 1), gust });
      st.roll = eagle.roll;
      ring.update(dt, eagle.roll);
      feathers.update(dt);
      sky.update(dt, t, cam && cam.camera, { speed: SPEED * st.speedMul, progress: st.progress, streakMul: st.streakMul });
      // camera banks subtly with the flight (horizon tilts against the bird) + hard with the set-piece bank
      if (camD) camD.opts.roll = -THREE.MathUtils.radToDeg(eagle.pitch) * 0.9 + THREE.MathUtils.radToDeg(st.bank) * 0.55 + 0.6 * Math.sin(t * 0.31);
      if (cam && cam.camera) motes.update(cam.camera, cam.focus, game.renderer ? game.renderer.height : 900);
      // screeches every ~15-22 s
      st.screechIn -= dt;
      if (st.screechIn <= 0) { screech(0.78 + Math.random() * 0.1); st.screechIn = 15 + Math.random() * 8; }
    };
    update(0);
    const env = {
      update, eagle, sky, ring, feathers, st,
      groundAt: (x, z) => eagle.groundAt(x, z),
      bankThroughArch() {
        st.bankT = 7.5;
        screech(0.74);
        sky.arch.start(() => { if (cam && cam.shake) cam.shake(0.3); screech(0.7); });
        if (cam && cam.drama) cam.drama({ distance: 16, height: 5.6, lookHeight: 2.6, fov: 38, in: 1.2, hold: 3.6, out: 1.6, priority: 2 });
        game.bus.emit('stage3:arch', {});
      },
      toKeep() {
        st.progressTarget = 1.0;
        screech(0.72);
        if (cam && cam.drama) cam.drama({ distance: 17.5, height: 6.4, lookHeight: 3.0, fov: 40, in: 2.0, hold: 3.0, out: 1.6, priority: 2 });
        game.bus.emit('stage3:keep', {});
      },
      setProgress(p) { st.progressTarget = Math.max(st.progressTarget, p); },
      dispose() {
        if (camD) camD.release();
        if (cam && cam.resetFraming) cam.resetFraming();
        scope.dispose(); ring.dispose();
        if (active === env) active = null;
      },
    };
    active = env;
    if (typeof window !== 'undefined' && window.__KCA && window.__KCA.register) try { window.__KCA.register('stage3', env); } catch (e) { /* optional */ }
    return env;
  },
  // ENCOUNTER SCRIPT (chapter1-integration, wave C). Every foe lands on (drop) or climbs up (climb) the eagle's
  // back; the rump is a ring-out edge (throws / knockbacks off the tail = instant KO). An Emberdrake raider climbs
  // the tail (beast encounter), knights and purple skeletons escalate, then the Wyrm Rider lands (bossHook).
  // Encounter tuning (chapter1-integration): enemy damage × this on top of the difficulty option (arcade curve:
  // later stages field tougher tiers, so the multiplier falls as base damage rises). See src/game/Settings.js.
  tuning: { enemyDamage: 0.42 },
  screens: [
    { x: LOCK, trigger: -100,
      onEnter() { if (active) active.setProgress(0.05); },
      waves: [
        { delay: 50, spawns: [drop('marauder', 1.5, -0.8, { tier: 'rust' }), drop('marauder', 3.0, 1.2, { delay: 25 }), climb('marauder', 0.6, { delay: 70, tier: 'straw' }), climb('marauder', -1.2, { delay: 100, tier: 'rust', coop: true })] },
        { spawns: [drop('skeleton', 2.2, -1.3, { tier: 'white' }), climb('marauder', 1.6, { tier: 'rust', delay: 30 }), drop('viper', 0.5, 1.8, { delay: 60, tier: 'jade' }), { pickup: 'pot', x: -1, z: -1.6, delay: 20 }] },
      ] },
    { x: LOCK, trigger: -100,
      onEnter() { if (active) active.setProgress(0.3); },
      waves: [
        { delay: 60, spawns: [drop('skeleton', 2.6, 1.0), drop('skeleton', -4.8, -1.4, { delay: 20 }), climb('thief', -0.4, { tier: 'blue', delay: 50 })] },
        // BEAST ENCOUNTER: an Emberdrake raider scrambles up the tail feathers
        { spawns: [{ mount: 'emberdrake', x: WALK_X0 - 2.2, z: 0.4, opts: { rider: 'viper', riderOpts: { tier: 'jade' }, enterFrom: { x: WALK_X0 + 1.4, z: 0.4, speed: 1.6 } } }, drop('marauder', 2.4, -1.6, { tier: 'violet', delay: 60 }), drop('marauder', 1.0, 1.6, { tier: 'rust', delay: 90, coop: true })] },
        { spawns: [drop('knight', 2.8, 0.2, { tier: 'silver' }), drop('marauder', -2.0, 1.9, { tier: 'violet', delay: 40 }), { pickup: 'food', x: -4, z: -1.2, delay: 30 }] },
      ] },
    { x: LOCK, trigger: -100,
      onEnter({ game }) {
        // SET PIECE (stage-3 env): the eagle screeches and banks steeply through a colossal stone arch
        if (active) { active.setProgress(0.55); active.bankThroughArch(); }
        void game;
      },
      waves: [
        { delay: 470, spawns: [drop('skeleton', 1.5, -1.6, { tier: 'purple' }), drop('marauder', 3.0, 1.4, { tier: 'iron', delay: 20 }), climb('skeleton', 0.8, { delay: 50 }), climb('marauder', -1.0, { tier: 'violet', delay: 90, coop: true })] },
        { spawns: [drop('knight', 2.5, -0.6, { tier: 'red' }), climb('marauder', 1.5, { tier: 'rust', delay: 30 }), climb('thief', -1.2, { tier: 'green', delay: 80 })] },
      ] },
    { x: LOCK, trigger: -100,
      onEnter() { if (active) active.setProgress(0.8); },
      onClear() { if (active) active.toKeep(); },
      waves: [
        { delay: 60, spawns: [drop('viper', 2.2, 0.4, { tier: 'crimson' }), drop('skeleton', -4.6, 1.6, { tier: 'purple', delay: 25 }), drop('marauder', 3.2, -1.7, { tier: 'iron', delay: 50 })] },
        { spawns: [drop('knight', 2.6, 0.2, { tier: 'gold' }), drop('viper', -2.5, -1.5, { delay: 40 }), climb('marauder', 1.8, { tier: 'violet', delay: 70 }), drop('skeleton', 0.4, 1.2, { tier: 'purple', delay: 100, coop: true })] },
      ],
      bossHook: { id: 'wyrm_riders', note: 'Wyrm Rider (Viper Maiden captain on a Cinderwyrm) lands on the back after the last screen grunts.' } },
  ],
  next: 'bonus',
};
