// A5: the Judge Run is a fixed, replayable map under normal rules, not a rigged outcome.
import { describe, expect, it } from "vitest";
import { boostRoom, ring } from "./economy";
import { radius } from "./motion";
import { applyJudgeLayout, JUDGE_SEED, judgeLineup } from "./scenario";
import { step } from "./step";
import type { InputCmd } from "./protocol";
import { newWorld, startMatch } from "./world";

const judgeWorld = () => {
  const w = newWorld(JUDGE_SEED, "free", judgeLineup({ id: "you", kind: "human", label: "You", accountId: null }));
  startMatch(w, 1);
  applyJudgeLayout(w, "you");
  return w;
};

describe("Judge Run", () => {
  it("is the same map every time (published seed)", () => {
    const a = judgeWorld();
    const b = judgeWorld();
    expect(a.food).toEqual(b.food);
    expect(a.spikes).toEqual(b.spikes);
    expect([...a.blobs.values()].map((x) => [x.x, x.y])).toEqual([...b.blobs.values()].map((x) => [x.x, x.y]));
  });

  it("labels everyone: 10 agents and one liquidator drone", () => {
    const w = judgeWorld();
    const kinds = [...w.blobs.values()].map((b) => b.kind);
    expect(kinds.filter((k) => k === "agent")).toHaveLength(10);
    expect(w.blobs.get("drone-1")?.label).toContain("liquidator");
  });

  it("only moves what the pot paid for: food rings the player, big spikes ring the final zone", () => {
    const w = judgeWorld();
    const you = w.blobs.get("you")!;
    expect(w.food.reduce((s, f) => s + f.mass, w.foodPool)).toBe(Math.floor(w.pot * 0.2)); // on the map + still pooled
    for (const f of w.food) expect(Math.hypot(f.x - you.x, f.y - you.y)).toBeGreaterThan(radius(you.mass));
    const big = w.spikes.filter((s) => s.big);
    expect(big.length).toBeGreaterThanOrEqual(w.spikes.length / 2);
    for (const s of big.slice(0, Math.ceil(w.spikes.length / 2))) {
      expect(Math.hypot(s.x - w.zone.cx, s.y - w.zone.cy)).toBeCloseTo(w.zone.targetR * 1.25, 0);
    }
  });

  it("maxing the loan drops one big spike on a judge who stands still: red at the cap, once", () => {
    const w = judgeWorld();
    const hold: InputCmd = { seq: 0, dirX: 0, dirY: 0, boost: true, repay: false, cashout: false };
    let cap: number | null = null;
    for (let t = 2; cap === null && t < 20 * 60; t++) {
      step(w, new Map([["you", { ...hold, seq: t }]]), t);
      const you = w.blobs.get("you")!;
      if (you.debt > 0 && boostRoom(you) === 0) cap = t;
    }
    expect(cap).not.toBeNull();
    const hits = () => w.pendingLog.filter((e) => e.type === "SPIKE" && e.data.blob === "you");
    expect(hits()).toHaveLength(1);
    expect(hits()[0]!.tick).toBe(cap);
    expect(ring(w.blobs.get("you")!)).toBe("red"); // HF 0.95 floor: red, never a keeper pop
    const spikes = JSON.stringify(w.spikes);
    step(w, new Map([["you", { ...hold, seq: 9_999 }]]), cap! + 1);
    expect(JSON.stringify(w.spikes)).toBe(spikes); // one beat only, nothing moves again
  });

  it("drops nothing outside a Judge Run (same seed, no layout)", () => {
    const w = newWorld(JUDGE_SEED, "free", judgeLineup({ id: "you", kind: "human", label: "You", accountId: null }));
    startMatch(w, 1);
    const hold: InputCmd = { seq: 0, dirX: 0, dirY: 0, boost: true, repay: false, cashout: false };
    for (let t = 2; t < 20 * 60; t++) step(w, new Map([["you", { ...hold, seq: t }]]), t);
    expect(w.pendingLog.some((e) => e.type === "SPIKE" && e.data.blob === "you")).toBe(false);
  });

  it("plays out under normal rules (the invariant runs every tick)", () => {
    const w = judgeWorld();
    for (let t = 2; w.phase !== "ENDED"; t++) step(w, new Map(), t);
    expect(w.phase).toBe("ENDED");
  }, 30_000); // heavy and seeded: slow only under a loaded full run (5 s default flaked)
});
