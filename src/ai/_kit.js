// Shared brain kit (private helper: '_' files are not registered as behaviours).
//   meleeBrain(e, game, P, hooks) → brain  — the common crowd-fighter loop used by grunt / skeleton / knight / viper /
//   ogre: director target + slot, token-gated approach, surround/flank circling, feints, retreat-when-hurt, wake-up
//   swings, whiff punishes, rider jump-slashes. Per-type flavour comes from hooks:
//     hooks.choose(c) → moveId | null      pick the melee move once in range with a token (c = context below)
//     hooks.special(c) → bool              act outside the normal loop (dash, leap, backflip, counter); true = acted
//     hooks.canAttack(c) → bool            veto taking a token (Brute Brothers alternate)
//     hooks.guard(ev) / preHit / onHit / react / onAttackTick   passed through onto the brain (see Enemy.js)
//   context c = { t, dx, dz, adx, adz, aggr, behind, punish, rng, game, e, P, tick, mounted, heroBusy }
//   P (enemy def.ai): spacing, attackRange, reaction, aggression, cooldown [min,max], depthTol, rush, feint, taunt,
//     retreatHp, retreatChance, retreatTicks, wakeSwing
export const defaults = {
  spacing: 2.2, attackRange: 1.25, reaction: 12, aggression: 0.6, cooldown: [34, 80], depthTol: 0.36, rush: 1.15,
  feint: 0.12, taunt: 0.05, retreatHp: 0.34, retreatChance: 0.55, retreatTicks: 100, wakeSwing: 1,
};

/** Can an enemy grab/affect this hero right now? */
export function grabbable(v) {
  return !!(v && v.kind === 'hero' && v.alive && !v.removed && v.grounded && !v.mountedOn && v.invuln <= 0 && v.fsm
    && !v.fsm.is('dead', 'down', 'getup', 'grabbed', 'thrown', 'dodge', 'magic', 'magicSelect', 'knockdown', 'clinch', 'throw'));
}

/** Is the hero recovering from a move that missed (punish window)? */
export function heroOpen(t) {
  const ta = t && t.attack;
  return !!(ta && !ta.anyHit && ta.frame > (ta.def.startup || 0) + (ta.def.active || 0));
}

/** Visible x range at depth z (thieves run off-screen, spawners). c1r10: measured on the real camera projection of
 *  the floor (feet) at depth z — rig.visibleRange() is a flat-plane estimate that runs ~1 m wide on the back rows, so
 *  waiters the AI thought were in frame stood with their feet past the screen edge. Falls back to the rig estimate. */
const _vr = { tick: -1, cam: null, m: new Map() };
export function viewRange(game, z = 0) {
  const rig = game.cameraRig, c = rig && rig.camera;
  if (c && c.projectionMatrix && !(game.ai && game.ai.director && game.ai.director.v9View)) {
    if (_vr.tick !== game.tick || _vr.cam !== c) { _vr.tick = game.tick; _vr.cam = c; _vr.m.clear(); }
    const k = Math.round(z * 10);
    let r = _vr.m.get(k);
    if (!r) {
      const V = c.position.constructor, cx = c.position.x;
      c.updateMatrixWorld();
      const p0 = new V(cx, 0, z).project(c).x, p1 = new V(cx + 1, 0, z).project(c).x, sl = p1 - p0;
      r = Number.isFinite(sl) && sl > 1e-4 ? { xMin: cx + (-1 - p0) / sl, xMax: cx + (1 - p0) / sl } : null;
      if (r) _vr.m.set(k, r);
    }
    if (r) return r;
  }
  const r = rig && rig.visibleRange ? rig.visibleRange(z) : null;
  return r && Number.isFinite(r.xMin) ? r : { xMin: -9, xMax: 9 };
}

/** c1r9: is e's body (feet ± ~0.5 m) outside the camera frame at its depth? */
export function offFrame(game, e, pad = 0.5) {
  const vr = viewRange(game, e.pos.z);
  return e.pos.x < vr.xMin + pad || e.pos.x > vr.xMax - pad;
}

export function clampZ(game, z, pad = 0.2) {
  const b = game.world.band || { zMin: -3, zMax: 3 };
  return Math.max(b.zMin + pad, Math.min(b.zMax - pad, z));
}

/** r5: depth for a detour round the hero, as far out as the band allows (≥ 2 m reads as clearly behind / in front). */
function crossZ(game, tz, pref, off = 2.1) {
  const a = clampZ(game, tz + pref * off);
  if (Math.abs(a - tz) >= 1.6) return a;
  const b = clampZ(game, tz - pref * off);
  return Math.abs(b - tz) > Math.abs(a - tz) ? b : a;
}

/** C2 r15: which depth side a detour round hero t takes (+1 behind / -1 in front of his row): its own side, unless the director
 *  (co-op flank plan) picks the clearer lane. */
function xPref(game, e, t) {
  const own = e.pos.z >= t.pos.z ? 1 : -1, d = game.ai && game.ai.director;
  return d && d.crossPref ? d.crossPref(e, t, own) : own;
}

export function meleeBrain(e, game, params = {}, hooks = {}) {
  const P = { ...defaults, ...params };
  const rng = game.rng;
  const D = () => game.ai && game.ai.director;
  const tokens = () => game.ai && game.ai.tokens;
  const rankAggro = e.rank ? e.rank.aggro : 0;
  let think = rng.int(0, P.reaction);
  let cooldown = rng.int(16, 44);
  let orbit = rng.range(-0.8, 0.8);
  let lastCtl = game.tick;
  let retreatUntil = 0, nextRetreat = 0, feintCool = 0, tauntCool = rng.int(120, 300);
  let mode = 'approach';
  let blockWait = 0, holdWalk = 0, waitHeld = 0, waitFree = 0, offTicks = 0, atkWalk = 0, roundT = 0; // r6 clear-path gate counters (waiters hold ≤ holdMax ticks, then walk on)
  const heroCount = () => game.world.query({ kind: 'hero' }).length;
  const cool = (aggr) => Math.round(rng.int(P.cooldown[0], P.cooldown[1]) * Math.max(0.5, 1.3 - aggr) * (heroCount() > 1 ? 0.85 : 1));
  const brain = {
    P,
    get mode() { return mode; },
    set cooldown(v) { cooldown = v; },
    get cooldown() { return cooldown; },
    update() {
      const d = D();
      const t = d ? d.targetFor(e) : game.world.nearest(e, { kind: 'hero' });
      if (!t) { e.stopMoving(); mode = 'idle'; return; }
      e.target = t;
      const tick = game.tick;
      // Back in control after a hit or get-up (not after its own swing): often swing straight away.
      const woke = e.fsm.prevName === 'getup' ? 0.85 : e.fsm.prevName === 'hitstun' ? 0.5 : e.fsm.prevName === 'block' ? 0.6 : 0;
      if (tick - lastCtl > 8 && cooldown > 10 && woke && rng.chance(woke * P.aggression * P.wakeSwing)) cooldown = rng.int(2, 8);
      lastCtl = tick;
      if (--think <= 0) { think = (d ? d.reaction(P.reaction) : P.reaction) + rng.int(0, 6); if (rng.chance(0.15)) orbit = rng.range(-0.9, 0.9); }
      if (cooldown > 0) cooldown--;
      if (feintCool > 0) feintCool--;
      if (tauntCool > 0) tauntCool--;
      const dx = t.pos.x - e.pos.x, dz = t.pos.z - e.pos.z, adx = Math.abs(dx), adz = Math.abs(dz);
      const aggr = d ? d.aggression(e, t, P.aggression + rankAggro) : P.aggression;
      const c = { t, dx, dz, adx, adz, aggr, rng, game, e, P, tick, mounted: !!t.mountedOn, punish: heroOpen(t),
        behind: Math.sign(e.pos.x - t.pos.x) === -(t.facing || 1), heroBusy: !!(t.fsm && t.fsm.is('down', 'getup', 'dead')) };
      c.canStrike = d ? d.canStrike(t, false, e) : true;
      c.flankBusy = !!(d && d.sideBusy && d.sideBusy(e, t, Math.sign(e.pos.x - t.pos.x) || 1)); // gap-closers skip a used flank // offensive specials respect the per-hero strike budget
      const tk = tokens();
      // r7 vanguard (director.entryLane): the wave's first arrival while nobody is on the hero goes straight in —
      // token now, no queueing / hand-overs / column holds, at a run — so a new wave engages within a beat.
      const van = !!(e.vanguard && tick - e.vanguard < 240 && !(t.fsm && t.fsm.is('dead')) && e.aiTarget === t); // r8: stays a vanguard while the hero is down / getting up (it closes in and swings the moment he can act)
      if (e.vanguard && !van) e.vanguard = 0;
      // Retreat when hurt: one foe per hero backs off to catch its breath, then returns.
      if (tick < retreatUntil) {
        mode = 'retreat';
        if (tk) tk.release(e);
        const side = Math.sign(e.pos.x - t.pos.x) || 1;
        const rvr = viewRange(game, t.pos.z), rx = Math.max(rvr.xMin + 1.8, Math.min(rvr.xMax - 1.8, t.pos.x + side * Math.min(4.8, P.spacing * 2.3)));
        const rg = d && d.steer ? d.steer(e, rx, clampZ(game, t.pos.z + orbit * 1.8)) : { x: rx, z: t.pos.z + orbit * 1.8 }; // r5b: own screen lane
        e.moveTo(Math.max(rvr.xMin + 1.2, Math.min(rvr.xMax - 1.2, rg.x)), clampZ(game, rg.z), d && d.columnAhead && d.columnAhead(e, rg.x) ? 0.4 : 1.05); // catch its breath in frame, not off at the edge
        e.faceToward(t);
        if (adx < 1.1 && adz < P.depthTol && hooks.choose && (!d || d.canStrike(t, true, e))) { const m = hooks.choose(c); if (m) { e.attackWith(m, t); retreatUntil = 0; cooldown = cool(aggr); } }
        return;
      }
      // C2 r3: a foe that has never swung doesn't back off hurt (board r12: a marauder beaten up on arrival retreated, then crossed —
      // 9.1 s to its first attack); its first swing comes first
      if (e.hp < e.maxHp * P.retreatHp && tick > nextRetreat && e.def.canRetreat !== false && (e.aiHasAtk || !d || d.noFirstRush)) {
        nextRetreat = tick + 600;
        if (rng.chance(P.retreatChance) && (!d || d.requestRetreat(e, t, P.retreatTicks))) {
          retreatUntil = tick + P.retreatTicks;
          if (e.moves && hooks.onRetreat) hooks.onRetreat(c);
          return;
        }
      }
      if (hooks.special && hooks.special(c)) { mode = 'special'; if (tk) tk.release(e); cooldown = Math.max(cooldown, cool(aggr) >> 1); return; }
      // C2 r1: with the body-space floor on (director.space), the r5–r6 screen-column gates (front row first, clear path,
      // column mates, hand-overs, holds behind reeling bodies, single-file tails) are redundant — bodies can no longer fuse —
      // and they were what kept foes visible-but-idle for 10–30 s (same-time control: showcase crowd worst idle 28.5 s,
      // 'circle/pathShut' + 'circle/front' the top reasons). director.oldGates = true restores them.
      const G = !!(d && (d.noSpace || d.oldGates));
      const prio = !!(d && d.starved(e)); // C2 r1: overdue (visible too long without a swing) or a starved tank: next in line
      if (prio && cooldown > 4) cooldown = 4;
      // C2 r3 FIRST RUSH (board r12: first swing up to 8.6–10.1 s after a foe came into view): an overdue foe that has never attacked
      // swings the moment it is back in control (no cooldown), runs in (any foe that has never swung runs in with its token), never gives its token up on a long walk, and may strike
      // from a short lunge further out (reach +0.2 m, depth tolerance ×1.5). The token / threat / heat caps still apply.
      const first = !!(d && e.aiOverdue && !e.aiHasAtk && !d.noFirstDue && !d.noFirstRush);
      if (first) cooldown = 0;
      const wantsAttack = van || ((cooldown <= 0 || (c.punish && cooldown < 30)) && !c.heroBusy && (!hooks.canAttack || hooks.canAttack(c))
        && !(G && d.frontReady && !prio && !(tk && tk.has(e)) && d.frontReady(e, t))); // r5: front row goes first
      // r6 clear path: never commit to a run that walks through another body's screen column (two silhouettes fused
      // for the whole approach). The blocker, if it is a waiting ally of the same hero, goes first instead.
      let pathShut = false;
      if (G && wantsAttack && !van && d.pathBlocker && !(tk && tk.has(e)) && !d.starved(e) && adx > P.attackRange + 0.6) {
        const own = Math.sign(e.pos.x - t.pos.x) || 1;
        const b = d.pathBlocker(e, t.pos.x + own * P.attackRange * 0.85, t.pos.z) || (d.columnMate && d.columnMate(e, t));
        if (b && ++blockWait < 150) {
          pathShut = true;
          if (b.brain && b.aiTarget === t && b.brain.mode === 'circle' && b.controllable && (b.brain.cooldown ?? 0) > 6) b.brain.cooldown = 6;
        } else if (!b) blockWait = 0;
      } else if (!wantsAttack) blockWait = 0;
      e.aiWhy = !wantsAttack ? (cooldown > 0 ? 'cd' : c.heroBusy ? 'heroBusy' : 'front') : pathShut ? 'pathShut' : ''; // r8 probe: why a foe is not attacking yet
      const hasToken = wantsAttack && !pathShut && (tk ? tk.request(e, t) : true);
      if (wantsAttack && !pathShut && !hasToken) e.aiWhy = 'noToken';
      if (!hasToken) atkWalk = 0;
      if (hasToken) {
        mode = 'attack';
        // C2 r1 GIVE-UP: a token holder that hasn't reached a strike spot in ~2.5 s (a hero who keeps moving off, a detour
        // round a hero pinned at the frame edge whose depth keeps following it) hands the token on, so the hero's two
        // attack slots don't sit idle on one stuck foe (showcase crowd: 12 attack starts / min).
        if (!van && d && !d.noSpace && ++atkWalk > (d.giveUpT ?? 150) * (first ? 3 : 1)) {
          atkWalk = 0; if (tk) tk.release(e); cooldown = rng.int(30, 60); e.aiWhy = 'giveUp'; if (d.stats) d.stats.giveUp = (d.stats.giveUp || 0) + 1;
          e.faceToward(t); if (!offFrame(game, e)) e.pause(16, { anim: adx < 2.2 ? 'sidestep' : 'taunt', vx: adx < 2.2 ? -2.2 : 0 }); else e.stopMoving(); return; // a visible beat (hop back / taunt), not a freeze
        }
        // Surround (r4): the director hands each committed foe a free flank (2nd attacker → the other side, a 3rd →
        // a depth-offset lane), so attackers never pile onto one spot.
        // r6: walking in side by side (other depth, same screen column) with a foe nearer the hero → give the turn back
        // (the waiting-lane slide then parts the pair) instead of arriving as one fused body.
        if (G && !van && d.columnMate && !d.starved(e) && e.fsm.is('walk', 'idle') && adx > (P.attackRange + 0.3) && d.columnMate(e, t)) {
          if (tk) tk.release(e); cooldown = rng.int(12, 24); e.aiWhy = 'colMate'; e.stopMoving(); e.faceToward(t); return;
        }
        const lane = d && d.attackSide ? d.attackSide(e, t) : { side: Math.sign(e.pos.x - t.pos.x) || 1, dz: 0 };
        if (lane.yield && (!van || lane.room) && tk) { tk.release(e); cooldown = rng.int(8, 20); e.aiWhy = 'yield'; e.stopMoving(); e.faceToward(t); return; }
        const side = lane.side;
        const reach = (c.mounted && e.moves.jump_slash ? 1.7 : P.attackRange), lunge = first ? 0.2 : 0, dTol = P.depthTol * (first ? 1.5 : 1);
        const onSide = Math.sign(e.pos.x - t.pos.x) === side;
        // r5 screen-x lanes: a queued 3rd attacker holds one lane back; the strike spot must be free of other bodies
        // (at any depth) so every attacker keeps its own readable silhouette; closer than 0.55 m steps back out first.
        const queued = !van && !!(lane.queue && lane.queue > reach + 0.15);
        const laneOk = van || !G || !d.laneFree || d.laneFree(e, e.pos.x, e.pos.z);
        if (onSide && !queued && laneOk && adx <= reach + 0.15 + lunge && adz < dTol && adx > 0.7) { // C2 r1: 0.55 → 0.7 (the body-space floor holds foes ≥ ~0.8 m off a hero)
          if (c.heroBusy) { e.aiWhy = 'heroBusy'; e.stopMoving(); e.faceToward(t); return; } // standing over the downed hero: no swing until he can act
          // Feint: step in, then hop back out of range (baits a whiff, which the brain then punishes).
          if (!van && !first && !c.punish && feintCool <= 0 && rng.chance(P.feint * aggr)) {
            feintCool = 240; cooldown = rng.int(10, 22);
            e.faceToward(t); e.pause(14, { anim: 'sidestep', vx: -3.2 });
            game.bus.emit('ai:feint', { actor: e, target: t });
            return;
          }
          // Strike budget: attacks on one hero are spaced out (never two swings landing on the same frame).
          if (d && !d.canStrike(t, c.punish || van, e)) {
            // C2 r1 (A/B director.menaceHold): held at the strike spot by the hero's strike budget, hop back out (a feint step)
            if (d.menaceHold && d.menaceDue && d.menaceDue(e)) { e.faceToward(t); e.pause(14, { anim: 'sidestep', vx: -2.6 }); game.bus.emit('ai:feint', { actor: e, target: t }); d.stats.menaceHold = (d.stats.menaceHold || 0) + 1; return; } // off by default: the hop-back cost the crowd its strikes (solo crowd 4.7 vs 7.3 hits / hero-min)
            e.aiWhy = 'strike'; e.stopMoving(); e.faceToward(t); return;
          }
          let m = c.mounted && e.moves.jump_slash ? 'jump_slash' : hooks.choose ? hooks.choose(c) : Object.keys(e.moves)[0];
          if (m && e.attackWith(m, t)) { atkWalk = 0; cooldown = cool(aggr); if (tk) tk.release(e); if (van) { e.vanguard = 0; game.bus.emit('ai:vanguard', { actor: e, target: t }); } return; }
          if (m && d && d.attackVeto && d.attackVeto(e, t)) { if (tk) tk.release(e); e.vanguard = 0; cooldown = rng.int(8, 16); e.aiWhy = 'veto'; e.stopMoving(); e.faceToward(t); return; } // C2 r1: half off-frame / pinned hero's outer side
        }
        if (d && d.stats && d.diagAtk) { const k = 'af_' + (!onSide ? 'side' : queued ? 'queue' : !laneOk ? 'lane' : adx > reach + 0.15 + lunge ? 'far' : adz >= dTol ? 'dz' : adx <= 0.7 ? 'close' : 'other'); d.stats[k] = (d.stats[k] || 0) + 1; e.aiAf = k; } // probe diagnostics (director.diagAtk)
        const crossing = !onSide && adx > 0.3;
        e.aiCrossing = crossing;
        // C2 r1: a detour to a pinned hero's inner flank that hasn't got round in 2 s (the hero keeps matching its depth, or
        // the co-op camera pins both heroes at the frame edges and the hero can't step off-screen to it) → the foe may take
        // the outer flank after all, as long as its whole body stands inside the frame (attackVeto still checks that)
        if (crossing && lane.room) { if (++roundT > (d && d.roundFailT || 120)) { roundT = 0; atkWalk = 0; e.aiRoundFail = tick; if (d && d.stats) d.stats.roundFail = (d.stats.roundFail || 0) + 1; } } else roundT = 0;
        // r5 front-row hand-over: still walking in from an outer ring past a waiting ally's column → pass it the turn.
        const ff = G && !van && !crossing && adx > reach + 0.6 && d.frontFoe ? d.frontFoe(e, t) : null;
        if (ff && tk) { tk.release(e); e.aiWhy = 'handover'; cooldown = rng.int(24, 48); ff.brain.cooldown = 0; game.bus.emit('ai:handover', { actor: e, to: ff }); return; }
        // C2 r3 LEAD (probe preWhy: ~60 % of the time before a first swing was a token holder walking after a hero who kept moving):
        // aim where the hero will be in ~0.3 s while closing in on his own side (director.noLead: off)
        const lead = d && !d.noLead && !crossing && !queued && adx < 4.5 && t.vel ? 0.3 : 0;
        let ax = t.pos.x + (lead ? t.vel.x * lead : 0) + side * (queued ? Math.min(4.2, lane.queue) : reach * 0.85), az = crossing ? crossZ(game, t.pos.z, xPref(game, e, t), d && !d.v9Cross ? 2.5 : 2.1) : clampZ(game, t.pos.z + lane.dz + (lead && t.vel.z ? t.vel.z * lead : 0));
        if (crossing && d && !d.v9Cross && Math.abs(az - e.pos.z) > 0.6 && Math.abs(e.pos.z - t.pos.z) < 2.0) ax = e.pos.x; // c1r10: round the hero depth first
        const sg = d && d.steer && (crossing || queued || !laneOk || adx > reach + 0.6) ? d.steer(e, ax, az) : { x: ax, z: az };
        // r5: passing through another body's column → run so the overlap is a flicker; a body still reeling in the lane
        // ahead (hitstun / knockdown) → hold a beat until it clears instead of walking into the same silhouette.
        // r6: someone stepped into my run's screen column (a reeling body, another attacker) → hold a beat; if it
        // stays, hand the token back so a foe with a clear run takes it.
        if (G && !van && !crossing && adx > reach + 0.6 && d.pathBlocker && d.pathBlocker(e, sg.x, sg.z)) {
          if (++holdWalk > 50) { holdWalk = 0; if (tk) tk.release(e); cooldown = rng.int(10, 24); }
          e.aiWhy = 'hold'; e.stopMoving(); e.faceToward(t); return;
        }
        holdWalk = 0;
        const passing = d && d.laneFree && !d.laneFree(e, e.pos.x, e.pos.z);
        if (G && !van && !crossing && d.reeling && d.reeling(e, sg.x, sg.z)) { e.aiWhy = 'reel'; e.stopMoving(); e.faceToward(t); return; }
        // r5b: travelling in step with an ally in the same screen column (a group walking in together) → the one behind
        // drops back so the pair splits into a file instead of arriving as one fused body.
        const tail = G && !van && !crossing && adx > reach + 0.6 && d.columnAhead && d.columnAhead(e, sg.x);
        e.moveTo(sg.x, clampZ(game, sg.z), van ? (adx > reach + 1.6 ? 1.85 : 1.2) : (first || (d && !d.noFirstRush && !e.aiHasAtk)) && adx > reach + 0.4 ? Math.max(1.45, P.rush * 1.25) : tail ? P.rush * 0.5 : crossing ? Math.max(1.35, P.rush * 1.2) : passing ? Math.max(1.3, P.rush) : P.rush); // flanking runs round briskly
        return;
      }
      mode = 'circle';
      e.aiCrossing = false;
      // C2 r1 MENACE (board C1 r10: a foe stood visible ~10 s doing nothing): a waiter that has made no visible action for
      // director.menaceDue ticks steps in at the hero (a short forward lunge it then walks back from) or taunts.
      if (d && d.menaceDue && d.menaceDue(e) && !offFrame(game, e) && adx < 7.5 && adz < 2.6) {
        e.faceToward(t);
        if (e.animator && e.animator.has && e.animator.has('taunt') && tauntCool <= 0 && rng.chance(0.35)) { tauntCool = rng.int(240, 480); e.pause(36, { anim: 'taunt' }); game.bus.emit('ai:taunt', { actor: e }); }
        else if (adx > 1.9) { e.pause(15, { anim: 'walk', vx: Math.min(2.2, (adx - 1.5) * 4) }); game.bus.emit('ai:menace', { actor: e, target: t }); }
        else { e.pause(14, { anim: 'sidestep', vx: -2.4 }); game.bus.emit('ai:feint', { actor: e, target: t }); } // already close (hero down / stepping past it): hop back out
        if (d.stats) d.stats.menace = (d.stats.menace || 0) + 1;
        return;
      }
      const slot = d ? d.slotFor(e) : { side: Math.sign(e.pos.x - t.pos.x) || 1, dz: orbit, ring: 1 };
      // Waiting ring stays in the fight; the director hands out distinct x lanes per flank (slot.x, r5).
      // r5: rings are distinct x lanes per slot (cap 4.4 m so the outer lane still differs from the one inside it).
      const ring = Math.min(5.4, slot.x ?? P.spacing * slot.ring) + 0.08 * Math.sin((tick + e.id * 37) / 50);
      let gx = t.pos.x + slot.side * ring;
      // Never wait off-frame: pull the slot well inside the visible range.
      const vr = viewRange(game, slot.z ?? t.pos.z + slot.dz);
      const inX = (x) => (d && (d.v8Kit || d.v8Clamp) ? Math.max(vr.xMin - 0.6, Math.min(vr.xMax + 0.6, x)) : Math.max(vr.xMin + 1.0, Math.min(vr.xMax - 1.0, x))); // c1r9: a waiting goal is always inside the frame (was ±0.6 m past the edge: co-op waiters parked off-screen)
      gx = inX(gx);
      // c1r10 NO-CROSS: a waiter on the other side of its hero from its slot (the hero walked past it, a knockback, a
      // slot shuffle) adopts the side it stands on instead of walking back through the hero and the fight (critic r9:
      // ~700 crossings per 40 s co-op run, half the fused contact frames). Only when that side has no room in the frame
      // does it still go round.
      const sideNow = Math.sign(e.pos.x - t.pos.x);
      if (d && !d.v9Cross && !slot.cross && !slot.co && sideNow && sideNow !== slot.side && adx > 0.35) { // C2 r15: never for a co-op flank-plan waiter (it goes round)
        const kx = inX(t.pos.x + sideNow * ring);
        if (Math.abs(kx - t.pos.x) >= 1.6) { slot.side = sideNow; slot.src = 'keep'; gx = kx; d.stats.xKeep = (d.stats.xKeep || 0) + 1; }
      }
      // Going round to the far side: detour in depth instead of walking through the hero.
      const crossing = Math.sign(e.pos.x - t.pos.x) !== slot.side && (adx < ring || !!slot.flank || !!(slot.cross && d && d.coBal && d._nh > 1) || !!slot.co); // C2 r15: a co-op flank-plan waiter returning to its side // C2 r3: a flanker (director.flankPass / coBal) goes round from any distance
      if (crossing && !e.aiCrossing && d && d.stats) { const k = 'xStart_' + (slot.src || '?'); d.stats[k] = (d.stats[k] || 0) + 1; }
      e.aiCrossing = crossing;
      // Waiting foes keep prowling: a slow depth drift so the ring breathes instead of parking.
      // r8: the breathing stays small (±0.5 m) so a waiting foe keeps to its depth row (rows are ~2.3 m apart).
      const drift = (d && d.zDrift != null ? d.zDrift : 0.3) * Math.sin((tick + e.id * 53) / 85);
      let gz = clampZ(game, crossing ? crossZ(game, t.pos.z, xPref(game, e, t), d && !d.v9Cross ? 2.5 : 2.1) : (slot.z ?? t.pos.z + slot.dz) + orbit * (d && d.zDrift != null ? d.zDrift * 0.6 : 0.2) + drift);
      // c1r10: going round = depth first (out of the hero's contact box, behind / in front of his fight), then across
      let depthFirst = false;
      if (crossing && d && !d.v9Cross && Math.abs(gz - e.pos.z) > 0.6 && Math.abs(e.pos.z - t.pos.z) < 2.0) { gx = e.pos.x; depthFirst = true; }
      if (d && d.steer && !depthFirst) { const sg = d.steer(e, gx, gz, !crossing); gx = inX(sg.x); gz = clampZ(game, sg.z); }
      // r5: while passing through another body's screen column, walk briskly so the overlap is a flicker, not a pose.
      const inLane = d && d.laneFree && !d.laneFree(e, e.pos.x, e.pos.z);
      // r6: the walk to a new waiting spot would pass through a fighting body's screen column (an attacker squaring
      // up, a foe reeling): stay put while the current spot is clean — waiting is waiting, and it never fuses.
      // (director.holdFar caps holds far from the fight; A/B r6: a cap of 90 ticks measured worse, so default = none)
      // r7: a fresh arrival still far out (> ring + 1.6 m) walks on to its ring instead of parking at the frame edge
      // behind a blocker (critic r6: a wave loitering 10 m from the hero); the lane pass keeps it out of columns.
      const fresh = e.arrivedAt != null && tick - e.arrivedAt < 240 && adx > ring + 1.6 && !(d && d.noFreshWalk);
      // c1r9: a waiter outside the frame never holds (critic r8: co-op waiters held behind a blocker while the camera
      // panned away, parked off-screen for seconds): it walks in briskly; a fused flicker beats an invisible foe.
      const off = !(d && (d.v8Kit || d.v8Walk || d.noOutWalk)) && offFrame(game, e);
      offTicks = off ? offTicks + 1 : 0;
      const outF = off && offTicks > (d ? d.outDelay ?? 0 : 0); // c1r9: held off-frame for outDelay ticks → walk in
      // c1r10 SCREEN-FREE WALK (replaces the r6 hold): the waiter walks toward its goal only as far as the free screen
      // gap it stands in reaches (never into / through another body's or a hero's strike column, at any depth), and a
      // waiter whose spot became occupied (a foe knocked back into it, a hero stepping up) steps out to the nearest clear
      // spot on its own side. Critic r9: held waiters stood fused for seconds; pairs fused on 11–14 % of contact frames.
      const free = !!(d && d.freeSpot && !d.v9Hold && !crossing && !outF);
      let esc = false;
      if (free) { const fs = d.freeSpot(e, gx, gz, t); if (fs) { gx = inX(fs.x); esc = fs.esc; if (esc) gz = e.pos.z + Math.max(-0.3, Math.min(0.3, gz - e.pos.z)); } } // stepping clear: sideways first
      e.aiFreeEsc = esc; e.aiFreeT = free ? game.tick : e.aiFreeT; e.aiOutF = outF;
      if (!free && !crossing && !inLane && !fresh && !outF && d && d.pathBlocker && tick >= waitFree) {
        const blk = d.pathBlocker(e, gx, gz);
        if (blk && (d.holdAll !== false || !(blk.brain && blk.brain.mode === 'circle' && !(tokens() && tokens().has(blk))))) {
          if (++waitHeld > (adx > ring + 1.6 ? d.holdFar ?? Infinity : d.holdMax ?? Infinity)) { waitHeld = 0; waitFree = tick + 60; }
          e.aiHold = game.tick;
          // c1r9 row discipline: a held waiter still steps straight in depth onto its row (x fixed: crosses no column)
          if (!d.v8Kit && !d.v8Walk && !d.noHoldZ && Math.abs(gz - e.pos.z) > 0.45) e.moveTo(e.pos.x, gz, 0.72); else e.stopMoving();
          e.faceToward(t); return;
        } // r6: any body, incl. other waiters (director then packs round this spot)
      }
      waitHeld = 0;
      // C2 r1: slid aside by the body-space floor a moment ago → don't walk straight back into that neighbour
      if (e.aiPush && tick - e.aiPush.t < 4 && Math.sign(gx - e.pos.x) === -e.aiPush.dir && Math.abs(gx - e.pos.x) < 1.6) gx = e.pos.x;
      const tail = G && !crossing && d.columnAhead && d.columnAhead(e, gx); // r5b: in step behind an ally → drop back
      if (Math.hypot(gx - e.pos.x, gz - e.pos.z) > (esc ? 0.04 : 0.25)) e.moveTo(gx, gz, crossing && (slot.flank || slot.co) ? 1.5 : outF ? (d && d.outSpeed) || 1.35 : esc ? 1.3 : tail && !free ? 0.45 : adx > P.spacing * 2.6 ? 1.35 : inLane ? 1.3 : !(d && (d.v8Kit || d.v8Walk || d.noRowRush)) && Math.abs(gz - e.pos.z) > 0.6 ? 1.0 : 0.72); // c1r9: off its row → a brisker walk back onto it
      else {
        e.stopMoving();
        if (tauntCool <= 0 && e.moves && rng.chance(P.taunt)) { tauntCool = rng.int(240, 480); e.pause(40, { anim: 'taunt' }); game.bus.emit('ai:taunt', { actor: e }); return; }
      }
      e.faceToward(t);
    },
  };
  for (const k of ['guard', 'preHit', 'onHit', 'react', 'onAttackTick', 'onDeath']) if (hooks[k]) brain[k] = hooks[k];
  return brain;
}
