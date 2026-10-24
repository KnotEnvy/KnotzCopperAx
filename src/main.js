// main.js — boot + URL routing (docs/ARCHITECTURE.md §5).
//
//   /?mode=title (default)                         full game from the title screen (attract mode after idle)
//   /?mode=stage&stage=1&p1=brann[&p2=..][&bot=1][&seed=N][&screen=K][&pots=N]
//   /?mode=showcase&what=<kind>&id=<id>[&anim=][&cam=][&tier=]
//   &capture=1 (manual clock) · &quality=low|high · &debug=1 (hitboxes + error toasts) · &nopost · &mute
//
// Every subsystem service is imported LAZILY through safeImport, so a broken file owned by one specialist
// (vfx, audio, ui, magic, mounts, ai…) logs an error and is replaced by a null service instead of taking the
// whole game down. Core (src/core/**) is imported statically; it is the only hard dependency.
import { params } from './core/config.js';
import { Game } from './core/Game.js';
import { installTestHooks, markReady } from './core/testhooks.js';
import { safeImport } from './core/safeImport.js';
import { reportError, onError } from './core/log.js';
import { NULL_SERVICES } from './core/services.js';
import { installDebugDraw } from './core/debugDraw.js';

const api = installTestHooks();

/**
 * Load one service module and construct it. On failure returns `fallback` (a null object with the same API).
 * If the constructed service has update/render it is registered as a Game system.
 */
async function service(game, name, loader, make, fallback = null) {
  const mod = await safeImport(loader, `service:${name}`);
  if (mod) {
    try {
      const s = await make(mod);
      if (s && s.name && (s.update || s.render)) game.addSystem(s);
      return s;
    } catch (e) { reportError(`service:${name}`, e); }
  }
  return fallback;
}

function fatal(container, msg) {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:20px;color:#ffb0a0;font:13px/1.5 monospace;white-space:pre-wrap;z-index:99';
  el.textContent = 'KnotzCopperAx failed to boot:\n' + msg;
  container.appendChild(el);
}

async function boot() {
  const container = document.getElementById('app');
  if (params.capture) document.body.style.cursor = 'none';
  const game = new Game({ container, params });
  api.game = game;

  // ---- render core (render/** is owned by look-dev; if it fails we cannot draw, but we still report ready)
  const R = await safeImport(() => import('./render/Renderer.js'), 'render/Renderer');
  const C = await safeImport(() => import('./render/CameraRig.js'), 'render/CameraRig');
  if (!R || !C) { fatal(container, 'render/Renderer.js or render/CameraRig.js failed to import (see console).'); markReady('error'); return; }
  try {
    game.renderer = new R.Renderer(game, container);
    game.scene = game.renderer.scene;
    game.cameraRig = new C.CameraRig(game);
    game.camera = game.cameraRig.camera;
    game.renderer.setCamera(game.camera);
  } catch (e) { reportError('boot.render', e); fatal(container, String(e.stack || e)); markReady('error'); return; }
  const rig = game.cameraRig;
  game.addSystem({ name: 'camera', order: 80, freezable: false, update: (dt) => rig.update(dt), render: (a) => rig.render(a) });

  // ---- content services (order of construction matters only where noted)
  game.assets = await service(game, 'assets', () => import('./assets/AssetLoader.js'), (m) => new m.AssetLoader(game));
  game.anim = await service(game, 'anim', () => import('./anim/ClipLibrary.js'), (m) => new m.ClipLibrary().load());
  game.combat = await service(game, 'combat', () => import('./combat/CombatSystem.js'), (m) => new m.CombatSystem(game), NULL_SERVICES.combat());
  game.combo = await service(game, 'combo', () => import('./combat/ComboCounter.js'), (m) => new m.ComboCounter(game));
  game.vfx = await service(game, 'vfx', () => import('./vfx/VfxSystem.js'), async (m) => { const v = new m.VfxSystem(game); await v.preload(); return v; }, NULL_SERVICES.vfx(game));
  game.magic = await service(game, 'magic', () => import('./magic/MagicSystem.js'), (m) => new m.MagicSystem(game));
  game.audio = await service(game, 'audio', () => import('./audio/AudioEngine.js'), async (m) => { const a = new m.AudioEngine(game); await a.preload(); return a; }, NULL_SERVICES.audio());
  game.ui = await service(game, 'ui', () => import('./ui/UI.js'), (m) => new m.UI(game, container), NULL_SERVICES.ui());
  game.ai = await service(game, 'ai', () => import('./ai/AISystem.js'), (m) => new m.AISystem(game, { difficulty: params.get('difficulty', 'normal') }), NULL_SERVICES.ai());
  game.bots = await service(game, 'bots', () => import('./ai/heroBot.js'), (m) => new m.HeroBotSystem(game), NULL_SERVICES.bots());
  game.mounts = await service(game, 'mounts', () => import('./mounts/MountSystem.js'), (m) => new m.MountSystem(game), NULL_SERVICES.mounts());
  game.levels = await service(game, 'levels', () => import('./levels/LevelDirector.js'), (m) => new m.LevelDirector(game));
  game.session = await service(game, 'session', () => import('./game/GameSession.js'), (m) => new m.GameSession(game));
  game.flow = await service(game, 'flow', () => import('./game/Flow.js'), (m) => new m.Flow(game));
  await service(game, 'pickups', () => import('./game/Pickup.js'), (m) => m.installPickups(game));
  await service(game, 'debugHooks', () => import('./game/debugHooks.js'), (m) => m.installDebugHooks(game));
  installDebugDraw(game);
  if (params.debug) onError((e) => game.ui && game.ui.toast && game.ui.toast(e.msg.slice(0, 160), 4));

  // ---- route the requested mode
  const mode = params.mode;
  try {
    if (mode === 'stage') await routeStage(game);
    else if (mode === 'showcase') {
      const S = await safeImport(() => import('./showcase/Showcase.js'), 'showcase');
      if (S) await S.runShowcase(game, params.what, params);
    } else if (mode === 'bench') { // perf-1650: in-game benchmark (render/bench.js)
      const B = await safeImport(() => import('./render/bench.js'), 'bench');
      if (B) await B.startBench(game, params);
    } else if (game.flow) await game.flow.go('title');
  } catch (e) { reportError(`mode:${mode}`, e); }

  // ---- compile shaders, render a first frame, then declare ready
  await game.flushPending();
  try { await game.renderer.compile(); } catch (e) { reportError('compile', e); }
  game.renderFrame(0, 1 / 60);
  game.renderFrame(0, 1 / 60);
  markReady(mode);
  game.start();
}

/** ?mode=stage — straight into gameplay with the given heroes (bots optional). */
async function routeStage(game) {
  const players = [{ player: 0, heroId: params.p1 || 'brann', bot: params.botMask[0] }];
  if (params.p2) players.push({ player: 1, heroId: params.p2, bot: params.botMask[1] });
  // &pots=N sets every hero's starting pots; without it, bots start with 3 so bot=1 runs show magic like attract mode.
  const pots = params.num('pots', -1);
  for (const p of players) { if (pots >= 0) p.magic = pots; else if (p.bot) p.magic = 3; }
  if (game.session) {
    game.session.reset();
    for (const p of players) game.session.join(p.player, p.heroId, { bot: p.bot });
    // Bots (captures, attract) auto-continue so a long capture never hits GAME OVER.
    game.session.autoContinue = players.every((p) => p.bot);
  }
  if (game.flow) await game.flow.go('stage', { stage: params.stage, players, screen: params.screen, direct: true });
  else {
    const S = await import('./game/StageRunner.js');
    await S.startStage(game, { stage: params.stage, players, screen: params.screen });
  }
}

boot().catch((e) => { reportError('boot', e); markReady('error'); });
