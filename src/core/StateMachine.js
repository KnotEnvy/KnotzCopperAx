// Minimal hierarchical-friendly state machine used by every actor.
//
// States are plain objects keyed by name:
//   { enter?(actor, data, prevName), update?(actor, dt) → optional next state name, exit?(actor, nextName),
//     tags?: ['busy','air','hittable', ...] }
// fsm.time / fsm.ticks = time in the current state. go(name, data) switches immediately (enter runs now).
import { reportError } from './log.js';

export class StateMachine {
  constructor(owner, states = {}) {
    this.owner = owner;
    this.states = states;
    this.name = null;
    this.state = null;
    this.prevName = null;
    this.ticks = 0;
    this.time = 0;
    this.data = null;
  }

  /** Add or replace states (subclasses and specialists extend actors this way). */
  define(states) { Object.assign(this.states, states); return this; }

  has(name) { return !!this.states[name]; }
  is(...names) { return names.includes(this.name); }
  tagged(tag) { return !!(this.state && this.state.tags && this.state.tags.includes(tag)); }

  go(name, data = null) {
    const next = this.states[name];
    if (!next) { reportError('fsm', new Error(`${this.owner && this.owner.kind}#${this.owner && this.owner.id}: unknown state '${name}'`)); return false; }
    const prev = this.name;
    try { if (this.state && this.state.exit) this.state.exit(this.owner, name); } catch (e) { reportError(`fsm:${prev}.exit`, e); }
    this.prevName = prev;
    this.name = name;
    this.state = next;
    this.ticks = 0;
    this.time = 0;
    this.data = data;
    try { if (next.enter) next.enter(this.owner, data, prev); } catch (e) { reportError(`fsm:${name}.enter`, e); }
    return true;
  }

  update(dt) {
    if (!this.state) return;
    let nxt;
    try { nxt = this.state.update ? this.state.update(this.owner, dt) : undefined; } catch (e) { reportError(`fsm:${this.name}.update`, e); }
    this.ticks++;
    this.time += dt;
    if (typeof nxt === 'string' && nxt !== this.name) this.go(nxt);
  }
}
