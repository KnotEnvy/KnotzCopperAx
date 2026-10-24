// MusicDirector (audio.music): picks cues from flow/stage events, crossfades between them, and drives the adaptive
// intensity (0 calm … 3 all-out) from combat: live enemy count, combo count, screen locks, boss presence.
//   play(id, { fade, restart, transpose }) · stop(fade) · setIntensity(n | null = auto) · setBoss(bool) · bump(level)
//   combo(count) · forStage(stageId) · forFlow(state, data) · info()
// Cues: src/audio/music/<id>.js → { id, song } (song format: music/_seq.js); start(engine, opts) → { stop() } is provided
// here when a cue does not define its own.
import { registries } from '../core/registries.js';
import { reportError } from '../core/log.js';
import { Sequencer } from './music/_seq.js';

const STAGE_CUE = { stage1: ['stage1', 0], stage2: ['stage2', 0], stage3: ['stage1', 2], stage4: ['stage2', -2], stage5: ['stage1', 0], duel: ['stage1', 0], test: ['stage1', 0], bonus: ['camp', 0], camp: ['camp', 0] };
const FLOW_CUE = { title: 'title', attract: 'title', select: 'title', hall: 'title', map: 'camp', ranking: 'camp', highscore: 'camp', ending: 'clear' };

export class MusicDirector {
  constructor(engine) {
    this.engine = engine;
    this.cues = new Map();
    this.ctx = null; this.buses = null;
    this.current = null; this.seq = null; this.pending = null;
    this.level = 0; this.manual = null; this.boss = false;
    this._combo = 0; this._comboT = 0; this._bump = 0; this._bumpT = 0; this._downT = 0; this._tick = 0;
  }

  async preload() {
    try { const cues = await registries.music.loadAll(); for (const [, c] of cues) if (c && c.id) this.cues.set(c.id, c); } catch (e) { reportError('music.preload', e); }
  }

  attach(ctx, buses) {
    this.ctx = ctx; this.buses = buses;
    if (this.pending) { const p = this.pending; this.pending = null; this.play(p.id, p.opts); }
  }

  play(id, opts = {}) {
    if (!this.ctx) { this.pending = { id, opts }; return false; }
    if (this.current === id && this.seq && !this.seq.done && !opts.restart && (opts.transpose ?? 0) === (this._tp ?? 0)) return true;
    const cue = this.cues.get(id);
    if (!cue) return false;
    try {
      if (this.seq) this.seq.stop(opts.fade ?? 1.2);
      const song = { ...cue.song, transpose: opts.transpose ?? cue.song.transpose ?? 0 };
      this.seq = new Sequencer(this.ctx, this.buses.music, this.buses.hallSend, song, {
        intensity: song.adaptive ? () => this.effectiveLevel() : null,
        boss: song.adaptive ? () => this.boss : null,
        fadeIn: opts.fadeIn ?? (song.loop === false ? 0 : 0.6),
        start: this.ctx.currentTime + (opts.delay ?? 0.15),
      });
      this.current = id; this._tp = song.transpose;
      return true;
    } catch (e) { reportError(`music:${id}`, e); return false; }
  }

  stop(fade = 1.5) { if (this.seq) this.seq.stop(fade); this.seq = null; this.current = null; }

  effectiveLevel() { return this.manual ?? (this.boss ? 3 : this.level); }
  setIntensity(n) { this.manual = n === null || n === undefined ? null : Math.max(0, Math.min(3, n)); }
  setBoss(on) { this.boss = !!on; }
  bump(level) { this._bump = Math.max(this._bump, level); this._bumpT = 8; }
  combo(n) { this._combo = n; this._comboT = 3; }

  forStage(stageId) {
    const [id, tp] = STAGE_CUE[String(stageId)] || ['stage1', 0];
    this.boss = false; this.level = 0;
    this.play(id, { transpose: tp });
  }

  forFlow(state, data) {
    if (state === 'gameover') { this.play('gameover'); return; }
    if (state === 'tally') { this.play('clear'); return; }
    const id = FLOW_CUE[state];
    if (id) this.play(id);
    void data;
  }

  update() {
    if (!this.seq) return;
    const now = this.ctx.currentTime;
    this.seq.scheduleUntil(now + 0.4);
    if (this.seq.done && now > this.seq.endTime) {
      const next = this.seq.song.then; this.seq = null; this.current = null;
      if (next) this.play(next, { fadeIn: 3 });
      return;
    }
    if (++this._tick % 15) return;
    // Combat intensity (sampled 4×/s, applied on the next downbeat by the sequencer).
    const dt = 0.25;
    this._comboT -= dt; this._bumpT -= dt;
    if (this._comboT <= 0) this._combo = 0;
    if (this._bumpT <= 0) this._bump = 0;
    let enemies = 0;
    try { const w = this.engine.game.world; if (w && w.query) enemies = w.query({ team: 'enemies', alive: true }).length; } catch { /* */ }
    let want = enemies === 0 ? 0 : enemies <= 2 ? 1 : enemies <= 4 ? 2 : 3;
    if (this._combo >= 8) want = Math.max(want, 2);
    if (this._combo >= 20) want = 3;
    if (enemies > 0) want = Math.max(want, this._bump);
    // Rise immediately; fall only after 4 s of calm so the score doesn't flap between waves.
    if (want >= this.level) { this.level = want; this._downT = 4; }
    else if ((this._downT -= dt) <= 0) { this.level = Math.max(want, this.level - 1); this._downT = 3; }
  }

  info() { return { cue: this.current, level: this.effectiveLevel(), boss: this.boss, bar: this.seq ? this.seq.bar : 0, notes: this.seq ? this.seq.notes : 0, cues: [...this.cues.keys()] }; }
}
