// Morvane Deathcoil encounter script (intro → phase 2 corruption → Copper Ax finale). Used by types/boss_morvane.js.
// Stage 5 hooks read (all optional; see docs/notes/bosses.md "Stage hooks"): game.levels.env.boss = {
//   relic: {x,y,z} (the Copper Ax on the altar), crack(stage?), arena: { x: [x0, x1] }, captives: false }.
import * as THREE from 'three';
import { fxSystem, bonePile, snakeSwarm, serpentCoils, cape, captives, arenaCracks, copperAxImpale, WITCH } from './_fx.js';
import { reportError } from '../../core/log.js';
import { revealCam, introStandoff } from './_camera.js';

const envHook = (game) => {
  const env = game.levels && game.levels.env;
  if (!env) return null;
  if (env.boss || env.bossHooks) return env.boss || env.bossHooks;
  // Stage 5 (stage5-env): env.anchors (ARENA_ANCHORS) + env.arena runtime (crackAll auto on BOSS_PHASE 2, own captives).
  if (env.arena && env.anchors) {
    const A = env.anchors, R = env.arena;
    return { arena: A.arena, relic: A.relic, swarm: A.swarm, captives: false, stageCracks: true, relicGroup: R.relic,
      lowerCaptives: () => { try { R.lowerCaptives(); } catch (e) { reportError('stage5.lowerCaptives', e); } } };
  }
  return null;
};

// C2 r1 (ref morvane.png: "green witchfire in the off hand"; his stance holds that claw forward). C2 r12 (board r11: "a
// soft vertical green smear / shapeless additive blob — needs flame tongues and hot core falloff"): rebuilt on the
// shared authored fire library (src/vfx/fireLib.js, the VfxSystem's FirePool = one existing instanced draw): three
// looping 'flame' flipbook tongues, green-tinted (the authored hot bed → mint core, the red tongues → acid green with
// yellow tips), additive, rooted ON the claw and leaning off it against his motion, + a small palm glow and rising
// sparks on the pooled shape/add emitters. Live while he stands / stalks and through the intro reveal; the tongues are
// taken out of the pool (not hidden) whenever he attacks, reacts or dies. &witchhand=0 disables. 0 new programs.
const WH_OFF = typeof location !== 'undefined' && /[?&]witchhand=0/.test(location.search);
const _wh = { v: null };
// dz: the pool soft-fades against the depth behind it over 0.2 m — rooted flush on the gauntlet the armour behind ate
// them (a green haze), so the quads sit ~0.4 m toward the lens (a few px of parallax off-centre at game distance)
const WH_R12 = typeof location !== 'undefined' && /[?&]witchfire=r12/.test(location.search);
// C2 r13 (board r12, all three seats: "still a small green glint on the fist"): a SHAPED flame, not a glow. The r12
// tongues were additive only — on the dark gauntlet that reads as a luminous patch with no outline. Now: a tall body
// tongue + two side licks in the pool's NORMAL (premultiplied, silhouetted) mode, green-graded, so the flame has an edge
// against the armour and the hall; an additive hot inner tongue (emissive core, bloom), short detached licks that break
// off the top and rise, a tighter brighter palm core glow, and a flickering green point light — one reused slot of the
// VfxSystem's pooled pop lights (the scene's point-light count never changes → no new programs).
// [dx along facing, dy, dz toward camera, w, h, cycle s, phase, mirror, lean, additive, core, tint]
const HAND_R13 = typeof location !== 'undefined' && /[?&]witchhand=r13/.test(location.search);
// r14 (board r13, Sol: "the casting hand competes with the brighter green braziers"): the braziers are pale mint, so the hand
// separates by VALUE CONTRAST inside the flame — a deeper, saturated emerald body around a hotter near-white core — and a
// little more size (body 0.40×1.02 → 0.46×1.16, core 0.17×0.50 → 0.21×0.62), + a stronger light on his own gauntlet.
const BODY = HAND_R13 ? [0.08, 1.5, 0.5] : [0.04, 1.2, 0.3], CORE = HAND_R13 ? [0.9, 2.6, 1.3] : [1.5, 3.2, 1.9];   // r13 resume: body r 0.28 → 0.08 (the atlas' red tongue tips read orange)
const HS = HAND_R13 ? 1 : 1.14;
const TONGUES = WH_R12 ? [
  [0.10, 0.02, 0.42, 0.21, 0.56, 0.62, 0.0, 1, -0.10, true, 1.6, null],
  [0.0, 0.0, 0.48, 0.16, 0.44, 0.53, 0.37, -1, 0.16, true, 1.6, null],
  [0.18, -0.02, 0.36, 0.14, 0.38, 0.47, 0.71, 1, 0.26, true, 1.6, null],
] : [
  [0.06, 0.0, 0.40, 0.40 * HS, 1.02 * HS, 0.58, 0.0, 1, -0.04, false, 0.42, BODY],    // body tongue
  [-0.10, -0.04, 0.44, 0.24 * HS, 0.66 * HS, 0.49, 0.41, -1, 0.34, false, 0.35, BODY], // back lick (leans off the fist)
  [0.20, -0.06, 0.36, 0.22 * HS, 0.58 * HS, 0.44, 0.73, 1, -0.30, false, 0.35, BODY],  // front lick
  [0.06, 0.0, 0.50, 0.17 * HS * 1.08, 0.50 * HS * 1.08, 0.37, 0.19, 1, 0.0, true, HAND_R13 ? 1.9 : 2.3, CORE],       // hot inner core (additive)
];
// C2 r15 (board r14, all three seats: "the hand flame is a fan of straight tapered spikes with hard alpha edges and blocky
// pixels at 2x; the brighter braziers dominate"): every 'flame' atlas frame is already a CLUSTER of three sharp tongues, so
// the four fanned quads above stacked ~12 spikes. Now the hand burns as soft MASSES: the atlas' fireBurst flipbook (a full
// rounded flame body with its own licking crown) scrubbed back and forth through its four living frames (0–3, never the
// burn-out) by setting each item's age every tick — two silhouetted emerald lobes + one additive hot core, erosion 0
// (no eaten edge), detached licks are tiny dying fireBursts instead of spikes, and a soft DARK halo sits just behind
// the claw (lit-alpha pool, black albedo, depth-tested so only the hall behind the hand darkens) for local contrast
// against the braziers. Same pool / draws / light slot → 0 new programs. `&witchhand=r14` = the r14 spike fan.
const HAND_R14 = typeof location !== 'undefined' && /[?&]witchhand=r14/.test(location.search);
const SOFT = !HAND_R14 && !HAND_R13 && !WH_R12;
const BURST_LIFE = 10;   // scrubbed items: frame = age / life * 7 → age = frame * life / 7 (never reaches the fade at t 0.65)
// the fireBurst body is mostly yellow (not the flame clip's red): the r14 CORE tint [1.5,3.2,1.9] turned it YELLOW → low red,
// high green (yellow 1,.7,.2 → .3,1.7,.28 green; the near-white root stays mint-white through the shader's hot mix)
const CORE_SOFT = [0.3, 2.4, 1.4];
// [dx along facing, dy, dz toward camera, w, h, scrub period s, phase, mirror, lean, additive, core, tint]
const LOBES = [
  [0.05, 0.0, 0.40, 0.56, 0.94, 0.70, 0.0, 1, -0.06, false, 0.22, BODY],    // body mass (taller than the cell: the crown licks stretch up)
  [-0.10, 0.06, 0.44, 0.40, 0.72, 0.57, 0.41, -1, 0.30, false, 0.2, BODY],  // back lobe (leans off the fist)
  [0.05, -0.03, 0.50, 0.28, 0.44, 0.47, 0.19, 1, 0.0, true, 1.5, CORE_SOFT], // hot inner core (additive)
];
const GREEN = [0.14, 1.85, 0.7];   // r12 additive tint (the authored red tongue edges stayed orange-red at r 0.3)
function dropTongues(b) {
  if (b._whLight) { b._whLight.t = b._whLight.life; b._whLight.light.intensity = 0; b._whLight = null; }
  const L = b._whT; if (!L) return;
  const pool = b.game.vfx && b.game.vfx.fire;
  if (pool) for (const o of L) { const i = pool.items.indexOf(o); if (i >= 0) pool.items.splice(i, 1); }
  b._whT = null;
}
function softLobes(b, pool, p, vx, vy, t, f, k) {
  if (b._whT && b._whT.some((o) => pool.items.indexOf(o) < 0)) b._whT = null;   // pool cleared (stage change / reset)
  if (!b._whT) {
    b._whT = [];
    for (const T of LOBES) {
      const o = pool.emit({ clip: 'fireBurst', life: BURST_LIFE, phase: 0, erosion: 0, size: [T[3], T[4]], additive: T[9], core: T[10], mirror: T[7], pos: [p.x, p.y, p.z], radiance: T[9] ? 0 : 0.6 });
      if (!o) break;
      o.tint = [...T[11]];
      b._whT.push(o);
    }
  }
  const lean = Math.max(-0.5, Math.min(0.5, -vx * 0.12));
  for (let i = 0; i < b._whT.length; i++) {
    const o = b._whT[i], T = LOBES[i];
    // scrub the living frames 0..3 back and forth (two incommensurate sines → no visible loop)
    const w = (t / 60) * Math.PI * 2 / T[5] + T[6] * Math.PI * 2;
    const fr = Math.max(0.02, Math.min(3.1, 1.55 + 1.05 * Math.sin(w) + 0.45 * Math.sin(t * 0.093 + i * 2.3)));
    o.age = fr * BURST_LIFE / 7;
    const fl = 0.92 + 0.08 * Math.sin(t * (0.29 + i * 0.07) + i * 2.1);
    o.size[0] = T[3] * k; o.size[1] = T[4] * k * fl * (1 + Math.max(0, -vy) * 0.08);
    o.pos[0] = p.x + f * T[0]; o.pos[1] = p.y + T[1] + o.size[1] * 0.24; o.pos[2] = p.z + T[2];   // fireBurst's bed sits ~0.24 h below the cell centre → on the claw
    o.rot = (T[8] * -f) + lean; o.vel[0] = o.vel[1] = o.vel[2] = 0;
  }
}
function witchHand(b, force = false) {
  const g = b.game, v = g.vfx;
  const on = !WH_OFF && v && v.shape && v.add && b.alive && !b.defeated && b.view.visible !== false
    && (force || (b.introDone && b.fsm.is('idle', 'walk', 'run', 'pause', 'puppet')));   // puppet = showcase plinth / lineup
  if (!on) { dropTongues(b); return; }
  const hand = b._hand || (b._hand = b.modelRoot && b.modelRoot.getObjectByName('hand_L'));
  if (!hand) return;
  const p = _wh.v || (_wh.v = hand.position.clone());
  hand.getWorldPosition(p);
  const vx = b._whP ? (p.x - b._whP.x) * 60 : 0, vy = b._whP ? (p.y - b._whP.y) * 60 : 0;   // claw velocity (m/s)
  (b._whP || (b._whP = p.clone())).copy(p);
  const t = g.tick, f = b.facing || 1;
  const k = 0.88 + 0.12 * Math.sin(t * 0.21) * Math.sin(t * 0.077);
  // flame tongues (shared fire pool): keep the 3 looping items, re-root them on the claw every tick
  const pool = v.fire;
  if (pool) {
    if (b._whT && b._whT.some((o) => pool.items.indexOf(o) < 0)) b._whT = null;   // pool cleared (stage change / reset)
    if (SOFT) softLobes(b, pool, p, vx, vy, t, f, k);
    else if (!b._whT) {
      b._whT = [];
      for (const T of TONGUES) {
        const o = pool.emit({ clip: 'flame', loop: true, life: T[5], phase: T[6], size: [T[3], T[4]], additive: T[9], core: T[10], mirror: T[7], pos: [p.x, p.y, p.z], radiance: T[9] ? 0 : 0.6 });
        if (!o) break;
        o.tint = [...(T[11] || GREEN)];
        b._whT.push(o);
      }
    }
    const lean = Math.max(-0.5, Math.min(0.5, -vx * 0.12));   // the tongues trail his motion
    if (!SOFT) for (let i = 0; i < b._whT.length; i++) {
      const o = b._whT[i], T = TONGUES[i];
      const fl = 0.9 + 0.1 * Math.sin(t * (0.31 + i * 0.07) + i * 2.1);
      o.size[0] = T[3] * k; o.size[1] = T[4] * k * fl * (1 + Math.max(0, -vy) * 0.08);
      o.pos[0] = p.x + f * T[0]; o.pos[1] = p.y + T[1] + o.size[1] * 0.36; o.pos[2] = p.z + T[2];
      o.rot = (T[8] * -f) + lean; o.vel[0] = o.vel[1] = o.vel[2] = 0;
    }
  }
  const fx0 = p.x + f * 0.1;
  if (!WH_R12) {
    const cz = g.camera ? Math.sign(g.camera.position.z - p.z) || 1 : 1;
    // flickering green light: the last pooled pop-light slot, re-armed every tick while the flame burns
    const L = v.lights && v.lights[v.lights.length - 1];
    if (L) {
      const fl = 0.78 + 0.22 * Math.sin(t * 0.43) * Math.sin(t * 0.171 + 1.3) + (Math.random() - 0.5) * 0.12;
      L.light.position.set(fx0, p.y + 0.3, p.z + cz * 0.55); L.light.color.set(0x4dff7a);
      L.light.distance = 2.6; L.base = (HAND_R13 ? 4.2 : 5.2) * fl; L.t = 0; L.life = 0.12; L.hold = 0.1; L.light.intensity = L.base;
      b._whLight = L;
    }
    // detached licks: a small flame breaks off the crown and rises / fades
    if (SOFT) {
      if (pool && t % 11 === 0) {   // a small dying fireBurst rises off the crown (its own burn-out frames)
        const o = pool.emit({ clip: 'fireBurst', life: 0.42, phase: 0.3, erosion: 0, size: [0.2, 0.26], core: 0.25, radiance: 0.5, mirror: t % 22 ? 1 : -1, pos: [p.x + f * (0.02 + Math.random() * 0.1), p.y + 0.5 + Math.random() * 0.1, p.z + cz * 0.44], vel: [-vx * 0.15 + (Math.random() - 0.5) * 0.25, 1.2, 0], grow: -0.35 });
        if (o) o.tint = [...BODY];
      }
      // dark halo just BEHIND the claw: depth-tested, so the gauntlet in front stays lit and only the hall behind darkens
      if (v.alpha && t % 3 === 0) v.alpha.emit({ pos: [fx0, p.y + 0.3, p.z - cz * 0.14], life: 0.2, size: [1.15 * k, 1.2 * k], color: [[0, 0.01, 0, 0.3], [0, 0.01, 0, 0]], shape: 'soft', fadeIn: 0.04 });
    } else if (pool && t % 9 === 0) {
      const o = pool.emit({ clip: 'flame', life: 0.34, size: [0.13, 0.3], additive: false, core: 0.4, radiance: 0.5, mirror: t % 18 ? 1 : -1, pos: [p.x + f * (0.04 + Math.random() * 0.1), p.y + 0.62 + Math.random() * 0.12, p.z + cz * 0.42], vel: [-vx * 0.15 + (Math.random() - 0.5) * 0.3, 1.5, 0], growY: -0.4 });
      if (o) o.tint = [...BODY];
    }
  }
  if (t % 2) return;
  // palm glow: small and tight (was a 0.75 m soft disc — the "smear")
  if (t % 4 === 0) v.shape.emit({ shape: 'glow', pos: [fx0, p.y + 0.03, p.z + 0.4], size: WH_R12 ? [0.3 * k, 0.28 * k] : [0.42 * k, 0.4 * k], life: 0.14, color: [WITCH.hot, WITCH.mid], intensity: WH_R12 ? 0.8 : 1.5, alpha: [WH_R12 ? 0.6 : 0.8, 0] });
  if (t % 6 === 0) v.add.emit({ pos: [fx0 + (Math.random() - 0.5) * 0.12, p.y + 0.26, p.z + 0.42], vel: [(Math.random() - 0.5) * 0.5 - vx * 0.2, 1.1 + Math.random() * 0.9, (Math.random() - 0.5) * 0.4], life: 0.55, size: [0.07, 0.012], color: [WITCH.hot, WITCH.tail], intensity: 3.5, shape: 'spark', stretch: 0.02, gravity: -1.5, drag: 1.5 });
}

// C2 r12 reveal camera: _camera.js revealCam (boss + both heroes framed, 24° lens, orbit toward the heroes' side).
const REVEAL_OFF = typeof location !== 'undefined' && /[?&]bossreveal=0/.test(location.search);
const REVEAL_YAW = 0.66;   // body cheat toward the camera during the reveal (rad; fight value 0.32)
const INTRO_R13 = typeof location !== 'undefined' && /[?&]morvaneintro=r13/.test(location.search);   // A/B: r13 intro length
function standoff(b, t) { if (!REVEAL_OFF) introStandoff(b, t, 3.4); }

export function morvaneScript() {
  let fx = null, pile = null, swarm = null, coils = null, capeFx = null, capt = null, cracks = null, cam = null;
  let cheat0 = 0.32;
  let introT = -1, coilGrow = 0, coilTarget = 0, strike = 0, dissolve = 0, veins = 0;
  const S = {
    hiddenIntro: true,   // he rises from the pile at t 92 (_Boss bossIntro keeps him hidden from the first frame)
    async setup(b, opts = {}) {
      fx = b.fx = fxSystem(b);
      const H0 = envHook(b.game);
      if (H0 && H0.swarm && !b.showcase) {  // rise from the stage's own bone pile
        const band = b.game.world && b.game.world.band;
        b.pos.x = H0.swarm.x; b.pos.z = band ? Math.max(band.zMin + 0.3, Math.min(band.zMax - 0.3, H0.swarm.z)) : H0.swarm.z;
        if (b.prevPos) b.prevPos.copy(b.pos);
      } else pile = bonePile(fx, b.pos.x, b.pos.z - 0.2);
      capeFx = cape(fx, b, { color: '#4a1a1a', trim: '#b8903a', lining: '#2c1a14',   // C2 r1: dark oxblood (ref morvane.png; a hue break from the green hall) now that it is key-lit
        width: 1.0, length: 1.0, top: 0.8 });
      const H = envHook(b.game);
      if (opts.captives !== false && !(H && H.captives === false)) {
        try { capt = await captives(fx, b.pos.x - 1.2, b.pos.z, { y: 4.4 }); } catch (e) { reportError('morvane.captives', e); }
      }
      if (opts.phase >= 2) { S.corrupt(b, true); b.phase = 2; }
    },
    relicPos(b) {
      const H = envHook(b.game);
      if (H && H.relic) return H.relic;
      return { x: b.pos.x + 3.5, y: 4.2, z: b.pos.z - 4.5 };
    },
    /** Apply the corrupted look (coils, green veins, bulk). instant = showcase phase=2. */
    corrupt(b, instant = false) {
      if (!coils) coils = serpentCoils(fx, b);
      coilTarget = 1; if (instant) coilGrow = 1;
      veins = 1;
      if (b.lightRig) b.lightRig.k = 1.15;   // r6: the relic's copper fire burns brighter on him in phase 2
      // r6: copper-ember corruption veins (was witch-green #1c8a3a — green-on-green vanished into the lime hall)
      for (const m of b.flashMaterials) { if (m.userData.baseEmissive) { m.userData.baseEmissive.set('#a8401a'); m.userData.baseEmissiveIntensity = 0.15; m.emissive.set('#a8401a'); m.emissiveIntensity = 0.15; } }
      if (b.modelRoot) b.modelRoot.scale.multiplyScalar(1.12);   // phase 2 towers (critic r2: larger phase 2)
      b.height *= 1.08;
    },
    intro(b, t) {
      const g = b.game;
      introT = t;
      const H = b.height;
      if (t === 1) {
        // C2 r12 (board r11: back/side to the camera behind the name card, heroes half-cropped, a 5.4 m camera snap
        // from punch(0.6)): a reveal camera that frames him AND both heroes (revealCam), a slight orbit toward the
        // heroes' side, and he turns 3/4 to the camera while he rises — face, claw and axe all read before the card.
        cam = REVEAL_OFF ? (g.cameraRig && g.cameraRig.drama ? g.cameraRig.drama({ focus: b, distance: 9, height: 2.7, fov: 30, lookHeight: H * 0.5, in: 0.5, hold: null, priority: 4 }) : null) : revealCam(b, { yaw: 12, out: INTRO_R13 ? 0.6 : 1.1 });   // r14: slower hand-back to the fight camera (clipcheck: 6 spike frames on the 0.6 s release)
        cheat0 = b.cheatYaw;
        swarm = snakeSwarm(fx, { x: b.pos.x, y: H * 0.88, z: b.pos.z }, { n: 20, radius: 3.6 });
        if (g.audio && g.audio.play) g.audio.play('roar', { volume: 0.5, pitch: 0.6 });
      }
      if (cam && cam.tick) cam.tick(t);
      standoff(b, t);
      if (t > 1 && t < 110 && t % 3 === 0 && g.vfx && g.vfx.alpha) g.vfx.alpha.emit({ pos: [b.pos.x + (Math.random() - 0.5) * 3, 0.3, b.pos.z + (Math.random() - 0.5) * 1.5], vel: [0, 0.6, 0], life: 2.2, size: [0.8, 2.2], color: ['#0c1a10', '#0c1a10'], alpha: [0.55, 0], drag: 0.8 });
      if (t === 92) {
        b.view.visible = true; if (b.modelRoot) b.modelRoot.position.y = -H * 0.9;
        b.play('intro_rise', { restart: true, fade: 0, fallback: ['getup', 'idle'] });
        b.flash(WITCH.hot, 30, 1.6);
        if (g.vfx && g.vfx.shape) { g.vfx.shape.emit({ shape: 'ring', pos: [b.pos.x, H * 0.85, b.pos.z + 0.3], size: [2.4, 2.4], life: 0.5, color: [WITCH.core, WITCH.mid], intensity: 4, grow: [0.3, 1.2] }); g.vfx.shape.emit({ shape: 'glow', pos: [b.pos.x, H * 0.85, b.pos.z + 0.3], size: [1.3, 1.3], life: 0.4, color: [WITCH.hot, WITCH.mid], intensity: 3 }); }
      }
      if (t >= 92 && t <= 140 && b.modelRoot) { const k = (t - 92) / 48; b.modelRoot.position.y = -H * 0.9 * (1 - (1 - (1 - k) ** 3)); b.view.visible = true; }
      if (t < 92) b.view.visible = false;
      // the turn: profile (cheatYaw 0.32 rad) → 3/4 front while he rises, settled before the reveal pose and the card
      if (t >= 96 && t <= 140 && !REVEAL_OFF) { const k = (t - 96) / 44; b.cheatYaw = cheat0 + (REVEAL_YAW - cheat0) * k * k * (3 - 2 * k); }
      // r14 (board r13: "frame the snake-swarm formation" — dark scales on the dark throne steps read as a clump): a witchfire
      // glow pools under the converging swarm and green motes spiral up into it (pooled shape/add emitters, 0 draws)
      if (!INTRO_R13 && swarm && t > 4 && t < 118 && g.vfx && g.vfx.shape) {
        const k = Math.min(1, t / 110), sx = b.pos.x, sz = b.pos.z;
        if (t % 4 === 0) g.vfx.shape.emit({ shape: 'glow', mode: 'plane', pos: [sx, 0.03, sz], size: [3.6 - 2.2 * k, 3.6 - 2.2 * k], life: 0.5, color: [WITCH.mid, WITCH.tail], intensity: 1.2 + 1.6 * k });
        if (t % 2 === 0) { const a = t * 0.37, r = 3.2 * (1 - k) + 0.3; g.vfx.add.emit({ pos: [sx + Math.cos(a) * r, 0.15 + k * H * 0.6, sz + Math.sin(a) * r * 0.8], vel: [-Math.cos(a) * 1.4, 1.2, -Math.sin(a) * 1.1], life: 0.6, size: [0.07, 0.012], color: [WITCH.hot, WITCH.mid], intensity: 4, shape: 'spark', stretch: 0.02, gravity: -0.8, drag: 1.2 }); }
      }
      if (t === 118 && swarm) { swarm.dispose(); swarm = null; }
      if (t === 138) b.play('intro_reveal', { restart: true, fade: 0.12, fallback: ['taunt', 'idle'] });
      if (t === 150) {
        b.announce();
        if (g.cameraRig && g.cameraRig.shake) g.cameraRig.shake(0.45);
        if (g.cameraRig && g.cameraRig.punch) g.cameraRig.punch(0.045, 14);   // was 0.6: a 5.4 m one-frame dolly snap
      }
      // C2 r14 (board r13: "the final boss gets the shortest card — 85 ticks / 55 full vs ~140 / 111 elsewhere"): the card is
      // dismissed when the intro ends, so the intro now holds the reveal until card + 140 ticks (was t 215 = card + 65).
      if (t >= (INTRO_R13 ? 215 : 290)) { if (b.modelRoot) b.modelRoot.position.y = 0; if (cam) { cam.release(); cam = null; } return true; }
      return false;
    },
    phaseShift(b, t) {
      const g = b.game, H = b.height;
      if (t === 1) {
        if (g.cameraRig && g.cameraRig.drama) cam = g.cameraRig.drama({ focus: b, distance: 12, height: 3.6, fov: 31, lookHeight: H * 0.5, in: 0.4, hold: null, priority: 4 });
        b.play('summon', { restart: true, fade: 0.1, duration: 1.4 });
        g.slowmo(0.6, 0.8);
        g.bus.emit('boss:corrupt', { boss: b });
      }
      const rp = S.relicPos(b);
      if (t < 110 && t % 2 === 0 && g.vfx && g.vfx.shape) {
        const a = new THREE.Vector3(rp.x, rp.y, rp.z), c = new THREE.Vector3(b.pos.x, H * 0.7, b.pos.z);
        const d = c.clone().sub(a), L = d.length(); d.normalize();
        const k = Math.random();
        const p = a.clone().addScaledVector(d, L * k);
        g.vfx.shape.emit({ shape: 'line', mode: 'axial', pos: [p.x, p.y, p.z], dir: [d.x, d.y, d.z], size: [L * 0.35, 0.18], life: 0.12, color: ['#ffe2b0', '#ff7a30'], intensity: 5 });
        g.vfx.add.emit({ pos: [p.x, p.y, p.z], vel: [d.x * 6, d.y * 6, d.z * 6], life: 0.4, size: [0.1, 0.02], color: ['#ffd8a0', WITCH.mid], intensity: 5 });
      }
      if (t % 24 === 0) b.flash(WITCH.hot, 6, 1.2);
      if (t === 60) { S.corrupt(b); if (g.audio && g.audio.play) g.audio.play('roar', { volume: 0.9, pitch: 0.7 }); }
      if (t === 100) {
        const A = envHook(g), band = g.levels && g.levels.stage && g.cameraRig ? g.cameraRig.visibleRange(0) : { xMin: b.pos.x - 8, xMax: b.pos.x + 8 };
        const x0 = (A && A.arena && A.arena.x) ? A.arena.x[0] : band.xMin + 1, x1 = (A && A.arena && A.arena.x) ? A.arena.x[1] : band.xMax - 1;
        if (!(A && A.stageCracks)) { cracks = arenaCracks(fx, x0, x1); cracks.burst(); }  // stage 5 cracks itself on BOSS_PHASE 2
        if (A && typeof A.crack === 'function') try { A.crack(2); } catch (e) { reportError('stage5.crack', e); }
        if (g.cameraRig && g.cameraRig.shake) g.cameraRig.shake(0.8);
        b.play('taunt', { restart: true, fade: 0.1 });
      }
      if (t >= 175) { if (cam) { cam.release(); cam = null; } return true; }
      return false;
    },
    onPhase(b, phase) { if (phase >= 2 && b.brain && b.brain.onPhase) b.brain.onPhase(phase); },
    update(b) {
      if (fx) fx.update();
      witchHand(b, b.fsm.is('bossIntro') && introT >= 112);
      if (b.introDone && b.cheatYaw > cheat0 + 1e-4) b.cheatYaw = Math.max(cheat0, b.cheatYaw - 0.012);   // back to the fight's profile cheat over ~0.4 s
      if (cracks) cracks.update();
      if (b.attack && b.moveId === 'lunge') strike = Math.min(1, strike + 0.12); else strike = Math.max(0, strike - 0.06);
    },
    render(b, alpha, dt) {
      const time = b.game.time;
      if (swarm && introT >= 0) swarm.update(Math.min(1, introT / 110), time);
      if (capeFx) capeFx.update(dt, time);
      if (coils) { coilGrow += (coilTarget - coilGrow) * Math.min(1, dt * 1.6); const lying = b.fsm.is('knockdown', 'down', 'getup') ? 0.25 : 1; coils.update(time, coilGrow * (1 - dissolve) * lying, strike); }
      if (capt) capt.update(dt, time);
      if (veins && b.flashMaterials.length && !b._flash.t) {
        const k = 0.13 + 0.07 * Math.sin(time * 3.2);   // r6: ember veins are a pulse, not a body wash
        for (const m of b.flashMaterials) { m.emissiveIntensity = k; }
      }
    },
    async finale(b) {
      const g = b.game;
      await g.wait(50);
      b.play('hit_high', { restart: true, fade: 0.1, duration: 1.2 });
      const rp = S.relicPos(b);
      g.bus.emit('boss:relicFree', { boss: b, pos: rp });
      const HR = envHook(g);
      if (HR && HR.relicGroup) HR.relicGroup.visible = false;  // the stage's hovering relic tears free → our flying ax
      const ax = await copperAxImpale(fx, b, { from: rp });
      b.play('taunt', { restart: true, fade: 0.05, speed: 0.5 });
      b.flash('#ff9a50', 40, 2);
      // unravel into snakes + witchfire smoke
      swarm = snakeSwarm(fx, { x: b.pos.x, y: b.height * 0.6, z: b.pos.z }, { n: 16, radius: 4.2 });
      const sy0 = b.modelRoot ? b.modelRoot.scale.y : 1;   // C2 r12: own height scale (bodyScale makes x ≠ y)
      for (let i = 0; i <= 110; i++) {
        const k = i / 110;
        dissolve = k;
        if (swarm) swarm.update(1 - k, g.time);
        if (b.modelRoot) { b.modelRoot.scale.y = Math.max(0.02, sy0 * (1 - k * 0.98)); b.modelRoot.position.y = -k * 0.3; }
        if (i % 3 === 0 && g.vfx && g.vfx.alpha) g.vfx.alpha.emit({ pos: [b.pos.x + (Math.random() - 0.5) * 1.6, 0.3 + Math.random() * b.height * (1 - k), b.pos.z], vel: [0, 1.2, 0], life: 1.8, size: [0.7, 1.8], color: ['#0c1a10', '#0c1a10'], alpha: [0.6, 0], drag: 0.8 });
        if (i % 2 === 0 && g.vfx && g.vfx.add) g.vfx.add.emit({ pos: [b.pos.x + (Math.random() - 0.5), Math.random() * b.height * (1 - k), b.pos.z], vel: [0, 2.5, 0], life: 0.8, size: [0.09, 0.01], color: [WITCH.core, WITCH.mid], intensity: 5 });
        await g.wait(1);
      }
      b.view.visible = false;
      if (ax) { ax.position.set(b.pos.x, 0.9, b.pos.z + 0.2); ax.rotation.set(0, 0, Math.PI * 0.9); }
      if (swarm) { swarm.dispose(); swarm = null; }
      const HL = envHook(g);
      if (capt) capt.lower(3.2); else if (HL && HL.lowerCaptives) HL.lowerCaptives();
      const lowered = !!(capt || (HL && HL.lowerCaptives));
      if (lowered) g.bus.emit('boss:captivesLowered', { boss: b });
      await g.wait(lowered ? 220 : 60);
    },
    dispose(b) {
      dropTongues(b);
      if (cam) { cam.release(); cam = null; }
      if (b.brain && b.brain.dispose) b.brain.dispose();
      if (fx) fx.dispose();
      pile = null;
    },
  };
  return S;
}
