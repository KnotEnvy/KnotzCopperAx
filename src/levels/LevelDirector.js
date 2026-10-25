// LevelDirector (game.levels): loads a stage module, builds its environment, and runs its screen/wave script:
// camera lock per screen → waves of spawns → all dead → next wave → screen clear → "GO →" → walk right to
// the next screen → … → stage clear (EV.STAGE_CLEAR).
//
// Stage module (src/levels/stages/<id>.js, default export):
//   { id, name, subtitle, number, zBand: [zMin, zMax], extents: [xMin, xMax], lighting: {...Lighting preset},
//     playerStart: { x, z }, music?: 'cue', ambience?: {...},
//     build(ctx) → Promise<{ update?(dt, t), dispose?(), groundAt?(x,z) }>   ctx: { game, THREE, group, kit, rng, quality, stage, params }
//     screens: [ { x: [x0, x1], lock: true, trigger?: m, waves: [ { spawns: [SpawnDef], delay?: ticks } ], onEnter?(ctx), onClear?(ctx) } ],
//     autoClear?: seconds (stages without screens, e.g. the bonus camp, clear after this long), next?: 'bonus' }
//   SpawnDef: { type: 'marauder', side: 'right'|'left', x?: absolute, z: 0, delay: ticks, tier?, enter: true, hp?, opts? }
//             { mount: 'cluckhorn', ... } spawns a beast; { pickup: 'pot', x, z } drops an item.
//             { prop: 'crate'|'urn'|'barrel', x, z, loot: 'pot'|'food'|[...]|null } places a breakable (src/levels/props).
//             { type: 'skeleton', x, z, rise: true } = rises from the ground at x (no walk-in).
//             coop: true → only spawned with 2+ heroes (co-op scaling); solo: true → only with 1 hero.
//   stage.props = [{ prop, x, z, loot }] are placed when the stage loads (visible before their screen).
import * as THREE from 'three';
import { registries } from '../core/registries.js';
import { EV } from '../core/EventBus.js';
import { reportError } from '../core/log.js';
import { safeImport } from '../core/safeImport.js';
import * as kit from './EnvKit.js';

// Enemies are imported lazily so a broken enemies/** file only breaks spawns, not stage environments.
let enemiesMod = null;
const enemies = async () => enemiesMod || (enemiesMod = await safeImport(() => import('../enemies/spawnEnemy.js'), 'enemies/spawnEnemy'));

export function stageModuleId(s) {
  const v = String(s ?? '1');
  return /^\d+$/.test(v) ? `stage${v}` : v;
}

export class LevelDirector {
  constructor(game) {
    this.game = game;
    this.name = 'level';
    this.order = 40;
    this.stage = null;
    this.env = null;
    this.phase = 'none';   // none | fight | go | clear | idle
    this.screenIndex = -1;
    this.waveIndex = -1;
    this.pendingSpawns = 0;
    this.waveActors = new Set();
    this.t = 0;
    this.scriptEnabled = true;
  }

  get screens() { return (this.stage && this.stage.screens) || []; }

  async load(stageId, { script = true } = {}) {
    const g = this.game;
    this.dispose();
    const id = stageModuleId(stageId);
    let mod = await registries.stages.load(id);
    if (!mod) { reportError('level', new Error(`stage '${id}' failed to load, using 'test'`)); mod = await registries.stages.load('test'); }
    if (!mod) throw new Error('no stage available');
    this.stage = mod;
    this.scriptEnabled = script;
    const [zMin, zMax] = mod.zBand || [-2.8, 2.8];
    g.world.band = { zMin, zMax };
    g.world.extents = { xMin: (mod.extents && mod.extents[0]) ?? -3, xMax: (mod.extents && mod.extents[1]) ?? (this.screens.length ? this.screens[this.screens.length - 1].x[1] : 40) };
    g.world.groundAt = () => 0;
    if (g.cameraRig) { g.cameraRig.zMid = (zMin + zMax) / 2; g.cameraRig.setLimits(g.world.extents.xMin, g.world.extents.xMax); g.cameraRig.clearLock(); }
    g.renderer.lighting.apply(mod.lighting || {});
    const ctx = { game: g, THREE, group: g.renderer.envGroup, kit, rng: g.rng.fork(), quality: g.quality, stage: mod, params: g.params };
    try { this.env = (await mod.build(ctx)) || {}; } catch (e) { reportError(`stage:${id}.build`, e); this.env = {}; }
    if (this.env.groundAt) g.world.groundAt = this.env.groundAt;
    // Preload every enemy type the script references so spawns are synchronous-ish and deterministic.
    const types = new Set();
    for (const s of this.screens) for (const w of s.waves || []) for (const sp of w.spawns || []) if (sp.type) types.add(sp.type);
    const E = await enemies();
    if (E) await Promise.all([...types].map((t) => E.preloadEnemy(g, t)));
    const propIds = new Set((mod.props || []).map((p) => p.prop));
    for (const s of this.screens) for (const w of s.waves || []) for (const sp of w.spawns || []) if (sp.prop) propIds.add(sp.prop);
    await Promise.all([...propIds].map((p) => registries.props.load(p)));
    // Preload beast types + their GLBs (a 4–5 MB mount GLB first fetched mid-wave kept that wave pending for a long time).
    const mountIds = new Set();
    for (const s of this.screens) for (const w of s.waves || []) for (const sp of w.spawns || []) if (sp.mount) mountIds.add(sp.mount);
    const t0 = performance.now();
    const cap = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 30000))]);
    await Promise.all([...mountIds].map((m) => cap(Promise.all([registries.mounts.load(m), g.assets && g.assets.gltf ? g.assets.gltf(`mount_${m}`) : null]))));
    if (mountIds.size) this.mountPreloadMs = Math.round(performance.now() - t0);
    // Boss hooks (bosses agent, src/enemies/bosses/_hook.js): a boss screen gets one extra boss wave after its waves.
    this.bossKit = await safeImport(() => import('../enemies/bosses/_hook.js'), 'bosses/_hook');
    this.bossSpawned = new Set();
    this.phase = 'idle';
    this._props = mod.props || [];
    this._propsPlaced = false;
    return mod;
  }

  /** Place stage.props (breakables) — after the heroes exist so world.clear() at stage start can't eat them. */
  placeProps() {
    if (!this.scriptEnabled || this._propsPlaced) return Promise.resolve();
    this._propsPlaced = true;
    return Promise.all((this._props || []).map((p) => this.game.track(this.spawnProp(p))));
  }

  async spawnProp(sp) {
    try {
      const mod = await registries.props.load(sp.prop);
      if (mod) return mod.create({ game: this.game }, { x: sp.x, z: sp.z ?? 0, loot: sp.loot, hp: sp.hp, yaw: sp.yaw });
    } catch (e) { reportError('level.prop', e); }
    return null;
  }

  heroCount() { return this.game.world.query({ kind: 'hero', alive: false }).length; }

  start(screen = 0) {
    if (!this.stage) return;
    this.placeProps();
    this.game.bus.emit(EV.STAGE_START, { stageId: this.stage.id });
    if (this.scriptEnabled && !this.screens.length && this.stage.autoClear) {
      const stage = this.stage;
      this.game.after(this.game.ticks(stage.autoClear), () => { if (this.stage === stage && this.phase === 'idle') this.stageClear(); });
    }
    if (!this.scriptEnabled || !this.screens.length) { this.phase = 'idle'; return; }
    this.enterScreen(Math.min(screen, this.screens.length - 1));
  }

  enterScreen(i) {
    const g = this.game, s = this.screens[i];
    this.screenIndex = i;
    this.waveIndex = -1;
    if (g.ui) g.ui.go(false);
    if (s.lock !== false && g.cameraRig) g.cameraRig.setLock(s.x[0], s.x[1]);
    g.bus.emit(EV.SCREEN_LOCK, { index: i, xMin: s.x[0], xMax: s.x[1] });
    if (s.onEnter) try { s.onEnter({ game: g, director: this }); } catch (e) { reportError('screen.onEnter', e); }
    this.phase = 'fight';
    this.nextWave();
  }

  nextWave() {
    const s = this.screens[this.screenIndex];
    this.waveIndex++;
    const waves = s.waves || [];
    if (this.waveIndex >= waves.length) {
      const hook = this.bossKit && this.bossSpawned && !this.bossSpawned.has(this.screenIndex) && this.bossKit.resolveHook(this.game, this.stage, this.screenIndex);
      if (hook) {
        this.bossSpawned.add(this.screenIndex);
        this.waveActors.clear();
        this.pendingSpawns++;
        this.game.bus.emit(EV.WAVE_START, { screen: this.screenIndex, wave: this.waveIndex, boss: hook.id });
        this.game.track(this.bossKit.spawnBossWave(this.game, this, hook).then(() => this.tuneBosses()).finally(() => { this.pendingSpawns--; }));
        return;
      }
      this.screenClear(); return;
    }
    const w = waves[this.waveIndex];
    this.waveActors.clear();
    this.game.bus.emit(EV.WAVE_START, { screen: this.screenIndex, wave: this.waveIndex });
    const base = w.delay || 0;
    const nh = this.heroCount();
    for (const sp of w.spawns || []) {
      if ((sp.coop && nh < 2) || (sp.solo && nh > 1)) continue;
      this.pendingSpawns++;
      this.game.after(base + (sp.delay || 0), () => this.spawn(sp));
    }
    if (!(w.spawns || []).length) this.game.after(base + 1, () => this.nextWave());
  }

  async spawn(sp) {
    const g = this.game;
    // Watchdog: a spawn whose asset load stalls must never hold its wave open forever (10 s of sim).
    let settled = false;
    const settle = () => { if (!settled) { settled = true; this.pendingSpawns--; } };
    // enemies-ai r8: judged in WALL time too. The manual (capture) clock steps 600+ sim ticks inside one synchronous
    // advance() where this spawn's awaits cannot run, so the tick timer alone fired 'spawn stalled' on healthy spawns.
    const wall0 = performance.now();
    const watch = () => {
      if (settled) return;
      if (performance.now() - wall0 < 10000) { g.after(120, watch); return; }
      reportError('level.spawn', new Error(`spawn stalled: ${sp.type || sp.mount || sp.prop || sp.pickup}`)); settle();
    };
    g.after(600, watch);
    try {
      const cam = g.cameraRig;
      const vis = cam ? cam.visibleRange(sp.z ?? 0) : { xMin: -8, xMax: 8 };
      const side = sp.side || 'right';
      const offX = side === 'left' ? vis.xMin - 1.6 : vis.xMax + 1.6;
      const z = sp.z ?? g.rng.range(g.world.band.zMin * 0.8, g.world.band.zMax * 0.8);
      if (sp.pickup) { g.spawnPickup && g.spawnPickup(sp.pickup, sp.x ?? (vis.xMin + vis.xMax) / 2, z, sp.opts); return; }
      if (sp.mount) { if (g.mounts) await g.mounts.spawn(sp.mount, { x: sp.x ?? offX, z, ...(sp.opts || {}) }); return; }
      if (sp.prop) { await this.spawnProp({ ...sp, z }); return; }
      const inX = side === 'left' ? vis.xMin + g.rng.range(1.5, 3.5) : vis.xMax - g.rng.range(1.5, 3.5);
      const rise = sp.rise || (sp.opts && sp.opts.rise);
      const enter = sp.enter !== false && sp.x === undefined;
      let x = sp.x ?? (rise ? inX : offX);
      // C2 r15 (enemies-ai, additive): in co-op the crowd director may move a riser to the emptier flank of a hero (no-op in 1P)
      if (rise && g.ai && g.ai.director && g.ai.director.coRiseX) x = g.ai.director.coRiseX(x, z);
      const E = await enemies();
      if (!E) return;
      const p = E.spawnEnemy(g, sp.type, { x, z, facing: side === 'left' ? 1 : -1, tier: sp.tier, hp: sp.hp, elite: sp.elite, enterFrom: enter && !rise ? { x: inX, z } : null, ...(sp.opts || {}), ...(rise ? { rise: true } : {}) });
      g.track(p);
      const e = await p;
      if (e) { e.tags.add('wave'); this.waveActors.add(e); }
    } catch (e) { reportError('level.spawn', e); } finally { settle(); }
  }

  screenClear() {
    const g = this.game, i = this.screenIndex, s = this.screens[i];
    g.bus.emit(EV.SCREEN_CLEAR, { index: i });
    if (s && s.onClear) try { s.onClear({ game: g, director: this }); } catch (e) { reportError('screen.onClear', e); }
    if (i >= this.screens.length - 1) { this.stageClear(); return; }
    const next = this.screens[i + 1];
    if (g.cameraRig) g.cameraRig.setLock(s.x[0], next.x[1]);
    this.phase = 'go';
    if (g.ui) g.ui.go(true);
    g.bus.emit(EV.GO, { index: i, dir: 1 });
  }

  stageClear() {
    this.phase = 'clear';
    if (this.game.ui) this.game.ui.go(false);
    this.game.bus.emit(EV.STAGE_CLEAR, { stageId: this.stage.id });
    // QA r1: a defeated boss (or a group-boss member / riderless beast / fleeing thief) could linger in
    // world.query({team:'enemies'}) after the clear. Sweep every enemy-team actor once the finale beat has had a moment.
    const stage = this.stage;
    this.game.after(45, () => { if (this.stage === stage) this.sweepEnemies(); });
  }

  /** Stage tuning for boss actors: tuning.bossDamage (× damage dealt), tuning.soloBossHp (1P HP ×). */
  tuneBosses() {
    const t = (this.stage && this.stage.tuning) || {};
    const solo = this.heroCount() < 2;
    for (const a of this.waveActors) {
      if (a.kind !== 'boss' || a._tuned) continue;
      a._tuned = true;
      if (t.bossDamage) a.damageMul = (a.damageMul ?? 1) * t.bossDamage;
      if (solo && t.soloBossHp && a.maxHp) { a.maxHp = Math.round(a.maxHp * t.soloBossHp); a.hp = Math.min(a.hp, a.maxHp); }
    }
  }

  /** Remove every remaining live enemy-team actor + any unremoved boss. Returns how many were removed. */
  sweepEnemies() {
    let n = 0;
    for (const a of this.game.world.query({ team: 'enemies', alive: false })) {
      if (a.removed) continue;
      if (!a.alive && a.kind !== 'boss' && !a.isBoss) continue; // ordinary corpses fade and remove themselves
      try { a.alive = false; if (a.token) a.token.alive = false; a.remove(); n++; } catch (e) { reportError('level.sweep', e); }
    }
    if (n) this.game.bus.emit('level:swept', { count: n });
    return n;
  }

  canAdvance() { return this.phase === 'go'; }

  /** A fleeing thief pinned against the world extents (or long off-camera) has "escaped": remove it. */
  strandCheck(a, step = 1) {
    const ex = this.game.world.extents, x = a.pos.x;
    const cam = this.game.cameraRig, vis = cam && cam.visibleRange ? cam.visibleRange(a.pos.z) : null;
    const pinned = x <= ex.xMin + 0.4 || x >= ex.xMax - 0.4;
    const off = vis && (x < vis.xMin - 1 || x > vis.xMax + 1);
    a._strand = (pinned || off) ? (a._strand || 0) + step : 0;
    if (a._strand > (off ? 90 : 150) && (a.age || 0) > 240) { a.alive = false; a.remove(); this.game.bus.emit('level:thiefEscaped', { actor: a }); }
  }

  update(dt) {
    this.t += dt;
    if (this.env && this.env.update) { try { this.env.update(dt, this.t); } catch (e) { reportError('stage.update', e); this.env.update = null; } }
    // Loot thieves outlive their wave (waveActors is reset per wave): strand-check every live passive foe in the world,
    // or a thief pinned at the world edge keeps the hero bot (and the GO walk) busy forever (r9 2P softlock).
    if ((this.phase === 'fight' || this.phase === 'go') && (this.game.tick & 7) === 0) {
      for (const a of this.game.world.query({ team: 'enemies' })) if (a.def && a.def.passive) this.strandCheck(a, 8);
    }
    if (this.phase === 'fight') {
      if (this.pendingSpawns > 0) return;
      let alive = 0;
      for (const a of this.waveActors) {
        if (!a.alive || a.removed) continue;
        // Loot thieves (def.passive) never block a wave: they can't be killed (minHp), only robbed, and flee.
        if (a.def && a.def.passive) continue; // strand-checked below
        alive++;
      }
      if (alive === 0) this.nextWave();
    } else if (this.phase === 'go') {
      const heroes = this.game.world.query({ kind: 'hero' });
      const next = this.screens[this.screenIndex + 1];
      if (next && heroes.some((h) => h.pos.x > next.x[0] + (next.trigger ?? 4))) this.enterScreen(this.screenIndex + 1);
    }
  }

  info() {
    return this.stage ? { id: this.stage.id, screen: this.screenIndex, wave: this.waveIndex, phase: this.phase, screens: this.screens.length } : null;
  }

  dispose() {
    if (this.env && this.env.dispose) { try { this.env.dispose(); } catch (e) { reportError('stage.dispose', e); } }
    this.env = null;
    this.stage = null;
    this.phase = 'none';
    this.waveActors.clear();
    this.pendingSpawns = 0;
    if (this.game.renderer) this.game.renderer.clearEnv();
  }
}
