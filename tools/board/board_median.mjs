// usage: node board_median.mjs <pack dir>  -> board.json with per-axis medians
import fs from 'node:fs';
const dir = process.argv[2];
const seats = fs.readdirSync(dir).filter((f) => /^seat-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')));
const axes = ['craft', 'lighting_render', 'readability', 'juice_feel', 'fidelity_to_brief', 'innovation'];
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const scores = Object.fromEntries(axes.map((k) => [k, med(seats.map((s) => s.scores[k]))]));
const avg = Math.round(axes.reduce((a, k) => a + scores[k], 0) / axes.length * 100) / 100;
const passes = seats.filter((s) => s.verdict === 'PASS').length;
const out = { seats: seats.map((s) => ({ seat: s.seat, verdict: s.verdict, avg: s.avg })), scores, avg, passes, verdict: passes >= 2 ? 'PASS' : 'FAIL' };
fs.writeFileSync(`${dir}/board.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
