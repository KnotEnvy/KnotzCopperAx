# KnotzCopperAx — Engine API (how-to for specialists)

Read `docs/ARCHITECTURE.md` §0 (concurrency rules) and §9 (ownership) first. This file is the practical guide: every recipe below adds a feature **by dropping a file into a folder**. No shared index needs editing. Code references are the source of truth; each file has a header comment with its API.

- [0. Orientation](#0-orientation)
- [1. Time, systems, events](#1-time-systems-events)
- [2. Actors, world, input](#2-actors-world-input)
- [3. Add an enemy type (+ AI behaviour)](#3-add-an-enemy-type--ai-behaviour)
- [4. Add a stage](#4-add-a-stage)
- [5. Add a spell](#5-add-a-spell)
- [6. Author a clip (axis convention, worked example)](#6-author-a-clip)
- [7. Movesets: frame-data format](#7-movesets-frame-data-format)
- [8. Add a VFX effect](#8-add-a-vfx-effect)
- [9. Add a UI screen](#9-add-a-ui-screen)
- [10. Add a showcase kind](#10-add-a-showcase-kind)
- [11. Audio, mounts, pickups, bosses](#11-audio-mounts-pickups-bosses)
- [12. Assets, rendering, camera](#12-assets-rendering-camera)
- [13. `__KCA` in scenarios](#13-__kca-in-scenarios)
- [14. Rules of thumb](#14-rules-of-thumb)

---

## 0. Orientation

```
index.html → src/main.js      installs window.__KCA, builds Game, lazy-loads every service with safeImport,
                              routes ?mode=title|stage|showcase, compiles shaders, resolves __KCA.ready
src/core/                     Game (clock), Input, EventBus (EV), World, Actor, StateMachine, RNG, registries,
                              safeImport, services (null stubs), testhooks, debugDraw, config (params, QUALITY)
```

- **Units** are metres, **Y is up**, and the stage scrolls toward **+X**. Depth is **Z** (+Z toward the camera). Actors face `±1` along X.
- **Tick** = 1/60 s. All gameplay timing (frame data, hitstun, timers) is in ticks.
- **Isolation.** If your module throws while importing or constructing, main.js logs it and installs a null service (`src/core/services.js`). Your crash then shows up as a missing feature, not a dead game. **Always read `pageErrors`, `consoleErrors` and `info().errors`** in captures.
- **Dev URLs** (full list in ARCHITECTURE §5): `/?mode=stage&stage=1&p1=brann&bot=1` (bots start with 3 magic pots unless `&pots=N` is given; `&pots=0` = none), `/?mode=showcase&what=hero&id=gorrim&anim=walk`, `&debug=1` draws hitboxes and shows error toasts, `&quality=low`.

## 1. Time, systems, events

```js
game.tick / game.time                 sim ticks / seconds (freeze during global hitstop)
game.hitstop(ticks)                   global freeze of every `freezable` system (camera, vfx, ui, audio keep running)
actor.hitstop = n                     per-actor freeze (CombatSystem sets it on attacker + victim)
game.slowmo(scale, holdSeconds, { inTime, out })   timeScale ramp (perfect dodge, final blow, magic)
game.after(ticks, fn) → cancel        sim-clock timer;  await game.wait(ticks)  (the manual clock runs the continuation
                                      before the next tick, exactly like live play, so async choreography is deterministic)
game.track(promise)                   make __KCA.advance() wait for an async load (spawns, lazy effects)
game.addSystem({ name, order, update(dt), render?(alpha, frameDt), frozenUpdate?(dt), freezable?, dispose? })
game.rng (gameplay, seeded by &seed)  game.fxRng (cosmetic only)
```

**Events.** The catalogue with payload shapes lives in `src/core/EventBus.js` (`EV`).

```js
import { EV } from '../core/EventBus.js';
const scope = game.bus.scope();                 // ALWAYS scope listeners you own…
scope.on(EV.HIT, (ev) => { /* ev.attacker, ev.target, ev.damage, ev.point, ev.level, ev.killed, ev.hit (window) */ });
scope.on(EV.KO, ({ actor, by }) => {});
scope.dispose();                                // …and dispose them with your stage/showcase/system
game.bus.emit('mounts:riderOff', { rider });    // your own events: namespace them
```

Listener exceptions are caught and reported. A broken sound hook can't break combat.

Every emit is also recorded (`bus.recent`, read with `__KCA.events(type, sinceTick)`). An event's `tick` is the value `game.tick` has once the step that emitted it finishes (`game.tick + 1` while a step runs, or the upcoming tick between steps). So `const t = game.tick; …; __KCA.events('jump', t)` returns everything emitted after `t` was read, including the very next stepped tick.

## 2. Actors, world, input

`Actor` (src/core/Actor.js) holds belt-plane physics: `pos` (y is height above the ground), `vel`, `facing`, `grounded`, gravity, `hp`, `team` (`'players'|'enemies'|'neutral'`), `tags`, `hurtboxes()`, a `fsm` (StateMachine), a contact shadow, and a view hierarchy: `actor.view` (positioned, not rotated) → `actor.body` (yawed to facing with a slight camera cheat) → the model. `Combatant` (src/combat/Combatant.js) adds a model and Animator, move execution (`startMove(id)`), hit flash, and the shared reaction states `hitstun, knockdown, down, getup, dead`. `Hero` and `Enemy` extend it.

```js
game.world.add(actor) / actor.remove()
game.world.query({ team, notTeam, kind, tag, alive = true, near: { x, z, r }, filter }) → Actor[]
game.world.nearest(actor, opts) · world.sorted() (far → near) · world.band { zMin, zMax } · world.extents · world.screen
actor.fsm.define({ myState: { enter(a, data, prev), update(a, dt) → nextName?, exit(a, next), tags: ['busy'] } }); actor.fsm.go('myState', data)
```

**Input.** Every device (keyboard P1/P2, gamepads, bots, test hooks) writes into the same `PlayerInput`:

```js
const inp = game.input.players[0];
inp.isDown('light') · inp.pressed('jump') (edge this tick) · inp.consume('light') (8-tick buffer) · inp.heldTicks('heavy')
inp.moveX() / inp.moveZ() (−1..1, up = far = −Z) · inp.runDir (±1 after a double-tap)
game.input.assign(1, ['pad0'])          per-player device assignment
game.input.virtual(1).press('light', ticks) / .hold('right', true)   bots and scripts
```

## 3. Add an enemy type (+ AI behaviour)

Create `src/enemies/types/viper.js`:

```js
export default {
  id: 'viper', name: 'Viper Maiden', asset: 'enemy_viper',    // /assets/models/enemy_viper.glb when it exists
  height: 1.78, hp: 30, speed: 3.0, radius: 0.33, weight: 0.85,
  weapon: 'spear',                                            // placeholder weapon kind until a GLB exists
  proportions: { shoulderW: 0.19, hipR: [0.16, 0.12] },       // placeholder rig (assets/placeholderRig.js)
  palette: { skin: '#c89a78', cloth: '#2a4a3a' }, style: { hair: 'braid', armor: 'scale' },
  behaviour: 'grunt', ai: { spacing: 3.0, attackRange: 1.6, aggression: 0.7 },   // src/ai/behaviours/<id>.js
  moves: {                                                    // same MoveDef format as hero movesets (§7)
    thrust: { anim: 'light_1', startup: 10, active: 4, recovery: 18,
      hits: [{ box: { x: 1.3, y: 0.7, w: 1.6, h: 0.6, d: 0.7 }, damage: 4, hitstun: 18, knockback: 2 }] },
  },
  tiers: { violet: { hp: 44, palette: { cloth: '#553070' } } },
  score: { hit: 10, ko: 250 },
  // create?(game, opts, { Enemy, def }) → Actor   for fully custom classes (bosses, ogres)
};
```

Spawn it from a stage wave (`{ type: 'viper', side: 'right', z: 0.5 }`) or with `__KCA.debug.spawn('viper', 4, 0)`. See it at `/?mode=showcase&what=enemy&id=viper`.

**Behaviour** `src/ai/behaviours/<id>.js`: `{ id, create(enemy, game, params) → { update(dt) } }`. `update` only runs while the enemy is controllable (idle or walk, not stunned). Use `enemy.moveTo(x, z, speedScale)`, `enemy.stopMoving()`, `enemy.attackWith(moveId, target)`, `enemy.faceToward(t)`, and `game.ai.tokens.request(enemy, target)` / `.release(enemy)` (the attack-token director allows at most 2 attackers per player on normal and hands a token back as soon as its holder is stunned). Crowd directors go in `game.ai.directors.push({ update(dt, game) })`.

The stock `grunt` behaviour (params `spacing, attackRange, reaction, aggression, cooldown: [min, max], depthTol, rush`) approaches on its own side of the target (a second token holder flanks to the far side). It swings on a cooldown of `cooldown × (1.3 − aggression)` ticks, swings again soon after it recovers from hitstun or a get-up, and punishes a hero recovering from a move that missed.

**Enemy AI kit (enemies-ai, wave B).** Behaviours `grunt, thief, skeleton, knight, ogre, viper` are built on `meleeBrain(e, game, params, hooks)` in `src/ai/_kit.js` (hooks: `choose`, `special`, `canAttack`, `guard`, `preHit`, `onHit`, `react`, `onAttackTick`, `onDeath`). `game.ai.director` (`src/ai/CrowdDirector.js`) does co-op target splitting, surround slots on both sides and in depth, combo-pressure aggression (+1 token under pressure), thrown-ally dodge/brace, the retreat budget, anti-stunlock (`stunLimit`: after N hits without control the next hit floors the foe, which rises with light-hit armour) and difficulty (`DIFFICULTY` easy/normal/hard). Enemy-only MoveDef fields: `chain: { into, at, hit, chance }` (strings), `grab: { from, to, reach }` (→ enemy `clinch` + toss, `def.grab`), `shockwave: { at, radius, x, hit }` (grounded heroes only), `unblockable`, `telegraph`, `teleLead`, `whiffPause`, hit `dismount: true` (knocks a rider off). Type fields: `reassemble: { ticks, hp, max }`, `passive`, `canRun`, `canRide`, `cannotDodge`, `canRetreat`, `stunBonus`, `armorDamage`, `chip`, `damageMul`; spawn opts `elite: 1..4` (Sgt. Tarnish → Gen. Oxide name tag), `rise: true`, `group` (Brute Brothers), `steal: n` / `sack: n` (thieves). Events for VFX/audio: `ai:telegraph { actor, moveId, kind: normal|heavy|unblockable|grab, pos, activeIn }`, `ai:rise { actor, pos, phase: start|burst|done }`, `ai:crumble`, `ai:reassemble`, `ai:shatter`, `ai:block`, `ai:guardBreak`, `ai:breakout`, `ai:armor`, `ai:shockwave`, `ai:react`, `ai:feint`, `ai:taunt`, `ai:evade`, `ai:enrage`, `ai:thiefSpill`, `ai:steal`, `ai:escape`, `ai:handover { actor, to }`. Screen-x lanes (r5): waiting foes get a concrete per-flank distance `e.aiSlot.x` (distinct x lanes ≥ 1 m apart across both heroes' crowds, clamped into view), the director exposes `laneFree(e, x, z)`, `frontFoe(e, t)`, `reeling(e, x, z)`, and `e.aiCrossing` is true while a foe runs round a hero; `tools/scenarios/ai_spacing.mjs` reports `pairX08`/`pairX06`/`heroX06` on contact frames. Depth rows (r8): slots carry `row` `m` (the hero's own row: strikers) / `a` / `b` (two waiting rows at the band's front and back edges — `director.rows(hero)`, ≥ 2 m from the hero row and ~4.5 m apart in stage 1; both on the roomy side when the hero hugs an edge), `e.aiSlot = { side, row, ring, x, dz, z }` (`z` = absolute row z), so a crowd stands in three screen bands; `tools/scenarios/ai_depth.mjs` reports the feet-row spread in px (`spreadPx`, `oneRow`, `rows`). Arrivals (r7/r8): the first foe of a wave is the vanguard, the second a "wing" (rushes in from the opposite edge when a token is free); both close on a downed hero and swing the moment he can act. Scenarios: `/?mode=showcase&what=ai&id=thief|camp|marauder|skeleton|knight|ogre|viper|crowd|coop|tokens|duel`; balance metrics with `tools/scenarios/ai_balance.mjs`. Details: `docs/notes/enemies-ai.md`. Enemy defaults: `downTicks` 34, `getupTicks` 24 and `getupInvuln` 20 (heroes 44/30/24), and the walk-in from off-screen runs at `def.enterSpeed` (1.35) × speed.

## 4. Add a stage

`src/levels/stages/<id>.js` (URL `stage=<id>`; numeric `stage=2` maps to `stage2`):

```js
export default {
  id: 'stage2', number: 2, name: 'Shellback Crossing', subtitle: 'STAGE 2',
  zBand: [-2.4, 2.4], extents: [-3, 52], playerStart: { x: 3, z: 0 },
  lighting: {                                         // render/Lighting.js preset (all optional)
    sky: { top, horizon, bottom, sunDir: [x, y, z], sunColor, sunGlow, hazeHeight },
    sun: { color, intensity, dir: [x, y, z] }, hemi: { sky, ground, intensity }, rim: { color, intensity, dir },
    fog: { color, near, far } /* or { color, density } */, env: { intensity }, exposure: 1,
  },
  async build(ctx) {        // ctx: { game, THREE, group (renderer.envGroup; torn down for you), kit (levels/EnvKit.js), rng, quality, stage, params }
    ctx.kit.ground(ctx, { colorA: '#3a4a2a', colorB: '#6a7a4a' });
    const tick = ctx.kit.flicker(ctx, { pos: [8, 2.5, -6] });
    return { update: (dt, t) => tick(dt, t), dispose() {}, groundAt: (x, z) => 0 };
  },
  screens: [                // camera locks; waves spawn when the previous wave is dead; "GO →" between screens
    { x: [-3, 17], waves: [ { spawns: [ { type: 'marauder', side: 'right', z: 0.6 }, { type: 'marauder', side: 'left', tier: 'rust', delay: 30 } ] } ] },
    { x: [17, 34], trigger: 4, onEnter({ game, director }) {}, onClear() {}, waves: [ /* … */ ] },
  ],
  // SpawnDef: { type, side: 'right'|'left', x? (absolute; skips the walk-in), z, delay (ticks), tier, hp, enter: false, opts }
  //           { pickup: 'pot', x, z } · { mount: 'cluckhorn', x, z, opts: { rider } }
  //           { prop: 'crate'|'urn'|'barrel', x, z, loot: 'pot'|'food'|[...] } · { type: 'skeleton', x, z, rise: true } · coop: true (2P only) · elite: 1..4
  // props: [{ prop, x, z, loot }]   breakables placed at stage start (src/levels/props/<id>.js; players-only hits)
  autoClear: 12,            // stages without screens (bonus camp) clear after N seconds
  next: 'bonus',
};
```

Keep your stage's own helpers in `src/levels/stages/<id>/**` (you own that folder). Budget (ARCHITECTURE §8): ≤ 400 draw calls, instance or merge scatter, ≤ 2 flicker point lights. Check it with `/?mode=showcase&what=stage&id=<id>&cam=fly|wide|high|game` and `/?mode=stage&stage=<id>&bot=1`.

## 5. Add a spell

`src/magic/spells/<spell>.js` (a hero's `def.magic.spell` names it):

```js
export default {
  id: 'seraphine', element: 'fire', maxTier: 6,
  tiers: { 1: { name: 'Flare Burst' }, /* … */ },
  async preload(ctx) {},
  async cast(ctx, hero, tier) {          // resolves when the choreography ends (the hero is invulnerable meanwhile)
    const cam = ctx.drama({ distance: 21, height: 7, fov: 34, focus: hero, in: 0.3, hold: null });   // pull back
    ctx.darken(0.5, 1.2); ctx.slowmo(0.5, 0.3);
    ctx.vfx.spawn('magic_burst', { pos: hero.pos, element: 'fire', power: tier });
    await ctx.wait(20);                                            // sim ticks
    for (const e of ctx.enemies()) ctx.vfx.spawn('magic_burst', { pos: e.pos, element: 'fire', power: tier });
    ctx.hitAll({ damage: ctx.damage, knockdown: true, launch: 6, hitstop: 8 + tier });   // ctx.damage = canon tier total
    ctx.shake(0.6); ctx.flash({ color: '#ffc070', strength: 0.4 });
    await ctx.wait(30); cam.release();
  },
};
```

`ctx` = `{ game, hero, tier, damage, vfx, camera, combat, bus, rng, wait(ticks), enemies({ onScreen }), hit(target, hitData), hitAll(hitData, filter), drama(opts), darken(amount, seconds), slowmo(scale, hold), shake(t), flash({ color, strength, duration }) }`. **Damage is canon:** `ctx.damage` = `TIER_DAMAGE[tier]` (`magic/MagicSystem.js`: 4/8/16/24/32/40, DESIGN §2) is the total each enemy takes from one cast, and `hitData.damage` defaults to it. A multi-hit spell splits it (`ctx.hitAll({ damage: ctx.damage / 4 })` ×4). Magic ignores the difficulty and attacker multipliers; only the target's `damageTakenMul` applies. **Determinism:** a hero's spell book is preloaded (and `game.track()`ed) when the hero spawns, so `game.magic.cast()` starts synchronously and `magicCast` lands on the tick the cast begins. Keep heavy asset loading in `preload(ctx)`, not in `cast`. Pots and tiers (DESIGN §2) are handled by `Hero`: `def.magic = { pots: 9, tiers: [1, 5, 6, 7, 8, 9] }` (pots needed per tier). A tap casts `hero.magicTier()` and spends everything. Holding Magic steps the tier down (`EV.MAGIC_SELECT`) and spends only that tier's cost. Test with `/?mode=showcase&what=magic&id=<hero>&tier=N` or `__KCA.debug.cast(1, tier)`.

## 6. Author a clip

Clip sets live in `src/anim/clips/<file>.js`. They are code-authored keyframes of **character-space rotation offsets from the rest pose**, retargeted onto any §2 rig by `src/anim/retarget.js`.

**Axis convention (right-handed, character space):** **+X = forward (facing), +Y = up, +Z = the character's right.** Euler angles are in **degrees, order `'XYZ'`**, about those axes as they are at rest, applied at the joint (children follow their parents).

| Want | Key |
|---|---|
| lean the torso forward 15° | `spine: [0, 0, -15]` (+Z tips the top backward) |
| raise a hanging arm or thigh forward | `+Z` on `upperarm_*` / `thigh_*` |
| bend the knee | `-Z` on `shin_*` (swings the shin back) |
| turn the chest to the character's left | `chest: [0, +20, 0]` |
| side-bend toward the right | `spine: [+10, 0, 0]` |
| abduct (lift sideways) the left arm / right arm | `upperarm_L: [+X, 0, 0]` / `upperarm_R: [−X, 0, 0]` |
| crouch (hips down 20% of hip height) | `hips: [0, -0.2, 0]` (translation, reference rig hips at 1.0 m, scaled per rig) |
| mirror a clip L↔R | `{ mirror: 'light_1' }` (swaps `_L/_R`, negates X and Y) |

Most keys never need raw Euler angles: `src/anim/poseKit.js` converts **direction vectors** (character space, relative to the chest rest frame for arms and the hips for legs) into offsets:

```js
// src/anim/clips/humanoid_taunt.js — a new clip for every humanoid (drop-in, no index edits)
import { arm, leg, pose } from '../poseKit.js';

const PLANT = pose(leg('L', { thigh: [0.3, -1, -0.15], shin: [0, -1, -0.1] }), leg('R', { thigh: [-0.2, -1, 0.15], shin: [-0.3, -1, 0.1] }));

export default {
  rig: 'humanoid', priority: 5,                  // character: 'gorrim' → only Gorrim; higher priority wins
  clips: {
    taunt: {
      frames: 48, loop: false,                   // or duration: seconds; keys use f (frames) or t (seconds)
      keys: [
        { f: 0, pose: pose(PLANT, { spine: [0, 0, -5] }), hips: [0, -0.03, 0] },
        { f: 14, ease: 'outBack', pose: pose(PLANT,
            { spine: [0, 10, 8], chest: [0, 8, 6], head: [0, -10, 12] },                 // chest opens, chin up
            arm('R', { upper: [0.2, 1, 0.4], fore: [0.1, 1, 0.1], blade: [0, 1, 0], edge: [1, 0, 0] }),   // weapon to the sky
            arm('L', { upper: [0.3, -0.6, -0.8], fore: [0.9, 0.3, -0.3] })), hips: [0, 0.02, 0] },
        { f: 48, ease: 'inOut', pose: pose(PLANT, { spine: [0, 0, -5] }), hips: [0, -0.03, 0] },
      ],
      events: [{ f: 14, name: 'roar' }],         // → Animator listeners; 'footstep' and 'bodyfall' are forwarded to the bus
    },
  },
};
```

- `arm(side, { upper, fore, blade, edge, twist })` gives the upper-arm direction, the forearm direction, where the weapon blade points, and where its edge faces. `leg(side, { thigh, shin, toe })` does the same for the leg. Directions need not be normalized: `[1,0,0]` forward, `[0,1,0]` up, `[0,0,1]` right.
- Interpolation is Catmull-Rom by default. A key's `ease` (`linear|in|out|inOut|outBack|outExpo|inExpo|outCubic|inCubic|step`) shapes the segment arriving at it. Bones only animate in the keys that mention them. Use `tracks: { bone: [[t, x, y, z, ease?], …] }` for per-bone channels.
- **Required names** are in ARCHITECTURE §3. Moves play `move.anim || moveId` with fallbacks (`animFallback`), so authoring `pommel`, `kick`, `death_stab`, `back_attack`, `launcher` or `run_jump_attack` upgrades those moves automatically.
- **Timing:** combat frame data is authoritative. The Animator time-warps attack clips to the move's `startup + active + recovery`, so author attacks in 60 Hz frames matching the moveset (anticipation → strike on the first active frame).
- Verify on both rig flavours with `/?mode=showcase&what=rigtest&id=brann&anim=taunt` (`__KCA.showcase.compare()` must stay ≈ 0), and on the real hero with `/?mode=showcase&what=hero&id=gorrim&anim=taunt&cam=close`.
- Runtime: `animator.play(name, { fade, speed, loop, restart, duration, startAt, fallback })`, `animator.setSpeed(k)`, `animator.on('roar', fn)`, `animator.postProcessors.push((dt, an) => …)` for springs, look-at and IK layers (runs after the mixer every frame).

## 7. Movesets: frame-data format

`src/characters/movesets/<hero>.js` → `{ id, moves: { moveId: MoveDef } }`. The full field list is in the header of `src/combat/MoveRunner.js`. Essentials:

```js
light_2: {
  anim: 'light_2', animFallback: ['light_1'],
  startup: 5, active: 3, recovery: 15,                 // ticks; total = sum unless `total`
  hits: [{ from: 5, to: 8,                             // optional per-window ticks (default [startup, startup+active))
    box: { x: 1.05, y: 0.45, w: 1.7, h: 1.25, d: 0.8 },  // metres from the feet, x along facing, d = depth (belt tolerance)
    damage: 5, hitstun: 20, knockback: 1.4, launch: 0, knockdown: false, hitstop: 5,
    level: 'light' | 'heavy' | 'magic', spark: 'hit_spark', shake: 0.12, otg: false, hits: 1, interval: 6, dir: 0 | ±1 | 'facing' | 'back',
    reaction: 'hit_high' }],
  move: [{ from: 2, to: 8, speed: 2.2, ease: 'out', vy: 0 }],          // root motion along facing (m/s)
  cancels: [                                                              // buffered input → next move
    { from: 7, to: 22, on: 'light', into: 'light_3', hit: true, cond: 'far' },     // string continues ONLY on hit
    { from: 7, to: 22, on: 'light', into: 'pommel_1', hit: true, cond: 'close' },  // close branch (Hero.cancelAllowed)
    { from: 7, to: 22, on: 'dodge', into: '@dodge', hit: true },                   // '@dodge' '@jump' '@idle'
  ],
  invuln: [0, 20], armor: 0, air: false, endOnLand: true, landInto: 'land', gravity: 1, friction: 10, tracking: 0, clash: 'low',
}
```

`armor: 7` or `armor: { from, to, damage }` gives the move super armor (default window: the whole startup). Hits dealing less than `damage` that don't knock down still hurt and flash, but they don't interrupt the move. The marauder's smash uses it. Leaving the `attack` state ends the move (`endMove()`), unless the runner is `paused` (the heavy charge sets that), so a stale runner can never keep live hit windows.

Hero move ids the controller uses: `light_1 → light_2 → (far) light_3 | (close) pommel_1 → pommel_2 → close_finisher` (kick) **or `throw`** (Light while holding ←/→, cancel `cond: 'aim'`), `heavy` (hold to charge), `launcher` (Heavy after two lights), `air_slam` → `air_slam_land` (Heavy in the air), `run_attack` (double-tap then Light), `jump_attack`, `run_jump_attack`, `death_stab` (dash → jump → Light near the apex), `back_attack` (Light+Jump).

**Heavy charge** (`heavy.charge = { at, levels: [l1, l2, l3], max, scale? }`): if Heavy is still held when the move reaches frame `at`, the hero pauses in the `charge` state (windup pose held). Hold ticks `levels[i]` reach charge level i+1 (flash, small shake, `EV.CHARGE { actor, level }`). Release, or `max`, resumes the swing with its hit windows scaled by `scale[level-1]` (`{ damage, knockback, launch, hitstop (+ticks), shake, …extra hit fields }`; default `Hero.CHARGE_DEFAULTS`: ×1.3 / ×1.65 / ×2.2 damage, level 3 adds `guardBreak: true`). Charged hits report `moveId: 'heavy_c1'…'heavy_c3'`. Dodge cancels a charge. Any MoveDef can be chargeable (`chargeButton` defaults to `'heavy'`).

**Air slam / ground bounce.** A hit field `bounce: v` spikes the victim into the floor, and it rebounds at `v` m/s (scaled by weight and juggle count, juggle-able). `landInto` may name a MOVE as well as a state: the air slam lands into `air_slam_land`, a shockwave move (`EV.LAND { slam: true }` fires).

**Throw** (`kind: 'throw'` MoveDef, run by Hero's `throw` state, not MoveRunner): `{ grab, release, total, lift: { x, y }, fling: { speed, vy }, damage, impact: {hit data}, maxWeight }`. The victim (the foe the string last hit, else `hero.foeClose()`; `hero.canThrow(v)` rejects bosses, riders, `def.throwable === false` and `weight > maxWeight`, in which case the next cancel, the kick, runs instead) enters the shared `grabbed` state (the thrower writes its position; it lies flat via `actor.roll`), is released into `thrown` at `release` along the held direction (hold ← while facing right = over-the-shoulder throw behind you), damages every foe of its own team it passes through (`moveId: 'throw_impact'`, `impact` hit data), and takes `damage` on landing (`moveId: 'throw'`). Events: `EV.GRAB { actor, victim }`, `EV.THROW { actor, victim, dir }`. The `grabbed`/`thrown` states live in `Combatant` (every fighter has them). A grabbed victim stays held while its holder is in a `throw` or `clinch` state (after 150 ticks it drops), so an enemy grab (ogre) only needs one of those state names on the enemy.

**Walk-in grab (clinch).** Walking (or running) into a foe clinches it: 2 ticks of contact if the foe is in hitstun, `CLINCH_PUSH_TICKS` (12) if it is standing (a swinging foe only early in an unarmoured windup), and `canThrow` must pass. The hero's `clinch` state holds the foe at arm's length (the victim is `grabbed`). Light = a knee (`moveId: 'clinch_knee'`, hit data with `hold: true`, which flinches a grabbed victim without breaking the hold). After `knees` (2) knees, the next Light, any Heavy, or a Light while holding ←/→ goes into the `throw` state along the held direction (default forward). Dodge shoves the foe off. After `hold` (90 ticks) the foe breaks free. Presses made during the knee recovery are queued. Override the defaults per hero with a `clinch: { hold, knees, cool, anim, kneeAnim, knee: {hit data} }` entry in the moveset (`Hero.CLINCH_DEFAULTS`). Events: `EV.GRAB { actor, victim, moveId: 'clinch', clinch: true }`. The hit pipeline is `CombatSystem` (per-tick overlaps, one hit per swing per target) → `target.canBeHit(ev)` → `target.receiveHit(ev)` → attacker and victim hitstop → `EV.HIT`. Non-melee damage (projectiles, traps, spells) goes through `game.combat.applyHit(attacker, target, hitData)` / `areaHit(attacker, { box | center, radius, team }, hitData)`. Veto or modify hits with `combat.preHitHooks.push((ev) => false | void)` (blocking and guard specialists). Defence: `target.damageTakenMul` (Gorrim 0.85, Seraphine 1.1). Test with `/?mode=showcase&what=moveset&id=<hero>&debug=1` (now includes a level-3 charge, an air slam and a close-string throw), `tools/scenarios/combo.mjs` and `tools/scenarios/moves.mjs`.

## 8. Add a VFX effect

`src/vfx/effects/<id>.js`:

```js
export default {
  id: 'ember_ring',
  preload(vfx) {},                                   // optional (build shared geometry/materials once)
  spawn(vfx, o = {}) {                               // o is whatever the caller passes (pos, point, dir, level, element, power…)
    const r = vfx.rng, p = o.pos || { x: 0, y: 0, z: 0 };
    for (let i = 0; i < Math.round(24 * vfx.scale); i++)   // vfx.scale = 0.5 on quality=low
      vfx.add.emit({ pos: [p.x, 0.2, p.z], vel: [r.range(-3, 3), r.range(1, 4), r.range(-1, 1)], life: 0.6,
        size: [0.08, 0.01], color: ['#fff0c0', '#ff4000'], intensity: 4, shape: 'streak', stretch: 0.02, gravity: 6, drag: 2 });
    vfx.light(p, { color: 0xff8040, intensity: 40, distance: 8, life: 0.2 });
    // meshes: vfx.track(mesh, lifeSeconds, (obj, t01, dt) => {...})
  },
};
```

Call it with `game.vfx.spawn('ember_ring', { pos })`. Pools: `vfx.add` (additive, HDR, one draw call) and `vfx.alpha` (smoke, dust). Shapes: `soft streak ring spark smoke shard`. Default event wiring (hit → `hit.spark || 'hit_spark'`, land → `dust`) is in `VfxSystem._wire()`. Camera and post juice (shake, punch, CA pulse, final-blow slow-mo) live in `vfx/ScreenFx.js`. Preview with `/?mode=showcase&what=vfx&id=ember_ring&level=heavy`.

## 9. Add a UI screen

`src/ui/screens/<id>.js`:

```js
export default {
  id: 'pause',
  create(ui, opts) {
    const el = document.createElement('div');
    el.innerHTML = '<h1>PAUSED</h1>';
    return {
      el,                                        // appended to the screen layer (class kca-screen kca-screen-pause)
      update(dt) {},                             // every rendered frame
      onAction(player, action) { if (action === 'start') ui.hide('pause'); return true; },   // menu input (press edges)
      dispose() {},
    };
  },
};
```

`await game.ui.show('pause', opts)` · `ui.hide(id)` · `ui.hud.show(true)` · `ui.card(title, subtitle, seconds, { big })` · `ui.bossCard(name, epithet)` (also fired automatically by `EV.BOSS_INTRO { boss }` using `boss.def.name/title`; the HUD then shows a boss life bar) · `ui.demo(on)` · `ui.go(on)` · `ui.toast(text)`. Display lettering: `forge(text, { metal, glint })` from `ui/lettering.js` (vector, no fonts); ornaments in `ui/art.js`; menus/panels in `ui/widgets.js`. Screens: title · select (3D skeletal-hands set, `ui/select3d.js`) · map · tally · ranking · highscore · pause · options. Flow extras: `game.flow.pause()/resume()`, `game.stats` (RunStats: per-stage kills/deaths/pots/damage → tally, rating, YOUR STRENGTH), `game/HighScores.js`, `game/Settings.js`. The HUD (`ui/Hud.js`) reads `game.session`: life blocks of 16 HP, numbered magic tier boxes, lives, score, `CONTINUE? 9…0`, combo. Styles go in `ui/styles.js`. The flow states that show screens are in `game/Flow.js`; replace or extend them with `game.flow.define({ ... })`. Preview with `/?mode=showcase&what=ui&id=<screen|hud|go|card>`.

## 10. Add a showcase kind

`src/showcase/kinds/<what>.js` → URL `/?mode=showcase&what=<what>&id=…`:

```js
export default {
  id: 'breakables',
  async setup(ctx) {                    // ctx helpers (src/showcase/Showcase.js):
    ctx.studio();                        // studio lighting + lit plinth   | await ctx.stage('stage1')
    const h = await ctx.hero('brann', { x: 0, puppet: true });            // puppet: no controls/AI, only clips
    const e = await ctx.enemy('marauder', { x: 3, tier: 'rust' });
    ctx.orbit({ target: [0, 1, 0], distance: 5, yaw: 20 });               // or ctx.gameCam([h], { lock: [-10, 10] })
    ctx.turntable(h, { speed: 20 });                                      // or { yaw: 35 }
    ctx.every(2, () => h.play('light_1', { restart: true }));             // sim-time schedulers: every / after
    ctx.label('breakables');
    ctx.expose({ actor: h, reset() {} });                                  // → window.__KCA.showcase.*
  },
};
```

## 11. Audio, mounts, pickups, bosses

- **Audio.** Call `game.audio.play(id, { volume, pitch, pan, bus: 'sfx'|'voice'|'ui'|'music', tier, delay })`; it is a no-op until the AudioContext is unlocked by the first key/click/touch (never throws; zero cost when muted — the context is suspended at master 0). Banks live in `src/audio/banks/<id>.js` → `{ id, sounds: { name: S(meta, (ctx, out, opts) => …) } }` built with `src/audio/dsp.js` (`kit()`, `S()`); meta `{ dur, v (variants), max, gap, verb, bus, live }`. Loudness is automatic: `src/audio/levels.js` sets each sound's target peak and the engine calibrates `meta.norm` offline. Non-live sounds are pre-rendered into seeded variants (no machine-gun repeats). Music cues go in `src/audio/music/<id>.js` (`cue(song)` from `music/_seq.js`), and `game.audio.music` is the director: `play(id)`, `setIntensity(0..3|null)`, `setBoss(bool)`. The engine picks cues itself from `stageStart`, `flowState`, `bossIntro`, `stageClear` and `gameOver`, and intensity follows the live enemy count, combo and screen locks. The event → sound mapping is `AudioEngine._wire()`. `audio.duck(amount, s)` (sidechain on the music), `audio.panFor(actor)`. Debug: `__KCA.audio.stats()` (voices played by name, skips, music cue/level). To preview, use `/?mode=showcase&what=audio` (the workbench). To inspect levels, run `node tools/audio-render.mjs --host <origin> --out progress/audio/<run>`, which writes WAVs, LUFS/peak analysis and spectrogram sheets.
- **Mounts (bizarrians).** Beasts: `cluckhorn` (tail whip with turn-around wind-up / beak ram), `emberdrake` (roots + fire-breath cone / ram), `cinderwyrm` (one fireball in flight at a time, else a bite / ram), `tusker` (gore launcher / armoured charge; placeholder visual). Type `src/mounts/types/<id>.js` → `{ id, name, hp, speed, run, jump, enemySpeed, height, radius, saddleY, soak, leaveTicks, buttons: { light, heavy, dash, air }, attacks: { id: MoveDef }, gate?(m, rider, key), onAttackTick?(m, rider, run, id), create(game, opts, { Mount, def }) → Mount }`. Spawn with `game.mounts.spawn(id, { x, z, facing, rider })`; `rider` = an actor or an **enemy type id** (`'marauder'`, `'viper'`…; spawned and seated, rides in from off-screen, counts toward the wave; `riderOpts: { tier, elite }`). Stage waves: `{ mount: 'emberdrake', x, opts: { rider: 'viper' } }`. Debug: `__KCA.debug.spawn('cluckhorn', x, z, { rider: 'marauder' })`. Rules: the RIDER stays the physics body (the beast follows it); beast attacks run as the rider's moves `beast_<id>` (Light/air = `buttons.light|air`, Heavy = `heavy`, run+attack = `dash`); a hero walks into a free beast + Jump (or Light with no foe near) to hop on (`mountUp` state), Dodge+Jump hops off, Magic hops off then casts; no back attack / Death Stab / throws / clinch / air slam while seated. Enemy riders fall off on any hit; hero riders only on big hits (knockdown / launch / heavy / magic / `hit.dismount` jump-slash / lethal / beast HP gone), smaller hits are soaked (`def.soak` to the beast, the rider isn't interrupted). Free beasts are neutral and hittable by both teams (a hard hit makes them bolt), wander, leave `leaveTicks` after losing a rider, and are removed on `stageStart`/`stageClear`. Knights/ogres (`canRide: false`) never ride; a knocked-off enemy climbs back on if he gets up next to his free beast. Mount API: `rider`, `free`, `canMount(a)`, `mount(a)`, `dismount({ knocked, silent })`, `flee()`, `saddle`, `saddleY`, `animate(dt, speed)`, `demoAction(id)`/`demoTick()` (showcase). Events: `mount`/`dismount` `{ rider, mount, knocked }`, `mounts:hop|riderOff|flee|hurt|soak|attack`. Art: `mount_<id>.glb` (blender/build_mount_*.py, beast_biped / beast_quad rigs) driven procedurally by `src/mounts/beastRig.js` (model-axis joint offsets, works on GLB bones and the procedural fallback). Preview `/?mode=showcase&what=mount&id=<id>[&anim=walk|run|<attack>|attacks][&rider=brann]`, in-game sandbox `&scene=ride` + `tools/scenarios/mounts.mjs`. Details: `docs/notes/mounts.md`.
- **Pickups.** `src/game/pickups/<id>.js` → `{ id, glint, build(ctx) → Object3D, onCollect(game, hero, pickup) → bool, animate?(pickup, alpha, frameDt), ownFx? }`. Spawn with `game.spawnPickup('pot', x, z, { vx, vy })`. Hero helpers: `hero.addPots(n)`, `hero.heal(hp)`. `pot` / `food` are built from `pickups/_kit.js` (merged mesh + painted atlas, rig `model > lift > tumble > spin`, tick-driven pop / flip / squash / hover; effects in `vfx/effects/loot_fx.js`). Origin of a pickup model = its base at the ground; never scale the model root from outside (scale `pickup.body`, as the camp does).
- **Bosses.** `src/enemies/bosses/<id>.js` → `{ id, name, create(game, opts) → Actor }` (use `Enemy`/`Combatant` and emit `EV.BOSS_INTRO` / `EV.BOSS_PHASE`). Preview with `/?mode=showcase&what=boss&id=<id>&anim=…`. **Bosses (wave B):** base class `src/enemies/bosses/_Boss.js` (intro/phase/defeat states, phase-line HP clamp, poise), group bosses `_group.js`, set-piece kit `_fx.js`; stages get a boss wave automatically after the last wave of a `bossHook` screen (or the last screen of stage1/5) via `_hook.js` (`&boss=0` off). Ids: morvane, varkhul, brute_brothers, captains, wyrm_rider; `&scene=fight` runs the encounter with bot heroes. Details: `docs/notes/bosses.md`.

## 12. Assets, rendering, camera

- **GLBs.** Asset id `X` → `/assets/models/X.glb` (put the file in `public/assets/models/`). Heroes use `hero_<id>`, enemies `enemy_<id>`. A missing or invalid GLB, or one missing required §2 bones, falls back to the procedural placeholder automatically, so nothing breaks while art is in progress. When the file appears it is picked up on the next page load (`&placeholder=1` forces the procedural rig). Check skin weights in-engine with `__KCA.debug.skinCheck()` after posing (e.g. `showcase.play('light_1')`): `stretched` must be 0. Metadata (scale, extra yaw, weapon GLB ids) goes in `src/assets/manifest.js` (additive edits only). Weapons: grip at the origin, blade along local +Y, attached to `socket_hand_R`/`socket_hand_L` by `attachToSocket` (the socket convention in `anim/retarget.js`).
- `await game.assets.character(def)` → `{ root, rigInfo, source: 'glb'|'placeholder', weapon, sockets, hipHeight }` · `await game.assets.instance(id, { fallback })` for props · `assets/proceduralTextures.js`: `noiseTexture`, `normalFromNoise`, `gradientTexture`, `radialTexture`, `canvasTexture`.
- GPU memory (perf-1650 r4): the asset cache keeps every GLB for the session and three never frees an uploaded texture, so `startStage` calls `game.assets.releaseGpu({ keep })` (`StageRunner.releaseAssetGpu`; heroes of the run stay resident) — a released texture keeps its ImageBitmap and re-uploads by itself on the next draw. Do NOT hold GPU-only state in a cached GLB texture. `&gpurelease=0` disables. Hidden / pooled effects that start with `InstancedMesh.count = 0`, `geometry.instanceCount = 0` or `drawRange.count = 0` are given one degenerate instance during the stage prewarm so their programs are DRAWN once behind the curtain (ANGLE builds a program's D3D executables at its first draw); mark a mesh `userData.noWarm = true` to opt out. Mounts have no `modelRoot`: `lookForActors` does not patch them.
- **Render.** `game.renderer.lighting.apply(preset)` · `renderer.post` (`exposure`, `bloom`, `grade.set({ saturation, contrast, lift, gain, shadowTint, highlightTint, split })`, `vignette`, `pulse({ ca, flash, flashColor, desat, duration })`) · `renderer.exposureMul` (transient) · `renderer.envGroup` (stage geometry) · `QUALITY` (`core/config.js`: `high|low`). A global NaN/Inf guard is patched into every built-in material (`installNanGuard`). Custom ShaderMaterials must not output NaN.
- **Character look / fire kit (look-dev, r2).** `preset.character = { rim, intensity, power, floor, base, edge, width (px), maxNdv, key: { color, intensity, dir }, ambient, ambientIntensity }` drives the actor-only light rig in `render/characterLook.js`: a pixel-width sun-coloured silhouette rim (`edge`/`width`), a soft Fresnel term, and an unshadowed actor key and ambient that lift combatants above the ground's value. It applies automatically to every hero, enemy, boss and mount. `render/fire.js` `fx.flame(pos, { height, width, intensity, layers, heat, soot })` now emits a 3-layer flame (envelope, tongue, core), a heat-haze column and a soot plume. Pass `false` to opt out of each.
- **Camera.** `game.cameraRig`: `follow(actors)`, `setLock(x0, x1)`/`clearLock()`, `setLimits()`, `shake(trauma)` (trauma² amplitude), `punch(amount, ticks)`, `drama({ distance, height, fov, lookHeight, focus, yaw, roll, in, hold, out, priority })` → `handle.release()`, `snap()`, `visibleRange(z)`, `worldToScreen(v)`, `manual = true` for custom cameras.

## 13. `__KCA` in scenarios

`node tools/capture.mjs --url "<mode url>" --scenario tools/scenarios/<x>.mjs [--sheet] [--mp4] --out progress/shots/<item>/rN`. A scenario is `export default async (api) => {}` with `api = { page, advance(ms), shot(name), frames(n, stepMs, prefix), evalGame(fn, arg), press(player, action, ms), hold(player, action, down), log(msg), outDir }`. Frames taken with `frames()` feed `--sheet` and `--mp4`. Throw to fail the capture (it is reported in `pageErrors`).

```js
export default async (api) => {
  await api.evalGame(() => window.__KCA.debug.god(true));
  await api.hold(1, 'right', true); await api.frames(3, 200, 'walk'); await api.hold(1, 'right', false);
  await api.press(1, 'light', 50); await api.advance(120);
  const hits = await api.evalGame(() => window.__KCA.events('hit').length);
  if (!hits) throw new Error('no hit landed');
  const info = await api.evalGame(() => window.__KCA.info());   // drawCalls, triangles, heroes[], stage, errors[]
};
```

Ready-made: `tools/scenarios/smoke.mjs` (load, walk, depth, attack, jump, land), `tools/scenarios/combo.mjs` (light string, run attack, jump attack, Death Stab vs dummies) and `tools/scenarios/moves.mjs` (events stamping, first-cast determinism, canon spell damage per tier, heavy tap vs 3 charge levels, air slam + ground bounce, close-string throw vs kick; writes `moves.json`). The full `__KCA` surface is in ARCHITECTURE §6.

Scenario gotchas:
- `__KCA.events(type, sinceTick)` returns events with `tick > sinceTick`; pass the `game.tick` you read before acting (see §1). No `- 1` needed.
- `advance(ms)` steps first and renders one frame at the end, and the UI writes the DOM in that render, so classes and text are current when it returns. CSS transitions still run on wall-clock time, so assert on classes/text, not on computed `opacity`.
- A hero's death: `EV.PLAYER_DOWN` fires `Hero.DEATH_BEAT_TICKS` (42) unfrozen ticks after the killing blow, whatever the body is doing, so respawn or CONTINUE? follows in under 1 s.
- `tools/scenarios/flow.mjs` (HUD DOM freshness, CONTINUE timing, GAME OVER card) and `tools/scenarios/attract.mjs` (bot moveset coverage and enemy pressure, reading events incrementally) are ready-made regression checks.
- Long captures and other agents' edits: the shared dev server full-reloads the page on every save. For a long scenario, run a private server with HMR off (`server: { port: 5191, hmr: false }` in a scratch config) and pass `--host http://127.0.0.1:5191`.
- `debug.pots(player, n)` **adds** n pots (clamped to the hero's max). `debug.cast(player, tier)` tops pots up to the tier's cost and casts it.
- Heroes are clamped to the camera window (`boundsMode: 'screen'`): teleporting one far from the camera clamps it back, so place foes relative to the hero's position *after* a tick.
- Another agent's edit can trigger a Vite full reload mid-capture ("Execution context was destroyed"); just re-run.

## 14. Rules of thumb

1. Put gameplay randomness on `game.rng` and cosmetic randomness on `game.fxRng`. Never use `Math.random()` in sim code (captures are seeded).
2. Keep sim state in ticks (`update`) and visuals in `render(alpha, frameDt)`. Don't read `performance.now()` for gameplay.
3. Wrap your listeners in `bus.scope()` and dispose them. Namespace private events. Don't mutate other agents' objects: go through their APIs or `preHitHooks`, `fsm.define`, `animator.postProcessors`, `game.addSystem`.
4. Stay within the budget (ARCHITECTURE §8) and check `info().drawCalls/triangles` in your captures.
5. If you must touch a shared file, make a minimal additive edit and log it in `docs/CHANGELOG_SHARED.md`.

## Shared authored fire / hit flipbooks (C2)

`src/vfx/fireLib.js` exports `preloadFireLibrary()`, `FirePool`, and `FIRE_CLIPS`.
The atlas is original offline painting (`python3 src/vfx/author_atlas.py`, requires numpy + Pillow),
`public/assets/vfx/fire-hit-atlas.png`: 2048² RGBA8, 8×8 cells of256px, trilinear mipmaps (~21.3MiB GPU). Shader gradients clamp mip selection to level3,
so transparent eight-pixel gutters isolate adjacent clips at gameplay sizes.
The concept reference sheets are never sampled or shipped. Rows: `flame` loop; `fireBurst` incandescent contact→cooling flame lobes (soot is a separate `smoke` instance); `smoke` advected irregular density masses; `embers`; `slash` four-pose directional light wedge; `blunt` distinct four-pose heavy fan; `knockdown`; `storm`.

```js
import { FirePool, preloadFireLibrary } from '../vfx/fireLib.js';
await preloadFireLibrary(); // stage readiness: wait before compiling / lifting curtain
const fire = new FirePool({ capacity: 48 }); // use fewer instances on Low
scene.add(fire.mesh);
fire.emit({ clip: 'flame', pos: [x, y + .7, z], size: [1.1, 1.4],
  life: .9, loop: true, phase: .27, core: .65, soft: .12, floor: y });
// On each render, with slow-motion-aware seconds:
fire.update(dt);
// On teardown: remove fire.mesh; fire.dispose(); (atlas is shared; do not dispose it)
```

`emit()` returns a mutable instance handle (or null when capacity is full). Options: clip, centre `pos`,
`size:[width,height]` in metres, `life` seconds, `loop`, normalized `phase` (loop phase; fireBurst initial frame offset), screen-plane `rot` radians,
`tint` hex, `alpha`, HDR `core` multiplier, lifetime `erosion`, `vel:[x,y,z]`, growth fraction `grow`, optional `growY` (defaults to grow) and `spin` radians/second,
`additive` (default false; zero destination attenuation for hot arcs/combustion), `rooted` (default false; dark red/orange base fading into a roof attachment), `fadeIn` seconds (default0; smooth onset for soot),
`delay` seconds, analytic ground softness `soft` metres and `floor` world Y. Ground softness assumes an
unrotated world-space pool. For moving a whole pool keep `floor` in pool-local units. `clear()` resets instances;
`dispose()` also releases its geometry/material. Pool capacity never grows during play. Dropped emissions return null.

One instanced draw per pool with a single shader/material implementation and shared atlas. Frame interpolation
uses premultiplied sample colors, trilinear filtering + bounded mip footprint + smooth transparent padding + RGB bleed, normal premultiplied blending,
soft alpha threshold erosion and a bounded HDR core; only invisible texels below alpha .002 are discarded. No render passes or lights are created by the library.
`setDepth(opaqueDepthTexture, camera, softness=.2)` enables full depth-intersection soft particles when a consumer
already has an opaque/stable depth texture; **never pass the active framebuffer's depth attachment**. Pass null
to disable. Current hit/camp consumers use ground softness where needed and depth testing; no extra depth copy pass.
`game.vfx.fire` is the transient hit pool (96High/48Low), updated and disposed by VfxSystem.
Campfire owns a16-instance pool; roof-fire and dragon-fire teams should own their pools and teardown.

C2 pre-board atlas guard: `python3 src/vfx/author_atlas.py --check` verifies all64cells have exactly zero
alpha on their 2px border and writes `public/assets/vfx/fire-hit-atlas.check.json` with per-frame transparent
padding. Packing applies an8-18px smooth gutter and6px RGB bleed; runtime clamps to cell texel centres,
uses ClampToEdgeWrapping, and bounds mip gradients to level3 to prevent neighbouring-frame bleed.

C2 r7 contact authoring: `slash`/`blunt` use four authored poses at 0/33/66/99ms
(the remaining atlas cells duplicate the final pose); each billboard rotates to the
weapon-tip velocity projected onto the camera basis. Other rows retain eight frames.
Incandescent physical chips use `vfx.debris.emit({kind:'metal', ...})`; only magic-earth
may use stone. Both kinds share the existing pool/program.
`contactFill(root, worldPoint, {radius,strength,life,heavy})` in `render/characterLook.js`
drives per-material warm fill and an optional restrained 28ms warm heavy rim. VfxSystem advances
and clears this render-clock state; defaults have zero gain and all uniforms warm at load.
Rooted non-bed flame cards widen 1.95x / height 1.38x around the supplied floor anchor;
looping smoke widens 1.38x and gains 1.45x alpha (capped at one), with neutralized tint for dusk contrast. No cross-aperture
geometry, lights, passes, extra pools or implicit smoke emitters are added. Tall looping
smoke cards (height>=4m) also rise by22% of their original height and extend18%,
so the dense part clears a roof crest while the separate low wisp stays in the hole.

C2 r8: `fire.emitCombustion({pos:[x,y,z],target,scale=1,dir=1})` emits three unequal
fireBurst instances plus independently advected soot in the same pool/draw. The flame
centres follow target's posed chest bone (modelRoot/actor position fallback), with
independent phase/mirror/skew and 280/310/355ms lifetimes. Handles are returned for the
three flames; capacity remains bounded. `emit({follow:()=>deltaVector3,...})` accepts a
world-space displacement from the emission point; it is evaluated each render update,
including update(0). Flames release node references when they expire/clear/dispose.
Use a world-aligned pool for these world attachments. No terrain/bone geometry is
modified. Eight fireBurst poses now change shape, opening holes and burning away;
phase offsets advance toward the last pose without wrapping to ignition.
