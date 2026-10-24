// Boss registry entry: Morvane Deathcoil, the Adder King (stage 5 final boss). Actor + moves: types/boss_morvane.js,
// script: ./_morvane.js, brain: src/ai/bosses/morvane.js. Showcase: /?mode=showcase&what=boss&id=morvane[&phase=2][&scene=fight]
import { spawnEnemy } from '../spawnEnemy.js';

export default {
  id: 'morvane',
  name: 'Morvane Deathcoil',
  title: 'The Adder King',
  stage: 'stage5',
  arenaX: 52,
  type: 'boss_morvane',
  async create(game, opts = {}) {
    return spawnEnemy(game, 'boss_morvane', { x: opts.x ?? 0, z: opts.z ?? 0, facing: opts.facing ?? -1, ...opts });
  },
};
