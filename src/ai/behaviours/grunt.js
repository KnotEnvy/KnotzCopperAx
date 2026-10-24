// Grunt brain (Ashen Marauders and any club/mace footsoldier), built on the shared meleeBrain (src/ai/_kit.js):
// director slot + token → close in and swing; without a token, hold a surround slot (both sides, in depth) and
// circle. Tier params (enemy def.ai): moveset (which moves this tier uses), smashBias, dash (chance of the
// unblockable dash from 2.8–5.5 m), plus the meleeBrain params (spacing, attackRange, reaction, aggression,
// cooldown, feint, taunt, retreatHp…). Mounted heroes get the rider-dismounting jump slash.
import { meleeBrain } from '../_kit.js';

export default {
  id: 'grunt',
  create(e, game, p = {}) {
    const set = new Set((p.moveset || Object.keys(e.moves)).filter((m) => e.moves[m]));
    let dashCool = 90;
    return meleeBrain(e, game, p, {
      choose(c) {
        const { rng, aggr, behind, punish } = c;
        // Armoured smash: more likely from behind (the hero can't see it) or to trade through a hero's string.
        const heroSwinging = c.t.attack && !punish;
        if (set.has('smash') && rng.chance(((behind ? 0.45 : 0) + (heroSwinging ? 0.3 : 0) + (p.smashBias ?? 0.25)) * aggr)) return 'smash';
        if (set.has('jab') && (punish || rng.chance(0.45))) return 'jab';
        return set.has('swing') ? 'swing' : [...set][0];
      },
      special(c) {
        if (dashCool > 0) dashCool--;
        if (!set.has('dash') || dashCool > 0 || c.adx < 2.8 || c.adx > 5.5 || c.adz > 0.4 || c.heroBusy || c.mounted || !c.canStrike || c.flankBusy) return false;
        const tk = game.ai && game.ai.tokens;
        if (!c.rng.chance((p.dash || 0) * c.aggr * 0.06)) return false;
        if (tk && !tk.request(e, c.t)) return false;
        dashCool = 240;
        return e.attackWith('dash', c.t);
      },
    });
  },
};
