// UI SFX: forged-metal menu ticks, sword-ring confirm, dull back, coin, READY anvil + shout, GO horn call, screen lock
// war-drum, continue tick, tally stamp, boss stinger, player-down toll. All on the 'ui' bus unless noted.
import { kit, S } from '../dsp.js';

const UI = (dur, extra = {}) => ({ dur, bus: 'ui', jit: 0.01, ...extra });

function horn(k, notes, { t = 0, g = 0.3, len = 0.3 } = {}) { // brass-ish: detuned saws through a swept lowpass
  notes.forEach(([f, dt, dl]) => {
    for (const det of [-6, 5]) k.tone({ type: 'sawtooth', f, t: t + dt, a: 0.03, d: dl ?? len, g: g * 0.5, detune: det, filter: { type: 'lowpass', f: 500, fPeak: 2800, fPeakT: 0.08, fTo: 900, q: 1.5 } });
    k.tone({ type: 'square', f: f / 2, t: t + dt, a: 0.03, d: dl ?? len, g: g * 0.15, filter: { type: 'lowpass', f: 600 } });
  });
}
function taiko(k, t, g = 1, f = 95) {
  k.tone({ type: 'sine', f: f * k.r(0.97, 1.03), fTo: f * 0.48, fTime: 0.15, t, a: 0.001, d: 0.7, g });
  k.tone({ type: 'triangle', f: f * 1.9, fTo: f, t, a: 0.001, d: 0.12, g: g * 0.3 });
  k.noise({ t, a: 0.001, d: 0.08, g: g * 0.45, filter: { type: 'bandpass', f: 180, q: 1 } });
  k.noise({ t, a: 0.0005, d: 0.012, g: g * 0.25, filter: { type: 'highpass', f: 2000 } });
}

export default {
  id: 'ui',
  sounds: {
    ui_move: S(UI(0.25, { gain: 0.55, v: 3, gap: 0.03 }), (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.metal({ f: k.r(1750, 1850), g: 0.35, ratios: [1, 1.51, 2.74], decays: [0.1, 0.07, 0.04], gains: [1, 0.4, 0.2] });
      k.noise({ a: 0.0005, d: 0.02, g: 0.3, filter: { type: 'bandpass', f: 900, q: 2 } }); // knock
    }),
    ui_back: S(UI(0.3, { gain: 0.5, v: 2 }), (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.tone({ type: 'triangle', f: 520, fTo: 330, a: 0.002, d: 0.12, g: 0.4 });
      k.noise({ a: 0.001, d: 0.05, g: 0.4, filter: { type: 'bandpass', f: 400, q: 2 } });
    }),
    ui_confirm: S(UI(1.2, { gain: 0.7, verb: 0.25, v: 2 }), (ctx, out, o) => { // sword ring + stomp
      const k = kit(ctx, out, o);
      k.noise({ a: 0.0005, d: 0.02, g: 0.6, filter: { type: 'highpass', f: 3000 } });
      k.metal({ f: 1046.5, g: 0.35, ratios: [1, 2.01, 3.03, 4.7], decays: [0.9, 0.5, 0.3, 0.15], gains: [1, 0.35, 0.2, 0.12] });
      k.tone({ type: 'sine', f: 110, fTo: 55, a: 0.001, d: 0.2, g: 0.6 });
    }),
    ui_coin: S(UI(1.0, { gain: 0.65, verb: 0.2, v: 1 }), (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.tone({ type: 'square', f: 987.77, a: 0.002, d: 0.08, g: 0.12, filter: { type: 'lowpass', f: 4000 } });
      k.tone({ type: 'square', f: 1318.5, t: 0.08, a: 0.002, d: 0.5, g: 0.12, filter: { type: 'lowpass', f: 4000 } });
      k.metal({ f: 2637, t: 0.08, g: 0.15, ratios: [1, 2.4], decays: [0.6, 0.3], gains: [1, 0.3] });
    }),
    ui_ready: S(UI(1.5, { gain: 0.8, verb: 0.3, v: 1 }), (ctx, out, o) => { // anvil + low horn
      const k = kit(ctx, out, o);
      k.metal({ f: 740, g: 0.4, ratios: [1, 2.76, 5.4], decays: [1.0, 0.5, 0.25], gains: [1, 0.5, 0.3] });
      taiko(k, 0, 0.8, 80);
      horn(k, [[146.83, 0.05, 0.6], [220, 0.05, 0.6]], { g: 0.28 });
    }),
    go: S(UI(1.6, { gain: 0.8, verb: 0.35, v: 1, bus: 'sfx' }), (ctx, out, o) => { // GO arrow: two-note horn call
      const k = kit(ctx, out, o);
      horn(k, [[293.66, 0, 0.16], [440, 0.2, 0.7], [220, 0.2, 0.7]], { g: 0.32 });
      taiko(k, 0.2, 0.6, 110);
    }),
    lock: S(UI(1.2, { gain: 0.85, verb: 0.3, v: 2, bus: 'sfx' }), (ctx, out, o) => { // screen lock: double war-drum
      const k = kit(ctx, out, o);
      taiko(k, 0, 1, 90); taiko(k, 0.16, 0.8, 84);
      k.noise({ color: 'brown', a: 0.01, d: 0.6, g: 0.3, filter: { type: 'lowpass', f: 250 } });
    }),
    ui_tick: S(UI(0.5, { gain: 0.6, v: 1 }), (ctx, out, o) => {
      const k = kit(ctx, out, o);
      k.noise({ a: 0.0004, d: 0.015, g: 0.6, filter: { type: 'bandpass', f: 3000, q: 3 } });
      k.metal({ f: 880, g: 0.2, ratios: [1, 2.9], decays: [0.35, 0.15], gains: [1, 0.3] });
    }),
    ui_stamp: S(UI(0.8, { gain: 0.9, verb: 0.2, v: 1 }), (ctx, out, o) => {
      const k = kit(ctx, out, o);
      taiko(k, 0, 0.9, 70);
      k.noise({ a: 0.001, d: 0.06, g: 0.6, drive: 4, filter: { type: 'bandpass', f: 1200, q: 0.8 } });
    }),
    boss_stinger: S(UI(3.5, { gain: 0.9, verb: 0.45, v: 1, bus: 'sfx' }), (ctx, out, o) => { // bossPhase: cluster brass + drums
      const k = kit(ctx, out, o);
      taiko(k, 0, 1, 70); taiko(k, 0.12, 0.8, 76);
      horn(k, [[73.42, 0.02, 1.6], [110, 0.02, 1.6], [116.54, 0.02, 1.6], [146.83, 0.02, 1.6]], { g: 0.3 });
      k.noise({ color: 'brown', a: 0.4, d: 1.8, g: 0.35, filter: { type: 'lowpass', f: 200 } });
    }),
    player_down: S(UI(3.0, { gain: 0.9, verb: 0.5, v: 1, bus: 'sfx' }), (ctx, out, o) => { // funeral toll
      const k = kit(ctx, out, o);
      taiko(k, 0, 1, 62);
      k.metal({ f: 196, g: 0.45, ratios: [1, 2.0, 2.4, 3.0, 4.1], decays: [2.6, 1.8, 1.4, 0.9, 0.6], gains: [1, 0.5, 0.4, 0.3, 0.2] });
    }),
    // thief cackle: nasal "he-he-he-heh" falling, lives here because it is a character signature, not a hurt voice
    thief_cackle: S({ dur: 1.1, gain: 0.8, verb: 0.2, bus: 'voice', v: 3, max: 1 }, (ctx, out, o) => {
      const k = kit(ctx, out, o);
      const n = 4 + Math.floor(k.r(0, 3)); let f = k.r(360, 420);
      for (let i = 0; i < n; i++) {
        const t = i * k.r(0.1, 0.13);
        k.formant({ t, dur: 0.09, contour: [[0, f * 1.08], [0.08, f * 0.92]], vowels: [[0, 'e'], [0.07, 'i']], g: 0.7, fscale: 1.15, breath: 0.35, src: 'sawtooth' });
        f *= k.r(0.9, 0.96);
      }
    }),
  },
};
