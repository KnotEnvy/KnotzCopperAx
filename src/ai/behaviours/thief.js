// Pot Thief brain (DESIGN §4, GA Blue/Green Thief): non-hostile loot runner.
//   enter    runs in from off-screen to a spot near (not at) the heroes
//   cackle   stops to taunt (taunt clip + 'thief_cackle'), then keeps away at 3–4.5 m, dodging round in depth
//   kicked   every hit kicks it flying (knockdown) and spills 1–2 items from its sack (bouncing pots / meat)
//   flee     when the sack is empty or its time is up it sprints off-screen and escapes ('ai:escape')
//   steal    camp / bonus mode (params.steal = n or spawn opts.steal): sneaks to the hero with the most pots, pinches
//            up to n pots from their stock ('ai:steal') and bolts; kicking it gets them back plus extras
// Params (def.ai / spawn opts): sack [min,max], escapeAfter (ticks), keep [min,max] distance, steal, stealBonus.
// Loot kind: def.loot 'magic' → 'pot' pickups, 'meat' → 'food' pickups (tiers blue / green).
// Events: 'ai:thiefSpill' { actor, kind, n, left } · 'ai:steal' { actor, hero, n } · 'ai:escape' { actor, carried, stolen }
//   camp     spawn opts.camp = { x, z, ax, az, lit, minRun } (Thieves' Night, bonus-camp): a sack-carrying thief never
//            parks — it makes a telegraphed panic RUN round the fire ellipse (ax × az) of ≥ minRun ticks of motion,
//            with one stop-to-taunt beat (kick window) part-way, then bolts out; the escape only counts ('ai:escape')
//            when it leaves the fire-lit radius |x - camp.x| > lit. Each kick bursts the sack and restarts a shorter run.
import { viewRange, clampZ } from '../_kit.js';

export default {
  id: 'thief',
  create(e, game, p = {}) {
    const rng = game.rng;
    const o = e.spawnOpts || {};
    const P = { sack: [2, 4], escapeAfter: 60 * 10, keep: [3.0, 4.4], stealBonus: 2, ...p };
    const loot = e.def.loot === 'meat' ? 'food' : 'pot';
    e.sack = o.sack ?? rng.int(P.sack[0], P.sack[1]);
    e.stolen = 0;
    let steal = o.steal ?? P.steal ?? 0;
    let mode = steal ? 'steal' : 'enter';
    const C = o.camp || null;
    const R = { dir: 1, ang: 0, last: 0, end: 0, start: 0, tauntAt: -1, taunted: false, ticks: 0, t0: 0, exit: 1, restart: true, out: false, leg: false, fx: 0 };
    let born = game.tick, side = rng.sign(), zOff = rng.range(-1, 1), keepD = rng.range(P.keep[0] + 0.2, P.keep[1]), cackled = false, bonusGiven = false, stealT = 0, forced = 0, forcedSide = 1;
    const heroes = () => game.world.query({ kind: 'hero' }).filter((h) => h.alive);
    const nearest = () => { let b = null, bd = Infinity; for (const h of heroes()) { const d = Math.abs(h.pos.x - e.pos.x) + Math.abs(h.pos.z - e.pos.z); if (d < bd) { bd = d; b = h; } } return b; };
    const cackle = (ticks = 44) => {
      e.pause(ticks, { anim: 'taunt' });
      if (game.audio && game.audio.play) game.audio.play('thief_cackle', { pan: game.audio.panFor ? game.audio.panFor(e) : 0, volume: 0.85 });
      game.bus.emit('ai:taunt', { actor: e, cackle: true });
    };
    const spill = (n, dir) => {
      n = Math.min(n, e.sack);
      if (n <= 0 || !game.spawnPickup) return 0;
      e.sack -= n;
      for (let i = 0; i < n; i++) {
        // camp: a fan of big, high arcs out of the burst sack (readable at camp framing; bonus-camp r5)
        const fan = n > 1 ? (i / (n - 1) - 0.5) : 0;
        const vx = C ? dir * rng.range(1.0, 2.2) + fan * 2.6 : dir * rng.range(1.2, 3.2) + rng.range(-0.6, 0.6);
        const vz = C ? fan * 1.4 + rng.range(-0.4, 0.4) : rng.range(-1.6, 1.6);
        const pr = game.spawnPickup(loot, e.pos.x, clampZ(game, e.pos.z), C
          ? { y: 1.1, vx, vy: rng.range(6.8, 8.2), vz, delay: 40 + i * 4 }
          : { y: 0.9, vx, vy: rng.range(4.8, 6.8), vz, delay: 24 });
        if (C && pr && pr.then) pr.then((p) => { if (p && p.body) { p.body.scale.setScalar(1.4); p.shadowRadius = 0.32; p.campLoot = true; } });
        if (game.track && pr) game.track(pr);
      }
      game.bus.emit('ai:thiefSpill', { actor: e, kind: loot, n, left: e.sack });
      return n;
    };
    // ---- camp panic run (see header)
    // r10: opts.camp.sides = { dx, ax, az, z } → every thief runs its OWN loop on one side of the fire (centre x = ±dx), never across it
    const loopOf = (s) => (C.sides ? { cx: C.x + s * C.sides.dx, cz: C.sides.z ?? C.z, ax: C.sides.ax, az: C.sides.az } : { cx: C.x, cz: C.z, ax: C.ax, az: C.az });
    let L = C ? loopOf(side) : null;
    const angOf = () => Math.atan2((e.pos.z - L.cz) / L.az, (e.pos.x - L.cx) / L.ax);
    const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
    const startRun = () => {
      R.restart = false; R.leg = false;
      const s0 = Math.sign(e.pos.x - C.x) || side; L = loopOf(s0);
      const v = e.speed * 1.27, rMean = Math.sqrt((L.ax * L.ax + L.az * L.az) / 2), exitLen = Math.max(0.5, C.lit - Math.abs(L.cx - C.x) - L.ax);
      const needT = Math.max(150, (C.minRun || 204) - R.ticks);
      const arcNeed = Math.max(1, needT / 60 * v - exitLen);
      const a0 = angOf();
      let best = null;
      for (const th of C.sides ? [s0 > 0 ? 0 : Math.PI] : [0, Math.PI]) for (const dir of [1, -1]) {
        let d = (dir * (th - a0)) % (Math.PI * 2); if (d < 0) d += Math.PI * 2; if (d < 0.4) d += Math.PI * 2;
        if (C.sides && d * rMean < arcNeed) d += Math.PI * 2; // a small side loop: one more lap
        const len = d * rMean, ok = len >= arcNeed;
        const score = ok ? len : 1000 - len;
        if (!best || score < best.score) best = { score, d, dir, th };
      }
      R.dir = best.dir; R.start = R.ang = R.last = a0; R.end = a0 + best.dir * best.d; R.exit = Math.cos(best.th) > 0 ? 1 : -1;
      R.tauntAt = R.taunted ? -1 : best.d * rng.range(0.38, 0.5);
      R.t0 = game.tick; if (!R.first) R.first = game.tick;
    };
    const runFx = () => {
      if (!game.vfx || !game.vfx.spawn || ++R.fx % 18) return;
      game.vfx.spawn('sparkle', { pos: { x: e.pos.x - e.facing * 0.12, y: e.pos.y + e.height * 1.02, z: e.pos.z }, color: '#cfe8ff', count: 2 }); // panic sweat
      game.vfx.spawn('dust', { pos: e.pos, amount: 0.35, dir: -e.facing, kind: 'step' });
    };
    const campRun = (h) => {
      e.target = null; e.faceMove = true;
      if (R.restart) startRun();
      if (!R.out && R.leg && Math.abs(e.pos.x - C.x) > C.lit) {
        // out of the firelight: this one got away with its loot
        R.out = true; e.hurtable = false;
        game.bus.emit('ai:escape', { actor: e, carried: e.sack, stolen: e.stolen, lit: true, runTicks: game.tick - R.first });
      }
      if (R.out) {
        const vr = viewRange(game, e.pos.z);
        e.moveTo(C.x + (Math.sign(e.pos.x - C.x) || R.exit) * (C.lit + 30), e.pos.z, 1.5);
        if (e.pos.x > vr.xMax + 1.4 || e.pos.x < vr.xMin - 1.4) e.remove();
        return;
      }
      const a = angOf(); R.ang += wrapA(a - R.last); R.last = a;
      const prog = R.dir * (R.ang - R.start), left = R.dir * (R.end - R.ang);
      // (r9: not while it is hidden behind the campfire — the kick window has to be somewhere a hero can reach and see it)
      const behindFire = C.fire && e.pos.z < C.fire.z - 0.3 && Math.abs(e.pos.x - C.fire.x) < 2.6;
      if (R.tauntAt >= 0 && prog >= R.tauntAt && !behindFire) {
        // the telegraphed kick window: stops dead, shakes the sack at the nearest hero and cackles
        R.tauntAt = -1; R.taunted = true;
        if (h) e.faceToward(h);
        cackle(50);
        return;
      }
      R.ticks++; runFx();
      if (left > 0.08 && game.tick - R.t0 < (C.minRun || 204) + 360) {
        const ta = R.ang + R.dir * Math.min(0.55, left);
        e.moveTo(L.cx + Math.cos(ta) * L.ax, clampZ(game, L.cz + Math.sin(ta) * L.az), 1.27);
      } else { R.leg = true; e.moveTo(C.x + R.exit * (C.lit + 4), clampZ(game, e.pos.z), 1.35); }
    };
    const campKick = (ev, spilled) => {
      if (!game.vfx) return;
      // one designed sack burst (bonus-camp r6: vfx/effects/camp_sack_burst.js — burlap tear + coins + dust, drawn
      // behind the thief, thinned when bursts overlap); the pots themselves arc out as real pickups
      const dir = ev.dir || Math.sign(e.pos.x - (ev.attacker ? ev.attacker.pos.x : 0)) || 1;
      if (game.vfx.spawn) game.vfx.spawn('camp_sack_burst', { pos: { x: e.pos.x, y: e.pos.y + e.height * 0.62, z: e.pos.z }, groundY: 0, kind: loot, dir, n: spilled });
      if (game.cameraRig && game.cameraRig.shake) game.cameraRig.shake(0.12);
      if (game.cameraRig && game.cameraRig.punch) game.cameraRig.punch(0.03, 8);
    };
    return {
      get mode() { return mode; },
      get sack() { return e.sack; },
      preHit(ev) {
        // Every kick sends the thief flying (GA), and it can't be killed — it only runs away.
        ev.knockdown = true; ev.launch = Math.max(ev.launch || 0, 4.2); ev.knockback = Math.max(ev.knockback || 0, 3.2);
        // camp: a short comic hop, not a launch off-screen (the thief has to stay in the firelight to be chased)
        if (C) { ev.launch = Math.min(ev.launch, 4.4); ev.knockback = 3; }
      },
      onHit(ev) {
        if (ev.blocked) return;
        // Caught after stealing: the stolen pots come back plus extras (GA camp rule).
        if (e.stolen > 0 && !bonusGiven) { bonusGiven = true; e.sack += P.stealBonus; }
        const dir = ev.dir || Math.sign(e.pos.x - (ev.attacker ? ev.attacker.pos.x : 0)) || 1;
        const spilled = spill(C ? Math.max(1, Math.ceil(e.sack * 0.6)) : e.sack > 3 ? 2 : 1, dir);
        if (C) {
          // camp: the sack bursts (most of it flies), then the thief picks itself up and panics round the fire again
          campKick(ev, spilled);
          if (!R.out) { mode = e.sack > 0 ? 'run' : 'flee'; R.restart = true; }
          e.invuln = Math.max(e.invuln, 0);
          return;
        }
        if (mode === 'steal') mode = 'flee';
        if (e.sack <= 0) mode = 'flee';
        else if (mode !== 'flee') mode = 'keep';
        e.invuln = Math.max(e.invuln, 0);
      },
      update() {
        const h = nearest();
        const vr = viewRange(game, e.pos.z);
        if (!h) { e.stopMoving(); return; }
        const age = game.tick - born;
        // Dazed after a kick (seeing stars): a short window to chase it down for the next kick.
        if (e.fsm.prevName === 'getup' && e.fsm.ticks < 2 && mode !== 'flee') { e.pause(26, { anim: 'idle' }); return; }
        if (!C && mode !== 'flee' && mode !== 'steal' && age > P.escapeAfter) mode = 'flee';
        const dx = e.pos.x - h.pos.x;
        if (mode === 'steal') {
          e.faceMove = false;
          // Sneak to the hero with the most pots and pinch them.
          // camp r10: o.markSide keeps a sneak thief on the sleeper's own side of the fire (never across it)
          const mark = heroes().filter((x) => (x.pots || 0) > 0 && (o.markSide == null || Math.sign(x.pos.x - (C ? C.x : 0)) === o.markSide)).sort((a, b) => b.pots - a.pots)[0];
          if (!mark) { mode = C ? (e.sack > 0 ? 'run' : 'flee') : e.stolen ? 'flee' : 'keep'; return; }
          e.target = mark;
          const gx = mark.pos.x + (Math.sign(e.pos.x - mark.pos.x) || 1) * 0.55;
          if (Math.abs(e.pos.x - gx) < 0.3 && Math.abs(e.pos.z - mark.pos.z) < 0.35) {
            if (++stealT >= 3) {
              const n = Math.min(steal, mark.pots || 0);
              if (n > 0 && mark.addPots) { mark.addPots(-n); e.sack += n; e.stolen += n; }
              game.bus.emit('ai:steal', { actor: e, hero: mark, n });
              steal = 0; mode = C ? 'run' : 'flee'; R.restart = true;
              cackle(30);
            } else e.stopMoving();
            return;
          }
          stealT = 0;
          e.moveTo(gx, mark.pos.z, Math.abs(e.pos.x - gx) > 3 ? 1.3 : 0.8); // scurry in, tip-toe the last steps
          return;
        }
        if (mode === 'run') { if (e.sack > 0 || R.out) campRun(h); else mode = 'flee'; return; }
        if (mode === 'flee') {
          const dir = C && C.sides ? (Math.sign(e.pos.x - C.x) || side) : (Math.sign(dx) || side); // camp r10: out on its own side, never across the fire
          e.target = null; e.faceMove = true;
          const edge = dir > 0 ? vr.xMax + 2.5 : vr.xMin - 2.5;
          e.moveTo(edge + dir * 2, clampZ(game, e.pos.z + zOff * 0.2), 1.65);
          if ((dir > 0 && e.pos.x > vr.xMax + 1.4) || (dir < 0 && e.pos.x < vr.xMin - 1.4)) {
            game.bus.emit('ai:escape', { actor: e, carried: e.sack, stolen: e.stolen });
            e.remove();
          }
          return;
        }
        e.faceMove = false;
        e.target = h;
        if (mode === 'enter' && C) {
          // camp: scurry in to the edge of the firelight, cackle (first kick window), then the panic run
          const es = Math.sign(e.pos.x - C.x || side), EL = loopOf(es), gx = EL.cx + es * EL.ax;
          e.moveTo(gx, clampZ(game, C.z + zOff), 1.3);
          if (Math.abs(e.pos.x - gx) < 0.5 || age > 200) { mode = e.sack > 0 ? 'run' : 'flee'; R.restart = true; cackle(40); }
          return;
        }
        if (mode === 'enter') {
          const gx = h.pos.x + (Math.sign(dx) || side) * P.keep[1];
          e.moveTo(gx, clampZ(game, h.pos.z + zOff), 1.6);
          if (Math.abs(e.pos.x - gx) < 0.6 || age > 240) { mode = 'keep'; if (!cackled) { cackled = true; cackle(); return; } }
          return;
        }
        // keep away: hold 3–4.5 m from the nearest hero; if cornered at the screen edge, dart past in depth.
        let s = Math.sign(dx) || side;
        const near = Math.abs(dx) < P.keep[0];
        const cornered = (s > 0 && e.pos.x > vr.xMax - 1.2) || (s < 0 && e.pos.x < vr.xMin + 1.2);
        if (game.tick < forced) s = forcedSide;
        else if (cornered && near) { forcedSide = -s; forced = game.tick + 75; s = forcedSide; zOff = e.pos.z > h.pos.z ? 1.9 : -1.9; }
        let want = h.pos.x + s * keepD;
        let gz = clampZ(game, h.pos.z + zOff);
        // r5b: keep its own screen lane (a thief taunting from inside a marauder's column reads as one blob).
        const Dr = game.ai && game.ai.director;
        if (Dr && Dr.steer && game.tick >= forced) { const sg = Dr.steer(e, want, gz); want = Math.max(vr.xMin + 0.8, Math.min(vr.xMax - 0.8, sg.x)); gz = clampZ(game, sg.z); }
        if (near || Math.abs(e.pos.x - want) > 0.8 || Math.abs(e.pos.z - gz) > 0.5) e.moveTo(want, gz, (near ? 1.4 : 1.0) * (!near && Dr && Dr.columnAhead && Dr.columnAhead(e, want) ? 0.35 : 1));
        else {
          e.stopMoving();
          if (rng.chance(0.006)) cackle(36);
          else if (rng.chance(0.01)) { zOff = rng.range(-1.4, 1.4); keepD = rng.range(P.keep[0] + 0.2, P.keep[1]); }
        }
      },
    };
  },
};
