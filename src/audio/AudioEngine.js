// AudioEngine (game.audio): WebAudio mixer + synthesized SFX banks (src/audio/banks/<id>.js) + adaptive music (src/audio/music).
//
//   audio.play(id, { volume=1, pitch=1, pan=0, bus, tier, delay })  → voice | null   (safe no-op until unlocked / when muted)
//   audio.unlock()     first user gesture (keydown/pointerdown/touch/gamepad); never throws, even if resume() is refused
//   audio.buses        { master, sfx, voice, ui, music, musicDuck, ... } (Settings writes master/music/sfx .gain.value)
//   audio.duck(amount, seconds)   sidechain-style music dip (big hits, magic, pause)
//   audio.panFor(actor) screen-x pan −1..1           audio.music  MusicDirector: play(cueId), setIntensity(0..3), setBoss(bool)
//   audio.stats        { played, skipped, live, buffered, byName, events }   → __KCA.audio.stats() (debug hook)
// Sounds are functions (ctx, out, opts) with .meta { dur, v, gain, jit, max, gap, verb, bus, live } (see dsp.S()).
// After unlock every non-live sound is pre-rendered into `v` mono AudioBuffer variants via OfflineAudioContext
// (seeded, so each variant differs); play() picks a variant ≠ the last one and jitters pitch/level. Until a sound's
// buffers exist it is synthesized live, so nothing is ever silent. Event → sound mapping lives in _wire().
import { registries } from '../core/registries.js';
import { reportError } from '../core/log.js';
import { EV } from '../core/EventBus.js';
import { buildMixer, duckParam } from './mixer.js';
import { seeded, hashStr } from './dsp.js';
import { MusicDirector } from './MusicDirector.js';
import { targetDb } from './levels.js';

const ALIAS = { swing: 'whoosh_fist', thud: 'land', bodyfall: 'body_fall', magic_cast: 'magic_rise' };
const WHOOSH = {
  greatsword: ['whoosh_greatsword', 'whoosh_greatsword_heavy'], sabre: ['whoosh_sabre', 'whoosh_blade'],
  copperax: ['whoosh_axe', 'whoosh_axe_heavy'], axe: ['whoosh_axe', 'whoosh_axe_heavy'],
  club: ['whoosh_club', 'whoosh_club'], mace: ['whoosh_club', 'whoosh_axe_heavy'], sword: ['whoosh_blade', 'whoosh_greatsword'],
  none: ['whoosh_fist', 'whoosh_club'], fist: ['whoosh_fist', 'whoosh_club'],
};
const BLADED = new Set(['greatsword', 'sabre', 'copperax', 'axe', 'sword']);
const POT_STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const PRE_SR = 32000;

export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.name = 'audio';
    this.order = 95;
    this.freezable = false;
    this.ctx = null;
    this.sounds = new Map();
    this.cache = new Map(); // name → AudioBuffer[]
    this.buses = {};
    this.volume = { master: 0.8, sfx: 1, music: 0.6, ui: 0.8, voice: 0.9 };
    this.enabled = !game.params.raw.has('mute');
    this.maxVoices = 40;
    this.voices = [];
    this._last = new Map();
    this._lastVar = new Map();
    this._cool = new Map();
    this._duck = { until: 0, depth: 1 };
    this.stats = { played: 0, skipped: 0, live: 0, buffered: 0, stolen: 0, byName: {}, events: 0, prerendered: 0 };
    this.music = new MusicDirector(this);
    this._unlockFn = () => this.unlock();
    for (const ev of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(ev, this._unlockFn, { passive: true });
    this._wire();
    try {
      const K = window.__KCA;
      if (K && K.register) K.register('audio', {
        stats: () => ({ ...this.stats, byName: { ...this.stats.byName }, active: this.voices.length, state: this.ctx ? this.ctx.state : 'locked', music: this.music.info() }),
        unlock: () => { this.unlock(); return this.ctx ? this.ctx.state : 'none'; },
        play: (id, o) => !!this.play(id, o),
        music: (id, o) => this.music.play(id, o),
        intensity: (n) => this.music.setIntensity(n),
        boss: (on) => this.music.setBoss(on),
        sounds: () => [...this.sounds.keys()],
        peak: () => this.peak(),
        reset: () => { this.stats.played = 0; this.stats.byName = {}; this.stats.events = 0; this.stats.skipped = 0; },
      });
    } catch { /* hooks optional */ }
  }

  async preload() {
    const banks = await registries.sfx.loadAll();
    for (const [, b] of banks) for (const [name, fn] of Object.entries(b.sounds || {})) this.sounds.set(name, fn);
    await this.music.preload();
  }

  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.buses = buildMixer(this.ctx, this.volume);
        this._prerender();
        this.music.attach(this.ctx, this.buses);
      }
      if (this.ctx.state === 'suspended' && this.volume.master > 0.001) {
        const p = this.ctx.resume();
        if (p && p.catch) p.catch(() => { /* autoplay refused: stays suspended, next gesture retries */ });
      }
    } catch (e) { reportError('audio.unlock', e); }
  }

  get running() { return !!(this.ctx && this.ctx.state === 'running'); }
  get muted() { return !this.enabled || this.volume.master <= 0.001; }

  /** Render one sound offline (mono, PRE_SR) → AudioBuffer. */
  static async renderOne(fn, name, v = 0, opts = {}) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const oc = new OAC(1, Math.ceil((fn.meta.dur || 1) * PRE_SR), PRE_SR);
    const out = oc.createGain(); out.connect(oc.destination);
    fn(oc, out, { rng: seeded(hashStr(name) + v * 7919), pitch: 1, variant: v, at: 0, tier: 6, ...opts });
    return oc.startRendering();
  }

  /** Measure the raw peak of every sound not yet calibrated and set meta.norm (see levels.js). Needs no AudioContext. */
  async calibrate() {
    if (this._calibrating) return this._calibrating;
    this._calibrating = (async () => {
      for (const [name, fn] of this.sounds) {
        const m = fn.meta; if (!m || m.norm) continue;
        try { setNorm(name, m, [await AudioEngine.renderOne(fn, name, 0)]); } catch (e) { reportError(`audio.calibrate:${name}`, e); }
      }
    })();
    return this._calibrating;
  }

  /** Render `n` seeded variants of a sound in ONE offline pass (variant i starts at i·dur) → AudioBuffer[]. */
  static async renderVariants(fn, name, n) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const len = Math.ceil((fn.meta.dur || 1) * PRE_SR), oc = new OAC(1, len * n, PRE_SR);
    for (let v = 0; v < n; v++) {
      const out = oc.createGain(); out.connect(oc.destination);
      fn(oc, out, { rng: seeded(hashStr(name) + v * 7919), pitch: 1, variant: v, at: v * len / PRE_SR, tier: 6 });
    }
    const all = (await oc.startRendering()).getChannelData(0), list = [];
    for (let v = 0; v < n; v++) {
      const b = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: PRE_SR });
      b.copyToChannel(all.subarray(v * len, (v + 1) * len), 0);
      list.push(b);
    }
    return list;
  }

  /** Pre-render every non-live sound into mono variant buffers in the background, most frequent sounds first. */
  async _prerender() {
    if (!(window.OfflineAudioContext || window.webkitOfflineAudioContext)) return;
    const prio = (n) => (/^(step_|hit_|whoosh_)/.test(n) ? 0 : /^(vo_|land|body_|jump|dodge|grab|throw)/.test(n) ? 1 : 2);
    const order = [...this.sounds].sort((a, b) => prio(a[0]) - prio(b[0]));
    for (const [name, fn] of order) {
      const m = fn.meta;
      if (!m || !m.dur) continue;
      const n = m.live ? (m.norm ? 0 : 1) : (m.v ?? 4);
      if (!n) continue;
      let list = [];
      try { list = await AudioEngine.renderVariants(fn, name, n); } catch (e) { reportError(`audio.prerender:${name}`, e); }
      if (list.length && !m.norm) setNorm(name, m, list);
      if (list.length && !m.live) { this.cache.set(name, list.map(trim)); this.stats.prerendered++; }
      await new Promise((r) => setTimeout(r, 0));
    }
    this.stats.prerenderDone = true;
  }

  /**
   * Play a sound. o: { volume, pitch, pan, bus, delay, tier, verb } → voice handle or null.
   * Voice rules: per-sound min gap (meta.gap, 25 ms), per-sound max concurrent (meta.max, steals oldest), global cap.
   */
  play(id, o = {}) {
    let name = ALIAS[id] || id;
    if (name === 'ui_move' && (o.pitch ?? 1) < 0.8) { name = 'ui_back'; o = { ...o, pitch: 1 }; } // widgets.sfx 'back'
    this.stats.events++;
    if (!this.running || this.muted) { this.stats.skipped++; this.stats.skipLocked = (this.stats.skipLocked || 0) + 1; return null; }
    const fn = this.sounds.get(name);
    if (!fn) { this.stats.skipped++; return null; }
    const m = fn.meta || {};
    const ctx = this.ctx, now = ctx.currentTime;
    const last = this._last.get(name) || -1;
    if (now - last < (m.gap ?? 0.025)) { this.stats.skipped++; this.stats.skipGap = (this.stats.skipGap || 0) + 1; return null; }
    this._last.set(name, now);
    try {
      const same = this.voices.filter((v) => v.name === name);
      if (same.length >= (m.max ?? 4)) { this._stop(same[0]); this.stats.stolen++; }
      if (this.voices.length >= this.maxVoices) { this._stop(this.voices[0]); this.stats.stolen++; }
      const r = Math.random;
      const jit = m.jit ?? 0.05;
      const rate = (o.pitch ?? 1) * (1 + (r() * 2 - 1) * jit);
      const vol = (o.volume ?? 1) * (m.norm ?? m.gain ?? 1) * (1 + (r() * 2 - 1) * 0.08);
      const t = now + (o.delay || 0);
      const out = ctx.createGain(); out.gain.value = vol;
      let tail = out;
      if (o.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); out.connect(p); tail = p; }
      tail.connect(this.buses[o.bus || m.bus || 'sfx'] || this.buses.sfx);
      const verb = o.verb ?? m.verb ?? 0;
      let send = null;
      if (verb > 0) { send = ctx.createGain(); send.gain.value = verb; tail.connect(send); send.connect(this.buses.roomSend); }
      const voice = { name, out, tail, send, src: null, end: 0 };
      const bufs = this.cache.get(name);
      if (bufs && bufs.length && !m.live) {
        let vi = Math.floor(r() * bufs.length);
        if (bufs.length > 1 && vi === this._lastVar.get(name)) vi = (vi + 1 + Math.floor(r() * (bufs.length - 1))) % bufs.length;
        this._lastVar.set(name, vi);
        const src = ctx.createBufferSource(); src.buffer = bufs[vi]; src.playbackRate.value = rate;
        src.connect(out); src.start(t);
        voice.src = src; voice.end = t + bufs[vi].duration / rate;
        src.onended = () => this._release(voice);
        this.stats.buffered++;
      } else {
        fn(ctx, out, { ...o, pitch: rate, rng: r, at: t });
        voice.end = t + (m.dur || 2) + 0.1;
        voice.timer = setTimeout(() => this._release(voice), (voice.end - now) * 1000 + 200);
        this.stats.live++;
      }
      this.voices.push(voice);
      this.stats.played++;
      this.stats.byName[name] = (this.stats.byName[name] || 0) + 1;
      return voice;
    } catch (e) { reportError(`audio:${name}`, e); return null; }
  }

  _stop(v) {
    try {
      const t = this.ctx.currentTime;
      v.out.gain.cancelScheduledValues(t); v.out.gain.setValueAtTime(v.out.gain.value, t); v.out.gain.linearRampToValueAtTime(0, t + 0.03);
      if (v.src) v.src.stop(t + 0.04);
    } catch { /* already stopped */ }
    this._release(v, 80);
  }

  _release(v, delayMs = 0) {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    const kill = () => { try { v.out.disconnect(); if (v.tail !== v.out) v.tail.disconnect(); if (v.send) v.send.disconnect(); } catch { /* */ } };
    if (v.timer) clearTimeout(v.timer);
    if (delayMs) setTimeout(kill, delayMs); else kill();
  }

  duck(amount = 0.5, seconds = 0.5) {
    if (!this.running || !this.buses.musicDuck) return;
    duckParam(this.ctx, this.buses.musicDuck.gain, this._duck, amount, seconds);
  }

  /** Screen-space pan for an actor (−1 left … +1 right). */
  /** Per-creature voice name: roar_<typeId> when the bank has one, else the generic roar. */
  creatureRoar(actor) { const n = actor && actor.typeId ? `roar_${actor.typeId}` : ''; return n && this.sounds && this.sounds.has(n) ? n : 'roar'; }
  panFor(actor) {
    const cam = this.game.cameraRig;
    if (!cam || !actor || !actor.pos || !cam.visibleRange) return 0;
    try {
      const r = cam.visibleRange();
      return Math.max(-1, Math.min(1, ((actor.pos.x - r.xMin) / Math.max(1, r.xMax - r.xMin)) * 2 - 1));
    } catch { return 0; }
  }

  /** Output peak (dBFS) over the analyser window — debug meter. */
  peak() {
    const an = this.buses.analyser;
    if (!an) return null;
    const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d);
    let p = 0; for (const x of d) p = Math.max(p, Math.abs(x));
    return p > 0 ? 20 * Math.log10(p) : -120;
  }

  // ------------------------------------------------------------------ event → sound mapping
  voiceOf(a) {
    if (!a) return null;
    if (a.kind === 'hero') return a.typeId in VOICE_IDS ? a.typeId : 'brann';
    const t = a.typeId;
    if (t === 'dummy') return null;
    return t in VOICE_IDS ? t : 'enemy';
  }
  weaponOf(a) {
    if (!a) return 'fist';
    return a.weaponKind || (a.variant && a.variant.weapon) || (a.tier && a.tier.weapon) || (a.def && a.def.weapon) || 'fist';
  }
  /** Per-actor voice cooldown so heroes don't grunt on every hit. */
  vocal(actor, kind, { chance = 1, cool = 0.5, volume = 1, delay = 0 } = {}) {
    const v = this.voiceOf(actor);
    if (!v || !this.running) return;
    if (Math.random() > chance) return;
    const now = this.ctx.currentTime, key = actor.id ?? actor;
    if ((this._cool.get(key) || 0) > now) return;
    this._cool.set(key, now + cool);
    if (this._cool.size > 200) this._cool.clear();
    this.play(`vo_${v}_${kind}`, { volume, delay, pan: this.panFor(actor) * 0.6 });
  }
  surfaceAt(pos) {
    const st = this.game.levels && this.game.levels.stage;
    if (!st) return 'dirt';
    try {
      const au = st.audio || (st.def && st.def.audio);
      if (au && au.surfaceAt && pos) { const s = au.surfaceAt(pos.x, pos.z, pos.y); if (s) return s; }
      if (au && au.surface) return au.surface;
    } catch { /* fall through */ }
    const id = String(st.id || '');
    if (id.includes('stage2')) return 'stone';
    if (id.includes('bonus') || id.includes('camp')) return 'dirt';
    if (id.includes('stage4')) return 'wood';
    return 'dirt';
  }

  _wire() {
    const bus = this.game.bus, P = (a, s = 0.7) => this.panFor(a) * s;
    bus.on(EV.ATTACK_ACTIVE, (e) => {
      const w = WHOOSH[this.weaponOf(e.actor)] || WHOOSH.fist;
      const h = e.hit || {};
      const heavy = h.level === 'heavy' || h.knockdown;
      this.play(heavy ? w[1] : w[0], { pan: P(e.actor), volume: (e.actor && e.actor.kind === 'hero' ? 0.85 : 0.6) * (e.index ? 0.8 : 1), pitch: heavy ? 0.94 : 1 });
    });
    bus.on(EV.ATTACK_START, (e) => {
      const a = e.actor; if (!a) return;
      const big = (e.charge && e.charge > 0) || /heavy|finisher|slam|launcher|throw|dash/.test(String(e.moveId || ''));
      if (a.kind === 'hero') this.vocal(a, big ? 'cry' : 'effort', { chance: big ? 0.8 : 0.3, cool: big ? 1.2 : 0.7, volume: big ? 0.8 : 0.7 });
      else this.vocal(a, 'effort', { chance: 0.25, cool: 1.5, volume: 0.6 });
    });
    bus.on(EV.HIT, (e) => {
      const t = e.target, pan = P(t);
      const w = Math.max(0, Math.min(1, (e.damage || 5) / 24));
      if (e.blocked) { this.play('hit_block', { pan, volume: 0.8 + w * 0.3 }); return; }
      const heavy = e.level === 'heavy' || e.knockdown || (e.damage || 0) >= 14;
      if (e.killed) { this.play('hit_ko', { pan, volume: 1 }); this.duck(0.5, 0.45); }
      else if (e.level === 'magic') this.play('hit_magic', { pan, volume: 0.6 + w * 0.3 });
      else if (e.otg && t && t.fsm && t.fsm.is && t.fsm.is('down')) this.play('hit_otg', { pan, volume: 0.9 });
      else if (heavy) { this.play('hit_heavy', { pan, volume: 0.75 + w * 0.3 }); this.duck(0.25, 0.16); }
      else this.play('hit_light', { pan, volume: 0.6 + w * 0.4 });
      if (e.level !== 'magic' && BLADED.has(this.weaponOf(e.attacker))) this.play('hit_slash', { pan, volume: 0.35 + w * 0.35 });
      if (!e.killed && t) this.vocal(t, 'hurt', { chance: t.kind === 'hero' ? 0.55 : 0.4, cool: 0.6, volume: 0.75, delay: 0.03 });
    });
    bus.on(EV.KO, (e) => {
      const a = e.actor; if (!a) return;
      if (e.ringout || e.cause === 'ringout') { this.play('splash', { pan: P(a), volume: 1, delay: 0.35 }); this.vocal(a, 'death', { cool: 0, volume: 0.9 }); return; }
      this.vocal(a, 'death', { cool: 0, volume: 0.85, delay: 0.05 });
    });
    bus.on(EV.LAND, (e) => {
      const a = e.actor, sp = e.speed || 0;
      if (e.slam) { this.play('land_heavy', { pan: P(a), volume: 1 }); this.play('body_impact', { pan: P(a), volume: 0.8 }); return; }
      if (e.body) { this.play('body_fall', { pan: P(a), volume: e.bounce ? 0.65 : Math.min(1, 0.5 + sp / 16) }); return; }
      if (sp > 11) this.play('land_heavy', { pan: P(a), volume: 0.8 });
      else this.play('land', { pan: P(a), volume: a && a.kind === 'hero' ? 0.6 : 0.4 });
    });
    bus.on(EV.JUMP, (e) => { this.play('jump', { pan: P(e.actor), volume: 0.6 }); if (e.actor && e.actor.kind === 'hero') this.vocal(e.actor, 'effort', { chance: 0.2, cool: 1.5, volume: 0.5 }); });
    bus.on(EV.FOOTSTEP, (e) => {
      const a = e.actor, hero = a && a.kind === 'hero';
      this.play(`step_${this.surfaceAt(e.pos || (a && a.pos))}`, { pan: P(a, 0.5), volume: hero ? 0.55 : 0.32 });
    });
    bus.on(EV.DODGE, (e) => {
      if (e.perfect) { this.play('dodge_perfect', { pan: P(e.actor, 0.3), volume: 1 }); this.duck(0.7, 0.7); }
      else this.play('dodge', { pan: P(e.actor), volume: 0.7 });
    });
    bus.on(EV.GRAB, (e) => { this.play('grab', { pan: P(e.actor), volume: 0.8 }); this.vocal(e.victim, 'hurt', { chance: 0.6, volume: 0.6 }); });
    bus.on(EV.THROW, (e) => { this.play('throw', { pan: P(e.actor), volume: 0.9 }); this.vocal(e.actor, 'cry', { chance: 0.7, cool: 1, volume: 0.8 }); });
    bus.on(EV.CHARGE, (e) => { if (e.level) this.play('charge', { pitch: Math.pow(2, (e.level - 1) * 4 / 12), volume: 0.5 + e.level * 0.12, pan: P(e.actor, 0.5) }); });
    bus.on(EV.POT_PICKUP, (e) => {
      if (e.kind === 'food') { this.play('pickup_food', { volume: 0.9 }); return; }
      const n = Math.max(1, (e.hero && e.hero.pots) || 1);
      this.play('pickup_pot', { pitch: Math.pow(2, POT_STEPS[Math.min(POT_STEPS.length - 1, n - 1)] / 12) });
    });
    bus.on(EV.MAGIC_CAST, (e) => {
      const h = e.hero, el = (h && h.def && h.def.magic && h.def.magic.element) || 'fire', tier = e.tier || 1;
      this.play('magic_rise', { volume: 0.7 });
      this.play(`magic_${el}`, { tier, volume: 0.85 + Math.min(0.15, tier * 0.03) });
      this.vocal(h, 'cry', { cool: 0, volume: 0.9 });
      this.duck(0.7, 1.4 + tier * 0.45);
    });
    bus.on(EV.MAGIC_IMPACT, (e) => {
      const h = e.hero, el = (h && h.def && h.def.magic && h.def.magic.element) || 'fire';
      this.play(`impact_${el}`, { tier: e.tier || 1, volume: 0.9 });
      this.duck(0.5, 0.4);
    });
    bus.on(EV.SCREEN_LOCK, () => { this.play('lock', { volume: 0.8 }); this.music.bump(1); });
    bus.on(EV.GO, () => this.play('go', { volume: 0.8 }));
    bus.on(EV.PLAYER_JOIN, () => this.play('ui_coin'));
    bus.on(EV.PLAYER_DOWN, (e) => { this.play('player_down', { volume: 0.85 }); this.vocal(e.hero, 'death', { cool: 0, volume: 0.9 }); this.duck(0.6, 1.2); });
    bus.on(EV.CONTINUE_TICK, () => this.play('ui_tick'));
    bus.on(EV.CONTINUE_TAKEN, () => this.play('ui_coin'));
    bus.on(EV.BOSS_INTRO, (e) => { this.play(this.creatureRoar(e && e.boss), { volume: 1 }); this.play('boss_stinger', { volume: 0.7, delay: 0.2 }); this.duck(0.8, 1.5); this.music.setBoss(true); });
    // Bizarrians: each beast has its own voice (roar_<typeId>); a steal/mount gets a call, a knock-off a sharper yelp.
    if (EV.MOUNT) bus.on(EV.MOUNT, (e) => { if (e.mount) this.play(this.creatureRoar(e.mount), { pan: P(e.mount), volume: 0.75 }); });
    if (EV.DISMOUNT) bus.on(EV.DISMOUNT, (e) => { if (e.knocked && e.mount) this.play(this.creatureRoar(e.mount), { pan: P(e.mount), volume: 0.6, pitch: 1.18 }); });
    bus.on(EV.BOSS_PHASE, () => { this.play('boss_stinger', { volume: 0.8 }); this.music.bump(2); });
    bus.on(EV.SPAWN, (e) => {
      const a = e.actor;
      if (a && a.kind === 'mount') this.play(this.creatureRoar(a), { pan: P(a), volume: 0.8, delay: 0.3 });
      if (a && a.typeId === 'thief' && Math.random() < 0.8) this.play('thief_cackle', { pan: P(a), volume: 0.8, delay: 0.25 });
    });
    bus.on(EV.COMBO, (e) => this.music.combo(e.count || 0));
    bus.on(EV.STAGE_START, (e) => this.music.forStage(e.stageId));
    bus.on(EV.STAGE_CLEAR, () => { this.music.setBoss(false); this.music.play('clear'); });
    bus.on(EV.GAME_OVER, () => this.music.play('gameover'));
    bus.on(EV.FLOW_STATE, (e) => this.music.forFlow(e.to, e.data));
  }

  update() {
    if (!this.ctx) {
      // Gamepad input is not a DOM gesture: try to unlock once a pad button is down (works where autoplay allows).
      if (this.enabled && navigator.getGamepads && (this._padPoll = (this._padPoll || 0) + 1) % 20 === 0) {
        try { for (const p of navigator.getGamepads()) if (p && p.buttons.some((b) => b.pressed)) { this.unlock(); break; } } catch { /* */ }
      }
      return;
    }
    // Zero cost when muted: suspend the context entirely; resume when the master slider comes back up.
    try {
      if (this.muted && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
      else if (!this.muted && this.ctx.state === 'suspended' && this._wasMuted) { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
      this._wasMuted = this.muted;
    } catch { /* */ }
    if (this.running) {
      this.music.update();
      // Paused (Flow.pause freezes the sim): hold the music dipped until resume.
      const fl = this.game.flow;
      if (fl && fl.paused && (this._pauseTick = (this._pauseTick || 0) + 1) % 10 === 0) this.duck(0.55, 0.4);
    }
  }
}

/** meta.norm = gain that brings the loudest rendered variant to the sound's target peak (levels.js). */
function setNorm(name, m, bufs) {
  let p = 0;
  for (const b of bufs) { const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) { const x = d[i] < 0 ? -d[i] : d[i]; if (x > p) p = x; } }
  if (p > 1e-5) m.norm = Math.min(8, Math.pow(10, targetDb(name) / 20) / p);
}

const VOICE_IDS = { brann: 1, gorrim: 1, seraphine: 1, thief: 1, marauder: 1, enemy: 1 };

/** Drop trailing near-silence (< −70 dBFS) from a rendered buffer to save memory. */
function trim(buf) {
  const d = buf.getChannelData(0);
  let n = d.length - 1;
  while (n > 0 && Math.abs(d[n]) < 3e-4) n--;
  n = Math.min(d.length, n + Math.ceil(buf.sampleRate * 0.01));
  if (n >= d.length - 64) return buf;
  const out = new AudioBuffer({ length: Math.max(1, n), numberOfChannels: 1, sampleRate: buf.sampleRate });
  out.copyToChannel(d.subarray(0, n), 0);
  return out;
}
