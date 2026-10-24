// Alias: vfx.spawn('fx_shockwave', opts) = fx_prims type 'shockwave' (options documented in fx_prims.js).
import { spawnPrim } from './fx_prims.js';

export default { id: 'fx_shockwave', spawn: (vfx, o = {}) => spawnPrim(vfx, 'shockwave', o) };
