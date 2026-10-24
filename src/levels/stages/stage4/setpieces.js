// Stage 4 set pieces:
//   gateSequence()   — the DRAWBRIDGE crashes down across the back moat (chains pay out), then the PORTCULLIS grinds
//                      up (camera tilts up to the adder sigil, lightning), foes march out of the gate over the deck.
//   burstDoor(i)     — a courtyard door is kicked open (leaves slam outward, dust, shake) and foes pour out.
//   awakenGargoyle() — HOOK: a gargoyle's eyes flare on a lightning strike, it shudders, tears free and leaps away
//                      (emits 'stage4:gargoyle' {pos}; a future gargoyle enemy type can spawn from it).
//   boulders         — BOULDER CHASE (§10): carved stone balls roll out of the upper gate, bound down the grand stair
//                      and across the belt TOWARD THE CAMERA, crushing anyone in their lane (heroes + foes).
//   arrivals         — enemies spawned with opts.s4from = 'gate'|'door0'|'door1'|'upper' emerge from that opening.
import * as THREE from 'three';
import { patchMaterial } from './shading.js';
import { GATE_X, WALL_Z, STAIRS, BERM_Z0 } from './layout.js';

const BOULDER_R = 1.15;

function boulderMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  return patchMaterial(m, {
    key: 'boulder',
    vertPars: 'varying vec3 vS4Local;\n', vertMain: 'vS4Local = position;\n', extraPars: 'varying vec3 vS4Local;\n',
    surface: /* glsl */`
      vec3 lp = normalize(vS4Local);
      // carved coil band spiralling round the ball (the adder), deep grooves either side
      float ang = atan(lp.z, lp.x);
      float band = abs(fract((lp.y * 2.2 + ang / 6.2832) * 1.0) - 0.5);
      float groove = smoothstep(0.05, 0.02, abs(band - 0.18));
      float scale = step(band, 0.16) * smoothstep(0.35, 0.6, s4n(vec2(ang * 9.0, lp.y * 26.0)));
      float f = s4fbm(vec2(ang * 3.0, lp.y * 4.0));
      diffuseColor.rgb = vec3(0.19, 0.185, 0.19) * (0.75 + 0.5 * f);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.27, 0.25, 0.22), step(band, 0.16) * 0.6 + scale * 0.2);
      diffuseColor.rgb *= 1.0 - groove * 0.8;
      s4WetM = 0.75; s4Mirror = 0.15; roughnessFactor = mix(0.45, 0.8, groove);`,
  });
}

function boulderGeometry() {
  const g = new THREE.IcosahedronGeometry(BOULDER_R, 4);
  const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 3.1 + v.y * 1.7) * Math.sin(v.z * 2.3 - v.y * 2.9) * 0.05 + Math.sin(v.x * 9 + v.z * 7) * 0.012;
    v.multiplyScalar(1 + n); p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function createSetPieces(ctx, { castle, storm, bursts }) {
  const { game, group } = ctx;
  const cam = game.cameraRig;
  const shake = (t) => cam && cam.shake && cam.shake(t);
  const play = (id, o) => { if (game.audio && game.audio.play) try { game.audio.play(id, o); } catch (e) { /* optional */ } };
  const st = { gate: null, gateDone: false, gargoyle: null, boulders: [], boulderOn: false, boulderNext: 0, doorQ: [] };
  const bGeo = boulderGeometry(), bMat = boulderMaterial();

  // ---------------------------------------------------------------- gate sequence
  function gateSequence() {
    if (st.gate || st.gateDone) return;
    st.gate = { t: 0, crashed: false, lifted: false };
    storm.quiet(6);
    if (cam && cam.drama) cam.drama({ distance: 19, height: 3.0, lookHeight: 4.6, fov: 38, focus: { x: GATE_X }, in: 1.0, hold: 4.6, out: 1.4, priority: 2 });
    play('impact_heavy', { volume: 0.5, pitch: 0.5 });
  }
  const openings = () => ({
    gate: { x: GATE_X, z: WALL_Z - 0.6, out: BERM_Z0 + 1.2, open: st.gateDone },
    door0: { x: castle.doors[0].x, z: WALL_Z - 0.9, out: -1.6, open: true },
    door1: { x: castle.doors[1].x, z: WALL_Z - 0.9, out: -1.6, open: true },
    upper: { x: 70, z: STAIRS.z1 + 1, out: -2, open: true },
  });
  function burstDoor(i) {
    const d = castle.doors[i];
    if (!d || d.target > 0) return;
    d.target = 1; d.v = 0;
    shake(0.35);
    bursts.dust(d.x, 0.4, WALL_Z + 0.3, 14, 1.3);
    bursts.chips(d.x, 1.2, WALL_Z + 0.2, 10);
    play('impact_heavy', { volume: 0.7, pitch: 0.7 });
    game.bus.emit('stage4:door', { index: i, x: d.x });
  }
  function awakenGargoyle() {
    if (st.gargoyle) return;
    const g = castle.gargoyle;
    st.gargoyle = { t: 0, p0: g.position.clone(), leapt: false };
    storm.strike({ power: 1.3, x: g.position.x + 6, near: true });
    play('roar_stormroc', { volume: 0.55, pitch: 1.35 });
    game.bus.emit('stage4:gargoyle', { phase: 'wake', pos: g.position.clone() });
  }
  function startBoulders(on = true) { st.boulderOn = on; st.boulderNext = on ? 1.5 : 0; }
  function spawnBoulder(x) {
    const m = new THREE.Mesh(bGeo, bMat); m.castShadow = true;
    const b = { m, x, y: STAIRS.rise + BOULDER_R, z: STAIRS.z1 - 0.5, vz: 3.5, vy: 0, hit: new Set(), t: 0, spin: 0, lastStep: -1 };
    m.position.set(b.x, b.y, b.z);
    group.add(m);
    st.boulders.push(b);
    castle.portUpper.userData.lift = 1;
    play('impact_heavy', { volume: 0.45, pitch: 0.4 });
    game.bus.emit('stage4:boulder', { x });
  }
  const stairY = (z) => {
    if (z >= STAIRS.z0) return 0;
    if (z <= STAIRS.z1) return STAIRS.rise;
    const k = (STAIRS.z0 - z) / (STAIRS.z0 - STAIRS.z1);
    return Math.ceil(k * STAIRS.steps) * (STAIRS.rise / STAIRS.steps);
  };

  function updateBoulders(dt) {
    if (st.boulderOn) {
      st.boulderNext -= dt;
      if (st.boulderNext <= 0) {
        const hx = heroX();
        spawnBoulder(THREE.MathUtils.clamp(hx + (game.fxRng ? game.fxRng.range(-2.5, 2.5) : 0), STAIRS.x0 + 1.6, STAIRS.x1 - 1.6));
        st.boulderNext = 4.2 + (game.fxRng ? game.fxRng.next() * 2.5 : 1);
      }
    }
    for (let i = st.boulders.length - 1; i >= 0; i--) {
      const b = st.boulders[i]; b.t += dt;
      b.vz = Math.min(11, b.vz + dt * (b.z < STAIRS.z0 ? 6 : 2.5));
      b.z += b.vz * dt;
      const gy = stairY(b.z) + BOULDER_R;
      b.vy -= 22 * dt; b.y += b.vy * dt;
      if (b.y < gy) {
        if (b.vy < -3) { shake(Math.min(0.3, 0.08 + (-b.vy) * 0.02)); bursts.dust(b.x, gy - BOULDER_R, b.z, 3, 0.7); }
        b.y = gy; b.vy = b.z < STAIRS.z0 ? 2.2 : Math.abs(b.vy) * 0.25;
      }
      b.spin += b.vz * dt / BOULDER_R;
      b.m.position.set(b.x, b.y, b.z);
      b.m.rotation.set(b.spin, 0, 0);
      // crush: anything in the lane at ground level
      if (b.z > -3.5 && b.z < 3.5) {
        for (const a of game.world.actors) {
          if (!a.alive || a.removed || !a.hurtable || b.hit.has(a.id) || (a.kind !== 'hero' && a.kind !== 'enemy')) continue;
          if (a.pos.y > 1.6) continue;                         // jumped over it
          const dx = a.pos.x - b.x, dz = a.pos.z - b.z;
          if (dx * dx + dz * dz < (BOULDER_R + 0.35) ** 2) {
            b.hit.add(a.id);
            if (game.combat) game.combat.applyHit(null, a, { damage: a.kind === 'hero' ? 14 : 30, knockdown: true, launch: 7, knockback: 5, hitstun: 30, hitstop: 6, level: 'heavy', dir: Math.sign(dx) || 1 });
            shake(0.35);
            bursts.chips(a.pos.x, 1, a.pos.z, 6);
          }
        }
      }
      if (b.z > 4 && !b.near) { b.near = true; shake(0.4); play('impact_heavy', { volume: 0.6, pitch: 0.35 }); }
      if (b.z > 17) { group.remove(b.m); st.boulders.splice(i, 1); }
    }
  }
  const heroX = () => {
    const hs = game.world.actors.filter((a) => a.kind === 'hero' && a.alive);
    return hs.length ? hs.reduce((s, h) => s + h.pos.x, 0) / hs.length : (STAIRS.x0 + STAIRS.x1) / 2;
  };

  // ---------------------------------------------------------------- arrivals from openings
  function updateArrivals() {
    const band = game.world.band;
    const O = openings();
    for (const a of game.world.actors) {
      if (a.kind !== 'enemy' || !a.spawnOpts || !a.spawnOpts.s4from) continue;
      if (!a._s4arr) {
        const o = O[a.spawnOpts.s4from];
        if (!o) { a._s4arr = 2; continue; }
        a._s4arr = 1;
        a._s4bm = a.boundsMode; a.boundsMode = 'none';
        a.pos.x = o.x + (a.spawnOpts.dx || 0); a.pos.z = o.z;
        if (a.spawnOpts.s4from === 'upper') { a.pos.y = 0; a._s4up = true; }
        if (a.moveTo) a.moveTo(a.pos.x + (a.spawnOpts.dx || 0) * 0.5, o.out);
        if (a.fsm && a.fsm.go) try { a.fsm.go('enter', { x: a.pos.x, z: o.out }); } catch (e) { /* ok */ }
      } else if (a._s4arr === 1) {
        if (a._s4up) a.groundY = stairY(a.pos.z);
        if (a.pos.z > band.zMin + 0.05) { a._s4arr = 2; a.boundsMode = a._s4bm || 'band'; a.groundY = 0; }
      }
    }
  }

  // ---------------------------------------------------------------- per-tick
  function update(dt, t) {
    // gate: drawbridge falls (ease-in, bounce), then the portcullis grinds up
    const G = st.gate;
    if (G) {
      G.t += dt;
      const k = Math.min(1, Math.max(0, (G.t - 0.6) / 1.5));
      let lower = k * k;
      if (k >= 1 && !G.crashed) {
        G.crashed = true; shake(0.55);
        bursts.dust(GATE_X, 0.2, BERM_Z0 + 0.3, 18, 1.6);
        bursts.splash(GATE_X - 2.4, -1.2, -5.2, 1.2); bursts.splash(GATE_X + 2.4, -1.2, -5.2, 1.2);
        play('impact_heavy', { volume: 0.9, pitch: 0.45 });
        storm.strike({ power: 1.2, x: GATE_X - 30 });
      }
      if (G.crashed) lower = 1 - Math.max(0, Math.sin(Math.min(1, (G.t - 2.1) / 0.35) * Math.PI)) * 0.04;
      castle.bridge.set(lower);
      const lift = THREE.MathUtils.smoothstep(G.t, 2.8, 5.4);
      castle.portOuter.position.y = -0.8 + lift * 6.4;
      castle.portOuter.position.x = GATE_X + Math.sin(G.t * 40) * 0.006 * (lift > 0 && lift < 1 ? 1 : 0);
      if (lift > 0 && lift < 1 && Math.floor(G.t * 6) !== G.rattle) { G.rattle = Math.floor(G.t * 6); shake(0.05); }
      if (lift >= 1 && !G.lifted) { G.lifted = true; st.gateDone = true; game.bus.emit('stage4:gate', { open: true }); }
      if (G.t > 6.5) st.gate = null;
    }
    // doors swing outward fast (spring + slam), stay open
    for (const d of castle.doors) {
      if (d.target <= 0) continue;
      d.v += (d.target - d.open) * 90 * dt - d.v * 9 * dt;
      d.open += d.v * dt;
      const a = d.open * 1.75;
      d.L.rotation.y = -a; d.R.rotation.y = a;
    }
    // gargoyle: shudder → eyes flare → leap off in an arc away over the wall, gone
    const S = st.gargoyle;
    if (S) {
      S.t += dt;
      const g = castle.gargoyle;
      const glow = castle.gargoyleMat.userData.s4.s4Glow;
      glow.value = S.t < 0.2 ? 0.3 : Math.min(9, 0.3 + (S.t - 0.2) * 12);
      if (S.t < 1.6) {
        g.position.x = S.p0.x + Math.sin(S.t * 60) * 0.02 * Math.min(1, S.t);
        g.rotation.y = Math.sin(S.t * 2.5) * 0.3 * Math.min(1, S.t);
        if (Math.floor(S.t * 5) !== S.k) { S.k = Math.floor(S.t * 5); bursts.chips(S.p0.x, S.p0.y, S.p0.z + 0.6, 2); }
      } else {
        if (!S.leapt) { S.leapt = true; bursts.dust(S.p0.x, S.p0.y, S.p0.z + 0.4, 8, 0.9); play('roar_stormroc', { volume: 0.6, pitch: 1.5 }); game.bus.emit('stage4:gargoyle', { phase: 'leap', pos: g.position.clone() }); }
        const u = S.t - 1.6;
        g.position.set(S.p0.x + u * 7, S.p0.y + u * 9 - u * u * 2.5, S.p0.z - u * 3.5);
        g.rotation.set(-u * 0.8, u * 1.5, 0);
        if (u > 3) { g.visible = false; st.gargoyle = { ...S, done: true, t: 99 }; }
      }
      if (S.done) st.gargoyle.t = 99;
    }
    // upper portcullis rises for each boulder then drops back
    const pu = castle.portUpper;
    if (pu.userData.lift) { pu.userData.l = Math.min(1, (pu.userData.l || 0) + dt * 2.5); if (pu.userData.l >= 1) pu.userData.lift = 0; }
    else if (pu.userData.l) pu.userData.l = Math.max(0, pu.userData.l - dt * 0.7);
    pu.position.y = STAIRS.rise + (pu.userData.l || 0) * 4.2;
    updateBoulders(dt);
    updateArrivals();
    void t;
  }
  return {
    update, gateSequence, burstDoor, awakenGargoyle, startBoulders, spawnBoulder, st,
    bridgeDown: () => castle.bridge.lower > 0.9,
    openInner() { castle.portInner.userData.open = true; },
    dispose() { for (const b of st.boulders) group.remove(b.m); st.boulders.length = 0; },
  };
}
