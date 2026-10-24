// GAME OVER sting: the motif's head inverted and falling, low horns + choir over a funeral war-drum, dying on D minor.
import { cue, mel, melodyEv, drumEv, padEv } from './_seq.js';

const B = 16;
const FALL = mel('A4:4 G4:4 F4:4 E4:4 | D4:6 C#4:2 D4:8 | -:16');
export default cue({
  id: 'gameover', bpm: 60, beatSteps: 4, barSteps: B, bars: 3, loop: false, tail: 4.5, gain: 0.95, level: 2,
  tracks: [
    { id: 'horn', inst: 'brass', ev: melodyEv(FALL, B, { vel: 0.85 }), gain: 0.8, verb: 0.5 },
    { id: 'hornLow', inst: 'brass', ev: melodyEv(FALL, B, { oct: -1, vel: 0.6 }), gain: 0.55, verb: 0.4 },
    { id: 'pad', inst: 'strings', ev: padEv(['Dm', ['Bb', 'A'], 'Dm'], B, { oct: 3, vel: 0.6 }), gain: 0.55, verb: 0.55, o: { release: 3 } },
    { id: 'choir', inst: 'choir', ev: padEv(['Dm', 'Gm', 'Dm'], B, { oct: 4, vel: 0.5 }), gain: 0.45, verb: 0.7, o: { vowel: 'o' } },
    { id: 'drum', inst: 'taiko', ev: drumEv(['X...............', 'X.......X.......', 'X...............'], 33), gain: 1, verb: 0.5 },
    { id: 'bass', inst: 'bass', ev: (bar) => [{ s: 0, n: bar === 1 ? 45 : 38, d: 16, v: 0.8 }], gain: 0.7 },
  ],
});
