// Alias: vfx.spawn('fx_slash', opts) = fx_prims type 'slash' (options documented in fx_prims.js).
import { spawnPrim } from './fx_prims.js';

export default { id: 'fx_slash', spawn: (vfx, o = {}) => spawnPrim(vfx, 'slash', o) };
