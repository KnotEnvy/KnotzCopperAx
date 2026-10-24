// StageRunner: tear down whatever is running and start a stage with the session's players.
//   await startStage(game, { stage: '1', players: [{ player: 0, heroId: 'brann', bot: true, magic: 0 }], screen: 0 })
//   await spawnPlayerHero(game, { player: 1, heroId: 'gorrim' }, { dropIn: true })   mid-stage join
//   resetStage(game)   clear actors/effects/timers/env but keep services (showcases call this too)
//   snapshotCarry(game) / session.players[i].carry = { pots, hp }: arcade carry-over between stages (DESIGN §7/§10:
//   magic pots and life carry into the next stage and the camp; beasts do not). Flow snapshots at every stage
//   clear; startStage applies it to the new heroes (hp floored at two life bars). Cleared by session.reset/join.
import { createHero, loadHeroDef } from '../characters/spawnHero.js';
import { reportError } from '../core/log.js';
import { prewarmStage, warmCurtain } from '../assets/prewarm.js';
import { applyStageTuning } from './Settings.js';

/** Clear actors, effects, timers and env (keeps services). */
export function resetStage(game) {
  if (game.bots) game.bots.dispose();
  game.world.clear();
  if (game.vfx) game.vfx.clear();
  if (game.ai) game.ai.reset();
  game.clearTimers();
  if (game.ui) { game.ui.clearStage(); game.ui.hideAll(); if (game.ui.hud) game.ui.hud.show(false); }
  if (game.levels) game.levels.dispose();
  if (game.cameraRig) { game.cameraRig.clearDrama(); game.cameraRig.clearLock(); game.cameraRig.manual = false; game.cameraRig.trauma = 0; game.cameraRig.follow([]); }
  game.removeSystem('showcase');
  game.input.releaseAll();
  game.timeScale = 1;
  game.freeze = 0;
}

/** Create a player's hero at the stage start (or next to the camera focus for a drop-in) and wire session/bot/camera. */
export async function spawnPlayerHero(game, p, { x = null, z = null, dropIn = false } = {}) {
  let hx = x, hz = z;
  if (dropIn && game.cameraRig) { hx = game.cameraRig.focus.x - 2; hz = 0; }
  const hero = await createHero(game, p.heroId, { x: hx ?? 0, z: hz ?? 0, playerIndex: p.player, facing: 1 });
  if (p.magic) hero.addPots(p.magic);
  if (dropIn) { hero.pos.y = 5; hero.grounded = false; hero.fsm.go('fall'); hero.invuln = 90; hero.blink = 90; }
  game.world.add(hero);
  if (game.session) {
    const sp = game.session.players[p.player];
    if (!sp.active) game.session.join(p.player, p.heroId, { bot: p.bot });
    sp.actor = hero;
  }
  if (p.bot && game.bots) game.bots.attach(hero, { skill: p.skill ?? 0.85 });
  if (game.cameraRig) game.cameraRig.follow(game.world.query({ kind: 'hero', alive: false }));
  return hero;
}

export const CARRY_MIN_HP = 40; // two and a half life bars: a near-dead clear is not a death sentence in the next stage

/** Record each active session player's pots + hp from its live hero (call when a stage/camp ends). */
export function snapshotCarry(game) {
  const sess = game.session; if (!sess) return;
  for (const p of sess.players) {
    const h = p.actor;
    if (!p.active || !h) continue;
    const dead = !h.alive || h.hp <= 0;
    p.carry = { pots: h.pots | 0, hp: dead ? h.maxHp : Math.round(h.hp), maxHp: h.maxHp };
  }
}

/** Apply a session carry record to a freshly spawned hero. */
export function applyCarry(game, hero, playerIndex) {
  const sp = game.session && game.session.players[playerIndex];
  const c = sp && sp.carry;
  if (!c) return;
  hero.pots = 0; hero.addPots(c.pots || 0);
  if (c.hp != null) hero.hp = Math.max(Math.min(CARRY_MIN_HP, hero.maxHp), Math.min(hero.maxHp, c.hp));
}

/** Title-card wording (UI copy) for stage names that read better with an article. */
const CARD_NAMES = { 'Ashen Wilds': 'The Ashen Wilds' };
/** Arcade stage number (1–5) for an action stage id: camps are interludes and are not numbered (QA r1: counting
 *  camps made Stage 2 read 'STAGE 3' … Stage 5 'STAGE 9'). null for camps/unknown ids. */
export function arcadeStageNumber(game, stageId) {
  const id = String(stageId).replace(/^stage/, '');
  const n = Number(id);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/**
 * perf-1650 r4: free the GPU copy of every cached GLB texture the new stage does not need (heroes of this run stay
 * resident). The asset cache never forgets a GLB and three never forgets an uploaded texture, so without this a 5-stage
 * run held ~1.2 GB of VRAM at stage 5 (fresh page: 0.6 GB) and the 4 GB card overcommitted next to the desktop and any
 * other GPU app → multi-second paging stalls. prewarmStage below re-uploads what the stage draws, behind the curtain.
 * &gpurelease=0 disables (A/B).
 */
export async function releaseAssetGpu(game, players = []) {
  try {
    if (!game.assets || !game.assets.releaseGpu) return null;
    if (game.params && game.params.get && String(game.params.get('gpurelease', '1')) === '0') return null;
    const keep = new Set();
    for (const p of players) {
      try {
        const d = await loadHeroDef(p.heroId);
        const a = d.asset || `char_${d.id}`; keep.add(a);
        const m = (game.assets.manifest && game.assets.manifest[a]) || {};
        if (m.weapon) keep.add(m.weapon);
        if (m.weaponL) keep.add(m.weaponL);
      } catch (e) { /* unknown hero: nothing to keep */ }
    }
    const r = game.assets.releaseGpu({ keep });
    game.lastGpuRelease = r;
    return r;
  } catch (e) { reportError('stage.releaseGpu', e); return null; }
}

export async function startStage(game, { stage = '1', players = [], screen = 0, script = true, card = true, carry = false } = {}) {
  resetStage(game);
  if (script) warmCurtain(game, true); // black until prewarmStage has compiled/uploaded the stage (fades out there)
  await releaseAssetGpu(game, players);
  const mod = await game.levels.load(stage, { script });
  try { applyStageTuning(game, mod); } catch (e) { reportError('stage.tuning', e); }
  const start = mod.playerStart || { x: 2, z: 0 };
  const screens = mod.screens || [];
  const sx = screens[screen] ? screens[screen].x[0] + (start.x - (screens[0] ? screens[0].x[0] : 0)) : start.x;
  const heroes = [];
  for (const p of players) {
    try {
      // two heroes enter side by side and on different depth lanes (a 1.2 / 1.0 offset stacked them into one silhouette)
      const two = players.length > 1, band = game.world.band || { zMin: -3, zMax: 3 };
      const lane = two ? (p.player ? 1.1 : -1.1) : 0;
      const h = await spawnPlayerHero(game, p, { x: sx + (two ? (p.player ? 1.3 : -1.3) : 0), z: Math.max(band.zMin + 0.4, Math.min(band.zMax - 0.4, (start.z || 0) + lane)) });
      if (carry) applyCarry(game, h, p.player);
      heroes.push(h);
    } catch (e) { reportError('stage.hero', e); }
  }
  game.cameraRig.follow(heroes);
  if (screens[screen]) game.cameraRig.setLock(screens[screen].x[0], screens[screen].x[1]);
  game.cameraRig.snap();
  // Props first (they are part of the opening frame), then compile/upload everything the stage will draw behind a
  // black curtain (src/assets/prewarm.js) so the first seconds, first spawns, first spell and the boss never hitch.
  if (script) { try { await game.levels.placeProps(); } catch (e) { reportError('stage.props', e); } }
  const warmNum = arcadeStageNumber(game, stage);
  const warmCard = card && mod.name ? [warmNum != null && mod.subtitle !== 'FINAL STAGE' ? `STAGE ${warmNum}` : (mod.subtitle || ''), CARD_NAMES[mod.name] || mod.name, warmNum, mod.name] : null;
  if (script) { try { await prewarmStage(game, { stage, card: warmCard }); } catch (e) { reportError('stage.prewarm', e); } }
  if (game.ui) {
    game.ui.hud.show(true);
    const num = arcadeStageNumber(game, stage);
    if (game.ui.hud.setStage) game.ui.hud.setStage(num, mod.name || '');
    if (card && mod.name) game.ui.card(num != null && mod.subtitle !== 'FINAL STAGE' ? `STAGE ${num}` : (mod.subtitle || ''), CARD_NAMES[mod.name] || mod.name, 3.2);
  }
  game.levels.start(screen);
  return { stage: mod, heroes };
}
