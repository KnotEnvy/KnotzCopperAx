// Alias: vfx.spawn('fx_rock_burst', opts) = fx_prims type 'rock_burst' (options documented in fx_prims.js).
import { spawnPrim } from './fx_prims.js';

export default { id: 'fx_rock_burst', spawn: (vfx, o = {}) => spawnPrim(vfx, 'rock_burst', o) };
