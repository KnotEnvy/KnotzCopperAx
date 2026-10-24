// Final machine-readable board handoff for hitfx14 + fire8.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const H='progress/shots/vfx-hitfx/r14',F='progress/shots/shared-fire-library/r8';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,o)=>fs.writeFileSync(p,JSON.stringify(o,null,2)+'\n');
const hitDirs=['light-fwd','light-rev','heavy-fwd','heavy-rev','kick-final','brawl'].map(d=>`${H}/${d}`);
const fireDirs=['fire-game','fireball','camp-final','roof-final'].map(d=>`${F}/${d}`);
const reports=[...hitDirs,...fireDirs].map(dir=>{
 const r=read(`${dir}/report.json`);assert.equal(r.ok,true,dir);assert.equal(r.pageErrors.length,0,dir);assert.equal(r.consoleErrors.length,0,dir);assert.equal(r.info.errors.length,0,dir);assert.match(r.gpu,/5070/);
 return {dir,gpu:r.gpu,pageErrors:r.pageErrors,consoleErrors:r.consoleErrors,gameErrors:r.info.errors,warnings:r.warnings,gpuEvents:r.gpuEvents,readback:r.readback};
});
const brawl=read(`${H}/brawl/contacts.json`).hits,kick=read(`${H}/kick-final/kick.json`).hits;
assert.ok(brawl.every(h=>h.blocked||h.chips>0));assert.ok(kick.find(h=>h.moveId==='close_finisher').chips>=3);
const clipDirs=[`${H}/brawl`,`${F}/fire-game`,`${F}/fireball`,`${F}/camp-final`];
const clips=clipDirs.map(d=>({dir:d,...read(`${d}/clipcheck.json`)}));
assert.ok(clips.every(c=>c.counts.freeze===0&&c.counts.flash===0&&c.counts.blank===0));
const refs=['docs/refs/c2/vfx/hit_impact_frames.png','docs/refs/c2/vfx/hit_sparks.png','docs/refs/c2/vfx/fire_library.png'];
const hitGallery=[`${H}/directions-400x225.png`,`${H}/light-fwd/contact-000ms.png`,`${H}/heavy-fwd/contact-000ms.png`,`${H}/light-fwd-2x.png`,`${H}/heavy-fwd-2x.png`,`${H}/kick-400x225.png`,`${H}/kick-final/kick-contact-000ms.png`,`${H}/brawl/clip.mp4`,`${H}/brawl/sheet.png`];
const fireGallery=[`${F}/fire-game-400x225.png`,`${F}/fire-game-0ms-2x.png`,`${F}/fire-game-264ms-2x.png`,`${F}/fire-game/clip.mp4`,`${F}/fireball-400x225.png`,`${F}/fireball/clip.mp4`,`${F}/camp-final/camp-game.png`,`${F}/camp-2x.png`,`${F}/camp-final/clip.mp4`,`${F}/roof-final/roof-game.png`,`${F}/roof-2x.png`,`${F}/spike-neighbours.png`];
for(const p of [...hitGallery,...fireGallery])assert.ok(fs.existsSync(p),p);
const perfPaths=[`${F}/perf-final-ab/perfbench.json`,`${F}/perf-final-s5-ab/perfbench.json`];
const performanceSummary=[];
for(const p of perfPaths){const perf=read(p);assert.ok(perf.runs.length>=4);assert.ok(perf.runs.every(r=>!r.errors?.length),p);assert.ok(perf.runs.every(r=>!r.newPrograms?.length),p);
 for(const r of perf.runs)performanceSummary.push({stage:r.stage,phase:r.phase,target:r.target,est1650TiMs:r.gpu.estRefMs,clean:r.gpu.nClean,attempts:r.gpu.attempts,ab:r.ab,calls:r.census.calls,triangles:r.census.triangles,passPx:r.census.passPixels1080,overdraw:r.overdraw,cpuMaxNorm:r.slices?.maxNorm,errors:r.errors,newPrograms:r.newPrograms});
}
const v={items:[{id:'vfx-hitfx',iter:14},{id:'shared-fire-library',iter:8}],reports,clips,
 contracts:read(`${F}/contracts.json`),atlasGuard:read('public/assets/vfx/fire-hit-atlas.check.json'),
 actualBrawlContacts:brawl.map(({moveId,target,chips,live,brains})=>({moveId,target,chips,live,brains})),kick,
 attachment:read(`${F}/attachment-summary.json`),atlasMotion:read(`${F}/atlas-motion.json`),
 pixelCounts:`${F}/pixel-counts.json`,sourceHashes:`${F}/source-hashes.json`,
 shaderContract:`${F}/shader-contract.txt`,cleanup:`${F}/cleanup.json`,sharedRenderScope:`${F}/shared-render-scope.json`,performance:{combat:`${F}/perf-final-ab/perfbench.json`,castBoss:`${F}/perf-final-s5-ab/perfbench.json`,frozenSources:`${F}/perf-source-freeze.json`,invalidFirstAttempt:`${F}/perf-ab/perfbench.json`},
 performanceSummary,roofSmokeContrast:read(`${F}/roof-final/sky-contrast.json`),hitGallery,fireGallery,refs_used:refs,refs_wanted:[],
 caveats:['Arranged four-live-brain brawl uses HP999 and player godmode; kick uses real input against a stationary brainless thief. Fire hit is an isolated showcase event; mounted fireball is an actual hit.',
 'Clipcheck motion spikes: brawl3, fire2, fireball3; all0freeze/flash/blank. All flagged frames and neighbours inspected in spike-neighbours.png.',
 'First perf-ab run is invalid: its candidate output was rebuilt during lazy loading, producing a missing-chunk error; the superseding comparisons use frozen source and atlas bytes in immutable builds. The queued preliminary cast/boss run was stopped before loading.',
 'Both final perf processes returned143 after printing terminal summaries and writing complete4-run JSON; all8saved runs have0errors/0newprograms and>=8clean samples. Successful process exit is not claimed.',
 'S5 boss remains slightly above the12ms budget; paired CI is wide, so no speedup claim. CPU spikes and unmeasured allocations limit overall performance claims.',
 'Effects remain camera-facing painted sprites. Independent board review decides craft/parity.',
 'Canonical direction/Heavy/brawl/fire/camp captures precede only later boss-kernel, small-thief-fill or tall-roof-smoke adjustments; those paths are unaffected. kick-final and roof-final verify the adjusted paths.',
 'Initial close-camera fire preview, banner-covered camp, first kick and first roof are iteration evidence; canonical galleries above supersede them.'],
 sharedScope:'Only two heavy-rim amplitudes in characterLook.js; concurrent weapon-glint edits are preserved. Earth effect branch, stage geometry/anchors, combat and cameras untouched.'};
write(`${F}/verification.json`,v);write(`${H}/verification.json`,v);
write(`${H}/pack.json`,{item:'vfx-hitfx',iter:14,gallery:hitGallery,verification:`${H}/verification.json`,refs_used:refs.slice(0,2)});
write(`${F}/pack.json`,{item:'shared-fire-library',iter:8,gallery:fireGallery,verification:`${F}/verification.json`,refs_used:refs});
console.log(JSON.stringify({reports:reports.length,errors:0,brawl:brawl.map(h=>h.chips),kick:kick.at(-1).chips,clipCounts:clips.map(c=>({dir:c.dir,...c.counts}))}));
