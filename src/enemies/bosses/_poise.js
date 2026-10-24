// Boss POISE (bosses r7 — critic r6 6.5: "the bosses have NO POISE: the lead boss is on the floor for a large share of
// samples, juggled / stunlocked like a grunt, so fights read as beating up a dummy").
//
// One system for every boss body (the Boss class: Morvane, Varkhul; and the group members that are regular Enemy actors:
// Brute Brothers, Captains, the Wyrm Rider). What it does to an incoming hit:
//   - SUPER-ARMOUR: while the boss is mid-move (attack / clinch) or airborne / on the floor, nothing interrupts it: the
//     hit deals its damage (+ flash, spark) but never a hitstun, knockback, knockdown, launch, juggle or ground bounce.
//     Victim + attacker hitstop are capped (a swinging boss no longer freezes under every hit).
//   - FLINCH: out of a move (idle / walk / recovery) a hit gives a tiny hitstun (≤ flinch.ticks) and then a `grace`
//     window with no further flinch — no stunlock. Knockdown / launch / bounce are stripped from every hit.
//   - POISE METER: every landed hit adds poise damage (its damage + bonuses for a knockdown ender / launcher / heavy /
//     magic). The meter refills after `regenDelay` ticks without a hit. It only breaks after a real combo.
//   - STAGGER (the payoff): on break the boss reels — a readable stagger (rocked-back pose, dizzy sparkles, flash,
//     shockwave, slow-mo blip, camera punch, ×`stagger.mul` damage for `stagger.ticks`) and is then IMMUNE for
//     `immune` ticks (the meter can't drop below `floor`), so a stagger can't chain into another; it ends with an
//     armoured COUNTER-attack when a hero is standing in reach (also after any getup).
//   - GETUPS: if a floor state is ever entered (unseated rider …) down / getup are short and end with the counter.
//   &poise=0 in the URL disables the system (A/B against the old behaviour).
// API: initPoise(actor, cfg, { wrap }) · poisePre(actor, ev) · poiseHit(actor, ev, call) · tickPoise(actor) · resetPoise(actor)
//      actor.poise = { cur, max, frac, immune, stagger, breaks, flinches, ... } (read by the boss HUD sliver).
import { EV } from '../../core/EventBus.js';
import * as THREE from 'three';
import { reportError } from '../../core/log.js';

const DEF = {
  max: 64,               // poise points (× (1 + coop) per extra hero)
  coop: 0.45,
  regenDelay: 110,       // ticks after the last hit before the meter refills
  regen: 0.3,            // points / tick
  add: { knockdown: 5, launch: 4, heavy: 2, magic: 7 },   // bonus poise damage per hit type
  floor: 0.34,           // during immunity the meter cannot drop below this fraction
  immune: 540,           // ticks of break immunity after a stagger / getup
  refill: 0.75,          // meter after a stagger (fraction)
  vulnMul: 2.2,          // poise damage ×N while def-scripted `vulnerable` (Morvane's crouch)
  flinch: { ticks: 7, grace: 56, knock: 0.7 },
  hitstop: 4,            // cap (attacker) for armoured hits; the victim keeps ≤ 2
  stagger: { ticks: 96, mul: 1.4, shove: 3.0, anim: 'blocked', hitstop: 12 },
  down: 22, getup: 20, getupInvuln: 4,
  counter: null, counterReach: 2.6, counterDz: 0.9,
};

const merge = (c) => ({ ...DEF, ...c, add: { ...DEF.add, ...(c.add || {}) }, flinch: { ...DEF.flinch, ...(c.flinch || {}) }, stagger: { ...DEF.stagger, ...(c.stagger || {}) } });
const FLOOR_STATES = ['knockdown', 'down', 'getup', 'thrown', 'grabbed', 'unhorsed'];   // unhorsed: wyrm_rider.js knock-off

function heroCount(game) { let n = 0; for (const h of game.world.query({ kind: 'hero' })) if (h.alive !== false && !h.removed) n++; return Math.max(1, n); }

/** Attach the poise system to a boss body. wrap: true → hook receiveHit / update on the instance (group members). */
export function initPoise(a, cfg = {}, { wrap = false } = {}) {
  if (typeof location !== 'undefined' && /[?&]poise=0/.test(location.search)) return null;
  const C = merge(cfg), g = a.game;
  const P = { C, cur: C.max, max: C.max, immune: C.spawnImmune ?? 480, stagger: 0, graceUntil: 0, lastHit: -1e9, breaks: 0, flinches: 0, counterAt: -1, prev: null, n: 0, on: true,
    get frac() { return this.max > 0 ? Math.max(0, Math.min(1, this.cur / this.max)) : 0; } };
  a.poise = P;
  rescale(a);
  a.downTicks = C.down; a.getupTicks = C.getup; a.getupInvuln = C.getupInvuln;
  a.fsm.define({ stagger: staggerState() });
  if (!g._poiseHs) {   // armoured hits: the victim's hitstop is clamped after CombatSystem applied it
    g._poiseHs = true;
    g.bus.on(EV.HIT, (e) => { if (e._poiseCap !== undefined && e.target && e.target.hitstop > e._poiseCap) e.target.hitstop = e._poiseCap; });
  }
  if (wrap) {
    a.def = { ...a.def, throwable: false };   // a boss is never thrown (hero canThrow(): kind 'boss' / def.throwable)
    const rh = a.receiveHit.bind(a), up = a.update.bind(a);
    a.receiveHit = (ev) => { poisePre(a, ev); return poiseHit(a, ev, rh); };
    a.update = (dt) => { tickPoise(a); up(dt); };
  }
  return P;
}

function rescale(a) {
  const P = a.poise; if (!P) return;
  const m = P.C.max * (1 + P.C.coop * (heroCount(a.game) - 1));
  if (Math.abs(m - P.max) > 0.01) { P.cur = P.cur / P.max * m; P.max = m; }
}

/** Damage multiplier for a staggered boss (call BEFORE the phase clamp / lethal check so the clamp stays exact). */
export function poisePre(a, ev) {
  const P = a.poise;
  if (P && P.stagger > 0 && !ev._poiseMul) { ev._poiseMul = 1; ev.damage *= P.C.stagger.mul; }
}

/** The hit itself. `call(ev)` is the boss's original receiveHit. */
export function poiseHit(a, ev, call) {
  const P = a.poise;
  if (!P || !a.alive || a.removed || (ev.damage >= a.hp && !a.godMode)) return call(ev);
  if (a.fsm.is('thrown', 'grabbed')) return call(ev);   // the throw's landing hit is what ends 'thrown' — never sanitise it
  const C = P.C, now = a.game.tick, w = ev.hit || {}, s = a.fsm.name;
  a.stunChain = 0;                         // Enemy anti-stunlock floor: the poise meter is the rule for bosses
  const kd = !!(ev.knockdown || w.knockdown), lch = (ev.launch || 0) > 0 || (w.launch || 0) > 0;
  const vuln = a.vulnerable > 0;
  let mode = 'flinch';
  if (P.stagger > 0 || s === 'stagger') mode = 'stagger';
  else if (!a.grounded || FLOOR_STATES.includes(s)) mode = 'floor';
  else if (a.mountedOn || ((s === 'attack' || s === 'clinch') && !vuln)) mode = 'armor';   // in the saddle the beast carries her: no flinch, no stagger
  else if (now < P.graceUntil) mode = 'grace';
  // poise damage of this blow
  let pd = ev.damage;
  if (kd) pd += C.add.knockdown;
  if (lch) pd += C.add.launch;
  if (ev.level === 'heavy') pd += C.add.heavy; else if (ev.level === 'magic') pd += C.add.magic;
  if (vuln) pd *= C.vulnMul;
  if (mode === 'stagger') pd = 0;
  const immune = P.immune > 0;
  const floor = P.max * C.floor;
  const next = immune ? Math.max(floor, P.cur - pd) : P.cur - pd;
  const brk = !immune && mode !== 'stagger' && mode !== 'floor' && !a.mountedOn && next <= 0;
  // sanitise the hit: bosses are never launched / juggled / bounced
  const armour = a.superArmor;
  ev.knockdown = false; ev.launch = 0;
  ev.hit = { ...w, knockdown: false, launch: 0, bounce: 0 };
  if (mode === 'flinch' && !brk) {
    ev.hitstun = Math.min(ev.hitstun || 0, C.flinch.ticks);
    ev.knockback = Math.min(ev.knockback || 0, C.flinch.knock);
    a.superArmor = 0;
  } else {
    a.superArmor = 1e6;
    if (brk) ev.hitstop = Math.max(ev.hitstop || 0, C.stagger.hitstop);
    else { ev.hitstop = Math.min(ev.hitstop || 0, C.hitstop); ev._poiseCap = 2; }
  }
  const ok = call(ev);
  a.superArmor = armour;
  if (mode === 'flinch' && !brk && ok && !ev.blocked && a.fsm.is('hitstun')) { P.graceUntil = now + C.flinch.ticks + C.flinch.grace; P.flinches++; }
  if (ok && !ev.blocked && a.alive && mode !== 'stagger') {
    P.lastHit = now;
    P.cur = next;
    if (brk && !a.removed) breakPoise(a, ev);
    else if (P.cur <= 0 && !immune) P.cur = 1;         // would break, but the boss is airborne / on the floor: defer
  }
  return ok;
}

function breakPoise(a, ev) {
  const P = a.poise;
  P.breaks++; P.cur = 0;
  a.game.bus.emit('boss:stagger', { boss: a, by: ev.attacker, breaks: P.breaks });
  a.fsm.go('stagger', { dir: ev.dir || -a.facing, by: ev.attacker, point: ev.point });
}

/** Solo mercy: armoured bosses no longer get interrupted, so a lone hero takes far more of their damage
 *  (boss_solo probe r7: brutes 2.9 lives, captains 2.0, Morvane 2.1 of 3) — a solo hero takes `dmg`× from this boss. */
export function soloMercy(a, dmg = 0.75) { if (heroCount(a.game) <= 1) a.damageMul = (a.damageMul || 1) * dmg; }

/** Refill + short immunity (phase shifts, scripted resets). */
export function resetPoise(a, immune = 300) {
  const P = a.poise; if (!P) return;
  if (P.stagger > 0 && a.fsm.is('stagger')) { P.stagger = 0; }
  P.cur = P.max; P.immune = Math.max(P.immune, immune); P.graceUntil = 0;
}

/** Per-tick upkeep: regen, immunity, counter-attack after a getup / stagger. Call before the brain runs. */
export function tickPoise(a) {
  const P = a.poise;
  if (!P || !a.alive) return;
  const C = P.C, now = a.game.tick, s = a.fsm.name;
  if (++P.n % 90 === 0) rescale(a);
  if (s !== P.prev) {
    if ((P.prev === 'getup' || P.prev === 'stagger') && s === 'idle') { P.immune = Math.max(P.immune, C.immune); if (C.counter) P.counterAt = now + 3; }
    P.prev = s;
  }
  if (P.immune > 0) P.immune--;
  if (P.stagger <= 0 && now - P.lastHit > C.regenDelay && P.cur < P.max) P.cur = Math.min(P.max, P.cur + C.regen);
  if (P.counterAt >= 0) {
    if (now > P.counterAt + 40) P.counterAt = -1;
    else if (now >= P.counterAt && a.controllable) { P.counterAt = -1; counter(a); }
  }
}

function counter(a) {
  const C = a.poise.C;
  if (!a.moves || !a.moves[C.counter]) return;
  let best = null, bd = 1e9;
  for (const h of a.game.world.query({ kind: 'hero' })) {
    if (!h.alive || h.removed || (h.fsm && h.fsm.is('down', 'getup', 'dead'))) continue;
    const ax = (h.pos.x - a.pos.x) * a.facing, dx = Math.abs(h.pos.x - a.pos.x), dz = Math.abs(h.pos.z - a.pos.z);
    if (dx > C.counterReach || dz > C.counterDz) continue;
    const d = dx + dz + (ax < -0.3 ? 0.8 : 0);
    if (d < bd) { bd = d; best = h; }
  }
  if (!best) return;
  a.attackWith(C.counter, best);
  a.game.bus.emit('boss:counter', { boss: a, moveId: C.counter });
}

/** Floating "STAGGERED" callout above the boss (one sprite per boss, built lazily): pops in, holds, fades with the stagger. */
function callout(a, on, t = 0, total = 90) {
  let sp = a._pzTag;
  if (!sp) {
    if (!on) return;
    try {
      const c = document.createElement('canvas'); c.width = 512; c.height = 96;
      const g = c.getContext('2d');
      g.font = '800 54px Georgia, "Times New Roman", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 12; g.strokeStyle = 'rgba(20,8,4,0.95)'; g.strokeText('STAGGERED', 256, 50);
      const gr = g.createLinearGradient(0, 22, 0, 78); gr.addColorStop(0, '#fff6d0'); gr.addColorStop(1, '#f0a838');
      g.fillStyle = gr; g.fillText('STAGGERED', 256, 50);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
      sp.renderOrder = 21; a.view.add(sp); a._pzTag = sp;
    } catch (e) { reportError('boss.staggerTag', e); return; }
  }
  if (!on) { sp.visible = false; return; }
  const k = Math.min(1, t / 7), pop = 1 + 0.35 * Math.sin(Math.min(1, t / 7) * Math.PI) * (1 - k * 0.3);
  sp.visible = true;
  sp.scale.set(2.3 * k * pop, 0.43 * k * pop, 1);
  sp.position.y = (a.height || 3) + 0.55 + Math.min(0.25, t * 0.006);
  sp.material.opacity = Math.max(0, Math.min(1, (total - t) / 18));
}

function staggerState() {
  return {
    tags: ['stunned'],
    enter(a, d) {
      const P = a.poise, S = P.C.stagger, g = a.game;
      if (a.attack) a.endMove();
      if (a.desired) a.desired.active = false;
      P.stagger = S.ticks;
      const dir = (d && d.dir) || -a.facing;
      a.vel.x = dir * S.shove / (a.weight || 1); a.vel.z = 0;
      if (a.grounded) a.setFacing(-dir);
      a.play(S.anim, { restart: true, fade: 0.05, duration: Math.max(0.5, S.ticks / 60 * 0.9), loop: false, fallback: ['hit_low', 'hit_high'] });
      a.flash('#fff0c0', 16, 1.6);
      callout(a, true, 0, S.ticks);
      try {
        const p = d && d.point ? { x: d.point.x, y: d.point.y, z: d.point.z } : { x: a.pos.x, y: a.height * 0.6, z: a.pos.z };
        if (g.vfx && g.vfx.spawn) {
          g.vfx.spawn('hit_spark', { point: p, level: 'ko', dir });
          g.vfx.spawn('fx_shockwave', { pos: { x: a.pos.x, y: 0.02, z: a.pos.z }, radius: Math.max(2.2, a.height * 0.9), element: (a.def && a.def.element) || 'earth', dust: true, debris: 8 });
          g.vfx.spawn('sparkle', { pos: { x: a.pos.x, y: a.height * 0.95, z: a.pos.z }, color: '#ffe08a', count: 10 });
        }
        if (g.cameraRig && g.cameraRig.shake) g.cameraRig.shake(0.55);
        if (g.slowmo) g.slowmo(0.4, 0.45, { inTime: 0.03, out: 0.3 });
        const post = g.renderer && g.renderer.post;
        if (post && post.pulse) post.pulse({ flash: 0, ca: 0.008, desat: 0.25, duration: 0.32 });   // r10: ca ≤ 0.01, no flash (PostFX mixes flash in linear HDR before tonemap: 0.08 already hazes the whole frame)
        if (g.audio && g.audio.play) { g.audio.play('hit_ko', { volume: 0.9, pitch: 0.75 }); g.audio.play('land_heavy', { volume: 0.8, pitch: 0.8, delay: 0.05 }); }
      } catch (e) { reportError('boss.stagger', e); }
    },
    update(a, dt) {
      const P = a.poise, t = a.fsm.ticks, dir = Math.sign(a.vel.x) || -a.facing;
      a.friction(5, dt);
      // reeling lean: the whole body rocks away from the blow (Combatant decays roll ×0.72 / tick)
      a.roll = -dir * (0.2 + 0.06 * Math.sin(t * 0.28)) * Math.min(1, t / 6);
      callout(a, true, t, P.C.stagger.ticks);
      if (t % 18 === 9 && a.game.vfx && a.game.vfx.spawn) a.game.vfx.spawn('sparkle', { pos: { x: a.pos.x, y: a.height * 1.0, z: a.pos.z }, color: '#ffe08a', count: 4 });
      if (--P.stagger <= 0) return 'idle';
      return undefined;
    },
    exit(a) {
      const P = a.poise;
      callout(a, false);
      P.stagger = 0; P.immune = P.C.immune; P.cur = P.max * P.C.refill; P.lastHit = a.game.tick; a.roll = 0;
      a.flash('#ffd890', 8, 0.8);
    },
  };
}
