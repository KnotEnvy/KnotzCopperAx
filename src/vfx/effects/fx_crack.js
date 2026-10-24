// Alias: vfx.spawn('fx_crack', opts) = fx_prims type 'crack' (options documented in fx_prims.js).
import { spawnPrim } from './fx_prims.js';

export default { id: 'fx_crack', spawn: (vfx, o = {}) => spawnPrim(vfx, 'crack', o) };
