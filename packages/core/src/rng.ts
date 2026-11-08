// Seeded randomness for the engine (mulberry32). The state lives on World.rngState so a
// match replays bit-for-bit from its seed; core never calls Math.random.

/** Anything carrying mulberry32 state (World does). */
export interface RngHolder {
  rngState: number;
}

/** Starting rng state for a match seed. */
export function seedRng(seed: number): number {
  return seed >>> 0;
}

/** Next float in [0, 1); advances holder.rngState. */
export function rand(h: RngHolder): number {
  const a = (h.rngState + 0x6d2b79f5) | 0;
  h.rngState = a >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function randInt(h: RngHolder, n: number): number {
  return Math.floor(rand(h) * n);
}

/** Float in [lo, hi). */
export function randRange(h: RngHolder, lo: number, hi: number): number {
  return lo + rand(h) * (hi - lo);
}
