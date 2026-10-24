// Hero factory: loads def + moveset + model (GLB or placeholder) and creates a Hero actor (not yet added).
//   const hero = await createHero(game, 'brann', { x, z, playerIndex: 0 });  game.world.add(hero);
import { registries } from '../core/registries.js';
import { Hero } from './Hero.js';
import { reportError } from '../core/log.js';

export async function loadHeroDef(id) {
  let def = await registries.heroes.load(id);
  if (!def) { reportError('hero', new Error(`unknown hero '${id}', falling back to brann`)); def = await registries.heroes.load('brann'); }
  return def;
}

export async function createHero(game, id, opts = {}) {
  const def = await loadHeroDef(id);
  const [moveset, model] = await Promise.all([
    registries.movesets.load(def.moveset || def.id),
    game.assets.character(def),
  ]);
  const HeroClass = def.heroClass || Hero;
  return new HeroClass(game, def, model, moveset, opts);
}
