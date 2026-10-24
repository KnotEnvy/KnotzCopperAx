// what=moveset&id=<hero>[&stage=test|stage1|..][&cam=game|close][&x=N] — the hero performs its move list against
// training dummies, driven through the real input path (virtual device): light string, heavy, charged heavy (L3),
// jump attack, air slam, close string + THROW, back attack, dodge, run attack, run-jump cut, Death Stab (dash → jump →
// Light AT THE APEX), run-jump slam (dash → jump → Heavy).
// One full pass of the list ≈ 1930 ticks (~32 s); capture it with --warm 800 --frames 980 --step 33. Every tick-map
// claim must come from tools/scenarios/moveset_trace.mjs (it logs the state/clip/move per tick), never from arithmetic.
// C1 r5 (board r4: "the Death Stab never happens; the slam lands short"): (1) the Light press was 12 ticks after the
// jump = |vel.y| ≈ 4.4 > 3.2, outside the apex window, so the game correctly gave run_jump_attack; now 22 ticks = the
// apex for all three heroes (verified: tools/scenarios/death_stab_input.mjs). (2) the 'back' teleport to x = -6 was
// clamped by the screen bounds, so the run-ins started from wherever the last move ended; the hero is now unbounded
// in this showcase and each run-in starts from a hero-speed-derived x so the run attack / Death Stab / slam COME DOWN
// ON the dummy. (3) `cam=close` tightens the belt camera for evidence captures; `stage=stage1` runs the list on a lit
// stage slice (no waves) instead of the void.
export default {
  id: 'moveset',
  async setup(ctx) {
    const { params, game } = ctx;
    const id = params.id || 'brann';
    const stageId = params.get('stage', 'test'); // (params.stage defaults to '1' for ?mode=stage; the list belongs on the void unless asked)
    const mod = await ctx.stage(stageId);
    const ox = Number(params.get('x', stageId === 'test' ? '0' : String(((mod && mod.playerStart && mod.playerStart.x) || 2) + 4)));
    const h = await ctx.hero(id, { x: ox - 1.5, z: 0 });
    h.boundsMode = 'none'; // teleports for the run-ins must not be clamped to the previous camera view
    const dummies = [];
    const spots = [[0.2, 0], [1.4, 0.8], [1.6, -0.8]];
    for (const [x, z] of spots) { const d = await ctx.enemy('dummy', { x: ox + x, z, facing: -1 }); if (d) { d.home = { x: ox + x, z }; dummies.push(d); } }
    ctx.gameCam([h], { lock: [ox - 12, ox + 24] });
    // C2 r1: 8.8 m / look 1.0 / fov 30 cut the hero's head at the leap apex (top of frame 3.36 m, head at ~3.9 m);
    // 9.2 m / look 1.45 / fov 31 puts the top of frame at ~4.0 m and keeps the floor (hero ≈ 38 % of frame height)
    if ((params.cam || 'game') === 'close') game.cameraRig.setFraming({ distance: 9.2, height: 3.3, lookHeight: 1.45, fov: 31, lead: 0.6 });
    const dev = h.input.virtual;
    const v = h.stats.run;                       // m/s; run-ins ramp up over ~5 ticks
    const runUp = (ticks) => v * Math.max(0, ticks - 5) / 60;
    // Where each run-in starts so the move connects with the front dummy (ox + 0.2):
    //   run attack: 24 ticks of run then the dash attack's first ~1.3 m of travel carry the active window onto the foe
    //   Death Stab: 20 ticks of run, 22 ticks of leap at 0.95 v, 6-8 ticks of startup = the apex ≈ 0.55 m before the foe
    //   (the blade tip hangs over it), then the C2 forward dive (≈ 0.9-1.1 m) lands the hero ON the floored body
    //   run-jump slam: 20 ticks of run, 13 ticks of leap, then the dive (≈ 2.0 m incl. the leap)
    const X_RUN_ATTACK = ox + 0.2 - (runUp(24) + 1.3);
    const X_DEATH_STAB = ox + 0.2 - 0.55 - 0.565 * v; // measured c2r1: 20 ticks of run + leap to the Light press = 0.565 v (all three)
    const X_SLAM = ox + 0.2 - (runUp(20) + 0.95 * v * 13 / 60 + 0.5 - 0.3);
    // [action, ticks to wait BEFORE this step]
    const seq = [
      ['light', 30], ['light', 10], ['light', 10],                                     // light string (far branch: finisher)
      ['reset', 100], ['light', 20], ['light', 10], ['heavy', 10],                      // light, light, heavy = launcher
      ['reset', 120], ['heavy', 20],                                                    // heavy
      ['reset', 110], ['charge', 20],                                                   // charged heavy (level 3)
      ['near', 130], ['jump', 20], ['light', 16],                                       // jump attack
      ['near', 100], ['jump', 20], ['heavy', 16],                                       // air slam
      ['near', 110], ['string', 20],                                                   // close string → pommels → aimed THROW (string driver)
      ['reset', 192], ['light+jump', 20],                                               // back attack
      ['dodge', 70],                                                                   // neutral dodge (backstep roll)
      ['at:run_attack', 70], ['run', 1], ['light', 24],                                // run attack
      ['at:run_cut', 90], ['run', 1], ['jump', 20], ['light', 10],                     // run-jump cut (Light before the apex)
      ['at:death_stab', 110], ['run', 1], ['jump', 20], ['light', 22],                 // DEATH STAB (Light at the apex)
      ['at:slam', 110], ['run', 1], ['jump', 20], ['heavy', 13],                       // run-jump slam
      ['reset', 110],
    ];
    let i = 0, wait = seq[0][1], str = null;
    const ch = (h.moves.heavy && h.moves.heavy.charge) || {};
    const chargeHold = (ch.at ?? 8) + ((ch.levels && ch.levels[2]) ?? 72) + 6; // hold past this hero's charge level 3
    const place = (x) => { h.endMove(); if (!h.fsm.is('idle')) h.fsm.go('idle'); h.pos.x = x; h.pos.z = 0; h.facing = 1; h.vel.set(0, 0, 0); h.prevPos.copy(h.pos); game.cameraRig.snap(); };
    const home = () => place(ox - 1.5);
    const resetDummies = () => { for (const d of dummies) { if (d.fsm.is('grabbed', 'thrown')) continue; d.pos.set(d.home.x, 0, d.home.z); d.prevPos.copy(d.pos); d.vel.set(0, 0, 0); d.facing = -1; d.grounded = true; d.invuln = 0; d.hurtable = true; d.solid = true; if (!d.fsm.is('idle')) d.fsm.go('idle'); } };
    ctx.every(1 / 60, () => {
      // Close-string driver: Light the tick the current move opens its Light cancel (fixed 10-tick presses expire in
      // Gorrim's slower string); ← is held before the 5th press so pommel_2 takes the 'aim' cancel = THROW.
      if (str) {
        str.tries--;
        const run = h.attack;
        const open = str.k === 0 ? !run : !!(run && run.id !== str.last && run.cancelsNow().some((c) => c.on === 'light'));
        if (open) {
          str.last = run ? run.id : 'start'; str.k++;
          if (str.k === 5) { dev.hold('left', true); game.after(14, () => dev.hold('left', false)); }
          dev.press('light', 3);
        }
        if (str.k >= 5 || str.tries <= 0) str = null;
      }
      if (wait-- > 0) return;
      const [a] = seq[i];
      i = (i + 1) % seq.length;
      wait = seq[i][1];
      if (a === 'light+jump') { dev.press('light', 3); dev.press('jump', 3); return; }
      if (a === 'near') { resetDummies(); place(ox - 0.5); return; }
      if (a === 'reset') { resetDummies(); home(); return; }
      if (a.startsWith('at:')) { resetDummies(); place({ run_attack: X_RUN_ATTACK, run_cut: X_RUN_ATTACK, death_stab: X_DEATH_STAB, slam: X_SLAM }[a.slice(3)]); return; }
      if (a === 'charge') { dev.press('heavy', chargeHold); return; }
      if (a === 'string') { str = { k: 0, last: null, tries: 150 }; return; }
      if (a === 'run') { dev.press('right', 3); game.after(5, () => dev.hold('right', true)); game.after(40, () => dev.hold('right', false)); return; } // double-tap → run (held through the jump)
      dev.press(a, 4);
    });
    ctx.label(`${h.def.name} · move list`);
    ctx.expose({ actor: h, dummies, runIns: { run_attack: X_RUN_ATTACK, death_stab: X_DEATH_STAB, slam: X_SLAM } });
  },
};
