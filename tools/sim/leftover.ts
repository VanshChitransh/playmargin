// `npx tsx tools/sim/leftover.ts [matches] [free|paid]`: the bell leftover split against equity.
// Per survivor: equity cashed at the bell vs the leftover share paid on top (second bell CASHOUT).
// Free rooms pay the leftover to humans only; paid rooms are all humans (FreeBot-driven here).
import { toUnits } from "@margin/core";
import { runMatch } from "./match";

const n = Number(process.argv[2] ?? 200);
const mode = (process.argv[3] ?? "paid") as "free" | "paid";
const q = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)] ?? 0;
const eq: number[] = [];
const share: number[] = [];
const ratio: number[] = [];
let survivors = 0;
for (let m = 1; m <= n; m++) {
  const players = mode === "paid" ? 4 + (m % 9) : 12;
  const { log } = await runMatch({ seed: 5000 + m, mode, players, humans: mode === "free" ? 2 : undefined, drones: mode === "paid" ? Math.min(3, Math.ceil(players / 3)) : 0 });
  const end = log.at(-1)!;
  const bell = new Map<string, number[]>();
  for (const e of log) if (e.type === "CASHOUT" && e.tick === end.tick) {
    const d = e.data as { blob: string; amount: number };
    if (d.blob.startsWith("drone")) continue;
    bell.set(d.blob, [...(bell.get(d.blob) ?? []), toUnits(d.amount)]);
  }
  for (const [, [a = 0, b = 0]] of bell) {
    survivors++;
    eq.push(a);
    share.push(b);
    if (a > 0) ratio.push(b / a);
  }
}
const f = (xs: number[]): string => `p25 ${q(xs, 0.25).toFixed(1)} / median ${q(xs, 0.5).toFixed(1)} / p75 ${q(xs, 0.75).toFixed(1)} / p95 ${q(xs, 0.95).toFixed(1)}`;
console.log(JSON.stringify({ mode, matches: n, survivorsPerMatch: +(survivors / n).toFixed(2), equityAtBell: f(eq), leftoverShare: f(share), shareOverEquity: f(ratio) }));
