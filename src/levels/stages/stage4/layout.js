// Stage 4 layout constants (world metres; +X = progress, +Z = camera side, belt ground y = 0).
//   x < COURT_X : the moat causeway (stone berm z BERM_Z0..BERM_Z1, moat in front and behind; the back moat widens
//                 into a broad water court at x < WIDE_X, the keep standing across it)
//   GATE_X      : the outer gatehouse (drawbridge lowers from its sill onto the berm, portcullis rises)
//   COURT_X     : the gate passage pier passes the camera; beyond it the torch-lit courtyard (flagstones z -7..7)
//   STAIRS      : the grand stair to the upper ward (boulders roll down it toward the camera)
//   INNER_X     : the inner gate (boss arena)
export const WATER_Y = -1.3;
export const BERM_Z0 = -3.4, BERM_Z1 = 3.4;
export const WALL_Z = -7.0;             // front face of the back walls
export const WIDE_X = 14;               // back moat is wide (keep across the water) for x < WIDE_X
export const FAR_WALL_Z = -88;           // the keep's curtain across the water court
export const GATE_X = 28;
export const COURT_X = 40;
export const STAIRS = { x0: 63, x1: 77, z0: -7, z1: -19, rise: 5.0, steps: 20 };
export const INNER_X = 89;
export const END_X = 99;

/** Is (x, z) over open water? (ring-outs, splashes) */
export function overWater(x, z) {
  if (x >= COURT_X - 1.5) return false;
  if (z > BERM_Z1) return true;
  if (z < BERM_Z0) return x < WIDE_X ? z > FAR_WALL_Z : z > WALL_Z;
  return false;
}
