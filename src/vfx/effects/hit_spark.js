// Hit feedback per weight (default HIT spark). opts: { point, dir:±1, level, attacker, target, blocked, killed,
// knockdown, launch, otg, moveId, hitstop (ticks), element?, kind? (force: light|heavy|knockdown|ko|block|otg|throw|magic) }
// C2 r17: light / heavy / knockdown / finisher contacts are screen-sized DIRECTIONAL bursts of inked blades:
// light = a gold slash comet (one fat blade along the cut, lopsided forward fan, short stubs behind, glow mass, three
// fragments flying on); heavy = a red-orange broken fan (wide uneven blades, two snapped off, inked chunks thrown out,
// a ring on the 0/33 ms frames only, a copper shock crescent travelling along the hit) + ground flash/crack.
// The burst slides/tilts into free space and every blade, fragment, glow and ring stops short of bystander heads and
// torsos. The struck body gets a tinted flash one frame after the core (bodyPop).
// magic fire: flash -> billowing fire -> soot, ember cluster; storm: branching electric strike.
// KO / block / OTG / throw keep their established motion/dust and victim-anchored placement.
// Only full magic-earth hits emit stone chips. Boss/repeat contacts retain bounded kernels.
// A physical hit carrying an element (hit.element) adds a small element accent on top of its weight motif.
// Sparks orient along the attacker's actual weapon-tip velocity (vfx.trails.swingDir) when known.
import * as THREE from 'three';
import { contactFill } from '../../render/characterLook.js';
import { bodyContact, frontContact } from '../contact.js';
import { hitKind, hitPalette, PALETTES } from '../palette.js';
import { coreGlow, impactBurst, sparkSpray, speedLines, groundRing, dustRing, dustPuffs, embers, flare, crackDecal } from './_lib.js';

// Per-VFX-system weak target keys: despawned actors are not retained, and a new world starts fresh.
const contactWindows = new WeakMap();
function repeatContact(vfx, target) {
  if (!target) return false;
  let state = contactWindows.get(vfx);
  if (!state || state.world !== vfx.game.world) { state = { world: vfx.game.world, targets: new WeakMap() }; contactWindows.set(vfx, state); }
  const tick = vfx.game.tick || 0, last = state.targets.get(target);
  // Anchor to the first burst, so a continuous string cannot suppress large contacts forever.
  if (last !== undefined && tick >= last && tick - last < 6) return true;
  state.targets.set(target, tick);
  return false;
}

function metalChips(vfx, q, sw, heavy, gy) {
  const r=vfx.rng;
  for (let i=0;i<(heavy ? 5 : 3);i++) {
    const speed=r.range(heavy ? 5 : 4,heavy ? 11 : 8);
    vfx.debris.emit({kind:'metal',pos:[q.x,q.y,q.z],
      vel:[sw.x*speed+r.range(-1,1),sw.y*speed+r.range(.6,2),sw.z*speed+r.range(-.7,.7)],
      size:r.range(.065,.095),color:i%2 ? '#ff9b28' : '#ffdf92',life:r.range(.12,.24),spin:r.range(-18,18),groundY:gy,bounce:.1});
  }
}

const _dir = new THREE.Vector3(), _sw = new THREE.Vector3(), _v = new THREE.Vector3();

function swing(vfx, o, kind) {
  const d = o.dir || 1;
  const sw = o.attacker && vfx.trails ? vfx.trails.swingDir(o.attacker) : null;
  if (sw) {
    _sw.copy(sw); _sw.z *= 0.4;
    if (_sw.lengthSq() > 1e-4) return _sw.normalize();
  }
  const lightTilt = { light_1: -.65, light_2: .65, light_3: -1.1 };
  if (o.moveId in lightTilt) return _sw.set(d, lightTilt[o.moveId], 0).normalize();
  const r = vfx.rng;
  const tilt = kind === 'heavy' || kind === 'knockdown' || kind === 'ko' ? r.range(-0.75, 0.25) : r.range(-0.45, 0.45);
  return _sw.set(d * Math.cos(tilt), Math.sin(tilt), r.range(-0.12, 0.12)).normalize();
}

/** Camera-plane unit direction at angle a (radians, 0 = screen right). */
function camDir(vfx, a, out = _v) {
  const c = vfx.camBasis();
  return out.set(c.right.x * Math.cos(a) + c.up.x * Math.sin(a), c.right.y * Math.cos(a) + c.up.y * Math.sin(a), c.right.z * Math.cos(a) + c.up.z * Math.sin(a));
}

/** Thin blade line (axial) through p at screen angle a. */
function bladeLine(vfx, p, a, { length = 1, width = 0.06, color, intensity = 2.2, life = 0.1, hold = 0, delay = 0 } = {}) {
  const d = camDir(vfx, a);
  vfx.shape.emit({ shape: 'line', mode: 'axial', pos: [p.x, p.y, p.z], dir: [d.x, d.y, d.z], size: [length, width], grow: [0.55, 1.15], growY: [1.3, 0.3], ease: 'out',
    life, hold, delay, color, intensity, p0: [0.5, 1, 1], occ: 0.65 });
}

// ------------------------------------------------------------------ C2 r16 impact star (light / heavy / finisher)
// A hard star of long tapered spikes sized in SCREEN pixels (1600x900 reference), so it reads at play size and at
// thumbnail size. Each spike is one ShapeFx 'spike' instance (ink contour + hot body + white spine in one quad, in
// the existing vfx_shape pool: no extra draw call or program). Bystander safety is per spike: every other fighter's
// head + torso is a screen rect and a spike stops just short of it, instead of shrinking the whole burst to fit the
// victim's own (often diagonal / narrow) projection.
const _sp = new THREE.Vector3();
const GUARD_KINDS = new Set(['hero', 'enemy', 'boss', 'mount']);
function toScreen(camera, x, y, z) { _sp.set(x, y, z).project(camera); return [(_sp.x + 1) * 800, (1 - _sp.y) * 450, _sp.z]; }
function guardRects(vfx, target, camera) {
  const out = [];
  for (const a of vfx.game.world?.actors || []) {
    if (a === target || a.removed || !GUARD_KINDS.has(a.kind) || !a.hurtboxes) continue;
    const boxes = a.hurtboxes() || [];
    if (!boxes.length) continue;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const b of boxes) for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) {
      const [sx, sy] = toScreen(camera, x, y, z);
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    // Legs may be crossed by a spike tip; head + torso (top 78 %) may not. 4 px margin.
    out.push({ x0: x0 - 4, x1: x1 + 4, y0: y0 - 4, y1: y0 + (y1 - y0) * 0.78 + 4 });
  }
  return out;
}
// Ray (cx,cy)+t(dx,dy): distance at which it enters rect r (0 = starts inside, Infinity = never).
function rayEnter(cx, cy, dx, dy, r) {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, lo, hi] of [[cx, dx, r.x0, r.x1], [cy, dy, r.y0, r.y1]]) {
    if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) return Infinity; continue; }
    let a = (lo - o) / d, b = (hi - o) / d;
    if (a > b) { const tmp = a; a = b; b = tmp; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}
function rectDistance(cx, cy, r) { return Math.hypot(Math.max(0, r.x0 - cx, cx - r.x1), Math.max(0, r.y0 - cy, cy - r.y1)); }

// Clear length of a screen ray before the first bystander head/torso rect (3 px short of it).
function clearLen(cx, cy, a, len, guards) {
  const dx = Math.cos(a), dy = -Math.sin(a);
  for (const g of guards) { const e = rayEnter(cx, cy, dx, dy, g); if (e - 3 < len) len = e - 3; }
  return len;
}
/** Place a directional burst in the free space round the contact: try sliding its origin back along the cut (toward the
 *  blade's entry, at most 0.6 R and never off the victim's own projection) and tilting it (<= 0.4 rad); keep the
 *  candidate that leaves clearly the most weighted blade length off bystander heads/torsos. Mutates spike angles;
 *  returns { shift (px), aim (rad), ox, oy }. */
function placeBurst(spikes, A, R, cx, cy, guards, victim) {
  const score = (ox, oy, off) => spikes.reduce((s, k) => s + Math.max(0, Math.min(k.len, clearLen(ox, oy, k.a + off, k.len, guards))) * (k.wt ?? 1), 0);
  let best = { shift: 0, aim: 0, ox: cx, oy: cy }, bestS = score(cx, cy, 0);
  if (guards.length) for (const sh of [0, 0.2, 0.35, 0.5, 0.6]) for (const off of [0, 0.2, -0.2, 0.4, -0.4]) {
    const ox = cx - Math.cos(A + off) * sh * R, oy = cy + Math.sin(A + off) * sh * R;
    if (victim && (ox < victim.x0 || ox > victim.x1 || oy < victim.y0 || oy > victim.y1)) continue;
    if (guards.some(g => ox > g.x0 && ox < g.x1 && oy > g.y0 && oy < g.y1)) continue;
    const v = score(ox, oy, off) * (1 - Math.abs(off) * 0.3 - sh * 0.12);
    if (v > bestS * 1.06) { bestS = v; best = { shift: Math.round(sh * R), aim: off, ox, oy }; }
  }
  if (best.aim) for (const k of spikes) k.a += best.aim;
  return best;
}
/** Screen rect of an actor's whole hurt projection. */
function actorRect(a, camera) {
  const boxes = a?.hurtboxes?.() || [];
  if (!boxes.length) return null;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const b of boxes) for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) {
    const [sx, sy] = toScreen(camera, x, y, z);
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  return { x0, x1, y0, y1 };
}
/** World point offset from q by `d` screen px at screen angle a. */
function shifted(vfx, q, a, d, px) { const v = camDir(vfx, a, new THREE.Vector3()); return { x: q.x + v.x * d * px, y: q.y + v.y * d * px, z: q.z + v.z * d * px }; }

/** spikes: [{ a (screen rad), len (px), w (px), taper?, ink (px)?, spine?, heat?, body?, life?, hold? }].
 *  Returns the probe record (clipped lengths). */
function impactStar(vfx, q, spikes, { px, guards, cx, cy, hub = 0.03, body, cool, life, hold, heat = 1, minLen = 14 }) {
  const out = [];
  for (const k of spikes) {
    let len = k.len;
    for (const g of guards) { const e = rayEnter(cx, cy, Math.cos(k.a), -Math.sin(k.a), g); if (e - 3 < len) len = Math.max(minLen, e - 3); }
    const r0 = k.len * hub, L = Math.max(4, len - r0), d = camDir(vfx, k.a);
    const c = (r0 + L * 0.5) * px, h = k.heat ?? heat, b = k.body || body;
    vfx.shape.emit({ shape: 'spike', pos: [q.x + d.x * c, q.y + d.y * c, q.z + d.z * c], rot: k.a, size: [L * px, k.w * px],
      grow: [1, k.shrink ?? 0.82], growY: [1, 0.35], ease: 'in', life: k.life ?? life, hold: k.hold ?? hold, color: [[...b, 1], [...(k.cool || cool), 0]], occ: 0.9,
      p0: [k.taper || 0, k.ink ?? 3.5, k.spine ?? 0.2, h], p1: [k.taper || 0, k.ink ?? 3.5, (k.spine ?? 0.2) * 0.4, h * 0.3] });
    out.push({ a: +k.a.toFixed(3), want: Math.round(k.len), len: Math.round(len), w: Math.round(k.w) });
  }
  return out;
}

/** Fragments thrown outward along the hit: small inked blades (same 'spike' shape) that fly from `start` px out to
 *  `dist` px and decelerate. Travel is cut short before any bystander's head/torso; a fragment that would leave
 *  less than 18 px of flight is dropped. Returns the probe record. */
function throwFragments(vfx, q, list, { px, guards, cx, cy }) {
  const out = [];
  for (const f of list) {
    const T = (f.hold ?? 0) + f.life, D = f.drag ?? 7;
    // blocked: re-aim up to +-0.6 rad toward free space (nearest angle first), else drop
    let dist = -1;
    for (const off of f.fixed ? [0] : [0, 0.3, -0.3, 0.6, -0.6]) {
      const reach = clearLen(cx, cy, f.a + off, f.start + f.dist + f.len * 0.5, guards);
      dist = Math.min(f.dist, reach - f.start - f.len * 0.5);
      if (dist >= Math.min(f.dist, 30)) { f.a += off; break; }
    }
    if (dist < 18) continue;
    const d = camDir(vfx, f.a), c = (f.start + f.len * 0.5) * px, v0 = dist * px * D / (1 - Math.exp(-D * T));
    vfx.shape.emit({ shape: 'spike', pos: [q.x + d.x * c, q.y + d.y * c, q.z + d.z * c], vel: [d.x * v0, d.y * v0, d.z * v0], drag: D,
      rot: f.a, spin: f.spin || 0, size: [f.len * px, f.w * px], grow: [1, 0.7], growY: [1, 0.6], ease: 'in', life: f.life, hold: f.hold ?? 0,
      delay: f.delay || 0, color: [[...f.body, 1], [...f.cool, 0]], occ: 0.9,
      p0: [f.taper ?? 0.55, f.ink ?? 3, f.spine ?? 0.3, f.heat ?? 0.8], p1: [f.taper ?? 0.55, f.ink ?? 3, 0.1, 0.2] });
    out.push({ a: +f.a.toFixed(3), start: Math.round(f.start), dist: Math.round(dist), len: Math.round(f.len) });
  }
  return out;
}

/** Heavy shock front: a copper 'cutarc' crescent across the hit, bowed forward, travelling along it. Travel and then
 *  half-length shrink until its centre and both horns stay out of bystander heads/torsos; skipped if it cannot. */
function shockFront(vfx, q, A, { px, guards, cx, cy, R, start, dist, half }) {
  const inside = (x, y) => guards.some(g => x > g.x0 && x < g.x1 && y > g.y0 && y < g.y1);
  const ca = Math.cos(A), sa = -Math.sin(A), pa = -sa, pb = ca;   // screen: along (ca, sa), across (pa, pb)
  const bad = (d, h) => { const x = cx + ca * d, y = cy + sa * d; return clearLen(cx, cy, A, d + 4, guards) < d + 4 || inside(x + pa * h, y + pb * h) || inside(x - pa * h, y - pb * h); };
  let d = start + dist, h = half;
  while (d > start && bad(d, h)) d -= 10;
  if (d <= start) { d = start; while (h > R * 0.3 && bad(d, h)) h -= 8; if (bad(d, h)) return null; }
  const T = 0.11, D = 6, v = (d - start) * px * D / (1 - Math.exp(-D * T)), dv = camDir(vfx, A, new THREE.Vector3()), c = start * px;
  vfx.shape.emit({ shape: 'cutarc', pos: [q.x + dv.x * c, q.y + dv.y * c, q.z + dv.z * c + 0.02], vel: [dv.x * v, dv.y * v, dv.z * v], drag: D,
    rot: A - Math.PI / 2, size: [2 * h * px, h * 0.9 * px], grow: [0.8, 1.05], growY: [1, 0.55], ease: 'out', life: 0.09, hold: 0.02,
    color: [[1.5, 0.5, 0.07, 1], [0.8, 0.12, 0.02, 0]], occ: 0.6, p0: [0.4, 0.3, 0, 0], p1: [0.4, 0.16, 0, 0] });
  return { travel: Math.round(d - start), half: Math.round(h) };
}

/** Soft additive glow mass under/around the burst: an ellipse along the hit, its visible edge (~0.55 of the quad)
 *  kept off the nearest bystander head/torso. */
function glowMass(vfx, q, a, { px, guards, cx, cy, ahead, rx, ry, color, tail, life, hold, core = 0.12 }) {
  const d = camDir(vfx, a), o = ahead * px, ox = cx + Math.cos(a) * ahead, oy = cy - Math.sin(a) * ahead;
  // fit the visible ellipse (~0.55 of the quad) to the free space by 12 rays; scale each axis on its own
  let kx = 1, ky = 1;
  for (let i = 0; i < 12; i++) {
    const th = i * Math.PI / 6, ex = Math.cos(th) * rx * 0.55, ey = Math.sin(th) * ry * 0.55, want = Math.hypot(ex, ey);
    const ang = a + Math.atan2(ey, ex), free = clearLen(ox, oy, ang, want, guards);
    if (free < want) { const k = Math.max(0.15, free / want); if (Math.abs(ex) >= Math.abs(ey)) kx = Math.min(kx, k); else ky = Math.min(ky, k); }
  }
  // quad trimmed to 0.78 (falloff 1.9): the outer ring of a full-size (1-d)^2.3 glow is below 4 % and only cost fill
  vfx.shape.emit({ shape: 'glow', pos: [q.x + d.x * o, q.y + d.y * o, q.z + d.z * o], rot: a, size: [1.56 * rx * kx * px, 1.56 * ry * ky * px],
    grow: [0.9, 1.1], life, hold, color: [[...color, 1], [...tail, 0]], occ: 0, p0: [1.9, core] });
  return { rx: Math.round(rx * kx), ry: Math.round(ry * ky) };
}

// ------------------------------------------------------------------ element motifs (magic + accents)
const ELEMENT_FX = {
  fire(vfx, q, pal, { gy, hs, dir, target, s = 1 }) {
    const scale = 0.65 + s * 0.35;
    vfx.fire.emitCombustion({pos:[q.x,q.y,q.z],target,scale,dir});
    // Attached cooling residue is emitted by emitCombustion; no world-fixed ember copy.
    vfx.light(q, { color: pal.mid, intensity: 1.5, distance: 1.6, life: 0.1 });
  },
  storm(vfx, q, pal, { gy, gx, gz, hs, s = 1 }) {
    coreGlow(vfx, q, { size: .22 * s, color: '#effcff', tail: '#3b8eff', intensity: 1.3, life: .05, core: .08 });
    vfx.fire.emit({ clip: 'storm', pos: [q.x, q.y + .65, q.z], size: [3.0 * s, 3.8 * s], life: .26,
      core: .3, erosion: 0, radiance: 1.15 });
    sparkSpray(vfx, q, _dir.set(0, 1, 0), { n: Math.round(12 * s), speed: [4, 10], cone: 1.2,
      life: [0.1, 0.24], color: [pal.mid, pal.tail], intensity: 1.4, gravity: 5, floor: gy + 0.02 });
    vfx.shape.emit({ shape: 'glow', mode: 'plane', pos: [gx, gy+.03, gz], size: [2.0*s, 1.5*s],
      life: .07, color: ['#9ee8ff', '#2966c8'], intensity: 1.0, p0: [2.6,.2] });
    vfx.light({x:gx,y:gy+.55,z:gz+.20}, { color: '#7bcaff', intensity: 4.2, distance: 2.4, life: .075 });
  },
  earth(vfx, q, pal, { gy, gx, gz, dir, s = 1 }) {
    // Only the full earth spell hit emits stone; physical element accents stay dust-only.
    const r = vfx.rng;
    if (s >= 1) for (let i = 0, N = Math.max(1, Math.round(5 * vfx.scale)); i < N; i++) {
      const side = N > 1 ? (i / (N - 1) - 0.5) * 0.8 : 0;
      vfx.debris.emit({ pos: [gx + side, gy + 0.12 + r.range(0, 0.12), gz + r.range(-0.1, 0.15)],
        vel: [side * 2.2, r.range(2.8, 4.3), r.range(-0.4, 0.5)], size: r.range(0.09, 0.18),
        color: i % 2 === 0 ? '#c9b58e' : '#b5a580', kind: 'stone', groundY: gy,
        life: r.range(0.28, 0.42), spin: r.range(-9, 9), bounce: 0.12 });
    }
    if (s >= 1) {
      crackDecal(vfx, gx, gy, gz, { radius: 0.9, glow: '#658c47', glowIntensity: 0.65, life: 0.8 });
      dustPuffs(vfx, gx, gy, gz, { n: 3, spread: 0.42, speed: [1, 2], size: [0.13, 0.32], alpha: 0.45 });
      dustRing(vfx, gx, gy, gz, { radius: .8, alpha: 0.4, life: 0.36, n: 5, size: [.12,.32], band: false });
    }
    vfx.light(q, { color: '#a1ad63', intensity: 0.65, distance: 1.4, life: 0.08 });
  },
};

export default {
  id: 'hit_spark',
  spawn(vfx, o = {}) {
    const r = vfx.rng;
    const hitPoint = bodyContact(o);
    const kind = hitKind(o);
    const dir = o.dir || 1;
    const pal = hitPalette(kind, o.attacker, o.element);
    const hs = Math.max(0, (o.hitstop ?? 5) / 60);
    const t = o.target;
    const small=t?.typeId==='thief' || (t?.height || 1.8)<1.25;
    const boss = t && (t.kind === 'boss' || t.modelRoot?.userData.kcaBossFlash);
    const repeat = kind !== 'block' && repeatContact(vfx, t);
    const payoff = ['heavy','knockdown','ko'].includes(kind) || o.moveId === 'close_finisher';
    const compact = boss || (repeat && !payoff);
    const gy = t ? vfx.groundY(t) : 0;
    // A throw landing's event point can be the attacker/victim midpoint (over the thrower's face).
    // Its contact kernel belongs to the victim's landing, alongside the existing body-slam layers.
    const thrownContact = kind === 'throw' || o.moveId === 'throw_impact';
    const p = thrownContact && t?.pos ? { x: t.pos.x, y: kind === 'throw' ? gy + 0.4 : t.pos.y + (t.height || 1.8) * 0.55, z: t.pos.z } : hitPoint;
    const gx = t ? t.pos.x : p.x, gz = t ? t.pos.z : p.z;
    const sw = swing(vfx, o, kind);
    const basis = vfx.camBasis();
    const swA = Math.atan2(sw.dot(basis.up), sw.dot(basis.right));
    _dir.set(dir, 0.15, 0).normalize();
    // Push the effect a touch toward the camera so it sits in front of the victim's silhouette.
    const cb = vfx.camBasis();
    const q = frontContact(p, vfx.game.camera, ['light','heavy','knockdown'].includes(kind) ? 1.15 : .65);
    // Optional read-only evidence hook; no actor retention in production.
    vfx.contactProbe?.({ target: t, moveId: o.moveId, point: p, flash: q, kind });
    // Every unblocked body contact, including enemy knockdowns on heroes, has the same short core.
    if (kind !== 'block') coreGlow(vfx, q, { size: .18, color: '#fffef2', tail: pal.mid, intensity: 1.2, life: .045, core: .04 });
    // Size from the camera projection, with a world-space ceiling for close inspection.
    // 68px quad yields about 60px of opaque silhouette at 1600x900, before bloom.
    const camera = vfx.game.camera;
    const depth = camera ? _v.set(q.x, q.y, q.z).sub(camera.position).dot(cb.fwd) : 18;
    const px = camera ? 2 * Math.max(1, depth) * Math.tan(camera.fov * Math.PI / 360) / 900 : 0.015;
    const diameter = Math.min(1.3, Math.max(0.72, px * 68));
    if (kind !== 'block' && !(boss && payoff) && (compact || !['light', 'heavy', 'knockdown', 'magic'].includes(kind))) vfx.shapeLit.emit({ shape: 'contact', pos: [q.x, q.y, q.z + 0.025],
      size: [diameter * (compact ? (repeat ? 0.32 : 0.52) : kind === 'light' ? 1 : 1.18), diameter * (compact ? (repeat ? 0.32 : 0.52) : kind === 'light' ? 1 : 1.18)], rot: swA + 0.12,
      p0: [compact ? 1 : 0, 0, 0, 0],
      life: 0.065, hold: compact ? 0.015 : 0.05, grow: [1, 0.78], color: '#ffffff', alpha: [1, 0], ease: 'linear' });
    const ctx = { gy, gx, gz, hs, dir, target:t };

    if (kind === 'block') {
      const M = PALETTES.metal;
      coreGlow(vfx, q, { size: 0.3, color: '#ffffff', tail: '#b8d4ff', intensity: 1.508, life: 0.06, hold: hs * 0.5 });
      vfx.shape.emit({ shape: 'star', pos: [q.x, q.y, q.z], size: [0.95, 0.95], life: 0.09, hold: hs * 0.6, rot: r.range(-0.2, 0.2) + Math.PI / 4, color: ['#ffffff', '#a8c8ff'], intensity: 1.392, p0: [4, 40, 1, 0.5], p1: [4, 60, 0.5, 0.2] });
      _dir.set(-dir, 0.55, 0).normalize();
      sparkSpray(vfx, q, _dir, { n: 18, speed: [5, 12], cone: 0.9, up: 0.6, life: [0.22, 0.5], size: [0.024, 0.01], color: [M.hot, '#8ab4ff'], intensity: 2.784, gravity: 20, drag: 1.6, floor: gy + 0.02, stretch: 0.014 });
      embers(vfx, q, { n: 3, dir: -dir, color: ['#fff2c0', '#ff7a20'], life: [0.2, 0.45] });
      vfx.light(q, { color: 0xd8e8ff, intensity: 1.16, distance: 1.6, life: 0.06 });
      return;
    }

    if (kind === 'magic' && !repeat) {
      const el = ELEMENT_FX[o.element] ? o.element : (pal === PALETTES.storm ? 'storm' : pal === PALETTES.earth ? 'earth' : 'fire');
      ELEMENT_FX[el](vfx, q, pal, ctx);
      return;
    }

    if (kind !== 'magic') metalChips(vfx,q,sw,payoff,gy);

    // Bound paint to the struck body's width, independent of camera zoom or scene depth.
    const boxes=t?.hurtboxes?.() || [];
    const bodyWidth=boxes.length ? Math.max(...boxes.map(b=>b.maxX-b.minX)) : .8;
    const extent=Math.min(2.1,Math.max(1.0,bodyWidth*1.65));

    // Boss physical contacts / repeat elemental hits: small kernel plus directional moving sparks.
    // Repeat hits on any target keep their own point/direction, without another broad burst/ring/light.
    if (compact) {
      // Boss payoff swaps the compact kernel for the heavy sequence in the same bounded area.
      if (payoff) vfx.fire.emit({clip:'blunt',pos:[q.x,q.y,q.z],size:[diameter*.85,diameter*.75],
        life:.12,rot:swA,core:6,radiance:1.15,erosion:.05});
      sparkSpray(vfx, q, sw, { n: repeat ? 5 : kind === 'light' ? 8 : 12, speed: [5, 10], cone: 0.32,
        up: 0.12, life: [0.06, 0.14], size: [0.022, 0.008], color: [pal.mid, pal.tail], intensity: 1.45,
        gravity: 9, floor: gy + 0.02, stretch: 0.018 });
      bladeLine(vfx, q, swA, { length: repeat ? 0.24 : 0.42, width: 0.025,
        color: [pal.mid, pal.tail], intensity: 0.85, life: 0.065 });
      if (!repeat && kind !== 'light' && p.y - gy < 1.2)
        dustPuffs(vfx, gx, gy, gz, { n: 3, spread: 0.18, size: [0.1, 0.25], alpha: 0.3 });
      return;
    }

    if (kind === 'throw') {
      // body slam: flattened impact star at the victim's hip/feet + ground shock
      const s = { x: gx, y: gy + 0.4, z: gz + 0.3 };
      impactBurst(vfx, s, { size: 1.3, stretch: 1.9, spikes: 9, valley: 0.4, color: [pal.mid, pal.tail], intensity: 0.522, life: 0.18, hold: hs, rot: 0, occ: 0.35 });
      coreGlow(vfx, s, { size: 0.6, color: pal.hot, tail: pal.mid, intensity: 1.044, life: 0.1, hold: hs, core: 0.1 });
      groundRing(vfx, gx, gy, gz, { radius: 2.2, color: [pal.mid, pal.tail], intensity: 0.377, life: 0.4 });
      groundRing(vfx, gx, gy, gz, { radius: 1.3, color: [pal.core, pal.mid], intensity: 0.464, life: 0.28, delay: 0.04 });
      crackDecal(vfx, gx, gy, gz, { radius: 0.9, glow: pal.mid, glowIntensity: 1.0, life: 1.4 });
      dustRing(vfx, gx, gy, gz, { radius: 1.8, alpha: 0.8, life: 1.0, stretchX: 1.35, n: 16 });
      dustPuffs(vfx, gx, gy, gz, { n: 12, spread: 0.6, speed: [1, 3.2], size: [0.35, 1.0], alpha: 0.7 });
      _dir.set(0, 1, 0);
      sparkSpray(vfx, s, _dir, { n: 12, speed: [4, 9], cone: 1.3, life: [0.15, 0.35], color: [pal.hot, pal.tail], intensity: 1.972, gravity: 14, floor: gy + 0.02 });
      speedLines(vfx, s, { n: 8, r0: 0.5, r1: 1.6, length: 0.55, color: [pal.core, pal.mid], intensity: 0.87, life: 0.16, hold: hs * 0.5 });
      vfx.light(s, { color: pal.mid, intensity: 2.32, distance: 2.2, life: 0.12 });
      if (o.element && ELEMENT_FX[o.element]) ELEMENT_FX[o.element](vfx, s, PALETTES[o.element], { ...ctx, s: 0.5 });
      return;
    }

    const accent = (sc) => { if (o.element && ELEMENT_FX[o.element]) ELEMENT_FX[o.element](vfx, q, PALETTES[o.element], { ...ctx, s: sc }); };
    const nearGround = p.y - gy < 2.4;

    // C2 r16 screen-space star frame (shared by light / heavy / finisher).
    const cam = vfx.game.camera;
    const [cx, cy] = cam ? toScreen(cam, q.x, q.y, q.z) : [800, 450];
    const guards = cam ? guardRects(vfx, t, cam) : [];
    const victimRect = cam && t ? actorRect(t, cam) : null;
    // Victim scale: a thief gets ~85 % of a marauder's star, never less.
    const bodyK = Math.min(1.1, Math.max(0.85, (t?.height || 1.8) / 1.8));
    const bodyPop = (heavy) => {
      // C2 r17: the whole-body flash is TINTED (hit colour, no white rim on light) and starts one frame after the
      // impact core, so frame 0 shows the burst's dark contour against the unbleached body.
      if (!t?.modelRoot) return;
      const h = t.height || 1.8;
      contactFill(t.modelRoot, { x: t.pos.x, y: (t.pos.y || gy) + h * 0.55, z: t.pos.z + 0.15 }, { radius: h * 0.66,
        strength: (heavy ? 0.9 : 0.85) * (small ? 0.85 : 1), color: heavy ? [1, 0.34, 0.09] : [1, 0.48, 0.12],
        hold: heavy ? 0.045 : 0.038, life: heavy ? 0.06 : 0.05, white: heavy ? 0.28 : 0, whiteLife: 0.03, delay: 0.02 });
    };

    if (kind === 'light') {
      // C2 r17 LIGHT = a slash-aligned comet burst: one fat blade thrown along the blade's travel, a lopsided forward
      // fan, short stubs behind, a gold glow mass and three small inked fragments flying on along the cut.
      const R = 78 * bodyK, j = () => r.range(-0.06, 0.06), side = r.next() < 0.5 ? 1 : -1;
      const spikes = [
        { a: swA + j(), len: R * 2.05, w: R * 0.8, taper: 0.72, spine: 0.45, wt: 3 },
        { a: swA + side * 0.42 + j(), len: R * 1.35, w: R * 0.48, taper: 0.8, spine: 0.36 },
        { a: swA - side * 0.48 + j(), len: R * 1.02, w: R * 0.4, taper: 0.85, spine: 0.32 },
        { a: swA + side * 0.98 + j(), len: R * 0.72, w: R * 0.28, ink: 3 },
        { a: swA - side * 1.08 + j(), len: R * 0.52, w: R * 0.22, ink: 3 },
        { a: swA + Math.PI + j(), len: R * 0.6, w: R * 0.5, taper: 0.9, ink: 3 },
        { a: swA + Math.PI + side * 0.52 + j(), len: R * 0.36, w: R * 0.24, ink: 3 },
      ];
      const pl = placeBurst(spikes, swA, R, cx, cy, guards, victimRect), A = swA + pl.aim;
      const qo = shifted(vfx, q, A, -pl.shift, px), at = { px, guards, cx: pl.ox, cy: pl.oy };
      const halo = glowMass(vfx, qo, A, { ...at, ahead: R * 0.5, rx: R * 1.8, ry: R * 1.0,
        color: [1.0, 0.42, 0.06], tail: [0.55, 0.1, 0.015], life: 0.075, hold: 0.04 });
      const probe = impactStar(vfx, qo, spikes, { ...at, body: [1.35, 0.55, 0.055], cool: [0.75, 0.13, 0.015], life: 0.07, hold: 0.045, heat: 0.6 });
      const frags = throwFragments(vfx, qo, [-0.32, 0.04, 0.36].map((o, i) => ({ a: A + o * side + j(), start: R * (0.55 + i * 0.12),
        dist: R * r.range(1.4, 2.0), len: R * 0.42, w: R * 0.2, life: 0.13, hold: 0.02, body: [1.5, 0.62, 0.07], cool: [0.8, 0.14, 0.02] })), at);
      coreGlow(vfx, qo, { size: 0.45 * R * px, color: '#fff6d8', tail: '#ffb43a', intensity: 1.3, life: 0.06, hold: 0.04, core: 0.5 });
      vfx.starProbe?.({ kind, moveId: o.moveId, centre: [cx, cy], origin: [Math.round(pl.ox), Math.round(pl.oy)], shift: pl.shift, R, aim: pl.aim, swA: +swA.toFixed(3), halo, spikes: probe, frags, guards, victim: victimRect });
      sparkSpray(vfx, q, sw, { n: 9, speed: [6, 13], cone: .55, life: [.09, .18], size: [.025, .006],
        color: ['#ffd976', pal.tail], intensity: 1.1, gravity: 8, floor: gy + .02, stretch: .020 });
      bodyPop(false);
      const arm=o.attacker?.model?.sockets?.R;
      if(arm) contactFill(o.attacker.modelRoot,arm.getWorldPosition(new THREE.Vector3()),{radius:.60,strength:.50,life:.065});
      // A surface-level light reaches the torso and weapon arm; one existing pool slot is reused.
      vfx.light({x:p.x-dir*.27,y:p.y+.16,z:p.z+.42}, { color: '#ffd18a', intensity: small ? 3 : 7, distance: small ? .8 : 1.1, life: .055, contact: true });
      accent(0.35);
      return;
    }

    if (kind === 'otg') {
      // downward stab: the GROUND CRACK is the silhouette: bright glowing fissure + upward fountain, no star
      const g = { x: gx, y: gy + 0.12, z: gz + 0.15 };
      coreGlow(vfx, g, { size: 0.5, color: pal.hot, tail: pal.mid, intensity: 1.044, life: 0.1, hold: hs, core: 0.1 });
      crackDecal(vfx, gx, gy, gz, { radius: 1.35, glow: pal.mid, glowIntensity: 2.4, life: 1.8 });
      groundRing(vfx, gx, gy, gz, { radius: 1.0, color: [pal.mid, pal.tail], intensity: 0.261, life: 0.22 });
      _dir.set(0, 1, 0);
      sparkSpray(vfx, g, _dir, { n: 18, speed: [5, 11], cone: 0.35, life: [0.2, 0.42], color: [pal.hot, pal.tail], intensity: 2.204, gravity: 16, floor: gy + 0.02 });
      vfx.shape.emit({ shape: 'line', mode: 'axial', pos: [g.x, g.y + 0.7, g.z], dir: [0, 1, 0], size: [1.5, 0.12], grow: [0.4, 1.2], growY: [1.2, 0.2], life: 0.14, hold: hs * 0.5, color: [pal.mid, pal.tail], intensity: 1.15, p0: [0.5, 1, 1], occ: 0.4 });
      for (let i = -1; i <= 1; i++) {
        vfx.shape.emit({ shape: 'shard', mode: 'axial', pos: [g.x + i * 0.16, g.y + 0.18, g.z],
          dir: [i * 0.4, 1, 0], vel: [i * 0.6, 0.8, 0], size: [0.55, 0.16], grow: [0.7, 1.05],
          delay: 0.035, life: 0.22, color: [pal.mid, pal.tail], intensity: 0.7, occ: 0.65 });
      }
      dustRing(vfx, gx, gy, gz, { radius: 1.2, alpha: 0.7, life: 0.85 });
      dustPuffs(vfx, gx, gy, gz, { n: 4, spread: 0.3, size: [0.16, 0.4], alpha: 0.4 });
      vfx.light(g, { color: pal.mid, intensity: 2.03, distance: 2, life: 0.1 });
      accent(0.55);
      return;
    }

    // Real heavy moves carry knockdown; retain their weight-specific contact at +0.
    if (kind === 'heavy' || kind === 'knockdown') {
      // C2 r17 HEAVY = a broken fan: a wide spread of broad red-orange blades of uneven length thrown along the hit,
      // the two longest snapped off into fragments, heavy inked chunks flying out, a red glow mass and a thick
      // elliptical shock held over two frames. The fan dies by ~85 ms and the fragments carry the read after it.
      const finisher = o.moveId === 'close_finisher';
      const R = 116 * bodyK * (finisher ? 1.06 : 1), j = () => r.range(-0.08, 0.08);
      const LEN = [0.7, 1.25, 0.78, 1.42, 0.66, 1.15, 0.72], N = LEN.length, SPREAD = 1.15;
      const HB = [1.2, 0.17, 0.015], HC = [0.55, 0.03, 0.006];
      const spikes = LEN.map((l, i) => ({ a: swA + (i / (N - 1) - 0.5) * 2 * SPREAD + j(), len: R * l * r.range(0.92, 1.06),
        w: R * (0.24 + l * 0.2), taper: 0.75, ink: 4.5, spine: 0.2, heat: 0.5, hold: 0.035, life: 0.05,
        body: i % 3 === 2 ? [0.8, 0.09, 0.01] : HB, wt: l }));
      spikes.push({ a: swA + Math.PI - 0.5 + j(), len: R * 0.42, w: R * 0.3, ink: 3.5, hold: 0.035, life: 0.05 },
        { a: swA + Math.PI + 0.45 + j(), len: R * 0.34, w: R * 0.26, ink: 3.5, hold: 0.035, life: 0.05 });
      const pl = placeBurst(spikes, swA, R, cx, cy, guards, victimRect), A = swA + pl.aim;
      const qo = shifted(vfx, q, A, -pl.shift, px), at = { px, guards, cx: pl.ox, cy: pl.oy };
      // snap the two longest blades: their outer third leaves as a fragment
      const snapped = [3, 1].map(i => spikes[i]).map(k => { const cut = k.len * 0.64; const f = { a: k.a, start: cut * 1.02, len: k.len - cut,
        w: k.w * 0.42, dist: R * r.range(0.9, 1.3), life: 0.2, hold: 0.02, taper: 0.7, ink: 4, body: HB, cool: HC }; k.len = cut; return f; });
      const halo = glowMass(vfx, qo, A, { ...at, ahead: R * 0.35, rx: R * 1.8, ry: R * 1.3,
        color: [0.95, 0.22, 0.03], tail: [0.45, 0.05, 0.01], life: 0.09, hold: 0.035, core: 0.15 });
      const probe = impactStar(vfx, qo, spikes, { ...at, body: HB, cool: HC, life: 0.05, hold: 0.035, heat: 0.5 });
      const chunks = [];
      for (let i = 0; i < 6; i++) {
        const dark = i % 3 === 1;
        chunks.push({ a: A + ((i + 0.5) / 6 - 0.5) * 1.9 + j(), start: R * r.range(0.3, 0.55), dist: R * r.range(1.3, 2.1),
          len: R * r.range(0.28, 0.4), w: R * r.range(0.17, 0.24), life: r.range(0.2, 0.27), hold: 0.02, spin: r.range(-5, 5),
          taper: 0.5, ink: 3.5, heat: dark ? 0.35 : 0.9, spine: dark ? 0.2 : 0.35,
          body: dark ? [0.36, 0.07, 0.02] : [1.45, 0.42, 0.04], cool: dark ? [0.2, 0.03, 0.01] : [0.7, 0.08, 0.01] });
      }
      const frags = throwFragments(vfx, qo, [...snapped, ...chunks], at);
      coreGlow(vfx, qo, { size: 0.4 * R * px, color: '#fff0d0', tail: '#ff7a20', intensity: 1.2, life: 0.07, hold: 0.04, core: 0.5 });
      // Shock: a thick bright ellipse over the 0 / 33 ms frames only (gone by 66 ms, so it never settles into an
      // emblem), then a copper shock crescent that travels on along the hit. Both stop short of bystander heads/torsos.
      const sc = R * 0.15, sx = pl.ox + Math.cos(A) * sc, sy = pl.oy - Math.sin(A) * sc;
      let ringR = R * 1.1;
      for (const g of guards) ringR = Math.min(ringR, rectDistance(sx, sy, g) - 2);
      const sd = camDir(vfx, A), so = sc * px;
      if (ringR > R * 0.35 && !vfx.debugHideRing) vfx.shape.emit({ shape: 'ripple', pos: [qo.x + sd.x * so, qo.y + sd.y * so, qo.z + sd.z * so + 0.02], rot: A,
        size: [ringR * 2 * px, ringR * 1.56 * px], life: 0.045, hold: 0.025, color: [[1.9, 1.05, 0.38, 1], [1.2, 0.28, 0.04, 0.3]], occ: 0.3, ease: 'out',
        p0: [0.55, 0.12, 0.1, 0], p1: [0.85, 0.09, 0.1, 0] });
      const shock = shockFront(vfx, qo, A, { ...at, R, start: R * 0.55, dist: R * 1.0, half: R * 0.75 });
      vfx.starProbe?.({ kind, moveId: o.moveId, centre: [cx, cy], origin: [Math.round(pl.ox), Math.round(pl.oy)], shift: pl.shift, R, aim: pl.aim, swA: +swA.toFixed(3), halo, ringR: Math.round(ringR), shock, spikes: probe, frags, guards, victim: victimRect });
      sparkSpray(vfx, q, sw, { n: 14, speed: [8, 15], cone: 0.7, life: [0.12, 0.3], color: [pal.hot, pal.tail], intensity: 2.088, gravity: 11, floor: gy + 0.02 });
      bodyPop(true);
      const arm=o.attacker?.model?.sockets?.R;
      if(arm) contactFill(o.attacker.modelRoot,arm.getWorldPosition(new THREE.Vector3()),{radius:.68,strength:.65,life:.075});
      if (nearGround) {
        // ground flash + short glowing crack under the struck body
        // (short lives: these planes cover more pixels than the star; perf A/B r16)
        vfx.shape.emit({ shape: 'glow', mode: 'plane', pos: [gx, gy + .035, gz], size: [2.6, 2.1], life: .065, color: ['#ffc063', '#f47d20'], intensity: 1.8, p0: [2.2, .35] });
        crackDecal(vfx, gx, gy, gz, { radius: 0.6, glow: '#ff9a38', glowIntensity: 1.8, life: 0.2 });
        groundRing(vfx, gx, gy, gz, { radius: .9, color: ['#a68b69', '#65513d'], intensity: .34, life: .08, thick: [.14, .065], breakup: .90 });
        dustRing(vfx, gx, gy, gz, { radius: .82, alpha: .55, life: .30, n: 6, band: false, size: [.15,.35] });
      }
      embers(vfx, q, { n: 5, dir, color: [pal.hot, pal.tail] });
      vfx.light({x:p.x,y:gy+.65,z:p.z+.18}, { color: '#ffd478', intensity: small ? 2.6 : 6, distance: small ? 1.3 : 2.6, life: .06 });
      accent(0.55);
      return;
    }

    vfx.fire.emit({clip:'blunt',pos:[q.x,q.y,q.z],size:[extent*1.6,extent*1.4],life:.15,rot:swA,core:7,radiance:1.15});
    // KO: freeze-flash + soul wisp
    coreGlow(vfx, q, { size: 0.38, color: pal.mid, tail: pal.mid, intensity: 1.392, life: 0.12, hold: hs, core: 0.15 });
    flare(vfx, q, { width: 4.2, height: 0.42, color: ['#e4b440', '#a51e4c'], intensity: 0.95, life: 0.2, hold: hs });

    vfx.shape.emit({ shape: 'ring', pos: [q.x, q.y, q.z - 0.05], size: [2.1, 2.1], life: 0.3, hold: hs * 0.6, color: ['#e8b63f', '#a82855'], alpha: [1, 0], intensity: 0.8, p0: [0.55, 0.035, 0.8, 1], p1: [0.95, 0.025, 0.8, 1] });
    sparkSpray(vfx, q, sw, { n: 22, speed: [9, 18], cone: 0.8, life: [0.14, 0.36], color: [pal.hot, pal.tail], intensity: 2.32, gravity: 10, floor: gy + 0.02 });
    // soul wisp: a pale streak lifts off the body right after the freeze
    vfx.shape.emit({ shape: 'line', mode: 'axial', pos: [q.x, q.y + 0.9, q.z + 0.05], dir: [0, 1, 0], size: [1.8, 0.16], vel: [0, 2.5, 0], drag: 2, grow: [0.3, 1.2], growY: [1, 0.3],
      life: 0.45, delay: hs * 0.8, color: ['#e8f4ff', '#7aa0ff'], alpha: [1, 0], intensity: 0.928, p0: [0.5, 1, 1], occ: 0.2 });
    for (let i = 0; i < 6; i++) {
      vfx.add.emit({ pos: [q.x + r.range(-0.25, 0.25), q.y + r.range(0, 0.4), q.z + 0.05], vel: [r.range(-0.4, 0.4), r.range(1.8, 3.5), 0], life: r.range(0.5, 0.9), delay: hs * 0.8 + i * 0.03,
        size: [0.06, 0.02], color: ['#eef6ff', '#6a8cff'], intensity: 1.392, shape: 'ember', gravity: -0.5, drag: 1.2 });
      vfx.add.emit({ pos: [q.x + r.range(-0.7, 0.7), q.y + r.range(-0.5, 0.6), q.z + 0.05], life: 0.22, delay: 0.02 + i * 0.04, size: [0.2, 0.55], color: [pal.glint, pal.mid], intensity: 1.16, shape: 'glint', rot: r.range(-0.3, 0.3) });
    }
    if (nearGround) {
      dustRing(vfx, gx, gy, gz, { radius: 1.6, alpha: 0.7, life: 0.9 });
      groundRing(vfx, gx, gy, gz, { radius: 2.4, color: [pal.hot, pal.tail], intensity: 0.464, life: 0.45, delay: 0.06 });
    }
    vfx.light(q, { color: pal.mid, intensity: 2.9, distance: 2.4, life: 0.14 });
    accent(0.6);
  },
};
