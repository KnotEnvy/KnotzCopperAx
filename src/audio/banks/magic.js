// Magic SFX per element, scaled by tier (1..6). Cast sounds are LIVE (not pre-rendered: they are long, rare, and tier
// changes their layering); impacts too. opts.tier (1..6), opts.maxTier. Also generic pickups: pot chime, food.
import { kit, S } from '../dsp.js';

const tierOf = (o) => Math.max(1, Math.min(6, o.tier || 1));
const LIVE = (dur, extra = {}) => ({ dur, live: true, gain: 1, verb: 0.35, max: 2, ...extra });

// Rock crack: noisy transient + low knock, used by earth (and debris everywhere)
function rock(k, t, g = 1) {
  k.noise({ t, a: 0.0005, d: 0.05, g, drive: 6, filter: { type: 'bandpass', f: k.r(700, 1600), q: 1 } });
  k.tone({ type: 'sine', f: k.r(70, 110), fTo: 35, t, a: 0.001, d: 0.3, g: g * 0.9 });
  k.noise({ color: 'pink', t: t + 0.01, a: 0.01, d: 0.25, g: g * 0.4, filter: { type: 'lowpass', f: 900 } });
}
function thunder(k, t, g = 1, len = 2.5) {
  k.noise({ t, a: 0.0003, d: 0.06, g: g * 1.1, drive: 8, filter: { type: 'highpass', f: 900 } }); // crack
  k.noise({ t: t + 0.005, a: 0.002, d: 0.12, g: g * 0.8, filter: { type: 'bandpass', f: 2200, q: 0.7 } });
  k.noise({ color: 'brown', t: t + 0.03, a: 0.08, d: len, g: g * 0.9, filter: { type: 'lowpass', f: 380, fTo: 90 } }); // rumble roll
  k.tone({ type: 'sine', f: 60, fTo: 28, t, a: 0.003, d: 0.9, g: g * 0.9 });
}
function zap(k, t, d, g) {
  k.tone({ type: 'sawtooth', f: k.r(70, 110), fTo: k.r(40, 60), t, a: 0.003, d, g: g * 0.35, drive: 5, vib: 1200, vibRate: k.r(25, 60), filter: { type: 'bandpass', f: 1800, q: 0.8 } });
  k.noise({ t, a: 0.002, d, g: g * 0.35, filter: { type: 'highpass', f: 4000 } });
}

export default {
  id: 'magic',
  sounds: {
    magic_rise: S({ dur: 1.2, gain: 0.8, verb: 0.3 }, (ctx, out, o) => { // generic cast charge-up (pots glow)
      const k = kit(ctx, out, o);
      k.noise({ a: 0.7, d: 0.3, g: 0.5, filter: { type: 'bandpass', f: 300, fTo: 3500, fTime: 0.9, q: 3 } });
      [293.66, 440, 587.33].forEach((f, i) => k.tone({ type: 'triangle', f, fTo: f * 2, fTime: 0.95, t: i * 0.05, a: 0.6, d: 0.35, g: 0.12 }));
    }),
    magic_earth: S(LIVE(5.5), (ctx, out, o) => {
      const k = kit(ctx, out, o), T = tierOf(o), len = 1.2 + T * 0.65, G = 0.55 + T * 0.08;
      k.noise({ color: 'brown', a: 0.4, hold: len * 0.6, d: len * 0.5, g: G, filter: { type: 'lowpass', f: 160 + T * 40, q: 1.5 } }); // ground rumble
      k.tone({ type: 'sine', f: 38, fTo: 30, a: 0.5, d: len, g: G * 0.8, vib: 40, vibRate: 7 });
      const n = 2 + T * 2;
      for (let i = 0; i < n; i++) rock(k, 0.25 + (i / n) * len * 0.9 + k.r(0, 0.1), 0.35 + k.r(0, 0.4) * (0.6 + T * 0.08));
      if (T >= 4) k.noise({ color: 'pink', t: len * 0.4, a: 0.3, d: len * 0.6, g: 0.3, filter: { type: 'bandpass', f: 500, q: 0.8 } }); // landslide wash
    }),
    magic_fire: S(LIVE(5.5), (ctx, out, o) => {
      const k = kit(ctx, out, o), T = tierOf(o), len = 1.0 + T * 0.55, G = 0.45 + T * 0.08;
      k.tone({ type: 'sine', f: 90, fTo: 45, a: 0.01, d: 0.5, g: 0.9 }); // whoomph ignition
      k.noise({ color: 'pink', a: 0.01, d: 0.35, g: 0.8, filter: { type: 'bandpass', f: 300, fTo: 1500, fTime: 0.15, q: 0.9 } });
      k.noise({ color: 'pink', t: 0.1, a: 0.35, hold: len * 0.5, d: len * 0.5, g: G, filter: { type: 'bandpass', f: 500 + T * 90, q: 0.7, then: { type: 'lowpass', f: 2600 } } }); // roar
      k.noise({ color: 'brown', t: 0.1, a: 0.3, hold: len * 0.5, d: len * 0.4, g: G * 0.6, filter: { type: 'lowpass', f: 250 } });
      const n = 8 + T * 7; // crackle
      for (let i = 0; i < n; i++) k.noise({ t: 0.15 + k.r(0, len), a: 0.0003, d: k.r(0.004, 0.015), g: k.r(0.1, 0.35), filter: { type: 'highpass', f: k.r(2000, 5000) } });
    }),
    magic_storm: S(LIVE(5.5), (ctx, out, o) => {
      const k = kit(ctx, out, o), T = tierOf(o), len = 1.0 + T * 0.6, G = 0.5 + T * 0.1;
      k.noise({ color: 'pink', a: 0.6, hold: len * 0.4, d: len * 0.5, g: 0.3, filter: { type: 'bandpass', f: 800, fTo: 300, q: 0.8 } }); // wind
      zap(k, 0.1, 0.5, G);
      const n = 1 + T;
      for (let i = 0; i < n; i++) { const t = 0.35 + (i / n) * len * 0.8 + k.r(0, 0.1); zap(k, t, k.r(0.08, 0.2), G * 0.8); if (i === n - 1 || k.rng() < 0.3) thunder(k, t + 0.05, 0.5 + T * 0.07, 1.2 + T * 0.3); }
    }),
    impact_earth: S(LIVE(2.5), (ctx, out, o) => { const k = kit(ctx, out, o), T = tierOf(o); rock(k, 0, 0.8 + T * 0.06); rock(k, k.r(0.05, 0.12), 0.5); k.noise({ color: 'brown', a: 0.01, d: 1 + T * 0.2, g: 0.6, filter: { type: 'lowpass', f: 300 } }); }),
    impact_fire: S(LIVE(2.5), (ctx, out, o) => { const k = kit(ctx, out, o), T = tierOf(o); k.tone({ type: 'sine', f: 100, fTo: 40, a: 0.002, d: 0.6, g: 0.9 }); k.noise({ color: 'pink', a: 0.005, d: 0.6 + T * 0.1, g: 0.8, drive: 3, filter: { type: 'bandpass', f: 700, fTo: 300, q: 0.8 } }); for (let i = 0; i < 12; i++) k.noise({ t: k.r(0.02, 0.8), a: 0.0003, d: 0.008, g: 0.25, filter: { type: 'highpass', f: 3000 } }); }),
    impact_storm: S(LIVE(3), (ctx, out, o) => { const k = kit(ctx, out, o), T = tierOf(o); zap(k, 0, 0.12, 0.9); thunder(k, 0.03, 0.75 + T * 0.05, 1.4 + T * 0.2); }),

    // pot pickup: bright bell + sparkle run; the engine raises pitch per pot held (semitone steps)
    pickup_pot: S({ dur: 1.2, gain: 0.7, verb: 0.35, bus: 'ui', jit: 0 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.metal({ f: 1318.5, g: 0.4, ratios: [1, 2, 2.99, 4.2], decays: [0.9, 0.5, 0.3, 0.15], gains: [1, 0.35, 0.2, 0.1] });
      [1760, 2217.5, 2637].forEach((f, i) => k.tone({ type: 'sine', f, t: 0.05 + i * 0.045, a: 0.002, d: 0.35, g: 0.14 }));
      k.tone({ type: 'triangle', f: 659.25, a: 0.002, d: 0.4, g: 0.25 });
    }),
    // food: soft crunch/gulp + warm three-note chord (health restored)
    pickup_food: S({ dur: 1.4, gain: 0.8, verb: 0.3, bus: 'ui', jit: 0 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.noise({ color: 'pink', a: 0.002, d: 0.08, g: 0.5, filter: { type: 'bandpass', f: 1600, q: 1.5 } });
      k.noise({ t: 0.12, a: 0.004, d: 0.12, g: 0.5, filter: { type: 'bandpass', f: 350, fTo: 180, q: 4 } }); // gulp
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => k.tone({ type: 'triangle', f, t: 0.18 + i * 0.07, a: 0.01, d: 0.8, g: 0.16 }));
    }),
  },
};
