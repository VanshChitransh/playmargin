// `npx tsx tools/sim/balance.ts [matches] [greedy caution]`: liquidation balance under the CURRENT constants.
// Each match has one greedy player (holds all 3 pips: boosts whenever it can, never repays or
// cashes out) among normal FreeBots. Prints one JSON line; tools/sim/sweep.ts runs it per config.
import { type AgentView, type Brain, type InputCmd } from "@margin/core";
import { FreeBot } from "../../apps/server/src/agents/index";
import { runMatch } from "./match";

class Greedy implements Brain {
  private bot: FreeBot;
  constructor(seed: number, caution: number) { this.bot = new FreeBot(seed, { greed: 1, caution }); }
  decide(v: AgentView, tick: number): InputCmd {
    const c = this.bot.decide(v, tick);
    return { ...c, boost: v.self.pips > 0, repay: false, cashout: false };
  }
}

const n = Number(process.argv[2] ?? 200);
/** How hard the greedy player dodges spikes (FreeBot caution: 0.1 careless to 1.2 careful). */
const caution = Number(process.argv[3] ?? 0.6);
let greedyEaten = 0, greedyBehind = 0, liqs = 0, greedyPopped = 0, oneToThree = 0, zero = 0, matches = 0, keeper = 0, popsByDrone = 0;
for (let m = 1; m <= n; m++) {
  const paid = m % 2 === 0;
  const greedyId = paid ? "player-1" : "agent-1";
  const { log } = await runMatch({
    ...(paid ? { mode: "paid", players: 6, drones: 2 } : { mode: "free", players: 12, drones: 0 }),
    seed: 1000 + m,
    brain: (b) => (b.id === greedyId ? new Greedy(7000 + m, caution) : null),
  });
  let k = 0;
  for (const e of log) {
    if (e.type !== "POP" && e.type !== "KEEPER_POP") continue;
    k++;
    if (e.type === "KEEPER_POP") keeper++;
    else if (String((e.data as { by: string }).by).startsWith("drone")) popsByDrone++;
    if ((e.data as { victim: string }).victim === greedyId) greedyPopped++;
  }
  for (const e of log) if (e.type === "EAT" && (e.data as { victim: string }).victim === greedyId) greedyEaten++;
  const end = log.at(-1)?.data as { finalMasses: Record<string, number> };
  const start = log.find((e) => e.type === "CHARGE" && (e.data as { blob: string }).blob === greedyId)?.data as { entry: number };
  if ((end.finalMasses[greedyId] ?? 0) < start.entry) greedyBehind++;
  liqs += k;
  matches++;
  if (k === 0) zero++;
  if (k >= 1 && k <= 3) oneToThree++;
}
console.log(JSON.stringify({ matches, liqPerMatch: liqs / matches, pct1to3: oneToThree / matches, pctZero: zero / matches, greedyPopped: greedyPopped / matches, greedyEaten: greedyEaten / matches, greedyLost: greedyBehind / matches, keeper, popsByDrone }));
