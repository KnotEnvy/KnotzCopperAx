// Ogre Brute brain: meleeBrain + grab-and-toss, ground pound, dash, and Brute Brothers pair logic.
//   pair      ogres sharing spawn opts.group (default 'brutes') alternate: only the LEAD takes attack tokens; the
//             other holds a flank slot and menaces. The lead role passes to the partner after every attack, or at
//             once if the lead is floored. When one brother falls, the other ENRAGES ('ai:enrage': faster, meaner).
//   choose    grab (unmounted hero in reach), pound (hero close in front or two heroes near), else armoured swing
//   special   unblockable dash from 3.5–6.5 m
import { meleeBrain, grabbable } from '../_kit.js';

export default {
  id: 'ogre',
  create(e, game, p = {}) {
    const g = game.ai && game.ai.director ? game.ai.director.group('ogre:' + ((e.spawnOpts && e.spawnOpts.group) || 'brutes')) : { members: [] };
    g.members.push(e);
    if (!g.lead || !g.lead.alive) g.lead = e;
    let dashCool = 180, enraged = false, grabCool = 0;
    const partner = () => g.members.find((m) => m !== e && m.alive && !m.removed);
    const passLead = () => { const o = partner(); if (o) g.lead = o; };
    const P = { ...p };
    const brain = meleeBrain(e, game, P, {
      canAttack(c) {
        const o = partner();
        if (!o) return true;
        if (g.lead === e) return true;
        const leadDown = !g.lead || !g.lead.alive || (g.lead.fsm && g.lead.fsm.tagged('stunned'));
        if (leadDown) { g.lead = e; return true; }
        return c.adx < 1.2 && c.rng.chance(0.02); // crowded by the hero: a rare swat
      },
      choose(c) {
        if (grabCool <= 0 && c.adx < 1.8 && grabbable(c.t) && c.rng.chance(0.5)) { grabCool = 240; passLead(); return 'grab'; }
        const heroesNear = game.world.query({ kind: 'hero' }).filter((h) => Math.abs(h.pos.x - e.pos.x) < 3 && Math.abs(h.pos.z - e.pos.z) < 1.4).length;
        passLead();
        if (heroesNear > 1 || c.rng.chance(0.3)) return 'pound';
        return 'swing';
      },
      special(c) {
        if (grabCool > 0) grabCool--;
        if (dashCool > 0) { dashCool--; return false; }
        if (g.lead !== e && partner()) return false;
        if (c.heroBusy || !c.canStrike || c.adx < 3.5 || c.adx > 6.5 || c.adz > 0.5) return false;
        if (!c.rng.chance(0.012 * c.aggr)) return false;
        const tk = game.ai && game.ai.tokens;
        if (tk && !tk.request(e, c.t)) return false;
        dashCool = 300; passLead();
        return e.attackWith('dash', c.t);
      },
      onDeath() {
        const o = partner();
        g.members = g.members.filter((m) => m !== e);
        if (o && o.brain && o.brain.enrage) o.brain.enrage();
      },
    });
    brain.enrage = () => {
      if (enraged) return;
      enraged = true;
      P.aggression = Math.min(1, (P.aggression || 0.6) + 0.25);
      P.cooldown = [Math.round((P.cooldown || [50, 100])[0] * 0.7), Math.round((P.cooldown || [50, 100])[1] * 0.7)];
      e.speed *= 1.15; e.damageMul = (e.damageMul || 1) * 1.1;
      g.lead = e;
      e.localFlash('#ff4020', 20, 1.4, { point: { x: e.pos.x, y: e.pos.y + (e.height || 2.75) * 0.8, z: e.pos.z }, radius: 0.65 }); // C2 r1: enrage = a red glow on head + shoulders, not a red statue
      e.pause(50, { anim: 'taunt' });
      game.bus.emit('ai:enrage', { actor: e });
    };
    return brain;
  },
};
