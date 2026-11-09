// A5: the Judge Run is a fixed, replayable map under normal rules, not a rigged outcome.
import { describe, expect, it } from "vitest";
import { radius } from "./motion";
import { applyJudgeLayout, JUDGE_SEED, judgeLineup } from "./scenario";
import { step } from "./step";
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
    expect(w.food.reduce((s, f) => s + f.mass, 0)).toBe(Math.floor(w.pot * 0.2));
    for (const f of w.food) expect(Math.hypot(f.x - you.x, f.y - you.y)).toBeGreaterThan(radius(you.mass));
    const big = w.spikes.filter((s) => s.big);
    expect(big.length).toBeGreaterThanOrEqual(w.spikes.length / 2);
    for (const s of big.slice(0, Math.ceil(w.spikes.length / 2))) {
      expect(Math.hypot(s.x - w.zone.cx, s.y - w.zone.cy)).toBeCloseTo(w.zone.targetR * 1.25, 0);
    }
  });

  it("plays out under normal rules (the invariant runs every tick)", () => {
    const w = judgeWorld();
    for (let t = 2; w.phase !== "ENDED"; t++) step(w, new Map(), t);
    expect(w.phase).toBe("ENDED");
  });
});
