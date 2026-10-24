// Stage 3 — sky ring-outs (DESIGN §6: "knock foes off the edges for instant KOs"). Over the marked lip zones (pale
// fluttering edge feathers + streaming wind lines) there is nothing but air: a foe knocked down / thrown / launched within
// reach of the band edge goes OVER — the stage takes the body (skipPhysics), flings it off the back, and it tumbles away
// into the clouds far below (shrinking, a cloud puff as it punches through). Counts as a KO with `ringout: true`.
// While the eagle rolls toward a side, downed foes in a zone on that side slide toward the edge. Heroes never ring out.
import { EV } from '../../../core/EventBus.js';

const KNOCKED = new Set(['knockdown', 'thrown', 'down']);

export function createRingOuts(game, { zones, onFall, onPunch, shake }) {
  const scope = game.bus.scope();
  const lastHit = new Map();
  scope.on(EV.HIT, (ev) => { if (ev && ev.target && ev.attacker) lastHit.set(ev.target.id, ev.attacker); });
  const falling = [];
  const zoneAt = (x, z) => zones.find((zn) => x > zn.x0 && x < zn.x1 && (zn.side > 0 ? z > 0 : z < 0));

  function takeOver(a, side) {
    a.skipPhysics = true;
    a.boundsMode = 'none';
    a.hurtable = false; a.solid = false;
    a._s3ringout = { vx: a.vel.x * 0.5 - 2.5, vy: Math.max(3.4, a.vel.y + 2.8), vz: 4.2 * side, y: (a.groundY || 0) + a.pos.y, spin: 0, side };
    a.hp = 0;
    const by = lastHit.get(a.id) || null;
    try { if (a.fsm && a.fsm.go) a.fsm.go('dead'); } catch (e) { /* physics takeover still runs */ }
    game.bus.emit(EV.KO, { actor: a, by, ringout: true, cause: 'ringout' });
    game.bus.emit('stage3:ringout', { actor: a, by });
    if (shake) shake(0.18);
    if (onFall) onFall(a);
    falling.push(a);
  }

  return {
    zones,
    /** Sim tick. roll = eagle roll (rad, + = near side down). */
    update(dt, roll = 0) {
      const band = game.world.band;
      for (const a of game.world.actors) {
        if (a.kind !== 'enemy' || !a.alive || a.removed || a._s3ringout) continue;
        const zn = zoneAt(a.pos.x, a.pos.z);
        if (!zn) continue;
        const sName = (a.fsm && a.fsm.name) || '';
        const knocked = KNOCKED.has(sName) || (!a.grounded && sName === 'hitstun');
        if (!knocked) continue;
        const edge = zn.side > 0 ? band.zMax : band.zMin;
        const tilt = roll * zn.side;                    // eagle leaning toward this edge
        if (sName === 'down' && tilt > 0.02) a.pos.z += zn.side * dt * 1.6 * Math.min(1, tilt * 12);
        const reach = sName === 'down' ? 0.05 : 0.34;
        if ((zn.side > 0 && a.pos.z >= edge - reach) || (zn.side < 0 && a.pos.z <= edge + reach)) takeOver(a, zn.side);
      }
      for (let i = falling.length - 1; i >= 0; i--) {
        const a = falling[i], r = a._s3ringout;
        if (a.removed) { falling.splice(i, 1); continue; }
        r.vy -= 15 * dt;
        r.vx -= 9 * dt;                                // the eagle flies on: the body is left behind
        a.pos.x += r.vx * dt; a.pos.z += r.vz * dt; r.y += r.vy * dt;
        r.vz *= 0.99;
        r.spin += dt * 3.6;
        if (a.body) { a.body.rotation.x = r.spin * r.side; a.body.rotation.z = r.spin * 0.4; }
        a.pos.y = r.y - (a.groundY || 0);
        if (!r.punched && r.y < -16) { r.punched = true; if (onPunch) onPunch(a.pos.x, r.y, a.pos.z); }
        if (r.y < -30) { a.visible = false; if (a.view) a.view.visible = false; }
      }
    },
    dispose() { scope.dispose(); falling.length = 0; lastHit.clear(); },
  };
}
