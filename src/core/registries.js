// Every auto-discovered content folder in the game. Add content by DROPPING A FILE into one of these
// folders — never edit a shared index. Files whose name starts with '_' are ignored (private helpers).
//
// Module contract per folder (default export) is documented in docs/ENGINE_API.md.
import { Registry } from './safeImport.js';

// NOTE: import.meta.glob needs literal strings, so each registry is spelled out here.
export const registries = {
  /** src/characters/heroes/<id>.js → hero definition { id, name, asset, proportions, stats, magic, ... } */
  heroes: new Registry('heroes', import.meta.glob('../characters/heroes/*.js')),
  /** src/characters/movesets/<id>.js → { id, moves: { moveId: MoveDef } } (frame data in 60 Hz ticks) */
  movesets: new Registry('movesets', import.meta.glob('../characters/movesets/*.js')),
  /** src/enemies/types/<id>.js → enemy type { id, name, hp, ..., create?(game, opts) } */
  enemies: new Registry('enemies', import.meta.glob('../enemies/types/*.js')),
  /** src/ai/behaviours/<id>.js → behaviour factory { id, create(actor, game) → { update(dt) } } */
  behaviours: new Registry('behaviours', import.meta.glob('../ai/behaviours/*.js')),
  /** src/levels/stages/<id>.js → stage module { id, name, zBand, lighting, build(ctx), screens, ... } */
  stages: new Registry('stages', import.meta.glob('../levels/stages/*.js')),
  /** src/levels/props/<id>.js → prop type { id, create(ctx, opts) } */
  props: new Registry('props', import.meta.glob('../levels/props/*.js')),
  /** src/magic/spells/<id>.js → spell book { id, element, maxTier, cast(ctx, hero, tier) } */
  spells: new Registry('spells', import.meta.glob('../magic/spells/*.js')),
  /** src/vfx/effects/<id>.js → effect { id, preload?(vfx), spawn(vfx, opts) } */
  effects: new Registry('effects', import.meta.glob('../vfx/effects/*.js')),
  /** src/mounts/types/<id>.js → mount type { id, name, create(game, opts) } */
  mounts: new Registry('mounts', import.meta.glob('../mounts/types/*.js')),
  /** src/anim/clips/<id>.js → clip set { rig, character?, priority?, clips: { name: ClipDef } } */
  clips: new Registry('clips', import.meta.glob('../anim/clips/*.js')),
  /** src/ui/screens/<id>.js → screen { id, create(ui, opts) → { el, update?(dt), dispose?() } } */
  screens: new Registry('screens', import.meta.glob('../ui/screens/*.js')),
  /** src/showcase/kinds/<what>.js → showcase kind { id, setup(ctx) } */
  showcase: new Registry('showcase', import.meta.glob('../showcase/kinds/*.js')),
  /** src/audio/banks/<id>.js → SFX bank { id, sounds: { name: (ctx, out, opts) => void } } */
  sfx: new Registry('sfx', import.meta.glob('../audio/banks/*.js')),
  /** src/audio/music/<id>.js → music cue { id, start(engine, opts) → { stop() } } */
  music: new Registry('music', import.meta.glob('../audio/music/*.js')),
  /** src/game/pickups/<id>.js → pickup kind { id, build(ctx), onCollect(game, hero, pickup) } */
  pickups: new Registry('pickups', import.meta.glob('../game/pickups/*.js')),
  /** src/enemies/bosses/<id>.js → boss { id, name, create(game, opts) → Actor } (boss agents drop files here) */
  bosses: new Registry('bosses', import.meta.glob('../enemies/bosses/*.js')),
};
