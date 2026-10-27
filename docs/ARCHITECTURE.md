# KnotzCopperAx — Architecture & Contracts

Stack: **Three.js r186 + pmndrs `postprocessing`**, vanilla ES modules (JSDoc types welcome, no TypeScript), bundled by **Vite 8**. The game uses no third-party art or audio. Everything is generated: Blender Python scripts for meshes and textures (`blender/` → `public/assets/models/*.glb`), code for animation, VFX, and audio.

Sections marked **(FOUNDATION fills in)** get concrete API signatures from the foundation agent. Keep this document true.

## 0. Rules for concurrent agents (read first)
Many agents work in this same folder at once, against one shared dev server at `http://127.0.0.1:5190` (already running; do NOT start another). The port is 5190, not Vite's default 5173, because other projects on this machine use 5173.

**Machine (since 2026-10-20):** WSL2 Ubuntu 24.04 on Windows, RTX 5070 12 GB, 20 CPU threads, 48 GB RAM for WSL (31 GB until 2026-10-23) + 12 GB swap. The perf TARGET is still the user's GTX 1650 Ti laptop (§8); perfbench converts its numbers to "≈1650 Ti ms" (docs/PERF.md). Run `node tools/doctor.mjs` first if anything in the toolchain misbehaves: it checks the GPU browser, ffmpeg, Blender + CUDA, the dev server, locks and stray processes in ~3 s.

1. **Edit only files you own** (see §9 ownership). If you need a change in someone else's file, prefer an extension point: registries, hooks, or events. If you must touch a shared file, make the smallest additive edit and note it in `docs/CHANGELOG_SHARED.md`.
2. **Never leave the build broken.** Each write must leave working code. Vite hot-reloads other agents' pages when you save.
3. **Isolate failures.** Subsystems load through `safeImport()` or registries, so a broken level or enemy file must not take down unrelated showcase modes.
4. If a capture shows an error from a file you don't own, wait ~30–60 s and retry. The owner is probably mid-change. Only fix it yourself if it is trivially broken and blocking you, and log it in `docs/CHANGELOG_SHARED.md`.
5. **Blender only through the wrapper:** `node tools/blender-run.mjs [--log <file>] [--what "<label>"] [--owner <item-id>] -- -b --factory-startup -P blender/<script>.py -- <args>`. It runs Linux Blender 5.2.1 (`~/.local/opt/blender-5.2.1-linux-x64`, override with `BLENDER_EXE`), adds WSL's NVIDIA libraries, and makes Cycles bake on **CUDA** (OptiX can't create a context under WSL2; `blender/lib/pipeline.py` reads `KCA_CYCLES_DEVICE`). At most `KCA_BLENDER_SLOTS` (default 3, hard cap 3 — owner rule) Blenders run machine-wide; extra builds queue first come, first served. A new build waits until enough memory is *usable* (`tools/lib/memgate.mjs`: MemAvailable − half the swap in use − what running jobs are still expected to grow by): at least `KCA_BLENDER_MIN_FREE_MB` (default 14000), more for a job whose script peaked higher before (the wrapper learns each script's peak RSS; `--mem-mb N` declares it). Captures likewise wait for `KCA_CAPTURE_MIN_FREE_MB` (default 4000) usable, and both wait while the machine is thrashing (memory pressure ≥ 10 %) or VRAM < 1 GB is free. With `--log`, the wrapper writes a `[kca-watchdog]` line every 60 s and a loud `STALL` line after 45 min without Blender output (it never kills the job). For background use, run the WRAPPER in the background; stopping the wrapper stops its Blender. Never call blender directly. Use fast or preview modes while iterating and one release build at the end. `node tools/blender-run.mjs --status` shows who holds the slots (RSS, runtime, minutes since the last output), the queue and the memory.
6. Keep `docs/` accurate for the subsystem you own. The next agent reads it cold.
7. **Never kill processes you didn't start.** No `pkill node`, `pkill blender`, `pkill chrome` or anything similar: other agents' runs share the machine (and other projects run here too). Record the PIDs you launch and stop only those. `node tools/doctor.mjs --cleanup` safely stops only ORPHANED tool processes (whose launching tool died) and removes stale locks.
8. **One shared dev server, shared browsers; clean up after yourself.** Every capture, perfbench, and preview uses `http://127.0.0.1:5190`. `tools/capture.mjs` stubs Vite's HMR client by default, so other agents' saves can't reload your page mid-capture (`--hmr` re-enables it). Do NOT start other servers. Production builds for perf A/B go through the same server: build with `npx vite build --base ./ --outDir public/_bench/<name>` (watch-ignored, gitignored) and open `http://127.0.0.1:5190/_bench/<name>/index.html?...`. **Browsers:** every tool launches its browser through `tools/lib/browser.mjs` `launchBrowser()` — never `chromium.launch()` directly. On WSL2, headless Chromium silently falls back to a CPU renderer (SwiftShader), so the launcher runs headed Chromium on a shared hidden Xvfb display (`:99`, `tools/lib/xdisplay.mjs`) where it renders on the RTX 5070; nothing appears on screen. `capture.mjs` prints the renderer as `gpu` and reports a CPU fallback as a page error. Browsers are capped machine-wide at `KCA_CAPTURE_SLOTS` (default 6): `capture.mjs` waits for a slot, and anything else that opens a browser must `acquire('capture', {slots: 6})` from `tools/lib/locks.mjs`. Kill every process you started as soon as its task is done (by PID).

## 1. World conventions
- **Units:** 1 unit = 1 metre. **Y up.**
- **Belt plane:** X is the scroll axis (the stage progresses toward +X). Z is the depth lane (+Z is toward the camera). Each stage defines its walkable Z band `[zMin, zMax]` (typically ~6 m deep) and X extents per screen.
- **Facing:** actors face ±X (`facing = +1 | -1`). Their models are yawed accordingly. Depth-plane "near-far" hit tolerance for melee is `|Δz| ≤ depthTol` (default 0.45 m), which is the classic belt-scroller rule.
- **Camera:** perspective, FOV ≈ 32°, sitting ~15–18 m in front (+Z) and ~5–7 m up, looking at the action centroid at ~1.2 m height. The camera rig handles smoothing, screen locks, drama zooms (magic, boss intros, finishing blows), shake (trauma model), and subtle banking on the eagle stage.
- **Time:** fixed-step simulation at **60 Hz** (`dt = 1/60`) with an accumulator. Rendering happens on rAF. There is a global `timeScale` (slow-mo), a global **hitstop** (freeze N sim ticks), and per-actor hitstop.

## 2. Rig contract (all humanoids: heroes, human enemies, skeleton, knights, ogres, bosses)
glTF node or bone names are EXACTLY:
```
root
 └ hips
    ├ spine └ chest ├ neck └ head [└ jaw]
    │               ├ clavicle_L └ upperarm_L └ forearm_L └ hand_L └ socket_hand_L
    │               └ clavicle_R └ upperarm_R └ forearm_R └ hand_R └ socket_hand_R
    ├ thigh_L └ shin_L └ foot_L └ toe_L
    └ thigh_R └ shin_R └ foot_R └ toe_R
optional chains (secondary motion): hair_1..N (child of head), beard_1..N (child of jaw/head), cape_1..N (child of chest), kilt_F/B/L/R_1..N (child of hips), tail_1..N (creatures), socket_back (chest)
```
- **Underscores only.** No dots, because Three.js `PropertyBinding` breaks on "." in names.
- **Rest pose = A-pose.** Arms ~40° down from horizontal, legs straight, palms down, model **facing +Z in glTF** (which is -Y in Blender). Feet on Y=0. The `root` bone sits at the origin on the ground, and `hips` is at pelvis height.
- `socket_hand_R` is the main weapon grip. The weapon mesh is a separate GLB or node, attached at runtime. Its grip point is at the local origin and the blade points along the socket's local +Y.
- Creature rigs (mounts, dragons, eagle, tortoise) define their own bone sets in `docs/ART_PIPELINE.md`.

## 3. Animation contract
- Clips are **authored in code** (`src/anim/clips/*.js`) as keyframes of **character-space rotation offsets from rest** (degrees, Euler order `'XYZ'`), plus hips translation offsets in metres. A retarget helper (`src/anim/retarget.js`) converts these to bone-local quaternions using each bone's rest orientation measured relative to the model root. The same clip then works on the JS placeholder rig and on every Blender GLB whose rest pose follows §2, regardless of per-bone local axes or armature node scale/rotation (verified by `?mode=showcase&what=rigtest`: max joint error 0 over every clip).
- **Axis convention (confirmed by FOUNDATION; right-handed):** character space **+X = forward (facing), +Y = up, +Z = the character's RIGHT**. (The draft said "+Z = left", which would be left-handed.) The model faces +Z in glTF, so char → model is `(x, y, z) → (−z, y, x)`. Signs: a rotation about **+Z** swings a hanging limb forward/up (raise arm or thigh forward, curl forearm) and tips the torso back, so a forward lean is **−Z** and a knee bend is **−Z** on the shin. **+Y** turns to the character's left. **+X** rolls the top toward the character's right; a hanging left arm abducts with +X and a right arm with −X. Mirroring L↔R: swap `_L/_R` and negate X and Y. Rotations are applied at the joint in FK order, in the rest frame (a child's offset is carried by its posed parent). `hips` translations are in character space on a reference rig with hips at 1.0 m and scale with the rig's hip height. `src/anim/poseKit.js` builds offsets from plain direction vectors (`arm('R', { upper, fore, blade, edge })`, `leg('L', { thigh, shin, toe })`) so most keys never need raw Euler angles. Worked example: `docs/ENGINE_API.md` §Clips.
- The runtime supports crossfades, additive layers (breathing, hit-react flinch, look-at), procedural secondary chains (hair, beard, cape, kilt springs), foot IK/planting for idle, animation events (`footstep`, `swingStart`, `hitFrame`), and per-actor time scale for hitstop.
- **Combat timing is authoritative in move data** (`src/characters/movesets/*.js`) in ticks. Clips are authored to match those ticks, and the Animator can time-warp a clip to a move's duration.
- Required clip names per humanoid (extend freely): `idle, walk, run, jump_up, jump_fall, land, light_1, light_2, light_3, light_4, heavy, heavy_charge, launcher, air_light, air_heavy_slam, jump_attack, run_attack, run_jump_attack, back_attack, grab, grab_hit, throw, dodge_roll, sidestep, hit_high, hit_low, knockdown, down_loop, getup, launched, death, magic_cast, taunt, victory, mount, dismount, ride_idle, ride_attack`.

## 4. Runtime architecture (precise APIs: `docs/ENGINE_API.md`)
```
src/main.js                 boot: parse URL mode, create Game, route to screen/showcase
src/core/                   Game loop, clock (fixed step, timeScale, hitstop, manual clock), Input (kb+gamepad, buffers,
                            double-tap), events bus, World (actors, spatial queries), Actor base, state machine, rng, safeImport, testhooks
src/render/                 Renderer (WebGL2, AgX/ACES tonemap, shadows), PostFX (bloom, grade/LUT, vignette, CA pulse, lens),
                            CameraRig, lighting presets, sky/env, shared shader chunks & materials library, quality presets
src/assets/                 AssetLoader (GLB via GLTFLoader, cache, clone skinned via SkeletonUtils), procedural textures, placeholder rigs
src/anim/                   retarget helper, Animator, clip library (clips/*.js per archetype), secondary motion, IK
src/characters/             Hero actor + controller, movesets/<hero>.js (frame data), hero definitions
src/combat/                 hitboxes/hurtboxes, CombatSystem (overlap → HitEvent), damage, knockback/juggle, grabs/throws, combo & style
src/magic/                  spell runner + spells/<hero>.js (per-tier choreography), cinematic magic camera
src/vfx/                    GPU particle system, weapon trails, impact sparks, dust, decals, screen FX (flash/shake/zoom), text popups
src/enemies/                enemy definitions (stats, visuals), per-type behaviour
src/ai/                     AI director (attack tokens, spacing, flanking), behaviour trees/FSMs, boss scripts
src/mounts/                 beast actors, riding/stealing logic, beast attacks
src/levels/                 LevelDirector (screens, locks, waves, GO arrow, triggers), stages/<id>.js (env build + script), props
src/ui/                     HUD, title, attract, character select, pause, options, continue, results/tally, high scores, stage cards
src/audio/                  WebAudio engine, synthesized SFX bank, procedural music sequencer, mixer/ducking
src/game/                   GameSession (players, lives, continues, score), flow state machine (screens), save/high scores
src/showcase/               showcase framework (Showcase.js ctx helpers) + kinds/<what>.js
```

**Boot & isolation.** `main.js` installs `window.__KCA`, creates `Game` (core), then imports every service module **lazily through `safeImport`**: `render/Renderer`, `render/CameraRig`, `assets/AssetLoader`, `anim/ClipLibrary`, `combat/CombatSystem`, `combat/ComboCounter`, `vfx/VfxSystem`, `magic/MagicSystem`, `audio/AudioEngine`, `ui/UI`, `ai/AISystem`, `ai/heroBot`, `mounts/MountSystem`, `levels/LevelDirector`, `game/GameSession`, `game/Flow`, `game/Pickup`, `game/debugHooks`. A module that fails to import or construct is logged (`__KCA.info().errors`, console) and replaced by a null service from `src/core/services.js` with the same API, so a broken VFX file removes sparks but not gameplay. Enemies are imported lazily by the level director and showcases, so a broken `enemies/**` file only breaks spawns. Content modules are found by auto-discovery registries (`src/core/registries.js`, Vite `import.meta.glob`, lazy, each load wrapped in try/catch): drop a file into the folder, never edit an index. Files starting with `_` are private helpers and are not registered.

| Registry (`registries.X`) | Folder | Default export |
|---|---|---|
| `heroes` | `src/characters/heroes/<id>.js` | hero definition (stats, proportions, palette, asset id, moveset id, magic pots/tiers) |
| `movesets` | `src/characters/movesets/<id>.js` | `{ id, moves: { moveId: MoveDef } }` (60 Hz frame data) |
| `enemies` | `src/enemies/types/<id>.js` | enemy type (stats, visuals, `behaviour`, `ai`, `moves`, `tiers`, optional `create`) |
| `behaviours` | `src/ai/behaviours/<id>.js` | `{ id, create(enemy, game, params) → { update(dt) } }` |
| `bosses` | `src/enemies/bosses/<id>.js` | `{ id, name, create(game, opts) → Actor }` |
| `stages` | `src/levels/stages/<id>.js` | stage module (`zBand`, `extents`, `lighting`, `build(ctx)`, `screens`, `next`) |
| `props` | `src/levels/props/<id>.js` | `{ id, create(ctx, opts) }` |
| `spells` | `src/magic/spells/<id>.js` | spell book `{ id, element, maxTier, tiers, cast(ctx, hero, tier) }` |
| `effects` | `src/vfx/effects/<id>.js` | `{ id, preload?(vfx), spawn(vfx, opts) }` |
| `mounts` | `src/mounts/types/<id>.js` | `{ id, name, hp, speed, attacks, create?(game, opts, { Mount, def }) }` |
| `clips` | `src/anim/clips/<id>.js` | clip set `{ rig, character?, priority?, clips: { name: ClipDef } }` |
| `screens` | `src/ui/screens/<id>.js` | `{ id, create(ui, opts) → { el, update?, dispose?, onAction? } }` |
| `showcase` | `src/showcase/kinds/<what>.js` | `{ id, setup(ctx) }` |
| `sfx` / `music` | `src/audio/banks/<id>.js` / `src/audio/music/<id>.js` | `{ id, sounds: { name(ctx, out, opts) } }` / `{ id, start(engine, opts) → { stop() } }` |
| `pickups` | `src/game/pickups/<id>.js` | `{ id, build(ctx), onCollect(game, hero, pickup), glint? }` |

**Services on `game`** (any optional one may be a null stub): `renderer` (Renderer: `scene`, `envGroup`, `lighting`, `post`, `webgl`), `cameraRig`/`camera`, `world`, `bus`, `input`, `rng`/`fxRng`, `assets`, `anim`, `combat`, `combo`, `vfx`, `magic`, `audio`, `ui`, `ai`, `bots`, `mounts`, `levels`, `session`, `flow`, `spawnPickup(kind, x, z, opts)`. Systems run in `order` each 60 Hz tick: bots −10 · input 0 · timers 5 · ai 10 · world 20 · mounts 25 · combat 30 · combo 35 · level 40 · magic 45 · session 50 · flow 55 · vfx 60 · showcase 70 · camera 80 · ui 90 · audio 95 · debugDraw 99. Global hitstop (`game.hitstop(ticks)`) skips `freezable` systems; per-actor hitstop (`actor.hitstop`) freezes one actor; `game.slowmo(scale, hold)` ramps `game.timeScale`; `game.after(ticks, fn)` and `game.wait(ticks)` are sim-clock timers.

**Events** (`game.bus`; the catalogue and payloads live in `src/core/EventBus.js` `EV`): `hit, whiff, attackStart, attackActive, ko, knockdown, getup, land, jump, footstep, dodge, spawn, despawn, magicSelect, magicCast, magicEnd, magicImpact, potPickup, pickupSpawn, screenLock, screenClear, go, waveStart, stageStart, stageClear, playerJoin, playerDown, playerOut, respawn, continueStart, continueTick, continueTaken, gameOver, bossPhase, bossIntro, combo, comboEnd, score, flowState, camera, mount, dismount`. Use `bus.scope()` so listeners die with your stage or showcase, and namespace new private events (`'mounts:riderOff'`).

## 5. URL modes (every subsystem must be showcase-able in isolation)
- `/?mode=title` is the full game from the title screen (the default when no mode is given).
- `/?mode=stage&stage=<1-5|bonus|duel>&p1=<brann|seraphine|gorrim>[&p2=...][&bot=1][&seed=N][&screen=K]` jumps straight into gameplay. `bot=1` makes AI drive the players (for captures and attract mode).
- `/?mode=showcase&what=<kind>&id=<id>[&anim=<clip>][&cam=<preset>][&tier=N]` shows isolated turntables and tests.
  - `what=hero|enemy|mount|boss&id=...&anim=...` shows the model on a lit plinth, playing a clip.
  - `what=moveset&id=<hero>` shows the hero performing the move list vs dummies.
  - `what=magic&id=<hero>&tier=N` casts a spell vs a group of dummies.
  - `what=stage&id=<stageId>&cam=<preset>` does an environment flythrough or a fixed camera.
  - `what=vfx&id=<effect>`, `what=ui&id=<screen>`, `what=ai&id=<scenario>`, `what=audio`.
  - `what=rigtest&id=<hero>&anim=<clip>` compares one clip on the placeholder rig and on a scrambled-axes, scaled-armature copy (retarget check).
- Extra params: `&debug=1` (hitbox/hurtbox/band overlay + error toasts), `&pots=N` (stage mode: start with N magic pots; bots default to 3), `&difficulty=easy|normal|hard`, `&nopost`, `&mute`, `&nocache` (bust the GLB cache), `&placeholder=1` (force procedural characters even when GLBs exist).
- `&capture=1` is appended by the capture tool, which enables the manual clock and hides the cursor. `&quality=low|high`.

## 6. Test hooks: `window.__KCA` (src/core/testhooks.js)
`ready: Promise` resolves when the requested mode has fully loaded (assets and shaders compiled, two frames rendered). `setManualClock(bool)` (on by default with `&capture=1`) · `advance(ms): Promise` (waits for tracked async loads, steps the sim by fixed 60 Hz ticks, renders exactly one frame at the end, so HUD DOM text/classes are current when it resolves) · `input.press(player, action, ms)` (holds for `ms` of SIM time, one press edge), `input.hold(player, action, down)`, `input.releaseAll()`, with `player` 1|2 and actions `left right up down light heavy jump magic dodge start`. These go through the players' virtual devices, the SAME path as keyboard and gamepad (buffers, double-tap run) · `events(type?, sinceTick?)` → recent bus events `[{ type, tick, summary }]` with `tick > sinceTick` (actors appear as `kind:type#id`; an event's tick is the `game.tick` after the step that emitted it, so `sinceTick = game.tick` read before acting means "from now on") · `info()` → `{ ready, mode, fps, drawCalls, triangles, geometries, textures, programs, actors, enemies, heroes: [{ id, hero, hp, maxHp, x, y, z, state, pots, tier, player }], tick, time, timeScale, stage: { id, screen, wave, phase, screens }, flow, session, quality, errors[] }` · `game` (the live Game) · `register(ns, obj)`.
`debug.*` (src/game/debugHooks.js): `spawn(type, x, z, opts)` (enemy type, pickup `'pot'`/`'food'`, or mount id) · `setHP(target, hp)` · `kill(target='enemies')` (target: actor id, `'p1'`, `'p2'`, `'enemies'`) · `god(on)` · `pots(player, n)` (**adds** n, clamped to capacity) · `cast(player, tier)` · `timeScale(s)` · `hitstop(ticks)` · `hitboxes(on)` (debug overlay) · `skinCheck(target='p1')` (CPU-skins the actor's mesh in its current pose and reports stretched triangles by bone pair, to catch bad GLB weights) · `actors()` · `heroes()` · `events(type)`.
`showcase.*` is registered per kind via `ctx.expose()`: hero/enemy/boss → `play(clip)`, `setYaw(deg)`, `clips()`, `actor`; moveset → `actor`, `dummies`; magic → `cast(tier)`; vfx → `fire()`, `effects()`; ai → `tokens()`; audio → `play(name)`, `sounds()`; rigtest → `compare()`, `play(clip)`, `clips()`. Ready-made scenarios: `tools/scenarios/smoke.mjs` and `tools/scenarios/combo.mjs` (see `docs/ENGINE_API.md` §Scenarios).

## 7. Capture, compare & progress tooling
- `node tools/capture.mjs --url "<mode url>" --out progress/shots/<item>/r<N> [--frames 60 --step 33 --sheet --mp4] [--scenario tools/scenarios/<x>.mjs] [--size 1600x900]` runs headless **Edge on the real GPU** and prints JSON with files, page errors, and perf info. **Always read the printed pageErrors and consoleErrors.** View PNGs with the Read tool.
- `node tools/blindpair.mjs --ours <png> --ref <refs/...> [--ref ...] --out progress/compare/<item>-r<N>` writes `blind.png` (A/B/C tiles in random order) and `key.json`. Critics judge `blind.png` FIRST, write their verdict, and only then open `key.json`.
- `node tools/progress.mjs --item <id> --title "<title>" --wave <W> --status <queued|building|critic|passed|failed|blocked> --iter N [--score X --verdict PASS|FAIL --gap "..."] [--note "..."] --shot <png> [--clip <mp4>]` updates the live progress page at `http://127.0.0.1:5190/progress/`.
- `refs/` holds reference images (Golden Axe series and modern quality-bar games). See `refs/REFERENCES.md` for the index. **Reference images are for internal comparison only. Never ship or publish them.**

## 8. Performance budget — two tiers (owner, 2026-10-26)
- **Low = GTX 1650 Ti** (`quality=low`, 1080p): every stage × phase ≤ 12 ms on the ≈1650 Ti estimate (docs/PERF.md). Achieved; it must stay true.
- **High = RTX 4080-class baseline** (`quality=high`): graphics and VFX may now aim much higher. Until a 4080 calibration exists, High at 2560×1440 must hold ≤ 12 ms GPU on the dev box's RTX 5070 (≈ 70-75 % of a 4080), i.e. 60 fps on the target with margin. Heroes and bosses may use up to 75k triangles; anything that would push Low over budget needs a Low path (LOD, fewer particles, cheaper shader).
The numbers below were the original single-tier budget (1650 Ti at 1080p "High"); they now apply to **Low**:
≤ 400 draw calls, ≤ 1.5 M triangles on screen, ≤ 1 shadow-casting directional light (plus fake shadows or blobs for extras), and a post chain ≤ 4 ms. Use instancing for foliage, debris, and particles. Merge static environment geometry per screen. Texture budget ≤ 2K per hero atlas. The `quality=low` preset disables SSAO-like effects, reduces the shadow map, and halves particles.

## 9. File ownership (edit only what you own; the orchestrator assigns owners per wave)
| Path | Owner |
|---|---|
| `src/core/**`, `src/main.js`, `index.html`, `src/game/**` | foundation / integration agent |
| `src/render/**` | look-dev agent |
| `src/assets/**` | foundation (loader), art agents may add to `src/assets/manifest.js` (additive) |
| `src/anim/**` | animation agent |
| `src/characters/**`, `src/combat/**` | combat agent |
| `src/magic/**`, `src/vfx/**` | magic/VFX agent |
| `src/enemies/**`, `src/ai/**` | AI/enemies agent |
| `src/mounts/**` | mounts agent |
| `src/levels/LevelDirector.js`, `src/levels/props/**` | level-systems agent |
| `src/levels/stages/<id>.js` + `src/levels/stages/<id>/**` | that stage's environment agent |
| `src/ui/**` | UI agent |
| `src/audio/**` | audio agent |
| `blender/<asset>.py`, `public/assets/models/<asset>*.glb` | that asset's art agent; `blender/lib/**` is owned by the pipeline agent (others add, never break) |
| `docs/DESIGN.md`, `docs/ARCHITECTURE.md` | orchestrator (agents may fill in FOUNDATION sections and their own subsystem notes) |
