// Stage 1 — "Dusk March": driving 4/4 at 104 bpm in D minor. 16-bar loop: bars 0–7 ostinato section (lute + low
// strings riff, stabs), bars 8–15 the main-theme motif in brass. Adaptive stems:
//   0 calm (walking, no foes): pad, drone bass, lute, soft frame drum
//   1 foes on screen: taiko march, marching bass, rim, shaker, low-string riff
//   2 heavy fight / combo 8+: brass motif + stabs, odaiko, anvil downbeats
//   3 swarm / combo 20+ / boss: choir, high-string counter-line, 16th taiko
//   boss stem: 'The Warlord' leitmotif (low brass, _theme BOSS_44) + string shriek, dissonant choir cluster, double odaiko (replaces the stabs)
import { cue, mel, melodyEv, drumEv, padEv, arpEv, bassEv, stabEv, section } from './_seq.js';
import { MOTIF_44, PROG_44, BOSS_44, BOSS_SHRIEK_44 } from './_theme.js';

const B = 16;
const PROG = ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Dm', 'Gm', 'A', ...PROG_44];
const RIFF = mel(`D3:3 D3:1 F3:2 D3:2 A3:3 G3:1 F3:2 E3:2 | D3:3 D3:1 F3:2 D3:2 C4:3 Bb3:1 A3:4 |
  Bb2:3 Bb2:1 D3:2 F3:2 A3:3 G3:1 F3:2 D3:2 | A2:3 A2:1 C#3:2 E3:2 A3:4 G3:2 E3:2 |
  D3:3 D3:1 F3:2 D3:2 A3:3 G3:1 F3:2 E3:2 | D3:3 D3:1 F3:2 D3:2 C4:3 Bb3:1 A3:4 |
  G2:3 G2:1 Bb2:2 D3:2 G3:3 F3:1 D3:2 Bb2:2 | A2:3 A2:1 C#3:2 E3:2 A3:4 C#4:2 E4:2`);
const COUNTER = mel(`A5:8 G5:4 F5:4 | F5:8 E5:4 D5:4 | D5:8 E5:4 F5:4 | E5:12 -:4 |
  A5:8 G5:4 F5:4 | A5:8 G5:4 F5:4 | G5:8 F5:4 E5:4 | F5:16`);
const BOSS_CLUSTER = (bar) => (bar % 2 ? [] : [62, 63, 69].map((n) => ({ s: 0, n, d: 32, v: 0.55 })));

export default cue({
  id: 'stage1', bpm: 104, beatSteps: 4, barSteps: B, bars: 16, adaptive: true, gain: 0.8,
  tracks: [
    { id: 'pad', inst: 'strings', ev: padEv(PROG, B, { oct: 3, vel: 0.55 }), gain: 0.55, verb: 0.35 },
    { id: 'drone', inst: 'bass', maxLvl: 0, ev: bassEv(PROG, B, 'x.......x.......', { vel: 0.7 }), gain: 0.8 },
    { id: 'bass', inst: 'bass', lvl: 1, ev: bassEv(PROG, B, 'X.x.x.x.X.x.x.xx', { vel: 0.72, fifth: [6, 14] }), gain: 0.8 },
    { id: 'lute', inst: 'lute', ev: arpEv(PROG, B, [0, null, 1, 2, null, 1, 2, null, 0, null, 1, 2, 3, 2, 1, null], { oct: 4, vel: 0.5, accent: [0, 8] }), gain: 0.6, verb: 0.25, pan: 0.25 },
    { id: 'frame', inst: 'frame', maxLvl: 0, ev: drumEv('x...o...x...o.o.', 50), gain: 0.5, verb: 0.15 },
    { id: 'taiko', inst: 'taiko', lvl: 1, ev: drumEv(['X.....x.X...x...', 'X.....x.X...x.xx', 'X.....x.X...x...', 'X.....x.X.x.X.xx'], 40), gain: 0.85, verb: 0.2 },
    { id: 'rim', inst: 'rim', lvl: 1, ev: drumEv('....x.......x..o', 0), gain: 0.5, verb: 0.2, pan: -0.2 },
    { id: 'shaker', inst: 'shaker', lvl: 1, ev: drumEv('.o.o.o.o.o.o.o.o'), gain: 0.5, pan: 0.3, swing: 0.12 },
    { id: 'riff', inst: 'marcato', lvl: 1, ev: section(melodyEv(RIFF, B), 0, 8), gain: 0.55, verb: 0.25, pan: -0.15 },
    { id: 'motif', inst: 'brass', lvl: 2, ev: section(melodyEv(MOTIF_44, B), 8, 16), gain: 0.75, verb: 0.35 },
    { id: 'motifLow', inst: 'strings', lvl: 1, maxLvl: 1, ev: section(melodyEv(MOTIF_44, B, { oct: -1, vel: 0.8 }), 8, 16), gain: 0.5, verb: 0.3 },
    { id: 'stabs', inst: 'brass', lvl: 2, boss: false, ev: section(stabEv(PROG, B, [0, 6, 12], { oct: 3, vel: 0.7 }), 0, 8), gain: 0.5, verb: 0.3 },
    { id: 'odaiko', inst: 'taiko', lvl: 2, ev: drumEv(['X.......X.....x.', 'X.......X...X.X.'], 34), gain: 0.9, verb: 0.3 },
    { id: 'anvil', inst: 'anvil', lvl: 2, every: 4, ev: () => [{ s: 0, n: 74, d: 4, v: 0.6 }], gain: 0.4, verb: 0.5 },
    { id: 'choir', inst: 'choir', lvl: 3, ev: padEv(PROG, B, { oct: 4, vel: 0.55 }), gain: 0.55, verb: 0.5, o: { vowel: 'a' } },
    { id: 'counter', inst: 'strings', lvl: 3, ev: section(melodyEv(COUNTER, B), 8, 16), gain: 0.4, verb: 0.4, o: { attack: 0.12, bright: 2600 } },
    { id: 'taiko16', inst: 'taiko', lvl: 3, ev: drumEv('x.o.x.o.x.o.x.oo', 46), gain: 0.5, verb: 0.15, pan: 0.2 },
    { id: 'bossBrass', inst: 'brass', boss: true, ev: melodyEv(BOSS_44, B, { vel: 1 }), gain: 0.7, verb: 0.2 },
    { id: 'bossPedal', inst: 'bass', boss: true, ev: bassEv(['Dm', 'Dm', 'Bb', 'A'], B, 'X..x..x.X..x.xx.', { vel: 0.7 }), gain: 0.55 },
    { id: 'bossShriek', inst: 'strings', boss: true, ev: melodyEv(BOSS_SHRIEK_44, B, { vel: 0.7 }), gain: 0.4, verb: 0.5, o: { attack: 0.05, bright: 3200 } },
    { id: 'bossChoir', inst: 'choir', boss: true, ev: BOSS_CLUSTER, gain: 0.5, verb: 0.6, o: { vowel: 'o' } },
    { id: 'bossDrums', inst: 'taiko', boss: true, ev: drumEv('X..X..X...X.X...', 36), gain: 0.8, verb: 0.3 },
  ],
});
