// Hit feedback per weight (default HIT spark). opts: { point, dir:±1, level, attacker, target, blocked, killed,
// knockdown, launch, otg, moveId, hitstop (ticks), element?, kind? (force: light|heavy|knockdown|ko|block|otg|throw|magic) }
// C2: shared authored flipbooks replace the plateaued procedural contacts.
// light: asymmetric white-hot slash + warm contour, sized for the game camera.
// heavy: chunky blunt burst + broken shock rim. knockdown: warm eroded jets + dust.
// magic fire: flash -> billowing fire -> soot, ember cluster; storm: branching electric strike.
// KO / block / OTG / throw keep their established motion/dust and victim-anchored placement.
// Only full magic-earth hits emit stone chips. Boss/repeat contacts retain bounded kernels.
// A physical hit carrying an element (hit.element) adds a small element accent on top of its weight motif.
// Sparks orient along the attacker's actual weapon-tip velocity (vfx.trails.swingDir) when known.
import * as THREE from 'three';
import { contactFill } from '../../render/characterLook.js';
import { bodyContact, frontContact } from '../contact.js';
import { hitKind, hitPalette, PALETTES } from '../palette.js';
import { coreGlow, impactBurst, sparkSpray, speedLines, groundRing, dustRing, dustPuffs, embers, flare, crackDecal } from './_lib.js';

// Per-VFX-system weak target keys: despawned actors are not retained, and a new world starts fresh.
const contactWindows = new WeakMap();
function repeatContact(vfx, target) {
  if (!target) return false;
  let state = contactWindows.get(vfx);
  if (!state || state.world !== vfx.game.world) { state = { world: vfx.game.world, targets: new WeakMap() }; contactWindows.set(vfx, state); }
  const tick = vfx.game.tick || 0, last = state.targets.get(target);
  // Anchor to the first burst, so a continuous string cannot suppress large contacts forever.
  if (last !== undefined && tick >= last && tick - last < 6) return true;
  state.targets.set(target, tick);
  return false;
}

function metalChips(vfx, q, sw, heavy, gy) {
  const r=vfx.rng;
  for (let i=0;i<(heavy ? 5 : 3);i++) {
    const speed=r.range(heavy ? 5 : 4,heavy ? 11 : 8);
    vfx.debris.emit({kind:'metal',pos:[q.x,q.y,q.z],
      vel:[sw.x*speed+r.range(-1,1),sw.y*speed+r.range(.6,2),sw.z*speed+r.range(-.7,.7)],
      size:r.range(.035,.062),color:i%2 ? '#ff9b28' : '#ffdf92',life:r.range(.12,.24),spin:r.range(-18,18),groundY:gy,bounce:.1});
  }
}

const _dir = new THREE.Vector3(), _sw = new THREE.Vector3(), _v = new THREE.Vector3();

function swing(vfx, o, kind) {
  const d = o.dir || 1;
  const sw = o.attacker && vfx.trails ? vfx.trails.swingDir(o.attacker) : null;
  if (sw) {
    _sw.copy(sw); _sw.z *= 0.4;
    if (_sw.lengthSq() > 1e-4) return _sw.normalize();
  }
  const lightTilt = { light_1: -.65, light_2: .65, light_3: -1.1 };
  if (o.moveId in lightTilt) return _sw.set(d, lightTilt[o.moveId], 0).normalize();
  const r = vfx.rng;
  const tilt = kind === 'heavy' || kind === 'knockdown' || kind === 'ko' ? r.range(-0.75, 0.25) : r.range(-0.45, 0.45);
  return _sw.set(d * Math.cos(tilt), Math.sin(tilt), r.range(-0.12, 0.12)).normalize();
}

/** Camera-plane unit direction at angle a (radians, 0 = screen right). */
function camDir(vfx, a, out = _v) {
  const c = vfx.camBasis();
  return out.set(c.right.x * Math.cos(a) + c.up.x * Math.sin(a), c.right.y * Math.cos(a) + c.up.y * Math.sin(a), c.right.z * Math.cos(a) + c.up.z * Math.sin(a));
}

/** Thin blade line (axial) through p at screen angle a. */
function bladeLine(vfx, p, a, { length = 1, width = 0.06, color, intensity = 2.2, life = 0.1, hold = 0, delay = 0 } = {}) {
  const d = camDir(vfx, a);
  vfx.shape.emit({ shape: 'line', mode: 'axial', pos: [p.x, p.y, p.z], dir: [d.x, d.y, d.z], size: [length, width], grow: [0.55, 1.15], growY: [1.3, 0.3], ease: 'out',
    life, hold, delay, color, intensity, p0: [0.5, 1, 1], occ: 0.65 });
}

// ------------------------------------------------------------------ element motifs (magic + accents)
const ELEMENT_FX = {
  fire(vfx, q, pal, { gy, hs, dir, s = 1 }) {
    const scale = 0.65 + s * 0.35;
    // Independently rising soot behind the small premultiplied combustion tongues.
    if (s >= 1) vfx.fire.emit({ clip: 'smoke', pos: [q.x - dir*.18, q.y + .16, q.z + .10], size: [1.65, 1.8],
      delay: .075, fadeIn: .065, life: .52, vel: [dir*.24, .65, 0], core: 0, tint: '#b1a69c', alpha: 1.0, grow: .52, spin: -dir*.24 });
    vfx.fire.emit({ clip: 'fireBurst', pos: [q.x - dir*.30, q.y + .10, q.z + .025], size: [1.28 * scale, 1.30 * scale],
      life: .355, alpha: 1, core: 2.6, erosion: 0, grow: .07, radiance: 1.8, mirror: dir, rot: -dir * .12 });
    vfx.fire.emit({ clip: 'embers', pos: [q.x, q.y + .3, q.z + .03], size: [1.6 * scale, 1.8 * scale],
      life: 0.5, core: 0.2, alpha: .65, grow: 0.3 });
    vfx.light(q, { color: pal.mid, intensity: 1.5, distance: 1.6, life: 0.1 });
  },
  storm(vfx, q, pal, { gy, gx, gz, hs, s = 1 }) {
    coreGlow(vfx, q, { size: .22 * s, color: '#effcff', tail: '#3b8eff', intensity: 1.3, life: .05, core: .08 });
    vfx.fire.emit({ clip: 'storm', pos: [q.x, q.y + .65, q.z], size: [3.0 * s, 3.8 * s], life: .26,
      core: .3, erosion: 0, radiance: 1.15 });
    sparkSpray(vfx, q, _dir.set(0, 1, 0), { n: Math.round(12 * s), speed: [4, 10], cone: 1.2,
      life: [0.1, 0.24], color: [pal.mid, pal.tail], intensity: 1.4, gravity: 5, floor: gy + 0.02 });
    vfx.shape.emit({ shape: 'glow', mode: 'plane', pos: [gx, gy+.03, gz], size: [2.0*s, 1.5*s],
      life: .07, color: ['#9ee8ff', '#2966c8'], intensity: 1.0, p0: [2.6,.2] });
    vfx.light({x:gx,y:gy+.55,z:gz+.20}, { color: '#7bcaff', intensity: 4.2, distance: 2.4, life: .075 });
  },
  earth(vfx, q, pal, { gy, gx, gz, dir, s = 1 }) {
    // Only the full earth spell hit emits stone; physical element accents stay dust-only.
    const r = vfx.rng;
    if (s >= 1) for (let i = 0, N = Math.max(1, Math.round(5 * vfx.scale)); i < N; i++) {
      const side = N > 1 ? (i / (N - 1) - 0.5) * 0.8 : 0;
      vfx.debris.emit({ pos: [gx + side, gy + 0.12 + r.range(0, 0.12), gz + r.range(-0.1, 0.15)],
        vel: [side * 2.2, r.range(2.8, 4.3), r.range(-0.4, 0.5)], size: r.range(0.09, 0.18),
        color: i % 2 === 0 ? '#c9b58e' : '#b5a580', kind: 'stone', groundY: gy,
        life: r.range(0.28, 0.42), spin: r.range(-9, 9), bounce: 0.12 });
    }
    if (s >= 1) {
      crackDecal(vfx, gx, gy, gz, { radius: 0.9, glow: '#658c47', glowIntensity: 0.65, life: 0.8 });
      dustPuffs(vfx, gx, gy, gz, { n: 3, spread: 0.42, speed: [1, 2], size: [0.13, 0.32], alpha: 0.45 });
      dustRing(vfx, gx, gy, gz, { radius: .8, alpha: 0.4, life: 0.36, n: 5, size: [.12,.32], band: false });
    }
    vfx.light(q, { color: '#a1ad63', intensity: 0.65, distance: 1.4, life: 0.08 });
  },
};

export default {
  id: 'hit_spark',
  spawn(vfx, o = {}) {
    const r = vfx.rng;
    const hitPoint = bodyContact(o);
    const kind = hitKind(o);
    const dir = o.dir || 1;
    const pal = hitPalette(kind, o.attacker, o.element);
    const hs = Math.max(0, (o.hitstop ?? 5) / 60);
    const t = o.target;
    const boss = t && (t.kind === 'boss' || t.modelRoot?.userData.kcaBossFlash);
    const repeat = kind !== 'block' && repeatContact(vfx, t);
    const compact = boss || repeat;
    const gy = t ? vfx.groundY(t) : 0;
    // A throw landing's event point can be the attacker/victim midpoint (over the thrower's face).
    // Its contact kernel belongs to the victim's landing, alongside the existing body-slam layers.
    const thrownContact = kind === 'throw' || o.moveId === 'throw_impact';
    const p = thrownContact && t?.pos ? { x: t.pos.x, y: kind === 'throw' ? gy + 0.4 : t.pos.y + (t.height || 1.8) * 0.55, z: t.pos.z } : hitPoint;
    const gx = t ? t.pos.x : p.x, gz = t ? t.pos.z : p.z;
    const sw = swing(vfx, o, kind);
    const basis = vfx.camBasis();
    const swA = Math.atan2(sw.dot(basis.up), sw.dot(basis.right));
    _dir.set(dir, 0.15, 0).normalize();
    // Push the effect a touch toward the camera so it sits in front of the victim's silhouette.
    const cb = vfx.camBasis();
    const q = frontContact(p, vfx.game.camera, ['light','heavy','knockdown'].includes(kind) ? 1.15 : .65);
    // Optional read-only evidence hook; no actor retention in production.
    vfx.contactProbe?.({ target: t, moveId: o.moveId, point: p, flash: q, kind });
    // Every unblocked body contact, including enemy knockdowns on heroes, has the same short core.
    if (kind !== 'block') coreGlow(vfx, q, { size: .18, color: '#fffef2', tail: pal.mid, intensity: 1.2, life: .045, core: .04 });
    // Size from the camera projection, with a world-space ceiling for close inspection.
    // 68px quad yields about 60px of opaque silhouette at 1600x900, before bloom.
    const camera = vfx.game.camera;
    const depth = camera ? _v.set(q.x, q.y, q.z).sub(camera.position).dot(cb.fwd) : 18;
    const px = camera ? 2 * Math.max(1, depth) * Math.tan(camera.fov * Math.PI / 360) / 900 : 0.015;
    const diameter = Math.min(1.3, Math.max(0.72, px * 68));
    if (kind !== 'block' && (compact || !['light', 'heavy', 'knockdown', 'magic'].includes(kind))) vfx.shapeLit.emit({ shape: 'contact', pos: [q.x, q.y, q.z + 0.025],
      size: [diameter * (compact ? (repeat ? 0.32 : 0.52) : kind === 'light' ? 1 : 1.18), diameter * (compact ? (repeat ? 0.32 : 0.52) : kind === 'light' ? 1 : 1.18)], rot: swA + 0.12,
      p0: [compact ? 1 : 0, 0, 0, 0],
      life: 0.065, hold: compact ? 0.015 : 0.05, grow: [1, 0.78], color: '#ffffff', alpha: [1, 0], ease: 'linear' });
    const ctx = { gy, gx, gz, hs, dir };

    if (kind === 'block') {
      const M = PALETTES.metal;
      coreGlow(vfx, q, { size: 0.3, color: '#ffffff', tail: '#b8d4ff', intensity: 1.508, life: 0.06, hold: hs * 0.5 });
      vfx.shape.emit({ shape: 'star', pos: [q.x, q.y, q.z], size: [0.95, 0.95], life: 0.09, hold: hs * 0.6, rot: r.range(-0.2, 0.2) + Math.PI / 4, color: ['#ffffff', '#a8c8ff'], intensity: 1.392, p0: [4, 40, 1, 0.5], p1: [4, 60, 0.5, 0.2] });
      _dir.set(-dir, 0.55, 0).normalize();
      sparkSpray(vfx, q, _dir, { n: 18, speed: [5, 12], cone: 0.9, up: 0.6, life: [0.22, 0.5], size: [0.024, 0.01], color: [M.hot, '#8ab4ff'], intensity: 2.784, gravity: 20, drag: 1.6, floor: gy + 0.02, stretch: 0.014 });
      embers(vfx, q, { n: 3, dir: -dir, color: ['#fff2c0', '#ff7a20'], life: [0.2, 0.45] });
      vfx.light(q, { color: 0xd8e8ff, intensity: 1.16, distance: 1.6, life: 0.06 });
      return;
    }

    if (kind === 'magic' && !repeat) {
      const el = ELEMENT_FX[o.element] ? o.element : (pal === PALETTES.storm ? 'storm' : pal === PALETTES.earth ? 'earth' : 'fire');
      ELEMENT_FX[el](vfx, q, pal, ctx);
      return;
    }

    // Boss physical contacts / repeat elemental hits: small kernel plus directional moving sparks.
    // Repeat hits on any target keep their own point/direction, without another broad burst/ring/light.
    if (compact) {
      sparkSpray(vfx, q, sw, { n: repeat ? 5 : kind === 'light' ? 8 : 12, speed: [5, 10], cone: 0.32,
        up: 0.12, life: [0.06, 0.14], size: [0.022, 0.008], color: [pal.mid, pal.tail], intensity: 1.45,
        gravity: 9, floor: gy + 0.02, stretch: 0.018 });
      bladeLine(vfx, q, swA, { length: repeat ? 0.24 : 0.42, width: 0.025,
        color: [pal.mid, pal.tail], intensity: 0.85, life: 0.065 });
      if (!repeat && kind !== 'light' && p.y - gy < 1.2)
        dustPuffs(vfx, gx, gy, gz, { n: 3, spread: 0.18, size: [0.1, 0.25], alpha: 0.3 });
      return;
    }

    if (kind === 'throw') {
      // body slam: flattened impact star at the victim's hip/feet + ground shock
      const s = { x: gx, y: gy + 0.4, z: gz + 0.3 };
      impactBurst(vfx, s, { size: 1.3, stretch: 1.9, spikes: 9, valley: 0.4, color: [pal.mid, pal.tail], intensity: 0.522, life: 0.18, hold: hs, rot: 0, occ: 0.35 });
      coreGlow(vfx, s, { size: 0.6, color: pal.hot, tail: pal.mid, intensity: 1.044, life: 0.1, hold: hs, core: 0.1 });
      groundRing(vfx, gx, gy, gz, { radius: 2.2, color: [pal.mid, pal.tail], intensity: 0.377, life: 0.4 });
      groundRing(vfx, gx, gy, gz, { radius: 1.3, color: [pal.core, pal.mid], intensity: 0.464, life: 0.28, delay: 0.04 });
      crackDecal(vfx, gx, gy, gz, { radius: 0.9, glow: pal.mid, glowIntensity: 1.0, life: 1.4 });
      dustRing(vfx, gx, gy, gz, { radius: 1.8, alpha: 0.8, life: 1.0, stretchX: 1.35, n: 16 });
      dustPuffs(vfx, gx, gy, gz, { n: 12, spread: 0.6, speed: [1, 3.2], size: [0.35, 1.0], alpha: 0.7 });
      _dir.set(0, 1, 0);
      sparkSpray(vfx, s, _dir, { n: 12, speed: [4, 9], cone: 1.3, life: [0.15, 0.35], color: [pal.hot, pal.tail], intensity: 1.972, gravity: 14, floor: gy + 0.02 });
      speedLines(vfx, s, { n: 8, r0: 0.5, r1: 1.6, length: 0.55, color: [pal.core, pal.mid], intensity: 0.87, life: 0.16, hold: hs * 0.5 });
      vfx.light(s, { color: pal.mid, intensity: 2.32, distance: 2.2, life: 0.12 });
      if (o.element && ELEMENT_FX[o.element]) ELEMENT_FX[o.element](vfx, s, PALETTES[o.element], { ...ctx, s: 0.5 });
      return;
    }

    const accent = (sc) => { if (o.element && ELEMENT_FX[o.element]) ELEMENT_FX[o.element](vfx, q, PALETTES[o.element], { ...ctx, s: sc }); };
    const nearGround = p.y - gy < 2.4;

    if (kind === 'light') {
      // Four authored directional wedge poses with open streaks and travelling metal.
      const extent = Math.min(4.15, Math.max(3.95, px * 255)) * r.range(.94, 1.06);
      vfx.fire.emit({ clip: 'slash', pos: [q.x, q.y, q.z], size: [extent, extent * r.range(.78,.82)],
        skew: r.range(-.30,.30), rot: swA, life: .12, core: 10, radiance: 1.15, erosion: .04, grow: .10, growY: -.12,
        vel: [sw.x*.8, sw.y*.8, sw.z*.8] });
      sparkSpray(vfx, q, sw, { n: 9, speed: [6, 13], cone: .55, life: [.09, .18], size: [.025, .006],
        color: ['#ffd976', pal.tail], intensity: 1.1, gravity: 8, floor: gy + .02, stretch: .020 });
      metalChips(vfx,q,sw,false,gy);
      contactFill(t?.modelRoot, {x:p.x,y:(t?.pos.y || gy)+(t?.height || 1.8)*.60,z:p.z+.22});
      const arm=o.attacker?.model?.sockets?.R;
      if(arm) contactFill(o.attacker.modelRoot,arm.getWorldPosition(new THREE.Vector3()),{radius:.72,strength:1.1,life:.075});
      // A surface-level light reaches the torso and weapon arm; one existing pool slot is reused.
      vfx.light({x:p.x-dir*.27,y:p.y+.16,z:p.z+.42}, { color: '#ffd18a', intensity: 18, distance: 1.65, life: .060, contact: true });
      accent(0.35);
      return;
    }

    if (kind === 'otg') {
      // downward stab: the GROUND CRACK is the silhouette: bright glowing fissure + upward fountain, no star
      const g = { x: gx, y: gy + 0.12, z: gz + 0.15 };
      coreGlow(vfx, g, { size: 0.5, color: pal.hot, tail: pal.mid, intensity: 1.044, life: 0.1, hold: hs, core: 0.1 });
      crackDecal(vfx, gx, gy, gz, { radius: 1.35, glow: pal.mid, glowIntensity: 2.4, life: 1.8 });
      groundRing(vfx, gx, gy, gz, { radius: 1.0, color: [pal.mid, pal.tail], intensity: 0.261, life: 0.22 });
      _dir.set(0, 1, 0);
      sparkSpray(vfx, g, _dir, { n: 18, speed: [5, 11], cone: 0.35, life: [0.2, 0.42], color: [pal.hot, pal.tail], intensity: 2.204, gravity: 16, floor: gy + 0.02 });
      vfx.shape.emit({ shape: 'line', mode: 'axial', pos: [g.x, g.y + 0.7, g.z], dir: [0, 1, 0], size: [1.5, 0.12], grow: [0.4, 1.2], growY: [1.2, 0.2], life: 0.14, hold: hs * 0.5, color: [pal.mid, pal.tail], intensity: 1.15, p0: [0.5, 1, 1], occ: 0.4 });
      for (let i = -1; i <= 1; i++) {
        vfx.shape.emit({ shape: 'shard', mode: 'axial', pos: [g.x + i * 0.16, g.y + 0.18, g.z],
          dir: [i * 0.4, 1, 0], vel: [i * 0.6, 0.8, 0], size: [0.55, 0.16], grow: [0.7, 1.05],
          delay: 0.035, life: 0.22, color: [pal.mid, pal.tail], intensity: 0.7, occ: 0.65 });
      }
      dustRing(vfx, gx, gy, gz, { radius: 1.2, alpha: 0.7, life: 0.85 });
      dustPuffs(vfx, gx, gy, gz, { n: 4, spread: 0.3, size: [0.16, 0.4], alpha: 0.4 });
      vfx.light(g, { color: pal.mid, intensity: 2.03, distance: 2, life: 0.1 });
      accent(0.55);
      return;
    }

    // Real heavy moves carry knockdown; retain their weight-specific contact at +0.
    if (kind === 'heavy' || (kind === 'knockdown' && /^heavy/.test(o.moveId || ''))) {
      // Authored blunt burst and broken painted shock rim, with ground dust.
      vfx.fire.emit({ clip: 'blunt', pos: [q.x, q.y, q.z], size: [r.range(3.0,3.25), r.range(2.7,2.9)], life: .15,
        skew: r.range(-.24,.24), core: 10, radiance: 1.15, erosion: .06, grow: .22, growY: -.18, vel: [sw.x*1.4,sw.y*1.4,sw.z*1.4], rot: swA });
      sparkSpray(vfx, q, sw, { n: 14, speed: [8, 15], cone: 0.7, life: [0.12, 0.3], color: [pal.hot, pal.tail], intensity: 2.088, gravity: 11, floor: gy + 0.02 });
      metalChips(vfx,q,sw,true,gy);
      contactFill(t?.modelRoot,{x:p.x,y:(t?.pos.y || gy)+(t?.height || 1.8)*.60,z:p.z+.2},{strength:2.4,radius:1.25,life:.10,heavy:true});
      const arm=o.attacker?.model?.sockets?.R;
      if(arm) contactFill(o.attacker.modelRoot,arm.getWorldPosition(new THREE.Vector3()),{radius:.78,strength:1.4,life:.09});
      groundRing(vfx, gx, gy, gz, { radius: .80, color: ['#a68b69', '#65513d'], intensity: .34, life: .065, thick: [.14, .065], breakup: .90 });
      vfx.shape.emit({ shape: 'glow', mode: 'plane', pos: [gx, gy + .035, gz], size: [3.2, 2.8], life: .065, color: ['#ffc063', '#f47d20'], intensity: 1.5, p0: [2.6, .2] });
      if (nearGround) {
        dustRing(vfx, gx, gy, gz, { radius: .82, alpha: .55, life: .30, n: 6, band: false, size: [.15,.35] });
      }
      embers(vfx, q, { n: 5, dir, color: [pal.hot, pal.tail] });
      vfx.light({x:p.x,y:gy+.65,z:p.z+.18}, { color: '#ffd478', intensity: 6, distance: 2.6, life: .05 });
      accent(0.55);
      return;
    }

    if (kind === 'knockdown') {
      // The ranged light-string finisher keeps a short blade-direction contact before its floor slam.
      if (o.moveId === 'close_finisher') {
        // Foot contact needs a hot core even when the body is small and the kick floors it.
        // Compact compressed shock arc for a boot/pommel, separate from both blade clips.
        vfx.shape.emit({shape:'ring',pos:[q.x,q.y,q.z],size:[.68,.42],life:.075,rot:swA,
          color:['#fff4cc','#bd7131'],intensity:1.6,p0:[.32,.12,.85,1],p1:[.82,.035,.85,1],grow:[.7,1.1]});
        bladeLine(vfx,q,swA,{length:.48,width:.055,color:['#fff9df','#e9a44b'],life:.06,intensity:2.4});
      } else if (o.moveId === 'light_3') {
        vfx.fire.emit({ clip: 'slash', pos: [q.x, q.y, q.z + .025], size: [2.1, 1.5], life: .12,
          rot: swA, vel: [sw.x, sw.y, sw.z], grow: .20, growY: -.12, core: 8, radiance: 1.15, erosion: .08 });
      } else {
        vfx.fire.emit({ clip: 'blunt', pos: [q.x,q.y,q.z], size: [1.8,1.6], life: .12,
          core: 8, radiance: 1.15, erosion: .08, rot: swA });
      }
      // Low, wide dust-led body slam rooted at the victim's feet.
      const kick=o.moveId==='close_finisher';
      const ground = { x: gx, y: gy + .18, z: gz + .22 };
      coreGlow(vfx, ground, { size: .65, color: pal.hot, tail: pal.mid, intensity: 1.1, life: .05, core: .1 });
      vfx.fire.emit({ clip: 'knockdown', pos: [gx, gy + .48, q.z], size: kick ? [1.1,.55] : [3.8,1.4], life: kick ? .18 : .40,
        core: 0, erosion: .15, grow: .35, growY: .1, soft: .08, floor: gy });
      groundRing(vfx, gx, gy, gz, { radius: kick ? .48 : 1.9, color: kick ? ['#9c8060','#67513a'] : [pal.mid, pal.tail], intensity: kick ? .24 : .8, life: kick ? .055 : .26, breakup: .75 });
      dustRing(vfx, gx, gy, gz, { radius: kick ? .48 : 1.7, alpha: kick ? .5 : .8, life: kick ? .22 : .6, stretchX: kick ? 1 : 1.4, size: kick ? [.1,.3] : [.2,.65], n: kick ? 5 : 12, band: !kick });
      dustPuffs(vfx, gx, gy, gz, { n: kick ? 4 : 8, dir, bias: .7, speed: kick ? [.5,1.2] : [1.8,3.5], up: [.05,.3], size: kick ? [.12,.35] : [.25,.7], alpha: kick ? .5 : .7 });
      sparkSpray(vfx, ground, _dir.set(dir, .12, 0).normalize(), { n: 9, speed: [7, 13], cone: .7,
        life: [.07, .17], color: [pal.mid, pal.tail], intensity: 1.4, gravity: 18, floor: gy + .02 });
      vfx.light(ground, { color: pal.mid, intensity: 2.6, distance: 2, life: .07 });
      accent(0.55);
      return;
    }

    // KO: freeze-flash + soul wisp
    coreGlow(vfx, q, { size: 0.38, color: pal.mid, tail: pal.mid, intensity: 1.392, life: 0.12, hold: hs, core: 0.15 });
    flare(vfx, q, { width: 4.2, height: 0.42, color: ['#e4b440', '#a51e4c'], intensity: 0.95, life: 0.2, hold: hs });

    vfx.shape.emit({ shape: 'ring', pos: [q.x, q.y, q.z - 0.05], size: [2.1, 2.1], life: 0.3, hold: hs * 0.6, color: ['#e8b63f', '#a82855'], alpha: [1, 0], intensity: 0.8, p0: [0.55, 0.035, 0.8, 1], p1: [0.95, 0.025, 0.8, 1] });
    sparkSpray(vfx, q, sw, { n: 22, speed: [9, 18], cone: 0.8, life: [0.14, 0.36], color: [pal.hot, pal.tail], intensity: 2.32, gravity: 10, floor: gy + 0.02 });
    // soul wisp: a pale streak lifts off the body right after the freeze
    vfx.shape.emit({ shape: 'line', mode: 'axial', pos: [q.x, q.y + 0.9, q.z + 0.05], dir: [0, 1, 0], size: [1.8, 0.16], vel: [0, 2.5, 0], drag: 2, grow: [0.3, 1.2], growY: [1, 0.3],
      life: 0.45, delay: hs * 0.8, color: ['#e8f4ff', '#7aa0ff'], alpha: [1, 0], intensity: 0.928, p0: [0.5, 1, 1], occ: 0.2 });
    for (let i = 0; i < 6; i++) {
      vfx.add.emit({ pos: [q.x + r.range(-0.25, 0.25), q.y + r.range(0, 0.4), q.z + 0.05], vel: [r.range(-0.4, 0.4), r.range(1.8, 3.5), 0], life: r.range(0.5, 0.9), delay: hs * 0.8 + i * 0.03,
        size: [0.06, 0.02], color: ['#eef6ff', '#6a8cff'], intensity: 1.392, shape: 'ember', gravity: -0.5, drag: 1.2 });
      vfx.add.emit({ pos: [q.x + r.range(-0.7, 0.7), q.y + r.range(-0.5, 0.6), q.z + 0.05], life: 0.22, delay: 0.02 + i * 0.04, size: [0.2, 0.55], color: [pal.glint, pal.mid], intensity: 1.16, shape: 'glint', rot: r.range(-0.3, 0.3) });
    }
    if (nearGround) {
      dustRing(vfx, gx, gy, gz, { radius: 1.6, alpha: 0.7, life: 0.9 });
      groundRing(vfx, gx, gy, gz, { radius: 2.4, color: [pal.hot, pal.tail], intensity: 0.464, life: 0.45, delay: 0.06 });
    }
    vfx.light(q, { color: pal.mid, intensity: 2.9, distance: 2.4, life: 0.14 });
    accent(0.6);
  },
};
