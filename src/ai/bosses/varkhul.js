// Iron Chancellor Varkhul brain (bosses agent; attached by types/boss_varkhul.js).
//   close (|dx| < 2.5): flail sweep (wide depth) / windmill spin (when crowded by 2 heroes)
//   mid   (2.1 – 4.3) : overhead flail smash (reach 3 m + shock)
//   lieutenant       : 'rally' calls a Hollow Knight (≤ 85 % HP, none of his knights alive, 35 s cooldown)
//   phase 2 (60 %)   : callWall() — 2 knights march in as a shield wall in front of him; while they stand he hangs
//                      back behind them and smashes over their heads (wall mode).
import { clampZ } from '../_kit.js';
import { clamp } from '../../core/math.js';
import { reportError } from '../../core/log.js';

export default {
  id: 'varkhul',
  create(b, game) {
    const rng = game.rng;
    const cool = { flail_sweep: 0, flail_smash: 0, flail_spin: 240, rally: 360 };
    let cd = 60, target = null, retarget = 0, lastMove = null;
    const wall = new Set();
    const knights = () => { let n = 0; for (const k of b.minions) if (k.alive && !k.removed) n++; return n; };
    const wallUp = () => { let n = 0; for (const k of wall) if (k.alive && !k.removed) n++; return n; };
    const use = (id, t, extra = 0) => {
      const base = { flail_sweep: 160, flail_smash: 190, flail_spin: 420, rally: 2400 }[id] || 120;
      const mul = b.phase >= 2 ? 0.8 : 1;
      cool[id] = Math.round(base * mul);
      cd = Math.round((rng.int(80, 124) + extra) * mul * (b.heroes().length > 1 ? 0.8 : 1));
      lastMove = id;
      b.attackWith(id, t);
      game.bus.emit('boss:move', { boss: b, moveId: id });
    };
    async function call(n, tier, asWall, hp) {
      let mod = null;
      try { mod = await import('../../enemies/spawnEnemy.js'); } catch (e) { reportError('ai:varkhul.call', e); return; }
      const band = game.world.band;
      for (let i = 0; i < n; i++) {
        const z = asWall ? band.zMin + (band.zMax - band.zMin) * (i + 0.5) / n : clampZ(game, rng.range(-1.5, 1.5), 0.4);
        const side = asWall ? (b.facing > 0 ? 'left' : 'right') : (i % 2 ? 'left' : 'right');
        const vis = game.cameraRig && game.cameraRig.visibleRange ? game.cameraRig.visibleRange(z) : { xMin: b.pos.x - 9, xMax: b.pos.x + 9 };
        const x = side === 'left' ? vis.xMin - 1.4 : vis.xMax + 1.4;
        // Lieutenants and shield-wall knights both form up near Varkhul so they don't drag heroes to the arena edge
        const enterX = clamp(b.pos.x + b.facing * (asWall ? 1.9 + (i % 2) * 0.4 : 2.1), vis.xMin + 2.6, vis.xMax - 2.6);
        const p = mod.spawnEnemy(game, 'knight', { x, z, tier, facing: side === 'left' ? 1 : -1, enterFrom: { x: enterX, z, run: true }, summoned: true, hp: hp * (b.heroes().length > 1 ? 1.4 : 1) });
        game.track(p);
        p.then((e) => { if (!e) return; e.damageMul = (e.damageMul || 1) * 0.7; b.addMinion(e); if (asWall) wall.add(e); });
      }
      game.bus.emit('boss:summon', { boss: b, count: n, wall: !!asWall });
    }
    const brain = {
      callWall() { call(2, 'silver', true, 55); cd = 120; },
      update() {
        for (const k in cool) if (cool[k] > 0) cool[k]--;
        if (retarget > 0) retarget--;
        const hs = b.heroes().filter((h) => !h.fsm || !h.fsm.is('dead'));
        if (!hs.length) { b.stopMoving(); return; }
        if (!target || !hs.includes(target) || retarget <= 0) { target = hs[rng.int(0, hs.length - 1)]; retarget = rng.int(300, 460); }
        const t = target; b.target = t;
        const dx = t.pos.x - b.pos.x, adx = Math.abs(dx), adz = Math.abs(t.pos.z - b.pos.z);
        const busy = t.fsm && t.fsm.is('down', 'getup', 'knockdown');
        if (cd > 0) cd--;
        const walling = wallUp() > 0;
        if (cd <= 0 && !busy) {
          if (!walling && cool.rally <= 0 && knights() === 0 && b.hp < b.maxHp * 0.85) { use('rally', t, 20); call(1, 'silver', false, 80); return; }
          const crowded = hs.filter((h) => Math.abs(h.pos.x - b.pos.x) < 2.2 && Math.abs(h.pos.z - b.pos.z) < 1.3).length > 1;
          const opts = [];
          if (adx < 2.5 && adz < 1.0) {
            if (cool.flail_sweep <= 0) opts.push(['flail_sweep', 3]);
            if (cool.flail_spin <= 0) opts.push(['flail_spin', crowded ? 5 : 1]);
          }
          if (adx >= 2.1 && adx < 4.3 && adz < 0.7 && cool.flail_smash <= 0) opts.push(['flail_smash', walling ? 6 : 3]);
          const f = opts.filter(([id]) => id !== lastMove || opts.length === 1);
          if (f.length) {
            let sum = 0; for (const o of f) sum += o[1];
            let r = rng.range(0, sum), id = f[0][0];
            for (const o of f) { r -= o[1]; if (r <= 0) { id = o[0]; break; } }
            use(id, t);
            return;
          }
        }
        // Positioning: behind the shield wall at smash range, else close to flail range; never back into the arena edge.
        const lk = game.cameraRig && game.cameraRig.lock;
        const mid = lk ? (lk.xMin + lk.xMax) / 2 : (b.homeX ?? b.pos.x);
        let side = Math.sign(b.pos.x - t.pos.x) || 1;
        const want = busy ? 2.9 : walling ? 2.7 : (cool.flail_smash <= 0 ? 2.6 : 1.9);
        if (Math.abs(t.pos.x + side * want - mid) > 3.8 && Math.abs(t.pos.x - side * want - mid) < Math.abs(t.pos.x + side * want - mid)) side = -side;
        const gx = clamp(t.pos.x + side * want, mid - 4.0, mid + 4.0), gz = clampZ(game, t.pos.z, 0.3);
        if (Math.hypot(gx - b.pos.x, gz - b.pos.z) > 0.35) b.moveTo(gx, gz, adx > 4.5 ? 1.35 : 0.95);
        else { b.stopMoving(); b.faceToward(t); }
      },
      dispose() {},
    };
    return brain;
  },
};
