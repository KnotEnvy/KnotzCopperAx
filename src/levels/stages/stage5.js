// Stage 5 — Throne of Coils (DESIGN §6, §10; GA Death Adder's throne room; Hades II / Absolum dark halls): the Adder
// King's obsidian hall. Staging is FRONTAL (camera looks -Z): the hall wall runs parallel to the belt behind a
// colonnade of colossal COILED-SERPENT pillars, each with a GREEN WITCHFIRE brazier under its rearing head.
//   screen 0  the approach gallery — banners, bone heaps, a side door that foes burst through
//   screen 1  the statue gallery — guardian statues COME ALIVE (crack apart as foes step off the plinths), a second
//             door bursts; the near floor has collapsed into a green-lit abyss (ring-outs over the broken lip)
//   screen 2  the throne arena — obsidian throne on its dais, the stolen COPPER AX relic hovering over the altar in a
//             gold shaft, the chained Queen + consort hanging above; boss hook for Morvane Deathcoil (anchors below)
// Look: emerald witchfire (16 analytic pools + 2 real lights re-seated for the actors) vs deep violet shadow, warm gold
// ONLY on the relic; polished obsidian mirrors the fires. Env code lives in ./stage5/**.
import * as THREE from 'three';
import { EV } from '../../core/EventBus.js';
import { loadKit } from './stage5/kit.js';
import { buildFloor } from './stage5/floor.js';
import { buildHall } from './stage5/hall.js';
import { createBursts } from './stage5/fx.js';
import { createMotes } from './stage5/motes.js';
import { createRingOuts } from './stage5/ringout.js';
import { createSetPieces } from './stage5/setpieces.js';
import { updateFires } from './stage5/shading.js';
import { GALLERY, EDGE_Z, THRONE, RELIC, BONES, CAPTIVES, CRACKS, ARENA, DOORS } from './stage5/layout.js';

const FRAMING = { fov: 34, distance: 14, height: 3.2, lookHeight: 1.9 };
let active = null;

const door = (i, type, o = {}) => ({ type, x: DOORS[i].x, z: -2.2, delay: o.delay || 0, tier: o.tier, coop: o.coop, elite: o.elite, opts: { s5from: 'door' + i, dx: o.dx || 0 } });
const statue = (i, type, o = {}) => ({ type, x: [22.4, 25.6, 30.4, 33.6][i], z: -2.2, delay: o.delay || 0, tier: o.tier, coop: o.coop, elite: o.elite, opts: { s5from: 'statue' + i } });

/** Arena anchors for the Morvane Deathcoil fight (bosses agent): world metres. */
export const ARENA_ANCHORS = {
  arena: { x: [ARENA.x0 + 1, ARENA.x1], centre: { x: 52, z: 0.2 } },
  throne: { x: THRONE.x, y: 1.65, z: THRONE.z + 0.2 },          // seat top (he waits / rises here)
  relic: { x: RELIC.x, y: RELIC.y, z: RELIC.z },                 // Copper Ax relic (finale: tears free, impales him)
  swarm: { x: BONES.x, y: 0.2, z: BONES.z + 0.4 },               // bone pile: the snake swarm forms him here
  captives: CAPTIVES.map((c) => ({ id: c.id, x: c.x, y: c.y, z: c.z, lowered: { x: c.x, y: 2.45, z: c.z } })),  // wrist anchor
  cracks: CRACKS.map((c) => ({ ...c })),                         // phase-2 crack zones (x, z, r)
};

export default {
  id: 'stage5',
  number: 5,
  name: 'Throne of Coils',
  subtitle: 'FINAL STAGE',
  zBand: [-2.6, 2.6],
  extents: [-3, 64],
  playerStart: { x: 2, z: 0 },
  lighting: {
    base: 'witchfire-hall',
    sky: { zenith: '#040306', top: '#07060b', horizon: '#0c0a12', bottom: '#040305', sunGlow: 0, sunDiscIntensity: 0, stars: 0 },
    sun: { color: '#8e88b0', intensity: 0.5, dir: [0.25, 0.9, 0.35], shadow: true, radius: 3, frustum: [-16, 16, 12, -10] },
    fill: { color: '#4a2a78', intensity: 0.45, dir: [-0.6, 0.3, 0.7] },
    hemi: { sky: '#2e2046', ground: '#07100a', intensity: 0.38 },
    rim: { color: '#58ff8a', intensity: 2.2, dir: [0.2, 0.45, -1] },
    fog: { color: '#0a0812', near: 20, far: 95, height: { density: 0.05, base: 0, falloff: 0.45, start: 14, max: 0.6, color: '#0e1c16' },
      depthGrade: { start: 14, end: 60, dim: 0.3, desat: 0.25, tint: '#140e22' } },
    env: { intensity: 0.28 },
    exposure: 1.1,
    grade: { saturation: 1.08, contrast: 1.16, vibrance: 0.08, lift: [0.004, 0.0, 0.014], shadowTint: [0.5, 0.38, 0.66], highlightTint: [0.5, 0.62, 0.46], split: 0.28 },
    bloom: { intensity: 1.1, threshold: 0.95, smoothing: 0.3, radius: 0.75 },
    vignette: { offset: 0.28, darkness: 0.6 },
    character: { rim: '#78ffa4', intensity: 0.55, power: 3.0, floor: 0.05, base: 0.0, edge: 2.6, width: 2.5, maxNdv: 0.6,
      key: { color: '#f0ece0', intensity: 2.8, wrap: 0.35, dir: [-0.6, 0.6, 0.5] }, ambient: '#9a86c0', ambientIntensity: 0.45 },
    wind: { dir: [1, 0], strength: 0.15, gust: 0.2 },
  },
  async build(ctx) {
    const { game, group } = ctx;
    const q = ctx.quality || {};
    const low = q.name === 'low';
    const cam = game.cameraRig;
    if (cam && cam.setFraming) cam.setFraming(FRAMING);

    const kit = await loadKit(game);
    const floor = buildFloor(ctx, kit);
    const hall = await buildHall(ctx, kit, { low });
    const bursts = createBursts(group);
    createMotes(group, { sources: hall.fires.map((f) => ({ x: f.x, y: f.y - 0.2, z: f.z })), abyss: { x0: GALLERY.x0, x1: GALLERY.x1, z0: EDGE_Z + 1 }, low });
    const sp = createSetPieces(ctx, { hall, floor, bursts });
    const ring = createRingOuts(game, { flare: (x, y, z, k) => bursts.flare(x, y, z, k), shake: (t) => cam && cam.shake && cam.shake(t), floor });
    const lights = [0, 1].map(() => { const l = new THREE.PointLight('#48ff84', 0, 10, 2); group.add(l); return l; });
    const relicLight = new THREE.PointLight('#ffaa48', 0, 14, 2); relicLight.position.set(RELIC.x, RELIC.y - 1, RELIC.z + 3); group.add(relicLight);

    const scope = game.bus.scope();
    scope.on(EV.WAVE_START, (ev) => {
      if (!ev) return;
      if (ev.screen === 0 && ev.wave === 2) game.after(10, () => sp.burstDoor(0));
      if (ev.screen === 1 && ev.wave === 0) sp.wakeStatues();
      if (ev.screen === 1 && ev.wave === 1) game.after(20, () => sp.burstDoor(1));
    });
    scope.on(EV.BOSS_INTRO, () => sp.surge(1.2, 2.5));
    scope.on(EV.BOSS_PHASE, (ev) => { sp.surge(1.5, 2); if (ev && (ev.phase === 2 || ev.phase === '2')) sp.crackAll(); });
    scope.on(EV.HIT, (ev) => { const tg = ev && ev.target; if (tg && tg.pos && (ev.killed || ev.level === 'heavy')) bursts.dust(tg.pos.x, 0.05, tg.pos.z, 3, 0.5, [0.1, 0.1, 0.11]); });

    const update = (dt, t) => {
      const f = cam && cam.focus ? cam.focus : { x: 0, z: 0 };
      updateFires(hall.fires, t, f.x);
      let a = null, b = null, da = 1e9, db = 1e9;
      for (const T of hall.fires) { const d = Math.abs(T.x - f.x) + Math.abs(T.z) * 0.3; if (d < da) { b = a; db = da; a = T; da = d; } else if (d < db) { b = T; db = d; } }
      [a, b].forEach((T, i) => { const l = lights[i]; if (!T) { l.intensity = 0; return; } l.position.set(T.x, T.y, T.z + 0.8); l.intensity = 4 * (0.85 + 0.15 * Math.sin(t * 9 + i * 2.1)); });
      relicLight.intensity = Math.max(0, 1 - Math.abs(f.x - RELIC.x) / 14) * 16;
      hall.update(dt, t);
      sp.update(dt, t);
      ring.update(dt);
      bursts.update(dt);
    };
    update(0, 0);
    const env = {
      update, kit, hall, floor, sp, ring, bursts,
      anchors: ARENA_ANCHORS,
      arena: {
        anchors: ARENA_ANCHORS,
        crack: (i, to) => sp.crackArena(i, to), crackAll: () => sp.crackAll(), lowerCaptives: () => sp.lowerCaptives(),
        surge: (k, s) => sp.surge(k, s), pitAt: (x, z) => ring.pitAt(x, z), relic: hall.relic,
      },
      groundAt: () => 0,
      dispose() {
        if (cam && cam.resetFraming) cam.resetFraming();
        scope.dispose(); ring.dispose(); sp.dispose();
        if (active === env) active = null;
      },
    };
    active = env;
    if (typeof window !== 'undefined' && window.__KCA && window.__KCA.register) try { window.__KCA.register('stage5', env); } catch (e) { /* optional */ }
    return env;
  },
  // ENCOUNTER SCRIPT (chapter1-integration, wave C). The gallery (collapsed near lip = ring-out edge): skeletons
  // RISE from the bone-strewn floor, foes burst through the doors, a raider on an Emberdrake -> the statue hall:
  // serpent statues come alive, then a Red Ogre -> the throne: the last guard (Gen. Oxide), then Morvane
  // Deathcoil forms from the bone pile once they fall (bossHook).
  props: [
    { prop: 'urn', x: 7.0, z: -2.1, loot: 'pot' }, { prop: 'urn', x: 12.5, z: -2.1, loot: 'food' },
    { prop: 'crate', x: 27.8, z: -2.1, loot: ['pot', 'pot'] }, { prop: 'urn', x: 44.0, z: -2.1, loot: 'food' },
  ],
  // Encounter tuning (chapter1-integration): enemy damage × this on top of the difficulty option (arcade curve:
  // later stages field tougher tiers, so the multiplier falls as base damage rises). See src/game/Settings.js.
  tuning: { enemyDamage: 0.34, bossDamage: 0.6, soloBossHp: 0.8 },
  screens: [
    { x: [-3, 20],
      waves: [
        { delay: 40, spawns: [{ type: 'marauder', side: 'right', z: 0.8, tier: 'violet' }, { type: 'skeleton', tier: 'white', x: 9, z: -1.4, rise: true, delay: 30 }, { type: 'skeleton', tier: 'white', x: 13, z: 1.0, rise: true, delay: 55 }, { type: 'thief', side: 'left', z: 1.6, tier: 'blue', delay: 90 }] },
        { spawns: [{ type: 'marauder', side: 'right', z: -0.8, tier: 'iron' }, { type: 'skeleton', tier: 'purple', x: 6, z: 1.2, rise: true, delay: 40 }, { type: 'viper', side: 'left', z: -1.0, tier: 'dusk', delay: 70, coop: true }, { pickup: 'pot', x: 9, z: -1.8, delay: 20 }] },
        { spawns: [door(0, 'marauder', { tier: 'violet', dx: -1 }), door(0, 'skeleton', { tier: 'purple', delay: 35, dx: 1 }), door(0, 'marauder', { tier: 'rust', delay: 80, coop: true })] },
        // BEAST ENCOUNTER: an Emberdrake raider charges down the gallery
        { spawns: [{ mount: 'emberdrake', side: 'right', z: 0.2, opts: { rider: 'marauder', riderOpts: { tier: 'iron' } } }, { type: 'skeleton', tier: 'white', x: 11, z: -1.6, rise: true, delay: 60, coop: true }, { type: 'thief', side: 'left', z: 1.4, tier: 'green', delay: 90 }] },
      ] },
    { x: [20, 41],
      waves: [
        { delay: 20, spawns: [statue(0, 'knight', { tier: 'silver', delay: 80 }), statue(3, 'knight', { tier: 'silver', delay: 120, coop: true }), { type: 'skeleton', side: 'right', z: 1.0, tier: 'purple', delay: 150 }] },
        { spawns: [statue(1, 'skeleton', { tier: 'purple' }), statue(2, 'skeleton', { tier: 'purple', delay: 30 }), door(1, 'marauder', { tier: 'iron', delay: 60 }), door(1, 'viper', { tier: 'dusk', delay: 100, coop: true }), { pickup: 'food', x: 36, z: -1.6, delay: 40 }] },
        { spawns: [door(1, 'ogre', { tier: 'red' }), { type: 'skeleton', tier: 'purple', x: 26, z: 1.4, rise: true, delay: 60, coop: true }, { pickup: 'food', x: 30, z: -1.6, delay: 90 }] },
      ] },
    { x: [41, 64],
      waves: [
        { delay: 40, spawns: [{ type: 'knight', side: 'right', z: 0.6, tier: 'gold', elite: 2 }, { type: 'skeleton', side: 'left', z: -1.4, tier: 'purple', delay: 40 }, { type: 'skeleton', side: 'right', z: 1.6, tier: 'purple', delay: 70, coop: true }, { type: 'viper', side: 'left', z: 1.0, tier: 'dusk', delay: 100, coop: true }, { pickup: 'pot', x: 47, z: 1.8, delay: 20 }, { pickup: 'food', x: 52, z: -1.6, delay: 40 }] },
      ],
      bossHook: { id: 'morvane', name: 'Morvane Deathcoil, the Adder King', arena: ARENA_ANCHORS,
        note: 'Throne arena. env.arena: crack(i, 1|2) / crackAll() (phase 2; EV.BOSS_PHASE {phase:2} triggers crackAll automatically), lowerCaptives() (finale), surge(k, s) (witchfire flare; auto on BOSS_INTRO/BOSS_PHASE), pitAt(x,z), relic (THREE.Group of the hovering Copper Ax). Opened pits swallow knocked enemies (ring-out) and keep walkers on the rim; kind "boss" is never pushed.' } },
  ],
  next: 'ending',
};
