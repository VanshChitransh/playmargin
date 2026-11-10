// QA-B-07: in the Judge Run a judge who never borrows is not eaten by an agent, and a greedy judge
// still gets the lesson (liquidated by Drone-1). Same lineup, seed, layout and brains as the room.
import { describe, expect, it } from "vitest";
import { JUDGE_SEED, R, applyJudgeLayout, judgeLineup, newWorld, startMatch, step, type InputCmd } from "@margin/core";
import { agentView, createBrain } from "./index";

function judgeRun(boost: boolean) {
  const w = newWorld(JUDGE_SEED, "free", judgeLineup({ id: "you", kind: "human", label: "Judge", accountId: null }), "judge-test");
  const brains = new Map([...w.blobs.values()].flatMap((b) => { const br = createBrain(b, JUDGE_SEED); return br ? [[b.id, br] as const] : []; }));
  const warm = R.WARMUP_S * R.TICK_HZ;
  for (let tick = 1; w.phase !== "ENDED"; tick++) {
    const inputs = new Map<string, InputCmd>();
    for (const [id, br] of brains) { const v = agentView(w, id); if (v) inputs.set(id, br.decide(v, tick)); }
    inputs.set("you", { seq: tick, dirX: 0, dirY: 0, boost, repay: false, cashout: false });
    if (tick === warm) (startMatch(w, tick), applyJudgeLayout(w, "you"));
    else step(w, inputs, tick);
  }
  return w.pendingLog.find((e) => (e.type === "EAT" || e.type === "POP" || e.type === "KEEPER_POP") && e.data.victim === "you") ?? null;
}

describe("Judge Run agents", () => {
  it("never eat a judge who stands still and never borrows", () => {
    expect(judgeRun(false)).toBeNull();
  }, 30_000);
  it("a judge who holds BOOST is liquidated by Drone-1", () => {
    const end = judgeRun(true);
    expect(end?.type).toBe("POP");
    expect(end?.type === "POP" && end.data.by).toBe("drone-1");
  }, 30_000);
});
