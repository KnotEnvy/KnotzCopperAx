// Cluckhorn: bipedal beaked beast with a spiked club-tail (the GA "chicken leg" analogue).
//   Light / air = TAIL WHIP: it spins round to face away (delayed, turn-around wind-up), the spiked club sweeps
//                 through where it was facing, then it turns back. Knocks down. (GA: 8)
//   Heavy / dash (run + attack) = BEAK RAM: a fast lunge, head low. (GA: dash 4)
// Visual: GLB `mount_cluckhorn` (blender/build_mount_cluckhorn.py, beast_biped rig) when present, else the procedural
// model below (same joint names), animated procedurally by beastRig (gait with chicken head-bob, tail whip spin).
import * as THREE from 'three';
import { loadBeastRig, joint, lerp, ramp } from '../beastRig.js';
import { std, blob, limb, cone, aim } from '../proc.js';

export const PAL = { hide: '#9a7446', hide2: '#6e4c2c', belly: '#e0c79a', beak: '#e7a93a', leg: '#d89a3a', horn: '#efe3c4', iron: '#3c3a40', collar: '#e0b030', leather: '#6a2e1c', brass: '#c89a48', eye: '#140c08', comb: '#b8342a' };


export function buildCluckhorn() {
  const M = Object.fromEntries(Object.entries(PAL).map(([k, c]) => [k, std(c, k === 'iron' ? 0.35 : k === 'brass' ? 0.4 : k === 'beak' || k === 'horn' ? 0.45 : 0.8, k === 'iron' ? 0.8 : k === 'brass' ? 0.9 : 0)]));
  const root = new THREE.Group(); root.name = 'mount_cluckhorn';
  const rj = joint('root', root, [0, 0, 0]);
  const hips = joint('hips', rj, [0, 1.05, -0.05]);
  const sp1 = joint('spine_1', hips, [0, 0.05, 0.2]);
  const sp2 = joint('spine_2', sp1, [0, 0.03, 0.2]);
  const chest = joint('chest', sp2, [0, 0.0, 0.22]);
  const n1 = joint('neck_1', chest, [0, 0.18, 0.2]);
  const n2 = joint('neck_2', n1, [0, 0.26, 0.08]);
  const n3 = joint('neck_3', n2, [0, 0.24, 0.02]);
  const head = joint('head', n3, [0, 0.16, 0.06]);
  const jaw = joint('jaw', head, [0, -0.04, 0.1]);
  // Body: plump feathered barrel, pale belly, darker back
  const body = blob(0.5, [1.0, 0.92, 1.35], M.hide, 28); body.position.set(0, 0.1, 0.12); hips.add(body);
  const belly = blob(0.42, [0.92, 0.8, 1.05], M.belly, 24); belly.position.set(0, -0.08, 0.3); hips.add(belly);
  const breast = blob(0.36, [1.0, 1.05, 0.9], M.belly, 22); breast.position.set(0, 0.02, 0.12); chest.add(breast);
  // Feather tufts: overlapping cones along the flanks and rump (reads as plumage at game distance)
  const fg = new THREE.ConeGeometry(0.09, 0.42, 5); fg.translate(0, 0.21, 0);
  const feathers = [];
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1, k = Math.floor(i / 2) / 12;
    const f = new THREE.Mesh(fg, i % 3 ? M.hide2 : M.hide); f.castShadow = true;
    f.position.set(side * lerp(0.46, 0.3, k), lerp(0.18, 0.28, Math.sin(k * 3)), lerp(0.35, -0.55, k));
    aim(f, [side * 0.55, 0.35 - k * 0.2, -1]); f.scale.setScalar(lerp(0.9, 1.35, k)); hips.add(f); feathers.push(f);
  }
  // Wing stubs (tiny, folded)
  for (const s of [1, -1]) { const w = blob(0.2, [0.35, 0.7, 1.4], M.hide2, 14); w.position.set(s * 0.47, 0.12, 0.05); w.rotation.set(-0.25, s * 0.2, s * 0.35); hips.add(w); }
  // Neck: overlapping segments (no gaps when bent) + feather ruff at the base
  const nk = [[n1, 0.2, 0.17, 0.3], [n2, 0.17, 0.14, 0.28], [n3, 0.14, 0.13, 0.22]];
  for (const [j, r0, r1, l] of nk) { const s = limb(r0, r1, l, M.hide, 14); s.rotation.x = Math.PI; s.position.y = 0; j.add(s); const cap = blob(r0 * 1.02, [1, 1, 1], M.hide, 14); j.add(cap); }
  n1.children.forEach((c) => { if (c.isMesh && c.geometry.type === 'CylinderGeometry') { c.rotation.x = Math.PI - 0.55; } });
  n2.children.forEach((c) => { if (c.isMesh && c.geometry.type === 'CylinderGeometry') { c.rotation.x = Math.PI - 0.28; } });
  n3.children.forEach((c) => { if (c.isMesh && c.geometry.type === 'CylinderGeometry') { c.rotation.x = Math.PI - 0.2; } });
  // Spiked yellow collar at the neck base (GA reference: spiked yellow collar)
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.05, 8, 20), M.collar); collar.rotation.x = Math.PI / 2 - 0.55; collar.position.set(0, 0.08, 0.02); n1.add(collar);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; const c = cone(0.035, 0.12, M.iron, 6); c.position.set(Math.cos(a) * 0.24, 0.08 + Math.sin(a) * 0.24 * Math.sin(0.55), Math.sin(a) * 0.24 * Math.cos(0.55) + 0.02); aim(c, [Math.cos(a), Math.sin(a) * 0.5, Math.sin(a) * 0.8]); n1.add(c); }
  // Head: rounded skull, big hooked beak, comb, brow horns, eyes
  const skull = blob(0.17, [0.95, 0.9, 1.15], M.hide, 20); skull.position.set(0, 0.02, 0.02); head.add(skull);
  const cheek = blob(0.13, [1.1, 0.8, 1.0], M.belly, 16); cheek.position.set(0, -0.05, 0.08); head.add(cheek);
  const upper = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 12), M.beak); upper.rotation.x = Math.PI / 2 + 0.25; upper.position.set(0, 0.0, 0.25); upper.scale.set(1, 1, 0.8); upper.castShadow = true; head.add(upper);
  const hook = blob(0.05, [0.8, 1, 1.2], M.beak, 10); hook.position.set(0, -0.06, 0.4); head.add(hook);
  const lower = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.24, 10), M.beak); lower.rotation.x = Math.PI / 2 + 0.05; lower.position.set(0, -0.05, 0.12); lower.castShadow = true; jaw.add(lower);
  for (let i = 0; i < 4; i++) { const c = blob(0.05 - i * 0.006, [0.4, 1.1, 1], M.comb, 10); c.position.set(0, 0.17 - i * 0.012, 0.08 - i * 0.075); head.add(c); }
  for (const s of [1, -1]) {
    const eye = blob(0.034, [1, 1, 0.8], M.eye, 10); eye.position.set(s * 0.13, 0.05, 0.1); head.add(eye);
    const glint = blob(0.01, [1, 1, 1], std('#fff6e0', 0.2, 0, { emissive: '#fff6e0', emissiveIntensity: 0.6 }), 6); glint.position.set(s * 0.155, 0.065, 0.115); head.add(glint);
    const brow = blob(0.05, [0.9, 0.4, 1.1], M.hide2, 10); brow.position.set(s * 0.11, 0.1, 0.1); brow.rotation.z = s * 0.3; head.add(brow);
    const hn = cone(0.045, 0.3, M.horn, 10); hn.position.set(s * 0.1, 0.12, -0.02); aim(hn, [s * 0.5, 0.55, -0.8]); head.add(hn);
  }
  // Saddle (leather + brass) on spine_2, with stirrups; the rider's origin socket sits on top.
  const seat = blob(0.3, [1.05, 0.28, 1.25], M.leather, 18); seat.position.set(0, 0.4, 0.0); sp2.add(seat);
  const cantle = blob(0.2, [1.2, 0.55, 0.35], M.leather, 14); cantle.position.set(0, 0.48, -0.28); sp2.add(cantle);
  const pommel = blob(0.07, [1, 1.4, 1], M.brass, 10); pommel.position.set(0, 0.5, 0.28); sp2.add(pommel);
  const blanket = blob(0.42, [1.12, 0.2, 1.1], std('#7e2a24', 0.9), 18); blanket.position.set(0, 0.3, 0.0); sp2.add(blanket);
  for (const s of [1, -1]) { const strap = limb(0.02, 0.02, 0.5, M.leather, 6); strap.position.set(s * 0.44, 0.34, 0.05); strap.rotation.z = s * 0.12; sp2.add(strap); const st = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 6, 12), M.brass); st.position.set(s * 0.49, -0.18, 0.05); st.rotation.y = Math.PI / 2; sp2.add(st); }
  const saddle = joint('socket_saddle', sp2, [0, 0.47, -0.02]);
  saddle.userData.joint = false;
  // Tail: 6 joints tapering to a spiked iron-studded bone club
  let parent = hips, tails = [];
  const tailP = [[0, 0.12, -0.62], [0, 0.03, -0.26], [0, 0.0, -0.26], [0, -0.02, -0.24], [0, -0.03, -0.22], [0, -0.02, -0.2]];
  tailP.forEach((p, i) => {
    const t = joint(`tail_${i + 1}`, parent, p);
    const r = lerp(0.2, 0.07, i / 5);
    const seg = limb(r, r * 0.82, 0.3, i % 2 ? M.hide2 : M.hide, 12); seg.rotation.x = -Math.PI / 2; t.add(seg);
    t.add(blob(r, [1, 1, 1], i % 2 ? M.hide2 : M.hide, 12));
    parent = t; tails.push(t);
  });
  const club = blob(0.2, [1, 0.9, 1.25], M.horn, 18); club.position.set(0, 0, -0.26); parent.add(club);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, ring = i % 2;
    const c = cone(0.045, 0.2, M.iron, 7); c.position.set(Math.cos(a) * 0.17, Math.sin(a) * 0.16, -0.22 - ring * 0.12); aim(c, [Math.cos(a), Math.sin(a), -0.3]); parent.add(c);
  }
  const tip = cone(0.06, 0.24, M.iron, 8); tip.position.set(0, 0, -0.46); aim(tip, [0, 0, -1]); parent.add(tip);
  // Legs: digitigrade chicken legs — feathered thigh, scaly yellow shank, 3 forward toes + spur
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const th = joint(`thigh_${L}`, hips, [s * 0.3, -0.02, 0.05]);
    th.add(blob(0.22, [0.85, 1.3, 1.0], M.hide, 16));
    const tm = limb(0.2, 0.13, 0.4, M.hide2, 12); tm.rotation.x = -0.45; th.add(tm);
    const sh = joint(`shin_${L}`, th, [0, -0.37, 0.17]);
    const sm = limb(0.1, 0.07, 0.38, M.leg, 10); sm.rotation.x = 0.8; sh.add(sm); sh.add(blob(0.1, [1, 1, 1], M.leg, 10));
    const mt = joint(`metatarsal_${L}`, sh, [0, -0.26, -0.28]);
    const mm = limb(0.07, 0.055, 0.36, M.leg, 10); mm.rotation.x = -0.18; mt.add(mm); mt.add(blob(0.075, [1, 1, 1], M.leg, 10));
    const spur = cone(0.02, 0.12, M.horn, 6); spur.position.set(0, -0.12, -0.04); aim(spur, [0, -0.3, -1]); mt.add(spur);
    const ft = joint(`foot_${L}`, mt, [0, -0.36, -0.06]);
    ft.add(blob(0.07, [1.1, 0.6, 1.1], M.leg, 10));
    const tj = joint(`toe_${L}`, ft, [0, -0.02, 0.04]);
    for (const a of [-0.5, 0, 0.5]) {
      const tg = limb(0.035, 0.022, 0.24, M.leg, 6); tg.rotation.set(Math.PI / 2 + 0.1, 0, 0); tg.rotation.z = 0; const holder = new THREE.Group(); holder.rotation.y = a; holder.add(tg); tj.add(holder);
      const cl = cone(0.02, 0.07, M.horn, 5); cl.position.set(Math.sin(a) * 0.25, -0.04, Math.cos(a) * 0.25); aim(cl, [Math.sin(a), -0.5, Math.cos(a)]); tj.add(cl);
    }
    const back = limb(0.025, 0.018, 0.12, M.leg, 6); back.rotation.x = -Math.PI / 2 - 0.2; tj.add(back);
  }
  root.userData.feathers = feathers;
  return root;
}

/** Tail-whip swoosh: a hidden bar on tail_6 (grip back at tail_4, tip past the club) is the "weapon" of a proxy
 *  actor for vfx.trails, so the whip gets the same tapered crescent ribbon as hero weapons (one shared draw call). */
const _tip = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _s = new THREE.Vector3();
const WHIP_TRAIL = { base: 0.3, tip: 1.0, span: 0.8, taper: 1.15, persist: 0.2, alpha: 0.95, width: 1, minSpeed: 3, fullSpeed: 9, selfMask: false, color: ['#fff6e4', '#e2a860'] };
function whipTrail(m) {
  if (m._whip !== undefined) return m._whip;
  m._whip = null;
  const J = m.rig && m.rig.J, t6 = J && J.tail_6, t4 = J && (J.tail_4 || J.tail_3);
  if (!t6 || !t4) return null;
  t6.updateWorldMatrix(true, false);
  t4.getWorldPosition(_a); t6.getWorldPosition(_b);
  const dir = _s.subVectors(_b, _a).normalize().clone();
  const tipW = _b.clone().addScaledVector(dir, 0.55);                       // past the spiked club
  const holder = new THREE.Object3D(); holder.name = 'whip_trail_ref';
  t6.getWorldScale(_s); holder.scale.set(1 / (_s.x || 1), 1 / (_s.y || 1), 1 / (_s.z || 1)); // metres, whatever the bone scale
  t6.add(holder); holder.updateWorldMatrix(true, false);
  const inv = holder.matrixWorld.clone().invert();
  const aL = _a.clone().applyMatrix4(inv), tL = tipW.applyMatrix4(inv), len = aL.distanceTo(tL);
  const geo = new THREE.BoxGeometry(0.02, len, 0.02); geo.translate(0, len / 2, 0);
  const bar = new THREE.Mesh(geo, new THREE.MeshBasicMaterial()); bar.visible = false; bar.name = 'whip_trail_bar';
  bar.position.copy(aL); bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tL.clone().sub(aL).normalize());
  holder.add(bar);
  const proxy = { kind: 'mount', typeId: 'cluckhorn_whip', team: m.team, def: { trail: WHIP_TRAIL }, model: { weapon: bar },
    get removed() { return m.removed; }, get hitstop() { return m.hitstop; }, get attack() { return null; } };
  return (m._whip = { proxy, bar, len, last: null, lastF: -9 });
}

/** Pose driver shared by the GLB and the procedural fallback. */
export function animateCluckhorn(m, rig, dt, speed) {
  const R = rig.rot.bind(rig);
  rig.reset();
  const ph = m.gait;
  const act = m.action;
  const run = Math.min(1, speed / 6.5);
  const moving = Math.min(1, speed / 1.2);
  // ---- locomotion: digitigrade stride
  const amp = lerp(10, 38, run) * moving;
  let bodyYaw = 0, crouch = 0, lean = 0, neckFwd = 0, tailSwing = 0, tailLift = 0, headPitch = 0, jawOpen = 0;
  for (const [L, off] of [['L', 0], ['R', Math.PI]]) {
    const p = ph + off, sw = Math.sin(p), lift = Math.max(0, Math.cos(p));
    R(`thigh_${L}`, -sw * amp - 8 * run, 0, 0);
    R(`shin_${L}`, -lift * amp * 1.1 * moving, 0, 0);
    R(`metatarsal_${L}`, lift * amp * 1.2 * moving, 0, 0);
    R(`toe_${L}`, (lift * 40 - sw * 10) * moving, 0, 0);
  }
  const bob = Math.abs(Math.sin(ph)) * 0.05 * moving;
  // chicken head-bob: the head holds still in space then snaps forward each step
  neckFwd = moving * (Math.sin(ph * 2) > 0 ? 1 : -0.3) * lerp(8, 4, run);
  tailSwing = Math.sin(ph) * 8 * moving;
  lean = lerp(0, 14, run);
  // ---- idle life
  const t = m.game.time;
  const breathe = Math.sin(t * 2.2) * 0.012;
  const look = (1 - moving) * Math.sin(t * 0.7 + m.id) * 18;
  const tailIdle = (1 - moving) * Math.sin(t * 1.3 + m.id) * 10;
  // ---- attacks
  if (act) {
    const f = act.frame, d = act.def;
    if (act.id === 'tail_whip') {
      const S = d.startup, A = S + d.active, T = act.total;
      // spin to face away over the wind-up, whip through the active window, turn back in recovery
      const spin = f < S ? ramp(f, 2, S - 2) : f < A ? 1 : 1 - ramp(f, A + 4, T);
      bodyYaw = 180 * spin;
      crouch = f < S ? ramp(f, 0, S) * 0.08 : 0.08 * (1 - ramp(f, A, T));
      // the club is MID-SWEEP (fastest) on the first active frame, so the ribbon + impact land together
      const whip = f < S - 4 ? -ramp(f, S * 0.4, S - 4) : f < A ? lerp(-1, 1, ramp(f, S - 4, S + 5)) : 1 - ramp(f, A, T);
      tailSwing = whip * 55; tailLift = f < A ? 12 : 0;
      neckFwd = -10 * spin; headPitch = -12 * spin; jawOpen = f >= S && f < A ? 1 : 0;
    } else if (act.id === 'beak_ram') {
      const S = d.startup;
      const k = f < S ? ramp(f, 0, S) : 1 - ramp(f, act.total - 8, act.total);
      neckFwd = 40 * k; headPitch = 28 * k; lean = Math.max(lean, 24 * k); jawOpen = k; tailLift = 20 * k;
    }
  }
  if (!m.grounded) { for (const L of ['L', 'R']) { R(`thigh_${L}`, -30, 0, 0); R(`shin_${L}`, -40, 0, 0); R(`metatarsal_${L}`, 55, 0, 0); } tailLift += 10; }
  // hurt jolt
  const hurt = m.flinch > 0 ? Math.sin((m.flinch / 12) * Math.PI) : 0;
  R('root', 0, bodyYaw, 0);
  m.spinYaw = bodyYaw * Math.PI / 180; // the rider turns with the beast (MountSystem.render)
  rig.pos('hips', 0, bob + breathe - crouch, 0);
  R('hips', lean * 0.4 - hurt * 10, 0, hurt * 8 * (m.hurtLean || 1) * -m.facing);
  R('spine_1', lean * 0.2, 0, 0);
  R('chest', -lean * 0.3, 0, 0);
  R('neck_1', -12 + neckFwd * 0.6 - lean * 0.2, look * 0.3, 0);
  R('neck_2', neckFwd * 0.6, look * 0.3, 0);
  R('neck_3', neckFwd * 0.3, look * 0.4, 0);
  R('head', headPitch - neckFwd * 0.9 + hurt * -20, look * 0.3, 0);
  R('jaw', jawOpen * 28 + hurt * 20, 0, 0);
  for (let i = 1; i <= 6; i++) R(`tail_${i}`, -tailLift / 6 - (i === 1 ? 6 : 0), (tailSwing + tailIdle) * (0.16 + i * 0.05), 0);
}

export default {
  id: 'cluckhorn',
  name: 'Cluckhorn',
  hp: 40,
  speed: 4.4, run: 8.6, jump: 2.0, enemySpeed: 3.1,
  height: 2.3, radius: 0.62, saddleY: 1.52, soak: 0.5, stride: 1.7,
  leaveTicks: 720,
  buttons: { light: 'tail_whip', heavy: 'beak_ram', dash: 'beak_ram', air: 'tail_whip' },
  attacks: {
    // turn-around wind-up (GA: "spins to face away, so the whip is powerful but delayed")
    tail_whip: { anim: 'ride_attack', startup: 16, active: 9, recovery: 20, friction: 12,
      hits: [{ box: { x: 0.5, y: 0.1, w: 3.6, h: 1.5, d: 1.3 }, damage: 8, knockdown: true, knockback: 5.2, launch: 4.6, hitstop: 8, level: 'heavy', shake: 0.35, spark: 'mount_whip' }] },
    beak_ram: { anim: 'ride_idle', startup: 6, active: 14, recovery: 14, friction: 8,
      move: [{ from: 3, to: 20, speed: 9.5, ease: 'out' }],
      hits: [{ box: { x: 1.0, y: 0.4, w: 1.5, h: 1.4, d: 1.0 }, damage: 4, knockdown: true, knockback: 4.4, launch: 3.2, hitstop: 6, level: 'light', shake: 0.2 }] },
  },
  onAttackTick(m, rider, run, id) {
    if (id !== 'tail_whip') return;
    const d = m.attacks.tail_whip, S = d.startup ?? 16, A = S + (d.active ?? 9), f = run.frame, g = m.game;
    if (f < S - 5 || f > A + 1 || !g.vfx) return;
    const tr = whipTrail(m);
    if (!tr) return;
    if (g.vfx.trails) g.vfx.trails.start(tr.proxy, { seconds: 0.05 });
    // accents off the club head (air streaks, flecks, ground dust) from its tick-to-tick motion
    tr.bar.updateWorldMatrix(true, false);
    const p = _tip.set(0, tr.len, 0).applyMatrix4(tr.bar.matrixWorld);
    if (tr.last && tr.lastF === f - 1) {
      const vel = { x: (p.x - tr.last.x) * 60, y: (p.y - tr.last.y) * 60, z: (p.z - tr.last.z) * 60 };
      g.vfx.spawn('mount_whip', { type: 'sweep', pos: { x: p.x, y: p.y, z: p.z }, vel, gy: g.vfx.groundY(m.pos) });
    }
    tr.last = (tr.last || new THREE.Vector3()).copy(p); tr.lastF = f;
  },
  async create(game, opts, { Mount, def }) {
    const m = new Mount(game, def, opts);
    const rig = await loadBeastRig(game, 'mount_cluckhorn', buildCluckhorn);
    m.body.add(rig.root);
    m.model = rig.root; m.rig = rig;
    const seat = rig.J.socket_saddle || rig.root.getObjectByName('socket_saddle');
    if (seat) seat.add(m.saddle); else { m.saddle.position.set(0, def.saddleY, 0); m.body.add(m.saddle); }
    m.animate = (dt, speed) => animateCluckhorn(m, rig, dt, speed);
    try { whipTrail(m); } catch (e) { m._whip = null; } // measured in the bind pose (cosmetic; never blocks spawning)
    return m;
  },
};
