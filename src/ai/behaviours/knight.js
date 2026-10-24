// Hollow Knight brain: meleeBrain + an always-up frontal guard and deliberate halberd play.
//   guard     every frontal LIGHT hit clanks off while the knight isn't mid-swing (heavy, charged heavy
//             (guardBreak), throws, magic and back attacks go through — the answer the player must learn)
//   counter   after two blocks in a row the knight answers with a quick 'counter' cut (still telegraphed)
//   anti-dash a hero running at it within reach gets the long thrust (GA knights swing early vs dash-ins)
//   choose    sweep (low, wide) vs thrust (long, narrow) vs armoured chop (up close / from behind)
//   heavy hit from the front → 'ai:guardBreak' (stagger flash) for VFX/audio
import { meleeBrain } from '../_kit.js';

export default {
  id: 'knight',
  create(e, game, p = {}) {
    let blocks = 0, lastBlock = -999, counterDue = false, antiCool = 0;
    return meleeBrain(e, game, p, {
      guard(ev) {
        const a = ev.attacker;
        if (!a || !e.fsm.is('idle', 'walk', 'block', 'pause')) return false;
        if (Math.sign(a.pos.x - e.pos.x) !== e.facing) return false;
        if (ev.level !== 'light' || ev.moveId === 'throw_impact' || ev.moveId === 'throw') return false;
        blocks = game.tick - lastBlock < 60 ? blocks + 1 : 1;
        lastBlock = game.tick;
        if (blocks >= 2) { counterDue = true; blocks = 0; }
        return true;
      },
      onHit(ev) {
        const a = ev.attacker;
        if (!ev.blocked && a && ev.level === 'heavy' && Math.sign(a.pos.x - e.pos.x) === e.facing) {
          e.localFlash('#ffffff', 8, 1.4, { point: ev.point, radius: 0.6 }); // C2 r1: guard-break flash at the impact (was a white statue)
          game.bus.emit('ai:guardBreak', { actor: e, by: a, point: ev.point });
        }
      },
      special(c) {
        if (antiCool > 0) antiCool--;
        // Counter after blocking: no token needed, it's a reaction.
        if (counterDue && c.adx < 2.2 && c.adz < 0.5 && (!game.ai || game.ai.director.canStrike(c.t, true, e))) { counterDue = false; return e.attackWith('counter', c.t); }
        if (game.tick - lastBlock > 40) counterDue = false;
        const t = c.t;
        const charging = t.fsm && t.fsm.is('run') && Math.sign(t.vel.x) === Math.sign(e.pos.x - t.pos.x);
        if (antiCool <= 0 && charging && c.canStrike && c.adx < 3.6 && c.adx > 1.2 && c.adz < 0.45) { antiCool = 150; return e.attackWith('thrust', t); }
        return false;
      },
      choose(c) {
        if (c.adx < 1.2 || c.behind) return 'chop';
        if (c.adx > 1.7) return c.rng.chance(0.65) ? 'thrust' : 'sweep';
        return c.rng.chance(0.5) ? 'sweep' : c.rng.chance(0.5) ? 'chop' : 'thrust';
      },
    });
  },
};
