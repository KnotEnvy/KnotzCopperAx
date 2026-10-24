// Tempo-synced bar sequencer + notation helpers for the procedural score.
//
// Song: { id, bpm, beatSteps (steps per beat), barSteps, bars (loop length), loop=true, tail (s, one-shots),
//         transpose, tracks: [{ id, inst, lvl=0 (min intensity 0..3), maxLvl=3, boss (true: only with boss, false: only
//         without), gain, verb (hall send), pan, ev(bar, info) → [{ s (step in bar), n (midi), d (steps), v, o }] }] }
// Sequencer.scheduleUntil(t) schedules whole bars ahead of time (live: from a 25 ms-ish poll with ~0.35 s lookahead;
// offline: once for the whole render). Intensity/boss are sampled per bar, so stems enter and leave on downbeats.
import { INST } from './_inst.js';
import { seeded, hashStr } from '../dsp.js';

// Score headroom: the arrangement sums many stems; this trim sits music ~−18 LUFS so hits punch over it.
export const MUSIC_TRIM = 0.38;
const DRUMS = new Set(['taiko', 'rim', 'frame', 'shaker', 'swell', 'cricket', 'anvil']);

// ---------------------------------------------------------------- notation
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'D4' / 'Bb3' / 'F#5' → midi */
export function nm(s) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!m) throw new Error(`bad note ${s}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
/** Melody: "D4:6 A4:2 -:4 C5:4:0.9" (note:steps[:vel]) → { len, notes:[{s,n,d,v}] } */
export function mel(str) {
  const notes = []; let s = 0;
  for (const tok of str.trim().split(/\s+/)) {
    if (tok === '|') continue;
    const [p, l = '1', v = '0.8'] = tok.split(':');
    const d = Number(l);
    if (p !== '-') for (const q of p.split('+')) notes.push({ s, n: nm(q), d, v: Number(v) });
    s += d;
  }
  return { len: s, notes };
}
/** Chord symbol → midi triad (root in octave `oct`): Dm, Bb, A, Gm, F, C, Esus4, D5, A7, Ddim */
export function chord(sym, oct = 3) {
  const m = /^([A-G][#b]?)(m|sus4|sus2|5|7|m7|dim|maj7)?$/.exec(sym);
  if (!m) throw new Error(`bad chord ${sym}`);
  const r = nm(m[1] + oct), q = m[2] || '';
  const iv = { '': [0, 4, 7], m: [0, 3, 7], sus4: [0, 5, 7], sus2: [0, 2, 7], 5: [0, 7, 12], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], dim: [0, 3, 6], maj7: [0, 4, 7, 11] }[q];
  return iv.map((i) => r + i);
}

// ---------------------------------------------------------------- track builders (return ev(bar) functions)
/** Loop a melody over bars. */
export function melodyEv(m, barSteps, { vel = 1, oct = 0 } = {}) {
  const bars = Math.max(1, Math.round(m.len / barSteps));
  return (bar) => {
    const b = bar % bars, lo = b * barSteps, hi = lo + barSteps;
    return m.notes.filter((x) => x.s >= lo && x.s < hi).map((x) => ({ s: x.s - lo, n: x.n + oct * 12, d: x.d, v: x.v * vel }));
  };
}
/** Drum patterns: array of per-bar strings ('X' 1, 'x' .7, 'o' .45, '.' rest). n = midi drum size. */
export function drumEv(patterns, n = 40, { vel = 1, alt = null } = {}) {
  const P = Array.isArray(patterns) ? patterns : [patterns];
  return (bar) => {
    const p = P[bar % P.length], out = [];
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      const v = c === 'X' ? 1 : c === 'x' ? 0.7 : c === 'o' ? 0.45 : c === 'g' ? 0.25 : 0;
      if (v) out.push({ s: i, n: alt && c === 'o' ? alt : n, d: 1, v: v * vel });
    }
    return out;
  };
}
/** Sustained chord per bar (prog entries can be 'Dm' or ['Gm','A'] for half bars). */
export function padEv(prog, barSteps, { oct = 3, vel = 0.7, top = false } = {}) {
  return (bar) => {
    const c = prog[bar % prog.length], parts = Array.isArray(c) ? c : [c], len = barSteps / parts.length;
    const out = [];
    parts.forEach((sym, i) => { const ns = chord(sym, oct); if (top) ns.push(ns[0] + 12); for (const n of ns) out.push({ s: i * len, n, d: len, v: vel }); });
    return out;
  };
}
/** Arpeggio: pattern of chord-tone indices per step (null = rest; index ≥ chord size wraps up an octave). */
export function arpEv(prog, barSteps, pattern, { oct = 4, vel = 0.6, d = 2, accent = [] } = {}) {
  return (bar) => {
    const c = prog[bar % prog.length], parts = Array.isArray(c) ? c : [c], len = barSteps / parts.length;
    const out = [];
    for (let s = 0; s < barSteps; s++) {
      const idx = pattern[s % pattern.length];
      if (idx === null || idx === undefined) continue;
      const ns = chord(parts[Math.min(parts.length - 1, Math.floor(s / len))], oct);
      const n = ns[idx % ns.length] + 12 * Math.floor(idx / ns.length);
      out.push({ s, n, d, v: vel * (accent.includes(s) ? 1.25 : 1) });
    }
    return out;
  };
}
/** Bass: chord roots on a rhythm string ('x' = hit, '-' hold not needed; length per hit = until next hit). */
export function bassEv(prog, barSteps, rhythm, { oct = 2, vel = 0.8, fifth = [] } = {}) {
  return (bar) => {
    const c = prog[bar % prog.length], parts = Array.isArray(c) ? c : [c], len = barSteps / parts.length;
    const hits = []; for (let i = 0; i < rhythm.length; i++) if (rhythm[i] !== '.') hits.push(i);
    return hits.map((s, i) => {
      const ns = chord(parts[Math.min(parts.length - 1, Math.floor(s / len))], oct);
      const next = hits[i + 1] ?? barSteps;
      return { s, n: fifth.includes(s) ? ns[2] - 12 : ns[0], d: Math.max(1, next - s) - 0.2, v: vel * (rhythm[s] === 'X' ? 1.15 : 1) };
    });
  };
}

// ---------------------------------------------------------------- sequencer
export class Sequencer {
  /** opts: { intensity(): 0..3, boss(): bool, start (ctx time), fadeIn } */
  constructor(ctx, dest, verbSend, song, opts = {}) {
    this.ctx = ctx; this.song = song; this.opts = opts;
    this.stepDur = 60 / song.bpm / (song.beatSteps || 4);
    this.barDur = this.stepDur * song.barSteps;
    this.t0 = opts.start ?? ctx.currentTime + 0.12;
    this.bar = 0;
    this.rng = seeded(hashStr(song.id || 'song'));
    const G = (song.gain ?? 1) * MUSIC_TRIM;
    this.out = ctx.createGain(); this.out.gain.value = G; this.out.connect(dest);
    if (opts.fadeIn) { this.out.gain.setValueAtTime(0.0001, this.t0); this.out.gain.linearRampToValueAtTime(G, this.t0 + opts.fadeIn); }
    this.tracks = song.tracks.map((tr) => {
      const g = ctx.createGain(); g.gain.value = tr.gain ?? 0.8;
      let node = g;
      if (tr.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = tr.pan; g.connect(p); node = p; }
      node.connect(this.out);
      if (tr.verb && verbSend) { const s = ctx.createGain(); s.gain.value = tr.verb; node.connect(s); s.connect(verbSend); }
      return { ...tr, g, fn: INST[tr.inst] };
    });
    this.level = 0; this.lastLevel = 0; this.done = false; this.notes = 0;
  }

  get endTime() { return this.song.loop === false ? this.t0 + this.barDur * this.song.bars + (this.song.tail || 2) : Infinity; }

  scheduleUntil(t) {
    while (!this.done && this.t0 + this.bar * this.barDur < t) {
      if (this.song.loop === false && this.bar >= this.song.bars) { this.done = true; break; }
      this._scheduleBar(this.bar++);
    }
  }

  _scheduleBar(bar) {
    const song = this.song, ctx = this.ctx;
    const level = Math.max(0, Math.min(3, Math.round(this.opts.intensity ? this.opts.intensity(bar) : song.level ?? 2)));
    const boss = !!(this.opts.boss && this.opts.boss(bar));
    const tb = this.t0 + bar * this.barDur;
    const lb = song.loop === false ? bar : bar % song.bars;
    const info = { level, boss, bar: lb, abs: bar, rng: this.rng };
    // Intensity rise: reverse swell into the downbeat + a big drum.
    if ((level > this.lastLevel || (boss && !this._boss)) && bar > 0) {
      INST.swell(ctx, this.out, Math.max(ctx.currentTime, tb - 0.5), 0, 0.8, 0.5, this.rng);
      INST.taiko(ctx, this.out, tb, 36, 0.9, 1, this.rng);
    }
    this.lastLevel = level; this._boss = boss; this.level = level;
    const tp = song.transpose || 0;
    for (const tr of this.tracks) {
      if (!tr.fn) continue;
      if (level < (tr.lvl ?? 0) || level > (tr.maxLvl ?? 3)) continue;
      if (tr.boss === true && !boss) continue;
      if (tr.boss === false && boss) continue;
      if (tr.every && lb % tr.every !== (tr.phase || 0)) continue;
      let evs;
      try { evs = tr.ev(lb, info) || []; } catch { evs = []; }
      const tpN = tr.drum || DRUMS.has(tr.inst) ? 0 : tp;
      for (const e of evs) {
        const swing = (tr.swing && e.s % 2 === 1) ? tr.swing * this.stepDur : 0;
        const hum = (this.rng() - 0.5) * 0.006;
        const t = tb + e.s * this.stepDur + swing + hum;
        if (t < ctx.currentTime - 0.01) continue;
        tr.fn(ctx, tr.g, Math.max(ctx.currentTime, t), e.n + tpN, Math.min(1.3, e.v * (0.94 + this.rng() * 0.12)), e.d * this.stepDur, this.rng, e.o || tr.o || {});
        this.notes++;
      }
    }
  }

  stop(fade = 1) {
    const t = this.ctx.currentTime;
    try { this.out.gain.cancelScheduledValues(t); this.out.gain.setValueAtTime(this.out.gain.value, t); this.out.gain.linearRampToValueAtTime(0.0001, t + fade); } catch { /* */ }
    this.done = true;
    const o = this.out;
    if (typeof setTimeout === 'function') setTimeout(() => { try { o.disconnect(); } catch { /* */ } }, (fade + 3.5) * 1000);
  }
}

/** Wrap a song as a registry music cue: { id, song, start(engine, opts) → { stop() } }. */
export function cue(song) {
  return { id: song.id, song, start(engine, opts = {}) { engine.music.play(song.id, opts); return { stop: (f) => engine.music.stop(f) }; } };
}
/** Chord stabs on given steps (brass/marcato hits). */
export function stabEv(prog, barSteps, steps, { oct = 3, vel = 0.8, d = 1.5, accent = [0] } = {}) {
  return (bar) => {
    const c = prog[bar % prog.length], parts = Array.isArray(c) ? c : [c], len = barSteps / parts.length, out = [];
    for (const s of steps) for (const n of chord(parts[Math.min(parts.length - 1, Math.floor(s / len))], oct)) out.push({ s, n, d, v: vel * (accent.includes(s) ? 1.2 : 1) });
    return out;
  };
}
/** Play `ev` only on bars [from, to) of the loop (bar index relative to the loop). */
export const section = (ev, from, to, shift = from) => (bar, info) => (bar >= from && bar < to ? ev(bar - shift, info) : []);
