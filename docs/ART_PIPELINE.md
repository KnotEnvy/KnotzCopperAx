# KnotzCopperAx — Procedural Art Pipeline (Blender 5.2, headless)

Owner: art-pipeline agent (`blender/lib/**`, `tools/viewer.*`, `tools/validate-glb.mjs`). Other art agents **add**
to `blender/lib` (new functions, new optional parameters with defaults) but never change existing defaults or
signatures without updating every caller and this document. Reference implementation: `blender/build_hero_brann.py`
(hero) and `blender/build_weapon_grudgebrand.py` (weapon).

Everything is generated from code: signed-distance-field (SDF) sculpts → hi-poly bake sources + decimated game
meshes → artist-style UV charts → per-vertex painted materials baked by Cycles → one PBR atlas → skinned GLB.
No third-party art, no hand-painted files.

## 1. Commands

```bash
B="node tools/blender-run.mjs --"     # the wrapper (docs/ARCHITECTURE.md §0 rule 5); always -b --factory-startup
$B -b --factory-startup -P blender/build_hero_brann.py -- --preview head   # clay review renders (~20 s)
$B -b --factory-startup -P blender/build_hero_brann.py -- --preview full   # body+gear+hands+kilt+mane (~90 s)
$B -b --factory-startup -P blender/build_hero_brann.py -- --fast --stage skin   # LO meshes + weights + QA only (~2 min)
$B -b --factory-startup -P blender/build_hero_brann.py -- --fast           # whole pipeline, 1024 atlas (~6 min)
$B -b --factory-startup -P blender/build_hero_brann.py                     # release: 2048 atlas, fine bake (~20 min)
$B -b --factory-startup -P blender/build_weapon_grudgebrand.py             # weapon only (~2 min)
node tools/validate-glb.mjs public/assets/models/hero_brann.glb              # contract validator (exit 1 on FAIL)
node tools/capture.mjs --url "/tools/viewer.html?model=/assets/models/hero_brann.glb&view=three-quarter" --out <dir>
node tools/capture.mjs --url "/?mode=showcase&what=hero&id=brann&anim=walk&nocache" --frames 24 --step 50 --sheet --out <dir>
```
Preview PNGs land in `progress/shots/<item>/dev/`. Build reports (tris per part, UV fill, stretch QA, timings) land
in `blender/out/<asset>_report.json`. Run long builds in the background and poll the log; never open the UI.

Build options (hero script): `--fast`, `--no-weapon`, `--stage skin`, `--device AUTO|OPTIX|CUDA|CPU`,
`--skin sdf|heat`, `--body-tris 16000 --head-tris 5200 --hand-tris 1150 --kilt-tris 3000 --mane-tris 5600`,
`--save-blend` (writes `progress/tmp/<asset>_build.blend` for debugging).

## 2. Budgets

| Asset | Triangles | Atlas | Notes |
|---|---|---|---|
| Hero | ≤ 30 000 (Brann ≈ 27 k) | 2048² albedo + normal + ORM | head region ≥ 5 k tris, face ≥ 1.75× texel density |
| Human enemy | ≤ 18 000 | 1024–2048 | share lib parts, vary style dicts |
| Boss / mount | ≤ 40 000 / ≤ 25 000 | 2048 | |
| Weapon | ≤ 3 000 | 1024 | separate GLB, grip at origin |
| Prop | ≤ 5 000 | ≤ 1024 | merge statics per screen |
One skinned mesh + one material per character (1–2 draw calls). Textures are embedded as WEBP (q90).
Heroic read at gameplay distance (~180 px tall on screen): exaggerate silhouettes — broad blades, capped
shoulders, heavy hair masses. Detail below ~5 mm lives in the normal map, not in geometry.

## 3. Library map (`blender/lib`)

| Module | What it gives you |
|---|---|
| `sdf.py` | primitives (`Sphere, Ellipsoid, RoundCone/Capsule, RoundBox, Torus, Chain, HalfSpace, Slab, Inter, Union, Diff, SymX, Offset, Shell, Displace, Warp, Bounded`), `Sculpt` (`add/sub/inter(prim, k, mat)`, `paint(prim, channel)`, `snapshot()`, `dist/grad/project/eval_points`), `polygonize(S, h, lo, hi)` (OpenVDB, chunked narrow band) |
| `rig.py` | `landmarks(P)` proportions → joints/hand frames; `build_armature(L, name, hair_chain, kilt_chain, extra)` (contract rig); `CONTRACT_BONES` |
| `anatomy.py` | parametric humanoid: `torso, torso_details, arm, arm_details, hand, hand_details, leg, foot, head, eyebrows, separate_legs`; helpers `Frame, HeadFrame, groove, surf_chain, surface_hit, resample` |
| `gear.py` | conforming costume built on a body snapshot: `bracer, boot, belt, strap, medallion, torc, studs_on, scalp_cap, kilt_sculpt, fur_band, ellipse_ring` |
| `hair.py` | `groom_swept` (designed swept-back manes/tails — preferred), `groom` (simulated drape), `clump_sculpt` (SDF clump volume, hi = grooved sub-strands + forked tips), `path_attrs` (along / lock_id / lateral / flow per point), legacy `LockSet` ribbons |
| `pipeline.py` | `setup_cycles`, `sculpt_mesh` (hi + paint attributes), `lowpoly` (polygonize → region-budget decimate), `region_unwrap`, `smart_project_faces`, `normalize_density`, `pack_atlas_skyline`, `Baker`, `final_material`, `strip_for_export`, `export_glb` |
| `shaders.py` | per-vertex **painters** (`PAINTERS`: skin, eye, nail, brow, hair, mane, leather, fur, bronze, iron, cloth…), node-side micro detail (`MICRO`: pores, grain, hammered, weave, strands), `paint_mesh`, `assign_bake_materials`, `set_pass`, `srgb` |
| `skin.py` | weighting (`skin()`), anatomical restriction (`restrict_adjacent`, `ADJ`, `CHAIN_PARENTS`), `skirt_weights`, deformation QA (`stretch_report`, `TEST_POSES`, `pose_bones_char`), `debug_dominant` |
| `weapon.py` | swept blades with fuller (`blade_mesh`), `rune_strokes` + `engrave`, `nick_edges` |
| `preview.py`, `meshutil.py` | clay contact sheets; numpy ⇄ mesh helpers |

### 3.1 Parametric body
`rig.landmarks(P)` takes a proportions dict (defaults in `rig.DEFAULT`; Brann: `BRANN` in his script):
`height, head_h, shoulder_x, shoulder_z, clav_in_x, hip_x, hip_joint_z, pelvis_z, knee_z, ankle_z, foot_len,
stance_x, spine_z, chest_z, neck_z, head_base_z, upperarm, forearm, hand, arm_down (A-pose °), arm_fwd, elbow_bend`.
The same landmarks drive the sculpt and the armature, so bones always sit inside the mesh.

Style dict (`anatomy` functions read what they need; 1 = default):
`muscle, defin, fat` · silhouette masses `chest, lats, traps, waist, delts, arm, forearm, neck` (V-taper =
lats/delts/traps > 1, waist < 1; ogre = waist > 1) · head (`anatomy.HEAD_STYLE`) `brow, jaw, scowl, cheek, chin,
nose_len, nose_w, nose_bump, lip, mouth_w, eye, squint, skull_w, skull_h, ear, fem` (`fem` 0..1 softens brow/jaw/nose,
fuller lips, bigger eyes — use it for Seraphine). Hands: `anatomy.hand(S, L, side, pose="grip"|"relaxed")`.

Head construction (reuse, do not fork): skull → face planes → mandible chain + square chin → brow bar → carved
sockets → real eyeball spheres (material `eye`, iris painted by `p_eye` from `eyes/eye_r/eye_fwd`) → lids = skin
shell over the eyeball opened by an almond aperture (the `squint` plane covers the top of the iris) → nose with
downward nostrils → muzzle, bowed upper lip, full lower lip → ears. Paint channels on the head: `stubble, lips,
blush, scar` (see `scars_and_paint`/`scar_cut` in the Brann script for ray-traced scars).

### 3.2 Hair
Use `hair.groom_swept(S_body, head_centre, region_fn(dir), exit_fn(dir), length_fn(dir), n, width, thick,
clearance, clear_add, fall_bend, wave)` then `hair.clump_sculpt(clumps, detail="hi"|"lo")`. Every clump arcs over
the scalp to `exit_fn(root_dir)` (nape / behind the ears) and then falls with body collision, so hair can never
flop over the face. The LO sculpt keeps the same silhouette (forked tips included) without the strand grooves; the
HI sculpt carries 3 sub-strands per clump for the normal bake. `path_attrs` gives the painter (`p_mane`: value
jitter, strand streaks, clump-edge/root shading, painted Kajiya-Kay sheen) and the skinning (root → head) what
they need. Beards: same functions with a jaw-rooted `region_fn` and `exit_fn` pointing down. Fur trims:
`gear.fur_band`. Tails/manes of beasts: `groom_swept` from a neck/tail frame.

### 3.3 Costume
Build gear on `snap = S.snapshot()` of the finished body: `Bounded(Inter(Offset(snap, t), region), lo, hi)`
fuses leather/metal into the body mesh (no floating shells, deforms with the skin). Separate meshes only for
things that must move independently (kilt/skirt strips, mane, capes, hands). After boots and trims, call
`anatomy.separate_legs(S, L, top_z)` with `top_z` hidden under the kilt/skirt so the legs are distinct surfaces.

## 4. Mesh, UV, bake

1. **HI** bake sources: `pipeline.sculpt_mesh(S, name, h)` (body h 2.1 mm, head 0.9 mm via `keep_box/drop_box`,
   hands 0.7 mm, kilt 1.6 mm, mane 1.1 mm; `--fast` roughly doubles h). Paint channels become `p_<chan>` point
   attributes; materials become face material indices.
2. **LO** game meshes: `pipeline.lowpoly(S, name, h, tris, regions=[(mask_fn, tris)])` — coarse polygonize,
   exact per-region budgets (the face gets its own), collapse-decimate with X symmetry, triangulate.
   Optional `clean=fn(ob)` hook runs on the raw polygonized mesh before decimation (hero-seraphine r2 uses it to
   drop loose specks / internal bubbles left by smooth-max cut corners). **Cut-edge rule** (Seraphine r1 FAIL: torn
   shards): cut a gear shell with cutters whose surface meets the body at a steep angle (never a capsule coaxial
   with a limb or a ball concentric with a dome), and put rolled rims on the KEPT side only
   (`Inter(Offset(snap, t+e), Diff(Offset(C, w), C))`) -- a `Shell(C)` rim hovers over bare skin.
3. **Skin before UV** (charts follow the dominant bone): see §6.
4. **UV**: `region_unwrap(body, face_region=dominant bone, cfg)` gives artist-style charts with a meridian cut on
   the hidden side of every limb (`uv_regions` in the Brann script); `smart_project_faces` + `normalize_density`
   for hands (1.3), kilt (0.85), mane (0.95); head density 1.75. `pack_atlas_skyline(meshes, margin_px, res)`
   packs everything into one atlas.
5. **Paint + bake**: `shaders.assign_bake_materials(hi, names)` + `shaders.paint_mesh(hi, names, L, PAL, extra)`
   (custom painters via `painters={name: fn}`; `PAL` = named sRGB colours). `pipeline.Baker(res, jobs, ...)` bakes
   selected-to-active on Cycles (OPTIX → CUDA → CPU fallback), per-job cage extrusion / max ray distance
   (body 12/30 mm, hands 6/14, kilt 5/12, mane 6/16). Passes: `albedo` EMIT 4 spp, `prm` (rough, metal, emit)
   EMIT 2 spp, `ao` EMIT 64 spp (32 fast), `normal` tangent-space 8 spp.
6. **Composite** (`composite_maps`): AO + cavity tint multiplied into albedo (warm tint, painterly), ORM =
   (AO, roughness, metal), 16 px dilation, PNGs in `public/assets/textures/<asset>_*.png`, embedded in the GLB as
   WEBP.
7. **Export**: `pipeline.final_material` (one Principled material), `strip_for_export`, `meshutil.join`,
   `pipeline.export_glb(path, [armature, mesh])` (+Y up, skins, rest-position armature, 4 influences, no anim).

## 4.1 Colour and value blocking (mandatory — Brann r1 FAILED on this)
A character must read at gameplay distance (~180 px tall, AgX tone mapping, which **desaturates and lifts**) as
**4+ clearly separated value groups**, the way Dota/Smite/SoR4 heroes do. In r1 Brann was one tan value head to toe
(tan skin, tan leather kilt, tan boots, a "black" mane that measured neutral grey under its sheen) and lost the
blind comparison at a glance. Rules:
- Plan the value ladder first and write it as a comment above `PAL`. Brann: skin (bronze, albedo luma ~43%) >
  crimson tartan kilt (~27%) > near-black leather harness/bracers/boots (~12-17%) > blue-black mane (~6%);
  metals (bronze, steel) are the bright accents, fur a neutral grey-brown.
- Neighbouring big shapes must differ in **value**, not just hue (a red kilt next to tan skin at the same
  value still blobs together in greyscale). Rec.709 luma of saturated reds is low, but AgX lifts them: Brann's
  first crimson kilt (158,20,28) rendered at the SAME grey value as the bronze skin; the tartan base had to drop to
  ~(90,12,20) with near-black and dark-green over-checks to sit a clear step below the skin.
- Push saturation ~15-25% above the look you want: AgX pulls it back (lit skin albedo (172,112,78) rendered
  as (179,136,113)).
- Black hair: albedo ~(13,15,22) with roughness ~0.8 and a very small cool sheen (`hair_sheen` 0.15,
  `hair_hi_amt` 0.08, `hair_hi` blue-grey). Low roughness + a grey sheen = grey hair at distance, and the engine's
  actor rim light turns a glossy mane into a white cap (r2 build#1). No high-frequency
  noise/cross-hatched micro normals on hair (reads as snakeskin/latex).
- Painters read tunables from `PAL`: `<key>_rough`, `<key>_hi`, `<key>_hi_amt` (hair mass / brows),
  `hair_sheen`, `tartan=(period, [(offset, width, rgb), ...])` (woven sett on `cloth`, world-space around the
  hips), `browpaint` paint channel (painted brow hair under the sculpted brow), `scar` (pale, glossier, no dark
  cavity — deep scar grooves bake a dark AO line that reads as dirt).
- `gear.kilt_sculpt(..., strip_mats=("cloth",), flap_mat="leather_dark")` switches the strips from leather to
  cloth (default = the r1 mixed leather strips).
- **Verify**: viewer `view=game&grey=1` capture + `__KCA.viewer.probe()` (per-group mean L* of the rendered
  pixels at named body points; groups should differ by >= ~10 L*).

- **Material winner gotcha** (`sdf.Sculpt`): `S.add(prim, k)` with `mat=None` keeps whatever material already won
  at that point. A shell added over a coloured primitive (eyelids over the eyeball, a strap over a buckle) inherits
  the coloured material unless you pass `mat=` explicitly. Brann r1/r2 had 'goggle eyes' because every eyelid point
  was still `eye` (sclera): lids are now `mat="skin"`.
- **No sub-voxel features**: a primitive thinner than ~2x the polygonize step (head h=0.9 mm) aliases into slots,
  dotted lines and notches (Brann's 0.5 mm philtrum capsules read as two vertical cuts; a 1.4 mm chin-cleft capsule
  read as a slot). Carve fine landmarks as a soft `S.sub(Ellipsoid(...), k)` with k >= 4 mm instead, and keep small
  add-pads (modiolus, under-eye, nasolabial) under ~3 mm radius with wide blends or the face goes puffy/jowly.
  Always check `--preview face` (clay, h=0.8 mm) before a 50-minute release build.

## 4.2 Weapons
`lib/weapon.py`: `blade_mesh` (exact swept section, fuller, point), `rune_strokes` + `engrave` (emissive runes),
`nick_edges`; hilts are SDF sculpts baked like characters. Grip point (dominant hand) at the origin, blade +Z in
Blender (= +Y glTF), flat facing ±Y, edges ±X. Read at gameplay distance first:
- A two-handed greatsword (Grudgebrand): ~1.40 m overall, blade 9 -> 7.4 cm with a wide fuller, a big STRAIGHT
  crossguard (~34 cm) with block terminals, a ~30 cm two-hand grip + heavy pommel. Curled quillons read as a
  sabre/rapier; a thin dark blade reads as a rapier.
- Steel: bright albedo (~170-230), metalness ~0.6-0.9 (a pure metal renders black in a dark arena env).
- Two-hand hold: left-hand grip point at weapon-local y = -0.14 (`GRIP_L_Z`). Both fists are sculpted `grip`.
  The socket convention is NOT mirrored (+X = character right for both sockets), so a left fist on the same grip
  must use the weapon frame half-turned about the blade axis (`Qw * Ry(180)`), otherwise the wrist needs ~170 deg
  of twist (see `twoHandIK` in `tools/viewer.js`).
- **Attachment nodes (contract)**: every weapon GLB exports empty nodes as children of its mesh node, in the
  weapon frame: `grip_main` (origin, dominant hand), `grip_offhand` (two-handed weapons only: where the off hand
  holds; the engine's two-hand IK target), `blade_tip` / `head_tip` (point of the blade / axe head, for trails and
  reach). Create them as Blender empties parented to the joined mesh and pass them to `pipeline.export_glb`
  (see the export block of `build_weapon_grudgebrand.py`). Log any new node name in `docs/CHANGELOG_SHARED.md`.

## 5. Rig contract (see `docs/ARCHITECTURE.md` §2/§3 — the source of truth)

- Names exactly: `root, hips, spine, chest, neck, head [jaw], clavicle_L/R, upperarm_L/R, forearm_L/R, hand_L/R,
  socket_hand_L/R, thigh_L/R, shin_L/R, foot_L/R, toe_L/R`; optional chains `hair_1..N` (head), `beard_1..N`
  (jaw/head), `cape_1..N` (chest), `kilt_F/B/L/R_1..N` (hips), `tail_1..N`, `socket_back` (chest). Underscores
  only — never dots.
- Rest pose A-pose (arms ~40° down, palms down, legs straight), feet on the ground, `root` at the origin, `hips` at
  pelvis height. **Blender space:** Z up, character faces **−Y**, character's LEFT is **+X**. The exporter turns this
  into glTF Y-up facing **+Z** with the left side on +X.
- **Animation axes (character space, right-handed): +X = forward (facing), +Y = up, +Z = the character's RIGHT.**
  (The early draft said +Z = left; that was wrong.) char → glTF model: (x, y, z) → (−z, y, x). char → Blender:
  (x, y, z) → (−z, −x, y), i.e. char X → Blender −Y, char Y → Blender +Z, char Z → Blender −X (the matrix used by
  `skin.pose_bones_char`). +Z rotation swings a hanging limb forward/up
  (knee bend and forward lean are −Z), +Y turns left, a hanging LEFT arm abducts with +X and a RIGHT arm with −X.
- Sockets carry no weight. `socket_hand_R` = main grip: head at the fist centre, local +Y = blade direction
  (thumb side), local X = edge direction, local Z = flat normal. Weapons are separate GLBs: **grip at the origin,
  blade along +Y** (Blender +Z), flat of the blade facing ±Z (glTF).

### 5.1 Creature rig conventions (mounts, dragons, eagle, tortoise, beasts)
Same rules (underscores, faces +Z in glTF, units = metres, feet on Y=0, `root` at the origin on the ground,
rest pose = natural standing pose with legs straight under the body) with these bone sets:

| Rig | Bones (parent → child) |
|---|---|
| `beast_biped` (chickenleg-style mount, raptors) | `root → hips → spine_1..2 → chest → neck_1..3 → head → jaw`; `hips → tail_1..6`; legs `thigh_L → shin_L → metatarsal_L → foot_L → toe_L` (digitigrade); optional arms `upperarm_L → forearm_L → hand_L`; sockets `socket_saddle` (spine_2, +Y up, +Z forward), `socket_mouth` (head) |
| `beast_quad` (dragons, beasts, tortoise) | `root → hips → spine_1..3 → chest → neck_1..N → head → jaw`; `hips → tail_1..N`; front legs `clavicle_L → upperarm_L → forearm_L → hand_L → finger_L`; hind legs `thigh_L → shin_L → metatarsal_L → foot_L → toe_L`; sockets `socket_saddle`, `socket_mouth`; tortoise adds `shell` (child of spine_2, rigid) |
| `wings` (dragons, eagle) | `chest → wing_1_L (humerus) → wing_2_L (forearm) → wing_3_L (hand) → wing_4_L (tip)`; feathers/membrane are weighted along the chain |
| `bird` (giant eagle) | `root → hips → spine → chest → neck_1..3 → head → beak`; wings as above; legs `thigh_L → shin_L → foot_L → talon_L`; `hips → tail_1..2`; `socket_rider` on chest |

Each creature build script documents its `landmarks` dict and exports with `CONTRACT_BONES` replaced by its
own list; clips for creatures use the same character-space axis convention (+X forward, +Y up, +Z right).

## 6. Weighting rules (why characters don't tear)

> **Spring chains are live.** `src/anim/springs.js` drives `hair_*`, `beard_*`, `kilt_F/B/L/R_*`, `cape_*`,
> `tail_*` as independent spring-damper chains (kilt limit 58 deg, thigh collision). Neighbouring chains diverge, so a
> skirt/cape weighted hard per chain tears between them (Brann r2 build#1 `heavy`: 12 stretched tris
> `kilt_B_1 <-> kilt_R_1`). Share each level's weight between the two nearest chains with a cosine partition around
> the garment axis (`kilt_angular_blend` in `build_hero_brann.py`: 1 on a chain, 0.5/0.5 half-way). Same for capes
> with several columns and for hair clumps sharing one mesh.

`skin.skin(ob, arm, method, S, allowed, overrides, rigid, post, restrict=True)`:
1. **Per part.** Every separate mesh is weighted only against the bones that may move it:
   body → all body bones (no chains); hands → `forearm_X, hand_X`; kilt → `hips, kilt_*` (+ thighs via
   `skirt_weights`); mane → `head, neck, chest, hair_*` with roots forced to `head` (`along < 0.16`);
   capes → `chest, spine, cape_*`. **Hands never touch anything but their own forearm.**
2. **Base weights** (`method="sdf"`): distance to bone segments with side filters (`_L` bones cannot reach
   x < −2.5 cm), a visibility penalty when the straight path leaves the body (armpits, between the legs),
   inverse-power falloff, 4 Laplacian smoothing passes. `method="heat"` (bone heat) is validated and falls back.
3. **post hook**: e.g. `skin.skirt_weights(P, names, W, top_z, hem_z, share=0.55, seam=0.12)` blends kilt hems to
   the thigh on the same side (0 at the belt → `share` at the hem, smooth across the centre seam) so legs never
   punch through the kilt even without secondary motion.
4. **overrides** `[(mask_fn(P) → 0..1, bone)]`: head above the jaw line, wrists → hand (masks MUST be local: a
   plain half-space through the wrist also grabbed the shins — the r1 tearing bug), crotch bridge → hips.
5. **rigid** groups (metal plates/buckles move as one: group-averaged weights).
6. **restrict_adjacent**: a vertex may only keep weights from its dominant bone and that bone's anatomical
   neighbours (`skin.ADJ`, chains via `CHAIN_PARENTS`) — hand weight on a thigh vertex or hand_L↔hand_R bleed is
   impossible by construction.
7. top-4 influences, normalised, written as vertex groups; Armature modifier bound.
8. **Geometry rule**: separate the legs below the kilt (`anatomy.separate_legs`), keep arms clear of the torso in
   the A-pose. Any triangle joining the two legs becomes a sheet in every run/kick.

**QA gates** (all must pass before a GLB ships):
- `skin.stretch_report(mesh, arm)` in the build (poses `arms_down, reach, overhead, kick, crouch, twist, split`):
  `bad` = edges > 4× rest and > 0.25 m (same rule as the engine), `soft` = > 2.5× and > 6 cm, with bone pairs and
  location. Logged and stored in the report.
- `node tools/validate-glb.mjs <glb>`: bone names/hierarchy, orientation, A-pose, height, tris, textures, weights
  (normalised, ≤ 4, sockets unweighted, **no vertex > 0.75 m from its main joint**).
- In engine: `/?mode=showcase&what=hero&id=<id>&anim=<clip>` then `__KCA.debug.skinCheck()` ≈ 0 stretched
  triangles for idle, walk, run, light_1..3, heavy, knockdown, jump, magic_cast, getup
  (scenario: `progress/shots/art-pipeline-brann/qa/skincheck.mjs`, clips via `KCA_CLIPS=walk,run node ...`).

## 7. Review tools

- **Viewer** `/tools/viewer.html?model=<glb>&weapon=<glb>&pose=rest|apose|lunge|armsup|crouch|twist|ready&view=
  front|three-quarter|side|back|face|face-front|bust|hand|weapon|game&channel=albedo|normal|rough|metal|ao
  &turntable=1&bones=1&wire=1&bg=studio|dusk&grey=1&lgrip=-0.14` (supports `tools/capture.mjs`;
  `window.__KCA.viewer.{setPose, setView, probe, ik}`). `pose=ready` is a two-handed guard solved by IK (both arms
  onto the grip, sword roll searched for minimal wrist strain, forearm absorbs pronation); `info().ik` reports miss
  distance / reach / wrist strain. `grey=1` = greyscale value check; `probe()` = value groups (see §4.1).
- **Clay previews** (`--preview head|full|hands`) to iterate on sculpt shape in ~20–90 s before any bake.
- Build reports in `blender/out/`.

## 8. Recipe: a new character

1. Copy the structure of `build_hero_brann.py`: proportions dict → `rig.landmarks`, `STYLE`, `MATERIALS`, `PAL`.
2. `body_sculpt`: `anatomy.torso/arm/leg/foot/head` + details, then gear on a snapshot, then `separate_legs`.
3. Separate sculpts for hands (`anatomy.hand` + wrist cut), skirts (`gear.kilt_sculpt`), hair (`groom_swept` +
   `clump_sculpt`).
4. Iterate shape with `--preview`; then `--fast --stage skin` until `stretch_report` is clean; then `--fast`;
   check in viewer + engine; then the release build.
5. Add the asset to `src/assets/manifest.js` (additive, `{ kind: 'character', weapon: '<weapon id>' }`).
6. Acceptance before hand-off: viewer `view=three-quarter|back|face|game` + `view=game&grey=1` (4+ value groups,
   `probe()`), engine `what=showcase` walk/light_1 sheet with `__KCA.debug.skinCheck()` = 0 bad tris, tri budget (§2).

### 8.1 Roster notes (next builds from `blender/lib`)
- **Seraphine** (amazon, sword + shield or spear): proportions dict with longer legs / narrower shoulders, female
  `anatomy.torso` masses via STYLE, `hair.groom_swept` with a braid (clumps along one path), bronze scale/leather
  armour pieces as `gear` sculpts. Value plan: tanned skin (light), pale/red hair (mid-light), dark leather, bronze.
- **Gorrim** (dwarf, battle-axe): short proportions (head ~1/4.5 of height), huge hands, beard = `hair` clumps from
  the jaw (keep the mouth region clear), chainmail painter on cloth UVs. Axe = `weapon.py` head sculpt + haft,
  nodes `grip_main`/`grip_offhand`/`head_tip`.
- **Enemies** (grunts, amazons, skeletons, knights, giants): same body pipeline; reuse rig + weighting rules; a
  skeleton = `anatomy` bone SDFs only (no skin mass), paint bone ivory vs rusted iron for value separation.
- **Mounts** (chicken-leg / blue dragon / red dragon): §5.1 creature rig (`beast_biped` / `beast_quad` + `wings`); the rider socket is `socket_saddle`.

