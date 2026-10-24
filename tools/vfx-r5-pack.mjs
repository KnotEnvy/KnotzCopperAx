import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const H='progress/shots/vfx-hitfx/r11',F='progress/shots/shared-fire-library/r5',read=f=>JSON.parse(fs.readFileSync(f));
const dirs=[`${H}/brawl-final`,`${H}/heavy`,`${H}/camp-hits`,`${H}/kick-verified`,`${H}/light-proof`,`${H}/storm`,`${F}/fire`,`${F}/camp-final`,`${F}/roof`];
const reports=dirs.map(d=>{const r=read(d+'/report.json');return {path:d+'/report.json',ok:r.ok,gpu:r.gpu,errors:[...r.pageErrors,...r.consoleErrors,...(r.info.errors||[])],warnings:r.warnings};});
assert.ok(reports.every(r=>r.ok&&/5070/.test(r.gpu)&&!r.errors.length));
// Preserve benign geometry warnings from concurrent assets instead of silently dropping them.
assert.ok(reports.every(r=>r.warnings.every(w=>w==='THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed.')));
const probes=read(`${H}/brawl-final/flash-placement.json`),heavy=read(`${H}/heavy/contacts.json`),kick=read(`${H}/kick-verified/kick.json`),light=read(`${H}/light-proof/light-delta.json`);
assert.ok(probes.every(p=>p.screenDistancePx===0));
assert.ok(heavy.probes.every(p=>p.screenDistancePx===0));
assert.ok(heavy.hits.some(h=>h.attacker==='brann'&&/^heavy/.test(h.moveId)&&h.brains>=4));
const hits=read(`${H}/brawl-final/contacts.json`).hits;
for(const move of ['light_1','light_2','light_3'])assert.ok(hits.some(h=>h.attacker==='brann'&&h.moveId===move&&h.brains>=4));
assert.ok(kick.hits.some(h=>h.moveId==='close_finisher')&&kick.debrisStart===0&&kick.debrisEnd===0);
assert.ok(light.floor.delta>0&&light.body.delta>0);
const compact=r=>({stage:r.stage,phase:r.phase,target:r.target,estimated1650TiMs:r.gpu.estRefMs,clean:r.gpu.nClean,method:r.gpu.method,calls:r.census.calls,triangles:r.census.triangles,passPixels:r.census.passPixels1080,overdraw:r.overdraw,newPrograms:r.newPrograms,jsMaxNormalizedMs:r.slices.maxNorm,errors:r.errors});
const final=read(`${F}/perf-final/perfbench.json`).runs.map(compact),s3=read(`${F}/perf-s3-ab/perfbench.json`).runs.map(compact),s3Initial=read(`${F}/perf-s3/perfbench.json`).runs.map(compact);
assert.ok(final.every(r=>!r.errors.length&&!r.newPrograms.length));
assert.ok(final.find(r=>r.stage==='1').estimated1650TiMs<=9.6);
assert.ok(final.find(r=>r.stage==='5').estimated1650TiMs<=9.9);
const cast=s3.find(r=>r.target==='cand'&&r.phase==='cast');
assert.ok(cast.overdraw.mean<=3&&cast.overdraw.p95<=8);
assert.ok(s3.every(r=>!r.errors.length&&!r.newPrograms.length));
const files=['src/vfx/author_atlas.py','src/vfx/fireLib.js','src/vfx/effects/hit_spark.js','src/vfx/effects/time_ripple.js','src/vfx/HitFlash.js','src/vfx/ScreenFx.js','src/vfx/VfxSystem.js','src/vfx/contact.js','src/levels/stages/bonus/campfire.js','public/assets/vfx/fire-hit-atlas.png'];
const hashes=Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const evidence=[`${H}/board-gap-fixed.png`,`${H}/light-brawl-native.png`,`${H}/light-brawl-400x225.png`,`${H}/heavy-brawl-native.png`,`${H}/heavy-brawl-400x225.png`,`${H}/heavy-0-33-66-99ms.png`,`${H}/heavy-contact-2x-strip.png`,`${H}/light-chain.png`,`${H}/brawl-final/clip.mp4`,`${H}/kick-verified/kick-contact-000ms.png`,`${H}/kick-33ms-strip.png`,`${H}/camp-hits/camp-hit-0.png`,`${H}/storm-and-dodge.png`,`${H}/light-proof/contact-light-restored.png`,`${F}/board-gap-fixed.png`,`${F}/fire-hit-0-495ms.png`,`${F}/fire-hit-2x-strip.png`,`${F}/fire/clip.mp4`,`${F}/camp-final/frame_0000.png`,`${F}/camp-final/clip.mp4`,`${F}/camp-2x.png`,`${F}/roof/shot.png`,`${F}/roof-2x.png`];
assert.ok(evidence.every(f=>fs.existsSync(f)));
const result={round:5,items:[{id:'vfx-hitfx',iter:11},{id:'shared-fire-library',iter:5}],reports,hashes,evidence,
  gates:{allCanonicalCapturesRTX5070NoErrors:true,captureWarningsDisclosed:true,light123FourLiveBrains:true,heavyFourLiveBrains:true,contactAnchorsInsideBody:probes.length+heavy.probes.length,allContactProjectionDistancesZero:true,kickFullInputChainNoDebris:true,pooledLightBodyAndFloorPositive:true,atlasPadding:read('public/assets/vfx/fire-hit-atlas.check.json').passAll,contracts:read(`${F}/contracts.json`).pass,stage1And5GPUBudgets:true,zeroNewPrograms:true,stage3CastLatestMeanWithin3:true,stage3CastEveryObservedRunWithin3:false,overallPerfPass:false},
  probes,heavy,kick,light,perf:{final,s3Interleaved:s3,s3Initial},
  clips:{camp:read(`${F}/camp-final/clipcheck.json`),fire:read(`${F}/fire/clipcheck.json`),brawl:read(`${H}/brawl-final/clipcheck.json`)},
  provenance:['Brawl and heavy use arranged starts, HP999/player godmode and real virtual-device input/unchanged CombatSystem, four live enemy brains and retained stage/camera/HUD.',
    'Kick uses a stationary thief with its brain disabled and arranged positions 2.0/2.8m beside the campfire, outside the camp no-go band. Actual input completes Light1/2/pommel1/pommel2/close_finisher at tick88; no forced hit events.',
    'Camp hits use the untouched bot, camp rules, HUD and fire. Ambient fire clip uses Brann/bot0, camp2 at6500ms.',
    'Fire/storm are explicit showcase effects at the game camera, including ScreenFx; they are not claimed as natural spell damage.',
    'Light proof renders the same real hit pose with only existing pooled point lights toggled, no simulation advance.',
    'Roof evidence includes the concurrently rebuilt Stages ember geometry/anchors; no stage1 source files edited by this round.',
    'Perf uses isolated /tmp/kca-fire-c2r5-before-build and final-build bundles, shared public assets. Other teams edited AI/art/stages between snapshots; atlas is shared by both A/B targets, so this is not an isolated causal benchmark of atlas cost.'],
  limitations:['S3 first final cast measured3.27mean/p956 at11.11ms; a fresh interleaved comparison measured2.80/p955 at9.29ms (before2.88). Both retained: no claim every run meets the cast budget or of overallperfPASS.',
    'Normalized S1/S5 JS maxima92.5/101.7ms exceed50ms; allocation sampling not run.',
    'Camp final reports six THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed. warnings; every canonical capture has zero page/console/game errors.',
    'Brawl clip has1 actual contact/shake spike; fire clip has2 initial ignition/shake spikes at33/100ms. All canonical clips have0freezes/flashes/blanks; camp has0issues.',
    'Roof flames now have dark rooted bases, but remain sparse beside the current prominent ember band. Stages owns emitter seating/spread; coordination request posted.',
    'Smoke is deliberately dark and is subtle over the dark camp background; final craft/parity awaits the independent board.',
    'Earlier noncanonical brawl attempt timed out taking a screenshot; one Gorrim camp capture stalled and its owned browser/process tree was terminated by PID. Initial kick arrangements failed because camp no-go rules separated the actors. Clean reruns above replace those attempts.'],
  refsUsed:['docs/refs/c2/vfx/hit_sparks.png','docs/refs/c2/vfx/fire_library.png','refs/modern/tmnt_hit-impact.jpg','refs/modern/sor4_crowd-brawl.jpg','refs/modern/absolum_campfire-select.jpg']};
fs.writeFileSync(`${F}/verification.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({gates:result.gates,final,s3Cast:cast},null,2));
