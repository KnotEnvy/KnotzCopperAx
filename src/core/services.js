// Null-object stand-ins for optional services. main.js installs one of these when a subsystem module fails
// to import or construct, so gameplay code can call game.vfx.spawn(...) / game.audio.play(...) / game.ui.card(...)
// without null checks and a broken specialist file only removes its own feature.
//
// Keep each stub's surface in sync with the real service's public API (docs/ENGINE_API.md §Services).
import * as THREE from 'three';

const noop = () => {};
const pool = () => ({ emit: () => -1, clear: noop, n: 0 });

export const NULL_SERVICES = {
  vfx: (game) => ({
    name: 'vfx', null: true, rng: game.fxRng, scale: 1, add: pool(), alpha: pool(), group: new THREE.Group(),
    spawn: () => null, light: noop, track: (o) => o, clear: noop, preload: async () => new Map(),
  }),
  audio: () => ({ name: 'audio', null: true, sounds: new Map(), play: noop, unlock: noop, duck: noop, running: false, panFor: () => 0 }),
  ui: () => ({
    name: 'ui', null: true, hud: { show: noop, render: noop }, screens: new Map(),
    show: async () => null, hide: noop, hideAll: noop, card: noop, go: noop, toast: noop, clearStage: noop, dispatch: () => false,
  }),
  ai: () => ({ name: 'ai', null: true, tokens: null, directors: [], reset: noop }),
  bots: () => ({ name: 'bots', null: true, bots: [], attach: () => null, detach: noop, dispose: noop }),
  mounts: () => ({ name: 'mounts', null: true, spawn: async () => null }),
  combat: () => ({ name: 'combat', null: true, applyHit: () => false, areaHit: () => 0, resolve: () => false, preHitHooks: [], debugBoxes: [], damageScale: { players: 1, enemies: 1, neutral: 1 } }),
};
