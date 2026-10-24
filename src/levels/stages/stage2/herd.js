// Stage 2 — the herd: a few of Old Shellfather's smaller kin swimming alongside in the lake mist, beyond the crest.
// Each is a domed carapace (the shell scute material, local-space lattice so it rides with the animal), a marginal
// skirt, and a long neck + blunt beaked head reaching forward just above the water; they bob, the heads rise and
// dip on slow breaths, and a pale bow wave rolls off each chest. All built procedurally (cheap, fogged silhouettes).
import * as THREE from 'three';
import { shellMaterial } from './shell.js';
import { merge, xform } from '../stage1/geo.js';

// x, z, scale, heading(deg, +X = with the big one), phase
const HERD = [
  { x: -6, z: -62, s: 0.8, h: 4, ph: 0.0 },
  { x: 18, z: -78, s: 1.15, h: -3, ph: 1.7 },
  { x: 40, z: -58, s: 0.6, h: 8, ph: 3.1 },
  { x: 62, z: -84, s: 1.3, h: 0, ph: 4.4 },
  { x: 96, z: -66, s: 0.9, h: -6, ph: 2.2 },
];

function carapace() {
  // half-ellipsoid dome (unit radius) with a flared, scalloped marginal rim; aSc = lattice coords (x, z) in metres at scale 1
  const g = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.getAttribute('position');
  const sc = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x), r = Math.hypot(x, z);
    const scal = 1 + 0.035 * Math.pow(Math.abs(Math.sin(a * 11)), 0.5) * (1 - y);
    x *= 8.5 * scal; z *= 6.4 * scal; y = y * 4.6 - 0.35 * (1 - y) * (1 - y);
    p.setXYZ(i, x, y, z);
    sc[i * 2] = x * 0.85; sc[i * 2 + 1] = z * 1.05 + Math.sign(z) * y * 0.4;
  }
  g.setAttribute('aSc', new THREE.BufferAttribute(sc, 2));
  g.computeVertexNormals();
  return g;
}

function neckHead() {
  // a thick neck arching forward out of the shell front, ending in a blunt head with a hooked beak
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(6.0, 0.6, 0), new THREE.Vector3(8.6, 1.6, 0), new THREE.Vector3(11.0, 2.6, 0), new THREE.Vector3(13.2, 2.9, 0),
  ]);
  const neck = new THREE.TubeGeometry(curve, 18, 1.0, 12, false);
  const pn = neck.getAttribute('position');
  for (let i = 0; i < pn.count; i++) {   // taper toward the head + wrinkle rings
    const x = pn.getX(i), t = Math.min(1, Math.max(0, (x - 6) / 7.2));
    const c = curve.getPointAt(Math.min(1, t));
    const k = (1.35 - 0.55 * t) * (1 + 0.05 * Math.sin(t * 60));
    pn.setXYZ(i, c.x + (x - c.x) * k, c.y + (pn.getY(i) - c.y) * k, pn.getZ(i) * k);
  }
  const head = new THREE.SphereGeometry(1.25, 16, 10); head.scale(1.35, 0.95, 0.95);
  const beak = new THREE.ConeGeometry(0.62, 1.3, 10); beak.rotateZ(-Math.PI / 2 - 0.35);
  const eyeL = new THREE.SphereGeometry(0.2, 8, 6), eyeR = eyeL.clone();
  return {
    neck,
    head: merge([xform(head, { pos: [13.9, 3.05, 0] }), xform(beak, { pos: [15.5, 2.6, 0] })].map((g) => g.index ? g.toNonIndexed() : g)),
    eyes: merge([xform(eyeL, { pos: [14.8, 3.35, 0.95] }), xform(eyeR, { pos: [14.8, 3.35, -0.95] })].map((g) => g.index ? g.toNonIndexed() : g)),
  };
}

export function buildHerd(ctx, parent) {
  const low = (ctx.quality || {}).name === 'low';
  const shellG = carapace();
  const nh = neckHead();
  const shellM = shellMaterial({ small: true });
  const hideM = new THREE.MeshStandardMaterial({ color: '#6a6452', roughness: 0.75 });
  const eyeM = new THREE.MeshStandardMaterial({ color: '#201008', emissive: '#ff9a40', emissiveIntensity: 0.6, roughness: 0.3 });
  const wakeM = new THREE.MeshBasicMaterial({ color: '#dfe8e2', transparent: true, opacity: 0.55, depthWrite: false, fog: true });
  const wakeG = new THREE.RingGeometry(0.85, 1.0, 40, 1, -Math.PI * 0.35, Math.PI * 0.7); wakeG.rotateX(-Math.PI / 2);
  const list = (low ? HERD.slice(0, 3) : HERD).map((H) => {
    const g = new THREE.Group(); g.name = 'herdTortoise';
    g.position.set(H.x, -1.6, H.z); g.rotation.y = H.h * Math.PI / 180; g.scale.setScalar(H.s);
    const shell = new THREE.Mesh(shellG, shellM);
    const neckPivot = new THREE.Group(); neckPivot.position.set(6, 0.6, 0);
    const neck = new THREE.Mesh(nh.neck, hideM), head = new THREE.Mesh(nh.head, hideM), eyes = new THREE.Mesh(nh.eyes, eyeM);
    for (const m of [neck, head, eyes]) { m.position.set(-6, -0.6, 0); neckPivot.add(m); }
    const wake = new THREE.Mesh(wakeG, wakeM); wake.scale.set(9.5, 1, 7.5); wake.position.set(1.5, 0.65 / H.s, 0);
    g.add(shell, neckPivot, wake);
    parent.add(g);
    return { g, H, neckPivot, wake };
  });
  return {
    update(t) {
      for (const o of list) {
        const { g, H, neckPivot, wake } = o;
        const b = Math.sin(t * 0.55 + H.ph);
        g.position.y = -1.6 + 0.25 * b * H.s;
        g.rotation.z = 0.02 * Math.sin(t * 0.4 + H.ph);
        neckPivot.rotation.z = 0.08 * Math.sin(t * 0.3 + H.ph * 2) - 0.04;
        neckPivot.rotation.y = 0.12 * Math.sin(t * 0.21 + H.ph);
        const w = 1 + 0.06 * Math.sin(t * 1.3 + H.ph);
        wake.scale.set(9.5 * w, 1, 7.5 * w);
      }
    },
  };
}
