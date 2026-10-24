// Boss set-piece kit (private helper): projectiles, telegraphed ground spells, stolen-spell choreography and
// procedural boss dressing (bone pile, snake swarm, serpent coils, cape, captives, arena cracks, Copper Ax finale).
// Sim logic runs on game ticks through a tiny per-boss system (fxSystem(boss)); visuals use the shared VFX pools
// (vfx.shape / vfx.add / vfx.alpha) so they cost no extra draw calls, plus a handful of lit meshes.
//
//   const fx = fxSystem(boss)                 → { sparks: [], update(), dispose(), add(obj), later(ticks, fn) }
//   spark(fx, boss, target, { speed, turn, life, angle, damage })        homing ground spark (jump it)
//   eruption(fx, boss, pos, { delay, radius, damage, color })            telegraph ring → witchfire pillar
//   stolenSpell(fx, boss, hero, element)                                 that hero's element cast back at every hero
//   bonePile / snakeSwarm / serpentCoils / cape / captives / arenaCracks / copperAxImpale   (meshes, see each)
import * as THREE from 'three';
import { EV } from '../../core/EventBus.js';
import { reportError } from '../../core/log.js';
import { canvasTexture, normalFromNoise } from '../../assets/proceduralTextures.js';
import { applyCharacterLook } from '../../render/characterLook.js';
import { bossRim, bossGrade, bossLook } from './_look.js';

const WITCH = { core: '#eaffe4', hot: '#8dff9a', mid: '#2ad05a', tail: '#0a5a24', dark: '#07120a' };
export const ELEMENT_COLORS = {
  earth: { core: '#fff2c0', hot: '#ffd060', mid: '#d09020', ring: '#e8b040' },
  fire: { core: '#fff0c0', hot: '#ffb03a', mid: '#ff4a10', ring: '#ff7030' },
  storm: { core: '#f0fcff', hot: '#a8e8ff', mid: '#40a0ff', ring: '#80c8ff' },
};
export const HERO_ELEMENT = { brann: 'earth', seraphine: 'fire', gorrim: 'storm' };
export function elementOf(hero) {
  const d = hero && hero.def;
  return (d && d.magic && d.magic.element) || HERO_ELEMENT[hero && (hero.heroId || hero.typeId || (d && d.id))] || 'fire';
}

// ------------------------------------------------------------------------------------------------ per-boss system
export function fxSystem(boss) {
  const game = boss.game;
  const fx = {
    boss, game, sparks: [], jobs: [], objs: [], t: 0,
    add(o) { if (game.renderer && game.renderer.scene) game.renderer.scene.add(o); fx.objs.push(o); return o; },
    remove(o) { if (o && o.parent) o.parent.remove(o); disposeTree(o); fx.objs = fx.objs.filter((x) => x !== o); },
    later(ticks, fn) { fx.jobs.push({ at: fx.t + Math.max(1, ticks | 0), fn }); },
    update() {
      fx.t++;
      for (let i = fx.jobs.length - 1; i >= 0; i--) if (fx.t >= fx.jobs[i].at) { const j = fx.jobs.splice(i, 1)[0]; try { j.fn(); } catch (e) { reportError('bossfx.job', e); } }
      for (let i = fx.sparks.length - 1; i >= 0; i--) if (!stepSpark(fx, fx.sparks[i])) fx.sparks.splice(i, 1);
    },
    dispose() { for (const o of [...fx.objs]) fx.remove(o); fx.sparks.length = 0; fx.jobs.length = 0; },
  };
  return fx;
}

function disposeTree(o) {
  if (!o) return;
  o.traverse((c) => {
    if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose();
    const ms = c.material ? [].concat(c.material) : [];
    for (const m of ms) if (!m.userData.shared) m.dispose();
  });
}

const heroesOf = (game) => game.world.query({ kind: 'hero' }).filter((h) => h.alive && !h.removed);
const vfxOf = (game) => (game.vfx && game.vfx.shape ? game.vfx : null);
const shake = (game, t) => { if (game.cameraRig && game.cameraRig.shake) game.cameraRig.shake(t); };

// ------------------------------------------------------------------------------------------------ homing spark
/** Plant a spark that crawls along the ground after `target`. Jumping over it (hero y > 0.35) dodges it. */
export function spark(fx, boss, target, o = {}) {
  const f = boss.facing;
  const a0 = Math.atan2(0, f) + (o.angle || 0);
  const s = {
    x: boss.pos.x + f * (o.offset ?? 1.6), z: boss.pos.z, dir: a0, target, speed: o.speed ?? 3.4, turn: o.turn ?? 2.0,
    life: o.life ?? 330, age: 0, damage: o.damage ?? 8, hit: false, arm: o.arm ?? 10, seed: Math.random() * 10,
  };
  fx.sparks.push(s);
  const v = vfxOf(fx.game);
  if (v) {
    v.shape.emit({ shape: 'burst', mode: 'plane', pos: [s.x, 0.04, s.z], size: [1.6, 1.6], life: 0.35, color: [WITCH.core, WITCH.mid], intensity: 5, grow: [0.4, 1.3] });
    v.shape.emit({ shape: 'crack', mode: 'plane', pos: [s.x, 0.03, s.z], size: [1.4, 1.4], life: 1.2, color: [WITCH.hot, WITCH.tail], intensity: 3 });
  }
  fx.game.bus.emit('boss:spark', { boss, pos: { x: s.x, y: 0, z: s.z } });
  return s;
}

function stepSpark(fx, s) {
  const game = fx.game, dt = 1 / 60;
  s.age++;
  if (s.age > s.life || s.hit) { sparkPop(fx, s); return false; }
  let t = s.target;
  if (!t || !t.alive || t.removed) t = s.target = heroesOf(game).sort((a, b) => Math.abs(a.pos.x - s.x) - Math.abs(b.pos.x - s.x))[0] || null;
  if (t) {
    const want = Math.atan2(t.pos.z - s.z, t.pos.x - s.x);
    let d = want - s.dir; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const turn = s.turn * dt * (s.age < 24 ? 0.3 : 1);
    s.dir += Math.max(-turn, Math.min(turn, d));
  }
  const sp = s.speed * Math.min(1, s.age / 20);
  s.x += Math.cos(s.dir) * sp * dt; s.z += Math.sin(s.dir) * sp * dt;
  const b = game.world.band || { zMin: -3, zMax: 3 };
  if (s.z < b.zMin || s.z > b.zMax) { s.z = Math.max(b.zMin, Math.min(b.zMax, s.z)); s.dir = -s.dir; }
  // visuals: crawling witchfire orb + crackle sparks + scorched trail
  const v = vfxOf(game);
  if (v) {
    const fl = 0.8 + 0.3 * Math.sin(s.age * 0.9 + s.seed);
    v.shape.emit({ shape: 'orb', pos: [s.x, 0.22, s.z], size: [0.55 * fl, 0.55 * fl], life: 0.07, color: [WITCH.core, WITCH.hot], intensity: 7, alpha: [1, 1] });
    if (s.age % 2 === 0) v.add.emit({ pos: [s.x, 0.15, s.z], vel: [(Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 2], life: 0.35, size: [0.06, 0.01], color: [WITCH.core, WITCH.mid], intensity: 6, shape: 'spark', stretch: 0.03, gravity: 7, drag: 1 });
    if (s.age % 4 === 0) v.shape.emit({ shape: 'glow', mode: 'plane', pos: [s.x, 0.025, s.z], size: [0.9, 0.9], life: 0.6, color: [WITCH.mid, WITCH.tail], intensity: 2.2 });
  }
  if (s.age < s.arm) return true;
  for (const h of heroesOf(game)) {
    if (h.pos.y > 0.35 || !h.hurtable || (h.invuln || 0) > 0) continue;
    if (Math.abs(h.pos.x - s.x) < 0.55 && Math.abs(h.pos.z - s.z) < 0.5) {
      if (game.combat) game.combat.applyHit(fx.boss, h, { damage: s.damage, knockdown: true, launch: 5, knockback: 3.5, hitstop: 9, hitstun: 28, level: 'magic', shake: 0.3, element: 'storm' }, { moveId: 'boss_spark', dir: Math.sign(h.pos.x - s.x) || 1 });
      s.hit = true;
      return true;
    }
  }
  return true;
}

function sparkPop(fx, s) {
  const v = vfxOf(fx.game);
  if (!v) return;
  v.shape.emit({ shape: 'burst', pos: [s.x, 0.3, s.z], size: [1.2, 1.2], life: 0.3, color: [WITCH.core, WITCH.mid], intensity: 6 });
  for (let i = 0; i < 10; i++) v.add.emit({ pos: [s.x, 0.25, s.z], vel: [(Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 4], life: 0.5, size: [0.07, 0.01], color: [WITCH.core, WITCH.mid], intensity: 6, shape: 'spark', stretch: 0.03, gravity: 9 });
}

// ------------------------------------------------------------------------------------------------ ground spells
/** Telegraphed witchfire eruption at pos: a rune ring for `delay` ticks, then a pillar that floors grounded heroes. */
export function eruption(fx, boss, pos, o = {}) {
  const game = fx.game, v = vfxOf(game);
  const delay = o.delay ?? 54, r = o.radius ?? 1.25, col = o.colors || WITCH;
  const p = { x: pos.x, z: pos.z };
  if (v) {
    v.shape.emit({ shape: 'ring', mode: 'plane', pos: [p.x, 0.03, p.z], size: [r * 2.2, r * 2.2], life: delay / 60, color: [col.hot, col.mid], intensity: 3.2, grow: [1.25, 0.95], alpha: [0.2, 1] });
    v.shape.emit({ shape: 'crack', mode: 'plane', pos: [p.x, 0.028, p.z], size: [r * 1.8, r * 1.8], life: delay / 60 + 0.8, color: [col.hot, col.tail || col.mid], intensity: 2.4, alpha: [0.3, 1] });
    v.shape.emit({ shape: 'glow', mode: 'plane', pos: [p.x, 0.02, p.z], size: [r * 2.4, r * 2.4], life: delay / 60, color: [col.mid, col.mid], intensity: 1.2, alpha: [0.1, 0.8] });
  }
  game.bus.emit('ai:telegraph', { actor: boss, moveId: 'boss_eruption', kind: 'unblockable', pos: { x: p.x, y: 0, z: p.z }, activeIn: delay });
  fx.later(delay, () => {
    if (v) {
      for (let i = 0; i < 7; i++) v.shape.emit({ shape: 'flame', mode: 'axial', pos: [p.x + (Math.random() - 0.5) * r, 0, p.z + (Math.random() - 0.5) * r * 0.6], dir: [0, 1, 0], size: [2.6 + Math.random() * 1.8, 0.7], life: 0.7 + Math.random() * 0.3, color: [col.core, col.mid], intensity: 5, grow: [0.5, 1.1] });
      v.shape.emit({ shape: 'burst', mode: 'plane', pos: [p.x, 0.05, p.z], size: [r * 2.6, r * 2.6], life: 0.4, color: [col.core, col.mid], intensity: 6 });
      for (let i = 0; i < 16; i++) v.alpha.emit({ pos: [p.x + (Math.random() - 0.5) * r, 0.4 + Math.random(), p.z], vel: [(Math.random() - 0.5), 2 + Math.random() * 2, (Math.random() - 0.5) * 0.5], life: 1.4, size: [0.5, 1.4], color: [WITCH.dark, WITCH.dark], alpha: [0.8, 0], drag: 1.2 });
      for (let i = 0; i < 18; i++) v.add.emit({ pos: [p.x, 0.3, p.z], vel: [(Math.random() - 0.5) * 5, 3 + Math.random() * 6, (Math.random() - 0.5) * 3], life: 0.8, size: [0.08, 0.01], color: [col.core, col.mid], intensity: 6, shape: 'spark', stretch: 0.03, gravity: 6 });
    }
    shake(game, 0.3);
    game.bus.emit('boss:eruption', { boss, pos: p });
    if (!boss.alive && !o.always) return;
    for (const h of heroesOf(game)) {
      if (h.pos.y > 0.5 || !h.hurtable) continue;
      if (Math.hypot(h.pos.x - p.x, (h.pos.z - p.z) * 1.3) < r && game.combat) game.combat.applyHit(boss, h, { damage: o.damage ?? 9, knockdown: true, launch: 6.5, knockback: 1.5, hitstop: 10, hitstun: 28, level: 'magic', shake: 0.35 }, { moveId: o.moveId || 'boss_eruption', dir: Math.sign(h.pos.x - boss.pos.x) || 1 });
    }
  });
}

/** Phase-2 mirror: the Copper Ax relic lets Morvane throw `hero`'s own element back at every hero (telegraphed). */
export function stolenSpell(fx, boss, hero, element = elementOf(hero)) {
  const game = fx.game, v = vfxOf(game), C = ELEMENT_COLORS[element] || ELEMENT_COLORS.fire;
  const colors = { core: C.core, hot: C.hot, mid: C.mid, tail: C.mid };
  game.bus.emit('boss:stolenSpell', { boss, hero, element });
  if (game.renderer && game.renderer.post && game.renderer.post.pulse) game.renderer.post.pulse({ ca: 0.008, desat: 0.3, duration: 0.8 });
  if (v) {
    const hp = { x: boss.pos.x + boss.facing * 0.5, y: boss.height * 0.8, z: boss.pos.z + 0.2 };
    v.shape.emit({ shape: 'star', pos: [hp.x, hp.y, hp.z], size: [2.2, 2.2], life: 0.9, color: [C.core, C.mid], intensity: 6, spin: 3 });
    v.shape.emit({ shape: 'ring', pos: [hp.x, hp.y, hp.z], size: [3.2, 3.2], life: 0.7, color: [WITCH.hot, C.mid], intensity: 4, grow: [0.2, 1.4] });
  }
  const targets = heroesOf(game);
  targets.forEach((h, i) => {
    const pos = { x: h.pos.x, z: h.pos.z };
    const delay = 58 + i * 10;
    eruption(fx, boss, pos, { delay, radius: 1.35, damage: 10, colors, moveId: 'boss_stolen_' + element });
    fx.later(delay, () => {
      if (!v) return;
      const P = [pos.x, 0.05, pos.z];
      if (element === 'storm') {
        game.vfx.spawn('fx_bolt', { from: { x: pos.x + 0.4, y: 9, z: pos.z - 0.5 }, to: { x: pos.x, y: 0.05, z: pos.z }, width: 0.5, element: 'storm', impact: true });
        game.vfx.spawn('fx_bolt', { from: { x: pos.x - 0.7, y: 8, z: pos.z - 0.3 }, to: { x: pos.x + 0.2, y: 0.05, z: pos.z }, width: 0.3, element: 'storm', impact: false });
      } else if (element === 'earth') {
        game.vfx.spawn('fx_rock_burst', { pos: { x: P[0], y: 0.1, z: P[2] }, count: 18, speed: 6, size: 0.14, element: 'earth' });
        game.vfx.spawn('fx_shockwave', { pos: { x: P[0], y: 0.02, z: P[2] }, radius: 1.8, element: 'earth', dust: true, debris: 10 });
      } else {
        game.vfx.spawn('fx_flame', { pos: { x: P[0], y: 0, z: P[2] }, height: 3.2, width: 1.2, count: 10, element: 'fire' });
      }
      game.vfx.spawn('magic_burst', { pos: { x: P[0], y: 0, z: P[2] }, element, power: 2 });
    });
  });
}

// ------------------------------------------------------------------------------------------------ materials
let _boneMat = null, _scaleMat = null;
function boneMat() {
  if (_boneMat) return _boneMat;
  const tex = canvasTexture('boss_bone', 256, 256, (g, w, h) => {
    g.fillStyle = '#9c9076'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const v = 90 + Math.random() * 90; g.fillStyle = `rgba(${v},${v * 0.92},${v * 0.72},0.25)`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1 + Math.random() * 2); }
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(40,34,24,0.18)'; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 8 + Math.random() * 20); }
  }, { repeat: true });
  _boneMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0, color: '#c8bea4', normalMap: normalFromNoise({ size: 128, scale: 14, strength: 1.4 }) });
  _boneMat.userData.shared = true;
  return _boneMat;
}

export function scaleMat() {
  if (_scaleMat) return _scaleMat;
  const tex = canvasTexture('boss_scales', 256, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#0c0a08'); grd.addColorStop(0.55, '#221a12'); grd.addColorStop(0.82, '#5a3a18'); grd.addColorStop(1, '#c89040');   // r6: black-bronze adder, gold belly (was jade — lost on the lime floor)
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const R = 11;
    for (let y = 0; y < h + R; y += R * 0.8) for (let x = 0; x < w + R; x += R * 1.6) {
      const ox = (Math.round(y / (R * 0.8)) % 2) * R * 0.8;
      g.strokeStyle = 'rgba(6,14,8,0.8)'; g.lineWidth = 2; g.beginPath(); g.arc(x + ox, y, R, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      g.fillStyle = 'rgba(230,180,110,0.12)'; g.beginPath(); g.arc(x + ox, y - R * 0.35, R * 0.45, 0, 7); g.fill();
    }
    for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(10,20,10,0.35)'; g.fillRect(x, 0, 10, h * 0.45); } // dorsal bands
  }, { repeat: true });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(8, 1);
  const nrm = normalFromNoise({ size: 128, scale: 30, strength: 2.2 });
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping; nrm.repeat.set(8, 1);
  _scaleMat = new THREE.MeshStandardMaterial({ map: tex, normalMap: nrm, roughness: 0.42, metalness: 0.08, color: '#e8e0d8', emissive: '#4a1a06', emissiveIntensity: 0.22 });
  _scaleMat.userData.shared = true;
  return _scaleMat;
}

// ------------------------------------------------------------------------------------------------ dressing
/** Bone pile (instanced long bones + skulls) the Adder King forms upon. */
export function bonePile(fx, x, z, { radius = 1.9, count = 150 } = {}) {
  const g = new THREE.Group(); g.name = 'boss_bonepile';
  const bone = new THREE.CapsuleGeometry(0.035, 0.42, 3, 7);
  const knob = new THREE.SphereGeometry(0.055, 8, 6);
  const mat = boneMat();
  const im = new THREE.InstancedMesh(bone, mat, count), km = new THREE.InstancedMesh(knob, mat, count * 2);
  const skull = new THREE.SphereGeometry(0.1, 12, 10); skull.scale(1, 0.92, 1.2);
  const sk = new THREE.InstancedMesh(skull, mat, 12);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const rnd = mulberry(77);
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * radius, hgt = Math.max(0, (1 - d / radius) ** 1.4 * 0.9);
    p.set(x + Math.cos(a) * d, hgt * rnd() + 0.03, z + Math.sin(a) * d * 0.7);
    e.set(rnd() * 3, rnd() * 6.3, Math.PI / 2 + (rnd() - 0.5) * 0.9); q.setFromEuler(e);
    s.setScalar(0.7 + rnd() * 0.7); m.compose(p, q, s); im.setMatrixAt(i, m);
    const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(0.25 * s.x);
    for (let k = 0; k < 2; k++) { const pk = p.clone().addScaledVector(ax, k ? 1 : -1); m.compose(pk, q, new THREE.Vector3(s.x, s.x * 0.8, s.x)); km.setMatrixAt(i * 2 + k, m); }
  }
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * radius * 0.9;
    p.set(x + Math.cos(a) * d, 0.1 + Math.max(0, (1 - d / radius)) * 0.55, z + Math.sin(a) * d * 0.7);
    e.set((rnd() - 0.5) * 0.8, rnd() * 6.3, (rnd() - 0.5) * 0.8); q.setFromEuler(e); s.setScalar(0.8 + rnd() * 0.5);
    m.compose(p, q, s); sk.setMatrixAt(i, m);
  }
  for (const o of [im, km, sk]) { o.castShadow = true; o.receiveShadow = true; g.add(o); }
  return fx.add(g);
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function snakeGeo(len = 1.2, r = 0.05, seg = 40) {
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(i / 8 * len, Math.sin(i * 0.7) * 0.02, Math.sin(i * 1.3) * 0.11 * (1 - i / 10)));
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, seg, r, 8, false);
  // taper to a tail (u=0) and a blunt head (u=1)
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i), k = Math.min(1, u * 3) * (u > 0.9 ? 1.25 : 1);
    pos.setY(i, pos.getY(i) * k); pos.setZ(i, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Swarm of snakes spiralling in to a point (the Adder King's formation). update(k01) drives it; 1 = converged. */
export function snakeSwarm(fx, center, { n = 18, radius = 3.4 } = {}) {
  const g = new THREE.Group(); g.name = 'boss_snakes';
  const mat = scaleMat();
  const geo = snakeGeo(1.1, 0.05);
  const list = [];
  const rnd = mulberry(9);
  for (let i = 0; i < n; i++) {
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true;
    const base = { a: (i / n) * Math.PI * 2 + rnd() * 0.4, r: radius * (0.7 + rnd() * 0.5), h: rnd() * 0.3, spd: 0.8 + rnd() * 0.6, ph: rnd() * 6 };
    g.add(mesh); list.push({ mesh, base });
  }
  const eye = new THREE.MeshBasicMaterial({ color: '#b0ff80', toneMapped: false });
  for (const s of list) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), eye); e.position.set(1.12, 0.03, 0); s.mesh.add(e); }
  fx.add(g);
  const api = {
    group: g,
    update(k, time) {
      const kk = Math.min(1, Math.max(0, k));
      for (const s of list) {
        const b = s.base;
        const a = b.a + kk * 5.5 * b.spd + Math.sin(time * 3 + b.ph) * 0.1;
        const r = b.r * (1 - kk) ** 1.2 + 0.25;
        const y = b.h + kk * kk * (center.y - 0.2) + 0.04;
        s.mesh.position.set(center.x + Math.cos(a) * r, y, center.z + Math.sin(a) * r * 0.8);
        s.mesh.rotation.set(Math.sin(time * 8 + b.ph) * 0.3, -a - Math.PI / 2 + 0.5, kk * 0.9);
        const sc = 1 - Math.max(0, kk - 0.85) * 5; s.mesh.scale.setScalar(Math.max(0.01, sc));
      }
    },
    dispose() { fx.remove(g); },
  };
  api.update(0, 0);
  return api;
}

/** Phase-2 serpent coils: a thick serpent wound round the torso + two rearing heads over the shoulders. Parented to
 *  boss.body (yawed; model faces +Z in body space). update(time, strike01) animates the coil breathing and heads. */
export function serpentCoils(fx, boss) {
  const H = boss.height, g = new THREE.Group(); g.name = 'boss_coils';
  const mat = scaleMat();
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, a = t * Math.PI * 2 * 2.6;
    const rr = H * (0.17 + 0.05 * Math.sin(t * Math.PI));
    pts.push(new THREE.Vector3(Math.cos(a) * rr, H * (0.3 + t * 0.34), Math.sin(a) * rr * 0.85));
  }
  const coil = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 220, H * 0.045, 12, false), mat);
  coil.castShadow = true; g.add(coil);
  const heads = [];
  for (const sx of [1, -1]) {
    const neckPts = [new THREE.Vector3(sx * H * 0.16, H * 0.62, -H * 0.05), new THREE.Vector3(sx * H * 0.25, H * 0.78, -H * 0.08), new THREE.Vector3(sx * H * 0.24, H * 0.92, H * 0.02), new THREE.Vector3(sx * H * 0.2, H * 0.98, H * 0.12)];
    const neck = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(neckPts), 40, H * 0.035, 10, false), mat);
    neck.castShadow = true; g.add(neck);
    const head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(H * 0.055, 14, 10), mat); skull.scale.set(1, 0.75, 1.5);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(H * 0.04, H * 0.09, 10), mat); snout.rotation.x = Math.PI / 2; snout.position.z = H * 0.07; snout.scale.set(1, 1, 0.6);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(H * 0.09, 14, 10), mat); hood.scale.set(1.3, 1.1, 0.25); hood.position.set(0, -H * 0.01, -H * 0.05);
    const eyeM = new THREE.MeshBasicMaterial({ color: '#c8ff70', toneMapped: false });
    for (const ex of [1, -1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(H * 0.009, 6, 4), eyeM); e.position.set(ex * H * 0.03, H * 0.02, H * 0.05); head.add(e); }
    const fangM = new THREE.MeshStandardMaterial({ color: '#e8e0c8', roughness: 0.4 });
    for (const ex of [1, -1]) { const f = new THREE.Mesh(new THREE.ConeGeometry(H * 0.006, H * 0.035, 5), fangM); f.rotation.x = Math.PI; f.position.set(ex * H * 0.015, -H * 0.03, H * 0.09); head.add(f); }
    for (const o of [skull, snout, hood]) { o.castShadow = true; head.add(o); }
    head.position.copy(neckPts[3]); g.add(head);
    heads.push({ head, base: neckPts[3].clone(), sx });
  }
  boss.body.add(g); fx.objs.push(g);
  g.scale.setScalar(0.01);
  return {
    group: g, heads,
    update(time, grow = 1, strike = 0) {
      g.scale.setScalar(Math.max(0.01, grow));
      coil.rotation.y = Math.sin(time * 0.8) * 0.12;
      coil.scale.set(1 + 0.03 * Math.sin(time * 2.2), 1, 1 + 0.03 * Math.sin(time * 2.2 + 1));
      for (const h of heads) {
        const w = Math.sin(time * 2 + h.sx) * 0.08;
        h.head.position.set(h.base.x + w * H * 0.2, h.base.y + Math.sin(time * 3 + h.sx) * H * 0.02, h.base.z + strike * H * 0.35);
        h.head.rotation.set(-0.25 + strike * 0.5 + Math.sin(time * 2.6 + h.sx) * 0.1, h.sx * (0.35 - strike * 0.3) + w, 0);
      }
    },
  };
}

/** Heavy war cape (closed, thick cloth — never a single-sided card): hangs from the shoulders behind the back,
 *  sways with the boss's velocity. Parented to the chest bone. update(dt)
 *  C1 r9 (board: "near-black flat slab, dead-straight edge, no fold shading"): wrapped round the shoulders, flared to
 *  the hem, three vertical pleats (real geometry → lit fold shading, + baked crease AO in the maps), a ragged hem that
 *  follows the pleats, and its own materials: outer cloth / contrasting LINING (inner face + cut edges) / trim. */
function foldNormal() {
  return canvasTexture('boss_cape_folds12', 128, 256, (g2, w, h) => {
    const img = g2.createImageData(w, h), hf = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1), fan = 1 + 0.35 * v;
      for (let x = 0; x < w; x++) {
        const u = (x / (w - 1)) * 2 - 1, uf = u / fan;
        let k = 0.55 * (0.35 + 0.65 * v) * Math.cos(uf * Math.PI * 6.5 + 1.1 + Math.sin(v * 3.1) * 0.6)
          + 0.32 * (0.3 + 0.7 * v) * Math.cos(uf * Math.PI * 11 + 0.4 + v * 2.2)
          + 0.22 * Math.max(0, 1 - v * 4) * Math.cos(u * Math.PI * 19 + 0.3);                            // collar gathers
        k += v > 0.86 ? 0.35 * ((v - 0.86) / 0.14) * Math.sin(u * 37 + Math.sin(u * 7) * 2) : 0;          // crumpled hem
        k += 0.04 * Math.sin(x * 2.7 + y * 0.31) * Math.sin(y * 1.9);                                     // weave trace
        hf[y * w + x] = k;
      }
    }
    const at = (x, y) => hf[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 3.2, dy = (at(x, y + 1) - at(x, y - 1)) * 3.2;
      const l = Math.sqrt(dx * dx + dy * dy + 1), i = (y * w + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g2.putImageData(img, 0, 0);
  }, { srgb: false });
}

export function cape(fx, boss, { color = '#1a2a1e', trim = '#b08a3a', lining = '#6a4a2a', width = 0.95, length = 1.0, top = 0.78 } = {}) {
  const H = boss.height, W = H * width * 0.36, L = H * length * 0.62, T = H * 0.014;
  const geo = new THREE.BoxGeometry(W, L, T, 30, 22, 1);
  geo.translate(0, -L / 2, 0);
  const pos = geo.attributes.position, uv = geo.attributes.uv, base = new Float32Array(pos.array);
  const PLEAT = 2.5, PH = Math.PI;   // 3 outward fold ridges (centre + both sides), 2 creases between
  // C2 r12 (board r11: "a smooth two-tone tube, no fold volume"): an uneven second fold harmonic (the ridges are no
  // longer one even sine), deeper pleats, and a fold normal map below (smaller folds between the big ones)
  const foldAt = (u) => (Math.cos(u * Math.PI * PLEAT + PH) + 0.4 * Math.cos(u * Math.PI * 5.5 + 0.7)) / 1.25;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1];
    const u = x / (W / 2), v = Math.min(1, -y / L);
    uv.setXY(i, x / W + 0.5, 1 - v);   // one mapping for both faces (Box mirrors -Z): baked creases line up with the pleats
    const fold = foldAt(u);
    let z = base[i * 3 + 2];
    z += H * 0.085 * u * u * (1 - 0.45 * v);               // wraps forward round the shoulders, opens toward the hem
    z -= H * 0.07 * v * v + H * 0.03 * v;                  // the hem kicks back off the calves (creases stay clear of the back)
    z += H * 0.044 * (0.25 + 0.75 * v) * fold;             // pleats, deepening toward the hem (C2 r12: 0.03 → 0.044)
    // r10 (board r9: "rigid slab with a straight diagonal edge"): 2½ gravity folds down the length — the side
    // silhouette (the back profile) bellies out and tucks in instead of running as one straight line; the bellies
    // are offset between the pleat ridges and the creases so the folds twist a little across the width.
    z -= H * 0.03 * Math.sin(v * Math.PI * 2.5 + 0.35 + 0.5 * fold) * Math.sin(v * Math.PI * 0.95 + 0.15);
    let yy = y;
    const v4 = v * v * v * v;
    yy -= L * v4 * (0.055 * (fold + 1) * 0.5 + 0.03 * Math.sin(u * 9.1 + 1.3) + 0.018 * Math.sin(u * 23.7) + 0.035 * u);   // ragged, uneven hem
    base[i * 3] = x * (1 + v * 0.42);
    base[i * 3 + 1] = yy;
    base[i * 3 + 2] = z;
  }
  pos.array.set(base);
  geo.computeVertexNormals();
  // crease AO / ridge sheen baked along u (outer face: recessed where fold > 0; the lining sees the opposite)
  const crease = (g2, w, h, outer) => {
    for (let x = 0; x < w; x++) {
      const u = (x / w) * 2 - 1, f = foldAt(u) * (outer ? 1 : -1);
      const dark = Math.max(0, f) ** 1.6 * 0.5, lit = Math.max(0, -f) ** 3 * 0.12;
      const gr = g2.createLinearGradient(0, 0, 0, h);   // creases deepen toward the hem like the pleats
      gr.addColorStop(0, `rgba(0,0,0,${dark * 0.35})`); gr.addColorStop(1, `rgba(0,0,0,${dark})`);
      g2.fillStyle = gr; g2.fillRect(x, 0, 1, h);
      if (lit > 0.005) { g2.fillStyle = `rgba(255,240,220,${lit})`; g2.fillRect(x, 0, 1, h); }
    }
  };
  const weave = (g2, w, h, a = 1) => {
    for (let i = 0; i < 700; i++) { g2.fillStyle = `rgba(0,0,0,${Math.random() * 0.06 * a})`; g2.fillRect(Math.random() * w, Math.random() * h, 1, 6 + Math.random() * 22); }
    for (let i = 0; i < 500; i++) { g2.fillStyle = `rgba(255,255,255,${Math.random() * 0.05 * a})`; g2.fillRect(Math.random() * w, Math.random() * h, 1, 4 + Math.random() * 12); }
  };
  const outerTex = canvasTexture('boss_cape12_' + color + trim, 256, 256, (g2, w, h) => {
    g2.fillStyle = color; g2.fillRect(0, 0, w, h);
    const lift = g2.createLinearGradient(0, 0, 0, h); lift.addColorStop(0, 'rgba(255,235,210,0.10)'); lift.addColorStop(0.5, 'rgba(255,235,210,0)'); lift.addColorStop(1, 'rgba(8,6,4,0.45)');
    g2.fillStyle = lift; g2.fillRect(0, 0, w, h);   // shoulders catch light, hem sinks into shadow
    weave(g2, w, h); crease(g2, w, h, true);
    g2.fillStyle = trim; g2.fillRect(0, 0, w, 9);   // embroidered collar band
    g2.fillStyle = 'rgba(0,0,0,0.35)'; g2.fillRect(0, 9, w, 2);
    // C2 r12: the full-length 7 px gold side borders read as ONE hard highlight stripe whenever the cape is seen edge-on
    // (board r11) — now a thin dark welt with sparse, aged-bronze stitch dashes
    g2.fillStyle = 'rgba(0,0,0,0.42)'; g2.fillRect(0, 0, 4, h); g2.fillRect(w - 4, 0, 4, h);
    g2.globalAlpha = 0.55; for (let y = 18; y < h - 30; y += 16) { g2.fillStyle = trim; g2.fillRect(1, y, 2, 4); g2.fillRect(w - 3, y, 2, 4); } g2.globalAlpha = 1;
    // hem: a dark weighted band with an embroidered serpent-scale border (lozenges) above the frayed edge
    const hy = h - 30;
    g2.fillStyle = 'rgba(0,0,0,0.38)'; g2.fillRect(0, hy, w, 30);
    g2.fillStyle = trim; g2.globalAlpha = 0.85; g2.fillRect(0, hy, w, 2); g2.fillRect(0, hy + 13, w, 1);
    for (let x = 4; x < w; x += 12) { g2.beginPath(); g2.moveTo(x, hy + 7); g2.lineTo(x + 4, hy + 3); g2.lineTo(x + 8, hy + 7); g2.lineTo(x + 4, hy + 11); g2.closePath(); g2.fill(); }
    g2.globalAlpha = 1;
    for (let x = 0; x < w; x += 3) { const d = 4 + Math.random() * 12; g2.fillStyle = 'rgba(0,0,0,0.55)'; g2.fillRect(x, h - d, 2, d); }   // frayed hem
  });
  const liningTex = canvasTexture('boss_cape12L_' + lining, 128, 256, (g2, w, h) => {
    g2.fillStyle = lining; g2.fillRect(0, 0, w, h);
    const sh = g2.createLinearGradient(0, 0, 0, h); sh.addColorStop(0, 'rgba(0,0,0,0.25)'); sh.addColorStop(0.4, 'rgba(255,240,220,0.06)'); sh.addColorStop(1, 'rgba(0,0,0,0.2)');
    g2.fillStyle = sh; g2.fillRect(0, 0, w, h);
    weave(g2, w, h, 0.7); crease(g2, w, h, false);
  });
  // C2 r12 fold normal map (was fBm noise: read as felt, no folds): vertical drapery folds between the big pleats that
  // fan out and deepen toward the hem, fine gathers under the collar, a crumpled weighted hem, a trace of weave. Same
  // material (normalMap was already bound) → same program.
  const nrm = foldNormal();
  // C2 r1 (board: "capes are unlit/flat"): the cape now takes the SAME actor light rig as the body — character look
  // (key + rim) and this boss's grade (key colour, rim colour/strength, scene grade; boss.lightRig handle → phase
  // pulses drive it too). Patched below right after creation, so the warm actor of the stage prewarm links the
  // program (kcaChar, non-skinned map+normalMap) and the live spawn reuses it. The old self-lit emissive floor
  // (0.3 / 0.2) is down to a trace — the key does that job now.
  const outer = new THREE.MeshStandardMaterial({ map: outerTex, roughness: 0.86, metalness: 0, normalMap: nrm, emissive: new THREE.Color(color).multiplyScalar(0.06) });
  const inner = new THREE.MeshStandardMaterial({ map: liningTex, roughness: 0.55, metalness: 0, normalMap: nrm, emissive: new THREE.Color(lining).multiplyScalar(0.04) });   // silk-ish lining: a touch of sheen
  // Box groups: +x, -x, +y, -y, +z (against the back = lining), -z (outer). Cut edges show the lining colour.
  // Re-pack the index into 2 groups (lining, outer) → 2 draws instead of 6.
  { const idx = geo.index.array, sel = (ids) => geo.groups.filter((gr, k) => ids.includes(k)).flatMap((gr) => Array.from(idx.subarray(gr.start, gr.start + gr.count)));
    const a = sel([0, 1, 3, 4]), o = sel([2, 5]);
    geo.setIndex([...a, ...o]); geo.clearGroups(); geo.addGroup(0, a.length, 0); geo.addGroup(a.length, o.length, 1); }
  const mesh = new THREE.Mesh(geo, [inner, outer]); mesh.castShadow = true; mesh.name = 'boss_cape';
  // &capelook=0: the pre-C2 unlit cape (A/B for perfbench --baseline self --base-extra "&capelook=0")
  const capeLook = !(typeof location !== 'undefined' && /[?&]capelook=0/.test(location.search));
  if (!capeLook) { outer.emissive.set(color).multiplyScalar(0.3); inner.emissive.set(lining).multiplyScalar(0.2); }
  if (capeLook) try {
    applyCharacterLook(mesh, { strength: 1 });
    // dark dyed cloth: the stage key's albedo floor (×4 lift to 0.3 lin) turned oxblood / crimson into flat cream in
    // stages 4 and 5 — a low floor + lift cap like the Brutes' bossLook keeps the dye (key colour comes from bossGrade)
    bossLook(mesh, { floor: 0.12, liftMax: 1.4, key: 1, wrap: 0.6, metal: 1 });
    bossRim(mesh, (boss.def && boss.def.rim) ?? 1.4);
    // cloth keeps its hue: the body grades desaturate hard (Morvane 0.8, for the lime throne hall) — capped for the cape
    if (boss.def && boss.def.grade && boss.lightRig) bossGrade(mesh, { ...boss.def.grade, desat: Math.min(boss.def.grade.desat ?? 0, 0.3) }, boss.lightRig);
  } catch (e) { reportError('boss.capeLook', e); }
  mesh.position.set(0, H * top, -H * 0.075);
  boss.body.add(mesh); fx.objs.push(mesh);
  // C1 r8: hang it from the chest bone (bind pose) so it leans with the torso — on the body root it stayed upright and
  // read as a flat black slab behind the head whenever the boss bent into a smash.
  const chest = boss.modelRoot && boss.modelRoot.getObjectByName('chest');
  if (chest) { try { boss.view.updateWorldMatrix(true, true); chest.attach(mesh); } catch (e) { reportError('boss.cape', e); } }
  // C2 r1 gravity hang: on the chest bone the cape inherited the full torso pitch — Morvane's new hunched stance (chest
  // ~30° forward) laid it out flat behind him like a plank. Its orientation now follows the chest only by FOLLOW and
  // otherwise keeps its bind-pose orientation relative to the body root (= hangs plumb), so it still leans a little
  // into smashes but always falls from the shoulders.
  const FOLLOW = 0.35, bodyQ0 = new THREE.Quaternion(), relQ = new THREE.Quaternion(), localQ0 = mesh.quaternion.clone();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  { const mq = new THREE.Quaternion(); mesh.getWorldQuaternion(mq); boss.body.getWorldQuaternion(bodyQ0); relQ.copy(bodyQ0).invert().multiply(mq); }
  const hang = () => {
    if (!mesh.parent || mesh.parent === boss.body) return;
    mesh.parent.getWorldQuaternion(qc);                       // chest world
    qa.copy(qc).multiply(localQ0);                           // where the chest would carry it
    boss.body.getWorldQuaternion(qb); qb.multiply(relQ);      // plumb: bind orientation relative to the body root
    qb.slerp(qa, FOLLOW);
    mesh.quaternion.copy(qc.invert().multiply(qb));
  };
  let swing = 0, sv = 0;
  // r10 secondary motion: the hem lags the chest bone's WORLD motion (flail wind-ups, lunges, casts, turns) through a
  // damped spring in the cape's local frame — the cloth trails then swings through instead of moving as a rigid plate.
  const wp = new THREE.Vector3(), prev = new THREE.Vector3(), wq = new THREE.Quaternion(), wv = new THREE.Vector3();
  let havePrev = false, lx = 0, lz = 0, vlx = 0, vlz = 0;
  return {
    mesh,
    update(dt, time) {
      hang();
      const vx = boss.vel.x * boss.facing;
      const target = Math.max(-0.15, Math.min(0.7, vx * 0.12)) + 0.05 + Math.sin(time * 1.3) * 0.03;
      sv += (target - swing) * 30 * dt; sv *= Math.exp(-5 * dt); swing += sv * dt * 4;
      if (dt > 0) {
        mesh.getWorldPosition(wp);
        if (havePrev && wp.distanceToSquared(prev) < 1) {   // > 1 m in a tick = a teleport / respawn: no whip
          wv.subVectors(wp, prev).divideScalar(dt);
          mesh.getWorldQuaternion(wq); wv.applyQuaternion(wq.invert());   // world velocity → cape-local (x across, z out of the back)
          const tx = Math.max(-0.35, Math.min(0.35, -wv.x * 0.07)), tz = Math.max(-0.35, Math.min(0.45, -wv.z * 0.07));
          vlx += (tx - lx) * 90 * dt; vlz += (tz - lz) * 90 * dt;
          const damp = Math.exp(-7 * dt); vlx *= damp; vlz *= damp;
          lx += vlx * dt; lz += vlz * dt;
        }
        prev.copy(wp); havePrev = true;
      }
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1], v = Math.min(1, Math.max(0, -y / L)), u = x / (W * 0.71);   // top row y can be +1e-17: clamp (sqrt below)
        const bend = swing * v * v * L * 0.8;
        const v15 = v * Math.sqrt(v);
        const ripple = Math.sin(time * 1.9 - v * 4.2 + u * 1.3) * 0.016 * H * v;   // slow travelling ripple down the folds
        pos.array[i * 3 + 2] = base[i * 3 + 2] - bend + lz * v15 * L + ripple;
        pos.array[i * 3 + 1] = base[i * 3 + 1] + (Math.abs(bend) + Math.abs(lz) * v15 * L * 0.6) * 0.25 * v;
        pos.array[i * 3] = base[i * 3] + Math.sin(time * 2.1 + v * 3) * 0.015 * v * H + lx * v15 * L;
      }
      pos.needsUpdate = true;
      if ((fx.t & 1) === 0) geo.computeVertexNormals();
    },
  };
}

/** Chained captives (the Queen and her consort) hanging above the arena; lower(seconds) brings them down. */
export async function captives(fx, x, z, { y = 4.6 } = {}) {
  const game = fx.game;
  const out = [];
  const defs = [
    { id: 'boss_captive_queen', height: 1.7, palette: { skin: '#e0b89a', hair: '#c8a060', cloth: '#6a2a58', leather: '#3a2418', metal: '#d8b060', accent: '#e8d8a8' }, style: { hair: 'braid', helm: 'circlet', armor: 'rags' } },
    { id: 'boss_captive_consort', height: 1.82, palette: { skin: '#c89878', hair: '#3a2a1a', cloth: '#2a3a6a', leather: '#3a2418', metal: '#c8a050', accent: '#d8c8a0' }, style: { hair: 'short', helm: 'circlet', armor: 'rags' } },
  ];
  const chainMat = new THREE.MeshStandardMaterial({ color: '#4a4640', metalness: 0.8, roughness: 0.45 });
  const link = new THREE.TorusGeometry(0.045, 0.012, 5, 10);
  for (let i = 0; i < defs.length; i++) {
    let model = null;
    try { model = await game.assets.character({ ...defs[i], asset: defs[i].id }); } catch (e) { reportError('boss.captive', e); }
    if (!model) continue;
    const g = new THREE.Group(); g.name = defs[i].id;
    g.add(model.root);
    let animator = null;
    try { const { Animator } = await import('../../anim/Animator.js'); animator = new Animator(model.root, { library: game.anim, rig: 'humanoid', character: 'boss_captive' }); animator.play('captive_hang', { loop: true, fade: 0 }); } catch (e) { reportError('boss.captive.anim', e); }
    const chain = new THREE.InstancedMesh(link, chainMat, 60);
    chain.castShadow = true;
    g.add(chain);
    const px = x + (i ? 1.3 : -1.1), pz = z - 1.4;
    g.position.set(px, y, pz);
    model.root.rotation.y = i ? -0.35 : 0.35;
    fx.add(g);
    out.push({ g, chain, animator, y0: y, y: y, ph: i * 1.7, h: defs[i].height });
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const api = {
    list: out,
    lowering: null,
    lower(seconds = 3) { api.lowering = { t: 0, dur: seconds }; },
    update(dt, time) {
      if (api.lowering) { api.lowering.t += dt; }
      for (const c of out) {
        const k = api.lowering ? Math.min(1, api.lowering.t / api.lowering.dur) : 0;
        c.y = c.y0 * (1 - k * k * (3 - 2 * k)) + 0.02 * k;
        c.g.position.y = c.y;
        c.g.rotation.z = Math.sin(time * 0.9 + c.ph) * 0.04 * (1 - k);
        const top = 14 - c.y, n = Math.min(60, Math.ceil(top / 0.085));
        for (let j = 0; j < 60; j++) {
          e.set(0, j % 2 ? Math.PI / 2 : 0, 0); q.setFromEuler(e);
          m.compose(new THREE.Vector3(0, c.h * 1.12 + j * 0.085, 0), q, new THREE.Vector3(j < n ? 1 : 0, 1, 1));
          c.chain.setMatrixAt(j, m);
        }
        c.chain.instanceMatrix.needsUpdate = true;
        if (c.animator) { c.animator.tick(dt); c.animator.render(time); }
      }
    },
  };
  return api;
}

/** Glowing arena cracks (phase 2) — thin lit gashes + witchfire seep, spread along the arena floor. */
export function arenaCracks(fx, x0, x1, { n = 7 } = {}) {
  const v = vfxOf(fx.game);
  const band = fx.game.world.band || { zMin: -2.5, zMax: 2.5 };
  const rnd = mulberry(314);
  const spots = [];
  for (let i = 0; i < n; i++) spots.push({ x: x0 + (x1 - x0) * (i + 0.5) / n + (rnd() - 0.5) * 1.5, z: band.zMin + (band.zMax - band.zMin) * rnd(), s: 1.6 + rnd() * 1.8, rot: rnd() * 6 });
  let t = 0;
  return {
    spots,
    burst() {
      if (!v) return;
      for (const s of spots) {
        v.shape.emit({ shape: 'crack', mode: 'plane', pos: [s.x, 0.03, s.z], size: [s.s * 2, s.s * 2], rot: s.rot, life: 1.2, color: [WITCH.core, WITCH.mid], intensity: 5 });
        fx.game.vfx.spawn('fx_rock_burst', { pos: { x: s.x, y: 0.1, z: s.z }, count: 8, speed: 4, size: 0.1 });
      }
    },
    update() {
      if (!v) return;
      t++;
      if (t % 30 === 0) for (const s of spots) v.shape.emit({ shape: 'crack', mode: 'plane', pos: [s.x, 0.028, s.z], size: [s.s * 2, s.s * 2], rot: s.rot, life: 0.62, color: [WITCH.hot, WITCH.tail], intensity: 2.6, alpha: [1, 1] });
      if (t % 5 === 0) { const s = spots[t / 5 % spots.length | 0]; v.add.emit({ pos: [s.x + (Math.random() - 0.5) * s.s, 0.05, s.z + (Math.random() - 0.5) * 0.5], vel: [0, 1 + Math.random(), 0], life: 1.2, size: [0.07, 0.02], color: [WITCH.hot, WITCH.tail], intensity: 3, drag: 0.5 }); }
    },
  };
}

/** Finale: the Copper Ax tears free of his grip, wheels up and impales the Adder King. Resolves after the impact. */
export async function copperAxImpale(fx, boss, { from = null } = {}) {
  const game = fx.game;
  let ax = null;
  try { const inst = await game.assets.instance('weapon_copperax'); if (inst && inst.source === 'glb') ax = inst.root; } catch (e) { reportError('boss.copperax', e); }
  if (!ax) { ax = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.5), new THREE.MeshStandardMaterial({ color: '#c87040', metalness: 1, roughness: 0.3 })); }
  const g = new THREE.Group(); g.add(ax); ax.scale.setScalar(1.6);
  ax.traverse((o) => { if (o.isMesh) { o.castShadow = true; const m = o.material; if (m && m.emissive) { o.material = m.clone(); o.material.emissive.set('#ff7a30'); o.material.emissiveIntensity = 0.6; } } });
  const H = boss.height;
  const start = from || { x: boss.pos.x + boss.facing * 0.8, y: H * 0.6, z: boss.pos.z + 0.3 };
  g.position.set(start.x, start.y, start.z);
  fx.add(g);
  const chest = new THREE.Vector3(boss.pos.x, H * 0.62, boss.pos.z + 0.2);
  const apex = new THREE.Vector3(boss.pos.x + boss.facing * 1.2, H * 1.9, boss.pos.z + 0.6);
  const v = vfxOf(game);
  const T = 70;
  for (let i = 0; i <= T; i++) {
    const k = i / T;
    const p = k < 0.55 ? new THREE.Vector3().lerpVectors(new THREE.Vector3(start.x, start.y, start.z), apex, easeOut(k / 0.55)) : new THREE.Vector3().lerpVectors(apex, chest, easeIn((k - 0.55) / 0.45));
    g.position.copy(p);
    g.rotation.set(0, 0, k < 0.55 ? k * 18 : Math.PI * 0.72 * -boss.facing);
    if (v && i % 2 === 0) v.add.emit({ pos: [p.x, p.y, p.z], vel: [0, 0, 0], life: 0.35, size: [0.3, 0.02], color: ['#ffe0b0', '#ff6a20'], intensity: 5 });
    await game.wait(1);
  }
  game.hitstop(12);
  shake(game, 0.9);
  if (game.renderer && game.renderer.post && game.renderer.post.pulse) game.renderer.post.pulse({ flash: 0, ca: 0.01, desat: 0.3, duration: 0.7 });   // r10: was ca 0.6 / flash 0.9 (flash mixes in linear HDR pre-tonemap: even 0.03 milks the blacks)
  if (v) {
    v.shape.emit({ shape: 'burst', pos: [chest.x, chest.y, chest.z + 0.3], size: [2.2, 2.2], life: 0.3, color: ['#fff4d8', '#ff7020'], intensity: 7 });
    v.shape.emit({ shape: 'ring', pos: [chest.x, chest.y, chest.z + 0.3], size: [6, 6], life: 0.7, color: ['#ffd090', WITCH.mid], intensity: 4, grow: [0.2, 1.5] });
    for (let i = 0; i < 40; i++) v.add.emit({ pos: [chest.x, chest.y, chest.z], vel: [(Math.random() - 0.5) * 10, (Math.random() - 0.3) * 8, (Math.random() - 0.5) * 5], life: 0.9, size: [0.1, 0.01], color: ['#ffe8c0', '#ff5010'], intensity: 7, shape: 'spark', stretch: 0.03, gravity: 6 });
  }
  game.bus.emit('boss:impaled', { boss });
  return g;
}
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;

export { WITCH, heroesOf };
export const _unused = EV;
