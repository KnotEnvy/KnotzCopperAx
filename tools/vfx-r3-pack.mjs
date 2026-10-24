import fs from 'node:fs';
import crypto from 'node:crypto';
const H='progress/shots/vfx-hitfx/r9',F='progress/shots/shared-fire-library/r3';
const read=f=>JSON.parse(fs.readFileSync(f));
const reports=['brawl','motifs','hero-body-final'].map(x=>`${H}/${x}/report.json`).concat(['camp','roof-rooted','hit-soot-final','s3-cast-final'].map(x=>`${F}/${x}/report.json`));
const captureReports=reports.map(file=>{const r=read(file);return{file,ok:r.ok,gpu:r.gpu,drawCalls:r.info.drawCalls,errors:[...r.pageErrors,...r.consoleErrors,...r.info.errors],warnings:r.warnings};});
if(captureReports.some(r=>!r.ok||r.errors.length))throw Error('Canonical capture error');
const probes=read(`${H}/brawl/flash-placement.json`),hero=read(`${H}/hero-body-final/hero-contact.json`);
const chain=read(`${H}/brawl/contacts.json`).hits.filter(h=>h.attacker==='brann'&&/^light_[123]$/.test(h.moveId));
const perf=read(`${F}/perf-final2/perfbench.json`);
const latest=read(`${F}/perf-s3-final3/perfbench.json`);
const finalRuns=perf.runs.filter(r=>r.stage!=='3').concat(latest.runs);
const perfRows=finalRuns.map(r=>({stage:r.stage,phase:r.phase,estimated1650TiMs:r.gpu.estRefMs,clean:r.gpu.nClean,method:r.gpu.method,newPrograms:r.newPrograms,drawCalls:r.census.calls,triangles:r.census.triangles,passPixels:r.census.passPixels1080,overdraw:r.overdraw,errors:r.errors}));
const s3cast=perfRows.find(r=>r.stage==='3'&&r.phase==='cast');
const temporal=read(`${F}/hit-soot-final/temporal.json`);
const hashes=read(`${F}/final-source-hashes.json`);
for(const [f,h]of Object.entries(hashes))if(crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')!==h)throw Error('Owned source drift: '+f);
const result={round:3,items:[{id:'shared-fire-library',iter:3},{id:'vfx-hitfx',iter:9}],sourceHashes:hashes,
 captures:captureReports,chain,flashPlacement:probes,heroContact:hero,
 gates:{allBrawlContactsInsideHurtProjection:probes.every(p=>p.screenDistancePx===0),light123:chain.length===3,heroInside:hero.probes.every(p=>p.screenDistancePx===0),firePostFrame2Below4:temporal.pass,stage3CastOverdraw:s3cast.overdraw.mean<=3&&s3cast.overdraw.p95<=8,zeroPrograms:perfRows.every(r=>r.newPrograms.length===0),contracts:read(`${F}/contracts.json`).pass},
 temporal,perfRows,atlas:read('public/assets/vfx/fire-hit-atlas.check.json'),
 clips:Object.fromEntries(['camp','hit-soot-final'].map(d=>[d,read(`${F}/${d}/clipcheck.json`)]).concat([['brawl',read(`${H}/brawl/clipcheck.json`)]])),
 canonicalEvidence:[`${H}/board-gap-fixed.png`,`${H}/brawl-chain-33ms-strip.png`,`${H}/light_1-contact-2x.png`,`${H}/magic_fire-2x-strip.png`,`${H}/motifs-sheet.png`,`${H}/hero-body-final/hero-contact.png`,`${F}/camp/crop2x.png`,`${F}/camp/clip.mp4`,`${F}/roof-rooted/shot.png`,`${F}/hit-soot-final/clip.mp4`],
 provenance:['Brawl: arranged positions, enemy HP999, player godmode and partnerbot, retained world/HUD/camera/four live brains, unchanged CombatSystem.','Hero-contact: normal48HP hero, real marauder AI/CombatSystem; no godmode.','Primary motif-fire row uses final soot capture; other primary rows retain same hit code/atlas, predating invisible-alpha discard and spell-only large-dust refinements.','Roof consumer/geometry changed by Stages; no stage1 edits by this task.','Earlier shared cand perf and isolated S3 intermediates3.59/3.14 are retained as superseded attempts. Final S1/S5 use isolated final2; S3 final3 differs only in spell-sized shock ring lifetime/thickness. Assets still served from shared server.','Camp/body hit captures predate the invisible-alpha<.002 discard, which only removes sub-byte invisible texels.'],
 limitations:['Independent critic still required; camera-facing painted art remains soft at2x; soot is subtle against dark scenery.','Brawl has9impact/shake motion spikes; fire ignition frame2 spike5.37x is disclosed, all later ratios<=3.618.','Concurrent art/AI/render changes prevent an isolated VFX speedup claim. Shared CPU/allocation limits remain; no global performance PASS.','Initial hero capture hit a screenshot timeout; clean hero-body-final supersedes it.']};
fs.writeFileSync(`${F}/verification.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({gates:result.gates,perf:perfRows.map(r=>({stage:r.stage,phase:r.phase,ms:r.estimated1650TiMs,od:r.overdraw.mean,p95:r.overdraw.p95,newPrograms:r.newPrograms.length}))},null,2));
