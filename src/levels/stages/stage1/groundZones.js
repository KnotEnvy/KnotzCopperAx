// Unique stage-space earth field, shared by the soil and low verge dressing.
// No repeated stamps: metre-scale soil islands cross the lane and dissolve at edges.
import { fbm2, smooth } from './geo.js';

export function groundZones(x, z) {
  const n = fbm2(x * .45, z * .72, 131, 3);
  const broad = fbm2(x * .19 + n * .75, z * .32, 93, 3);
  const edge = 2.8 + Math.sin(x * .39) * .48 + (n - .5) * 1.8;
  const verge = smooth(edge, edge + 1.15, z);
  const clump = smooth(.39, .62, n) * verge;
  const drift = Math.exp(-Math.pow((z - edge - .48 - Math.sin(x * .71) * .35) / .72, 2));
  const ash = Math.min(1, drift * (.35 + .65 * n)
    + smooth(.53, .70, fbm2(x * .51 + n, z * .67, 39, 3)) * .82);
  const char = smooth(.45, .64, broad) * (.55 + .45 * smooth(-.8, 3.4, z));
  // R packs dry-earth versus trampled mud, not a broad constant lane stripe.
  const track = smooth(.33, .65, fbm2(x * .37, z * .48 + n * .6, 83, 3));
  return { clump, ash, char, track };
}
