// Thieves' Night — the camp between stages 1–4 (DESIGN §6, §7, §10; Golden Axe night bonus).
// A firelit clearing under the stars ringed by black pines: tents, bedrolls, a stash of pots, beasts tethered at the
// edge. The heroes sleep; blue thieves creep in and steal pots from their stock; the heroes wake and kick them to win
// the pots back plus extras before they escape (timed); green thieves bring meat; CAMP TALLY → stage clear.
// The last camp (before the throne) is a quiet rationing beat. Env: ./bonus/env.js + geo.js; script: ./bonus/camp.js.
//   /?mode=stage&stage=bonus&p1=brann&p2=gorrim&bot=1[&camp=1..4][&quiet=1][&pots=N]
import { buildCampEnv, CAMP } from './bonus/env.js';
import { createCamp, isQuietCamp } from './bonus/camp.js';

// r5: closer on the clearing (thieves ~15–20% of frame height; camera pinned on the fire by camp.js CAMP_VIEW)
const FRAMING = { fov: 32, distance: 10.6, height: 3.6, lookHeight: 0.95, lead: 0 };

/** Tethered beasts at the clearing edge (real mount actors pinned to their posts; not rideable, not hittable). */
async function tetherBeasts(game) {
  if (!game.mounts || !game.mounts.spawn) return [];
  const out = [];
  const defs = [['cluckhorn', CAMP.posts[0], -1], ['cluckhorn', CAMP.posts[1], 1]];
  for (const [id, p, facing] of defs) {
    try {
      const m = await game.mounts.spawn(id, { x: p.x + facing * -0.9, z: p.z + 0.35, facing });
      if (!m) continue;
      m.boundsMode = 'none'; m.hurtable = false; m.solid = false; m.tethered = true; m.campNoRide = true;
      m.pos.z = p.z + 0.35; if (m.prevPos) m.prevPos.copy(m.pos);
      const up = m.update.bind(m);
      const home = { x: m.pos.x, z: m.pos.z };
      m.update = (dt) => {
        if (m.wander) { m.wander.t = 999; m.wander.idle = true; m.wander.x = home.x; m.wander.z = home.z; }
        m.leaveTimer = -1;
        up(dt);
        // the tether: never more than a step from the post
        m.pos.x += (home.x - m.pos.x) * 0.2; m.pos.z = home.z; m.vel.set(0, m.vel.y, 0);
        if (m.setFacing) m.setFacing(facing);
      };
      out.push(m);
    } catch (e) { console.warn('[bonus] beast', e); }
  }
  return out;
}

export default {
  id: 'bonus',
  number: 0,
  name: "Thieves' Night",
  subtitle: 'BONUS',
  zBand: [-2.2, 2.2],
  // wider than the camera lock (±7.5) so fleeing thieves can actually leave the screen
  extents: [-16, 16],
  playerStart: { x: -1.5, z: 0 },
  music: 'camp',
  lighting: {
    base: 'camp-night',
    sky: { zenith: '#02030a', top: '#0a1128', horizon: '#1e2848', horizonSun: '#34406a', bottom: '#040406', sunDir: [0.38, 0.42, -1], sunColor: '#90a8e0',
      sunDisc: '#e8eeff', sunDiscIntensity: 3.2, sunSize: 0.028, sunGlow: 0.35, hazeHeight: 0.4, stars: 1 },
    sun: { color: '#7c94d8', intensity: 0.42, dir: [-0.35, 0.8, -0.45], shadow: true, radius: 3, frustum: [-14, 14, 10, -10] },
    fill: { color: '#1e2850', intensity: 0.22, dir: [0.6, 0.3, 0.7] },
    hemi: { sky: '#1c2648', ground: '#0e0a06', intensity: 0.16 },
    rim: { color: '#8aa4ff', intensity: 1.4, dir: [0.25, 0.45, -1] },
    fog: { color: '#070a16', near: 16, far: 70, height: { density: 0.04, base: 0, falloff: 0.5, start: 12, max: 0.55, color: '#0e1428' },
      depthGrade: { start: 8, end: 40, dim: 0.5, desat: 0.4, tint: '#101a3a' } },
    env: { intensity: 0.12 },
    exposure: 1.08,
    grade: { saturation: 1.05, contrast: 1.14, vibrance: 0.08, lift: [0.0, 0.004, 0.016], shadowTint: [0.34, 0.42, 0.74], highlightTint: [0.66, 0.5, 0.34], split: 0.38 },
    bloom: { intensity: 1.0, threshold: 1.0, smoothing: 0.35, radius: 0.72 },
    vignette: { offset: 0.3, darkness: 0.62 },
    // fire-lit faces: a warm low key from the fire side + cool moon rim from behind
    character: { rim: '#a8bcff', intensity: 0.5, power: 3.0, floor: 0.04, base: 0.0, edge: 2.8, width: 2.6, maxNdv: 0.6,
      key: { color: '#ffb070', intensity: 1.9, wrap: 0.4, dir: [0.0, 0.35, 0.94], albedoFloor: 0.25, albedoLiftMax: 3, specMax: 1.6 },
      ambient: '#6a78b0', ambientIntensity: 0.4, clamp: { knee: 0.65, max: 1.0 } },
    wind: { dir: [1, 0.1], strength: 0.25, gust: 0.3 },
  },
  /** perf-1650: called by assets/prewarm.js prefetchStage() while the tally is up — the thief assets load before the
   *  curtain drops. (The procedural ground textures are synchronous ~0.8 s of canvas work: they stay in build(),
   *  behind the curtain, instead of freezing the tally animation.) */
  async prefetch(game) {
    try { const E = await import('../../enemies/spawnEnemy.js'); if (E.preloadEnemy) await E.preloadEnemy(game, 'thief'); } catch (e) { /* optional */ }
  },
  async build(ctx) {
    const { game } = ctx;
    const cam = game.cameraRig;
    if (cam && cam.setFraming) cam.setFraming(FRAMING);
    const quiet = isQuietCamp(game);
    const env = buildCampEnv(ctx, { quiet });
    if (quiet) env.setFire(0.75);
    // warm the thief assets so the sneak-in spawns are instant (and deterministic under the capture clock)
    try {
      const E = await import('../../enemies/spawnEnemy.js');
      await E.preloadEnemy(game, 'thief');
      if (game.assets && game.assets.gltf) await Promise.all(['enemy_thief', 'enemy_thief_green'].map((id) => game.assets.gltf(id).catch(() => null)));
    } catch (e) { console.warn('[bonus] thief preload', e); }
    // beasts are cleared by MountSystem on STAGE_START, so tether them right after it
    const beasts = [];
    const noBeasts = ctx.params && ctx.params.get && ctx.params.get('beasts') === '0';
    const bscope = game.bus.scope();
    if (!noBeasts) bscope.on('stageStart', () => { const p = tetherBeasts(game).then((b) => beasts.push(...b)); if (game.track) game.track(p); });
    const camp = ctx.params && (ctx.params.get ? ctx.params.get('camp') === 'off' : false) ? null : createCamp(game, env);
    const out = {
      update(dt, t) { env.update(dt, t); if (camp) camp.update(dt); },
      camp, env, beasts, anchors: CAMP,
      groundAt: () => 0,
      dispose() { bscope.dispose(); if (cam && cam.resetFraming) cam.resetFraming(); if (camp) camp.dispose(); env.dispose(); },
    };
    if (typeof window !== 'undefined' && window.__KCA && window.__KCA.register) try { window.__KCA.register('camp', out); } catch (e) { /* optional */ }
    return out;
  },
  screens: [],
  // no autoClear: the camp script clears the stage itself after the tally (camp.js finish())
  next: 'next',
};
