// Tusker: armoured war-boar (gameplay type; PLACEHOLDER procedural visual, no GLB yet).
//   Light / air = TUSK GORE: a short upward toss that launches (juggle starter).
//   Heavy / dash = CHARGE RAM: a long armoured charge that bowls through a crowd (multi-target, floors).
import * as THREE from 'three';
import { loadBeastRig, joint, lerp, ramp } from '../beastRig.js';
import { std, blob, limb, cone, aim } from '../proc.js';

function buildTusker() {
  const M = { hide: std('#5a4032', 0.85), bristle: std('#2e211a', 0.9), snout: std('#b07a68', 0.7), tusk: std('#efe3c4', 0.4), plate: std('#6d6a66', 0.35, 0.85), rivet: std('#c89a48', 0.4, 0.9), leather: std('#4a2616', 0.85), eye: std('#ffcf60', 0.3, 0, { emissive: '#ff9a30', emissiveIntensity: 1.2 }) };
  const root = new THREE.Group(); root.name = 'mount_tusker';
  const rj = joint('root', root);
  const hips = joint('hips', rj, [0, 0.82, -0.45]);
  const s1 = joint('spine_1', hips, [0, 0.04, 0.3]);
  const s2 = joint('spine_2', s1, [0, 0.03, 0.3]);
  const chest = joint('chest', s2, [0, 0.0, 0.25]);
  const head = joint('head', chest, [0, 0.0, 0.42]);
  const jaw = joint('jaw', head, [0, -0.1, 0.1]);
  hips.add(blob(0.42, [1.0, 0.95, 1.1], M.hide, 20));
  const mid = blob(0.46, [1.0, 1.0, 1.3], M.hide, 22); mid.position.z = 0.1; s1.add(mid);
  const sh = blob(0.5, [1.0, 1.08, 1.1], M.hide, 22); sh.position.set(0, 0.06, 0); chest.add(sh);
  // riveted armour plates (barding) over the back and brow
  for (const [j, z, r] of [[s1, 0.05, 0.5], [s2, 0.0, 0.52], [chest, 0.02, 0.55]]) { const p = blob(r, [1.05, 0.55, 0.7], M.plate, 18); p.position.set(0, 0.2, z); j.add(p); for (const s of [1, -1]) { const rv = blob(0.03, [1, 1, 1], M.rivet, 6); rv.position.set(s * r * 0.8, 0.12, z); j.add(rv); } }
  for (let i = 0; i < 9; i++) { const c = cone(0.04, 0.22, M.bristle, 5); c.position.set(0, 0.52, -0.1 + i * 0.12); aim(c, [0, 1, -0.4]); (i < 3 ? s1 : i < 6 ? s2 : chest).add(c); }
  head.add(blob(0.3, [0.95, 0.9, 1.2], M.hide, 18));
  const helm = blob(0.28, [1.05, 0.6, 1.05], M.plate, 16); helm.position.set(0, 0.14, 0.04); head.add(helm);
  const sn = blob(0.16, [1.1, 0.85, 1.4], M.hide, 14); sn.position.set(0, -0.06, 0.3); head.add(sn);
  const disc = blob(0.13, [1.1, 0.9, 0.3], M.snout, 12); disc.position.set(0, -0.06, 0.5); head.add(disc);
  for (const s of [1, -1]) {
    const tk = cone(0.045, 0.34, M.tusk, 10); tk.position.set(s * 0.12, -0.12, 0.34); aim(tk, [s * 0.35, 0.9, 0.5]); head.add(tk);
    const ear = cone(0.08, 0.2, M.bristle, 6); ear.position.set(s * 0.18, 0.2, -0.08); aim(ear, [s * 0.7, 0.6, -0.4]); head.add(ear);
    const eye = blob(0.028, [1, 0.7, 1], M.eye, 8); eye.position.set(s * 0.17, 0.05, 0.2); head.add(eye);
    const spk = cone(0.035, 0.16, M.plate, 6); spk.position.set(s * 0.12, 0.3, 0.1); aim(spk, [s * 0.3, 1, 0.4]); head.add(spk);
  }
  jaw.add(blob(0.12, [1, 0.5, 1.4], M.hide, 10));
  const seat = blob(0.28, [1.1, 0.3, 1.1], M.leather, 16); seat.position.set(0, 0.46, 0.05); s2.add(seat);
  const saddle = joint('socket_saddle', s2, [0, 0.54, 0.02]); saddle.userData.joint = false;
  let parent = hips;
  for (let i = 0; i < 3; i++) { const t = joint(`tail_${i + 1}`, parent, i ? [0, -0.04, -0.12] : [0, 0.12, -0.42]); t.add(blob(0.04 - i * 0.008, [1, 1, 1.4], M.hide, 8)); parent = t; }
  const tuft = cone(0.05, 0.14, M.bristle, 6); aim(tuft, [0, -0.6, -1]); parent.add(tuft);
  const leg = (name, par, p, thick) => {
    const L = name;
    const up = joint(`${L.startsWith('f') ? 'upperarm' : 'thigh'}_${L.slice(1)}`, par, p);
    up.add(blob(thick, [0.9, 1.3, 1.0], M.hide, 12)); const u = limb(thick * 0.8, thick * 0.55, 0.36, M.hide, 10); up.add(u);
    const lo = joint(`${L.startsWith('f') ? 'forearm' : 'shin'}_${L.slice(1)}`, up, [0, -0.36, 0]);
    const l = limb(thick * 0.5, thick * 0.42, 0.34, M.hide, 10); lo.add(l);
    const hoof = blob(thick * 0.5, [1, 0.6, 1.2], M.bristle, 10); hoof.position.set(0, -0.37, 0.02); lo.add(hoof);
  };
  leg('fL', chest, [0.24, -0.08, 0.05], 0.14); leg('fR', chest, [-0.24, -0.08, 0.05], 0.14);
  leg('hL', hips, [0.24, -0.06, 0.0], 0.15); leg('hR', hips, [-0.24, -0.06, 0.0], 0.15);
  return root;
}

function animateTusker(m, rig, dt, speed) {
  const R = rig.rot.bind(rig); rig.reset();
  const ph = m.gait, moving = Math.min(1, speed / 1), run = Math.min(1, speed / 7), amp = lerp(14, 36, run) * moving;
  for (const [L, off] of [['L', 0], ['R', Math.PI]]) {
    const p = ph + off;
    R(`thigh_${L}`, -Math.sin(p) * amp, 0, 0); R(`shin_${L}`, Math.max(0, Math.cos(p)) * amp * 0.8, 0, 0);
    R(`upperarm_${L}`, -Math.sin(p + Math.PI) * amp, 0, 0); R(`forearm_${L}`, -Math.max(0, Math.cos(p + Math.PI)) * amp * 0.8, 0, 0);
  }
  let headP = Math.sin(m.game.time * 1.5 + m.id) * 4, lean = 0;
  const act = m.action;
  if (act) {
    const f = act.frame, S = act.def.startup, T = act.total;
    if (act.id === 'gore') { headP = f < S ? 25 * ramp(f, 0, S) : -40 * (1 - ramp(f, S + 4, T)); }
    else if (act.id === 'charge') { const k = f < S ? ramp(f, 0, S) : 1 - ramp(f, T - 8, T); headP = 22 * k; lean = 8 * k; }
  }
  const hurt = m.flinch > 0 ? Math.sin((m.flinch / 12) * Math.PI) : 0;
  rig.pos('hips', 0, Math.abs(Math.sin(ph)) * 0.035 * moving, 0);
  R('hips', -lean * 0.3 - hurt * 6, 0, 0);
  R('head', headP - hurt * 15, 0, 0);
  for (let i = 1; i <= 3; i++) R(`tail_${i}`, 0, Math.sin(m.game.time * 6 + i) * 20, 0);
}

export default {
  id: 'tusker',
  name: 'Tusker',
  placeholder: true,
  hp: 60,
  speed: 3.6, run: 8.0, jump: 1.3, enemySpeed: 2.6,
  height: 1.7, radius: 0.72, saddleY: 1.36, soak: 0.6, stride: 2.0, hurtDepth: 0.55,
  leaveTicks: 720,
  buttons: { light: 'gore', heavy: 'charge', dash: 'charge', air: 'gore' },
  attacks: {
    gore: { anim: 'ride_attack', startup: 10, active: 6, recovery: 16, friction: 12,
      hits: [{ box: { x: 1.2, y: 0.2, w: 1.4, h: 1.3, d: 1.0 }, damage: 5, launch: 7.5, knockdown: true, knockback: 1.6, hitstop: 7, level: 'heavy', shake: 0.25 }] },
    charge: { anim: 'ride_idle', startup: 14, active: 30, recovery: 18, friction: 6, move: [{ from: 12, to: 44, speed: 10.5, ease: 'linear' }],
      hits: [{ box: { x: 1.0, y: 0.1, w: 1.6, h: 1.5, d: 1.1 }, damage: 6, knockdown: true, knockback: 6, launch: 4, hitstop: 5, level: 'heavy', shake: 0.3 }] },
  },
  async create(game, opts, { Mount, def }) {
    const m = new Mount(game, def, opts);
    const rig = await loadBeastRig(game, 'mount_tusker', buildTusker);
    m.body.add(rig.root); m.model = rig.root; m.rig = rig;
    const seat = rig.root.getObjectByName('socket_saddle');
    if (seat) seat.add(m.saddle); else { m.saddle.position.set(0, def.saddleY, 0); m.body.add(m.saddle); }
    m.animate = (dt, speed) => animateTusker(m, rig, dt, speed);
    return m;
  },
};
