// Game: owns the clock and the service hub. Fixed 60 Hz simulation with an accumulator, rAF rendering with
// interpolation (alpha), global timeScale (slow-mo), global hitstop (freeze N ticks), per-actor hitstop
// (World), and a manual clock for deterministic captures (__KCA.advance(ms)).
//
// Services (set up by main.js / StageRunner; any may be null in a showcase that doesn't need them):
//   game.renderer (render/Renderer) · game.scene · game.cameraRig · game.camera · game.world · game.bus
//   game.input · game.rng · game.fxRng · game.assets · game.anim (ClipLibrary) · game.combat · game.vfx
//   game.magic · game.audio · game.ui · game.levels (LevelDirector) · game.session · game.flow · game.ai
//   game.mounts · game.params · game.quality
//
// Systems: game.addSystem({ name, order, update(dt), frozenUpdate?(dt), render?(alpha, frameDt), freezable? })
//   order: bots −10 · input 0 · timers 5 · ai 10 · world 20 · mounts 25 · combat 30 · combo 35 · level 40 · magic 45
//          session 50 · flow 55 · vfx 60 · showcase 70 · camera 80 · ui 90 · audio 95 · debugDraw 99
//   update(dt) runs per 60 Hz sim tick (dt = 1/60); render(alpha, frameDt) once per displayed frame (alpha = sub-tick
//   interpolation, frameDt = real seconds). One system throwing is reported and skipped; the others keep running.
//   freezable (default true): skipped during global hitstop (frozenUpdate is called instead).
import { DT, TICK_HZ, params as urlParams, QUALITY } from './config.js';
import { EventBus } from './EventBus.js';
import { InputManager } from './Input.js';
import { World } from './World.js';
import { RNG } from './rng.js';
import { reportError } from './log.js';

export class Game {
  constructor({ container, params = urlParams } = {}) {
    this.container = container;
    this.params = params;
    this.quality = QUALITY;
    this.tick = 0;
    this.time = 0;          // sim seconds
    this.realTime = 0;      // unscaled seconds since boot (UI, time fx)
    this.timeScale = 1;
    this.freeze = 0;        // global hitstop ticks remaining
    this.acc = 0;
    this.alpha = 0;
    this.manual = !!params.capture;
    this.running = false;
    this.systems = [];
    this.pending = new Set();
    this._timers = [];
    this._timeFx = null;
    this._fps = { frames: 0, t0: performance.now(), value: 0 };
    /** Last live frame's CPU timings in ms (sim = fixed ticks, render = systems' render + Renderer), steps = ticks run. */
    this.perf = { sim: 0, render: 0, steps: 0, dt: 0 };
    this.frameHook = null; // (now, perf) => void — render/perfProbe.js recorder

    this.bus = new EventBus();
    // Events are stamped with the tick they belong to: game.tick once the step that emits them has finished
    // (step() increments tick after the systems run), or the upcoming tick when emitted between steps. So
    // __KCA.events(type, game.tick) read at any moment returns everything emitted after that read.
    this.bus.tickRef = () => this.tick + 1;
    this.input = new InputManager();
    this.rng = new RNG(params.seed);
    this.fxRng = new RNG((params.seed * 7919) >>> 0);
    this.world = new World(this);

    // Filled by main.js:
    this.renderer = null; this.scene = null; this.cameraRig = null; this.camera = null;
    this.assets = null; this.anim = null; this.combat = null; this.vfx = null; this.magic = null; this.audio = null;
    this.ui = null; this.levels = null; this.session = null; this.flow = null; this.ai = null; this.mounts = null;

    this.addSystem({ name: 'input', order: 0, freezable: false, update: () => this.input.update(this.tick) });
    this.addSystem({ name: 'timers', order: 5, update: () => this._runTimers() });
    this.addSystem({
      name: 'world', order: 20,
      update: (dt) => this.world.update(dt),
      frozenUpdate: () => this.world.frozenUpdate(),
      render: (a, fdt) => this.world.render(a, fdt),
    });
  }

  // ------------------------------------------------------------ systems
  addSystem(sys) {
    if (!sys.name) throw new Error('system needs a name');
    this.removeSystem(sys.name);
    sys.order = sys.order ?? 50;
    if (sys.freezable === undefined) sys.freezable = true;
    this.systems.push(sys);
    this.systems.sort((a, b) => a.order - b.order);
    return sys;
  }
  removeSystem(name) {
    const i = this.systems.findIndex((s) => s.name === name);
    if (i >= 0) { const [s] = this.systems.splice(i, 1); try { s.dispose && s.dispose(); } catch (e) { reportError(`system:${name}.dispose`, e); } }
  }
  system(name) { return this.systems.find((s) => s.name === name) || null; }

  // ------------------------------------------------------------ time control
  /** Global hitstop: freeze the simulation (except input/camera/vfx systems) for N ticks. */
  hitstop(ticks) { this.freeze = Math.max(this.freeze, ticks | 0); }

  /**
   * Slow motion: ramp timeScale to `scale`, hold for `hold` real seconds, ramp back over `out` seconds.
   * Returns a promise resolved when back to 1. A new call replaces the previous one.
   */
  slowmo(scale = 0.3, hold = 0.5, { inTime = 0.05, out = 0.25 } = {}) {
    return new Promise((resolve) => {
      if (this._timeFx) this._timeFx.resolve();
      this._timeFx = { scale, hold, inTime, out, t: 0, from: this.timeScale, resolve };
    });
  }

  _updateTimeFx(realDt) {
    const f = this._timeFx;
    if (!f) return;
    f.t += realDt;
    if (f.t < f.inTime) this.timeScale = f.from + (f.scale - f.from) * (f.t / f.inTime);
    else if (f.t < f.inTime + f.hold) this.timeScale = f.scale;
    else if (f.t < f.inTime + f.hold + f.out) this.timeScale = f.scale + (1 - f.scale) * ((f.t - f.inTime - f.hold) / f.out);
    else { this.timeScale = 1; this._timeFx = null; f.resolve(); }
  }

  /** Run fn after N sim ticks (respects hitstop/slow-mo). Returns a cancel function. */
  after(ticks, fn) {
    const t = { at: this.tick + Math.max(0, ticks | 0), fn, dead: false };
    this._timers.push(t);
    return () => { t.dead = true; };
  }
  /** Promise flavour of after(). The manual clock drains microtasks after a tick that resolved one, so an
   *  `await game.wait(n)` continuation runs before the next tick exactly as it does in live play. */
  wait(ticks) { return new Promise((r) => this.after(ticks, () => { this._waitFired = true; r(); })); }
  /** Seconds → ticks. */
  ticks(seconds) { return Math.round(seconds * TICK_HZ); }

  _runTimers() {
    if (!this._timers.length) return;
    const due = this._timers.filter((t) => !t.dead && t.at <= this.tick);
    this._timers = this._timers.filter((t) => !t.dead && t.at > this.tick);
    for (const t of due) { try { t.fn(); } catch (e) { reportError('timer', e); } }
  }
  clearTimers() { this._timers.length = 0; }

  // ------------------------------------------------------------ async tracking (capture determinism)
  /** Register an in-flight async load; __KCA.advance waits for these before stepping. */
  track(promise) {
    this.pending.add(promise);
    promise.finally(() => this.pending.delete(promise));
    return promise;
  }
  async flushPending(timeoutMs = 8000) {
    if (!this.pending.size) return;
    await Promise.race([Promise.allSettled([...this.pending]), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  // ------------------------------------------------------------ loop
  step() {
    const frozen = this.freeze > 0;
    for (const s of this.systems) {
      try {
        if (!frozen || !s.freezable) { if (s.update) s.update(DT); }
        else if (s.frozenUpdate) s.frozenUpdate(DT);
      } catch (e) { reportError(`system:${s.name}`, e); }
    }
    if (frozen) { this.freeze--; this.frozenTicks = (this.frozenTicks || 0) + 1; }
    else { this.tick++; this.time += DT; }
  }

  renderFrame(alpha, frameDt) {
    this.alpha = alpha;
    for (const s of this.systems) {
      if (!s.render) continue;
      try { s.render(alpha, frameDt); } catch (e) { reportError(`render:${s.name}`, e); }
    }
    if (this.renderer) {
      try { this.renderer.render(frameDt); } catch (e) { reportError('renderer', e); }
    }
    this._fps.frames++;
  }

  /** Advance the clock by real seconds (used by rAF and the manual clock). */
  _advanceReal(seconds) {
    let remaining = seconds;
    let steps = 0;
    while (remaining > 1e-9) {
      const chunk = Math.min(remaining, DT);
      remaining -= chunk;
      this.realTime += chunk;
      this._updateTimeFx(chunk);
      this.acc += chunk * this.timeScale;
      while (this.acc >= DT - 1e-9) {
        this.step();
        this.acc -= DT;
        if (++steps > 600) { this.acc = 0; break; }
      }
    }
    if (this.acc < 0) this.acc = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    // Frame pacing (perf-1650): on a 120/144/165/240 Hz panel rAF fires 2–4× per 60 Hz tick; rendering every one of
    // those frames multiplies the GPU load for no new simulation state (the sim is fixed 60 Hz). Render every k-th
    // vsync, k = floor(refresh / 60) (144 Hz → 72 fps, 120 → 60, 240 → 60), which keeps pacing even. &fpscap=0 off.
    const pace = this._pace = { iv: new Float32Array(61), n: 0, prev: 0, k: 1, count: 0, off: this.params.get && this.params.get('fpscap') === '0' };
    const loop = (now) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (!pace.off) {
        if (pace.prev) { pace.iv[pace.n++ % 61] = now - pace.prev; }
        pace.prev = now;
        if (pace.n >= 61 && (pace.n & 31) === 0) { const s = Array.from(pace.iv).sort((a, b) => a - b); const med = s[30]; pace.k = med > 2 && med < 12.5 ? Math.max(1, Math.floor(16.667 / med + 0.15)) : 1; }
        if (pace.k > 1 && (pace.count++ % pace.k) !== 0) return;
      }
      const realDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const f = this._fps;
      if (now - f.t0 > 500) { f.value = (f.frames * 1000) / (now - f.t0); f.frames = 0; f.t0 = now; }
      if (this.manual) return; // capture drives advance()
      // Per-frame CPU split (perf-1650): sim ticks vs render (systems + renderer). Read by render/perfProbe.js.
      const P = this.perf, t0 = performance.now(), tk = this.tick + (this.frozenTicks || 0);
      this._advanceReal(realDt);
      const t1 = performance.now();
      this.renderFrame(Math.min(1, this.acc / DT), realDt);
      const t2 = performance.now();
      P.sim = t1 - t0; P.render = t2 - t1; P.steps = this.tick + (this.frozenTicks || 0) - tk; P.dt = realDt;
      if (this.frameHook) { try { this.frameHook(now, P); } catch (e) { this.frameHook = null; reportError('perf.frameHook', e); } }
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }
  /** Current render pacing divisor (1 = every vsync). */
  get paceK() { return this._pace ? this._pace.k : 1; }

  setManualClock(on) { this.manual = !!on; }

  /** Manual clock: step the sim by `ms` of game time (fixed ticks), then render exactly one frame. */
  async advance(ms) {
    await this.flushPending();
    // Tick-sized chunks (same result as one _advanceReal call). After a chunk in which a game.wait() promise
    // resolved, let its continuation run (spells, flow scripts) before the next tick, as rAF play would.
    let remaining = Math.max(0, ms) / 1000;
    while (remaining > 1e-9) {
      const c = Math.min(remaining, DT);
      remaining -= c;
      this._advanceReal(c);
      if (this._waitFired) { this._waitFired = false; for (let i = 0; i < 16; i++) await null; } // eslint-disable-line no-await-in-loop
    }
    this.renderFrame(Math.min(1, this.acc / DT), Math.max(0, ms) / 1000);
    await this.flushPending(2000);
  }

  get fps() { return this._fps.value; }
}
