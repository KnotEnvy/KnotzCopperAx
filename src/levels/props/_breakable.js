// Breakable prop actor (chapter1-integration): crates, urns, barrels that heroes smash for loot (DESIGN §7
// "Breakable crates, urns, and fences drop loot"). Private helper (leading _ = not registered); the registered
// prop ids are crate.js / urn.js / barrel.js, each `{ id, create(ctx, opts) → Actor }`.
//   Stage script: SpawnDef { prop: 'urn', x, z, loot: 'food' | 'pot' | ['pot', 'pot'] | null, hp? }
//   or stage.props = [{ prop: 'crate', x, z, loot }] (placed when the stage loads, before screen 0).
// Rules: only the PLAYERS' team breaks props (enemy swings pass through; magic ignores them so a spell is never
// "wasted" on furniture); each hit chips + shakes; the last hit bursts the prop into debris + dust and spills its
// loot with a little hop. Cheap: 2–3 meshes per prop, shared geometry/materials per kind, no lights.
import * as THREE from 'three';
import { Actor } from '../../core/Actor.js';
import { reportError } from '../../core/log.js';

const shared = new Map();
/** Build (once per kind) and return { parts: [{ geo, mat }], height, radius }. */
export function sharedKind(id, build) {
  if (!shared.has(id)) shared.set(id, build());
  return shared.get(id);
}

export class BreakableProp extends Actor {
  constructor(game, kindDef, opts = {}) {
    super(game, { kind: 'prop', typeId: kindDef.id, team: 'neutral', x: opts.x ?? 0, z: opts.z ?? 0, facing: 1, radius: kindDef.radius, height: kindDef.height, hp: opts.hp ?? kindDef.hp ?? 10, solid: false, shadowRadius: kindDef.radius * 1.25, shadowOpacity: 0.55, boundsMode: 'band' });
    this.def = kindDef;
    this.hurtable = true;
    this.hittableByAll = true;
    this.gravityScale = 0;
    this.loot = opts.loot === undefined ? kindDef.loot : opts.loot;
    this.cheatYaw = 0;
    this.shakeT = 0;
    this.model = new THREE.Group();
    for (const p of kindDef.parts) {
      const m = new THREE.Mesh(p.geo, p.mat);
      m.castShadow = true; m.receiveShadow = true;
      this.model.add(m);
    }
    this.model.rotation.y = opts.yaw ?? (game.fxRng ? game.fxRng.range(-0.5, 0.5) : 0);
    this.view.add(this.model);
    this.hurt = { w: kindDef.radius * 2.1, h: kindDef.height, d: 0.9, dx: 0, dy: 0 };
  }

  canBeHit(ev) {
    return this.alive && !this.removed && !!ev.attacker && ev.attacker.team === 'players' && ev.hit && ev.hit.level !== 'magic';
  }

  receiveHit(ev) {
    this.hp -= Math.max(1, ev.damage || 1);
    this.shakeT = 10;
    ev.killed = false;
    const g = this.game;
    if (g.audio) g.audio.play(this.def.chipSfx || 'hit_light', { pitch: this.def.pitch || 0.7, volume: 0.8 });
    if (this.hp <= 0) this.smash(ev);
    return true;
  }

  smash(ev) {
    const g = this.game;
    this.alive = false;
    this.hurtable = false;
    const p = { x: this.pos.x, y: this.def.height * 0.5, z: this.pos.z };
    try {
      if (g.vfx) {
        g.vfx.spawn('fx_rock_burst', { pos: p, count: this.def.debris ?? 16, speed: [1.8, 4.8], up: [2.5, 6], size: this.def.chunk || [0.05, 0.14] });
        g.vfx.spawn('dust', { pos: { x: p.x, y: 0.05, z: p.z }, count: 10 });
      }
      if (g.audio) { g.audio.play('hit_heavy', { pitch: this.def.pitch || 0.6, volume: 0.9 }); g.audio.play('body_impact', { pitch: 1.3, volume: 0.6, delay: 0.03 }); }
      if (g.cameraRig && g.cameraRig.shake) g.cameraRig.shake(0.18);
      const loot = Array.isArray(this.loot) ? this.loot : this.loot ? [this.loot] : [];
      const dir = (ev && ev.dir) || 1;
      loot.forEach((k, i) => g.spawnPickup && g.spawnPickup(k, this.pos.x, this.pos.z, { vx: dir * (0.8 + i * 0.6), vy: 4.5 + i * 0.6, vz: (i % 2 ? 0.6 : -0.4), delay: 14 }));
      g.bus.emit('props:smash', { prop: this, loot });
    } catch (e) { reportError('prop.smash', e); }
    this.remove();
  }

  update(dt) { if (this.shakeT > 0) this.shakeT--; }

  render(alpha, frameDt) {
    super.render(alpha, frameDt);
    const s = this.shakeT / 10;
    this.model.position.x = s ? Math.sin(this.shakeT * 2.6) * 0.06 * s : 0;
    this.model.rotation.z = s ? Math.sin(this.shakeT * 2.1) * 0.08 * s : 0;
  }
}

/** Registered-prop factory: `export default makeProp(kindDef)`. */
export function makeProp(kind) {
  return {
    id: kind.id,
    create(ctx, opts = {}) {
      const game = ctx.game || ctx;
      const def = { ...kind, ...sharedKind(kind.id, kind.build) };
      const a = new BreakableProp(game, def, opts);
      game.world.add(a);
      return a;
    },
  };
}

// ---------------------------------------------------------------- shared material helpers
const canvasTex = (w, h, draw) => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};
let _rng = 1234567;
const rnd = () => { _rng = (_rng * 16807) % 2147483647; return _rng / 2147483647; };

/** Weathered plank texture: grain streaks, knots, soot at the bottom. */
export function woodTexture(base = [92, 60, 36]) {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = `rgb(${base})`; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const y = rnd() * h, l = 20 + rnd() * 120, k = rnd() * 0.5 + 0.5;
      x.strokeStyle = `rgba(${Math.round(base[0] * k * 0.7)},${Math.round(base[1] * k * 0.7)},${Math.round(base[2] * k * 0.7)},${0.25 + rnd() * 0.35})`;
      x.lineWidth = 0.6 + rnd() * 1.6; x.beginPath(); const sx = rnd() * w; x.moveTo(sx, y); x.bezierCurveTo(sx + l * 0.3, y + rnd() * 3, sx + l * 0.6, y - rnd() * 3, sx + l, y + rnd() * 2); x.stroke();
    }
    for (let i = 0; i < 6; i++) { const cx = rnd() * w, cy = rnd() * h; const g = x.createRadialGradient(cx, cy, 1, cx, cy, 7); g.addColorStop(0, 'rgba(30,18,10,0.8)'); g.addColorStop(1, 'rgba(30,18,10,0)'); x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, 9, 4, 0, 0, 7); x.fill(); }
    for (let py = 0; py < h; py += 64) { x.fillStyle = 'rgba(12,7,4,0.75)'; x.fillRect(0, py, w, 3); x.fillStyle = 'rgba(255,220,170,0.08)'; x.fillRect(0, py + 3, w, 2); }
    const s = x.createLinearGradient(0, h, 0, h * 0.6); s.addColorStop(0, 'rgba(10,6,4,0.55)'); s.addColorStop(1, 'rgba(10,6,4,0)'); x.fillStyle = s; x.fillRect(0, 0, w, h);
  });
}

/** Painted clay texture: terracotta body with a dark glazed band and a zig-zag frieze. */
export function clayTexture(body = [150, 78, 44], band = [34, 26, 22], trim = [196, 150, 84]) {
  return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = `rgb(${body})`; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { const k = 0.8 + rnd() * 0.35; x.fillStyle = `rgba(${Math.round(body[0] * k)},${Math.round(body[1] * k)},${Math.round(body[2] * k)},0.35)`; x.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 1 + rnd() * 2); }
    x.fillStyle = `rgb(${band})`; x.fillRect(0, h * 0.36, w, h * 0.2);
    x.strokeStyle = `rgb(${trim})`; x.lineWidth = 3; x.beginPath();
    for (let i = 0; i <= 16; i++) x.lineTo(i * w / 16, h * (i % 2 ? 0.39 : 0.53));
    x.stroke();
    x.fillStyle = `rgb(${trim})`; x.fillRect(0, h * 0.34, w, 3); x.fillRect(0, h * 0.56, w, 3);
    const s = x.createLinearGradient(0, h, 0, h * 0.7); s.addColorStop(0, 'rgba(20,10,6,0.5)'); s.addColorStop(1, 'rgba(20,10,6,0)'); x.fillStyle = s; x.fillRect(0, 0, w, h);
  });
}

export const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
