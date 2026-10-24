// High scores: top-10 local table with initials (localStorage, every access wrapped — private windows / blocked
// storage fall back to an in-memory table so the screens always render).
//   loadScores() → [{ initials, score, hero, stage, date }]   qualifies(score) → rank index | -1   addScore(entry) → index
const KEY = 'kca.highscores.v1';
export const TABLE_SIZE = 10;
const DEFAULTS = [
  ['KNZ', 250000, 'gorrim', '5'], ['AXE', 200000, 'brann', '5'], ['GLD', 160000, 'seraphine', '4'], ['TYR', 130000, 'brann', '4'], ['GIL', 100000, 'gorrim', '3'],
  ['ARN', 80000, 'seraphine', '3'], ['DTH', 60000, 'brann', '2'], ['ADR', 45000, 'gorrim', '2'], ['BAD', 30000, 'seraphine', '1'], ['LUV', 20000, 'brann', '1'],
].map(([initials, score, hero, stage]) => ({ initials, score, hero, stage, date: 0 }));
let memory = null;

export function loadScores() {
  let list = null;
  try { const raw = localStorage.getItem(KEY); if (raw) list = JSON.parse(raw); } catch { list = null; }
  if (!Array.isArray(list)) list = memory || DEFAULTS.map((d) => ({ ...d }));
  return list.filter((e) => e && typeof e.score === 'number').sort((a, b) => b.score - a.score).slice(0, TABLE_SIZE);
}

function save(list) { memory = list; try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked: memory only */ } }

export function qualifies(score) {
  if (!(score > 0)) return -1;
  const list = loadScores();
  const i = list.findIndex((e) => score > e.score);
  return i >= 0 ? i : list.length < TABLE_SIZE ? list.length : -1;
}

export function addScore(entry) {
  const list = loadScores();
  const e = { initials: String(entry.initials || 'AAA').slice(0, 3).toUpperCase(), score: Math.floor(entry.score), hero: entry.hero || null, stage: String(entry.stage ?? ''), date: Date.now() };
  list.push(e);
  list.sort((a, b) => b.score - a.score || a.date - b.date);
  const top = list.slice(0, TABLE_SIZE);
  save(top);
  return top.indexOf(e);
}
