// Title — "Legend of the Copper Ax": majestic 4/4 at 80 bpm, D minor. Full statement of the main motif in brass over
// choir + strings, harp runs, odaiko on the downbeats. Not adaptive (fixed intensity).
import { cue, melodyEv, drumEv, padEv, arpEv, bassEv, section } from './_seq.js';
import { MOTIF_44, PROG_44 } from './_theme.js';

const B = 16;
const PROG = ['Dm', 'Bb', 'Gm', 'A', ...PROG_44];

export default cue({
  id: 'title', bpm: 80, beatSteps: 4, barSteps: B, bars: 12, gain: 0.9, level: 3,
  tracks: [
    { id: 'pad', inst: 'strings', ev: padEv(PROG, B, { oct: 3, vel: 0.6, top: true }), gain: 0.5, verb: 0.5, o: { attack: 0.6, release: 1.2 } },
    { id: 'choir', inst: 'choir', ev: padEv(PROG, B, { oct: 4, vel: 0.5 }), gain: 0.5, verb: 0.6 },
    { id: 'bass', inst: 'bass', ev: bassEv(PROG, B, 'x.......x.......', { vel: 0.75 }), gain: 0.75 },
    { id: 'harp', inst: 'harp', ev: arpEv(PROG, B, [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 5], { oct: 4, vel: 0.35, d: 3 }), gain: 0.55, verb: 0.55, pan: 0.3 },
    { id: 'motif', inst: 'brass', ev: section(melodyEv(MOTIF_44, B, { vel: 0.9 }), 4, 12), gain: 0.8, verb: 0.45 },
    { id: 'motifStr', inst: 'strings', ev: section(melodyEv(MOTIF_44, B, { oct: 1, vel: 0.6 }), 8, 12, 4), gain: 0.35, verb: 0.5, o: { attack: 0.15, bright: 2800 } },
    { id: 'odaiko', inst: 'taiko', ev: drumEv(['X...............', 'X.......x.......', 'X...............', 'X.......x...x.x.'], 34), gain: 0.95, verb: 0.45 },
    { id: 'taiko', inst: 'taiko', ev: section(drumEv(['....x.......x...', '....x.......x.oo'], 42), 4, 12, 0), gain: 0.5, verb: 0.3 },
    { id: 'anvil', inst: 'anvil', every: 4, ev: () => [{ s: 0, n: 74, d: 4, v: 0.6 }], gain: 0.35, verb: 0.6 },
  ],
});
