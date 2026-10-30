// Stage 4 — Serpent Keep Gates (DESIGN §6, §10; GA Death Adder's castle; Trine 5 castles): a midnight THUNDERSTORM
// at the Adder King's fortress. Staging is FRONTAL: the fortress face runs parallel to the belt, so walls, gates,
// doors, banners, statues and gargoyles all read face-on in the default belt framing.
//   screen 0  the moat causeway — wet flagstone berm, moat below the near lip (ring-outs), the keep's spired towers
//             across the broad water court silhouetted by lightning, the outer curtain rising from the moat at right
//   screen 1  the outer gatehouse — SET PIECE: the drawbridge crashes down across the back moat, the portcullis grinds
//             up under the adder sigil, foes march out over the deck
//   screen 2  the torch-lit courtyard — braziers, coiled cobra statues, a door kicked open, a gargoyle comes alive (hook)
//   screen 3  the grand stair — BOULDER CHASE: carved stone balls bound down the stair toward the camera
//   screen 4  the inner gate — boss arena hook for Iron Chancellor Varkhul
// Look: cold blue-violet storm key + warm torch pools (analytic, 16 per frame), soaked stone with puddle mirrors,
// layered rain streaks + splashes, forked lightning that lights the whole scene.
import * as THREE from 'three';
import { EV } from '../../core/EventBus.js';
import { loadKit } from './stage4/kit.js';
import { buildGround } from './stage4/ground.js';
import { buildCastle } from './stage4/castle.js';
import { lightBreakables } from './stage4/props.js';
import { createRain } from './stage4/rain.js';
import { createStorm } from './stage4/storm.js';
import { createBursts } from './stage4/fx.js';
import { createRingOuts } from './stage4/ringout.js';
import { createSetPieces } from './stage4/setpieces.js';
import { updateTorches } from './stage4/shading.js';
import { GATE_X, COURT_X, STAIRS, INNER_X } from './stage4/layout.js';

const FRAMING = { fov: 34, distance: 14, height: 3.4, lookHeight: 1.7 };
let active = null;

const gate = (type, o = {}) => ({ type, x: GATE_X, z: -2.2, delay: o.delay || 0, tier: o.tier, coop: o.coop, elite: o.elite, opts: { s4from: 'gate', dx: o.dx || 0 } });
const door = (i, type, o = {}) => ({ type, x: i ? 81 : 52, z: -2.2, delay: o.delay || 0, tier: o.tier, coop: o.coop, elite: o.elite, opts: { s4from: 'door' + i, dx: o.dx || 0 } });
const upper = (type, o = {}) => ({ type, x: 70, z: -2.2, delay: o.delay || 0, tier: o.tier, coop: o.coop, elite: o.elite, opts: { s4from: 'upper', dx: o.dx || 0 } });

export default {
  id: 'stage4',
  number: 4,
  name: 'Serpent Keep Gates',
  subtitle: 'STAGE 4',
  zBand: [-2.6, 2.6],
  extents: [-3, 99],
  playerStart: { x: 2, z: 0 },
  lighting: {
    base: 'storm-night',
    sky: { zenith: '#04050c', top: '#0a0e1c', horizon: '#1a2034', bottom: '#06070c', sunDir: [0.5, 0.35, -1], sunColor: '#1a2030', sunDisc: '#000000', sunDiscIntensity: 0, sunGlow: 0, stars: 0 },
    sun: { color: '#8c9cd8', intensity: 0.55, dir: [-0.35, 0.85, 0.4], shadow: true, radius: 3, frustum: [-16, 16, 12, -10] },
    fill: { color: '#34406e', intensity: 0.35, dir: [0.6, 0.3, 0.7] },
    hemi: { sky: '#303a64', ground: '#140f0c', intensity: 0.42 },
    rim: { color: '#8ea8ff', intensity: 2.4, dir: [0.3, 0.45, -1] },
    fog: { color: '#0c1020', near: 22, far: 190, height: { density: 0.05, base: -1.3, falloff: 0.35, start: 16, max: 0.75, color: '#161c30' },
      depthGrade: { start: 10, end: 90, dim: 0.3, desat: 0.3, tint: '#1c2238' } },
    env: { intensity: 0.4 },
    exposure: 1.15,
    grade: { saturation: 1.08, contrast: 1.14, vibrance: 0.1, lift: [0.0, 0.004, 0.018], shadowTint: [0.38, 0.44, 0.66], highlightTint: [0.66, 0.54, 0.4], split: 0.3 },
    bloom: { intensity: 1.0, threshold: 1.0, smoothing: 0.3, radius: 0.7 },
    vignette: { offset: 0.28, darkness: 0.55 },
    character: { rim: '#b4c6ff', intensity: 0.5, power: 3.0, floor: 0.05, base: 0.0, edge: 2.8, width: 2.5, maxNdv: 0.6,
      key: { color: '#e4e8ff', intensity: 2.7, wrap: 0.35, dir: [-0.7, 0.55, 0.45] }, ambient: '#8a90c0', ambientIntensity: 0.42 },
    wind: { dir: [-1, 0.1], strength: 1.3, gust: 1 },
  },
  async build(ctx) {
    const { game, group } = ctx;
    const q = ctx.quality || {};
    const low = q.name === 'low';
    const cam = game.cameraRig;
    if (cam && cam.setFraming) cam.setFraming(FRAMING);

    const kit = await loadKit(game);
    const ground = buildGround(ctx);
    const castle = await buildCastle(ctx, kit, { low });
    const storm = createStorm(ctx, { low });
    const rain = createRain(ctx, { low });
    const bursts = createBursts(group);
    const sp = createSetPieces(ctx, { castle, storm, bursts });
    const ring = createRingOuts(game, {
      splash: (x, y, z, k) => bursts.splash(x, y, z, k),
      shake: (t) => cam && cam.shake && cam.shake(t),
      bridgeDown: sp.bridgeDown,
    });
    // two real flicker lights for the ACTORS, re-seated on the torches nearest the camera focus
    const lights = [0, 1].map(() => { const l = new THREE.PointLight('#ff9448', 0, 9, 2); group.add(l); return l; });

    // wave hooks (screen, wave) → set-piece beats
    const scope = game.bus.scope();
    const propLight = lightBreakables(game);
    scope.on(EV.WAVE_START, (ev) => {
      if (!ev) return;
      if (ev.screen === 2 && ev.wave === 1) game.after(10, () => sp.burstDoor(0));
      if (ev.screen === 2 && ev.wave === 0) game.after(150, () => sp.awakenGargoyle());
      if (ev.screen === 4 && ev.wave === 1) game.after(10, () => sp.burstDoor(1));
    });
    scope.on(EV.HIT, (ev) => { const tg = ev && ev.target; if (tg && tg.pos && (ev.killed || (ev.level === 'heavy'))) bursts.dust(tg.pos.x, 0.05, tg.pos.z, 3, 0.5, [0.1, 0.11, 0.14]); });

    const focus = new THREE.Vector3();
    const update = (dt, t) => {
      const f = cam && cam.focus ? cam.focus : { x: 0, z: 0 };
      focus.set(f.x, 0, f.z || 0);
      updateTorches(castle.torches, t, f.x);
      // nearest two torches → the actor lights
      let a = null, b = null, da = 1e9, db = 1e9;
      for (const T of castle.torches) { const d = Math.abs(T.x - f.x) + Math.abs(T.z) * 0.3; if (d < da) { b = a; db = da; a = T; da = d; } else if (d < db) { b = T; db = d; } }
      [a, b].forEach((T, i) => { const l = lights[i]; if (!T) { l.intensity = 0; return; } l.position.set(T.x, T.y, T.z + 0.6); l.intensity = 9 * (0.85 + 0.15 * Math.sin(t * 11 + i * 2.1)); });
      storm.update(dt, t);
      rain.update(dt, focus);
      castle.update(dt, t);
      sp.update(dt, t);
      ring.update(dt);
      bursts.update(dt);
    };
    update(0, 0);
    const env = {
      update, kit, castle, storm, rain, sp, ring, ground,
      groundAt: (x, z) => {
        if (x > STAIRS.x0 && x < STAIRS.x1 && z < STAIRS.z0) {
          const k = (STAIRS.z0 - z) / (STAIRS.z0 - STAIRS.z1);
          return Math.min(STAIRS.rise, Math.ceil(Math.max(0, k) * STAIRS.steps) * (STAIRS.rise / STAIRS.steps));
        }
        return 0;
      },
      dispose() {
        if (cam && cam.resetFraming) cam.resetFraming();
        scope.dispose(); propLight.dispose(); ring.dispose(); sp.dispose(); storm.dispose();
        if (active === env) active = null;
      },
    };
    active = env;
    if (typeof window !== 'undefined' && window.__KCA && window.__KCA.register) try { window.__KCA.register('stage4', env); } catch (e) { /* optional */ }
    return env;
  },
  // ENCOUNTER SCRIPT (chapter1-integration, wave C). Causeway over the moat (ring-outs off the berm) -> the
  // drawbridge / portcullis gate sequence (foes pour out of the gatehouse) -> the courtyard: a Cinderwyrm raider
  // (beast encounter), an Ogre Brute and knights bursting from the doors -> the boulder stair -> the inner gate,
  // where Iron Chancellor Varkhul waits until his lieutenants fall (bossHook).
  props: [
    { prop: 'barrel', x: 10.5, z: -1.8, loot: 'pot' }, { prop: 'crate', x: 44.0, z: -2.1, loot: ['pot', 'food'] },
    { prop: 'urn', x: 57.0, z: 2.0, loot: 'food' }, { prop: 'barrel', x: 84.0, z: 2.0, loot: ['pot', 'pot'] },
  ],
  // Encounter tuning (chapter1-integration): enemy damage × this on top of the difficulty option (arcade curve:
  // later stages field tougher tiers, so the multiplier falls as base damage rises). See src/game/Settings.js.
  tuning: { enemyDamage: 0.38, bossDamage: 0.75, soloBossHp: 0.85 },
  screens: [
    { x: [-3, 17],
      waves: [
        { delay: 40, spawns: [{ type: 'marauder', side: 'right', z: 0.8, tier: 'violet' }, { type: 'marauder', side: 'right', z: -1.4, tier: 'rust', delay: 30 }, { type: 'thief', side: 'left', z: 1.6, tier: 'blue', delay: 90 }, { type: 'marauder', side: 'left', z: -0.4, tier: 'rust', delay: 110, coop: true }] },
        { spawns: [{ type: 'skeleton', side: 'right', z: -0.6, tier: 'white' }, { type: 'viper', side: 'right', z: 1.0, tier: 'crimson', delay: 30 }, { type: 'marauder', side: 'left', z: 1.2, tier: 'iron', delay: 60, coop: true }, { pickup: 'pot', x: 8, z: -1.8, delay: 20 }] },
      ] },
    { x: [17, 37],
      onEnter() { if (active) active.sp.gateSequence(); },
      waves: [
        { delay: 360, spawns: [gate('marauder', { tier: 'iron', dx: -1 }), gate('marauder', { tier: 'rust', dx: 1, delay: 25 }), gate('skeleton', { delay: 70, coop: true }), gate('marauder', { tier: 'violet', delay: 100, coop: true })] },
        { spawns: [gate('knight', { tier: 'silver' }), { type: 'marauder', side: 'left', z: 1.5, tier: 'violet', delay: 40 }, gate('skeleton', { tier: 'purple', delay: 90, coop: true })] },
      ] },
    { x: [COURT_X, 62],
      waves: [
        // BEAST ENCOUNTER: a Cinderwyrm raider (one fireball in flight at a time) charges across the courtyard
        { delay: 40, spawns: [{ mount: 'cinderwyrm', side: 'right', z: 0.4, opts: { rider: 'viper', riderOpts: { tier: 'crimson' } } }, { type: 'marauder', side: 'right', z: -1.5, tier: 'iron', delay: 30 }, { type: 'thief', side: 'left', z: 1.4, tier: 'green', delay: 80 }] },
        { spawns: [door(0, 'knight', { tier: 'silver' }), door(0, 'marauder', { tier: 'violet', delay: 30, dx: 1 }), door(0, 'skeleton', { tier: 'purple', delay: 60, dx: -1, coop: true }), { pickup: 'food', x: 50, z: 1.8, delay: 30 }] },
        // mini-boss: an Ogre Brute shoulders through the courtyard door
        { spawns: [door(0, 'ogre', { tier: 'green' }), { type: 'marauder', side: 'left', z: 1.2, tier: 'rust', delay: 60, coop: true }, { type: 'marauder', side: 'right', z: -1.0, tier: 'iron', delay: 90, coop: true }] },
      ] },
    { x: [62, 80],
      onEnter() { if (active) active.sp.startBoulders(true); },
      onClear() { if (active) active.sp.startBoulders(false); },
      waves: [
        { delay: 60, spawns: [upper('marauder', { tier: 'rust' }), { type: 'marauder', side: 'right', z: 1.4, tier: 'iron', delay: 40 }, upper('skeleton', { delay: 120, coop: true }), { pickup: 'food', x: 70, z: 1.6, delay: 60 }] },
        { spawns: [upper('knight', { tier: 'red' }), { type: 'viper', side: 'left', z: -1, tier: 'crimson', delay: 50 }, upper('marauder', { tier: 'violet', delay: 110, coop: true }), upper('skeleton', { tier: 'purple', delay: 140, coop: true })] },
      ] },
    { x: [80, 99],
      waves: [
        { delay: 40, spawns: [{ type: 'knight', side: 'right', z: 0.6, tier: 'red' }, { type: 'skeleton', side: 'left', z: -1.4, tier: 'purple', delay: 40, coop: true }, { type: 'thief', side: 'left', z: 1.8, tier: 'blue', delay: 70 }, { pickup: 'food', x: 84, z: 1.6, delay: 30 }] },
        { spawns: [door(1, 'knight', { tier: 'gold', elite: 1 }), door(1, 'marauder', { tier: 'iron', delay: 40, dx: 1 }), { type: 'viper', side: 'right', z: 1.2, tier: 'dusk', delay: 70 }, { pickup: 'pot', x: 86, z: -1.6, delay: 20 }] },
      ],
      bossHook: { id: 'iron_chancellor_varkhul', name: 'Iron Chancellor Varkhul', arena: { x: [80, 99], gateX: INNER_X },
        note: 'Boss arena: the inner portcullis (env.castle.portInner) rises and Varkhul strides out from the inner gate; call env.sp.openInner() + a storm.strike() on BOSS_INTRO.' } },
  ],
  next: 'bonus',
};
