// Grave Skeleton brain: meleeBrain + shield guard + the hero-grammar specials.
//   guard     frontal light hits are blocked with chance ai.guard while idle/walking (clank); two blocks in a row
//             → an immediate counter string. Heavy / magic / back hits / guardBreak go through.
//   string    slash → slash_2 (white) or the 4-hit pslash string (purple, ai.moveset)
//   specials  jump slash from 2–3.5 m (ai.jump), unblockable dash from 3–5 m (ai.dash), Death Stab (ai.deathStab,
//             purple) from 3–5 m; all gated by attack tokens.
// Rising / crumbling / reassembling are Enemy.js states (spawn opts.rise, def.reassemble).
import { meleeBrain } from '../_kit.js';

export default {
  id: 'skeleton',
  create(e, game, p = {}) {
    const set = (p.moveset || ['slash', 'thrust']).filter((m) => e.moves[m]);
    const opener = set[0] || 'slash';
    let specialCool = 120, counter = 0, lastBlock = -999;
    const brain = meleeBrain(e, game, p, {
      guard(ev) {
        const a = ev.attacker;
        if (!a || !e.fsm.is('idle', 'walk', 'block')) return false;
        if (Math.sign(a.pos.x - e.pos.x) !== e.facing) return false; // hit from behind
        if (ev.level !== 'light' || ev.moveId === 'throw_impact' || ev.moveId === 'throw') return false;
        const up = game.tick - lastBlock < 40 ? 0.9 : (p.guard ?? 0.5);
        if (!game.rng.chance(up)) return false;
        if (game.tick - lastBlock < 50) counter++; else counter = 1;
        lastBlock = game.tick;
        if (counter >= 2) { counter = 0; brain.cooldown = 0; }
        return true;
      },
      choose(c) {
        if (c.rng.chance(0.25 + (c.punish ? 0.2 : 0)) && set.includes('thrust') && c.adx > 1.0) return 'thrust';
        return opener;
      },
      special(c) {
        if (specialCool > 0) { specialCool--; return false; }
        if (c.heroBusy || c.adz > 0.45 || !c.canStrike || c.flankBusy) return false;
        const tk = game.ai && game.ai.tokens;
        const roll = c.rng.next() / Math.max(0.2, c.aggr);
        let m = null;
        if (p.deathStab && c.adx > 3 && c.adx < 5 && roll < p.deathStab * 0.04) m = 'death_stab';
        else if (p.dash && c.adx > 3 && c.adx < 5.2 && roll < p.dash * 0.04) m = 'dash';
        else if (p.jump && c.adx > 2 && c.adx < 3.4 && roll < p.jump * 0.04) m = 'jump_slash';
        if (!m || !e.moves[m]) return false;
        if (tk && !tk.request(e, c.t)) return false;
        specialCool = 200;
        return e.attackWith(m, c.t);
      },
    });
    return brain;
  },
};
