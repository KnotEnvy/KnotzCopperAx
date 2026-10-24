// Stage 2 — "Shellback Crossing": misty, flowing 6/8 in E minor (the main motif re-barred), dotted-quarter = 56.
// 12 steps per bar (16ths). Bars 0–7 harp/choir mist, bars 8–15 the motif (strings, then horns at intensity 2+).
//   0 calm: harp arpeggios, pad, bass on the dotted beats, lake crickets-free hush (water is in the stage)
//   1 foes: frame drum lilt, choir "oh", lute counter-arp
//   2 fight: taiko on 1 and 4, horn motif, shaker 8ths
//   3 swarm: marcato string 8ths, odaiko, high choir "ah"      boss: low horn pedal + cluster + war drums
import { cue, melodyEv, drumEv, padEv, arpEv, bassEv, section } from './_seq.js';
import { MOTIF_68, PROG_68, SHELL_68, SHELL_PROG, BOSS_68, BOSS_SHRIEK_68 } from './_theme.js';

const B = 12;
const PROG = [...SHELL_PROG, ...PROG_68]; // A: own 'Shellback Hymn' (E Dorian), B: main motif

export default cue({
  id: 'stage2', bpm: 56, beatSteps: 6, barSteps: B, bars: 16, adaptive: true, gain: 0.95,
  tracks: [
    { id: 'pad', inst: 'strings', ev: padEv(PROG, B, { oct: 3, vel: 0.5 }), gain: 0.5, verb: 0.45, o: { attack: 0.8, release: 1.2, bright: 1100 } },
    { id: 'bass', inst: 'bass', ev: bassEv(PROG, B, 'x.....x.....', { vel: 0.65, fifth: [6] }), gain: 0.75 },
    { id: 'harp', inst: 'harp', ev: arpEv(PROG, B, [0, null, 1, null, 2, null, 3, null, 4, null, 2, null], { oct: 4, vel: 0.6, accent: [0] }), gain: 0.7, verb: 0.5, pan: -0.2 },
    { id: 'choir', inst: 'choir', lvl: 1, ev: padEv(PROG, B, { oct: 4, vel: 0.45 }), gain: 0.5, verb: 0.6, o: { vowel: 'o' } },
    { id: 'frame', inst: 'frame', lvl: 1, ev: drumEv(['X.....x.....', 'X....ox..o.o'], 50), gain: 0.55, verb: 0.2 },
    { id: 'lute', inst: 'lute', lvl: 1, ev: arpEv(PROG, B, [null, null, null, 2, 1, null, null, null, null, 2, 1, 0], { oct: 5, vel: 0.35 }), gain: 0.5, verb: 0.35, pan: 0.3 },
    { id: 'hymn', inst: 'strings', lvl: 0, ev: section(melodyEv(SHELL_68, B, { vel: 0.7 }), 0, 8), gain: 0.42, verb: 0.55, o: { attack: 0.25, bright: 1900 } },
    { id: 'hymnHarp', inst: 'harp', lvl: 1, ev: section(melodyEv(SHELL_68, B, { oct: 1, vel: 0.45 }), 0, 8), gain: 0.4, verb: 0.55, pan: 0.2 },
    { id: 'hymnHorn', inst: 'brass', lvl: 2, ev: section(melodyEv(SHELL_68, B, { vel: 0.6 }), 0, 8), gain: 0.5, verb: 0.45 },
    { id: 'motifStr', inst: 'strings', lvl: 0, maxLvl: 1, ev: section(melodyEv(MOTIF_68, B, { vel: 0.8 }), 8, 16), gain: 0.5, verb: 0.45, o: { attack: 0.2, bright: 2200 } },
    { id: 'motif', inst: 'brass', lvl: 2, ev: section(melodyEv(MOTIF_68, B, { vel: 0.75 }), 8, 16), gain: 0.65, verb: 0.45 },
    { id: 'taiko', inst: 'taiko', lvl: 2, ev: drumEv(['X.....x.....', 'X.....x..o.o'], 40), gain: 0.8, verb: 0.3 },
    { id: 'shaker', inst: 'shaker', lvl: 2, ev: drumEv('o.g.g.o.g.g.'), gain: 0.5, pan: 0.25 },
    { id: 'marcato', inst: 'marcato', lvl: 3, ev: bassEv(PROG, B, 'x.x.x.x.x.x.', { oct: 3, vel: 0.6 }), gain: 0.45, verb: 0.25 },
    { id: 'odaiko', inst: 'taiko', lvl: 3, ev: drumEv(['X...........', 'X.....X.....'], 34), gain: 0.9, verb: 0.35 },
    { id: 'choirHi', inst: 'choir', lvl: 3, ev: section(melodyEv(MOTIF_68, B, { oct: 0, vel: 0.5 }), 8, 16), gain: 0.4, verb: 0.6, o: { vowel: 'a' } },
    { id: 'bossHorn', inst: 'brass', boss: true, ev: melodyEv(BOSS_68, B, { vel: 1 }), gain: 0.65, verb: 0.3 },
    { id: 'bossPedal', inst: 'bass', boss: true, ev: bassEv(['Em', 'Em', 'C', 'B'], B, 'X.....x..x..', { vel: 0.7 }), gain: 0.55 },
    { id: 'bossShriek', inst: 'strings', boss: true, ev: melodyEv(BOSS_SHRIEK_68, B, { vel: 0.7 }), gain: 0.4, verb: 0.5, o: { attack: 0.05, bright: 3200 } },
    { id: 'bossChoir', inst: 'choir', boss: true, ev: (bar) => (bar % 2 ? [] : [64, 65, 71].map((n) => ({ s: 0, n, d: 24, v: 0.5 }))), gain: 0.5, verb: 0.6, o: { vowel: 'o' } },
    { id: 'bossDrums', inst: 'taiko', boss: true, ev: drumEv('X..X..X.X.X.', 36), gain: 0.8, verb: 0.3 },
  ],
});
