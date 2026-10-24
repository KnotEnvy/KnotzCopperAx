// Iron Chancellor Varkhul — visual attachments (chain-and-spiked-ball flail, tattered cloak) + intro / phaseShift
// choreography (bosses agent; paired with types/boss_varkhul.js and src/ai/bosses/varkhul.js).
import * as THREE from 'three';
import { fxSystem, cape } from './_fx.js';
import { reportError } from '../../core/log.js';
import { revealCam, introStandoff } from './_camera.js';
import { bossShade, bossGrade } from './_look.js';

const Q = typeof location !== 'undefined' ? location.search : '';
const OLD_INTRO = /[?&]varkhulintro=0/.test(Q), OLD_CARRY = /[?&]varkhulcarry=0/.test(Q);

function envOf(g) {
  const reg = typeof window !== 'undefined' && window.__KCA && window.__KCA.registry && window.__KCA.registry.stage4;
  return (g.levels && g.levels.env) || reg || null;
}

/** Iron chain (12 interlocking instanced links — 5 read as floating dots in the r8 stills) + spiked ball driven by damped verlet from the mace's `head_tip` anchor; attack moves override
 *  the ball target so smash slams the ground ahead and sweep/spin whip it around a wide arc. */
function flailRig(fx, b) {
  const game = b.game, H = b.height;
  const g = new THREE.Group(); g.name = 'varkhul_flail';
  const N = 12; let L = H * 0.42;
  const linkMat = new THREE.MeshStandardMaterial({ color: '#26282e', roughness: 0.45, metalness: 0.85 });
  const linkGeo = new THREE.TorusGeometry(H * 0.02, H * 0.0065, 6, 10);
  const links = new THREE.InstancedMesh(linkGeo, linkMat, N);
  links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  g.add(links);
  const ball = new THREE.Group(); g.add(ball);
  const fallback = () => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(H * 0.085, 1), new THREE.MeshStandardMaterial({ color: '#1c1e24', roughness: 0.4, metalness: 0.88 }));
    for (let i = 0; i < 12; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(H * 0.018, H * 0.06, 6), m.material); const d = new THREE.Vector3().randomDirection(); s.position.copy(d.clone().multiplyScalar(H * 0.08)); s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); m.add(s); }
    return m;
  };
  game.assets.instance('boss_varkhul_ball').then((inst) => {
    const r = inst && inst.source === 'glb' ? inst.root : fallback();
    if (inst && inst.source === 'glb') r.scale.setScalar(H / 2.0);          // built at the 2 m reference; ring at origin
    r.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // C2 r13 resume: the rebuilt ball (blackened iron, metallic, no kcaMetal extras) rendered pitch-black in the dark stage-4
    // hall — it was loaded raw, outside the character look. Grade it with the body's own handle: same look + boss grade as
    // the GLB body (kcaChar program family) and it follows bossShade() during the shaded emergence.
    if (inst && inst.source === 'glb' && !/[?&]ballgrade=0/.test(Q)) try { bossGrade(r, (b.def && b.def.grade) || {}, b.lightRig || null); } catch (e) { reportError('varkhul.ballGrade', e); }
    ball.add(r);
    // C2 r13: the ball's real bottom below the chain ring (the r13 asset hangs its centre 0.27 m under the ring) → floor clamp
    // (measured in the ball group's frame: the group may already sit at its world spot when the asset resolves)
    try { ball.updateWorldMatrix(true, true); const bb = new THREE.Box3().setFromObject(r); const by = new THREE.Vector3().setFromMatrixPosition(ball.matrixWorld).y; if (!bb.isEmpty()) rig.lowY = Math.max(H * 0.07, -(bb.min.y - by) * 0.92); } catch (e) { /* keep default */ }
  }).catch((e) => { reportError('varkhul.ball', e); ball.add(fallback()); });
  fx.add(g);
  const rig = {};   // (filled below; the ball loader writes rig.lowY once the GLB is in)
  const anchor = new THREE.Vector3(), p = new THREE.Vector3(b.pos.x, 0.3, b.pos.z), prev = p.clone();
  const tmp = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let tip = null;
  const findTip = () => {
    const w = b.model && b.model.weapon; if (!w) return;
    tip = w.getObjectByName('head_tip') || w;
    // C2 r13: Enemy Art's rebuilt flail is a short iron grip (head_tip +0.24 m at the 2 m reference, was 0.60): the chain
    // leaves the fist, so it gets longer to still reach the floor ahead of the lead foot
    if (tip !== w && tip.position && tip.position.y < 0.4) L = H * 0.52;
  };
  return Object.assign(rig, {
    ball: p, drive: null, driveK: 14, anchor, lowY: H * 0.07,
    update(dt) {
      if (!tip) findTip();
      if (tip) tip.getWorldPosition(anchor); else anchor.set(b.pos.x + b.facing * 0.6, H * 0.45, b.pos.z);
      const vel = tmp.copy(p).sub(prev).multiplyScalar(0.985);
      prev.copy(p);
      p.add(vel); p.y -= 9.8 * dt * dt * 1.2;
      if (this.drive) p.lerp(this.drive, Math.min(1, dt * this.driveK));
      const d = tmp.copy(p).sub(anchor), len = d.length();
      if (len > L) p.copy(anchor).addScaledVector(d.normalize(), L);
      if (p.y < this.lowY) p.y = this.lowY;
      ball.position.copy(p);
      const dir = tmp.copy(p).sub(anchor); const dl = dir.length() || 1; dir.divideScalar(dl);
      q.setFromUnitVectors(up, dir);
      for (let i = 0; i < N; i++) {
        const k = (i + 0.5) / N;
        const pos = anchor.clone().lerp(p, k); pos.y -= Math.sin(k * Math.PI) * Math.max(0, L - dl) * 0.5;
        const qi = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(up, (i % 2) * Math.PI / 2));
        m4.compose(pos, qi, new THREE.Vector3(1, 1, 1)); links.setMatrixAt(i, m4);
      }
      links.instanceMatrix.needsUpdate = true;
    },
  });
}

/** C2 r13 carry (board r12: "the flail hangs behind the body so the weapon drops out of the silhouette"): while he
 *  stands, stalks, walks or strides in, the spiked ball is drawn (softly — the verlet chain still swings) to a spot AHEAD
 *  of the lead foot, on the camera side, resting on / skimming the floor, so ball + chain read in front of the body and
 *  outside its outline in the lineup and the stage-4 intro. During the intro's flail spin it whirls round him at chest
 *  height. Reactions / knockdowns / attacks keep the free physics (attacks drive their own targets). */
const CARRY_STATES = new Set(['idle', 'walk', 'run', 'pause', 'puppet', 'bossIntro', 'taunt']);
function carry(b, flail, time) {
  const st = b.fsm && b.fsm.name;
  if (!CARRY_STATES.has(st)) return;
  const H = b.height, s = H / 3.15, f = b.facing || 1, a = flail.anchor;
  const cz = b.game.camera ? Math.sign(b.game.camera.position.z - b.pos.z) || 1 : 1;
  if (b._introSpin) {
    const ang = time * 7.5;
    flail.drive = (flail._dv || (flail._dv = new THREE.Vector3())).set(b.pos.x + Math.cos(ang) * H * 0.62, H * 0.62 + Math.sin(ang * 0.5) * H * 0.05, b.pos.z + Math.sin(ang) * H * 0.45);
    flail.driveK = 10;
    return;
  }
  const clip = b.animator && b.animator.name;
  const moving = clip === 'walk' || clip === 'run';
  const ph = moving ? time * (clip === 'run' ? 9 : 7.1) : time * 0.7;
  const sw = moving ? Math.sin(ph) : 0;
  // ahead of the haft tip (the fist is forward of the hip), toward the lens, on the floor (radius) — a little lift and
  // fore/aft swing in the stride, a slow sway at rest
  const x = Math.max(a.x + f * 0.22 * s, b.pos.x + f * 1.02 * s) + f * (moving ? 0.16 * s * sw : 0.04 * s * Math.sin(ph));
  const y = flail.lowY + (moving ? 0.1 * s * Math.max(0, Math.sin(ph * 2)) : 0);
  const z = b.pos.z + cz * 0.42 * s;
  flail.drive = (flail._dv || (flail._dv = new THREE.Vector3())).set(x, y, z);
  flail.driveK = moving ? 6 : 3.2;
}

/** C2 r13: Enemy Art's rebuilt Varkhul (blender/build_boss_varkhul.py; contract on docs/notes/_coord-C2.md) carries its
 *  own torn cape (a mesh named *cape*) and a short-grip flail (head_tip +0.24 m at the 2 m reference). Detect either. */
function r13Asset(b) {
  let capeMesh = false;
  if (b.modelRoot) b.modelRoot.traverse((o) => { if (o.isMesh && /cape/i.test(o.name || '')) capeMesh = true; });
  const w = b.model && b.model.weapon, tip = w && w.getObjectByName('head_tip');
  return { cape: capeMesh, flail: !!(tip && tip.position && tip.position.y < 0.4) };
}
/** The mass is in the new mesh (pauldrons + fur mantle ~1.6× wider): drop the r12 narrow-column bodyScale [0.88, 0.9]
 *  back to 1:1 and widen the push radius + hurtbox to the shoulders (height fit and hurt height unchanged: same hips). */
function fitR13(b) {
  if (b._r13fit || /[?&]varkhulfit=0/.test(Q)) return;
  b._r13fit = true;
  const bs = b.def && b.def.bodyScale;
  if (b.modelRoot && Array.isArray(bs) && !/[?&]bodyscale=0/.test(Q)) { b.modelRoot.scale.x /= bs[0]; b.modelRoot.scale.z /= (bs[1] ?? bs[0]); }
  b.radius = Math.max(b.radius || 0, 0.8);
  if (b.hurt) b.hurt.w = Math.max(b.hurt.w || 0, 1.6);
}

export function varkhulScript() {
  let fx = null, capeFx = null, flail = null, cam = null, strode = false;
  const S = {
    async setup(b, opts = {}) {
      fx = b.fx = fxSystem(b);
      const r13 = r13Asset(b);
      if (!r13.cape) capeFx = cape(fx, b, { color: '#6c1a1e', trim: '#d0a450', lining: '#a07834',   // C2 r1: darker now that the cape is key-lit (read coral)
        width: 1.05, length: 0.95, top: 0.8 });
      if (r13.cape || r13.flail) fitR13(b);
      flail = b.flail = flailRig(fx, b);
      b.homeX = b.pos.x;
      const gx = opts.hook && opts.hook.arena && opts.hook.arena.gateX;
      if (Number.isFinite(gx) && !opts.showcase) { b.pos.x = gx + 1.2; b.homeX = Math.max(b.homeX, gx - 1.6); b.gateStart = true; }
    },
    intro(b, t) {
      if (OLD_INTRO) return S.introR12(b, t);
      // C2 r13 (board r12: the IRON CHANCELLOR card lived 8 ticks of a 2 s clip, a ghost; he POPPED in on the same frame
      // as a full lightning flash): he is shaded out of the inner gate's darkness while he strides (a uniform ramp on his
      // own graded materials, t 1 → ~50, eyes/emissive stay lit), ONE softer lightning strike at t 14 back-lights the
      // silhouette (not on the reveal and not on the card), the name card goes up at t 46 mid-stride and HOLDS: the intro
      // runs ≥ 150 ticks past it (2.5 s card, ≈ 2 s at full opacity), with the flail spin + roar under the card. Random
      // storm strikes are held off for the whole intro. `&varkhulintro=0` = the r12 timeline.
      const g = b.game, env = envOf(g);
      if (t === 1) {
        if (env && env.sp && typeof env.sp.openInner === 'function') try { env.sp.openInner(); } catch (e) { reportError('stage4.openInner', e); }
        if (env && env.storm && typeof env.storm.quiet === 'function') try { env.storm.quiet(4.5); } catch (e) { reportError('stage4.quiet', e); }
        cam = revealCam(b, { yaw: 8, fill: 0.46, lift: 0.1 });
        bossShade(b.lightRig, 1);
        b.view.visible = true;
      }
      if (t <= 56) { const u = Math.max(0, Math.min(1, (t - 4) / 50)); bossShade(b.lightRig, 1 - u * u * (3 - 2 * u)); }
      if (t === 14 && env && env.storm && typeof env.storm.strike === 'function') try { env.storm.strike({ power: 0.62, x: b.pos.x - 6 }); } catch (e) { reportError('stage4.strike', e); }
      if (cam && cam.tick) { cam.tick(t); introStandoff(b, t, 3.2); }
      if (t === 46) { b.announce(); b._cardT = t; }
      // stride out from the gate to the fighting spot
      if (!strode) {
        const dx = b.homeX - b.pos.x;
        if (Math.abs(dx) > 0.25 && t < 80) { b.vel.x = Math.sign(dx) * 2.4; b.setFacing(dx); if (t % 30 === 1) b.play('walk', { fade: 0.2, loop: true }); return false; }
        strode = true; b.vel.x = 0; b.faceToward(b.heroes()[0] || { pos: { x: b.pos.x - 1 } });
        b.play('flail_spin', { restart: true, fade: 0.15, duration: 1.0 });
        b.introMark = t; b._introSpin = true;
      }
      const k = t - (b.introMark ?? t);
      if (k === 58) {
        b._introSpin = false;
        b.play('taunt', { restart: true, fade: 0.12 });
        if (g.cameraRig && g.cameraRig.shake) g.cameraRig.shake(0.22);
      }
      if (t >= (b._cardT ?? 46) + 150 && k >= 92) { bossShade(b.lightRig, 0); b._introSpin = false; if (cam) { cam.release(); cam = null; } return true; }
      return false;
    },
    introR12(b, t) {
      const g = b.game, env = envOf(g);
      if (t === 1) {
        if (env && env.sp && typeof env.sp.openInner === 'function') try { env.sp.openInner(); } catch (e) { reportError('stage4.openInner', e); }
        if (env && env.storm && typeof env.storm.strike === 'function') try { env.storm.strike(); } catch (e) { reportError('stage4.strike', e); }
        if (/[?&]bossreveal=0/.test(Q)) { if (g.cameraRig && g.cameraRig.drama) cam = g.cameraRig.drama({ focus: b, distance: 11, height: 3.0, fov: 30, lookHeight: b.height * 0.5, in: 0.6, hold: null, priority: 4 }); }
        else cam = revealCam(b, { yaw: 8, fill: 0.46, lift: 0.1 });
        b.view.visible = true;
      }
      if (cam && cam.tick) { cam.tick(t); introStandoff(b, t, 3.2); }
      if (!strode) {
        const dx = b.homeX - b.pos.x;
        if (Math.abs(dx) > 0.25 && t < 80) { b.vel.x = Math.sign(dx) * 2.4; b.setFacing(dx); if (t % 30 === 1) b.play('walk', { fade: 0.2, loop: true }); return false; }
        strode = true; b.vel.x = 0; b.faceToward(b.heroes()[0] || { pos: { x: b.pos.x - 1 } });
        b.play('flail_spin', { restart: true, fade: 0.15, duration: 1.0 });
        b.introMark = t;
      }
      const k = t - (b.introMark ?? t);
      if (k === 28) {
        b.play('taunt', { restart: true, fade: 0.1 });
        b.announce();
        if (env && env.storm && typeof env.storm.strike === 'function') try { env.storm.strike(); } catch (e) { reportError('stage4.strike', e); }
        if (g.cameraRig && g.cameraRig.shake) g.cameraRig.shake(0.5);
      }
      if (k >= 92) { if (cam) { cam.release(); cam = null; } return true; }
      return false;
    },
    phaseShift(b, t) {
      const g = b.game;
      if (t === 1) {
        if (g.cameraRig && g.cameraRig.drama) cam = g.cameraRig.drama({ focus: b, distance: 12, height: 3.4, fov: 31, lookHeight: b.height * 0.5, in: 0.4, hold: null, priority: 4 });
        b.play('summon', { restart: true, fade: 0.1, duration: 1.3 });
        b.flash('#ffd080', 20, 1.4);
        g.bus.emit('boss:rally', { boss: b });
        if (b.brain && b.brain.callWall) b.brain.callWall();
      }
      if (t === 70) b.play('taunt', { restart: true, fade: 0.1 });
      if (t >= 130) { if (cam) { cam.release(); cam = null; } return true; }
      return false;
    },
    update(b) { if (fx) fx.update(); },
    render(b, alpha, dt) {
      const time = b.game.time;
      if (capeFx) capeFx.update(dt, time);
      if (flail) {
        const run = b.attack, H = b.height;
        flail.drive = null; flail.driveK = 14;
        if (!run && !OLD_CARRY) carry(b, flail, time);
        if (run && b.moveId && b.moveId.startsWith('flail')) {
          const d = run.def, f = run.frame, s = d.startup || 0, a = d.active || 1;
          const k = Math.max(0, Math.min(1, (f - s * 0.4) / (s * 0.6 + a)));
          const fwd = b.facing;
          if (b.moveId === 'flail_smash') flail.drive = new THREE.Vector3(b.pos.x + fwd * H * (k < 0.7 ? -0.2 + k * 0.6 : 1.1), H * (k < 0.7 ? 1.2 : 0.1 + (1 - k) * 2), b.pos.z);
          else if (b.moveId === 'flail_sweep') { const ang = -2.2 + k * 3.6; flail.drive = new THREE.Vector3(b.pos.x + Math.cos(ang) * H * 0.85 * fwd, H * 0.45, b.pos.z + Math.sin(ang) * H * 0.6); }
          else if (b.moveId === 'flail_spin') { const ang = time * 9; flail.drive = new THREE.Vector3(b.pos.x + Math.cos(ang) * H * 0.75, H * 0.55, b.pos.z + Math.sin(ang) * H * 0.55); }
        }
        flail.update(Math.min(dt, 1 / 30));
      }
    },
    dispose(b) { bossShade(b.lightRig, 0); if (cam) { cam.release(); cam = null; } if (b.brain && b.brain.dispose) b.brain.dispose(); if (fx) fx.dispose(); },
  };
  return S;
}
