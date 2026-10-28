// Seraphine Vey — dual sabres (Dawn right, Dusk left). Blade-dance: light on the balls of the feet, quick
// alternating cuts, full-body spins (pelvis yaw through 360° with chest-space weapon goals), flips, long leaps and
// the flying kick. Frames match characters/movesets/seraphine.js (strike pose on the first ACTIVE tick).
// Weapon goals: W(at, blade, flat) for Dawn, WL(...) for Dusk; `at` from the posed chest in arm lengths.
// C2 r4 (hero-weapons; board r3: "in the swing Dawn turns edge-on and shrinks to a 1-2 px line"): the flat of a sabre whose
// blade is not along +-Z now faces the CAMERA side ([0, 0.3, +-1], the belt-scroll read) through the cuts, the run carry and
// the kick, instead of up ([0, 1, x] = the edge toward the camera). Measured in stage 1 (tools/scenarios/weapon_read_probe.mjs):
// Dawn flat-to-camera over the attack frames 0.32 -> 0.95. Spin keys (blades out along chest +-Z while the pelvis turns
// through 360 deg) use a chest-FORWARD flat ([1, 0, 0]): when the turning chest brings a blade into the screen plane, its flat
// faces the camera (an up-flat there was a 7-10 px edge-on line at light_3's own contact frames).
import { dir, W, torso, pose, gait, leg, feet, arm } from './_kit.js';
import { rideSet } from './_ride.js';

const WL = W;
// ----------------------------------------------------------------------------------------------- stances
// C2 r27 (anim fix3; board r21 Opus: "the Duel guard crouch still pulls the knees inward", d_0261 = light_2's recovery): the leg
// IK bends every knee toward her forward (bake pole ~8 deg out, runtime plant = straight forward), so a BENT knee over a foot
// turned out 36 deg caved in (probe r27/idle_knees.mjs). Guard feet: front foot nearly straight (knee over the toes), wider,
// back foot turned out less (36 -> 10) and set further back so its knee bends less. Strike keys keep their own feet.
const ST = feet([0.2, 0.03, -0.04, -10, 0], [-0.28, 0.02, 0.08, -8, 10]);           // on the balls of the feet
const ST_W = feet([0.3, 0, -0.04, 0, 4], [-0.28, 0.02, 0.08, -10, 40]);
const G_T = torso({ pelvis: -24, yaw: 8, pitch: -9, look: 0.95 });
const G_R = W([0.55, 0.04, 0.24], dir(-8, 20), [0, 0.3, 1]);
// C2 r2 (board r1: "Dusk hides behind her body in idle"): Dusk is carried low and FORWARD (blade ahead of the front
// thigh, flat to the camera) instead of trailing behind the left hip where the body covered it from the game camera.
const G_L = WL([0.34, -0.4, -0.3], dir(-26, -22), [0, 0.3, -1]);
const GUARD = { pose: G_T, hips: [0, -0.09, 0], ...ST, wpn: G_R, wpnL: G_L };
const g = (f, x = {}) => ({ f, ...GUARD, ...x });
// FK legs for spins (they ride with the pelvis)
const SPIN_LEGS = pose(leg('L', { thigh: [0.05, -1, -0.1], shin: [0.02, -1, -0.1], toe: [1, -0.45, -0.1] }),
  leg('R', { thigh: [0.35, -0.85, 0.35], shin: [-0.35, -0.95, 0.3], toe: [0.6, -0.8, 0.1] }));
const TUCK_LEGS = pose(leg('L', { thigh: [0.9, -0.3, -0.12], shin: [-0.5, -0.9, -0.1], toe: [0.5, -0.85, 0] }),
  leg('R', { thigh: [0.75, -0.55, 0.12], shin: [-0.6, -0.8, 0.1], toe: [0.4, -0.9, 0] }));

// ----------------------------------------------------------------------------------------------- locomotion
// C2 r25 (anim fix; board r19 Sol: "held upper body ... mannequin-like"): dancer's balance. The arms swing
// contralateral to the legs (right hand forward as the left foot lands, ph 0) instead of a quarter cycle late; the chest
// counter-rotates against the pelvis (net shoulders ~7 deg the other way) while the head holds the line (look .9) and
// counter-tilts the shoulder roll; clavicles ride forward/back with each arm; a light bounce (bob + chest pitch twice a
// cycle); the sabres' wrists lag the hands (follow-through), so the blades flick instead of hanging rigid.
const TAU = Math.PI * 2;
// C2 r26 (anim fix2; board r20 Sol: "the upright walk torso and repeated elbows-out carriage still feel mechanical"):
// (a) the chest engages forward (pitch -7 -> -11; the head keeps the line, look .9); (b) elbows in: the hands ride closer
// to the body (z .42 -> .38 arm lengths; an FK upper-arm elbow hint was tried and dropped: its joint configuration made the
// walk-tap -> idle -> run blend swing Dawn through the right thigh for a frame, gate r26 it1); (c) less repetition: the loop is TWO strides (1.12 s)
// and the wrist play, hand height and blade lift vary on a half-rate wave, different per sabre (Dawn and Dusk no longer
// mirror each other), so no two consecutive steps carry the blades the same way. Legs are the same gait twice.
// C2 r28 (anim fix4; board r22 Sol: "walk keeps the elbows winged and wrists near the hips"): the arm IK bends each elbow
// toward 0.4 x a fixed out-down-back default + 0.6 x the FK upper-arm direction, and with the upper arm left at the A-pose
// (40 deg out) that pole points ~80% OUTWARD: winged elbows (walk upper arms 50 deg out of her side plane, elbows .22 m out).
// ELBOW(bR, bL) = an FK upper-arm hint (chest frame, z = outward for that side) that only seeds the pole; the IK still owns
// the arm. ONE shared configuration in idle + walk + run (r26 tried it in the walk alone: the walk-tap -> idle -> run blend
// between two different elbow configurations swung Dawn through the thigh), so locomotion blends stay a pure elbow swivel.
const ELBOW = (bR, bL = bR) => ({ ...arm('R', { upper: bR }), ...arm('L', { upper: [bL[0], bL[1], -bL[2]] }) });
const EL_DOWN = [-0.45, -1, -0.08];   // elbows down and a little back, close to the ribs
const ELBOW_DOWN = ELBOW(EL_DOWN);
// run: the hint follows the pump (k = 1 hand forward: elbow down under the shoulder; k = -1 hand back: elbow back, up and out).
// A little more outward than EL_DOWN all through the pump: the plait swings ~15 deg sideways in the run and a fully tucked elbow
// passed 9 cm from it (gate it2/it3 braid-arm .093 m; r27 .137 m with the elbows winged .33 m out).
const elRun = (k) => { const u = (1 + k) / 2; return [-0.85 + 0.45 * u, -0.45 - 0.55 * u, 0.35 - 0.2 * u]; };
const WALK_P = 0.56;
// C2 r28: hands forward of the hips and in (z .38 -> .3, x .3 -> .42 arm lengths), elbows down by the ribs; Dawn's tip
// forward-out and DOWN (az 32 -> 14, a real downward angle) so from the side the gold blade leaves the body ahead of the front
// thigh instead of lying across it (board r22 Opus: "in walk and idle the gold sabre lies flat across the front thigh").
const walkUpper = (cyc) => (ph) => {
  const a = TAU * ph, c = Math.cos(a), w = Math.cos(a - 0.9), s = Math.sin(TAU * (ph - 0.24)), c2 = Math.cos(2 * a);
  const hv = Math.PI * (ph + cyc), vR = Math.sin(hv), vL = Math.cos(hv + 0.8);   // one slow wave per two strides
  const yR = -0.5 + 0.03 * c * c + 0.025 * vR, yL = -0.52 + 0.03 * c * c + 0.025 * vL;
  return {
    pose: { ...torso({ pelvis: -8 * c, yaw: 15 * c, pitch: -11 - 1.5 * c2, roll: 3 * s, pelvisRoll: -3 * s, look: 0.9, hr: -1.5 * s }),
      clavicle_R: [-1 - c, 6 * c, 0], clavicle_L: [1 - c, 6 * c, 0], ...ELBOW_DOWN },
    wpn: W([0.42 + 0.12 * c, yR, 0.3], dir(14 + (6 + 3 * vR) * w + 3 * vL, -30 + (5 + 3 * vR) * w), [0, 0.3, 1]),
    wpnL: WL([0.42 - 0.1 * c, yL, -0.3], dir(-26 + (6 + 4 * vL) * w - 3 * vR, -28 - (5 + 3 * vL) * w), [0, 0.3, -1]),
  };
};
const walkGait = (cyc) => gait({
  // C2 r29 phase B (anim): heel .12 -> .08 — at heel strike the r29 foot's lowest vertex sat 27-28 mm up on the integrated GLB
  // (one sample; r28 8 mm; foot gate <= 25): a flatter strike keeps the heel on the floor. lift/duty trims did not touch that instant.
  P: WALK_P, v: 3.85, duty: 0.48, cx: 0.38, lift: 0.12, heel: 0.08, bob: 0.036, hipsY: -0.08, twist: 10, lean: -11, width: 0.0,
  upper: walkUpper(cyc),
});
const walk = [...walkGait(0), ...walkGait(1).map((k) => ({ ...k, t: k.t + WALK_P }))];
// C2 r24 (anim): push-off toe lift. The gait pitches the foot toes-down (pushOff) faster than it raises the ankle, so the
// boot tip sank up to 33 mm into the floor (foot probe, r18). Raise the ankle so the boot pivots on its tip instead.
const TOE_L = 0.21;
// Blade sweep for the run pump: c = 1 leading → c = 0 the mid direction → c = -1 trailing (quadratic blend, normalised).
const sweep = (lead, mid, trail, c) => {
  const a = ((1 + c) * (1 + c)) / 4, m = (1 - c * c) / 2, b = ((1 - c) * (1 - c)) / 4;
  const v = [0, 1, 2].map((i) => a * lead[i] + m * mid[i] + b * trail[i]), l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};
const toeLift = (f) => (f && f[3] < 0 ? [f[0], Math.max(f[1], TOE_L * Math.sin((-f[3] * Math.PI) / 180)), ...f.slice(2)] : f);
const lifted = (keys) => keys.map((k) => ({ ...k, footL: toeLift(k.footL), footR: toeLift(k.footR) }));
const runKeys = lifted(gait({
  P: 0.5, v: 8.84, duty: 0.22, cx: 0.44, lift: 0.36, heel: 0.1, bob: 0.05, hipsY: -0.1, hipsX: 0.08, twist: 9, lean: -27,
  flight: 0.15, strike: 4, pushOff: 42, width: 0.0,   // C2 r29: lean -24 -> -27 (poses sheet run)
  upper: (ph) => {
    // C2 r25 (anim fix; board r19 Opus: "one fist stays locked at the hip and the gold sabre is held stiff and level;
    // the arms never pump"): both arms PUMP contralateral to the legs (right hand forward as the left foot lands), the
    // leading sabre angled forward-up, the trailing one back-up; between them each blade sweeps up and OUT over the
    // shoulder line (never down: tips stay high, nothing crosses the legs or the hip drape), its wrist lagging the hand.
    // The pelvis turns with the forward leg and the chest counter-rotates (net shoulders ~9 deg the other way), the
    // clavicles push forward with each arm, the chest dips at every contact; the head holds the line (look .88).
    const a = TAU * (ph + 0.03), c = Math.cos(a), cb = Math.cos(a - 0.4), s = Math.sin(TAU * (ph - 0.11));
    const hand = (k) => [0.02 + 0.4 * k, -0.17 + 0.12 * k - 0.06 * (1 - k * k), 0.45 - 0.02 * k + 0.03 * (1 - k * k)];
    const R = hand(c), L = hand(-c);
    return {
      pose: { ...torso({ pelvis: -10 * c, yaw: 19 * c, pitch: -27 - 2 * Math.cos(2 * a), roll: 3.5 * s, pelvisRoll: -3 * s, look: 0.88 }),
        clavicle_R: [-1.5 * (1 + c), 7 * c, 0], clavicle_L: [1.5 * (1 - c), 7 * c, 0], ...ELBOW(elRun(c), elRun(-c)) },
      wpn: W(R, sweep(dir(24, 38), [0, 0.7, 0.72], dir(164, 26), cb), [0, 0.3, 1]),   // C2 r29: trail further back and lower (sheet run)
      wpnL: WL([L[0], L[1], -L[2]], sweep(dir(-24, 38), [0, 0.7, -0.72], dir(-164, 26), -cb), [0, 0.3, -1]),
    };
  },
}));
// C2 r25: the loop STARTS at ph 0.25 (both blades mid-sweep, up and out = nearest the idle hold). Hero.js plays 'run'
// from t 0 with a 0.1 s fade; from ph 0 the idle->run blend slerped Dusk the long way round (~130 deg in one frame,
// gate whip 4,400 deg/s). Footstep events shift with it (L lands at n 0.77, R at 0.27).
const RUN_START = 4;   // of 16 samples
const run = runKeys.map((_, i) => ({ ...runKeys[(i + RUN_START) % runKeys.length], t: (i * 0.5) / runKeys.length }));

// Seraphine owns both hover and READY presentation; confirmation must retain the body line.
// C2 r25 (anim fix; board r19 Opus: "the select pose is passive and sway-backed, pelvis forward and sabres hanging low,
// next to Brann's raised greatsword"): an ACTIVE dancer's guard. Weight forward over the balls of the feet (front heel
// up, hips a touch forward, chest leaning in -6 instead of the r24 S-curve that pushed the pelvis out), chin level,
// head turned toward the select camera (~20 deg to her right). Dawn (right) RAISED high above the right shoulder, blade
// flaring up and out-back over the shoulder line (flat to the camera); Dusk (left) extended low and forward in guard,
// pointing down-forward-left. One diagonal line from the raised gold sabre to the low violet one, both inside the frame.
// C2 r26 (anim fix2; board r20 Opus: "the select pose is knock-kneed (knees together, feet splayed)"): the knees solve
// toward her forward (bake + runtime plant pole), so a BENT knee over a turned-out foot caved in (r25: back knee 33 deg
// inside its toe line, select_knees.mjs). Now a grounded dancer's stance: the front (left) foot FLAT and turned out 16
// deg with its knee bent over the toes, the back (right) leg long (near-straight knee) on the ball of a turned-out foot,
// hips forward over the front foot and squarer (pelvis -16 -> -8; the chest keeps its net turn, so the raised Dawn and
// the low Dusk keep their r25 lines).
// C2 r29 (Amazon rebuild; poses sheet panel 4): confident CONTRAPPOSTO for the select camera (front, ~20 deg to her right).
// The weight on the LEFT (far) leg: straight, foot flat and turned out 20 deg, the hips shifted over it (z -.04) with the left
// hip high (pelvisRoll +6); the right (near) leg relaxed out to the side with a soft knee over a flat, straight foot (knee rule).
// Chest counter-tilt, chin up, head to the camera. Dawn RAISED: the hand above the head, the gold blade sweeping LEFT-up across the camera plane
// over the crown (clear of the face/hair top), flat to the camera; Dusk hangs long beside the left thigh pointing down-forward-
// left (tip ~.15 m off the floor, .14 m outside the thigh). FK upper-arm hints only seed the elbow poles (raised arm: elbow
// up-out; hanging arm: elbow down-out).
const SEL = (b) => ({
  pose: { ...torso({ pelvis: -10 - b, yaw: 6 + b, pitch: -4 - b * 0.6, roll: -4, pelvisRoll: 6, look: 0.7, hy: -14, hp: 4, hr: 2 }),   // it4: +X pelvis roll = left hip HIGH
    clavicle_R: [-8 - b, 4, 0], clavicle_L: [2, 0, 0], ...arm('R', { upper: [0.15, 0.75, 0.6] }), ...arm('L', { upper: [0.1, -1, -0.3] }) },
  hips: [0.0, -0.03 - b * 0.004, -0.04],
  ...feet([0.0, 0, -0.02, 0, 20], [0.08, 0, 0.1, 0, 4]),
  wpn: W([0.05, 0.98 + b * 0.01, 0.22], dir(-100 - b * 3, 35 + b), [0.9, 0.2, 0.35]),   // it3: blade LEFT-up across the camera plane (az -140 foreshortened to a hilt)
  wpnL: WL([0.12, -0.76 - b * 0.005, -0.46], dir(-30 + b * 2, -50 + b), [0.9, 0.2, -0.3]),
});
// C2 r25 (anim fix; board r19 Sol: counter-motion): the guard idle keeps r24's grips, feet and blade lines (gate-proven)
// but breathes like a dancer: the weight sways between the feet (hips z) with the pelvis dropping on the free side, the
// chest counter-rolls and turns a little, the head counter-tilts, the clavicles follow, a light 1 Hz bounce on the balls
// of the feet, and both wrists play (Dawn's tip circles ±12 deg, Dusk's ±7 deg, out of phase). 24 samples, Catmull-Rom.
// C2 r27: idle feet = the same knee-over-toe logic as select_stand (r26): the front (left) foot flat and nearly straight with the
// knee bent over the toes, the back (right) leg long on the ball of a foot turned out 8 deg (r26: 28 deg with an 18 cm knee bend =
// the knee 31 deg inside its toe line), both feet a little wider; hips forward over the front foot.
// C2 r29 (Amazon rebuild; sheet docs/refs/c2/heroes/seraphine_r29_poses.png panel 1): CONTRAPPOSTO idle. The weight on the RIGHT
// (back) leg: straight, foot flat and turned out (r26/r27 rule: a turned-out foot only under a straight leg), the hips
// shifted over it (z +.05) with that hip high (pelvisRoll -7); the free left leg forward and a little out with a soft knee over
// a flat, straight foot. The chest counter-tilts (right shoulder low), the head counters again, chin up. Arms long at the sides
// and a touch forward, elbows soft (ELBOW_DOWN, shared with walk/run), both sabres LOW and READY: hands at mid-thigh height
// outside the hips, tips down-out past the thighs (Dawn dir(62,-48), Dusk dir(-72,-48)) >= .15 m off the floor; the hands sit
// ahead/outside the thigh capsules so the idle <-> walk blend is a short swing up to the walk carry (no leg crossing).
// 24 samples, Catmull-Rom: weight sway, pelvis/chest counter-roll, 1 Hz bounce, wrist play (Dawn +-7, Dusk +-6, out of phase).
// it3 (knees probe it2: right knee 13.5 cm bent, 25 deg inside its toe line; feet yaw WITH the pelvis turn, so the left foot was
// toe-in 13 deg): hips higher (y -.025 -> -.005) so the weight leg is straight, toe-out per foot set against the -18 pelvis turn
// (L 16 -> ~0 deg vs forward, R 6 -> ~24), the hip shift/tilt stronger (z .05, pelvisRoll 7) for the contrapposto read.
// it4: a +X pelvis roll DROPS the right hip (it3 probe: the weight leg bent 10 cm, the free leg straight) -> pelvisRoll -7,
// chest roll +4, head roll -2.5: the right hip rides high over the straight weight leg, the left knee softens.
const IDLE_FEET = feet([0.1, 0, -0.04, 0, 16], [-0.1, 0, 0.02, 0, 6]);
const IDLE_KEYS = Array.from({ length: 25 }, (_, i) => {
  const u = i / 24, a = TAU * u, s1 = Math.sin(a), c1 = Math.cos(a), c2 = Math.cos(2 * a);
  return {
    f: i * 5,
    pose: { ...torso({ pelvis: -18 + 2 * c1, yaw: 6 + 2 * s1, pitch: -3 + 0.8 * c2, roll: 4 - 1.5 * s1, pelvisRoll: -7 + 1.5 * s1, look: 0.95, hr: -2.5 + s1, hp: 3 }),
      clavicle_R: [-0.8 * (1 + s1), 2 * s1, 0], clavicle_L: [0.8 * (1 - s1), 2 * s1, 0], ...ELBOW_DOWN },
    hips: [0.01 + 0.006 * c1, -0.005 - 0.004 * (1 - Math.cos(4 * a)), 0.05 + 0.008 * s1],
    ...(i === 0 ? IDLE_FEET : {}),
    // it2: Dusk out and more sideways (z -.44 -> -.48, az -58 -> -72): with the left leg forward its blade passed .02 m from the
    // left thigh capsule in idle / at walk taps (gate it1); Dawn matched for the V read (the right leg is back: .13 m clear).
    wpn: W([0.22 + 0.02 * s1, -0.78 + 0.012 * c2, 0.46], dir(62 + 7 * Math.sin(a + 0.6), -48 + 4 * Math.sin(2 * a + 1)), [0, 0.3, 1]),
    wpnL: WL([0.22 - 0.02 * s1, -0.78 + 0.01 * c2, -0.48], dir(-72 - 6 * Math.sin(a + 1.4), -48 + 4 * Math.sin(2 * a + 2)), [0, 0.3, -1]),
  };
});
const SELECT_PRESENTATION = {
  frames: 120, loop: true, plant: 1, guard: 0, breathe: 0.8, tags: ['idle'],
  keys: [{ f: 0, ...SEL(0) }, { f: 60, ease: 'inOut', ...SEL(1) }, { f: 120, ease: 'inOut', ...SEL(0) }],
};
// C2 r31 (owner playtest of r30: "she's already in her selected pose before being selected, and once selected doesn't move"):
// three select clips instead of one shared loop. src/ui/select3d.js plays select_stand while she is unselected / hovered,
// select_ready (one-shot) on READY, then select_hold (loop) once select_ready has finished.
// CAM = the select camera's direction in character space (~20 deg to her right, a little above): flats face it (an edge-on
// sabre reads as a needle on this set).
const CAM = [0.92, 0.19, 0.35];
// select_stand = the r29 poses sheet panel 1 (IDLE): the idle's contrapposto (weight on the right hip, both sabres LOW and
// READY, gate-proven hand/blade lines) as a slower 3 s loop, the head turned toward the camera, the flats rolled to the camera
// (Dusk's flat a little less, so its curve still bows away from the front thigh) with a slow wrist roll that catches the light.
const STAND_KEYS = Array.from({ length: 37 }, (_, i) => {
  const u = i / 36, a = TAU * u, s1 = Math.sin(a), c1 = Math.cos(a), c2 = Math.cos(2 * a), s2 = Math.sin(2 * a);
  return {
    f: i * 5,
    pose: { ...torso({ pelvis: -18 + 2 * c1, yaw: 6 + 2 * s1, pitch: -3 + 0.8 * c2, roll: 4 - 1.5 * s1, pelvisRoll: -7 + 1.5 * s1, look: 0.95, hy: -9 + 3 * Math.sin(a + 0.8), hr: -2.5 + s1, hp: 3 }),
      clavicle_R: [-0.8 * (1 + s1), 2 * s1, 0], clavicle_L: [0.8 * (1 - s1), 2 * s1, 0], ...ELBOW_DOWN },
    hips: [0.01 + 0.006 * c1, -0.005 - 0.004 * (1 - Math.cos(4 * a)), 0.05 + 0.008 * s1],
    ...(i === 0 ? IDLE_FEET : {}),
    wpn: W([0.22 + 0.02 * s1, -0.78 + 0.012 * c2, 0.46], dir(62 + 9 * Math.sin(a + 0.6), -48 + 5 * Math.sin(2 * a + 1)), [CAM[0], CAM[1] + 0.25 * s2, CAM[2]]),
    wpnL: WL([0.22 - 0.02 * s1, -0.78 + 0.01 * c2, -0.48], dir(-72 - 8 * Math.sin(a + 1.4), -48 + 5 * Math.sin(2 * a + 2)), [0.95, 0.15 - 0.25 * Math.sin(2 * a + 1.2), -0.05]),
  };
});
// select_hold = the raised SELECT pose (SEL, panel 4) kept alive while she waits: two breaths per 4 s loop (SEL's own b), a slow
// weight shift between the hips with the chest countering, Dawn's wrist play over the crown (+-5 deg, a slow flat roll that
// glints), Dusk's tip circling a little, and a slow head turn toward / away from the camera. Same body line as SEL at every key.
const SELH = (u) => {
  const a = TAU * u, s1 = Math.sin(a), b = 0.5 * (1 - Math.cos(2 * a));
  const k = SEL(b);
  return {
    ...k,
    pose: { ...k.pose, ...torso({ pelvis: -10 - b, yaw: 6 + b - 1.5 * s1, pitch: -4 - b * 0.6, roll: -4 - 1.2 * s1, pelvisRoll: 6 + 1.5 * s1, look: 0.7, hy: -14 + 6 * Math.sin(a + 1), hp: 4 - b, hr: 2 + 1.5 * s1 }) },
    hips: [0.0, -0.03 - b * 0.004, -0.04 + 0.012 * s1],
    wpn: W([0.05 + 0.012 * s1, 0.98 + b * 0.01, 0.22], dir(-100 - b * 3 + 5 * Math.sin(2 * a + 0.5), 35 + b + 3 * Math.sin(a)), [0.9, 0.2 + 0.12 * Math.sin(2 * a), 0.35]),
    // Dusk 6 deg further out than SEL (hand 1.7 cm out): SEL's own Dusk passes ~1.5-2 cm from the left thigh skin, so its circle
    // only swings outward of that line (r31 probe: min 1.5 cm -> see notes)
    wpnL: WL([0.12, -0.76 - b * 0.005, -0.49], dir(-36 + b * 2 + 3 * Math.sin(2 * a + 2), -50 + b + 2 * Math.sin(a + 1)), [0.9, 0.2, -0.3]),
  };
};
const HOLD_KEYS = Array.from({ length: 13 }, (_, i) => ({ f: i * 20, ...SELH(i / 12) }));
// select_ready = the SELECTION BEAT (1.4 s, one-shot) from the stand into SEL: a quick coil (knees give, chin down, the chest
// winds right, Dawn's wrist cocks back by the hip, Dusk snaps up to a forward guard) -> Dawn swept up the right side in one arc
// (forward-out, vertical beside the head, then laid LEFT over the crown) while Dusk fans up and back down the left side in the
// camera plane and the right foot steps out to the select stance -> plant with an overshoot (hips dip, Dawn past its line) ->
// rebound -> settle on select_hold's first key (no pop into the hold). Feet: plant off for the step, back on at the plant.
const READY_KEYS = [
  { f: 0, ...STAND_KEYS[0], plant: 1 },
  { f: 10, pose: { ...torso({ pelvis: -20, yaw: -6, pitch: -9, roll: 2, pelvisRoll: -5, look: 0.8, hy: -10, hp: -6 }), clavicle_R: [-2, -3, 0], clavicle_L: [1, 2, 0], ...ELBOW_DOWN },
    hips: [0.01, -0.065, 0.04], ...IDLE_FEET, plant: 1,
    wpn: W([0.12, -0.62, 0.42], dir(120, -40), CAM), wpnL: WL([0.38, -0.5, -0.36], dir(-90, 0), [0.95, 0.15, 0]) },
  { f: 19, pose: { ...torso({ pelvis: -14, yaw: 2, pitch: -2, roll: 0, pelvisRoll: 0, look: 0.8, hy: -12, hp: 0 }), clavicle_R: [-6, 4, 0], clavicle_L: [2, 0, 0], ...arm('R', { upper: [0.4, 0.2, 0.8] }), ...arm('L', { upper: [0.1, -0.7, -0.6] }) },
    hips: [0.0, -0.025, 0.0], ...feet([0.07, 0.0, -0.03, 0, 18], [-0.02, 0.05, 0.06, 0, 5]), plant: 0,
    wpn: W([0.55, -0.1, 0.5], dir(30, 25), CAM), wpnL: WL([0.32, -0.38, -0.44], dir(-80, 60), [0.95, 0.15, 0.1]) },
  { f: 28, pose: { ...torso({ pelvis: -10, yaw: 7, pitch: 2, roll: -3, pelvisRoll: 4, look: 0.75, hy: -14, hp: 6 }), clavicle_R: [-9, 5, 0], clavicle_L: [2, 0, 0], ...arm('R', { upper: [0.2, 0.7, 0.65] }), ...arm('L', { upper: [0.1, -0.9, -0.4] }) },
    hips: [0.0, -0.01, -0.03], ...feet([0.0, 0.0, -0.02, 0, 20], [0.08, 0.012, 0.1, 0, 4]), plant: 0,
    wpn: W([0.36, 0.6, 0.5], dir(0, 78), CAM), wpnL: WL([0.18, -0.55, -0.5], dir(-110, 10), [0.95, 0.15, -0.1]) },
  { f: 38, ease: 'outCubic', ...SEL(3), hips: [0.0, -0.058, -0.045], ...feet([0.0, 0, -0.02, 0, 20], [0.08, 0, 0.1, 0, 4]), plant: 1,
    wpn: W([0.05, 1.02, 0.22], dir(-112, 32), [0.9, 0.2, 0.35]), wpnL: WL([0.12, -0.78, -0.5], dir(-42, -47), [0.9, 0.2, -0.3]) },
  { f: 52, ease: 'inOut', ...SEL(-0.6), hips: [0.0, -0.024, -0.038], wpn: W([0.05, 0.975, 0.22], dir(-96, 37), [0.9, 0.2, 0.35]), wpnL: WL([0.12, -0.757, -0.49], dir(-34, -50), [0.9, 0.2, -0.3]) },
  { f: 66, ease: 'inOut', ...SELH(0), hips: [0.0, -0.034, -0.04] },
  { f: 84, ease: 'inOut', ...SELH(0) },
];

export default {
  rig: 'humanoid', character: 'seraphine', priority: 10,
  clips: {
    // riding: Dawn raised, Dusk held low along the flank (no reins — knees steer); a falling cut from the saddle
    ...rideSet({ carry: W([0.46, -0.02, 0.36], dir(10, 40), [0, 0.3, 1]), carryL: W([0.3, -0.36, -0.42], dir(160, -30), [0, 0.3, -1]), up: W([0.0, 0.86, 0.36], dir(170, 40), [0, 0, 1]), hit: W([0.8, 0.02, 0.3], dir(10, -24), [0, 0, 1]), follow: W([0.56, -0.42, -0.1], dir(-40, -50), [0, 0, 1]) }),
    idle: {  // relaxed asymmetric guard; weight settles over a supporting leg (C2 r25: IDLE_KEYS, dancer's balance)
      frames: 120, loop: true, plant: 1, breathe: 0.65, tags: ['idle'], keys: IDLE_KEYS,
    },
    walk: { duration: 2 * WALK_P, loop: true, keys: walk, events: [{ n: 0.01, name: 'footstep', foot: 'L' }, { n: 0.26, name: 'footstep', foot: 'R' }, { n: 0.51, name: 'footstep', foot: 'L' }, { n: 0.76, name: 'footstep', foot: 'R' }] },
    run: { duration: 0.5, loop: true, keys: run, events: [{ n: 0.27, name: 'footstep', foot: 'R' }, { n: 0.77, name: 'footstep', foot: 'L' }] },

    // ------------------------------------------------------------------------------------------- string
    // light_1: Dawn (right) flat forehand cut right → left (4 / 3 / 12)
    light_1: {
      frames: 19,
      keys: [
        g(0),
        // C1 r5 (board r4: "arm-led cuts, little torso compression"): the cut is driven hip-to-shoulder. f2 coils
        // pelvis AND shoulders away with the weight on the rear foot; f3 the pelvis has already turned while the
        // shoulders still lag (hips lead); f4 the shoulders whip through past the hips, the front foot is planted
        // forward and the rear heel lifts (weight transfer), hips dropped; f7 overshoots; the recovery keeps a little.
        { f: 2, ease: 'out', pose: torso({ pelvis: -44, yaw: -24, pitch: -4, roll: -4 }), hips: [-0.05, -0.1, 0], ...feet([0.2, 0.03, -0.02, -10, 4], [-0.24, 0.0, 0.06, 0, 36]), wpn: W([0.2, 0.22, 0.56], dir(122, 12), [0, 0.3, 1]) },
        { f: 3, ease: 'outCubic', pose: torso({ pelvis: -6, yaw: -10, pitch: -14 }), hips: [0.1, -0.13, 0], ...feet([0.34, 0, -0.02, 0, 4], [-0.26, 0.03, 0.06, -10, 36]) },
        { f: 4, ease: 'outCubic', pose: torso({ pelvis: 10, yaw: 18, pitch: -24, roll: 4 }), hips: [0.2, -0.16, 0], ...feet([0.38, 0, -0.02, 0, 4], [-0.26, 0.07, 0.06, -24, 36]),
          wpn: W([0.76, 0.08, 0.02], dir(0, -2), [0, 0.3, 1]), wpnL: WL([0.0, -0.34, -0.44], dir(170, -20), [0, 0.3, -1]) },
        { f: 7, ease: 'out', pose: torso({ pelvis: 20, yaw: 30, pitch: -26 }), hips: [0.22, -0.16, 0], ...feet([0.38, 0, -0.02, 0, 4], [-0.24, 0.09, 0.06, -30, 36]), wpn: W([0.5, -0.04, -0.36], dir(-58, -18), [0, 0, -1]) },
        { f: 12, ease: 'inOut', pose: torso({ pelvis: -6, yaw: 14, pitch: -14 }), hips: [0.1, -0.11, 0], wpn: W([0.5, 0.0, 0.0], dir(-30, 10), [0, 0.3, 1]), ...ST },
        g(19, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 2, name: 'swing' }, { f: 4, name: 'impact' }],
    },
    // light_2: Dusk (left) answers left → right, hips whipping back (4 / 3 / 12)
    light_2: {
      frames: 19,
      keys: [
        // C1 r5: same hip-to-shoulder drive as light_1, mirrored (coil right → pelvis leads → shoulders whip left)
        { f: 0, pose: torso({ pelvis: 10, yaw: 20, pitch: -14 }), hips: [0.1, -0.11, 0], ...ST, wpn: W([0.46, 0.0, -0.3], dir(-60, -5), [0, 0.3, -1]), wpnL: G_L },
        { f: 2, ease: 'out', pose: torso({ pelvis: 24, yaw: 34, pitch: -6, roll: 4 }), hips: [0.04, -0.1, 0], ...feet([0.2, 0.03, -0.02, -10, 4], [-0.24, 0.0, 0.06, 0, 36]), wpnL: WL([0.2, 0.22, -0.56], dir(-122, 12), [0, 0.3, -1]), wpn: W([0.3, -0.2, 0.3], dir(60, -20), [0, 0.3, 1]) },
        { f: 3, ease: 'outCubic', pose: torso({ pelvis: -8, yaw: 12, pitch: -14 }), hips: [0.1, -0.13, 0], ...feet([0.34, 0, -0.02, 0, 4], [-0.26, 0.03, 0.06, -10, 36]) },
        { f: 4, ease: 'outCubic', pose: torso({ pelvis: -36, yaw: -20, pitch: -24, roll: -4 }), hips: [0.2, -0.16, 0], ...feet([0.38, 0, -0.02, 0, 4], [-0.26, 0.07, 0.06, -24, 36]),
          wpnL: WL([0.76, 0.1, -0.02], dir(0, 0), [0, 0.3, -1]), wpn: W([0.05, -0.3, 0.46], dir(170, -20), [0, 0.3, 1]) },
        { f: 7, ease: 'out', pose: torso({ pelvis: -50, yaw: -30, pitch: -26 }), hips: [0.22, -0.16, 0], ...feet([0.38, 0, -0.02, 0, 4], [-0.24, 0.09, 0.06, -30, 36]), wpnL: WL([0.5, -0.02, 0.36], dir(58, -18), [0, 0, 1]) },
        { f: 12, ease: 'inOut', pose: torso({ pelvis: -28, yaw: -4, pitch: -12 }), hips: [0.08, -0.11, 0], wpnL: WL([0.4, -0.2, -0.1], dir(40, -20), [0, 0.3, -1]), ...ST },
        g(19, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 2, name: 'swing' }, { f: 4, name: 'impact' }],
    },
    // light_3: whirlwind — a full counter-clockwise pirouette, both blades out; Dawn crosses the front on the first
    // window (f6–9), Dusk on the second (f10–14) (6 / 8 / 18)
    light_3: {
      frames: 32, goalSpace: 'chest', look: 0,
      keys: [
        { f: 0, pose: torso({ pelvis: -30, yaw: -2, pitch: -10 }), hips: [0.08, -0.12, 0], ...ST, wpn: W([0.4, 0.0, 0.2], dir(-40, 0), [0, 0.3, 1]), wpnL: WL([0.4, 0.0, -0.3], dir(60, -10), [0, 0.3, -1]) },
        // C1 r5: the spin is loaded from a crouch (hips -0.24) and lands compressed (f15 -0.18) instead of staying tall
        { f: 3, ease: 'out', pose: pose(SPIN_LEGS, torso({ pelvis: -50, yaw: -10, pitch: -24, look: 0 })), hips: [0.06, -0.24, 0],
          wpn: W([0.35, -0.05, -0.2], dir(-60, -10), [0, 0.3, 1]), wpnL: WL([0.3, -0.05, -0.45], dir(-100, -10), [0, 1, 0]) },
        { f: 6, ease: 'in', pose: pose(SPIN_LEGS, torso({ pelvis: 70, pitch: -8, look: 0 })), hips: [0.1, -0.08, 0],
          wpn: W([0.05, 0.1, 0.92], dir(90, 4), [1, 0, 0]), wpnL: WL([0.05, 0.1, -0.92], dir(-90, 4), [1, 0, 0]) },
        { f: 8, ease: 'linear', pose: pose(SPIN_LEGS, torso({ pelvis: 150, pitch: -6, look: 0 })), hips: [0.12, -0.06, 0] },
        { f: 10, ease: 'linear', pose: pose(SPIN_LEGS, torso({ pelvis: 230, pitch: -6, look: 0 })), hips: [0.13, -0.06, 0] },
        { f: 12, ease: 'linear', pose: pose(SPIN_LEGS, torso({ pelvis: 300, pitch: -8, look: 0 })), hips: [0.14, -0.07, 0],
          wpn: W([0.1, 0.05, 0.9], dir(90, -4), [1, 0, 0]), wpnL: WL([0.1, 0.05, -0.9], dir(-90, -4), [1, 0, 0]) },
        { f: 15, ease: 'out', pose: pose(SPIN_LEGS, torso({ pelvis: 350, yaw: 6, pitch: -20, look: 0 })), hips: [0.15, -0.18, 0] },
        { f: 22, ease: 'inOut', pose: pose(torso({ pelvis: 336, yaw: 8, pitch: -10 }), leg('L', { thigh: [0.3, -1, -0.1], shin: [0.1, -1, -0.1] }), leg('R', { thigh: [-0.25, -1, 0.1], shin: [-0.4, -1, 0.1] })), hips: [0.08, -0.1, 0],
          wpn: W([0.5, 0.0, 0.3], dir(0, 10), [0, 0.3, 1]), wpnL: WL([0.2, -0.3, -0.35], dir(160, -30), [0, 0.3, -1]) },
        { f: 32, ease: 'inOut', pose: torso({ pelvis: 336, yaw: 8, pitch: -9, look: 0.95 }), hips: [0, -0.09, 0], ...ST, wpn: G_R, wpnL: G_L, plant: 1 },
      ],
      events: [{ f: 4, name: 'swing' }, { f: 6, name: 'impact' }, { f: 10, name: 'impact' }],
    },
    // pommel_1: Dawn's hilt to the face, blade laid back over the shoulder (3 / 2 / 10)
    pommel_1: {
      frames: 15,
      keys: [
        g(0),
        { f: 1, ease: 'out', pose: torso({ pelvis: -34, yaw: -12, pitch: -6 }), hips: [-0.02, -0.1, 0], wpn: W([0.18, 0.14, 0.42], dir(165, 40), [0, 0, 1]) },
        { f: 3, ease: 'outCubic', pose: torso({ pelvis: 0, yaw: 10, pitch: -12 }), hips: [0.1, -0.1, 0], ...feet([0.32, 0, -0.02, 0, 4], [-0.24, 0.04, 0.06, -12, 36]), wpn: W([0.66, 0.26, 0.06], dir(168, 36), [0, 0, 1]) },
        { f: 7, pose: torso({ pelvis: -4, yaw: 8, pitch: -11 }), hips: [0.09, -0.1, 0], wpn: W([0.58, 0.22, 0.1], dir(162, 40), [0, 0, 1]) },
        g(15, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 1, name: 'swing' }, { f: 3, name: 'impact' }],
    },
    // pommel_2: Dusk's hilt answers from the other side (3 / 2 / 10)
    pommel_2: {
      frames: 15,
      keys: [
        { f: 0, pose: torso({ pelvis: -4, yaw: 8, pitch: -11 }), hips: [0.06, -0.1, 0], ...ST, wpn: W([0.58, 0.22, 0.1], dir(162, 40), [0, 0, 1]), wpnL: G_L },
        { f: 1, ease: 'out', pose: torso({ pelvis: 12, yaw: 20, pitch: -8 }), hips: [0.02, -0.1, 0], wpnL: WL([0.2, 0.14, -0.42], dir(-165, 40), [0, 0, -1]), wpn: W([0.3, -0.2, 0.4], dir(60, -20), [0, 0.3, 1]) },
        { f: 3, ease: 'outCubic', pose: torso({ pelvis: -32, yaw: -14, pitch: -12 }), hips: [0.12, -0.1, 0], ...feet([0.34, 0, -0.02, 0, 4], [-0.24, 0.04, 0.06, -12, 36]), wpnL: WL([0.66, 0.26, -0.06], dir(-168, 36), [0, 0, -1]) },
        { f: 7, pose: torso({ pelvis: -30, yaw: -12, pitch: -11 }), hips: [0.1, -0.1, 0], wpnL: WL([0.58, 0.22, -0.1], dir(-162, 40), [0, 0, -1]) },
        g(15, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 1, name: 'swing' }, { f: 3, name: 'impact' }],
    },
    // close finisher: spinning back kick (pivot right on the left foot, heel to the chest) (6 / 4 / 18)
    kick: {
      frames: 28, goalSpace: 'chest', look: 0,
      keys: [
        g(0),
        { f: 3, ease: 'out', pose: pose(torso({ pelvis: -100, yaw: -10, pitch: -12, look: 0, hy: -50 }),
          leg('L', { thigh: [0.05, -1, -0.1], shin: [0.05, -1, -0.1], toe: [1, -0.4, 0] }), leg('R', { thigh: [0.5, -0.5, 0.25], shin: [-0.6, -0.7, 0.2], toe: [0.3, -0.9, 0] })),
          hips: [0, -0.08, 0], wpn: W([0.2, -0.1, 0.8], dir(80, -30), [0, 1, 0]), wpnL: WL([0.3, 0.1, -0.8], dir(-80, 10), [0, 1, 0]) },
        { f: 6, ease: 'outCubic', pose: pose(torso({ pelvis: -176, yaw: -4, pitch: -30, look: 0, hy: -60, hp: 10 }),
          leg('L', { thigh: [0.1, -1, -0.12], shin: [0.1, -1, -0.12], toe: [1, -0.4, 0] }), leg('R', { thigh: [-1, 0.12, 0.08], shin: [-1, 0.16, 0.06], toe: [-0.2, -1, 0] })),
          hips: [0.05, -0.05, 0], wpn: W([0.3, -0.3, 0.75], dir(40, -50), [0, 0.2, 1]), wpnL: WL([0.3, 0.0, -0.8], dir(-40, -10), [0, 0.2, -1]) },
        { f: 10, pose: pose(torso({ pelvis: -178, yaw: -4, pitch: -28, look: 0, hy: -60, hp: 10 }),
          leg('L', { thigh: [0.1, -1, -0.12], shin: [0.1, -1, -0.12], toe: [1, -0.4, 0] }), leg('R', { thigh: [-1, 0.08, 0.08], shin: [-1, 0.1, 0.06], toe: [-0.2, -1, 0] })), hips: [0.05, -0.05, 0] },
        { f: 15, ease: 'inOut', pose: pose(torso({ pelvis: -220, yaw: -4, pitch: -16, look: 0, hy: -30 }),
          leg('L', { thigh: [0.1, -1, -0.12], shin: [0.05, -1, -0.12], toe: [1, -0.4, 0] }), leg('R', { thigh: [-0.3, -0.6, 0.2], shin: [-0.6, -0.8, 0.15], toe: [0.3, -0.9, 0] })), hips: [0.03, -0.08, 0] },
        { f: 21, ease: 'inOut', pose: pose(torso({ pelvis: -330, yaw: 6, pitch: -10, look: 0.5 }), leg('L', { thigh: [0.25, -1, -0.1], shin: [0.1, -1, -0.1] }), leg('R', { thigh: [-0.25, -1, 0.1], shin: [-0.4, -1, 0.1] })), hips: [0.02, -0.1, 0],
          wpn: W([0.5, 0.0, 0.3], dir(0, 10), [0, 0.3, 1]), wpnL: WL([0.2, -0.3, -0.35], dir(160, -30), [0, 0.3, -1]) },
        { f: 28, ease: 'inOut', pose: torso({ pelvis: -384, yaw: 8, pitch: -9, look: 0.95 }), hips: [0, -0.09, 0], ...ST, wpn: G_R, wpnL: G_L, plant: 1 },
      ],
      events: [{ f: 3, name: 'swing' }, { f: 6, name: 'impact' }],
    },
    grab: {
      frames: 36, loop: true, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -14, yaw: 14, pitch: -10, look: 1 }), hips: [0, -0.12, 0], ...ST_W, wpn: W([0.1, 0.14, 0.5], dir(165, 20), [0, 0, 1]), wpnL: WL([0.74, 0.12, -0.04], dir(170, -55), [0, 0, -1]) },
        { f: 18, pose: torso({ pelvis: -16, yaw: 12, pitch: -12, look: 1 }), hips: [0.01, -0.13, 0], ...ST_W, wpn: W([0.1, 0.18, 0.5], dir(165, 24), [0, 0, 1]), wpnL: WL([0.72, 0.08, -0.04], dir(170, -58), [0, 0, -1]) },
      ],
    },
    knee: {
      frames: 17,
      keys: [
        { f: 0, pose: torso({ pelvis: -14, yaw: 14, pitch: -10, look: 1 }), hips: [0, -0.12, 0], ...ST_W, wpn: W([0.1, 0.14, 0.5], dir(165, 20), [0, 0, 1]), wpnL: WL([0.74, 0.12, -0.04], dir(170, -55), [0, 0, -1]) },
        { f: 3, ease: 'out', pose: torso({ pelvis: -20, yaw: 10, pitch: -2, look: 1 }), hips: [-0.03, -0.08, 0], ...feet([0.3, 0, -0.04, 0, 4], [-0.2, 0.14, 0.08, -30, 20]) },
        { f: 5, ease: 'outCubic', pose: torso({ pelvis: 4, yaw: 4, pitch: -20, look: 1 }), hips: [0.08, -0.04, 0], ...feet([0.3, 0.04, -0.04, -10, 4], [0.46, 0.6, 0.03, -36, 0]), wpnL: WL([0.6, -0.12, -0.04], dir(170, -60), [0, 0, -1]) },
        { f: 9, pose: torso({ pelvis: 2, yaw: 4, pitch: -18, look: 1 }), hips: [0.07, -0.05, 0], ...feet([0.3, 0.03, -0.04, -8, 4], [0.4, 0.48, 0.04, -30, 0]) },
        { f: 17, ease: 'inOut', pose: torso({ pelvis: -14, yaw: 14, pitch: -10, look: 1 }), hips: [0, -0.12, 0], ...ST_W, wpnL: WL([0.74, 0.12, -0.04], dir(170, -55), [0, 0, -1]) },
      ],
      events: [{ f: 5, name: 'impact' }],
    },
    grab_hit: { alias: 'knee' },
    // throw: duck under, heave the foe up and over (grab 5, release 14), flourish spin to recover (32)
    throw: {
      frames: 32, goalSpace: 'chest',
      keys: [
        { f: 0, pose: torso({ pelvis: -14, yaw: 14, pitch: -10 }), hips: [0, -0.12, 0], ...ST_W, wpn: W([0.1, 0.14, 0.5], dir(165, 20), [0, 0, 1]), wpnL: WL([0.74, 0.12, -0.04], dir(170, -55), [0, 0, -1]) },
        { f: 5, ease: 'out', pose: torso({ pelvis: 0, pitch: -26 }), hips: [0.06, -0.3, 0], ...ST_W, wpn: W([0.7, 0.0, 0.2], dir(170, -60), [0, 0, 1]), wpnL: WL([0.7, 0.0, -0.2], dir(-170, -60), [0, 0, -1]) },
        { f: 11, ease: 'inOut', pose: torso({ pelvis: 0, pitch: 10, look: 0.5 }), hips: [0.02, -0.06, 0], ...feet([0.3, 0.05, -0.04, -20, 4], [-0.26, 0.06, 0.08, -30, 40]),
          wpn: W([0.35, 0.92, 0.2], dir(170, 0), [0, 0, 1]), wpnL: WL([0.35, 0.92, -0.2], dir(-170, 0), [0, 0, -1]) },
        { f: 14, ease: 'in', pose: torso({ pelvis: 4, pitch: -22 }), hips: [0.12, -0.12, 0], ...feet([0.42, 0, -0.04, 0, 4], [-0.34, 0.06, 0.08, -24, 40]),
          wpn: W([0.75, 0.45, 0.2], dir(20, 30), [0, 0, 1]), wpnL: WL([0.75, 0.45, -0.2], dir(-20, 30), [0, 0, -1]) },
        { f: 19, ease: 'out', pose: pose(SPIN_LEGS, torso({ pelvis: 150, pitch: -10, look: 0 })), hips: [0.1, -0.08, 0], wpn: W([0.05, 0.1, 0.9], dir(90, 0), [1, 0, 0]), wpnL: WL([0.05, 0.1, -0.9], dir(-90, 0), [1, 0, 0]) },
        { f: 24, ease: 'linear', pose: pose(SPIN_LEGS, torso({ pelvis: 300, pitch: -10, look: 0 })), hips: [0.08, -0.08, 0] },
        { f: 32, ease: 'out', pose: torso({ pelvis: 336, yaw: 8, pitch: -9, look: 0.95 }), hips: [0, -0.09, 0], ...ST, wpn: G_R, wpnL: G_L, plant: 1 },
      ],
      events: [{ f: 5, name: 'grab' }, { f: 14, name: 'impact' }],
    },
    // throw_back: pivot with the foe across the hip and release behind; the pelvis unwinds as the code turns her
    throw_back: {
      frames: 32, goalSpace: 'chest',
      keys: [
        { f: 0, pose: torso({ pelvis: -14, yaw: 14, pitch: -10 }), hips: [0, -0.12, 0], ...ST_W, wpn: W([0.1, 0.14, 0.5], dir(165, 20), [0, 0, 1]), wpnL: WL([0.74, 0.12, -0.04], dir(170, -55), [0, 0, -1]) },
        { f: 5, ease: 'out', pose: torso({ pelvis: 0, pitch: -24 }), hips: [0.04, -0.28, 0], ...ST_W, wpn: W([0.7, 0.0, 0.2], dir(170, -60), [0, 0, 1]), wpnL: WL([0.7, 0.0, -0.2], dir(-170, -60), [0, 0, -1]) },
        { f: 10, ease: 'inOut', pose: pose(SPIN_LEGS, torso({ pelvis: 90, pitch: 4, look: 0 })), hips: [0.0, -0.1, 0], wpn: W([0.6, 0.6, 0.2], dir(170, 10), [0, 0, 1]), wpnL: WL([0.6, 0.6, -0.2], dir(-170, 10), [0, 0, -1]) },
        { f: 14, ease: 'in', pose: pose(SPIN_LEGS, torso({ pelvis: 178, pitch: -20, look: 0 })), hips: [0.06, -0.12, 0], wpn: W([0.75, 0.3, 0.2], dir(20, 20), [0, 0, 1]), wpnL: WL([0.75, 0.3, -0.2], dir(-20, 20), [0, 0, -1]) },
        { f: 20, ease: 'inOut', pose: torso({ pelvis: 20, pitch: -12, look: 0.5 }), hips: [0.04, -0.12, 0], ...ST_W, wpn: W([0.5, 0.0, 0.3], dir(0, 10), [0, 0.3, 1]), wpnL: WL([0.2, -0.3, -0.35], dir(160, -30), [0, 0.3, -1]) },
        g(32, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 5, name: 'grab' }, { f: 14, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- heavy
    // Ember Cross: blades crossed high behind the head (f7 = charge hold), then an X-cut through a deep lunge (11 / 5 / 20)
    heavy: {
      frames: 36,
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: torso({ pelvis: -10, pitch: 12, look: 1 }), hips: [-0.03, -0.14, 0], ...ST_W,
          wpn: W([0.24, 0.76, 0.18], dir(170, 48), [0, 0, 1]), wpnL: WL([0.24, 0.76, -0.18], dir(-170, 48), [0, 0, -1]) },
        { f: 7, ease: 'out', pose: torso({ pelvis: -10, pitch: 16, look: 1 }), hips: [-0.06, -0.2, 0], ...ST_W,
          wpn: W([0.16, 0.8, 0.16], dir(176, 38), [0, 0, 1]), wpnL: WL([0.16, 0.8, -0.16], dir(-176, 38), [0, 0, -1]) },
        { f: 10, ease: 'in', pose: torso({ pelvis: -4, pitch: 0 }), hips: [0.1, -0.18, 0], ...feet([0.46, 0.06, -0.04, 10, 4], [-0.34, 0.02, 0.08, -10, 40]),
          wpn: W([0.6, 0.55, 0.14], dir(10, 62), [0, 0, 1]), wpnL: WL([0.6, 0.55, -0.14], dir(-10, 62), [0, 0, -1]) },
        { f: 11, ease: 'linear', pose: torso({ pelvis: 0, pitch: -24 }), hips: [0.26, -0.24, 0], ...feet([0.58, 0, -0.04, 0, 4], [-0.44, 0.02, 0.08, -18, 40]),
          wpn: W([0.78, 0.06, 0.18], dir(18, -24), [0, 0, 1]), wpnL: WL([0.78, 0.06, -0.18], dir(-18, -24), [0, 0, -1]) },
        { f: 15, ease: 'out', pose: torso({ pelvis: 0, pitch: -28 }), hips: [0.28, -0.26, 0],
          wpn: W([0.48, -0.3, 0.56], dir(72, -40), [0, 1, 0]), wpnL: WL([0.48, -0.3, -0.56], dir(-72, -40), [0, 1, 0]) },
        { f: 22, pose: torso({ pelvis: 0, pitch: -26 }), hips: [0.27, -0.25, 0] },
        { f: 29, ease: 'inOut', pose: torso({ pelvis: -16, yaw: 6, pitch: -12 }), hips: [0.12, -0.14, 0], ...feet([0.34, 0, -0.04, 0, 4], [-0.24, 0.08, 0.08, 0, 36]) },
        g(36, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 8, name: 'swing' }, { f: 11, name: 'impact' }],
    },
    heavy_charge: {
      frames: 30, loop: true,
      keys: [
        { f: 0, pose: torso({ pelvis: -12, pitch: 18, look: 1 }), hips: [-0.07, -0.23, 0], ...ST_W, wpn: W([0.14, 0.82, 0.16], dir(178, 36), [0, 0, 1]), wpnL: WL([0.14, 0.82, -0.16], dir(-178, 36), [0, 0, -1]) },
        { f: 15, pose: torso({ pelvis: -12, pitch: 20, look: 1 }), hips: [-0.08, -0.25, 0], ...ST_W, wpn: W([0.12, 0.84, 0.17], dir(179, 32), [0, 0, 1]), wpnL: WL([0.12, 0.84, -0.17], dir(-179, 32), [0, 0, -1]) },
      ],
    },
    // launcher: coil low, both blades rip upward together, rising onto the toes into a hop (7 / 4 / 18)
    launcher: {
      frames: 29,
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: torso({ pelvis: -10, pitch: -26, look: 1 }), hips: [0.0, -0.3, 0], ...ST_W,
          wpn: W([0.1, -0.56, 0.42], dir(170, -30), [0, 0, 1]), wpnL: WL([0.1, -0.56, -0.42], dir(-170, -30), [0, 0, -1]) },
        { f: 7, ease: 'outCubic', pose: torso({ pelvis: 0, pitch: -4 }), hips: [0.12, 0.0, 0], ...feet([0.36, 0.06, -0.04, -30, 4], [-0.2, 0.1, 0.08, -40, 36]),
          wpn: W([0.7, 0.24, 0.14], dir(8, 52), [0, 0, 1]), wpnL: WL([0.7, 0.24, -0.14], dir(-8, 52), [0, 0, -1]) },
        { f: 10, ease: 'out', pose: torso({ pelvis: 0, pitch: 14 }), hips: [0.14, 0.08, 0], ...feet([0.34, 0.16, -0.04, -30, 4], [-0.18, 0.2, 0.08, -40, 36]),
          wpn: W([0.3, 0.92, 0.2], dir(4, 86), [0, 0, 1]), wpnL: WL([0.3, 0.92, -0.2], dir(-4, 86), [0, 0, -1]) },
        { f: 15, ease: 'in', pose: torso({ pelvis: -6, pitch: -10 }), hips: [0.1, -0.16, 0], ...ST_W },
        g(29, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 4, name: 'swing' }, { f: 7, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- air
    jump_up: {
      frames: 20,
      keys: [
        { f: 0, pose: torso({ pelvis: -20, pitch: -24 }), hips: [0.02, -0.24, 0], ...ST_W, wpn: W([0.3, -0.5, 0.42], dir(150, -30), [0, 0.3, 1]), wpnL: WL([0.3, -0.5, -0.42], dir(-150, -30), [0, 0.3, -1]) },
        { f: 4, ease: 'out', pose: torso({ pelvis: -14, pitch: 4 }), hips: [0.02, 0.03, 0], ...feet([0.1, 0.04, -0.03, -50, 4], [-0.14, 0.08, 0.06, -60, 30]),
          wpn: W([-0.1, -0.4, 0.45], dir(175, -40), [0, 0.3, 1]), wpnL: WL([-0.1, -0.4, -0.45], dir(-175, -40), [0, 0.3, -1]) },
        { f: 20, ease: 'inOut', pose: pose(torso({ pelvis: -14, pitch: -10 })), hips: [0.02, 0.0, 0], ...feet([0.3, 0.46, -0.03, 20, 4], [0.04, 0.3, 0.06, -10, 30]),
          wpn: W([0.3, 0.1, 0.62], dir(60, 20), [0, 1, 0.3]), wpnL: WL([0.3, 0.1, -0.62], dir(-60, 20), [0, 1, -0.3]) },
      ],
    },
    jump_fall: {
      frames: 36, loop: true,
      keys: [
        { f: 0, pose: torso({ pelvis: -14, pitch: -6 }), ...feet([0.28, 0.18, -0.03, 10, 4], [-0.12, 0.08, 0.06, -10, 30]), wpn: W([0.3, 0.12, 0.66], dir(70, 20), [0, 1, 0.3]), wpnL: WL([0.3, 0.12, -0.66], dir(-70, 20), [0, 1, -0.3]) },
        { f: 18, pose: torso({ pelvis: -14, pitch: -4 }), ...feet([0.26, 0.12, -0.03, 12, 4], [-0.14, 0.04, 0.06, -6, 30]), wpn: W([0.3, 0.16, 0.68], dir(70, 24), [0, 1, 0.3]), wpnL: WL([0.3, 0.16, -0.68], dir(-70, 24), [0, 1, -0.3]) },
      ],
    },
    land: {
      frames: 14, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -20, pitch: -22 }), hips: [0.04, -0.26, 0], ...ST_W, wpn: W([0.35, -0.2, 0.62], dir(70, -10), [0, 1, 0.3]), wpnL: WL([0.35, -0.2, -0.62], dir(-70, -10), [0, 1, -0.3]) },
        { f: 3, ease: 'out', pose: torso({ pelvis: -20, pitch: -25 }), hips: [0.05, -0.29, 0] },
        g(14, { ease: 'inOut' }),
      ],
    },
    land_heavy: { alias: 'land' },
    // jump_attack: aerial pirouette — a full spin in the air, both blades out, then the blades held low (3 / 40)
    jump_attack: {
      frames: 43, goalSpace: 'chest', look: 0,
      keys: [
        { f: 0, ease: 'out', pose: pose(TUCK_LEGS, torso({ pelvis: -40, pitch: -6, look: 0 })), wpn: W([0.3, 0.2, 0.7], dir(60, 20), [0, 1, 0]), wpnL: WL([0.3, 0.2, -0.7], dir(-60, 20), [0, 1, 0]) },
        { f: 3, ease: 'linear', pose: pose(TUCK_LEGS, torso({ pelvis: 70, pitch: -10, look: 0 })), wpn: W([0.05, 0.05, 0.92], dir(90, -10), [1, 0, 0]), wpnL: WL([0.05, 0.05, -0.92], dir(-90, -10), [1, 0, 0]) },
        { f: 6, ease: 'linear', pose: pose(TUCK_LEGS, torso({ pelvis: 190, pitch: -10, look: 0 })) },
        { f: 9, ease: 'linear', pose: pose(TUCK_LEGS, torso({ pelvis: 300, pitch: -14, look: 0 })) },
        { f: 13, ease: 'out', pose: pose(TUCK_LEGS, torso({ pelvis: 340, pitch: -22, look: 0.6 })), wpn: W([0.6, -0.3, 0.3], dir(20, -50), [0, 0, 1]), wpnL: WL([0.6, -0.3, -0.3], dir(-20, -50), [0, 0, -1]) },
        { f: 43, pose: pose(TUCK_LEGS, torso({ pelvis: 340, pitch: -20, look: 0.6 })), wpn: W([0.58, -0.28, 0.3], dir(20, -48), [0, 0, 1]), wpnL: WL([0.58, -0.28, -0.3], dir(-20, -48), [0, 0, -1]) },
      ],
      events: [{ f: 1, name: 'swing' }, { f: 3, name: 'impact' }],
    },
    air_light: { alias: 'jump_attack' },
    // run_jump_attack: the long leap — split legs, body stretched forward, scissor cut with both blades (3 / 40)
    run_jump_attack: {
      frames: 43,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -10, pitch: 8, look: 1 }), ...feet([0.5, 0.2, -0.03, 20, 4], [-0.5, 0.32, 0.06, -50, 30]),
          wpn: W([0.0, 0.62, 0.36], dir(165, 40), [0, 0, 1]), wpnL: WL([0.0, 0.62, -0.36], dir(-165, 40), [0, 0, -1]) },
        { f: 3, ease: 'outCubic', pose: torso({ pelvis: 0, pitch: -28 }), ...feet([0.64, 0.2, -0.03, 24, 4], [-0.6, 0.34, 0.06, -56, 30]),
          wpn: W([0.8, 0.0, 0.1], dir(-20, -20), [0, 0.3, 1]), wpnL: WL([0.8, 0.02, -0.1], dir(20, -20), [0, 0.3, -1]) },
        { f: 8, ease: 'out', pose: torso({ pelvis: 0, pitch: -30 }), wpn: W([0.62, -0.2, -0.3], dir(-60, -35), [0, 1, 0]), wpnL: WL([0.62, -0.2, 0.3], dir(60, -35), [0, 1, 0]) },
        { f: 43, pose: torso({ pelvis: 0, pitch: -26 }), ...feet([0.56, 0.18, -0.03, 20, 4], [-0.52, 0.28, 0.06, -50, 30]) },
      ],
      events: [{ f: 1, name: 'swing' }, { f: 3, name: 'impact' }],
    },
    // death_stab: flip the blades point-down at the apex and drop onto the foe (6 / 45)
    death_stab: {
      frames: 51,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -8, pitch: 8, look: 1 }), ...feet([0.26, 0.46, -0.04, 10, 4], [-0.06, 0.34, 0.06, -20, 30]),
          wpn: W([0.3, 0.8, 0.2], dir(10, 80), [0, 0, 1]), wpnL: WL([0.3, 0.8, -0.2], dir(-10, 80), [0, 0, -1]) },
        { f: 5, ease: 'inOut', pose: torso({ pelvis: -6, pitch: 12, look: 1 }), wpn: W([0.26, 0.9, 0.16], dir(6, -84), [0, 0, 1]), wpnL: WL([0.26, 0.9, -0.16], dir(-6, -84), [0, 0, -1]) },
        // C2 r1: grips driven 0.42 arm-lengths lower with a deeper lean — the sabre tips sat 0.56 m above her feet, so a
        // lying body (0.4 m) was unreachable; now ≈ 0.3 m (the hit box in movesets/seraphine.js is the tip)
        { f: 7, ease: 'in', pose: torso({ pelvis: 0, pitch: -32, look: 0.8 }), ...feet([0.3, 0.4, -0.04, 6, 4], [-0.14, 0.3, 0.06, -26, 30]),
          wpn: W([0.52, -0.72, 0.14], dir(8, -84), [0, 0, 1]), wpnL: WL([0.52, -0.72, -0.14], dir(-8, -84), [0, 0, -1]) },
        { f: 51, pose: torso({ pelvis: 0, pitch: -34, look: 0.8 }), wpn: W([0.54, -0.74, 0.14], dir(8, -86), [0, 0, 1]), wpnL: WL([0.54, -0.74, -0.14], dir(-8, -86), [0, 0, -1]) },
      ],
      events: [{ f: 6, name: 'swing' }],
    },
    // air_slam: falcon dive — tuck, then drop blades-first, both sabres reversed beneath her (5 / 60)
    air_slam: {
      frames: 65,
      keys: [
        { f: 0, ease: 'out', pose: torso({ pelvis: -8, pitch: 10, look: 1 }), ...feet([0.3, 0.46, -0.04, 10, 4], [0.0, 0.36, 0.06, -20, 30]),
          wpn: W([0.1, 0.7, 0.4], dir(150, 40), [0, 0, 1]), wpnL: WL([0.1, 0.7, -0.4], dir(-150, 40), [0, 0, -1]) },
        { f: 5, ease: 'in', pose: torso({ pelvis: 0, pitch: -30, look: 0.8 }), ...feet([0.14, 0.34, -0.04, 0, 4], [-0.2, 0.22, 0.06, -30, 30]),
          wpn: W([0.46, -0.32, 0.14], dir(8, -80), [0, 0, 1]), wpnL: WL([0.46, -0.32, -0.14], dir(-8, -80), [0, 0, -1]) },
        { f: 65, pose: torso({ pelvis: 0, pitch: -28, look: 0.8 }) },
      ],
      events: [{ f: 4, name: 'swing' }],
    },
    air_heavy_slam: { alias: 'air_slam' },
    air_slam_land: {
      frames: 17, plant: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -10, pitch: -36, look: 0.7 }), hips: [0.06, -0.42, 0], ...ST_W,
          wpn: W([0.5, -0.66, 0.34], dir(10, -76), [0, 0, 1]), wpnL: WL([0.5, -0.66, -0.34], dir(-10, -76), [0, 0, -1]) },
        { f: 3, ease: 'out', pose: torso({ pelvis: -10, pitch: -38, look: 0.7 }), hips: [0.06, -0.45, 0] },
        { f: 9, ease: 'outCubic', pose: torso({ pelvis: -20, pitch: -10 }), hips: [0.02, -0.12, 0], wpn: W([0.5, 0.1, 0.5], dir(60, 30), [0, 1, 0.3]), wpnL: WL([0.3, -0.2, -0.5], dir(-120, -10), [0, 1, -0.3]) },
        g(17, { ease: 'inOut' }),
      ],
      events: [{ f: 0, name: 'impact' }],
    },

    // ------------------------------------------------------------------------------------------- dash / back / evade
    // run_attack: FLYING KICK — leap (the move adds vy), right heel driven forward, blades swept back (4 / 9 / 16)
    run_attack: {
      frames: 29,
      keys: [
        { f: 0, pose: torso({ pelvis: -10, pitch: -20 }), hips: [0.06, -0.16, 0], ...ST_W, wpn: W([-0.3, -0.34, 0.42], dir(172, -8), [0, 0.3, 1]), wpnL: WL([-0.3, -0.34, -0.42], dir(-172, -8), [0, 0.3, -1]) },
        // C1 r5 (board r4: "a low seated hop, then a sideways ground swing"): the kick now reads as a leap — the move's
        // vy is 4.0 (was 2.5), the torso stays nearer upright (pitch 6, not 16 reclined), the right heel drives
        // forward at hip height with the left shin tucked under, the blades sweep back-and-up; the landing (f17-f22)
        // is a deep absorbed crouch with both blades driven down-forward, then the guard recovers.
        { f: 2, ease: 'out', pose: torso({ pelvis: -20, pitch: -4, look: 1 }), hips: [0.0, 0.02, 0], ...feet([0.1, 0.44, -0.04, 0, 10], [0.3, 0.38, 0.04, 30, 0]) },
        // C2 r29 (Amazon rebuild; poses sheet panel 3): a HIGH flying kick. The right leg drives straight forward-UP (~20 deg above
        // the hip: foot rel (.85, +.31) hip-heights = an over-reached, straight leg; r28 pointed 24 deg below the hip), the torso
        // opens back (pitch +10) with the chin tucked, the left shin stays tucked under. Dusk (left) is flung HIGH forward-up over
        // the head, Dawn (right) swept back-up behind her; the move's ticks (4 / 9 / 16) are unchanged.
        // C2 r30 (anim fix; loincloth): the pelvis turns LESS into the kick (-32 -> -4) and the spine/chest take the rest (yaw -6 ->
        // -34: the same -38 deg net chest turn, so the head, both blade goals and the arms are unchanged). At -32 the pelvis yaw swung
        // the front loincloth's root onto the kicking thigh's line (kilt_F_1 2.4 cm from the thigh axis at the apex: no spring could
        // keep the panel out of the leg, 7 frames at -3.9 cm); squarer hips keep the right hip beside the panel.
        { f: 4, ease: 'outCubic', pose: { ...torso({ pelvis: -4, yaw: -34, pitch: 10, look: 1, hp: -6 }), ...arm('L', { upper: [0.3, 0.9, -0.35] }) }, hips: [-0.06, 0.04, 0], ...feet([-0.12, 0.4, -0.06, -24, 10], [0.79, 1.27, 0.0, 70, 0]),
          wpn: W([-0.34, 0.3, 0.5], dir(170, 34), [0, 0.3, 1]), wpnL: WL([0.3, 0.8, -0.36], dir(-18, 62), [0, 0.3, -1]) },
        { f: 13, pose: { ...torso({ pelvis: -4, yaw: -34, pitch: 8, look: 1, hp: -6 }), ...arm('L', { upper: [0.3, 0.9, -0.35] }) }, hips: [-0.06, 0.02, 0], ...feet([-0.1, 0.38, -0.06, -20, 10], [0.76, 1.22, 0.0, 66, 0]) },
        { f: 17, ease: 'in', pose: torso({ pelvis: -20, pitch: -30, look: 0.8 }), hips: [0.06, -0.32, 0], ...feet([0.34, 0, -0.04, 0, 4], [-0.26, 0.02, 0.08, -8, 40]),
          wpn: W([0.5, -0.34, 0.5], dir(30, -52), [0, 0.3, 1]), wpnL: WL([0.5, -0.34, -0.5], dir(-30, -52), [0, 0.3, -1]) },
        { f: 22, ease: 'out', pose: torso({ pelvis: -22, pitch: -18 }), hips: [0.03, -0.2, 0], wpn: W([0.44, -0.16, 0.5], dir(50, -24), [0, 0.3, 1]), wpnL: WL([0.44, -0.16, -0.5], dir(-50, -24), [0, 0.3, -1]) },
        g(29, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 2, name: 'swing' }, { f: 4, name: 'impact' }],
    },
    // back_attack: reverse pivot, Dawn whips around behind at head height, Dusk trailing (3 / 5 / 14)
    back_attack: {
      frames: 22,
      keys: [
        g(0),
        { f: 1, ease: 'out', pose: torso({ pelvis: 0, yaw: 16, pitch: -8, look: 0.2 }), hips: [0.02, -0.12, 0], wpn: W([0.5, 0.1, -0.3], dir(-50, 0), [0, 0.3, -1]) },
        { f: 3, ease: 'outCubic', pose: torso({ pelvis: -70, yaw: -40, pitch: -6, look: 0.2 }), hips: [-0.06, -0.12, 0], ...feet([0.2, 0.02, -0.02, -10, 4], [-0.28, 0.02, 0.1, -10, 70]),
          wpn: W([-0.36, 0.2, 0.56], dir(170, 4), [0, 0.3, 1]), wpnL: WL([0.3, 0.1, -0.6], dir(-40, 0), [0, 0.3, -1]) },
        { f: 7, ease: 'out', pose: torso({ pelvis: -86, yaw: -50, pitch: -6, look: 0.2 }), hips: [-0.08, -0.12, 0], wpn: W([-0.4, 0.14, 0.1], dir(-160, 0), [0, 0.3, 1]), wpnL: WL([-0.1, 0.1, -0.6], dir(-150, 0), [0, 0.3, -1]) },
        { f: 14, ease: 'inOut', pose: torso({ pelvis: -40, yaw: -10, pitch: -8 }), hips: [-0.03, -0.1, 0], ...ST, wpn: W([0.3, 0.0, 0.4], dir(40, 10), [0, 0.3, 1]), wpnL: G_L },
        g(22, { ease: 'inOut', plant: 1 }),
      ],
      events: [{ f: 1, name: 'swing' }, { f: 3, name: 'impact' }],
    },
    // dodge_roll: quick tucked forward roll, blades hugged along the forearms (22)
    dodge_roll: {
      frames: 22, goalSpace: 'chest',
      keys: [
        { f: 0, pose: torso({ pitch: -26 }), hips: [0.04, -0.26, 0], ...ST_W, wpn: W([0.3, -0.25, 0.3], dir(175, -10), [0, 0, 1]), wpnL: WL([0.3, -0.25, -0.3], dir(-175, -10), [0, 0, -1]) },
        // C1 r5 (board r4: "head planting into the ground line" at f4-f12): hips were -0.5..-0.55 m while inverted, which
        // put the head below the floor; now -0.3/-0.26 with a tighter chin-to-chest tuck (neck -42 / head -24)
        { f: 4, ease: 'in', pose: pose(TUCK_LEGS, { hips: [0, 0, -80], spine: [0, 0, -34], chest: [0, 0, -26], neck: [0, 0, -42], head: [0, 0, -24] }), hips: [0.14, -0.3, 0] },
        { f: 10, pose: pose(TUCK_LEGS, { hips: [0, 0, -190], spine: [0, 0, -36], chest: [0, 0, -26], neck: [0, 0, -42], head: [0, 0, -24] }), hips: [0.2, -0.26, 0] },
        { f: 16, pose: pose(TUCK_LEGS, { hips: [0, 0, -300], spine: [0, 0, -24], chest: [0, 0, -14], neck: [0, 0, -14], head: [0, 0, -6] }), hips: [0.12, -0.26, 0] },
        { f: 22, ease: 'out', pose: pose({ hips: [0, 0, -360] }, torso({ pelvis: 0, pitch: -14 }), leg('L', { thigh: [0.3, -1, -0.1], shin: [0, -1, -0.1] }), leg('R', { thigh: [-0.2, -1, 0.1], shin: [-0.4, -1, 0.1] })), hips: [0.02, -0.12, 0] },
      ],
    },
    // sidestep: a half-twirl slip, low and quick
    sidestep: {
      frames: 22, goalSpace: 'chest',
      keys: [
        g(0),
        { f: 4, ease: 'out', pose: pose(SPIN_LEGS, torso({ pelvis: -80, pitch: -24, roll: 10, look: 0.5 })), hips: [-0.04, -0.26, 0.06] },
        { f: 10, pose: pose(SPIN_LEGS, torso({ pelvis: -200, pitch: -18, roll: 6, look: 0 })), hips: [-0.03, -0.2, 0.04] },
        { f: 16, ease: 'inOut', pose: pose(SPIN_LEGS, torso({ pelvis: -330, pitch: -12, look: 0.5 })), hips: [0, -0.14, 0] },
        { f: 22, ease: 'inOut', pose: torso({ pelvis: -384, yaw: 8, pitch: -9, look: 0.95 }), hips: [0, -0.09, 0], ...ST, wpn: G_R, wpnL: G_L },
      ],
    },

    // ------------------------------------------------------------------------------------------- show
    taunt: {
      frames: 60, plant: 1,
      keys: [
        g(0),
        { f: 12, ease: 'out', pose: torso({ pelvis: -30, yaw: 10, pitch: 6, look: 0.6, hp: 8 }), hips: [0, -0.05, 0], ...feet([0.14, 0.04, -0.06, -12, 4], [-0.16, 0, 0.1, 0, 40]),
          wpn: W([0.2, 1.0, 0.3], dir(0, 88), [0.7, 0, 0.7]), wpnL: WL([0.3, -0.2, -0.62], dir(-90, -30), [0, 1, 0]) }, // C1 r5: flat at 45 deg
        { f: 30, ease: 'inOut', pose: torso({ pelvis: -34, yaw: 14, pitch: 2, look: 0.9, hr: 8 }), hips: [0, -0.06, 0],
          wpn: W([0.5, 0.4, 0.14], dir(-30, 50), [0, 0, 1]), wpnL: WL([0.5, 0.4, -0.14], dir(30, 50), [0, 0, -1]) },
        { f: 46, pose: torso({ pelvis: -34, yaw: 14, pitch: 3, look: 0.9, hr: 8 }), hips: [0, -0.06, 0] },
        g(60, { ease: 'inOut' }),
      ],
      events: [{ f: 30, name: 'roar' }],
    },
    victory: {
      frames: 96, loop: true, breathe: 1,
      keys: [
        { f: 0, pose: torso({ pelvis: -30, yaw: -4, pitch: 4, roll: -6, look: 0.4, hp: 8 }), hips: [0, -0.04, 0.03], ...feet([0.14, 0.03, -0.08, -10, 10], [-0.1, 0, 0.1, 0, 30]),
          wpn: W([0.2, 1.0, 0.36], dir(10, 84), [0.7, 0, 0.7]), wpnL: WL([0.0, 0.2, -0.36], dir(170, 50), [-0.7, 0, -0.7]) }, // C1 r5: flats at 45 deg (select-camera needle)
        { f: 48, pose: torso({ pelvis: -30, yaw: -6, pitch: 6, roll: -7, look: 0.4, hp: 10 }), hips: [0, -0.035, 0.03], ...feet([0.14, 0.03, -0.08, -10, 10], [-0.1, 0, 0.1, 0, 30]),
          wpn: W([0.22, 1.02, 0.34], dir(6, 86), [0.7, 0, 0.7]), wpnL: WL([0.0, 0.22, -0.36], dir(170, 52), [-0.7, 0, -0.7]) },
      ],
    },
    // select_stand (C2 r2, hero-weapons; src/ui/select3d.js plays it when it exists, else idle): the select camera is
    // ~20 deg off her forward axis (char-space dir ≈ [0.92, 0.19, 0.35]); Dawn raised on the right, Dusk low on the left,
    // both flats to the camera so the gold / violet PAIR reads.
    // C2 r31: three clips (owner: "already in her selected pose before being selected, and once selected doesn't move"):
    // select_stand = the sheet's IDLE stance (sabres low and ready, flats to this camera); select_ready = the one-shot
    // selection beat into the raised pose (select3d.js plays it on READY); select_hold = the raised pose kept alive, played by
    // select3d.js once select_ready has finished (heroes without select_hold keep their clamped last key).
    select_stand: { frames: 180, loop: true, plant: 1, breathe: 0.7, tags: ['idle'], keys: STAND_KEYS },
    select_ready: { frames: 84, loop: false, plant: 1, guard: 0, breathe: 0.8, keys: READY_KEYS },
    select_hold: { frames: 240, loop: true, plant: 1, guard: 0, breathe: 0.8, tags: ['idle'], keys: HOLD_KEYS },
    // magic: blades crossed low, then flung up into a burning V (castPeak)
    magic_cast: {
      frames: 50,
      keys: [
        g(0),
        { f: 12, ease: 'out', pose: torso({ pitch: -22, look: 0.6 }), hips: [0, -0.22, 0], ...ST_W, wpn: W([0.5, -0.4, 0.1], dir(-40, -30), [0, 0, 1]), wpnL: WL([0.5, -0.4, -0.1], dir(40, -30), [0, 0, -1]) },
        { f: 22, ease: 'outCubic', pose: torso({ pitch: 16, look: 0.3, hp: 12 }), hips: [0, 0.03, 0], ...feet([0.1, 0.05, -0.08, -20, 8], [-0.1, 0.05, 0.1, -20, 20]),
          wpn: W([0.2, 1.0, 0.44], dir(20, 72), [0, 0, 1]), wpnL: WL([0.2, 1.0, -0.44], dir(-20, 72), [0, 0, -1]) },
        { f: 40, pose: torso({ pitch: 13, look: 0.3, hp: 10 }), hips: [0, 0.02, 0] },
        g(50, { ease: 'inOut' }),
      ],
      events: [{ f: 22, name: 'castPeak' }],
    },
  },
};
