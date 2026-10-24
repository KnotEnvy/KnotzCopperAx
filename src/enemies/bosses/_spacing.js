// Boss arena spacing (C1 r9, extended r10 to every boss). Called every tick by Boss.update (Varkhul, Morvane) once the
// intro is over, and by a per-encounter system from groupBoss (Brute Brothers, Hollow Knight Captains, Wyrm Rider).
// Board r8 (Muse): "t30 reads as a downed-hero pile — both heroes flat on his feet amid 4 skeletons". Board r9 (Fable):
// the gold captain's boot stood on downed Brann; Varkhul's flail swung over both heroes stacked under him.
//   - summoned minions are eased off lying heroes, off the boss's feet and off each other;
//   - boss bodies (when not mid-swing) are eased off lying heroes;
//   - r10: KNOCKED-DOWN heroes (knockdown / down / get-up — not grabbed, not dead) slide out from under any boss body or
//     beast, and apart along screen-x from each other — so a boss mid-attack never stands on a hero and two downed
//     heroes never stack into one pile.
// ≤ 0.05 m/tick (0.07 split between a downed hero pair) — a slide, never a pop. &spacing=0 disables it (A/B).
const DOWN = ['down', 'knockdown', 'getup', 'dead'];
function pushOff(a, ox, oz, rx, rz, band, step = 0.04) {
  const dx = a.pos.x - ox, dz = a.pos.z - oz, e = Math.hypot(dx / rx, dz / rz);
  if (e >= 1) return 0;
  const d = Math.hypot(dx, dz);
  const nx = d > 1e-3 ? dx / d : (a.facing ? -a.facing : 1), nz = d > 1e-3 ? dz / d : 0;
  const s = Math.min(step, (1 - e) * rx * 0.3);
  a.pos.x += nx * s;
  if (band) a.pos.z = Math.max(band.zMin + 0.2, Math.min(band.zMax - 0.2, a.pos.z + nz * s * 0.7));
  return s;
}
const NO_SPACING = typeof location !== 'undefined' && /[?&]spacing=0/.test(location.search);   // A/B only
const bodyCentre = (h) => ({ x: h.pos.x - (h.facing || 1) * (h.height || 1.9) * 0.2, z: h.pos.z });   // centre of a lying body
const live = (a) => a && a.alive && !a.removed;

/** Shared pass. `bodies` = boss actors (moved only when idle/walk/block/pause), `minions` = summons (always steerable). */
export function arenaSpacing(game, bodies, minions = []) {
  if (NO_SPACING || !game || !game.world) return 0;
  const band = game.world.band;
  const heroes = game.world.query({ kind: 'hero' }).filter((h) => h && !h.removed && h.fsm);
  const lyingH = heroes.filter((h) => h.fsm.is(...DOWN));
  const lying = lyingH.map(bodyCentre);
  const B = bodies.filter(live);
  const mins = minions.filter((m) => live(m) && m.grounded !== false);
  let moved = 0;
  for (const m of mins) {
    for (const L of lying) moved += pushOff(m, L.x, L.z, 1.6, 0.8, band, 0.05);
    for (const b of B) moved += pushOff(m, b.pos.x, b.pos.z, 1.35, 0.65, band);
    for (const o of mins) if (o !== m) moved += pushOff(m, o.pos.x, o.pos.z, 0.95, 0.45, band, 0.025);
  }
  for (const b of B) {
    if (b.mountedOn || b.attack || !b.grounded || !b.fsm || !b.fsm.is('idle', 'walk', 'block', 'pause')) continue;
    for (const L of lying) moved += pushOff(b, L.x, L.z, 1.8, 0.8, band, 0.05);
  }
  // r10: the downed hero slides clear of the feet (bodies mid-swing can't be moved without breaking their attack).
  // Only a grounded, lying hero (not airborne mid-knockdown, not getting up — the get-up has i-frames and a pose).
  const feet = [];
  for (const b of B) {
    const k = Math.max(1, Math.min(1.45, (b.height || 2.6) / 2.6));
    feet.push({ x: b.pos.x, z: b.pos.z, rx: 1.35 * k, rz: 0.62 * k });
  }
  // beasts (the Wyrm Rider's cinderwyrm, ridden or riderless) are big bodies too
  if (game.mounts && game.mounts.list) for (const mt of game.mounts.list()) if (mt && mt.pos && !mt.removed) feet.push({ x: mt.pos.x, z: mt.pos.z, rx: 2.0, rz: 0.75 });
  const lock = game.cameraRig && game.cameraRig.lock;
  const clampX = (x) => (lock ? Math.max(lock.xMin + 0.6, Math.min(lock.xMax - 0.6, x)) : x);
  // knocked-down heroes from knockdown flight through the get-up (both heroes are usually floored by the SAME blow, so
  // they land, lie and rise together); never a grabbed or dead one.
  const slidable = lyingH.filter((h) => h.fsm.is('down', 'knockdown', 'getup') && !h.grabbedBy && h.alive !== false);
  for (const h of slidable) {
    const c = bodyCentre(h), ox = h.pos.x - c.x;
    const tmp = { pos: { x: c.x, z: c.z }, facing: h.facing };
    let s = 0;
    for (const f of feet) s += pushOff(tmp, f.x, f.z, f.rx, f.rz, band, 0.05);
    if (s) { h.pos.x = clampX(tmp.pos.x + ox); h.pos.z = tmp.pos.z; moved += s; }
  }
  // two downed heroes: the side camera sees lying bodies end-on along x, so a depth gap reads as one pile — separate
  // them along SCREEN x (≥ 1.45 m between body centres unless 0.9 m apart in depth). The one farther from the nearest
  // boss body takes most of the slide; the other always gives way a little (edges can pin the far one).
  for (let i = 0; i < slidable.length; i++) for (let j = i + 1; j < slidable.length; j++) {
    const A = slidable[i], Bh = slidable[j], ca = bodyCentre(A), cb = bodyCentre(Bh);
    const dx = cb.x - ca.x, adx = Math.abs(dx);
    if (adx >= 1.45 || Math.abs(cb.z - ca.z) >= 0.9) continue;
    const mx = (ca.x + cb.x) / 2;
    let bx = mx, bd = Infinity; for (const f of feet) { const d = Math.abs(f.x - mx) + Math.abs(f.z - (ca.z + cb.z) / 2); if (d < bd) { bd = d; bx = f.x; } }
    const far = Math.abs(cb.x - bx) >= Math.abs(ca.x - bx) ? Bh : A, near = far === Bh ? A : Bh;
    const dir = Math.sign(far.pos.x - near.pos.x) || Math.sign(far.pos.x - bx) || 1;
    // split: the far one takes 60 %, the near one 40 % (the stage/screen edge can clamp the far one back after us —
    // r10 dom_s4 caught pairs parked 0.7 m apart against the right edge — so the near one always gives way too)
    const step = Math.min(0.07, 0.015 + (1.45 - adx) * 0.3);
    far.pos.x = clampX(far.pos.x + dir * step * 0.6);
    near.pos.x = clampX(near.pos.x - dir * step * 0.4);
    moved += step;
  }
  return moved;
}

export function bossSpacing(b) {
  if (NO_SPACING || !live(b)) return;
  const moved = arenaSpacing(b.game, [b], b.minions ? [...b.minions] : []);
  if (moved) { const S = b._spacing || (b._spacing = { pushes: 0, m: 0 }); S.pushes++; S.m += moved; }   // QA
}
