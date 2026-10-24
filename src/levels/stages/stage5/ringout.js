// Stage 5 ring-outs (DESIGN §10): the statue gallery's near floor has collapsed into a green-lit abyss — a foe knocked
// down / thrown / launched at the near band edge there plunges over the broken lip. In the arena, crack zones that
// have OPENED (floor.setPit state > 1) swallow knocked foes too; anyone else is kept on the rim (pits are solid walls
// for walkers, so heroes never fall through). Stage-owned takeover: skipPhysics arc → flare → fall; EV.KO {ringout}.
import { EV } from '../../../core/EventBus.js';
import { GALLERY, CRACKS } from './layout.js';

const KNOCKED = new Set(['knockdown', 'thrown', 'down', 'launch', 'air']);

export function createRingOuts(game, { flare, shake, floor }) {
  const scope = game.bus.scope();
  const lastHit = new Map();
  scope.on(EV.HIT, (ev) => { if (ev && ev.target && ev.attacker) lastHit.set(ev.target.id, ev.attacker); });
  const falling = [];
  const openR = (i) => { const s = floor.pitState(i); return s > 1 ? CRACKS[i].r * Math.min(1, s - 1) * 0.85 : 0; };
  const pitAt = (x, z) => {
    for (let i = 0; i < CRACKS.length; i++) { const r = openR(i); if (r > 0.2 && Math.hypot(x - CRACKS[i].x, z - CRACKS[i].z) < r) return i; }
    return -1;
  };

  function takeOver(a, mode, pit) {
    a.skipPhysics = true; a.boundsMode = 'none'; a.hurtable = false; a.solid = false;
    const cx = pit >= 0 ? CRACKS[pit].x : a.pos.x, cz = pit >= 0 ? CRACKS[pit].z : a.pos.z;
    a._s5ringout = { vx: mode === 'edge' ? a.vel.x * 0.5 : (cx - a.pos.x) * 1.5, vy: mode === 'edge' ? Math.max(3.2, a.vel.y + 2.6) : 1.5, vz: mode === 'edge' ? 3.2 : (cz - a.pos.z) * 1.5,
      y: (a.groundY || 0) + a.pos.y, spin: 0, mode, flared: false };
    a.hp = 0;
    const by = lastHit.get(a.id) || null;
    try { if (a.fsm && a.fsm.go) a.fsm.go('dead'); } catch (e) { /* physics takeover still runs */ }
    game.bus.emit(EV.KO, { actor: a, by, ringout: true, cause: 'ringout' });
    game.bus.emit('stage5:ringout', { actor: a, by, pit });
    falling.push(a);
  }

  return {
    pitAt,
    update(dt) {
      const band = game.world.band;
      for (const a of game.world.actors) {
        if (!a.alive || a.removed || a._s5ringout) continue;
        const sName = (a.fsm && a.fsm.name) || '';
        const knocked = KNOCKED.has(sName) || (!a.grounded && sName === 'hitstun');
        const pit = pitAt(a.pos.x, a.pos.z);
        if (a.kind === 'enemy' && knocked) {
          const reach = sName === 'down' ? 0.05 : 0.34;
          if (a.pos.z >= band.zMax - reach && a.pos.x > GALLERY.x0 + 0.6 && a.pos.x < GALLERY.x1 - 0.6) { takeOver(a, 'edge', -1); continue; }
          if (pit >= 0) { takeOver(a, 'pit', pit); continue; }
        }
        if (pit >= 0 && a.kind !== 'boss' && !a.flying) {           // walkers keep to the rim
          const c = CRACKS[pit], r = openR(pit) + 0.05;
          const dx = a.pos.x - c.x, dz = a.pos.z - c.z, d = Math.hypot(dx, dz) || 1;
          a.pos.x = c.x + dx / d * r; a.pos.z = c.z + dz / d * r;
        }
      }
      for (let i = falling.length - 1; i >= 0; i--) {
        const a = falling[i], r = a._s5ringout;
        if (a.removed) { falling.splice(i, 1); continue; }
        r.vy -= 16 * dt;
        a.pos.x += r.vx * dt; a.pos.z += r.vz * dt; r.y += r.vy * dt;
        r.vx *= 0.98; r.vz *= r.mode === 'pit' ? 0.9 : 1;
        r.spin += dt * 3.2;
        if (a.body) a.body.rotation.x = Math.min(1.5, r.spin) * (r.mode === 'edge' ? 1 : 0.4);
        a.pos.y = r.y - (a.groundY || 0);
        if (!r.flared && r.y < -1.2) {
          r.flared = true;
          if (shake) shake(0.2);
          if (game.audio && game.audio.play) try { game.audio.play('bodyfall', { volume: 0.5, pitch: 0.5 }); } catch (e) { /* optional */ }
        }
        if (!r.gone && r.y < -5.5) {
          r.gone = true;
          if (flare) flare(a.pos.x, -5.2, a.pos.z, 1.2);
          a.visible = false; if (a.view) a.view.visible = false;
        }
      }
    },
    dispose() { scope.dispose(); falling.length = 0; lastHit.clear(); },
  };
}
