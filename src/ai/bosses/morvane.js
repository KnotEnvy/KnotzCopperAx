// Morvane Deathcoil brain (bosses agent; attached by types/boss_morvane.js).
//   phase 1 (100–55 %): cleave, sweep, plant (ground witchfire orbs, vulnerable window), shadow (eruptions), summon
//   phase 2 (< 55 %)  : faster cooldowns, serpent lunge across the arena, mirror (steals a knocked hero's magic),
//                       6-way plant orb burst; drops a GA-style roast on the phase transition.
import { EV } from '../../core/EventBus.js';
import { clamp } from '../../core/math.js';
import { spark, eruption, stolenSpell, elementOf } from '../../enemies/bosses/_fx.js';
import { reportError } from '../../core/log.js';
import { clampZ } from '../_kit.js';

export default {
  id: 'morvane',
  create(b, game) {
    const rng = game.rng;
    const cool = { cleave: 0, sweep: 0, plant: 120, shadow: 200, summon: 420, lunge: 0, mirror: 0 };
    let cd = 70, target = null, retarget = 0, mirrorVictim = null, lastMove = null;
    const scope = game.bus.scope();
    scope.on(EV.HIT, (ev) => {
      if (ev.attacker !== b || !ev.target || ev.target.kind !== 'hero' || b.phase < 2) return;
      if ((ev.knockdown || (ev.hit && ev.hit.knockdown)) && !String(ev.moveId || '').startsWith('boss_stolen')) mirrorVictim = ev.target;
    });
    const phase2 = () => b.phase >= 2;
    const pick = () => {
      const hs = b.heroes().filter((h) => !h.fsm || !h.fsm.is('dead'));
      if (!hs.length) return null;
      const up = hs.filter((h) => !h.fsm || !h.fsm.is('down', 'getup', 'knockdown'));
      const pool = up.length ? up : hs;
      if (target && pool.includes(target) && retarget > 0) return target;
      retarget = rng.int(300, 480);
      const other = pool.filter((h) => h !== target);
      return (other.length && rng.chance(0.7) ? other : pool).sort((a, c) => Math.abs(a.pos.x - b.pos.x) - Math.abs(c.pos.x - b.pos.x))[0];
    };
    const use = (id, t, extra = 0) => {
      const mul = phase2() ? 0.75 : 1;
      const base = { cleave: 150, sweep: 170, plant: 330, shadow: 420, summon: 1800, lunge: 300, mirror: 480 }[id] || 120;
      cool[id] = Math.round(base * mul);
      cd = Math.round((rng.int(78, 118) + extra) * mul * (b.heroes().length > 1 ? 0.8 : 1.12));   // solo: a beat more air (r3 1P tune)
      lastMove = id;
      if (id === 'plant') b.vulnerable = 108;
      b.attackWith(id, t);
      game.bus.emit('boss:move', { boss: b, moveId: id });
    };
    const brain = {
      get target() { return target; },
      onPhase() { cd = 50; cool.lunge = 60; cool.plant = 90; dropFood(); },
      update() {
        for (const k in cool) if (cool[k] > 0) cool[k]--;
        if (retarget > 0) retarget--;
        target = pick();
        b.target = target;
        if (!target) { b.stopMoving(); return; }
        const t = target, dx = t.pos.x - b.pos.x, adx = Math.abs(dx), adz = Math.abs(t.pos.z - b.pos.z);
        const busy = t.fsm && t.fsm.is('down', 'getup', 'knockdown');
        if (cd > 0) cd--;
        // Mirror first: the knocked-down hero's own spell comes back (phase 2).
        if (cd <= 0 && phase2() && mirrorVictim && cool.mirror <= 0) { const v = mirrorVictim; mirrorVictim = null; b.mirrorOf = v; use('mirror', t, 40); return; }
        if (cd <= 0 && !busy) {
          const summonOk = cool.summon <= 0 && b.liveMinions() === 0 && b.hp < b.maxHp * 0.85;
          if (summonOk) { use('summon', t, 30); return; }
          const close = adx < 2.7 && adz < 0.9;
          const opts = [];
          if (close) {
            if (cool.cleave <= 0) opts.push(['cleave', 3]);
            if (cool.sweep <= 0) opts.push(['sweep', adz > 0.45 ? 4 : 2.5]);
            if (cool.plant <= 0) opts.push(['plant', 0.8]);
          } else {
            if (cool.plant <= 0) opts.push(['plant', adx > 4 ? 3 : 1.6]);
            if (cool.shadow <= 0) opts.push(['shadow', 2]);
            if (phase2() && cool.lunge <= 0 && adx > 2.8 && adx < 7.5 && adz < 0.8) opts.push(['lunge', 3]);
          }
          const filtered = opts.filter(([id]) => id !== lastMove || opts.length === 1);
          if (filtered.length) {
            let sum = 0; for (const o of filtered) sum += o[1];
            let r = rng.range(0, sum), id = filtered[0][0];
            for (const o of filtered) { r -= o[1]; if (r <= 0) { id = o[0]; break; } }
            use(id, t);
            return;
          }
        }
        // Stalk: hold axe range on the target's lane (far range while the target is getting up — no wake-up camping); stay inside arena centre.
        const lk = game.cameraRig && game.cameraRig.lock;
        const mid = lk ? (lk.xMin + lk.xMax) / 2 : b.pos.x;
        let side = Math.sign(b.pos.x - t.pos.x) || 1;
        const want = busy ? 3.1 : (cool.cleave <= 0 || cool.sweep <= 0 ? 2.0 : 2.8);
        if (Math.abs(t.pos.x + side * want - mid) > 4.2 && Math.abs(t.pos.x - side * want - mid) < Math.abs(t.pos.x + side * want - mid)) side = -side;
        const gx = clamp(t.pos.x + side * want, mid - 4.4, mid + 4.4);
        let gz = clampZ(game, t.pos.z, 0.3);
        // C1 r9: never plant his feet on a lying hero — take the next lane over (board r8 "downed-hero pile")
        for (const h of b.heroes()) {
          if (h === t || !h.fsm || !h.fsm.is('down', 'knockdown', 'getup')) continue;
          const lx = h.pos.x - (h.facing || 1) * (h.height || 1.9) * 0.2;
          if (Math.abs(lx - gx) < 1.9 && Math.abs(h.pos.z - gz) < 0.9) gz = clampZ(game, h.pos.z + (gz >= h.pos.z ? 1.1 : -1.1), 0.3);
        }
        if (Math.hypot(gx - b.pos.x, gz - b.pos.z) > 0.35) b.moveTo(gx, gz, adx > 5 ? 1.3 : 0.85);
        else { b.stopMoving(); b.faceToward(t); }
      },
      onAttackTick(run) {
        const f = run.frame + 1, fx = b.fx;
        if (!fx) return undefined;
        try {
          if (run.id === 'plant' && f === 22) {
            const hs = b.heroes();
            if (phase2()) {
              for (let i = 0; i < 6; i++) spark(fx, b, hs[i % hs.length], { angle: (i - 2.5) * 0.36, speed: 3.0, turn: 1.3, damage: 6, life: 300 });
            } else {
              spark(fx, b, target, { speed: 3.5, turn: 2.1, damage: 9 });
              if (hs.length > 1) spark(fx, b, hs.find((h) => h !== target) || target, { angle: 0.5, speed: 3.2, turn: 1.9, damage: 9 });
            }
            if (game.cameraRig && game.cameraRig.shake) game.cameraRig.shake(0.25);
          }
          if (run.id === 'shadow' && f === 22) {
            const hs = b.heroes();
            for (const h of hs) eruption(fx, b, { x: h.pos.x + (h.vel ? h.vel.x * 0.35 : 0), z: h.pos.z }, { delay: 52, radius: 1.25, damage: 9 });
            const band = game.world.band;
            eruption(fx, b, { x: (hs[0] ? hs[0].pos.x : b.pos.x) + rng.range(-3, 3), z: rng.range(band.zMin + 0.4, band.zMax - 0.4) }, { delay: 64, radius: 1.1, damage: 9 });
          }
          if (run.id === 'mirror' && f === 26) stolenSpell(fx, b, b.mirrorOf || target, elementOf(b.mirrorOf || target));
          if (run.id === 'summon' && f === 28) summon();
        } catch (e) { reportError('ai:morvane.attackTick', e); }
        return undefined;
      },
      dispose() { scope.dispose(); },
    };
    // Mid-fight relief (GA roast + r3 1P tune): as the relic corrupts him, a roast tumbles from the throne dais toward
    // the heroes — one for a solo hero (plus one per extra hero in co-op), dropped on the heroes' side of the arena.
    function dropFood() {
      if (!game.spawnPickup) return;
      const hs = b.heroes();
      const n = hs.length > 1 ? hs.length - 1 : 1;
      const cx = hs.length ? hs.reduce((s2, h) => s2 + h.pos.x, 0) / hs.length : b.pos.x - 3;
      const side = Math.sign(cx - b.pos.x) || -1;
      for (let i = 0; i < n; i++) {
        const x = b.pos.x + side * (2.2 + i * 0.9), z = clampZ(game, (i % 2 ? -0.6 : 0.5), 0.4);
        game.track(game.spawnPickup('food', x, z, { y: 2.4, vx: side * 2.2, vy: 5.5, vz: 0, delay: 30, life: 60 * 30 }));
      }
    }
    async function summon() {
      const hs = b.heroes();
      const cx = hs.length ? hs.reduce((s, h) => s + h.pos.x, 0) / hs.length : b.pos.x;
      const band = game.world.band;
      const n = hs.length > 1 ? 4 : 3;   // solo: 3 (r3 1P tune — strict arcade failed narrowly at Morvane)
      game.bus.emit('boss:summon', { boss: b, count: n });
      if (game.cameraRig && game.cameraRig.shake) game.cameraRig.shake(0.35);
      let mod = null;
      try { mod = await import('../../enemies/spawnEnemy.js'); } catch (e) { reportError('ai:morvane.summon', e); return; }
      const spots = [[-2.6, -0.9], [2.8, 0.9], [-2.0, 1.2], [2.2, -1.3]];
      for (let i = 0; i < n; i++) {
        let x = cx + spots[i][0];
        const z = clampZ(game, spots[i][1] + rng.range(-0.3, 0.3), 0.4);
        // C1 r9: never rise on top of a hero (lying or not) or at Morvane's feet — slide the spot outward
        const sx = Math.sign(spots[i][0]) || 1;
        for (let k = 0; k < 6; k++) {
          const near = [...hs, b].some((a) => Math.abs(a.pos.x - x) < 1.3 && Math.abs(a.pos.z - z) < 0.8);
          if (!near) break;
          x += sx * 0.6;
        }
        const p = mod.spawnEnemy(game, 'skeleton', { x, z, tier: 'purple', rise: true, facing: x > cx ? -1 : 1, summoned: true });
        game.track(p);
        p.then((e) => { if (e) { if (n < 4) e.damageMul = (e.damageMul || 1) * 0.8; b.addMinion(e); if (b.defeated && game.combat) game.combat.applyHit(b, e, { damage: 999, knockdown: true, level: 'magic' }, { moveId: 'boss_fall' }); } });
        void band;
      }
    }
    return brain;
  },
};
