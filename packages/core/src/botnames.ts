// Display names for AI players in the hero, offline practice and live free rooms. One list for
// client and server, picked with the match seed so a match's names are reproducible. Every
// label still carries the robot glyph: a name never hides that a player is an AI.
import { randInt, seedRng } from "./rng";

export const BOT_NAMES = [
  "Greedy Gus", "Lil Leverage", "Moon Boy", "Paper Hands", "Diamond Dani", "Ape Strong", "Dip Buyer", "Max Pain",
  "Fomo Fred", "Bag Holder", "Yolo Yuki", "Stop Loss Sam", "Gas Goblin", "Nitro Nina", "Vault Rat", "Margin Mo",
  "Bull Bao", "Bear Bjorn", "Candle Kai", "Liquid Lola", "Debt Duck", "Pump Priya", "Squeeze Sid",
] as const;

/** n distinct names for one match (seeded Fisher-Yates: same seed, same names). Past the list, "Name 2". */
export function botNames(seed: number, n: number): string[] {
  const pool: string[] = [...BOT_NAMES];
  const h = { rngState: seedRng(seed ^ 0x6e616d65) }; // own stream: never shifts the match's rng
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randInt(h, i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return Array.from({ length: n }, (_, i) => (i < pool.length ? pool[i]! : `${pool[i % pool.length]} ${Math.floor(i / pool.length) + 1}`));
}
