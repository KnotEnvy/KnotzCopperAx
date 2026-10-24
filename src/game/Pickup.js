// Pickup actor (pots, food, …). Kinds are auto-discovered from src/game/pickups/<id>.js:
//   { id, build(ctx) → Object3D, onCollect(game, hero, pickup) → bool (true = consumed), glint?: '#hex', score?: n,
//     animate?(pickup, alpha, frameDt) per-frame visuals, ownFx?: true (the def draws its own ambient glint + collect flash) }
// Spawn with game.spawnPickup(kind, x, z, { vx, vy, vz }) — thieves, props and stage scripts all use this.
import { Actor } from '../core/Actor.js';
import { registries } from '../core/registries.js';
import { EV } from '../core/EventBus.js';
import { reportError } from '../core/log.js';

export class Pickup extends Actor {
  constructor(game, def, opts = {}) {
    super(game, { kind: 'pickup', typeId: def.id, team: 'neutral', x: opts.x, z: opts.z, y: opts.y ?? 0.6, radius: 0.2, height: 0.4, solid: false, shadowRadius: 0.22, shadowOpacity: 0.5, boundsMode: 'band' });
    this.def = def;
    this.hurtable = false;
    this.vel.set(opts.vx ?? 0, opts.vy ?? 4.5, opts.vz ?? 0);
    this.grounded = false;
    this.bounces = 0;
    this.cheatYaw = 0;
    this.pickupDelay = opts.delay ?? 18;
    this.lifeTicks = opts.life ?? 60 * 14;
    try { this.model = def.build({ game }); if (this.model) this.body.add(this.model); } catch (e) { reportError(`pickup:${def.id}.build`, e); }
  }

  onLand(speed) {
    if (speed > 1.5 && this.bounces < 3) { this.vel.y = speed * 0.45; this.grounded = false; this.bounces++; this.vel.x *= 0.6; this.vel.z *= 0.6; }
  }

  update(dt) {
    if (this.grounded) this.friction(6, dt);
    if (this.pickupDelay > 0) { this.pickupDelay--; return; }
    if (--this.lifeTicks <= 0) { this.remove(); return; }
    if (this.lifeTicks < 120) this.view.visible = (this.lifeTicks >> 2) % 2 === 0;
    if (this.age % 50 === 0 && this.def.glint && !this.def.ownFx && this.game.vfx) this.game.vfx.spawn('sparkle', { pos: { x: this.pos.x, y: this.pos.y + 0.35, z: this.pos.z }, color: this.def.glint, count: 3 });
    for (const h of this.game.world.query({ kind: 'hero' })) {
      if (Math.abs(h.pos.x - this.pos.x) < 0.6 && Math.abs(h.pos.z - this.pos.z) < 0.5 && h.pos.y < 1) {
        let ok = true;
        try { ok = this.def.onCollect(this.game, h, this) !== false; } catch (e) { reportError(`pickup:${this.def.id}.collect`, e); }
        if (ok) {
          this.game.bus.emit(EV.POT_PICKUP, { hero: h, kind: this.def.id === 'food' ? 'food' : 'pot', amount: 1, pickup: this.typeId });
          if (this.game.vfx && !this.def.ownFx) this.game.vfx.spawn('sparkle', { pos: { x: this.pos.x, y: this.pos.y + 0.4, z: this.pos.z }, color: this.def.glint || '#ffffff', count: 12 });
          this.remove();
          return;
        }
      }
    }
  }

  render(alpha, frameDt) {
    super.render(alpha, frameDt);
    if (this.model && this.grounded) this.model.rotation.y += frameDt * 1.2;
    // optional per-frame visuals from the def (bonus-camp r8: pot.js / food.js pop, flip, squash, hover, glint)
    if (this.def.animate) { try { this.def.animate(this, alpha, frameDt); } catch (e) { reportError(`pickup:${this.def.id}.animate`, e); this.def.animate = null; } }
  }
}

/** Install game.spawnPickup(kind, x, z, opts) → Promise<Pickup|null>. */
export function installPickups(game) {
  game.spawnPickup = async (kind, x, z, opts = {}) => {
    const def = await registries.pickups.load(kind);
    if (!def) return null;
    const p = new Pickup(game, def, { x, z, ...opts });
    game.world.add(p);
    game.bus.emit(EV.PICKUP_SPAWN, { pickup: p });
    return p;
  };
  return registries.pickups.loadAll();
}
