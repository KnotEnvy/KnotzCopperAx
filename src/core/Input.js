// Input: keyboard (P1/P2 maps) + Gamepad API + virtual devices, sampled once per 60 Hz sim tick.
//
// Every source (keyboard, gamepad, AI bot, test hook) is a *device* that writes action states into a
// PlayerInput during sampling, so bots/tests go through EXACTLY the same path as humans (buffers,
// double-tap run, edges). Gameplay code only ever reads PlayerInput:
//   in.isDown('light') · in.pressed('jump') (edge this tick) · in.consume('light') (8-tick buffer)
//   in.moveX() / in.moveZ() (−1..1; up = far = −Z) · in.runDir (±1 after a double-tap, 0 otherwise)
import { TICK_HZ } from './config.js';

export const ACTIONS = ['left', 'right', 'up', 'down', 'light', 'heavy', 'jump', 'magic', 'dodge', 'start'];
export const BUFFER_TICKS = 8;
export const DOUBLE_TAP_TICKS = 14;

/** Keyboard maps per docs/DESIGN.md §3 (KeyboardEvent.code → action). */
export const KEYMAPS = {
  kb1: { KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down', KeyJ: 'light', KeyK: 'heavy', KeyL: 'jump', Space: 'jump', KeyI: 'magic', KeyU: 'dodge', Enter: 'start', Escape: 'start' },
  kb2: { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Numpad1: 'light', Numpad2: 'heavy', Numpad3: 'jump', Numpad5: 'magic', Numpad0: 'dodge', NumpadEnter: 'start' },
};
/** Standard-mapping gamepad buttons → action. */
export const PADMAP = { 2: 'light', 3: 'heavy', 0: 'jump', 1: 'dodge', 5: 'magic', 4: 'dodge', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

// ---------------------------------------------------------------- devices
const keysDown = new Set();
let keyboardAttached = false;
function attachKeyboard() {
  if (keyboardAttached || typeof window === 'undefined') return;
  keyboardAttached = true;
  const block = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    keysDown.add(e.code);
    if (block.has(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keysDown.delete(e.code));
  window.addEventListener('blur', () => keysDown.clear());
}

export class KeyboardDevice {
  constructor(id, map) { this.id = id; this.kind = 'keyboard'; this.map = map; attachKeyboard(); }
  sample(out) {
    for (const code in this.map) if (keysDown.has(code)) out[this.map[code]] = true;
  }
  active() { for (const code in this.map) if (keysDown.has(code)) return true; return false; }
}

export class GamepadDevice {
  constructor(index) { this.id = 'pad' + index; this.kind = 'gamepad'; this.index = index; this.deadzone = 0.35; this.axes = { x: 0, z: 0 }; }
  pad() { const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []; return pads && pads[this.index]; }
  sample(out, analog) {
    const p = this.pad();
    if (!p || !p.connected) return;
    for (const b in PADMAP) { const btn = p.buttons[b]; if (btn && (btn.pressed || btn.value > 0.5)) out[PADMAP[b]] = true; }
    const ax = p.axes[0] || 0, az = p.axes[1] || 0;
    const mag = Math.hypot(ax, az);
    if (mag > this.deadzone) {
      // 8-way digitize with a generous diagonal zone; also expose the analog vector.
      const ang = Math.atan2(az, ax);
      const oct = Math.round(ang / (Math.PI / 4));
      const dx = Math.round(Math.cos(oct * Math.PI / 4)), dz = Math.round(Math.sin(oct * Math.PI / 4));
      if (dx < 0) out.left = true; if (dx > 0) out.right = true;
      if (dz < 0) out.up = true; if (dz > 0) out.down = true;
      if (analog) { analog.x = ax; analog.z = az; analog.set = true; }
    }
  }
  active() { const p = this.pad(); if (!p) return false; return p.buttons.some((b) => b.pressed) || Math.hypot(p.axes[0] || 0, p.axes[1] || 0) > this.deadzone; }
}

/**
 * Virtual device: bots and test hooks drive players through this.
 *   press(action, ticks)  hold action down for N sim ticks, then release (registers one press edge)
 *   hold(action, down)    latch until released
 */
export class VirtualDevice {
  constructor(id) { this.id = id; this.kind = 'virtual'; this.held = new Set(); this.timed = new Map(); this.analog = null; }
  press(action, ticks = 5) {
    // If already down from a previous timed press, force a release tick first so a new edge is seen.
    if (this.timed.has(action)) { this.timed.set(action, -1); this._queued = this._queued || []; this._queued.push([action, ticks]); return; }
    this.timed.set(action, Math.max(1, ticks | 0));
  }
  hold(action, down = true) { if (down) this.held.add(action); else this.held.delete(action); }
  releaseAll() { this.held.clear(); this.timed.clear(); this._queued = null; }
  sample(out) {
    for (const a of this.held) out[a] = true;
    for (const [a, t] of this.timed) if (t > 0) out[a] = true;
  }
  /** advance timers (called once per tick after sampling) */
  tick() {
    for (const [a, t] of this.timed) {
      if (t <= 1) this.timed.delete(a); else this.timed.set(a, t - 1);
    }
    if (this._queued && this._queued.length) {
      for (const [a, t] of this._queued.splice(0)) if (!this.timed.has(a)) this.timed.set(a, t);
    }
  }
  active() { return this.held.size > 0 || this.timed.size > 0; }
}

// ---------------------------------------------------------------- per-player state
export class PlayerInput {
  constructor(index) {
    this.index = index;
    /** @type {Array<KeyboardDevice|GamepadDevice|VirtualDevice>} */
    this.devices = [];
    this.virtual = new VirtualDevice('virtual' + index);
    this.enabled = true;
    this.down = {}; this.prev = {};
    this.pressTick = {}; this.consumedTick = {};
    for (const a of ACTIONS) { this.down[a] = false; this.prev[a] = false; this.pressTick[a] = -9999; this.consumedTick[a] = -9999; }
    this.analog = { x: 0, z: 0, set: false };
    this.tick = 0;
    this.runDir = 0;
    this._lastTapDir = 0; this._lastTapTick = -9999;
  }

  update(tick) {
    this.tick = tick;
    const cur = {};
    this.analog.set = false;
    if (this.enabled) {
      for (const d of this.devices) d.sample(cur, this.analog);
      this.virtual.sample(cur);
    }
    this.virtual.tick();
    for (const a of ACTIONS) {
      this.prev[a] = this.down[a];
      this.down[a] = !!cur[a];
      if (this.down[a] && !this.prev[a]) this.pressTick[a] = tick;
    }
    // Opposite directions cancel.
    if (this.down.left && this.down.right) { this.down.left = this.down.right = false; }
    if (this.down.up && this.down.down) { this.down.up = this.down.down = false; }
    // Double-tap run detection on left/right press edges.
    for (const [a, dir] of [['left', -1], ['right', 1]]) {
      if (this.pressTick[a] === tick) {
        if (this._lastTapDir === dir && tick - this._lastTapTick <= DOUBLE_TAP_TICKS) this.runDir = dir;
        this._lastTapDir = dir; this._lastTapTick = tick;
      }
    }
    if (this.runDir === -1 && !this.down.left) this.runDir = 0;
    if (this.runDir === 1 && !this.down.right) this.runDir = 0;
  }

  isDown(a) { return this.down[a]; }
  /** Press edge on this exact tick. */
  pressed(a) { return this.pressTick[a] === this.tick; }
  released(a) { return !this.down[a] && this.prev[a]; }
  /** Pressed within the buffer window and not yet consumed. */
  buffered(a, window = BUFFER_TICKS) {
    const t = this.pressTick[a];
    return this.tick - t <= window && this.consumedTick[a] < t;
  }
  /** Take a buffered press (returns true once per physical press). */
  consume(a, window = BUFFER_TICKS) {
    if (!this.buffered(a, window)) return false;
    this.consumedTick[a] = this.pressTick[a];
    return true;
  }
  /** Ticks the action has been held (0 if up). */
  heldTicks(a) { return this.down[a] ? this.tick - this.pressTick[a] + 1 : 0; }
  clearBuffer() { for (const a of ACTIONS) this.consumedTick[a] = this.pressTick[a]; }
  moveX() { return (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0); }
  /** −1 = up (far, −Z), +1 = down (near, +Z). */
  moveZ() { return (this.down.down ? 1 : 0) - (this.down.up ? 1 : 0); }
  anyPressed(list = ['light', 'jump', 'start', 'heavy', 'magic']) { return list.some((a) => this.pressed(a)); }
}

// ---------------------------------------------------------------- manager
export class InputManager {
  constructor() {
    this.devices = new Map();
    this.devices.set('kb1', new KeyboardDevice('kb1', KEYMAPS.kb1));
    this.devices.set('kb2', new KeyboardDevice('kb2', KEYMAPS.kb2));
    for (let i = 0; i < 4; i++) this.devices.set('pad' + i, new GamepadDevice(i));
    this.players = [new PlayerInput(0), new PlayerInput(1)];
    this.assign(0, ['kb1', 'pad0']);
    this.assign(1, ['kb2', 'pad1']);
    this.tick = 0;
  }

  /** Per-player device assignment (e.g. assign(1, ['pad0']) gives the first pad to P2). */
  assign(playerIndex, deviceIds) {
    this.players[playerIndex].devices = deviceIds.map((id) => this.devices.get(id)).filter(Boolean);
  }

  /** Player 1-based numbering for hooks: 1|'p1'|0 → P1, 2|'p2' → P2. */
  player(p) {
    if (p === 2 || p === '2' || p === 'p2' || p === 'P2') return this.players[1];
    return this.players[0];
  }

  /** The virtual device of a player (bots write here). */
  virtual(p) { return this.player(p).virtual; }

  /** Test-hook press: hold `action` for `ms` of SIM time (converted to ticks). */
  press(p, action, ms = 80) { this.virtual(p).press(action, Math.max(1, Math.round((ms / 1000) * TICK_HZ))); }
  hold(p, action, down = true) { this.virtual(p).hold(action, down); }
  releaseAll() { for (const pl of this.players) pl.virtual.releaseAll(); }

  update(tick) {
    this.tick = tick;
    for (const p of this.players) p.update(tick);
  }

  /** Which physical device is currently active (for drop-in join on select screens). */
  activeDevices() { return [...this.devices.values()].filter((d) => d.active && d.active()).map((d) => d.id); }
}
