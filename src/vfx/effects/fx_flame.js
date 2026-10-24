// Alias: vfx.spawn('fx_flame', opts) = fx_prims type 'flame' (options documented in fx_prims.js).
import { spawnPrim } from './fx_prims.js';

export default { id: 'fx_flame', spawn: (vfx, o = {}) => spawnPrim(vfx, 'flame', o) };
