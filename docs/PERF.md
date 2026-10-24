# PERF — measuring performance on a machine that is never quiet

Owner: perf-1650. Target hardware: the dev laptop's **GTX 1650 Ti (4 GB), 1920×1080, High preset at 60 fps with no
hitches**, plus a Low preset. Since 2026-10-20 development runs on a much faster machine (WSL2, RTX 5070), so raw
ms there are ~10× lower than on the target: read the **≈1650 Ti ms** column (§0). The machine also runs other agents'
browsers, Blender builds and other apps, so **wall-clock fps is not a measurement here**. Every perf claim has to come from `tools/perfbench.mjs`,
which reports numbers that don't change much with background load. `/?mode=bench` is the human-facing,
wall-clock check you can run on a real headed browser.

## 0. Measuring for the 1650 Ti from another GPU
`tools/perfbench.calib.json` stores the calibration kernel's idle ms per GPU (1650 Ti: 1.379 ms/draw; RTX 5070 under
WSL2: 0.144). perfbench multiplies every estimate by their ratio (≈9.58) and reports it as **≈1650 Ti ms**; JS slice
times are normalised to the laptop's CPU kernel the same way. Check (2026-10-20): stage 1 worst phase ≈8.8 ms
(laptop measured 9.22), stage 5 boss ≈9.96 ms (laptop 10.75), so the conversion is within ~10 % and slightly
optimistic. The deterministic budgets (calls, triangles, pass pixels, overdraw, programs) are hardware-independent and
still the primary gate; confirm on the real laptop before calling a perf item done.

## 1. The rules

1. **Never add render cost without a perfbench number.** New effect, shader, pass, light, or stage content → run
   perfbench on the affected stage × phase before and after (`--baseline HEAD` does both in one interleaved run).
2. **Budgets are measured in units that don't depend on load** (section 3). The fps you see in a capture is not one of them.
3. **0 gameplay program compiles** and **no synchronous JS slice of our code > 50 ms** during gameplay or transitions.
4. Keep the High look at game distance. If a cut changes pixels, compare stills (`tools/capture.mjs`) before landing it.

## 2. perfbench in one screen

```
node tools/perfbench.mjs                                    # build working tree; stages 1-5 × reveal,combat,cast,boss; High; 1920x1080
node tools/perfbench.mjs --stages 3,5 --phases combat,cast --quality high,low
node tools/perfbench.mjs --baseline HEAD --stages 5         # A/B working tree vs HEAD, interleaved ABAB in ONE browser
node tools/perfbench.mjs --baseline self --url-extra "&freeze=0"   # A/B a runtime toggle on the same build
node tools/perfbench.mjs --repeat 3 --stages 1,5            # repeatability (CV column)
node tools/perfbench.mjs --stages 5 --phases combat --parts all    # GPU cost split (hide one part at a time)
node tools/perfbench.mjs --stages 5 --cpuprof --nominify    # V8 CPU profile per phase: where main-thread JS goes
node tools/perfbench.mjs --stages 1,4 --phases combat --no-gpu --no-overdraw --nominify   # allocation hunt (fast)
node tools/perfbench.mjs --stages 1,3 --phases cast --no-gpu --od-mats     # transparent overdraw by material
node tools/perfbench.mjs --dev                               # measure the shared dev server itself (unbundled)
node tools/perfbench.mjs --stages 1 --phases combat --no-gpu --od-heat             # overdraw heat-map PNG per checkpoint
node tools/perfbench.mjs --stages 1 --phases combat --no-gpu --od-mats combat --od-opaque   # split the OPAQUE layers
```

It builds a production bundle into `public/_bench/<name>` (`tools/perfbench.vite.mjs`: base `./`, `public/` is NOT
copied; `cand` = working tree, `<sha>` = a git baseline built from a worktree) and opens it as
`http://127.0.0.1:5190/_bench/<name>/index.html` on the ONE shared dev server — **perfbench starts no servers**
(ARCHITECTURE §0 rule 8). The bench browser fulfils `/_bench/<name>/*` from the build directory (exact production
bytes) and forwards every other `/_bench/<name>/<path>` to `:5190/<path>` (public assets). This routing is required:
Vite's dev server only serves public files it saw at startup (its watcher ignores `_bench`), so a build made after the
server started falls through to the SPA index.html — i.e. silently the DEV app. The browser holds one of the 2
machine-wide capture slots (`tools/lib/locks.mjs`) for the whole run, and a page / GPU-process crash re-opens the
pages and retries that phase once (`--retry`). It drives a GPU browser through `tools/lib/browser.mjs` (WSL2: headed
Chromium on the hidden Xvfb display → ANGLE/OpenGL → D3D12 → the real GPU; Windows: headless Edge, ANGLE/D3D11). It
uses the **manual clock** (`__KCA.setManualClock`) and fixed seeds (`mode=stage&bot=1`, heroes Brann + Seraphine),
and it runs **`drs=0`**, so every run renders the same frames at native resolution. The in-page kit
(`tools/perfbench.page.js`) only touches long-lived engine internals, so the same kit also measures old baselines.
Output: `progress/tmp/perf/bench/<stamp>/summary.md` (+ `perfbench.json` with raw samples).

Phases (`PB.pre` → sampled `PB.window`):
- `reveal`: the first 1.2 s after `__KCA.ready` (stage card, curtain lift).
- `combat`: 7 s of bot fighting (god mode), then a 1 s window.
- `cast`: both heroes cast their top tier. Checkpoints are taken at 0 / +0.7 / +1.4 s of the spell, and the worst one is reported.
- `boss`: skip to the last screen, start the boss wave, wait for the `bossIntro` bus event, then 4 s of fight with the boss kept immortal.

## 3. The metrics

### 3a. Deterministic budget metrics (exact, independent of load)
| column | what | budget (High 1080p) |
|---|---|---|
| calls / tris | `renderer.info` of one frame | ≤ 250 calls |
| passPx 1080p | Σ over every GL draw run of its viewport area ÷ 1920·1080 (shadow map 2048² = 2.02, scene = 1, each full-res post pass = 1, bloom mips ≈ 0.33 total). C2: 7.69 = shadow 2.02 + scene (env depth pre-pass drawn inside it) 1 + bloom 0.67 + main 1 + SMAA 3 | ≤ 8 |
| od mean/p95/max (T) | **measured overdraw**: each material is replaced by a clone that writes 1 (opaque → R, transparent → G) with additive One/One blending into a float RT, keeping the same depth state and order → shaded fragments per pixel | spells: mean ≤ 3, p95 ≤ 8 |
| opaqueOdd | opaque draws with renderOrder ≠ 0, depthWrite off, or depthTest off (sky/backdrop layers). This audit exists for early-z: something drawn before the opaques shades every pixel it covers | — |
| vramEstMB / texMB / rtMB | textures (incl. mips, compressed sizes) + render targets + geometry buffers | ≤ 1.5 GB |
| casters / skinned / bones | shadow casters, skinned meshes, bones | — |
| alloc KB/f | V8 sampling heap profiler over the window, **including objects already collected by GC** ÷ frames; `alloc.top` gives the allocating functions | ≤ 100 KB/frame |
| new prog | programs linked during the phase (`cacheKey` diff), with the parameter that created the variant and the materials using it (`name{idx:old>new}[mat@object]`) | **0** |
| JS p50/max | per-frame synchronous JS (`game.step` ticks + `renderFrame`), attributed per system when > 50 ms (`slices.big`). The `idle-norm` values are divided by the CPU contention factor (a fixed JS kernel `cpuCal` ÷ its idle time) | max ≤ 50 ms |

### 3b. GPU frame time that holds up under load
Each GPU **sample** has two parts, taken back to back:
1. a **calibration kernel**, a fixed synthetic full-screen workload (ALU + texture) with its draw count matched to the frame window's length, timed with `EXT_disjoint_timer_query_webgl2`;
2. a **blocker** of kernel draws, queued and `gl.flush()`ed first, so the GPU stays busy while the CPU records the frames. Then a burst of 2 identical frames (`renderer.render`, shadow map forced) inside one `TIME_ELAPSED` query.

A sample is **valid** only if the burst's CPU submit time is < 0.5 × the blocker's GPU time. In a valid sample the GPU was never starved waiting for commands, so the query holds pure GPU time. The blocker adapts to the recent submit cost (capped at 300 ms: long GPU queues risk a driver reset on this shared laptop). Invalid samples are discarded, and sampling continues up to 3× the requested count.

Contention on this GPU is **bimodal** (another process's burst either overlaps a window or it doesn't) and sometimes
**steady** (a long Blender render). A second calibration window right after the burst brackets it, and every valid
sample is classified by its two calibration readings c1, c2 (ms per kernel draw) against `calIdle` — the kernel's
idle ms per draw (`tools/perfbench.calib.json`, **frozen** at 1.379 ms/draw; `--calibrate` re-derives it):
- **clean**: both ≤ 1.3 × calIdle (`--clean`) → the GPU was uncontended around the burst;
- **stable**: contended, but c_max ≤ 1.12 × c_min (`--stable`) and ≤ 4 × calIdle → steady proportional sharing.
Each is normalised `frame × calIdle / mean(c1, c2)` (clock throttling and proportional sharing cancel). Estimate
`est GPU ms` (the quiet-machine GPU frame time), by tier: ≥ 8 clean → p25 of clean (**clean**); else ≥ 4 clean → p25
of clean (**f**n, few); else ≥ 6 clean + stable → p25 of both (**s**n — an UPPER BOUND: steady contention slows the
scene more than the kernel, repeat3 S1 cast read 8.2–12.7 ms stable vs 7.0–7.3 clean); else `noisy` = p10(frame) ÷
p10(cal) × calIdle — NOT a measurement (it mixes contention states), re-run when the GPU is quieter. A phase with
several checkpoints (cast) reports the worst checkpoint among those of the best tier present.
Sampling continues up to 4 × `--samples` attempts while clean < samples.

Other defences:
- The bench browser's processes (browser, GPU process, renderers; found by a marker switch on its command line plus
  its descendants) run at **AboveNormal** priority, so other agents' CPU load can't starve the submit or the
  GPU-process decode (`--no-prio` turns this off).
- A/B: `--baseline <git ref | dist dir | self>` opens both builds in the same browser and alternates samples ABAB…,
  so both see the same contention. `cand/base` = ratio of the p25s of their clean (else clean + stable) normalised
  samples, with a bootstrap 95 % CI. Two 1080p pages at once is heavy on a 4 GB card: prefer one-target suites plus
  A/B only for the phases in question.
- Allocation keys are `allocating fn < caller < caller's caller` (who allocates matters more than the three.js leaf).
- `--od-mats [phases]`: transparent overdraw split by material (each material's objects drawn alone: raw
  fragments/pixel mean / p99 / max) — tells you which FX layer owns a spell's overdraw. `hot` = that material's mean
  layers inside the **hot mask** (pixels with ≥ 9 layers in the full frame; its share of the screen is printed first) —
  the p95 owners. `--od-opaque` splits the opaque layers instead. `--od-heat` writes `odheat_s<stage>_<phase>_<cp>_<tgt>.png`
  (¼ res; grey = layers × 24, red ≥ 9, yellow ≥ 13, blue tint = transparent share).
- `slices.big[]` (JS frames > 50 ms) carry the frame index and `rsub` = Renderer sub-timings of that frame
  (patch+look / freeze / guard / scans / draw, ms).
- `/?mode=bench` results carry `spikes[]`: every frame gap > 100 ms with its segment, programs linked since the previous
  frame (name + cache-key tail), DRS change and JS heap — a program link vs a resize vs plain contention.
- `--parts`: cost split. Each pair (full frame, frame with one part hidden) is measured back to back.
  `share = 1 − median(part/full)`, with a bootstrap CI of the median. Parts: shadowPass, casters, post, smaa,
  bloomBlur, env, actors, vfx, transparent, instanced, sky, earlyZ (backdrops after opaques), pr085 (0.85 pixel
  ratio); `envkids` adds one toggle per env child.

GPU budgets (est, High 1080p): **≤ 12 ms in every stage × phase** (incl. top-tier spells and boss fights), **Low ≤ 8 ms**.
The remaining ~4 ms of the 16.7 ms frame covers compositor, DOM/HUD raster and headroom.

### 3c. Known limits
- Post passes read 0 on per-pass ANGLE timer queries. Only whole-burst queries work, which is why the design above times whole bursts.
- `est` ignores the browser compositor and DOM raster (the HUD). Those were measured separately with
  `tools/scenarios/steadytrace.mjs` (CDP trace per thread, see docs/notes/perf-1650.md r2).
- Manual-clock JS per frame includes kit instrumentation and the CDP sampler (≈ +10–20 %), so the 50 ms slice rule is conservative.
- **DOM animations are paused (and the UI layer hidden) while GPU samples are taken** (`quietDom`, `--no-quiet` off).
  CSS animations run in real time under the manual clock (spell cut-in card, boss band, forge glints: 3 infinite ones
  in every cast/boss window) and their raster + compositing shared the GPU with the timed windows: before this, every
  cast/boss cell read "noisy" even on a quiet machine. The log prints `dom anims N run, M inf` per checkpoint.
- The overdraw pass swaps every material for a counting clone. In **stage 4 only**, JS allocations measured AFTER the
  first overdraw pass read ~0.9 MB/frame (V8 starts boxing matrix writes — cause not found; not the clones' userData).
  Real S4 values (`--no-overdraw`): combat 205, boss 280 KB/frame. Use `--no-overdraw` when hunting S4 allocations.
- `GL ERRORS` lines: once per stage the kit renders one frame with every draw call checked (`gl.getError`) and names
  the program + materials of any failing draw (a GL_INVALID_OPERATION draw is silently skipped by the driver).

## 4. Repeatability (the harness proving itself)
Suite run 3× back to back under normal busy conditions (other agents running). Target: CV of the normalised metrics ≤ 5–7 %.

**Recorded 2026-09-28** (`--repeat 3 --stages 1,5 --phases combat,cast`, run `repeat3`, 1080p High, three fresh pages
per cell, other agents' captures and a Blender build running):
| cell | est GPU ms rep 1 / 2 / 3 (tier) | CV | overdraw mean/p95 | calls |
|---|---|---|---|---|
| S1 combat | 6.99 / 7.15 / 7.13 (clean ×3) | **1.2 %** | 2.33/8 ×3 | 155 ×3 |
| S5 combat | 9.40 / 9.36 / 9.56 (clean ×3) | **1.1 %** | 2.30/5 ×3 | 153 ×3 |
| S5 cast | 10.85 / (noisy) / 11.05 (clean) | **1.3 %** (clean reps) | 2.53/5 ×3 | 156 ×3 |
| S1 cast | clean checkpoints 7.04, 7.30, 7.04 · stable 8.16 / 10.79 / 12.67 | clean 2.1 % | 3.02/10, 3.02/10, 2.76/9 | 156/156/154 |
Clean-tier GPU estimates repeat within ~1–2 %; deterministic metrics (overdraw, calls) are identical rep to rep
when the bot's fight plays out the same (S1 cast rep 3 differed by one spell hit). The S1 cast row is why the
stable tier is now ranked below few and treated as an upper bound.

## 5. In-game benchmark (for the human)
`http://127.0.0.1:5190/?mode=bench` (options `&stages=1,2,3,4,5&secs=14&p1=brann&quality=low|high`). A real-time
bot run of each stage with the shipped frame loop, DRS and pacing: 14 s of combat, then a top-tier spell (4 s),
then the boss arena (intro + 8 s). The `&perf` overlay stays on the whole time. It ends on a results card with per-stage
**median / 1 %-low frame time**, the preset, the internal resolution and the DRS scale. Press R or click to run again.
These are wall-clock numbers, so run it on a quiet machine or treat them as indicative.

**Automated runs (r4): always exclusive.**
```
KCA_EXCLUSIVE=1 node tools/capture.mjs --realtime --url "/?mode=bench&stages=1,2,3,4,5" --scenario tools/scenarios/perf_bench.mjs --out progress/tmp/perf/<run>
```
`KCA_EXCLUSIVE=1` makes capture.mjs claim `progress/locks/capture.want` (`tools/lib/locks.mjs` `claimPriority`) BEFORE it takes its first
slot: every capture started afterwards leaves free slots to the claimant, the running ones drain (5–20 min on a busy day — 6 agents,
3 slots), then `perf_bench.mjs` takes the remaining slots (`tools/lib/exclusive.mjs`), reloads the page, raises the browser's
processes to ABOVE_NORMAL and runs (~7 min). The log must say `exclusive=true`; a non-exclusive card is not a measurement (it
is what QA sees when another agent's page shares the GPU: S1 combat 6.8 s and cast 8.4 s single frames with `renderer.render`
itself blocked 8.3 s and 14 ms of JS — the GPU process / OS starved by the neighbour). `PB_EXCLUSIVE=0` skips it. Without
`KCA_EXCLUSIVE` the scenario still waits for the other slots (old behaviour, can starve: a 20-minute wait ended contended).
**Perf QA must run the bench this way.** Per stage the log prints median / 1 %-low / worst, `js` = sim + render JS per frame
(`sim`, `ren`, steps per frame, renderer sub-steps patch/freeze/guard/scans/draw), the probe GPU span, every rAF gap > 100 ms
(segment, new programs, DRS, heap, JS of that frame), the actor census and — with `&fd=1` — the FIRST-DRAW list (below).

### 5b. r4: what made the realtime bench freeze (root causes found, all measured)
1. **VRAM grew with every stage** (fixed). One page playing S1→S5 held GPU-process dedicated memory 612 → 625 → 943 → 1072 → 1156 →
   1178 MB (a fresh S5 page: 613 MB); live GL textures 126 → 406. `tools/scenarios/texleak.mjs` (EventDispatcher 'dispose' hook =
   registry of every live texture tagged with the stage that uploaded it): 957 of ~1000 MB of live textures were GLB ImageBitmaps
   (heroes, enemy tiers, BOSSES — a boss is 3 × 2048² = 64 MB, the Brute Brothers 128 MB) kept by `AssetLoader.cache` for the whole
   session; three never frees an uploaded texture until `texture.dispose()`. The 4 GB card already carries ~1 GB of desktop (dwm 0.8 GB,
   explorer, Discord, the agents' own windows) and up to 3 headless game pages → WDDM overcommit → paging stalls with no shader
   link, no DRS change, no heap change. FIX: `AssetLoader.releaseGpu({keep})` from `StageRunner.startStage` (heroes of the run stay
   resident; the prewarm re-uploads what the stage draws behind the curtain); `Actor.dispose` also frees each clone's Skeleton
   bone texture. After: 615 / 714 / 683 / 686 / 615 MB at S1…S5, live textures 340 → 225. `&gpurelease=0` turns it off (A/B).
2. **First-DRAW compiles** (fixed; bench `&fd=1` + `tools/fdaudit.mjs`). ANGLE/D3D11 builds a program's HLSL executables at its first
   DRAW, not at link — 100–2000 ms in the GPU process for a big PBR/skinned shader, and the next sync GL call waits for it.
   (a) every stage's vfx pools (`vfx_debris`, `vfx_shape`, `vfx_shape_lit`, `vfx_add`, `kca-depth-instanced`) and dynamic effects
   were empty at the prewarm (InstancedMesh.count / instanceCount / drawRange.count = 0 → no draw call) → compiled at the first hits of
   the fight (the 100–250 ms combat spikes): the prewarm now bumps each pool to one degenerate instance for its warm draws.
   (b) **mounts have no `modelRoot`, so `lookForActors` never patches them**: a fresh mount draws with the plain standard program
   until `bossRim` patches it (the wyrm: after its rider finishes spawning = several frames). The prewarm only LINKED that program
   (unpatched inset variant) → the S3 boss start stalled 0.6–2.6 s (8.4 s contended) at the Cinderwyrm's first frame. The prewarm now
   draws each warm mount once, unpatched, into the scene target (`rep.mountUnpatched`). (c) boss-lock fade variants of S2's
   `ringoutPosts` / `tortoise_leg` / lanterns are warmed regardless of the band test (`_occluders.fadeWarmProxies`).
   `fdaudit --boss --cast` (S1–S5): FIRST-DRAWN after the boss start = 0.
3. **28+ `GL_INVALID_OPERATION … texture format and sampler type` per boot** (fixed): `CutIn.update`'s first inset draw (boot prewarm)
   ran before any shadow map existed (`tools/glboot.mjs`: getError after every draw + JS stack). 0 errors now.
4. **Neighbours and Blender on an 8-thread laptop** (harness, not code): a second page on the GPU, or a Blender build at normal
   priority (34 threads) starving the renderer / GPU main threads, produces single rAF gaps of 1–8 s with 10–20 ms of JS (one such
   2.6 s gap still appeared in an exclusive run: S5 combat, no program / texture / GC / DRS event). `tools/blender-run.mjs` now runs
   Blender at BELOW_NORMAL, the bench browser at ABOVE_NORMAL, and `KCA_EXCLUSIVE=1` keeps other pages off the GPU.
5. **What is left: the boss segments of S2/S3/S4 sit at 33.3 ms (CPU-bound).** `tools/scenarios/bosscpu.mjs` with a 320×180 canvas
   (GPU ≈ 0): S2 boss sim 1.7 + systems.render 5.5 (world/Animator 4.5) + renderer.render 15 ms = 22 ms per frame on this
   heat-throttled 4-core CPU, i.e. the frame cannot reach 16.7 whatever the resolution. renderer.render parts (A/B, same page): env
   −6 ms (91 meshes, 24 programs), actors −5.5, shadow pass −3, post −2.3, depth pre-pass −1.5 (`R.prepass.enabled=false`),
   1 788 GL calls per frame (689 uniform*, 203 bindTexture, 181 activeTexture, 130 bindVertexArray, 84 useProgram, 12 bone-texture
   uploads). No single hot function (flat V8 profile: updateMatrixWorld/multiplyMatrices/setFromRotationMatrix ≈ 19 %, setProgram
   uniform upload ≈ 26 %). Levers for the next round: merge static env meshes per material (stage owners), fewer shadow casters,
   batch the IK `setWQ` subtree updates (`RigPost._rot`: ~30 force-updates/frame), drop the pre-pass when the frame is CPU-bound.

Diagnosis tools (r4): `texleak.mjs`, `stagemem.mjs`, `vramcensus.mjs` (GPU-process dedicated MB via the Windows counter — whole-GPU MB from nvidia-smi on Linux — + texture census),
`glerrors.mjs` / `tools/glboot.mjs`, `tools/fdaudit.mjs` (linked-but-undrawn programs after the prewarm; `--boss [--cast]`; `--warmmount`),
`glcount.mjs` (GL calls per frame by function), `mwcount.mjs`, `bosscpu.mjs` (env `BC_SMALL=320x180` = CPU-only A/B), `bossprof.mjs`
(V8 profile per subtree — unpaced manual-clock loops show GPU backpressure as `uniformMatrix4fv` self time, use BC_SMALL),
`benchtrace5.mjs` (`BT_FROM=cast BT_TO=end` traces the boss window), `benchprof.mjs`, `benchvram.mjs`, `perf-freshtrace.mjs` (all three hold
every capture slot now). Bench options for diagnosis: `&probe=1` (every GL call > 25 ms logged with its JS stack, per-system update/render
ms per spike and per segment — inflates JS 2–3×, attribution only), `&gputimer=0`, `&gpusegs=1` (per-pass GPU queries; default ONE per
frame), `&fd=1` (first-draw program log + texture uploads ≥ 512 px after the fight starts). Tracing.start / Profiler.start themselves cause
0.7–3.3 s gaps at their start, and a reload in the same browser hides first-compile stalls (the GPU process keeps its shader caches) —
`perf-freshtrace.mjs` traces from a FRESH browser.

### 5c. Wave C1: the QA / baseline command set (repeat these on a quiet machine)
Every number in the C1 results (§6) came from these commands. Run them in this order (the exclusive bench must not overlap
anything else of yours); evidence goes to `progress/qa/perf-c1/<run>`. Label every result with the machine state (`uptime`
load, other captures / Blender running).
```
# 1. realtime 5-stage bench, exclusive (takes all KCA_CAPTURE_SLOTS; ~7 min once it has them, but it blocks every other
#    team's captures while it drains the slots — 18+ min on a busy day). WAVE RULE (orchestrator, C1): only at wrap-up on a
#    quiet machine; during a wave use the non-exclusive tools below. The quiet-machine baseline = exactly this, twice:
KCA_EXCLUSIVE=1 node tools/capture.mjs --realtime --url "/?mode=bench&stages=1,2,3,4,5" --scenario tools/scenarios/perf_bench.mjs --out progress/qa/perf-c1/quiet_bench1 --timeout 2400000
KCA_EXCLUSIVE=1 node tools/capture.mjs --realtime --url "/?mode=bench&stages=1,2,3,4,5" --scenario tools/scenarios/perf_bench.mjs --out progress/qa/perf-c1/quiet_bench2 --timeout 2400000
#    read: the log must say exclusive=true; every cell's 1 %-low < 100 ms, no frame > 250 ms, medians ≈ 16.7, DRS 100 % on the
#    RTX 5070; record `uptime` load before/after. (On Linux boostBrowser() can't raise priority — it prints 0; that's expected.)
# 2. GPU / programs / JS budgets, all stages × phases, High + Low, 1080p (~60 min)
node tools/perfbench.mjs --quality high,low --out progress/qa/perf-c1/pb_suite
#    JS slices > 50 ms without the GPU sampler's blocker floods, with a V8 profile per phase (attribution)
node tools/perfbench.mjs --stages 1,2,4 --phases combat,cast --quality high,low --no-gpu --no-overdraw --cpuprof --nominify --out progress/qa/perf-c1/pb_js
# 3. stage reveal + boss appearance in real time, arcade entry (title → map → stage), per stage N = 1..5 (~3 min each)
BI_STAGE=N node tools/capture.mjs --realtime --url "/?mode=title" --scenario tools/scenarios/bossintro.mjs --out progress/qa/perf-c1/bi/sN --timeout 300000
# 4. what the GPU process does at the reveal (Skia ops inside each raster flush), and the prewarm's shader-compile timeline
WP_STAGE=N RT_SKIA=1 RT_AFTER=1500 node tools/capture.mjs --realtime --url "/?mode=title" --scenario tools/scenarios/revealtrace.mjs --out progress/qa/perf-c1/reveal/sN --timeout 300000
CP_STAGE=N node tools/capture.mjs --realtime --url "/?mode=title" --scenario tools/scenarios/compileprobe.mjs --out progress/qa/perf-c1/compile/sN --timeout 300000
# 5. programs linked / first drawn after the boss start (incl. a spell), per stage
node tools/fdaudit.mjs "/?mode=stage&stage=N&p1=brann&bot=1" 3000 --boss --cast
```
`bossintro.mjs` windows: `reveal10s` (curtain lift + 10 s), `bossSpawn` (boss wave start → `bossIntro` event), `bossIntro`
(−1 s … +3 s around the event), `bossAll`. Per window: worst rAF gap, min fps over any 500 ms, longtasks, and every gap ≥ 50 ms
with that frame's JS (sim / render), programs linked and textures uploaded; with the V8 profile (`BI_PROF=reveal,boss`) the
top functions inside each gap and longtask. "≈laptop" = raw × 13.6 / this page's cpuCal (JS-bound work only — a gap with
little JS is GPU-process / compositor time and does not scale that way). `cardwipe.mjs` shoots the stage card's wipe at fixed
wall-clock times (look check for any card CSS change).

**This machine's shader path is slow (C1 finding).** ANGLE → OpenGL → Mesa d3d12 compiles ~0.5 s per program, serially in the
GPU process (`compileprobe.mjs`: 59 programs, link → ready p50 1.9 s, max 34 s), so each stage's prewarm curtain lasts
40–60 s here (one page) — a dev-box property, not the laptop's (ANGLE/D3D11 compiles in parallel worker threads). The
prewarm therefore waits for programs as long as they keep finishing (`waitPrograms`, 15 s stall / 150 s cap) instead of a
fixed 30 s cap.

## 6. Results log
(see below; newest last)

### 2026-09-28 · perf-1650 round 2 — before/after, 1920×1080 High (drs=0, manual clock, Brann + Seraphine)

BEFORE = `aa7ba76` (round-2 start: end of perf r1). AFTER = working tree on top of `683b794` (runs `after2_high` + `after3_cb`
under progress/tmp/perf/bench/). GPU est cells are marked with their estimator tier when not **clean** (§3b);
"noisy" = the machine was too contended during that window — not a measurement. Budgets: GPU ≤ 12 ms, spell
overdraw mean ≤ 3 / p95 ≤ 8, 0 gameplay compiles, JS slices ≤ 50 ms.

| q | stage | phase | GPU est ms before → after | overdraw mean/p95 before → after | calls | passPx | JS max ms (idle-norm) before → after | alloc KB/f before → after | new prog before → after |
|---|---|---|---|---|---|---|---|---|---|
| high | 1 | reveal | 7 → **6.57** | 3.64/8 → 2.35/7 | 130 → 135 | 8.69 → 8.94 | 41.3 → 49.2 | 200 → 187 | 0 → 0 |
| high | 1 | combat | 7.39 → **7.01** | 3.86/9 → 2.55/8 | 141 → 145 | 8.69 → 8.94 | 616.6 → 25.9 | 242 → 179 | 0 → 0 |
| high | 1 | cast | 12.27 (noisy) → **7.02** | 4.23/11 → 2.91/9 | 153 → 155 | 8.69 → 8.94 | 27.1 → 51.2 | 219 → 312 | 1 → 0 |
| high | 1 | boss | 21.24 (few) → **7.76** | 4.06/10 → 2.52/7 | 126 → 139 | 8.69 → 8.94 | 16.6 → 19.9 | 109 → 130 | 0 → 2 |
| high | 2 | reveal | 7.88 → **7.36 (stable)** | 3.27/6 → 2.27/5 | 120 → 127 | 8.69 → 8.94 | 38.8 → 45.7 | 237 → 225 | 0 → 0 |
| high | 2 | combat | 14.99 (noisy) → **6.88 (noisy)** | 2.83/5 → 1.75/4 | 146 → 146 | 8.69 → 8.94 | 34.1 → 42.5 | 290 → 231 | 0 → 0 |
| high | 2 | cast | 18.83 (noisy) → **7.71** | 3.13/6 → 2.18/5 | 146 → 143 | 8.69 → 8.94 | 41.2 → 50.3 | 281 → 342 | 1 → 0 |
| high | 2 | boss | 31.03 (noisy) → **8.7** | 3.09/5 → 2.38/5 | 116 → 127 | 8.69 → 8.94 | 27.7 → 1914.4 | 145 → 177 | 0 → 5 |
| high | 3 | reveal | 9.8 → **9.17** | 4.44/9 → 3.21/7 | 64 → 64 | 8.69 → 7.94 | 45.2 → 43.6 | 186 → 160 | 0 → 0 |
| high | 3 | combat | 9.53 (stable) → **8.37 (stable)** | 4.12/7 → 3.71/6 | 85 → 86 | 8.69 → 7.94 | 25.8 → 48.6 | 234 → 186 | 0 → 0 |
| high | 3 | cast | 42.64 (noisy) → **8.59** | 4.66/8 → 3.51/7 | 87 → 77 | 9.69 → 7.94 | 47.1 → 45.7 | 269 → 268 | 1 → 0 |
| high | 3 | boss | 9.24 (noisy) → **9.09** | 2.92/5 → 2.62/5 | 57 → 69 | 8.69 → 7.94 | 35 → 18.8 | 107 → 141 | 34 → 2 |
| high | 4 | reveal | 10.9 → **6.94** | 3.67/7 → 2.26/5 | 85 → 105 | 8.69 → 8.94 | 60 → 44.5 | 406 → 193 | 0 → 0 |
| high | 4 | combat | 11.54 (stable) → **7.43 (stable)** | 3.83/7 → 2.3/5 | 119 → 133 | 8.69 → 8.94 | 54.3 → 41.1 | 1234 → 876 | 1 → 0 |
| high | 4 | cast | 36.1 (noisy) → **7.03** | 3.89/7 → 2.28/5 | 118 → 113 | 9.69 → 8.94 | 59 → 54.2 | 1136 → 275 | 1 → 0 |
| high | 4 | boss | 20.22 (noisy) → **8.53** | 3.8/6 → 2.22/5 | 115 → 138 | 8.69 → 8.94 | 48.1 → 40.5 | 972 → 616 | 1 → 1 |
| high | 5 | reveal | 9.41 → **7.94** | 2.64/4 → 1.64/3 | 87 → 104 | 8.69 → 8.94 | 47.5 → 38.2 | 193 → 192 | 0 → 0 |
| high | 5 | combat | 10.34 (stable) → **9.31 (stable)** | 2.86/5 → 2.04/4 | 116 → 165 | 8.69 → 8.94 | 24.5 → 26.7 | 244 → 221 | 1 → 0 |
| high | 5 | cast | 34.02 (noisy) → **8.25** | 3.21/6 → 1.8/4 | 119 → 120 | 8.69 → 8.94 | 54.7 → 46.3 | 307 → 246 | 0 → 0 |
| high | 5 | boss | 25.81 (noisy) → **9.12 (stable)** | 3.01/5 → 1.91/5 | 102 → 152 | 8.69 → 9.94 | 33.6 → 32.2 | 172 → 252 | 1 → 1 |

Reading it:
- **GPU: every stage × phase is ≤ 9.3 ms** est at 1080p High (budget 12). The before column is mostly noisy for
  cast/boss (the old build has no DOM quieting — its SMIL glint rastered every frame), but where both are clean/stable
  the cuts are clear: S4 reveal 10.9 → 6.9, S4 combat 11.5 → 7.4, S5 reveal 9.4 → 7.9, S3 reveal 9.8 → 9.2.
- **Overdraw** fell in every cell (early-z for backdrops + env depth pre-pass): S1 combat 3.86 → 2.55, S4 3.83 → 2.30.
  Still over the spell budget: S1 cast p95 9 (stage-1 smoke + fire columns, `--od-mats`) and S3 cast mean 3.5 (eagle
  feather cards are alpha-tested, 2.2 opaque layers; an alpha-tested feather pre-pass was tried: overdraw 3.6 → 3.1
  but GPU A/B 1.03 [0.89, 1.08] — no gain, reverted).
- **Allocations**: the r2 cut that mattered was the pre-pass light-hash flip (three re-derived every lit program every
  frame). S4 after-values are inflated by the harness (§3c): real S4 combat 205, boss 280 KB/frame.
- **New programs** left are all in boss phases and all bosses-owned: S1 brute-twin materials, S2 captains (placeholder
  body while the GLB is being built) + an env-wide relink with a **1.9–4.9 s** `renderer.render` stall at the S2 boss
  intro, S3 boss sprite/basic FX, S4 occluder `#fade` clones (compiled async by design), S5 one depth variant.
- **JS slices**: > 50 ms only at the S2 boss intro (above) and one 51–54 ms cast frame in S1/S2/S4 (idle-normalised,
  includes kit instrumentation ≈ +10–20 %).

### 2026-09-28 · 1920×1080 Low (after only; runs `after_low` + `after_low2`)
| stage | combat | cast | boss |
|---|---|---|---|
| 1 | 4.32 | 4.92 | 4.93 |
| 2 | 5.43 | 4.94 | 5.19 |
| 3 | 4.89 | 8.69 (noisy) | 5.41 (few) |
| 4 | 5.10 | 7.34 (noisy) | 6.54 (noisy) |
| 5 | 6.16 | 6.64 | 6.16 |
Every clean / few Low cell is ≤ 6.2 ms (budget 8); the three noisy cells come from contended windows (not a
measurement — re-run S3/S4 cast on a quieter machine). Low renders at 0.8 × and SMAA LOW (passPx 4.3–4.9 vs 7.9–8.9).

### 2026-09-28 · perf-1650 round 3 — the last gaps (1920×1080 High, runs under progress/tmp/perf/r3/)
BEFORE = perf QA r2 findings on `1fce3b7`/`9f2d3a9`; AFTER = working tree (runs `final_high`, `final_boss`, `ab_s35`,
`ab_s34`, `h7`, `js5`, realtime `bench4`). A/B = cand/base vs HEAD `9f2d3a9` on clean samples, 95 % CI.

| fail from QA r2 | before | after |
|---|---|---|
| boss-phase program links | S2 4–5 (env `#fade` clones) + 3.2–4.0 s renderer.render; S1 2 (brute `\|bossLook` order); S3 2 (name-tag sprite, fade basic) | **0 in every stage's boss phase**; boss JS max 30 / 42 / 30 / 32 / 32 ms (S1–S5, idle-norm) |
| S1 boss measured | null ("NO BOSS": harness killed the group-boss members) | **8.71 ms clean 16/16**, od 2.98/8 |
| spell overdraw S1 cast p95 | 11 | **7** (2.62/7; hut fire clusters: shared heat/soot, denser fewer smoke puffs) |
| spell overdraw S3 cast mean | 4.03 | **2.73** (cloud sea 3 planes → 1 pass, puff fringe discard, hull after feathers) |
| JS cast slices | S1 55–58, S5 61 ms | S1 28 / S2 37 / S3 28 / S5 42 ms (suite, idle-norm); no-sampler: S1 43, S5 30 ms |
| realtime bench S1 | combat worst 3233, 1 %-low 1716 ms | combat worst 667, 1 %-low 200; cast worst 67; boss worst 50 ms (busy machine) |
| S5 floor neon grid | 3 critics | sett border matte (spec 0.1), bevel lines gone, ragged grime margins; A/B S5 combat 0.962 [0.875, 1.212] |

GPU est (ms, High 1080p, clean unless marked): S1 combat 7.65 · cast 7.71 · boss 8.71 — S2 8.85 · 10.73 (few) ·
10.47 — S3 8.15 · 8.31 · 9.99 — S4 9.49 (stable) · 8.85 (stable) · 9.65 — S5 8.82 · 9.86 · 11.09 (stable). Every
cell ≤ 11.1 ms (budget 12). A/B vs HEAD: S3 cast 0.985 [0.868, 1.054], S4 cast 1.027 [0.893, 1.206], S5 cast 1.022
[0.98, 1.13] — the look/overdraw cuts cost nothing on the GPU estimate.
Residual: the realtime bench shows one ~0.7–1.1 s rAF gap in the first 1.5 s of the fight with no program link, DRS
change or heap drop; a CDP trace (tools/scenarios/benchtrace.mjs) shows no single main-thread task > 350 ms, only a
1.2 s concurrent Maglev compile. Suspect: JIT tier-up of the fight code under contention. Re-check on a quiet headed browser.

### 2026-09-30 · perf-1650 round 4 — the realtime-bench freezes (runs under progress/tmp/perf/r4b/, evidence in progress/shots/perf-1650/r4s2/)
Real-time `/?mode=bench&stages=1,2,3,4,5` on the dev server, 1600×900 High (DRS on), Brann bot, **exclusive** (`exclusive=true`). Cells are
median / 1 %-low ms. BEFORE = QA r3 (`S3 combat 6080 ms`, `S1 combat 2195 ms` single frames, non-exclusive) and the session-1 exclusive card1.

| stage | combat card1 → card3 → card4 | cast card1 → card3 → card4 | boss card1 → card3 → card4 |
|---|---|---|---|
| 1 | 16.7/33.6 → 16.7/73.9 → 16.7/73.8 | 16.9/66.9 → 16.8/50.1 → 16.7/33.7 | 16.7/54.3 → 16.8/83.4 → 16.7/39.2 |
| 2 | 16.7/52.4 → 16.7/58.4 → 16.7/45.4 | 16.7/41.8 → 33.2/50.2 → 33.2/50.2 | 16.7/133.5 → 33.4/125.1 → 33.3/91.6 |
| 3 | 16.7/35.6 → 16.7/52.5 → 16.7/42.9 | 16.7/33.4 → 16.8/33.5 → 16.7/66.7 | 33.6/100.3 → 33.3/83.4 → 33.4/74.9 |
| 4 | 16.7/50.1 → 16.7/38.2 → 16.7/75.0 | 16.7/33.4 → 16.7/50.2 → 16.8/83.4 | 16.7/77.9 → 33.3/66.8 → 33.3/67.7 |
| 5 | 16.7/21.1 → 16.7/38.2 → **16.7/560** | 16.7/50.2 → 16.7/41.8 → 16.8/67.0 | 16.7/50.0 → 16.7/44.5 → 33.2/91.7 |

* No multi-second stall in any exclusive card except ONE 2 577 ms rAF gap in card4 S5 combat (20 ms of JS, no program / texture / GC /
  DRS / heap event; Blender build running) — an OS/GPU-process starvation event, not a code path. Card3's only 1 %-low ≥ 100 is S2 boss
  (one 183 ms frame at the boss lock = the S2 fade-variant first draws, warmed by name since). The first-draw list (`&fd=1`) of card4 is
  empty except the boss name-tag canvas (512×96) and one S2 fade variant + one S4 env shader (~100–180 ms each).
* Card5 (same code + ABOVE_NORMAL bench browser) was taken while the laptop ran at **36–55 % of its nominal CPU clock** (Windows "%
  Processor Performance") with two Blender jobs queued: medians 33–50 ms in every stage and a 1.68 s S1 boss frame — the CPU, not the game.
  The bench card now prints a **CPU ×** column (kernel speed vs the nominal clock per segment): judge a cell only when it is ≥ ~0.8.
* Medians of the S2/S3/S4 boss segments (and S2 cast) stay at 33.3: CPU-bound, see §5b.5.

GPU-process dedicated memory, one page, S1 → S5 in a run (MB): before 633 / 947 / 1081 / 1142 / 1209 → after 615 / 714 / 683 / 686 / 615
(live GL textures 340 → 225). Console `GL_INVALID_OPERATION` per boot: 28+ → 0. perfbench (final tree, 1080p High, S2/S3 × combat/boss; run pbfinal): est GPU 7.7 / 8.45 / 7.49 ms and S3 boss 11.31 (noisy 1/80 — not a measurement; r3 clean value 9.99),
0 new programs in every cell, JS p50 (idle-norm) 19.2 / 19.8 (S2), 14.6 / 16.5 (S3) — budgets met, no render-cost change (prewarm draws are behind the curtain;
release / re-upload happens during the stage load).

### 2026-10-20 · Wave C1 (perf-1650 QA of r4 + chapter1-integration r3) — WSL2 RTX 5070, busy shared machine
Evidence and full tables: `progress/qa/perf-c1/SUMMARY.md` (commands: §5c). Load avg 4–164 during the wave (6 teams, Blender).
- **Realtime exclusive bench** (1600×900 High, DRS on), bench1 (r4 tree) → bench2 (final): every median 16.7 in both; 1 %-low max
  50.1 → 35.5; worst frame 67 → 50 ms; frames ≥ 100 ms 9 → 0 (bench1's were the stage-card raster at the reveal); DRS 85–95 % →
  100 % everywhere. The r4 multi-second freeze does not reproduce on this machine.
- **perfbench 1080p** (all 40 cells clean 20/20): ≈1650 Ti GPU High 6.99–10.73 ms (max S2 combat), Low 4.60–7.09 → budgets 12 / 8
  met; 0 new programs everywhere. JS frames > 50 ms (laptop-norm) only inside the GL draw submission (backpressure; pb_js with
  --cpuprof: native `uniformMatrix4fv` dominates, our JS ≈ 10 ms) — not a code slice.
- **Fixes**: (1) stage card wipe animated as a mask (styles.js) — reveal GPU raster 399 → 114 ms, largest flush 160 → 29 ms;
  (2) DRS steps down only when the per-frame GPU timer says the GPU is loaded (≥ 11 ms) — no more contention-driven resizes;
  (3) prewarm waits for slow shader compiles while they progress (no fixed 30 s cap; curtain failsafe re-armed) — S5's
  late-linked boss-window programs 10 → 0; (4) prewarm warms Morvane's lazily built FX material (bosses/_fx.js scaleMat).
- **This machine's shader compile is ~0.5 s per program, serial** (compileprobe): 40–60 s prewarm curtains here. Re-measure the
  curtain time on the laptop before judging load times.

### 2026-10-23 · Wave C2 r1 (perf-1650 iter 6) — boss-entry stall, passPx, select screen, light budget
Evidence + full write-up: `docs/notes/perf-1650.md` 'Wave C2 r1 (iter 6)', `progress/shots/perf-1650/c2r1b/`.
- **S3 boss entrance**: the two ~435 ms GPU-process flushes were the boss look's recoloured 1024² atlases (`_wyrmLook.js`)
  created + uploaded mid-entrance. Now one shared copy per atlas, built at map time, uploaded + drawn behind the stage
  curtain (prewarm BOSS_WARM `maps`). bossSpawn worst 33–133 ms over 4 busy-machine runs, no 4xx ms flush.
- **passPx 8.94 / 9.94 → 7.69** everywhere: CA pulse inside the main pass (`&cafold=0`), bloom luminance fused into its
  first blur level (`&bloomfold=0`), env depth pre-pass drawn inside the colour pass after the shadow map
  (`&prepassold=1`). Frozen-frame A/B (`tools/scenarios/prepass_ab.mjs`): pre-pass max |Δ| 0, folds max 1/255 (forced CA
  pulse: 503 px > 8/255 in tiny highlights). GPU same-build A/B all within ±1.5 % (CA fold S5 cast 0.991 [0.981, 0.995]).
- **Depth pre-pass never links on screen** (readiness guard + early `prepare()`), select screen light count 12 → 8, the
  light-budget warning now names the stage / screen and fires per stage.
- perfbench tip for busy waves: other agents' runs rebuild the shared `public/_bench/cand` mid-run (lazy chunk 404 →
  a spell module missing). Build privately (`PB_OUT=/tmp/<name> node node_modules/vite/bin/vite.js build --config
  tools/perfbench.vite.mjs`) and pass `--dist /tmp/<name>`.
