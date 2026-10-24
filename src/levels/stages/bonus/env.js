// Thieves' Night camp — environment build: a firelit clearing under the stars, ringed by black pines (r10: authored props — see geo.js/tex.js/campfire.js).
// Value planes (back → front): starry sky + moon · far ridge silhouette · black pine ring (cool moon rim) · tents +
// tethered beasts (warm fire-lit fronts) · the belt: bedrolls, log seat, stash, the campfire (the brightest value) ·
// near-camera fern silhouettes. All props = 2 merged atlas-textured meshes + 7 instanced conifer sets (low draw cost).
import * as THREE from 'three';
import { createAmbient } from '../../../render/particles.js';
import { createGrass } from '../../../render/foliage.js';
import { Geo, M, rngFrom, tent, bedroll, fireRing, logSeat, potStash, tripod, post, stump, crate, sack, conifer, bush, pot, firewood } from './geo.js';
import { buildCampfire } from './campfire.js';
import { buildCampAtlas, campMaterial } from './tex.js';

/** Camp anchors (world metres) shared by the camp script and the ending vignettes. */
export const CAMP = {
  fire: { x: 0, z: -0.7 },
  beds: [{ x: -2.55, z: 0.55, facing: 1 }, { x: 2.55, z: 0.55, facing: -1 }, { x: 1.3, z: -2.05, facing: -1 }],
  stash: { x: -4.0, z: 1.0 },
  posts: [{ x: 6.7, z: -3.5 }, { x: -7.0, z: -3.8 }],
  seat: { x: -1.3, z: -2.25 },
};

/** Camp ground options (shared with bonus.js prefetch(), which pre-generates its textures during the tally). */
export const CAMP_GROUND = { x0: -60, x1: 60, z0: -60, z1: 14, colorA: '#0a0907', colorB: '#221c12', scale: 7, seed: 41, repeat: 0.16, normalStrength: 0.55, rough: 1 };

export function buildCampEnv(ctx, { quiet = false } = {}) {
  const { THREE: T = THREE, group, kit, game } = ctx;
  const q = ctx.quality || {};
  const low = q.name === 'low';
  const rng = rngFrom(4242);

  // ---- ground: dark loam with a trampled, ash-grey clearing (the fire light does the rest)
  kit.ground(ctx, CAMP_GROUND);


  buildCampAtlas();   // canvas atlas (bark, wool, rock, iron, needles …) — once per session
  // ---- props (one merged mesh; DoubleSide because the canvas/blankets are single sheets)
  const P = new Geo();
  tent(P, M(-4.8, 0, -5.6, -Math.PI / 2 + 0.42), { seed: 1 });
  tent(P, M(4.2, 0, -6.0, -Math.PI / 2 - 0.4), { seed: 2, L: 3.2, W: 2.7, H: 1.95, tint: '#6a7a8a' });
  tent(P, M(-11.0, 0, -7.6, -Math.PI / 2 + 0.7), { seed: 3, L: 2.6, H: 1.6 });
  CAMP.beds.forEach((bd, i) => bedroll(P, M(bd.x, 0, bd.z, bd.facing > 0 ? 0 : Math.PI), { color: ['#6a2420', '#23405e', '#3e5a2a'][i], stripe: ['#c8a060', '#b0b8c8', '#c89a50'][i], seed: 3 + i, cloth: i === 1 ? 'quilt' : 'wool' }));
  fireRing(P, M(CAMP.fire.x, 0, CAMP.fire.z));
  logSeat(P, M(CAMP.seat.x, 0, CAMP.seat.z, 0.22), { L: 2.3 });
  logSeat(P, M(-5.2, 0, -2.4, -0.9), { L: 1.6, r: 0.17, seed: 8 });
  potStash(P, M(CAMP.stash.x, 0, CAMP.stash.z, 0.5));
  for (const p of CAMP.posts) post(P, M(p.x, 0, p.z));
  stump(P, M(5.4, 0, -2.9), { withAxe: true }); stump(P, M(-9.4, 0, -1.9), { r: 0.4, h: 0.36, seed: 3 });
  crate(P, M(-3.0, 0, -4.4, 0.4)); crate(P, M(-2.45, 0, -4.1, -0.2), { s: 0.4 }); crate(P, M(-2.8, 0.5, -4.3, 0.9), { s: 0.36 });
  sack(P, M(5.2, 0, -4.5)); sack(P, M(5.7, 0, -4.2, 1), { h: 0.45, seed: 5 }); sack(P, M(-4.3, 0, 1.55, 0.3), { h: 0.4, seed: 7, tie: false });
  pot(P, M(4.45, 0, -2.6, 0.2), { h: 0.3, seed: 9 });
  // foreground: a fallen log + stones on the near edge (dark value plane framing the belt)
  logSeat(P, M(-5.0, 0, 3.5, 0.15), { L: 2.6, r: 0.24, seed: 13 });
  stump(P, M(5.3, 0, 3.8), { r: 0.36, h: 0.3, seed: 14 });
  // firewood pile (split quarters + rounds, staked) by the right bedroll
  firewood(P, M(4.4, 0, -1.6, 0.04), { seed: 20 });
  const propMat = campMaterial({ side: T.DoubleSide, gain: 2.0 });
  const props = new T.Mesh(P.build(), propMat); props.castShadow = true; props.receiveShadow = true; props.name = 'camp_props'; group.add(props);

  // the cook tripod + iron pot is its own mesh: it softens (see-through) when a fighter overlaps it on screen (r9)
  const TP = new Geo(); tripod(TP, M(CAMP.fire.x, 0, CAMP.fire.z, 0.4));
  const tripodMat = campMaterial({ side: T.DoubleSide, transparent: true, gain: 2.0, rough: 0.7 });
  const tripodMesh = new T.Mesh(TP.build(), tripodMat); tripodMesh.castShadow = true; tripodMesh.receiveShadow = true; tripodMesh.name = 'camp_tripod'; group.add(tripodMesh);

  // ---- conifer ring (instanced, 4 species + a snag) + far black ridge + near fern silhouettes
  const treeMat = campMaterial({ alphaTest: 0.42, side: T.DoubleSide, gain: 2.1, ns: 0.3, rough: 0.95 });
  const kinds = { spruce: [{ variant: 'spruce', seed: 3 }], fir: [{ variant: 'fir', seed: 5 }], pine: [{ variant: 'pine', seed: 7 }], young: [{ variant: 'young', seed: 9 }], snag: [{ variant: 'snag', seed: 11 }],
    spruceFar: [{ variant: 'spruce', seed: 13, lod: 1 }], firFar: [{ variant: 'fir', seed: 15, lod: 1 }] };
  const sets = {}; for (const k of Object.keys(kinds)) sets[k] = [];
  const pick = (r) => (r < 0.36 ? 'spruce' : r < 0.64 ? 'fir' : r < 0.86 ? 'pine' : r < 0.94 ? 'young' : 'snag');
  for (let i = 0; i < 44; i++) {
    const t = i / 43, a = Math.PI * (0.02 + 0.96 * t);
    const r = 13 + rng() * 5 + (Math.abs(t - 0.5) < 0.2 ? 2 : 0);
    const x = Math.cos(a) * -r * 1.9, z = -Math.sin(a) * r * 0.62 - 4.5 - rng() * 3;
    if (z > -7 && Math.abs(x) < 12) continue;
    const kk = pick(rng()); sets[kk].push({ x, z, s: (kk === 'young' ? 1.0 : 0.8) + rng() * 0.75, yaw: rng() * 6 });
  }
  for (let i = 0; i < 30; i++) sets[i % 3 ? 'spruceFar' : 'firFar'].push({ x: -34 + i * 2.35 + (rng() - 0.5) * 1.6, z: -24 - rng() * 8, s: 1.1 + rng() * 0.8, yaw: rng() * 6 });
  for (const [x, z, s] of [[-13.5, -3.2, 0.9], [14.5, -3.6, 1.0], [-17, 0.5, 1.2], [18, 1.5, 1.15]]) sets[rng() < 0.5 ? 'spruce' : 'fir'].push({ x, z, s, yaw: rng() * 6 });
  const m4 = new T.Matrix4();
  for (const [name, list] of Object.entries(sets)) {
    if (!list.length) continue;
    const g = new Geo(); for (const o of kinds[name]) conifer(g, null, o);
    const im = new T.InstancedMesh(g.build(), treeMat, list.length);
    list.forEach((tr, i) => { m4.copy(M(tr.x, 0, tr.z, tr.yaw, { s: tr.s })); im.setMatrixAt(i, m4); });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = false; im.receiveShadow = true; im.name = 'camp_trees_' + name; group.add(im);
  }
  kit.hills(ctx, { x0: -120, x1: 120, z: -70, height: 16, jag: 0.6, color: '#06080e', seed: 5, step: 4 });

  const B = new Geo();
  for (const [x, z, r, h, s] of [[-8.6, 3.3, 1.3, 0.9, 1], [-11.2, 3.8, 1.2, 1.0, 2], [8.4, 3.4, 1.4, 0.95, 3], [11.4, 3.0, 1.2, 1.1, 4], [-6.6, 3.7, 1.1, 0.7, 5], [6.9, 3.6, 1.0, 0.65, 6], [-3.6, 4.3, 0.7, 0.4, 11], [3.2, 4.4, 0.6, 0.35, 12]]) bush(B, M(x, 0, z), { r, h, seed: s });
  for (const [x, z, r, h, s] of [[-7.6, -4.6, 1.0, 0.8, 7], [9.8, -5.0, 1.1, 0.9, 8], [-1.2, -7.5, 1.3, 0.9, 9], [12.4, -2.4, 0.9, 0.8, 10]]) bush(B, M(x, 0, z), { r, h, seed: s });
  const bushes = new T.Mesh(B.build(), treeMat); bushes.name = 'camp_bushes'; bushes.receiveShadow = true; group.add(bushes);

  // ---- grass around the clearing edge (not on the trampled ground)
  const fx0 = CAMP.fire.x, fz0 = CAMP.fire.z;
  const dens = (x, z) => { const d = Math.hypot((x - fx0) / 1.35, (z - fz0) / 0.75); return d < 6.5 ? 0 : Math.min(1, (d - 6.5) / 2.5); };
  try {
    group.add(createGrass({ next: rng, range: (a, b) => a + (b - a) * rng(), int: (a, b) => Math.floor(a + (b - a + 1) * rng()) }, { x0: -22, x1: 22, z0: -12, z1: 6, density: 2.4, densityFn: dens, y: () => 0, quality: q, height: [0.3, 0.7],
      base: '#050706', tip: '#1e2a1c', dry: '#2e2e20', tints: ['#ffffff', '#d8dcd0', '#c0c8b8'] }));
  } catch (e) { console.warn('[bonus] grass', e); }

  // ---- the campfire: layered flame tongues, coal bed, smoke column, embers, glow + the warm key lights (campfire.js)
  const cf = buildCampfire({ group, quality: q, at: CAMP.fire });
  const fire = cf.fire;

  // drifting sparks / motes around the camera
  const motes = createAmbient({ kind: 'ember', count: low ? 60 : 120, box: [20, 5, 10], offset: [0, 0.3, -2], quality: q, velocity: [0.15, 0.35, 0.02], size: 0.08, intensity: 3.5 });
  group.add(motes.object);

  let fireScale = 1, soft = 0;
  const update = (dt, t) => {
    const fl = 0.8 + 0.12 * Math.sin(t * 9.1) * Math.sin(t * 5.3 + 1) + 0.08 * Math.sin(t * 23.7);
    cf.update(fl, fireScale);
    const cam = game.cameraRig;
    if (cam && cam.camera) motes.update(cam.camera, cam.focus, game.renderer ? game.renderer.height : 900);
  };
  update(0, 0);
  return {
    update, fire, anchors: CAMP,
    /** 0..1: how far the flare, heat shimmer and cauldron fade back because a fighter overlaps the fire on screen. */
    setSoft(k) { soft = k; cf.kFade.value = 1 - 0.6 * k; tripodMat.opacity = 1 - 0.75 * k; },
    get soft() { return soft; },
    /** Dim/raise the fire (0..1.5): the quiet camp banks it low. */
    setFire(k) { fireScale = k; },
    dispose() { /* meshes/materials die with envGroup */ },
  };
}
