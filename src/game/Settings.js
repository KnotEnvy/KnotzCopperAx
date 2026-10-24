// Settings: player options persisted in localStorage (wrapped; falls back to defaults) and applied to services.
//   settings.get() → { master, music, sfx (0..10), difficulty: easy|normal|hard, quality: high|low }
//   settings.set(patch, game) persists + applies        settings.apply(game) at boot
const KEY = 'kca.settings.v1';
export const DEFAULTS = { master: 8, music: 6, sfx: 9, difficulty: 'normal', quality: 'high' };
export const DIFFICULTY = {
  // enemies/players = team damage scale; attackers = how many enemies may commit to one hero at once (attack tokens,
  // DESIGN §4); hold = ticks a token is held before it must be passed on (longer = more sustained pressure).
  easy: { enemies: 0.7, players: 1.15, attackers: 1, hold: 110, label: 'Squire' },
  normal: { enemies: 1, players: 1, attackers: 2, hold: 150, label: 'Warrior' },
  hard: { enemies: 1.35, players: 0.9, attackers: 3, hold: 190, label: 'Legend' },
};
let cur = null;

export function get() {
  if (cur) return cur;
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { s = null; }
  cur = { ...DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
  return cur;
}

export function set(patch, game) {
  cur = { ...get(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* ignore */ }
  if (game) apply(game);
  return cur;
}

export function apply(game) {
  const s = get();
  const a = game.audio;
  if (a && a.volume) {
    a.volume.master = s.master / 10 * 0.9; a.volume.music = s.music / 10; a.volume.sfx = s.sfx / 10;
    try {
      if (a.buses) for (const b of ['master', 'music', 'sfx']) if (a.buses[b]) a.buses[b].gain.value = a.volume[b];
    } catch { /* not unlocked yet: values are picked up on unlock */ }
  }
  const pd = game.params && (typeof game.params.get === 'function' ? game.params.get('difficulty', null) : game.params.difficulty);
  const d = DIFFICULTY[pd] ? pd : s.difficulty;
  const D = DIFFICULTY[d] || DIFFICULTY.normal;
  // Enemy damage = difficulty × stage tuning (stage.tuning.enemyDamage) × mercy (falls with each hero KO this stage).
  if (game.combat && game.combat.damageScale) { game.combat.damageScale.enemies = D.enemies * (game.stageDamageMul ?? 1) * (game.mercyMul ?? 1); game.combat.damageScale.players = D.players; }
  // AI aggression: retune the live attack-token director so the option changes enemy pressure immediately.
  const tk = game.ai && game.ai.tokens;
  if (tk && typeof tk.maxPerTarget === 'number') { tk.maxPerTarget = D.attackers; tk.holdTicks = D.hold; }
  if (game.ai) game.ai.difficulty = d;
}

// ------------------------------------------------------------------ stage tuning + mercy
// Arcade "rank" in reverse: every hero KO in a stage eases enemy damage by MERCY_STEP (floor MERCY_FLOOR), so a
// struggling player gets a fair second wind while a player who never dies faces the authored curve. Resets per stage.
export const MERCY_STEP = 0.8, MERCY_FLOOR = 0.45;
let mercyInstalled = false;
/** Call at stage start with the stage module: sets the stage multiplier, resets mercy and re-applies. */
export function applyStageTuning(game, mod) {
  game.stageDamageMul = (mod && mod.tuning && mod.tuning.enemyDamage) || 1;
  game.mercyMul = 1;
  if (!mercyInstalled && game.bus) {
    mercyInstalled = true;
    game.bus.on('playerDown', () => { game.mercyMul = Math.max(MERCY_FLOOR, (game.mercyMul ?? 1) * MERCY_STEP); apply(game); });
  }
  apply(game);
}
