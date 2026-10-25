// CrowdDirector (game.ai.director): the SoR4-style crowd brain above the per-enemy behaviours.
//   - co-op target splitting: engaged enemies are balanced across living heroes (sticky; re-evaluated every 15 ticks)
//   - surround / flank slots: each hero has slots on BOTH sides and in depth; enemies take the cheapest free slot
//     (no walking through the hero to reach the far side), token holders get the near slots
//   - combo pressure: damage a hero deals raises that hero's pressure → the crowd's aggression and token cap rise
//     (they try to break the combo); a hit on the hero vents it
//   - thrown-ally reactions: allies in the flight path of a thrown enemy dodge aside in depth or brace
//   - anti-stunlock limit and difficulty scaling (tokens, reaction time, aggression)
//   - SHARED PRESSURE CAP per hero (r2): every type's strike budget is tuned alone, so a mixed elite crowd (knight +
//     skeleton + viper + marauders) used to stack up. Now (a) token holders' summed def.threat ≤ cfg.threatCap and at
//     most cfg.eliteCap elites (threat ≥ 1.5) hold a token / swing at one hero at once, and (b) a damage-rate governor
//     (rolling ~10 s window vs cfg.dmgPerMin) stretches the strike gap while a hero is taking more than the budget.
//   - TANK PRIORITY (r3): tanks (def.tank or threat ≥ 2.5: knight, ogre) used to starve behind the caps (a knight
//     swung ~4× per 40 s in a mixed crowd). A tank that has wanted a token for STARVE ticks may pre-empt a
//     non-swinging lower-threat holder, ignores the threat cap (not a swinging elite), and RESERVES the hero's next
//     strike (others hold their swing until the tank commits or RESERVE ticks pass). Every hit still telegraphs.
//   - CONTACT SPACING (r4): critic saw attackers pile onto one spot on one side while others parked at the frame
//     edge. Now (a) the 2nd token holder on a hero is always given the opposite side (attackSide), a 3rd takes a
//     depth-offset lane, (b) every enemy steers away from allies inside STEER m (steer) and a hard belt-plane
//     constraint keeps foes ≥ SEP m apart (a mid-swing striker is the anchor, the other one yields), (c) slots that
//     fall outside the camera view are penalised and circlers keep drifting in depth instead of parking.
//   - SCREEN-X LANES (r5): under the side camera two foes at the same x but different depth merge into one blob, and
//     a foe in the hero's own column hides behind / in front of him. Now (a) the waiting slots on each side sit on
//     DISTINCT x rings (depth-lane slots are also further out in x, never straight behind a front-row foe), (b) a 3rd
//     attacker on a busy flank queues one lane (>= XSEP) behind the foe already there instead of stacking in depth,
//     (c) steer() repels allies inside the same x lane at ANY visible depth and keeps foes out of a hero's column,
//     (d) separate() adds a soft x-lane push (swinging foe / token holder anchors, the waiting one yields outward),
//     (e) an attacker only strikes from a spot whose x lane is free (laneFree).
//   - DEPTH ROWS (r8): the critic saw 8+ foes on ONE screen row (feet within ~45 px, a conga line, same-colour foes
//     fusing, hero not findable). Slots now carry a row: `m` = the hero's row (strikers), `a` / `b` = two waiting rows at
//     the band's front / back edges (rows(hero)), so the crowd stands in three bands ≥ 2 m apart in depth; waiters are
//     spread over the rows (rowBal / rowMid / rowStick), the lane hand-out runs per row, ZVIS 2.5 (bodies on other rows are
//     separate silhouettes), entryLane fans a wave's arrivals over the rows. e.aiSlot.z = the absolute row z.
//   - WING (r8): the second arrival while someone fights the hero and a token is free rushes in like the vanguard (from the
//     opposite edge when the hero is < 12 m from it); vanguard / wing stay committed while the hero is down and swing when
//     he can act. eliteCap counts only threat ≥ 1.8 (knights, ogres): skeletons / vipers no longer share one elite slot.
//   - retreat budget (at most one hurt foe backs off per hero at a time) and shared group state (Brute Brothers)
// API used by behaviours (src/ai/_kit.js wraps it):
//   director.targetFor(e) · director.slotFor(e, t) → { side, dz, ring } · director.aggression(e, t, base)
//   director.reaction(ticks) · director.tokenCap(t) · director.stunLimit(e) · director.pressure(t)
//   director.requestRetreat(e, t, ticks) → bool · director.group(name) → shared object
// Events: 'ai:react' { actor, order: 'dodge'|'brace', from }
import { EV } from '../core/EventBus.js';
import { viewRange, offFrame } from './_kit.js';

export const DIFFICULTY = {
  easy: { tokens: 1, tokenHold: 130, reaction: 1.35, aggro: 0.8, stunLimit: 14, dodge: 0.25, brace: 0.35, strikeGap: 130, pressureToken: false, threatCap: 2, eliteCap: 1, dmgPerMin: 42 },
  normal: { tokens: 2, tokenHold: 150, reaction: 1.0, aggro: 1.0, stunLimit: 10, dodge: 0.45, brace: 0.35, strikeGap: 88, pressureToken: false, threatCap: 3, eliteCap: 1, dmgPerMin: 46 }, // r8: strike gap 96→88 (more attack starts), dmgPerMin 60→46 (skeletons / vipers attack now: 40 s runs measured 55–90 dmg per hero-min at 52) (the heat governor keeps damage in budget; threatCap 3.5 measured hot: knight + grunt pairs)
  hard: { tokens: 3, tokenHold: 170, reaction: 0.75, aggro: 1.2, stunLimit: 8, dodge: 0.6, brace: 0.3, strikeGap: 60, pressureToken: true, threatCap: 4.5, eliteCap: 2, dmgPerMin: 100 },
};

const ELITE = 1.8;   // threat at/above which an enemy counts as an elite for cfg.eliteCap (r8: was 1.5 — skeleton / viper / elite marauders all shared ONE elite slot and starved: 2 skeleton attacks in 40 s; they still count in the threatCap sum)
const HEAT_TAU = 10; // s — damage-rate governor window
const HEAT_CEIL = 1.2;
const TANK = 2.5;     // threat at/above which an enemy is a tank (token priority)
const STARVE = 80;    // ticks a tank may be denied a token before it gets priority
const RESERVE = 110;  // ticks a starved tank's granted strike stays reserved // heat at/above which new strikes on that hero are held (chains too: Enemy.js)

const SEP = 1.15;   // m — hard minimum spacing between two grounded foes (belt plane, euclidean)
const DZW = 0.85;   // depth weight (<1: foes need MORE room in depth — depth-stacked foes overlap on screen)
const STEER = 1.8;  // m — radius of the soft ally-avoidance steering
const XSEP = 0.95;  // m: screen-x lane, two visible foes want at least this much x between them at any depth
const ZVIS = 2.5;   // m: depth window inside which two bodies overlap on screen (side camera). r8: was 3.4; rows sit ≥ 2.5 m apart, bodies on different rows are separate silhouettes
const HCOL = 0.75;  // m: a hero's own screen column, waiting / walking foes keep out of it
const VIEWPAD = 1.5; // m: r6, waiting goals stay this far inside the frame edge (was 2.0: packed the outer lanes together)
const WAITX = 3.2;  // m: waiting foes stand at least this far (screen x) from any hero. r6: 2.0 (strike columns at ~1.1 m clear); c1r10: 3.2 — struck foes reel to ~1.5–2.2 m and fused with waiters at 2.0 (A/B: 2.0 / 2.6 / 3.2 / 3.6 → 6.9 / 6.2 / 5.0 / 8.4 % co-op contact pairs)
const EDGE_IN = 1.0;  // m: c1r10, a waiter's feet stay at least this far inside the frame edge (one body width: never half clipped)
const WAITX_SOLO = 2.4; // m: c1r10, solo stand-off (one hero: 3.2 parked the crowd at the frame edge on one side)
const DZ_SEP = 2.2;  // m: c1r10, bodies this far apart in depth read as separate on screen (feet ≥ ~60 px apart): they may share a screen column
const BOX_X = 4.3, BOX_Z = 2.1; // m: c1r10, a hero's contact box (what the player reads as 'his fight'): every body inside it gets its own screen column
const FREE_R = 0.9;   // m: c1r10, screen half-width a standing body blocks for a waiter's walk / stand (pairs < 0.8 m read as one blob)
const ENTRY_GAP = 1.1; // m: r5b, distinct arrival x between entering foes and every other visible body
// C2 r1 BODY SPACE (space(): post-physics, every tick, perspective-true screen x). Board C1 r10: standing bodies still
// merged in co-op (also while walking / circling) and attackers stood on top of their hero — goal picking alone never
// held a floor. Now a hard screen-space floor between every pair of standing bodies whose silhouettes overlap in height.
const SP_EE = 0.92;    // m: foe–foe centre gap on screen (pairs < 0.8 m read as one blob)
const SP_EE_FAR = 0.84; // m: …for pairs SP_DZ..SP_DZMAX apart in depth (one stands a band higher, still overlaps the torso)
const SP_EH = 0.82;    // m: foe–hero centre gap (critic: "attackers stand on top of their hero, hold ~0.6 m"); hero clinch contact is ≤ 1.0 m
const SP_EH_PRESS = 0.78; // m: …while the hero walks / lunges into the foe (ordinary body contact: walk-in clinch, close strings)
const SP_DZ_EH = 1.2; // m: the foe–hero floor holds only on the hero's own depth row (a detour round him passes behind / in front)
const SP_EH_FAR = 0.68; // C2 r2: foe–hero screen gap for standing foes a band off his row (the probe flags < 0.6 m)
const SP_DZ = 1.5, SP_DZMAX = 2.9;
const SP_VOV = 0.42; // silhouette height overlap at/above which two bodies need their own screen columns (probe flags ≥ 0.5) // m: depth gaps — below SP_DZMAX two upright bodies overlap ≥ ~50 % of their height on screen
const SP_STEP = 0.08; // m per tick: the most a body is slid by the floor (≈ 4.8 m/s; 0.055 lost the dense 2P crowd — 3 seeds pooled: 0.07 → 5.2 %, 0.085 → 3.3 % overlap)
const SP_NO = ['thrown', 'grabbed', 'clinch', 'bones', 'rise', 'dead', 'knockdown', 'down', 'getup', 'reform', 'hold', 'toss'];
// C2 r1 IDLE CAP: board saw a foe visible ~10 s before its first swing. Visible + in control without an attack start for
// OVERDUE ticks → priority on the next token (like a starved tank); without ANY action (swing, feint, menace step, taunt)
// for MENACE ticks → the kit makes a visible threat move.
const OVERDUE = 230;
const MENACE = 110;
const SOLO_TIGHT = 1.75; // m: tightest solo stand-off on a hero's cramped (frame-edge) side
const FLANK_BAL = 2.0; // solo waiter placement: cost per waiter a side holds beyond the other side
// C2 r1 PINNED HERO: a hero whose screen centre is within PIN of the frame width from an edge is fought from the inner side
// only (board C1 r10: in real stage mode pinned heroes were struck from the outer, half-clipped side). An overdue foe
// (idle cap) is exempt as long as its whole body is in frame: stage 2 opens on a locked screen whose wall sits at the frame
// edge, and a foe caught between the wall and a pinned hero otherwise never swung (measured: 20 s visible idle).
const PIN = 0.12;      // hard band: an outer-side attacker here would stand < ~0.7 m from the edge (half cut off) — never
const PIN_PREF = 0.2;  // soft band (board: 'within ~15 %'): the first attacker on the hero takes the inner flank while it is free
const STRIKE_IN = 0.6; // body half-width ~0.4 + margin: the whole body is inside the frame // m: an attacker's body centre must be at least this far inside the frame to start a move
// C2 r2 FRAME FLOOR (board r11: "foes take the slot beyond the pinned heroes and are fought half or wholly off-screen —
// '5 HITS' on a foe clipped at x 0–40"; enemies have no screen clamp, only the world extents, so knockbacks carried them
// past a screen lock out of the frame). Every foe out of its walk-in keeps its body centre EDGE_FOE m inside the frame
// (90 px at 1600 wide ≈ 0.8 m at the hero row; 1.0 m keeps the margin on the back rows): walkers / reeling foes are slid
// in, a knockback / throw flight meets an invisible wall at EDGE_WALL (a small bounce, SoR-style), a body on the floor
// is eased in. A foe squeezed between that floor and a hero on the hero's row steps off his row in depth and goes round.
const EDGE_FOE = 1.0;
const EDGE_WALL = 1.15;
const PIN_VETO = 0.17; // C2 r2: attack-start veto band (probe 'pinned' = 15 %); PIN stays the slot-side reference
const PIN_SIDE = 0.18; // C2 r2: attackSide routes attackers to the inner flank inside this band (before the veto applies). C2 r3: 0.2 → 0.18
                       // (just above PIN_VETO): at 0.2 most co-op bots stood in it and their foes spent 3–5 s on detours round them
const STRIKE_IN2 = 0.95; // C2 r2: an attacker's centre must be this far inside the frame to start a move (was 0.6)
const SP_HH = 0.85;   // C2 r2: hero–hero screen gap below which two standing heroes are eased apart (board: co-op heroes stack)
const SP_HH_STEP = 0.025; // m per tick per hero (≈ 1.5 m/s: a soft body, never fights the stick)
const FIRST_DUE = 120; // C2 r2: ticks after a foe first stands fully in frame without having attacked → priority (cap ≤ 6 s). C2 r3: 180 → 120
const FIRST_GAP = 12;
const LANE_STICK = 120; // C2 r3: ticks a foe going round its hero keeps the side it chose
const FLANK_MIN = 1.7; // C2 r3: m — the nearest a flank waiter stands to its hero (strike spot ~1.06 m + a body)
const CO_DZ = 1.9;      // C2 r15: m — a co-op depth-lane walk-in passes every hero at least this far off his row
const CO_GAP_MIN = 1.7; // C2 r15: m — the gap between the heroes takes a flank foe only if the partner stands >= this + 1.6 m away
const FLANK_X = 2.3;   // C2 r3: m — a flank waiter's preferred distance from its hero on his open side  // C2 r3: the strike gap an overdue first-timer waits out (r12: 45; the full gap is 50–150 ticks) — never two starts on one frame
const SLIDE_MODES = ['circle', 'retreat', 'keep']; // r5b: brain modes that may be slid sideways out of a shared screen column
const NOPUSH = ['thrown', 'grabbed', 'clinch', 'bones', 'rise', 'dead'];

// Slot table: side (±1 = right/left of the hero), row (depth row, see rows()), ring (spacing multiplier). Near slots first.
// r5: every slot on one side has its own x ring (~0.95 m apart at spacing 2.2) so depth lanes never share a column.
// r8 DEPTH ROWS: the two strike slots sit on the hero's own row ('m'); every waiting slot sits on row 'a' or 'b', the
// two waiting rows rows() spreads ≥ ROW_GAP m away from it (front/back across the walkable band), so a crowd of eight
// stands in three readable bands on screen instead of one conga line. `dz` (resolved per hero in assign()) is the
// depth offset the rest of the AI reads (lane pass, kit circle goal).
const ROW_GAP = 2.3;  // m: depth between the hero's row and a waiting row (and between the two waiting rows when the band allows)
const SLOTS = [
  { side: 1, row: 'm', ring: 1 }, { side: -1, row: 'm', ring: 1 },
  { side: 1, row: 'a', ring: 1.43 }, { side: -1, row: 'b', ring: 1.43 },
  { side: -1, row: 'a', ring: 1.86 }, { side: 1, row: 'b', ring: 1.86 },
  { side: 1, row: 'a', ring: 2.3 }, { side: -1, row: 'b', ring: 2.3 },
  { side: -1, row: 'a', ring: 2.75 }, { side: 1, row: 'b', ring: 2.75 },
  { side: 1, row: 'm', ring: 2.3 }, { side: -1, row: 'm', ring: 2.3 },
];

export class CrowdDirector {
  constructor(game, ai, cfg = DIFFICULTY.normal) {
    this.game = game;
    this.ai = ai;
    this.cfg = cfg;
    this._pressure = new Map();
    this.groups = new Map();
    this.retreats = new Map(); // heroId → { id, until }
    this.flying = [];
    this.stats = { reacts: 0, dodges: 0, braces: 0, breakouts: 0, blocks: 0, telegraphs: 0 };
    this.coBal = true; // C2 r16: the r3 co-op flank balance in place() + the kit's planned-crosser rule, ON (it ran in all r16 tuning via a name clash; A/B AI_FLAGS {"coBal":false}: S1 one-sided 40.7 vs 37.2 %)
    const bus = game.bus;
    this.scope = bus.scope ? bus.scope() : bus;
    this.scope.on(EV.HIT, (ev) => {
      const a = ev.attacker, t = ev.target;
      if (!a || !t) return;
      if (a.kind === 'hero' && t.team === 'enemies' && !ev.blocked) this._pressure.set(a.id, Math.min(80, (this._pressure.get(a.id) || 0) + (ev.damage || 0)));
      if (t.kind === 'hero') this._pressure.set(t.id, (this._pressure.get(t.id) || 0) * 0.4);
      // C2 r2 AGGRO: a foe struck by a hero turns on that hero (board r11: a skeleton beaten by one hero kept its token on the
      // other one 9 m away and walked there for 25 s without a swing). The co-op balance pass leaves it there for 1.5 s.
      // C2 r16 (co-op): a foe already standing in its own hero's fight (within 4 m of him) keeps him when the partner strikes it — the
      // r12 rule was for a foe 9 m off; at close range the switch emptied the first hero's flank (the gap foe is hit by both heroes)
      const keep = !this.v15Bal && t.aiTarget && t.aiTarget.alive && t.aiTarget.kind === 'hero' && this._nh > 1 && Math.abs(t.pos.x - t.aiTarget.pos.x) < 4.0 && Math.abs(t.pos.z - t.aiTarget.pos.z) < 2.5 && !(t.aiTarget.fsm && t.aiTarget.fsm.is('dead'));
      if (keep && a.kind === 'hero' && t.team === 'enemies' && t.aiTarget !== a) this.stats.aggroKeep = (this.stats.aggroKeep || 0) + 1;
      if (a.kind === 'hero' && t.team === 'enemies' && t.brain && !this.noAggro && a.alive && t.aiTarget !== a && !this.across(t, a) && !keep) {
        if (this.ai.tokens && this.ai.tokens.has(t)) this.ai.tokens.release(t);
        t.aiTarget = a; t.aiAggroT = game.tick; this.stats.aggro = (this.stats.aggro || 0) + 1;
      } else if (a.kind === 'hero' && t.team === 'enemies') t.aiAggroT = game.tick;
      // Rider jump-slash (GA): an enemy hit flagged `dismount` knocks a mounted hero off its beast (Mount API).
      if (a.team === 'enemies' && ev.hit && ev.hit.dismount && !ev.blocked && t.mountedOn && t.mountedOn.dismount) {
        try { t.mountedOn.dismount({ knocked: true }); } catch (e) { /* mounts specialist owns the rules */ }
      }
    });
    this.lastStrike = new Map();
    this._lastGo = new Map(); // enemy id → tick of its last attack start (front-row hand-over fairness)
    this._want = new Map();    // tank id → tick it first asked for a token and was refused
    this._reserve = new Map(); // heroId → { id, until } strike reserved for a starved tank
    this._heat = new Map(); // heroId → decayed recent damage taken (τ = HEAT_TAU s)
    this._sideLog = new Map(); // C2 r16: heroId → sides (±1) of the last attack starts on him
    this._turn = new Map();    // C2 r16: heroId → { side, until } the other flank's turn
    this.scope.on(EV.HIT, (ev) => {
      const a = ev.attacker, t = ev.target;
      if (a && t && t.kind === 'hero' && a.team === 'enemies' && !ev.blocked) { this._heat.set(t.id, (this._heat.get(t.id) || 0) + (ev.damage || 0)); this.stats.heatPeak = Math.max(this.stats.heatPeak || 0, this.heat(t)); }
    });
    this.scope.on(EV.ATTACK_START, (ev) => {
      const a = ev.actor;
      if (a && a.team === 'enemies' && a.kind !== 'boss' && a.target && a.target.kind === 'hero') {
        this.lastStrike.set(a.target.id, { tick: game.tick, w: (a.def && a.def.strikeWeight) || 1 });
        this._lastGo.set(a.id, game.tick);
        if (!this.v16Bal) this.coThreat(a, a.target);
        { const L = this._sideLog.get(a.target.id) || []; L.push(Math.sign(a.pos.x - a.target.pos.x) || 1); if (L.length > 4) L.shift(); this._sideLog.set(a.target.id, L); this._turn.delete(a.target.id); } // C2 r16 side turns
        const r = this._reserve.get(a.target.id);
        if (r && r.id === a.id) this._reserve.delete(a.target.id);
      }
    });
    this.scope.on(EV.THROW, (ev) => { if (ev.victim && ev.victim.team === 'enemies') { this.flying.push({ v: ev.victim, reacted: new Set(), t: game.tick }); this.allyDown(ev.victim, ev.thrower || ev.actor || ev.by, 'throw'); } });
    this.scope.on(EV.KNOCKDOWN, (ev) => { this.allyDown(ev.actor, ev.by, 'down'); if (!this.v16React && !this._bossEncounter && ev.actor?.alive && ['marauder', 'skeleton'].includes(ev.actor.typeId) && ev.actor.vel.y > 5 && ev.actor.animator?.has('crowd_tumble')) ev.actor.play('crowd_tumble', { restart: true, fade: .05 }); if (!this.v16React && ev.actor?.kind === 'hero') this.heroFloored(ev.actor); }); // C2 r3 crowd reactions
    this.scope.on('ai:breakout', () => this.stats.breakouts++);
    this.scope.on('ai:block', () => this.stats.blocks++);
    this.scope.on('ai:telegraph', () => this.stats.telegraphs++);
  }

  /** C2 r3: does another standing hero stand between foe e and hero h (in x, on a nearby depth)? Reaching h would mean walking
   *  through that hero's fight (board r12 trace: a spell from the far hero turned a foe on him; it stood 2 s pressed against the
   *  partner it had to pass). Used by the aggro rule: no retarget across the partner. */
  across(e, h, m = 0.3) { // C2 r15: m = margin — a planned co-op foe only counts as across with the partner >= m from both (heroes jostle)
    if (this.noAcross) return false;
    for (const o of this.heroes()) {
      if (o === h || Math.abs(o.pos.z - e.pos.z) > 2.4) continue;
      if ((o.pos.x - e.pos.x) * (h.pos.x - o.pos.x) > 0 && Math.abs(o.pos.x - e.pos.x) > m && (m <= 0.3 || Math.abs(o.pos.x - h.pos.x) > m)) return true;
    }
    return false;
  }

  reset() { this._pair = null; if (this._sideLog) this._sideLog.clear(); if (this._turn) this._turn.clear(); if (this._coX) this._coX.clear(); if (this._rowSt) this._rowSt.clear(); this._free = null; this._lastGo.clear(); this._want.clear(); this._reserve.clear(); this._heat.clear(); this._pressure.clear(); this.groups.clear(); this.retreats.clear(); this.flying.length = 0; }

  /** c1r10 waiting stand-off (screen x from a hero): co-op WAITX; solo waitXSolo (one fight: the crowd waits closer). */
  wx() { return this.waitX ?? ((this._nh || 1) > 1 || this.v9Pack ? (!this.v16Bal && !this.r16Off && !this._bossEncounter ? 2.35 : WAITX) : this.waitXSolo ?? WAITX_SOLO); }
  /** c1r10 may a waiter go round its hero (depth detour behind / in front of the fight) to balance the sides? solo only by default. */
  round() { return this.roundOk ?? ((this._nh || 1) === 1 && !this.v9Pack && !this.noRoundSolo); }

  heroes() { return this.game.world.query({ kind: 'hero' }).filter((h) => h.alive && !(h.fsm && h.fsm.is('dead'))); }
  engaged() { return this.game.world.query({ team: 'enemies' }).filter((e) => e.alive && e.brain && !(e.def && e.def.passive) && e.kind !== 'boss'); }

  pressure(t) { return t ? this._pressure.get(t.id) || 0 : 0; }
  aggression(e, t, base = 0.6) { return Math.min(1.25, base * this.cfg.aggro * (1 + Math.min(0.5, this.pressure(t) / 40))); }
  reaction(ticks) { return Math.max(2, Math.round(ticks * this.cfg.reaction)); }
  tokenCap(t) { return Math.min(4, this.cfg.tokens + (this.cfg.pressureToken && this.pressure(t) > 22 ? 1 : 0)); }
  /** Threat of one enemy (def.threat; grunts 1, elite ranks +0.5). ≥ ELITE counts against cfg.eliteCap. */
  threatOf(e) { return ((e && e.def && e.def.threat) || 1) + (e && e.eliteLevel ? 0.5 : 0); }
  isElite(e) { return this.threatOf(e) >= ELITE; }
  isTank(e) { return !!(e && e.def && (e.def.tank || (e.def.threat || 0) >= TANK)); }
  /** A tank that has been refused a token for STARVE ticks (it gets priority). */
  starved(e) {
    if (e && e.aiOverdue && !this.noOverdue) return true; // C2 r1: a foe visible too long without a swing gets the tank's priority
    const w = this._want.get(e.id); return w !== undefined && this.game.tick - w >= STARVE;
  }
  _refuse(e) { if (this.isTank(e) && !this._want.has(e.id)) this._want.set(e.id, this.game.tick); return false; }
  _granted(e, t) {
    // C2 r1: an overdue foe reserves the hero's next strike only when it is close (a far one walking in held everybody's swing)
    if (this.starved(e) && (this.isTank(e) || Math.abs(e.pos.x - t.pos.x) < 4)) { this._reserve.set(t.id, { id: e.id, until: this.game.tick + RESERVE }); this.stats.tankPriority = (this.stats.tankPriority || 0) + 1; }
    this._want.delete(e.id);
    return true;
  }
  /** Token cap full: a starved tank bumps the lowest-threat holder that isn't mid-swing (AttackTokenDirector hook). */
  preempt(e, t, holders) {
    if (!this.starved(e)) { this._refuse(e); return null; }
    let best = null, bt = Infinity;
    for (const id of holders.keys()) {
      const o = this.game.world.byId.get(id);
      if (!o || this.isTank(o) || this.starved(o) || (o.fsm && o.fsm.is('attack'))) continue;
      const th = this.threatOf(o);
      if (th < bt) { bt = th; best = id; }
    }
    return best;
  }
  /** Recent damage heat vs the difficulty's damage budget: 1 = on budget, >1 = hero is being over-pressured. */
  heat(t) { return t ? (this._heat.get(t.id) || 0) / (this.cfg.dmgPerMin / 60 * HEAT_TAU) : 0; }
  /** Enemies (other than `except`) currently mid-swing on hero t. */
  swinging(t, except) {
    const out = [];
    for (const o of this.engaged()) if (o !== except && o.target === t && o.fsm && o.fsm.is('attack')) out.push(o);
    return out;
  }
  /** Token veto (AttackTokenDirector.canGrant): shared threat + elite caps over holders and live swingers. */
  canGrant(e, t, holders) {
    const w = this.game.world, seen = new Set();
    let sum = 0, elites = 0, n = 0;
    const add = (o) => { if (!o || o === e || seen.has(o.id)) return; seen.add(o.id); n++; sum += this.threatOf(o); if (this.isElite(o)) elites++; };
    if (holders) for (const id of holders.keys()) add(w.byId.get(id));
    for (const o of this.swinging(t, e)) add(o);
    if (this.sideTurn(e, t)) return false; // C2 r16: the other flank's turn
    if (!n) return this._granted(e, t); // the first attacker is always allowed (a lone ogre still fights)
    if (this.starved(e)) {
      // Priority: only another elite actually mid-swing on this hero keeps a starved tank waiting.
      for (const o of this.swinging(t, e)) if (this.isElite(o)) return false;
      return this._granted(e, t);
    }
    if (this.isElite(e) && elites >= this.cfg.eliteCap) { this.stats.eliteHolds = (this.stats.eliteHolds || 0) + 1; return this._refuse(e); }
    if (sum + this.threatOf(e) > this.cfg.threatCap) { this.stats.threatHolds = (this.stats.threatHolds || 0) + 1; return this._refuse(e); }
    return this._granted(e, t);
  }
  /** C2 r16 SIDE TURNS (board r14: per-hero attack sides 20L/6R, 3L/14R): after two attack starts in a row on hero t from one side,
   *  a ready foe standing on his OTHER flank gets the next turn — a request from the busy side is refused for up to 1.5 s (its cooldown
   *  is cut so it steps in now). Never against an overdue first-timer, a vanguard or a starved tank; co-op only unless director.sideTurn1P. */
  sideTurn(e, t) {
    if (this.noSideTurn || (this._nh < 2 && !this.sideTurn1P) || (this.starved(e) && (this.r16Off || this.isTank(e))) || (e.aiOverdue && !e.aiHasAtk) || e.vanguard) return false;
    const tick = this.game.tick, sd = Math.sign(e.pos.x - t.pos.x) || 1, cur = this._turn.get(t.id);
    if (cur) { if (tick > cur.until) return false; if (cur.side === sd) return false; const o = this.game.world.byId.get(cur.id); if (o && o.alive && o.controllable && o.aiTarget === t) { this.stats.sideTurnHold = (this.stats.sideTurnHold || 0) + 1; return true; } this._turn.delete(t.id); return false; }
    const L = this._sideLog.get(t.id);
    const run = this.turnRun ?? (this.r16Off || e.kind === 'boss' ? 2 : 1);
    if (!L || L.length < run || L.slice(-run).some((x) => x !== sd) || !this.openFlank(t, -sd)) return false;
    const tk = this.ai.tokens;
    let best = null, bc = Infinity;
    for (const o of this.engaged()) {
      if (o === e || o.aiTarget !== t || !o.controllable || !o.brain || !o.fsm || !o.fsm.is('idle', 'walk', 'pause') || ((this.r16Off || e.kind === 'boss') && tk && tk.has(o)) || o.aiCoX != null) continue;
      const dx = (o.pos.x - t.pos.x) * -sd, dz = Math.abs(o.pos.z - t.pos.z);
      if (dx < 0.8 || dx > 5.2 || dz > 2.8 || offFrame(this.game, o, 0.5)) continue;
      const c = dx + dz;
      if (c < bc) { bc = c; best = o; }
    }
    if (!best) return false;
    this._turn.set(t.id, { side: -sd, id: best.id, until: tick + (this.turnT ?? 90) });
    if ((best.brain.cooldown ?? 0) > 2) best.brain.cooldown = 2;
    this.stats.sideTurn = (this.stats.sideTurn || 0) + 1;
    return true;
  }
  /** Strike budget: minimum ticks between enemy attack starts on one hero (a punish window halves it). Passing the
   *  striker `e` also applies the elite concurrency cap (so token-free specials — dashes, leaps — obey it too). */
  canStrike(t, punish = false, e = null) {
    if (!t) return false;
    const last = this.lastStrike.get(t.id) || { tick: -9999, w: 1 };
    // Damage-rate governor: over budget → the gap stretches (up to ×3); a punish window no longer halves it.
    const h = this.heat(t), gov = h > 1 ? Math.min(3, h * h) : 1;
    // A heavy hitter's swing (knight, ogre: def.strikeWeight) buys the hero a longer breather before the next one.
    // r4: surround makes back-side strikes common; an elite striking from behind the hero waits a little longer
    // (flanking stays a threat, but a pincer of heavies doesn't turn into free back hits).
    const behind = e && Math.sign(e.pos.x - t.pos.x) === -(t.facing || 1);
    const back = behind && this.isElite(e) ? 1.35 : behind && this._nh > 1 && !this.v15Bal ? this.coBack ?? 1.2 : 1; // C2 r16: co-op flanks hold (more back strikes) → every back strike waits a little longer (2P pace)
    // r8: co-op has two heroes soaking the crowd (twice the attack starts at the same per-hero gap): a wider gap keeps a 2P run in budget
    const gap = this.cfg.strikeGap * (this._nh > 1 ? 1.2 : 1) * last.w * gov * back * (punish && h <= 1 ? 0.5 : 1) * (1 - Math.min(0.3, this.pressure(t) / 120));
    // C2 r2: a foe that has not attacked yet and is due (FIRST_DUE) only waits out a short gap (the heat ceiling still holds)
    const first = e && e.aiOverdue && !e.aiHasAtk && !this.noFirstDue ? Math.min(gap, this.firstGap ?? FIRST_GAP) : gap;
    if (this.game.tick - last.tick < first) return false;
    // A starved tank's reserved strike: everybody else holds their swing until it commits (or the hold lapses).
    const r = this._reserve.get(t.id);
    if (r && e && r.id !== e.id) {
      const o = this.game.world.byId.get(r.id);
      // C2 r3: two overdue first-timers of one wave: the first one's reservation no longer holds the other at its strike spot
      // (board r12 trace: 110 ticks) — only a starved TANK's reservation does
      const firstOk = first < gap && o && !this.isTank(o) && !this.noFirstDue;
      const live = o && o.alive && !o.removed && this.game.tick < r.until && !(o.fsm && o.fsm.tagged && o.fsm.tagged('stunned'));
      if (live && !firstOk) return false;
      if (!live) this._reserve.delete(t.id);
    }
    // Hard ceiling: well over the damage budget → nobody starts a new strike on this hero until the heat vents.
    if (h >= HEAT_CEIL) { this.stats.heatHolds = (this.stats.heatHolds || 0) + 1; return false; }
    if (!this.r16Off && e && e.kind !== 'boss' && this.sideTurn(e, t)) return false; // a token already held on the busy flank must yield too
    if (e && this.isElite(e)) {
      let elites = 0;
      for (const o of this.swinging(t, e)) if (this.isElite(o)) elites++;
      if (elites >= this.cfg.eliteCap) return false;
    }
    return true;
  }
  stunLimit(e) { return this.cfg.stunLimit + (e && e.def && e.def.stunBonus ? e.def.stunBonus : 0); }
  group(name) { let g = this.groups.get(name); if (!g) this.groups.set(name, (g = { members: [] })); return g; }

  targetFor(e) {
    const t = e.aiTarget;
    if (t && t.alive && !t.removed && !(t.fsm && t.fsm.is('dead'))) return t;
    const hs = this.heroes();
    if (!hs.length) return null;
    let best = hs[0], bd = Infinity;
    for (const h of hs) { const d = Math.abs(h.pos.x - e.pos.x) + Math.abs(h.pos.z - e.pos.z) * 0.5; if (d < bd) { bd = d; best = h; } }
    e.aiTarget = best;
    return best;
  }

  slotFor(e) { return e.aiSlot || { side: Math.sign(e.pos.x - (e.aiTarget ? e.aiTarget.pos.x : 0)) || 1, dz: 0, ring: 1 }; }

  /** r8 depth rows for hero h. The hero's own row `m` is where the strikers stand; the two WAITING rows `a` / `b` use
   *  the whole walkable band: with room on both sides they sit at the band's back and front edges (≥ 2 m from the
   *  hero row, ~4.5 m from each other in stage 1), so a crowd of eight stands in three bands on screen instead of one
   *  conga line. A hero at the near/far edge of the band gets both rows on the roomy side (a nearer, b at the far
   *  edge). Rows are absolute z (they don't follow every hero step) slewed 0.4 m per assign when the layout changes.
   *  → { m: 0, a: dz, b: dz, az, bz }: dz relative to the hero (what slots store), az / bz the absolute row z. */
  rows(h) {
    if (!this.rowsV8 && !this.noRows) return this.freeRows(h);
    const band = this.game.world.band || { zMin: -3, zMax: 3 };
    const lo = band.zMin + 0.25, hi = band.zMax - 0.25, z = Math.max(lo, Math.min(hi, h.pos.z));
    const up = hi - z, dn = z - lo, T = this.rowMin ?? 1.0;
    const st = (this._rowSt = this._rowSt || new Map()).get(h.id) || { mode: 'both', a: z, b: z, init: false };
    // layout with hysteresis (±0.25 m): both = one row at each band edge, back / front = the hero hugs an edge, so
    // both rows go on the roomy side (a half-way, b at the far edge)
    let mode = st.mode;
    if (mode === 'both') { if (up < T) mode = 'back'; else if (dn < T) mode = 'front'; }
    else if (up >= T + 0.25 && dn >= T + 0.25) mode = 'both';
    else if (mode === 'back' && dn < T) mode = up > dn ? 'front' : 'back';
    else if (mode === 'front' && up < T) mode = dn > up ? 'back' : 'front';
    let a, b;
    if (this.noRows) { a = z + 1.1; b = z - 1.1; } // A/B: r7 layout (±1.1 m)
    else if (mode === 'both') { a = hi; b = lo; }
    else if (mode === 'back') { b = lo; a = z - Math.max(1.5, dn / 2); }
    else { b = hi; a = z + Math.max(1.5, up / 2); }
    if (!st.init) { st.a = a; st.b = b; st.init = true; }
    else { st.a += Math.max(-0.4, Math.min(0.4, a - st.a)); st.b += Math.max(-0.4, Math.min(0.4, b - st.b)); }
    st.mode = mode; st.tick = this.game.tick;
    this._rowSt.set(h.id, st);
    return { m: 0, a: st.a - h.pos.z, b: st.b - h.pos.z, az: st.a, bz: st.b };
  }

  /** c1r9 SHARED FREE ROWS (replaces the per-hero layout above; director.rowsV8 = true restores it). The two waiting
   *  rows are the depths farthest from EVERY hero's strike row (max-min over the walkable band, 0.1 m grid): one hero at
   *  mid-band → both band edges (as r8); a hero off-centre → the far edge + half-way (three bands ≥ 1.6 m apart instead
   *  of a row 1 m from the hero that smears into its band); co-op → rows clear of BOTH heroes' strike rows (critic r8:
   *  each hero's waiting row landed ~1 m from the other hero's row, the whole co-op crowd read as one band). A second
   *  row that can't clear every hero row by ROWMIN goes to a band edge (an edge row never bridges two bands). Rows are
   *  absolute z shared by all heroes, kept stable (0.3 m preference for the current rows) and slewed 0.4 m per assign. */
  freeRows(h) {
    const g = this.game;
    let st = this._free;
    if (!st || st.tick !== g.tick) {
      const band = g.world.band || { zMin: -3, zMax: 3 };
      const lo = band.zMin + 0.25, hi = band.zMax - 0.25, ROWMIN = this.rowMinFree ?? 1.6;
      const O = this.heroes().map((o) => Math.max(lo, Math.min(hi, o.pos.z)));
      const prev = st && st.init ? st : null;
      const dist = (z, extra) => { let d = Infinity; for (const o of O) d = Math.min(d, Math.abs(z - o)); for (const o of extra) d = Math.min(d, Math.abs(z - o)); return d; };
      const pick = (extra) => {
        let best = lo, bs = -Infinity;
        for (let z = lo; z <= hi + 1e-6; z += 0.1) {
          const sc = dist(z, extra) + (prev && (Math.abs(z - prev.a) < 0.35 || Math.abs(z - prev.b) < 0.35) ? 0.3 : 0);
          if (sc > bs) { bs = sc; best = z; }
        }
        return best;
      };
      let p1 = pick([]);
      // no depth clears every hero row by ROWMIN (co-op heroes spanning the band): a row between them would bridge the
      // two hero bands into one smear → both rows go to the band edges (an edge row at worst merges with one band)
      if (!this.noEdgeFallback && dist(p1, []) < ROWMIN) p1 = Math.abs(lo - (O.reduce((x, y) => x + y, 0) / O.length)) > Math.abs(hi - (O.reduce((x, y) => x + y, 0) / O.length)) ? lo : hi;
      let p2 = pick([p1]);
      if (dist(p2, [p1]) < ROWMIN) p2 = Math.abs(lo - p1) > Math.abs(hi - p1) ? lo : hi;
      // keep row identities (a stays a): the pairing nearest the current rows
      let a = Math.max(p1, p2), b = Math.min(p1, p2);
      // stability: every row move walks the waiters on it across the fight (co-op spacing: walkers through other bodies'
      // columns). Keep the current target rows while they still clear the heroes nearly as well as the new picks.
      if (prev && !this.noRowKeep) {
        const cl = (x, y) => Math.min(dist(x, [y]), dist(y, [x]));
        if (cl(prev.ta, prev.tb) >= Math.min(ROWMIN, cl(a, b)) - (this.rowKeep ?? 0.6) && dist(prev.ta, []) >= 0.9 && dist(prev.tb, []) >= 0.9) { a = prev.ta; b = prev.tb; }
        else this.stats.rowMoves = (this.stats.rowMoves || 0) + 1;
      }
      if (prev && Math.abs(b - prev.a) + Math.abs(a - prev.b) < Math.abs(a - prev.a) + Math.abs(b - prev.b)) { const t = a; a = b; b = t; }
      if (!prev) st = this._free = { a, b, init: true };
      else { st.a += Math.max(-0.4, Math.min(0.4, a - st.a)); st.b += Math.max(-0.4, Math.min(0.4, b - st.b)); }
      st.tick = g.tick; st.ta = a; st.tb = b;
    }
    (this._rowSt = this._rowSt || new Map()).set(h.id, { mode: 'free', a: st.a, b: st.b, tick: g.tick });
    return { m: 0, a: st.a - h.pos.z, b: st.b - h.pos.z, az: st.a, bz: st.b };
  }

  requestRetreat(e, t, ticks = 90) {
    if (!t || (e.aiCoX != null && !this.v15Bal)) return false; // C2 r16: the co-op crosser finishes its run first
    const r = this.retreats.get(t.id);
    if (r && r.id !== e.id && r.until > this.game.tick && this.game.world.byId.get(r.id)) return false;
    this.retreats.set(t.id, { id: e.id, until: this.game.tick + ticks });
    return true;
  }

  update() {
    const g = this.game;
    const hd = Math.exp(-1 / (60 * HEAT_TAU));
    for (const [k, v] of this._heat) { const n = v * hd; if (n < 0.2) this._heat.delete(k); else this._heat.set(k, n); }
    for (const [k, v] of this._pressure) { const n = v * 0.985; if (n < 0.5) this._pressure.delete(k); else this._pressure.set(k, n); }
    if (g.tick % 5 === 0) this._bossEncounter = g.world.query({ team: 'enemies' }).some(e => e.alive && e.kind === 'boss');
    if (g.tick % 15 === 0) this.assign();
    else if (g.tick % 5 === 0 && !this.v9Pack) {
      const es = this.engaged(), hs = this.heroes();
      if (!this.r16Off && !this.noCoSide && !this.noCoRebal && !this.v15Bal && hs.length > 1) this.coFlank(es, hs);
      this.lanes(es, hs);
    } // flank responsibility and waiting spots both follow moving heroes between full assignments
    this.separate();
    this.idleTrack();
    if (g.tick % 60 === 0) for (const id of this._want.keys()) { const o = g.world.byId.get(id); if (!o || !o.alive || o.removed) this._want.delete(id); }
    this.reactToThrows();
  }

  /** C2 r1 BODY SPACE — runs AFTER physics every tick (system 'ai.space', order 21), so it is the last word before the
   *  frame is drawn. In perspective-true screen x (sx), every pair of standing bodies whose silhouettes overlap in height
   *  (depth gap < SP_DZMAX) keeps a floor: foe–foe SP_EE (SP_EE_FAR when a band apart), foe–hero SP_EH. Heroes never move;
   *  a foe mid-swing barely moves, a reeling one a little, a waiter / walker most (it yields). A body is never slid out of
   *  the frame (the other one takes the push) and gets at most SP_STEP per tick, so a knockback into a waiter reads as a
   *  shove, not a teleport. A slid body's velocity into its neighbour is cancelled and e.aiPush = { t, dir } tells the kit
   *  not to walk straight back into it. director.noSpace = true turns it off (A/B). */
  space() {
    if (this.noSpace) return;
    const g = this.game, c = g.cameraRig && g.cameraRig.camera;
    if (!c) return;
    const k = (z) => this.sk(z);
    const tk = this.ai.tokens, B = [], V = c.position.constructor;
    c.updateMatrixWorld();
    const ff = !this.noFrameFloor, eIn = ff ? this.edgeFoe ?? EDGE_FOE : 0.5;
    if (ff) this.frameWall(g);
    if (!this.noHeroSpace) this.heroSpace(g, c);
    for (const a of g.world.actors) {
      if (a.removed || !a.alive || a.pos.y > 0.45 || a.kind === 'boss' || a.kind === 'mount') continue;
      const hero = a.kind === 'hero';
      if (!hero && a.team !== 'enemies') continue;
      if (a.fsm && a.fsm.is(...SP_NO)) continue;
      if (a.mountedOn || (hero && a.fsm && a.fsm.is('throw'))) continue; // riders move with their beast
      if (!hero && a.grabbedBy) continue;
      // C2 r3: a loot thief (def.passive) runs off-screen by design and is no fighter: the frame floor held it at the edge and the
      // pair floor then pinned a foe walking past it (board r12 probe: a token holder stuck 6 s behind a fleeing thief)
      if (!hero && a.def && a.def.passive && !this.thiefSpace) continue;
      const vr = viewRange(g, a.pos.z), s = this.sx(a.pos.x, a.pos.z);
      if (!hero && a.fsm && a.fsm.is('enter') && (a.pos.x < vr.xMin || a.pos.x > vr.xMax)) continue; // still walking in off-screen
      let w = 1, cap = this.spStep ?? SP_STEP;
      if (hero) { w = 0; cap = 0; }
      else if (a.fsm.is('attack')) { w = 0.2; cap = 0.025; }
      else if (a.fsm.is('hitstun', 'block')) { w = 0.55; cap = 0.04; }
      else if (a.fsm.is('pause')) w = 0.7;
      else if (a.aiCrossing && a.aiCo && !this.noCoSide) w = 0.3; // C2 r15: a planned foe going round its hero has right of way (waiters yield)
      else if ((tk && tk.has(a)) || (a.brain && a.brain.mode === 'attack')) w = 0.45;
      // silhouette height on screen (NDC y of feet and head): two bodies interact only while their silhouettes overlap
      const ft = new V(a.pos.x, a.pos.y, a.pos.z).project(c).y, hd = new V(a.pos.x, a.pos.y + (a.height || 1.8), a.pos.z).project(c).y;
      B.push({ a, hero, w, cap, s, z: a.pos.z, k: k(a.pos.z), lo: this.sx(vr.xMin + (hero ? 0.5 : eIn), a.pos.z), hi: this.sx(vr.xMax - (hero ? 0.5 : eIn), a.pos.z), moved: 0, em: 0, y0: ft, y1: hd });
    }
    // C2 r2 FRAME FLOOR: a standing / reeling foe whose body centre is within EDGE_FOE of the frame edge (or past it) is
    // slid back in (walkers fastest, a swinger barely); the pair floor below then never pushes it back out
    if (ff) for (const b of B) {
      if (b.hero) continue;
      const f = b.a.fsm, capE = f.is('attack') ? 0.03 : f.is('hitstun', 'block') ? 0.06 : 0.075;
      const m = b.s < b.lo ? Math.min(capE, b.lo - b.s) : b.s > b.hi ? -Math.min(capE, b.s - b.hi) : 0;
      if (m) { b.s += m; b.em = Math.abs(m); b.dir = Math.sign(m); this.stats.edgeFloor = (this.stats.edgeFloor || 0) + 1; }
    }
    if (B.length < 2) { for (const b of B) if (b.em) this.unslide(b, g); return; }
    let pushes = 0;
    for (let it = 0, nIt = this.spIters ?? 10; it < nIt; it++) {
      let any = false;
      for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
        const p = B[i], q = B[j];
        if (p.hero && q.hero) continue;
        const dz = Math.abs(p.z - q.z);
        // C2 r1: the pair test is the on-screen silhouette overlap (≥ SP_VOV of the shorter body's height), not a depth gap:
        // at this camera two upright bodies 4.5 m apart in depth still cover half of each other (probe: dz 2.5–4.5 m pairs)
        const vov = (Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0)) / Math.max(1e-6, Math.min(p.y1 - p.y0, q.y1 - q.y0));
        if (this.dzPairs ? dz >= SP_DZMAX : vov < (this.spVov ?? SP_VOV)) continue;
        const eh = p.hero || q.hero;
        if (!eh && dz >= SP_DZ && (p.a.aiDeep != null || q.a.aiDeep != null)) continue; // C2 r3: a spread-in entrant passes behind / in front
        if (!eh && dz >= (this.coPassDz ?? SP_DZ) && !this.noCoSide && !this.noCoPass && ((p.a.aiCrossing && p.a.aiCo) || (q.a.aiCrossing && q.a.aiCo))) continue; // C2 r15: …so does a planned foe going round its hero
        let needM = dz < SP_DZ ? SP_EE : SP_EE_FAR;
        if (eh) {
          const e = p.hero ? q.a : p.a, h = p.hero ? p.a : q.a;
          if (e.fsm.is('clinch', 'hitstun') || (h.fsm && h.fsm.is('grabbed', 'clinch'))) continue; // a foe reeling from the hero's string: the combo owns that spacing
          // a band off the hero's row only WAITERS keep clear of his column (a waiter parked behind him hides his torso); an
          // attacker going round behind / in front of him (depth detour) must pass it
          // C2 r2 OFF-ROW FLOOR: …and every other standing foe (a token holder walking in, a reeling foe, a swinger) keeps
          // SP_EH_FAR off his column: the board's 'foe within 0.6 m of a hero' was mostly these (a hero walking past a foe on
          // another row, the partner's attacker a band behind him). Detours round him (aiCrossing / squeezed) still pass.
          let far = false;
          if (dz >= (this.spDzEH ?? SP_DZ_EH) && (e.aiCrossing || e.aiDeep != null || (tk && tk.has(e)) || !e.brain || e.brain.mode !== 'circle' || (e.aiSqueeze != null && g.tick - e.aiSqueeze < 40))) {
            if (this.noEhFar || e.aiCrossing || e.aiDeep != null || !e.brain || (e.aiSqueeze != null && g.tick - e.aiSqueeze < 40)) continue;
            far = true;
          }
          // the HERO pressing in (walking into the foe, or lunging in a move) is held by ordinary body contact, not a shove
          const press = (h.fsm && h.fsm.is('attack', 'run')) || (h.vel && h.vel.x * Math.sign(e.pos.x - h.pos.x) > 0.4);
          needM = far ? this.spEhFar ?? SP_EH_FAR : press ? SP_EH_PRESS : SP_EH;
        }
        const need = needM * (p.k + q.k) / 2;
        const d = q.s - p.s, ad = Math.abs(d);
        if (ad >= need - 1e-4) continue;
        // direction: apart along screen x; a dead-even pair splits by which side of its hero each one stands on, then id
        let dir = Math.sign(d);
        if (!dir) { const ht = q.a.aiTarget; dir = ht ? Math.sign(q.a.pos.x - ht.pos.x) || (p.a.id < q.a.id ? 1 : -1) : (p.a.id < q.a.id ? 1 : -1); }
        // a hero running / dashing into a foe moves ~0.08 m a tick: the foe may then slide that fast (else it ends up inside him)
        const hv = eh ? (() => { const h = p.hero ? p.a : q.a; return h.vel ? Math.abs(h.vel.x) / 60 : 0; })() : 0;
        const room = (b, sgn) => (b.hero ? 0 : Math.max(0, Math.min(Math.max(b.cap, eh ? hv + 0.01 : 0) - b.moved, sgn > 0 ? b.hi - b.s : b.s - b.lo)));
        const rp = room(p, -dir), rq = room(q, dir);
        let over = need - ad, sp = p.w / Math.max(1e-6, p.w + q.w);
        // C2 r2 SQUEEZE: a foe between the frame floor and a hero on his row can't make room in x → it leaves his row in depth
        if (eh && ff) { const fb = p.hero ? q : p, fd = p.hero ? dir : -dir, fr = fd > 0 ? fb.hi - fb.s : fb.s - fb.lo; if (fr < over - 0.02) fb.sq = p.hero ? p.a : q.a; }
        // …and two foes pressed together against the frame floor (one walking out to the edge, one mid-swing there): the one at
        // the floor that can't make the room steps off the other's row in depth too — OFF by default (director.ffSqueeze = true turns it on; C2 r13 A/B: it held foes 8–15 s in control before a first swing, ee08 no better)
        else if (!eh && ff && !this.noSqueeze && this.ffSqueeze && dz < SP_DZ && rp + rq < over - 0.02) { const pAt = (dir > 0 ? p.s - p.lo : p.hi - p.s) < 0.05, qAt = (dir > 0 ? q.hi - q.s : q.s - q.lo) < 0.05, fb = pAt ? p : qAt ? q : null; if (fb && !fb.sq && !fb.a.fsm.is('attack')) fb.sq = fb === p ? q.a : p.a; }
        if (rp + rq <= 1e-5) continue;
        let mp = Math.min(rp, over * sp), mq = Math.min(rq, over - mp);
        if (mq < over - mp - 1e-6) mp = Math.min(rp, over - mq); // q is stuck (frame edge / cap): p takes the rest
        if (mp > 0) { p.s -= dir * mp; p.moved += mp; p.dir = -dir; }
        if (mq > 0) { q.s += dir * mq; q.moved += mq; q.dir = dir; }
        any = true; pushes++;
      }
      if (!any) break;
    }
    for (const b of B) {
      if (b.hero) continue;
      if (b.sq && !this.noSqueeze) this.squeeze(b, g);
      if (b.moved || b.em) this.unslide(b, g);
    }
    if (pushes) this.stats.spacePush = (this.stats.spacePush || 0) + pushes;
  }
  /** write a slid body back (screen x → world x at its depth); its velocity into the neighbour / the frame edge is cancelled */
  unslide(b, g) {
    const a = b.a;
    a.pos.x = this.unsx(b.s, a.pos.z);
    if (a.vel && Math.sign(a.vel.x) === -b.dir) a.vel.x = 0; // walking into the neighbour: stop pressing
    a.aiPush = { t: g.tick, dir: b.dir };
  }
  /** C2 r2: foe b is pinned between the frame floor and hero b.sq on his row → it steps off his row in depth (the hero
   *  floor no longer holds it there, the frame floor then eases it round to the inner side; the kit walks it round). */
  squeeze(b, g) {
    const a = b.a, h = b.sq, band = g.world.band || { zMin: -3, zMax: 3 };
    if (a.fsm.is('attack')) return;
    let sg = Math.sign(a.pos.z - h.pos.z);
    if (!sg) sg = band.zMax - h.pos.z > h.pos.z - band.zMin ? 1 : -1;
    const z = Math.max(band.zMin + 0.2, Math.min(band.zMax - 0.2, a.pos.z + sg * 0.05));
    if (Math.abs(z - a.pos.z) < 0.005) { sg = -sg; } else a.pos.z = z;
    a.aiSqueeze = g.tick; a.aiSqueezeH = h.id; a.aiSqueezeZ = sg;
    this.stats.squeeze = (this.stats.squeeze || 0) + 1;
  }
  /** C2 r2: knockback / throw flights meet an invisible wall EDGE_WALL inside the frame (bounce ×0.25); bodies on the floor
   *  (down / getting up / skeleton bones) are eased in. Walk-ins, grabbed bodies, riders and bosses are left alone. */
  frameWall(g) {
    for (const a of g.world.actors) {
      if (a.removed || !a.alive || a.team !== 'enemies' || a.kind === 'boss' || a.kind === 'mount' || a.mountedOn || a.grabbedBy || !a.fsm || a.typeId === 'thief') continue;
      if (!a.fsm.is('knockdown', 'thrown', 'down', 'getup', 'reform', 'bones')) continue;
      const vr = viewRange(g, a.pos.z), air = a.fsm.is('knockdown', 'thrown'), W = this.edgeWall ?? EDGE_WALL;
      const lo = vr.xMin + W, hi = vr.xMax - W, cap = air ? 0.14 : 0.02;
      let m = 0;
      if (a.pos.x < lo) { m = Math.min(cap, lo - a.pos.x); if (a.vel && a.vel.x < 0) a.vel.x = air ? -a.vel.x * 0.25 : 0; }
      else if (a.pos.x > hi) { m = -Math.min(cap, a.pos.x - hi); if (a.vel && a.vel.x > 0) a.vel.x = air ? -a.vel.x * 0.25 : 0; }
      if (m) { a.pos.x += m; this.stats.frameWall = (this.stats.frameWall || 0) + 1; }
    }
  }
  /** C2 r2 HERO SPACE (board r11: "Seraphine lands on Brann, Brann stands on Gorrim"): two standing heroes whose silhouettes
   *  overlap on screen keep SP_HH apart in screen x — a soft push of SP_HH_STEP per tick each (≈ 1.5 m/s: a human
   *  player walks through it if they insist; moves, jumps, throws and grabs are never pushed). director.noHeroSpace: off. */
  heroSpace(g, c) {
    const V = c.position.constructor, free = (h) => h.pos.y < 0.05 && !h.mountedOn && h.fsm && h.fsm.is('idle', 'walk', 'run', 'block');
    const hs = g.world.query({ kind: 'hero' }).filter((h) => h.alive && !h.removed && free(h));
    if (hs.length < 2) return;
    const sc = g.world.screen || { xMin: -Infinity, xMax: Infinity };
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
      const p = hs[i], q = hs[j];
      const yp0 = new V(p.pos.x, 0, p.pos.z).project(c).y, yp1 = new V(p.pos.x, p.height || 1.8, p.pos.z).project(c).y;
      const yq0 = new V(q.pos.x, 0, q.pos.z).project(c).y, yq1 = new V(q.pos.x, q.height || 1.8, q.pos.z).project(c).y;
      const vov = (Math.min(yp1, yq1) - Math.max(yp0, yq0)) / Math.max(1e-6, Math.min(yp1 - yp0, yq1 - yq0));
      if (vov < SP_VOV) continue;
      const sp = this.sx(p.pos.x, p.pos.z), sq = this.sx(q.pos.x, q.pos.z), d = sq - sp, need = (this.spHH ?? SP_HH) * (this.sk(p.pos.z) + this.sk(q.pos.z)) / 2;
      if (Math.abs(d) >= need) continue;
      const dir = Math.sign(d) || (p.id < q.id ? 1 : -1), m = Math.min(this.spHHStep ?? SP_HH_STEP, (need - Math.abs(d)) / 2);
      const mv = (h, s) => { const nx = Math.max(sc.xMin, Math.min(sc.xMax, h.pos.x + s * m)); const got = Math.abs(nx - h.pos.x); h.pos.x = nx; return got; };
      if (mv(p, -dir) < m * 0.5) mv(q, dir); // p against the frame: q takes the push
      if (mv(q, dir) < m * 0.5) mv(p, -dir);
      this.stats.heroSpace = (this.stats.heroSpace || 0) + 1;
    }
  }

  /** C2 r1 IDLE CAP bookkeeping (every tick): e.aiIdleT = visible ticks in control since its last attack start, e.aiIdleA =
   *  …since its last action of any kind (attack, feint / menace / taunt pause). Over OVERDUE → e.aiOverdue (priority). */
  idleTrack() {
    if (this.noIdleCap) return;
    const g = this.game;
    for (const e of this.engaged()) {
      if (!e.brain || !e.brain.P || !e.fsm) continue;
      if (e.aiDeep != null && !e.fsm.is('enter')) e.aiDeep = null; // C2 r3 spread-in walk done
      if (e.fsm.is('attack')) { e.aiIdleA = 0; e.aiIdleT = 0; e.aiHasAtk = true; if (e.aiOverdue) { e.aiOverdue = false; this.stats.overdueServed = (this.stats.overdueServed || 0) + 1; } continue; }
      // C2 r2 TIME TO FIRST ATTACK (board r11: 12.3–19.8 s from first sight to the first swing — the idle cap only counted
      // idle / walk ticks, a foe being hit or detouring never got due): FIRST_DUE ticks after it first stands fully in
      // frame, a foe that has never attacked gets the overdue priority whatever it has been doing.
      if (e.aiSeen == null && !e.fsm.is('enter', 'rise', 'bones', 'reform') && !offFrame(g, e, 0.6)) e.aiSeen = g.tick;
      if (!this.noFirstDue && !e.aiHasAtk && !e.aiOverdue && e.aiSeen != null && g.tick - e.aiSeen > (this.firstDue ?? (this.r16Off ? FIRST_DUE : 60))) { e.aiOverdue = true; this.stats.firstDue = (this.stats.firstDue || 0) + 1; }
      if (e.fsm.is('pause')) { e.aiIdleA = 0; continue; }
      if (!e.controllable || e.fsm.is('enter')) continue;
      const vr = viewRange(g, e.pos.z);
      if (e.pos.x < vr.xMin + 0.5 || e.pos.x > vr.xMax - 0.5) continue;
      e.aiIdleA = (e.aiIdleA || 0) + 1;
      e.aiIdleT = (e.aiIdleT || 0) + 1;
      if (!e.aiOverdue && e.aiIdleT > (this.overdueT ?? OVERDUE)) { e.aiOverdue = true; this.stats.overdue = (this.stats.overdue || 0) + 1; }
    }
  }
  /** Ticks without any visible action after which waiter e makes a menace move (per-foe jitter so a crowd doesn't pulse). */
  menaceDue(e) { return !this.noIdleCap && (e.aiCoX == null || !!this.v15Bal) && (e.aiIdleA || 0) > (this.menaceT ?? MENACE) + ((e.id * 37) % 50); }

  /** C2 r1: a hero's pinned side — -1 / +1 when its screen centre is within PIN of the frame width from the left / right
   *  edge (camera projection, the same test the stage probe makes), else 0. */
  pinnedSide(t, P = this.pin ?? PIN) {
    const vr = viewRange(this.game, t.pos.z), w = vr.xMax - vr.xMin;
    if (!(w > 1)) return 0;
    const f = (t.pos.x - vr.xMin) / w;
    return f < P ? -1 : f > 1 - P ? 1 : 0;
  }
  /** C2 r1 (Enemy.attackWith hook): may e start a move on t from where it stands? Not with its body centre < STRIKE_IN m
   *  inside the frame (half cut off), and not from the OUTER side of a hero pinned at the frame edge. Bosses exempt. */
  attackVeto(e, t, chain = false) {
    if (this.noVeto || !e || e.kind === 'boss' || !e.brain || !e.brain.P) return false;
    const vr = viewRange(this.game, e.pos.z), sIn = this.v11Veto ? STRIKE_IN : STRIKE_IN2;
    if (e.pos.x < vr.xMin + sIn || e.pos.x > vr.xMax - sIn) { this.stats.vetoEdge = (this.stats.vetoEdge || 0) + 1; if (chain) this.stats.vetoChain = (this.stats.vetoChain || 0) + 1; return true; }
    if (t && t.kind === 'hero') {
      const ps = this.pinExempt(e, t) ? 0 : this.pinnedSide(t, this.v11Veto ? PIN : this.pinVeto ?? PIN_VETO);
      if (ps && Math.sign(e.pos.x - t.pos.x) === ps && Math.abs(e.pos.x - t.pos.x) < 4.5) { this.stats.vetoPinned = (this.stats.vetoPinned || 0) + 1; if (chain) this.stats.vetoChain = (this.stats.vetoChain || 0) + 1; return true; }
    }
    return false;
  }
  /** C2 r2: may e still fight pinned hero t from his outer side? r11 let any overdue foe or a foe whose detour failed do it
   *  (board: all 7 stage-2 outer attacks). Now never against a bot-driven hero (the bot steps inward instead, heroBot), and
   *  against a human only after a failed detour / when overdue AND with its whole body ≥ 1.4 m inside the frame. */
  pinExempt(e, t) {
    if (this.v11Veto) return this.starved(e) || (e.aiRoundFail != null && this.game.tick - e.aiRoundFail < 300);
    if (!t || t.aiBot) return false;
    if (!(this.starved(e) || (e.aiRoundFail != null && this.game.tick - e.aiRoundFail < 300))) return false;
    const vr = viewRange(this.game, e.pos.z);
    return e.pos.x > vr.xMin + 1.4 && e.pos.x < vr.xMax - 1.4;
  }

  /** Hard spacing constraint: no two grounded foes closer than SEP m. The one mid-swing holds its ground. */
  separate() {
    const list = this.game.world.query({ team: 'enemies' }).filter((e) => e.kind !== 'boss' && e.solid !== false && e.pos.y < 0.6 && !(e.fsm && e.fsm.is(...NOPUSH)));
    let minD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        // Depth counts for less (DZW < 1) so two foes need extra room in depth: depth-stacked foes overlap on screen.
        let dx = b.pos.x - a.pos.x, dz = (b.pos.z - a.pos.z) * DZW;
        let d = Math.hypot(dx, dz);
        if (d >= SEP) continue;
        if (d < 1e-4) { dx = a.id < b.id ? 0.01 : -0.01; dz = 0.005; d = Math.hypot(dx, dz); }
        const nx = dx / d, nz = dz / d, fix = (SEP - d) * (d < 0.75 ? 0.9 : 0.55); // deep overlap (knocked into a mate): resolve fast
        const aa = a.fsm && a.fsm.is('attack'), ba = b.fsm && b.fsm.is('attack');
        let wa = (b.mass || 1) / ((a.mass || 1) + (b.mass || 1));
        if (aa && !ba) wa = 0.1; else if (ba && !aa) wa = 0.9;
        a.pos.x -= nx * fix * wa; a.pos.z -= nz * fix * wa / DZW;
        b.pos.x += nx * fix * (1 - wa); b.pos.z += nz * fix * (1 - wa) / DZW;
        if (d < minD) minD = d;
      }
    }
    // Screen-x lanes (r5): soft push apart in x for visible pairs sharing a column at different depths. Whoever is
    // swinging / holding a token (or nearer its hero) keeps the lane; the other yields outward from its hero.
    const tk = this.ai.tokens;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const adx = Math.abs(this.sx(b.pos.x, b.pos.z) - this.sx(a.pos.x, a.pos.z)), adz = Math.abs(b.pos.z - a.pos.z);
        if (adx >= XSEP || adz >= ZVIS || adz < 0.35) continue; // same-depth overlaps are the euclidean rule's job
        const pr = (o) => (o.fsm && o.fsm.is('attack') ? 2 : 0) + (tk && tk.has(o) ? 1 : 0);
        const pa = pr(a), pb = pr(b);
        let y = pb > pa ? a : pa > pb ? b : null;
        if (!y) { const ha = a.aiTarget || a.target, hb = b.aiTarget || b.target; y = (ha ? Math.abs(a.pos.x - ha.pos.x) : 0) >= (hb ? Math.abs(b.pos.x - hb.pos.x) : 0) ? a : b; }
        // Only a WAITING foe (circling, not crossing) is ever slid: pushing a walking attacker fights its own steering.
        // r6: a body knocked back (hitstun / knockdown) into the column of a walking attacker makes the attacker
        // side-step too (the reel passes in a beat; the fused silhouette is what the player sees).
        const reel = (o) => o.fsm && o.fsm.is('hitstun', 'knockdown');
        const busyB = (o, other) => !o.brain || !(SLIDE_MODES.includes(o.brain.mode) || (o.brain.mode === 'attack' && reel(other))) || o.aiCrossing || (o.fsm && o.fsm.is('attack', 'hitstun', 'knockdown', 'down', 'getup', 'block'));
        if (busyB(y, y === a ? b : a)) { const z = y === a ? b : a; if (busyB(z, y)) continue; y = z; } // never slide a reacting body: the other yields
        const o = y === a ? b : a, ht = y.aiTarget || y.target;
        let dir = Math.sign(y.pos.x - o.pos.x);
        if (ht && dir && Math.sign(y.pos.x - ht.pos.x) === -dir && Math.abs(y.pos.x - ht.pos.x) < 1.6) dir = -dir; // yield outward, not through the hero
        if (!dir) dir = ht ? Math.sign(y.pos.x - ht.pos.x) || 1 : 1;
        y.pos.x += dir * Math.min(reel(o) ? 0.06 : 0.035, (XSEP - adx) * (reel(o) ? 0.12 : 0.07));
        this.stats.xLanePush = (this.stats.xLanePush || 0) + 1;
      }
    }
    this.stats.minSep = Math.min(this.stats.minSep ?? Infinity, minD);
  }

  /** r5b: perspective-true screen x, in metres on the z = 0 plane. The camera is a perspective side view, so at the
   *  frame edges a body 2 m deeper sits ~0.8 m further toward the centre on screen: lanes must be judged here. */
  sx(x, z) {
    const c = this.game.cameraRig && this.game.cameraRig.camera;
    if (!c) return x;
    if (!this.flatSx) { const L = this._lin(z), L0 = this._lin(0); if (L && L0) return (L.a + L.b * x - L0.a) / L0.b; }
    const cz = c.position.z, d = cz - z;
    return d > 1 ? c.position.x + (x - c.position.x) * cz / d : x;
  }

  /** C2 r1: the camera's true projection of a body's CHEST (y = 1 m) at depth z is linear in x: ndc = a + b·x. The r5–c1r10
   *  sx() used the horizontal distance only (pitch ignored): at the frame edges two bodies a band apart in depth were off
   *  by up to ~0.2 m against what the player sees. Cached per tick per 5 cm of depth. director.flatSx = true: old model. */
  _lin(z) {
    const g = this.game, c = g.cameraRig && g.cameraRig.camera;
    if (!c || !c.projectionMatrix) return null;
    let L = this._linC;
    if (!L || L.tick !== g.tick || L.cam !== c) { c.updateMatrixWorld(); L = this._linC = { tick: g.tick, cam: c, m: new Map(), V: c.position.constructor }; }
    const key = Math.round(z * 20);
    let r = L.m.get(key);
    if (!r) {
      const zz = key / 20, x0 = c.position.x;
      const p0 = new L.V(x0, 1.0, zz).project(c).x, p1 = new L.V(x0 + 1, 1.0, zz).project(c).x, b = p1 - p0;
      r = Number.isFinite(b) && Math.abs(b) > 1e-5 ? { a: p0 - b * x0, b } : null;
      L.m.set(key, r);
    }
    return r;
  }
  /** screen metres per world metre of x at depth z (1 at z = 0). */
  sk(z) { if (!this.flatSx) { const L = this._lin(z), L0 = this._lin(0); if (L && L0) return L.b / L0.b; } const c = this.game.cameraRig && this.game.cameraRig.camera; return c ? c.position.z / Math.max(1, c.position.z - z) : 1; }

  /** c1r10 SCREEN-FREE WAIT SPOT for waiter e heading to (gx, gz) around hero t. In screen x (sx, any depth: under this
   *  camera a foe 2–3 m deeper still overlaps the nearer one's torso) every other standing body keeps ±FREE_R clear and
   *  every hero ±waitX (its strike column + the lane its struck foes reel into). The waiter never passes its nearest
   *  neighbour on either side: it walks toward its goal only inside the gap between them, steps back out when a neighbour
   *  closes in (a foe knocked back toward it, a hero walking up), and splits the difference when the gap is too tight.
   *  A reeling body counts where it will slide in the next ~0.3 s. → { x (world, at depth gz), esc (stepping clear) } */
  freeSpot(e, gx, gz, t) {
    const R = this.freeR ?? FREE_R, W = this.wx(), DZS = this.dzSep ?? DZ_SEP;
    const me = this.sx(e.pos.x, e.pos.z), goal = this.sx(gx, gz);
    const z0 = Math.min(e.pos.z, gz), z1 = Math.max(e.pos.z, gz), zd = (z) => (z < z0 ? z0 - z : z > z1 ? z - z1 : 0);
    const boxes = this.heroes().filter((h) => [[e.pos.x, e.pos.z], [gx, gz]].some(([x, z]) => Math.abs(x - h.pos.x) < BOX_X && Math.abs(z - h.pos.z) < BOX_Z));
    const shared = (x, z) => boxes.some((h) => Math.abs(x - h.pos.x) < BOX_X && Math.abs(z - h.pos.z) < BOX_Z);
    // two levels: body spacing (hard) and the heroes' bands (applied only where they fit inside the body gap — a waiter
    // squeezed between a hero walking up and its neighbour holds its body gap instead of pushing the whole row)
    const B = [-Infinity, Infinity], H = [-Infinity, Infinity];
    const add = (o, s0, s1, r, L) => {
      const left = Math.abs(s0 - me) > 0.04 ? s0 < me : o.pos.x < e.pos.x || (o.pos.x === e.pos.x && o.id < e.id);
      if (left) L[0] = Math.max(L[0], Math.max(s0, s1) + r); else L[1] = Math.min(L[1], Math.min(s0, s1) - r);
    };
    for (const o of this.game.world.query({ team: 'enemies' })) {
      if (o === e || o.removed || !o.alive || o.kind === 'boss' || o.pos.y > 1.2 || (o.fsm && o.fsm.is('dead', 'thrown', 'grabbed', 'clinch', 'bones'))) continue;
      if (o.fsm && o.fsm.is('enter') && offFrame(this.game, o, 0)) continue;
      const oh = o.aiTarget || o.target, oz2 = oh && oh.kind === 'hero' && Math.abs(oh.pos.x - o.pos.x) < 4.5 ? oh.pos.z : o.pos.z;
      if (zd(o.pos.z) >= DZS && zd(oz2) >= DZS && !shared(o.pos.x, o.pos.z)) continue; // c1r10: a body this far in depth from every depth e passes on its way (and from its hero's fight) is a separate silhouette
      const s0 = this.sx(o.pos.x, o.pos.z);
      const la = o.fsm && o.fsm.is('knockdown') ? this.downLook ?? 0.9 : 0.3, s1 = o.fsm && o.fsm.is('hitstun', 'knockdown') && o.vel ? this.sx(o.pos.x + (o.vel.x || 0) * la, o.pos.z + (o.vel.z || 0) * la) : s0;
      add(o, s0, s1, R + (o.fsm && o.fsm.is('down', 'knockdown', 'getup') ? this.downPad ?? 0.8 : 0), B);
    }
    for (const h of this.heroes()) { if (zd(h.pos.z) >= DZS) continue; const s0 = this.sx(h.pos.x, h.pos.z); add(h, s0, s0, W, H); }
    let a = B[0], b = B[1];
    if (a <= b) { const a2 = Math.max(a, H[0]), b2 = Math.min(b, H[1]); if (a2 <= b2) { a = a2; b = b2; } else if (H[0] > a && H[0] <= b) a = b; else if (H[1] < b && H[1] >= a) b = a; }
    const s = a <= b ? Math.max(a, Math.min(b, goal)) : (a + b) / 2;
    const esc = me < a - 0.02 || me > b + 0.02;
    if (this.debugCells) e.aiCell = [a, b, me, goal, s, B[0], B[1], H[0], H[1]]; // probe (director.debugCells)
    if (esc) this.stats.freeEsc = (this.stats.freeEsc || 0) + 1; else if (Math.abs(s - goal) > 0.05) this.stats.freeClamp = (this.stats.freeClamp || 0) + 1;
    return { x: this.unsx(s, gz), esc };
  }

  /** r6: inverse of sx — the world x at depth z that lands on screen x s. */
  unsx(s, z) {
    const c = this.game.cameraRig && this.game.cameraRig.camera;
    if (!c) return s;
    if (!this.flatSx) { const L = this._lin(z), L0 = this._lin(0); if (L && L0) return (L0.a + L0.b * s - L.a) / L.b; }
    const cz = c.position.z, d = cz - z;
    return d > 1 ? c.position.x + (s - c.position.x) * d / cz : s;
  }

  /** Soft steering: shift a movement goal away from nearby allies (so foes flow around each other, not into). */
  steer(e, gx, gz, waiting = false) {
    let sx = 0, sz = 0;
    for (const o of this.game.world.query({ team: 'enemies' })) {
      if (o === e || o.kind === 'boss' || o.pos.y > 0.8 || o.removed) continue;
      const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d = Math.hypot(dx, dz);
      if (d < STEER && d > 1e-4) {
        const k = (STEER - d) / STEER * 1.4;
        sx += dx / d * k; sz += dz / d * k;
      }
      // Screen-x lane (r5): judged at the GOAL, so a foe never plans to stand in an ally's column at any depth.
      const gdx = this.sx(gx, gz) - this.sx(o.pos.x, o.pos.z), gdz = gz - o.pos.z, agx = Math.abs(gdx);
      if (agx < XSEP && Math.abs(gdz) < ZVIS && !(o.fsm && o.fsm.is('dead'))) {
        const out = Math.sign(gdx) || Math.sign(e.pos.x - o.pos.x) || (e.id < o.id ? -1 : 1);
        sx += out * (XSEP - agx) * (Math.abs(gdz) < 1.2 ? 1.0 : 0.8);
      }
    }
    // Keep the goal out of every hero's own column (a body straight behind / in front of the hero hides both).
    const coX = e.aiCrossing && e.aiCo && !this.noCoSide && !this.noCoPass; // C2 r15: a planned foe going round its hero on a depth lane passes behind / in front of his column
    for (const h of this.heroes()) {
      if (coX && Math.abs(gz - h.pos.z) >= 1.2) continue;
      const hx = this.sx(gx + sx, gz) - this.sx(h.pos.x, h.pos.z);
      const hc = waiting ? this.wx() : HCOL; // r6: a waiting foe keeps out of the attackers' strike columns too
      if (Math.abs(hx) < hc && Math.abs(gz - h.pos.z) < ZVIS) sx += (Math.sign(hx) || Math.sign(e.pos.x - h.pos.x) || 1) * (hc - Math.abs(hx));
    }
    // c1r9: a waiting foe keeps to its depth row (row discipline: waiters stood ~1 m off their rows, the bands smeared);
    // ally avoidance acts mostly in x for it, the lane pass already spaced the waiting goals
    return { x: gx + sx, z: gz + sz * (waiting && !this.v8Steer ? this.waitSz ?? 0.35 : 1.2) };
  }

  /** Front row first (r5): a waiting ally nearer the hero on e's flank at another depth is about to attack, so e (which
   *  would walk through its screen column to get in) holds. */
  frontReady(e, t) {
    const ex = Math.abs(e.pos.x - t.pos.x), s = Math.sign(e.pos.x - t.pos.x), tk = this.ai.tokens;
    for (const o of this.engaged()) {
      if (o === e || o.aiTarget !== t || !o.brain || o.brain.mode !== 'circle' || (tk && tk.has(o))) continue;
      if (o.fsm && o.fsm.is(...NOPUSH, 'hitstun', 'down', 'getup', 'knockdown', 'attack')) continue;
      const ox = Math.abs(o.pos.x - t.pos.x);
      if (Math.sign(o.pos.x - t.pos.x) !== s || ox > ex - 0.5 || Math.abs(o.pos.z - e.pos.z) < 0.35) continue;
      if ((o.brain.cooldown ?? 99) <= 40) return true;
    }
    return false;
  }

  /** Front-row hand-over (r5): an attacker still walking in from an outer ring would pass through the screen column
   *  of a waiting ally nearer the hero at another depth. Returns that ally (if it hasn't swung for 2 s) so the kit
   *  can pass the turn to it instead. Starved tanks never hand over (r3 tank priority). */
  frontFoe(e, t) {
    if (this.noHandover || (this.starved(e))) return null;
    const ex = Math.abs(e.pos.x - t.pos.x), s = Math.sign(e.pos.x - t.pos.x), tk = this.ai.tokens, now = this.game.tick;
    let best = null, bx = Infinity;
    for (const o of this.engaged()) {
      if (o === e || o.aiTarget !== t || !o.brain || o.brain.mode !== 'circle' || (tk && tk.has(o)) || !o.controllable) continue;
      if (o.fsm && o.fsm.is(...NOPUSH, 'hitstun', 'down', 'getup', 'knockdown', 'attack', 'block')) continue;
      const ox = Math.abs(o.pos.x - t.pos.x);
      if (Math.sign(o.pos.x - t.pos.x) !== s || ox > ex - 0.5 || ox < 0.6 || Math.abs(o.pos.z - e.pos.z) < 0.35) continue;
      if (now - (this._lastGo.get(o.id) ?? -9999) < 120) continue;
      if (ox < bx) { bx = ox; best = o; }
    }
    return best;
  }

  /** A reeling body (hitstun / knockdown) in the x lane of (x, z) at another depth, between e and that spot? */
  reeling(e, x, z) {
    for (const o of this.game.world.query({ team: 'enemies' })) {
      if (o === e || o.removed || o.kind === 'boss' || !(o.fsm && o.fsm.is('hitstun', 'knockdown'))) continue;
      const adz = Math.abs(o.pos.z - z);
      if (Math.abs(this.sx(o.pos.x, o.pos.z) - this.sx(x, z)) < XSEP && adz < ZVIS && adz >= 0.35 && Math.abs(o.pos.x - e.pos.x) < Math.abs(x - e.pos.x) + XSEP) return true;
    }
    return false;
  }

  /** r5b entry lanes: a wave's foes all spawn at the same off-screen x, so without this they walk in single-column
   *  (one fused blob on screen). Gives an entering foe its own arrival x (≥ ENTRY_GAP from every other visible body's
   *  x / entry x, and out of the heroes' columns) and staggers its start further off-screen behind recent entrants on
   *  the same side. Mutates t (the enter target) and e.pos.x. */
  entryLane(e, t) {
    if (!t || !Number.isFinite(t.x) || this.noEntryLanes) return t;
    const g = this.game, z = t.z ?? e.pos.z;
    const vr = viewRange(g, z), mid = (vr.xMin + vr.xMax) / 2;
    let side = Math.sign(e.pos.x - mid) || 1, inward = -side;
    // Only generic off-screen walk-ins: scripted set-piece entrances (climbs over a wall, boss adds) keep their marks.
    if (e.kind === 'boss' || (e.pos.x > vr.xMin + 0.2 && e.pos.x < vr.xMax - 0.2)) return t;
    t.lane = true; // generic walk-in: the brain may take over as soon as it is well inside the frame
    // r7 arrival rhythm. (1) Vanguard: the first foe to arrive while nobody is on the hero goes straight at them
    // (brain rushes in with the token, no queueing) — a new wave engages within a beat instead of loitering at the
    // edge. If the hero stands at the far end of the frame, the vanguard comes in from the hero's side (GA: foes pour
    // in from both edges). (2) Everyone else joins a per-side arrival queue (0.55–0.95 s apart, whatever the asset
    // loader did: a stalled load releases a whole wave on one tick) with its own walk speed and gait phase.
    const now = g.tick, h = this.targetFor(e);
    const vOk = this._vanguard && this._vanguard.until > now && (() => { const o = g.world.byId.get(this._vanguard.id); return o && o.alive && !o.removed; })();
    let van = !!(h && e.brain && e.brain.P && !this.noVanguard && !vOk && !this.engagedOn(h, e));
    // r8 WING: the second arrival while the vanguard is fighting (critic r7: 2nd foe of a wave took 4.3–9.4 s to swing
    // and spectated) also goes straight in — token now, at a run, no plant-and-taunt — and enters from the OPPOSITE
    // edge when the hero is reachable from there (GA: foes pour in from both sides = a pincer), as long as a token is free.
    let wing = false;
    let cm = null;
    if (!van && h && e.brain && e.brain.P && !this.noWing && this.cfg.tokens >= 2) {
      const wOk = this._wing && this._wing.until > now && (() => { const o = g.world.byId.get(this._wing.id); return o && o.alive && !o.removed; })();
      cm = this.committed(h, e);
      if (!wOk && cm.length < this.cfg.tokens && (cm.length || vOk)) wing = true; // someone is fighting the hero (or the vanguard is on its way) and a token is free
    }
    if (wing) {
      const opp = -side, dOpp = opp > 0 ? vr.xMax - h.pos.x : h.pos.x - vr.xMin;
      if (!this.noFlip && dOpp < 12 && (this.noVeto || dOpp > (vr.xMax - vr.xMin) * 0.32) && (cm.some((o) => Math.sign(o.pos.x - h.pos.x) === side) || (this._vanguard && this._vanguard.side === side))) {
        const inset = side > 0 ? vr.xMax - t.x : t.x - vr.xMin, off = side > 0 ? e.pos.x - vr.xMax : vr.xMin - e.pos.x;
        side = opp; inward = -side;
        e.pos.x = side > 0 ? vr.xMax + off : vr.xMin - off;
        t.x = side > 0 ? vr.xMax - inset : vr.xMin + inset;
        e.setFacing(-side);
        this.stats.entryFlip = (this.stats.entryFlip || 0) + 1; this.stats.wingFlip = (this.stats.wingFlip || 0) + 1;
      }
      e.vanguard = now; this._wing = { id: e.id, until: now + 240 };
      const q = (this._entryQ = this._entryQ || {});
      t.run = true; t.spMul = 1.3; t.delay = Math.min(45, Math.max(0, (q[side] ?? -1e9) - now)); t.delay0 = t.delay;
      q[side] = Math.max(q[side] ?? -1e9, now + t.delay + this.game.rng.int(34, 56));
      this.stats.wings = (this.stats.wings || 0) + 1;
    }
    if (van) {
      // Another fighter already walking in on this side goes first (a vanguard spawned behind it would run through it).
      let lead = null, ld = Infinity;
      for (const o of g.world.query({ team: 'enemies' })) {
        if (o === e || o.removed || !o.alive || !o.brain || !o.brain.P || !(o.fsm && o.fsm.is('enter')) || !o.enterTarget || !o.enterTarget._laned || !o.enterTarget.lane || o.enterTarget.delay > 0 || o.vanguard) continue;
        if ((Math.sign(o.pos.x - mid) || 1) !== side) continue;
        const d = Math.abs(o.pos.x - mid); if (d < ld) { ld = d; lead = o; }
      }
      if (lead) {
        lead.vanguard = now; this._vanguard = { id: lead.id, until: now + 240, side };
        Object.assign(lead.enterTarget, { run: true, spMul: 1.45, _gait: false });
        this.stats.vanguards = (this.stats.vanguards || 0) + 1; this.stats.vanPromote = (this.stats.vanPromote || 0) + 1;
        van = false;
      }
    }
    if (van) {
      const far = side > 0 ? vr.xMax - h.pos.x : h.pos.x - vr.xMin, near = side > 0 ? h.pos.x - vr.xMin : vr.xMax - h.pos.x;
      if (!this.noFlip && far > 8 && near < far * 0.5 && (this.noVeto || near > (vr.xMax - vr.xMin) * 0.32)) { // C2 r1: never flip in on the outer side of a hero pinned near that edge
        const inset = side > 0 ? vr.xMax - t.x : t.x - vr.xMin, off = side > 0 ? e.pos.x - vr.xMax : vr.xMin - e.pos.x;
        side = -side; inward = -side;
        e.pos.x = side > 0 ? vr.xMax + off : vr.xMin - off;
        t.x = side > 0 ? vr.xMax - inset : vr.xMin + inset;
        e.setFacing(-side);
        this.stats.entryFlip = (this.stats.entryFlip || 0) + 1;
      }
      e.vanguard = now; this._vanguard = { id: e.id, until: now + 240, side };
      t.run = true; t.spMul = 1.45; t.delay = 0;
      const q = (this._entryQ = this._entryQ || {}); q[side] = Math.max(q[side] ?? -1e9, now + this.game.rng.int(34, 56));
      this.stats.vanguards = (this.stats.vanguards || 0) + 1;
    } else if (!wing) {
      // C2 r3 CO-OP PINCER (board r12: a wave walked in from one edge and stayed on one side of both heroes — flank.one2 69–100 %):
      // in co-op a generic walk-in enters from the edge with FEWER foes on its half of the frame (GA: foes pour in from both
      // sides), unless the hero nearest that edge stands within PIN_SIDE + 0.04 of it (he'd be fought from his outer side).
      // director.noPincer: off.
      if (this.noCoSide && !this.noPincer && !this.noFlip && this.heroes().length > 1 && e.brain && e.brain.P) {
        const n = { 1: 0, '-1': 0 };
        for (const o of this.engaged()) if (o !== e && o.kind !== 'mount') n[Math.sign(o.pos.x - mid) || 1]++;
        const opp = -side, w = vr.xMax - vr.xMin;
        const edgeHero = this.heroes().reduce((m, o) => Math.min(m, opp > 0 ? vr.xMax - o.pos.x : o.pos.x - vr.xMin), Infinity);
        if (n[side] > n[opp] && edgeHero > w * ((this.pinSide ?? PIN_SIDE) + 0.04)) {
          const inset = side > 0 ? vr.xMax - t.x : t.x - vr.xMin, off = side > 0 ? e.pos.x - vr.xMax : vr.xMin - e.pos.x;
          side = opp; inward = -side;
          e.pos.x = side > 0 ? vr.xMax + off : vr.xMin - off;
          t.x = side > 0 ? vr.xMax - inset : vr.xMin + inset;
          e.setFacing(-side);
          this.stats.entryFlip = (this.stats.entryFlip || 0) + 1; this.stats.pincer = (this.stats.pincer || 0) + 1;
        }
      }
      const q = (this._entryQ = this._entryQ || {});
      const delay = Math.max(0, (q[side] ?? -1e9) - now);
      q[side] = now + delay + this.game.rng.int(34, 56);
      t.delay = delay; t.delay0 = delay; t.spMul = this.game.rng.range(0.86, 1.1);
      if (delay) this.stats.entryDelay = (this.stats.entryDelay || 0) + 1;
    }
    // C2 r15 CO-OP FLANK PLAN (coPick): the slot picks the entry edge here (an unseen swap while off-screen); a slot past a hero
    // gets its depth lane below, after the generic x / depth fan-out.
    let co = null;
    if (!this.noCoSide && e.brain && e.brain.P && !t.fixed && e.kind !== 'mount' && this.heroes().length > 1) {
      this._coDbg = []; co = this.coPick(e, t, vr, z);
      if (co) {
        if (co.flip) {
          const inset = side > 0 ? vr.xMax - t.x : t.x - vr.xMin, off = side > 0 ? e.pos.x - vr.xMax : vr.xMin - e.pos.x;
          side = -side; inward = -side;
          e.pos.x = side > 0 ? vr.xMax + off : vr.xMin - off;
          t.x = side > 0 ? vr.xMax - inset : vr.xMin + inset;
          e.setFacing(-side);
          if (this._vanguard && this._vanguard.id === e.id) this._vanguard.side = side;
          this.stats.coFlip = (this.stats.coFlip || 0) + 1;
        }
        if (co.deep == null && Math.sign(t.x - co.h.pos.x) !== co.side) t.x = co.gx; // a walk-in aimed past its hero stops on its side
        e.aiTarget = co.h; e.aiCo = { h: co.h.id, side: co.side, t: now };
        this.stats.coPick = (this.stats.coPick || 0) + 1;
        if ((this.stats.coLog = this.stats.coLog || []).length < 40) this.stats.coLog.push([now, e.id, e.typeId, co.h.id, co.side, co.flip ? 1 : 0, co.deep != null ? +co.deep.toFixed(1) : null, +co.cost.toFixed(2), co.n, +((co.h.pos.x - vr.xMin) / (vr.xMax - vr.xMin)).toFixed(2), this._coDbg.join(','), +(vr.xMax - vr.xMin).toFixed(1)]); this._coDbg = null; // diagnostics
      } else this.stats.coNone = (this.stats.coNone || 0) + 1;
    }
    const xs = [];
    for (const o of g.world.query({ team: 'enemies' })) {
      if (o === e || o.removed || !o.alive || o.pos.y > 0.8) continue;
      const oz = o.enterTarget && o.fsm && o.fsm.is('enter') ? (o.enterTarget.z ?? o.pos.z) : o.pos.z;
      if (Math.abs(oz - z) >= ZVIS) continue;
      xs.push({ x: this.sx(o.fsm && o.fsm.is('enter') && o.enterTarget ? o.enterTarget.x : o.pos.x, oz), gap: ENTRY_GAP });
    }
    for (const h of this.heroes()) xs.push({ x: this.sx(h.pos.x, h.pos.z), gap: 1.2 });
    const lo = vr.xMin + 0.9, hi = vr.xMax - 0.9;
    const clampV = (x) => Math.max(lo, Math.min(hi, x));
    const score = (x) => { let m = Infinity; const px = this.sx(x, z); for (const o of xs) m = Math.min(m, Math.abs(o.x - px) - o.gap); return m; };
    let best = clampV(t.x), bs = score(best);
    for (let k = 1; k <= 8 && bs < 0; k++) {
      for (const dir of [inward, side]) {
        const x = clampV(t.x + dir * k * 0.55);
        const s = score(x) - (dir === side ? 0.15 : 0); // prefer stepping further in over hugging the frame edge
        if (s > bs) { bs = s; best = x; }
      }
    }
    t.x = best;
    // Depth lane: entrants arriving together fan out in depth too (a wave reads as a staggered formation, not a
    // conga line at one depth).
    const band = g.world.band || { zMin: -3, zMax: 3 };
    const near = [];
    for (const o of g.world.query({ team: 'enemies' })) {
      if (o === e || o.removed || !o.alive || o.kind === 'boss' || o.pos.y > 0.8) continue;
      const en = o.fsm && o.fsm.is('enter') && o.enterTarget;
      const ox = en ? o.enterTarget.x : o.pos.x, oz = en ? (o.enterTarget.z ?? o.pos.z) : o.pos.z;
      if (Math.abs(ox - best) < 4.5) near.push(oz); // r8: was 2.6 m / 0.9 m — a wave now fans out over the depth rows (≥ ~2 m apart)
    }
    const zGap = (zz) => near.reduce((m, oz) => Math.min(m, Math.abs(oz - zz)), Infinity);
    if (near.length && zGap(z) < 1.9) {
      let bz = z, bg = zGap(z) - 0;
      for (let zz = band.zMin + 0.35; zz <= band.zMax - 0.35; zz += 0.25) {
        const gsc = Math.min(2.3, zGap(zz)) - Math.abs(zz - z) * 0.12;
        if (gsc > bg) { bg = gsc; bz = zz; }
      }
      t.z = bz;
      this.stats.entryDepth = (this.stats.entryDepth || 0) + 1;
    }
    // Stagger: every same-side foe still entering puts this one another ~1.3 m further back off-screen (a file,
    // not a blob — the lane pick above then fans them out in x as they arrive).
    let ahead = 0;
    for (const o of g.world.query({ team: 'enemies' })) {
      if (o !== e && !o.removed && o.fsm && o.fsm.is('enter') && Math.sign(o.pos.x - mid) === side && Math.abs(o.pos.x - mid) > (vr.xMax - vr.xMin) / 2 - 1.5) ahead++;
    }
    if (ahead && !t.delay && !t.run) { e.pos.x += side * Math.min(3, ahead) * 1.3; this.stats.entryStagger = (this.stats.entryStagger || 0) + 1; }
    // C2 r3 CO-OP SPREAD-IN (board r12: two foes on one hero stood on the same side 69–100 % of the time; r3 probes: the one-sided
    // samples were the hero's foes all between him and the edge they walked in from, nobody in the gap between the heroes, and
    // detours round him afterwards were slow and stood in his silhouette). A later arrival (not the vanguard / wing) whose hero —
    // the one nearest its entry edge — has more foes on his outer side than on his inner side walks in along a depth row
    // >= 1.8 m off his row (set while it is still off-screen), past behind / in front of him, into the gap between the
    // two heroes, and joins from there. The walk-in is the 'enter' state (a purposeful entrance, not idling).
    // director.noSpreadIn: off; spreadGap: the least hero gap (m) it needs.
    if (this.noCoSide && !van && !wing && !this.noSpreadIn && e.brain && e.brain.P && !t.fixed) {
      const hs = this.heroes();
      if (hs.length > 1) {
        const srt = hs.slice().sort((a, b) => (side > 0 ? b.pos.x - a.pos.x : a.pos.x - b.pos.x)); // nearest this edge first
        const nh = srt[0], oh = srt[1], gap = Math.abs(oh.pos.x - nh.pos.x), dirIn = Math.sign(oh.pos.x - nh.pos.x) || inward;
        if (dirIn === inward && gap >= (this.spreadGap ?? 4.4)) {
          let nOut = 0, nIn = 0;
          for (const o of this.engaged()) {
            if (o === e || o.aiTarget !== nh || !o.fsm || o.fsm.is('dead')) continue;
            const ox = o.fsm.is('enter') && o.enterTarget ? o.enterTarget.x : o.pos.x;
            if (Math.sign(ox - nh.pos.x) === -dirIn) nOut++; else nIn++;
          }
          if (nOut >= 1 && nOut > nIn) {
            const band = g.world.band || { zMin: -3, zMax: 3 };
            let bz = null, bs = -Infinity;
            for (let zz = band.zMin + 0.4; zz <= band.zMax - 0.4 + 1e-6; zz += 0.25) {
              const m = Math.abs(zz - nh.pos.z), sc = Math.min(m, 3.0) - Math.abs(zz - (t.z ?? e.pos.z)) * 0.05 + Math.min(1, Math.abs(zz - oh.pos.z)) * 0.3;
              if (m >= 1.8 && sc > bs) { bs = sc; bz = zz; }
            }
            if (bz != null) {
              t.x = nh.pos.x + dirIn * Math.min(3.0, gap * 0.45); t.z = bz; e.pos.z = bz; // still off-screen: the row change is unseen
              t.lane = false; t.deep = true; e.aiDeep = nh.id; e.aiTarget = nh;
              this.stats.spreadIn = (this.stats.spreadIn || 0) + 1;
            }
          }
        }
      }
    }
    if (co && co.deep != null) { // C2 r15: past a hero → along a depth row >= CO_DZ off his (set while still off-screen: the row change is unseen)
      t.x = co.gx; t.z = co.deep; e.pos.z = co.deep;
      t.lane = false; t.deep = true; e.aiDeep = co.h.id;
      this.stats.coDeep = (this.stats.coDeep || 0) + 1;
    }
    this.stats.entryLanes = (this.stats.entryLanes || 0) + 1;
    return t;
  }

  /** C2 r15 CO-OP FLANK PLAN (board r13, unanimous: co-op foes piled on ONE side of their hero — one2 98 / 89 / 77 %; r13's five
   *  go-round mechanisms moved foes AROUND the hero mid-fight and stayed inside seed noise). The fix is at the SOURCE: every co-op
   *  arrival is given a sticky (hero, side) flank slot while it is still off-screen — the four slots (each hero's left / right)
   *  filled in balance (heroes first, then the emptier side of that hero) — and its walk-in is routed to land there:
   *    - natural: its slot lies between its entry edge and every hero → walk in as before;
   *    - edge swap: the slot is reachable from the OTHER edge without passing a hero → it enters from that edge (unseen);
   *    - depth lane: the slot is the gap between the heroes (or behind the hero it targets) → it walks in along a depth row
   *      >= CO_DZ off the row of every hero it passes (behind / in front of them, never through a silhouette) and stops in the gap.
   *  A slot is open only with frame room and no pinned-edge veto (openFlank: PIN_SIDE band, partner not on it) — a pinned hero is
   *  never given an outer-side foe. assign() keeps the hero, the slot costs keep the side; a foe knocked / thrown across adopts
   *  the side it lands on. → { h, side, flip, deep, gx, cost } or null. director.noCoSide = true: off (r14 behaviour). */
  /** C2 r15: per hero, how many foes hold (or will hold) each of his flanks — plans first, else target + side; a wave-mate spawned on
   *  the same tick that has not picked its own walk-in yet is not counted (it plans next, seeing this one's plan). */
  coCount(e, hs) {
    const cnt = new Map(hs.map((h) => [h.id, { 1: 0, '-1': 0, tot: 0 }]));
    for (const o of this.engaged()) {
      if (o === e || o.kind === 'mount' || !o.fsm || o.fsm.is('dead')) continue;
      const c = o.aiCo && cnt.get(o.aiCo.h);
      if (c) { c[o.aiCo.side]++; c.tot++; if (this._coDbg) this._coDbg.push(o.id + 'p' + o.aiCo.side); continue; }
      if (o.fsm.is('enter') && o.enterTarget && !o.enterTarget._laned) continue;
      const h = o.aiTarget && cnt.has(o.aiTarget.id) ? o.aiTarget : null;
      if (!h) continue;
      const ox = o.fsm.is('enter') && o.enterTarget ? o.enterTarget.x : o.pos.x, cc = cnt.get(h.id);
      cc[Math.sign(ox - h.pos.x) || 1]++; cc.tot++;
      if (this._coDbg) this._coDbg.push(o.id + o.fsm.name[0] + (o.enterTarget && o.enterTarget._laned ? 'L' : ''));
    }
    if (this._coRiseP) for (const p of this._coRiseP) { const c = cnt.get(p.h); if (c && this.game.tick - p.t < 120) { c[p.side]++; c.tot++; } } // risers on their way up
    return cnt;
  }
  /** C2 r15: a plan for a foe that did not walk in from an edge (scripted / in-frame entrance, riser): it keeps the side it stands on
   *  of whichever hero it gets, so the HERO is picked to fill an empty flank (no hero between them, side open). → hero or null */
  coLate(e, hs) {
    const rp = this._coRiseP && this._coRiseP.findIndex((p) => Math.abs(p.x - e.pos.x) < 0.6 && Math.abs(p.z - e.pos.z) < 0.6);
    if (rp >= 0) { const p = this._coRiseP.splice(rp, 1)[0], h = hs.find((o) => o.id === p.h); if (h) { e.aiCo = { h: h.id, side: p.side, t: this.game.tick, late: true }; return h; } } // a riser takes the flank it was raised for
    const cnt = this.coCount(e, hs), ex = e.fsm && e.fsm.is('enter') && e.enterTarget ? e.enterTarget.x : e.pos.x;
    let best = null, bc = Infinity;
    for (const h of hs) {
      const sd = Math.sign(ex - h.pos.x) || 1, c = cnt.get(h.id);
      if (this.across(e, h)) continue;
      const cost = (this.coHeroW ?? 2.0) * c.tot + (this.coSideW ?? 3.0) * c[sd] + (this.openFlank(h, sd) ? 0 : 4) + 0.15 * Math.abs(ex - h.pos.x);
      if (cost < bc) { bc = cost; best = h; }
    }
    if (best) { e.aiCo = { h: best.id, side: Math.sign(ex - best.pos.x) || 1, t: this.game.tick, late: true }; this.stats.coLate = (this.stats.coLate || 0) + 1; }
    return best;
  }
  /** C2 r15 CO-OP RISERS (LevelDirector hook, before the spawn): a skeleton the stage raises out of the ground at a fixed x (s2 probe: it
   *  rose on the side its hero's other foe already held — one-sided until it died) rises instead on the emptiest open flank of a hero
   *  (same balance as coPick), clear of every standing body; the crack / dust VFX follow the body. 1P or director.noCoSide: x unchanged. */
  coRiseX(x, z) {
    const hs = this.heroes();
    if (this.noCoSide || hs.length < 2) return x;
    const cnt = this.coCount(null, hs), vr = viewRange(this.game, z);
    const bodies = this.game.world.query({}).filter((o) => o.alive && !o.removed && (o.kind === 'hero' || o.team === 'enemies') && o.pos && Math.abs(o.pos.z - z) < 1.6);
    let best = x, bc = Infinity, bh = null, bsd = 0;
    for (const h of hs) for (const sd of [-1, 1]) {
      const mate = hs.find((o) => o !== h), inner = Math.sign(mate.pos.x - h.pos.x) === sd;
      if (!this.openFlank(h, sd, inner ? CO_GAP_MIN : FLANK_MIN)) continue;
      const room = (sd > 0 ? vr.xMax - EDGE_IN - h.pos.x : h.pos.x - vr.xMin - EDGE_IN) - 0.3;
      const gx = h.pos.x + sd * Math.max(FLANK_MIN, Math.min(inner ? Math.min(3.0, Math.abs(mate.pos.x - h.pos.x) * 0.45) : 2.8, room));
      if (bodies.some((o) => Math.abs(o.pos.x - gx) < 1.2)) continue;
      const c = cnt.get(h.id), cost = (this.coHeroW ?? 2.0) * c.tot + (this.coSideW ?? 3.0) * c[sd] + 0.1 * Math.abs(gx - x);
      if (cost < bc) { bc = cost; best = gx; bh = h; bsd = sd; }
    }
    if (best !== x) this.stats.coRise = (this.stats.coRise || 0) + 1;
    if (bh) (this._coRiseP = (this._coRiseP || []).filter((p) => this.game.tick - p.t < 120)).push({ h: bh.id, side: bsd, x: best, z, t: this.game.tick }); // counted until the riser takes it (coLate)
    return best;
  }
  /** C2 r15: a hero whose planned foes all hold ONE flank while the other is open (it was shut when they arrived: the partner stood
   *  there, or he was pinned) gets one of them re-planned to the open flank — the one with the shortest way round (off his row
   *  already, nearest), never a token holder, at most one per hero per 2 s and per foe per 5 s. It goes round depth first. */
  coEv(e, k) { const L = (this.stats.coEv = this.stats.coEv || []); if (L.length < 200) { const h = this.game.world.byId.get(e.aiCo.h); L.push([this.game.tick, e.id, k, e.aiCo.h, e.aiCo.side, h ? +(e.pos.x - h.pos.x).toFixed(1) : null, e.fsm ? e.fsm.name.slice(0, 4) : '']); } } // diagnostics
  /** C2 r15: re-aim a walk-in at flank sd of hero h — straight if no hero stands between it and the spot, else along a depth row
   *  >= CO_DZ off every hero it passes (an off-screen walker changes row unseen). */
  coReroute(e, h, sd) {
    const t = e.enterTarget, hs = this.heroes(), vr = viewRange(this.game, h.pos.z), band = this.game.world.band || { zMin: -3, zMax: 3 };
    const mate = hs.find((o) => o !== h), inner = mate && Math.sign(mate.pos.x - h.pos.x) === sd;
    const room = (sd > 0 ? vr.xMax - EDGE_IN - h.pos.x : h.pos.x - vr.xMin - EDGE_IN) - 0.2;
    const gx = h.pos.x + sd * Math.max(FLANK_MIN, Math.min(inner ? Math.min(3.0, Math.abs(mate.pos.x - h.pos.x) * 0.45) : WAITX, room));
    const pass = hs.filter((o) => (o.pos.x - e.pos.x) * (gx - o.pos.x) > 0);
    t.x = gx;
    if (pass.length) {
      let bz = null, bs = -Infinity;
      for (let zz = band.zMin + 0.4; zz <= band.zMax - 0.4 + 1e-6; zz += 0.25) { const m = Math.min(...pass.map((o) => Math.abs(zz - o.pos.z))); if (m < (this.coDz ?? CO_DZ)) continue; const sc = Math.min(m, 3.0) - Math.abs(zz - e.pos.z) * 0.05; if (sc > bs) { bs = sc; bz = zz; } }
      if (bz != null) { t.z = bz; if (offFrame(this.game, e, 0)) e.pos.z = bz; t.lane = false; t.deep = true; e.aiDeep = h.id; }
    }
  }
  coRebal(es, hs) {
    const tick = this.game.tick, tk = this.ai.tokens, cd = (this._coRb = this._coRb || {});
    for (const h of hs) {
      if (cd[h.id] > tick) continue;
      const mine = es.filter((o) => o.aiCo && o.aiCo.h === h.id && o.fsm && !o.fsm.is('enter', 'dead') && o.aiTarget === h);
      const ents = this.noCoReroute ? [] : es.filter((o) => o.aiCo && o.aiCo.h === h.id && o.fsm && o.fsm.is('enter') && o.enterTarget && o.enterTarget._laned && !o.enterTarget.fixed && o.aiDeep == null); // C2 r15: still walking in
      if (mine.length + ents.length < 2) continue;
      for (const sd of [-1, 1]) {
        if (mine.some((o) => o.aiCo.side === sd) || ents.some((o) => o.aiCo.side === sd)) continue;
        const mate = hs.find((o) => o !== h), inner = Math.sign(mate.pos.x - h.pos.x) === sd;
        if (!this.openFlank(h, sd, inner ? CO_GAP_MIN : FLANK_MIN)) continue;
        let best = null, bc = Infinity;
        // C2 r15: a foe still walking in is re-routed (its entry walk goes along a depth lane into the open flank: no detour mid-fight)
        for (const o of ents) { const c = -5 + Math.abs(o.enterTarget.x - h.pos.x) * 0.1; if (c < bc) { bc = c; best = o; } }
        if (best) { best.aiCo = { ...best.aiCo, side: sd, t: tick }; best.aiCoRb = tick; cd[h.id] = tick + 60; this.coReroute(best, h, sd); this.stats.coReroute = (this.stats.coReroute || 0) + 1; this.coEv(best, 'rr'); break; }
        for (const o of mine) {
          if ((tk && tk.has(o)) || !o.controllable || (o.aiCoRb != null && tick - o.aiCoRb < 300)) continue;
          const c = Math.abs(o.pos.x - h.pos.x) + (Math.abs(o.pos.z - h.pos.z) < 1.2 ? 1.5 : 0);
          if (c < bc) { bc = c; best = o; }
        }
        if (best) { best.aiCo = { ...best.aiCo, side: sd, t: tick }; best.aiCoRb = tick; cd[h.id] = tick + 120; this.stats.coRebal = (this.stats.coRebal || 0) + 1; this.coEv(best, 'rb'); }
        break;
      }
    }
  }
  /** C2 r16 CO-OP FLANK BALANCER coFlank (replaces coRebal; NB the r3 A/B flag `director.coBal` is a different, older rule; director.v15Bal = r15 rule). Board r14: the entry plan held, but in sustained play the
   *  flanks collapsed — the r15 rebalance re-planned one foe at a time from STALE plan sides (both foes 'planned' on one flank after the
   *  hero walked past them), and its crosser picked up a token on the way, was fought where it stood, gave up after 1.5 s, adopted its old
   *  side and was re-sent (s2 2P seed 99: rb → give → rb for 25 s). Now, every assign pass, per hero, from where his foes actually STAND:
   *   - every standing foe's plan side = the side it stands on (the hero moved past it → it simply belongs to that flank now), except
   *   - ONE crosser per hero, sent round to the empty open flank. It is picked out of his reach (not the foe in his face, not a token
   *     holder squaring up), takes NO token until it is round (coHoldTok; an overdue first-timer still swings from where it is), keeps
   *     the role until it arrives (stats coXArrive), its flank shuts or 5 s pass (coXFail: then a different foe is picked);
   *   - before any standing foe goes round, a foe still walking in is re-routed to the empty flank (coReroute: no detour in the fight),
   *     or a partner's foe standing in the gap on that side is handed over (coSwap) if the partner keeps both his flanks or < 2 foes. */
  coFlank(es, hs) {
    if (!this.v16Bal && !this.r16Off && !this._bossEncounter) return this.coBracket(es, hs);
    const g = this.game, tick = g.tick, tk = this.ai.tokens, X = (this._coX = this._coX || new Map()), st = this.stats;
    const recovering = this.r16Off ? [] : ['knockdown', 'down', 'getup', 'reform', 'hitstun', 'block'];
    const standing = (o) => o.fsm && !o.fsm.is('enter', 'dead', ...NOPUSH, ...recovering) && o.pos.y < 0.8;
    for (const h of hs) {
      const mate = hs.find((o) => o !== h);
      const mine = es.filter((o) => o.aiTarget === h && o.kind !== 'mount' && standing(o) && Math.abs(o.pos.x - h.pos.x) < 9 && !offFrame(g, o, 0.3));
      let cr = X.get(h.id);
      if (cr) {
        const o = g.world.byId.get(cr.id), dx = o ? o.pos.x - h.pos.x : 0;
        const inner = mate && Math.sign(mate.pos.x - h.pos.x) === cr.side, open = this.openFlank(h, cr.side, inner ? CO_GAP_MIN : FLANK_MIN);
        if (open) cr.shut = null; else if (cr.shut == null) cr.shut = tick;
        let end = null;
        if (!o || !o.alive || o.removed || o.aiTarget !== h || (o.fsm && o.fsm.is('dead'))) end = 'Lost';
        else if (Math.sign(dx) === cr.side && Math.abs(dx) > (this.coXArr ?? (this.r16Off ? 0.7 : 1.55))) end = 'Arrive';
        else if ((this.r16Off ? tick - cr.t : cr.active ?? 0) > (this.coXT ?? (this.r16Off ? 150 : 240))) end = 'FailT';
        else if (cr.shut != null && tick - cr.shut > 45) end = 'FailS';
        if (end) { X.delete(h.id); if (o) { o.aiCoX = null; if (end === 'Arrive' && !this.r16Off) o.aiCoHome = { h: h.id, side: cr.side, until: tick + 240 }; if (end.startsWith('Fail')) o.aiCoNo = tick; if (o.aiCo && end.startsWith('Fail')) o.aiCo = { ...o.aiCo, side: Math.sign(dx) || o.aiCo.side, t: tick }; } st['coX' + end] = (st['coX' + end] || 0) + 1; if (o && o.aiCo) this.coEv(o, 'x' + end[0] + (end[4] || '')); cr = null; }
        else { if (o.aiCo) o.aiCo.side = cr.side; else o.aiCo = { h: h.id, side: cr.side, t: tick }; }
      }
      // plans follow reality: a standing foe belongs to the flank it stands on
      for (const o of mine) {
        if (cr && o.id === cr.id) continue;
        const dx = o.pos.x - h.pos.x;
        if (Math.abs(dx) < 0.4 || o.aiDeep != null) continue;
        const sd = Math.sign(dx);
        if (!this.r16Off && o.aiCoHome && o.aiCoHome.h === h.id && o.aiCoHome.until > tick && this.openFlank(h, o.aiCoHome.side)) {
          if (o.aiCo) o.aiCo.side = o.aiCoHome.side;
          continue;
        }
        if (!o.aiCo || o.aiCo.h !== h.id) o.aiCo = { h: h.id, side: sd, t: tick, late: true };
        else if (o.aiCo.side !== sd) { o.aiCo = { ...o.aiCo, side: sd, t: tick }; st.coReal = (st.coReal || 0) + 1; }
      }
      if (cr) continue;
      const ents = this.noCoReroute ? [] : es.filter((o) => o.aiCo && o.aiCo.h === h.id && o.fsm && o.fsm.is('enter') && o.enterTarget && o.enterTarget._laned && !o.enterTarget.fixed && o.aiDeep == null);
      // Prepare the opposite side BEFORE an ally gets back up on the busy flank. The previous loop waited until both
      // were standing/waiting, so every recovery necessarily began with a full one-sided crossing episode.
      const rising = !this.r16Off && mine.length === 1 ? es.filter(o => o.aiTarget === h && o !== mine[0] && o.fsm && o.fsm.is('hitstun', 'block', 'knockdown', 'down', 'getup', 'reform') && Math.abs(o.pos.x - h.pos.x) < 9) : [];
      // A downed/reeling ally still owns its flank. "One standing foe" is not a lone fighter: sending it round while its
      // opposite-side ally gets up created the very one-sided recovery episodes this balancer is meant to prevent.
      const alone = es.filter(o => o.aiTarget === h && o.kind !== 'mount' && o.fsm && !o.fsm.is('dead') && Math.abs(o.pos.x - h.pos.x) < 12).length === 1;
      const log = this._sideLog.get(h.id), single = !this.r16Off && alone && mine.length === 1 && !ents.length && mine[0].aiHasAtk && log && log.length >= 2 && log.slice(-2).every((s) => s === Math.sign(mine[0].pos.x - h.pos.x));
      if (mine.length + rising.length + ents.length < 2 && !single) continue;
      const cov = { 1: 0, '-1': 0 };
      for (const o of [...mine, ...rising]) { const dx = o.pos.x - h.pos.x; if (Math.abs(dx) >= 0.4) cov[Math.sign(dx)]++; }
      for (const o of ents) cov[o.aiCo.side]++;
      if (cov[1] && cov[-1]) continue;
      const sd = cov[1] ? -1 : 1, inner = mate && Math.sign(mate.pos.x - h.pos.x) === sd;
      if (!this.openFlank(h, sd, inner ? CO_GAP_MIN : FLANK_MIN)) continue;
      // 1. a foe still walking in takes the empty flank (its entry walk goes there)
      let best = null, bc = Infinity;
      for (const o of ents) { const c = Math.abs(o.enterTarget.x - h.pos.x) * 0.1; if (c < bc) { bc = c; best = o; } }
      if (best) { best.aiCo = { ...best.aiCo, side: sd, t: tick }; best.aiCoRb = tick; this.coReroute(best, h, sd); st.coReroute = (st.coReroute || 0) + 1; this.coEv(best, 'rr'); continue; }
      // 2. a partner's foe standing in the gap on that side (no walk at all)
      if (inner && !this.noCoSwap) {
        const hisL = es.filter((o) => o.aiTarget === mate && standing(o) && Math.abs(o.pos.x - mate.pos.x) < 9);
        for (const o of hisL) {
          const dx = o.pos.x - h.pos.x;
          if (Math.sign(dx) !== sd || Math.abs(dx) < 1.2 || Math.abs(dx) > 4.6 || Math.abs(o.pos.z - h.pos.z) > 2.6 || (tk && tk.has(o)) || !o.controllable || (o.fsm && !o.fsm.is('idle', 'walk', 'pause'))) continue;
          if (o.aiAggroT != null && tick - o.aiAggroT < 90) continue;
          if (!this.r16Off && o.aiCoHome && o.aiCoHome.until > tick) continue;
          const rest = hisL.filter((q) => q !== o), rs = new Set(rest.map((q) => Math.sign(q.pos.x - mate.pos.x)));
          if (rest.length >= 2 && rs.size < 2) continue; // he would be left one-sided
          const c = Math.abs(dx - sd * 2.3) + Math.abs(o.pos.z - h.pos.z) * 0.3;
          if (c < bc) { bc = c; best = o; }
        }
        if (best) { best.aiTarget = h; best.aiCo = { h: h.id, side: sd, t: tick }; best.aiCoRb = tick; st.coSwap = (st.coSwap || 0) + 1; this.coEv(best, 'sw'); continue; }
      }
      // 3. one standing foe goes round (out of his reach, no token on the way)
      for (const o of mine) {
        if (!o.controllable || !o.fsm.is('idle', 'walk', 'pause') || (o.brain && o.brain.mode === 'retreat') || (o.aiCoNo != null && tick - o.aiCoNo < (this.coNoT ?? 180))) continue;
        if (o.aiOverdue && (!this.r16Off || !o.aiHasAtk)) continue; // an owed swing takes priority over another flank run
        const adx = Math.abs(o.pos.x - h.pos.x), adz = Math.abs(o.pos.z - h.pos.z), hold = tk && tk.has(o);
        if (hold && adx < 2.4 && adz < 1.0 && (this.r16Off || (o.brain.cooldown ?? 0) < 12)) continue; // squaring up to strike
        const recovering = !this.r16Off && o.aiHasAtk && o.brain && o.brain.cooldown > 18;
        const c = adx + (adz < 1.2 ? 1.5 : 0) + (adx < 1.5 && adz < 1.2 ? (recovering ? 0 : 3) : 0) + (hold ? 2 : 0) + (!this.noCoProd && o.brain && (o.brain.cooldown ?? 0) < 12 ? 1.2 : 0) - (recovering ? 2.0 : 0);
        if (c < bc) { bc = c; best = o; }
      }
      if (best) {
        if (tk && tk.has(best)) tk.release(best);
        if (!this.r16Off) for (const o of mine) if (o !== best && (o.pos.x - h.pos.x) * sd < -0.4 && o.aiCo && o.aiCo.side === sd) {
          o.aiCo = { ...o.aiCo, side: -sd, t: tick }; o.aiCoHome = null;
        }
        best.aiCo = { ...(best.aiCo || { h: h.id }), h: h.id, side: sd, t: tick }; best.aiCoRb = tick; best.aiCoX = tick;
        X.set(h.id, { id: best.id, side: sd, t: tick, active: 0, shut: null });
        st.coXGo = (st.coXGo || 0) + 1; this.coEv(best, 'xg');
        if (rising.length) st.coXPrepare = (st.coXPrepare || 0) + 1;
        // C2 r16 ONE SWINGS WHILE ONE CIRCLES: the nearest other foe on the busy side gets its turn now (cooldown cut), so the hero is
        // pressed from the front while the crosser runs round behind him (SoR4 choreography; director.noCoProd: off)
        if (!this.noCoProd) {
          let pr = null, pd = Infinity;
          for (const o of mine) { if (o === best || !o.brain || !o.controllable || (tk && tk.has(o)) || (o.aiOverdue && !o.aiHasAtk)) continue; const d0 = Math.abs(o.pos.x - h.pos.x) + Math.abs(o.pos.z - h.pos.z) * 0.5; if (d0 < pd) { pd = d0; pr = o; } }
          if (pr && (pr.brain.cooldown ?? 0) > 3 && this.heat(h) < (this.coProdHeat ?? 0.8)) { pr.brain.cooldown = 3; st.coProd = (st.coProd || 0) + 1; } // not while he is over his damage budget
        }
      }
    }
  }
  /** C2 r17: an opposite-side job ends at a threatening swing, not at a horizontal crossing or a timer.
   * Reeling/getting-up bodies keep their jobs. Only one route runs per hero; the other foe can keep attacking.
   * An owed swing may temporarily preempt a route, but cannot erase its side. */
  coBracket(es, hs) {
    const g = this.game, tick = g.tick, X = this._coX || (this._coX = new Map());
    const bump = k => this.stats[k] = (this.stats[k] || 0) + 1;
    for (const h of hs) {
      const mine = es.filter(e => e.aiTarget === h && e.kind !== 'mount' && e.alive && !e.removed && e.fsm && !e.fsm.is('dead') && Math.abs(e.pos.x - h.pos.x) < 12);
      const open = side => this.openFlank(h, side);
      const set = (e, side) => {
        e.aiCo = { ...(e.aiCo || {}), h: h.id, side, t: tick };
        e.aiCoDuty = { h: h.id, side, since: tick, pending: true };
        e.aiCoHome = { h: h.id, side, until: tick + 1000000 };
        e.aiCoNo = null; bump('coDuty');
        if (e.fsm.is('enter') && e.enterTarget?._laned && !e.enterTarget.fixed && e.aiDeep == null) { this.coReroute(e, h, side); bump('coReroute'); }
      };
      let cr = X.get(h.id);
      if (cr) {
        const e = mine.find(e => e.id === cr.id);
        const arrived = e && (e.pos.x - h.pos.x) * cr.side >= (h.fsm?.is('down', 'getup', 'knockdown') ? 2.1 : 1.45) && e.pos.y < .3 && !e.fsm.is('thrown', 'grabbed', 'knockdown', 'down', 'getup', 'reform');
        if (!e || !open(cr.side) || e.aiCo?.side !== cr.side || arrived) {
          X.delete(h.id); const old = g.world.byId.get(cr.id); if (old) old.aiCoX = null;
          bump(arrived ? 'coXArrive' : 'coXLost'); cr = null;
        }
      }
      for (const e of mine) {
        const plan = e.aiCo && e.aiCo.h === h.id ? e.aiCo.side : Math.sign(e.pos.x - h.pos.x) || 1;
        if (!e.aiCoDuty || e.aiCoDuty.h !== h.id) {
          const inherited = !!e.aiCoDuty?.pending;
          set(e, plan);
          // Already occupying an ordinary flank is not an unfulfilled crossing job. Protect only real opposite-side
          // assignments; anchoring every arrival until its first swing prevented r15's useful physical rebalancing.
          if (!inherited && (e.pos.x - h.pos.x) * plan > .7 && !e.fsm.is('enter')) { e.aiCoDuty.pending = false; e.aiCoHome = null; }
        }
        // Losing the partner temporarily clears aiCo in coKeep; the promised duty survives that co-op reset.
        if (!e.aiCo || e.aiCo.h !== h.id) e.aiCo = { h: h.id, side: e.aiCoDuty.side, t: tick };
        const own = Math.sign(e.pos.x - h.pos.x);
        if (!e.aiCoDuty.pending && own && Math.abs(e.pos.x - h.pos.x) > .7 && !e.fsm.is('enter')) {
          e.aiCoDuty.side = own; e.aiCo.side = own;
        }
        const side = e.aiCoDuty.side, vr = viewRange(g, h.pos.z);
        const edge = this.pinnedSide(h, this.pinSide ?? PIN_SIDE) === side || h.pos.x + side * FLANK_MIN < vr.xMin + EDGE_IN || h.pos.x + side * FLANK_MIN > vr.xMax - EDGE_IN;
        // The pinned veto suspends an outer job; reopening restores it without a new assignment or timer.
        const suspended = edge && !open(side) && open(-side);
        e.aiCoDuty.suspended = suspended;
        e.aiCo = { ...e.aiCo, h: h.id, side: suspended ? -side : side };
        if (e.aiCoDuty.pending) e.aiCoHome = { h: h.id, side, until: tick + 1000000 };
      }
      // A genuine isolated duel gets a fresh side after two same-side swings. A floored/reforming comrade
      // is still in `mine`, so it never causes the r16 premature lone-foe rotations that emptied an existing flank.
      if (mine.length === 1 && open(-1) && open(1)) {
        const e = mine[0], log = this._sideLog.get(h.id), own = Math.sign(e.pos.x - h.pos.x);
        if (!cr && own && !e.aiCoDuty.pending && e.aiHasAtk && e.controllable && !e.aiOverdue && (e.aiIdleT || 0) < 150
          && (e.brain?.cooldown || 0) > 18 && log?.length >= 2 && log.slice(-2).every(s => s === own)) { set(e, -own); bump('coDuelTurn'); }
      }
      if (mine.length < 2 || !open(-1) || !open(1)) continue;
      const count = side => mine.filter(e => e.aiCo.side === side).length;
      for (const side of [-1, 1]) {
        if (count(side)) continue;
        const choices = mine.filter(e => (!cr || e.id !== cr.id) && count(e.aiCo.side) > 1 && !e.fsm.is('attack'));
        choices.sort((a,b) => {
          const cost = e => ((e.pos.x - h.pos.x) * side > .7 ? -12 : 0) + (e.controllable ? 0 : e.fsm.is('enter') ? -8 : 18)
            + (!e.aiHasAtk ? 4 : 0) + (e.aiOverdue ? 5 : 0) + Math.abs(e.pos.x - h.pos.x) * .3 - Math.min(2, (e.brain?.cooldown || 0) / 30);
          return cost(a) - cost(b);
        });
        if (choices[0]) { set(choices[0], side); bump('coDutyBalance'); }
      }
      // Start returns on this pass, including a recovering foe's first controllable tick. No cooldown-based
      // reassignment and no lone-foe side rotations: those undid S2 brackets in r16.
      if (!cr) {
        const choices = mine.filter(e => e.controllable && e.fsm.is('idle', 'walk') && e.aiDeep == null
          && (e.pos.x - h.pos.x) * e.aiCo.side < -.4 && !(e.aiOverdue && !e.aiHasAtk) && !e.aiCoService);
        choices.sort((a,b) => (b.aiHasAtk - a.aiHasAtk) || (a.aiIdleT || 0) - (b.aiIdleT || 0));
        const e = choices[0];
        if (e) {
          cr = { id: e.id, side: e.aiCo.side, t: tick, active: 0, shut: null };
          X.set(h.id, cr); e.aiCoX = tick; this.ai.tokens?.release(e); bump('coXGo');
        }
      }
    }
  }
  coWaiting(e, h) { const r = this._coX?.get(h.id); return !!(!this.v16Bal && !this._bossEncounter && r && r.id !== e.id); }
  coThreat(e, h) {
    const d = e.aiCoDuty;
    e.aiCoService = null;
    if (!d || d.h !== h.id || (e.pos.x - h.pos.x) * d.side < .7 || Math.abs(e.pos.z - h.pos.z) > 1.2) return;
    d.pending = false; d.threatened = this.game.tick;
    e.aiCoHome = { h: h.id, side: d.side, until: this.game.tick + 120 };
    this.stats.coThreat = (this.stats.coThreat || 0) + 1;
  }
  /** A flank run owns its path through arrival, independently of waiting-slot packing. Find a depth lane clear of BOTH
   *  heroes and of the waiters it passes; move off the contact row first, then across. Hitstun/get-up keeps the route.
   *  No collision exemption: the usual body floor still applies when another actor steps onto the route. */
  coRoute(e, h) {
    if (this.r16Off || this.noCoRoute || this.noCoSide || this._nh < 2) return null;
    const legacy = this.v16Bal || this._bossEncounter;
    const X = this._coX || (this._coX = new Map()), g = this.game;
    let r = X.get(h.id);
    // Entry plans and post-attack slot returns use the same route as the balancer; they used to fall back to the old,
    // target-row-only detour and stall against the partner even after the explicit coX crossings were fixed.
    const side = e.aiCo && e.aiCo.h === h.id ? e.aiCo.side : 0;
    if (!legacy && e.aiCoService) return null;
    if (!r && side && (e.pos.x - h.pos.x) * side < -0.4 && this.openFlank(h, side) && !e.aiOverdue && (e.aiCoNo == null || g.tick - e.aiCoNo >= 180)) {
      r = { id: e.id, side, t: g.tick, active: 0, shut: null };
      X.set(h.id, r); e.aiCoX = g.tick;
      this.stats.coXPlan = (this.stats.coXPlan || 0) + 1;
    }
    if (!r || r.id !== e.id) return null;
    // A route acquired before the first-attack deadline cannot override the wake-up swing afterwards. The token gate
    // already exempted these foes, but this earlier path return still forced an interrupted first-timer to finish circling.
    const firstDue = e.aiOverdue && !e.aiHasAtk, serviceDue = e.aiHasAtk && (e.aiIdleT || 0) > 240;
    if (firstDue || serviceDue) {
      X.delete(h.id); e.aiCoX = null; e.aiCoHome = null; e.aiCoNo = g.tick;
      if (!legacy) { e.aiCoService = g.tick || 1; }
      else if (e.aiCo) e.aiCo.side = Math.sign(e.pos.x - h.pos.x) || e.aiCo.side;
      const key = firstDue ? 'coXFirst' : 'coXServe'; this.stats[key] = (this.stats[key] || 0) + 1;
      return null;
    }
    const hs = this.heroes(), b = g.world.band || { zMin: -3, zMax: 3 };
    const dx = e.pos.x - h.pos.x, vr = viewRange(g, e.pos.z), down = !legacy && h.fsm?.is('down', 'getup', 'knockdown');
    const radius = down ? 2.25 : 1.65, clearance = down ? 1.9 : 1.35;
    const lead = h.vel && Math.sign(h.vel.x) === r.side ? Math.min(0.6, Math.abs(h.vel.x) * 0.18) : 0;
    let gx = h.pos.x + r.side * ((down ? 2.3 : 1.9) + lead);
    for (const o of hs) if (o !== h && (o.pos.x - h.pos.x) * r.side > 0.3 && Math.abs(o.pos.z - h.pos.z) < 2.4) {
      gx = r.side > 0 ? Math.min(gx, o.pos.x - 1.45) : Math.max(gx, o.pos.x + 1.45);
    }
    gx = Math.max(vr.xMin + 1.0, Math.min(vr.xMax - 1.0, gx));
    const x0 = Math.min(e.pos.x, gx) - 0.85, x1 = Math.max(e.pos.x, gx) + 0.85;
    if (r.lane == null || g.tick - (r.laneT || 0) >= 15) {
      const bodies = g.world.query({ team: 'enemies' }).filter((o) => o !== e && o.alive && !o.removed && o.pos.x >= x0 && o.pos.x <= x1 && o.fsm && !o.fsm.is(...NOPUSH, 'enter') && o.pos.y < 0.6);
      let best = null, cost = Infinity;
      for (let z = b.zMin + 0.25; z <= b.zMax - 0.25 + 1e-6; z += 0.25) {
        let c = Math.abs(z - e.pos.z) * 0.3 + (r.lane == null ? 0 : Math.abs(z - r.lane) * 0.8);
        for (const o of hs) {
          // The partner is a hard obstacle only when this path passes his body. A partner safely beyond the capped
          // arrival still influences the lane, but cannot repeatedly force a long lane reversal as he moves in depth.
          const near = o === h || (o.pos.x >= x0 && o.pos.x <= x1) || this.noCoLocalLane;
          c += Math.max(0, (o === h && down ? 2.1 : 1.65) - Math.abs(z - o.pos.z)) * (near ? 30 : 1);
        }
        for (const o of bodies) c += Math.max(0, 1.8 - Math.abs(z - o.pos.z)) * 6;
        if (c < cost) { cost = c; best = z; }
      }
      r.lane = best ?? e.pos.z; r.laneT = g.tick;
    }
    // Retain a crossing silhouette until its whole body has reached the new flank, rather than cutting back onto a hero.
    const aligned = (e.pos.z - h.pos.z) * (r.lane - h.pos.z) >= 0;
    const clear = aligned && hs.every((o) => (o !== h && (o.pos.x < x0 || o.pos.x > x1)) || Math.abs(e.pos.z - o.pos.z) >= (o === h ? clearance : 1.35));
    const onSide = dx * r.side > (down ? 2.1 : 1.45);
    if (!onSide && !clear) {
      // Follow the near half of an arc while exiting in depth; the old rectangular path spent half its time walking
      // straight away from the hero before it could begin crossing, and a moving hero kept resetting that first leg.
      const dz = aligned ? Math.min(clearance, Math.abs(e.pos.z - h.pos.z)) : 0;
      const tangent = Math.sqrt(Math.max(0.5 * 0.5, radius * radius - dz * dz));
      gx = h.pos.x + (Math.sign(dx) || -r.side) * tangent;
    }
    r.active = (r.active || 0) + 1;
    return { x: gx, z: onSide && !legacy ? h.pos.z : r.lane, side: r.side, speed: legacy ? 1.9 : 2.45 };
  }
  /** The last, inactive part of a melee recovery starts the exit to an empty flank. Keep the move's full punish window,
   *  chain decision and active/root-motion frames intact; begin the step in depth before a second waiter joins the busy side. */
  coRecover(e, run, dt) {
    if (this.r16Off || this.noCoRecover || this._nh < 2 || e.kind === 'boss' || !e.grounded || !e.aiHasAtk || !run || run.def.air) return;
    if (!this.v16Bal && !this._bossEncounter && e.aiCoDuty?.pending) return;
    const h = e.aiTarget, f = run.frame, d = run.def, tick = this.game.tick;
    if (!h || (h.fsm && h.fsm.is('down', 'getup', 'knockdown', 'dead'))) return;
    const activeEnd = Math.max((d.startup || 0) + (d.active || 0), ...(run.wins || []).map(w => w.to), ...(d.move || []).map(m => m.to), d.chain ? d.chain.at : 0);
    if (f < activeEnd + 2) return;
    const X = this._coX || (this._coX = new Map());
    let r = X.get(h.id);
    if (!r) {
      const side = Math.sign(e.pos.x - h.pos.x) || 1;
      if (!this.openFlank(h, -side)) return;
      const others = this.engaged().filter(o => o !== e && o.aiTarget === h && o.fsm && o.fsm.is('idle', 'walk', 'pause', 'attack') && Math.abs(o.pos.x - h.pos.x) < 7);
      if (!others.length || others.some(o => (o.pos.x - h.pos.x) * side < -0.4)) return;
      r = { id: e.id, side: -side, t: tick, active: 0, shut: null };
      X.set(h.id, r); e.aiCoX = tick; e.aiCo = { h: h.id, side: -side, t: tick };
      if (!this.v16Bal && !this._bossEncounter) { e.aiCoDuty = { h: h.id, side: -side, since: tick, pending: true }; e.aiCoHome = { h: h.id, side: -side, until: tick + 1000000 }; }
      this.stats.coXRecovery = (this.stats.coXRecovery || 0) + 1;
    }
    if (r.id !== e.id) return;
    const p = this.coRoute(e, h);
    if (!p) return;
    const dx = p.x - e.pos.x, dz = p.z - e.pos.z, len = Math.max(0.1, Math.hypot(dx, dz));
    const speed = (e.speed || 2.8) * 1.7, k = Math.min(1, dt * 18);
    e.vel.x += (dx / len * speed - e.vel.x) * k;
    e.vel.z += (dz / len * speed - e.vel.z) * k;
    e.aiCrossing = true;
  }
  /** C2 r16: the co-op crosser takes no attack token until it is round (kit wantsAttack). An overdue first-timer / vanguard still may. */
  coHoldTok(e, t) {
    if (this.v15Bal || !this._coX || e.aiCoX == null || (e.aiOverdue && !e.aiHasAtk) || e.vanguard) return false;
    const cr = this._coX.get(t.id);
    return !!(cr && cr.id === e.id);
  }
  /** C2 r15 (kit xPref): a planned co-op foe going round its hero takes the depth side (behind / in front of his row) with fewer standing
   *  bodies in its path (r15 trace: a detour walked into a waiting comrade on the back row and the body-space floor froze it in the
   *  hero's column for 1+ s); the choice sticks, and flips once if it makes no depth progress for 0.5 s. Others: their own side. */
  crossPref(e, t, own) {
    if (this.noCoSide || this.noCrossPref || !e.aiCo || this._nh < 2) return own;
    const tick = this.game.tick, m = e.aiXP;
    if (m && m.t === t.id && tick - m.seen < 20) {
      m.seen = tick;
      if (Math.abs(e.pos.z - m.z0) >= 0.25) { m.z0 = e.pos.z; m.at = tick; }
      else if (tick - m.at > 30 && !m.flip && Math.abs(e.pos.z - t.pos.z) < 1.2) { /* stuck on (near) his row, not arrived on its lane */ m.side = -m.side; m.flip = true; m.at = tick; this.stats.crossFlip = (this.stats.crossFlip || 0) + 1; }
      return m.side;
    }
    const n = { 1: 0, '-1': 0 }, x0 = Math.min(e.pos.x, t.pos.x) - 1.2, x1 = Math.max(e.pos.x, t.pos.x) + 1.2;
    for (const o of this.game.world.query({ team: 'enemies' })) {
      if (o === e || o.removed || !o.alive || o.kind === 'boss' || o.pos.y > 0.5 || !o.fsm || o.fsm.is('dead', 'enter')) continue;
      if (o.pos.x < x0 || o.pos.x > x1 || Math.abs(o.pos.z - t.pos.z) < 0.6) continue;
      n[Math.sign(o.pos.z - t.pos.z) || own]++;
    }
    const side = n[own] <= n[-own] ? own : -own;
    if (side !== own) this.stats.crossOther = (this.stats.crossOther || 0) + 1;
    e.aiXP = { t: t.id, side, at: tick, seen: tick, z0: e.pos.z };
    return side;
  }
  coPick(e, t, vr, z) {
    const hs = this.heroes();
    if (hs.length < 2) return null;
    const cnt = this.coCount(e, hs);
    const band = this.game.world.band || { zMin: -3, zMax: 3 };
    const edge0 = Math.sign(e.pos.x - (vr.xMin + vr.xMax) / 2) || 1; // +1 = it spawned past the right edge
    const DZ = this.coDz ?? CO_DZ;
    let best = null;
    for (const h of hs) for (const sd of [-1, 1]) {
      const mate = hs.find((o) => o !== h), inner = Math.sign(mate.pos.x - h.pos.x) === sd;
      if (!this.openFlank(h, sd, inner ? CO_GAP_MIN : FLANK_MIN)) continue;
      const room = (sd > 0 ? vr.xMax - EDGE_IN - h.pos.x : h.pos.x - vr.xMin - EDGE_IN) - 0.2;
      let gx = h.pos.x + sd * Math.max(FLANK_MIN, Math.min(inner ? Math.min(3.0, Math.abs(mate.pos.x - h.pos.x) * 0.45) : WAITX, room));
      const c = cnt.get(h.id);
      for (const ed of [edge0, -edge0]) {
        const ex = ed > 0 ? vr.xMax : vr.xMin; // walk from ex toward gx: every hero standing between passes beside it
        const pass = hs.filter((o) => (o.pos.x - gx) * ed > -0.6 && (ex - o.pos.x) * ed > 0);
        let bz = null;
        if (pass.length) {
          let bs = -Infinity;
          for (let zz = band.zMin + 0.4; zz <= band.zMax - 0.4 + 1e-6; zz += 0.25) {
            const m = Math.min(...pass.map((o) => Math.abs(zz - o.pos.z)));
            if (m < DZ) continue;
            const sc = Math.min(m, 3.0) - Math.abs(zz - z) * 0.05;
            if (sc > bs) { bs = sc; bz = zz; }
          }
          if (bz == null) continue; // no clear depth lane past them
        }
        const route = (ed !== edge0 ? this.coFlipCost ?? 0.8 : 0) + (pass.length ? this.coPassCost ?? 1.6 : 0);
        const cost = (this.coHeroW ?? 2.0) * c.tot + (this.coSideW ?? 3.0) * c[sd] + route + 0.05 * Math.abs(ex - gx);
        if (!best || cost < best.cost) best = { h, side: sd, flip: ed !== edge0, deep: pass.length ? bz : null, gx, cost, ed, n: [...cnt.values()].map((q) => q[-1] + '/' + q[1]).join(' ') };
      }
    }
    return best;
  }
  /** C2 r15: keep e.aiCo in step with its hero (assign()): a foe without a plan (scripted entrance, riser, a hand-over) takes the
   *  side it stands on; a planned foe that has stood on the other side for 1 s (knocked / thrown across) adopts that side. */
  coKeep(e, t, hs) {
    if (this.noCoSide || hs.length < 2) { e.aiCo = null; return; }
    if (e.fsm && e.fsm.is('enter') && e.enterTarget && !e.enterTarget._laned) return; // an edge walk-in plans its own slot on its first tick (entryLane)
    const ex = e.fsm && e.fsm.is('enter') && e.enterTarget ? e.enterTarget.x : e.pos.x, sd = Math.sign(ex - t.pos.x) || 1, tick = this.game.tick;
    if (!e.aiCo || e.aiCo.h !== t.id) { const was = e.aiCo; e.aiCo = { h: t.id, side: !this.v16Bal && e.aiCoDuty?.pending ? e.aiCoDuty.side : sd, t: tick, late: true }; e.aiCoOff = null; this.coEv(e, was ? 'hero' : 'new'); return; }
    if (!this.v15Bal) return; // C2 r16: coFlank sets the plan sides from where the foes stand (and keeps its crosser's)
    if (sd !== e.aiCo.side && Math.abs(ex - t.pos.x) > 1.2 && e.aiDeep == null && !(e.fsm && e.fsm.is('enter'))) {
      if (e.aiCoOff == null) e.aiCoOff = tick;
      else if (tick - e.aiCoOff > 60 && (this.coAdoptAll || (tick - e.aiCoOff > 240 && !this.noCoGive) || !this.openFlank(t, e.aiCo.side) || this.engaged().some((o) => o !== e && o.aiTarget === t && o.fsm && !o.fsm.is('enter', 'dead') && (o.pos.x - t.pos.x) * e.aiCo.side > 0.6))) { /* C2 r15 sticky: it goes back round unless its flank is shut or held */ e.aiCo = { ...e.aiCo, side: sd, t: tick }; e.aiCoOff = null; this.stats.coAdopt = (this.stats.coAdopt || 0) + 1; this.coEv(e, 'adopt'); }
    } else e.aiCoOff = null;
  }

  /** r7: is some foe other than `except` already fighting hero t (token holder, mid-swing, or standing in control
   *  within 3.4 m of it)? No → the next arrival is the wave's vanguard. */
  engagedOn(t, except) {
    if (this.committed(t, except).length) return true;
    for (const o of this.game.world.query({ team: 'enemies' })) {
      if (o === except || o.removed || !o.alive || o.kind === 'mount' || !(o.brain && o.brain.P) || (o.fsm && o.fsm.is('enter', 'dead'))) continue; // fighters only (a thief near the hero isn't a fight)
      if (o.aiTarget === t && Math.abs(o.pos.x - t.pos.x) < 3.4 && Math.abs(o.pos.z - t.pos.z) < 1.6) return true;
    }
    return false;
  }

  /** r5b: an entering foe with another body in its screen column just ahead holds back (walks in single file, then
   *  fans out to its own entry lane) instead of merging into it. */
  entryHold(e, dirX) {
    if (this.noEntryLanes) return false;
    // C2 r3 (board r12: a half-cut body at the frame edge on entry): an entrant whose body straddles the frame edge never slows —
    // it holds back off-screen or walks on until it stands fully inside
    if (!this.noEdgeWalk) { const vr = viewRange(this.game, e.pos.z); if (e.pos.x > vr.xMin - 0.7 && e.pos.x < vr.xMin + 1.1) return false; if (e.pos.x < vr.xMax + 0.7 && e.pos.x > vr.xMax - 1.1) return false; }
    for (const o of this.game.world.query({ team: 'enemies' })) {
      if (o === e || o.removed || !o.alive || !(o.fsm && o.fsm.is('enter'))) continue;
      const dx = this.sx(o.pos.x, o.pos.z) - this.sx(e.pos.x, e.pos.z);
      if (Math.abs(dx) < XSEP && Math.sign(dx) === Math.sign(dirX) && Math.abs(o.pos.z - e.pos.z) < ZVIS) return true;
    }
    return false;
  }

  /** r5b: is another standing foe in e's screen column just ahead of it (moving toward gx)? Walkers then hold back
   *  and fall into single file instead of travelling fused with it. */
  columnAhead(e, gx) {
    const dir = Math.sign(gx - e.pos.x);
    if (!dir || Math.abs(gx - e.pos.x) < 0.5) return false;
    for (const o of this.game.world.query({ team: 'enemies' })) {
      if (o === e || o.removed || !o.alive || o.kind === 'boss' || o.pos.y > 0.8 || (o.fsm && o.fsm.is(...NOPUSH))) continue;
      const dx = this.sx(o.pos.x, o.pos.z) - this.sx(e.pos.x, e.pos.z), adz = Math.abs(o.pos.z - e.pos.z);
      if (Math.abs(dx) < XSEP && Math.sign(dx) === dir && adz < ZVIS && adz >= 0.35) return true;
    }
    return false;
  }

  /** r6 clear path: another visible standing body whose screen column lies on e's walk from where it stands to
   *  (gx, gz), at another depth (passing it = two silhouettes fused for a beat). → that body or null. Reeling bodies
   *  count (a foe knocked back across the lane). The mover's own depth-mates are the euclidean rule's job. */
  pathBlocker(e, gx, gz) {
    if (this.noPathGate) return null;
    const s0 = this.sx(e.pos.x, e.pos.z), s1 = this.sx(gx, gz), dir = Math.sign(s1 - s0);
    if (!dir || Math.abs(s1 - s0) < 0.35) return null;
    const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
    for (const o of this.game.world.query({ team: 'enemies' })) {
      if (o === e || o.removed || !o.alive || o.kind === 'boss' || o.pos.y > 0.8 || (o.fsm && o.fsm.is(...NOPUSH))) continue;
      // r6: judged where the body is now AND where it will be in ~0.4 s (a foe walking or reeling into my lane)
      const la = this.pathLook ?? 0.4, v = o.vel || { x: 0, z: 0 };
      const s0o = this.sx(o.pos.x, o.pos.z), s1o = this.sx(o.pos.x + (v.x || 0) * la, o.pos.z + (v.z || 0) * la);
      const inside = (q) => q >= lo - 0.3 && q <= hi + 0.3;
      if (!inside(s0o) && !inside(s1o)) continue;
      const so = inside(s0o) ? s0o : s1o;
      if ((so - s0) * dir < 0.2) continue; // behind me / already beside me: walking on clears it
      const dzA = Math.abs(o.pos.z - e.pos.z), dzB = Math.abs(o.pos.z - gz);
      if (Math.min(dzA, dzB) >= ZVIS || (dzA < 0.35 && dzB < 0.35)) continue;
      return o;
    }
    return null;
  }

  /** r6: a standing body sharing e's screen column right now (other depth) that is nearer e's hero — it owns the
   *  lane, e must not take a turn from there (two attackers side by side in depth read as one). */
  columnMate(e, t) {
    if (this.noPathGate || this.noColMate || !t) return null;
    const se = this.sx(e.pos.x, e.pos.z), ex = Math.abs(e.pos.x - t.pos.x);
    for (const o of this.game.world.query({ team: 'enemies' })) {
      if (o === e || o.removed || !o.alive || o.kind === 'boss' || o.pos.y > 0.8 || (o.fsm && o.fsm.is(...NOPUSH))) continue;
      const adz = Math.abs(o.pos.z - e.pos.z);
      if (adz < 0.35 || adz >= ZVIS || Math.abs(this.sx(o.pos.x, o.pos.z) - se) >= XSEP * 0.85) continue;
      const ox = Math.abs(o.pos.x - t.pos.x);
      if (ox < ex - 0.05 || (Math.abs(ox - ex) <= 0.05 && o.id < e.id)) return o;
    }
    return null;
  }

  /** Is the x lane at (x, z) free of other visible foes? (an attacker strikes only from its own silhouette lane) */
  laneFree(e, x, z) {
    for (const o of this.game.world.query({ team: 'enemies' })) {
      if (o === e || o.kind === 'boss' || o.removed || o.pos.y > 0.8 || (o.fsm && o.fsm.is(...NOPUSH))) continue;
      if (Math.abs(this.sx(o.pos.x, o.pos.z) - this.sx(x, z)) < XSEP * 0.8 && Math.abs(o.pos.z - z) < ZVIS && Math.abs(o.pos.z - z) >= 0.35) return false;
    }
    return true;
  }

  /** Enemies other than e committed on hero t (token holders + live swingers). */
  committed(t, e) {
    const out = new Set(this.swinging(t, e));
    const tk = this.ai.tokens;
    if (tk) for (const id of tk.holders(t).keys()) { const o = this.game.world.byId.get(id); if (o && o !== e && o.alive && !o.removed) out.add(o); }
    return [...out];
  }

  /** C2 r3 LANE STICKINESS (board r12 traces: a token holder going round its hero re-decided its side every tick — as it passed
   *  behind him its 'own' side flipped and so did the answer; detours took 3–5 s and were the largest part of the remaining
   *  first-attack waits). A foe going round keeps that side for LANE_STICK ticks unless the frame rule (room / pinned) says
   *  otherwise. director.noLaneStick: off. */
  attackSide(e, t) {
    const r = this._attackSide(e, t);
    if (!this.laneStick || r.yield || r.queue) return r; // A/B only (director.laneStick = true | ticks): measured worse — longer detours, eh06 +3 %
    const tick = this.game.tick, own = Math.sign(e.pos.x - t.pos.x) || 1, k = e.aiLane;
    if (k && k.t === t.id && tick - k.at < (this.laneStick === true ? LANE_STICK : this.laneStick) && k.side !== r.side && !r.room && this.pinnedSide(t, this.pinSide ?? PIN_SIDE) !== k.side) {
      this.stats.laneStick = (this.stats.laneStick || 0) + 1;
      return { ...r, side: k.side };
    }
    if (r.side !== own) { if (!k || k.t !== t.id || k.side !== r.side) e.aiLane = { t: t.id, side: r.side, at: tick }; }
    else if (k) e.aiLane = null;
    return r;
  }

  /** Attack lane for a committing foe: the side of the hero no other committed foe is using (surround, never a
   *  pile-up), plus a depth offset when both sides are already taken. → { side, dz } */
  _attackSide(e, t) {
    const own = Math.sign(e.pos.x - t.pos.x) || (e.aiSlot && e.aiSlot.side) || 1;
    const busy = { 1: 0, '-1': 0 }, far = { 1: 0, '-1': 0 }, ex = Math.abs(e.pos.x - t.pos.x);
    for (const o of this.committed(t, e)) {
      const ox = Math.abs(o.pos.x - t.pos.x), s = Math.sign(o.pos.x - t.pos.x) || 1;
      if (ox >= 3.2) continue;
      // On my own side only a foe ahead of me (or mid-swing) owns the flank — the farther one yields, not both.
      if (s === own && !(o.fsm && o.fsm.is('attack')) && (ox > ex || (Math.abs(ox - ex) < 0.05 && o.id > e.id))) continue;
      busy[s]++; far[s] = Math.max(far[s], ox);
    }
    // c1r10: a foe the hero is hitting right now (reeling / blocking next to him, token or not) owns that flank too —
    // a second attacker walking up behind it in depth stood in its screen column (critic r9: three bodies on one hero)
    if (!this.v9Side) for (const o of this.game.world.query({ team: 'enemies' })) {
      if (o === e || o.removed || !o.alive || o.kind === 'boss' || !(o.fsm && o.fsm.is('hitstun', 'knockdown', 'block'))) continue;
      const ox = Math.abs(o.pos.x - t.pos.x), s = Math.sign(o.pos.x - t.pos.x) || 1;
      if (ox > 2.4 || Math.abs(o.pos.z - t.pos.z) > 1.8 || (s === own && ox > ex)) continue;
      busy[s]++; far[s] = Math.max(far[s], ox); this.stats.reelBusy = (this.stats.reelBusy || 0) + 1;
    }
    // c1r10 FRAME ROOM: a hero pinned near the frame edge (co-op: the camera frames both heroes, so each often stands
    // ~1 m from an edge) can't be fought from the outer side — that attacker stood half clipped by the frame and its
    // whole fight piled there while the middle of the screen stayed empty. The strike spot must be ≥ EDGE_IN inside the
    // frame; if it isn't, the attacker goes round (depth detour) to the inner flank, or waits for it.
    if (!this.v9Side) {
      const vr = viewRange(this.game, t.pos.z), ins = (sd) => { const x = t.pos.x + sd * 1.1; return x > vr.xMin + EDGE_IN && x < vr.xMax - EDGE_IN; };
      // C2 r1: …and never from the outer side of a hero PINNED near the frame edge (projected, PIN of the frame width; a
      // slightly wider band here than the attackWith veto, so attackers are already on the inner side when it applies)
      const band = (P) => { const w = vr.xMax - vr.xMin, f = (t.pos.x - vr.xMin) / w; return f < P ? -1 : f > 1 - P ? 1 : 0; };
      const rf = e.aiRoundFail != null && this.game.tick - e.aiRoundFail < 300; // its detour to the inner side failed (kit)
      const ps = this.noVeto || this.pinExempt(e, t) ? 0 : band(this.v11Veto ? (this.pin ?? PIN) + 0.03 : this.pinSide ?? PIN_SIDE); // hard (C2 r2: no exemption against a bot hero, see pinExempt)
      // C2 r3: the soft band is OFF (director.softPin = true restores): with the bots at 18–25 % of the frame it sent most first
      // attackers round the hero (eh06 ×3); the hard band + the attack veto keep the edge fair
      const pref = this.noVeto || (rf && !t.aiBot) || !this.softPin ? 0 : band(Math.max(PIN_PREF, this.v11Veto ? 0 : (this.pinSide ?? PIN_SIDE) + 0.04)); // soft: inner flank preferred while it is free
      if (!ins(own) || ps === own) {
        this.stats.sideRoom = (this.stats.sideRoom || 0) + 1;
        if (!busy[-own] && ins(-own) && ps !== -own) return { side: -own, dz: 0, room: true };
        return { side: own, dz: 0, yield: true, room: true };
      }
      if (pref === own && !busy[-own] && ins(-own) && !this.committed(t, e).length) { // solo only: in co-op a detour round one hero crosses the other's fight
        this.stats.sidePref = (this.stats.sidePref || 0) + 1; return { side: -own, dz: 0, room: true }; }
    }
    // C2 r2 PARTNER COLUMN (board r11 probe: most remaining foe-on-hero frames were an attacker of one hero standing in the
    // OTHER hero's screen column a band off in depth): a strike spot inside another hero's column is a busy flank.
    if (this.mateCol && this._nh > 1) { // A/B only (director.mateCol = true): measured worse — every refusal is a detour round the hero (stage-2 2P crossings ×3, foe-on-hero 9.6 → 20.5 %)
      const inCol = (sd) => { const sx0 = this.sx(t.pos.x + sd * 1.06, t.pos.z); return this.heroes().some((o) => o !== t && Math.abs(o.pos.z - t.pos.z) < SP_DZMAX && Math.abs(this.sx(o.pos.x, o.pos.z) - sx0) < 0.8 * this.sk(o.pos.z)); };
      if (inCol(own) && !busy[-own] && !inCol(-own)) { this.stats.mateCol = (this.stats.mateCol || 0) + 1; if (Math.abs(e.pos.x - t.pos.x) > 1.6 || Math.abs(e.pos.z - t.pos.z) > 1.0) return { side: -own, dz: 0, room: true }; }
    }
    // C2 r3 CO-OP FLANK (board r12: two foes on one hero stood on the SAME side 69–100 % of the time): the hero's designated
    // flanker (flankPass) that gets a token on its way round keeps going round (depth detour) to his open side while it has
    // frame room and the partner hero isn't on it; every other foe keeps the r5 rule below (A/B v1: letting every second co-op
    // engager cross cost ~35 % of the attack starts). director.v12Side = r12 rule.
    // C2 r15 CO-OP FLANK PLAN: a foe planned for the other flank of this hero (he walked past it) attacks from there while it is open and free
    { const p = !this.noCoSide && this._nh > 1 && e.aiCo && e.aiCo.h === t.id ? e.aiCo.side : 0;
      const tk0 = this.game.tick; if (!(p && p === -own)) e.aiCoXT = null; else if (e.aiCoXT == null) e.aiCoXT = tk0;
      if ((this.v16Bal || !e.aiCoDuty) && p && p === -own && e.aiCoXT != null && tk0 - e.aiCoXT > (this.coXGive ?? 90) && !this.noCoGive) { e.aiCo = { ...e.aiCo, side: own, t: tk0 }; e.aiCoRb = tk0; e.aiCoXT = null; this.stats.coGiveUp = (this.stats.coGiveUp || 0) + 1; this.coEv(e, 'give'); } /* C2 r15: a token holder not round in 1.5 s (the hero matches its depth) attacks from here */
      else if (!this.v16Bal && p && p === -own && this.coWaiting(e, t)) return { side: own, dz: 0, queue: busy[own] ? far[own] + XSEP : undefined };
      else if (!(e.aiCoService && !this.v16Bal) && p && p === -own && !busy[p] && this.openFlank(t, p) && !(e.aiOverdue && !e.aiHasAtk)) { /* never an overdue first-timer: its first swing comes first */ this.stats.coAtkX = (this.stats.coAtkX || 0) + 1; return { side: p, dz: 0, flank: true }; } }
    if (!this.v12Side && e.aiFlank && e.aiFlank.h === t.id && e.aiFlank.side === -own && !busy[-own] && this.openFlank(t, -own)) { this.stats.flankX = (this.stats.flankX || 0) + 1; return { side: -own, dz: 0, flank: true }; }
    if (!busy[own]) return { side: own, dz: 0 };
    // C2 r3: an overdue foe that has never swung doesn't go round (a 3–5 s detour) or hand its turn back: it queues one lane back
    // on its own side and steps in when that flank clears
    if (e.aiOverdue && !e.aiHasAtk && !this.noFirstDue && !this.noFirstQueue) { this.stats.firstQueue = (this.stats.firstQueue || 0) + 1; return { side: own, dz: 0, queue: far[own] + XSEP }; }
    // Co-op (r5): the space round each hero is shared with the other hero's crowd, and a flanking run crosses one
    // hero's screen column and often the other's too, so with 2+ heroes a foe never crosses: it yields its turn.
    if (!busy[-own] && this.heroes().length > 1) return { side: own, dz: 0, yield: true };
    if (!busy[-own]) {
      // r5: crossing to the free flank walks through the hero's screen column. If an uncommitted ally already waits on
      // that flank, hand over instead (yield: the kit releases the token so the ally takes the next one).
      const tk = this.ai.tokens;
      for (const o of this.engaged()) {
        if (o === e || o.aiTarget !== t || (tk && tk.has(o)) || (o.fsm && o.fsm.is(...NOPUSH, 'hitstun', 'down', 'getup', 'knockdown'))) continue;
        const ox = (o.pos.x - t.pos.x) * -own;
        if (ox > 0.6 && ox < 4.6 && Math.abs(o.pos.z - t.pos.z) < 3.0) return { side: own, dz: 0, yield: true }; // r8: waiting rows sit ~2.3 m off the hero's row
      }
      return { side: -own, dz: 0 };
    }
    // Both flanks taken (r5): queue one screen-x lane behind the foe already on the flank (no depth stacking) and
    // step in once it clears. queue = minimum |x| from the hero for this attacker.
    const side = busy[own] <= busy[-own] ? own : -own;
    return { side, dz: 0, queue: far[side] + XSEP, yield: true };
  }

  /** C2 r3: can a foe fight hero t from side sd? Its strike spot (1.1 m out) and a waiting spot FLANK_MIN out are inside the frame
   *  (EDGE_IN), the hero is not pinned on that side (PIN_SIDE: the attack veto would refuse the swing), and no other hero stands
   *  in that flank (his own fight is there). */
  openFlank(t, sd, x0 = FLANK_MIN) {
    const vr = viewRange(this.game, t.pos.z), x = t.pos.x + sd * x0;
    if (x < vr.xMin + EDGE_IN || x > vr.xMax - EDGE_IN) return false;
    if (this.pinnedSide(t, this.pinSide ?? PIN_SIDE) === sd) return false;
    for (const o of this.heroes()) {
      if (o === t || Math.abs(o.pos.z - t.pos.z) > 2.4) continue;
      const ox = (o.pos.x - t.pos.x) * sd;
      if (ox > 0.3 && ox < x0 + 1.6) return false;
    }
    return true;
  }

  /** Is side `side` of hero t already used by another committed foe? (token-free specials: leaps, dashes) */
  sideBusy(e, t, side) {
    for (const o of this.committed(t, e)) if (Math.sign(o.pos.x - t.pos.x) === side && Math.abs(o.pos.x - t.pos.x) < 2.0) return true;
    return false;
  }

  /** Two fighters cannot bracket two heroes at once. After BOTH have taken their first swing, a small pack focuses one
   *  hero for a bounded beat, then changes pressure to the partner. This replaces permanent two-duel splitting while
   *  retaining strike/heat caps, open-flank/pinned checks and downed-hero space. Never runs in a boss encounter. */
  pairFocus(es, hs) {
    const g = this.game;
    if (this.r16Off || this.noPairFocus || hs.length !== 2 || es.length !== 2 || es.some(e => !e.aiHasAtk || e.kind === 'mount')
      || g.world.query({ team: 'enemies' }).some(e => e.alive && !e.removed && e.kind === 'boss')) { this._pair = null; return null; }
    const ids = es.map(e => e.id).sort((a,b) => a-b).join('/'), now = g.tick;
    const cost = h => Math.max(...es.map(e => Math.abs(e.pos.x-h.pos.x) + Math.abs(e.pos.z-h.pos.z)*.5));
    const ok = h => cost(h) < 8 && this.openFlank(h, -1) && this.openFlank(h, 1);
    let p = this._pair, h = p && hs.find(h => h.id === p.h);
    const hold = h && cost(h) < 11 && this.openFlank(h, -1) && this.openFlank(h, 1);
    if (!p || p.ids !== ids || !h || !hold || now >= p.until) {
      const choices = hs.filter(ok).sort((a,b) => (cost(a) + this.heat(a)*2 + (p && p.h === a.id ? 3 : 0)) - (cost(b) + this.heat(b)*2 + (p && p.h === b.id ? 3 : 0)));
      h = (p && p.ids === ids && now >= p.until && choices.find(h => h.id !== p.h)) || choices[0];
      if (!h) { this._pair = null; return null; }
      p = this._pair = { ids, h: h.id, until: now + (this.pairT ?? 480) };
      this.stats.coPair = (this.stats.coPair || 0) + 1;
    }
    return h;
  }

  /** Co-op split + slot assignment. */
  assign() {
    const g = this.game, hs = this.heroes(), es = this.engaged();
    this._nh = hs.length; this._bossEncounter = g.world.query({team:'enemies'}).some(e => e.alive && e.kind === 'boss');
    if (!hs.length) return;
    const dist = (e, h) => Math.abs(h.pos.x - e.pos.x) + Math.abs(h.pos.z - e.pos.z) * 0.5;
    const by = new Map(hs.map((h) => [h.id, []]));
    const focus = this.pairFocus(es, hs);
    for (const e of es) {
      let t = e.aiTarget && by.has(e.aiTarget.id) ? e.aiTarget : null;
      const aggro = e.aiAggroT != null && g.tick - e.aiAggroT < 90 && t && e.aiCo && t.id !== e.aiCo.h; // a hit from the other hero turned it on him (C2 r2 aggro): that wins
      if (!this.noCoSide && hs.length > 1 && e.aiCo && by.has(e.aiCo.h) && !aggro) t = g.world.byId.get(e.aiCo.h); // C2 r15: the flank plan's hero is sticky
      else if (!this.noCoSide && hs.length > 1 && !(e.fsm && e.fsm.is('enter') && e.enterTarget && !e.enterTarget._laned)) t = this.coLate(e, hs) || t; // C2 r15: no plan yet (not an edge walk-in)
      if (!this.r16Off && !focus && t && hs.length > 1 && e.aiCoX == null && e.fsm && !e.fsm.is('enter', 'attack')) {
        const near = hs.reduce((a, h) => dist(e, h) < dist(e, a) ? h : a, t);
        if (dist(e, t) > 5.5 && dist(e, near) + 2 < dist(e, t)) {
          if (this.ai.tokens) this.ai.tokens.release(e);
          t = near; e.aiCo = { h: t.id, side: Math.sign(e.pos.x - t.pos.x) || 1, t: g.tick, late: true };
          this.stats.coNear = (this.stats.coNear || 0) + 1;
        }
      }
      // C2 r3: its hero is now across the partner (the heroes moved past each other) → the nearer hero, unless it just got hit
      const home = !this.r16Off && e.aiCoHome && t && e.aiCoHome.h === t.id && e.aiCoHome.until > g.tick && dist(e, t) < 5;
      if (t && hs.length > 1 && !focus && !home && (this.r16Off || e.aiCoX == null) && !(e.aiAggroT != null && g.tick - e.aiAggroT < 90) && this.across(e, t, e.aiCo && !this.noCoSide ? 1.2 : 0.3) && !(e.fsm && e.fsm.is('attack'))) { if (this.ai.tokens) this.ai.tokens.release(e); t = null; this.stats.acrossRe = (this.stats.acrossRe || 0) + 1; }
      if (focus && e.fsm && !e.fsm.is('attack')) {
        if (t !== focus) {
          if (this.ai.tokens) this.ai.tokens.release(e);
          const old = this._coX && t && this._coX.get(t.id); if (old && old.id === e.id) this._coX.delete(t.id);
          e.aiCoX = null; e.aiCoHome = null; e.aiCoNo = null;
          e.aiCo = { h: focus.id, side: !this.v16Bal && e.aiCoDuty?.pending ? e.aiCoDuty.side : Math.sign(e.pos.x - focus.pos.x) || 1, t: g.tick };
          this.coEv(e, 'pair');
        }
        t = focus;
      }
      if (!t) { t = hs[0]; for (const h of hs) if (dist(e, h) < dist(e, t)) t = h; }
      e.aiTarget = t; by.get(t.id).push(e);
      this.coKeep(e, t, hs);
    }
    // Balance: while one hero has ≥ 2 more attackers than another, hand over the one that is relatively closest.
    if (hs.length > 1 && !focus) {
      for (let guard = 0; guard < 8; guard++) {
        const sorted = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
        const [hiId, hiL] = sorted[0], [loId, loL] = sorted[sorted.length - 1];
        if (hiL.length - loL.length < 2) break;
        const lo = g.world.byId.get(loId), hi = g.world.byId.get(hiId);
        hiL.sort((a, b) => (dist(a, lo) - dist(a, hi)) - (dist(b, lo) - dist(b, hi)));
        // r5: never hand over a foe that would have to walk through its old hero's screen column to reach the new one.
        const keepHome = (f) => !this.r16Off && ((f.aiCoHome && f.aiCoHome.h === hi.id && f.aiCoHome.until > g.tick) || dist(f, lo) > 5.5 || (f.fsm && f.fsm.is('attack')));
        const k = hiL.findIndex((f) => !keepHome(f) && !((hi.pos.x - f.pos.x) * (lo.pos.x - hi.pos.x) > 0 && Math.abs(hi.pos.x - f.pos.x) > 0.3) && !(f.aiAggroT != null && g.tick - f.aiAggroT < 90 && !this.noAggro) && !f.aiFlank && (f.aiCoX == null || this.v15Bal)); // C2 r16: never the co-op crosser
        if (k < 0) break;
        let k2 = k;
        if (!this.v15Bal && !this.noCoSide) { // C2 r16 side-aware hand-over: keep the giver two-sided, give the taker a new flank
          const ok = (f) => !keepHome(f) && !((hi.pos.x - f.pos.x) * (lo.pos.x - hi.pos.x) > 0 && Math.abs(hi.pos.x - f.pos.x) > 0.3) && !(f.aiAggroT != null && g.tick - f.aiAggroT < 90 && !this.noAggro) && !f.aiFlank && f.aiCoX == null;
          const sideOf = (o, h) => Math.sign(o.pos.x - h.pos.x) || 1;
          let bc = Infinity;
          hiL.forEach((f, i) => {
            if (!ok(f)) return;
            const rest = hiL.filter((q) => q !== f), rs = new Set(rest.map((q) => sideOf(q, hi))), ls = new Set(loL.map((q) => sideOf(q, lo)));
            const c = (dist(f, lo) - dist(f, hi)) + (rest.length >= 2 && rs.size < 2 ? 3 : 0) + (loL.length && ls.has(sideOf(f, lo)) && ls.size < 2 ? 3 : 0);
            if (c < bc) { bc = c; k2 = i; }
          });
        }
        const mv = hiL.splice(k2, 1)[0]; loL.push(mv); mv.aiTarget = lo; this.coKeep(mv, lo, hs);
      }
    }
    if (!this.noCoSide && !this.noCoRebal && hs.length > 1) { if (this.v15Bal) this.coRebal(es, hs); else this.coFlank(es, hs); } // C2 r16: coFlank (director.v15Bal = r15 coRebal)
    // coSwap can hand a gap foe to the other hero; its slot must follow that decision on THIS pass.
    if (!this.r16Off) { for (const list of by.values()) list.length = 0; for (const e of es) if (e.aiTarget && by.has(e.aiTarget.id)) by.get(e.aiTarget.id).push(e); }
    // Slots: token holders first, then nearest; cost = distance to the slot point + a crossing penalty.
    const tk = this.ai.tokens;
    const rowZs = []; // c1r9: absolute z of every waiter's row assigned so far this pass, across BOTH heroes in co-op
    for (const [hid, list] of by) {
      const h = g.world.byId.get(hid);
      list.sort((a, b) => ((tk && tk.has(b)) - (tk && tk.has(a))) || dist(a, h) - dist(b, h));
      const used = new Set();
      const side = { 1: 0, '-1': 0 };
      const R = this.rows(h), rowN = { m: 0, a: 0, b: 0 }; // r8: depth rows + how many waiters already stand on each
      const cells = new Map(); // r8: 'side|row' → looks already standing there (two same-colour foes side by side read as one body)
      const look = (e) => e.typeId + '|' + (e.tier || '');
      let holders = 0;
      for (const e of list) {
        const sp = (e.def.ai && e.def.ai.spacing) || 2.2;
        const holder = tk && tk.has(e);
        let best = -1, bc = Infinity;
        const prev = e.aiSlot ? e.aiSlot.i ?? SLOTS.indexOf(e.aiSlot) : -1, prevRow = e.aiSlot && e.aiSlot.row, costs = [];
        SLOTS.forEach((s, i) => {
          if (used.has(i)) return;
          // 2nd token holder: forced to the opposite side of the 1st (both flanks attack; one swing can't sweep both).
          if (holder && holders === 1 && side[s.side] > 0) return;
          const px = h.pos.x + s.side * sp * s.ring, pz = s.row === 'm' ? h.pos.z : R[s.row + 'z'];
          const cross = !holder && Math.sign(e.pos.x - h.pos.x) !== s.side && Math.abs(e.pos.x - h.pos.x) > 0.6 ? (this.crossCost ?? (this.v9Cross ? 2.2 : this.round() ? 3.5 : 9)) : 0; // r6 A/B: 5 (fewer side swaps) measured worse, packing goes infeasible
          const vr = viewRange(g, pz), off = px < vr.xMin + 2.0 || px > vr.xMax - 2.0 ? 8 : 0; // never park off-frame
          // Waiting foes balance the flanks too (a crowd on one side only reads as a queue).
          const bal = holder ? 0 : side[s.side] * 1.3;
          // Co-op (r5): the gap between two heroes belongs to the attackers; waiting foes wrap round the outside.
          const coS = !this.noCoSide && hs.length > 1 && e.aiCo && e.aiCo.h === h.id ? e.aiCo.side : 0; // C2 r15: its flank-plan side
          const coC = coS && s.side !== coS ? this.coSlotCost ?? 6 : 0;
          const betw = coS === s.side ? 0 : !holder && hs.some((o) => o !== h && Math.sign(o.pos.x - h.pos.x) === s.side && Math.abs(o.pos.x - h.pos.x) < 7) ? 2.5 : 0;
          // r8: waiters spread over the depth rows (a crowd sharing one row is the conga line), the hero's row is for strikers
          // r8 stickiness: a waiter keeps its row (each row change is a 2–4 m walk across the fight)
          // c1r9 co-op: the balance counts waiters of EVERY hero standing near that row's depth (critic r8: each hero's
          // lone waiter picked the same front row → the whole co-op crowd on one band)
          const nRow = this.noGlobalRows ? rowN[s.row] : rowZs.reduce((n, z) => n + (Math.abs(z - pz) < 1.2), 0);
          const rowBal = holder ? 0 : nRow * (this.rowBal ?? 1.7) + (s.row === 'm' ? this.rowMid ?? 2.5 : 0) + (prevRow && prevRow !== s.row ? this.rowStick ?? 1.8 : 0);
          const twin = !holder && (cells.get(s.side + '|' + s.row) || '').includes(look(e) + ';') ? this.twinCost ?? 2.2 : 0;
          // c1r9: a waiter's walk to another depth row is weighted less (×rowZW) than a holder's (×1.3): at 1.3 a free
          // row 4 m away cost ~5 m vs a row-balance of 1.7, so every waiter piled onto the rows nearest the heroes
          const c = Math.hypot(px - e.pos.x, (pz - e.pos.z) * (holder ? 1.3 : this.rowZW ?? (this.v8Kit ? 1.3 : 0.6))) + cross + off + bal + betw + rowBal + twin + coC + i * 0.25;
          costs[i] = c;
          if (c < bc) { bc = c; best = i; }
        });
        // r5 hysteresis: keep the current slot unless another is clearly better (slot shuffles walk bodies through
        // each other's screen column).
        if (prev >= 0 && best >= 0 && prev !== best && costs[prev] !== undefined && costs[prev] < bc + 0.9) best = prev;
        if (best < 0) best = SLOTS.findIndex((s, i) => !used.has(i));
        if (best < 0) best = 0;
        used.add(best);
        side[SLOTS[best].side]++;
        if (holder) holders++; else { rowN[SLOTS[best].row]++; rowZs.push(SLOTS[best].row === 'm' ? h.pos.z : R[SLOTS[best].row + 'z']); }
        { const ck = SLOTS[best].side + '|' + SLOTS[best].row; cells.set(ck, (cells.get(ck) || '') + look(e) + ';'); }
        e.aiSlot = { ...SLOTS[best], dz: R[SLOTS[best].row], z: SLOTS[best].row === 'm' ? undefined : R[SLOTS[best].row + 'z'], i: best, src: 'slot', co: !this.noCoSide && hs.length > 1 && !!e.aiCo && e.aiCo.h === h.id && e.aiCo.side === SLOTS[best].side };
      }
      // r5 screen-x lanes: turn the chosen slots into concrete x distances per flank, innermost ring first, each at
      // least XSEP+0.05 outside the previous one whatever the foe types' own spacing (knight 2.6 vs grunt 2.2 used
      // to put a knight's front slot and a grunt's depth slot in the same column).
      for (const sd of [1, -1]) {
        const mine = list.filter((e) => e.aiSlot && e.aiSlot.side === sd && !(tk && tk.has(e)))
          .map((e) => ({ e, x: ((e.def.ai && e.def.ai.spacing) || 2.2) * e.aiSlot.ring }))
          .sort((p, q) => p.x - q.x);
        let last = -Infinity;
        for (const m of mine) {
          const x = Math.max(m.x, last + XSEP + 0.05);
          last = x;
          m.e.aiSlot = { ...m.e.aiSlot, x };
        }
      }
    }
    this.lanes(es, hs);
  }

  /** c1r10 SCREEN SLOT RESERVATION (replaces the r5–c1r9 waiting-lane packing; director.v9Pack = true restores it).
   *  Critic r9: foes fused on 11–14 % of co-op contact frames although no two stood closer than 1 m in the world — they
   *  lined up along the camera's view ray. Everything here is in perspective-true screen x (sx), at every depth:
   *   - reserved columns: each hero ±waitX (its strike columns + the lane its struck foes reel into), every busy body
   *     (attacker, swinger, reeling foe — where it will slide in ~0.35 s —, downed foe) ±FREE_R;
   *   - the free gaps between them, clipped ≥ EDGE_IN inside the frame, are where waiters stand. A waiter stays in the gap
   *     it stands in (moving to another gap = walking through a body); one standing inside a reserved column goes to the
   *     gap on its own side of that hero (never through him) or the nearer edge of a body's column;
   *   - in each gap the waiters keep their screen order and are packed ≥ GAP apart as near their slot (ring / row) goals
   *     as fits; a gap with no room in the frame (a hero at the frame edge) hands its waiters to the next gap inward.
   *  Writes each waiter's slot (side, x) — the kit walks there through its own free gap (freeSpot). */
  place(W, F, hs, GAP) {
    if (!W.length) return;
    const need = this.wx(), R = this.freeR ?? FREE_R, DZS = this.dzSep ?? DZ_SEP, st = this.stats;
    const B = [];
    for (const h of hs) {
      const c = this.sx(h.pos.x, h.pos.z);
      let lo = c - need, hi = c + need;
      // C2 r1 solo: the camera often clamps the hero at 60–90 % of the frame; at the full stand-off his outer side then had no
      // room at all and every waiter queued on one flank (board: 'five foes on the hero's right … a line-up'). That side's
      // band shrinks (down to SOLO_TIGHT) so a waiter still fits there with a body width to spare inside the frame.
      // C2 r3 CO-OP: the same shrink, but a cramped outer side holds ONE waiter (all depth rows together, `crN` below): the rest
      // overflow round into the middle, so a hero near the edge has foes on both sides (board r12 flank.one2 69–100 %; A/B: with
      // room for one per row the whole crowd parked on the outer sides, one2 79–90 %; with none (r12) it all went to the middle)
      const cramp = { 1: false, '-1': false };
      if ((hs.length === 1 ? this.round() : !this.noCramp) && !this.noFlankBal) {
        const vr = viewRange(this.game, h.pos.z), FL = this.sx(vr.xMin + EDGE_IN, h.pos.z), FR = this.sx(vr.xMax - EDGE_IN, h.pos.z);
        if (FR - c < need + 0.9) { hi = c + Math.max(SOLO_TIGHT, Math.min(need, FR - c - 0.9)); cramp[1] = true; }
        if (c - FL < need + 0.9) { lo = c - Math.max(SOLO_TIGHT, Math.min(need, c - FL - 0.9)); cramp[-1] = true; }
      }
      B.push({ lo, hi, c, x: h.pos.x, z: h.pos.z, hero: true, h, cramp });
    }
    for (const f of F) {
      const o = f.e, down = o && o.fsm && o.fsm.is('down', 'knockdown', 'getup');
      let lo = f.s - R, hi = f.s + R;
      if (o && o.fsm && o.fsm.is('hitstun', 'knockdown') && o.vel) { const la = o.fsm.is('knockdown') ? this.downLook ?? 0.9 : 0.35, s1 = this.sx(o.pos.x + (o.vel.x || 0) * la, o.pos.z + (o.vel.z || 0) * la); lo = Math.min(lo, s1 - R); hi = Math.max(hi, s1 + R); }
      if (down) { const dp = this.downPad ?? 0.8; lo -= dp; hi += dp; } // a body on the floor is ~1.8 m long on screen
      const h = o && (o.aiTarget || o.target); // a body fighting a hero shares that hero's contact box (±2 m depth)
      B.push({ lo, hi, c: f.s, x: o ? o.pos.x : this.unsx(f.s, f.z), z: f.z, z2: h && h.kind === 'hero' && Math.abs(h.pos.x - o.pos.x) < 4.5 ? h.pos.z : f.z });
    }
    for (const w of W) { w.cur = this.sx(w.e.pos.x, w.e.pos.z); w.hd = Math.min(...B.filter((b) => b.hero).map((b) => Math.abs(w.cur - b.c))); }
    W.sort((p, q) => p.hd - q.hd); // inner waiters first: they get the spots next to the fight
    // C2 r1 SOLO FLANK BALANCE (board C1 r10: solo waiters ~2/3 on one flank, five foes on one side reads as a line-up):
    // a spot on a side that already holds more placed waiters than the other costs FLANK_BAL per extra waiter, and a gap
    // across the hero is judged against the MIRRORED goal (same ring, other side), so going round wins once a side is
    // two waiters heavier. director.noFlankBal = true: off.
    const solo = hs.length === 1 && this.round() && !this.noFlankBal, hc0 = solo ? this.sx(hs[0].pos.x, hs[0].pos.z) : 0, sideN = { 1: 0, '-1': 0 };
    // C2 r3 CO-OP FLANK BALANCE (A/B director.coBal): the same balance per hero — its waiters + committed foes counted per side; a
    // waiter may go round ITS OWN hero only (never the partner), and only to a side openFlank() allows.
    const co = hs.length > 1 && !!this.coBal && !this.noFlankBal, coN = new Map(hs.map((h) => [h.id, { 1: 0, '-1': 0 }]));
    const crN = hs.length > 1 && !this.noCramp ? new Map(hs.map((h) => [h.id, { 1: 0, '-1': 0 }])) : null; // C2 r3: waiters placed on a hero's cramped side
    if (co) for (const f of F) { const o = f.e, h = o && o.aiTarget; if (h && coN.has(h.id) && o.fsm && !o.fsm.is('down', 'knockdown', 'getup')) coN.get(h.id)[Math.sign(o.pos.x - h.pos.x) || 1]++; }
    const placed = [];
    const rowZ = this._free && !this.noRowSwap ? { a: this._free.a, b: this._free.b } : null;
    for (const w of W) {
      const zc = w.e.pos.z, row0 = w.e.aiSlot && w.e.aiSlot.row;
      // candidate rows: its own, then (c1r10 "pick another row") the other waiting row
      const rows = [{ z: w.z, row: row0, pen: 0 }];
      if (rowZ && (row0 === 'a' || row0 === 'b')) { const o = row0 === 'a' ? 'b' : 'a'; if (Math.abs(rowZ[o] - w.z) > 0.5) rows.push({ z: rowZ[o], row: o, pen: (this.rowSwapCost ?? 1.2) + 0.25 * Math.abs(rowZ[o] - w.z) }); }
      let best = null, bc = Infinity, bz = null, g0 = [];
      for (const rw of rows) {
        const zr = rw.z, near = (z) => Math.abs(zr - z) < DZS || Math.abs(zc - z) < DZS; // until it stands on its row, judged at both depths
        // two bodies inside one hero's contact box (±BOX_X, ±BOX_Z) always need their own columns, whatever their depths
        const xs = [w.e.pos.x, this.unsx(w.sd, zr)], boxes = hs.filter((h) => Math.abs(zr - h.pos.z) < BOX_Z && xs.some((x) => Math.abs(x - h.pos.x) < BOX_X));
        const shared = (x, z) => boxes.some((h) => Math.abs(x - h.pos.x) < BOX_X && Math.abs(z - h.pos.z) < BOX_Z);
        const iv = [];
        for (const b of B) if (near(b.z) || (b.z2 != null && near(b.z2)) || shared(b.x, b.z)) iv.push([b.lo, b.hi]);
        for (const p of placed) if (near(p.z) || near(p.zc) || shared(p.x, p.z)) iv.push([p.s - GAP, p.s + GAP]);
        const FL = this.sx(w.vr.xMin + EDGE_IN, zr), FR = this.sx(w.vr.xMax - EDGE_IN, zr);
        iv.sort((p, q) => p[0] - q[0]);
        const M = [];
        for (const v of iv) { const L = M[M.length - 1]; if (L && v[0] <= L[1]) L[1] = Math.max(L[1], v[1]); else M.push(v.slice()); }
        const gaps = [];
        let lo = FL;
        for (const m of M) { if (m[1] <= FL) continue; if (m[0] >= FR) break; if (m[0] > lo) gaps.push([lo, m[0]]); lo = Math.max(lo, m[1]); }
        if (lo < FR) gaps.push([lo, FR]);
        if (rw === rows[0]) g0 = gaps;
        // never across a hero standing within DZS of the waiter's depth now or at that row (the walk goes through his fight)
        const za = Math.min(zc, zr), zb = Math.max(zc, zr), span = (z) => (z < za ? za - z : z > zb ? z - zb : 0) < DZS; // any depth the walk passes
        const walls = B.filter((b) => b.hero && span(b.z) && Math.abs(w.cur - b.c) > 0.3);
        const obst = [...B.filter((b) => !b.hero && (span(b.z) || (b.z2 != null && span(b.z2)))), ...W.filter((o) => o !== w && span(o.e.pos.z)).map((o) => ({ c: o.cur }))];
        const sd = this.sx(this.unsx(w.sd, w.z), zr), hcW = co ? this.sx(w.h.pos.x, w.h.pos.z) : hc0, nW = co ? coN.get(w.h.id) : sideN;
        const coP = !this.noCoSide && hs.length > 1 && w.e.aiCo && w.e.aiCo.h === w.h.id ? w.e.aiCo.side : 0, hcP = coP ? this.sx(w.h.pos.x, w.h.pos.z) : 0; // C2 r15: its plan side
        for (const gp of gaps) {
          let goal = sd;
          if (solo || co) {
            const gs = Math.sign((gp[0] + gp[1]) / 2 - hcW), ss = Math.sign(sd - hcW);
            if (gs && ss && gs !== ss) goal = 2 * hcW - sd;
            goal = Math.max(FL, Math.min(FR, goal)); // a ring that doesn't fit in the frame on this side costs nothing extra (it just stands nearer)
          }
          const s = Math.max(gp[0], Math.min(gp[1], goal));
          if (crN) { const hb = B.find((b) => b.hero && b.h === w.h), sd2 = hb ? Math.sign(s - hb.c) || 1 : 0; if (hb && hb.cramp[sd2] && crN.get(w.h.id)[sd2] >= 1) continue; } // C2 r3: cramped outer side full
          // going round a hero = a depth detour behind / in front of his fight (kit: depth first, ≥ 2.5 m off his row),
          // allowed when this side is crowded (cost wallCost per hero rounded, plus the detour's bodies)
          const nw = walls.filter((b) => Math.sign(s - b.c) !== Math.sign(w.cur - b.c)).length;
          if (coP && (Math.sign(s - hcP) || 1) !== coP) continue; // C2 r15: never park on the hero's other flank
          if (nw && coP) { const cr = walls.filter((b) => Math.sign(s - b.c) !== Math.sign(w.cur - b.c)); if (nw > 1 || cr[0].h !== w.h) continue; } // …going round its OWN hero to get there is allowed (depth first)
          else if (nw && co) { const cr = walls.filter((b) => Math.sign(s - b.c) !== Math.sign(w.cur - b.c)); if (nw > 1 || cr[0].h !== w.h || !this.openFlank(w.h, Math.sign(s - hcW) || 1)) continue; }
          else if (nw && (!this.round() || nw > 1)) continue; // A/B director.roundOk (measured: solo fused 20.6 → 26.3 %, off by default)
          const pass = nw ? 0 : obst.filter((o) => (o.c - w.cur) * (o.c - s) < 0 && Math.abs(o.c - w.cur) > 0.3).length;
          const sg = Math.sign(s - hcW) || 1, bal = solo || co ? (this.flankBal ?? FLANK_BAL) * Math.max(0, nW[sg] - nW[-sg]) : 0;
          const c = Math.abs(s - goal) + (this.passCost ?? 2.5) * pass + rw.pen + nw * (this.wallCost ?? 3.0) + bal;
          if (c < bc) { bc = c; best = s; bz = rw; w.round = nw > 0; }
        }
      }
      w.cross = !!(best != null && w.round);
      if (w.cross) st.placeRound = (st.placeRound || 0) + 1;
      if (best == null) { // no free spot on its side in the frame on either row: the nearest free spot on its row (it goes round)
        const zr = w.z, FL = this.sx(w.vr.xMin + EDGE_IN, zr), FR = this.sx(w.vr.xMax - EDGE_IN, zr);
        bz = rows[0];
        const hbF = crN ? B.find((b) => b.hero && b.h === w.h) : null, full = (x) => !!(hbF && hbF.cramp[Math.sign(x - hbF.c) || 1] && crN.get(w.h.id)[Math.sign(x - hbF.c) || 1] >= 1); // C2 r3
        const coS = !this.noCoSide && w.e.aiCo && w.e.aiCo.h === w.h.id ? w.e.aiCo.side : 0, hcF = this.sx(w.h.pos.x, w.h.pos.z); // C2 r15: never overflow across to the hero's other flank
        for (const gp of this.noPlaceCross ? [] : g0) { const x = Math.max(gp[0], Math.min(gp[1], w.sd)), c = Math.abs(x - w.cur); if (full(x) || (coS && (Math.sign(x - hcF) || 1) !== coS)) continue; if (c < bc) { bc = c; best = x; } }
        if (best != null) { w.cross = true; st.placeCross = (st.placeCross || 0) + 1; }
        else { best = Math.max(Math.min(FL, FR), Math.min(Math.max(FL, FR), w.sd)); st.placeOvf = (st.placeOvf || 0) + 1; }
      }
      if (bz.row !== row0) { st.rowSwap = (st.rowSwap || 0) + 1; w.z = bz.z; w.e.aiSlot = { ...w.e.aiSlot, row: bz.row, z: bz.z, dz: bz.z - w.h.pos.z }; }
      w.s = best;
      placed.push({ s: best, z: w.z, zc, x: this.unsx(best, w.z) });
      if (crN && best != null) { const hb = B.find((b) => b.hero && b.h === w.h); if (hb) crN.get(w.h.id)[Math.sign(best - hb.c) || 1]++; }
      if (solo) sideN[Math.sign(best - hc0) || 1]++;
      else if (co) coN.get(w.h.id)[Math.sign(best - this.sx(w.h.pos.x, w.h.pos.z)) || 1]++;
    }
    for (const w of W) {
      const r = this.unsx(w.s, w.z) - w.h.pos.x;
      w.e.aiSlot = { ...w.e.aiSlot, side: Math.sign(r) || w.e.aiSlot.side, x: Math.abs(r), cross: !!w.cross, src: w.cross ? 'placeX' : 'place', co: !this.noCoSide && !!w.e.aiCo && w.e.aiCo.h === w.h.id };
    }
  }

  /** Waiting-goal lane pass (every assign, and c1r10 every 5 ticks between: the heroes keep moving). */
  lanes(es = this.engaged(), hs = this.heroes()) {
    const g = this.game, tk = this.ai.tokens;
    if (!hs.length) return;
    // Global lane pass (r5, r6 in perspective-true screen x): relax every waiting foe's goal apart from every other
    // waiting goal, from every body that is busy fighting (token holders, swingers, reeling foes: fixed obstacles) and
    // from each hero's strike columns — judged as the player sees it (sx), since at the frame edges two goals 1 m apart
    // in world x at different depths land in one screen column. Then write the distances back into the slots.
    const W = [], F = [], GAP = this.laneGap ?? XSEP + 0.05;
    for (const e of g.world.query({ team: 'enemies' })) {
      if (e.removed || !e.alive || e.kind === 'boss' || e.pos.y > 0.8 || (e.fsm && e.fsm.is(...NOPUSH))) continue;
      const h = e.aiTarget, sl = e.aiSlot;
      const waiting = es.includes(e) && h && sl && sl.x != null && !(tk && tk.has(e)) && !(e.fsm && e.fsm.is('attack', 'hitstun', 'knockdown', 'down', 'getup', 'block', 'enter')) && !e.aiFlank; // C2 r3: a flanker's goal is flankPass's
      // r6: a waiter holding its spot (its walk was blocked) is a fixed body for this pass, not a movable goal
      // (c1r9: unless it is holding off-frame — it then walks in, so its goal stays movable)
      if (!waiting && !this.v9Pack && e.fsm && e.fsm.is('enter') && offFrame(g, e, 0)) continue; // c1r10: an arrival still off-screen reserves no screen column
      if (!waiting || (!this.noHoldFix && this.v9Pack && g.tick - (e.aiHold ?? -99) < 20 && (this.v8Kit || this.v8Walk || this.noOutWalk || !offFrame(g, e)))) { F.push({ s: this.sx(e.pos.x, e.pos.z), z: e.pos.z, e }); continue; }
      const z = sl.z ?? h.pos.z + sl.dz, vr = viewRange(g, z);
      // c1r10 no-cross: the desired spot is on the side of its hero the waiter stands on now (the kit refuses to walk
      // through the hero anyway; a goal across it only made the packing and the walk disagree)
      const ps = Math.sign(e.pos.x - h.pos.x), side = !this.noCoSide && hs.length > 1 && e.aiCo && e.aiCo.h === h.id ? e.aiCo.side : !this.v9Cross && !this.round() && ps && Math.abs(e.pos.x - h.pos.x) > 0.35 ? ps : sl.side;
      W.push({ e, h, z, vr, sd: this.sx(h.pos.x + side * sl.x, z) });
    }
    if (!this.v9Pack) { this.place(W, F, hs, GAP); this.flankPass(es, hs); return; }
    let worst = Infinity;
    if (W.length) {
      const need = this.wx(); // r6: clear of the attackers' strike columns (~1.1 m), not just the hero's
      const H = hs.map((o) => ({ s: this.sx(o.pos.x, o.pos.z), z: o.pos.z }));
      // c1r9 DEPTH-AWARE PACKING: waiters on rows ≥ ZVIS apart in depth are separate silhouettes on screen (one stands
      // a band above the other), so they don't compete for the same x lanes. Co-op (critic r8: 2 heroes' strike bands
      // + attackers filled the 16 m frame, the outer waiters were packed past the frame edge) now gets one x packing
      // per depth group: twice the room, and no waiter is ever parked off-frame.
      const byZ = [...W].sort((p, q) => p.z - q.z), groups = [];
      for (const w of byZ) { const G = groups[groups.length - 1]; if (G && w.z - G[G.length - 1].z < (this.rowSplit ?? ZVIS)) G.push(w); else groups.push([w]); }
      for (const G of (this.noDepthPack || !this.v9Pack ? [W] : groups)) { // c1r10: one screen packing for all depths (pairs on rows 2–3 m apart still overlap on screen)
        const zlo = Math.min(...G.map((w) => w.z)), zhi = Math.max(...G.map((w) => w.z));
        const near = (z) => this.noDepthPack || !this.v9Pack || (z > zlo - ZVIS && z < zhi + ZVIS); // c1r10: every hero keeps its full strike band at every depth (a far-row waiter 1.2 m from the hero stood exactly where struck foes reel)
        // 1D packing in screen x: forbidden bands round each hero (strike columns; a hero far off this group's depth
        // only keeps its own column + a margin) and each busy body at this depth, merged; waiters placed left→right in
        // desired order (snapping to the nearer edge of a band), then right→left against the frame.
        const M = [];
        const bands = [...H.map((o) => { const r = near(o.z) ? need : HCOL + 0.45; return [o.s - r, o.s + r, 1]; }), ...F.filter((f) => near(f.z)).map((f) => [f.s - GAP, f.s + GAP, 0])];
        for (const iv of bands.sort((p, q) => p[0] - q[0])) {
          const L = M[M.length - 1];
          if (L && iv[0] <= L[1]) { L[1] = Math.max(L[1], iv[1]); L[2] |= iv[2]; } else M.push(iv);
        }
        const inBand = (x) => M.find((iv) => x > iv[0] + 1e-6 && x < iv[1] - 1e-6);
        // A band holding a hero is never jumped across (that walks the waiter through the hero and the fight): the
        // waiter keeps to its own side, packed tighter if it must.
        // c1r9: …unless the waiter's own side has no room inside the frame (a hero near the frame edge — critic r8: co-op
        // waiters squeezed against the left edge, half cut off): then it waits on the side that fits.
        const edge = (iv, x, from, pref, w) => {
          if (!iv[2]) return pref;
          let e2 = from < (iv[0] + iv[1]) / 2 ? iv[0] : iv[1];
          const o = e2 === iv[0] ? iv[1] : iv[0];
          if (w && !this.v8Kit && w.lo < w.hi && (e2 < w.lo || e2 > w.hi) && o >= w.lo && o <= w.hi) { e2 = o; this.stats.edgeFlip = (this.stats.edgeFlip || 0) + 1; }
          return e2;
        };
        // A full screen: the second pass packs against a tighter frame pad, still inside the frame (c1r9: was −0.6 m,
        // i.e. past the edge — critic r8 saw co-op waiters parked at the left frame edge).
        let gw = Infinity;
        for (const pad of [VIEWPAD, this.v8Kit || this.v8Clamp ? -0.6 : this.padMin ?? 1.0]) {
          for (const w of G) { w.s = w.sd; w.lo = this.sx(w.vr.xMin + pad, w.z); w.hi = this.sx(w.vr.xMax - pad, w.z); }
          G.sort((p, q) => p.s - q.s);
          let prev = -Infinity;
          for (const w of G) {
            let x = Math.max(w.s, prev + GAP);
            const iv = inBand(x);
            if (iv) x = edge(iv, x, w.s, iv[0] >= prev + GAP && x - iv[0] < iv[1] - x ? iv[0] : iv[1], w);
            if (w.lo < w.hi) x = Math.max(x, w.lo);
            w.s0 = w.s; w.s = prev = x;
          }
          let next = Infinity;
          for (let i = G.length - 1; i >= 0; i--) {
            const w = G[i];
            let x = Math.min(w.s, next - GAP);
            if (w.lo < w.hi) x = Math.min(x, w.hi);
            const iv = x < w.s ? inBand(x) : null;
            if (iv) x = edge(iv, x, w.s0, iv[0], w);
            w.s = next = x;
          }
          G.sort((p, q) => p.s - q.s);
          gw = Infinity;
          for (let i = 1; i < G.length; i++) gw = Math.min(gw, G[i].s - G[i - 1].s);
          if (gw >= GAP - 0.05) break;
          this.stats.waitOverflow = (this.stats.waitOverflow || 0) + (pad === VIEWPAD ? 1 : 0);
        }
        // never off-frame: the last word is the frame (a tight pair beats a waiter nobody can see)
        if (!this.v8Kit && !this.v8Clamp) for (const w of G) { const lo = this.sx(w.vr.xMin + 1.0, w.z), hi = this.sx(w.vr.xMax - 1.0, w.z); if (lo < hi) w.s = Math.max(lo, Math.min(hi, w.s)); }
        worst = Math.min(worst, gw);
        for (const w of G) for (const o of H) if (Math.abs(w.s - o.s) < need - 0.05) { const k = 'gInBand_' + (gw >= GAP - 0.05 ? 'ok' : 'ovf') + (Math.abs(w.s0 - o.s) < need - 0.05 ? '_s0' : '') + (Math.abs(w.sd - o.s) < need - 0.05 ? '_sd' : ''); this.stats[k] = (this.stats[k] || 0) + 1; }
      }
      this.stats.waitGap = worst;
      // r6 order-preserving hand-out: the k-th waiting foe from the left (on screen, now) takes the k-th goal from the
      // left, so waiting foes never walk through each other's columns to swap places.
      // r8: the hand-out runs per depth row (a foe on the front row never swaps rows just to keep the x order: that
      // walks it 4+ m across the fight); rows share the x packing above, so lanes stay distinct across rows too.
      const goals = new Map(W.map((w) => [w, { s: w.s, z: w.z, h: w.h, slot: w.e.aiSlot }]));
      const across = (w, gl) => { const a = this.sx(w.e.pos.x, w.e.pos.z); return H.some(({ s: hx }) => (a - hx) * (gl.s - hx) < 0 && Math.abs(a - hx) > 0.6); };
      const byRow = new Map();
      for (const w of W) { const r = (w.e.aiSlot && w.e.aiSlot.row) || 'm'; if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push(w); }
      const perm = new Map();
      for (const ws of byRow.values()) {
        const gs = ws.map((w) => goals.get(w)).sort((p, q) => p.s - q.s);
        [...ws].sort((p, q) => this.sx(p.e.pos.x, p.e.pos.z) - this.sx(q.e.pos.x, q.e.pos.z)).forEach((w, k) => perm.set(w, gs[k]));
      }
      // …unless that sends more of them across a hero than their own goals do (a walk through the whole fight).
      let nPerm = 0, nOwn = 0;
      for (const w of W) { nPerm += across(w, perm.get(w)); nOwn += across(w, goals.get(w)); }
      const keep = this.noOrder || (!this.permAlways && nPerm > nOwn);
      for (const w of W) {
        const gl = keep ? goals.get(w) : perm.get(w);
        const r = this.unsx(gl.s, gl.z) - gl.h.pos.x;
        w.e.aiTarget = gl.h;
        w.e.aiSlot = { ...gl.slot, side: Math.sign(r) || gl.slot.side, x: Math.abs(r), src: (keep ? 'pack' : 'perm') + (Math.sign(r) && Math.sign(r) !== gl.slot.side ? 'F' : '') + (gl.h !== w.h ? 'H' : '') };
      }
    }
    }

  /** C2 r3 FLANK WAITERS (co-op; board r12: with two foes on one hero they stood on the same side 69–100 % of the time — every
   *  waiter keeps the side of its hero it stands on, and in co-op the crowd gathers between the heroes). When all of a hero's
   *  standing foes are on one side and his other side has frame room (openFlank: not pinned there, partner not on it), ONE waiter
   *  goes round behind / in front of his fight (kit: depth detour first, then across) to stand FLANK_X out on the open side —
   *  the hero is sandwiched, the rest keep circling on their rows. The role ends on arrival (it is then an ordinary waiter on
   *  that side; a token on the way keeps it — attackSide sends it on round), after 5 s, or if the flank closes. Solo play has place()'s flank balance. director.noFlank: off. */
  flankPass(es, hs) {
    // C2 r15: the old gate tested `this.flankPass` = this METHOD (always truthy), so flankPass ran all through r14. With the co-op plan it
    // is off (director.flankOn = true: on); director.noCoSide keeps the r14 behaviour (on).
    if ((this.noCoSide ? false : !this.flankOn) || this.noFlank || hs.length < 2) { for (const e of es) if (e.aiFlank) e.aiFlank = null; return; } // A/B only (director.flankPass = true): measured worse — 1 of 6 flankers arrived, eh06 2.2 → 7.5 % (detours inside the hero's column)
    const g = this.game, tk = this.ai.tokens, tick = g.tick, st = this.stats;
    for (const h of hs) {
      const mine = es.filter((e) => e.aiTarget === h && e.fsm && !e.fsm.is(...NOPUSH, 'enter', 'down', 'knockdown', 'getup') && Math.abs(e.pos.x - h.pos.x) < 9 && !offFrame(g, e, 0.3));
      const fl = es.find((e) => e.aiFlank && e.aiFlank.h === h.id);
      if (fl) {
        const sd = fl.aiFlank.side, arrived = Math.sign(fl.pos.x - h.pos.x) === sd && Math.abs(fl.pos.x - h.pos.x) > 1.2;
        const open = this.openFlank(h, sd);
        if (open) fl.aiFlank.shut = null; else if (fl.aiFlank.shut == null) fl.aiFlank.shut = tick;
        const drop = arrived || fl.aiTarget !== h || tick - fl.aiFlank.t > 480 || !fl.alive || (!open && tick - fl.aiFlank.shut > 45); // a token on the way keeps the role (attackSide); a flank shut for 0.75 s ends it
        if (!drop) { this.flankSlot(fl, h, sd); continue; }
        if (arrived) st.flankArrive = (st.flankArrive || 0) + 1; else { fl.aiFlankNo = tick; st.flankDrop = (st.flankDrop || 0) + 1; }
        fl.aiFlank = null;
      }
      if (mine.length < 2) continue;
      const nL = mine.filter((e) => e.pos.x < h.pos.x - 0.3).length, nR = mine.filter((e) => e.pos.x > h.pos.x + 0.3).length;
      if (nL && nR) continue;
      const sd = nL ? 1 : -1;
      if (!this.openFlank(h, sd)) continue;
      // the flanker: a waiter of this hero (circling, in control, not just failed a flank), the one with the shortest way round
      let best = null, bc = Infinity;
      for (const e of mine) {
        if ((tk && tk.has(e)) || !e.controllable || !e.fsm.is('idle', 'walk') || !e.brain || e.brain.mode !== 'circle' || (e.aiFlankNo != null && tick - e.aiFlankNo < 300) || e.aiFlank) continue;
        const c = Math.abs(e.pos.x - h.pos.x) + (Math.abs(e.pos.z - h.pos.z) < 1.2 ? 1.5 : 0); // already off his row: a shorter detour
        if (c < bc) { bc = c; best = e; }
      }
      if (!best) continue;
      best.aiFlank = { h: h.id, side: sd, t: tick };
      st.flankGo = (st.flankGo || 0) + 1;
      this.flankSlot(best, h, sd);
    }
  }
  /** C2 r3: a flanker's waiting goal on side sd of hero h (as far as FLANK_X, never nearer than FLANK_MIN, EDGE_IN inside the frame). */
  flankSlot(e, h, sd) {
    const z = e.aiSlot && e.aiSlot.z != null ? e.aiSlot.z : h.pos.z, vr = viewRange(this.game, z);
    const room = (sd > 0 ? vr.xMax - EDGE_IN - h.pos.x : h.pos.x - vr.xMin - EDGE_IN) - 0.1;
    e.aiSlot = { ...(e.aiSlot || { ring: 1, dz: 0 }), side: sd, x: Math.max(FLANK_MIN, Math.min(FLANK_X, room)), cross: true, flank: true, src: 'flank' };
  }

  /** C2 r3 CROWD REACTIONS (board r12: reacts / dodges / braces 0 in both 2P stage probes — nobody flinched when an ally was
   *  floored or thrown; DESIGN crowd spec + the SoR4 reference): when a hero knocks down or throws a foe, up to two nearby allies
   *  in control react for a beat (C2 r3 final: up to 3 within 6 m; a token holder still walking in > 2.2 m out gets a short flinch / brace), nearest first — next to the body (< 2 m): FLINCH (guard up, half a step back) or STEP BACK;
   *  further out: BRACE (guard up), STEP BACK or RALLY (a roar / brandish). Each then re-engages fired up (its attack cooldown
   *  drops to a few ticks). Never a token holder, a swinger or a foe still owed its first attack (first-attack latency stays
   *  first), at most once per foe per 4 s. 'ai:react' { actor, order, from }. director.noAllyReact: off. */
  allyDown(v, by, why) {
    if (this.noAllyReact || !v || v.team !== 'enemies' || v.kind === 'boss' || (v.def && v.def.passive) || !by || by.kind !== 'hero') return;
    const g = this.game, tk = this.ai.tokens, rnd = () => (g.rng.next ? g.rng.next() : g.rng.range(0, 1));
    // token holders walking in (still > 2.2 m from their hero) react too, with a short beat (flinch / brace only)
    const busyTk = (e) => tk && tk.has(e) && !(e.target && Math.abs(e.target.pos.x - e.pos.x) > 2.2);
    const list = this.engaged().filter((e) => e !== v && e.controllable && e.fsm && e.fsm.is('idle', 'walk') && e.grounded !== false && e.pos.y < 0.1
      && (this.r16Off || (e.aiHasAtk && (e.aiIdleT || 0) < 150 && (this.v16React || (e.brain.cooldown || 0) > 12))) // the first swing has priority over any crowd pose
      && !(this.v16React ? busyTk(e) : tk?.has(e)) && !(e.aiOverdue && (!e.aiHasAtk || !this.v16React)) && !(e.aiReactT != null && g.tick - e.aiReactT < 180) && (e.aiCoX == null || !!this.v15Bal) /* C2 r16: not the co-op crosser mid-run */
      && Math.abs(e.pos.x - v.pos.x) < 6 && Math.abs(e.pos.z - v.pos.z) < 3.2 && !offFrame(g, e, 0.8))
      .sort((a, b) => Math.abs(a.pos.x - v.pos.x) - Math.abs(b.pos.x - v.pos.x));
    let n = 0;
    for (const e of list) {
      if (n >= (this.reactMax ?? 3)) break;
      n++; e.aiReactT = g.tick;
      const near = Math.abs(e.pos.x - v.pos.x) < 2.0, r = rnd(), walking = tk && tk.has(e);
      const order = !this.v16React && (why === 'throw' || v.vel?.y > 5) ? (near ? 'flinch' : 'back') : walking ? (near ? 'flinch' : 'brace') : near ? (r < 0.6 ? 'flinch' : 'back') : r < 0.45 ? 'brace' : r < 0.75 ? 'back' : 'rally';
      e.faceToward(by);
      if (this.v14React) { // r14 poses (A/B director.v14React)
        if (order === 'flinch') e.pause(13, { anim: 'blocked', face: false, vx: -1.3 });
        else if (order === 'brace') { e.braced = Math.max(e.braced || 0, 30); e.pause(walking ? 12 : 18, { anim: 'blocked', face: false }); }
        else if (order === 'back') e.pause(14, { anim: 'sidestep', face: false, vx: -2.3 });
        else e.pause(e.animator && e.animator.has && e.animator.has('taunt') ? 30 : 14, { anim: e.animator && e.animator.has && e.animator.has('taunt') ? 'taunt' : 'blocked', face: false });
      } else this.reactPose(e, v, by, order, walking);
      if (e.brain) e.brain.cooldown = Math.min(e.brain.cooldown ?? 99, 4 + Math.floor(rnd() * 10)); // re-engage fired up
      this.stats.reacts++; this.stats['react_' + order] = (this.stats['react_' + order] || 0) + 1; if (order === 'brace') this.stats.braces++;
      g.bus.emit('ai:react', { actor: e, order, from: v, by, why });
    }
  }

  /** C2 r15 READABLE REACTIONS (board r13: the brace / flinch read as a twitch next to a hero attack — 0.2–0.3 s of the 0.4 s guard
   *  clank): two beats from existing clips, slowed so they read at game distance in a 4 s clip.
   *    flinch (next to the body): recoil step back (sidestep clip at 0.45 s, ~0.8 m) → guard up, held (blocked at 0.7 s);
   *    back: a bigger step back (0.55 s, ~1.1 m) → guard held;  brace: guard held 0.75 s, a half step back;
   *    rally: turns to LOOK at the floored ally (0.3 s) → turns on the hero and roars (taunt).
   *  A token holder still walking in only gets the short guard (0.4 s). Each beat checks the foe is still free (not hit / grabbed). */
  reactPose(e, v, by, order, walking) {
    const g = this.game, free = () => e.alive && !e.removed && e.fsm && e.fsm.is('idle', 'walk', 'pause') && e.hitstop <= 0;
    const guard = (ticks, vx = 0) => { if (!free()) return; e.faceToward(by); e.braced = Math.max(e.braced || 0, ticks + 10); e.pause(ticks, { anim: 'blocked', face: false, vx, duration: ticks / 60 }); };
    if (!this.v16React && !this.r16Off && !this._bossEncounter && e.kind !== 'boss') {
      return this.crowdPose(e, by, order === 'rally' ? 'fear' : order === 'back' ? 'fear' : order === 'flinch' ? 'recoil' : 'brace');
    }
    if (!this.r16Off) {
      // An open-chested recoil with the weapon lowered, a whole step back, then a held high guard/brandish. Existing clips
      // and Animator's public sampling API make the silhouette readable without another procedural/render layer.
      e.faceToward(by);
      const n = walking ? 18 : 24;
      e.pause(n, { anim: 'hit_high', face: false, vx: -2.6, duration: 0.65 });
      g.after(n, () => {
        if (!free()) return;
        if (order === 'rally' && e.animator && e.animator.has('taunt')) {
          e.pause(30, { anim: 'taunt', face: false });
          e.play('taunt', { restart: true, startAt: 0.45, speed: 0.45, fade: 0.08 });
        } else {
          guard(walking ? 12 : 30);
          e.play('blocked', { restart: true, startAt: 0.1, speed: 0.18, fade: 0.06 });
        }
      });
      return;
    }
    // C2 r16 (board r14: 'understated at the game camera'): every reaction starts with a visible body read from the rig's procedural
    // layers (anim/RigPost via the Animator API, no new clips, no time added): a recoil lean-back + squash (the hit-flinch spring) and
    // a head turn to the floored ally (look-at target held for the beat). director.v15React = r15 poses.
    const an = !this.v15React && e.animator, post = an && an.post;
    const recoil = (k) => { if (an && an.impulse && free()) an.impulse('hit', k); };
    const lookAt = (o, s) => { if (post && post.look && o && !o.removed) { post.look.target = o; post.look.refresh = s; } };
    if (an) { lookAt(v, order === 'rally' ? 0.55 : 0.4); recoil(order === 'flinch' ? 1.7 : order === 'back' ? 1.5 : order === 'brace' ? 1.1 : 0.6); }
    if (walking || (!e.aiHasAtk && !this.reactFirstFull)) { guard(24, order === 'flinch' ? -0.9 : 0); return; } /* C2 r15 A/B: the full two-beat pose on a foe that has not swung yet cost 1P first attacks ~1.5 s (p90 4.3 → 5.7 s): it gets the short guard */
    if (order === 'flinch' || order === 'back') {
      const t1 = order === 'flinch' ? 27 : 33;
      e.pause(t1, { anim: 'sidestep', face: false, vx: order === 'flinch' ? -1.8 : -2.0, duration: t1 / 60 });
      g.after(t1, () => guard(order === 'flinch' ? 40 : 34, -0.35));
    } else if (order === 'brace') guard(45, -0.6);
    else {
      const taunt = e.animator && e.animator.has && e.animator.has('taunt');
      e.faceToward(v); e.pause(18, { anim: 'idle', face: false });
      g.after(18, () => { if (!free()) return; e.faceToward(by); if (an && an.impulse) an.impulse('jump', 0.9); lookAt(by, 0.6); e.pause(taunt ? 34 : 30, { anim: taunt ? 'taunt' : 'blocked', face: false, duration: taunt ? undefined : 0.5 }); }); // C2 r16: the roar puffs up (stretch) facing the hero
    }
  }

  crowdPose(e, h, pose) {
    if (this._bossEncounter || !e.controllable || !e.aiHasAtk || e.kind === 'boss' || e.aiOverdue || (e.aiIdleT || 0) > 150 || !e.animator?.has('crowd_' + pose)) return false;
    if (e.aiCoX != null || this.ai.tokens?.has(e)) return false;
    const ticks = pose === 'fear' || pose === 'rally' ? 45 : 40;
    e.faceToward(h); e.aiReactT = this.game.tick;
    if (pose === 'brace') e.braced = Math.max(e.braced || 0, ticks + 8);
    e.pause(ticks, { anim: 'crowd_' + pose, face: false, duration: ticks / 60, vx: pose === 'recoil' ? -1.35 : pose === 'fear' ? -.3 : 0 });
    return true;
  }
  heroFloored(h) {
    let n = 0;
    for (const e of this.engaged()) {
      if (n >= 2) break;
      if (e.aiTarget !== h || Math.abs(e.pos.x - h.pos.x) > 5 || e.aiReactT != null && this.game.tick - e.aiReactT < 180) continue;
      if (this.crowdPose(e, h, 'rally')) { n++; this.stats.react_rally = (this.stats.react_rally || 0) + 1; this.stats.reacts++; this.game.bus.emit('ai:react', { actor: e, order: 'rally', from: h, why: 'heroFloored' }); }
    }
  }
  chargeReact(e, h) {
    if (this.v16React || this._bossEncounter || !h.fsm?.is('charge', 'run_attack') || Math.abs(e.pos.x - h.pos.x) > 4 || Math.abs(e.pos.z - h.pos.z) > 1.3
      || (e.brain?.cooldown || 0) < 15 || e.aiReactT != null && this.game.tick - e.aiReactT < 180) return false;
    if (!this.crowdPose(e, h, 'brace')) return false;
    this.stats.react_brace = (this.stats.react_brace || 0) + 1; this.stats.reacts++;
    this.game.bus.emit('ai:react', { actor: e, order: 'brace', from: h, why: 'charge' }); return true;
  }
  /** Allies in a thrown enemy's flight path dodge aside in depth or brace for the impact. */
  reactToThrows() {
    const g = this.game;
    this.flying = this.flying.filter((f) => f.v && !f.v.removed && f.v.fsm.is('thrown') && g.tick - f.t < 90);
    for (const f of this.flying) {
      const v = f.v, dir = Math.sign(v.vel.x) || 1;
      for (const e of this.engaged()) {
        if (e === v || f.reacted.has(e.id) || !e.controllable) continue;
        const ahead = (e.pos.x - v.pos.x) * dir;
        if (ahead < 0.6 || ahead > 5.5 || Math.abs(e.pos.z - v.pos.z) > 0.8) continue;
        f.reacted.add(e.id);
        const agile = (e.def.ai && e.def.ai.agility) ?? 1;
        const r = g.rng.next ? g.rng.next() : g.rng.range(0, 1);
        let order = r < this.cfg.dodge * agile ? 'dodge' : r < this.cfg.dodge * agile + this.cfg.brace ? 'brace' : null;
        if (!order) continue;
        if (e.def.cannotDodge && order === 'dodge') order = 'brace';
        if (e.brain && e.brain.react && e.brain.react(order, { from: v }) === true) { /* brain handled it */ }
        else if (order === 'dodge') {
          const side = e.pos.z > v.pos.z ? 1 : -1;
          e.pause(16, { anim: 'sidestep', vz: side * 6.5, face: false });
        } else { e.braced = 40; e.pause(22, { anim: 'blocked', face: false }); e.faceToward(v); }
        this.stats.reacts++; if (order === 'dodge') this.stats.dodges++; else this.stats.braces++;
        g.bus.emit('ai:react', { actor: e, order, from: v });
      }
    }
  }

  dispose() { if (this.scope && this.scope.dispose) this.scope.dispose(); }
}
