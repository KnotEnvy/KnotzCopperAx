// Shared WebAudio synthesis toolkit. Works on any BaseAudioContext (live AudioContext and OfflineAudioContext),
// so the same sound code renders at load into AudioBuffers, plays live, and renders headless for tools/audio-render.mjs.
//
//   const k = kit(ctx, out, opts)       opts: { rng, pitch, delay, ... }  → k.t0 (start time), k.r(a,b), k.pick(arr)
//   k.tone({ type, f, fTo, fTime, t, a, d, g, to, filter, detune, shape })   oscillator voice, returns end time
//   k.noise({ color, t, a, d, g, to, filter:{ type, f, fTo, q, fTime } })     filtered noise voice
//   k.gain(v, to) · k.filter(type, f, q, to) · k.shaper(drive, to) · k.pan(p, to)
//   k.formant({ ... })                                                    formant-filtered vocal gesture (vo banks)
//   seeded(n) → rng()   hashStr(s)   mtof(m)   noiseBuffer(ctx, color)   makeIR(ctx, sec, decay, tone)
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Mulberry32 — small, fast, deterministic. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const NOISE = new WeakMap();
/** Cached 2 s mono noise buffers per context: white | pink | brown. */
export function noiseBuffer(ctx, color = 'white') {
  let m = NOISE.get(ctx);
  if (!m) { m = {}; NOISE.set(ctx, m); }
  if (m[color]) return m[color];
  const len = Math.floor(ctx.sampleRate * 2), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  const r = seeded(color === 'white' ? 11 : color === 'pink' ? 23 : 37);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = r() * 2 - 1;
    if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    else if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else d[i] = w;
  }
  m[color] = b;
  return b;
}

const CURVES = new Map();
function driveCurve(k) {
  const key = Math.round(k * 10);
  if (CURVES.has(key)) return CURVES.get(key);
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); }
  CURVES.set(key, c);
  return c;
}

/** Stereo reverb impulse: decaying noise with a darkening tail and slightly decorrelated channels. */
export function makeIR(ctx, sec = 2.5, decay = 3, tone = 0.5, seed = 7) {
  const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch), r = seeded(seed + ch * 101);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len, e = Math.pow(1 - x, decay);
      const a = 0.25 + tone * 0.7 * (1 - x); // lowpass coefficient closes over time
      lp += a * ((r() * 2 - 1) - lp);
      d[i] = lp * e * (i < ctx.sampleRate * 0.004 ? i / (ctx.sampleRate * 0.004) : 1);
    }
  }
  return b;
}

/** Exponential-ish amplitude envelope on an AudioParam. Returns the end time. */
export function envAD(p, t, a, d, peak = 1, floor = 0.0001) {
  p.cancelScheduledValues(t);
  p.setValueAtTime(floor, t);
  p.linearRampToValueAtTime(peak, t + Math.max(0.0005, a));
  p.exponentialRampToValueAtTime(floor, t + a + Math.max(0.005, d));
  return t + a + d;
}

export function kit(ctx, out, opts = {}) {
  const rng = opts.rng || Math.random;
  const t0 = (opts.at ?? ctx.currentTime) + (opts.delay || 0);
  const P = opts.pitch || 1;
  const r = (a, b) => a + (b - a) * rng();
  const k = {
    ctx, out, t0, rng, P, r, opts,
    pick: (arr) => arr[Math.floor(rng() * arr.length) % arr.length],
    gain(v = 1, to = out) { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; },
    filter(type, f, q = 0.707, to = out) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (to) b.connect(to); return b; },
    shaper(drive = 3, to = out) { const s = ctx.createWaveShaper(); s.curve = driveCurve(drive); s.oversample = '2x'; if (to) s.connect(to); return s; },
    pan(p = 0, to = out) {
      if (!ctx.createStereoPanner) return k.gain(1, to);
      const s = ctx.createStereoPanner(); s.pan.value = Math.max(-1, Math.min(1, p)); if (to) s.connect(to); return s;
    },
    /** Chain a filter spec onto `to` and return the node to feed. */
    _filt(spec, to, t, dur) {
      if (!spec) return to;
      const b = k.filter(spec.type || 'lowpass', spec.f || 1000, spec.q ?? 0.707, to);
      if (spec.fTo) {
        const ft = spec.fTime ?? dur;
        b.frequency.setValueAtTime(spec.f, t);
        if (spec.lin) b.frequency.linearRampToValueAtTime(spec.fTo, t + ft); else b.frequency.exponentialRampToValueAtTime(Math.max(20, spec.fTo), t + ft);
      }
      if (spec.fPeak) { // up then down sweep: f → fPeak at fPeakT → fTo
        b.frequency.setValueAtTime(spec.f, t);
        b.frequency.exponentialRampToValueAtTime(spec.fPeak, t + (spec.fPeakT ?? dur * 0.4));
        b.frequency.exponentialRampToValueAtTime(Math.max(20, spec.fTo || spec.f), t + dur);
      }
      return spec.then ? k._filt(spec.then, b, t, dur) : b;
    },
    tone({ type = 'sine', f = 440, fTo = null, fTime = null, t = 0, a = 0.002, d = 0.2, g = 1, to = out, filter = null, detune = 0, drive = 0, vib = 0, vibRate = 5.5, curve = 'exp' } = {}) {
      const s = t0 + t, dur = a + d;
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f * P, s);
      if (fTo) { const ft = fTime ?? dur; if (curve === 'lin') o.frequency.linearRampToValueAtTime(fTo * P, s + ft); else o.frequency.exponentialRampToValueAtTime(Math.max(1, fTo * P), s + ft); }
      if (detune) o.detune.value = detune;
      if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = vibRate; lg.gain.value = vib; l.connect(lg); lg.connect(o.detune); l.start(s); l.stop(s + dur + 0.05); }
      const e = ctx.createGain();
      let dst = k._filt(filter, to, s, dur);
      if (drive) dst = k.shaper(drive, dst);
      e.connect(dst);
      o.connect(e);
      envAD(e.gain, s, a, d, g);
      o.start(s); o.stop(s + dur + 0.05);
      return s + dur;
    },
    noise({ color = 'white', t = 0, a = 0.001, d = 0.1, g = 1, to = out, filter = null, rate = 1, drive = 0, hold = 0 } = {}) {
      const s = t0 + t, dur = a + hold + d;
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, color); src.loop = true;
      src.playbackRate.value = rate;
      const off = rng() * 1.5;
      const e = ctx.createGain();
      let dst = k._filt(filter, to, s, dur);
      if (drive) dst = k.shaper(drive, dst);
      e.connect(dst); src.connect(e);
      e.gain.setValueAtTime(0.0001, s);
      e.gain.linearRampToValueAtTime(g, s + Math.max(0.0005, a));
      if (hold) e.gain.setValueAtTime(g, s + a + hold);
      e.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      src.start(s, off); src.stop(s + dur + 0.05);
      return s + dur;
    },
    /** Inharmonic metallic partials (clank, ring, bell). ratios × f, each with its own decay. */
    metal({ f = 800, ratios = [1, 2.76, 5.4, 8.93], decays = [0.5, 0.3, 0.18, 0.1], gains = [1, 0.6, 0.4, 0.25], t = 0, g = 1, to = out, type = 'sine' } = {}) {
      let end = t0;
      ratios.forEach((q, i) => { end = Math.max(end, k.tone({ type, f: f * q * r(0.985, 1.015), t, a: 0.001, d: decays[i] ?? 0.1, g: g * (gains[i] ?? 0.3), to })); });
      return end;
    },
    /** Formant-filtered vocal gesture. contour: [[time, hz]...]; vowels: [[time, 'a'|'e'|'i'|'o'|'u'|'uh']...]. */
    formant({ contour, vowels = [[0, 'a']], dur = 0.4, g = 1, fscale = 1, breath = 0.15, growl = 0, rough = 0, a = 0.02, rel = 0.08, t = 0, to = out, src = 'sawtooth' } = {}) {
      const s = t0 + t;
      const o = ctx.createOscillator(); o.type = src;
      o.frequency.setValueAtTime(contour[0][1] * P, s);
      for (const [ct, hz] of contour.slice(1)) o.frequency.linearRampToValueAtTime(hz * P, s + ct);
      if (rough) { const j = ctx.createBufferSource(); j.buffer = noiseBuffer(ctx, 'pink'); j.loop = true; const jg = ctx.createGain(); jg.gain.value = rough * 60; const jl = k.filter('lowpass', 40, 0.7, jg); j.connect(jl); jg.connect(o.detune); j.start(s); j.stop(s + dur + 0.1); }
      const v = ctx.createGain(); // voiced + breath sum
      o.connect(v);
      if (breath) { const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 'white'); n.loop = true; const ng = ctx.createGain(); ng.gain.value = breath; n.connect(ng); ng.connect(v); n.start(s, rng()); n.stop(s + dur + 0.1); }
      let amp = ctx.createGain();
      if (growl) { // amplitude modulation 30–70 Hz → growl/roar
        const l = ctx.createOscillator(); l.frequency.value = 38 + rng() * 25; const lg = ctx.createGain(); lg.gain.value = growl * 0.5;
        const am = ctx.createGain(); am.gain.value = 1 - growl * 0.5; l.connect(lg); lg.connect(am.gain); v.connect(am); am.connect(amp); l.start(s); l.stop(s + dur + 0.1);
      } else v.connect(amp);
      const F = VOWELS;
      const bands = [0, 1, 2].map((i) => {
        const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.Q.value = [7, 9, 11][i];
        const bg = ctx.createGain(); bg.gain.value = [1.0, 0.55, 0.3][i] * 3.2;
        amp.connect(b); b.connect(bg); bg.connect(to);
        const v0 = F[vowels[0][1]] || F.a;
        b.frequency.setValueAtTime(v0[i] * fscale, s);
        for (const [vt, vn] of vowels.slice(1)) b.frequency.linearRampToValueAtTime((F[vn] || F.a)[i] * fscale, s + vt);
        return b;
      });
      void bands;
      amp.gain.setValueAtTime(0.0001, s);
      amp.gain.linearRampToValueAtTime(g, s + a);
      amp.gain.setValueAtTime(g, s + Math.max(a, dur - rel));
      amp.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      o.start(s); o.stop(s + dur + 0.1);
      return s + dur;
    },
  };
  return k;
}

export const VOWELS = { a: [800, 1150, 2900], e: [480, 1720, 2520], i: [300, 2200, 2950], o: [470, 800, 2600], u: [330, 700, 2450], uh: [620, 1100, 2500], ae: [680, 1650, 2450] };

/** Wrap a synth fn with metadata: dur (s) for pre-rendering, variants, gain, max concurrent, min gap, verb send, live-only. */
export function S(meta, fn) { return Object.assign(fn, { meta }); }
