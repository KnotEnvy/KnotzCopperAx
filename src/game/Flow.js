// Flow (game.flow): the arcade state machine (DESIGN §7)
//   boot → title ⇄ attract (AI demo after idle, DEMO PLAY banner) → select (3D skeletal hands) → map (route to
//   stage 1) → stage(1) → tally → bonus camp → map → stage(2) → … → stage(5) → tally → ending → ranking → highscore
//   → title;  gameover (all players out) → ranking → highscore → title;  duel (select → gauntlet);  hall (view scores).
//   Pause: START during a stage (flow.pause()/resume()) freezes the sim via game.freeze and shows ui 'pause'.
// Each state is { enter(flow, data), exit?(flow), update?(flow, dt) }. Extend/replace states with flow.define({...}).
// Also installs game.stats (RunStats) and applies saved Settings (volume, difficulty).
import { EV } from '../core/EventBus.js';
import { registries } from '../core/registries.js';
import { HERO_IDS } from '../core/config.js';
import { startStage, resetStage, snapshotCarry } from './StageRunner.js';
import { reportError } from '../core/log.js';
import { RunStats } from './RunStats.js';
import { prefetchStage } from '../assets/prewarm.js';
import * as Settings from './Settings.js';

/** Arcade order: action stages with a Thieves' Night camp after stages 1–4 (DESIGN §10). */
export const ARCADE_SEQUENCE = ['1', 'bonus', '2', 'bonus', '3', 'bonus', '4', 'bonus', '5'];
/** Seconds of title-screen idle before the attract demo starts, and how long the demo runs. */
export const ATTRACT_IDLE = 25;
export const ATTRACT_LENGTH = 45;
const PAUSE_FREEZE = 1e9;

const norm = (s) => String(s).replace(/^stage/, '');
const isAction = (id) => /^[1-5]$/.test(norm(id));

export class Flow {
  constructor(game) {
    this.game = game;
    this.name = 'flow';
    this.order = 55;
    this.state = 'boot';
    this.data = null;
    this.seqIndex = 0;
    this.picks = [];
    this.mode = 'arcade';
    this.stateTime = 0;
    this.paused = false;
    this.states = defaultStates();
    try { game.stats = new RunStats(game); game.addSystem(game.stats); } catch (e) { reportError('flow.stats', e); }
    try { Settings.apply(game); } catch (e) { reportError('flow.settings', e); }
    this.scope = game.bus.scope();
    this.scope.on(EV.STAGE_CLEAR, () => this.onStageClear());
    this.scope.on(EV.GAME_OVER, () => { if (this.state === 'stage') this.go('gameover'); });
    this._startGuard = -1;
    this.scope.on(EV.CONTINUE_TAKEN, () => { this._startGuard = game.tick; });
    this.scope.on(EV.PLAYER_JOIN, () => { this._startGuard = game.tick; });
    this.scope.on(EV.BOSS_INTRO, (e) => {
      const b = e.boss || {}; const d = b.def || {};
      if (game.ui && game.ui.bossCard) game.ui.bossCard((d.name || b.name || 'BOSS').toUpperCase(), d.title || d.epithet || b.title || '');
    });
  }

  define(states) { Object.assign(this.states, states); }

  /** Switch state (async enter; resolves when entered). */
  async go(name, data = null) {
    const prev = this.state;
    const s = this.states[name];
    if (!s) { reportError('flow', new Error(`unknown flow state '${name}'`)); return; }
    if (this.paused) this.resume();
    try { if (this.states[prev] && this.states[prev].exit) this.states[prev].exit(this, name); } catch (e) { reportError(`flow:${prev}.exit`, e); }
    this.state = name;
    this.data = data;
    this.stateTime = 0;
    this.game.bus.emit(EV.FLOW_STATE, { from: prev, to: name, data });
    // Tracked so __KCA.advance() (manual clock) waits for async stage loads before stepping.
    const p = (async () => { try { await (s.enter && s.enter(this, data)); } catch (e) { reportError(`flow:${name}.enter`, e); } })();
    await this.game.track(p);
  }

  // ------------------------------------------------------------------ pause
  async pause(player = 0) {
    const g = this.game;
    if (this.paused || this.state !== 'stage') return;
    this.paused = true;
    this._freezeBefore = g.freeze;
    g.freeze = PAUSE_FREEZE;
    g.input.releaseAll && g.input.releaseAll();
    if (g.audio && g.audio.duck) g.audio.duck(0.6, 0.2);
    await g.ui.show('pause', {
      player,
      onResume: () => this.resume(),
      onOptions: () => g.ui.show('options', { onClose: () => g.ui.hide('options') }),
      onQuit: () => { this.resume(); this.go('title'); },
    });
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    const g = this.game;
    g.ui.hide('options'); g.ui.hide('pause');
    if (g.freeze >= PAUSE_FREEZE - 1e6) g.freeze = 0;
  }

  /** Stage cleared → tally (action stages) → next entry of the arcade sequence. */
  onStageClear() {
    if (this.state !== 'stage') return;
    const g = this.game;
    const stageId = this.data && this.data.stage;
    if (this.seqIndex >= 0) try { snapshotCarry(g); } catch (e) { reportError('flow.carry', e); }
    g.after(150, () => {
      if (this.state !== 'stage') return;
      if (this.seqIndex < 0) return; // stage not part of the arcade run (test / duel): stay
      try { snapshotCarry(g); } catch (e) { reportError('flow.carry', e); } // pots grabbed after the clear count too
      if (isAction(stageId)) this.go('tally', { stage: stageId });
      else this.advance();
    });
  }

  /** Move to the next arcade-sequence entry (map interlude before each action stage after a camp). */
  advance() {
    this.seqIndex++;
    if (this.seqIndex >= ARCADE_SEQUENCE.length) { this.go('ending'); return; }
    const next = ARCADE_SEQUENCE[this.seqIndex];
    if (isAction(next)) this.go('map', { from: Number(next) - 1, to: Number(next), then: { stage: next, players: this.picks } });
    else this.go('stage', { stage: next, players: this.picks });
  }

  update(dt) {
    this.stateTime += dt;
    const s = this.states[this.state];
    if (s && s.update) s.update(this, dt);
    // START during play = pause (not for bots, not the press that continued / dropped in this tick).
    if (this.state === 'stage' && !this.paused && this.game.tick !== this._startGuard && this.game.tick !== this._startGuard + 1) {
      const sess = this.game.session, ins = this.game.input.players;
      for (let i = 0; i < ins.length; i++) {
        const p = sess && sess.players[i];
        if (p && p.active && !p.bot && !p.out && p.continueTimer < 0 && ins[i].pressed('start')) { this.game.track(this.pause(i)); break; }
      }
    }
  }

  dispose() { this.scope.dispose(); }
}

/** Title backdrop: stage-1 environment with a slow wide camera drift. */
async function backdrop(g) {
  await g.levels.load('stage1', { script: false });
  g.cameraRig.manual = false;
  g.cameraRig.follow([]);
  g.cameraRig.focus.set(8, 0, 0);
  g.cameraRig.drama({ distance: 24, height: 7.5, fov: 30, lookHeight: 3.2, in: 0.001, hold: null });
  g.cameraRig.snap();
}

async function heroDefs() { return (await Promise.all(HERO_IDS.map((id) => registries.heroes.load(id)))).filter(Boolean); }

/** After a run: ranking → highscore entry → title. */
function endRun(flow) {
  const g = flow.game;
  if (g.stats) g.stats.close();
  const players = g.session.players.filter((p) => p.active && !p.bot).map((p) => p.index);
  flow.go('ranking', { players: players.length ? players : [0] });
}

function defaultStates() {
  return {
    boot: { enter() {} },
    title: {
      async enter(flow, data) {
        const g = flow.game;
        resetStage(g);
        g.session.reset();
        if (g.stats) g.stats.beginRun();
        Settings.apply(g);
        await backdrop(g);
        const open = (id) => g.ui.show(id, { onClose: () => g.ui.hide(id) });
        await g.ui.show('title', {
          skipPress: !!(data && data.menu),
          onSelect: (mode, player) => {
            if (mode === 'options') open('options');
            else if (mode === 'highscores') flow.go('hall');
            else { flow.mode = mode === 'duel' ? 'duel' : 'arcade'; flow.go('select', { player }); }
          },
        });
      },
      update(flow, dt) {
        const g = flow.game, r = g.cameraRig;
        r.focus.x += dt * 0.6; r.prevFocus.x = r.focus.x;
        if (g.input.players.some((p) => ['start', 'light', 'jump', 'up', 'down', 'left', 'right'].some((a) => p.pressed(a)))) flow.stateTime = 0;
        if (flow.stateTime > ATTRACT_IDLE && !g.params.capture && !g.ui.screens.has('options')) flow.go('attract');
      },
      exit(flow) { flow.game.ui.hide('title'); flow.game.ui.hide('options'); flow.game.cameraRig.clearDrama(); },
    },
    /** Attract mode: AI demo play (two bots) until START or timeout. */
    attract: {
      async enter(flow) {
        const g = flow.game;
        g.session.reset();
        g.session.autoContinue = true;
        // Demo heroes start with a magic stock so the attract loop shows spells too (the full DESIGN §3 moveset).
        const players = [{ player: 0, heroId: 'brann', bot: true, magic: 3 }, { player: 1, heroId: 'gorrim', bot: true, magic: 2 }];
        for (const p of players) g.session.join(p.player, p.heroId, { bot: true });
        await startStage(g, { stage: '1', players, card: false });
        g.ui.demo(true);
      },
      update(flow) {
        const g = flow.game;
        if (flow.stateTime > ATTRACT_LENGTH) flow.go('hall', { attract: true });
        else if (g.input.players.some((p) => p.pressed('start'))) flow.go('title', { menu: true });
      },
      exit(flow) { flow.game.session.autoContinue = false; flow.game.ui.demo(false); },
    },
    /** Hall of Legends (view-only high scores): from the title menu or as the attract loop's second half. */
    hall: {
      async enter(flow, data) {
        const g = flow.game;
        resetStage(g); await backdrop(g);
        await g.ui.show('highscore', { entries: [], hold: data && data.attract ? 10 : 30, onDone: () => flow.go('title', { menu: !(data && data.attract) }) });
      },
      update(flow) { const g = flow.game, r = g.cameraRig; r.focus.x += 0.01; r.prevFocus.x = r.focus.x; },
      exit(flow) { flow.game.ui.hide('highscore'); flow.game.cameraRig.clearDrama(); },
    },
    select: {
      async enter(flow, data) {
        const g = flow.game;
        resetStage(g);
        const heroes = await heroDefs();
        await g.ui.show('select', {
          heroes, player: (data && data.player) || 0,
          onBack: () => flow.go('title', { menu: true }),
          onConfirm: (picks) => {
            flow.picks = picks.map((p) => ({ player: p.player, heroId: p.heroId, bot: false }));
            g.session.reset();
            for (const p of flow.picks) g.session.join(p.player, p.heroId);
            if (g.stats) g.stats.beginRun();
            if (flow.mode === 'duel') { flow.seqIndex = -1; flow.go('stage', { stage: 'duel', players: flow.picks.slice(0, 1) }); return; }
            flow.seqIndex = 0;
            flow.go('map', { from: 0, to: 1, then: { stage: ARCADE_SEQUENCE[0], players: flow.picks } });
          },
        });
      },
      exit(flow) { flow.game.ui.hide('select'); },
    },
    /** Parchment-map interlude: route animates to the next location, then the stage starts. */
    map: {
      async enter(flow, data) {
        const g = flow.game;
        resetStage(g);
        g.renderer.lighting.apply({ sky: { top: '#050302', horizon: '#0a0604', bottom: '#050302', sunGlow: 0 }, fog: { color: '#050302', near: 1, far: 2 } });
        // Load + build the next stage's warm set while the route animates (src/assets/prewarm.js).
        if (data.then && data.then.stage != null) prefetchStage(g, data.then.stage);
        await g.ui.show('map', { from: data.from, to: data.to, onDone: () => flow.go('stage', data.then) });
      },
      exit(flow) { flow.game.ui.hide('map'); },
    },
    stage: {
      async enter(flow, data) {
        const g = flow.game;
        flow.picks = data.players;
        if (data.direct) flow.seqIndex = ARCADE_SEQUENCE.indexOf(norm(data.stage)); // -1 = not in the arcade run
        // Beasts are lost between stages and fresh credits keep their score (session persists).
        // Arcade run: pots + life carry over from the previous stage/camp (snapshotted at its clear).
        await startStage(g, { stage: data.stage, players: data.players, screen: data.screen || 0, carry: flow.seqIndex > 0 });
      },
      exit(flow) { flow.resume(); },
    },
    /** Stage-clear tally over the cleared stage; bonuses are banked into the session score. */
    tally: {
      async enter(flow) {
        const g = flow.game;
        g.ui.go(false);
        const rec = g.stats && g.stats.cur;
        // perf-1650: build the camp's warm set while the tally is up (the map prefetches action stages)
        { const nx = ARCADE_SEQUENCE[flow.seqIndex + 1]; if (nx && !isAction(nx)) prefetchStage(g, nx); }
        if (!rec) { flow.advance(); return; }
        const players = g.session.players.filter((p) => p.active).map((p) => p.index);
        await g.ui.show('tally', {
          rec, players,
          onDone: (res) => {
            for (const r of res) g.session.addScore(r.player, r.bonus, 'tally');
            rec.ratings = res;
            if (norm(rec.id) === '5') { g.ui.hide('tally'); flow.go('ending'); } else flow.advance();
          },
        });
      },
      exit(flow) { flow.game.ui.hide('tally'); },
    },
    duel: {
      async enter(flow) { flow.mode = 'duel'; flow.go('select', { player: 0 }); },
    },
    ending: {
      async enter(flow, data) {
        const g = flow.game;
        // Chapter 1 ending sequence (bonus-camp agent, src/game/ending.js); the card below is the fallback.
        try { const m = await import('./ending.js'); if (m && m.startEnding) { m.startEnding(flow, data, { endRun }); return; } } catch (e) { reportError('flow:ending', e); }
        g.ui.card('THE COPPER AX IS RESTORED', 'THE END', 6, { big: true });
        g.after(60 * 7, () => { if (flow.state === 'ending') endRun(flow); });
      },
      exit(flow) { if (flow._ending) flow._ending.stop(); },
    },
    gameover: {
      async enter(flow) {
        const g = flow.game;
        g.ui.go(false);
        // Whatever stage the run died on, the GAME OVER moment is graded into the same firelit ashen dusk as the
        // title / select / tally screens (the next stage load or the ranking ledger re-applies its own lighting).
        try { g.renderer.lighting.apply({ base: 'ashen-dusk', exposure: 0.9 }); } catch (e) { /* lighting optional */ }
        g.ui.card('YOUR LEGEND ENDS HERE', 'GAME OVER', 5.5, { big: true });
        g.after(60 * 6, () => { if (flow.state === 'gameover') endRun(flow); });
      },
    },
    /** YOUR STRENGTH / CLASS ledger. */
    ranking: {
      async enter(flow, data) {
        const g = flow.game;
        const heroes = {}; for (const p of g.session.players) if (p.active) heroes[p.index] = p.heroId;
        const snapshot = g.session.players.map((p) => ({ ...p, actor: null }));
        resetStage(g);
        g.renderer.lighting.apply({ sky: { top: '#050302', horizon: '#0a0604', bottom: '#050302', sunGlow: 0 }, fog: { color: '#050302', near: 1, far: 2 } });
        await g.ui.show('ranking', { run: g.stats ? g.stats.run : null, players: data.players, heroes, onDone: () => {
          const reached = g.stats ? ([...g.stats.run.stages].reverse().find((r) => r.num) || { id: '1' }).id : '1'; // numbered action stage only (camps are not numbered)
          flow.go('highscore', { entries: snapshot.filter((p) => p.active && !p.bot).map((p) => ({ player: p.index, score: p.score, hero: p.heroId, stage: reached })) });
        } });
      },
      exit(flow) { flow.game.ui.hide('ranking'); },
    },
    highscore: {
      async enter(flow, data) {
        const g = flow.game;
        resetStage(g); await backdrop(g);
        await g.ui.show('highscore', { entries: (data && data.entries) || [], onDone: () => flow.go('title') });
      },
      exit(flow) { flow.game.ui.hide('highscore'); flow.game.cameraRig.clearDrama(); },
    },
  };
}
