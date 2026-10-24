// window.__KCA — the test/capture contract (docs/ARCHITECTURE.md §6). Installed by main.js before any
// mode loads, so tools can always wait on __KCA.ready.
//
//   ready: Promise                        resolves once the requested mode is loaded + shaders compiled
//   setManualClock(bool)                  capture tool turns this on (also on by default with &capture=1)
//   advance(ms): Promise                  step sim by fixed ticks, render exactly one frame
//   input.press(player, action, ms)       player: 1|2 ('p1'|'p2'); action: left right up down light heavy jump magic dodge start
//   input.hold(player, action, down)      latch/unlatch · input.releaseAll()
//   info()                                { fps, drawCalls, triangles, geometries, textures, programs, actors, errors[], mode, tick, heroes[], enemies, ... }
//   events(type?, sinceTick?)             recent bus events [{type, tick, summary}] with tick > sinceTick; an event's tick is
//                                         game.tick after the step that emitted it, so since=game.tick (read now) = 'from now on'
//   game                                  the live Game
//   debug.spawn(type, x, z, opts)         enemy type id | 'pot' | 'food' | mount type → Promise<summary>
//   debug.setHP(target, hp)               target: actor id | 'p1' | 'p2' | 'enemies'
//   debug.kill(target)                    same targets ('enemies' kills all)
//   debug.god(on) · debug.timeScale(s) · debug.hitstop(ticks) · debug.hitboxes(on) · debug.cast(player, tier)
//   debug.actors()                        compact list of live actors
//   showcase.*                            registered by showcase kinds (play(clip), setYaw(rad), ...)
//   register(ns, obj)                     subsystems add helpers: __KCA.register('mounts', { ... })
import { getErrors } from './log.js';

let resolveReady;
const readyPromise = new Promise((r) => { resolveReady = r; });

export function installTestHooks() {
  const api = {
    ready: readyPromise,
    game: null,
    mode: null,
    _readyAt: null,
    setManualClock(v) { if (api.game) api.game.setManualClock(v); },
    async advance(ms = 16.667) { if (api.game) await api.game.advance(ms); },
    input: {
      press(p, action, ms = 80) { api.game && api.game.input.press(p, action, ms); },
      hold(p, action, down = true) { api.game && api.game.input.hold(p, action, down); },
      releaseAll() { api.game && api.game.input.releaseAll(); },
    },
    events(type = null, sinceTick = -1) {
      const g = api.game; if (!g) return [];
      return g.bus.recent.filter((e) => (!type || e.type === type) && e.tick > sinceTick);
    },
    info() {
      const g = api.game;
      const errors = getErrors();
      if (!g || !g.renderer) return { ready: !!api._readyAt, errors };
      const r = g.renderer.webgl;
      const fi = g.renderer.frameInfo || {};
      const heroes = g.world.query({ kind: 'hero', alive: false }).map((h) => ({
        id: h.id, hero: h.typeId, hp: Math.round(h.hp), maxHp: h.maxHp, x: +h.pos.x.toFixed(2), z: +h.pos.z.toFixed(2), y: +h.pos.y.toFixed(2),
        state: h.fsm.name, pots: h.pots ?? null, tier: h.magicTier ? h.magicTier() : null, player: h.playerIndex != null ? h.playerIndex + 1 : null,
      }));
      return {
        ready: !!api._readyAt,
        mode: api.mode,
        fps: Math.round(g.fps),
        drawCalls: fi.calls ?? r.info.render.calls,
        triangles: fi.triangles ?? r.info.render.triangles,
        geometries: r.info.memory.geometries,
        textures: r.info.memory.textures,
        programs: r.info.programs ? r.info.programs.length : null,
        actors: g.world.actors.length,
        enemies: g.world.query({ team: 'enemies' }).length,
        heroes,
        tick: g.tick,
        time: +g.time.toFixed(3),
        timeScale: g.timeScale,
        stage: g.levels ? g.levels.info() : null,
        flow: g.flow ? g.flow.state : null,
        session: g.session ? g.session.info() : null,
        quality: g.quality.name,
        errors,
      };
    },
    debug: {},
    showcase: {},
    register(ns, obj) { api[ns] = Object.assign(api[ns] || {}, obj); return api[ns]; },
  };
  window.__KCA = api;
  return api;
}

export function markReady(mode) {
  const api = window.__KCA;
  api.mode = mode;
  api._readyAt = performance.now();
  resolveReady(true);
}
