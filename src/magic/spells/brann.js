// Brann — EARTH, 4 tiers (DESIGN §2). Each tier is a choreographed cinematic (SpellKit):
//   T1 Tremor Shards    sword driven into the ground → glowing fissures race to every foe → stone spikes erupt
//   T2 Stone Pillars    a wave of basalt columns erupts outward both ways, launching each foe as it passes
//   T3 Boulder Rain     the sky darkens; three volleys of molten-veined boulders crash down on the foes (cut-in)
//   T4 Mountain's Wrath the ground quakes, a colossal stone titan's fist descends and smashes the screen (cut-in)
// Damage stays canon: every foe on screen takes exactly ctx.damage in total (S.strike ledger).
import { Color } from 'three';
import { spellKit } from '../SpellKit.js';
import { rockField, preloadTitanFist, preloadBasalt } from '../meshes.js';
import { groundRing, dustRing, debris, crackDecal, dustPuffs, embers, coreGlow } from '../../vfx/effects/_lib.js';

const VEIN = '#ffad42';
let columnSerial = 0;
const DUST_LIT = new Color().setRGB(5.8, 3.5, 1.8), DUST_COOL = new Color().setRGB(2.8, 2.1, 1.5);

function earthDust(S, x, y, z, n = 4, size = 1.2, dense = false) {
  if (!S.vfx.fire) return dustPuffs(S.vfx, x, y, z, { n, spread: .6, size: [size * .5, size], alpha: .4 });
  for (let i = 0; i < n; i++) S.vfx.fire.emit({ clip: 'smoke',
    pos: [x + S.r.range(-.65, .65), y + size * (dense ? .60 : .2), z + S.r.range(dense ? .45 : -.3, dense ? 1.0 : .4)],
    size: [size * .92, size * (dense ? 1.25 : 1)], life: S.r.range(dense ? .42 : .55, dense ? .68 : .85), tint: dense ? DUST_LIT : DUST_COOL, alpha: S.r.range(dense ? .22 : .14, dense ? .40 : .25), erosion: .12,
    vel: [S.r.range(-.55, .55), S.r.range(.8, 1.7), S.r.range(-.15, .3)], grow: dense ? .9 : 1.1, core: 0, soft: .14, floor: y,
    phase: i * .17, rot: S.r.range(-.4, .4) });
}

// Textured, spinning basalt fragments share one instanced draw. Larger pieces burst into smaller chips on landing.
function stoneFragments(S, x, y, z, ground, n = 6, size = 0.24, split = true) {
  const f = rockField(S.vfx, 'chip', { glow: VEIN }), r = S.r;
  f.glow(.65);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + r.range(-0.4, 0.4), s = size * (i === 0 && split ? 1.25 : r.range(0.4, 1.2)), speed = r.range(0.7, 2.3);
    f.add({ pos: { x: x + Math.cos(a) * 0.38, y: y + r.range(-0.28, 0.28), z: z + Math.sin(a) * 0.3 },
      scale: [s * r.range(.65, 1.15), s * r.range(.7, 1.3), s * r.range(.45, .8)], yaw: a, vel: [Math.cos(a) * speed, y > ground + 0.5 ? r.range(-1.8, 0.3) : r.range(1.4, 3.4), Math.sin(a) * speed * 0.6],
      gravity: 15, bounce: 0.3, spin: [r.range(-5, 5), r.range(-4, 4), r.range(-5, 5)], rise: 0, hold: 2.2, sink: 0.45, groundY: ground + s * 0.35,
      onLand: it => {
        if (split && i === 0) earthDust(S, it.x, ground + .02, it.z, 1, .5);
        if (split && i === 0) stoneFragments(S, it.x, ground + 0.12, it.z, ground, 3, s * 0.3, false);
      } });
  }
}

function spikeCluster(S, x, z, { n = 5, h = 1.3, delay = 0, hold = 1.0 } = {}) {
  const f = rockField(S.vfx, 'spike', { glow: VEIN }), r = S.r, y = S.gy(x, z);
  f.glow(3.6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + r.range(-0.3, 0.3), d = i === 0 ? 0 : r.range(0.25, 0.6);
    const sc = h * (i === 0 ? 1.15 : r.range(0.55, 0.9));
    f.add({ pos: { x: x + Math.cos(a) * d, y, z: z + Math.sin(a) * d * 0.7 }, scale: [sc * 1.35, sc, sc * 1.35], tilt: [Math.sin(a) * 0.35 * (i ? 1 : 0.2), -Math.cos(a) * 0.35 * (i ? 1 : 0.2)], rise: 0.09, hold: hold + r.range(0, 0.2), sink: 0.45, delay: delay + i * 0.02 });
  }
  S.vfx.delay(delay, () => {
    crackDecal(S.vfx, x, y, z, { radius: 1.0, glow: S.pal.tail, glowIntensity: 1.8, life: 1.8 });
    earthDust(S, x, y + .04, z, 2, .8);
    stoneFragments(S, x, y + .1, z, y, 4, .14, false);
    groundRing(S.vfx, x, y, z, { radius: 1.3, color: [S.pal.hot, S.pal.tail], intensity: 0.7, life: 0.3 });
  });
}

function column(S, target, { h = 3.7, hold = .76, variant = 0, scenic = false, lean = 0 } = {}) {
  const f = rockField(S.vfx, 'column', { glow: VEIN, variant }), r = S.r;
  f.glow(1.5);
  let rockX, rockZ;
  const id = ++columnSerial, w = scenic ? r.range(.85, 1.15) : r.range(1.35, 1.55);
  let x = target.pos.x, z = target.pos.z, y = S.gy(x, z);
  const tick = S.g.tick, foot = { x, y: target.pos.y, z };
  const struck = scenic || S.strike(target, 1, { final: true, launch: Math.sqrt(56 * (h + .12)), knockback: .35, hitstop: 0, shake: .0 });
  if (!struck) return false; // wait out an ordinary foe's get-up invulnerability before its visible breach
  f.add({ pos: { x, y, z }, scale: [w, h, w], yaw: variant * 2.13 + r.range(-.25, .25),
    tilt: [0, lean], rise: .24, hold, sink: .85, simBreach: true, fracture: true,
    contact: !scenic && target.vel?.y > 0 ? target : null,
    onBreach: it => {
      // Breach and strike run together on the simulation tick; the stone rise uses this same clock.
      // A launched target keeps the actual solid mass at its foot; immune targets use safe side/depth placement.
      rockX = it.x; rockZ = it.z;
      x = target.pos.x; z = target.pos.z; y = S.gy(x, z);
      const record = { column: id, variant, target: target.id, breachTick: tick,
        strikeTick: struck ? S.g.tick : null, base: { x, y, z }, columnBase: { x: rockX, y: it.y, z: rockZ }, skipped: !!it.omitted, targetFoot: foot,
        baseToTarget: Math.hypot(x - foot.x, z - foot.z), columnBaseToTarget: Math.hypot(rockX - foot.x, rockZ - foot.z), height: h, targetHeight: target.height,
        launched: !!(target.vel?.y > 0), launchVelocity: target.vel?.y ?? null,
        launchTick: target.vel?.y > 0 ? S.g.tick : null, struck, boss: !!(target.poise || target.kind === 'boss' || target.def?.boss) };
      if (!scenic) S.g.bus.emit('magic:earthBreach', record);
      else S.g.bus.emit('magic:earthRow', { column: id, tick, x, y, z, height: h });
      crackDecal(S.vfx, x, y, z, { radius: scenic ? .75 : 1.0, glow: '#ffd16b', glowIntensity: 7, life: 1.7 });
      groundRing(S.vfx, x, y + .04, z, { radius: scenic ? .8 : 1.2, color: ['#ffc15e', '#b7410b'], intensity: 1.2, life: .16, from: .12 });
      earthDust(S, x, y + .03, z, 1, scenic ? .85 : 1.05);
      stoneFragments(S, x, y + .2, z, y, scenic ? 6 : 12, .21, false);
      coreGlow(S.vfx, { x, y: y + .2, z: z + .15 }, { size: 2.5, color: '#fff9df', tail: '#ff931b', intensity: 12, life: .065, core: .2 });
      S.g.cameraRig?.shake(scenic ? .12 : .32);
      if (!scenic) S.g.cameraRig?.punch(.035, 8);
      // Reuse the preallocated light pool: no added lights, shaders, shadow maps or passes.
      S.vfx.light({ x, y: y + 1.0, z: z + .7 }, { color: '#ff9b32', intensity: 6, distance: 2.6, life: 1.1 });
      if (!scenic) {
        S.vfx.emitter(.85, (u, dt, t) => {
          if (target.removed) return;
          S.vfx.light({ x: target.pos.x, y: target.pos.y + .7, z: target.pos.z + .7 },
            { color: '#ffac4d', intensity: 6, distance: 2.6, life: .22 });
        });
      }
      // Ground-projected soft radiance persists through hold, independent of the small real light pool.
      if (!scenic) S.vfx.shape.emit({ shape: 'glow', mode: 'plane', pos: [x, y + .045, z], size: [2.8, 2.2],
        life: hold + .3, color: ['#ff9a28', '#b2440d'], alpha: [.65, .28], intensity: 1.9, p0: [2.3, .2] });
      embers(S.vfx, { x, y: y + .3, z }, { n: 9, dir: 0, speed: [-1, 1], up: [2, 5], color: ['#fff6cb', '#ff9a21'], intensity: 4 });
    },
    onCrumble: () => {
      // Unequal wedge shards replace the mass throughout its height, then fall and bounce.
      // The actual 28 solid authored cells rotate and fall in the column draw. Small chips add grit.
      stoneFragments(S, rockX, y + h * .45, rockZ, y, 9, .16, false);
      stoneFragments(S, rockX, y + .2, rockZ, y, 9, .075, false);
      // Warm translucent billows reveal the glowing break faces; staggered lifetimes avoid a dark curtain.
      earthDust(S, rockX, y + .08, rockZ, scenic ? 4 : 12, scenic ? .9 : 1.35, true);
      if (!scenic) earthDust(S, rockX, y + h * .35, rockZ, 3, 1.1, true);
      rockField(S.vfx, 'chip', { glow: VEIN })._tick(0);
      S.g.bus.emit('magic:earthCrumble', { column: id, tick: S.g.tick, x, y, z, height: h });
    } });
  return true;
}

function boulder(S, target, { delay = 0, size = 0.7, from = null, onLand } = {}) {
  const f = rockField(S.vfx, 'boulder', { glow: '#ffb040' }), r = S.r, vfx = S.vfx;
  f.glow(2.2);
  const gy = S.gy(target.x, target.z);
  const secs = 0.42;
  const o = from || { x: target.x - S.F * r.range(1.5, 3.5), y: gy + 11, z: target.z - 0.6 };
  const vel = [(target.x - o.x) / secs, (gy + size * 0.6 - o.y) / secs, (target.z - o.z) / secs];
  const inst = f.add({ pos: { x: o.x, y: o.y, z: o.z }, scale: [size, size, size], vel, gravity: 0, spin: [r.range(-6, 6), r.range(-3, 3), r.range(-6, 6)], rise: 0, hold: 0.7, sink: 0.5, delay, groundY: gy + size * 0.6, sinkDepth: size * 2,
    onLand: () => {
      crackDecal(vfx, target.x, gy, target.z, { radius: 1.2 + size * 0.5, glow: '#ff9030', glowIntensity: 1.8, life: 1.6 });
      groundRing(vfx, target.x, gy, target.z, { radius: 2 + size, color: [S.pal.hot, S.pal.tail], intensity: 0.8, life: 0.35 });
      dustRing(vfx, target.x, gy, target.z, { radius: 1.6 + size, alpha: 0.85, life: 1.1 });
      debris(vfx, target.x, gy, target.z, { n: 12, speed: [2, 5], up: [3, 7], size: [0.07, 0.18] });
      coreGlow(vfx, { x: target.x, y: gy + 0.5, z: target.z + 0.3 }, { size: 1.6, color: '#ffd080', tail: '#ff7020', intensity: 1.6, life: 0.14, core: 0.2 });
      S.g.cameraRig && S.g.cameraRig.shake(0.22 + size * 0.1);
      if (onLand) onLand();
    } });
  // falling trail: molten glow + dust streak behind each boulder
  let trailBeat = -1;
  vfx.delay(delay, () => vfx.emitter(secs, (u, dt, t) => {
    if ((t * 18 | 0) === trailBeat) return;
    trailBeat = t * 18 | 0;
    vfx.add.emit({ pos: [inst.x, inst.y, inst.z], vel: [r.range(-0.5, 0.5), r.range(0.5, 1.5), 0], life: r.range(0.25, 0.5), size: [0.08, 0.02], color: ['#ffd080', '#ff5010'], intensity: 3, shape: 'ember', drag: 1.5 });
    earthDust(S, inst.x, inst.y + .1, inst.z, 1, size * .7);
  }));
  return Math.round((delay + secs) * 60);
}

async function tremorShards(S) {
  await S.intro({ charge: 20 });
  // (spike clusters hold ~0.6 s then crumble back into the fissure)
  const h = S.hero;
  for (const e of S.alive()) {
    const d = Math.abs(e.pos.x - h.pos.x) + Math.abs(e.pos.z - h.pos.z);
    const secs = 0.12 + d / 16;
    S.fx.crackRun({ x: h.pos.x + S.F * 0.6, z: h.pos.z }, { x: e.pos.x, z: e.pos.z }, { secs, onArrive: () => {
      spikeCluster(S, e.pos.x, e.pos.z, { n: 5, h: 1.25, hold: 0.6 });
      S.strike(e, 1, { final: true, launch: 6, hitstop: 7 });
    } });
  }
  await S.outro(64);
}

async function stonePillars(S) {
  await S.intro({ charge: 22, light: 1.8, dark: .24, dist: 16.3, height: 5.5, lookHeight: 1.8 });
  const h = S.hero, speed = 18, foes = S.alive();
  const bosses = foes.filter(e => e.poise || e.kind === 'boss' || e.def?.boss);
  S.g.magic?.spellLight(h, VEIN, 78);
  // Sword-to-earth breach, 2–3 frames at 60 Hz, followed by the traveling fracture front.
  const gy = S.gy(h.pos.x, h.pos.z);
  coreGlow(S.vfx, { x: h.pos.x + S.F * .7, y: gy + .12, z: h.pos.z + .18 },
    { size: 2.8, color: '#fffbea', tail: '#ff8a20', intensity: 9, life: .05, core: .24 });
  stoneFragments(S, h.pos.x + S.F * .7, gy + .15, h.pos.z, gy, 18, .18, false);
  // Sculpted infill connects actual target eruptions into one broad, broken fault line.
  if (foes.length) {
    const rg = S.g.cameraRig?.visibleRange() || { xMin: h.pos.x - 8, xMax: h.pos.x + 8 };
    const left = Math.max(rg.xMin + .7, Math.min(h.pos.x + S.F * 1.8, ...foes.map(e => e.pos.x)) - .8);
    const right = Math.min(rg.xMax - .7, Math.max(h.pos.x + S.F * 1.8, ...foes.map(e => e.pos.x)) + .8);
    let j = 0;
    for (let x = left; x <= right; x += 1.6) {
      if (Math.abs(x - h.pos.x) < 1.35 || foes.some(e => Math.abs(e.pos.x - x) < .8) || bosses.some(e => Math.abs(e.pos.x - x) < 3.5)) continue;
      const i = j++, foreground = i % 3 === 1;
      const z = h.pos.z + (foreground ? .42 : -1.0) + Math.sin(i * 2.1) * .32;
      const height = foreground ? 1.15 + (i % 2) * .35 : 1.85 + Math.sin(i * 2.4) * .65;
      S.g.after(Math.max(1, Math.round(Math.abs(x - h.pos.x) / speed * 60)), () =>
        column(S, { pos: { x, y: gy, z }, height: 0 }, { h: height, hold: .80, variant: i % 3, scenic: true, lean: foreground ? (i % 2 ? .20 : -.18) : .06 }));
    }
  }
  if (bosses.length) {
    const rg=S.g.cameraRig?.visibleRange();
    const edge=rg ? Math.max(rg.xMin+1.4, Math.min(...bosses.map(b=>b.pos.x))-3.3) : h.pos.x-3;
    S.g.after(12,()=>column(S,{pos:{x:edge,y:gy,z:h.pos.z-1.8},height:0},{h:2.6,hold:1.0,variant:2,scenic:true}));
  }
  foes.forEach((e, i) => {
    const t = Math.min(.3, Math.abs(e.pos.x - h.pos.x) / speed);
    S.fx.crackRun({ x: h.pos.x, z: h.pos.z }, { x: e.pos.x, z: e.pos.z }, { secs: Math.max(.07, t) });
    const erupt = (attempt = 0) => {
      if (e.removed || e.alive === false) return;
      const boss = bosses.includes(e), nearBoss = bosses.some(b => Math.abs(b.pos.x-e.pos.x) < 3.0);
      if (!column(S, e, { h: boss ? 1.35 : nearBoss ? 2.4 : 3.65, hold: .65 + i * .025, variant: i % 3 }) && attempt < 18)
        S.g.after(3, () => erupt(attempt + 1));
    };
    S.g.after(Math.max(1, Math.round(t * 60)), () => erupt());
  });
  await S.outro(96);
}

async function boulderRain(S) {
  await S.intro({ charge: 26, dark: .28, light: 2 });
  const g = S.g, h = S.hero;
  S.fx.cloud(h.pos.x + S.F * 3, 7.5, 16, 2.6);
  g.slowmo(0.55, 0.3);
  let first = true;
  for (let wave = 0; wave < 3; wave++) {
    const foes = S.alive();
    for (const e of foes) {
      const land = boulder(S, { x: e.pos.x + S.r.range(-0.3, 0.3), z: e.pos.z }, { delay: S.r.range(0, 0.15), size: wave === 2 ? 1.12 : 0.78 });
      const final = wave === 2;
      g.after(land, () => {
        if (first) { first = false; S.cutIn(e); g.slowmo(0.35, 0.25); }
        S.strike(e, 0.3, { final, launch: final ? 7 : 0, hitstop: final ? 9 : 4 });
      });
    }
    // extras for the rain density
    const rg = g.cameraRig ? g.cameraRig.visibleRange() : { xMin: h.pos.x - 8, xMax: h.pos.x + 8 };
    for (let i = 0; i < 4; i++) boulder(S, { x: S.r.range(rg.xMin + 1, rg.xMax - 1), z: S.r.range(-2, 2) }, { delay: S.r.range(0, 0.35), size: S.r.range(0.4, 0.8) });
    await S.wait(22);
  }
  await S.wait(10);
  S.finishAll({ launch: 6 });
  await S.outro(60);
}

async function mountainsWrath(S) {
  const g = S.g, h = S.hero, vfx = S.vfx;
  await S.intro({ charge: 34, dark: .48, light: 2.4, dist: 21.5, height: 8 });
  const foes = S.alive();
  const cx = foes.length ? foes.reduce((a, e) => a + e.pos.x, 0) / foes.length : h.pos.x + S.F * 4;
  const cz = 0, gy = S.gy(cx, cz);
  // rumble: the ground shakes harder and harder, pebbles hop, dust sheets fall from above
  for (let i = 0; i < 4; i++) { S.fx.quake(0.18 + i * 0.07, { dust: 5 }); await S.wait(8); }
  // the fist descends: slow reveal from the sky, then a violent slam
  const fist = rockField(vfx, 'fist', { glow: '#ffc060' });
  fist.glow(1.0);
  g.magic?.spellLight({ pos: { x: cx - .5, y: gy + .1, z: cz + .4 }, facing: 1 }, '#ffb35c', 100);
  const SC = 2.6, y0 = gy + 9, yHit = gy + 0.05;
  const T_REVEAL = 0.72, T_SLAM = 0.13, tick0 = g.tick;
  fist.add({ pos: { x: cx, y: y0, z: cz + 0.2 }, scale: [SC, SC * 0.85, SC], yaw: -0.12 * S.F, tilt: [0.03, 0.025 * S.F], rise: 0.001, hold: T_REVEAL + T_SLAM + 0.9, sink: 0.7, sinkDepth: SC * 1.2,
    update: (it) => {
      // driven by the SIM clock (the impact is scheduled on sim ticks; the render clock lags under slow-mo, which
      // made the fist arrive AFTER its own impact in r1 → read as a tower rising out of the spikes)
      const a = (g.tick - tick0) / 60;
      if (a < T_REVEAL) { const k = Math.min(1, a / .52); it.y = y0 - (y0 - (gy + 2.8)) * (1 - (1 - k) ** 2); }
      else if (a < T_REVEAL + T_SLAM) { const k = (a - T_REVEAL) / T_SLAM; it.y = gy + 2.8 - (gy + 2.8 - yHit) * k * k; }
      else it.y = yHit;
    } });
  // falling-debris streaks around the descending fist
  vfx.emitter(T_REVEAL + T_SLAM, () => {
    vfx.alpha.emit({ pos: [cx + S.r.range(-2, 2), gy + S.r.range(6, 10), cz - 0.2], vel: [0, -6, 0], life: 0.6, size: [0.8, 1.8], color: [[0.34, 0.3, 0.26, 0.4], [0.34, 0.3, 0.26, 0]], shape: 'smoke', drag: 0.5, rot: S.r.range(0, 6.28) });
  });
  await S.wait(Math.round((T_REVEAL + T_SLAM) * 60));
  // IMPACT
  g.bus.emit('magic:earthFistImpact',{tick:g.tick,x:cx,y:gy,z:cz});
  const P = { x: cx, y: gy + 0.8, z: cz + 0.4 };
  g.slowmo(0.25, 0.35, { out: 0.35 });
  S.g.renderer && S.g.renderer.post && S.g.renderer.post.pulse({ flash: 0.3, flashColor: '#ffe8a0', ca: 0.006, duration: 0.4 });
  g.cameraRig && g.cameraRig.shake(1.0);
  g.cameraRig && g.cameraRig.punch(0.12, 14);
  // Aftershock persists beyond the single impact tick (camera trauma otherwise decays too early in slow motion).
  for (const [ticks, strength] of [[5,.72],[11,.55],[18,.38]]) g.after(ticks,()=>g.cameraRig?.shake(strength));
  S.fx.pop({ x: P.x, y: gy + 0.4, z: P.z + 1.4 }, 1.1);
  vfx.light({ x: cx, y: gy + 1.4, z: cz + 2.4 }, { color: '#ffc27a', intensity: 6, distance: 2.6, life: 1.3 });   // key-light the knuckles
  fist.glow(1.25);
  vfx.shape.emit({ shape: 'flare', pos: [P.x, P.y, P.z + 0.5], size: [5.5, .65], life: 0.13, color: ['#fff0b0', S.pal.mid], intensity: 1.8, p0: [0.06, 0.12] });
  for (let k = 0; k < 3; k++) groundRing(vfx, cx, gy, cz, { radius: 5 + k * 3, color: [S.pal.hot, S.pal.tail], intensity: 1.1 - k * 0.25, life: 0.5 + k * 0.15, delay: k * 0.07 });
  crackDecal(vfx, cx, gy, cz, { radius: 5.5, glow: S.pal.mid, glowIntensity: 2.4, life: 3 });
  earthDust(S,cx,gy+.06,cz,10,1.8,true);
  earthDust(S,cx,gy+.05,cz+1.9,8,1.6,true);
  dustRing(vfx, cx, gy, cz, { radius: 6, alpha: 0.9, life: 1.6, n: 28, size: [0.6, 1.8], stretchX: 1.5 });
  debris(vfx, cx, gy, cz, { n: 40, speed: [3, 9], up: [5, 11], size: [0.08, 0.26] });
  // shockwave of spikes rippling outward
  for (let ring = 2; ring <= 4; ring++) {   // ring 1 skipped: nothing hides the fist itself
    const n = 3 + ring * 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 + S.r.range(-0.2, 0.2), R = ring * 2.1;
      spikeCluster(S, cx + Math.cos(a) * R * 1.2, cz + Math.sin(a) * R * 0.3, { n: 1, h: 1.9 - ring * 0.3, delay: ring * 0.08, hold: 0.8 });
    }
  }
  foes.sort((a, b) => Math.abs(a.pos.x - cx) - Math.abs(b.pos.x - cx));
  if (foes[0]) S.cutIn(foes[0], { seconds: 1.2 });
  for (const e of foes) S.strike(e, 1, { final: true, launch: 11, knockback: 5, hitstop: 12, from: P });
  // boulders shed from the crumbling fist
  await S.wait(40);
  for (let i = 0; i < 8; i++) {
    const a = S.r.range(0, 6.28);
    boulder(S, { x: cx + Math.cos(a) * S.r.range(2, 6), z: Math.sin(a) * 2 }, { from: { x: cx, y: gy + 3, z: cz }, size: S.r.range(0.35, 0.7), delay: i * 0.03 });
  }
  dustPuffs(vfx, cx, gy, cz, { n: 14, spread: 1.5, speed: [1, 3], size: [0.6, 1.6], alpha: 0.6 });
  embers(vfx, { x: cx, y: gy + 2, z: cz }, { n: 20, dir: 0, speed: [-2, 2], up: [1, 4], color: [S.pal.hot, S.pal.tail], intensity: 2.8 });
  await S.outro(70);
}

export default {
  id: 'brann',
  element: 'earth',
  maxTier: 4,
  tiers: { 1: { name: 'Tremor Shards' }, 2: { name: 'Stone Pillars' }, 3: { name: 'Boulder Rain' }, 4: { name: "Mountain's Wrath" } },
  async preload(ctx) {
    if (!ctx.vfx || !ctx.vfx.group) return;
    for (const k of ['spike', 'column', 'boulder', 'chip', 'fist']) rockField(ctx.vfx, k, { glow: VEIN });
    await Promise.all([preloadTitanFist(ctx.vfx), preloadBasalt(ctx.vfx)]);
  },
  async cast(ctx, hero, tier) {
    const S = spellKit(ctx, hero, { element: 'earth', maxTier: 4 });
    const fn = [null, tremorShards, stonePillars, boulderRain, mountainsWrath][tier] || tremorShards;
    try { await fn(S); } finally { S.finishAll(); }
  },
};
