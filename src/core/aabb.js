// Axis-aligned boxes on the belt plane (x = scroll, y = height, z = depth). Plain objects, no allocation churn.
// A box is { minX, maxX, minY, maxY, minZ, maxZ }.

export const makeBox = () => ({ minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });

/** Fill `out` from a center-bottom anchored box: x/z center, y bottom, size w (x), h (y), d (z). */
export function boxFrom(out, cx, by, cz, w, h, d) {
  out.minX = cx - w / 2; out.maxX = cx + w / 2;
  out.minY = by; out.maxY = by + h;
  out.minZ = cz - d / 2; out.maxZ = cz + d / 2;
  return out;
}

export const overlaps = (a, b) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY && a.minZ <= b.maxZ && a.maxZ >= b.minZ;

/** Center of the overlap region (contact point for sparks). */
export function overlapCenter(a, b, out = { x: 0, y: 0, z: 0 }) {
  out.x = (Math.max(a.minX, b.minX) + Math.min(a.maxX, b.maxX)) / 2;
  out.y = (Math.max(a.minY, b.minY) + Math.min(a.maxY, b.maxY)) / 2;
  out.z = (Math.max(a.minZ, b.minZ) + Math.min(a.maxZ, b.maxZ)) / 2;
  return out;
}
