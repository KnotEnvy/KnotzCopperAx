// Synthesised orchestra for the procedural score. Each instrument: (ctx, dest, t, midi, vel 0..1, durSec, rng).
// Built on dsp.kit so it runs identically in the live AudioContext and in OfflineAudioContext renders.
import { kit, mtof } from '../dsp.js';

const K = (ctx, dest, t, rng) => kit(ctx, dest, { at: t, rng });

export const INST = {
  // Taiko / war drum: pitched body drop + skin + stick click. midi selects the drum size (36 = odaiko … 48 = shime-ish).
  taiko(ctx, dest, t, n, v, d, rng) {
    const k = K(ctx, dest, t, rng), f = mtof(n) * k.r(0.98, 1.02);
    k.tone({ type: 'sine', f: f * 1.6, fTo: f, fTime: 0.06, a: 0.001, d: 0.75 + (48 - n) * 0.02, g: v * 1.05 });
    k.tone({ type: 'triangle', f: f * 2.4, fTo: f * 1.3, fTime: 0.05, a: 0.001, d: 0.14, g: v * 0.28 });
    k.noise({ color: 'pink', a: 0.001, d: 0.09, g: v * 0.55, filter: { type: 'bandpass', f: f * 2.2, q: 0.9 } });
    k.noise({ a: 0.0005, d: 0.012, g: v * 0.22, filter: { type: 'highpass', f: 2200 } });
  },
  // Rim / stick click ("ka")
  rim(ctx, dest, t, n, v, d, rng) {
    const k = K(ctx, dest, t, rng);
    k.noise({ a: 0.0004, d: 0.035, g: v * 0.6, filter: { type: 'bandpass', f: k.r(1700, 2000), q: 5 } });
    k.tone({ type: 'triangle', f: 900, fTo: 700, a: 0.0005, d: 0.03, g: v * 0.15 });
  },
  // Frame drum (bodhrán-ish): softer, higher, with a finger slap; midi 50±
  frame(ctx, dest, t, n, v, d, rng) {
    const k = K(ctx, dest, t, rng), f = mtof(n);
    k.tone({ type: 'sine', f: f * 1.3, fTo: f, fTime: 0.03, a: 0.001, d: 0.32, g: v * 0.8 });
    k.noise({ color: 'pink', a: 0.001, d: 0.1, g: v * 0.5, filter: { type: 'bandpass', f: 800, q: 0.9 } });
  },
  shaker(ctx, dest, t, n, v, d, rng) {
    const k = K(ctx, dest, t, rng);
    k.noise({ a: 0.012, d: 0.05, g: v * 0.35, filter: { type: 'highpass', f: 6500 } });
  },
  // Low-string / bass: sine sub + filtered saw, bowed-ish attack
  bass(ctx, dest, t, n, v, d, rng) {
    const k = K(ctx, dest, t, rng), f = mtof(n);
    const g = k.gain(1);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.02); g.gain.setTargetAtTime(v * 0.7, t + 0.05, 0.15);
    g.gain.setValueAtTime(v * 0.7, t + Math.max(0.06, d - 0.08)); g.gain.linearRampToValueAtTime(0.0001, t + d + 0.12);
    for (const [type, mul, gg, det] of [['sine', 1, 0.8, 0], ['sawtooth', 1, 0.3, 4], ['sawtooth', 2, 0.1, -5]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = gg; o.connect(og);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(260, t + 0.25); og.connect(lp); lp.connect(g);
      o.start(t); o.stop(t + d + 0.2);
    }
  },
  // String section pad: 3 detuned saws per note, delayed vibrato, slow bow attack, dark lowpass
  strings(ctx, dest, t, n, v, d, rng, o = {}) {
    const k = K(ctx, dest, t, rng), f = mtof(n);
    const atk = o.attack ?? 0.35, rel = o.release ?? 0.7;
    const g = k.gain(1);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.33, t + atk);
    g.gain.setValueAtTime(v * 0.33, t + Math.max(atk, d)); g.gain.linearRampToValueAtTime(0.0001, t + Math.max(atk, d) + rel);
    const lp = k.filter('lowpass', o.bright ?? 1500, 0.6, g);
    const vib = ctx.createOscillator(); vib.frequency.value = k.r(4.8, 5.8); const vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(7, t + atk + 0.3); vib.connect(vg);
    for (const det of [-9, 0, 8]) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f; osc.detune.value = det + k.r(-2, 2); vg.connect(osc.detune); osc.connect(lp);
      osc.start(t); osc.stop(t + Math.max(atk, d) + rel + 0.05);
    }
    vib.start(t); vib.stop(t + Math.max(atk, d) + rel + 0.05);
  },
  // Short string stab (marcato)
  marcato(ctx, dest, t, n, v, d, rng) { INST.strings(ctx, dest, t, n, v * 1.2, Math.min(d, 0.18), rng, { attack: 0.02, release: 0.25, bright: 2600 }); },
  // Brass: detuned saws + square sub, filter envelope "blat", slight pitch scoop
  brass(ctx, dest, t, n, v, d, rng) {
    const k = K(ctx, dest, t, rng), f = mtof(n);
    const g = k.gain(1);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.3, t + 0.04); g.gain.setTargetAtTime(v * 0.22, t + 0.06, 0.2);
    g.gain.setValueAtTime(v * 0.22, t + Math.max(0.08, d)); g.gain.linearRampToValueAtTime(0.0001, t + Math.max(0.08, d) + 0.25);
    const lp = k.filter('lowpass', 400, 1.2, g);
    lp.frequency.setValueAtTime(350, t); lp.frequency.exponentialRampToValueAtTime(900 + v * 2600, t + 0.06); lp.frequency.exponentialRampToValueAtTime(700 + v * 900, t + 0.35);
    for (const [type, det, gg, mul] of [['sawtooth', -7, 0.5, 1], ['sawtooth', 6, 0.5, 1], ['square', 0, 0.25, 0.5]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f * mul * 0.985, t); o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.05); o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = gg; o.connect(og); og.connect(lp);
      o.start(t); o.stop(t + Math.max(0.08, d) + 0.3);
    }
  },
  // Lute: paired courses (two slightly detuned plucks), bright pick transient, fast-closing lowpass
  lute(ctx, dest, t, n, v, d, rng) {
    const k = K(ctx, dest, t, rng), f = mtof(n);
    for (const det of [-4, 4]) k.tone({ type: 'sawtooth', f, detune: det, a: 0.002, d: 0.9, g: v * 0.18, filter: { type: 'lowpass', f: 4200, fTo: 500, fTime: 0.35, q: 2 } });
    k.tone({ type: 'triangle', f, a: 0.002, d: 1.1, g: v * 0.2 });
    k.noise({ a: 0.0005, d: 0.012, g: v * 0.15, filter: { type: 'bandpass', f: 3000, q: 2 } });
  },
  // Harp: soft sine/triangle with long ring and a gentle second partial
  harp(ctx, dest, t, n, v, d, rng) {
    const k = K(ctx, dest, t, rng), f = mtof(n);
    k.tone({ type: 'triangle', f, a: 0.003, d: 2.2, g: v * 0.32, filter: { type: 'lowpass', f: 3200 } });
    k.tone({ type: 'sine', f: f * 2, a: 0.003, d: 0.9, g: v * 0.08 });
  },
  // Choir "ah/oh": saws through three formant bands, slow swell, vibrato
  choir(ctx, dest, t, n, v, d, rng, o = {}) {
    const k = K(ctx, dest, t, rng), f = mtof(n), vowel = o.vowel || (n > 64 ? 'a' : 'o');
    const atk = 0.5, rel = 0.9, len = Math.max(atk, d);
    k.formant({ dur: len + rel, a: atk, rel, contour: [[0, f], [len + rel, f]], vowels: [[0, vowel], [len, vowel === 'a' ? 'o' : 'a']], g: v * 0.32, fscale: n > 64 ? 1.15 : 0.95, breath: 0.12, src: 'sawtooth' });
    k.formant({ dur: len + rel, a: atk * 1.2, rel, contour: [[0, f * 1.004], [len + rel, f * 0.998]], vowels: [[0, vowel]], g: v * 0.22, fscale: n > 64 ? 1.2 : 1.0, breath: 0.05, src: 'sawtooth' });
  },
  // Deep anvil/bell accent for downbeats of big sections
  anvil(ctx, dest, t, n, v, d, rng) { const k = K(ctx, dest, t, rng); k.metal({ f: mtof(n), g: v * 0.3, ratios: [1, 2.76, 5.4, 8.93], decays: [1.4, 0.7, 0.35, 0.2] }); },
  // Reverse cymbal-ish swell into a downbeat (intensity rise)
  swell(ctx, dest, t, n, v, d, rng) { const k = K(ctx, dest, t, rng); k.noise({ a: d, d: 0.04, g: v * 0.35, filter: { type: 'bandpass', f: 800, fTo: 7000, fTime: d, q: 1.2 } }); },
  // Night crickets (camp): short AM chirps around 4.4 kHz
  cricket(ctx, dest, t, n, v, d, rng) { const k = K(ctx, dest, t, rng); for (let i = 0; i < 3; i++) k.tone({ type: 'sine', f: k.r(4200, 4600), t: i * 0.045, a: 0.005, d: 0.025, g: v * 0.05 }); },
};
