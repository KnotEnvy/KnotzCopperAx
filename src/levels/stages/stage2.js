// Stage 2 — Shellback Crossing (DESIGN.md §6, §10): the fight belt runs along the flank of Old Shellfather, a colossal
// ancient tortoise wading a misty lake with a village on his shell. Pale morning mist, cool jade/teal water and moss,
// warm paper lanterns. Environment helpers live in ./stage2/** (shell deck + scute material, lake + spray + splashes,
// stilt village, far shores + sea stacks + fog banks, the Blender head/neck/leg, water ring-outs).
//
// Living platform: the camera rides the shell, so the WORLD beyond it (lake, shores, fog) rolls/pitches/heaves slowly
// against it; lanterns swing, spray surges over the lip when the shell dips, downed foes slide toward the water.
// Set pieces: marked water ring-out zones on the near lip (screens 2, 3, 4); entering screen 3 the shell's crest has
// dropped enough to reveal the tortoise's head — a drama camera turns toward it while he lifts it from the mist.
// Hooks for later waves: screens[i].graveRise = [{ x, z }] (skeleton rise points), screens[3].bossHook.
import * as THREE from 'three';
import { charUniforms } from '../../render/characterLook.js';
import { createShafts } from '../../render/shafts.js';
import { createAmbient } from '../../render/particles.js';
import { createGrass, grassPushers } from '../../render/foliage.js';
import { buildShell, shellH, crestH, scuteEdge } from './stage2/shell.js';
import { buildWater, buildSpray, buildSplashes } from './stage2/water.js';
import { buildVillage, HUTS } from './stage2/village.js';
import { buildDistant } from './stage2/distant.js';
import { buildTortoise } from './stage2/tortoise.js';
import { buildHerd } from './stage2/herd.js';
import { createRingOuts } from './stage2/ringout.js';
import { buildCrows } from './stage1/crows.js';
import { rngFrom, fbm2, smooth } from './stage1/geo.js';
const smooth01 = smooth;
import { rimZ, WATER_Y } from './stage2/shell.js';

// r4: a flatter camera so the sky strip above the lake horizon can hold the tortoise's head
const FRAMING = { height: 4.1, lookHeight: 1.5, distance: 15 };
export const RING_ZONES = [{ x0: 22, x1: 29 }, { x0: 44.5, x1: 48.5 }, { x0: 56, x1: 63 }];
const SWAY = { tilt: 0.9, roll: 0.6, heave: 0.32 };   // degrees, degrees, metres

let active = null;   // current env (screen hooks reach the tortoise through it)

export default {
  id: 'stage2',
  number: 2,
  name: 'Shellback Crossing',
  subtitle: 'STAGE 2',
  zBand: [-2.4, 2.1],
  extents: [-3, 74],
  playerStart: { x: 3, z: 0 },
  lighting: {
    base: 'misty-lake',
    sky: { zenith: '#4a6a84', top: '#8aa4b4', horizon: '#bfd3d2', horizonSun: '#b9c7bd', bottom: '#45676d', sunDir: [-0.42, 0.16, -1], sunColor: '#ffe0b4',
      sunDisc: '#fff4dc', sunDiscIntensity: 1.8, sunSize: 0.02, sunGlow: 0.35, hazeHeight: 0.55,
      clouds: { cover: 0.45, color: '#8e9ea8', lit: '#fff0dc', scale: 1, speed: 0.002, opacity: 0.7, band: [0.02, 0.08, 0.36, 0.78], stretch: [0.3, 1] } },
    sun: { color: '#ffeedc', intensity: 2.3, dir: [-0.55, 0.62, 0.55], shadow: true, radius: 4, frustum: [-18, 18, 15, -11] },
    fill: { color: '#7ab0c0', intensity: 0.45, dir: [0.7, 0.3, 0.6] },
    hemi: { sky: '#a4bcc4', ground: '#2e3a30', intensity: 0.55 },
    rim: { color: '#ffe4bc', intensity: 1.2, dir: [-0.35, 0.3, -1] },
    fog: { color: '#88a8ad', near: 22, far: 330,
      height: { density: 0.028, base: -1, falloff: 0.3, start: 26, max: 0.62, color: '#9fbabc' },
      sun: { color: '#ffe8c4', strength: 0.2, power: 10 },
      depthGrade: { start: 22, end: 70, dim: 0.24, desat: 0.17, tint: '#6e8c8c' } },
    env: { intensity: 0.3 },
    exposure: 1.0,
    grade: { saturation: 1.08, contrast: 1.18, vibrance: 0.12, lift: [0.0, 0.006, 0.01], gamma: [1, 1, 1.01], gain: [1.0, 1.0, 0.99],
      shadowTint: [0.26, 0.48, 0.55], highlightTint: [0.6, 0.54, 0.44], split: 0.3 },
    bloom: { intensity: 0.3, threshold: 1.7, smoothing: 0.2, radius: 0.5 },
    vignette: { offset: 0.28, darkness: 0.5 },
    // C1 actor exposure: the same restrained, forward key as stage 1 preserves
    // authored skin/cloth/iron values; the lake sun stays on the environment.
    character: { rim: '#ffe8c8', intensity: 0.16, power: 3.0, floor: 0.06, base: 0.0, edge: 1.45, width: 1.8, maxNdv: 0.6,
      key: { color: '#fff3e8', intensity: 1.2, wrap: 0.12, dir: [0.78, 0.52, 0.36], albedoFloor: 0, albedoLiftMax: 1, metalAmbient: 0.6 },
      ambient: '#a6bec6', ambientIntensity: 0.12, clamp: { knee: 0.65, max: 1.0 } },
    wind: { dir: [-1, 0.2], strength: 0.55, gust: 0.8 },
  },
  async build(ctx) {
    const { game, group } = ctx;
    const q = ctx.quality || {};
    const low = q.name === 'low';
    const rng = rngFrom(2024);
    if (game.cameraRig && game.cameraRig.setFraming) game.cameraRig.setFraming(FRAMING);

    // ---- the swaying world (everything NOT on the shell)
    const PIVOT = new THREE.Vector3(24, -1, -16);
    const world = new THREE.Group(); world.name = 'stage2World'; world.position.copy(PIVOT);
    const worldInner = new THREE.Group(); worldInner.position.copy(PIVOT).negate();
    world.add(worldInner); group.add(world);

    buildShell(ctx);
    const water = buildWater(ctx);
    worldInner.add(water.mesh);
    buildDistant(ctx, worldInner);
    const herd = buildHerd(ctx, worldInner);

    const splashes = buildSplashes();
    group.add(splashes.object);
    const splash = (x, y, z, p) => splashes.burst(x, y, z, p, () => game.fxRng ? game.fxRng.next() : Math.random());

    const lightSpots = [];
    const village = buildVillage(ctx, { ringZones: RING_ZONES, lightSpots });

    // spray along the lip (denser + bigger over the ring-out zones) and around the leg/neck
    const em = [];
    for (let x = -14; x < 76; x += 1.9) {
      const inZ = RING_ZONES.some((z) => x > z.x0 - 1 && x < z.x1 + 1);
      em.push([x, WATER_Y + 0.05, rimZ(x) + 0.15, 0, 1]);
      if (inZ) em.push([x + 0.9, WATER_Y + 0.1, rimZ(x) + 0.05, 0.3, 1.2]);
    }
    const spray = buildSpray(ctx, em);
    group.add(spray.object);

    // ---- the tortoise (hero asset); optional so the stage still builds if the GLB is missing
    let tortoise = null;
    try { tortoise = await buildTortoise(ctx, { splash }); } catch (e) { console.warn('[stage2] tortoise', e); }

    // ---- moss / fern tufts ONLY in the plate seams: along the far edge of the crest and down the costal slope
    const nearHut = (x, z, r) => HUTS.some((h) => Math.hypot(h.x - x, h.z - z) < r);
    const seamDensity = (x, z) => {
      if (nearHut(x, z, 2.6) || shellH(x, z) < WATER_Y + 0.25) return 0;
      const e = scuteEdge(x, z);
      return e < 0.17 ? 0.8 * smooth01(0.3, 0.55, fbm2(x * 0.2, z * 0.2, 31, 3)) : 0;
    };
    group.add(createGrass(rng, { x0: -18, x1: 90, z0: -6.5, z1: -2.7, density: low ? 1.0 : 1.6, densityFn: seamDensity, y: shellH, quality: q, height: [0.15, 0.35],
      base: '#10180f', tip: '#5e8a40', dry: '#8a8a5a', tints: ['#ffffff', '#e0ecd8', '#c8dcc0', '#d8d8b0'], receiveShadow: true }));

    // ---- light shafts through the morning mist (sun low behind-left)
    const shafts = [];
    for (let x = -24; x < 110; x += 8 + rng.next() * 7) shafts.push({ pos: [x, 16 + rng.next() * 6, -30 - rng.next() * 18], length: 26 + rng.next() * 10, width: 2 + rng.next() * 3, intensity: 0.5 + rng.next() * 0.5, seed: rng.next() });
    const sh = createShafts(shafts, { dir: [0.42, -0.55, 0.72], color: '#c8d4bf', intensity: 0.22, quality: q });
    if (sh) { sh.name = 'mistShafts'; worldInner.add(sh); }

    // ---- motes + drifting mist droplets around the camera
    const motes = createAmbient({ kind: 'dust', count: low ? 160 : 320, box: [34, 8, 16], offset: [2, 0.4, -3], quality: q, color: '#d8e0d4', color2: '#8a9a94', size: 0.045, intensity: 0.55, velocity: [-0.25, 0.05, 0.0] });
    group.add(motes.object);

    // ---- birds: herons/cormorants gliding over the lake, a few perched on hut ridges
    const perches = HUTS.slice(0, 6).map((h, i) => [h.x + 0.6, shellH(h.x, h.z) + 6.6 + (i % 2) * 0.3, h.z, rng.next() * 6]);
    buildCrows(ctx, [
      { x: 30, y: 16, z: -60, r: 9, n: 5, speed: 0.2 },
      { x: -10, y: 11, z: -45, r: 6, n: 3, speed: -0.24 },
      { x: 70, y: 20, z: -80, r: 11, n: 6, speed: 0.17 },
    ], perches);

    // ---- pooled warm lantern lights (≤ 2) following the camera focus
    const lights = [new THREE.PointLight('#ffa050', 0, 9, 2), new THREE.PointLight('#ff9040', 0, 8, 2)];
    for (const l of lights) group.add(l);

    const ring = createRingOuts(game, { zones: RING_ZONES, splash, shake: (t) => game.cameraRig && game.cameraRig.shake && game.cameraRig.shake(t) });

    let lt = 0;
    const _v = new THREE.Vector3();
    const eu = new THREE.Euler();
    const update = (dt, t) => {
      lt += dt;
      const cam = game.cameraRig;
      const fxX = cam ? cam.focus.x : 0;
      // sway: the world tilts (tortoise pitching → horizon tilt), rolls (→ horizon bob) and heaves against the shell
      const tilt = (SWAY.tilt * Math.sin(lt * 0.66) + 0.22 * Math.sin(lt * 1.19 + 1)) * Math.PI / 180;
      const rollPh = Math.sin(lt * 0.48 + 0.7);
      const roll = SWAY.roll * rollPh * Math.PI / 180;
      eu.set(roll, 0, tilt); world.quaternion.setFromEuler(eu);
      world.position.y = PIVOT.y + SWAY.heave * Math.sin(lt * 0.88);
      const dip = Math.max(0, rollPh);
      spray.uniforms.uSurge.value = dip;
      water.uniforms.kWaRimF.value.z = dip;   // env-r33: rim foam surges where the shell dips into the swell
      village.swing(lt, -roll * 3 - tilt);
      if (tortoise) {
        tortoise.update(dt, lt, tilt, fxX, cam && cam.camera);
        // foam where the neck leaves the lake + churn around the raking fore leg
        const nb = tortoise.bones.neck_2;
        if (nb) { nb.getWorldPosition(_v); water.uniforms.kWaObs.value[0].set(_v.x, _v.z, 3.5, 0.5); }
        const L = tortoise.leg;
        if (L) { const near = Math.max(0, 1 - Math.abs(L.foot.y - WATER_Y) / 2.5); water.uniforms.kWaObs.value[1].set(L.foot.x, L.foot.z, 1.2 + 1.8 * near, near > 0.05 ? 0.4 + 1.2 * near : 0); }
      }
      splashes.update(dt);
      herd.update(lt);
      ring.update(dt, dip);
      // lights
      const sorted = lightSpots.slice().sort((a, b) => Math.abs(a.x - fxX) - Math.abs(b.x - fxX));
      lights.forEach((l, i) => {
        const s = sorted[i]; if (!s) { l.intensity = 0; return; }
        if (l.position.distanceToSquared(s) > 4) l.position.copy(s); else l.position.lerp(s, 0.2);
        l.intensity = (i === 0 ? 9 : 7) * (0.92 + 0.08 * Math.sin(lt * 7.1 + i * 2));
      });
      if (cam && cam.camera) motes.update(cam.camera, cam.focus, game.renderer ? game.renderer.height : 900);
      // grass pushers (dome tufts rarely meet actors, but keep it consistent with stage 1)
      for (const v of grassPushers.value) v.set(0, 0, 0, 0);
    };
    update(0, 0);
    // Existing actor-only scene grade (before key/rim/emissive): retain a little
    // lake bounce without washing out every tier. No light, material or program
    // changes. Install only after the build succeeds; restore on stage unload so
    // persistent heroes and later stages recover their normal scene lighting.
    const previousSceneGrade = charUniforms.kSceneGrade.value.clone();
    charUniforms.kSceneGrade.value.set(0.15, 0.15, 0.15, 0);
    const env = {
      update,
      tortoise, ring, village, water,
      groundAt: (x, z) => shellH(x, z),
      crestAt: crestH,
      dispose() {
        charUniforms.kSceneGrade.value.copy(previousSceneGrade);
        if (game.cameraRig && game.cameraRig.resetFraming) game.cameraRig.resetFraming();
        ring.dispose();
        if (active === env) active = null;
      },
    };
    active = env;
    if (typeof window !== 'undefined' && window.__KCA && window.__KCA.register) try { window.__KCA.register('stage2', env); } catch (e) { /* optional */ }
    return env;
  },
  // ENCOUNTER SCRIPT (chapter1-integration, wave C). Skeletons RISE from the shell moss at graveRise points,
  // the first Viper Maiden and Hollow Knight appear, an Emberdrake raider crosses the bridge (beast encounter),
  // foes are pulled along the near lip for water ring-outs, and the Hollow Knight Captains wait for the last
  // screen's grunts to fall (bossHook).
  props: [
    { prop: 'crate', x: 9.5, z: -1.9, loot: 'pot' }, { prop: 'urn', x: 23.5, z: -1.9, loot: 'food' },
    { prop: 'barrel', x: 44.0, z: -2.0, loot: ['pot', 'food'] }, { prop: 'urn', x: 58.5, z: -1.8, loot: 'pot' },
  ],
  // Encounter tuning (chapter1-integration): enemy damage × this on top of the difficulty option (arcade curve:
  // later stages field tougher tiers, so the multiplier falls as base damage rises). See src/game/Settings.js.
  tuning: { enemyDamage: 0.5 },
  screens: [
    { x: [-3, 15],
      waves: [
        { delay: 30, spawns: [{ type: 'marauder', side: 'right', z: 0.8, tier: 'rust' }, { type: 'marauder', side: 'right', z: -1.1, delay: 40 }, { type: 'marauder', side: 'left', z: 1.2, delay: 70, coop: true }] },
        { spawns: [{ type: 'skeleton', tier: 'white', x: 6, z: -1.8, rise: true }, { type: 'skeleton', tier: 'white', x: 11, z: 1.2, rise: true, delay: 40 }, { type: 'thief', side: 'left', z: 1.5, tier: 'blue', delay: 80 }] },
        { spawns: [{ type: 'marauder', side: 'left', z: 1.3, tier: 'rust' }, { type: 'viper', side: 'right', z: -0.5, tier: 'jade', delay: 30 }, { type: 'skeleton', tier: 'white', x: 8, z: 0.4, rise: true, delay: 60, coop: true }] },
      ],
      graveRise: [{ x: 6, z: -1.8 }, { x: 11, z: 1.2 }] },
    { x: [15, 33],
      waves: [
        // lip fight: foes arrive along the near (water) edge — throws and knockbacks ring them out
        { spawns: [{ type: 'marauder', side: 'right', z: 1.9 }, { type: 'marauder', side: 'right', z: 1.4, tier: 'rust', delay: 20 }, { type: 'marauder', side: 'left', z: -0.6, tier: 'rust', delay: 60 }] },
        // BEAST ENCOUNTER: an Emberdrake raider
        { spawns: [{ mount: 'emberdrake', side: 'right', z: 0.3, opts: { rider: 'marauder', riderOpts: { tier: 'violet' } } }, { type: 'skeleton', tier: 'white', x: 20, z: -1.5, rise: true, delay: 50 }, { type: 'skeleton', tier: 'white', x: 26, z: 0.4, rise: true, delay: 80 }, { type: 'thief', side: 'left', z: -1.8, tier: 'green', delay: 110 }] },
        { spawns: [{ type: 'viper', side: 'right', z: 1.6, tier: 'jade' }, { type: 'marauder', side: 'left', z: 1.8, tier: 'violet', delay: 40 }, { type: 'skeleton', tier: 'white', x: 30, z: -2.0, rise: true, delay: 70, coop: true }] },
      ],
      graveRise: [{ x: 20, z: -1.5 }, { x: 26, z: 0.4 }, { x: 30, z: -2.0 }] },
    { x: [33, 52],
      onEnter({ game }) {
        // SET PIECE (stage-2 env): the crest has dropped — Old Shellfather lifts his head out of the mist.
        const cam = game.cameraRig;
        if (active && active.tortoise) active.tortoise.reveal(3.2);
        if (cam && cam.drama) cam.drama({ yaw: -12, distance: 17, height: 3.4, lookHeight: 2.6, fov: 34, in: 1.4, hold: 2.0, out: 1.4, priority: 3 });
        game.bus.emit('stage2:reveal', {});
      },
      waves: [
        { delay: 200, spawns: [{ type: 'marauder', side: 'right', z: 0.4, tier: 'rust' }, { type: 'marauder', side: 'right', z: 1.8, delay: 25 }, { type: 'marauder', side: 'left', z: -1.4, tier: 'violet', delay: 50 }] },
        // first Hollow Knight (guards frontal lights: use heavies, throws, back attacks)
        { spawns: [{ type: 'knight', side: 'right', z: 0.6, tier: 'silver' }, { type: 'skeleton', tier: 'white', x: 37, z: -1.6, rise: true, delay: 40 }, { type: 'skeleton', tier: 'white', x: 42, z: 1.0, rise: true, delay: 70 }, { type: 'thief', side: 'left', z: 1.6, tier: 'blue', delay: 100 }] },
        { spawns: [{ type: 'marauder', side: 'right', z: 1.5, tier: 'violet' }, { type: 'viper', side: 'left', z: 0.2, tier: 'jade', delay: 30 }, { type: 'skeleton', tier: 'white', x: 49, z: -0.8, rise: true, delay: 60, coop: true }] },
      ],
      graveRise: [{ x: 37, z: -1.6 }, { x: 42, z: 1.0 }, { x: 49, z: -0.8 }] },
    { x: [52, 74],
      waves: [
        { spawns: [{ type: 'marauder', side: 'right', z: 1.6, tier: 'violet' }, { type: 'skeleton', tier: 'white', x: 55, z: -1.8, rise: true, delay: 30 }, { type: 'skeleton', tier: 'white', x: 61, z: 1.4, rise: true, delay: 50 }, { type: 'marauder', side: 'left', z: 1.9, tier: 'rust', delay: 60 }] },
        { spawns: [{ type: 'marauder', side: 'right', z: 0.6, tier: 'iron', elite: 1 }, { type: 'viper', side: 'left', z: 1.7, tier: 'jade', delay: 30 }, { type: 'skeleton', tier: 'white', x: 67, z: -0.6, rise: true, delay: 60 }, { type: 'knight', side: 'right', z: -1.4, tier: 'silver', delay: 90, coop: true }] },
      ],
      graveRise: [{ x: 55, z: -1.8 }, { x: 61, z: 1.4 }, { x: 67, z: -0.6 }, { x: 70, z: 1.0 }],
      bossHook: { id: 'hollow_knight_captains', note: 'Hollow Knight Captains (bosses agent) — spawned after the last screen waves.' } },
  ],
  next: 'bonus',
};
