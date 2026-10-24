// One authored field drives soil pigment, grass clumps and fallen straw placement.
// Zones cross the foreground in ragged islands, leaving the playable centre clear.
import { fbm2, smooth } from './geo.js';

export function groundZones(x, z) {
  const n = fbm2(x * .45, z * .72, 131, 3);
  const edge = 3.1 + Math.sin(x * .39) * .36 + (n - .5) * 1.1;
  const verge = smooth(edge, edge + 1.2, z);
  const clump = smooth(.43, .64, n) * verge;
  const drift = Math.exp(-Math.pow((z - edge - .48 - Math.sin(x * .71) * .35) / .62, 2));
  const laneDrift = Math.exp(-Math.pow((z - 1.8*Math.sin(x*.19) - .4) / .48, 2))
    * smooth(.51,.69,fbm2(x*.32,z*.5,83,2)) * .5;
  const ash = Math.min(1, drift * (.45 + .55 * fbm2(x * .23, z * 1.3, 39, 2)) + laneDrift);
  const char = smooth(.48, .68, fbm2(x * .31, z * .57, 93, 2)) * smooth(1.8, 3.4, z);
  return { clump, ash, char, track: 1 - smooth(edge - .65, edge + .2, z) };
}
