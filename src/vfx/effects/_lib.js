// Effect building blocks (private helper: files starting with `_` are not registered as effects).
// Every block takes (vfx, o) with plain {x,y,z} positions, scales counts by vfx.scale (quality=low halves them),
// and stays small + shaped: no big soft domes, no point-light pools.
import * as THREE from 'three';

const _d = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
export const cnt = (vfx, n) => Math.max(1, Math.round(n * vfx.scale));
export const arr = (p) => [p.x, p.y, p.z];

/** Tight hot core glow (the "contact point"). size = diameter in metres. */
export function coreGlow(vfx, p, { size = 0.35, color = '#fff4e0', tail = '#ffb060', intensity = 2.2, life = 0.07, hold = 0, core = 0.4 } = {}) {
  vfx.shape.emit({ shape: 'glow', pos: arr(p), size: [size, size], grow: [0.7, 1.15], life, hold, color: [color, tail], intensity, p0: [2.6, core] });
}

/** Angular comic impact burst (straight-edged spikes, hollows out from the centre — no white blob). */
export function impactBurst(vfx, p, { size = 1.6, spikes = 7, valley = 0.42, color = ['#ffc450', '#d8400a'], intensity = 1.5, life = 0.16, hold = 0, rot = null, stretch = 1, occ, hollow = 0 } = {}) {
  vfx.shape.emit({ shape: 'burst', pos: arr(p), size: [size * stretch, size], grow: [0.7, 1.12], ease: 'out', life, hold, rot: rot ?? vfx.rng.range(0, Math.PI),
    color, intensity, alpha: [1, 0], p0: [spikes, valley, 0.12, hollow], p1: [spikes, valley * 0.8, 0.06, 0.88], seed: vfx.rng.range(0, 1), occ });
}

/** Directional spark spray: streaks in a cone around `dir` (unit Vector3-like). */
export function sparkSpray(vfx, p, dir, { n = 10, speed = [6, 12], cone = 0.6, up = 0.25, life = [0.1, 0.24], size = [0.028, 0.012],
  color = ['#fff2c8', '#ff6020'], intensity = 3.5, gravity = 10, drag = 3.5, floor = null, stretch = 0.018 } = {}) {
  const r = vfx.rng;
  _d.set(dir.x, dir.y, dir.z).normalize();
  // two perpendiculars for the cone
  _r.set(-_d.y, _d.x, 0); if (_r.lengthSq() < 1e-4) _r.set(0, 0, 1); _r.normalize();
  _u.crossVectors(_d, _r).normalize();
  for (let i = 0, N = cnt(vfx, n); i < N; i++) {
    const a = r.range(-cone, cone), b = r.range(-cone, cone) * 0.6;
    const sp = r.range(speed[0], speed[1]);
    const vx = (_d.x + _r.x * a + _u.x * b) * sp, vy = (_d.y + _r.y * a + _u.y * b + up * r.range(0, 1)) * sp, vz = (_d.z + _r.z * a + _u.z * b) * sp * 0.6;
    vfx.add.emit({ pos: arr(p), vel: [vx, vy, vz], life: r.range(life[0], life[1]), size, color, intensity, shape: 'streak', stretch, gravity, drag, floor: floor ?? -1e9 });
  }
}

/** Crescent slash streak through p along the swing direction (axial, camera-facing width). */
export function slashStreak(vfx, p, dir, { length = 1.0, width = 0.2, color = ['#fff6e0', '#ffb050'], intensity = 1.5, life = 0.13, hold = 0, bow = 0.35, tail = 0.55, flip = false } = {}) {
  vfx.shape.emit({
    shape: 'slash', mode: 'axial', pos: arr(p), dir: [dir.x, dir.y, dir.z], size: [length, width * (flip ? -1 : 1)], grow: [0.9, 1.1],
    life, hold, color, intensity, alpha: [1, 0.6], p0: [bow, 0.3, tail, 1],
  });
}

/** N-ray star burst (billboard) — the heavy-impact silhouette. */
export function starBurst(vfx, p, { size = 1.0, rays = 8, color = ['#ffe8c0', '#ff9a40'], intensity = 1.8, life = 0.12, hold = 0, rot = null, sharp = 22, core = 0.7 } = {}) {
  vfx.shape.emit({
    shape: 'star', pos: arr(p), size: [size, size], grow: [0.75, 1.1], ease: 'out', life, hold, rot: rot ?? vfx.rng.range(0, Math.PI),
    color, intensity, alpha: [1, 0], p0: [rays, sharp, 1, core], p1: [rays, sharp * 1.8, 0.55, core * 0.3],
  });
}

/** Radial speed lines in the camera plane, flying outward from p. */
export function speedLines(vfx, p, { n = 8, r0 = 0.35, r1 = 1.25, length = 0.5, width = 0.035, color = ['#fff4e0', '#ffb060'], intensity = 1.6, life = 0.16, hold = 0 } = {}) {
  const cam = vfx.camBasis();
  const r = vfx.rng;
  const N = cnt(vfx, n), off = r.range(0, Math.PI * 2);
  for (let i = 0; i < N; i++) {
    const a = off + (i / N) * Math.PI * 2 + r.range(-0.2, 0.2);
    const dx = cam.right.x * Math.cos(a) + cam.up.x * Math.sin(a), dy = cam.right.y * Math.cos(a) + cam.up.y * Math.sin(a), dz = cam.right.z * Math.cos(a) + cam.up.z * Math.sin(a);
    const rr = r0 * r.range(0.85, 1.15), sp = (r1 - r0) / life;
    vfx.shape.emit({
      shape: 'line', mode: 'axial', pos: [p.x + dx * rr, p.y + dy * rr, p.z + dz * rr], vel: [dx * sp, dy * sp, dz * sp], drag: 3,
      dir: [dx, dy, dz], size: [length * r.range(0.8, 1.2), width], grow: [1, 0.35], growY: [1, 0.5], life, hold, color, intensity, p0: [0.5, 1, 1],
    });
  }
}

/** Shock ring flat on the ground plane (additive). radius in metres. */
export function groundRing(vfx, x, gy, z, { radius = 1.4, color = ['#ffb060', '#c05020'], intensity = 0.5, life = 0.32, delay = 0, thick = [0.16, 0.04], breakup = 0.9, from = 0.2 } = {}) {
  const D = radius * 2;
  // Keep world-space band thickness bounded on screen-wide spells, rather than scaling to metres.
  if (radius > 3) { thick = thick.map(w => w * 1.4 / radius); life = Math.min(life, .36); }
  // Starts as a thin ring (never a filled disc), soft trailing band, breaks up heavily as it expands.
  vfx.shape.emit({ shape: 'ring', mode: 'plane', pos: [x, gy + 0.025, z], size: [D, D], life, delay, color, intensity, alpha: [1, 0], ease: 'out',
    p0: [from, thick[0], breakup, 0.6], p1: [0.93, thick[1], breakup, 0.6], rot: vfx.rng.range(0, 6.28) });
}

/**
 * Dust wave: a ring of LIT puffs pushed radially outward along the ground (volumetric, terrain tinted), plus a
 * faint broken decal band. radius = how far the wave travels (m). stretchX elongates along the belt (bodies).
 */
export function dustRing(vfx, x, gy, z, { radius = 1.2, color, alpha = 0.6, life = 0.7, delay = 0, stretchX = 1, n = 12, size = [0.3, 0.8], band = true } = {}) {
  const r = vfx.rng, c = color || vfx.dustColor();
  // Large spell shock fronts use sparse small rolls; a screen-sized dust skirt hid combat and
  // spent >0.6 fragments/pixel in S3. Preserve the radius/motion, bound overlapping card area.
  if (radius > 3) { n = Math.min(n, 12); size = [Math.min(size[0], .28), Math.min(size[1], .85)]; band = false; }
  const N = cnt(vfx, n), off = r.range(0, 6.28);
  for (let i = 0; i < N; i++) {
    const a = off + (i / N) * Math.PI * 2 + r.range(-0.15, 0.15);
    const cx = Math.cos(a) * stretchX, sz = Math.sin(a) * 0.55;
    const sp = radius * r.range(2.2, 3.2);   // drag 3.5 → travel ≈ sp / 3.5
    const k = r.range(0.85, 1.12), s0 = size[0] * r.range(0.8, 1.2);
    vfx.alpha.emit({
      pos: [x + cx * 0.2, gy + r.range(0.05, 0.14), z + sz * 0.2], vel: [cx * sp, r.range(0.15, 0.6), sz * sp],
      life: life * r.range(0.8, 1.2), size: [s0, size[1] * r.range(0.85, 1.25)], delay,
      color: [[c.r * k, c.g * k, c.b * k, alpha], [c.r * k, c.g * k, c.b * k, 0]], shape: 'puff', drag: 3.5, gravity: -0.15, rot: r.range(0, 6.28), spin: r.range(-1, 1),
    });
  }
  if (band) {
    const D = radius * 2.1;
    vfx.shapeLit.emit({ shape: 'dustring', mode: 'plane', pos: [x, gy + 0.04, z], size: [D * stretchX, D], life: life * 0.8, delay, color: [[c.r, c.g, c.b, alpha * 0.5], [c.r, c.g, c.b, 0]],
      ease: 'out', p0: [0.15, 0.1, 0, 0], p1: [0.85, 0.16, 0.5, 0], rot: r.range(0, 6.28) });
  }
}

/** Lit dust puffs (billboards) kicked from the ground. */
export function dustPuffs(vfx, x, gy, z, { n = 6, spread = 0.25, speed = [0.6, 2.2], up = [0.2, 0.9], size = [0.22, 0.75], life = [0.5, 0.95], dir = null, alpha = 0.6, color, bias = 0.6, drag = 3.2 } = {}) {
  const r = vfx.rng, c = color || vfx.dustColor();
  if (size[1] > .8) { n = Math.ceil(n * .5); size = [Math.min(size[0],.25),.6]; life = [Math.min(life[0],.4),Math.min(life[1],.65)]; }
  for (let i = 0, N = cnt(vfx, n); i < N; i++) {
    let a = r.range(0, Math.PI * 2);
    let vx = Math.cos(a), vz = Math.sin(a) * 0.6;
    if (dir) { vx = vx * (1 - bias) + dir * bias * 1.4; }
    const sp = r.range(speed[0], speed[1]);
    const k = r.range(0.85, 1.12);
    vfx.alpha.emit({
      pos: [x + Math.cos(a) * spread, gy + 0.07, z + Math.sin(a) * spread * 0.5], vel: [vx * sp, r.range(up[0], up[1]), vz * sp],
      life: r.range(life[0], life[1]), size: [size[0] * r.range(0.8, 1.2), size[1] * r.range(0.85, 1.25)],
      color: [[c.r * k, c.g * k, c.b * k, alpha], [c.r * k, c.g * k, c.b * k, 0]], shape: 'puff', drag, gravity: -0.25, rot: r.range(0, 6.28), spin: r.range(-1.2, 1.2),
    });
  }
}

/** Embers: small hot motes that float/fall. */
export function embers(vfx, p, { n = 5, dir = 1, speed = [0.5, 3], up = [1, 3.5], life = [0.35, 0.8], color = ['#ffc070', '#ff3a10'], intensity = 3, size = [0.045, 0.02], gravity = 4, spread = 1.2 } = {}) {
  const r = vfx.rng;
  for (let i = 0, N = cnt(vfx, n); i < N; i++) {
    vfx.add.emit({ pos: arr(p), vel: [dir * r.range(speed[0], speed[1]), r.range(up[0], up[1]), r.range(-spread, spread)], life: r.range(life[0], life[1]), size, color, intensity, shape: 'ember', gravity, drag: 1.6 });
  }
}

/** Anamorphic flare line (finisher read). */
export function flare(vfx, p, { width = 2.4, height = 0.34, color = ['#fff4e4', '#ffa050'], intensity = 1.4, life = 0.13, hold = 0 } = {}) {
  vfx.shape.emit({ shape: 'flare', pos: arr(p), size: [width, height], grow: [0.6, 1.2], growY: [1, 0.4], life, hold, color, intensity, p0: [0.07, 0.16] });
}

/** Ground debris burst (lit rock chips), terrain tinted. */
export function debris(vfx, x, gy, z, { n = 6, speed = [1.2, 3.5], up = [2.5, 5], size = [0.04, 0.09], dir = null, spread = Math.PI, kind = 'rock', color, life = [0.9, 1.6] } = {}) {
  vfx.debris.burst({ pos: { x, y: gy, z }, groundY: gy, count: cnt(vfx, n), speed, up, size, dir, spread, kind, color: color || vfx.debrisColor(), life }, vfx.rng);
}

/** Downward-stab crack decal: dark lit crack + stain (alpha) and a hot glowing crack pass (additive). */
export function crackDecal(vfx, x, gy, z, { radius = 0.8, glow = '#ff9a40', glowIntensity = 1.3, life = 1.8 } = {}) {
  const D = radius * 2, seed = vfx.rng.range(0, 1), rot = vfx.rng.range(0, 6.28);
  vfx.shapeLit.emit({ shape: 'crack', mode: 'plane', pos: [x, gy + 0.03, z], size: [D, D], rot, seed, life, color: [[0.09, 0.07, 0.06, 0.95], [0.09, 0.07, 0.06, 0]], ease: 'out',
    p0: [0.35, 0.05, 0.7, 7], p1: [1.0, 0.07, 0.7, 7], hold: 0 });
  vfx.shape.emit({ shape: 'crack', mode: 'plane', pos: [x, gy + 0.035, z], size: [D, D], rot, seed, life: life * 0.35, color: [glow, glow], alpha: [1, 0], intensity: glowIntensity, ease: 'out',
    p0: [0.35, 0.035, 0, 7], p1: [1.0, 0.045, 0, 7] });
}

/** Lit smoke plume puffs (for magic/burning). */
export function smoke(vfx, p, { n = 6, color = [0.16, 0.14, 0.13], alpha = 0.55, size = [0.4, 1.4], rise = [0.6, 1.6], spread = 0.4, life = [1.2, 2.2] } = {}) {
  const r = vfx.rng;
  size = [Math.min(size[0],.5),Math.min(size[1],1.15)];
  life = [Math.min(life[0],.75),Math.min(life[1],1.1)];
  for (let i = 0, N = cnt(vfx, Math.ceil(n * .55)); i < N; i++) {
    vfx.alpha.emit({ pos: [p.x + r.range(-spread, spread), p.y + r.range(0, 0.3), p.z + r.range(-spread, spread) * 0.5], vel: [r.range(-0.3, 0.3), r.range(rise[0], rise[1]), r.range(-0.15, 0.15)],
      life: r.range(life[0], life[1]), size: [size[0] * r.range(0.7, .95), size[1] * r.range(0.65, .9)], color: [[...color, alpha], [...color, 0]], shape: 'smoke', drag: 1.2, gravity: -0.2, rot: r.range(0, 6.28), spin: r.range(-0.5, 0.5), fadeIn: 0.25 });
  }
}
