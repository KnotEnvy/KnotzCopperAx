// ClipLibrary: loads every clip set in src/anim/clips/*.js (auto-discovered) and bakes clips per rig on demand.
//
// Clip set module (default export):
//   { rig: 'humanoid', character?: 'brann' | ['brann','gorrim'], priority?: 0, clips: { name: ClipDef } }
// Lookup order for (name, character): character-specific sets (highest priority first), then generic sets.
// Baked clips are cached per rig instance key (asset) + set + name.
import { registries } from '../core/registries.js';
import { bakeClip, resolveMirror } from './clipBaker.js';
import { profileFor } from './profiles.js';
import { reportError } from '../core/log.js';

export class ClipLibrary {
  constructor() {
    this.sets = [];
    this.baked = new Map();
    this.loaded = false;
  }

  async load() {
    const all = await registries.clips.loadAll();
    this.sets = [...all.entries()].map(([id, s]) => ({ id, rig: s.rig || 'humanoid', character: s.character ? [].concat(s.character) : null, priority: s.priority || 0, clips: s.clips || {} }));
    this.sets.sort((a, b) => b.priority - a.priority);
    this.loaded = true;
    return this;
  }

  /** Re-read one set (HMR-friendly hook for animation authoring tools). */
  _setsFor(rig, character) {
    const spec = this.sets.filter((s) => s.rig === rig && s.character && character && s.character.includes(character));
    const gen = this.sets.filter((s) => s.rig === rig && !s.character);
    return [...spec, ...gen];
  }

  /** Raw ClipDef (mirror resolved) or null. */
  def(name, { rig = 'humanoid', character = null } = {}) {
    for (const s of this._setsFor(rig, character)) {
      const d = s.clips[name];
      if (d) return { set: s.id, def: resolveMirror(d, (n) => this.def(n, { rig, character })?.def) };
    }
    return null;
  }

  has(name, opts) { return !!this.def(name, opts); }

  names({ rig = 'humanoid', character = null } = {}) {
    const out = new Set();
    for (const s of this._setsFor(rig, character)) for (const n in s.clips) out.add(n);
    return [...out].sort();
  }

  /** Baked THREE.AnimationClip for a RigInfo (cached). */
  clip(name, rigInfo, { rig = 'humanoid', character = null, profile = null } = {}) {
    const found = this.def(name, { rig, character });
    if (!found) return null;
    const key = `${rigInfo.key}|${character || ''}|${found.set}|${name}`;
    let c = this.baked.get(key);
    if (!c) {
      try { c = bakeClip(name, found.def, rigInfo, profile || profileFor(character)); } catch (e) { reportError(`clip:${name}`, e); return null; }
      c.userData.def = found.def;
      this.baked.set(key, c);
    }
    return c;
  }
}
