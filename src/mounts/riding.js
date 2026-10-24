// Rider adoption: how a hero or an enemy rides a bizarrian WITHOUT edits to Hero.js / Enemy.js / src/ai/**.
//
// adoptRider(a) installs (once, per INSTANCE — never on a prototype or a shared def) thin wrappers:
//   a.play(name)          seated: every non-ride clip → 'ride_idle' (walk/run/jump/fall/land/taunt… all sit)
//   a.startMove(id)       seated: hero/enemy move ids → the beast attack for that button ('beast_<id>'), or refused
//   a.fsm.go(name)        seated: dodge (+jump) = dismount hop; magic = hop off then cast; clinch/throw/back moves refused.
//                         unseated hero: Jump next to a free beast = hop on ('mountUp' state)
//   a.attackWith(id)      enemies: AI picks any move → the beast attack
// seatRider() swaps the rider's `moves` (own copy + beast moves), `stats` (beast walk/run/jump), `speed` (enemies),
// hurtbox and superArmor (small hits never interrupt a rider: MountSystem's preHit hook decides knock-offs), and
// unseatRider() restores every one of them. State `mountUp` (hop into the saddle) is added with fsm.define.
import { GRAVITY } from '../core/config.js';

const EV_HOP = 'mounts:hop';

const RIDE_CLIPS = new Set(['ride_idle', 'ride_attack', 'mount', 'dismount']);
const REFUSED = new Set(['clinch', 'throw', 'charge', 'dodge', 'sidestep', 'block', 'grabbed']);

export function adoptRider(a) {
  if (a._rideAdopted) return a;
  a._rideAdopted = true;
  const play = a.play.bind(a);
  a.play = (name, o) => {
    if (a._seated && !RIDE_CLIPS.has(name)) return play('ride_idle', { ...(o || {}), loop: true, restart: false, duration: undefined, fallback: ['idle'] });
    return play(name, o);
  };
  const startMove = a.startMove.bind(a);
  a.startMove = (id, o) => {
    if (a._seated) {
      const m = a.mountedOn;
      const bid = m ? routeMove(a, m, id) : null;
      if (!bid) return null;
      return startMove(bid, o);
    }
    // Light while pressed against a free beast (no foe within reach) also climbs on.
    if (a.kind === 'hero' && id === 'light_1' && a.grounded && !a.mountedOn) {
      const beast = freeBeastFor(a);
      if (beast && Math.hypot(beast.pos.x - a.pos.x, beast.pos.z - a.pos.z) < 1.15
        && !a.game.world.query({ team: 'enemies', near: { x: a.pos.x, z: a.pos.z, r: 2.2 } }).some((e) => e.alive && !e.fsm.is('down', 'dead'))) { go('mountUp', { mount: beast }); return null; }
    }
    return startMove(id, o);
  };
  if (a.attackWith) {
    const attackWith = a.attackWith.bind(a);
    a.attackWith = (id, t) => {
      if (!a._seated) return attackWith(id, t);
      const m = a.mountedOn;
      const bid = m ? routeMove(a, m, id) : null;
      if (!bid || !a.moves[bid]) return false;
      if (t) a.faceToward(t);
      a.desired.active = false;
      return !!startMove(bid, { target: t });
    };
  }
  const go = a.fsm.go.bind(a.fsm);
  a.fsm.go = (name, data) => {
    if (a._seated) {
      const m = a.mountedOn;
      if (name === 'dodge') {
        // Dodge+Jump = dismount at will (DESIGN §10). A lone Dodge is ignored while riding.
        const inp = a.input;
        if (inp && (inp.isDown('jump') || (a.has && a.has('jump')))) { if (a.take) a.take('jump'); m.dismount({ knocked: false }); return true; }
        return false;
      }
      if (name === 'magic' || name === 'magicSelect') { m.dismount({ knocked: false, silent: true }); a.pos.y = 0; a.grounded = true; a.vel.y = 0; return go(name, data); }
      if (REFUSED.has(name)) return false;
    } else if (!a.mountedOn && a.kind === 'hero' && name === 'jump' && a.grounded && a.fsm.is('idle', 'walk', 'land')) {
      const beast = freeBeastFor(a);
      if (beast) return go('mountUp', { mount: beast });
    }
    return go(name, data);
  };
  a.fsm.define({ mountUp: mountUpState() });
  return a;
}

/** A free beast `a` is touching (hero hop-on check). */
export function freeBeastFor(a) {
  const ms = a.game.mounts;
  if (!ms || !ms.list) return null;
  let best = null, bd = 1e9;
  for (const m of ms.list()) { if (!m.canMount(a)) continue; const d = Math.hypot(m.pos.x - a.pos.x, m.pos.z - a.pos.z); if (d < bd) { bd = d; best = m; } }
  return best;
}

/** Map a rider move id (button intent) → an injected beast move id, honouring per-type gates (e.g. one fireball). */
function routeMove(a, m, id) {
  if (id && id.startsWith('beast_')) return a.moves[id] ? id : null;
  const b = m.def.buttons || {};
  const air = !a.grounded;
  let key;
  if (air) key = b.air || b.light;
  else if (id === 'run_attack') key = b.dash || b.heavy || b.light;
  else if (id === 'heavy' || id === 'launcher' || id === 'air_slam' || /^heavy/.test(id)) key = b.heavy || b.light;
  else key = b.light;
  if (m.def.gate) { try { key = m.def.gate(m, a, key) ?? key; } catch (e) { /* gate is advisory */ } }
  if (!key) return null;
  return a.moves[`beast_${key}`] ? `beast_${key}` : null;
}

function beastMoves(m) {
  const out = {};
  for (const [id, d] of Object.entries(m.attacks)) out[`beast_${id}`] = { anim: 'ride_attack', animFallback: ['ride_idle'], ...d };
  return out;
}

/** Seat `a` on `m` (called by Mount.mount). */
export function seatRider(a, m) {
  adoptRider(a);
  if (a.attack) a.endMove();
  a.mountedOn = m;
  a._seated = true;
  a._ride = { moves: a.moves, stats: a.stats, speed: a.speed, hurt: a.hurt, superArmor: a.superArmor, radius: a.radius };
  a.moves = { ...a.moves, ...beastMoves(m) };
  const d = m.def;
  if (a.stats) {
    a.stats = { ...a.stats, walk: d.speed ?? a.stats.walk, run: d.run ?? a.stats.run, depth: d.depth ?? a.stats.depth,
      jumpVel: Math.sqrt(2 * GRAVITY * (d.jump ?? 1.6)), airControl: d.airControl ?? a.stats.airControl, accel: d.accel ?? a.stats.accel };
  }
  if (typeof a.speed === 'number') a.speed = (d.enemySpeed ?? (d.speed ?? 4) * 0.62);
  a.hurt = { ...a.hurt, w: Math.max(a.hurt.w, (m.radius || 0.6) * 1.8), h: m.saddleY + (a.height || 1.8) * 0.62, d: Math.max(a.hurt.d, d.hurtDepth ?? a.hurt.d) };
  a.superArmor = 999;
  a.pos.y = Math.max(0, a.pos.y - m.saddleY); if (a.pos.y <= 0.001) { a.pos.y = 0; a.grounded = true; a.vel.y = 0; }
  a.prevPos.y = a.pos.y;
  if (a.tags) a.tags.add('mounted');
  a.play('ride_idle', { fade: 0.12 });
  if (a.fsm.has('idle')) a.fsm.go('idle');
}

/** Undo seatRider; knocked riders are left at saddle height for the knockdown the hit is about to apply. */
export function unseatRider(a, m, { knocked = false, silent = false } = {}) {
  const r = a._ride;
  a._seated = false;
  a.mountedOn = null;
  if (a.attack) a.endMove();
  if (r) { a.moves = r.moves; if (r.stats) a.stats = r.stats; if (typeof r.speed === 'number') a.speed = r.speed; a.hurt = r.hurt; a.superArmor = r.superArmor || 0; }
  a._ride = null;
  if (a.tags) a.tags.delete('mounted');
  if (a.body) { a.body.position.set(0, 0, 0); }
  a._saddleOff = null;
  if (silent) return;
  // Leave the rider in the air at the seat: a knock-off launches from there, a hop-off drops to the side.
  a.pos.y = Math.max(a.pos.y, 0) + m.saddleY * 0.85; a.prevPos.y = a.pos.y;
  a.grounded = false;
  if (!knocked) {
    a.vel.y = 3.2; a.vel.x = -a.facing * 1.4;
    a.vel.z = (a.pos.z < 0 ? 1 : -1) * 1.6;
    a.invuln = Math.max(a.invuln || 0, 12);
    a.play('dismount', { restart: true, fade: 0.06, fallback: ['jump_fall'] });
    if (a.fsm.has('fall')) a.fsm.go('fall'); else if (a.fsm.has('idle')) a.fsm.go('idle');
    if (a.animator && a.animator.has && a.animator.has('dismount')) a.play('dismount', { restart: true, fade: 0.06 });
  }
}

/** Hop into the saddle (hero Jump/Light next to a free beast, or an enemy reclaiming its beast). data: { mount }
 *  Scripted 14-tick arc (not physics): lerp onto the beast, peak just above the seat, land in it. */
const HOP_TICKS = 14;
function mountUpState() {
  return {
    tags: ['busy', 'air'],
    enter(a, data) {
      const m = data && data.mount;
      a._hop = m;
      if (!m || !m.claim(a)) { a._hop = null; return; }
      if (a.attack) a.endMove();
      a._hopFrom = { x: a.pos.x, z: a.pos.z, y: a.pos.y };
      a._hopGrav = a.gravityScale; a.gravityScale = 0; a.vel.set(0, 0, 0);
      a.grounded = false; a.pos.y = Math.max(a.pos.y, 0.02);
      a.invuln = Math.max(a.invuln || 0, HOP_TICKS + 6);
      a.faceToward(m);
      a.play('mount', { restart: true, fade: 0.05, duration: HOP_TICKS / 60 + 0.1, fallback: ['jump_up'] });
      a.game.bus.emit(EV_HOP, { rider: a, mount: m });
      if (a.game.audio) a.game.audio.play('jump', { volume: 0.8 });
    },
    update(a) {
      const m = a._hop;
      if (!m || m.removed || m.mode !== 'claimed' || m.claimedBy !== a) { a._hop = null; return a.fsm.has('fall') ? 'fall' : 'idle'; }
      const t = Math.min(1, (a.fsm.ticks + 1) / HOP_TICKS), e = t * t * (3 - 2 * t), f = a._hopFrom;
      a.vel.set(0, 0, 0);
      a.pos.x = f.x + (m.pos.x - f.x) * e; a.pos.z = f.z + (m.pos.z - f.z) * e;
      a.pos.y = f.y + (m.saddleY - f.y) * e + Math.sin(t * Math.PI) * 0.45;
      if (t >= 1) {
        a.facing = m.facing;
        a._hop = null;
        a.gravityScale = a._hopGrav ?? 1;
        m.mount(a, { force: true }); // seatRider lowers pos.y by saddleY → ground level, grounded, → idle
      }
      return undefined;
    },
    exit(a) { a.gravityScale = a._hopGrav ?? 1; if (a._hop) { a._hop.unclaim(); a._hop = null; } },
  };
}
