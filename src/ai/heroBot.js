// HeroBot: AI that drives a hero through its PlayerInput's virtual device, exactly like a human pad
// (used by &bot=1 captures and title-screen attract mode). Approaches the nearest enemy, lines up in depth,
// runs when far, strings lights (ending close strings in aimed throws), mixes in heavies (some charged), air
// slams and jump attacks on downed foes, run attacks and Death Stabs from a dash, back attacks when flanked,
// dodges incoming swings, casts magic into crowds, walks into foes to clinch → knee → throw, and walks right
// when the stage shows GO. The attract mode
// therefore shows the whole DESIGN §3 grammar.
//   game.addSystem(new HeroBotSystem(game)); system.attach(hero, { skill: 0.8 })
// C2 r2 (enemies-ai) FIGHT NEAR THE MIDDLE: board r11 — in 2P stage play the brawl collapsed onto a frame edge within ~1 s
// (screen locks put the lock wall at the frame edge; foes walk in from there and the bots walked out to meet them, then
// followed their knockbacks into the wall), and the two heroes stood inside each other. Now a bot (like a good player)
// (a) prefers foes away from the frame edges, (b) never walks further out than EDGE_BAND of the frame to reach a foe — it
// holds there and lets the crowd come (the director's frame floor keeps every foe EDGE_FOE inside), (c) pinned at an edge
// with its foe on the outer side, steps back inward, (d) keeps a body width of screen x from its partner (target choice +
// steering; the director's heroSpace is the soft floor). hero.aiBot marks a bot-driven hero for the director.
//   game.params: &botedge=0 → r11 behaviour (no band / partner spacing).
import { viewRange } from './_kit.js';
const EDGE_BAND = 0.25; // fraction of the frame width: the bot's own centre stays this far from an edge while it fights (> the director's PIN_SIDE 0.2, so foes never detour round a bot)
const MATE_GAP = 1.9;   // m: x gap a bot keeps from its partner while their silhouettes overlap (|dz| < MATE_DZ): a body + the partner's strike spot
const MATE_DZ = 2.4;
const THIEF_EDGE = 0.15; // C2 r13: a thief closer than this (fraction of the frame width) to an edge is not chased
export class HeroBot {
  constructor(game, hero, { skill = 0.8 } = {}) {
    this.game = game;
    this.hero = hero;
    this.dev = hero.input.virtual;
    this.rng = game.rng.fork();
    this.skill = skill;
    this.held = new Set();
    this.cool = 0;
    this.string = 0;
    this.queue = [];
    this.lastRunTick = -999;
    this.runSeqUntil = 0;
    this.lastDodge = -999;
    this.grabUntil = 0;
    this.closeUntil = 0;
    this.uses = {};
    this.lastHit = game.tick;
    hero.aiBot = true;
    const qp = (k) => { const P = game.params; return P && P.raw && P.raw.get ? P.raw.get(k) : P && P.get ? P.get(k) : null; };
    this.edgeOn = qp('botedge') !== '0';
    this.thiefOn = qp('botthief') !== '0';
    const gp = Number(qp('botgap')); this.mateGap = gp > 0 ? gp : MATE_GAP; // A/B knob &botgap=
    if (game.bus && game.bus.on) this._off = game.bus.on('hit', (ev) => { if (ev && ev.attacker === hero) this.lastHit = game.tick; });
  }

  hold(dirs) {
    for (const d of [...this.held]) if (!dirs.includes(d)) { this.dev.hold(d, false); this.held.delete(d); }
    for (const d of dirs) if (!this.held.has(d)) { this.dev.hold(d, true); this.held.add(d); }
  }

  tap(action, ticks = 3) { this.dev.press(action, ticks); }
  later(ticks, fn) { this.queue.push({ at: this.game.tick + ticks, fn }); }

  update() {
    const g = this.game, h = this.hero, rng = this.rng;
    for (const q of this.queue.filter((q) => q.at <= g.tick)) q.fn();
    this.queue = this.queue.filter((q) => q.at > g.tick);
    if (!h.alive || h.removed) { this.hold([]); return; }
    if (this.cool > 0) this.cool--;
    // Leave foes a partner is holding or throwing alone (so co-op throws land).
    const enemies = g.world.query({ team: 'enemies', filter: (e) => e.hurtable && !(e.fsm && e.fsm.is('grabbed', 'thrown') && e.grabbedBy !== h) });
    // C2 r13 (softlock gate): a loot thief (def.passive: can't be killed, never holds a wave) is only chased in the open.
    // Once the stage shows GO, or while it hugs a frame edge, the bot lets it go and walks on (the level's strand check
    // removes it). Gate r13: a lone thief at the left lock wall, outside the hero's camera clamp, held both bots at the
    // frame edge for 100–800 s (stage 1 2P, stage 4 1P). &botthief=0 → old rule.
    if (this.thiefOn && enemies.some((e) => e.def && e.def.passive)) {
      const adv = g.levels && g.levels.canAdvance && g.levels.canAdvance();
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (!(e.def && e.def.passive)) continue;
        const vr = viewRange(g, e.pos.z), w = vr.xMax - vr.xMin, f = w > 1 ? (e.pos.x - vr.xMin) / w : 0.5;
        if (adv || Math.min(f, 1 - f) < THIEF_EDGE) enemies.splice(i, 1);
      }
    }
    if (!enemies.length) {
      const adv = g.levels && g.levels.canAdvance && g.levels.canAdvance();
      this.hold(adv ? ['right'] : []);
      return;
    }
    // Prefer a standing target in front; downed targets are jump-attack bait.
    // C2 r1 (enemies-ai): co-op bots split the work — a foe the partner is already on costs extra, so the two heroes stop
    // fighting the same foe from the same spot (board: two bot heroes standing inside each other at the frame edge)
    const mate = g.world.query({ kind: 'hero' }).find((o) => o !== h && o.alive && !o.removed);
    // C2 r2: frame room. f(x, z) = position in the frame (0 = left edge, 1 = right edge) at that depth.
    const edge = this.edgeOn;
    const fr = (x, z) => { const vr = viewRange(g, z), w = vr.xMax - vr.xMin; return w > 1 ? (x - vr.xMin) / w : 0.5; };
    const stuck = g.tick - this.lastHit > (enemies.filter((e) => e.typeId !== 'thief').length <= 1 ? 150 : 300); // no hit landed in 5 s (2.5 s vs a wave's last foe): the band rules relax — never a stand-off (C2 softlock gate: last foe at the lock edge)
    let target = null, best = Infinity;
    for (const e of enemies) {
      let d = Math.abs(e.pos.x - h.pos.x) + Math.abs(e.pos.z - h.pos.z) * 2 + (e.fsm.is('down') ? 1.5 : 0) + (mate && mate.botTarget === e && enemies.length > 1 ? 3 : 0);
      if (edge && !stuck) {
        const ef = fr(e.pos.x, e.pos.z), in_ = Math.min(ef, 1 - ef);
        if (e.typeId === 'thief' && in_ < EDGE_BAND && enemies.length > 1) continue; // a thief already at the edge is gone: never chase it into the corner
        d += in_ < 0 ? 8 : Math.max(0, 0.22 - in_) * 30; // a foe at / past the frame edge: let it come in
        // a foe the partner stands next to (screen x, overlapping depth) → this bot would stand on the partner fighting it
        if (mate && Math.abs(e.pos.x - mate.pos.x) < 2.2 && Math.abs(e.pos.z - mate.pos.z) < MATE_DZ && enemies.length > 1) d += 3;
      }
      if (d < best) { best = d; target = e; }
    }
    if (!target) target = enemies[0];
    h.botTarget = target;
    const dx = target.pos.x - h.pos.x, dz = target.pos.z - h.pos.z, adx = Math.abs(dx);
    const dirX = dx > 0 ? 'right' : 'left';
    const busy = h.fsm.tagged('busy') || h.fsm.is('attack');
    const dirs = [];
    if (Math.abs(dz) > 0.2) dirs.push(dz < 0 ? 'up' : 'down');
    const reach = this.closeUntil > g.tick ? 0.7 : 1.35; // close pick: get chest-to-chest so the string branches close
    // C2 r2 EDGE BAND: where would the bot stand to hit this foe? Not further out than EDGE_BAND of the frame: it holds at
    // the band and lets the foe come in (the crowd director brings attackers to the hero, the frame floor keeps them in).
    const hf = fr(h.pos.x, h.pos.z), band = EDGE_BAND;
    const outward = (s) => (s > 0 ? hf > 1 - band : hf < band); // moving in direction s (+1 right) from here goes into the edge band
    let holdX = false, inward = 0;
    if (edge && !stuck && !h.fsm.is('clinch')) {
      if (adx > reach && outward(Math.sign(dx))) holdX = true;
      // pinned at an edge with the foe on the outer side: step back toward the middle (the foe follows; never fought clipped)
      // hysteresis: starts inside the band, keeps stepping in until band + 0.04 (clear of the director's 0.24 soft inner-flank band)
      const was = this.inwardSide && g.tick - (this.inwardT || 0) < 3 ? this.inwardSide : 0, lim = was ? band + 0.04 : band;
      const pin = hf < lim ? -1 : hf > 1 - lim ? 1 : 0;
      if (pin && (Math.sign(dx) === pin || was === -pin)) { inward = -pin; this.inwardSide = inward; this.inwardT = g.tick; }
    }
    if (inward) dirs.push(inward > 0 ? 'right' : 'left');
    else if (adx > reach && !holdX) dirs.push(dirX);
    else if (adx < (this.closeUntil > g.tick ? 0.4 : 0.55)) dirs.push(dx > 0 ? 'left' : 'right');
    // C2 r2 PARTNER SPACING: two heroes whose silhouettes overlap on screen (x gap < MATE_GAP, depth < MATE_DZ) — the
    // higher-id bot (or the one not attacking) steps apart in x toward the middle of the frame, in depth if x has no room.
    // r11 rule (edge off): only bodies inside each other (< 0.9 m both ways) stepped apart in depth.
    const mateClose = mate && mate.grounded && (edge ? Math.abs(mate.pos.x - h.pos.x) < this.mateGap && Math.abs(mate.pos.z - h.pos.z) < MATE_DZ : Math.abs(mate.pos.x - h.pos.x) < 0.9 && Math.abs(mate.pos.z - h.pos.z) < 0.9);
    if (mateClose && (h.id > mate.id || (edge && mate.fsm && mate.fsm.is('attack') && !h.fsm.is('attack')))) {
      let sx = edge ? Math.sign(h.pos.x - mate.pos.x) || (hf < 0.5 ? 1 : -1) : 0;
      if (sx && outward(sx)) sx = 0; // no room that way: depth
      if (sx) { for (let i = dirs.length - 1; i >= 0; i--) if (horizD(dirs[i])) dirs.splice(i, 1); dirs.push(sx > 0 ? 'right' : 'left'); }
      else {
        for (let i = dirs.length - 1; i >= 0; i--) if (dirs[i] === 'up' || dirs[i] === 'down') dirs.splice(i, 1);
        dirs.push(h.pos.z >= mate.pos.z ? 'down' : 'up');
      }
      if (edge) this.mateStep = g.tick;
    }
    const aimKeep = this.aimUntil > g.tick ? [this.aimDir] : []; // throw aim stays held until the Light is read
    const horiz = horizD;
    if (this.runSeqUntil > g.tick) this.hold(dirs.filter((d) => !horiz(d))); // the double-tap owns ←/→
    else if (busy) this.hold([...dirs.filter((d) => !horiz(d)), ...aimKeep]);
    else this.hold([...dirs.filter((d) => !aimKeep.length || !horiz(d)), ...aimKeep]);

    // Walk-in grab: in a clinch, knee once or twice, then throw toward the bigger crowd (or forward).
    if (h.fsm.is('clinch')) {
      if (this.cool <= 0) {
        if (h.clinchKnees >= (this.kneesWanted ?? 1)) {
          const left = enemies.filter((e) => e !== h.clinchVictim && e.pos.x < h.pos.x).length, right = enemies.filter((e) => e !== h.clinchVictim && e.pos.x > h.pos.x).length;
          const aim = left > right ? 'left' : right > left ? 'right' : (h.facing > 0 ? 'right' : 'left');
          this.aimDir = aim; this.aimUntil = g.tick + 14; this.hold([aim]); this.later(1, () => this.tap('light'));
        } else this.tap('light');
        this.cool = 14;
      }
      return;
    }
    if (this.grabUntil > g.tick && !busy && !holdX && !inward) { this.hold([dirX, ...dirs.filter((d) => !horiz(d))]); return; } // push into the foe
    // C2 r2: stepping inward / apart from the partner — no new opener this tick (strings already running continue below)
    const repositioning = !!(inward || (this.mateStep === g.tick && !h.attack));

    // Run toward targets a few steps away (a real double-tap: release, tap, press again within 14 ticks). From a run:
    // Light = dash attack; jump at 3–4.4 m then Light near the apex = Death Stab.
    if (!busy && !holdX && !inward && this.runSeqUntil <= g.tick && adx > 3.4 && adx < 9 && Math.abs(dz) < 0.5 && h.grounded && g.tick - this.lastRunTick > 150 && !h.fsm.is('run') && rng.chance(0.08)) {
      this.lastRunTick = g.tick;
      this.runSeqUntil = g.tick + 9;
      this.later(2, () => this.tap(dirX, 3));
      this.later(7, () => { this.dev.hold(dirX, true); this.held.add(dirX); });
    }
    if (h.fsm.is('run') && !this.runPlan) { this.runPlan = (this.uses.dash || 0) <= (this.uses.stab || 0) ? 'dash' : 'stab'; this.use(this.runPlan); }
    if (!h.fsm.is('run', 'jump', 'fall')) this.runPlan = null;
    if (h.fsm.is('run') && adx < 2.4 && Math.abs(dz) < 0.35 && this.cool <= 0) { this.tap('light'); this.cool = 30; return; }

    // Dash → jump → Light near the apex = Death Stab; plain dash near the foe = run attack.
    if (h.fsm.is('run') && this.runPlan === 'stab' && adx > 3.0 && adx < 4.4 && Math.abs(dz) < 0.3 && this.cool <= 0 && rng.chance(0.35 * this.skill)) { this.tap('jump'); this.cool = 20; return; }
    if (h.fsm.is('jump', 'fall') && h.runJump && Math.abs(h.vel.y) < 3 && !h.attack) { this.tap('light'); return; }
    // Airborne: strike on the way down (slam onto downed / clustered foes).
    if (h.fsm.is('jump', 'fall') && h.vel.y < 1 && adx < 1.8 && Math.abs(dz) < 0.4 && !h.attack && !(edge && mate && Math.abs(mate.pos.x - target.pos.x) < 1.0 && Math.abs(mate.pos.z - target.pos.z) < 1.2)) { this.tap(target.fsm.is('down') || rng.chance(0.3) ? 'heavy' : 'light'); return; }

    // Close string: end on an aimed THROW (toward the bigger crowd side) about half the time.
    if (h.moveId === 'pommel_2' && h.attack && h.attack.anyHit && !this.throwAimed) {
      this.throwAimed = true;
      if (rng.chance(this.uses.aimThrow ? 0.55 : 0.9)) {
        this.use('aimThrow');
        const left = enemies.filter((e) => e !== target && e.pos.x < h.pos.x).length, right = enemies.filter((e) => e !== target && e.pos.x > h.pos.x).length;
        const aim = left > right ? 'left' : right > left ? 'right' : (h.facing > 0 ? 'left' : 'right');
        this.aimDir = aim; this.aimUntil = g.tick + 8; this.hold([aim]); this.later(1, () => this.tap('light')); this.cool = 50; return;
      }
    }
    if (h.moveId !== 'pommel_2') this.throwAimed = false;

    // Read incoming swings: dodge an enemy attack that is about to become active nearby (reactive: ignores `cool`).
    if (!busy && h.grounded && g.tick - this.lastDodge > 40) {
      const threat = enemies.find((e) => e.attack && e.attack.frame < (e.attack.def.startup || 0) - 2 && Math.abs(e.pos.x - h.pos.x) < 2.2 && Math.abs(e.pos.z - h.pos.z) < 0.55);
      if (threat && rng.chance((this.uses.dodge ? 0.1 : 0.3) * this.skill)) { this.use('dodge'); this.lastDodge = g.tick; this.hold([]); this.tap('dodge'); this.cool = 26; return; }
    }
    // Magic into a crowd (or with a full stock).
    const near = enemies.filter((e) => Math.abs(e.pos.x - h.pos.x) < 7 && !e.fsm.is('down')).length;
    if (!busy && h.grounded && h.pots > 0 && this.cool <= 0 && !(h.game.magic && h.game.magic.locked) && (near >= 3 || (near >= 2 && h.magicTier() >= 2) || (h.pots >= h.maxPots && near >= 1)) && rng.chance(0.03)) { this.tap('magic'); this.cool = 90; return; }
    // Flanked: back attack (Light+Jump) on the foe behind.
    const behind = enemies.find((e) => Math.sign(e.pos.x - h.pos.x) === -h.facing && Math.abs(e.pos.x - h.pos.x) < 1.5 && Math.abs(e.pos.z - h.pos.z) < 0.4 && !e.fsm.is('down'));
    if (!busy && behind && this.cool <= 0 && h.moves.back_attack && rng.chance((this.uses.back ? 0.25 : 0.6) * this.skill)) { this.use('back'); this.tap('light'); this.tap('jump'); this.cool = 36; return; }

    // Mid-string: press Light exactly when the move offers a Light cancel (it connected), like a player reading the hit.
    if (h.attack && h.attack.anyHit && h.attack.cancelsNow().some((c) => c.on === 'light')) {
      if (h.moveId === 'light_2' && h.moves.launcher && rng.chance(0.2 * this.skill)) { this.tap('heavy'); this.cool = 30; return; }
      this.tap('light'); this.cool = 3; return;
    }
    const inRange = adx <= reach + 0.1 && Math.abs(dz) < 0.3;
    if (!inRange || this.cool > 0 || busy || repositioning) return;
    const facing = Math.sign(dx) === h.facing;
    if (!facing) { this.tap(dirX, 2); return; }
    if (target.fsm.is('down') && h.grounded && rng.chance(0.5) && !(edge && mate && Math.abs(mate.pos.x - target.pos.x) < 1.6 && Math.abs(mate.pos.z - target.pos.z) < 1.2)) { /* C2 r2: not a jump onto the partner's spot */ this.tap('jump'); this.later(14, () => this.tap(rng.chance(0.5) ? 'heavy' : 'light')); this.cool = 40; return; }
    const crowd = enemies.filter((e) => Math.abs(e.pos.x - h.pos.x) < 1.6 && Math.abs(e.pos.z - h.pos.z) < 0.6).length;
    if (crowd >= 3 && rng.chance(0.08 * this.skill)) { this.tap('dodge'); this.cool = 24; return; }
    if (this.closeUntil > g.tick) { this.closeUntil = 0; this.tap('light'); this.cool = 30; return; } // stepped in: close string
    // Opener: weighted pick, techniques this bot hasn't shown yet ×4, so a demo shows the whole grammar early.
    const opts = [['light', 0.5]];
    // A foe with a frontal guard (knight, skeleton) that has been blocking: favour heavies, charges and throws.
    const guarded = !!(target.brain && target.brain.guard && (target.guardHits || 0) > 0);
    if (guarded) opts[0][1] = 0.2;
    if (h.moves.heavy) opts.push(['heavy', guarded ? 0.45 : 0.1]);
    // Charge only with breathing room (nobody else within 3 m), like a player would.
    const crowded = enemies.some((e) => e !== target && Math.abs(e.pos.x - h.pos.x) < 3 && Math.abs(e.pos.z - h.pos.z) < 1);
    if (h.moves.heavy && h.moves.heavy.charge && !crowded) opts.push(['charge', guarded ? 0.3 : 0.12]);
    if (h.moves.throw && !target.fsm.is('down', 'knockdown', 'getup')) opts.push(['clinch', 0.12]);
    if (h.moves.air_slam) opts.push(['slam', 0.07]);
    if (h.moves.pommel_1) opts.push(['close', 0.13]);
    let sum = 0; for (const o of opts) { o[1] *= this.uses[o[0]] ? 1 : 4; sum += o[1]; }
    let r = rng.next() * sum, pick = 'light';
    for (const [k, w] of opts) { if ((r -= w) <= 0) { pick = k; break; } }
    this.use(pick);
    if (pick === 'heavy') { this.tap('heavy'); this.cool = 40; return; }
    if (pick === 'charge') { this.hold([]); this.tap('heavy', 58); this.cool = 90; return; } // charged (level 2)
    if (pick === 'clinch') { this.grabUntil = g.tick + 45; this.kneesWanted = rng.int(0, 2); return; } // walk into it
    if (pick === 'slam') { this.tap('jump'); this.later(16, () => this.tap('heavy')); this.cool = 50; return; }
    if (pick === 'close') { this.closeUntil = g.tick + 40; return; } // step in to pommel range first
    this.tap('light'); // opener; the string continues above on hit
    this.cool = 30;
  }

  use(k) { this.uses[k] = (this.uses[k] || 0) + 1; }

  dispose() { this.hold([]); this.dev.releaseAll(); if (this._off) this._off(); if (this.hero) this.hero.aiBot = false; }
}
const horizD = (d) => d === 'left' || d === 'right';

/** System wrapper: runs every attached bot before input sampling. */
export class HeroBotSystem {
  constructor(game) { this.game = game; this.name = 'bots'; this.order = -10; this.bots = []; }
  attach(hero, opts) { const b = new HeroBot(this.game, hero, opts); this.bots.push(b); return b; }
  detach(hero) { this.bots = this.bots.filter((b) => { if (b.hero === hero) { b.dispose(); return false; } return true; }); }
  update() { for (const b of this.bots) b.update(); }
  dispose() { for (const b of this.bots) b.dispose(); this.bots = []; }
}
