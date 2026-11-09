// `npx tsx tools/sim/human.ts [matches] [simple|freebot]`: can a first-time human survive a free room?
// One human against 11 agents (AGENT_SKILL). "simple" (default) is S3's realistic newcomer: heads
// for the nearest pellet, flees any bigger blob within 250 px, re-aims every 250 ms, never BOOSTs. "freebot" is
// a FreeBot at skill 0.4. Reports the human's median rank (1 = best of 12, popped or eaten = last),
// before the bell's leftover split (free rooms pay leftover food to humans only) and final,
// survival to the bell, top-3 share (final), and agent equity (median and top) at 10, 20, 30 and 60 s.
import { equity, outweighs, R, radius, ranking, toUnits, type AgentView, type Brain, type InputCmd } from "@margin/core";
import { FreeBot } from "../../apps/server/src/agents/index";
import { runMatch } from "./match";

/** A newcomer who never touches BOOST: eat the nearest pellet, run from anything bigger. */
class SimpleHuman implements Brain {
  private next = 0;
  private dir = { x: 0, y: 0 };
  decide(v: AgentView, tick: number): InputCmd {
    // A person re-aims about 4 times a second, not every 16 ms.
    if (tick < this.next) return { seq: tick, dirX: this.dir.x, dirY: this.dir.y, boost: false, repay: false, cashout: false };
    this.next = tick + 15;
    const me = v.self;
    let dx = 0, dy = 0;
    for (const o of v.others) {
      if (o.kind === "drone" || !outweighs(o, me)) continue;
      const d = Math.hypot(o.x - me.x, o.y - me.y) - radius(o.mass) - radius(me.mass);
      if (d < 250) { dx -= (o.x - me.x) / (d + 1); dy -= (o.y - me.y) / (d + 1); }
    }
    if (dx === 0 && dy === 0) {
      const f = [...v.food].sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
      if (f) [dx, dy] = [f.x - me.x, f.y - me.y];
    }
    const len = Math.hypot(dx, dy) || 1;
    this.dir = { x: dx / len, y: dy / len };
    return { seq: tick, dirX: this.dir.x, dirY: this.dir.y, boost: false, repay: false, cashout: false };
  }
}

const n = Number(process.argv[2] ?? 60);
const kind = process.argv[3] ?? "simple";
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const ranks: number[] = [];
const playRanks: number[] = [];
const at: Record<number, { med: number[]; top: number[] }> = { 10: { med: [], top: [] }, 20: { med: [], top: [] }, 30: { med: [], top: [] }, 60: { med: [], top: [] } };
let survived = 0;
for (let m = 1; m <= n; m++) {
  const { w, log } = await runMatch({
    seed: 900 + m, mode: "free", players: 12, humans: 1, drones: 0,
    brain: (b) => (b.kind !== "human" ? null : kind === "simple" ? new SimpleHuman() : new FreeBot(4000 + m, { greed: 0.6, caution: 0.6, skill: 0.4 })),
    onTick: (w, tick) => {
      if (tick - w.goTick === R.MATCH_S * R.TICK_HZ - 1) {
        const h = [...w.blobs.values()].find((b) => b.kind === "human")!;
        playRanks.push(ranking(w).indexOf(h.id) + 1 || 12);
      }
      const s = (tick - w.goTick) / R.TICK_HZ;
      const slot = at[s];
      if (!slot) return;
      const eq = [...w.blobs.values()].filter((b) => b.kind === "agent" && b.state === "alive").map((b) => toUnits(equity(b)));
      slot.med.push(med(eq));
      slot.top.push(Math.max(...eq));
    },
  });
  const h = [...w.blobs.values()].find((b) => b.kind === "human")!;
  // The result screen's rank: equity at the bell, before the leftover bonus (MATCH_END.ranking).
  const end = log.at(-1)!.data as { ranking: string[] };
  ranks.push(end.ranking.indexOf(h.id) + 1 || 12);
  if (h.state !== "popped") survived++;
}
const agents = Object.fromEntries(Object.entries(at).map(([s, v]) => [`${s}s`, `${med(v.med).toFixed(0)} / top ${med(v.top).toFixed(0)}`]));
console.log(JSON.stringify({
  matches: n, human: kind, humanMedianRankBeforeBell: med(playRanks), humanMedianRankFinal: med(ranks), humanTop3: +(ranks.filter((r) => r <= 3).length / n).toFixed(2),
  humanSurvived: +(survived / n).toFixed(2), agentEquityMedianAndTop: agents,
}));
