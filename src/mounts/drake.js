// Small riding dragons (beast_quad + folded wings): shared procedural fallback model + pose driver for
// Emberdrake (blue, fire-breath stream) and Cinderwyrm (red, fireball lobber). GLB ids mount_emberdrake /
// mount_cinderwyrm (blender/build_mount_emberdrake.py) use the same joint names and replace the fallback.
import * as THREE from 'three';
import { joint, lerp, ramp } from './beastRig.js';
import { std, blob, limb, cone, aim } from './proc.js';

export const DRAKE_PAL = {
  blue: { scale: '#2f63b4', dark: '#1a2f66', belly: '#bcd3e6', horn: '#ece0c2', membrane: '#3d7fc4', claw: '#26262c', eye: '#ffb030', mouth: '#5a1a1c', leather: '#5c2a1a', brass: '#c89a48', crest: '#f0b040' },
  red: { scale: '#b8321e', dark: '#5a140e', belly: '#e8c08a', horn: '#2a2222', membrane: '#c8502a', claw: '#1e1a1a', eye: '#fff080', mouth: '#3a0a08', leather: '#3a2418', brass: '#b89040', crest: '#ffcf50' },
};

function membraneGeo(pts) {
  // flat fan of triangles (wing membrane) from a list of [x,y,z] points, first = root
  const g = new THREE.BufferGeometry();
  const pos = [];
  for (let i = 1; i < pts.length - 1; i++) pos.push(...pts[0], ...pts[i], ...pts[i + 1]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildDrake(palName = 'blue', { name = 'mount_emberdrake', horns = 'swept' } = {}) {
  const P = DRAKE_PAL[palName];
  const M = {
    scale: std(P.scale, 0.55, 0.05), dark: std(P.dark, 0.6, 0.05), belly: std(P.belly, 0.7), horn: std(P.horn, 0.45),
    membrane: std(P.membrane, 0.8, 0, { side: THREE.DoubleSide }), claw: std(P.claw, 0.35, 0.3),
    eye: std(P.eye, 0.3, 0, { emissive: P.eye, emissiveIntensity: 1.6 }), mouth: std(P.mouth, 0.8), leather: std(P.leather, 0.85), brass: std(P.brass, 0.4, 0.9), crest: std(P.crest, 0.5),
  };
  const root = new THREE.Group(); root.name = name;
  const rj = joint('root', root);
  const hips = joint('hips', rj, [0, 0.92, -0.42]);
  const s1 = joint('spine_1', hips, [0, 0.03, 0.24]);
  const s2 = joint('spine_2', s1, [0, 0.02, 0.24]);
  const s3 = joint('spine_3', s2, [0, 0.0, 0.22]);
  const chest = joint('chest', s3, [0, -0.02, 0.2]);
  const n1 = joint('neck_1', chest, [0, 0.12, 0.2]);
  const n2 = joint('neck_2', n1, [0, 0.16, 0.14]);
  const n3 = joint('neck_3', n2, [0, 0.14, 0.12]);
  const head = joint('head', n3, [0, 0.1, 0.1]);
  const jaw = joint('jaw', head, [0, -0.07, 0.02]);
  const mouth = joint('socket_mouth', head, [0, -0.04, 0.46]); mouth.userData.joint = false;
  // torso: overlapping scaled blobs per spine joint (continuous silhouette under any spine bend)
  const torso = [[hips, 0.36, [1.0, 0.9, 1.25], [0, 0.02, 0.05]], [s1, 0.37, [1.0, 0.95, 1.0], [0, 0.02, 0]], [s2, 0.38, [1.02, 0.95, 1.0], [0, 0.0, 0]], [s3, 0.36, [1.0, 0.95, 1.0], [0, -0.02, 0]], [chest, 0.34, [1.0, 1.0, 1.1], [0, -0.02, 0.04]]];
  for (const [j, r, s, p] of torso) { const b = blob(r, s, M.scale, 22); b.position.set(...p); j.add(b); const bl = blob(r * 0.85, [s[0] * 0.85, s[1] * 0.6, s[2]], M.belly, 18); bl.position.set(p[0], p[1] - r * 0.42, p[2]); j.add(bl); }
  // dorsal ridge spikes (dark) along spine + neck + tail
  const ridge = (j, n, len, y0) => { for (let i = 0; i < n; i++) { const c = cone(0.05, len * (1 - i * 0.08), M.dark, 6); c.position.set(0, y0, -0.12 + i * 0.12); aim(c, [0, 1, -0.55]); j.add(c); } };
  ridge(hips, 2, 0.2, 0.36); ridge(s1, 2, 0.22, 0.37); ridge(s3, 2, 0.22, 0.35); ridge(chest, 2, 0.2, 0.33);
  // neck segments (overlapping spheres + tubes)
  for (const [j, r] of [[n1, 0.2], [n2, 0.17], [n3, 0.15]]) { j.add(blob(r, [1, 1, 1.1], M.scale, 16)); const bl = blob(r * 0.8, [0.85, 0.8, 1], M.belly, 12); bl.position.set(0, -r * 0.35, r * 0.25); j.add(bl); const c = cone(0.035, 0.14, M.dark, 6); c.position.set(0, r * 0.9, -0.02); aim(c, [0, 1, -0.6]); j.add(c); }
  // head: broad skull, long snout, brow ridges, horns, glowing eyes, teeth
  const skull = blob(0.17, [1.0, 0.85, 1.15], M.scale, 20); skull.position.set(0, 0.02, 0.04); head.add(skull);
  const snout = blob(0.12, [0.85, 0.6, 1.9], M.scale, 18); snout.position.set(0, -0.02, 0.26); head.add(snout);
  const nose = blob(0.06, [1.3, 0.7, 0.8], M.dark, 12); nose.position.set(0, 0.02, 0.46); head.add(nose);
  for (const s of [1, -1]) {
    const nos = blob(0.018, [1, 0.7, 1], M.mouth, 6); nos.position.set(s * 0.04, 0.035, 0.49); head.add(nos);
    const brow = blob(0.07, [0.9, 0.45, 1.4], M.dark, 12); brow.position.set(s * 0.1, 0.1, 0.14); brow.rotation.z = s * 0.35; head.add(brow);
    const eye = blob(0.032, [1, 0.75, 1.2], M.eye, 10); eye.position.set(s * 0.125, 0.06, 0.16); head.add(eye);
    const pupil = blob(0.012, [0.4, 1, 0.5], std('#140806', 0.3), 6); pupil.position.set(s * 0.15, 0.06, 0.17); head.add(pupil);
    if (horns === 'swept') { const h1 = cone(0.05, 0.38, M.horn, 10); h1.position.set(s * 0.09, 0.12, -0.04); aim(h1, [s * 0.35, 0.45, -1]); head.add(h1); const h2 = cone(0.03, 0.18, M.horn, 8); h2.position.set(s * 0.13, 0.03, -0.02); aim(h2, [s * 0.8, 0.1, -1]); head.add(h2); }
    else { const h1 = cone(0.06, 0.3, M.horn, 10); h1.position.set(s * 0.1, 0.14, 0.02); aim(h1, [s * 0.5, 1, -0.5]); head.add(h1); const h3 = cone(0.04, 0.2, M.horn, 8); h3.position.set(s * 0.05, 0.03, 0.4); aim(h3, [s * 0.2, 1, 0.3]); head.add(h3); }
    const fr = cone(0.03, 0.16, M.crest, 6); fr.position.set(s * 0.15, -0.06, 0.02); aim(fr, [s, -0.2, -0.6]); head.add(fr);
    for (let i = 0; i < 4; i++) { const t = cone(0.012, 0.05, M.horn, 5); t.position.set(s * 0.07, -0.06, 0.22 + i * 0.06); aim(t, [0, -1, 0]); head.add(t); }
  }
  const lowerJ = blob(0.1, [0.8, 0.4, 1.9], M.belly, 16); lowerJ.position.set(0, -0.02, 0.22); jaw.add(lowerJ);
  const tongue = blob(0.05, [0.8, 0.3, 2], M.mouth, 10); tongue.position.set(0, 0.02, 0.2); jaw.add(tongue);
  for (const s of [1, -1]) for (let i = 0; i < 3; i++) { const t = cone(0.012, 0.045, M.horn, 5); t.position.set(s * 0.06, 0.02, 0.24 + i * 0.07); jaw.add(t); }
  // saddle on spine_2 (+ reins to the neck)
  const seat = blob(0.28, [1.12, 0.28, 1.2], M.leather, 18); seat.position.set(0, 0.38, 0.02); s2.add(seat);
  const cantle = blob(0.18, [1.25, 0.55, 0.35], M.leather, 14); cantle.position.set(0, 0.45, -0.24); s2.add(cantle);
  const pommel = blob(0.06, [1, 1.5, 1], M.brass, 10); pommel.position.set(0, 0.47, 0.26); s2.add(pommel);
  const blanket = blob(0.38, [1.15, 0.2, 1.05], std(palName === 'blue' ? '#c29a3a' : '#2c3a58', 0.9), 18); blanket.position.set(0, 0.29, 0.02); s2.add(blanket);
  for (const s of [1, -1]) { const st = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.013, 6, 12), M.brass); st.position.set(s * 0.44, -0.12, 0.05); st.rotation.y = Math.PI / 2; s2.add(st); const strap = limb(0.018, 0.018, 0.48, M.leather, 6); strap.position.set(s * 0.41, 0.36, 0.05); strap.rotation.z = s * 0.1; s2.add(strap); }
  const saddle = joint('socket_saddle', s2, [0, 0.44, 0.0]); saddle.userData.joint = false;
  // wings (folded along the flanks; membrane fans between finger spars, rigid per wing: no tearing)
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const w1 = joint(`wing_1_${L}`, s3, [s * 0.28, 0.24, 0.0]);
    // folded tight along the flank (elbow up-back, fingers trailing back to the haunch)
    const w2 = joint(`wing_2_${L}`, w1, [s * 0.14, 0.21, -0.23]);
    const w3 = joint(`wing_3_${L}`, w2, [s * 0.04, -0.12, -0.5]);
    w1.add(blob(0.07, [1, 1, 1], M.dark, 10));
    const bone = (a, b, r, j) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A); const g = new THREE.CylinderGeometry(r * 0.7, r, d.length(), 7); g.translate(0, d.length() / 2, 0); const mm = new THREE.Mesh(g, M.dark); mm.position.copy(A); aim(mm, d.toArray()); mm.castShadow = true; j.add(mm); };
    bone([0, 0, 0], [s * 0.14, 0.21, -0.23], 0.05, w1);
    bone([0, 0, 0], [s * 0.04, -0.12, -0.5], 0.04, w2);
    w2.add(blob(0.05, [1, 1, 1], M.dark, 8));
    const claw = cone(0.02, 0.1, M.horn, 6); aim(claw, [s * 0.3, 0.8, 0.3]); w2.add(claw);
    const tips = [[s * 0.04, -0.12, -0.5], [s * 0.02, -0.3, -0.45], [s * -0.01, -0.36, -0.22], [s * -0.03, -0.3, 0.0]];
    for (let i = 1; i < tips.length; i++) bone([0, 0, 0], tips[i], 0.02, w2);
    const memb = new THREE.Mesh(membraneGeo([[0, 0, 0], ...tips, [s * -0.1, -0.2, 0.18]]), M.membrane); memb.castShadow = true; w2.add(memb);
  }
  // tail
  let parent = hips;
  const tp = [[0, 0.05, -0.36], [0, -0.03, -0.28], [0, -0.04, -0.28], [0, -0.04, -0.26], [0, -0.03, -0.24], [0, -0.02, -0.22]];
  tp.forEach((p, i) => {
    const t = joint(`tail_${i + 1}`, parent, p);
    const r = lerp(0.24, 0.06, i / 5);
    t.add(blob(r, [1, 0.92, 1.35], M.scale, 14));
    const bl = blob(r * 0.8, [0.9, 0.5, 1.3], M.belly, 10); bl.position.y = -r * 0.45; t.add(bl);
    const c = cone(0.035 + (5 - i) * 0.006, 0.16 - i * 0.012, M.dark, 6); c.position.set(0, r * 0.85, 0); aim(c, [0, 1, -0.6]); t.add(c);
    parent = t;
  });
  const fin = new THREE.Mesh(membraneGeo([[0, 0, 0.06], [0, 0.2, -0.12], [0, 0.02, -0.34], [0, -0.18, -0.14]]), M.membrane); parent.add(fin);
  // hind legs (digitigrade, powerful thighs)
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const th = joint(`thigh_${L}`, hips, [s * 0.27, -0.06, 0.02]);
    const tb = blob(0.19, [0.8, 1.3, 1.1], M.scale, 14); tb.position.set(0, -0.12, 0.05); th.add(tb);
    const sh = joint(`shin_${L}`, th, [0, -0.34, 0.14]);
    sh.add(blob(0.1, [1, 1, 1], M.scale, 10)); const sm = limb(0.1, 0.07, 0.32, M.scale, 10); sm.rotation.x = 0.75; sh.add(sm);
    const mt = joint(`metatarsal_${L}`, sh, [0, -0.23, -0.22]);
    mt.add(blob(0.07, [1, 1, 1], M.scale, 10)); const mm = limb(0.065, 0.055, 0.28, M.scale, 10); mm.rotation.x = -0.12; mt.add(mm);
    const ft = joint(`foot_${L}`, mt, [0, -0.24, -0.02]);
    ft.add(blob(0.075, [1.2, 0.55, 1.4], M.scale, 10));
    const tj = joint(`toe_${L}`, ft, [0, -0.02, 0.08]);
    for (const a of [-0.45, 0, 0.45]) { const c = cone(0.025, 0.12, M.claw, 6); c.position.set(Math.sin(a) * 0.08, -0.03, Math.cos(a) * 0.08); aim(c, [Math.sin(a), -0.35, Math.cos(a)]); tj.add(c); }
  }
  // front legs (clavicle → upperarm → forearm → hand → finger)
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const cl = joint(`clavicle_${L}`, chest, [s * 0.2, -0.08, 0.06]);
    const ua = joint(`upperarm_${L}`, cl, [s * 0.04, -0.06, 0.0]);
    ua.add(blob(0.12, [0.8, 1.2, 0.9], M.scale, 12)); const um = limb(0.1, 0.075, 0.3, M.scale, 10); um.rotation.x = -0.3; ua.add(um);
    const fa = joint(`forearm_${L}`, ua, [0, -0.28, -0.09]);
    fa.add(blob(0.075, [1, 1, 1], M.scale, 10)); const fm = limb(0.07, 0.055, 0.44, M.scale, 10); fm.rotation.x = 0.11; fa.add(fm);
    const hd = joint(`hand_${L}`, fa, [0, -0.44, 0.05]);
    hd.add(blob(0.065, [1.2, 0.55, 1.3], M.scale, 10));
    const fg = joint(`finger_${L}`, hd, [0, -0.02, 0.07]);
    for (const a of [-0.4, 0, 0.4]) { const c = cone(0.02, 0.1, M.claw, 6); c.position.set(Math.sin(a) * 0.06, -0.02, Math.cos(a) * 0.05); aim(c, [Math.sin(a), -0.4, Math.cos(a)]); fg.add(c); }
  }
  return root;
}

/** Pose driver: quadruped walk/trot, idle breathing, wing settle, breath / spit / ram / bite poses. */
export function animateDrake(m, rig, dt, speed) {
  const R = rig.rot.bind(rig);
  rig.reset();
  const ph = m.gait, t = m.game.time;
  const run = Math.min(1, speed / 7), moving = Math.min(1, speed / 1.0);
  const amp = lerp(14, 34, run) * moving;
  // diagonal gait: front-left with hind-right
  const legs = [['L', 0], ['R', Math.PI]];
  const biped = rig.source === 'glb';   // GLB r2 rig is a biped; the procedural fallback stays a quadruped
  for (const [L, off] of legs) {
    const p = ph + off, sw = Math.sin(p), lift = Math.max(0, Math.cos(p));
    R(`thigh_${L}`, -sw * amp, 0, 0);
    R(`shin_${L}`, -lift * amp * 0.9, 0, 0);
    R(`metatarsal_${L}`, lift * amp, 0, 0);
    if (biped) {
      // r2 GLB = theropod: the hind legs carry the stride; the small raised arms pump / flex a little
      R(`thigh_${L}`, -sw * amp * 1.3, 0, 0); R(`shin_${L}`, -lift * amp * 1.1, 0, 0); R(`metatarsal_${L}`, lift * amp * 1.2, 0, 0);
      const arm = Math.sin(p) * 8 * moving + Math.sin(t * 1.3 + m.id) * 3;
      R(`upperarm_${L}`, arm, 0, 0); R(`forearm_${L}`, -arm * 0.6, 0, 0); R(`hand_${L}`, Math.sin(t * 2.1 + off) * 5, 0, 0);
      continue;
    }
    const q = p + Math.PI; const sw2 = Math.sin(q), lift2 = Math.max(0, Math.cos(q));
    R(`upperarm_${L}`, -sw2 * amp * 0.9, 0, 0);
    R(`forearm_${L}`, lift2 * amp * 1.1, 0, 0);
    R(`hand_${L}`, -lift2 * amp * 0.6, 0, 0);
  }
  const bob = Math.abs(Math.sin(ph)) * 0.04 * moving;
  const breathe = Math.sin(t * 1.9 + m.id) * 0.015;
  let neck = 0, headP = 0, jaw = Math.max(0, Math.sin(t * 0.9 + m.id) - 0.92) * 60, crouch = 0, lean = 0, wing = Math.sin(t * 1.9) * 3, tailW = Math.sin(ph * 0.5) * 10 * moving + Math.sin(t * 1.1 + m.id) * 8 * (1 - moving), yawLook = (1 - moving) * Math.sin(t * 0.6 + m.id * 2) * 14;
  const act = m.action;
  if (act) {
    const f = act.frame, d = act.def, S = d.startup, A = S + (d.active || 0), T = act.total;
    if (act.id === 'breath' || act.id === 'fireball') {
      // rear back (inhale) → thrust the head forward, jaws wide → settle
      const inhale = ramp(f, 0, S), blow = f >= S ? 1 - ramp(f, A, T) : 0;
      neck = -22 * inhale * (1 - blow) + 18 * blow; headP = -10 * inhale * (1 - blow) + 6 * blow;
      jaw = Math.max(jaw, 12 * inhale + 30 * blow); crouch = 0.05 * blow; wing = 14 * inhale - 6 * blow; lean = -8 * inhale * (1 - blow);
      yawLook = 0;
      if (act.id === 'breath') neck += Math.sin(f * 0.5) * 3 * blow;
    } else if (act.id === 'ram' || act.id === 'bite') {
      const k = f < S ? ramp(f, 0, S) : 1 - ramp(f, T - 8, T);
      neck = 20 * k; headP = act.id === 'bite' ? 18 * k : 26 * k; jaw = act.id === 'bite' ? (f >= S && f < A ? 35 : 10) : 8 * k; lean = 12 * k; crouch = 0.04 * k;
    }
  }
  if (!m.grounded) { for (const L of ['L', 'R']) { R(`thigh_${L}`, -25, 0, 0); R(`metatarsal_${L}`, 40, 0, 0); R(`upperarm_${L}`, -30, 0, 0); R(`forearm_${L}`, 40, 0, 0); } wing += 35; }
  const hurt = m.flinch > 0 ? Math.sin((m.flinch / 12) * Math.PI) : 0;
  rig.pos('hips', 0, bob + breathe - crouch, 0);
  R('hips', -lean * 0.3 - hurt * 8, 0, hurt * 6 * -m.facing);
  R('spine_1', -lean * 0.2, 0, 0); R('spine_3', lean * 0.2, 0, 0);
  R('chest', lean * 0.2 + breathe * 60, 0, 0);
  R('neck_1', -neck * 0.5 - 6, yawLook * 0.3, 0);
  R('neck_2', -neck * 0.2, yawLook * 0.3, 0);
  R('neck_3', neck * 0.4, yawLook * 0.4, 0);
  R('head', headP + neck * 0.35 - hurt * 18, yawLook * 0.3, 0);
  R('jaw', jaw + hurt * 18, 0, 0);
  for (const [L, s] of [['L', 1], ['R', -1]]) { R(`wing_1_${L}`, 0, 0, s * -wing); R(`wing_2_${L}`, 0, 0, s * -wing * 0.5); }
  for (let i = 1; i <= 6; i++) R(`tail_${i}`, 2, tailW * (0.3 + i * 0.12), 0);
}

/** Mouth world position (after the last render). */
const _m = new THREE.Vector3();
export function mouthWorld(m) {
  const s = m.rig && (m.rig.root.getObjectByName('socket_mouth') || m.rig.J.head);
  if (!s) return _m.set(m.pos.x + m.facing * 1.2, m.pos.y + 1.4, m.pos.z);
  s.updateWorldMatrix(true, false);
  return s.getWorldPosition(_m);
}
