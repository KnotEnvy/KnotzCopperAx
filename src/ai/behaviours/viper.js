// Viper Maiden brain: meleeBrain tuned for range + mobility.
//   poke      whip-spear poke (+ chained second poke) from ~2 m, the edge of the hero's reach
//   leap      diving slash from 3–5.5 m (ai.leap), token-gated
//   backflip  when a hero crowds her (< 1.2 m) or right after she's hit and recovers: flips out of range (i-frames),
//             the body roll is driven here (Combatant.roll)
//   dash      unblockable lunge from 2.6–4.6 m (ai.dash)
//   riders    jump_slash (meleeBrain picks it automatically vs mounted heroes)
import { meleeBrain } from '../_kit.js';

const TAU = Math.PI * 2;

export default {
  id: 'viper',
  create(e, game, p = {}) {
    let flipCool = 60, leapCool = 90, dashCool = 150, wasHit = false;
    const brain = meleeBrain(e, game, p, {
      choose() { return 'poke'; },
      onHit() { wasHit = true; },
      onAttackTick(run) {
        if (run.id !== 'backflip') return undefined;
        const k = Math.min(1, run.frame / 26);
        // Combatant decays roll ×0.72 each tick after this hook; pre-compensate so the flip reads as one clean turn.
        e.roll = k >= 1 ? 0 : (e.facing * TAU * (1 - (1 - k) * (1 - k))) / 0.72;
        return undefined;
      },
      special(c) {
        if (flipCool > 0) flipCool--;
        if (leapCool > 0) leapCool--;
        if (dashCool > 0) dashCool--;
        const { t, adx, adz, rng, aggr } = c;
        // Crowded or just hit: backflip away (no token: it's evasion).
        if (flipCool <= 0 && adz < 0.9 && (adx < 1.2 || (wasHit && adx < 2.4)) && rng.chance((p.flip ?? 0.5) * (wasHit ? 0.9 : 0.12))) {
          wasHit = false; flipCool = 110;
          e.faceToward(t);
          game.bus.emit('ai:evade', { actor: e, kind: 'backflip' });
          return e.attackWith('backflip', t);
        }
        wasHit = false;
        if (c.heroBusy || adz > 0.5 || !c.canStrike) return false;
        const tk = game.ai && game.ai.tokens;
        let m = null;
        if (leapCool <= 0 && adx > 3 && adx < 5.5 && rng.chance((p.leap ?? 0.4) * aggr * 0.05)) m = 'leap';
        else if (dashCool <= 0 && adx > 2.6 && adx < 4.6 && rng.chance((p.dash ?? 0.25) * aggr * 0.05)) m = 'dash';
        if (!m) return false;
        // Don't dive onto a flank another foe is already using (r4 contact spacing).
        const dir = game.ai && game.ai.director;
        if (dir && dir.sideBusy && dir.sideBusy(e, t, Math.sign(e.pos.x - t.pos.x) || 1)) return false;
        if (tk && !tk.request(e, t)) return false;
        if (m === 'leap') leapCool = 200; else dashCool = 240;
        return e.attackWith(m, t);
      },
    });
    return brain;
  },
};
