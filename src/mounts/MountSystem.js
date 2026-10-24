// MountSystem (game.mounts): spawns bizarrians and owns the riding / stealing rules (DESIGN §5, §10).
//
//   const m = await game.mounts.spawn('cluckhorn', { x, z, rider })     rider = an Actor, or an ENEMY TYPE id string
//        ('marauder', 'viper'…; spawned via enemies/spawnEnemy.js, seated at once; knights/ogres (canRide:false) refuse)
//        extra opts for a string rider: riderOpts { tier, elite, … }, enterFrom { x, z } (ride in from off-screen;
//        default when x is outside the camera), wave (default true: counts toward the level director's wave clear)
//   game.mounts.list()          live beasts        game.mounts.clear()   remove every beast (between stages)
//
// Rules (preHit hook on game.combat): a hit on an ENEMY rider always knocks him off (floored, launched from the seat).
// A HERO rider is only knocked off by big hits (knockdown / launch / heavy / magic / `hit.dismount` jump-slashes /
// lethal / beast HP gone); smaller hits are soaked: the beast takes `def.soak` of the damage, the rider the rest,
// and the rider is not interrupted. Beasts flee when their HP runs out or when struck hard while riderless.
// Enemies that were knocked off climb back on their beast if it is still free and they land next to it.
// Type module: { id, name, hp, speed, run, jump, height, radius, saddleY, soak, attacks, buttons: { light, heavy,
//   dash, air }, gate?(mount, rider, key) → key, onAttackTick?(mount, rider, run, id), create(game, opts, { Mount, def }) }
// Events: EV.MOUNT / EV.DISMOUNT { rider, mount, knocked }, 'mounts:hop', 'mounts:riderOff', 'mounts:flee',
//   'mounts:hurt', 'mounts:soak' { rider, mount, damage }, 'mounts:attack' { mount, rider, id }.
import * as THREE from 'three';
import { registries } from '../core/registries.js';
import { Mount } from './Mount.js';
import { adoptRider } from './riding.js';
import { reportError } from '../core/log.js';
import { EV } from '../core/EventBus.js';
import { safeImport } from '../core/safeImport.js';
import { RiderHud } from './hud.js';

const _p = new THREE.Vector3();

export class MountSystem {
  constructor(game) {
    this.game = game; this.name = 'mounts'; this.order = 25;
    this.mounts = new Set();
    this._hooked = false;
    this.scope = game.bus.scope ? game.bus.scope() : null;
    if (this.scope) {
      // Beasts are lost between stages (DESIGN §10).
      this.scope.on(EV.STAGE_START, () => this.clear());
      this.scope.on(EV.STAGE_CLEAR, () => this.clear());
      this.scope.on(EV.ATTACK_START, (e) => { const a = e.actor; if (a && a.mountedOn && e.moveId && e.moveId.startsWith('beast_')) game.bus.emit('mounts:attack', { mount: a.mountedOn, rider: a, id: e.moveId.slice(6) }); });
    }
    try { this.hud = new RiderHud(game, this); } catch (e) { this.hud = null; reportError('mounts.hud', e); }
  }

  list() { const out = []; for (const m of this.mounts) if (!m.removed) out.push(m); else this.mounts.delete(m); return out; }

  clear() { for (const m of this.list()) { if (m.rider) m.dismount({ knocked: false, silent: true }); m.remove(); } this.mounts.clear(); }

  async spawn(id, opts = {}) {
    const def = await registries.mounts.load(id);
    if (!def) return null;
    this._hook();
    let m = null;
    try { m = def.create ? await def.create(this.game, opts, { Mount, def }) : new Mount(this.game, def, opts); } catch (e) { reportError(`mount:${id}`, e); return null; }
    if (!m) return null;
    if (opts.add !== false) this.game.world.add(m);
    this.mounts.add(m);
    let rider = opts.rider;
    if (typeof rider === 'string') rider = await this._spawnRider(rider, m, opts);
    if (rider && rider.alive) { adoptRider(rider); m.mount(rider, { force: true }); }
    return m;
  }

  async _spawnRider(type, m, opts) {
    const g = this.game;
    const base = await registries.enemies.load(type);
    if (!base || base.canRide === false) return null;
    const E = await safeImport(() => import('../enemies/spawnEnemy.js'), 'enemies/spawnEnemy');
    if (!E) return null;
    const cam = g.cameraRig;
    const vis = cam && cam.visibleRange ? cam.visibleRange(m.pos.z) : null;
    let enterFrom = opts.enterFrom || null;
    if (!enterFrom && vis && (m.pos.x < vis.xMin || m.pos.x > vis.xMax)) {
      const fromLeft = m.pos.x < vis.xMin;
      enterFrom = { x: fromLeft ? vis.xMin + 2.5 : vis.xMax - 2.5, z: m.pos.z, speed: 1.6 };
    }
    const p = E.spawnEnemy(g, type, { x: m.pos.x, z: m.pos.z, facing: opts.facing ?? (m.pos.x > (vis ? (vis.xMin + vis.xMax) / 2 : 0) ? -1 : 1), enterFrom, ...(opts.riderOpts || {}) });
    if (g.track) g.track(p);
    const e = await p;
    if (!e) return null;
    if (opts.wave !== false && g.levels && g.levels.waveActors && g.levels.waveActors.add) { e.tags.add('wave'); g.levels.waveActors.add(e); }
    return e;
  }

  /** Install the knock-off / soak rules once (combat may load after us). */
  _hook() {
    if (this._hooked || !this.game.combat || !this.game.combat.preHitHooks) return;
    this._hooked = true;
    this.game.combat.preHitHooks.push((ev) => this._preHit(ev));
  }

  _preHit(ev) {
    const t = ev.target, m = t && t.mountedOn;
    if (!m || !t._seated) return undefined;
    if (!t.canBeHit || !t.canBeHit(ev)) return undefined; // the pipeline will reject it; don't unseat on a whiff
    const w = ev.hit || {};
    if (t.kind !== 'hero' && !t.heavyRider) {   // heavyRider (boss riders, bosses agent): hero-style soak rules
      // Enemy rider: any clean hit knocks him out of the saddle (GA); the beast is startled.
      m.hp -= ev.damage * 0.5;
      this._knockOff(t, m, ev);
      return undefined;
    }
    const lethal = t.hp - ev.damage * (1 - (m.def.soak ?? 0.5)) <= 0 && !t.godMode;
    const big = !ev.keepSeat && (ev.knockdown || w.knockdown || (ev.launch || 0) > 0 || ev.level === 'heavy' || ev.level === 'magic' || w.dismount || w.unblockable);
    const soak = ev.damage * (m.def.soak ?? 0.5);
    m.hp -= soak;
    ev.damage -= soak;
    this.game.bus.emit('mounts:soak', { rider: t, mount: m, damage: soak });
    if (big || lethal || m.hp <= 0) { this._knockOff(t, m, ev); return undefined; }
    // Small hit: the beast flinches, the rider rides it out (superArmor keeps the state).
    m.flinch = 10; m.hurtLean = ev.dir || -m.facing;
    return undefined;
  }

  _knockOff(t, m, ev) {
    m.dismount({ knocked: true });
    ev.knockdown = true;
    ev.launch = Math.max(ev.launch || 0, 4.2);
    ev.knockback = Math.max(ev.knockback || 0, 2.6);
    m.flinch = 16; m.hurtLean = ev.dir || -m.facing;
    m.vel.x = (ev.dir || 1) * 1.5;
    if (m.hp <= 0) this.game.after(12, () => m.flee());
  }

  update() {
    this._hook();
    const g = this.game;
    const beasts = this.list();
    // Heroes get the rider hooks as soon as a beast exists (the hop-on check lives in the fsm.go wrapper).
    if (beasts.length) for (const h of g.world.query({ kind: 'hero', alive: false })) if (!h._rideAdopted) adoptRider(h);
    for (const m of beasts) {
      const r = m.rider;
      if (r) {
        if (r.removed || !r.alive) { m.dismount({ knocked: true, silent: true }); continue; }
        m.follow(r);
        continue;
      }
      if (!m.free) continue;
      // Knocked-off enemies climb back on when they get up next to their free beast.
      for (const e of g.world.query({ team: 'enemies', near: { x: m.pos.x, z: m.pos.z, r: 1.3 } })) {
        if (e.kind === 'boss' || e.mountedOn || !e.controllable || (e.def && e.def.canRide === false)) continue;
        if (e !== m.lastRider && !(e.def && e.def.rider)) continue;
        if (!m.canMount(e)) continue;
        adoptRider(e);
        e.fsm.go('mountUp', { mount: m });
        break;
      }
    }
  }

  render() {
    // Pin every seated rider's body to its beast's saddle (after the world interpolated both views).
    for (const m of this.mounts) {
      const r = m.rider;
      if (!r || m.removed || !r._seated) continue;
      m.saddleWorld(_p);
      const v = r.view.position;
      r.body.position.set(_p.x - v.x, _p.y - v.y, _p.z - v.z);
      r.body.rotation.y = m.body.rotation.y + (m.spinYaw || 0); // same yaw as the beast (+ its tail-whip spin)
    }
    if (this.hud) { try { this.hud.update(); } catch (e) { reportError('mounts.hud', e); this.hud = null; } }
  }
}
