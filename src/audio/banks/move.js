// Locomotion SFX: footsteps per surface (dirt, wood, shell/stone, water), jump, land, heavy land, dodge, perfect-dodge
// time-warp, water splash (ring-outs). Steps are quiet and have 6 variants each so a run never machine-guns.
import { kit, S } from '../dsp.js';

const step = (fn) => S({ dur: 0.3, gain: 0.5, v: 6, jit: 0.06, max: 6, gap: 0.04 }, fn);

export default {
  id: 'move',
  sounds: {
    step_dirt: step((ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.tone({ type: 'sine', f: k.r(85, 110), fTo: 50, a: 0.002, d: 0.07, g: 0.7 });
      k.noise({ color: 'pink', a: 0.003, d: k.r(0.05, 0.08), g: 0.8, filter: { type: 'lowpass', f: k.r(700, 1100) } });
      for (let i = 0; i < 3; i++) k.noise({ t: k.r(0.005, 0.05), a: 0.0005, d: 0.01, g: 0.12, filter: { type: 'bandpass', f: k.r(2500, 4500), q: 3 } }); // grit
    }),
    step_wood: step((ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.noise({ a: 0.0008, d: 0.06, g: 0.9, filter: { type: 'bandpass', f: k.r(260, 340), q: 6 } }); // hollow plank
      k.noise({ a: 0.0005, d: 0.04, g: 0.5, filter: { type: 'bandpass', f: k.r(650, 900), q: 5 } });
      k.tone({ type: 'sine', f: k.r(95, 120), fTo: 70, a: 0.002, d: 0.06, g: 0.5 });
      if (k.rng() < 0.35) k.tone({ type: 'sawtooth', f: k.r(140, 200), fTo: k.r(120, 240), t: 0.03, a: 0.03, d: 0.1, g: 0.05, filter: { type: 'bandpass', f: 1600, q: 8 } }); // creak
    }),
    step_stone: step((ctx, out, o) => { // tortoise shell / flagstones: hard click + hollow knock
      const k = kit(ctx, out, o);
      k.noise({ a: 0.0004, d: 0.018, g: 0.8, filter: { type: 'bandpass', f: k.r(2200, 3200), q: 2 } });
      k.noise({ a: 0.0008, d: 0.05, g: 0.6, filter: { type: 'bandpass', f: k.r(900, 1400), q: 3 } });
      k.noise({ a: 0.001, d: 0.07, g: 0.5, filter: { type: 'bandpass', f: k.r(190, 250), q: 8 } }); // shell hollowness
      k.tone({ type: 'sine', f: k.r(90, 110), fTo: 60, a: 0.002, d: 0.05, g: 0.45 });
    }),
    step_water: step((ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.noise({ a: 0.004, d: k.r(0.12, 0.18), g: 0.75, filter: { type: 'bandpass', f: 900, fTo: 2600, q: 1.1 } });
      k.noise({ color: 'pink', a: 0.002, d: 0.06, g: 0.5, filter: { type: 'lowpass', f: 700 } });
      for (let i = 0; i < 3; i++) { const f = k.r(500, 900); k.tone({ type: 'sine', f, fTo: f * k.r(1.6, 2.4), t: k.r(0.02, 0.12), a: 0.002, d: 0.03, g: 0.12 }); } // droplets
    }),
    jump: S({ dur: 0.3, gain: 0.55, jit: 0.06 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.noise({ color: 'pink', a: 0.03, d: 0.12, g: 0.7, filter: { type: 'bandpass', f: 500, fTo: 1600, q: 1 } }); // cloth whoosh up
      k.noise({ color: 'pink', a: 0.002, d: 0.05, g: 0.5, filter: { type: 'lowpass', f: 800 } }); // push-off scuff
    }),
    land: S({ dur: 0.35, gain: 0.7, max: 3 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.tone({ type: 'sine', f: k.r(115, 135), fTo: 55, a: 0.001, d: 0.12, g: 0.9 });
      k.noise({ color: 'pink', a: 0.002, d: 0.1, g: 0.6, filter: { type: 'lowpass', f: 1500 } });
      k.noise({ t: 0.01, a: 0.01, d: 0.12, g: 0.2, filter: { type: 'bandpass', f: 3000, q: 1 } }); // dust hiss
    }),
    land_heavy: S({ dur: 0.9, gain: 0.95, verb: 0.2, max: 2 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.tone({ type: 'sine', f: k.r(70, 85), fTo: 32, a: 0.001, d: 0.38, g: 1.3 });
      k.noise({ color: 'pink', a: 0.002, d: 0.28, g: 0.75, drive: 3, filter: { type: 'lowpass', f: 1300, fTo: 300 } });
      for (let i = 0; i < 6; i++) k.noise({ t: 0.03 + k.r(0, 0.3), a: 0.0005, d: 0.015, g: 0.14, filter: { type: 'bandpass', f: k.r(1500, 4000), q: 3 } }); // debris
    }),
    dodge: S({ dur: 0.35, gain: 0.6, jit: 0.07 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.noise({ color: 'pink', a: 0.06, d: 0.14, g: 0.85, filter: { type: 'bandpass', f: 700, fPeak: 2600, fPeakT: 0.08, fTo: 800, q: 1.4 } });
      k.noise({ color: 'pink', t: 0.1, a: 0.002, d: 0.06, g: 0.3, filter: { type: 'lowpass', f: 900 } }); // foot scuff
    }),
    // perfect dodge: reverse swell → tape-stop dive → shimmering bell cluster over a sub boom (time bends)
    dodge_perfect: S({ dur: 2.0, gain: 0.95, verb: 0.45, max: 1, v: 2 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.noise({ color: 'white', a: 0.22, d: 0.03, g: 0.55, filter: { type: 'bandpass', f: 400, fTo: 6000, fTime: 0.24, q: 2 } }); // reverse suck
      k.tone({ type: 'sawtooth', f: 900, fTo: 120, fTime: 0.8, t: 0.24, a: 0.01, d: 0.8, g: 0.18, filter: { type: 'lowpass', f: 2600, fTo: 400 } }); // tape stop
      k.tone({ type: 'sine', f: 70, fTo: 34, t: 0.24, a: 0.004, d: 1.0, g: 1.1 });
      [1567.98, 2093, 2637, 3136].forEach((f, i) => k.tone({ type: 'sine', f: f * k.r(0.995, 1.005), t: 0.25 + i * 0.03, a: 0.004, d: 1.3, g: 0.12, vib: 18, vibRate: 3 }));
    }),
    splash: S({ dur: 1.4, gain: 1, verb: 0.3, max: 2, v: 3 }, (ctx, out, o) => { // big water ring-out splash
      const k = kit(ctx, out, o);
      k.tone({ type: 'sine', f: 110, fTo: 40, a: 0.002, d: 0.3, g: 1 });
      k.noise({ a: 0.006, d: 0.6, g: 0.9, filter: { type: 'bandpass', f: 600, fPeak: 3200, fPeakT: 0.08, fTo: 900, q: 0.8 } });
      k.noise({ color: 'pink', t: 0.1, a: 0.1, d: 0.8, g: 0.35, filter: { type: 'bandpass', f: 1800, q: 0.9 } }); // spray rain-down
      for (let i = 0; i < 10; i++) { const f = k.r(500, 1400); k.tone({ type: 'sine', f, fTo: f * k.r(1.5, 2.5), t: k.r(0.1, 0.9), a: 0.002, d: 0.035, g: 0.1 }); }
    }),
  },
};
