// Stage 2 — water ring-outs (DESIGN §10). Over the marked ring-out zones of the near lip there is no rail: a foe that
// is knocked down / thrown / launched within reach of the band edge goes OVER — the stage takes the body (skipPhysics),
// flies it off the lip, drops it into the lake with a splash, and it counts as a KO with `ringout: true` (RunStats
// doubles ring-out kills). While the shell dips toward the near side (sway), downed foes inside a zone slide toward
// the edge, so a knockdown at the lip is enough. Heroes never ring out (the band clamps them).
import { EV } from '../../../core/EventBus.js';
import { WATER_Y } from './shell.js';

const KNOCKED = new Set(['knockdown', 'thrown', 'down']);

export function createRingOuts(game, { zones, splash, shake }) {
  const scope = game.bus.scope();
  const lastHit = new Map();          // enemy id → attacker
  scope.on(EV.HIT, (ev) => { if (ev && ev.target && ev.attacker) lastHit.set(ev.target.id, ev.attacker); });
  const falling = [];
  const inZone = (x) => zones.some((z) => x > z.x0 && x < z.x1);

  function takeOver(a) {
    a.skipPhysics = true;
    a.boundsMode = 'none';
    a.hurtable = false; a.solid = false;
    a._s2ringout = { vx: a.vel.x * 0.6, vy: Math.max(3.2, a.vel.y + 2.5), vz: 3.6, y: (a.groundY || 0) + a.pos.y, spin: 0 };
    a.hp = 0;
    const by = lastHit.get(a.id) || null;
    try { if (a.fsm && a.fsm.go) a.fsm.go('dead'); } catch (e) { /* state machine may refuse; physics takeover still runs */ }
    game.bus.emit(EV.KO, { actor: a, by, ringout: true, cause: 'ringout' });
    game.bus.emit('stage2:ringout', { actor: a, by });
    falling.push(a);
  }

  return {
    zones,
    /** Sim tick (runs after the world step). `dip` = 0..1 how far the shell currently tilts toward the water. */
    update(dt, dip = 0) {
      const band = game.world.band;
      const edge = band.zMax;
      for (const a of game.world.actors) {
        if (a.kind !== 'enemy' || !a.alive || a.removed || a._s2ringout || !inZone(a.pos.x)) continue;
        const sName = (a.fsm && a.fsm.name) || '';
        const knocked = KNOCKED.has(sName) || (!a.grounded && sName === 'hitstun');
        if (!knocked) continue;
        // slide toward the lip while the shell dips (downed bodies only)
        if (sName === 'down' && dip > 0.35 && a.pos.z > edge - 0.9) a.pos.z = Math.min(edge, a.pos.z + dt * 0.9 * dip);
        const reach = sName === 'down' ? 0.04 : 0.32;
        if (a.pos.z >= edge - reach) takeOver(a);
      }
      for (let i = falling.length - 1; i >= 0; i--) {
        const a = falling[i], r = a._s2ringout;
        if (a.removed) { falling.splice(i, 1); continue; }
        r.vy -= 16 * dt;
        a.pos.x += r.vx * dt; a.pos.z += r.vz * dt; r.y += r.vy * dt;
        r.vz *= 0.985;
        r.spin += dt * 3.2;
        if (a.body) a.body.rotation.x = Math.min(1.4, r.spin);
        a.pos.y = r.y - (a.groundY || 0);
        if (!r.splashed && r.y <= WATER_Y + 0.15) {
          r.splashed = true;
          if (splash) splash(a.pos.x, WATER_Y + 0.05, a.pos.z, 1.6);
          if (shake) shake(0.25);
          if (game.audio && game.audio.play) try { game.audio.play('bodyfall', { volume: 0.8, pitch: 0.7 }); } catch (e) { /* optional */ }
        }
        if (r.y < WATER_Y - 2.2) { a.visible = false; if (a.view) a.view.visible = false; }
      }
    },
    dispose() { scope.dispose(); falling.length = 0; lastHit.clear(); },
  };
}
