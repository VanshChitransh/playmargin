// A1 done-when: FreeBots play by the human rules and clearly beat random steering, deterministically.
import { describe, expect, it } from "vitest";
import {
  MICRO, newWorld, rand, ring, seedRng, startMatch, step, type InputCmd, type PlayerSeed, type World,
} from "@margin/core";
import { FreeBot } from "./freebot";
import { agentView, createBrain } from "./index";

const seeds = (n: number): PlayerSeed[] =>
  Array.from({ length: n }, (_, i) => ({ id: `agent-${i}`, kind: "agent", label: `Agent-${i}`, accountId: null }));

/** Agents 0..5 are FreeBots, 6..11 steer randomly. Returns the match and a log of bot taps. */
function botMatch(seed: number): { w: World; taps: Record<string, number> } {
  const w = newWorld(seed, "free", seeds(12));
  const bots = new Map([...w.blobs.values()].slice(0, 6).map((b) => [b.id, createBrain(b, seed)!]));
  const r = { rngState: seedRng(seed) };
  const taps: Record<string, number> = { boost: 0, repay: 0, cashout: 0 };
  startMatch(w, 1);
  for (let t = 2; w.phase !== "ENDED"; t++) {
    const inputs = new Map<string, InputCmd>();
    for (const b of w.blobs.values()) {
      if (b.state !== "alive") continue;
      const brain = bots.get(b.id);
      const view = agentView(w, b.id);
      if (brain && view) {
        const cmd = brain.decide(view, t);
        for (const k of ["boost", "repay", "cashout"] as const) if (cmd[k]) taps[k]! += 1;
        inputs.set(b.id, cmd);
      } else if (t % 15 === 0) {
        const a = rand(r) * Math.PI * 2;
        inputs.set(b.id, { seq: t, dirX: Math.cos(a), dirY: Math.sin(a), boost: rand(r) < 0.05, repay: false, cashout: false });
      }
    }
    step(w, inputs, t);
  }
  return { w, taps };
}

describe("FreeBot", () => {
  it("out-earns random steering over 6 matches (about 6x) and uses BOOST and cash-out", () => {
    let bot = 0;
    let rnd = 0;
    const taps: Record<string, number> = { boost: 0, repay: 0, cashout: 0 };
    for (let s = 1; s <= 6; s++) {
      const m = botMatch(s);
      const blobs = [...m.w.blobs.values()];
      bot += blobs.slice(0, 6).reduce((a, b) => a + b.payout, 0);
      rnd += blobs.slice(6).reduce((a, b) => a + b.payout, 0);
      for (const k in taps) taps[k]! += m.taps[k]!;
    }
    expect(bot).toBeGreaterThan(rnd * 1.3);
    expect(taps.boost).toBeGreaterThan(0);
    expect(taps.cashout).toBeGreaterThan(0);
  });

  it("is deterministic for the same seed", () => {
    const a = botMatch(9).w;
    const b = botMatch(9).w;
    expect([...a.blobs.values()].map((x) => x.payout)).toEqual([...b.blobs.values()].map((x) => x.payout));
  });

  // REPAY rarely fires in bot-only matches because bots stay green; this pins the habit.
  it("REPAYs when red, thinks at most every 200 ms and taps for one tick only", () => {
    const w = newWorld(1, "free", seeds(2));
    startMatch(w, 1);
    const me = w.blobs.get("agent-0")!;
    me.debt = 120 * MICRO;
    me.mass = 142 * MICRO; // red
    w.vault.lent = me.debt;
    expect(ring(me)).toBe("red");
    const bot = new FreeBot(3);
    const cmds = Array.from({ length: 30 }, (_, i) => bot.decide(agentView(w, "agent-0")!, 2 + i));
    expect(cmds[0]!.repay).toBe(true);
    expect(cmds.slice(1, 12).every((c) => !c.repay && !c.boost)).toBe(true);
    expect(cmds.filter((c) => c.repay).length).toBeLessThanOrEqual(3);
  });
});
