// Chapter 1 ending (Flow state 'ending', entered after the Stage 5 tally — i.e. after Morvane's finale + stage clear).
// Emits 'flow:chapterComplete' { chapter: 1 } on entry. Timeline (sim-clock, deterministic under captures):
//   A  Throne of Coils: the captives are lowered from their chains; the Copper Ax descends from its altar into the
//      three heroes' midst in a gold surge — THE COPPER AX IS RESTORED (heroes' victory poses)
//   B  epilogue vignettes (text over staged 3D): the Ashen Wilds at dawn (heroes walking home); the camp fire at night
//      with the restored Ax standing watch
//   C  credits roll over the camp; a marauder grunt wanders in and bats his own credit into the sky (it twinkles out),
//      then magic pots rain down and stack into E N D; PRESS START
//   → endRun (YOUR STRENGTH / CLASS ranking → high-score initials → title)
// CONFIRM (after 2 s) skips to the ranking. Debug: __KCA.game.flow.go('ending') from any mode (e.g. /?mode=title).
import * as THREE from 'three';
import { HERO_IDS } from '../core/config.js';
import { createHero } from '../characters/spawnHero.js';
import { reportError } from '../core/log.js';
import { installScriptStates, pose, walkTo } from '../levels/stages/bonus/camp.js';
import { Geo, pot as potGeo } from '../levels/stages/bonus/geo.js';

const STOP = Symbol('ending-stop');
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const DAWN = {
  base: 'ashen-dusk',
  sky: { zenith: '#1a2a5a', top: '#4a5a92', horizon: '#e0905a', horizonSun: '#ffd08a', bottom: '#2a1c1a', sunDir: [0.35, 0.07, -1], sunColor: '#ffb070', sunDisc: '#fff0c8', sunDiscIntensity: 9, sunGlow: 1.2,
    clouds: { cover: 0.45, color: '#5a3a4a', lit: '#ffb080' } },
  sun: { color: '#ffe0b8', intensity: 2.6 },
  hemi: { sky: '#8a90c0', ground: '#2a2020', intensity: 0.7 },
  rim: { color: '#ffb070', intensity: 0.9 },
  fog: { color: '#8a7888', near: 30, far: 300, height: { color: '#9a8a9a' }, depthGrade: { tint: '#8a7a9a', dim: 0.3, desat: 0.3 } },
  exposure: 1.15,
};

const CREDITS = [
  { title: 'KNOTZCOPPERAX', sub: 'Chapter 1 — The Adder King' },
  { role: 'A GAME BY', name: 'KnotEnvy' },
  { role: 'DIRECTION & DESIGN', name: 'KnotEnvy' },
  { role: 'BUILT WITH', name: 'Claude — a team of agents', sub: 'engine · look-dev · animation · combat · magic & VFX · enemies & AI · bosses · beasts · stages · camp · UI · audio' },
  { role: 'HEROES', name: 'Brann Ashmantle · Seraphine · Gorrim', sub: 'sculpted, rigged and animated in code' },
  { role: 'ART', name: 'Every mesh, texture and spark generated', sub: 'Blender Python + Three.js — no third-party art' },
  { role: 'MUSIC & SOUND', name: 'Synthesised live in WebAudio' },
  { role: 'TECHNOLOGY', name: 'Three.js · postprocessing · Vite · Blender' },
  { role: 'IN LOVING MEMORY OF', name: 'Golden Axe (Sega, 1989)', sub: 'the arcade that taught us to kick thieves' },
  { role: 'SPECIAL THANKS', name: 'Our playtesters', sub: 'and you, for playing' },
  { role: 'GRUNT WRANGLING', name: 'The Marauders of the Ashen Wilds', bat: true },
];

/** END spelled on a 4×5 grid per letter (row 0 = top). */
const LETTERS = {
  E: ['1111', '1000', '1110', '1000', '1111'],
  N: ['1001', '1101', '1011', '1001', '1001'],
  D: ['1110', '1001', '1001', '1001', '1110'],
};

export function startEnding(flow, data, { endRun }) {
  const g = flow.game;
  let alive = true, scr = null, skipOk = false;
  const cam = g.cameraRig;
  const C = { from: new THREE.Vector3(), to: new THREE.Vector3(), lf: new THREE.Vector3(), lt: new THREE.Vector3(), t: 0, dur: 1, fov: 32 };
  const tickers = new Set();
  const system = {
    name: 'ending', order: 85, freezable: false,
    update(dt) {
      if (!alive) return;
      for (const f of tickers) { try { f(dt); } catch (e) { tickers.delete(f); reportError('ending.tick', e); } }
      if (scr && scr.tick) scr.tick(dt);
      // cinematic camera (the rig is manual for the whole ending)
      C.t = Math.min(C.dur, C.t + dt);
      const k = ease(C.dur > 0 ? C.t / C.dur : 1);
      const camera = cam && cam.camera;
      if (camera) {
        camera.position.lerpVectors(C.from, C.to, k);
        const look = new THREE.Vector3().lerpVectors(C.lf, C.lt, k);
        camera.lookAt(look);
        if (Math.abs(camera.fov - C.fov) > 0.01) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
      }
    },
  };
  const shot = (from, to, lf, lt, seconds, fov = 32) => {
    const camera = cam && cam.camera;
    C.from.set(...from); C.to.set(...(to || from)); C.lf.set(...lf); C.lt.set(...(lt || lf)); C.t = 0; C.dur = seconds; C.fov = fov;
    if (camera) { camera.position.copy(C.from); camera.lookAt(C.lf); }
  };
  const wait = async (s) => { await g.wait(Math.max(1, Math.round(s * 60))); if (!alive) throw STOP; };
  const ctl = {
    stop() {
      if (!alive) return;
      alive = false;
      tickers.clear();
      g.removeSystem('ending');
      if (g.ui) g.ui.hide('ending');
      if (cam) { cam.manual = false; }
      if (flow._ending === ctl) flow._ending = null;
    },
  };
  flow._ending = ctl;
  const finish = () => { if (!alive) return; ctl.stop(); endRun(flow); };

  const clearScene = async (stageId, lighting = null) => {
    tickers.clear();
    if (g.bots) g.bots.dispose();
    g.world.clear();
    if (g.vfx) g.vfx.clear();
    if (g.ai && g.ai.reset) g.ai.reset();
    const p = g.levels.load(stageId, { script: false });
    await (g.track ? g.track(p) : p);
    if (lighting) g.renderer.lighting.apply(lighting);
    if (cam) { cam.manual = true; cam.clearDrama(); cam.clearLock(); cam.trauma = 0; }
    if (g.ui && g.ui.hud) g.ui.hud.show(false);
    return g.levels.env || {};
  };
  const heroOrder = () => {
    const picks = (flow.picks || []).map((p) => p.heroId).filter(Boolean);
    return [...new Set([...picks, ...HERO_IDS])].slice(0, 3);
  };
  const spawnHeroes = async (spots) => {
    const ids = heroOrder(), out = [];
    for (let i = 0; i < ids.length && i < spots.length; i++) {
      const s = spots[i];
      try {
        const pr = createHero(g, ids[i], { x: s.x, z: s.z, playerIndex: Math.min(i, 1), facing: s.facing || 1 });
        const h = await (g.track ? g.track(pr) : pr);
        h.boundsMode = 'none'; h.godMode = true; h.hurtable = false;
        g.world.add(h);
        installScriptStates(h);
        pose(h, s.clip || 'idle', 0.01);
        out.push(h);
      } catch (e) { reportError('ending.hero', e); }
    }
    return out;
  };
  const burst = (x, y, z, big = 1) => {
    const v = g.vfx; if (!v) return;
    try {
      if (v.shape) { v.shape.emit({ shape: 'ring', pos: [x, y, z], size: [2.2 * big, 2.2 * big], life: 0.9, color: ['#fff0c0', '#ff9a30'], intensity: 4, grow: [0.3, 2.2] }); v.shape.emit({ shape: 'glow', pos: [x, y, z], size: [2.4 * big, 2.4 * big], life: 0.7, color: ['#fff6d8', '#ffb050'], intensity: 3 }); }
      if (v.add) for (let i = 0; i < 26 * big; i++) { const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3; v.add.emit({ pos: [x, y, z], vel: [Math.cos(a) * s, Math.random() * 3 + 0.5, Math.sin(a) * s * 0.5], life: 0.8 + Math.random() * 0.6, size: [0.08, 0.01], color: ['#fff0b0', '#ff8a30'], intensity: 5, drag: 0.6, gravity: -2 }); }
    } catch (e) { /* vfx optional */ }
  };

  // ------------------------------------------------------------------------------------------ timeline
  const run = async () => {
    g.bus.emit('flow:chapterComplete', { chapter: 1 });
    if (g.ui) { g.ui.go(false); g.ui.hideAll && g.ui.hideAll(); }
    g.addSystem(system);
    scr = await g.ui.show('ending', { onSkip: () => { if (skipOk) finish(); } });
    g.after(120, () => { skipOk = true; });
    scr.fade(true, 0.01);

    // ---- A · the throne room: captives freed, the Copper Ax restored
    const env = await clearScene('stage5');
    const hall = env.hall || {}, arena = env.arena || {};
    const relic = hall.relic || arena.relic || null;
    const heroes = await spawnHeroes([{ x: 49.9, z: 0.7, facing: 1 }, { x: 52, z: 1.2, facing: 1 }, { x: 54.1, z: 0.7, facing: -1 }]);
    const gold = new THREE.PointLight('#ffb55a', 0, 16, 1.8); g.renderer.envGroup.add(gold);
    shot([52, 4.6, 17], [52, 3.4, 11.5], [52, 3.2, -3], [52, 2.6, -1], 7.5, 34);
    scr.bars(true);
    await wait(0.3);
    scr.fade(false, 1.6);
    if (arena.lowerCaptives) arena.lowerCaptives();
    await wait(1.2);
    scr.caption('THE ADDER KING HAS FALLEN', 'THE CAPTIVES ARE FREE', { metal: 'ivory', sub: 'The Queen and her consort are lowered from the serpent chains.' });
    await wait(3.6);
    scr.uncaption();
    // the relic tears loose from its altar and drifts down into the heroes' midst
    if (relic) {
      const p0 = relic.position.clone(), p1 = new THREE.Vector3(52, 2.9, 1.0);
      let t = 0; const T = 3.2;
      tickers.add((dt) => {
        t += dt; const k = ease(Math.min(1, t / T));
        relic.position.lerpVectors(p0, p1, k); relic.position.y += Math.sin(t * 2.2) * 0.06 * k;
        relic.rotation.y += dt * (2.5 - 2.0 * k);
        gold.position.set(relic.position.x, relic.position.y, relic.position.z + 0.8);
        gold.intensity = 6 + 34 * k * (0.9 + 0.1 * Math.sin(t * 9));
      });
      shot([52, 3.4, 11.5], [52, 2.7, 8.2], [52, 3.6, -3], [52, 2.4, 0.8], 3.4, 32);
    }
    heroes.forEach((h, i) => g.after(20 + i * 8, () => { h.facing = h.pos.x < 52 ? 1 : -1; pose(h, 'idle'); }));
    await wait(3.3);
    burst(52, 2.9, 1.0, 1.4);
    if (cam && cam.shake) cam.shake(0.25);
    if (g.audio && g.audio.play) g.audio.play('magic_fire', { volume: 0.6 });
    heroes.forEach((h, i) => g.after(i * 6, () => pose(h, 'victory', 0.2)));
    scr.caption('', 'THE COPPER AX IS RESTORED', { metal: 'copper', sub: 'Its light returns to the three who carried it home.' });
    await wait(5.4);
    scr.fade(true, 1.2);
    await wait(1.4);
    scr.clear();

    // ---- B1 · the Ashen Wilds at dawn: the heroes walk home
    await clearScene('stage1', DAWN);
    const walkers = await spawnHeroes([{ x: 3.2, z: 0.2 }, { x: 4.6, z: -0.7 }, { x: 5.8, z: 0.8 }]);
    walkers.forEach((h, i) => walkTo(h, 15 + i * 1.3, h.pos.z, { speed: 1.25 + i * 0.05, face: 1, then: 'idle' }));
    shot([3, 2.6, 11], [11, 2.8, 10], [5, 1.6, 0], [13, 1.8, 0], 10, 32);
    scr.fade(false, 1.4);
    scr.prose(['The Adder King’s coils fell still, and the witchfires guttered out one by one.', 'From the Ashen Wilds to the Shellback shore, the burned villages would rise again.'], { stagger: 3.0 });
    await wait(8.8);
    scr.fade(true, 1.2);
    await wait(1.4);
    scr.clear();

    // ---- B2 · the camp fire: the restored Ax keeps watch
    await clearScene('bonus');
    const campers = await spawnHeroes([{ x: -1.7, z: 0.35, facing: 1 }, { x: 1.8, z: 0.4, facing: -1 }, { x: 2.8, z: 0.6, facing: -1, clip: 'down_loop' }]);
    let ax = null;
    try {
      const res = await g.assets.instance('weapon_copperax');
      if (res && res.root && res.source !== 'placeholder') {
        ax = res.root; ax.position.set(-1.25, 0.28, -2.1); ax.rotation.set(0, 0.5, -0.12); ax.scale.setScalar(1.3); g.renderer.envGroup.add(ax);
        const l = new THREE.PointLight('#ffb45a', 5, 5, 2); l.position.set(-1.25, 1.2, -1.6); g.renderer.envGroup.add(l);
        let t = 0; tickers.add((dt) => { t += dt; l.intensity = 5 + Math.sin(t * 2) * 1.2; });
      }
    } catch (e) { /* the Ax is optional */ }
    shot([0.4, 3.0, 11.5], [0.2, 2.8, 10.2], [0, 1.2, -1], [0, 1.1, -1], 9, 32);
    scr.fade(false, 1.4);
    scr.prose(['Beneath the old stars, three wanderers shared one last fire…', '…and the Copper Ax, restored, kept watch until morning.'], { stagger: 3.0 });
    await wait(8.2);
    scr.clear();
    await wait(1.2);

    // ---- C · credits roll (+ the grunt gag) → pots spell END
    const ROLL = 26;
    const roll = scr.credits(CREDITS, ROLL);
    shot([0.2, 2.8, 10.2], [0, 3.1, 11.2], [0, 1.1, -1], [0, 1.4, -1], ROLL, 32);
    // a marauder grunt wanders in from the right as his own credit scrolls up
    let grunt = null;
    try {
      const E = await import('../enemies/spawnEnemy.js');
      const pr = E.spawnEnemy(g, 'marauder', { x: 9.5, z: 1.4, facing: -1, tier: 'straw' });
      grunt = await (g.track ? g.track(pr) : pr);
      if (grunt) { grunt.brain = null; grunt.boundsMode = 'none'; grunt.hurtable = false; installScriptStates(grunt); pose(grunt, 'idle', 0.01); grunt.pos.set(11, 0, 1.4); }
    } catch (e) { reportError('ending.grunt', e); }
    let phase = 'roll';
    tickers.add(() => {
      if (!roll.batEl || !grunt) return;
      const y = scr.batY();
      if (phase === 'roll' && y < 0.95) { phase = 'walk'; walkTo(grunt, 2.6, 1.4, { speed: 1.7, face: -1, then: 'idle' }); }
      if ((phase === 'walk' || phase === 'roll') && y < 0.47) scr.hold(true);   // the credit waits for its grunt
      if ((phase === 'walk' || phase === 'roll') && y < 0.47 && !grunt._walkTo) {
        phase = 'swing';
        grunt.facing = -1; pose(grunt, 'heavy', 0.08);
        g.after(18, () => {
          scr.bat(); if (cam && cam.shake) cam.shake(0.3);
          if (g.audio && g.audio.play) g.audio.play('hit_heavy', { volume: 0.8 });
          burst(grunt.pos.x - 0.9, 2.2, grunt.pos.z, 0.5);
        });
        g.after(70, () => { pose(grunt, 'taunt', 0.2); });
        g.after(140, () => { walkTo(grunt, 12, 1.4, { speed: 2.2, face: 1, then: 'idle' }); scr.hold(false); phase = 'gone'; });
      }
    });
    // wait for the roll to finish (+ the gag hold)
    for (let i = 0; i < 60 && phase !== 'gone'; i++) await wait(0.5);
    await wait(4.5);

    // pots rain down and stack into E N D
    const cells = [];
    const pitch = 0.38, letterW = 4 * pitch, gap = 0.75, totalW = 3 * letterW + 2 * gap;
    ['E', 'N', 'D'].forEach((L, li) => LETTERS[L].forEach((row, r) => [...row].forEach((c, ci) => {
      if (c === '1') cells.push({ x: -totalW / 2 + li * (letterW + gap) + ci * pitch + pitch / 2, y: 1.75 + (4 - r) * pitch, z: 2.4 });
    })));
    const pg = new Geo(); potGeo(pg, null, { h: 0.34, seed: 3 });
    const potMesh = new THREE.InstancedMesh(pg.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, emissive: new THREE.Color('#1a2a6a'), emissiveIntensity: 0.6 }), cells.length);
    potMesh.castShadow = true; potMesh.name = 'ending_pots'; g.renderer.envGroup.add(potMesh);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
    const order = cells.map((c, i) => ({ c, i, d: c.x + (Math.random() - 0.5) * 0.6 })).sort((a, b) => a.d - b.d);
    order.forEach((o, n) => { o.t0 = n * 0.075; o.landed = false; o.spin = (Math.random() - 0.5) * 6; });
    let tp = 0;
    tickers.add((dt) => {
      tp += dt;
      for (const o of order) {
        const u = tp - o.t0;
        let y = 9, rot = 0;
        if (u > 0) {
          const T = 0.8;
          if (u < T) { const k = u / T; y = o.c.y + (9 - o.c.y) * (1 - k * k); rot = o.spin * (1 - k); }
          else { const b = u - T; y = o.c.y + Math.abs(Math.sin(b * 9)) * 0.18 * Math.exp(-b * 5); if (!o.landed) { o.landed = true; if (g.vfx && g.vfx.add) try { g.vfx.add.emit({ pos: [o.c.x, o.c.y + 0.2, o.c.z + 0.2], vel: [0, 0.8, 0], life: 0.5, size: [0.12, 0.01], color: ['#bcd4ff', '#4a7aff'], intensity: 5 }); } catch (err) { /* */ } } }
        }
        pv.set(o.c.x, y, o.c.z); e.set(0, rot + o.c.x * 0.4, rot * 0.3); q.setFromEuler(e); m4.compose(pv, q, sc); potMesh.setMatrixAt(o.i, m4);
      }
      potMesh.instanceMatrix.needsUpdate = true;
    });
    shot([0, 3.1, 11.2], [0, 2.6, 9.2], [0, 1.4, -1], [0, 2.2, 1.5], 3.5, 32);
    await wait(order.length * 0.075 + 1.6);
    if (g.audio && g.audio.play) g.audio.play('ui_confirm', { bus: 'ui', volume: 0.8 });
    scr.prompt('PRESS START');
    await wait(5.5);
    scr.fade(true, 1.2);
    await wait(1.3);
    finish();
  };
  run().catch((err) => { if (err !== STOP) { reportError('ending', err); finish(); } });
  return ctl;
}
