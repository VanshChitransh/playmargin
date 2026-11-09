// `npx tsx tools/sim/human.ts [matches] [agentSkill]`: can a first-time human win a free room?
// One "average human" (a FreeBot with human reaction times and middling greed and caution) against
// 11 agents. Reports the human's median final rank (1 = best of 12, popped or eaten = last),
// survival to the bell, top-3 share, and median equity at t = 10 s for the human and the agents.
import { equity, R, ranking, toUnits } from "@margin/core";
import { FreeBot } from "../../apps/server/src/agents/index";
import { runMatch } from "./match";

const n = Number(process.argv[2] ?? 60);
const skill = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const ranks: number[] = [], humanAt10: number[] = [], agentsAt10: number[] = [];
let survived = 0;
for (let m = 1; m <= n; m++) {
  const { w } = await runMatch({
    seed: 900 + m, mode: "free", players: 12, humans: 1, drones: 0,
    brain: (b) =>
      b.kind === "human" ? new FreeBot(4000 + m, { greed: 0.6, caution: 0.6, skill: 0.4 })
      : b.kind === "agent" && skill !== undefined ? new FreeBot((7700 + m * 31 + b.id.length) >>> 0, { skill }) : null,
    onTick: (w, tick) => {
      if (tick - w.goTick !== 10 * R.TICK_HZ) return;
      for (const b of w.blobs.values()) {
        if (b.state !== "alive") continue;
        (b.kind === "human" ? humanAt10 : agentsAt10).push(toUnits(equity(b)));
      }
    },
  });
  const order = ranking(w);
  const h = [...w.blobs.values()].find((b) => b.kind === "human")!;
  const rank = order.indexOf(h.id) + 1 || 12;
  ranks.push(rank);
  if (h.state !== "popped") survived++;
}
console.log(JSON.stringify({
  matches: n, agentSkill: skill ?? "default", humanMedianRank: med(ranks), humanTop3: +(ranks.filter((r) => r <= 3).length / n).toFixed(2),
  humanSurvived: +(survived / n).toFixed(2), humanEquityAt10s: +med(humanAt10).toFixed(1), agentMedianEquityAt10s: +med(agentsAt10).toFixed(1),
}));
