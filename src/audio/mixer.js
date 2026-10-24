// Mixer graph (built on any BaseAudioContext so offline renders match the game exactly):
//
//   voice ─┐                                  ┌─ roomVerb (short, stone room) ─┐
//   (per-sound sends) ─────────────────────────┤                                 ├→ sfx ─┐
//   sfx voices ────────────────────────────────┴─────────────────────────────────┘      │
//   ui ────────────────────────────────────────────────────────────────────────────────┤→ master → glue comp → limiter → ceiling (−1 dBFS soft clip) → out
//   music tracks → music ─→ musicDuck (sidechain gain) ─────────────────────────────────┘        └→ analyser (debug peak meter)
//        └ hallVerb send (music instruments) → music
//
// Settings (src/game/Settings.js) writes buses.{master,music,sfx}.gain.value directly, so ducking automates `musicDuck`
// (a separate node) and never fights the volume sliders.
import { makeIR } from './dsp.js';

export const CEILING = Math.pow(10, -1.5 / 20); // under −1 dBFS with margin for 4× oversampling overshoot

export function buildMixer(ctx, volume, dest = ctx.destination) {
  const G = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const m = {};
  m.master = G(volume.master ?? 0.8);
  // Glue compressor (gentle) → brickwall-ish limiter → soft-clip ceiling (WaveShaper output can never exceed CEILING).
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16; glue.knee.value = 8; glue.ratio.value = 2.5; glue.attack.value = 0.012; glue.release.value = 0.22;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
  const clip = ctx.createWaveShaper();
  // Curve input is −1..1, so pre-scale by 0.5 (curve spans ±2 real units). Linear to 0.75·CEILING, then a tanh knee.
  const n = 4096, c = new Float32Array(n), K = CEILING * 0.75;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2, ax = Math.abs(x);
    c[i] = Math.sign(x) * (ax < K ? ax : K + (CEILING - K) * Math.tanh((ax - K) / (CEILING - K)));
  }
  const pre = G(0.5);
  clip.curve = c; clip.oversample = '4x';
  m.master.connect(glue); glue.connect(lim); lim.connect(pre); pre.connect(clip); clip.connect(dest);
  m.glue = glue; m.limiter = lim;
  if (ctx.createAnalyser) { m.analyser = ctx.createAnalyser(); m.analyser.fftSize = 2048; clip.connect(m.analyser); }

  m.sfx = G(volume.sfx ?? 1); m.sfx.connect(m.master);
  m.voice = G(volume.voice ?? 0.9); m.voice.connect(m.sfx);
  m.ui = G(volume.ui ?? 0.8); m.ui.connect(m.master);
  m.music = G(volume.music ?? 0.6);
  // Music EQ carves room for the SFX: low shelf (hits own the sub), presence dip (hits own the 2–4 kHz crack).
  const ls = ctx.createBiquadFilter(); ls.type = 'lowshelf'; ls.frequency.value = 110; ls.gain.value = -5;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 32; hp.Q.value = 0.7;
  const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2800; pk.Q.value = 0.9; pk.gain.value = -2.5;
  m.musicDuck = G(1); m.music.connect(hp); hp.connect(ls); ls.connect(pk); pk.connect(m.musicDuck); m.musicDuck.connect(m.master);

  // Short stone-room reverb for SFX (per-voice sends), long hall for music.
  m.roomVerb = ctx.createConvolver(); m.roomVerb.buffer = makeIR(ctx, 1.3, 4, 0.45, 5);
  m.roomSend = G(1); m.roomSend.connect(m.roomVerb); const rr = G(0.55); m.roomVerb.connect(rr); rr.connect(m.sfx);
  m.hallVerb = ctx.createConvolver(); m.hallVerb.buffer = makeIR(ctx, 3.6, 3, 0.5, 9);
  m.hallSend = G(1); m.hallSend.connect(m.hallVerb); const hr = G(0.5); m.hallVerb.connect(hr); hr.connect(m.music);
  return m;
}

/** Sidechain-style duck of the music: dip to (1 − amount) fast, hold, recover. Overlapping ducks keep the deepest. */
export function duckParam(ctx, param, state, amount, seconds, attack = 0.012, release = 0.35) {
  const t = ctx.currentTime;
  const target = Math.max(0.05, 1 - amount);
  const until = t + seconds;
  if (state.until > t && state.depth <= target && state.until >= until) return; // a deeper/longer duck is already running
  state.depth = Math.min(target, state.until > t ? state.depth : 1); state.until = Math.max(until, state.until > t ? state.until : 0);
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.setTargetAtTime(state.depth, t, attack);
  param.setTargetAtTime(1, state.until, release);
}
