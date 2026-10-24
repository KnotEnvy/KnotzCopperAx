// The heroic main-theme motif ("Copper Ax theme") and its variants, reused across every cue so the score has one identity.
// Home key D minor (Aeolian with a raised-7th A major dominant for the arcade "hero" lift).
import { mel } from './_seq.js';

// 4/4, 16 steps per bar. Statement (bars 1–4) + answer (5–8).
export const MOTIF_44 = mel(`
  D4:6 A4:2 G4:2 A4:2 C5:4
  D5:6 C5:2 Bb4:4 A4:4
  G4:6 A4:2 Bb4:4 A4:2 G4:2
  A4:12 -:4
  D4:6 A4:2 G4:2 A4:2 C5:4
  F5:6 E5:2 D5:4 C5:4
  Bb4:4 A4:4 G4:4 E4:4
  D4:12 -:4`);
export const PROG_44 = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'F', ['Gm', 'A'], 'Dm'];

// Same melody reshaped to 6/8 (12 steps per bar = six 8ths as 2-step units), in E minor for stage 2's mist.
export const MOTIF_68 = mel(`
  E4:4 B4:2 A4:2 B4:2 D5:2
  E5:6 D5:2 C5:4
  A4:6 B4:2 C5:2 B4:2
  B4:12
  E4:4 B4:2 A4:2 B4:2 D5:2
  G5:6 F#5:2 E5:4
  C5:4 B4:2 A4:4 F#4:2
  E4:12`);
export const PROG_68 = ['Em', 'C', 'Am', 'B', 'Em', 'G', ['Am', 'B'], 'Em'];

// Fragment (first bar) — used as brass calls, stingers and the camp lute's half-remembered tune.
export const HEAD_44 = mel('D4:6 A4:2 G4:2 A4:2 C5:4 D5:16');

// ---- Round 2: distinct thematic material per stage + a villain leitmotif for bosses.
// Stage 2 "Shellback Hymn": its own tune (E Dorian, the raised 6th C# gives the lake-folk colour), 8 bars of 6/8.
// Sung by harp-doubled strings in the misty A-section; the heroic main motif answers in the B-section.
export const SHELL_68 = mel(`
  B4:4 E5:2 D5:2 C#5:2 B4:2 | A4:6 B4:2 G4:4 | F#4:4 A4:2 G4:2 F#4:2 E4:2 | F#4:12 |
  B4:4 E5:2 D5:2 C#5:2 B4:2 | D5:6 E5:2 F#5:4 | E5:4 D5:2 C#5:2 B4:2 A4:2 | B4:12`);
export const SHELL_PROG = ['Em', 'Em', 'A', 'D', 'Em', 'D', 'A', 'B'];

// Boss leitmotif "The Warlord": Phrygian b2 grind + tritone drop (Ab against D) — the anti-hero mirror of the motif's
// rising fifth. 4 bars, low brass; every boss layers it over its stage cue (4/4 in D, 6/8 in E).
export const BOSS_44 = mel(`
  D3:3 D3:1 Eb3:4 D3:2 C3:2 Ab2:4 | D3:3 D3:1 Eb3:4 F3:2 Eb3:2 D3:4 |
  Bb2:3 Bb2:1 Ab2:4 G2:4 Ab2:4 | A2:8 Eb3:4 D3:4`);
export const BOSS_68 = mel(`
  E3:3 E3:1 F3:2 E3:2 D3:2 Bb2:2 | E3:3 E3:1 F3:2 G3:2 F3:2 E3:2 |
  C3:3 C3:1 Bb2:2 A2:2 Bb2:4 | B2:6 F3:3 E3:3`);
// High shriek answer (strings, 2 octaves up) on the tritone bar — the "boss is here" hook.
export const BOSS_SHRIEK_44 = mel('-:16 | -:16 | -:16 | A5:4 Ab5:4 G5:4 Eb5:4');
export const BOSS_SHRIEK_68 = mel('-:12 | -:12 | -:12 | B5:3 Bb5:3 A5:3 F5:3');
