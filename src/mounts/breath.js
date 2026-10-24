// Dragon fire for bizarrians. The look lives in src/vfx/effects/mount_fire.js (ENGINE_API §8); this file drives it.
//   breathTick(game, mouth, facing, k, { to, gy, phase })  one tick of the fire-breath CONE from `mouth` (world Vector3)
//        to `to` (far end of the hitbox reach; default 2.6 m ahead, 0.9 m lower); k = 0..1 intensity (ramps in/out);
//        phase 'start' | 'end' adds the ignition flash + ground scorch / the smoky last gasp; cone = the beast's
//        makeFlameCone() mesh (shaped flame body), owner = the beast. Cosmetic only (fxRng).
//   chargeTick(game, mouth, t01)   fire gathering in the jaws before a fireball (sparks drawn in, growing glow)
//   Fireball (projectile Actor): new Fireball(game, owner, { x, y, z, dir, speed, hit }) — lobs along X above its original belt-plane hit lane, hits the
//   first foe of another team (combat.applyHit), bursts on impact / after `range`. Mount types keep one in flight.
import * as THREE from 'three';
import { Actor } from '../core/Actor.js';
import { makeFireballMesh, fireballAttach, fireballTick, fireballHide } from '../vfx/effects/mount_fire.js';

export function breathTick(game, mouth, facing, k = 1, { to = null, gy = 0, phase = null, cone = null, owner = null } = {}) {
  const v = game.vfx;
  if (!v || !v.spawn || k <= 0) return;
  const from = { x: mouth.x, y: mouth.y, z: mouth.z };
  const end = to || { x: mouth.x + facing * 2.6, y: mouth.y - 0.9, z: mouth.z };
  if (phase === 'start') v.spawn('mount_fire', { type: 'breath_start', from, to: end, gy });
  v.spawn('mount_fire', { type: 'breath', from, to: end, k, gy, cone, owner });
  if (phase === 'end') v.spawn('mount_fire', { type: 'breath_end', from, to: end });
}

export function chargeTick(game, mouth, t) {
  const v = game.vfx;
  if (!v || !v.shape) return;
  const r = game.fxRng || { range: (a, b) => a + Math.random() * (b - a) };
  const s = 0.2 + 0.6 * t;
  v.shape.emit({ shape: 'orb', pos: [mouth.x, mouth.y, mouth.z], size: [s, s], life: 0.034, color: [[1, 0.85, 0.45, 1], [1, 0.45, 0.08, 0.7]], intensity: 1.1, p0: [0.55, 0.8, 5, 1], seed: r.range(0, 1), occ: 0.3 });
  if (v.add) {
    const a = r.range(0, Math.PI * 2), d = r.range(0.5, 0.9);
    const px = Math.cos(a) * d, py = Math.sin(a) * d;
    v.add.emit({ pos: [mouth.x + px, mouth.y + py, mouth.z], vel: [-px * 5, -py * 5, 0], life: 0.16, size: [0.03, 0.01], color: ['#ffe8b0', '#ff6010'], intensity: 3.2, shape: 'streak', stretch: 0.02 });
  }
  if (v.light && (game.tick & 3) === 0) v.light({ x: mouth.x, y: mouth.y, z: mouth.z + 0.3 }, { color: 0xff8030, intensity: 2 + 3 * t, distance: 2, life: 0.08 });
}

export class Fireball extends Actor {
  constructor(game, owner, o = {}) {
    super(game, { kind: 'projectile', typeId: 'mount_fireball', team: owner.team, x: o.x, y: o.y ?? 1.2, z: o.z, facing: o.dir ?? 1, radius: 0.25, height: 0.5, shadowRadius: 0.3, shadowOpacity: 0.12, boundsMode: 'none' });
    this.owner = owner; this.dir = o.dir ?? 1; this.speed = o.speed ?? 11; this.hitData = o.hit || { damage: 8, knockdown: true, launch: 4, knockback: 4, level: 'magic', hitstop: 6 };
    this.range = o.range ?? 18; this.travel = 0;
    // A cosmetic parabola over the same horizontal range/time. Keep the established vertical hit lane:
    // the lob must not make a formerly hittable short or airborne foe miss, or alter damage/range.
    this.launchY = this.pos.y;
    const eligible = game.world.query({ notTeam: this.team }).filter(t => t !== owner && t.hurtable
      && t.team !== 'neutral' && !['projectile', 'pickup', 'mount'].includes(t.kind)
      && (t.pos.x - this.pos.x) * this.dir > 0.9 && (t.pos.x - this.pos.x) * this.dir <= this.range
      && Math.abs(t.pos.z - this.pos.z) <= 0.55 && this.launchY >= t.pos.y - 0.2
      && this.launchY <= t.pos.y + (t.height || 1.8) + 0.3);
    eligible.sort((a, b) => (a.pos.x - b.pos.x) * this.dir);
    const aim = eligible[0];
    // Fit the visual parabola to the first collision plane, not the maximum miss range.
    this.arcDistance = aim ? Math.max(0.5, Math.abs(aim.pos.x - this.pos.x) - 0.80) : this.range;
    this.arcHeight = Math.max(1.05, Math.min(2.4, this.arcDistance * 0.20));
    const chest = aim && aim.modelRoot && aim.modelRoot.getObjectByName('chest');
    const end = this.pos.clone();
    if (chest) chest.getWorldPosition(end);
    this.endY = aim ? (chest ? end.y - (aim.groundY || 0) : aim.pos.y + (aim.height || 1.8) * 0.55) : this.launchY;
    // Keep at least the requested lift above the muzzle even when the chest is lower.
    this.arcHeight += Math.max(0, this.launchY - this.endY) * 0.5;
    this.visualLead = aim ? 0.72 : 0;
    this.gravityScale = 0; this.grounded = false; this.solid = false; this.hurtable = false;
    this.vel.set(this.dir * this.speed, 0, 0);
    // Shaped flame body (FireballMesh, mount_fire.js): borrowed from the beast (prewarmed there), or made on demand.
    this.fireBody = owner.fireMesh || (owner.fireMesh = makeFireballMesh());
    fireballAttach(this.fireBody, this.view, this.dir);
  }
  integrate(dt) {
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.travel += Math.abs(this.vel.x * dt);
    const t = Math.min(1, this.travel / Math.max(0.001, this.arcDistance));
    this.pos.y = this.launchY + (this.endY - this.launchY) * t + 4 * this.arcHeight * t * (1 - t);
  }
  update(dt) {
    super.update(dt);
    const g = this.game, v = g.vfx;
    if (v && v.spawn) v.spawn('mount_fire', { type: 'ball', pos: { x: this.pos.x, y: this.pos.y, z: this.pos.z }, dir: this.dir, gy: v.groundY ? v.groundY(this.pos) : 0, body: this.fireBody });
    for (const t of g.world.query({ notTeam: this.team, near: { x: this.pos.x, z: this.pos.z, r: 0.9 } })) {
      if (t === this.owner || t.team === 'neutral' || !t.hurtable || t.kind === 'projectile' || t.kind === 'pickup' || t.kind === 'mount') continue;
      if (Math.abs(t.pos.z - this.pos.z) > 0.55 || this.launchY < t.pos.y - 0.2 || this.launchY > t.pos.y + (t.height || 1.8) + 0.3) continue;
      if (g.combat && g.combat.applyHit(this.owner.rider || this.owner, t, { ...this.hitData, dir: this.dir }, { moveId: 'beast_fireball', point: { x: this.pos.x + this.dir * 0.25, y: this.pos.y, z: this.pos.z } })) { this.burst(t); return; }
    }
    const cam = g.cameraRig, vis = cam && cam.visibleRange ? cam.visibleRange(this.pos.z) : null;
    if (this.travel > this.range || (vis && (this.pos.x < vis.xMin - 4 || this.pos.x > vis.xMax + 4))) { fireballHide(this.fireBody); this.remove(); }
  }
  burst(t = null) {
    const v = this.game.vfx;
    // `target` = chest of the struck foe: the blast is centred on his near side (cosmetic only)
    const target = t && t.pos ? { x: t.pos.x, y: t.pos.y + (t.height || 1.8) * 0.55, z: t.pos.z } : null;
    if (v && v.spawn) v.spawn('mount_fire', { type: 'ball_burst', pos: { x: this.pos.x, y: this.pos.y, z: this.pos.z }, dir: this.dir, gy: v.groundY ? v.groundY(this.pos) : 0, body: this.fireBody, target });
    else fireballHide(this.fireBody);
    this.remove();
  }
  render(alpha, frameDt) {
    super.render(alpha, frameDt);
    if (this.fireBody.parent === this.view) {
      // Render the current projectile tick, predicting only the fractional next tick. Actor's
      // previous-tick interpolation otherwise leaves a ~40px gap before the chest ignition.
      const ahead = Math.abs(this.vel.x) * Math.max(0, alpha) / 60;
      const t = Math.min(1, (this.travel + ahead) / Math.max(0.001, this.arcDistance));
      this.view.position.x = this.pos.x + this.dir * (ahead + this.visualLead * t * t);
      this.view.position.y = this.groundY + this.launchY + (this.endY - this.launchY) * t + 4 * this.arcHeight * t * (1 - t);
      this.fireBody.rotation.z = -Math.atan(((this.endY - this.launchY) + 4 * this.arcHeight * (1 - 2 * t)) / Math.max(0.001, this.arcDistance));
      fireballTick(this.fireBody, this.game.time || 0);
    }
  }
}
