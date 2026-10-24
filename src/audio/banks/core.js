// Combat SFX: weapon whooshes per weapon, hits by weight, blocks, OTG/death-stab, KO boom + ring, body impacts.
// Every sound is layered (transient / body / sub / tail) and randomised through k.r() so each pre-rendered variant differs.
// Legacy names kept for external callers: hit_light, hit_heavy (tally stamp), swing/thud/bodyfall are engine aliases.
import { kit, S, noiseBuffer } from '../dsp.js';

// ---- whooshes: band-limited noise with a filter sweep that follows the blade's arc; heavier = lower, longer, + sub hum.
function whoosh(k, { f0, fPeak, f1, dur, q = 1.2, g = 0.9, sub = 0, color = 'pink', tail = 0 }) {
  const d = dur * k.r(0.9, 1.12);
  k.noise({ color, a: d * 0.45, d: d * 0.55, g, filter: { type: 'bandpass', f: f0 * k.r(0.9, 1.1), fPeak: fPeak * k.r(0.88, 1.12), fPeakT: d * 0.5, fTo: f1, q } });
  // air edge: brighter thin layer slightly behind the main sweep
  k.noise({ color: 'white', t: d * 0.12, a: d * 0.35, d: d * 0.4, g: g * 0.22, filter: { type: 'highpass', f: fPeak * 1.6, q: 0.7 } });
  if (sub) k.tone({ type: 'sine', f: sub * k.r(0.9, 1.1), fTo: sub * 0.6, a: d * 0.4, d: d * 0.7, g: g * 0.55 });
  if (tail) k.noise({ color: 'brown', t: d * 0.4, a: 0.02, d: tail, g: g * 0.25, filter: { type: 'lowpass', f: 500 } });
}

// ---- impact layers
function thump(k, { f = 120, fTo = 50, d = 0.18, g = 1, t = 0 }) { k.tone({ type: 'sine', f: f * k.r(0.92, 1.08), fTo, fTime: d * 0.6, t, a: 0.001, d, g }); }
function smack(k, { f = 1400, q = 1.1, d = 0.05, g = 0.9, t = 0 }) { k.noise({ color: 'white', t, a: 0.0005, d: d * k.r(0.85, 1.2), g, filter: { type: 'bandpass', f: f * k.r(0.8, 1.25), q } }); }
function crunch(k, { d = 0.12, g = 0.8, f = 900, drive = 6, t = 0 }) {
  k.noise({ color: 'white', t, a: 0.001, d, g, drive, filter: { type: 'bandpass', f: f * k.r(0.8, 1.2), q: 0.9, then: { type: 'lowpass', f: 3800 } } });
  // bone crackle: a few tiny clicks right after the transient
  const n = 2 + Math.floor(k.r(0, 3));
  for (let i = 0; i < n; i++) k.noise({ t: t + 0.004 + k.r(0, 0.05), a: 0.0003, d: 0.006, g: g * 0.5, filter: { type: 'highpass', f: 2500 } });
}
// Dedicated sub-thump (round 2): the "mass" of a body blow, independent of the crack transient.
// Pitch-enveloped sine (fStart -> f in `glide`, then a slow sag) with a flat hold and its OWN exponential tail
// (setTargetAtTime, tau), gently saturated for 2nd/3rd-harmonic translation on small speakers, low-passed so it
// never smears the crack. A low-passed brown-noise "air push" rides the same envelope for texture.
// Starts a few ms after the transient so the crack reads first, the weight lands under it (SoR4/Absolum layering).
function subThump(k, { f = 58, fStart = f * 1.8, glide = 0.05, hold = 0.08, tau = 0.08, g = 1, t = 0.004, sat = 1.6, air = 0.45, lp = 170 }) {
  const { ctx, P } = k, s = k.t0 + t, a = 0.006, h0 = s + a + hold, end = h0 + tau * 7;
  const fl = f * k.r(0.94, 1.06);
  const bus = k.filter('lowpass', lp, 0.6); // saturation harmonics above ~lp are removed
  const sh = k.shaper(sat, bus);
  const env = (node) => { const p = node.gain; p.setValueAtTime(0, s); p.linearRampToValueAtTime(g, s + a); p.setValueAtTime(g, h0); p.setTargetAtTime(0, h0, tau); };
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(fStart * P, s);
  o.frequency.exponentialRampToValueAtTime(fl * P, s + glide);
  o.frequency.exponentialRampToValueAtTime(fl * 0.82 * P, end);
  const e = ctx.createGain(); env(e); o.connect(e); e.connect(sh);
  o.start(s); o.stop(end + 0.02);
  if (air) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 'brown'); src.loop = true;
    {
      const nf = k.filter('lowpass', fl * 1.4, 1.1, bus), ng = ctx.createGain(); ng.connect(nf);
      const p = ng.gain; p.setValueAtTime(0, s); p.linearRampToValueAtTime(g * air, s + a); p.setValueAtTime(g * air, s + a + hold * 0.5); p.setTargetAtTime(0, s + a + hold * 0.5, tau * 0.7);
      src.connect(ng); src.start(s, k.r(0, 0.5)); src.stop(end);
    }
  }
  return end;
}
function ring(k, { f = 1150, d = 1.4, g = 0.35, t = 0 }) {
  k.metal({ f: f * k.r(0.95, 1.05), t, g, ratios: [1, 1.5, 2.43, 3.87, 5.1], decays: [d, d * 0.7, d * 0.45, d * 0.3, d * 0.2], gains: [1, 0.55, 0.4, 0.22, 0.15] });
}

export default {
  id: 'core',
  sounds: {
    whoosh_greatsword: S({ dur: 0.55, gain: 0.9, verb: 0.15 }, (ctx, out, o) => { const k = kit(ctx, out, o); whoosh(k, { f0: 220, fPeak: 820, f1: 260, dur: 0.36, q: 1.0, g: 1, sub: 75, tail: 0.1 }); }),
    whoosh_greatsword_heavy: S({ dur: 0.8, gain: 1, verb: 0.2 }, (ctx, out, o) => { const k = kit(ctx, out, o); whoosh(k, { f0: 160, fPeak: 640, f1: 180, dur: 0.52, q: 0.9, g: 1.1, sub: 55, tail: 0.18 }); k.tone({ type: 'sawtooth', f: 48, fTo: 36, a: 0.2, d: 0.35, g: 0.12, filter: { type: 'lowpass', f: 220 } }); }),
    whoosh_sabre: S({ dur: 0.3, gain: 0.75, verb: 0.1, jit: 0.07 }, (ctx, out, o) => { const k = kit(ctx, out, o); whoosh(k, { f0: 1300, fPeak: 4600, f1: 1800, dur: 0.15, q: 1.8, g: 0.8 }); k.tone({ type: 'sine', f: k.r(2900, 3600), fTo: 2400, a: 0.03, d: 0.08, g: 0.06 }); }),
    whoosh_axe: S({ dur: 0.45, gain: 0.9, verb: 0.12 }, (ctx, out, o) => { const k = kit(ctx, out, o); whoosh(k, { f0: 420, fPeak: 1500, f1: 380, dur: 0.24, q: 1.4, g: 1, sub: 90 }); k.noise({ t: 0.13, a: 0.03, d: 0.08, g: 0.2, filter: { type: 'bandpass', f: 2600, q: 3 } }); }),
    whoosh_axe_heavy: S({ dur: 0.7, gain: 1, verb: 0.18 }, (ctx, out, o) => { const k = kit(ctx, out, o); whoosh(k, { f0: 260, fPeak: 1100, f1: 220, dur: 0.42, q: 1.1, g: 1.1, sub: 62, tail: 0.14 }); }),
    whoosh_fist: S({ dur: 0.22, gain: 0.6, jit: 0.08 }, (ctx, out, o) => { const k = kit(ctx, out, o); whoosh(k, { f0: 600, fPeak: 1900, f1: 700, dur: 0.11, q: 1.3, g: 0.7 }); }),
    whoosh_blade: S({ dur: 0.35, gain: 0.7, jit: 0.07 }, (ctx, out, o) => { const k = kit(ctx, out, o); whoosh(k, { f0: 800, fPeak: 2800, f1: 900, dur: 0.19, q: 1.5, g: 0.8 }); }),
    whoosh_club: S({ dur: 0.5, gain: 0.85, verb: 0.1 }, (ctx, out, o) => { const k = kit(ctx, out, o); whoosh(k, { f0: 250, fPeak: 900, f1: 250, dur: 0.32, q: 0.9, g: 1, sub: 70 }); }),

    // light flesh/leather: slap transient + short body thump + leather creak
    hit_light: S({ dur: 0.35, gain: 0.85, verb: 0.12, max: 5 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      smack(k, { f: 1500, q: 0.9, d: 0.045, g: 1 });
      smack(k, { f: 380, q: 1.4, d: 0.07, g: 0.7 });
      thump(k, { f: 150, fTo: 70, d: 0.12, g: 0.9 });
      k.tone({ type: 'triangle', f: k.r(210, 260), fTo: 120, a: 0.001, d: 0.06, g: 0.35 });
    }),
    // blade cutting cloth/flesh: bright tearing layer (added to light/heavy hits by bladed weapons)
    hit_slash: S({ dur: 0.3, gain: 0.55, jit: 0.08, max: 4 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.noise({ a: 0.001, d: 0.09, g: 0.8, filter: { type: 'bandpass', f: 4200, fTo: 1800, q: 1.2 } });
      k.noise({ t: 0.01, a: 0.01, d: 0.12, g: 0.4, filter: { type: 'bandpass', f: 900, fTo: 450, q: 2 } }); // wet tail
      k.tone({ type: 'sine', f: k.r(3100, 3900), fTo: 2600, a: 0.001, d: 0.12, g: 0.08 });
    }),
    // heavy crunch with sub thump
    hit_heavy: S({ dur: 0.7, gain: 1, verb: 0.2, max: 4 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      smack(k, { f: 1100, q: 0.8, d: 0.06, g: 1 });
      crunch(k, { d: 0.14, g: 0.9, f: 850, drive: 7 });
      thump(k, { f: 120, fTo: 70, d: 0.1, g: 0.8 }); // knock (attack body)
      subThump(k, { f: 56, fStart: 98, glide: 0.045, hold: 0.075, tau: 0.075, g: 1.15 }); // sustained 50-60 Hz weight
      k.tone({ type: 'triangle', f: k.r(170, 210), fTo: 80, a: 0.001, d: 0.16, g: 0.55, drive: 2 });
      k.noise({ color: 'brown', t: 0.02, a: 0.01, d: 0.28, g: 0.35, filter: { type: 'lowpass', f: 400 } });
    }),
    // finisher / KO: boom + crunch + metallic ring tail (the "arcade kill" signature)
    hit_ko: S({ dur: 2.0, gain: 1, verb: 0.35, max: 3, v: 3 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      smack(k, { f: 900, q: 0.7, d: 0.08, g: 1 });
      crunch(k, { d: 0.2, g: 1, f: 700, drive: 9 });
      thump(k, { f: 110, fTo: 60, d: 0.12, g: 0.9 }); // knock
      subThump(k, { f: 46, fStart: 88, glide: 0.06, hold: 0.13, tau: 0.12, g: 1.3, air: 0.55 }); // KO boom: longest, deepest
      k.noise({ color: 'brown', a: 0.005, d: 0.7, g: 0.6, filter: { type: 'lowpass', f: 700, fTo: 120 } });
      k.tone({ type: 'sawtooth', f: 55, fTo: 30, a: 0.004, d: 0.5, g: 0.2, filter: { type: 'lowpass', f: 300 } });
      ring(k, { f: k.r(980, 1250), d: 1.6, g: 0.22, t: 0.005 });
    }),
    // blocked: metal-on-metal clank with a short ring + small body thump
    hit_block: S({ dur: 0.8, gain: 0.85, verb: 0.25, max: 3 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.noise({ a: 0.0003, d: 0.02, g: 1, filter: { type: 'highpass', f: 3500 } });
      k.metal({ f: k.r(620, 900), g: 0.55, ratios: [1, 2.76, 5.4, 8.93, 11.3], decays: [0.55, 0.38, 0.22, 0.12, 0.08], gains: [1, 0.7, 0.45, 0.3, 0.2] });
      k.noise({ a: 0.001, d: 0.05, g: 0.5, filter: { type: 'bandpass', f: 2200, q: 2 } });
      thump(k, { f: 160, fTo: 90, d: 0.07, g: 0.5 });
      subThump(k, { f: 72, fStart: 120, glide: 0.035, hold: 0.05, tau: 0.055, g: 0.85, air: 0.3, t: 0.003 }); // shield-arm shove: weight under the clank
    }),
    // OTG / death-stab: sharp crack + wet squelch
    hit_otg: S({ dur: 0.5, gain: 0.95, verb: 0.15, max: 3 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.noise({ a: 0.0003, d: 0.025, g: 1.1, drive: 5, filter: { type: 'highpass', f: 1400 } });
      crunch(k, { d: 0.09, g: 0.8, f: 1300, drive: 8 });
      k.noise({ t: 0.015, a: 0.01, d: 0.18, g: 0.55, filter: { type: 'bandpass', f: 700, fTo: 180, q: 3 } });
      thump(k, { f: 130, fTo: 55, d: 0.2, g: 0.9 });
    }),
    // magic damage tick on a victim (fire lick / rock shard / zap) — generic, element layers live in the magic bank
    hit_magic: S({ dur: 0.45, gain: 0.7, max: 4 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      smack(k, { f: 1000, q: 0.8, d: 0.05, g: 0.8 });
      thump(k, { f: 120, fTo: 50, d: 0.2, g: 0.9 });
      k.noise({ a: 0.005, d: 0.25, g: 0.3, filter: { type: 'bandpass', f: 2400, fTo: 700, q: 1 } });
    }),
    // body hitting the ground (knockdown / bodyfall / thrown landing)
    body_fall: S({ dur: 0.8, gain: 0.9, verb: 0.2, max: 4 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      thump(k, { f: 95, fTo: 42, d: 0.32, g: 1.2 });
      k.noise({ color: 'pink', a: 0.002, d: 0.22, g: 0.7, filter: { type: 'lowpass', f: 900, fTo: 300 } });
      smack(k, { f: 600, q: 1, d: 0.06, g: 0.5 });
      // gear rattle: buckles and scabbard
      const n = 3 + Math.floor(k.r(0, 4));
      for (let i = 0; i < n; i++) k.noise({ t: 0.02 + k.r(0, 0.16), a: 0.0005, d: 0.02, g: 0.18, filter: { type: 'bandpass', f: k.r(2500, 5000), q: 4 } });
    }),
    // thrown body smashing into another (heavy, crunchy)
    body_impact: S({ dur: 0.9, gain: 1, verb: 0.25, max: 3 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      crunch(k, { d: 0.16, g: 0.9, f: 700, drive: 8 });
      thump(k, { f: 90, fTo: 32, d: 0.55, g: 1.3 });
      k.noise({ color: 'pink', a: 0.002, d: 0.3, g: 0.6, filter: { type: 'lowpass', f: 1000, fTo: 250 } });
    }),
    grab: S({ dur: 0.35, gain: 0.7, max: 2 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.noise({ color: 'pink', a: 0.004, d: 0.09, g: 0.8, filter: { type: 'bandpass', f: 1300, q: 1.2 } }); // cloth fist
      k.tone({ type: 'sawtooth', f: k.r(80, 110), a: 0.02, d: 0.14, g: 0.25, filter: { type: 'bandpass', f: 1200, q: 6 } }); // leather creak
      thump(k, { f: 140, fTo: 90, d: 0.08, g: 0.5 });
    }),
    throw: S({ dur: 0.7, gain: 0.9, verb: 0.15, max: 2 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      whoosh(k, { f0: 200, fPeak: 900, f1: 220, dur: 0.48, q: 0.9, g: 1, sub: 60 });
      k.noise({ color: 'pink', a: 0.2, d: 0.2, g: 0.25, filter: { type: 'bandpass', f: 500, q: 2 } }); // cloth flap
    }),
    charge: S({ dur: 0.5, gain: 0.55, max: 2 }, (ctx, out, o) => { // heavy-charge level tick (pitch set per level by the engine)
      const k = kit(ctx, out, o);
      k.metal({ f: 660, g: 0.35, ratios: [1, 2, 3.01], decays: [0.4, 0.25, 0.15], gains: [1, 0.4, 0.2] });
      k.noise({ a: 0.12, d: 0.05, g: 0.25, filter: { type: 'bandpass', f: 1200, fTo: 4000, q: 2 } });
    }),
  },
};
