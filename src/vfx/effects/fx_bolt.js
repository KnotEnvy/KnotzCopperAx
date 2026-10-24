// Alias: vfx.spawn('fx_bolt', opts) = fx_prims type 'bolt' (options documented in fx_prims.js).
import { spawnPrim } from './fx_prims.js';

export default { id: 'fx_bolt', spawn: (vfx, o = {}) => spawnPrim(vfx, 'bolt', o) };
