// Cluckhorn TAIL WHIP VFX (mounts agent; ENGINE_API §8). The swoosh ribbon itself is a vfx.trails ribbon driven by
// src/mounts/types/cluckhorn.js (a hidden bar on the tail club = the "weapon"); this file adds the accents.
//   vfx.spawn('mount_whip', { type: 'sweep', pos, vel, gy })  one tick of the club sweeping: air-streak lines off the
//        spiked club along its path, spark flecks, and dust kicked up when it skims the ground.
//   (no type) = hit spark route (`hit.spark: 'mount_whip'`): hit_spark(heavy) + a big comic club-impact burst,
//        a flattened shock ring + dust at the victim's feet, chips and speed lines.
import { impactBurst, starBurst, speedLines, dustRing, dustPuffs, debris, sparkSpray, cnt } from './_lib.js';

function sweep(vfx, o) {
  const r = vfx.rng, p = o.pos, v = o.vel || { x: 0, y: 0, z: 0 }, gy = o.gy ?? 0;
  const sp = Math.hypot(v.x, v.y, v.z);
  if (sp < 2) return;
  const dx = v.x / sp, dy = v.y / sp, dz = v.z / sp;
  // Air streaks: thin pale lines trailing the club (read as speed, not as a second ribbon).
  for (let i = 0, N = cnt(vfx, 2); i < N; i++) {
    const off = r.range(-0.25, 0.25), len = Math.min(1.4, sp * 0.07) * r.range(0.7, 1.1);
    vfx.shape.emit({ shape: 'line', mode: 'axial', pos: [p.x - dx * len * 0.6, p.y + off, p.z - dz * len * 0.6 + off * 0.5], dir: [dx, dy, dz], size: [len, 0.05],
      grow: [1, 0.4], growY: [1, 0.4], life: r.range(0.1, 0.16), color: ['#fff6e6', '#d8b080'], intensity: 0.9, p0: [0.5, 0.6, 1, 0] });
  }
  if (r.range(0, 1) < 0.35) sparkSpray(vfx, p, { x: dx, y: 0.2, z: dz }, { n: 2, speed: [3, 6], cone: 0.5, color: ['#fff0d0', '#ffa040'], intensity: 2.6, floor: gy });
  if (p.y - gy < 0.75 && (vfx.game.tick & 1) === 0)
    dustPuffs(vfx, p.x, gy, p.z, { n: 3, spread: 0.2, speed: [1.5, 3.5], up: [0.3, 1.0], size: [0.25, 0.8], dir: dx, alpha: 0.5 });
}

function hit(vfx, o) {
  vfx.spawn('hit_spark', { ...o, level: o.level || 'heavy', type: undefined });
  const p = o.point || (o.target && o.target.pos) || { x: 0, y: 1, z: 0 }, t = o.target, dir = o.dir >= 0 ? 1 : -1;
  const gy = t ? vfx.groundY(t.pos) : 0;
  impactBurst(vfx, p, { size: 2.4, spikes: 8, valley: 0.36, color: ['#fff2d8', '#e08a30'], intensity: 1.4, life: 0.2, hold: (o.hitstop || 0) / 60, stretch: 1.25 });
  starBurst(vfx, p, { size: 1.4, rays: 6, color: ['#fffaf0', '#ffc070'], intensity: 1.6, life: 0.12, hold: (o.hitstop || 0) / 60 });
  speedLines(vfx, p, { n: 10, r0: 0.5, r1: 1.7, length: 0.7, width: 0.05, color: ['#fff8ec', '#e0b070'], intensity: 1.2, life: 0.2 });
  if (t) {
    dustRing(vfx, t.pos.x, gy, t.pos.z, { radius: 1.1, alpha: 0.6, life: 0.7, stretchX: 1.4 });
    dustPuffs(vfx, t.pos.x, gy, t.pos.z, { n: 6, spread: 0.3, speed: [1.5, 4], size: [0.3, 1.0], dir });
    debris(vfx, t.pos.x, gy, t.pos.z, { n: 6, speed: [2, 4.5], up: [2.5, 5], dir: { x: dir, y: 0, z: 0 }, spread: 1.2 });
  }
}

export default {
  id: 'mount_whip',
  spawn(vfx, o = {}) { return o.type === 'sweep' ? sweep(vfx, o) : hit(vfx, o); },
};
