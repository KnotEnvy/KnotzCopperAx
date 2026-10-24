// STAGE CLEAR fanfare: the motif head turned to D major, brass triplet call, taiko roll, held tonic with anvil.
// One-shot; hands over to the quiet camp bed (song.then).
import { cue, mel, melodyEv, drumEv, padEv, bassEv } from './_seq.js';

const B = 16;
const CALL = mel(`D4:2 D4:1 D4:1 A4:4 F#4:2 A4:2 D5:4 | B4:2 B4:1 B4:1 E5:4 C#5:2 E5:2 A5:4 | D5:16:1 | -:16`);
const HARM = mel(`A3:2 A3:1 A3:1 D4:4 D4:2 F#4:2 A4:4 | G4:2 G4:1 G4:1 B4:4 A4:2 C#5:2 E5:4 | F#4+A4:16:0.9 | -:16`);
export default cue({
  id: 'clear', bpm: 120, beatSteps: 4, barSteps: B, bars: 4, loop: false, tail: 3.5, gain: 0.95, level: 3, then: 'camp',
  tracks: [
    { id: 'call', inst: 'brass', ev: melodyEv(CALL, B, { vel: 0.95 }), gain: 0.8, verb: 0.45 },
    { id: 'harm', inst: 'brass', ev: melodyEv(HARM, B, { vel: 0.7 }), gain: 0.55, verb: 0.45 },
    { id: 'pad', inst: 'strings', ev: padEv(['D', 'A', 'D', 'D'], B, { oct: 3, vel: 0.6, top: true }), gain: 0.5, verb: 0.5, o: { release: 2.5 } },
    { id: 'choir', inst: 'choir', ev: (bar) => (bar === 2 ? [62, 66, 69, 74].map((n) => ({ s: 0, n, d: 24, v: 0.55 })) : []), gain: 0.5, verb: 0.7, o: { vowel: 'a' } },
    { id: 'bass', inst: 'bass', ev: bassEv(['D', 'A', 'D', 'D'], B, 'x.......x.......', { vel: 0.8 }), gain: 0.7 },
    { id: 'roll', inst: 'taiko', ev: drumEv(['X...x...X...x.x.', 'X...x...X.x.xxxx', 'X...............', '................'], 40), gain: 0.85, verb: 0.35 },
    { id: 'odaiko', inst: 'taiko', ev: drumEv(['X...............', 'X...............', 'X...............', '................'], 33), gain: 0.9, verb: 0.45 },
    { id: 'anvil', inst: 'anvil', ev: (bar) => (bar === 2 ? [{ s: 0, n: 74, d: 4, v: 0.8 }] : []), gain: 0.4, verb: 0.6 },
  ],
});
