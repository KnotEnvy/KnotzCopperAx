// Boss idle life (bosses C2 r15; board r14, Muse: "the lineup idle rows at 0.6 s and 1.8 s are near-identical per column —
// add a visible second-phase sway/breath"). Each boss idle was ONE slow breath of ~2° chest pitch and < 1 cm of hips, so any
// two samples looked alike. twoBeat() rebuilds an idle as 8 keys over the loop from the boss's own base key k(f) plus a
// two-beat layer:
//   beat 1 (first half)  weight rolls onto the RIGHT leg, the chest fills (pitch up, hips rise), weapon / free hand lift;
//   beat 2 (second half) weight rolls back onto the LEFT leg while he exhales and settles, the head scans the other way.
// Sway = one sine over the loop (hips side shift + counter roll + a little yaw), breath = a raised cosine peaking mid-loop,
// head scan leads the sway by 60°. Samples 0.4–0.6 loop apart (the lineup's 1.2 s on 2.3–3 s loops) now differ by about
// twice the amplitudes. Feet stay planted (clip `plant` + feet goals are root-relative), so the hips shift reads as weight.
// `&bossidle=r14` = the old one-breath idles (A/B).
export const IDLE_R14 = typeof location !== 'undefined' && /[?&]bossidle=r14/.test(location.search);

const add3 = (a, d) => (a ? [a[0] + d[0], a[1] + d[1], a[2] + d[2]] : d.slice());

/**
 * @param {number} frames loop length (60 Hz ticks)
 * @param {(f:number)=>object} k the clip's base key factory (pose/hips/feet/wpn/handL…)
 * @param {object} a amplitudes: sway (m, hips side), rock (m, hips fore/aft), rise (m, breath hips lift), roll/yaw/pitch (deg,
 *   torso), head (deg, scan yaw), lift (arm units, weapon grip + free hand on the breath), handSwing (arm units, free hand
 *   fore/aft with the sway), wpnSwing (arm units, weapon grip fore/aft with the sway)
 */
export function twoBeat(frames, k, a = {}) {
  const A = { sway: 0.03, rock: 0.012, rise: 0.012, roll: 2.5, yaw: 4, pitch: 4, head: 9, lift: 0.025, handSwing: 0.03, wpnSwing: 0.02, ...a };
  const N = 8, keys = [];
  for (let i = 0; i <= N; i++) {
    const ph = i / N, f = Math.round(frames * ph);
    if (i === N) { keys.push({ ...keys[0], f }); break; }
    const s = Math.sin(ph * Math.PI * 2);                 // + = weight on the right leg
    const c = Math.cos(ph * Math.PI * 2);
    const br = 0.5 - 0.5 * c;                             // breath: 0 at the loop start, 1 mid-loop
    const hd = Math.sin(ph * Math.PI * 2 + Math.PI / 3);  // head scan leads the sway
    const key = { ...k(f), f };
    const pose = { ...(key.pose || {}) };
    const r = -A.roll * s, y = A.yaw * s, p = A.pitch * br;   // bend away from the loaded leg, turn with it, chest up on the breath
    pose.hips = add3(pose.hips, [A.roll * 0.35 * s, y * 0.3, 0]);
    pose.spine = add3(pose.spine, [r * 0.4, y * 0.42, p * 0.45]);
    pose.chest = add3(pose.chest, [r * 0.6, y * 0.58, p * 0.55]);
    pose.neck = add3(pose.neck, [-r * 0.45, -y * 0.3 + A.head * hd * 0.4, -p * 0.4]);
    pose.head = add3(pose.head, [-r * 0.4, -y * 0.3 + A.head * hd * 0.6, -p * 0.35]);
    key.pose = pose;
    key.hips = add3(key.hips || [0, 0, 0], [A.rock * c, A.rise * br, A.sway * s]);
    if (key.wpn && key.wpn.at) key.wpn = { ...key.wpn, at: add3(key.wpn.at, [A.wpnSwing * s, A.lift * br, 0]) };
    if (Array.isArray(key.handL)) key.handL = add3(key.handL, [-A.handSwing * s, A.lift * 1.2 * br, 0]);
    keys.push(key);
  }
  return keys;
}
