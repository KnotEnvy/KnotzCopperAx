// Seeded RNG (mulberry32). Use game.rng for anything that affects gameplay so captures are reproducible
// (&seed=N; capture mode defaults to seed 1). Cosmetic-only randomness may use game.fxRng.

export class RNG {
  constructor(seed = 1) { this.seed(seed); }
  seed(s) { this._s = (Number(s) >>> 0) || 1; this.initialSeed = this._s; return this; }
  /** float in [0,1) */
  next() {
    let t = (this._s = (this._s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  /** Fork a child stream (stable given the parent state). */
  fork() { return new RNG(Math.floor(this.next() * 4294967296)); }
}
