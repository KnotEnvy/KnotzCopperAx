// Boss lineup before/after sheet (bosses C2 r1): node tools/boss_sil_compare.mjs <dirA> <dirB> <out.png> [frame=idle0.6]
// Crops each boss tile of two boss_lineup.mjs runs (A = top row, B = bottom row).
import sharp from 'sharp';
const [,, a, b, out, fr = "idle0.6"] = process.argv;
const W = 520, H = 700, row = async (d) => Promise.all(['0_brute_brothers','1_captains','2_wyrm_rider','3_varkhul','4_morvane'].map((n) => sharp(`${d}/${fr}_${n}.png`).extract({ left: 540, top: 60, width: W, height: H }).toBuffer()));
const r1 = await row(a), r2 = await row(b);
const comp = [...r1.map((x, i) => ({ input: x, left: i * W, top: 0 })), ...r2.map((x, i) => ({ input: x, left: i * W, top: H }))];
await sharp({ create: { width: W * 5, height: H * 2, channels: 3, background: '#fff' } }).composite(comp).png().toFile(out);
