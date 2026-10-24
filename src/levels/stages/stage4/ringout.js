// Stage 4 moat ring-outs (DESIGN §10): along the causeway the berm has no rail — a foe knocked down / thrown /
// launched at the band edge goes over the coping into the moat (near side, and the far side except where the
// lowered drawbridge spans it). Stage-owned takeover: skipPhysics arc → splash → sink; EV.KO { ringout: true }.
import { EV } from '../../../core/EventBus.js';
import { WATER_Y, BERM_Z0, BERM_Z1, COURT_X, GATE_X } from './layout.js';

const KNOCKED = new Set(['knockdown', 'thrown', 'down', 'launch', 'air']);

export function createRingOuts(game, { splash, shake, bridgeDown }) {
  const scope = game.bus.scope();
  const lastHit = new Map();
  scope.on(EV.HIT, (ev) => { if (ev && ev.target && ev.attacker) lastHit.set(ev.target.id, ev.attacker); });
  const falling = [];
  const canFall = (x, side) => x < COURT_X - 2.2 && x > -30 && !(side < 0 && bridgeDown() && Math.abs(x - GATE_X) < 2.8);

  function takeOver(a, side) {
    a.skipPhysics = true; a.boundsMode = 'none'; a.hurtable = false; a.solid = false;
    const edge = side > 0 ? BERM_Z1 : BERM_Z0;
    a._s4ringout = { vx: a.vel.x * 0.5, vy: Math.max(3.4, a.vel.y + 2.8), vz: side * 3.4, y: (a.groundY || 0) + a.pos.y, spin: 0, side, edge };
    a.hp = 0;
    const by = lastHit.get(a.id) || null;
    try { if (a.fsm && a.fsm.go) a.fsm.go('dead'); } catch (e) { /* physics takeover still runs */ }
    game.bus.emit(EV.KO, { actor: a, by, ringout: true, cause: 'ringout' });
    game.bus.emit('stage4:ringout', { actor: a, by });
    falling.push(a);
  }

  return {
    update(dt) {
      const band = game.world.band;
      for (const a of game.world.actors) {
        if (a.kind !== 'enemy' || !a.alive || a.removed || a._s4ringout) continue;
        const sName = (a.fsm && a.fsm.name) || '';
        const knocked = KNOCKED.has(sName) || (!a.grounded && sName === 'hitstun');
        if (!knocked) continue;
        const reach = sName === 'down' ? 0.05 : 0.34;
        if (a.pos.z >= band.zMax - reach && canFall(a.pos.x, 1)) takeOver(a, 1);
        else if (a.pos.z <= band.zMin + reach && canFall(a.pos.x, -1)) takeOver(a, -1);
      }
      for (let i = falling.length - 1; i >= 0; i--) {
        const a = falling[i], r = a._s4ringout;
        if (a.removed) { falling.splice(i, 1); continue; }
        r.vy -= 16 * dt;
        a.pos.x += r.vx * dt; a.pos.z += r.vz * dt; r.y += r.vy * dt;
        if (r.side > 0 ? a.pos.z < r.edge + 0.5 : a.pos.z > r.edge - 0.5) r.y = Math.max(r.y, 0.05);    // clear the coping
        r.spin += dt * 3.4;
        if (a.body) a.body.rotation.x = Math.min(1.5, r.spin) * r.side;
        a.pos.y = r.y - (a.groundY || 0);
        if (!r.splashed && r.y <= WATER_Y + 0.1) {
          r.splashed = true;
          if (splash) splash(a.pos.x, WATER_Y + 0.05, a.pos.z, 1.3);
          if (shake) shake(0.22);
          if (game.audio && game.audio.play) try { game.audio.play('bodyfall', { volume: 0.8, pitch: 0.65 }); } catch (e) { /* optional */ }
        }
        if (r.y < WATER_Y - 2.0) { a.visible = false; if (a.view) a.view.visible = false; }
      }
    },
    dispose() { scope.dispose(); falling.length = 0; lastHit.clear(); },
  };
}
