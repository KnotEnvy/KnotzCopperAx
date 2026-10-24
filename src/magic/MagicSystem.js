// MagicSystem (game.magic): casts a hero's spell book (src/magic/spells/<def.magic.spell>.js) at a tier.
//
//   await game.magic.cast(hero, tier)
//
// Spell book module (default export):
//   { id, element, maxTier, tiers?: { [n]: { name } }, preload?(ctx), cast(ctx, hero, tier) → Promise }
// ctx (SpellContext) gives choreography helpers so spell files stay declarative:
//   ctx.game, ctx.vfx, ctx.camera, ctx.combat, ctx.bus, ctx.rng, ctx.tier, ctx.damage (= TIER_DAMAGE[tier])
//   ctx.wait(ticks) · ctx.enemies({ onScreen:true }) · ctx.hitAll(hitData, filter?) · ctx.hit(target, hitData)
//   hitData.damage defaults to ctx.damage, the canon per-enemy total for the tier (DESIGN §2: 4/8/16/24/32/40).
//   A multi-hit spell splits it: ctx.hitAll({ damage: ctx.damage / 4 }) ×4. Magic damage ignores the
//   difficulty/attacker multipliers (only the target's damageTakenMul applies, e.g. hero defence in PvP/duel).
// Determinism: spell books are preloaded (and game.track()ed) when a hero spawns, so cast() runs synchronously:
// magicCast is emitted on the tick the hero enters the cast, under the manual clock and in live play alike.
//   ctx.drama(opts) → handle (camera pull-back; see CameraRig.drama) · ctx.darken(amount, seconds) (world dim)
//   ctx.slowmo(scale, hold) · ctx.shake(t) · ctx.flash({ color, strength, duration }) · ctx.darkHold(amount) → release()
// magic-vfx r1: game.magic.spellLight(hero, color, intensity) (caster lit by the spell), game.magic.cutIn (T3+ face
// close-up inset, CutIn.js), Knot Surge (2 heroes cast within 0.5 s → knotSurge.js). Spell books use SpellKit.js.
// Scripted beats (bonus-camp r4): game.magic.lock() → unlock()  (casts are no-ops while held: no MAGIC_CAST, no VFX)
//   game.magic.cancelAll()  aborts every running cast / Knot Surge at its next wait (MAGIC_END still fires), releases
//   their camera dramas, dark holds, spell light, cut-in and slow-mo, and scrubs all spell VFX (incl. rock fields).
import { registries } from '../core/registries.js';
import { EV } from '../core/EventBus.js';
import { reportError } from '../core/log.js';
import * as THREE from 'three';
import { CutIn } from './CutIn.js';
import { warmEmblems } from './emblems.js';
import { energyHammer } from './meshes.js';

/** Canon damage each enemy takes from one cast, by tier (index 1..6; DESIGN §2). */
export const TIER_DAMAGE = Object.freeze([0, 4, 8, 16, 24, 32, 40]);
const CANCEL = Object.freeze({ magicCancel: true, message: 'magic cancelled' });
export function tierDamage(tier) { return TIER_DAMAGE[Math.max(0, Math.min(TIER_DAMAGE.length - 1, tier | 0))]; }

export class MagicSystem {
  constructor(game) {
    this.game = game;
    this.name = 'magic';
    this.order = 45;
    this.active = null;
    this._dark = { t: 0, dur: 0, amount: 0 };
    this._preloaded = new Map();
    // Spell light: the caster is lit by the spell while the world darkens. Created up-front (intensity 0) so the
    // first cast never changes the scene's light count (no shader recompile hitch).
    this.light = new THREE.PointLight(0xffc080, 0, 7, 1.6);
    this.light.castShadow = false;
    this.light.name = 'magic_spellLight';
    this._light = { hero: null, target: 0, cur: 0 };
    if (game.scene) game.scene.add(this.light);
    this.cutIn = null;
    try { this.cutIn = new CutIn(game); } catch (e) { reportError('magic.cutIn', e); }
    this._recent = [];   // [{ hero, tick }] for the 2P Knot Surge window
    this._gen = 0;       // bumped by cancelAll(): a cast's ctx.wait() from an older generation aborts the choreography
    this._locks = 0;
    this._dramas = new Set();
    this.surges = 0;
    // Preload a hero's spell book the moment the hero exists (tracked, so __KCA.advance waits for it).
    game.bus.on(EV.SPAWN, ({ actor } = {}) => {
      if (actor && actor.kind === 'hero' && actor.def && actor.def.magic) this.preload([actor.def.magic.spell || actor.typeId]);
    });
  }

  /** Compile the spell-prop shaders (emblems, Thunder Anvil hammer) with one invisible frame at stage load,
   *  so the first big cast never hitches on a program link. */
  _warm() {
    if (this._warmed || !this.game.vfx || !this.game.camera) return;
    this._warmed = true;
    try {
      warmEmblems(this.game.vfx);
      const { mesh, material } = energyHammer();
      const c = this.game.camera;
      mesh.position.set(c.position.x, c.position.y, c.position.z - 4); mesh.scale.setScalar(0.001);
      material.uniforms.uA.value = 0;
      this.game.vfx.track(mesh, 0.1, null, { dispose: true });
    } catch (e) { reportError('magic.warm', e); }
  }

  /** Load (and run the optional preload hook of) spell books. Tracked; safe to call repeatedly. */
  preload(ids) {
    return Promise.all(ids.map((id) => {
      if (!this._preloaded.has(id)) {
        const p = registries.spells.load(id).then(async (s) => {
          if (s && s.preload) try { await s.preload(this.ctx()); } catch (e) { reportError(`spell:${id}.preload`, e); }
          this._warm();
          return s;
        });
        this._preloaded.set(id, p);
        this.game.track(p);
      }
      return this._preloaded.get(id);
    }));
  }

  ctx(hero = null, tier = 0) {
    const g = this.game;
    const dmg = tierDamage(tier);
    // Canon magic damage: bypass the attacker/difficulty scale (makeEvent multiplies by it), keep target defence.
    const canon = (hitData) => {
      const d = hitData.damage ?? dmg;
      const out = hero && g.combat ? (g.combat.damageScale[hero.team] ?? 1) * (hero.damageMul ?? 1) : 1;
      return { level: 'magic', ...hitData, damage: out ? d / out : d };
    };
    const gen = this._gen;
    return {
      game: g, hero, tier, damage: dmg, vfx: g.vfx, camera: g.cameraRig, combat: g.combat, bus: g.bus, rng: g.fxRng,
      wait: (ticks) => g.wait(ticks).then(() => { if (gen !== this._gen) throw CANCEL; }),
      enemies: ({ onScreen = true } = {}) => {
        const list = g.world.query({ team: 'enemies', filter: (e) => e.hurtable !== false });
        if (!onScreen || !g.cameraRig) return list;
        const r = g.cameraRig.visibleRange();
        return list.filter((e) => e.pos.x > r.xMin - 0.5 && e.pos.x < r.xMax + 0.5);
      },
      hit: (target, hitData = {}) => !!(g.combat && g.combat.applyHit(hero, target, canon(hitData), { moveId: `magic_t${tier}` })),
      hitAll: (hitData = {}, filter = null) => {
        let n = 0;
        for (const e of this.ctx(hero, tier).enemies()) if ((!filter || filter(e)) && g.combat && g.combat.applyHit(hero, e, canon(hitData), { moveId: `magic_t${tier}` })) n++;
        return n;
      },
      drama: (opts) => {
        if (!g.cameraRig) return { release() {} };
        const d = g.cameraRig.drama(opts), rel = d.release;
        this._dramas.add(d);
        d.release = () => { this._dramas.delete(d); rel(); };
        return d;
      },
      darken: (amount = 0.45, seconds = 1) => { this._dark = { t: 0, dur: seconds, amount }; },
      darkHold: (amount) => this.darkHold(amount),
      slowmo: (scale, hold) => g.slowmo(scale, hold),
      shake: (t) => g.cameraRig && g.cameraRig.shake(t),
      flash: ({ color = '#ffffff', strength = (tier === 4 ? 0.6 : 0.4), duration = 0.3 } = {}) => g.renderer && g.renderer.post && g.renderer.post.pulse({ flash: strength, flashColor: color, duration }),
    };
  }

  /**
   * Cast `hero`'s spell at `tier` (1..maxTier). Resolves when the spell's choreography finishes.
   * With the book already loaded (the normal case: preloaded on spawn) this starts synchronously, so the
   * magicCast event lands on the calling tick; otherwise the load is game.track()ed.
   */
  cast(hero, tier) {
    const def = hero.def && hero.def.magic;
    if (!def || tier <= 0 || this._locks > 0) return Promise.resolve();
    const id = def.spell || hero.typeId;
    const book = registries.spells.get(id);
    if (book) return this._run(hero, def, book, tier);
    return this.game.track(this.preload([id]).then(([b]) => this._run(hero, def, b, tier)));
  }

  /** Block casts (scripted beats: camp wrap/tally). Returns unlock(); nested holds stack. */
  lock() { this._locks++; let done = false; return () => { if (!done) { done = true; this._locks = Math.max(0, this._locks - 1); } }; }
  get locked() { return this._locks > 0; }

  /** Abort every running cast/Knot Surge and scrub what they left on screen (see header). */
  cancelAll() {
    const g = this.game;
    this._gen++;
    this._recent = [];
    for (const d of [...this._dramas]) d.release();
    this._dramas.clear();
    this._dark = { t: 0, dur: 0, amount: 0 };
    if (g.renderer) g.renderer.exposureMul = 1;
    this._light.target = 0; this._light.cur = 0; this._light.hero = null; this.light.intensity = 0;
    if (this.cutIn) this.cutIn.hide();
    if (g._timeFx) { const f = g._timeFx; g._timeFx = null; g.timeScale = 1; f.resolve(); }
    if (g.vfx && g.vfx.clear) g.vfx.clear();
  }

  /** Hold the world darkened until the returned release() (the stronger of overlapping holds wins). */
  darkHold(amount = 0.4) {
    const d = { t: 0, dur: 1e9, amount: Math.max(amount, this._dark.dur > 0 && this._dark.t < this._dark.dur ? this._dark.amount : 0) };
    this._dark = d;
    return () => { if (this._dark === d) d.dur = Math.min(d.dur, d.t); };
  }

  /** Light `hero` with the spell (colour, intensity; 0 fades it out). */
  spellLight(hero, color, intensity) {
    this._light.hero = hero; this._light.target = intensity;
    if (intensity > 0) this.light.color.set(color);
  }

  async _run(hero, def, book, tier) {
    // 2P Knot Surge: a second hero casting within 0.5 s (30 ticks) of another's cast braids the two spells.
    const now = this.game.tick;
    this._recent = this._recent.filter((c) => now - c.tick <= 30 && c.hero !== hero);
    const partner = this._recent.find((c) => c.hero.kind === 'hero' && c.hero.alive !== false);
    this._recent.push({ hero, tick: now, tier });
    if (partner) { this._recent = []; this.knotSurge(partner.hero, hero, partner.tier, tier); }
    const t = Math.min(tier, book ? book.maxTier || tier : tier);
    this.game.bus.emit(EV.MAGIC_CAST, { hero, tier: t, spell: def.spell, damage: tierDamage(t) });
    this.active = { hero, tier: t };
    try {
      if (book && book.cast) await book.cast(this.ctx(hero, t), hero, t);
    } catch (e) { if (e !== CANCEL) reportError(`spell:${def.spell}`, e); }
    this.active = null;
    this.game.bus.emit(EV.MAGIC_END, { hero, tier: t });
  }

  update() {}

  /** Combined team spell (both heroes' elements braided into one screen-wide knot). Runs alongside both casts. */
  async knotSurge(a, b, ta = 1, tb = 1) {
    this.surges++;
    this.game.bus.emit('magic:knotSurge', { heroes: [a, b] });
    try {
      const mod = await import('./knotSurge.js');
      await mod.default(this.ctx(b, Math.max(ta, tb)), a, b);
    } catch (e) { if (e !== CANCEL) reportError('magic.knotSurge', e); }
  }

  render(alpha, frameDt) {
    // Spell light follows its caster (chest height, toward the camera) and eases in/out.
    const L = this._light;
    L.cur += (L.target - L.cur) * Math.min(1, frameDt * 8);
    if (L.hero && !L.hero.removed && L.cur > 0.01) {
      const h = L.hero;
      this.light.position.set(h.pos.x + (h.facing || 1) * 0.5, h.pos.y + 1.7, h.pos.z + 1.3);
      this.light.intensity = L.cur;
    } else this.light.intensity = 0;
    if (this.cutIn) this.cutIn.update(frameDt);
    // World darkening envelope for cinematic casts (ease in 0.15 s, hold, ease out 0.3 s).
    const d = this._dark;
    const r = this.game.renderer;
    if (!r) return;
    if (d.dur > 0) {
      d.t += frameDt;
      const tin = Math.min(1, d.t / 0.15), tout = d.t > d.dur ? Math.max(0, 1 - (d.t - d.dur) / 0.3) : 1;
      r.exposureMul = 1 - d.amount * tin * tout;
      if (d.t > d.dur + 0.3) { d.dur = 0; r.exposureMul = 1; }
    }
  }
}
