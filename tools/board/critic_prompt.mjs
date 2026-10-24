// usage: node tools/board/critic_prompt.mjs <item> <round> <seat> <extra-file>  -> prints critic prompt
import fs from 'node:fs';
const [item, round, seat, extraFile] = process.argv.slice(2);
// Board wave folder: KCA_WAVE=c1 for old boards; default is the current wave.
const wave = (process.env.KCA_WAVE || 'c2').toLowerCase();
const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const pack = JSON.parse(fs.readFileSync(`${root}/progress/qa/board-${wave}/${item}-r${round}/pack.json`, 'utf8'));
const prev = JSON.parse(fs.readFileSync(`${root}/progress/items/${item}.json`, 'utf8'));
const hist = (prev.history || []).filter((h) => h.verdict);
const lastCritic = hist[hist.length - 1] || {};
const extra = extraFile ? fs.readFileSync(extraFile, 'utf8') : '';
const isGemini = seat === 'argon';
const imgs = pack.images.map((im, i) => `${isGemini ? `Attachment ${i + 1}` : im.path}: ${im.what}`).join('\n');
const clips = pack.clips.map((c) => `${c.path} — clipcheck: ${c.clipcheck}`).join('\n') || '(none)';
const probes = (pack.probes || []).map((p) => `${p.name}: ${p.headline} (${p.path})`).join('\n') || '(none)';
console.log(`You are a seat on the three-model critic board for **KnotzCopperAx**, a 2026-quality 3D fantasy beat-'em-up in Three.js (spiritual successor to Sega's Golden Axe; quality bar: Streets of Rage 4, Absolum, Trine 5 — shipped modern polish plus Golden Axe DNA). You did NOT build this item and you don't know which model did. Judge harshly and independently; the other two seats judge the same evidence without seeing your answer.

ITEM: ${item}, round ${round}. Title: ${prev.title || item}.
The previous critic's score: ${lastCritic.score ?? prev.score} (${lastCritic.verdict ?? prev.verdict}). Their largest gap was: "${lastCritic.gap ?? prev.gap}"
${extra}
${isGemini ? `You cannot open files from disk; the evidence images are attached to this message in this order:` : `Project root ${root}. For any node command use the absolute path /home/knotz2/.local/share/fnm/aliases/default/bin/node (plain node can fail with an fnm error). Read docs/notes/_board-${wave.toUpperCase()}.md (section 2), docs/CRITIC_PROTOCOL.md (rubric, anti-leniency, PASS rule) and the item's spec in docs/DESIGN.md. Evidence pack: ${root}/progress/qa/board-${wave}/${item}-r${round}/pack.json. View every image (Read/open them). You may take extra captures (node tools/capture.mjs against http://127.0.0.1:5190 only; save under progress/qa/board-${wave}/${item}-r${round}/seat-${seat}/; kill only processes you start; never edit src/, blender/, public/, docs/ or progress/items; do not run tools/progress.mjs or Blender; do NOT open other seats' seat-*.json files, seat-*/ folders or board.json — judge independently). Images:`}
${imgs}
Clips: ${clips}
Probes: ${probes}
Pack notes: ${(pack.errors || []).join(' | ') || '(none)'}

RUBRIC (1–10 each; 10 = shipped AAA-indie quality like Streets of Rage 4 or Trine 5 for this category): craft, lighting_render, readability, juice_feel (for static art: pose/appeal), fidelity_to_brief (DESIGN spec + Golden Axe DNA), innovation. PASS only if EVERY axis ≥ 8 AND the blind comparison puts ours at least equal to the modern reference. Programmer-art tells (flat untextured materials, primitive soup, default grey lighting, z-fighting, floating feet, popping, placeholder text, stretched UVs) = automatic craft FAIL. If you can't tell what is going on in a gameplay frame within 1 second, readability ≤ 5. Don't grade on effort or "for a browser game".
BLIND COMPARISON: the blind image has tiles A, B, C… — one is ours, the others are references. Score each tile 1–10 for polish with a one-line note BEFORE knowing which is ours. ${isGemini ? 'You do not get the key; the orchestrator maps your tile scores.' : 'Only after writing your tile scores, open blind/key.json and state whether ours was below/equal/above each reference.'}
${isGemini ? 'Vision models sometimes describe small text or fine texture that is not really there — if a detail is too small to read, SAY SO instead of guessing. Ground every claim in a numbered attachment.' : 'Ground every claim in a specific image/clip/probe path.'}
Name ONE largest gap: a single concrete, actionable, verifiable problem (what is wrong, where, and what "fixed" looks like). Up to 3 short secondary notes.

Return ONE fenced \`\`\`json block:
{"seat":"${seat}","item":"${item}","round":${round},"verdict":"PASS|FAIL","scores":{"craft":n,"lighting_render":n,"readability":n,"juice_feel":n,"fidelity_to_brief":n,"innovation":n},"avg":n,"blind_tiles":{"A":{"score":n,"note":"..."}},"blind_result":"...","largest_gap":"...","secondary_notes":["..."],"evidence":["..."]}`);
