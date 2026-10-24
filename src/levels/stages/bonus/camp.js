// Thieves' Night — the camp game (DESIGN §6/§7/§10, GA night bonus):
//   sleep  heroes lie asleep on their bedrolls by the fire; blue thieves tip-toe in and pinch pots from their stock
//   wake   the first theft (or a player's button, or a failsafe) wakes everyone: "THIEVES!" → a timed hunt
//   hunt   kick the thieves before they escape: stolen pots come back plus extras (thief AI stealBonus); green
//          thieves carry meat; more thieves scurry in while the timer runs
//   tally  CAMP TALLY panel (stolen / recovered / meat) → bonus score → stage clear
// Quiet camp (the last one before the throne, or &quiet=1): no thieves — the heroes sit by a banked fire, share
// rations (+1 bar each) and "THE KEEP AWAITS" … then the stage clears.
// Hooks used: thief behaviour spawn opts { steal, sack } + 'ai:steal' / 'ai:escape' / 'ai:thiefSpill';
// EV.POT_PICKUP { hero, kind: 'pot'|'food' }. Pots/life carry over between stages via Flow's snapshotCarry (session.players[i].carry).
import * as THREE from 'three';
import { EV } from '../../../core/EventBus.js';
import { safeImport } from '../../../core/safeImport.js';
import { createCampHud } from './hud.js';
import { CAMP } from './env.js';

const HUNT_SECONDS = 20;
// the firelit ring the thieves panic round (thief behaviour opts.camp): escapes only count past |x| > lit
// r10: the camera squashes depth (pitch ≈ 14°), so a fighter ANYWHERE in front of / behind the fire in z still draws over the flame —
// tools/scenarios/camp_footprint.mjs: overlap is 0 only past |x| ≈ 1.3 whatever the depth. So the fire is a wall: each thief runs its own
// small loop on ONE side of it (sides = centre ±dx, radii ax/az) and heroes stay on their side of FIRE_KEEP.
export const CAMP_RUN = { x: 0, z: -0.1, ax: 1.5, az: 2.0, lit: 5.8, minRun: 204, sides: { dx: 3.1, ax: 1.5, az: 2.0, z: -0.1 } };
// no-go band round the fire for every fighter (heroes, thieves, loot): |x − fire.x| < FIRE_KEEP (±0.2 with depth) at ANY depth; a body box 0.45 m
// wide then stays ≥ 0.15 m clear of the flame sprite (±0.8) on screen
export const FIRE_KEEP = 1.55;
const TAUNTS = ['NYEH!', 'HEE HEE!', 'MINE!', 'CATCH ME!'];
const WAKE_FAILSAFE = 60 * 7;
// camera (bonus-camp r5): pinned on the campfire clearing, close enough that thieves read at ~15–20% of frame height;
// the view spans x ≈ ±5.5 so the panic ring (±3.9) sits inside it and escapes past lit (5.6) leave the frame.
export const CAMP_VIEW = { x: 0, z: 0.1 };

/** No magic at camp (Golden Axe): the hero's magic states are swapped per instance for a refusal + cue while the camp
 *  runs; restore() puts the originals back. */
function blockMagic(h, cue) {
  const st = h.fsm && h.fsm.states; if (!st || h._campMagicOrig) return;
  h._campMagicOrig = { magicSelect: st.magicSelect, magic: st.magic };
  const refuse = { tags: ['busy'], enter(a) { a.vel.x *= 0.3; a.vel.z *= 0.3; cue(a); }, update(a, dt) { a.friction(16, dt); return a.fsm.ticks >= 8 ? 'idle' : undefined; } };
  h.fsm.define({ magicSelect: refuse, magic: refuse });
}
/** Pot accounting (bonus-camp r6): Hero.addPots caps at maxPots, so a pot scooped by a full hero is wasted. A per-
 *  instance wrapper records the real change so the tally matches the HUD ("+N (full)"). */
function hookPots(h) {
  if (!h || !h.addPots || h._campAddPots) return;
  const orig = h.addPots; h._campAddPots = orig;
  h.addPots = function (n = 1) { const b = this.pots; const r = orig.call(this, n); this._campGain = this.pots - b; return r; };
}
function unhookPots(h) { if (h && h._campAddPots) { h.addPots = h._campAddPots; h._campAddPots = null; if (Object.prototype.hasOwnProperty.call(h, 'addPots') && h.addPots === Object.getPrototypeOf(h).addPots) delete h.addPots; } }
function restoreMagic(h) {
  const o = h && h._campMagicOrig; if (!o) return;
  if (h.fsm.is('magic', 'magicSelect')) h.fsm.go('idle');
  h.fsm.define(o); h._campMagicOrig = null;
}

/** Per-instance scripted hero states (no controller input while in them). */
export function installScriptStates(h) {
  if (!h || !h.fsm || h.fsm.states.campSleep) return;
  h.fsm.define({
    campSleep: {
      tags: ['down'],
      enter(a) { a.vel.set(0, 0, 0); a.play('down_loop', { fade: 0, startAt: 0.97, fallback: ['knockdown', 'idle'] }); }, // r10: no blend, and a fallback fall clip starts at its lying end — no snap in the opening frames
      update(a, dt) { a.friction(20, dt); if (a._campWake) { a._campWake = false; return 'getup'; } return undefined; },
    },
    campPose: {
      enter(a, d) { a.vel.set(0, 0, 0); a._poseClip = (d && d.clip) || 'idle'; a.play(a._poseClip, { fade: (d && d.fade) ?? 0.25, fallback: ['idle'] }); },
      update(a, dt) {
        a.friction(14, dt);
        const w = a._walkTo;
        if (w) {
          const dx = w.x - a.pos.x, dz = w.z - a.pos.z, d = Math.hypot(dx, dz);
          if (d < 0.08) { a._walkTo = null; a.vel.set(0, 0, 0); if (w.face) a.facing = w.face; a.play(w.then || 'idle', { fade: 0.25, fallback: ['idle'] }); }
          else { const sp = w.speed || 1.6; a.vel.x = dx / d * sp; a.vel.z = dz / d * sp; if (Math.abs(dx) > 0.05) a.facing = Math.sign(dx); }
        }
        if (a._campFree) { a._campFree = false; return 'idle'; }
        return undefined;
      },
    },
  });
}
/** Walk a posed hero to (x, z), then play `then`. */
export function walkTo(h, x, z, { speed = 1.6, face = 0, then = 'idle' } = {}) {
  installScriptStates(h);
  if (!h.fsm.is('campPose')) h.fsm.go('campPose', { clip: 'walk', fade: 0.2 }); else h.play('walk', { fade: 0.2 });
  h._walkTo = { x, z, speed, face, then };
}
export function pose(h, clip, fade = 0.25) { installScriptStates(h); h._walkTo = null; h.fsm.go('campPose', { clip, fade }); }

/** Which camp of the run (1–4): flow position, &camp=N override, else 1. */
export function campNumber(game) {
  const p = game.params || {};
  const get = (k) => (p.get ? p.get(k) : p[k]);
  if (get('camp')) return Math.max(1, Math.min(4, Number(get('camp')) || 1));
  const f = game.flow;
  if (f && f.mode === 'arcade' && f.seqIndex >= 0 && f.state === 'stage') return Math.max(1, Math.min(4, Math.round((f.seqIndex + 1) / 2)));
  return 1;
}
export function isQuietCamp(game) {
  const p = game.params || {};
  const q = p.get ? p.get('quiet') : p.quiet;
  if (q != null) return q === '1' || q === true || q === 1;
  return campNumber(game) >= 4;
}

export function createCamp(game, env) {
  const scope = game.bus.scope();
  const n = campNumber(game), quiet = isQuietCamp(game);
  const hud = createCampHud(game);
  const heroes = () => game.world.query({ kind: 'hero', alive: false }).filter((h) => h.alive);
  const S = { phase: 'wait', t: 0, huntT: 0, wrapT: 0, casts: 0, magicEnd: -999, stolen: 0, stolenFrom: [0, 0], escaped: 0, recovered: [0, 0], kept: [0, 0], meat: [0, 0], spawned: 0, pending: 0, caught: new Set(), live: new Set(), schedule: [], ended: false };
  let E = null;
  const loadE = async () => E || (E = await safeImport(() => import('../../../enemies/spawnEnemy.js'), 'enemies/spawnEnemy'));
  loadE();

  const sideOf = (a) => ((a.pos.x - CAMP.fire.x) < 0 ? -1 : 1);
  /** r10: the sides of the fire that have a hero on them (thieves always spawn where somebody can kick them). */
  const heroSides = () => { const s = [...new Set(heroes().map(sideOf))].sort(); return s.length ? s : [-1]; };
  const spawnThief = async (side, { tier = 'blue', steal = 0, sack = 1, z = null, markSide } = {}) => {
    S.pending++; // before the await: the hunt's "all thieves dealt with" check must not see a gap
    const mod = await loadE(); if (!mod || S.ended) { S.pending--; return; }
    const cam = game.cameraRig;
    const zz = z ?? (Math.random() * 3 - 1.5);
    const vr = cam && cam.visibleRange ? cam.visibleRange(zz) : { xMin: -9, xMax: 9 };
    const x = side > 0 ? vr.xMax + 1.2 : vr.xMin - 1.2;
    try {
      const pr = mod.spawnEnemy(game, 'thief', { x, z: zz, facing: -side, tier, steal, sack, camp: CAMP_RUN, markSide });
      if (game.track) game.track(pr);
      const e = await pr;
      if (e) { S.live.add(e); if (!S.spawned++) S.firstSpawn = S.t; }
    } catch (err) { console.warn('[camp] thief', err); }
    S.pending--;
  };

  // ------------------------------------------------------------------ events
  scope.on('ai:steal', (ev) => {
    if (!ev || !ev.n) return;
    S.stolen += ev.n;
    S.stolenFrom[(ev.hero && ev.hero.playerIndex) || 0] += ev.n;
    hud.flash(`-${ev.n}`, ev.hero && ev.hero.playerIndex);
    if (S.phase === 'sleep') game.after(26, () => wake('steal'));
  });
  scope.on('ai:escape', (ev) => {
    if (ev && ev.actor) S.live.delete(ev.actor);
    if (ev && ev.carried > 0 && (S.phase === 'hunt' || S.phase === 'wrap')) {
      S.escaped += ev.carried;
      if (S.phase === 'hunt') { hud.toast('ESCAPED!'); if (ev.actor) hud.pop(`-${ev.carried} ${ev.carried === 1 ? 'POT' : 'POTS'}`, above(ev.actor, 1.1), 'lose'); }
    }
  });
  // (r6: anchored near the ground — a thief kicked into a hop doesn't throw its word to the top of the screen)
  const above = (a, k = 1.2) => ({ x: a.pos.x, y: Math.min(a.pos.y, 0.35) + Math.max((a.height || 1) * k, 2.1), z: a.pos.z }); // ≥ hero head height: words float over the scrum, not on a fighter
  scope.on('ai:thiefSpill', (ev) => {
    if (!ev || !ev.actor || !ev.n || (S.phase !== 'hunt' && S.phase !== 'sleep')) return;
    S.caught.add(ev.actor); // r10: tally "Thieves caught"
    hud.pop(ev.kind === 'food' ? `+${ev.n} MEAT` : `+${ev.n} ${ev.n === 1 ? 'POT' : 'POTS'}`, above(ev.actor), ev.kind === 'food' ? 'food' : 'pot'); // r7: one bold line, icon + count
    if (game.audio && game.audio.play) game.audio.play('ui_confirm', { bus: 'ui', volume: 0.35 });
  });
  scope.on('ai:taunt', (ev) => { if (ev && ev.actor && ev.actor.typeId === 'thief' && S.phase === 'hunt') hud.pop(TAUNTS[(S.t >> 3) % TAUNTS.length], above(ev.actor, 1.35), 'taunt'); });
  scope.on(EV.DESPAWN, (ev) => { if (ev && ev.actor) S.live.delete(ev.actor); });
  scope.on(EV.MAGIC_CAST, () => { S.casts++; });
  scope.on(EV.MAGIC_END, () => { S.casts = Math.max(0, S.casts - 1); S.magicEnd = S.t; });
  scope.on(EV.POT_PICKUP, (ev) => {
    if (!ev || !ev.hero || S.phase === 'wait' || S.phase === 'tally') return;
    const i = ev.hero.playerIndex || 0;
    if (ev.kind === 'food') S.meat[i] += ev.amount || 1;
    else {
      S.recovered[i] += ev.amount || 1;
      const g = ev.hero._campAddPots && ev.hero._campGain != null ? ev.hero._campGain : (ev.amount || 1);
      S.kept[i] += Math.max(0, g); ev.hero._campGain = null;
    }
  });

  // ------------------------------------------------------------------ phases
  const setupHeroes = () => {
    const hs = heroes();
    hs.forEach((h, k) => {
      installScriptStates(h);
      const bed = CAMP.beds[k] || CAMP.beds[0];
      h.pos.set(bed.x + (bed.facing > 0 ? 0.25 : -0.25), 0, bed.z); h.prevPos && h.prevPos.copy(h.pos);
      h.facing = bed.facing; h.vel.set(0, 0, 0);
      if (quiet) pose(h, 'idle'); else h.fsm.go('campSleep');
    });
    return hs;
  };
  const wake = (why) => {
    if (S.phase !== 'sleep') return;
    S.phase = 'hunt'; S.huntT = 0;
    for (const h of heroes()) if (h.fsm.is('campSleep')) h._campWake = true;
    if (game.ui && game.ui.card) hud.reserve(game.ui.card('THIEVES!', 'CATCH THEM', 1.8), 1.9); // r7: loot words keep clear of the card
    if (game.audio && game.audio.play) game.audio.play('ui_confirm', { bus: 'ui', volume: 0.7 });
    if (game.cameraRig && game.cameraRig.shake) game.cameraRig.shake(0.18);
    hud.timer(HUNT_SECONDS);
    // the hunt: more thieves scurry in while the clock runs (count grows with the camp number)
    const H = [[90, 1, { tier: 'green', sack: 2 }], [260, -1, { sack: 3 }], [430, 1, { sack: 2 }], [600, -1, { tier: 'green', sack: 1 }]];
    if (n >= 2) H.push([740, 1, { sack: 2 }]);
    if (n >= 3) H.push([820, -1, { sack: 3 }], [900, 1, { tier: 'green', sack: 2 }]);
    for (const [at, side, o] of H) S.schedule.push({ at: S.t + at, fn: () => { const sd = heroSides(); spawnThief(sd.includes(side) ? side : sd[(S.spawned + S.pending) % sd.length], o); } });
    game.bus.emit('camp:wake', { why });
  };
  // hunt over → 'wrap': the fight freezes at once — casts are locked (game.magic.lock) and any spell in flight is
  // cancelled with its set pieces scrubbed (game.magic.cancelAll), heroes are held in campPose (a cast that slips in
  // is refunded and undone), popups cleared; spilled loot drifts in. Then 'tally': thieves leave, VFX scrubbed again,
  // the heroes are set at the fire under the veil and the card goes up over a clean camp.
  let unlockMagic = null, camMode = null;
  const freezeHero = (h) => {
    if (h.fsm.is('magic', 'magicSelect')) { if (h._campPots != null) h.pots = Math.max(h.pots, h._campPots); pose(h, 'idle'); }
    else if (!h.fsm.is('campPose')) pose(h, 'idle');
    h._campPots = h.pots;
    h.invuln = Math.max(h.invuln || 0, 2);
  };
  const stopMagic = () => {
    const m = game.magic; if (!m) return;
    if (!unlockMagic && m.lock) unlockMagic = m.lock();
    if (m.cancelAll) m.cancelAll(); else if (game.vfx && game.vfx.clear) game.vfx.clear();
  };
  const endHunt = () => {
    if (S.phase !== 'hunt') return;
    S.phase = 'wrap'; S.wrapT = 0; S.schedule.length = 0;
    stopMagic();
    hud.timer(null); hud.clearPops();
    for (const h of heroes()) { h._campPots = h.fsm.is('magic', 'magicSelect') ? null : h.pots; freezeHero(h); }
  };
  // spilled pots/meat drift to the nearest hero (gently in the hunt, all of them in the wrap) so a kick always pays
  const magnet = (all) => {
    const hs = heroes(); if (!hs.length) return 0;
    let n = 0;
    for (const p of game.world.query({ kind: 'pickup' })) {
      if (p.removed || p.pickupDelay > 0 || !p.grounded) { if (!p.removed) n++; continue; }
      n++;
      let b = null, bd = Infinity; for (const h of hs) { const d = Math.hypot(h.pos.x - p.pos.x, h.pos.z - p.pos.z); if (d < bd) { bd = d; b = h; } }
      if (!b || (!all && bd > 2.4) || bd < 0.05) continue;
      const sp = (all ? 7 : 3.2) / 60, k = Math.min(1, sp / bd);
      p.pos.x += (b.pos.x - p.pos.x) * k; p.pos.z += (b.pos.z - p.pos.z) * k;
    }
    return n;
  };
  const wrap = () => {
    S.wrapT++;
    const hs = heroes();
    for (const h of hs) freezeHero(h);
    if (magnet(true) > 0 && S.wrapT < 200) return;
    // (cancelled spells' stray sim-tick callbacks — a late strike, a flame lick — are over well inside this beat)
    if (S.wrapT < 60) return;
    showTally();
  };
  const showTally = () => {
    S.phase = 'tally';
    // leftover thieves bolt with whatever they carry (under the veil)
    for (const e of S.live) if (!e.removed) { S.escaped += e.sack || 0; e.remove(); }
    S.live.clear();
    for (const p of game.world.query({ kind: 'pickup' })) if (!p.removed) p.remove();
    stopMagic();
    hud.clearPops();
    // the heroes back at the fire, facing in, camera home: the card reads over the camp, not over a fight
    const hs = heroes();
    hs.forEach((h, k) => {
      const side = h.playerIndex ? 1 : -1;   // P1 left, P2 right (matches the HUD)
      // flanking the card (it sits over the fire), in the firelit foreground, turned in toward the flames
      h.pos.set(CAMP.fire.x + side * 3.5, 0, CAMP.fire.z + 1.9); h.prevPos && h.prevPos.copy(h.pos);
      h.vel.set(0, 0, 0); h.facing = -side;
      pose(h, 'idle', 0.05);
    });
    const cam = game.cameraRig;
    if (cam) { if (cam.clearDrama) cam.clearDrama(); if (cam.snap) cam.snap(); }
    const idx = new Set(heroes().map((h) => h.playerIndex || 0));
    for (let i = 0; i < 2; i++) if (S.recovered[i] || S.meat[i] || S.stolenFrom[i]) idx.add(i);
    const rows = [...idx].sort().map((i) => ({
      player: i, stolen: S.stolenFrom[i], recovered: S.recovered[i], kept: S.kept[i], full: Math.max(0, S.recovered[i] - S.kept[i]), meat: S.meat[i],
      net: S.kept[i] - S.stolenFrom[i], bonus: S.recovered[i] * 1000 + S.meat[i] * 500,
    }));
    for (const r of rows) if (r.bonus && game.session) game.session.addScore(r.player, r.bonus, 'camp');
    const rec = rows.reduce((a, r) => a + r.recovered, 0);
    let outcome;
    if (S.stolen > 0 && rec === 0) outcome = 'away';
    else if (rec < S.stolen || (S.escaped > 0 && rec <= S.stolen)) outcome = 'some';
    else if (S.stolen === 0 && rec === 0) outcome = 'held';
    else outcome = 'caught';
    hud.tally({ stolen: S.stolen, escaped: S.escaped, rows, camp: n, outcome, caught: S.caught.size, total: S.spawned });
    game.bus.emit('camp:tally', { stolen: S.stolen, escaped: S.escaped, rows, outcome, caught: S.caught.size, total: S.spawned });
    game.after(60 * 5.2, finish);
  };
  const quietBeat = () => {
    S.phase = 'quiet';
    if (env.setFire) env.setFire(0.7);
    const hs = heroes();
    // rations: one bar each, then a long look at the keep's direction
    hs.forEach((h, k) => {
      game.after(40 + k * 25, () => { walkTo(h, CAMP.fire.x + (k ? 1.35 : -1.35), CAMP.fire.z + 0.9, { speed: 1.1, face: k ? -1 : 1, then: 'idle' }); });
      game.after(170 + k * 20, () => { if (h.maxHp) h.hp = Math.min(h.maxHp, h.hp + 16); hud.flash('+1', h.playerIndex, 'food'); });
    });
    game.after(90, () => hud.quiet('THE KEEP AWAITS', 'Rations are shared. The fire burns low. Tomorrow, the Adder King.'));
    game.after(60 * 7.5, () => { hs.forEach((h) => { h.facing = 1; walkTo(h, h.pos.x + 0.6, h.pos.z, { speed: 1.0, face: 1, then: 'idle' }); }); });
    game.after(60 * 9, finish);
  };
  const finish = () => {
    if (S.ended) return;
    S.ended = true;
    for (const h of heroes()) { h._campFree = true; h._campPots = null; restoreMagic(h); unhookPots(h); }
    unhookFx();
    if (unlockMagic) { unlockMagic(); unlockMagic = null; }
    hud.hide();
    if (game.levels && game.levels.stage && game.levels.phase !== 'clear') game.levels.stageClear();
  };

  // camp VFX diet (r6): while the camp runs, the generic collect effects (pickup_burst's ground ring + the 12-sparkle
  // collect ring, both drawn right over the hero) become one small camp_collect tick — pots are scooped by the dozen here.
  let unhookFx = () => {};
  const hookFx = () => {
    const V = game.vfx; if (!V || !V.spawn || V._campSpawn) return;
    const own = Object.prototype.hasOwnProperty.call(V, 'spawn'), orig = V.spawn;
    V._campSpawn = orig;
    V.spawn = function (id, o) {
      if (id === 'pickup_burst') id = 'camp_collect';
      else if (id === 'sparkle' && o && (o.count ?? 8) >= 10) return null;
      return orig.call(this, id, o);
    };
    unhookFx = () => { if (V._campSpawn) { if (own) V.spawn = orig; else delete V.spawn; V._campSpawn = null; } unhookFx = () => {}; };
  };
  let lastCue = -999;
  const noMagicCue = (h) => {
    if (S.t - lastCue < 50) return; lastCue = S.t;
    hud.pop('NO MAGIC', above(h, 1.25), 'lose');
    if (game.audio && game.audio.play) game.audio.play('ui_back', { bus: 'ui', volume: 0.5 });
  };
  scope.on(EV.STAGE_START, () => {
    const hs = setupHeroes();
    // Thieves' Night is a kicking game: casts are held for the whole camp (and a press shows the cue)
    if (game.magic && game.magic.lock && !unlockMagic) unlockMagic = game.magic.lock();
    for (const h of hs) { blockMagic(h, noMagicCue); hookPots(h); }
    if (!quiet) hookFx();
    const cam = game.cameraRig;
    if (cam) {
      cam.setLock(-7.5, 7.5);
      if (cam.setMode) camMode = cam.setMode({ desired: () => ({ x: CAMP_VIEW.x, z: CAMP_VIEW.z }), blend: 0.01 });
      cam.snap();
    }
    S.t = 0;
    if (quiet) { S.phase = 'quiet0'; game.after(20, quietBeat); return; }
    S.phase = 'sleep';
    // the sneak-in: blue thieves tip-toe to the sleepers (one per sleeper with pots, plus one on later camps)
    // (r10: each sneak thief is bound to one potted sleeper's side of the fire — nobody ever crosses it)
    const pottedHs = hs.filter((h) => (h.pots || 0) > 0);
    const k = Math.max(1, Math.min(3, pottedHs.length + (n >= 2 ? 1 : 0)));
    for (let i = 0; i < k; i++) {
      const mk = pottedHs.length ? pottedHs[i % pottedHs.length] : hs[0], sd = mk ? sideOf(mk) : -1;
      S.schedule.push({ at: 90 + i * 70, fn: () => spawnThief(sd, { steal: 1 + (n >= 3 ? 1 : 0) + (i === 0 ? 1 : 0), sack: 1, z: CAMP.beds[0].z + (i % 2 ? 0.35 : -0.35), markSide: sd }) });
    }
    game.bus.emit('camp:start', { camp: n, quiet });
  });

  // ---- r9/r10: fire keep-out + fade. The band |x − fire.x| < FIRE_KEEP is a soft wall at every depth (see CAMP_RUN): fighters are
  // eased out sideways (fast enough to feel like a wall, never a teleport) and lose their inward velocity, so heroes slide along
  // it; loot that lands in it is nudged out toward the nearest hero. If a fighter still overlaps the flare/cauldron on screen
  // (knock-downs, scripted poses) the fire softens (env.setSoft).
  const keepOut = (a, rate = 0.14) => {
    // (perspective: a body BEHIND the fire is drawn smaller, so the band widens with depth — ≈ 1.76 at the back, 1.45 at the front)
    const dx = a.pos.x - CAMP.fire.x, R = Math.max(FIRE_KEEP - 0.1, Math.min(FIRE_KEEP + 0.21, FIRE_KEEP - 0.12 * (a.pos.z - CAMP.fire.z))) + (a.kind === 'pickup' ? 0.1 : 0), ax = Math.abs(dx);
    if (ax >= R) { if (ax > R + 0.3) a._fireSide = Math.sign(dx); return false; }
    let sd = Math.abs(dx) > 0.04 ? Math.sign(dx) : (a._fireSide || 0);
    if (!sd) { let bd = 9; for (const h of heroes()) { const d = Math.abs(h.pos.x - a.pos.x); if (d < bd) { bd = d; sd = sideOf(h); } } if (!sd) sd = 1; }
    a.pos.x += sd * Math.min(rate, R - ax + 0.001);
    if (a.vel && a.vel.x * sd < 0) a.vel.x = 0;
    return true;
  };
  const applyKeepOut = () => {
    for (const h of heroes()) keepOut(h);
    for (const e of S.live) if (!e.removed) keepOut(e);
    for (const p of game.world.query({ kind: 'pickup' })) if (!p.removed && p.grounded) keepOut(p, 0.06);
  };
  let soft = 0;
  const projVec = new THREE.Vector3();
  const updateSoft = () => {
    const cam = game.cameraRig && game.cameraRig.camera; if (!cam || !env.setSoft) return;
    // screen footprint of the flare+cauldron (x ±0.95, y 0–1.9 over the fire) vs every fighter's body box (x ±0.45, y 0–h)
    const proj = (x, y, z) => { const v = projVec.set(x, y, z).project(cam); return [v.x, v.y]; };
    const box = (cx, cz, hw, h) => { let x0 = 9, x1 = -9, y0 = 9, y1 = -9; for (const dx of [-hw, hw]) for (const y of [0, h]) { const [px, py] = proj(cx + dx, y, cz); x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); } return [x0, x1, y0, y1]; };
    const F = box(CAMP.fire.x, CAMP.fire.z, 0.95, 1.9);
    let over = 0;
    const test = (a) => {
      if (!a || a.removed || a.alive === false) return;
      const B = box(a.pos.x, a.pos.z, 0.45, Math.max(0.9, a.height || 1.4) + Math.max(0, a.pos.y));
      const ox = Math.min(F[1], B[1]) - Math.max(F[0], B[0]), oy = Math.min(F[3], B[3]) - Math.max(F[2], B[2]);
      if (ox > 0 && oy > 0) over = Math.max(over, Math.max(0, Math.min(1, ((ox * oy) / ((B[1] - B[0]) * (B[3] - B[2])) - 0.2) / 0.5))); // ≥ 20% of the fighter's box over the flare starts the fade, 70% = full
    };
    for (const h of heroes()) test(h);
    for (const e of S.live) test(e);
    soft += (over - soft) * (over > soft ? 0.18 : 0.06);
    env.setSoft(soft < 0.01 ? 0 : soft);
  };

  return {
    state: S,
    hud, // probes: hud._lanes()
    update(dt) {
      S.t++;
      if (S.t % 30 === 0 && !S.ended) for (const h of heroes()) { if (!h._campMagicOrig) blockMagic(h, noMagicCue); hookPots(h); } // late joiners
      for (let i = S.schedule.length - 1; i >= 0; i--) if (S.t >= S.schedule[i].at) { const it = S.schedule.splice(i, 1)[0]; it.fn(); }
      if (S.phase === 'sleep') {
        // a human player's button wakes their hero early (bots sleep until the theft)
        const ins = game.input.players || [];
        for (const h of heroes()) {
          const sp = game.session && game.session.players[h.playerIndex];
          const inp = ins[h.playerIndex || 0];
          if (sp && !sp.bot && inp && ['light', 'heavy', 'jump', 'magic'].some((a) => inp.pressed && inp.pressed(a))) { wake('button'); break; }
        }
        // failsafe: measured from the first thief actually arriving (asset streaming can delay the sneak-in)
        if ((S.spawned && S.t - S.firstSpawn > WAKE_FAILSAFE - 90) || S.t > WAKE_FAILSAFE * 2) wake('failsafe');
      } else if (S.phase === 'hunt') {
        S.huntT++;
        const left = HUNT_SECONDS - S.huntT / 60;
        hud.timer(Math.max(0, left));
        const idle = !S.schedule.length && !S.pending && ![...S.live].some((e) => !e.removed);
        if (left <= 0 || (idle && S.huntT > 120)) endHunt();
        magnet(false);
      } else if (S.phase === 'wrap') wrap();
      else if (S.phase === 'tally') for (const h of heroes()) freezeHero(h);
      // kicked-out loot leaves a glint trail on its arc, so every burst reads as "pots flying"
      // (r6: every 6th tick, at most 4 per pass, a touch behind the pot so it never frosts a fighter)
      if (S.t % 6 === 0 && game.vfx && game.vfx.spawn && (S.phase === 'hunt' || S.phase === 'wrap' || S.phase === 'sleep')) {
        let k = 0;
        for (const p of game.world.query({ kind: 'pickup' })) {
          if (!p.campLoot || p.grounded || p.removed || p.pos.y < 0.6) continue;
          game.vfx.spawn('sparkle', { pos: { x: p.pos.x, y: p.pos.y + 0.2, z: p.pos.z - 0.25 }, color: p.typeId === 'food' ? '#c8f080' : '#9fd0ff', count: 1 });
          if (++k >= 4) break;
        }
      }
      if (S.phase === 'sleep' || S.phase === 'hunt' || S.phase === 'wrap') applyKeepOut();
      if (!quiet && S.phase !== 'tally') updateSoft(); else if (soft > 0) { soft = 0; if (env.setSoft) env.setSoft(0); }
      hud.update(dt);
    },
    dispose() {
      for (const h of game.world.query({ kind: 'hero', alive: false })) { restoreMagic(h); unhookPots(h); }
      unhookFx();
      if (unlockMagic) { unlockMagic(); unlockMagic = null; }
      if (camMode && game.cameraRig && game.cameraRig.clearMode) game.cameraRig.clearMode(camMode);
      scope.dispose(); hud.dispose();
    },
  };
}
