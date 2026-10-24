// World: the set of live actors + belt-plane rules (bounds, body separation, ground height) + queries.
//
//   world.add(actor) / world.remove(actor)      (removal is deferred to the end of the tick)
//   world.query({ team, notTeam, kind, tag, alive, near:{x,z,r}, filter }) → Actor[]
//   world.nearest(from, opts) → Actor|null
//   world.band = { zMin, zMax }                 walkable depth band (stage sets it)
//   world.screen = { xMin, xMax }               player clamp (LevelDirector/camera lock sets it)
//   world.groundAt = (x, z) => 0                ground height function (stage may replace)
//   world.sorted()                              actors sorted far→near (for 2D overlays / label order)
import { reportError } from './log.js';
import { EV } from './EventBus.js';

export class World {
  constructor(game) {
    this.game = game;
    /** @type {import('./Actor.js').Actor[]} */
    this.actors = [];
    this.byId = new Map();
    this.band = { zMin: -3, zMax: 3 };
    this.screen = { xMin: -Infinity, xMax: Infinity };
    /** Hard stage extents for everyone (enemies may walk in from off-screen within these). */
    this.extents = { xMin: -Infinity, xMax: Infinity };
    this.groundAt = () => 0;
    this.separation = true;
    this._toRemove = [];
  }

  add(actor) {
    if (this.byId.has(actor.id)) return actor;
    this.actors.push(actor);
    this.byId.set(actor.id, actor);
    this.game.scene.add(actor.view);
    actor.prevPos.copy(actor.pos);
    try { actor.onAdd(this); } catch (e) { reportError(`actor:${actor.typeId}.onAdd`, e); }
    this.game.bus.emit(EV.SPAWN, { actor });
    return actor;
  }

  remove(actor) { actor.removed = true; }

  clear() {
    for (const a of this.actors) this._detach(a);
    this.actors.length = 0;
    this.byId.clear();
  }

  _detach(a) {
    try { a.onRemove(this); } catch (e) { reportError(`actor:${a.typeId}.onRemove`, e); }
    if (a.view.parent) a.view.parent.remove(a.view);
    try { a.dispose(); } catch (e) { reportError('actor.dispose', e); }
    this.byId.delete(a.id);
    this.game.bus.emit(EV.DESPAWN, { actor: a });
  }

  // ------------------------------------------------------------ simulation
  update(dt) {
    const list = this.actors;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.removed) continue;
      a.prevPos.copy(a.pos);
      if (a.hitstop > 0) { a.hitstop--; try { a.onHitstopTick(); } catch (e) { reportError(`actor:${a.typeId}.hitstop`, e); } continue; }
      // Per-actor time scale: run 0 or 1 ticks this frame via accumulator (deterministic).
      a._tacc += a.timeScale;
      if (a._tacc < 1) continue;
      a._tacc -= 1;
      if (a.invuln > 0) a.invuln--;
      a.age++;
      a.localTime += dt;
      try {
        a.update(dt);
        if (!a.skipPhysics) a.integrate(dt);
      } catch (e) { reportError(`actor:${a.typeId}#${a.id}.update`, e); }
      this.clamp(a);
      a.groundY = this.groundAt(a.pos.x, a.pos.z);
    }
    if (this.separation) this.separate();
    if (list.some((a) => a.removed)) {
      for (const a of list) if (a.removed) this._detach(a);
      this.actors = list.filter((a) => !a.removed);
    }
  }

  /** During global hitstop: freeze interpolation so views don't jitter. */
  frozenUpdate() { for (const a of this.actors) a.prevPos.copy(a.pos); }

  clamp(a) {
    if (a.boundsMode === 'none') return;
    const b = this.band;
    if (a.pos.z < b.zMin) { a.pos.z = b.zMin; if (a.vel.z < 0) a.vel.z = 0; }
    if (a.pos.z > b.zMax) { a.pos.z = b.zMax; if (a.vel.z > 0) a.vel.z = 0; }
    const e = this.extents;
    let xMin = e.xMin, xMax = e.xMax;
    if (a.boundsMode === 'screen') { xMin = Math.max(xMin, this.screen.xMin); xMax = Math.min(xMax, this.screen.xMax); }
    const r = a.radius * 0.5;
    if (a.pos.x < xMin + r) { a.pos.x = xMin + r; if (a.vel.x < 0) a.vel.x = a.bounceWalls ? -a.vel.x * 0.5 : 0; a.hitWall = -1; }
    else if (a.pos.x > xMax - r) { a.pos.x = xMax - r; if (a.vel.x > 0) a.vel.x = a.bounceWalls ? -a.vel.x * 0.5 : 0; a.hitWall = 1; }
    else a.hitWall = 0;
  }

  /** Soft body separation on the belt plane (ellipse: depth counts double so lanes stay readable). */
  separate() {
    const list = this.actors;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.solid || a.removed || !a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.solid || b.removed || !b.alive) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.2) continue;
        const dx = b.pos.x - a.pos.x, dz = (b.pos.z - a.pos.z) * 2;
        const minD = (a.radius + b.radius) * 0.9;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.35;
        const nx = dx / d, nz = dz / d / 2;
        const wa = b.mass / (a.mass + b.mass), wb = 1 - wa;
        a.pos.x -= nx * push * wa; a.pos.z -= nz * push * wa;
        b.pos.x += nx * push * wb; b.pos.z += nz * push * wb;
      }
    }
  }

  // ------------------------------------------------------------ queries
  query({ team, notTeam, kind, tag, alive = true, near, filter } = {}) {
    const out = [];
    for (const a of this.actors) {
      if (a.removed) continue;
      if (alive && !a.alive) continue;
      if (team && a.team !== team) continue;
      if (notTeam && a.team === notTeam) continue;
      if (kind && (Array.isArray(kind) ? !kind.includes(a.kind) : a.kind !== kind)) continue;
      if (tag && !a.tags.has(tag)) continue;
      if (near && Math.hypot(a.pos.x - near.x, a.pos.z - near.z) > near.r) continue;
      if (filter && !filter(a)) continue;
      out.push(a);
    }
    return out;
  }

  nearest(from, opts = {}) {
    let best = null, bd = Infinity;
    for (const a of this.query(opts)) {
      if (a === from) continue;
      const d = Math.hypot(a.pos.x - from.pos.x, (a.pos.z - from.pos.z) * 1.5);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  heroes() { return this.query({ kind: 'hero', alive: false }); }
  enemies() { return this.query({ team: 'enemies' }); }

  /** Far → near ordering (z ascending). */
  sorted() { return [...this.actors].sort((a, b) => a.pos.z - b.pos.z); }

  render(alpha, frameDt) {
    for (const a of this.actors) {
      try { a.render(alpha, frameDt); } catch (e) { reportError(`actor:${a.typeId}.render`, e); }
    }
  }
}
