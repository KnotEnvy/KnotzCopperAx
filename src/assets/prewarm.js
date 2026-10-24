// Per-stage PREWARM (chapter1-integration): kills the first-use hitches (shader/program links, GLB parse, texture +
// geometry uploads, audio pre-render) that used to drop every stage to 1–12 fps in its first seconds, on the first
// enemy of each type, the first spell and the boss entrance.
//
//   prefetchStage(game, stageId)   start during the map interlude (Flow.map): loads the stage module, every enemy
//                                  type/tier its wave script + boss use, beasts, props and pickups, and builds one
//                                  off-world "warm actor" of each (spawnEnemy/mounts.spawn with add:false).
//   await prewarmStage(game)       in startStage after the env + heroes exist, BEHIND A BLACK CURTAIN: warm actors are
//                                  placed in view, hidden pools (VFX, spell rock fields…) are forced visible, the whole
//                                  scene is compiled (parallel shader compile; waitPrograms waits while programs keep
//                                  finishing — no fixed cap, slow-compile drivers included), then two real frames
//                                  go through the full post chain (shadow-map programs, texture/geometry uploads,
//                                  post passes). Everything is restored, the warm actors are dropped (their materials
//                                  are never disposed, so the linked programs stay cached for the real spawns), and
//                                  the curtain fades out. Also waits (capped) for the audio pre-render to finish.
//   warmCurtain(game, on)          the fade-from-black curtain (also usable by other transitions).
// URL &prewarm=0 disables it (A/B perf probes). Every step is capped and error-tolerant: a failed warm never blocks
// a stage.
import * as THREE from 'three';
import { registries } from '../core/registries.js';
import { reportError } from '../core/log.js';
import { safeImport } from '../core/safeImport.js';
import { applyCharacterLook } from '../render/characterLook.js';

/** What each boss encounter spawns (bosses agent scripts, src/enemies/bosses/*.js). tiers:'all' = every tier. */
const BOSS_WARM = {
  brute_brothers: { enemies: [['boss_brute', 'all'], ['ogre', 'all']], look: ['boss_brute'] },   // look: bossLook() types
  captains: { enemies: [['boss_captain', 'all', true], ['knight', 'all', true]] },
  // maps: boss-only textures built per encounter (MAP_WARM below) — built at map time, uploaded + drawn under the curtain
  // clipSets: [type, tier, character] — a boss body on shared art that switches to its own clip set at the encounter
  // (bosses/_stance.js useClipSet): those clips are baked on the warm body's rig under the curtain, not at the spawn
  wyrm_rider: { enemies: [['viper', 'all']], mounts: ['cinderwyrm'], maps: ['wyrm'], clipSets: [['viper', 'captain', 'boss_wyrm_rider']] },
  varkhul: { enemies: [['boss_varkhul']], gltf: ['boss_varkhul_ball'] },
  // fx: exported material builders of bosses/_fx.js that the encounter first calls mid-fight (warmed + drawn under the curtain)
  morvane: { enemies: [['boss_morvane']], fx: ['scaleMat'] },
};

/** perf-1650 C2: boss looks that make their own textures at the encounter (e.g. bosses/_wyrmLook.js recolours a copy of the
 *  rider + wyrm atlases: two 1024² CanvasTextures whose mid-entrance upload stalled the S3 boss arena 2 × ~435 ms). Each
 *  entry resolves fn(warmActors) → Promise<Texture[]> using the SAME shared cache as the live encounter. */
const MAP_WARM = {
  wyrm: () => import('../enemies/bosses/_wyrmLook.js').then((M) => M.wyrmLookMaps),
};

const stageId = (s) => { const v = String(s ?? '1'); return /^\d+$/.test(v) ? `stage${v}` : v; };
const cap = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
const enemiesMod = () => safeImport(() => import('../enemies/spawnEnemy.js'), 'enemies/spawnEnemy');

const cache = new Map(); // stage id → Promise<{ id, actors: Actor[], ms }>

/** Collect the warm list for a stage module: [{ type, tier, elite }], mounts, extra GLB ids. */
export async function warmList(game, mod) {
  const enemies = new Map(), mounts = new Set(), gltf = new Set(), looks = new Set(), fx = new Set(), maps = new Set(), clipSets = [];
  const addEnemy = (type, tier, elite) => { const k = `${type}|${tier || ''}|${elite ? 1 : ''}`; if (!enemies.has(k)) enemies.set(k, { type, tier, elite }); };
  const screens = mod.screens || [];
  for (const s of screens) for (const w of s.waves || []) for (const sp of w.spawns || []) {
    if (sp.type) addEnemy(sp.type, sp.tier, sp.elite);
    if (sp.mount) mounts.add(sp.mount);
    if (sp.mount && sp.opts && typeof sp.opts.rider === 'string') addEnemy(sp.opts.rider, sp.opts.riderOpts && sp.opts.riderOpts.tier);
  }
  const kit = await safeImport(() => import('../enemies/bosses/_hook.js'), 'bosses/_hook');
  for (let i = 0; kit && i < screens.length; i++) {
    let hook = null; try { hook = kit.resolveHook(game, mod, i); } catch (e) { /* no boss */ }
    const b = hook && BOSS_WARM[hook.id];
    if (!b) continue;
    for (const [type, tiers, elite] of b.enemies || []) {
      if (!registries.enemies.has(type)) continue;
      if (tiers !== 'all') { addEnemy(type, tiers); continue; }
      const def = await registries.enemies.load(type);
      addEnemy(type, undefined, elite);
      for (const t of Object.keys((def && def.tiers) || {})) addEnemy(type, t, elite);
    }
    for (const m of b.mounts || []) mounts.add(m);
    for (const g of b.gltf || []) gltf.add(g);
    for (const t of b.look || []) looks.add(t);
    for (const k of b.fx || []) fx.add(k);
    for (const k of b.maps || []) maps.add(k);
    for (const c of b.clipSets || []) clipSets.push(c);
  }
  return { enemies: [...enemies.values()], mounts: [...mounts], gltf: [...gltf], looks: [...looks], fx: [...fx], maps: [...maps], clipSets };
}

async function build(game, id) {
  const t0 = performance.now();
  const mod = await registries.stages.load(id);
  if (!mod) return { id, actors: [], ms: 0 };
  if (mod.prefetch) { try { await mod.prefetch(game); } catch (e) { reportError('prewarm.prefetch', e); } }
  const list = await warmList(game, mod);
  const E = await enemiesMod();
  const actors = [];
  const jobs = [];
  if (E) for (const e of list.enemies) {
    jobs.push(E.spawnEnemy(game, e.type, { x: 0, z: 0, facing: 1, tier: e.tier, elite: e.elite, add: false })
      .then((a) => { if (a) actors.push(a); }).catch((err) => reportError('prewarm.enemy', err)));
  }
  if (game.mounts && game.mounts.spawn) for (const m of list.mounts) {
    jobs.push(game.mounts.spawn(m, { x: 0, z: 0, add: false }).then((a) => {
      if (!a) return;
      if (game.mounts.mounts && game.mounts.mounts.delete) game.mounts.mounts.delete(a);
      actors.push(a);
    }).catch((err) => reportError('prewarm.mount', err)));
  }
  if (game.assets) for (const g of list.gltf) jobs.push(game.assets.instance(g).then((r) => { if (r && r.root) actors.push({ view: r.root, kind: 'prop' }); }).catch(() => {}));
  // pickups (food / pots / gold) and breakable props dropped by waves
  for (const pid of registries.pickups.ids()) {
    jobs.push(registries.pickups.load(pid).then((def) => { const m = def && def.build ? def.build({ game }) : null; if (m) actors.push({ view: m, kind: 'prop' }); }).catch(() => {}));
  }
  await cap(Promise.all(jobs), 45000);
  // Bake every clip each warm rig can play while the map is up (idle-time slices), not on the first swing/hit-react
  // mid-fight: clipBaker solves IK per key at bake time (2–15 ms per clip, 40–70 clips per rig).
  // boss clip sets (BOSS_WARM clipSets): pseudo animators = the warm body's rig + the boss character id
  const bakeExtra = [];
  for (const [type, tier, character] of list.clipSets || []) {
    const a = actors.find((x) => x.typeId === type && (x.tier || null) === (tier || null) && x.animator && x.animator.rigInfo);
    if (a) bakeExtra.push({ animator: { rigInfo: a.animator.rigInfo, rig: a.animator.rig, character } });
  }
  const bake = prebakeClips(game, [...actors, ...bakeExtra], { idle: true });
  // boss-only textures (MAP_WARM): start building them now too (CPU work in ≤ 5 ms slices while the map is up)
  const maps = list.maps && list.maps.length
    ? Promise.all(list.maps.map((k) => (MAP_WARM[k] ? MAP_WARM[k]().then((fn) => fn(actors)) : Promise.resolve([])).catch((e) => { reportError('prewarm.maps', e); return []; }))).then((r) => r.flat())
    : null;
  return { id, actors, ms: Math.round(performance.now() - t0), list, bake, maps, bakeExtra };
}

/** Bake all clips for the rigs of `actors` (+ the live heroes) into the ClipLibrary cache, in ≤ 8 ms slices. */
export function prebakeClips(game, actors, { idle = false, sliceMs = 8 } = {}) {
  const lib = game.anim;
  if (!lib || !lib.clip || !lib.names) return Promise.resolve({ baked: 0, ms: 0 });
  const jobs = [], rigs = new Set();
  const all = [...actors, ...(game.world ? game.world.query({ kind: 'hero', alive: false }) : [])];
  for (const a of all) {
    const an = a && a.animator; if (!an || !an.rigInfo) continue;
    const k = `${an.rigInfo.key}|${an.rig}|${an.character || ''}`; if (rigs.has(k)) continue; rigs.add(k);
    let names = []; try { names = lib.names({ rig: an.rig, character: an.character }); } catch (e) { /* none */ }
    for (const n of names) jobs.push([n, an]);
  }
  const t0 = performance.now(); let i = 0, work = 0;
  const slice = (deadline) => {
    const s = performance.now();
    while (i < jobs.length) {
      const [n, an] = jobs[i++];
      try { lib.clip(n, an.rigInfo, { rig: an.rig, character: an.character }); } catch (e) { /* reported by the lib */ }
      const el = performance.now() - s;
      if (deadline && deadline.timeRemaining ? deadline.timeRemaining() < 1 : el > sliceMs) break;
    }
    work += performance.now() - s;
    return i >= jobs.length;
  };
  return new Promise((resolve) => {
    const done = () => resolve({ baked: jobs.length, rigs: rigs.size, ms: Math.round(performance.now() - t0), workMs: Math.round(work) });
    const next = () => {
      if (idle && typeof requestIdleCallback !== 'undefined') requestIdleCallback((d) => (slice(d) ? done() : next()), { timeout: 200 });
      else setTimeout(() => (slice(null) ? done() : next()), 0);
    };
    next();
  });
}

/** Kick off loading + warm-actor building for a stage (idempotent). */
export function prefetchStage(game, stage) {
  if (game.params && game.params.get && game.params.get('prewarm') === '0') return Promise.resolve(null);
  const id = stageId(stage);
  if (!cache.has(id)) cache.set(id, build(game, id).catch((e) => { reportError('prewarm.build', e); return { id, actors: [], ms: 0 }; }));
  return cache.get(id);
}

// ------------------------------------------------------------------ curtain
let curtainEl = null, curtainFailsafe = 0;
export function warmCurtain(game, on, fadeMs = 380) {
  if (typeof document === 'undefined') return;
  if (game && game.params && game.params.get && game.params.get('curtain') === '0') return; // A/B probes
  if (!curtainEl) {
    curtainEl = document.createElement('div');
    curtainEl.id = 'kca-warm-curtain';
    curtainEl.style.cssText = 'position:fixed;inset:0;background:#050302;pointer-events:none;z-index:40;opacity:0;transition:opacity 0ms linear';
    document.body.appendChild(curtainEl);
  }
  clearTimeout(curtainFailsafe);
  if (on) {
    // 0.985, not 1: a fully opaque layer over the canvas lets the compositor occlusion-cull the WebGL layer, and the
    // warm frames then land as one big catch-up stall the moment the curtain lifts (measured 1.2 s vs ~0.4 s).
    curtainEl.style.transition = 'opacity 0ms linear'; curtainEl.style.opacity = '0.985'; curtainEl.style.display = 'block';
    curtainFailsafe = setTimeout(() => warmCurtain(game, false), 60000); // never leave the screen black on a failed load
  } else {
    curtainEl.style.transition = `opacity ${fadeMs}ms ease-out`;
    requestAnimationFrame(() => { curtainEl.style.opacity = '0'; });
  }
}

/** perf C1: the prewarm is still making progress — push the curtain's 60 s failsafe back (it must only fire on a stuck load). */
function keepCurtain(game) {
  if (!curtainEl || curtainEl.style.opacity === '0') return;
  clearTimeout(curtainFailsafe);
  curtainFailsafe = setTimeout(() => warmCurtain(game, false), 60000);
}

/**
 * perf C1: wait until every material's program has finished compiling (KHR_parallel_shader_compile; three's
 * program.isReady()), for as long as programs KEEP finishing. compileAsync behind a fixed 30 s cap was not enough where
 * shader compiles are slow: on the WSL2 dev box (ANGLE → OpenGL → Mesa d3d12) one GPU process compiles ~0.5 s per program,
 * serially; a stage links 60–120 programs, and with a second page compiling at the same time stage 5's warm hit both caps
 * (58.7 s), started the stage incomplete and linked 10 programs after the boss appeared. Gives up only after `stallMs`
 * with no program finishing, or `maxMs` in total (a stuck driver must never hold a stage). Re-arms the curtain failsafe
 * while it progresses.
 */
async function waitPrograms(game, mats, { stallMs = 15000, maxMs = 150000 } = {}) {
  const W = game.renderer.webgl, t0 = performance.now(), left = new Set(mats);
  let last = t0, n = left.size;
  for (;;) {
    for (const m of left) {
      let p; try { p = W.properties.get(m).currentProgram; } catch (e) { p = undefined; }
      if (p === undefined || p.isReady()) left.delete(m);
    }
    const now = performance.now();
    if (!left.size || now - t0 > maxMs) break;
    if (left.size < n) { n = left.size; last = now; keepCurtain(game); }
    else if (now - last > stallMs) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return { ms: Math.round(performance.now() - t0), materials: mats.size, left: left.size };
}

/** Compile + upload everything the current stage will draw. Resolves when the stage may start. */
export async function prewarmStage(game, { stage, card = null } = {}) {
  const g = game;
  const R = g.renderer;
  if ((g.params && g.params.get && g.params.get('prewarm') === '0') || !R || !R.camera) { warmCurtain(g, false, 200); return null; }
  const t0 = performance.now();
  const id = stageId(stage || (g.levels && g.levels.stage && g.levels.stage.id));
  const rep = { id, actors: 0, forced: 0, compileMs: 0, frames: 0, audioMs: 0, totalMs: 0 };
  warmCurtain(g, true);
  g.warming = true; // renderer DRS ignores these frames
  // perf-1650 r2: no LIVE frames from here until the controlled warm frames: the guard is switched off below, and a live
  // draw of any program still linking in the background blocks the main thread in getProgramParameter until the link
  // finishes (traced 3–7.7 s longtasks under the curtain at the camp / stage 2 on a hot laptop). Renderer.render skips
  // frames while g.warmHold is set; compileAsync below waits (non-blocking) for every link before it is cleared.
  g.warmHold = true;
  // perf-1650: the program guard (render/programGuard.js) must not hide warm objects whose programs are still linking
  // — the two real frames below exist precisely to DRAW everything once (ANGLE builds its D3D shader variants and
  // uploads textures at the first draw, not at compile), so they would otherwise be skipped and paid for mid-fight.
  const guard = R.guard, guardWas = guard ? guard.enabled : false;
  if (guard) { guard.enabled = false; if (guard.releaseAll) guard.releaseAll(); }
  const group = new THREE.Group(); group.name = 'prewarm';
  const forced = [], unculled = [], bumped = [];
  try {
    // Brann's earth spells draw from pooled rock fields created lazily on the first cast: create them now.
    if (g.vfx && g.world.query({ kind: 'hero', alive: false }).some((h) => h.typeId === 'brann')) {
      try { const M = await import('../magic/meshes.js'); for (const k of ['spike', 'column', 'boulder']) M.rockField(g.vfx, k); } catch (e) { reportError('prewarm.rocks', e); }
    }
    // Spell cut-in panel mesh joins the scene on its first show(): attach it now (hidden; forced visible below).
    try { if (g.magic && g.magic.cutIn && g.magic.cutIn._attach) g.magic.cutIn._attach(); } catch (e) { /* optional */ }
    const pre = await cap(prefetchStage(g, id), 45000);
    const actors = (pre && pre.actors) || [];
    // finish the clip prebake (started at map time) + the heroes' rigs, in fast slices behind the curtain
    try { if (pre && pre.bake) await cap(pre.bake, 20000); rep.bake = await cap(prebakeClips(g, [...actors, ...((pre && pre.bakeExtra) || [])], { sliceMs: 30 }), 20000); } catch (e) { reportError('prewarm.bake', e); }
    // boss-only textures (MAP_WARM, started at map time): upload them now and draw each once in the warm frames below
    // (tiny sprites, the warm name tag's program), so the encounter swaps in GPU-resident textures instead of uploading
    // 1024² atlases + mips mid-entrance
    let bossMaps = [];
    if (pre && pre.maps) {
      const m0 = performance.now();
      try { bossMaps = (await cap(pre.maps, 20000)) || []; } catch (e) { reportError('prewarm.maps', e); }
      for (const t of bossMaps) { try { R.webgl.initTexture(t); } catch (e) { reportError('prewarm.mapUpload', e); } }
      rep.bossMaps = { n: bossMaps.length, ms: Math.round(performance.now() - m0), px: bossMaps.map((t) => (t.image ? t.image.width + 'x' + t.image.height : '?')).join(' ') };
    }
    // Warm actors in view around the camera focus (inside the shadow camera too).
    const f = g.cameraRig ? g.cameraRig.focus : { x: 0, z: 0 };
    actors.forEach((a, i) => {
      const v = a.view; if (!v) return;
      const k = i - (actors.length - 1) / 2;
      v.position.set(f.x + k * 0.9, 0, (f.z || 0) + ((i % 3) - 1) * 0.6);
      v.visible = true;
      group.add(v);
    });
    rep.actors = actors.length;
    rep.buildMs = pre && pre.ms;
    rep.warmIds = actors.map((a) => (a.typeId || (a.def && a.def.id) || a.kind) + (a.tier ? ':' + a.tier : '')).join(' ');
    // A cut-in that fires in the same frame a new foe first appears draws it before the look/hit-flash patches are
    // applied (MagicSystem.render runs before Renderer.render): link that unpatched inset variant for each warm actor.
    const ciRT = g.magic && g.magic.cutIn && g.magic.cutIn.rt;
    const pending = new Set(); // perf C1: every material compiled below; waitPrograms() waits for all of them at once
    if (ciRT && actors.length) {
      const vg0 = g.vfx && g.vfx.group, vis0 = vg0 ? vg0.visible : true, prev0 = R.webgl.getRenderTarget();
      R.scene.add(group); group.updateMatrixWorld(true);
      // compile() links the unpatched inset variants now (parallel compile); their readiness is awaited with the rest
      try { if (vg0) vg0.visible = false; R.webgl.setRenderTarget(ciRT); await cap(waitPrograms(g, R.webgl.compile(group, R.camera, R.scene), { stallMs: 4000, maxMs: 20000 }), 25000); }
      catch (e) { /* optional */ } finally { R.webgl.setRenderTarget(prev0); if (vg0) vg0.visible = vis0; R.scene.remove(group); }
    }
    // Mounts are never patched by lookForActors (they have no modelRoot): a fresh mount draws with the PLAIN standard program
    // until something patches it (the boss wyrm: bossRim, only after its rider has finished spawning = several frames
    // later; regular mounts stay plain). That program was linked above (unpatched inset variant) but never DRAWN, and ANGLE
    // builds a program's D3D executables at its first draw: 0.6–2.6 s stall at the Wyrm Rider's first frame (bench S3
    // boss start; &fd=1 first-draw log: "M_enemy_thief_blue … SkinnedMesh:mount_cinderwyrm_mesh"). Draw each warm mount
    // once here, still unpatched, into the scene target (the patched variant is drawn by the warm frames below).
    const mountsW = actors.filter((x) => x.kind === 'mount' && x.view);
    if (mountsW.length) {
      const tgtM = R.post && R.postEnabled && R.post.composer ? (R.post.composer.inputBuffer || null) : null;
      const prevM = R.webgl.getRenderTarget(), hid = [];
      R.scene.add(group); group.updateMatrixWorld(true);
      for (const x of actors) if (!mountsW.includes(x) && x.view && x.view.visible) { hid.push(x.view); x.view.visible = false; }
      for (const x of mountsW) x.view.traverse((o) => { o.frustumCulled = false; if (!o.visible && (o.isMesh || o.isSkinnedMesh) && !(o.userData && o.userData.noWarm)) o.visible = true; });
      try { R.webgl.setRenderTarget(tgtM); R.webgl.render(R.scene, R.camera); rep.mountUnpatched = mountsW.length; }
      catch (e) { reportError('prewarm.mountDraw', e); }
      finally { R.webgl.setRenderTarget(prevM); for (const v of hid) v.visible = true; R.scene.remove(group); }
    }
    // Hit-flash shader patch (vfx/HitFlash.scan patches world actors on first render): patch the warm actors too,
    // or every enemy type links a second program on its first frame in the world.
    const hf = g.vfx && g.vfx.hitFlash;
    if (hf && hf.scan && g.world && g.world.actors) {
      const W = g.world.actors, n0 = W.length, real = actors.filter((a) => a.modelRoot);
      try { W.push(...real); hf.scan(); } catch (e) { reportError('prewarm.hitflash', e); } finally { W.length = n0; }
    }
    // …then the character light rig (same order as a live frame: HitFlash.scan runs before lookForActors).
    for (const a of actors) { try { if (a.kind !== 'prop' && (a.modelRoot || a.view)) applyCharacterLook(a.modelRoot || a.view, { strength: a.kind === 'mount' ? 0.9 : 1 }); } catch (e) { /* cosmetic */ } }
    // encounter-only boss look (bosses/_look.js bossLook: '|bossLook' program-key tag) on the warm bodies of those types
    const looks = pre && pre.list && pre.list.looks;
    if (looks && looks.length) { try { const LK = await import('../enemies/bosses/_look.js'); for (const a of actors) if (looks.includes(a.typeId) && (a.modelRoot || a.view)) LK.bossLook(a.modelRoot || a.view); } catch (e) { reportError('prewarm.bossLook', e); } }
    // three's plain shadow-depth program: a stage whose static casters are all instanced / skinned (own depth
    // materials, Renderer.assignCasterDepth) never linked it, and the first plain caster (a boss prop) linked it
    // synchronously mid-intro (perfbench S5 boss: renderer.render 282 ms). One tiny plain caster in the warm set.
    try { const pc = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshBasicMaterial()); pc.castShadow = true; pc.position.set(f.x, 0.5, f.z || 0); pc.name = 'warmPlainCaster'; group.add(pc); } catch (e) { /* optional */ }
    // skinned shadow-depth variants (Renderer.assignCasterDepth's shared kca-depth-skinned material takes the caster
    // material's side: Front → BackSide pass, Double → DoubleSide): perfbench r3 S5 boss linked "depth{skinning}" for a
    // double-sided skinned caster mid-intro. One tiny 1-bone skinned caster per side.
    try {
      for (const side of [THREE.FrontSide, THREE.DoubleSide]) {
        const geo = new THREE.BoxGeometry(0.05, 0.05, 0.05), n = geo.attributes.position.count;
        geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
        geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
        const sm = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ side }));
        const bone = new THREE.Bone(); sm.add(bone); sm.bind(new THREE.Skeleton([bone]));
        sm.castShadow = true; sm.position.set(f.x, 0.5, f.z || 0); sm.name = 'warmSkinCaster'; group.add(sm);
      }
    } catch (e) { /* optional */ }
    // boss / elite name-tag sprite (Enemy.addNameTag: fogged SpriteMaterial, sRGB canvas map) is added at the boss
    // intro, after the prewarm → linked mid-intro (perfbench r3 S3 boss "sprite{useFog}"). One warm twin.
    try {
      const c = document.createElement('canvas'); c.width = c.height = 4;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
      s.position.set(f.x, 2, f.z || 0); s.scale.setScalar(0.01); s.renderOrder = 20; s.name = 'warmNameTag'; group.add(s);
      // …and one twin per boss-only texture (same program: sRGB canvas map) so each is also DRAWN once under the curtain
      for (const t of bossMaps) {
        const sb = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
        sb.position.set(f.x, 2, f.z || 0); sb.scale.setScalar(0.01); sb.renderOrder = 20; sb.name = 'warmBossMap'; group.add(sb);
      }
    } catch (e) { /* optional */ }
    // lazily created shared spell programs (emblems: first created by a spell mid-fight) — one invisible warm draw
    try { const EM = await import('../magic/emblems.js'); if (EM.warmMesh) { const em = EM.warmMesh(); em.position.set(f.x, 1, f.z || 0); group.add(em); } } catch (e) { reportError('prewarm.emblem', e); }
    // perf C1: boss FX materials built lazily mid-encounter (bosses/_fx.js scaleMat: Morvane's intro snake swarm and phase-2
    // serpent coils — two procedural canvas textures generated on the main thread and uploaded at the reveal beat; bench
    // S5 boss intro: a 133 ms frame). Build them now and draw one tiny caster with each (texture upload + first draw).
    const fxList = pre && pre.list && pre.list.fx;
    if (fxList && fxList.length) {
      try {
        const FX = await import('../enemies/bosses/_fx.js');
        for (const k of fxList) {
          if (typeof FX[k] !== 'function') continue;
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), FX[k]());
          m.castShadow = true; m.position.set(f.x, 0.5, f.z || 0); m.name = 'warmBossFx:' + k; group.add(m);
        }
        rep.bossFx = fxList.join(' ');
      } catch (e) { reportError('prewarm.bossFx', e); }
    }
    // boss-lock occluder fade (enemies/bosses/_occluders.js): the transparent clone variant of every env material that
    // can fade — linked at the boss it stalled 1.7–3.9 s in getProgramParameter (perfbench r3, S2 captains)
    try { const OC = await import('../enemies/bosses/_occluders.js'); if (OC.fadeWarmProxies) { const px = OC.fadeWarmProxies(g); for (const p of px) group.add(p); rep.fadeWarm = px.length; } } catch (e) { reportError('prewarm.fade', e); }
    R.scene.add(group);
    // Hidden pools (VFX, spell rock fields, cut-in panels…) compile only when first shown: show them for the warm.
    R.scene.traverse((o) => { if (!o.visible && (o.isMesh || o.isPoints || o.isLine || o.isSprite) && !o.userData.noWarm) { forced.push(o); o.visible = true; } });
    for (const o of forced) { let p = o.parent; while (p && p !== R.scene) { if (!p.visible) { forced.push(p); p.visible = true; } p = p.parent; } }
    rep.forced = forced.length;
    // Empty instanced pools (InstancedMesh.count = 0 / InstancedBufferGeometry.instanceCount = 0: vfx debris, particles,
    // shape fx…) issue NO draw call, so their programs — and ANGLE's D3D executables, built at the first DRAW — first build
    // at the first live hit / spell of the stage: the bench's first-draw log (&fd=1) listed vfx_debris, vfx_shape(_lit),
    // vfx_add and the instanced shadow-depth variant in EVERY stage = the 100–450 ms hitches at the first hits. Give every
    // pool one degenerate instance (zeroed attributes) for the warm frames; restored below.
    R.scene.traverse((o) => {
      if (o.userData && o.userData.noWarm) return;
      if (o.isInstancedMesh && o.count === 0) { bumped.push([o, 'count', 0]); o.count = 1; }
      else if ((o.isMesh || o.isPoints || o.isLine) && o.geometry && o.geometry.isInstancedBufferGeometry && o.geometry.instanceCount === 0) { bumped.push([o.geometry, 'instanceCount', 0]); o.geometry.instanceCount = 1; }
      // …and dynamic-geometry effects that start with drawRange.count = 0 (storm bolts, geysers: first draw at the first strike)
      else if ((o.isMesh || o.isPoints || o.isLine) && o.geometry && o.geometry.drawRange && o.geometry.drawRange.count === 0 && o.geometry.attributes && o.geometry.attributes.position && o.geometry.attributes.position.count >= 3) { bumped.push([o.geometry.drawRange, 'count', 0]); o.geometry.drawRange.count = 3; }
    });
    rep.pools = bumped.length;
    // the pools' own update() rewrites the count every sim tick (the awaits below let the game loop run): re-apply right before each warm draw
    const bumpPools = () => { for (const [t, k] of bumped) { try { t[k] = t.start !== undefined ? 3 : 1; /* drawRange {start,count} → one triangle; InstancedMesh.count / instanceCount → one instance */ } catch (e) { /* ignore */ } } };
    // draw everything in the warm frames even if off-camera (frustum culling would skip the very first draw)
    // …and the WHOLE stage, not just what the start camera sees: ANGLE/D3D11 builds a program's real shader
    // executables at its FIRST DRAW (per vertex layout / target), on the GPU main thread — a trace showed a 1.6 s
    // GPUTask + GetProgramiv stall ~10 s into stage 1 when an env piece first scrolled into view (or into the shadow
    // frustum). Two culling-free frames here pay that behind the curtain.
    R.scene.traverseVisible((o) => { if ((o.isMesh || o.isPoints || o.isSprite || o.isLine) && o.frustumCulled) { o.frustumCulled = false; unculled.push(o); } });
    for (const root of [group, ...forced]) root.traverse((o) => { if ((o.isMesh || o.isPoints || o.isSprite || o.isLine) && o.frustumCulled) { o.frustumCulled = false; unculled.push(o); } });
    group.updateMatrixWorld(true);
    const c0 = performance.now();
    // Compile for the variant that is actually drawn: the scene renders into PostFX's linear HDR buffer, not the
    // canvas (a null target would link sRGB-output programs that the game never uses).
    const prevRT = R.webgl.getRenderTarget();
    const tgt = R.post && R.postEnabled && R.post.composer ? (R.post.composer.inputBuffer || null) : null;
    // The T3+ spell cut-in (magic/CutIn.js) renders the scene again into its own MSAA half-float target.
    const cut = g.magic && g.magic.cutIn && g.magic.cutIn.rt ? g.magic.cutIn.rt : null;
    // CutIn hides the vfx group while it draws — that group holds the pooled vfx lights, so every lit material has a
    // second light-count variant for the inset: compile the whole scene in that state too (compile ignores frustum).
    const vgrp = g.vfx && g.vfx.group;
    // perf C1: link both targets' variants first (compile() only queues the parallel compiles), then wait for all of them
    // while they keep finishing (waitPrograms) — was compileAsync per target behind a fixed 30 s cap
    for (const t of [tgt, cut]) {
      const vgVis = vgrp ? vgrp.visible : true;
      try {
        if (t === cut && vgrp) vgrp.visible = false;
        R.webgl.setRenderTarget(t);
        for (const m of R.webgl.compile(R.scene, R.camera)) pending.add(m);
      } catch (e) { reportError('prewarm.compile', e); }
      finally { R.webgl.setRenderTarget(prevRT); if (vgrp) vgrp.visible = vgVis; }
      if (!cut) break;
    }
    try { rep.compileWait = await waitPrograms(g, pending); } catch (e) { reportError('prewarm.compileWait', e); }
    keepCurtain(g);
    g.warmHold = false;
    // The real cut-in path once (its own camera, MSAA target, vfx hidden, shadows frozen), then a main frame with the
    // panel up — exactly what a T3+ spell does, so neither the inset render nor the panel links programs mid-spell.
    const ci = g.magic && g.magic.cutIn;
    const hero0 = g.world.query({ kind: 'hero' })[0];
    if (ci && ci.show && ci.update && hero0) {
      const hs = hero0.hitstop || 0;
      try { bumpPools(); ci.show(hero0, { seconds: 1 }); ci.update(1 / 60); R.render(1 / 60); } catch (e) { reportError('prewarm.cutin', e); }
      finally { try { ci.hide(); } catch (e) { /* ignore */ } hero0.hitstop = hs; }
    }
    rep.compileMs = Math.round(performance.now() - c0);
    // Two real frames through the post chain: shadow programs, texture/geometry uploads, post passes.
    // Post: the chromatic-aberration pulse pass is off until the first heavy hit/spell; link its program now.
    const caPass = R.post && R.post.caPass, caWas = caPass ? caPass.enabled : false;
    if (caPass) caPass.enabled = true;
    const sunSh = R.lighting && R.lighting.sun && R.lighting.sun.shadow;
    // env depth pre-pass variants (render/depthPrepass.js): drawn into the scene target it uses in play (the target
    // type is part of the program key), before StaticFreeze has flagged anything
    if (R.prepass && R.prepass.warm && R.camera) {
      try {
        const W = R.webgl, tgt = R.post && R.post.composer ? R.post.composer.inputBuffer : null, prev = W.getRenderTarget();
        W.setRenderTarget(tgt); rep.prepassWarm = R.prepass.warm(W, R.scene, R.camera, R.envGroup); W.setRenderTarget(prev);
      } catch (e) { reportError('prewarm.prepass', e); }
    }
    for (let i = 0; i < 2; i++) { try { bumpPools(); if (sunSh) sunSh.needsUpdate = true; R.render(1 / 60); rep.frames++; } catch (e) { reportError('prewarm.render', e); break; } await new Promise((r) => requestAnimationFrame(() => r())); }
    if (caPass) caPass.enabled = caWas;
  } catch (e) { reportError('prewarm', e); }
  finally {
    g.warmHold = false;
    if (guard) guard.enabled = guardWas;
    for (const o of unculled) o.frustumCulled = true;
    for (const o of forced) o.visible = false;
    for (const [t, k, v] of bumped) { try { t[k] = v; } catch (e) { /* ignore */ } }
    if (group.parent) group.parent.remove(group);
    for (const c of [...group.children]) group.remove(c);
  }
  // perf-1650 r2: the stage title card (and the boss intro band) are the first DOM content with big drop-shadow /
  // blur / masked-glint filters. Chrome's GPU raster (Skia on ANGLE) compiles a shader program per new filter kind at
  // FIRST raster — traced 0.15–0.9 s of CrGpuMain raster flush right after the curtain lifted. Show both cards here,
  // under the curtain (same text → the lettering images are decoded too), let the settle loop below absorb the raster,
  // then remove them; the real cards reuse the compiled Skia programs.
  // perf-1650 r4: BEFORE the HUD warm below — the portrait <img> is new DOM content too: captured after the warm it
  // was first rasterised when the HUD appeared at the stage-1 fight start (traced: a 373 ms CrGpuMain
  // RendererRasterWorker flush + a 211 ms one = the 1.0 + 0.6 s realtime-bench gaps, stage 1 only — once per page).
  // HUD portraits (ui/portraits.js) render each hero's head once per page with a synchronous float readback — a
  // GPU flush + its own fog-less program variants. Do it now, behind the curtain, instead of 0.5 s into the stage.
  try {
    const hud = g.ui && g.ui.hud;
    if (hud && hud.portraits && hud.setPortrait) {
      const P = await import('../ui/portraits.js');
      for (const h of g.world.query({ kind: 'hero', alive: false })) {
        const hid = h.typeId || (h.def && h.def.id);
        if (hid && !hud.portraits.has(hid)) { const url = P.capturePortrait(g, h); if (url) hud.setPortrait(hid, url); }
      }
    }
  } catch (e) { reportError('prewarm.portrait', e); }
  const warmCards = [];
  try {
    const ui = g.ui;
    if (ui && ui.card && card && card[1]) { const el = ui.card(card[0] || '', card[1], 60); if (el) { el.style.zIndex = '-1'; warmCards.push(el); warmCards.stageCard = el; } }
    // …and the HUD itself (player panels, stage plate): its first raster was the other big post-curtain stall
    if (ui && ui.hud && ui.hud.show) { ui.hud.show(true); if (ui.hud.setStage && card) ui.hud.setStage(card[2] ?? null, card[3] || ''); warmCards.hud = ui.hud; }
    // combo counter + GO arrow (first shown mid-fight, same first-raster cost): fill them in, reset after the settle
    if (ui && ui.hud && ui.hud.combos && ui.hud.combos[0]) {
      const c = ui.hud.combos[0], F = await import('../ui/lettering.js');
      c.n.innerHTML = F.forge('12', { metal: 'ivory', track: 4 }); c.r.innerHTML = F.forge('A', { metal: 'gold', track: 6 }); c.el.classList.add('on');
      warmCards.combo = c;
    }
    if (ui && ui.go) { ui.go(true); warmCards.go = ui; }
    if (ui && ui.bossCard) { const el = ui.bossCard('WARM', 'warm', 60); if (el) { el.style.zIndex = '-1'; warmCards.push(el); } }
  } catch (e) { reportError('prewarm.cards', e); }
  // Settle: the GPU process may still be linking/uploading (ANGLE finishes some work lazily at first draw). Keep the
  // curtain up while the live loop renders the stage until frames arrive steadily (12 in a row < 34 ms; cap 15 s).
  // r3: the HUD magic-pot pips raster their FULL + 'pop' styles the first time a player holds 3+ pots (realtime
  // /?mode=bench: ~1 s rAF gaps right after d.pots(9) at the fight start; same first raster in play). Fill every pip
  // for the settle below (pops them too), restore after.
  const potWas = [];
  let potUnlock = null;
  try { potUnlock = g.magic && g.magic.lock ? g.magic.lock() : null; for (const h of g.world.query({ kind: 'hero' })) { potWas.push([h, h.pots]); h.pots = 9; } } catch (e) { /* optional */ }
  // r4: the HUD player panels were still EMPTY during this settle (no life blocks / magic tiers / pot pips built: the
  // panel fills on the first hud.render that sees the session hero) → the stage-1 fight start rasterised all of it
  // for the first time: 26 new Skia programs = 52 D3DCompile, 1.4 s of GPU-process stall (fresh-browser trace
  // tools/perf-freshtrace.mjs). Feed the HUD the stage's heroes and render it twice (pots 0 → 9: 'full' + 'pop' pips,
  // 'ready' tiers) so the settle below rasterises the finished panel.
  const hudWarm = g.ui && g.ui.hud && g.ui.hud.render && g.ui.hud._playerData ? g.ui.hud : null;
  if (hudWarm) {
    try {
      const pd = hudWarm._playerData;
      hudWarm._playerData = function (i) { const d = pd.call(this, i); if (d && d.hero) return d; const hr = g.world.query({ kind: 'hero' }).find((x) => (x.playerIndex ?? 0) === i); return hr ? { hero: hr, lives: 3, score: 0, cont: -1 } : d; };
      const hs = g.world.query({ kind: 'hero' });
      for (const h of hs) h.pots = 0;
      hudWarm.render(1 / 60);
      for (const h of hs) h.pots = 9;
      hudWarm.render(1 / 60);
    } catch (e) { reportError('prewarm.hud', e); }
  }
  const s0 = performance.now();
  { let ok = 0, last = performance.now();
    while ((ok < 12 || (warmCards.length && performance.now() - s0 < 1000)) && performance.now() - s0 < 15000) { // cards: let the 0.7 s wipe finish
      await new Promise((r) => requestAnimationFrame(() => r()));
      const now = performance.now(); ok = now - last < 34 ? ok + 1 : 0; last = now;
    } }
  rep.settleMs = Math.round(performance.now() - s0);
  // r4: what the HUD warm actually rasterised (the first real fight frame used to raster the life blocks, magic tiers and
  // pot pips for the first time → 26 Skia programs / 1.4 s of D3DCompile in the GPU process at the stage-1 fight start)
  try { const P0 = g.ui && g.ui.hud && g.ui.hud.panels && g.ui.hud.panels[0]; if (P0) rep.hud = { empty: P0.el.classList.contains('empty'), blocks: P0.blocks.length, tiers: P0.tierEls.length, pots: P0.potEls.length, on: g.ui.hud.el.classList.contains('on') }; } catch (e) { /* diagnostics only */ }
  for (const [h, n] of potWas) h.pots = n;
  if (hudWarm) { try { delete hudWarm._playerData; for (const P of hudWarm.panels || []) for (const el of P.potEls || []) el.classList.remove('pop'); } catch (e) { /* ignore */ } }
  if (potUnlock) potUnlock();
  for (const el of warmCards) {
    if (el === warmCards.stageCard && g.ui && g.ui._card === el) { el.dataset.warm = '1'; el.dataset.t = '0'; el.dataset.life = '60'; el.classList.remove('in'); el.style.opacity = '0'; continue; } // kept for UI.card() reuse
    try { el.remove(); } catch (e) { /* gone */ }
  }
  if (warmCards.combo) { const c = warmCards.combo; c.el.classList.remove('on'); c.n.innerHTML = ''; c.r.innerHTML = ''; c.rank = null; c.count = 0; c.t = 0; }
  if (warmCards.go) { try { warmCards.go.go(false); } catch (e) { /* ignore */ } }
  if (warmCards.hud) { try { warmCards.hud.show(false); } catch (e) { /* ignore */ } }
  if (g.ui) { if (warmCards.includes(g.ui._card) && g.ui._card !== warmCards.stageCard) g.ui._card = null; if (warmCards.includes(g.ui._boss)) g.ui._boss = null; }
  // Audio: the offline pre-render of every SFX runs from the first user gesture; let it finish (capped).
  const a0 = performance.now();
  const au = g.audio;
  if (au && au.ctx && au.stats && !au.stats.prerenderDone) { for (let t = 0; t < 4000 && !au.stats.prerenderDone; t += 100) await new Promise((r) => setTimeout(r, 100)); }
  rep.audioMs = Math.round(performance.now() - a0);
  cache.delete(id); // warm actors are single-use; a restart of the stage rebuilds cheaply from the caches
  rep.totalMs = Math.round(performance.now() - t0);
  rep.doneAt = Math.round(performance.now());
  g.prewarmReport = rep;
  g.warming = false;
  if (g.bus) g.bus.emit('prewarm:done', rep);
  warmCurtain(g, false);
  return rep;
}
