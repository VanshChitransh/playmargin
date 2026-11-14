// QA-B-07: in the Judge Run a judge who never borrows is not eaten by an agent, and a greedy judge
// still gets the lesson (liquidated by Drone-1). Same lineup, seed, layout and brains as the room.
// JUDGE-RUN (teardown 14 Nov): a judge who holds BOOST and never steers, on any heading, is popped by
// Drone-1 within 10 s of maxing the loan, and the match still conserves and settles to the micro-unit.
import { describe, expect, it } from "vitest";
import {
  JUDGE_SEED, R, appendLog, applyJudgeLayout, boostRoom, judgeLineup, newWorld, settle, startMatch, step, type InputCmd, type LogEntry,
} from "@margin/core";
import { agentView, createBrain } from "./index";

async function judgeRun(boost: boolean, dirX = 0, dirY = 0) {
  const w = newWorld(JUDGE_SEED, "free", judgeLineup({ id: "you", kind: "human", label: "Judge", accountId: null }), "judge-test");
  const brains = new Map([...w.blobs.values()].flatMap((b) => { const br = createBrain(b, JUDGE_SEED); return br ? [[b.id, br] as const] : []; }));
  const warm = R.WARMUP_S * R.TICK_HZ;
  const log: LogEntry[] = [];
  let capTick: number | null = null;
  for (let tick = 1; w.phase !== "ENDED"; tick++) {
    const inputs = new Map<string, InputCmd>();
    for (const [id, br] of brains) { const v = agentView(w, id); if (v) inputs.set(id, br.decide(v, tick)); }
    inputs.set("you", { seq: tick, dirX, dirY, boost, repay: false, cashout: false });
    if (tick === warm) (startMatch(w, tick), applyJudgeLayout(w, "you"));
    else step(w, inputs, tick);
    const you = w.blobs.get("you")!;
    if (capTick === null && you.state === "alive" && you.debt > 0 && boostRoom(you) === 0) capTick = tick;
    await appendLog(log, w.pendingLog.splice(0));
  }
  const end = log.find((e) => (e.type === "EAT" || e.type === "POP" || e.type === "KEEPER_POP") && e.data.victim === "you") ?? null;
  return { w, log, capTick, end };
}

describe("Judge Run agents", () => {
  it("never eat a judge who stands still and never borrows", async () => {
    expect((await judgeRun(false)).end).toBeNull();
  }, 30_000);

  // Still (no mouse yet), the four walls and the four corners: every way of "hold Space, do nothing".
  const headings: Array<[string, number, number]> = [
    ["still", 0, 0], ["E", 1, 0], ["W", -1, 0], ["N", 0, -1], ["S", 0, 1],
    ["NE", 0.7, -0.7], ["SW", -0.7, 0.7], ["NW", -0.7, -0.7], ["SE", 0.7, 0.7],
  ];
  it.each(headings)("a judge who holds BOOST and never steers (%s) is popped by Drone-1 within 10 s of the cap", async (_, dx, dy) => {
    const { w, log, capTick, end } = await judgeRun(true, dx, dy);
    expect(capTick).not.toBeNull();
    expect(end?.type).toBe("POP");
    expect(end?.type === "POP" && end.data.by).toBe("drone-1");
    expect((end!.tick - capTick!) / R.TICK_HZ).toBeLessThanOrEqual(10);
    // The scripted spike moves no money: the log settles to exactly what the live room paid.
    const r = settle(log);
    expect(r.lent).toBe(w.vault.lent);
    expect(r.vaultRepaid).toBe(w.vault.repaid);
    expect(r.interestToVault).toBe(w.vault.interest);
    expect(r.fees).toBe(w.fees);
    expect(r.reserve).toBe(w.reserve);
    for (const b of w.blobs.values()) expect(r.payouts.find((p) => p.id === b.id)?.amount ?? 0).toBe(b.payout);
  }, 30_000);
});
