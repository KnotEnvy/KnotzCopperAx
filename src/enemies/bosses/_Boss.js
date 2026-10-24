// Boss base class (private helper; not a registry entry). Extends Enemy with everything a boss encounter needs:
//   - kind 'boss' (CrowdDirector/tokens/throws ignore it), model scaled to def.height (GLBs are built at a 2.0 m rig)
//   - scripted states: bossWait (hidden until the intro starts) → bossIntro (invulnerable, script.intro) → idle …
//     phaseShift (invulnerable transformation, script.phaseShift) · the brain (src/ai/bosses/<id>.js) runs in idle/walk
//   - HP phases: def.phases = [{ at: 0.5 }] — damage is clamped at a threshold until the phase change has played, so a
//     burst can never skip a phase. EV.BOSS_PHASE { boss, phase } is emitted (music layers, UI).
//   - poise (r7, src/enemies/bosses/_poise.js): super-armour on every move, tiny flinches with a no-stunlock grace, a
//     poise meter that only breaks after a real combo (→ readable STAGGER + big damage window, then break immunity and an
//     armoured counter); bosses are never launched / juggled. `vulnerable` windows (crouch plants) drop the armour, take
//     def.vulnerableMul damage and burn the meter ×2.2. def.poise = {..} tunes it, def.poise === false turns it off.
//   - EV.BOSS_INTRO { boss } at the reveal beat (HUD boss bar + boss card + music); `boss:*` private events.
//   - defeat: the killing blow freezes (hitstop), slow-mo, white KO flash + CA pulse, a drama zoom on the boss, every
//     minion collapses, heroes are made safe, then script.finale(boss) plays before the stage may clear (the boss holds
//     a 'finale token' in the level's waveActors until the finale ends).
// Script object (per boss, passed as opts.script by the type's create): { intro(b, t) → bool done, phaseShift(b, t, phase)
//   → bool done, finale(b) → Promise, onPhase?(b, phase), update?(b, dt), render?(b, alpha, frameDt), dispose?(b) }
import { Enemy } from '../Enemy.js';
import { EV } from '../../core/EventBus.js';
import { reportError } from '../../core/log.js';
import { bossRim, bossGrade } from './_look.js';
import { initPoise, poisePre, poiseHit, tickPoise, resetPoise } from './_poise.js';
import { bossCam } from './_camera.js';
import { bossSpacing } from './_spacing.js';
import { introLock } from './_group.js';

export class Boss extends Enemy {
  constructor(game, def, model, opts = {}) {
    super(game, { ...def, kind: 'boss' }, model, { ...opts, enterFrom: null, rise: false });
    this.kind = 'boss';
    this.script = opts.script || {};
    this.phase = opts.phase || 1;
    this.phases = (def.phases || []).map((p, i) => ({ ...p, id: i + 2 }));
    this.pendingPhase = null;
    this.kdCool = 0;
    this.vulnerable = 0;
    this.removeOnDeath = false;
    this.superArmor = def.armorDamage ?? 9;
    this.minions = new Set();
    this.showcase = !!opts.showcase;
    this._plinth = opts.captives === false;
    this._arena = (opts.hook && opts.hook.arena && opts.hook.arena.x) || opts.arena || null;
    this.introDone = false;
    this.defeated = false;
    this.token = { alive: true, removed: false, boss: this };
    // Scale the model to the boss height (rigs are authored at ~2 m; placeholder rigs already honour def.height).
    if (this.model && this.model.source === 'glb' && this.model.hipHeight) {
      const k = (def.height * (def.hipRatio ?? 0.5)) / this.model.hipHeight;
      if (Number.isFinite(k) && k > 0.3 && k < 4) this.modelRoot.scale.multiplyScalar(k);
    }
    // C2 r12 body proportions (board r11: "Varkhul and Morvane share one armoured body volume"): def.bodyScale =
    // [width, depth] in model space on top of the height fit — Varkhul a narrower, taller column, Morvane broad and heavy.
    // _bodyY0 = the model's height scale (finales that squash the body use it instead of scale.x).
    if (this.modelRoot && Array.isArray(def.bodyScale) && !(typeof location !== 'undefined' && /[?&]bodyscale=0/.test(location.search))) {
      this.modelRoot.scale.x *= def.bodyScale[0]; this.modelRoot.scale.z *= def.bodyScale[1] ?? def.bodyScale[0];
    }
    this._bodyY0 = this.modelRoot ? this.modelRoot.scale.y : 1;
    if (this.model && this.model.source === 'glb') try { bossRim(this.modelRoot, def.rim ?? 1.4); } catch (e) { reportError('boss.rim', e); }
    // r6: boss-only key/rim rig + armour grade (def.grade → _look.js bossGrade; uniforms only, handle.k drives it)
    this.lightRig = null;
    if (this.model && this.model.source === 'glb' && def.grade && !(typeof location !== 'undefined' && /[?&]bossgrade=0/.test(location.search))) try { this.lightRig = bossGrade(this.modelRoot, def.grade); } catch (e) { reportError('boss.grade', e); }
    this.fsm.define(bossStates());
    this.poise = def.poise === false ? null : initPoise(this, def.poise || {}, { wrap: false });
    this.fsm.go(opts.skipIntro ? 'idle' : 'bossWait');
    if (opts.skipIntro) { this.introDone = true; if (!this._plinth) this.ensureCam(); }
  }

  get controllable() { return this.alive && this.introDone && this.fsm.is('idle', 'walk') && this.hitstop <= 0 && !this.pendingPhase; }

  /** Ensure the boss-framing camera mode is running (both in-stage and in showcase fight/intro scenes). */
  ensureCam() {
    const g = this.game, rig = g && g.cameraRig;
    if (this._plinth || !rig || rig.manual || g._bossCam || (g.params && g.params.get && g.params.get('bosscam') === '0')) return;
    const arena = this._arena || (rig.lock ? [rig.lock.xMin, rig.lock.xMax] : null);
    try { bossCam(g, { ...(this.def && this.def.camera || {}), lead: this, arena }); } catch (e) { reportError('boss.camera', e); }
  }

  /** Start the intro now (the hook runner calls it; the showcase calls it on a timer). */
  beginIntro() { this.ensureCam(); if (this.fsm.is('bossWait')) this.fsm.go('bossIntro'); }

  /** Reveal beat: boss card + HUD boss bar + music. */
  announce() {
    this.ensureCam();
    if (this._announced) return;
    this._announced = true;
    this.game.bus.emit(EV.BOSS_INTRO, { boss: this });
  }

  canBeHit(ev) {
    if (this.fsm.is('bossWait', 'bossIntro', 'phaseShift') || this.defeated) return false;
    return super.canBeHit(ev);
  }

  /** Boss flashes are tempered: a full-strength emissive wash turns the big dark-armoured silhouette into a flat
   *  peach cut-out (seen in r2 stage-5 captures) — keep the read, lose the wash. */
  flash(color = '#ffffff', ticks = 4, strength = 1.5) { super.flash(color, ticks, Math.min(0.85, strength * 0.45)); }

  receiveHit(ev) {
    const D = this.def;
    if (this.vulnerable > 0 && ev.level !== 'magic') { ev.damage *= D.vulnerableMul ?? 1.5; }
    if (this.poise) poisePre(this, ev);
    else {   // legacy path (&poise=0): knockdown rationing + flat super-armour
      if ((ev.knockdown || ev.launch > 0) && this.kdCool > 0 && this.vulnerable <= 0) { ev.knockdown = false; ev.launch = 0; ev.knockback = Math.min(ev.knockback || 0, 1.5); }
      this.superArmor = this.vulnerable > 0 ? 0 : (D.armorDamage ?? 9);
    }
    // Phase threshold clamp: damage stops at the next phase line until the transformation has played.
    const next = this.phases.find((p) => p.id === this.phase + 1);
    if (next && !this.showcaseLock) {
      const line = Math.ceil(this.maxHp * next.at);
      if (this.hp - ev.damage <= line) {
        ev.damage = Math.max(0, this.hp - line);
        this.pendingPhase = next.id;
        ev.knockdown = false; ev.launch = 0;
      }
    }
    // Lethal blow: no ragdoll launch — the boss stays on its feet for its own defeat choreography.
    if (this.alive && ev.damage >= this.hp && !this.godMode) {
      this.lastHitBy = ev.attacker; this.hp = 0; this.damageTaken += ev.damage; ev.killed = true; this.alive = false;
      this.flash('#ffffff', 10, 2.0);
      if (this.attack) this.endMove();
      this.beginDefeat(ev);
      this.fsm.go('bossDying', ev);
      return true;
    }
    const ok = this.poise ? poiseHit(this, ev, (e) => super.receiveHit(e)) : super.receiveHit(ev);
    if (!this.poise && ok && this.fsm.is('knockdown')) this.kdCool = D.kdCooldown ?? 360;
    return ok;
  }

  // ---------------------------------------------------------------- minions (summons count toward the wave)
  addMinion(e) {
    if (!e) return;
    this.minions.add(e);
    const lv = this.game.levels;
    if (lv && lv.waveActors && this.inStage) lv.waveActors.add(e);
  }
  liveMinions() { let n = 0; for (const m of this.minions) if (m.alive && !m.removed) n++; else this.minions.delete(m); return n; }

  heroes() { return this.game.world.query({ kind: 'hero' }).filter((h) => h.alive && !h.removed); }

  // ---------------------------------------------------------------- defeat
  beginDefeat(ev) {
    if (this.defeated) return;
    this.defeated = true;
    const g = this.game;
    g.bus.emit('boss:defeat', { boss: this, by: ev && ev.attacker });
    try {
      g.hitstop(16);
      g.slowmo(0.22, 1.5, { inTime: 0.05, out: 0.7 });
      const post = g.renderer && g.renderer.post;
      if (post && post.pulse) {   // r10: was ca 0.8 / flash 1.0 (cream blank frame). Re-asserted next tick: the killing
        // hit's own ScreenFx KO pulse lands after this call in the same hit and would replace the defeat desat.
        const P = () => post.pulse({ flash: 0, ca: 0.01, desat: 0.55, duration: 0.9 });
        P(); if (g.after) g.after(1, P);
      }
      if (g.cameraRig && g.cameraRig.drama) this._defeatCam = g.cameraRig.drama({ focus: this, distance: 10, height: 3.2, fov: 30, lookHeight: this.height * 0.45, in: 0.2, hold: null, priority: 5 });
      if (g.cameraRig && g.cameraRig.shake) g.cameraRig.shake(0.8);
      if (g.vfx && g.vfx.spawn) {
        const p = { x: this.pos.x, y: this.height * 0.55, z: this.pos.z };
        g.vfx.spawn('hit_spark', { point: p, level: 'ko', dir: ev ? ev.dir : 1 });
        g.vfx.spawn('fx_shockwave', { pos: { x: p.x, y: 0.02, z: p.z }, radius: 4, element: this.def.element || 'earth', dust: true, debris: 14 });
      }
      for (const h of this.heroes()) h.invuln = Math.max(h.invuln || 0, 60 * 12);
      for (const e of g.world.query({ team: 'enemies' })) {
        if (e === this || !e.alive || e.removed) continue;
        if (g.combat) g.combat.applyHit(this, e, { damage: 999, knockdown: true, launch: 5, knockback: 3, level: 'magic', hitstop: 0 }, { moveId: 'boss_fall', dir: Math.sign(e.pos.x - this.pos.x) || 1 });
      }
    } catch (e) { reportError('boss.defeat', e); }
  }

  async runFinale() {
    try { await (this.script.finale ? this.script.finale(this) : Boss.defaultFinale(this)); }
    catch (e) { reportError(`boss:${this.typeId}.finale`, e); }
    if (this._defeatCam) { this._defeatCam.release(); this._defeatCam = null; }
    for (const h of this.heroes()) h.invuln = Math.min(h.invuln, 30);
    this.token.alive = false;
    this.game.bus.emit('boss:finaleDone', { boss: this });
    // Final victory of the chapter (Morvane): the ending sequence listens for 'chapterComplete' (CHANGELOG_SHARED).
    if (this.def && this.def.chapterFinal) this.game.bus.emit('chapterComplete', { boss: this, chapter: 1, stage: this.game.levels && this.game.levels.stage && this.game.levels.stage.id });
    if (!this.showcase) this.remove();
  }

  onDeath() {
    super.onDeath();
    if (!this._finaleStarted) { this._finaleStarted = true; this.runFinale(); }
  }

  /** Default finale (scripts override): collapse, linger, fade. */
  static async defaultFinale(b) {
    b.play('death', { restart: true, fade: 0.2, fallback: ['knockdown'] });
    await b.game.wait(100);
    for (let i = 0; i < 40; i++) { b.blink = 2; await b.game.wait(1); }
  }

  update(dt) {
    if (this.kdCool > 0) this.kdCool--;
    if (this.vulnerable > 0) { this.vulnerable--; if (this.vulnerable === 0) this.superArmor = this.def.armorDamage ?? 9; }
    if (this.poise) tickPoise(this);
    if (this.pendingPhase && this.alive && this.fsm.is('idle', 'walk', 'attack', 'hitstun', 'pause', 'block', 'stagger') && this.grounded) this.fsm.go('phaseShift', { phase: this.pendingPhase });
    if (this.script.update) { try { this.script.update(this, dt); } catch (e) { reportError(`boss:${this.typeId}.update`, e); this.script.update = null; } }
    if (!this.fsm.is('bossWait', 'bossIntro', 'phaseShift', 'bossDying')) try { bossSpacing(this); } catch (e) { reportError('boss.spacing', e); }
    super.update(dt);
  }

  render(alpha, frameDt) {
    super.render(alpha, frameDt);
    if (this.script.render) { try { this.script.render(this, alpha, frameDt); } catch (e) { reportError(`boss:${this.typeId}.render`, e); this.script.render = null; } }
  }

  onRemove() {
    super.onRemove();
    if (this._introLocked) { this._introLocked = false; introLock(this.game, -1); }
    this.token.alive = false;
    if (this.script.dispose) { try { this.script.dispose(this); } catch (e) { reportError(`boss:${this.typeId}.dispose`, e); } }
  }
}

function bossStates() {
  return {
    bossWait: {
      tags: ['busy', 'invuln'],
      enter(b) { b.hurtable = false; b.solid = false; b.vel.set(0, 0, 0); b.view.visible = false; b.play('idle', { fade: 0 }); },
      update(b, dt) { b.friction(20, dt); b.view.visible = false; return undefined; },
      exit(b) { b.hurtable = true; b.solid = true; b.view.visible = true; },
    },
    bossIntro: {
      tags: ['busy', 'invuln'],
      enter(b) {
        b.hurtable = false; b.vel.set(0, 0, 0);
        // C2 r1: bossWait.exit shows the body; a script whose intro reveals it later (Morvane rises from the bone pile)
        // sets hiddenIntro — else it stood fully visible for one rendered frame before its first intro tick hid it
        if (b.script && b.script.hiddenIntro) b.view.visible = false;
        if (!b._introLocked) { b._introLocked = true; introLock(b.game, 1); }   // C2 r12: bots hold their magic through the reveal
        b.game.bus.emit('boss:intro', { boss: b });
      },
      update(b, dt) {
        b.friction(20, dt);
        let done = true;
        try { done = b.script.intro ? b.script.intro(b, b.fsm.ticks) : b.fsm.ticks > 60; } catch (e) { reportError(`boss:${b.typeId}.intro`, e); done = true; }
        if (b.fsm.ticks === 20 && !b.script.intro) b.announce();
        if (done || b.fsm.ticks > 60 * 12) return 'idle';
        return undefined;
      },
      exit(b) {
        b.hurtable = true; b.introDone = true; b.announce();
        if (b._introLocked) { b._introLocked = false; introLock(b.game, -1); }
        if (b.game && b.game.ui && b.game.ui.dismissBossCard) b.game.ui.dismissBossCard(0.45);
        b.invuln = Math.max(b.invuln, 20);
      },
    },
    bossDying: {
      tags: ['busy', 'dead'],
      enter(b, ev) {
        b.hurtable = false; b.solid = false; b.vel.x = (ev && ev.dir ? ev.dir : -b.facing) * 1.2; b.vel.z = 0;
        b.play(b.def.dyingAnim || 'hit_high', { restart: true, fade: 0.05, duration: 0.9, fallback: ['hit_high'] });
        b.onDeath();
      },
      update(b, dt) { b.friction(6, dt); return undefined; },
    },
    phaseShift: {
      tags: ['busy', 'invuln'],
      enter(b, d) {
        b.shiftTo = d.phase; b.hurtable = false; b.vel.set(0, 0, 0);
        if (b.attack) b.endMove();
        b.game.bus.emit('boss:phaseShift', { boss: b, phase: d.phase });
      },
      update(b, dt) {
        b.friction(20, dt);
        let done = true;
        try { done = b.script.phaseShift ? b.script.phaseShift(b, b.fsm.ticks, b.shiftTo) : b.fsm.ticks > 60; } catch (e) { reportError(`boss:${b.typeId}.phaseShift`, e); done = true; }
        if (done || b.fsm.ticks > 60 * 10) return 'idle';
        return undefined;
      },
      exit(b) {
        b.phase = b.shiftTo || b.phase + 1; b.pendingPhase = null; b.hurtable = true; b.invuln = Math.max(b.invuln, 30); b.kdCool = Math.max(b.kdCool, 600);
        if (b.poise) resetPoise(b, 300);
        b.game.bus.emit(EV.BOSS_PHASE, { boss: b, phase: b.phase });
        if (b.script.onPhase) try { b.script.onPhase(b, b.phase); } catch (e) { reportError(`boss:${b.typeId}.onPhase`, e); }
      },
    },
  };
}
