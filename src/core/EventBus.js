// Typed-by-convention event bus. Listener exceptions are caught and reported so a broken VFX/audio
// listener can never break combat. Every event type used in the game is documented in EV below;
// add new ones here (additive edit) or namespace your own ('mounts:rider_off').
import { reportError } from './log.js';

/**
 * Event catalogue. Payload shapes (all fields optional unless noted):
 * - hit          { attacker, target, hit (hit-window data), damage, point:{x,y,z}, dir:±1, killed, blocked, level:'light'|'heavy'|'magic', comboCount }
 * - whiff        { actor, move }                                   attack window ended with no target
 * - attackStart  { actor, move, moveId }                           move began (anticipation)
 * - attackActive { actor, move, moveId, hit, index }              first tick of an active hit window (swing SFX/trails)
 * - ko           { actor, by }                                     actor HP reached 0
 * - knockdown    { actor, by }  · getup { actor } · land { actor, pos, speed } · jump { actor } · footstep { actor, foot, pos }
 * - dodge        { actor, perfect, by? }                           perfect = an attack whiffed inside the dodge's first frames
 * - magicSelect  { hero, tier, pots }                              Magic held: tier cursor changed (HUD tier boxes)
 * - charge       { actor, level, moveId }                          Heavy held: charge level 1..3 reached (flash); level 0 = released uncharged
 * - grab         { actor, victim, moveId }                         thrower seized a foe (close string → throw)
 * - throw        { actor, victim, dir, moveId }                    victim released (flies along dir; damages its own team on contact)
 * - spawn        { actor } · despawn { actor }
 * - magicCast    { hero, tier, spell } · magicEnd { hero, tier } · magicImpact { hero, tier, point }
 * - potPickup    { hero, kind:'pot'|'food', amount } · pickupSpawn { pickup }
 * - screenLock   { index, xMin, xMax } · screenClear { index } · go { index, dir } · waveStart { screen, wave }
 * - stageStart   { stageId } · stageClear { stageId }
 * - playerJoin   { player } · playerDown { player, hero } · playerOut { player } · gameOver {}
 * - continueStart { player, seconds } · continueTick { player, seconds } · continueTaken { player } (CONTINUE? 9…0)
 * - respawn      { player, hero }
 * - bossPhase    { boss, phase } · bossIntro { boss }
 * - combo        { player, count, rank, multiplier } · comboEnd { player, count }
 * - score        { player, points, total, reason }
 * - flowState    { from, to, data }
 * - camera       { kind:'shake'|'punch'|'drama', ... }
 * - mount / dismount { rider, mount }
 */
export const EV = Object.freeze({
  HIT: 'hit', WHIFF: 'whiff', ATTACK_START: 'attackStart', ATTACK_ACTIVE: 'attackActive', KO: 'ko',
  KNOCKDOWN: 'knockdown', GETUP: 'getup', LAND: 'land', JUMP: 'jump', FOOTSTEP: 'footstep', DODGE: 'dodge',
  SPAWN: 'spawn', DESPAWN: 'despawn', MAGIC_CAST: 'magicCast', MAGIC_END: 'magicEnd', MAGIC_IMPACT: 'magicImpact',
  POT_PICKUP: 'potPickup', PICKUP_SPAWN: 'pickupSpawn', SCREEN_LOCK: 'screenLock', SCREEN_CLEAR: 'screenClear',
  GO: 'go', WAVE_START: 'waveStart', STAGE_START: 'stageStart', STAGE_CLEAR: 'stageClear', PLAYER_JOIN: 'playerJoin',
  PLAYER_DOWN: 'playerDown', PLAYER_OUT: 'playerOut', GAME_OVER: 'gameOver', BOSS_PHASE: 'bossPhase', BOSS_INTRO: 'bossIntro',
  COMBO: 'combo', COMBO_END: 'comboEnd', SCORE: 'score', FLOW_STATE: 'flowState', CAMERA: 'camera', MOUNT: 'mount', DISMOUNT: 'dismount',
  MAGIC_SELECT: 'magicSelect', CHARGE: 'charge', GRAB: 'grab', THROW: 'throw', CONTINUE_START: 'continueStart', CONTINUE_TICK: 'continueTick', CONTINUE_TAKEN: 'continueTaken', RESPAWN: 'respawn',
});

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.map = new Map();
    /** Ring buffer of recent events (type + tick) for test scenarios: __KCA.events(). */
    this.recent = [];
    this.tickRef = () => 0;
    this.record = true;
  }

  /** Subscribe. Returns an unsubscribe function. Use type '*' to receive (type, payload) for everything. */
  on(type, fn) {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  once(type, fn) {
    const off = this.on(type, (p) => { off(); fn(p); });
    return off;
  }

  off(type, fn) { const s = this.map.get(type); if (s) s.delete(fn); }

  emit(type, payload = {}) {
    if (this.record) {
      this.recent.push({ type, tick: this.tickRef(), summary: summarize(payload) });
      if (this.recent.length > 1500) this.recent.shift();
    }
    const set = this.map.get(type);
    if (set) for (const fn of [...set]) {
      try { fn(payload); } catch (e) { reportError(`bus:${type}`, e); }
    }
    const all = this.map.get('*');
    if (all) for (const fn of [...all]) {
      try { fn(type, payload); } catch (e) { reportError('bus:*', e); }
    }
  }

  /** Remove every listener (tests only; prefer scope().dispose()). */
  clear() { this.map.clear(); }

  /**
   * Scoped subscriptions: const scope = bus.scope(); scope.on(...); ...; scope.dispose();
   * Stage/showcase code should use scopes so listeners die with the stage.
   */
  scope() {
    const offs = [];
    return {
      on: (t, fn) => { const off = this.on(t, fn); offs.push(off); return off; },
      dispose: () => { for (const o of offs.splice(0)) o(); },
    };
  }
}

// Keep the recorded summaries serializable (actors are replaced by `type#id`).
function summarize(p) {
  if (!p || typeof p !== 'object') return p;
  const o = {};
  for (const k in p) {
    const v = p[k];
    if (v && typeof v === 'object' && 'id' in v && 'kind' in v) o[k] = `${v.kind}:${v.typeId || ''}#${v.id}`;
    else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') o[k] = v;
  }
  return o;
}
