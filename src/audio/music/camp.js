// Camp / night — quiet 4/4 at 66 bpm: a lone lute half-remembering the main motif over a hushed low-string bed,
// sparse harp, crickets. No drums (the camp is where the party breathes). Also used on the map and ranking screens.
import { cue, mel, melodyEv, padEv, arpEv, bassEv, section } from './_seq.js';

const B = 16;
const PROG = ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A'];
const TUNE = mel(`D4:6 A4:2 G4:2 A4:2 C5:4 | D5:12 -:4 | Bb4:6 A4:2 G4:4 F4:4 | G4:12 -:4 |
  G4:6 A4:2 Bb4:4 A4:2 G4:2 | F4:12 -:4 | E4:6 F4:2 G4:4 E4:4 | A3:12 -:4`);

export default cue({
  id: 'camp', bpm: 66, beatSteps: 4, barSteps: B, bars: 16, gain: 1.25, level: 0,
  tracks: [
    { id: 'pad', inst: 'strings', ev: padEv(PROG, B, { oct: 3, vel: 0.4 }), gain: 0.45, verb: 0.55, o: { attack: 1.2, release: 1.6, bright: 900 } },
    { id: 'bass', inst: 'bass', ev: bassEv(PROG, B, 'x...............', { vel: 0.5 }), gain: 0.6 },
    { id: 'lutearp', inst: 'lute', ev: arpEv(PROG, B, [0, null, 1, null, 2, null, 1, null, 3, null, 2, null, 1, null, null, null], { oct: 3, vel: 0.45 }), gain: 0.6, verb: 0.4, pan: -0.2 },
    { id: 'tune', inst: 'lute', ev: section(melodyEv(TUNE, B, { vel: 0.8 }), 8, 16), gain: 0.65, verb: 0.45, pan: 0.15 },
    { id: 'harp', inst: 'harp', every: 2, ev: arpEv(PROG, B, [null, null, null, null, null, null, null, null, 4, 3, 2, null, null, null, null, null], { oct: 4, vel: 0.35 }), gain: 0.45, verb: 0.6, pan: 0.35 },
    { id: 'crickets', inst: 'cricket', ev: (bar, info) => [0, 1, 2].filter(() => info.rng() < 0.6).map(() => ({ s: Math.floor(info.rng() * 16), n: 0, d: 1, v: 0.5 + info.rng() * 0.5 })), gain: 0.6, verb: 0.4, pan: 0.5 },
  ],
});
