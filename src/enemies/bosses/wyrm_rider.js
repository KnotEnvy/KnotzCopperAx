// Boss encounter: THE WYRM RIDER (stage 3, the eagle's back). A Viper Maiden captain (elite Gen. Oxide, types/viper.js)
// riding a Cinderwyrm (mounts API: game.mounts.spawn('cinderwyrm', { rider: 'viper', riderOpts })): fireball arcs
// (one in flight at a time), bites, rams; knock her off and she fights on foot (and climbs back on if she can).
// The HUD boss bar tracks the captain; the beast is stealable. Showcase: &id=wyrm_rider&scene=fight
import { groupBoss } from './_group.js';
import { bossRim, bossScale } from './_look.js';
import { wyrmRiderLook } from './_wyrmLook.js';
import { useClipSet } from './_stance.js';
import { initPoise } from './_poise.js';
import { spawnEnemy } from '../spawnEnemy.js';
import { EV } from '../../core/EventBus.js';
import { GRAVITY } from '../../core/config.js';

const NAME = 'The Wyrm Rider', TITLE = 'Captain Sskara of the Cinder Flight';
export const WYRM_K = 1.3;
const POISE = 8, REGEN = 3, GRACE = 40;
// r9 knock-off choreography (board r8: she arced straight up through the saddle — the viper brain fired its backflip
// while she was still airborne at saddle height — then landed behind the riderless wyrm, hidden for the whole stagger).
const FLY_T = 0.62, FLY_MAX = 54, LIE = 32, RISE = 26, LANE = 2.3, WYRM_LANE = 1.9, WYRM_BACK = 2.3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** +1 / -1: which way along z the camera sits (the "camera-side lane"). */
const camSide = (g, z) => (g.camera ? Math.sign(g.camera.position.z - z) || 1 : 1);

/** Scripted unhorsing: a low sideways fall arc off the saddle toward the camera-side lane (knockdown pose, no flip),
 *  a short lie, a get-up, then the poise STAGGER (the heroes' payoff window, out in the open). data: { dir, mz } */
function unhorsedState() {
  return {
    tags: ['stunned', 'air'],
    enter(a, d = {}) {
      const g = a.game, band = g.world.band;
      if (a.attack) a.endMove();
      if (a.desired) a.desired.active = false;
      const dirX = d.dir || -a.facing, cz = camSide(g, a.pos.z), mz = d.mz ?? a.pos.z;
      const z1 = clamp(mz + cz * LANE, band.zMin + 0.15, band.zMax - 0.15);   // front edge: nothing can stand between her and the camera
      const x1 = a.pos.x + dirX * 1.4, y0 = Math.max(0.2, a.pos.y);
      a.gravityScale = 1; a.grounded = false; a.bounceWalls = false;
      a.vel.x = (x1 - a.pos.x) / FLY_T; a.vel.z = (z1 - a.pos.z) / FLY_T;
      a.vel.y = (0.5 * GRAVITY * FLY_T * FLY_T - y0) / FLY_T;   // lands at FLY_T: a short pop off the seat, then the drop
      a.setFacing(-dirX);                                     // knockdown flies backwards → she topples away from the blow
      a.roll = 0;
      a.play('knockdown', { restart: true, fade: 0.05, fallback: ['hit_high'] });
      a._unh = { phase: 0, t: 0, dirX, z1 };
      g.bus.emit(EV.KNOCKDOWN, { actor: a, by: d.by || null });
    },
    update(a, dt) {
      const U = a._unh, g = a.game;
      if (!U) return 'idle';
      U.t++;
      if (U.phase === 0) {
        // a slight sideways tumble on top of the backward knockdown pose (screen-plane roll, settles before landing)
        const k = Math.min(1, U.t / (FLY_T * 60));
        a.roll = (U.dirX * 0.32 * Math.sin(k * Math.PI)) / 0.72;   // Combatant decays roll ×0.72 after this
        if (a.landedThisTick || (a.grounded && U.t > 3) || U.t > FLY_MAX) {
          U.phase = 1; U.t = 0;
          a.vel.x *= 0.3; a.vel.z *= 0.2; a.roll = 0;
          a.invuln = Math.max(a.invuln || 0, LIE + RISE + 4);
          a.play('down_loop', { fade: 0.12, fallback: ['knockdown'] });
          g.bus.emit(EV.LAND, { actor: a, pos: a.pos, speed: Math.max(7, a.lastLandSpeed || 0), body: true });
          if (g.cameraRig && g.cameraRig.shake) g.cameraRig.shake(0.3);
          if (g.audio && g.audio.play) g.audio.play('land_heavy', { volume: 0.9, pitch: 0.9 });
        }
        return undefined;
      }
      a.friction(9, dt);
      if (U.phase === 1 && U.t >= LIE) {
        U.phase = 2; U.t = 0;
        a.play('getup', { restart: true, fade: 0.1, duration: RISE / 60 + 0.08, fallback: ['idle'] });
        g.bus.emit(EV.GETUP, { actor: a });
      } else if (U.phase === 2 && U.t >= RISE) {
        const P = a.poise;
        a._unh = null;
        if (P && a.fsm.has('stagger')) {   // the knock-off always pays out: STAGGERED, ×dmg, then immune (_poise.js)
          P.breaks++; P.cur = 0;
          g.bus.emit('boss:stagger', { boss: a, by: null, breaks: P.breaks });
          a.fsm.go('stagger', { dir: U.dirX });
          return undefined;
        }
        return 'idle';
      }
      return undefined;
    },
    exit(a) { a._unh = null; a.gravityScale = 1; a.roll = 0; },
  };
}

export function scaleBeast(m, k) {
  if (m.body) m.body.scale.multiplyScalar(k);
  if (m.height) m.height *= k;
  if (m.radius) m.radius *= 1.15;
  if (m.saddleY) m.saddleY *= k;
  m.modelScale = (m.modelScale || 1) * k;
  m.hp = m.maxHp = 99999;
}

function mountedBoss(game, rider, mount) {
  rider.heavyRider = true;
  // the Cinderwyrm is loyal while she lives (heroes may ride it after her fall — the GA steal, post-fight)
  const canMount0 = mount.canMount.bind(mount);
  mount.canMount = (a) => (a === rider || !rider.alive || rider.removed) && canMount0(a);
  let poise = POISE, calm = 0, graceUntil = 0, lastDir = 0;
  const baseSpeed = mount.speed;
  const hooks = game.combat && game.combat.preHitHooks;
  rider.fsm.define({ unhorsed: unhorsedState() });
  // knocked off (poise broken / magic): take over the fall before the hit pipeline's knockdown would (poise sanitises it)
  const offRiderOff = game.bus.on('mounts:riderOff', (e) => {
    if (!e || e.rider !== rider || e.mount !== mount || !e.knocked || !rider.alive || rider.removed) return;
    rider.fsm.go('unhorsed', { dir: lastDir || -rider.facing, mz: mount.pos.z });
  });
  const hook = (ev) => {
    if (ev.target !== rider || !rider._seated || rider.mountedOn !== mount) return undefined;
    lastDir = ev.dir || 0;
    const w = ev.hit || {};
    const big = ev.knockdown || w.knockdown || (ev.launch || 0) > 0 || ev.level === 'heavy' || w.dismount || w.unblockable;
    const soak = mount.def && mount.def.soak != null ? mount.def.soak : 0.5;
    ev.damage = ev.damage / Math.max(0.2, 1 - soak);       // MountSystem soaks `soak` into the beast: she still takes it all
    calm = 0;
    if (ev.level === 'magic' || !big) return undefined;    // small hits: ridden out; magic: always unseats
    const hard = ev.knockdown || w.knockdown || (ev.launch || 0) > 0 || w.dismount;
    if (hard && game.tick >= graceUntil) { graceUntil = game.tick + GRACE; if (--poise <= 0) { poise = POISE; return undefined; } }   // poise broken → knocked off
    ev.keepSeat = true; ev.knockdown = false; ev.launch = 0;
    ev.hit = { ...w, knockdown: false, launch: 0, dismount: false, unblockable: false };
    mount.flinch = 14; mount.hurtLean = ev.dir || -mount.facing;
    if (game.cameraRig && game.cameraRig.shake) game.cameraRig.shake(0.12);
    return undefined;
  };
  if (hooks) hooks.unshift(hook);
  const name = 'boss.wyrmRider.' + rider.id;
  game.addSystem({ name, order: 19, update(dt) {
    if (!rider.alive || rider.removed || mount.removed) {
      game.removeSystem(name);
      offRiderOff();
      if (hooks) { const i = hooks.indexOf(hook); if (i >= 0) hooks.splice(i, 1); }
      if (!mount.removed && mount.free && mount.flee) mount.flee();
      return;
    }
    if (rider.mountedOn === mount) {
      mount.speed = baseSpeed;
      if ((calm += dt) > REGEN && poise < POISE) { poise++; calm = 0; }
      return;
    }
    // unseated: the wyrm trots to her (free wander target = her flank), never bolts
    if (!mount.rider && mount.mode === 'flee') { mount.mode = 'free'; mount.vel.x = 0; }   // struck while riderless: stays
    if (mount.rider || !mount.free) return;
    mount.leaveTimer = 600;
    mount.lastRider = rider;                                 // MountSystem remounts its last rider when she is up beside it
    const nm = mount.noMount.get(rider.id); if (nm && nm > game.tick + 70) mount.noMount.set(rider.id, game.tick + 70);
    const W = mount.wander; if (!W) return;
    if (rider.fsm.is('unhorsed', 'stagger')) {
      // r9: while she is down / staggered the riderless wyrm backs off to the FAR lane, behind where she fell from,
      // facing her — it never stands between her and the camera (board r8: she was hidden behind it for ~3 s)
      const band = game.world.band, cz = camSide(game, rider.pos.z), U = rider._unh;
      const dirX = U ? U.dirX : (Math.sign(rider.pos.x - mount.pos.x) || 1);
      const tz = clamp((U ? U.z1 : rider.pos.z) - cz * WYRM_LANE, band.zMin + 0.2, band.zMax - 0.2);
      const tx = rider.pos.x - dirX * WYRM_BACK;
      W.x = tx; W.z = tz; W.idle = true; W.t = 20;           // idle wander = friction only; we drive it (backing up)
      mount.vel.x = clamp((tx - mount.pos.x) * 3, -3.2, 3.2);
      mount.vel.z = clamp((tz - mount.pos.z) * 3, -2.6, 2.6);
      mount.setFacing(rider.pos.x - mount.pos.x);
      return;
    }
    W.x = rider.pos.x - (rider.facing || 1) * 0.4; W.z = rider.pos.z; W.idle = false; W.t = 20;
    const d = Math.hypot(mount.pos.x - rider.pos.x, mount.pos.z - rider.pos.z);
    mount.speed = d > 1.0 ? 12 : baseSpeed;                 // free wander moves at speed × 0.3 → ~3.6 m/s
  } });
}

export default {
  id: 'wyrm_rider',
  name: NAME,
  title: TITLE,
  stage: 'stage3',
  arenaX: 2,
  async encounter(game, ctx = {}) {
    const x = ctx.x ?? 0;
    const vis = game.cameraRig && game.cameraRig.visibleRange ? game.cameraRig.visibleRange(0) : { xMin: x - 9, xMax: x + 9 };
    if (ctx.showcase && game.cameraRig && game.cameraRig.setLock) game.cameraRig.setLock(-6.1, 7.9);
    const two = game.world.query({ kind: 'hero' }).length > 1;
    const riderOpts = { elite: 4, tier: 'captain', hp: two ? 1080 : 700 };
    const spawnX = Math.max(-1.5, Math.min(/[?&]bossframe=0/.test(typeof location !== 'undefined' ? location.search : '') ? 1.6 : 0.9, vis.xMax - 2.4));
    let rider = null, mount = null;
    if (game.mounts && game.mounts.spawn) {
      try { mount = await game.mounts.spawn('cinderwyrm', { x: spawnX, z: -0.3, facing: -1, rider: 'viper', riderOpts }); rider = mount && mount.rider; } catch (e) { rider = null; }
    }
    if (!rider) rider = await spawnEnemy(game, 'viper', { x: spawnX, z: -0.3, facing: -1, ...riderOpts, enterFrom: { x: Math.min(1.2, x), z: -0.3 } });
    if (rider) {
      rider.def = { ...rider.def, throwable: false };   // a boss is never thrown
      // r7 poise (on foot: the saddle keeps its own POISE meter below): armoured, 7-tick flinches, stagger after a real combo
      initPoise(rider, { max: 50, immune: 540, counter: 'poke', counterReach: 2.6, stagger: { ticks: 84, mul: 1.4, shove: 2.4 } }, { wrap: true });
    }
    if (rider) bossScale(rider, 1.28);   // critic r2/r3: the captain read hero-sized on foot (2.07 m vs Brann 1.97)
    if (rider) useClipSet(rider, 'boss_wyrm_rider');   // C2 r1: her own riding posture (anim/clips/boss_wyrm_rider.js)
    if (mount) scaleBeast(mount, WYRM_K);
    // seated box = saddle height + 0.62 × rider height (riding.js formula), re-derived now that both are boss-scaled
    if (rider && mount && rider.mountedOn === mount && rider.hurt) rider.hurt.h = (mount.saddleY || 0) + rider.height * 0.62;
    if (rider && mount) mountedBoss(game, rider, mount);
    const members = rider ? [rider] : [];
    // boss-only art (viper captain tier + the wyrm): stronger rim so the pair reads over heroes + fire VFX
    for (const a of [rider, mount]) if (a && (a.modelRoot || a.view)) try { bossRim(a.modelRoot || a.view, 1.4); } catch (e) { /* optional */ }
    try { wyrmRiderLook(game, rider, mount); } catch (e) { /* cosmetic */ }   // r9: material breakup + value range (boss instance only)
    // the eagle's head (foreground, right third) hid her in r2; tail lip on left. C2 r13 (board r12: "the eagle-head
    // foreground mass dwarfs the Wyrm Rider at the game camera"): she fills more of the frame (span 0.6 → the camera
    // dollies in) and the frame's right edge stops at x 4.2 at her depth (head base x 4.85), so the boss owns the shot.
    const R13 = !/[?&]bossframe=0/.test(typeof location !== 'undefined' ? location.search : '');
    const camOpts = R13 ? { wallLeft: 0.38, wallRight: 0.56, span: 0.6, viewMaxX: 4.2 } : { wallLeft: 0.38, wallRight: 0.56 };
    const G = groupBoss(game, { name: NAME, title: TITLE, typeId: 'cinderwyrm', members, element: 'fire', camera: camOpts });
    return {
      lead: G.proxy, actors: members, tokens: [G.token], group: G, mount,
      camera: camOpts,
      begin() {
        game.track(G.intro({ focus: rider || { pos: { x: spawnX, y: 0, z: 0 } }, ticks: 140, distance: 12.8, height: 3.8, lookHeight: 1.85, announceAt: 70, onBeat(t) {
          if (t === 70 && game.audio && game.audio.play) game.audio.play('roar', { volume: 0.9, pitch: 0.8 });
          if (t === 72 && game.cameraRig && game.cameraRig.shake) game.cameraRig.shake(0.4);
        } }));
      },
    };
  },
  stance(game, rider) { if (rider) useClipSet(rider, 'boss_wyrm_rider'); },
  async create(game, opts = {}) { const enc = await this.encounter(game, opts); enc.begin(); return enc.actors[0]; },
};
