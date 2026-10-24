// Alias: vfx.spawn('fx_embers', opts) = fx_prims type 'embers' (options documented in fx_prims.js).
import { spawnPrim } from './fx_prims.js';

export default { id: 'fx_embers', spawn: (vfx, o = {}) => spawnPrim(vfx, 'embers', o) };
