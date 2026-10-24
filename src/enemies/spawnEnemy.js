// Enemy factory. Resolves a type from the registry (src/enemies/types/<id>.js), builds its model (GLB or
// placeholder), attaches its behaviour (src/ai/behaviours/<id>.js) and adds it to the world.
//
//   const e = await spawnEnemy(game, 'marauder', { x, z, facing, tier: 'rust', enterFrom: { x, z } });
//
// Type module contract (default export):
//   { id, name, hp, speed, height, hurtHeight? (standing hurtbox top, gameplay only; default 0.95 × height), radius,
//     weight, asset?, proportions?, palette?, style?, weapon?,
//     behaviour: 'grunt' | null, ai: {...behaviour params}, moves: { id: MoveDef }, score: { hit, ko },
//     tiers?: { rust: { hp, palette, speed, ai } }, create?(game, opts, ctx) → Actor (fully custom types),
//     preload?(game) }
import { registries } from '../core/registries.js';
import { Enemy } from './Enemy.js';
import { reportError } from '../core/log.js';

export async function preloadEnemy(game, id) {
  const def = await registries.enemies.load(id);
  if (!def) return null;
  if (def.preload) await def.preload(game);
  if (def.behaviour) await registries.behaviours.load(def.behaviour);
  await warmAssets(game, def, id);
  return def;
}

/** r8: fetch + parse the GLBs (body + weapon) of every tier the loaded stage script spawns for this type, so the
 *  first wave spawn is a cache hit instead of a mid-fight GLB parse. Best effort: never blocks longer than 30 s. */
async function warmAssets(game, def, id) {
  const A = game.assets, stage = game.levels && game.levels.stage;
  if (!A || !A.gltf || A.forcePlaceholder || !stage || def.create) return;
  const tiers = new Set();
  for (const s of stage.screens || []) for (const w of s.waves || []) for (const sp of w.spawns || []) if (sp.type === id) tiers.add(sp.tier || '');
  const ids = new Set();
  const add = (d) => {
    const a = d.asset || `enemy_${id}`;
    ids.add(a);
    const m = A.manifest && A.manifest[a];
    if (m && m.weapon) ids.add(m.weapon);
  };
  for (const t of tiers) add(t && def.tiers && def.tiers[t] ? { ...def, ...def.tiers[t] } : def);
  const cap = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 30000))]).catch(() => null);
  await Promise.all([...ids].map((a) => cap(A.gltf(a))));
}

export async function spawnEnemy(game, id, opts = {}) {
  const base = await registries.enemies.load(id);
  if (!base) return null;
  const tier = opts.tier && base.tiers ? base.tiers[opts.tier] : null;
  const def = tier ? { ...base, ...tier, palette: { ...(base.palette || {}), ...(tier.palette || {}) }, ai: { ...(base.ai || {}), ...(tier.ai || {}) } } : base;
  let actor = null;
  try {
    if (def.create) actor = await def.create(game, opts, { Enemy, def });
    else {
      const model = await game.assets.character({ ...def, asset: def.asset || `enemy_${def.id}` });
      actor = new Enemy(game, def, model, opts);
    }
  } catch (e) { reportError(`enemy:${id}.create`, e); return null; }
  if (!actor) return null;
  // Co-op scaling: +60% HP per extra hero for spawns without an explicit hp (stage waves), so a 2-player crowd
  // lives long enough to push back. def.coopHp overrides the factor (0 = none, bosses set their own).
  const heroes = game.world.query({ kind: 'hero' }).length;
  const coop = def.coopHp ?? (actor.kind === 'boss' ? 0 : 0.6);
  if (opts.hp === undefined && heroes > 1 && coop > 0) { actor.maxHp = Math.round(actor.maxHp * (1 + coop * (heroes - 1))); actor.hp = actor.maxHp; }
  if (def.behaviour && !actor.brain) {
    const beh = await registries.behaviours.load(def.behaviour);
    if (beh) { try { actor.brain = beh.create(actor, game, def.ai || {}); } catch (e) { reportError(`behaviour:${def.behaviour}`, e); } }
  }
  if (opts.add !== false) game.world.add(actor);
  return actor;
}
