// Combat event points can describe an attack overlap/midpoint. VFX must land on the hurt body.
export function bodyContact(o) {
  const t = o.target, p = o.point || { x: 0, y: 1, z: 0 };
  if (!t?.hurtboxes || o.kind === 'throw' || o.moveId === 'throw_impact') return p;
  let best = p, distance = Infinity;
  for (const b of t.hurtboxes()) {
    // Keep the core just inside the struck surface, rather than on the attack-side edge.
    const inset = (b.maxX - b.minX) * .22;
    const q = { x: Math.max(b.minX + inset, Math.min(b.maxX - inset, p.x)),
      y: Math.max(b.minY + (b.maxY - b.minY) * .32, Math.min(b.maxY - (b.maxY - b.minY) * .18, p.y)),
      z: Math.max(b.minZ, Math.min(b.maxZ, p.z)) };
    const d = (q.x-p.x)**2 + (q.y-p.y)**2 + (q.z-p.z)**2;
    if (d < distance) { distance = d; best = q; }
  }
  return best;
}

// Move along the view ray: draws over the body without moving the flash in screen space.
export function frontContact(p, camera, amount = .65) {
  if (!camera) return p;
  const dx = camera.position.x-p.x, dy = camera.position.y-p.y, dz = camera.position.z-p.z;
  const k = amount / Math.max(1, Math.hypot(dx,dy,dz));
  return { x:p.x+dx*k, y:p.y+dy*k, z:p.z+dz*k };
}
