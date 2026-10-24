// Boss hook runner (bosses agent). LevelDirector asks resolveHook() when a screen's waves are exhausted; a boss
// screen then gets one extra "boss wave" spawned by spawnBossWave() (the screen clears when every boss actor, its
// minions and the finale token are gone — so the stage never clears before the finale has played).
//   Hook source: screens[i].bossHook = { id, arena?: { x: [x0, x1] }, x?, z?, ... } (stage agents), else the LAST
//   screen of a stage in DEFAULT_BOSS. URL: &boss=0 disables boss waves (stage-art captures), &boss=<id> overrides.
// Boss modules (src/enemies/bosses/<id>.js) may export encounter(game, { x, z, hook, inStage }) → { actors, lead,
// tokens?, begin() }; otherwise create(game, opts) → Actor is used (then beginIntro() if present).
import { registries } from '../../core/registries.js';
import { reportError } from '../../core/log.js';
import { bossCam } from './_camera.js';

export const DEFAULT_BOSS = { stage1: 'brute_brothers', stage2: 'captains', stage3: 'wyrm_rider', stage4: 'varkhul', stage5: 'morvane' };
export const ALIAS = {
  iron_chancellor_varkhul: 'varkhul', varkhul: 'varkhul', hollow_knight_captains: 'captains', captains: 'captains',
  wyrm_riders: 'wyrm_rider', wyrm_rider: 'wyrm_rider', brute_brothers: 'brute_brothers', morvane: 'morvane',
  morvane_deathcoil: 'morvane', adder_king: 'morvane',
};

const param = (game, k) => (game.params && game.params.get ? game.params.get(k) : null);

export function resolveHook(game, stage, i) {
  if (!stage || !stage.screens) return null;
  const off = param(game, 'boss');
  if (off === '0' || off === 'false') return null;
  const s = stage.screens[i];
  let hook = s && s.bossHook ? { ...s.bossHook } : null;
  if (!hook && i === stage.screens.length - 1 && DEFAULT_BOSS[stage.id]) hook = { id: DEFAULT_BOSS[stage.id] };
  if (!hook) return null;
  if (off && off !== '1' && off !== 'true') hook.id = off;
  hook.id = ALIAS[hook.id] || hook.id;
  if (!registries.bosses.has(hook.id)) return null;
  hook.screen = s;
  return hook;
}

export async function spawnBossWave(game, director, hook) {
  try {
    const mod = await registries.bosses.load(hook.id);
    if (!mod) return null;
    const s = hook.screen || {};
    const ax = (hook.arena && hook.arena.x) || s.x || [0, 20];
    const vis = game.cameraRig && game.cameraRig.visibleRange ? game.cameraRig.visibleRange(0) : { xMin: ax[0], xMax: ax[1] };
    const x = hook.x ?? Math.min(ax[1] - 3.5, vis.xMax - 3.2);
    const z = hook.z ?? -0.4;
    const ctx = { x, z, hook, inStage: true, facing: -1 };
    if (mod.encounter) {
      const enc = await mod.encounter(game, ctx);
      for (const a of enc.actors || []) { a.inStage = true; director.waveActors.add(a); if (a.token) director.waveActors.add(a.token); }
      for (const t of enc.tokens || []) director.waveActors.add(t);
      if (enc.begin) enc.begin();
      startCam(game, enc.lead || (enc.actors || [])[0], ax, enc.group ? () => enc.group.members : null, enc.camera);
      return enc;
    }
    const b = await mod.create(game, ctx);
    if (!b) return null;
    b.inStage = true;
    director.waveActors.add(b);
    if (b.token) director.waveActors.add(b.token);
    if (b.beginIntro) b.beginIntro();
    startCam(game, b, ax, null, b.def && b.def.camera);
    return b;
  } catch (e) { reportError(`boss:${hook && hook.id}.spawn`, e); return null; }
}

function startCam(game, lead, arena, members, opts = null) {
  if (!lead || param(game, 'bosscam') === '0') return;
  try { if (game._bossCam) game._bossCam.stop(); bossCam(game, { ...(opts || {}), lead, arena, members }); } catch (e) { reportError('boss.camera', e); }
}
