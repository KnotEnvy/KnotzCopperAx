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
const PIN_SIDE = 0.2;  // C2 r2: attackSide routes attackers to the inner flank inside this band (before the veto applies)
const STRIKE_IN2 = 0.95; // C2 r2: an attacker's centre must be this far inside the frame to start a move (was 0.6)
const SP_HH = 0.85;   // C2 r2: hero–hero screen gap below which two standing heroes are eased apart (board: co-op heroes stack)
const SP_HH_STEP = 0.025; // m per tick per hero (≈ 1.5 m/s: a soft body, never fights the stick)
const FIRST_DUE = 180; // C2 r2: ticks after a foe first stands fully in frame without having attacked → priority (cap ≤ 6 s)
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
    const bus = game.bus;
    this.scope = bus.scope ? bus.scope() : bus;
    this.scope.on(EV.HIT, (ev) => {
      const a = ev.attacker, t = ev.target;
      if (!a || !t) return;
      if (a.kind === 'hero' && t.team === 'enemies' && !ev.blocked) this._pressure.set(a.id, Math.min(80, (this._pressure.get(a.id) || 0) + (ev.damage || 0)));
      if (t.kind === 'hero') this._pressure.set(t.id, (this._pressure.get(t.id) || 0) * 0.4);
      // C2 r2 AGGRO: a foe struck by a hero turns on that hero (board r11: a skeleton beaten by one hero kept its token on the
      // other one 9 m away and walked there for 25 s without a swing). The co-op balance pass leaves it there for 1.5 s.
      if (a.kind === 'hero' && t.team === 'enemies' && t.brain && !this.noAggro && a.alive && t.aiTarget !== a) {
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
    this.scope.on(EV.HIT, (ev) => {
      const a = ev.attacker, t = ev.target;
      if (a && t && t.kind === 'hero' && a.team === 'enemies' && !ev.blocked) { this._heat.set(t.id, (this._heat.get(t.id) || 0) + (ev.damage || 0)); this.stats.heatPeak = Math.max(this.stats.heatPeak || 0, this.heat(t)); }
    });
    this.scope.on(EV.ATTACK_START, (ev) => {
      const a = ev.actor;
      if (a && a.team === 'enemies' && a.kind !== 'boss' && a.target && a.target.kind === 'hero') {
        this.lastStrike.set(a.target.id, { tick: game.tick, w: (a.def && a.def.strikeWeight) || 1 });
        this._lastGo.set(a.id, game.tick);
        const r = this._reserve.get(a.target.id);
        if (r && r.id === a.id) this._reserve.delete(a.target.id);
      }
    });
    this.scope.on(EV.THROW, (ev) => { if (ev.victim && ev.victim.team === 'enemies') this.flying.push({ v: ev.victim, reacted: new Set(), t: game.tick }); });
    this.scope.on('ai:breakout', () => this.stats.breakouts++);
    this.scope.on('ai:block', () => this.stats.blocks++);
    this.scope.on('ai:telegraph', () => this.stats.telegraphs++);
  }

  reset() { if (this._rowSt) this._rowSt.clear(); this._free = null; this._lastGo.clear(); this._want.clear(); this._reserve.clear(); this._heat.clear(); this._pressure.clear(); this.groups.clear(); this.retreats.clear(); this.flying.length = 0; }

  /** c1r10 waiting stand-off (screen x from a hero): co-op WAITX; solo waitXSolo (one fight: the crowd waits closer). */
  wx() { return this.waitX ?? ((this._nh || 1) > 1 || this.v9Pack ? WAITX : this.waitXSolo ?? WAITX_SOLO); }
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
    const back = e && this.isElite(e) && Math.sign(e.pos.x - t.pos.x) === -(t.facing || 1) ? 1.35 : 1;
    // r8: co-op has two heroes soaking the crowd (twice the attack starts at the same per-hero gap): a wider gap keeps a 2P run in budget
    const gap = this.cfg.strikeGap * (this._nh > 1 ? 1.2 : 1) * last.w * gov * back * (punish && h <= 1 ? 0.5 : 1) * (1 - Math.min(0.3, this.pressure(t) / 120));
    // C2 r2: a foe that has not attacked yet and is due (FIRST_DUE) only waits out a short gap (the heat ceiling still holds)
    const first = e && e.aiOverdue && !e.aiHasAtk && !this.noFirstDue ? Math.min(gap, 45) : gap;
    if (this.game.tick - last.tick < first) return false;
    // A starved tank's reserved strike: everybody else holds their swing until it commits (or the hold lapses).
    const r = this._reserve.get(t.id);
    if (r && e && r.id !== e.id) {
      const o = this.game.world.byId.get(r.id);
      if (o && o.alive && !o.removed && this.game.tick < r.until && !(o.fsm && o.fsm.tagged && o.fsm.tagged('stunned'))) return false;
      this._reserve.delete(t.id);
    }
    // Hard ceiling: well over the damage budget → nobody starts a new strike on this hero until the heat vents.
    if (h >= HEAT_CEIL) { this.stats.heatHolds = (this.stats.heatHolds || 0) + 1; return false; }
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
    if (!t) return false;
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
    if (g.tick % 15 === 0) this.assign();
    else if (g.tick % 5 === 0 && !this.v9Pack) this.lanes(); // c1r10: waiting spots follow the moving heroes
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
      const vr = viewRange(g, a.pos.z), s = this.sx(a.pos.x, a.pos.z);
      if (!hero && a.fsm && a.fsm.is('enter') && (a.pos.x < vr.xMin || a.pos.x > vr.xMax)) continue; // still walking in off-screen
      let w = 1, cap = this.spStep ?? SP_STEP;
      if (hero) { w = 0; cap = 0; }
      else if (a.fsm.is('attack')) { w = 0.2; cap = 0.025; }
      else if (a.fsm.is('hitstun', 'block')) { w = 0.55; cap = 0.04; }
      else if (a.fsm.is('pause')) w = 0.7;
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
          if (dz >= (this.spDzEH ?? SP_DZ_EH) && (e.aiCrossing || (tk && tk.has(e)) || !e.brain || e.brain.mode !== 'circle' || (e.aiSqueeze != null && g.tick - e.aiSqueeze < 40))) {
            if (this.noEhFar || e.aiCrossing || !e.brain || (e.aiSqueeze != null && g.tick - e.aiSqueeze < 40)) continue;
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
      if (e.fsm.is('attack')) { e.aiIdleA = 0; e.aiIdleT = 0; e.aiHasAtk = true; if (e.aiOverdue) { e.aiOverdue = false; this.stats.overdueServed = (this.stats.overdueServed || 0) + 1; } continue; }
      // C2 r2 TIME TO FIRST ATTACK (board r11: 12.3–19.8 s from first sight to the first swing — the idle cap only counted
      // idle / walk ticks, a foe being hit or detouring never got due): FIRST_DUE ticks after it first stands fully in
      // frame, a foe that has never attacked gets the overdue priority whatever it has been doing.
      if (e.aiSeen == null && !e.fsm.is('enter', 'rise', 'bones', 'reform') && !offFrame(g, e, 0.6)) e.aiSeen = g.tick;
      if (!this.noFirstDue && !e.aiHasAtk && !e.aiOverdue && e.aiSeen != null && g.tick - e.aiSeen > (this.firstDue ?? FIRST_DUE)) { e.aiOverdue = true; this.stats.firstDue = (this.stats.firstDue || 0) + 1; }
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
  menaceDue(e) { return !this.noIdleCap && (e.aiIdleA || 0) > (this.menaceT ?? MENACE) + ((e.id * 37) % 50); }

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
    for (const h of this.heroes()) {
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
      const q = (this._entryQ = this._entryQ || {});
      const delay = Math.max(0, (q[side] ?? -1e9) - now);
      q[side] = now + delay + this.game.rng.int(34, 56);
      t.delay = delay; t.delay0 = delay; t.spMul = this.game.rng.range(0.86, 1.1);
      if (delay) this.stats.entryDelay = (this.stats.entryDelay || 0) + 1;
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
    this.stats.entryLanes = (this.stats.entryLanes || 0) + 1;
    return t;
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

  /** Attack lane for a committing foe: the side of the hero no other committed foe is using (surround, never a
   *  pile-up), plus a depth offset when both sides are already taken. → { side, dz } */
  attackSide(e, t) {
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
      const pref = this.noVeto || (rf && !t.aiBot) ? 0 : band(Math.max(PIN_PREF, this.v11Veto ? 0 : (this.pinSide ?? PIN_SIDE) + 0.04)); // soft: inner flank preferred while it is free
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
    if (!busy[own]) return { side: own, dz: 0 };
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

  /** Is side `side` of hero t already used by another committed foe? (token-free specials: leaps, dashes) */
  sideBusy(e, t, side) {
    for (const o of this.committed(t, e)) if (Math.sign(o.pos.x - t.pos.x) === side && Math.abs(o.pos.x - t.pos.x) < 2.0) return true;
    return false;
  }

  /** Co-op split + slot assignment. */
  assign() {
    const g = this.game, hs = this.heroes(), es = this.engaged();
    this._nh = hs.length;
    if (!hs.length) return;
    const dist = (e, h) => Math.abs(h.pos.x - e.pos.x) + Math.abs(h.pos.z - e.pos.z) * 0.5;
    const by = new Map(hs.map((h) => [h.id, []]));
    for (const e of es) {
      let t = e.aiTarget && by.has(e.aiTarget.id) ? e.aiTarget : null;
      if (!t) { t = hs[0]; for (const h of hs) if (dist(e, h) < dist(e, t)) t = h; }
      e.aiTarget = t; by.get(t.id).push(e);
    }
    // Balance: while one hero has ≥ 2 more attackers than another, hand over the one that is relatively closest.
    if (hs.length > 1) {
      for (let guard = 0; guard < 8; guard++) {
        const sorted = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
        const [hiId, hiL] = sorted[0], [loId, loL] = sorted[sorted.length - 1];
        if (hiL.length - loL.length < 2) break;
        const lo = g.world.byId.get(loId), hi = g.world.byId.get(hiId);
        hiL.sort((a, b) => (dist(a, lo) - dist(a, hi)) - (dist(b, lo) - dist(b, hi)));
        // r5: never hand over a foe that would have to walk through its old hero's screen column to reach the new one.
        const k = hiL.findIndex((f) => !((hi.pos.x - f.pos.x) * (lo.pos.x - hi.pos.x) > 0 && Math.abs(hi.pos.x - f.pos.x) > 0.3) && !(f.aiAggroT != null && g.tick - f.aiAggroT < 90 && !this.noAggro));
        if (k < 0) break;
        const mv = hiL.splice(k, 1)[0]; loL.push(mv); mv.aiTarget = lo;
      }
    }
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
          const betw = !holder && hs.some((o) => o !== h && Math.sign(o.pos.x - h.pos.x) === s.side && Math.abs(o.pos.x - h.pos.x) < 7) ? 2.5 : 0;
          // r8: waiters spread over the depth rows (a crowd sharing one row is the conga line), the hero's row is for strikers
          // r8 stickiness: a waiter keeps its row (each row change is a 2–4 m walk across the fight)
          // c1r9 co-op: the balance counts waiters of EVERY hero standing near that row's depth (critic r8: each hero's
          // lone waiter picked the same front row → the whole co-op crowd on one band)
          const nRow = this.noGlobalRows ? rowN[s.row] : rowZs.reduce((n, z) => n + (Math.abs(z - pz) < 1.2), 0);
          const rowBal = holder ? 0 : nRow * (this.rowBal ?? 1.7) + (s.row === 'm' ? this.rowMid ?? 2.5 : 0) + (prevRow && prevRow !== s.row ? this.rowStick ?? 1.8 : 0);
          const twin = !holder && (cells.get(s.side + '|' + s.row) || '').includes(look(e) + ';') ? this.twinCost ?? 2.2 : 0;
          // c1r9: a waiter's walk to another depth row is weighted less (×rowZW) than a holder's (×1.3): at 1.3 a free
          // row 4 m away cost ~5 m vs a row-balance of 1.7, so every waiter piled onto the rows nearest the heroes
          const c = Math.hypot(px - e.pos.x, (pz - e.pos.z) * (holder ? 1.3 : this.rowZW ?? (this.v8Kit ? 1.3 : 0.6))) + cross + off + bal + betw + rowBal + twin + i * 0.25;
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
        e.aiSlot = { ...SLOTS[best], dz: R[SLOTS[best].row], z: SLOTS[best].row === 'm' ? undefined : R[SLOTS[best].row + 'z'], i: best, src: 'slot' };
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
      if (hs.length === 1 && this.round() && !this.noFlankBal) {
        const vr = viewRange(this.game, h.pos.z), FL = this.sx(vr.xMin + EDGE_IN, h.pos.z), FR = this.sx(vr.xMax - EDGE_IN, h.pos.z);
        if (FR - c < need + 0.9) hi = c + Math.max(SOLO_TIGHT, Math.min(need, FR - c - 0.9));
        if (c - FL < need + 0.9) lo = c - Math.max(SOLO_TIGHT, Math.min(need, c - FL - 0.9));
      }
      B.push({ lo, hi, c, x: h.pos.x, z: h.pos.z, hero: true });
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
        const sd = this.sx(this.unsx(w.sd, w.z), zr);
        for (const gp of gaps) {
          let goal = sd;
          if (solo) {
            const gs = Math.sign((gp[0] + gp[1]) / 2 - hc0), ss = Math.sign(sd - hc0);
            if (gs && ss && gs !== ss) goal = 2 * hc0 - sd;
            goal = Math.max(FL, Math.min(FR, goal)); // a ring that doesn't fit in the frame on this side costs nothing extra (it just stands nearer)
          }
          const s = Math.max(gp[0], Math.min(gp[1], goal));
          // going round a hero = a depth detour behind / in front of his fight (kit: depth first, ≥ 2.5 m off his row),
          // allowed when this side is crowded (cost wallCost per hero rounded, plus the detour's bodies)
          const nw = walls.filter((b) => Math.sign(s - b.c) !== Math.sign(w.cur - b.c)).length;
          if (nw && (!this.round() || nw > 1)) continue; // A/B director.roundOk (measured: solo fused 20.6 → 26.3 %, off by default)
          const pass = nw ? 0 : obst.filter((o) => (o.c - w.cur) * (o.c - s) < 0 && Math.abs(o.c - w.cur) > 0.3).length;
          const sg = Math.sign(s - hc0) || 1, bal = solo ? (this.flankBal ?? FLANK_BAL) * Math.max(0, sideN[sg] - sideN[-sg]) : 0;
          const c = Math.abs(s - goal) + (this.passCost ?? 2.5) * pass + rw.pen + nw * (this.wallCost ?? 3.0) + bal;
          if (c < bc) { bc = c; best = s; bz = rw; w.round = nw > 0; }
        }
      }
      w.cross = !!(best != null && w.round);
      if (w.cross) st.placeRound = (st.placeRound || 0) + 1;
      if (best == null) { // no free spot on its side in the frame on either row: the nearest free spot on its row (it goes round)
        const zr = w.z, FL = this.sx(w.vr.xMin + EDGE_IN, zr), FR = this.sx(w.vr.xMax - EDGE_IN, zr);
        bz = rows[0];
        for (const gp of this.noPlaceCross ? [] : g0) { const x = Math.max(gp[0], Math.min(gp[1], w.sd)), c = Math.abs(x - w.cur); if (c < bc) { bc = c; best = x; } }
        if (best != null) { w.cross = true; st.placeCross = (st.placeCross || 0) + 1; }
        else { best = Math.max(Math.min(FL, FR), Math.min(Math.max(FL, FR), w.sd)); st.placeOvf = (st.placeOvf || 0) + 1; }
      }
      if (bz.row !== row0) { st.rowSwap = (st.rowSwap || 0) + 1; w.z = bz.z; w.e.aiSlot = { ...w.e.aiSlot, row: bz.row, z: bz.z, dz: bz.z - w.h.pos.z }; }
      w.s = best;
      placed.push({ s: best, z: w.z, zc, x: this.unsx(best, w.z) });
      if (solo) sideN[Math.sign(best - hc0) || 1]++;
    }
    for (const w of W) {
      const r = this.unsx(w.s, w.z) - w.h.pos.x;
      w.e.aiSlot = { ...w.e.aiSlot, side: Math.sign(r) || w.e.aiSlot.side, x: Math.abs(r), cross: !!w.cross, src: w.cross ? 'placeX' : 'place' };
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
      const waiting = es.includes(e) && h && sl && sl.x != null && !(tk && tk.has(e)) && !(e.fsm && e.fsm.is('attack', 'hitstun', 'knockdown', 'down', 'getup', 'block', 'enter'));
      // r6: a waiter holding its spot (its walk was blocked) is a fixed body for this pass, not a movable goal
      // (c1r9: unless it is holding off-frame — it then walks in, so its goal stays movable)
      if (!waiting && !this.v9Pack && e.fsm && e.fsm.is('enter') && offFrame(g, e, 0)) continue; // c1r10: an arrival still off-screen reserves no screen column
      if (!waiting || (!this.noHoldFix && this.v9Pack && g.tick - (e.aiHold ?? -99) < 20 && (this.v8Kit || this.v8Walk || this.noOutWalk || !offFrame(g, e)))) { F.push({ s: this.sx(e.pos.x, e.pos.z), z: e.pos.z, e }); continue; }
      const z = sl.z ?? h.pos.z + sl.dz, vr = viewRange(g, z);
      // c1r10 no-cross: the desired spot is on the side of its hero the waiter stands on now (the kit refuses to walk
      // through the hero anyway; a goal across it only made the packing and the walk disagree)
      const ps = Math.sign(e.pos.x - h.pos.x), side = !this.v9Cross && !this.round() && ps && Math.abs(e.pos.x - h.pos.x) > 0.35 ? ps : sl.side;
      W.push({ e, h, z, vr, sd: this.sx(h.pos.x + side * sl.x, z) });
    }
    if (!this.v9Pack) { this.place(W, F, hs, GAP); return; }
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
