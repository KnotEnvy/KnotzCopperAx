// Showcase framework: ?mode=showcase&what=<kind>&id=<id>[&anim=<clip>][&cam=<preset>][&tier=N]
// Each kind is src/showcase/kinds/<what>.js with default export { id, setup(ctx) }.
//
// ShowcaseContext helpers (ctx.*):
//   game, params, THREE, rng
//   studio(opts)                   studio lighting (warm key, cool rim, dark gradient sky) + plinth; returns { plinth }
//   plinth({ radius, y })          lit turntable disc
//   stage(id, { script:false })    load a stage environment (no waves unless script:true)
//   hero(id, opts) / enemy(type, opts) / mount(id, opts)   create + add actors (puppet: true → no AI/controls)
//   puppet(actor)                  freeze an actor's brain/controls (it only plays clips)
//   turntable(actor, { speed, yaw })   spin or fix the model's yaw (degrees)
//   orbit({ target, distance, height, yaw, speed, fov, lookHeight })  manual orbit camera
//   gameCam(actors, { lock })      normal belt-scroll camera following actors
//   every(seconds, fn) / after(seconds, fn)   sim-time schedulers
//   label(text)                    small caption overlay (top-left)
//   expose({ play(clip), ... })    → window.__KCA.showcase helpers
import * as THREE from 'three';
import { registries } from '../core/registries.js';
import { createHero } from '../characters/spawnHero.js';
import { resetStage } from '../game/StageRunner.js';
import { reportError } from '../core/log.js';
import { safeImport } from '../core/safeImport.js';
import { canvasTexture } from '../assets/proceduralTextures.js';
import { DEG } from '../core/math.js';

export const STUDIO_LIGHTING = {
  sky: { top: '#0c0c10', horizon: '#2a2220', bottom: '#0a0908', sunDir: [0.3, 0.3, 1], sunColor: '#ffcfa0', sunGlow: 0.0, hazeHeight: 0.6 },
  sun: { color: '#ffe2c4', intensity: 3.4, dir: [0.55, 0.85, 0.75] },
  hemi: { sky: '#8a96b0', ground: '#3a2a20', intensity: 0.55 },
  rim: { color: '#9ec4ff', intensity: 3.2, dir: [-0.4, 0.55, -1] },
  fog: { color: '#0c0b0a', near: 30, far: 90 },
  env: { intensity: 0.6 },
  exposure: 1.0,
};

export async function runShowcase(game, what, params) {
  resetStage(game);
  let kind = await registries.showcase.load(what);
  if (!kind) { reportError('showcase', new Error(`unknown showcase kind '${what}' (known: ${registries.showcase.ids().join(', ')})`)); kind = await registries.showcase.load('hero'); }
  const ctx = makeContext(game, params);
  game.addSystem({ name: 'showcase', order: 70, freezable: false, update: (dt) => ctx._update(dt), render: (a, fdt) => ctx._render(a, fdt) });
  await kind.setup(ctx);
  return ctx;
}

function makeContext(game, params) {
  const timers = [];
  const spins = [];
  let orbit = null;
  let labelEl = null;
  const ctx = {
    game, params, THREE, rng: game.rng,
    plinth({ radius = 1.1, y = 0 } = {}) {
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.04, 0.12, 64), new THREE.MeshStandardMaterial({ color: '#3a302a', roughness: 0.72, metalness: 0.1 }));
      top.position.y = y - 0.06; top.receiveShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.02, 0.015, 8, 96), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffb070', emissiveIntensity: 2.5 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = y + 0.002;
      // Floor fades to black away from the plinth (studio "limbo" look) instead of a flat lit disc.
      const fade = canvasTexture('studioFloorFade2', 512, 512, (g2, w, h) => {
        const gr = g2.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        // 30 m disc: bright only right around the plinth, black by ~7 m so the background reads as limbo.
        gr.addColorStop(0, '#5a524a'); gr.addColorStop(0.05, '#3a332d'); gr.addColorStop(0.12, '#141110'); gr.addColorStop(0.24, '#040303'); gr.addColorStop(1, '#000000');
        g2.fillStyle = gr; g2.fillRect(0, 0, w, h);
      });
      const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshLambertMaterial({ color: '#ffffff', map: fade }) /* no specular: the cool rim light would otherwise glaze the whole floor at grazing angles */);
      floor.rotation.x = -Math.PI / 2; floor.position.y = y - 0.12; floor.receiveShadow = true;
      g.add(floor, top, ring);
      game.renderer.envGroup.add(g);
      return g;
    },
    studio(o = {}) {
      game.renderer.lighting.apply({ ...STUDIO_LIGHTING, ...(o.lighting || {}) });
      game.world.band = { zMin: -3, zMax: 3 };
      game.world.extents = { xMin: -50, xMax: 50 };
      return { plinth: o.plinth === false ? null : ctx.plinth(o.plinth || {}) };
    },
    async stage(id, o = {}) { const m = await game.levels.load(id, { script: !!o.script }); if (o.script) game.levels.start(0); return m; },
    async hero(id, o = {}) {
      const h = await createHero(game, id, { x: o.x ?? 0, z: o.z ?? 0, facing: o.facing ?? 1, playerIndex: o.playerIndex ?? 0 });
      game.world.add(h);
      if (o.puppet) ctx.puppet(h);
      return h;
    },
    async enemy(type, o = {}) {
      const E = await safeImport(() => import('../enemies/spawnEnemy.js'), 'enemies/spawnEnemy');
      if (!E) return null;
      const e = await E.spawnEnemy(game, type, { x: o.x ?? 3, z: o.z ?? 0, facing: o.facing ?? -1, tier: o.tier, ...(o.opts || {}) });
      if (e && o.puppet) ctx.puppet(e);
      return e;
    },
    async mount(id, o = {}) { const m = await game.mounts.spawn(id, { x: o.x ?? 0, z: o.z ?? 0, facing: o.facing ?? 1 }); if (m && o.puppet) { m.update = () => {}; } return m; },
    puppet(a) {
      a.brain = null;
      if (a.input) a.input = { consume: () => false, buffered: () => false, isDown: () => false, pressed: () => false, moveX: () => 0, moveZ: () => 0, runDir: 0, virtual: a.input.virtual };
      a.fsm.define({ puppet: { update(x, dt) { x.friction(20, dt); } } });
      a.fsm.go('puppet');
      a.boundsMode = 'none';
      return a;
    },
    turntable(a, { speed = 18, yaw = null } = {}) { spins.push({ a, speed, yaw: yaw === null ? null : yaw * DEG, cur: 0.35 }); },
    orbit(o = {}) {
      orbit = { target: new THREE.Vector3(...(o.target || [0, 1, 0])), distance: o.distance ?? 5, height: o.height ?? 1.4, yaw: (o.yaw ?? 0) * DEG, speed: (o.speed ?? 0) * DEG, fov: o.fov ?? 30, lookHeight: o.lookHeight ?? null };
      game.cameraRig.manual = true;
      game.cameraRig.manualFocus = orbit.target;
      return orbit;
    },
    gameCam(actors, { lock = null } = {}) {
      game.cameraRig.manual = false;
      game.cameraRig.follow(actors);
      if (lock) game.cameraRig.setLock(lock[0], lock[1]); else game.cameraRig.clearLock();
      game.cameraRig.snap();
    },
    every(seconds, fn) { timers.push({ every: seconds, t: 0, fn }); },
    after(seconds, fn) { timers.push({ at: seconds, t: 0, fn }); },
    label(text) {
      if (!labelEl) { labelEl = document.createElement('div'); labelEl.style.cssText = 'position:fixed;left:18px;bottom:14px;font:13px/1.4 "Palatino Linotype",Georgia,serif;letter-spacing:.2em;color:#e8d4b0;opacity:.75;text-transform:uppercase;pointer-events:none;z-index:6;text-shadow:0 2px 3px #000'; document.body.appendChild(labelEl); }
      labelEl.textContent = text;
    },
    expose(obj) { window.__KCA.register('showcase', obj); },
    _update(dt) {
      for (const t of timers) {
        t.t += dt;
        try {
          if (t.every && t.t >= t.every) { t.t -= t.every; t.fn(); }
          else if (t.at !== undefined && !t.done && t.t >= t.at) { t.done = true; t.fn(); }
        } catch (e) { reportError('showcase.timer', e); }
      }
    },
    _render(alpha, fdt) {
      for (const s of spins) {
        if (!s.a || s.a.removed) continue;
        if (s.yaw !== null) s.a.body.rotation.y = s.yaw;
        else { s.cur += fdt * s.speed * DEG; s.a.body.rotation.y = s.cur; }
      }
      if (orbit) {
        orbit.yaw += orbit.speed * fdt;
        const cam = game.camera;
        cam.position.set(orbit.target.x + Math.sin(orbit.yaw) * orbit.distance, orbit.target.y + orbit.height, orbit.target.z + Math.cos(orbit.yaw) * orbit.distance);
        cam.lookAt(orbit.target.x, orbit.lookHeight ?? orbit.target.y, orbit.target.z);
        if (cam.fov !== orbit.fov) { cam.fov = orbit.fov; cam.updateProjectionMatrix(); }
      }
    },
  };
  return ctx;
}
