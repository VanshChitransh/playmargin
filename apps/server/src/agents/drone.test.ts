// A2 done-when: drones hunt red blobs only, pop them within seconds, never touch green ones,
// and a second drone flanks instead of queueing behind the first.
import { describe, expect, it } from "vitest";
import { boostHold, flushBoost, hitSpike, newWorld, ring, startMatch, step, type AgentView, type Blob, type InputCmd } from "@margin/core";
import { Drone } from "./drone";
import { agentView, createBrain } from "./index";

const seed = (id: string, kind: "human" | "drone") => ({ id, kind, label: id, accountId: `${id}.testnet` });

describe("Drone", () => {
  it("pops a red blob within 10 s and leaves the green one alone", () => {
    const w = newWorld(5, "paid", [seed("h0", "human"), seed("h1", "human"), seed("d0", "drone"), seed("d1", "drone")]);
    startMatch(w, 1);
    const brains = new Map(["d0", "d1"].map((id) => [id, createBrain(w.blobs.get(id)!, 5)!]));
    let t = 1;
    while (t < 300) step(w, new Map(), ++t); // wait out the paid 3 s shield
    const h0 = w.blobs.get("h0")!;
    while (boostHold(w, h0, t) > 0); // hold BOOST to the cap
    flushBoost(w, h0, t);
    hitSpike(w, h0, 0, true, t);
    expect(ring(h0)).toBe("red");
    const pops: string[] = [];
    for (const end = t + 600; t < end && h0.state === "alive"; ) {
      t++;
      const inputs = new Map<string, InputCmd>();
      for (const [id, b] of brains) {
        const v = agentView(w, id);
        if (v) inputs.set(id, b.decide(v, t));
      }
      for (const e of step(w, inputs, t)) if (e.type === "pop") pops.push(`${e.by}>${e.victim}`);
    }
    expect(h0.state).toBe("popped");
    expect(pops[0]).toMatch(/^d[01]>h0$/);
    expect(w.blobs.get("h1")!.state).toBe("alive");
    const bounty = (w.blobs.get("d0")!.mass + w.blobs.get("d1")!.mass);
    expect(bounty).toBeGreaterThan(0); // 8% of the debt, paid to the popping drone
  });

  it("flanks: a second drone aims beside the target, not at the rival's back", () => {
    const blob = (id: string, kind: Blob["kind"], x: number, y: number, mass: number, debt: number): Blob => ({
      id, kind, label: id, accountId: null, x, y, dirX: 0, dirY: 0, vx: 0, vy: 0, boostHeld: false, boostMinUntil: 0, burst: 0, burstReadyAt: 0, sputterUntil: 0, repayQueued: false, mass, debt, boostFees: 0, payout: 0, pendingBorrow: 0,
      boostUntil: 0, repayReadyAt: 0, shieldUntil: 0, spikeImmuneUntil: 0, redSince: 0,
      lastThreatAt: 0, cashout: null, state: "alive", lastInput: null, lastInputAt: 0,
    });
    const red = blob("r", "human", 500, 500, 142_500_000, 120_000_000);
    const rival = blob("d1", "drone", 400, 500, 0, 0);
    const me = blob("d0", "drone", 520, 900, 0, 0);
    const v: AgentView = { self: me, others: [red, rival], food: [], spikes: [], zone: { cx: 500, cy: 500, r: 2000, targetR: 500 }, phase: "LIVE" };
    const d = new Drone(1);
    const cmd = d.decide(v, 100);
    expect(d.target).toBe("r");
    // Goal is (500, 660): straight up from me, while the rival comes in from the left.
    expect(cmd.dirY).toBeLessThan(-0.95);
    // Without a rival it goes straight for the target.
    const solo = new Drone(1).decide({ ...v, others: [red] }, 100);
    expect(Math.atan2(solo.dirY, solo.dirX)).toBeCloseTo(Math.atan2(500 - 900, 500 - 520), 1);
  });

  it("never taps BOOST, REPAY or cash-out", () => {
    const w = newWorld(2, "paid", [seed("h0", "human"), seed("d0", "drone")]);
    startMatch(w, 1);
    const b = createBrain(w.blobs.get("d0")!, 2)!;
    for (let t = 2; t < 400; t++) {
      const c = b.decide(agentView(w, "d0")!, t);
      expect(c.boost || c.repay || c.cashout).toBe(false);
    }
  });
});
