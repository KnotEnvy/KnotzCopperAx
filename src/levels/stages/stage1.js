// Stage 1 — Ashen Wilds: burned village outskirts at blood-red dusk (DESIGN.md §6).
// Environment (look-dev/stage-1 agent): painted dusk sky + far ridges with a burning keep and smoke columns,
// ruined palisade + watchtower, smouldering thatched huts, gnarled dead trees, wind-swept grass, boulders,
// fences, a wrecked cart, crows, drifting embers and ash, slanting light shafts, and a rutted/puddled dirt road
// along the playable belt. Helpers live in ./stage1/**. Wave script (screens) is unchanged.
import * as THREE from 'three';
import * as M from '../../render/materials.js';
import { createFireKit } from '../../render/fire.js';
import { preloadFireLibrary, FirePool } from '../../vfx/fireLib.js';
import { createAmbient } from '../../render/particles.js';
import { createShafts } from '../../render/shafts.js';
import { createGrass, grassPushers } from '../../render/foliage.js';
import { buildTerrain, terrainH, ROAD } from './stage1/terrain.js';
import { buildHut } from './stage1/huts.js';
import { loadStage1Kit } from './stage1/kit.js';
import { buildPalisade, PALISADE_Z } from './stage1/palisade.js';
import { treeGeometry, plantTrees } from './stage1/trees.js';
import { scatterRocks, buildWoodProps } from './stage1/props.js';
import { buildDistant } from './stage1/distant.js';
import { buildCrows } from './stage1/crows.js';
import { buildForeground } from './stage1/foreground.js';
import { groundZones } from './stage1/groundZones.js';
import { finishStubble } from './stage1/surfaceFinish.js';
import { rngFrom, fbm2 } from './stage1/geo.js';

const FRAMING = { height: 3.9, lookHeight: 1.6, distance: 13.8 };

const HUTS = [
  { x: -9.5, z: -9.8, yaw: 0.2, w: 5.2, collapse: 0.5, burning: 0.7, seed: 19 },
  { x: 4.8, z: -10.4, yaw: 0.12, w: 5.6, d: 4.0, collapse: 0.75, holeU: 1.0, burning: 1, seed: 3 },
  { x: 17.8, z: -8.4, yaw: -0.25, gutted: true, burning: 0.6, seed: 5 },
  { x: 28.2, z: -12.8, yaw: -0.3, w: 6.0, d: 4.2, rise: 2.8, collapse: 1.0, holeU: -0.6, burning: 1, seed: 7 },
  { x: 42.2, z: -9.4, yaw: 0.22, w: 5.2, collapse: 0.35, holeU: 1.2, burning: 0.7, seed: 11 },
  { x: 55.8, z: -11.9, yaw: -0.12, w: 5.8, collapse: 0.8, burning: 1, seed: 13 },
  { x: 68.5, z: -9.8, yaw: 0.3, gutted: true, burning: 0.5, seed: 17 },
];

export default {
  id: 'stage1',
  number: 1,
  name: 'Ashen Wilds',
  subtitle: 'STAGE 1',
  zBand: [-2.6, 2.6],
  extents: [-3, 56],
  playerStart: { x: 3, z: 0 },
  // C1 r5: preserve the authored actor value ladder. The inherited .3-linear floor
  // and wrapped 3.25 key pushed skin/cloth/stone into the same HDR shoulder.
  // Keep separation on the key-side silhouette instead of lifting every dark texel.
  lighting: {
    base: 'ashen-dusk',
    character: {
      rim: '#ffc38b', intensity: 0.16, edge: 1.45, width: 1.8,
      key: { intensity: 1.2, wrap: 0.12, albedoFloor: 0, albedoLiftMax: 1, metalAmbient: 0.6 },
      ambientIntensity: 0.12,
    },
    // Haze starts beyond the fight belt; progressively cool/soften the village.
    fog: {
      height: { density: 0.065, falloff: 0.085, start: 24, max: 0.78, color: '#6b586b' },
      depthGrade: { dim: 0.12, desat: 0.6 },
    },
  },
  async build(ctx) {
    const { game, group } = ctx;
    const q = ctx.quality || {};
    const rng = rngFrom(1234);
    const villageKit = await loadStage1Kit(game);
    if (game.cameraRig && game.cameraRig.setFraming) game.cameraRig.setFraming(FRAMING);

    const mats = {
      wood: M.wood({ color: '#3e3129', color2: '#5e4c3e', charColor: '#120e0d', emberIntensity: 2.4, char: 0.12 }),
      bark: M.bark({ color: '#2a221e', color2: '#4a3e36', charColor: '#120e0d' }),
      rock: villageKit.material,
    };
    await preloadFireLibrary();
    const villageFire = new FirePool({ capacity: 128, name: 's1AuthoredFire' });
    group.add(villageFire.mesh);
    const fx = createFireKit({ quality: q });
    // Centre-anchored flipbooks: keep the painted flame roots on the Blender rim.
    // All near-village flames share this draw; smoke/sparks keep their existing kit.
    fx.flame = (pos, o = {}) => {
      const height = o.height || 1.4, width = o.width || height * .6;
      villageFire.emit({ clip: 'flame', pos: [pos[0], pos[1] + (o.roof ? height * .40 : height * .36 - .08), pos[2]],
        size: [width * 1.10, height * 1.12], life: .72 + (o.seed || 0) * .55,
        loop: true, phase: o.seed || 0, core: .27, alpha: .90, rooted: true, tint: '#ffc078',
        soft: height * .32, floor: pos[1] - height * .06 });
    };
    const farFx = createFireKit({ quality: q, fog: false, colors: { smokeCool: '#4a3246', smokeDark: '#23141d', smokeWarm: '#ff6a30' } });
    const lightSpots = [];

    buildDistant(ctx, farFx);

    // ---- huts
    for (const h of HUTS) {
      const r = buildHut({ ...h, y: terrainH(h.x, h.z) - 0.04, mats, kit: villageKit });
      group.add(r.group);
      for (const f of r.flames) fx.flame(f.p.toArray(), { height: f.h, width: f.w ?? f.h * .6, intensity: f.I, seed: f.seed, speed: f.speed, roof: true, layers: false, heat: false, soot: false });
      // One coherent narrowing plume per roof, in the existing authored-fire draw.
      for (const s of r.smoke) villageFire.emit({ clip: 'smoke', pos: [s.p.x, s.p.y + 2.1, s.p.z],
        size: [2.0, 5.0], life: 4.5, loop: true, phase: h.x*.13, core: 0, alpha: .68,
        tint: '#8c8189', rot: -.09, soft: .3, floor: s.p.y-.3 });
      // A separate low-density wisp lives behind each opening, not only above it.
      // All puffs remain in the shared fire draw and occlude against real rafters.
      for (const s of r.smoke) villageFire.emit({clip:'smoke',pos:[s.p.x,s.p.y-.12,s.p.z-.65],
        size:[1.65,1.6],life:5.3,loop:true,phase:h.seed*.137,core:0,alpha:.22,
        tint:'#a38c70',rot:.12,soft:.12,floor:s.p.y-1.0});
      for (const g of r.glows) fx.glow(g.p.toArray(), { size: g.s, color: g.c, intensity: g.I });
      for (const s of r.sparks) fx.sparks(s.p.toArray(), { count: s.rate, radius: 1.6, rise: 2.6 });
      // Broad, faint light-on-air scatter in front of the hut, behind all actors.
      // Reuses the fire kit's existing instanced glow draw; no new pass or light.
      fx.glow([h.x, terrainH(h.x, h.z) + 3.8, h.z + 2.8], {
        size: 10, color: '#ff965c', intensity: 0.045 * h.burning, flicker: 0.06,
      });
      lightSpots.push(...r.lights);
    }
    buildPalisade(ctx, mats, fx, lightSpots);

    // ---- dead trees (mid-ground frame the belt; far ones stand on the hills behind the palisade)
    const nearHut = (x, z, r) => HUTS.some((h) => Math.hypot(h.x - x, h.z - z) < r);
    const tv = [treeGeometry(11, { height: 8.5 }), treeGeometry(23, { height: 7.5 }), treeGeometry(37, { height: 9.5, radius: 0.36 }), treeGeometry(41, { height: 6.5, radius: 0.24 })];
    const farTv = [treeGeometry(51, { height: 7.5, lod: 1, levels: 2 }), treeGeometry(63, { height: 6.5, lod: 1, levels: 2 })];
    const mid = [], far = [];
    for (let x = -26; x < 90; x += 5.5 + rng.next() * 5) {
      const z = -5.8 - rng.next() * 11;
      if (nearHut(x, z, 4.8) || Math.abs(z - PALISADE_Z(x)) < 2) continue;
      mid.push({ v: Math.floor(rng.next() * 4), x, y: terrainH(x, z) - 0.1, z, s: 0.85 + rng.next() * 0.45, yaw: rng.next() * 6.28, tilt: (rng.next() - 0.5) * 0.12 });
    }
    for (let i = 0; i < 90; i++) {
      const x = -70 + rng.next() * 200, z = -26 - rng.next() * 55;
      far.push({ v: Math.floor(rng.next() * 2), x, y: terrainH(x, z) - 0.2, z, s: 0.8 + rng.next() * 0.7, yaw: rng.next() * 6.28, tilt: (rng.next() - 0.5) * 0.15 });
    }
    plantTrees(ctx, mats.bark, tv, mid, 'deadTrees');
    for (const im of plantTrees(ctx, mats.bark, farTv, far, 'farTrees')) im.castShadow = false; // outside the shadow frustum anyway

    // ---- boulders
    const rocks = [];
    const addRock = (x, z, s, o = {}) => rocks.push({ v: Math.floor(rng.next() * 3), x, y: terrainH(x, z) - s * (o.buried ?? .16), z, s, yaw: rng.next() * 6.28, sy: o.sy ?? (0.6 + rng.next() * 0.5), sx: o.sx ?? (0.65 + rng.next() * .85), tx: (rng.next() - 0.5) * 0.3 });
    for (let i = 0; i < 46; i++) { const x = -30 + rng.next() * 120, z = -4.2 - rng.next() * 15; if (!nearHut(x, z, 3.5)) addRock(x, z, 0.3 + Math.pow(rng.next(), 2) * 1.3); }
    for (let i = 0; i < 22; i++) { const x = -20 + rng.next() * 100, z = 3.9 + rng.next() * 4; addRock(x, z, 0.18 + rng.next() * 0.35, { sy: 0.85 }); }
    for (let i = 0; i < 16; i++) { const x = -10 + rng.next() * 80, z = rng.next() < 0.5 ? -2.9 - rng.next() * 0.6 : 2.9 + rng.next() * 0.6; addRock(x, z, 0.1 + rng.next() * 0.16, { sy: 0.85 }); }
    for (let i = 0; i < 30; i++) { const x = -60 + rng.next() * 180, z = -24 - rng.next() * 40; addRock(x, z, 0.8 + rng.next() * 2.2); }
    for (const [cx,cz,size] of [[-1.8,4.5,.68],[11.5,4.6,.56],[24.4,4.7,.74],[38.5,4.6,.62],[52.5,4.4,.7],[9,-5.7,.8],[31,-5.9,.9],[47,-5.6,.78]]) {
      addRock(cx,cz,cz>0?size*.70:size,{sy:.8});
      for(let i=0;i<5;i++) {
        const angle=rng.next()*Math.PI*2, radius=.45+rng.next()*.95;
        addRock(cx+Math.cos(angle)*radius,cz+Math.sin(angle)*radius*.55,.10+rng.next()*.20,{sy:.7});
      }
    }
    // Physical gravel in drift margins, clustered with the same authored zones.
    for (let i=0;i<380;i++) {
      const x=-12+rng.next()*85, z=2.9+rng.next()*3.3, zone=groundZones(x,z);
      if(rng.next()>zone.char*.6+zone.ash*.42) continue;
      addRock(x,z,.045+rng.next()*.11,{sy:.45+rng.next()*.7});
    }
    // Sparse chips on screen 2/3 packed-earth margins; no tall lane obstacles.
    for (let i=0; i<210; i++) {
      const x=-8+rng.next()*75, z=(rng.next()-.5)*4.7;
      if (Math.abs(z)<.35 || rng.next()>.72) continue;
      addRock(x,z,.035+rng.next()*.065,{sy:.35+rng.next()*.55});
    }
    // Wind-caught rubble islands on the later lane margins: clusters with a
    // size hierarchy, different minerals and burial, leaving the centre open.
    for (const [cx,cz] of [[20.8,-2.7],[29.5,2.55],[36.3,-2.5],[47.0,2.65],[56.3,-2.7]]) {
      for(let i=0;i<11;i++) {
        const a=rng.next()*6.28, d=Math.pow(rng.next(),1.6)*1.25;
        const s=i===0?.19:.035+Math.pow(rng.next(),2)*.12;
        addRock(cx+Math.cos(a)*d,cz+Math.sin(a)*d*.36,s,
          {sy:.35+rng.next()*.8,sx:.6+rng.next()*1.15,buried:.18+rng.next()*.27});
      }
    }
    await buildTerrain(ctx, HUTS, rocks);
    scatterRocks(ctx, mats.rock, rocks, villageKit);
    buildWoodProps(ctx, mats, fx, rocks, HUTS);
    buildForeground(ctx);

    // ---- grass: dense field behind the belt, sparse tufts on the verges, a foreground band at the frame bottom
    const roadHalf = ROAD.halfWidth - 0.4;
    const density = (x, z) => {
      const dz = Math.abs(z - ROAD.z);
      if (dz < roadHalf) return 0;
      let d = dz < 3.4 ? 0.18 + (dz - roadHalf) * 0.35 : 1;
      if (nearHut(x, z, 3.4)) d *= 0.15;
      const burnt = fbm2(x * 0.08, z * 0.08, 21, 3);
      d *= 0.35 + 0.65 * Math.min(1, Math.max(0, (0.72 - burnt) * 3));
      return d;
    };
    // r2 value re-key: ash-dusted, desaturated grass on the belt verges; a darker, cooler foreground band that frames
    // the bottom of the screen; the warmer straw colour survives only in the mid-ground field behind the belt.
    group.add(createGrass(rng, { x0: -34, x1: 96, z0: -17, z1: 3.4, density: 3.0, densityFn: density, y: terrainH, quality: q, height: [0.3, 0.72], width: 0.065, blades: 5, distinctForms: true, wind: 0.28,
      base: '#141418', tip: '#6e6c5c', dry: '#80725e', tints: ['#ffffff', '#e4e2dc', '#ece0cc', '#c8ccc0', '#b0aa9a', '#9a98a0'] }));
    // r3: the foreground band is thinned + lowered (it was ~20% of the frame of dark blades): sparse low tufts in
    // clumps that let the charred bank + debris read, and ~60% fewer blades to shade near the camera.
    // Short burnt stalks need less world-space wind: the full bend pushes their
    // tips below the terrain, leaving jagged strips where the ground clips them.
    const fgDensity = (x,z) => groundZones(x,z).clump;
    group.add(createGrass(rng, { x0: -34, x1: 96, z0: 2.9, z1: 7.5, density: 30, densityFn: fgDensity, y: terrainH, quality: q, height: [0.22, 0.72], width: 0.067, blades: 6, distinctForms: true, wind: 0.10, receiveShadow: false,
      base: '#18191d', tip: '#8d8870', dry: '#9c8965', tints: ['#ffffff', '#d3ccae', '#a5aaa3', '#bd9673', '#717c75'] }));
    group.add(createGrass(rng, { x0: -60, x1: 130, z0: -44, z1: -17, density: 0.9, chunk: 32, densityFn: (x, z) => (Math.abs(z - PALISADE_Z(x)) < 1 ? 0 : 0.9), y: terrainH, quality: q, height: [0.6, 1.2], blades: 7, width: 0.075, receiveShadow: false,
      base: '#2a261c', tip: '#8a7644', dry: '#a08a5a' }));

    // ---- fire, smoke, sparks, far fires
    for (const child of group.children) if (child.name === 'grass') finishStubble(child);
    const fxObj = fx.build(); if (fxObj) group.add(fxObj);
    const farObj = farFx.build(); if (farObj) group.add(farObj);

    // ---- light shafts slanting down from the sun side through the smoke
    const shafts = [];
    for (let x = -24; x < 96; x += 7 + rng.next() * 6) shafts.push({ pos: [x, 9 + rng.next() * 2.5, -20 - rng.next() * 7], length: 15 + rng.next() * 6, width: 2.4 + rng.next() * 2.4, intensity: 0.4 + rng.next() * 0.35, seed: rng.next() });
    const sh = createShafts(shafts, { dir: [-0.42, -0.55, 0.72], color: '#e4a67e', intensity: 0.32, fade: 0.018, quality: q });
    if (sh) group.add(sh);

    // ---- ambient embers + ash around the camera
    const embers = createAmbient({ kind: 'ember', count: 280, box: [36, 7, 16], offset: [2, 0.1, -3], quality: q, velocity: [0.9, 0.7, 0.05], size: 0.08, intensity: 4.5 });
    const ash = createAmbient({ kind: 'ash', count: 420, box: [36, 9, 18], offset: [2, 0, -3], quality: q, color: '#8a8084', color2: '#3a3238', size: 0.05, intensity: 0.7 });
    group.add(embers.object, ash.object);

    // ---- crows
    const perches = [];
    for (const x of [7.4, 22.6, 38.3, 50.2, -3.1]) perches.push([x, terrainH(x, PALISADE_Z(x)) + 3.55, PALISADE_Z(x), rng.next() * 6]);
    buildCrows(ctx, [
      { x: 12, y: 7.6, z: -36, r: 6, n: 4, speed: 0.32 },
      { x: 44, y: 9.5, z: -52, r: 8, n: 5, speed: -0.26 },
      { x: -2, y: 6.5, z: -15, r: 4.5, n: 3, speed: 0.38 },
    ], perches);

    // ---- pooled flicker lights (≤ 2) that follow the nearest fires
    const lights = [new THREE.PointLight('#ff9b58', 0, 23, 2), new THREE.PointLight('#ff8a48', 0, 21, 2)];
    for (const l of lights) group.add(l);
    const tmp = new THREE.Vector3();
    const pushTargets = [];
    let lt = 0;

    const update = (dt, t) => {
      const cam = game.cameraRig;
      const fxX = cam ? cam.focus.x : 0;
      lt += dt;
      villageFire.update(dt);
      // nearest two fire spots to the camera focus
      const sorted = lightSpots.slice().sort((a, b) => Math.abs(a.x - fxX) - Math.abs(b.x - fxX));
      lights.forEach((l, i) => {
        const s = sorted[i]; if (!s) { l.intensity = 0; return; }
        if (l.position.distanceToSquared(s) > 4) l.position.copy(s); else l.position.lerp(s, 0.2);
        const fl = 0.72 + 0.18 * Math.sin(lt * 9.3 + i * 2) * Math.sin(lt * 5.1 + i) + 0.1 * Math.sin(lt * 23.0 + i * 5);
        l.intensity = (i === 0 ? 55 : 42) * fl;
      });
      if (cam && cam.camera) { embers.update(cam.camera, cam.focus, game.renderer ? game.renderer.height : 900); ash.update(cam.camera, cam.focus, game.renderer ? game.renderer.height : 900); }
      // grass pushers: up to 4 actors nearest the focus
      pushTargets.length = 0;
      const actors = game.world && game.world.actors ? game.world.actors : [];
      for (const a of actors) if ((a.kind === 'hero' || a.kind === 'enemy' || a.kind === 'mount') && !a.removed && a.pos) pushTargets.push(a);
      pushTargets.sort((a, b) => Math.abs(a.pos.x - fxX) - Math.abs(b.pos.x - fxX));
      for (let i = 0; i < 4; i++) {
        const a = pushTargets[i];
        if (a) grassPushers.value[i].set(a.pos.x, a.pos.z, 0.85, 1); else grassPushers.value[i].set(0, 0, 0, 0);
      }
      tmp.set(0, 0, 0);
    };
    update(0, 0);
    return {
      update,
      groundAt: (x, z) => terrainH(x, z),
      dispose() {
        villageFire.dispose();
        if (game.cameraRig && game.cameraRig.resetFraming) game.cameraRig.resetFraming();
        for (const v of grassPushers.value) v.set(0, 0, 0, 0);
      },
    };
  },
  // ENCOUNTER SCRIPT (chapter1-integration, wave C). Tutorial-gentle curve: straw grunts → the first pot thief →
  // a Cluckhorn raider to steal → rust/violet/iron tiers → the Brute Brothers (bosses/_hook default for stage1,
  // spawned only after this screen's grunts are dead). `coop: true` spawns only with 2 heroes.
  props: [
    { prop: 'urn', x: 8.5, z: -1.9, loot: 'food' }, { prop: 'crate', x: 13.2, z: 1.9, loot: 'pot' },
    { prop: 'barrel', x: 27.5, z: -2.0, loot: ['pot', 'pot'] }, { prop: 'urn', x: 31.0, z: 2.0, loot: 'food' },
    { prop: 'crate', x: 45.5, z: -1.9, loot: 'food' }, { prop: 'urn', x: 50.0, z: 1.9, loot: 'pot' },
  ],
  // Encounter tuning (chapter1-integration): enemy damage × this on top of the difficulty option (arcade curve:
  // later stages field tougher tiers, so the multiplier falls as base damage rises). See src/game/Settings.js.
  tuning: { enemyDamage: 0.6 },
  screens: [
    { x: [-3, 16], waves: [
      { delay: 30, spawns: [{ type: 'marauder', side: 'right', z: 0.8, tier: 'straw' }, { type: 'marauder', side: 'right', z: -1.0, tier: 'straw', delay: 40 }, { type: 'marauder', side: 'left', z: 1.4, tier: 'straw', delay: 70, coop: true }] },
      // first pot thief: runs in from behind, kick him for magic
      { spawns: [{ type: 'thief', side: 'left', z: 1.5, tier: 'blue' }, { type: 'marauder', side: 'right', z: -0.4, tier: 'straw', delay: 40 }, { type: 'marauder', side: 'right', z: 1.0, tier: 'rust', delay: 90 }] },
      { spawns: [{ type: 'marauder', side: 'left', z: -1.2, tier: 'straw' }, { type: 'marauder', side: 'right', z: 0.6, tier: 'rust', delay: 30 }, { type: 'marauder', side: 'right', z: -1.6, tier: 'straw', delay: 60, coop: true }] },
    ] },
    { x: [16, 36], waves: [
      // BEAST ENCOUNTER: a raider on a Cluckhorn charges in — knock him off and take the beast
      { delay: 20, spawns: [{ mount: 'cluckhorn', side: 'right', z: 0.4, opts: { rider: 'marauder', riderOpts: { tier: 'rust' } } }, { type: 'marauder', side: 'left', z: -1.2, tier: 'straw', delay: 60 }, { type: 'marauder', side: 'right', z: 1.6, tier: 'straw', delay: 120, coop: true }] },
      { spawns: [{ type: 'marauder', side: 'right', z: 1.4, tier: 'rust' }, { type: 'marauder', side: 'right', z: -1.2, tier: 'straw', delay: 20 }, { type: 'marauder', side: 'left', z: 0, tier: 'rust', delay: 60 }, { type: 'thief', side: 'left', z: -1.8, tier: 'green', delay: 100 }] },
    ] },
    { x: [36, 56], waves: [
      { spawns: [{ type: 'marauder', side: 'right', z: 0.6, tier: 'rust' }, { type: 'marauder', side: 'left', z: -1.0, tier: 'violet', delay: 40 }, { type: 'marauder', side: 'right', z: -1.8, tier: 'straw', delay: 80, coop: true }] },
      { spawns: [{ type: 'marauder', side: 'right', z: 1.0, tier: 'iron', elite: 1 }, { type: 'marauder', side: 'right', z: -1.4, tier: 'rust', delay: 30 }, { type: 'thief', side: 'left', z: 1.8, tier: 'blue', delay: 70 }, { type: 'marauder', side: 'left', z: 0.2, tier: 'violet', delay: 90, coop: true }] },
    ] },
  ],
  next: 'bonus',
};
