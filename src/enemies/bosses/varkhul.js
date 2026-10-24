// Boss registry entry: Iron Chancellor Varkhul (stage 4 inner gate). Actor + moves: types/boss_varkhul.js,
// script: ./_varkhul.js, brain: src/ai/bosses/varkhul.js. Showcase: /?mode=showcase&what=boss&id=varkhul[&scene=fight]
import { spawnEnemy } from '../spawnEnemy.js';

export default {
  id: 'varkhul',
  name: 'Iron Chancellor Varkhul',
  title: 'Warden of the Serpent Keep',
  stage: 'stage4',
  arenaX: 88,
  type: 'boss_varkhul',
  async create(game, opts = {}) {
    return spawnEnemy(game, 'boss_varkhul', { x: opts.x ?? 0, z: opts.z ?? 0, facing: opts.facing ?? -1, ...opts });
  },
};
