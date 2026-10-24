// Vocal-ish synth gestures (formant-filtered saw + breath, pitch contours, growl AM) per character:
//   vo_<char>_effort (attack "hup!"), vo_<char>_hurt (short pained grunt), vo_<char>_death (falling scream),
//   vo_<char>_cry (battle cry: magic / throw / big finisher).   chars: brann gorrim seraphine thief marauder enemy
// Plus roar (beast/boss). No words — gestures, so they read as voices at arcade distance without uncanny speech.
import { kit, S } from '../dsp.js';

// f0 = speaking pitch, fs = formant scale (vocal tract length), growl = AM roughness, rough = pitch jitter
export const VOICES = {
  brann: { f0: 118, fs: 1.0, growl: 0.15, rough: 0.2, breath: 0.12 },
  gorrim: { f0: 96, fs: 0.86, growl: 0.35, rough: 0.35, breath: 0.1 },
  seraphine: { f0: 235, fs: 1.2, growl: 0, rough: 0.12, breath: 0.2 },
  thief: { f0: 175, fs: 1.1, growl: 0.1, rough: 0.3, breath: 0.25 },
  marauder: { f0: 88, fs: 0.84, growl: 0.55, rough: 0.5, breath: 0.1 },
  enemy: { f0: 105, fs: 0.92, growl: 0.35, rough: 0.35, breath: 0.12 },
};

const KINDS = {
  effort: { dur: 0.32, make: (k, V) => { const f = V.f0 * k.r(1.05, 1.25), d = k.r(0.14, 0.22); k.formant({ dur: d, a: 0.01, rel: 0.06, contour: [[0, f * 0.95], [d * 0.3, f * 1.1], [d, f * 0.85]], vowels: [[0, 'uh'], [d, k.pick(['a', 'uh', 'ae'])]], g: 0.8, fscale: V.fs, growl: V.growl, rough: V.rough, breath: V.breath + 0.1 }); } },
  hurt: { dur: 0.45, make: (k, V) => { const f = V.f0 * k.r(1.25, 1.5), d = k.r(0.18, 0.3); k.formant({ dur: d, a: 0.005, rel: 0.1, contour: [[0, f * 1.15], [d * 0.25, f], [d, f * 0.7]], vowels: [[0, k.pick(['a', 'uh', 'o'])], [d, 'uh']], g: 0.85, fscale: V.fs, growl: V.growl * 1.2, rough: V.rough + 0.2, breath: V.breath + 0.15 }); } },
  death: { dur: 1.3, make: (k, V) => { const f = V.f0 * k.r(1.8, 2.3), d = k.r(0.7, 1.0); k.formant({ dur: d, a: 0.02, rel: 0.35, contour: [[0, f * 0.9], [0.08, f * 1.1], [d * 0.5, f], [d, f * 0.45]], vowels: [[0, 'a'], [d * 0.6, 'a'], [d, 'o']], g: 0.9, fscale: V.fs * 1.03, growl: V.growl, rough: V.rough + 0.3, breath: V.breath + 0.1 }); } },
  cry: { dur: 1.0, make: (k, V) => { const f = V.f0 * k.r(1.5, 1.75), d = k.r(0.55, 0.7); k.formant({ dur: d, a: 0.03, rel: 0.18, contour: [[0, f * 0.85], [0.1, f * 1.08], [d * 0.7, f * 1.12], [d, f * 0.8]], vowels: [[0, 'uh'], [0.08, 'a'], [d, 'o']], g: 0.95, fscale: V.fs, growl: V.growl * 0.8, rough: V.rough, breath: V.breath }); } },
};

const sounds = {};
for (const [ch, V] of Object.entries(VOICES)) {
  for (const [kind, K] of Object.entries(KINDS)) {
    sounds[`vo_${ch}_${kind}`] = S({ dur: K.dur, bus: 'voice', gain: kind === 'effort' ? 0.55 : 0.7, verb: kind === 'death' ? 0.3 : 0.15, v: 4, max: 2, jit: 0.04 }, (ctx, out, o) => K.make(kit(ctx, out, o), V));
  }
}
// Beast / boss roar: low saw + growl through an "ah→oh" throat, with a noisy rasp and a sub swell.
sounds.roar = S({ dur: 2.8, bus: 'voice', gain: 1, verb: 0.4, v: 2, max: 1 }, (ctx, out, o) => {
  const k = kit(ctx, out, o), f = k.r(62, 78), d = k.r(1.6, 2.1);
  k.formant({ dur: d, a: 0.15, rel: 0.5, contour: [[0, f * 0.8], [0.3, f * 1.25], [d * 0.7, f * 1.1], [d, f * 0.7]], vowels: [[0, 'uh'], [0.3, 'a'], [d, 'o']], g: 1, fscale: 0.7, growl: 0.8, rough: 1.2, breath: 0.4 });
  k.noise({ color: 'pink', a: 0.2, hold: d * 0.5, d: d * 0.4, g: 0.35, filter: { type: 'bandpass', f: 700, q: 1.5 } });
  k.tone({ type: 'sine', f: 42, fTo: 32, a: 0.3, d: d, g: 0.6 });
});

// ---- Round 2: per-creature Bizarrian voices (roar_<mount typeId>) — each beast has its own silhouette in sound.
const V = { bus: 'voice', gain: 1, v: 3, max: 1 };
// Cluckhorn: beaked biped — a nasal honk-squawk pair then a throaty cluck-cluck, a club-tail rattle at the end.
sounds.roar_cluckhorn = S({ ...V, dur: 1.3, verb: 0.25 }, (ctx, out, o) => {
  const k = kit(ctx, out, o), f = k.r(360, 430);
  k.formant({ dur: 0.32, a: 0.01, rel: 0.08, contour: [[0, f], [0.07, f * 1.7], [0.32, f * 0.9]], vowels: [[0, 'e'], [0.1, 'ae'], [0.32, 'a']], g: 1, fscale: 1.15, growl: 0.35, rough: 0.8, breath: 0.25 });
  k.formant({ t: 0.36, dur: 0.24, a: 0.01, rel: 0.06, contour: [[0, f * 1.2], [0.06, f * 1.9], [0.24, f]], vowels: [[0, 'e'], [0.24, 'a']], g: 0.8, fscale: 1.15, growl: 0.3, rough: 0.8, breath: 0.25 });
  for (let i = 0; i < 3; i++) k.formant({ t: 0.7 + i * 0.12 + k.r(0, 0.02), dur: 0.06, a: 0.004, rel: 0.03, contour: [[0, 170], [0.06, 130]], vowels: [[0, 'uh']], g: 0.55, fscale: 0.9, rough: 0.5, breath: 0.1 });
  for (let i = 0; i < 5; i++) k.noise({ t: 1.0 + k.r(0, 0.22), a: 0.0005, d: 0.025, g: 0.2, filter: { type: 'bandpass', f: k.r(1800, 3400), q: 5 } });
});
// Emberdrake: small blue dragon — throat-rattle growl rising into a gas hiss with ember crackle (pre-breath).
sounds.roar_emberdrake = S({ ...V, dur: 2.0, verb: 0.35 }, (ctx, out, o) => {
  const k = kit(ctx, out, o), f = k.r(115, 140), d = k.r(1.1, 1.3);
  k.formant({ dur: d, a: 0.08, rel: 0.3, contour: [[0, f * 0.8], [0.25, f * 1.4], [d * 0.8, f * 1.2], [d, f * 0.9]], vowels: [[0, 'uh'], [0.25, 'ae'], [d, 'a']], g: 1, fscale: 0.95, growl: 0.7, rough: 1.4, breath: 0.35 });
  k.noise({ t: 0.25, a: 0.25, hold: 0.5, d: 0.6, g: 0.5, filter: { type: 'bandpass', f: 3200, fTo: 5200, q: 0.9 } });
  for (let i = 0; i < 9; i++) k.noise({ t: 0.35 + k.r(0, 1.1), a: 0.0004, d: 0.012, g: 0.28, filter: { type: 'highpass', f: 2800 } });
});
// Cinderwyrm: big red dragon — slow indrawn breath, then a deep cavernous bellow with a furnace rumble under it.
sounds.roar_cinderwyrm = S({ ...V, dur: 3.2, verb: 0.5 }, (ctx, out, o) => {
  const k = kit(ctx, out, o), f = k.r(52, 62), d = k.r(1.9, 2.2);
  k.noise({ color: 'pink', a: 0.4, d: 0.12, g: 0.3, filter: { type: 'bandpass', f: 900, fTo: 1800, q: 1.2 } }); // inhale
  k.formant({ t: 0.45, dur: d, a: 0.2, rel: 0.6, contour: [[0, f * 0.8], [0.35, f * 1.3], [d * 0.6, f * 1.15], [d, f * 0.7]], vowels: [[0, 'uh'], [0.35, 'a'], [d * 0.7, 'o'], [d, 'u']], g: 1, fscale: 0.6, growl: 0.9, rough: 1.3, breath: 0.45 });
  k.noise({ color: 'brown', t: 0.5, a: 0.3, hold: d * 0.5, d: d * 0.5, g: 0.55, filter: { type: 'lowpass', f: 260 } });
  k.tone({ type: 'sine', f: 38, fTo: 30, t: 0.5, a: 0.35, d, g: 0.6 });
});
// Tusker: armoured war-boar — two wet snorting grunts, then a shrill squeal and a trailing snuffle.
sounds.roar_tusker = S({ ...V, dur: 1.6, verb: 0.25 }, (ctx, out, o) => {
  const k = kit(ctx, out, o);
  for (let i = 0; i < 2; i++) {
    const t = i * 0.2; k.formant({ t, dur: 0.14, a: 0.01, rel: 0.05, contour: [[0, 95], [0.05, 120], [0.14, 80]], vowels: [[0, 'o'], [0.14, 'uh']], g: 0.85, fscale: 0.85, growl: 0.8, rough: 2, breath: 0.3 });
    k.noise({ t: t + 0.01, a: 0.005, d: 0.1, g: 0.35, filter: { type: 'bandpass', f: 1200, q: 1.5 } }); // snort
  }
  const f = k.r(720, 820);
  k.formant({ t: 0.45, dur: 0.55, a: 0.03, rel: 0.12, contour: [[0, f], [0.12, f * 1.45], [0.4, f * 1.3], [0.55, f * 0.85]], vowels: [[0, 'i'], [0.3, 'e'], [0.55, 'ae']], g: 0.9, fscale: 1.2, growl: 0.4, rough: 1.2, breath: 0.2 });
  k.noise({ t: 1.05, a: 0.03, d: 0.3, g: 0.25, filter: { type: 'bandpass', f: 900, q: 2 } });
});
// Stormroc: flightless thunder-bird — a raptor screech with a crackling electric edge and a distant thunder tail.
sounds.roar_stormroc = S({ ...V, dur: 2.2, verb: 0.45 }, (ctx, out, o) => {
  const k = kit(ctx, out, o), f = k.r(880, 1000);
  k.formant({ dur: 0.7, a: 0.02, rel: 0.2, contour: [[0, f], [0.1, f * 1.5], [0.45, f * 1.35], [0.7, f * 0.8]], vowels: [[0, 'e'], [0.2, 'i'], [0.7, 'e']], g: 1, fscale: 1.25, growl: 0.25, rough: 1.5, breath: 0.3 });
  for (let i = 0; i < 7; i++) k.noise({ t: 0.05 + k.r(0, 0.6), a: 0.0003, d: 0.01, g: 0.3, filter: { type: 'highpass', f: 4000 } });
  k.noise({ color: 'brown', t: 0.55, a: 0.08, d: 1.3, g: 0.6, filter: { type: 'lowpass', f: 420, fTo: 120 } });
});

export default { id: 'voice', sounds };
