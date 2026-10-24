// Alias: vfx.spawn('fx_smoke', opts) = fx_prims type 'smoke' (options documented in fx_prims.js).
import { spawnPrim } from './fx_prims.js';

export default { id: 'fx_smoke', spawn: (vfx, o = {}) => spawnPrim(vfx, 'smoke', o) };
