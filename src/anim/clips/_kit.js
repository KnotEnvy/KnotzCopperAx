// Authoring kit for code-keyed clips (private helper: files starting with '_' are not registered).
// Conventions (character space): +X forward, +Y up, +Z the character's RIGHT. Angles in degrees.
//   dir(az, el)          unit direction: az 0 = forward, +90 = right, -90 = left, 180 = back; el + = up
//   torso({...})         pelvis/spine/chest share of a yaw (+ = turn LEFT), pitch (- = lean FORWARD), roll (+ = bend RIGHT);
//                        neck/head counter-rotate by `look` (0..1) so the eyes stay on the target
//   W(at, blade, z)      weapon goal (see clipBaker): grip point (posed-chest origin, arm-length units), blade dir,
//                        weapon +Z dir (sword: which way the FLAT faces; axe: which way the BIT faces)
//   gait({...})          foot-planted locomotion keys: stance feet slide back at exactly the ground speed
//   shake(keys...)       helpers for impact frames
import { arm, leg, pose } from '../poseKit.js';

export { arm, leg, pose };
const D = Math.PI / 180;
export const dir = (az, el = 0) => [Math.cos(el * D) * Math.cos(az * D), Math.sin(el * D), Math.cos(el * D) * Math.sin(az * D)];
export const W = (at, blade, z = [0, 0, 1]) => ({ at, blade, edge: z });
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpV = (a, b, t) => a.map((x, i) => lerp(x, b[i], t));
const smooth = (t) => t * t * (3 - 2 * t);

/** Distribute a torso rotation over pelvis → spine → chest, with the neck/head countering by `look`. */
export function torso({ yaw = 0, pitch = 0, roll = 0, pelvis = 0, pelvisPitch = 0, pelvisRoll = 0, look = 0.85, hy = 0, hp = 0, hr = 0 } = {}) {
  const ty = yaw + pelvis;
  return {
    hips: [pelvisRoll, pelvis, pelvisPitch],
    spine: [roll * 0.4, yaw * 0.42, pitch * 0.45],
    chest: [roll * 0.6, yaw * 0.58, pitch * 0.55],
    neck: [-roll * 0.45, -ty * look * 0.45 + hy * 0.4, -(pitch + pelvisPitch) * look * 0.45 + hp * 0.4],
    head: [-roll * 0.4 + hr, -ty * look * 0.45 + hy * 0.6, -(pitch + pelvisPitch) * look * 0.4 + hp * 0.6],
  };
}

/** Feet goals: [dx, dy, dz, pitch, toeOut] offsets from the rest ankle (hip-height units). */
export const feet = (L, R) => ({ footL: L, footR: R });

/**
 * Foot-planted gait. v = ground speed in hip-heights per second at clip speed 1 (actor speed / hip height /
 * animator speed multiplier). P = cycle seconds. duty = stance fraction. cx = contact x (ankle ahead of rest).
 * Returns keys over one loop; `upper(ph, side)` adds per-phase upper-body parts ({ pose, wpn, wpnL, handL, ... }).
 */
export function gait({
  P, v, duty = 0.5, cx = 0.38, lift = 0.14, heel = 0.1, bob = 0.03, hipsY = -0.07, hipsX = 0.03, sway = 0.015,
  width = 0.03, toeOut = 8, twist = 7, lean = -6, samples = 16, strike = 10, pushOff = 32, upper = null, flight = 0,
}) {
  const Tr = v * duty * P;
  const keys = [];
  const footAt = (phi, side) => {
    const z = (side === 'L' ? -1 : 1) * width;
    if (phi < duty) {
      const u = phi / duty;
      const x = cx - Tr * u;
      const hr = u > 0.55 ? smooth((u - 0.55) / 0.45) : 0;   // heel rises into push-off
      const y = heel * hr;
      const pitch = u < 0.14 ? strike * (1 - u / 0.14) : -pushOff * hr;
      return [x, y, z, pitch, toeOut];
    }
    const u = (phi - duty) / (1 - duty);
    const e = u * u * (3 - 2 * u);
    const x = (cx - Tr) + Tr * e + Math.sin(u * Math.PI) * 0.04;
    const y = lift * Math.pow(Math.sin(u * Math.PI), 0.85) + heel * Math.max(0, 1 - u * 3) + flight * Math.sin(u * Math.PI) * 0.3;
    const pitch = lerp(-pushOff, strike, smooth(Math.min(1, u * 1.15)));
    return [x, y, z, pitch, toeOut];
  };
  for (let i = 0; i < samples; i++) {
    const ph = i / samples;
    const L = footAt(ph % 1, 'L'), R = footAt((ph + 0.5) % 1, 'R');
    // hips: highest at mid-stance for a walk (vault), lowest for a run/jog (flight > 0 flips it)
    const midL = duty / 2;
    const c2 = Math.cos(4 * Math.PI * (ph - midL));
    const y = hipsY + (flight > 0 ? -1 : 1) * bob * c2;
    const s = Math.sin(2 * Math.PI * (ph - midL));
    const k = {
      t: ph * P,
      footL: L, footR: R,
      hips: [hipsX, y, sway * s],
      pose: torso({ pelvis: -twist * Math.sin(2 * Math.PI * ph), yaw: twist * 1.35 * Math.sin(2 * Math.PI * ph), pitch: lean, roll: 0, pelvisRoll: -2.5 * s, look: 0.9 }),
    };
    if (upper) {
      const u = upper(ph, k);
      if (u) { if (u.pose) k.pose = { ...k.pose, ...u.pose }; for (const f of ['wpn', 'wpnL', 'handL', 'handR', 'grip', 'hips']) if (u[f] !== undefined) k[f] = u[f]; }
    }
    keys.push(k);
  }
  return keys;
}

/** Offset a list of keys in time (frames) — handy for re-using a phrase. */
export const shiftF = (keys, df) => keys.map((k) => ({ ...k, f: (k.f ?? 0) + df }));
/** Arm swing helper for a free arm: forward/back swing angle (deg) with the elbow bent (deg). */
export function swingArm(side, a, elbow = 25, out = 0.28) {
  const s = side === 'L' ? -1 : 1;
  const u = [Math.sin(a * D), -Math.cos(a * D), s * out];
  const f = [Math.sin((a + elbow) * D), -Math.cos((a + elbow) * D), s * out * 0.7];
  return arm(side, { upper: u, fore: f });
}
