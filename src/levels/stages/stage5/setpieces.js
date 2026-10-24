// Stage 5 set pieces + boss-arena hooks.
//   wakeStatues()      — the gallery guardians' eyes flare and they shudder; each one CRACKS APART (stone chips, dust,
//                        green flare) at the moment the foe spawned with opts.s5from = 'statue<i>' steps off its plinth.
//   burstDoor(i)       — a side door is flung open (leaves slam outward, dust, shake); foes with s5from 'door<i>' pour out.
//   crackArena(i, to)  — HOOK (Morvane phase 2): crack zone i spreads glowing fissures (to ≤ 1) or opens into a pit
//                        (to = 2; opens over ~1.2 s with shake + flares). crackAll() does the phase-2 sequence.
//   lowerCaptives()    — HOOK (finale): the chained Queen + consort are lowered to the dais floor.
//   surge(k, s)        — HOOK: witchfire flares hall-wide (k = strength, s = seconds) — boss intro / phase change.
import { WALL_Z, STATUE_Z, CRACKS } from './layout.js';
import { S5 } from './shading.js';

export function createSetPieces(ctx, { hall, floor, bursts }) {
  const { game } = ctx;
  const cam = game.cameraRig;
  const shake = (t) => { if (cam && cam.shake) cam.shake(t); };
  const play = (id, o) => { if (game.audio && game.audio.play) try { game.audio.play(id, o); } catch (e) { /* optional */ } };
  const pits = CRACKS.map(() => ({ cur: 0, target: 0 }));
  let surgeT = 0, surgeK = 0, surgeMax = 1;

  function wakeStatues() {
    for (const s of hall.statues) if (s.state === 0) { s.state = 1; s.t = 0; }
    play('stinger', { volume: 0.4, pitch: 0.6 });
    surge(0.6, 1.2);
  }
  function crumble(i) {
    const s = hall.statues[i];
    if (!s || s.state === 2) return;
    s.state = 2; s.m.visible = false;
    bursts.chips(s.x, 1.8, s.z + 0.3, 16); bursts.chips(s.x, 1.0, s.z + 0.3, 10);
    bursts.dust(s.x, 1.2, s.z + 0.4, 12, 1.1, [0.14, 0.15, 0.14]);
    bursts.flare(s.x, 2.6, s.z + 0.3, 0.8);
    shake(0.25); play('impact_heavy', { volume: 0.5, pitch: 0.5 });
  }
  function burstDoor(i) {
    const d = hall.doors[i];
    if (!d || d.target > 0) return;
    d.target = 1; d.v = 0;
    shake(0.35);
    bursts.dust(d.x, 0.4, WALL_Z + 1.8, 14, 1.3, [0.12, 0.13, 0.12]);
    bursts.chips(d.x, 1.2, WALL_Z + 1.7, 10);
    play('impact_heavy', { volume: 0.7, pitch: 0.6 });
  }
  function crackArena(i, to = 2) {
    const p = pits[i]; if (!p) return;
    p.target = Math.max(p.target, to);
    shake(to > 1 ? 0.45 : 0.2);
    const c = CRACKS[i];
    bursts.dust(c.x, 0.1, c.z, 10, 1.2, [0.1, 0.12, 0.1]);
    bursts.flare(c.x, 0.2, c.z, to > 1 ? 1.4 : 0.6);
    play('impact_heavy', { volume: 0.8, pitch: 0.4 });
  }
  function crackAll() {
    crackArena(1, 1);
    game.after(40, () => { crackArena(0, 1); crackArena(2, 1); });
    game.after(120, () => crackArena(1, 2));
    game.after(200, () => crackArena(0, 2));
    game.after(260, () => crackArena(2, 2));
  }
  function surge(k = 1, s = 1) { surgeK = k; surgeT = s; surgeMax = s; }

  // ---------------------------------------------------------------- arrivals (doors + statues)
  const openings = () => ({
    door0: { x: hall.doors[0].x, z: WALL_Z + 1.4, out: -2.0 },
    door1: { x: hall.doors[1].x, z: WALL_Z + 1.4, out: -2.0 },
    ...Object.fromEntries(hall.statues.map((s, i) => ['statue' + i, { x: s.x, z: STATUE_Z + 0.9, out: -2.0, statue: i }])),
  });
  function updateArrivals() {
    const band = game.world.band;
    const O = openings();
    for (const a of game.world.actors) {
      if (a.kind !== 'enemy' || !a.spawnOpts || !a.spawnOpts.s5from) continue;
      if (!a._s5arr) {
        const o = O[a.spawnOpts.s5from];
        if (!o) { a._s5arr = 2; continue; }
        a._s5arr = 1;
        a._s5bm = a.boundsMode; a.boundsMode = 'none';
        a.pos.x = o.x + (a.spawnOpts.dx || 0); a.pos.z = o.z;
        if (o.statue !== undefined) crumble(o.statue);
        if (a.moveTo) a.moveTo(a.pos.x + (a.spawnOpts.dx || 0) * 0.5, o.out);
        if (a.fsm && a.fsm.go) try { a.fsm.go('enter', { x: a.pos.x, z: o.out }); } catch (e) { /* ok */ }
      } else if (a._s5arr === 1) {
        if (a.pos.z > band.zMin + 0.05) { a._s5arr = 2; a.boundsMode = a._s5bm || 'band'; }
      }
    }
  }

  function update(dt) {
    updateArrivals();
    pits.forEach((p, i) => {
      if (p.cur < p.target) {
        p.cur = Math.min(p.target, p.cur + dt * (p.cur < 1 ? 0.9 : 0.85));
        floor.setPit(i, p.cur);
        if (p.cur > 1 && Math.random() < dt * 8) { const c = CRACKS[i]; bursts.chips(c.x + (Math.random() - 0.5) * c.r, 0.05, c.z + (Math.random() - 0.5) * c.r, 2); }
      }
    });
    if (surgeT > 0) { surgeT = Math.max(0, surgeT - dt); S5.s5Pulse.value = surgeK * Math.sin(Math.PI * (1 - surgeT / surgeMax)); } else S5.s5Pulse.value *= 0.9;
  }

  return {
    update, wakeStatues, crumble, burstDoor, crackArena, crackAll, surge,
    lowerCaptives() { for (const c of hall.captives) c.target = 1; },
    dispose() { S5.s5Pulse.value = 0; CRACKS.forEach((_, i) => floor.setPit(i, 0)); },
  };
}
