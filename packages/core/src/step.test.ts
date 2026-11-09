// C3 done-when: a scripted 90 s match ends at exactly MATCH_TICKS, pops resolve before eats,
// and a red blob eats food only. step() runs checkInvariant every tick, so these also prove conservation.
import { describe, expect, it } from "vitest";
import { MATCH_TICKS, MICRO, sToTicks } from "./constants";
import type { InputCmd } from "./protocol";
import { rand, seedRng } from "./rng";
import { step } from "./step";
import { makeBlob, makeWorld } from "./testkit";
import type { PlayerSeed, World } from "./types";
import { newWorld, startMatch } from "./world";

const u = (x: number) => Math.round(x * MICRO);
const seeds = (n: number): PlayerSeed[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: i < 2 ? "human" : "agent", label: `P${i}`, accountId: null }));

/** Plays a whole match with seeded random steering and taps; returns the tick it ended on. */
export function playMatch(seed: number, n = 6, goTick = 600): { w: World; endTick: number } {
  const w = newWorld(seed, "free", seeds(n));
  const bot = { rngState: seedRng(seed ^ 0x9e3779b9) };
  let tick = 0;
  while (w.phase === "WARMUP") {
    tick++;
    if (tick === goTick) startMatch(w, tick);
    else step(w, new Map(), tick);
  }
  while (w.phase !== "ENDED") {
    tick++;
    const inputs = new Map<string, InputCmd>();
    for (const id of w.blobs.keys()) {
      if (rand(bot) < 0.3) {
        const a = rand(bot) * Math.PI * 2;
        inputs.set(id, {
          seq: tick, dirX: Math.cos(a), dirY: Math.sin(a),
          boost: rand(bot) < 0.02, repay: rand(bot) < 0.01, cashout: rand(bot) < 0.005,
        });
      }
    }
    step(w, inputs, tick);
  }
  return { w, endTick: tick - goTick };
}

describe("step", () => {
  it("a scripted 90 s match ends at exactly MATCH_TICKS and pays out everything", () => {
    const { w, endTick } = playMatch(7);
    expect(endTick).toBe(MATCH_TICKS);
    expect(w.food).toEqual([]);
    const paid = [...w.blobs.values()].reduce((s, b) => s + b.payout, 0);
    expect(paid).toBe(w.cashedOut);
    expect(w.pendingLog.at(-1)?.type).toBe("MATCH_END");
  });

  it("a paid Duel (2 humans + a drone) gets the small map", () => {
    const duel = newWorld(1, "paid", [...seeds(2), { id: "d", kind: "drone", label: "D", accountId: null }]);
    expect(duel.arena.w).toBe(newWorld(1, "paid", seeds(2)).arena.w);
    expect(duel.arena.w).toBeLessThan(newWorld(1, "free", seeds(12)).arena.w);
  });

  it("warm-up ghosts move but nothing is charged", () => {
    const w = newWorld(3, "free", seeds(4));
    step(w, new Map([["p0", { seq: 1, dirX: 1, dirY: 0, boost: true, repay: false, cashout: false }]]), 1);
    expect(w.pot).toBe(0);
    expect(w.blobs.get("p0")?.debt).toBe(0);
    startMatch(w, 2);
    expect(w.pot).toBe(4 * 100 * MICRO);
    expect(w.vault.budget).toBe(4 * 150 * MICRO);
  });

  it("a drone holding bounty mass can't BOOST, REPAY or cash out (settle would refuse it)", () => {
    const drone = makeBlob({ id: "d", kind: "drone", mass: u(30), x: 100 });
    const w = makeWorld([drone, makeBlob({ id: "p" })]);
    const t = w.goTick + sToTicks(50);
    step(w, new Map([["d", { seq: 1, dirX: 1, dirY: 0, boost: true, repay: false, cashout: true }]]), t);
    expect(drone.debt).toBe(0);
    expect(drone.cashout).toBeNull();
    expect(w.pendingLog.some((e) => e.type === "BOOST")).toBe(false);
  });

  it("pops resolve before eats: a big red blob is popped by the small toucher", () => {
    // Red (HF 0.923) and past the 300 ms grace; the small blob sits inside it.
    const red = makeBlob({ id: "red", mass: u(300), debt: u(260), redSince: -100 });
    const small = makeBlob({ id: "small", mass: u(100), x: 520 });
    const w = makeWorld([red, small]);
    const ev = step(w, new Map(), 1);
    expect(red.state).toBe("popped");
    expect(small.state).toBe("alive");
    expect(ev).toContainEqual(expect.objectContaining({ type: "pop", by: "small", victim: "red", keeper: false }));
    expect(small.mass).toBeGreaterThan(u(100 + 20)); // bounty 8% of 260
  });

  it("a red blob inside its grace eats food only, never blobs", () => {
    const red = makeBlob({ id: "red", mass: u(300), debt: u(260) });
    const small = makeBlob({ id: "small", mass: u(100), x: 520 });
    const w = makeWorld([red, small]);
    w.food.push({ id: 99, x: 480, y: 500, mass: u(1) });
    w.pot += u(1);
    step(w, new Map(), 1);
    expect(small.state).toBe("alive");
    expect(red.state).toBe("alive");
    expect(red.redSince).toBe(1);
    expect(w.food).toEqual([]);
    expect(red.mass).toBe(u(301));
  });

  it("eat scatter lands outside the eater: the 30% is not swallowed back", () => {
    const a = makeBlob({ mass: u(200) });
    const v = makeBlob({ id: "v", mass: u(100), x: 510 });
    const w = makeWorld([a, v]);
    step(w, new Map(), 1);
    expect(v.state).toBe("popped");
    expect(a.mass).toBe(u(270));
    expect(w.food.reduce((s, f) => s + f.mass, 0)).toBe(u(30));
  });

  it("spike shards land outside the blob that lost them", () => {
    const a = makeBlob({ mass: u(200) });
    const w = makeWorld([a]);
    w.spikes.push({ id: 1, x: 505, y: 500, big: true, respawnAt: null });
    step(w, new Map(), 1);
    expect(a.mass).toBe(u(160));
    expect(w.food.reduce((s, f) => s + f.mass, 0)).toBe(u(40));
  });

  it("held input expires after 250 ms (no stuck BOOST or steering)", () => {
    const a = makeBlob();
    const w = makeWorld([a]);
    step(w, new Map([["a", { seq: 1, dirX: 1, dirY: 0, boost: false, repay: false, cashout: false }]]), 1);
    for (let t = 2; t <= 16; t++) step(w, new Map(), t);
    expect(a.dirX).toBe(1);
    step(w, new Map(), 17);
    expect(a.dirX).toBe(0);
  });

  it("cash-out: opens at 45 s, 4 s channel, a heavier toucher cancels it", () => {
    const a = makeBlob();
    const w = makeWorld([a]);
    const tap = { seq: 1, dirX: 0, dirY: 0, boost: false, repay: false, cashout: true };
    step(w, new Map([["a", tap]]), sToTicks(44));
    expect(a.cashout).toBeNull();
    const open = sToTicks(45);
    step(w, new Map([["a", tap]]), open);
    expect(a.cashout).not.toBeNull();
    const big = makeBlob({ id: "big", mass: u(200), x: 2000 - 10, y: 2000 - 10 });
    w.blobs.set("big", big);
    w.pot += big.mass;
    let ev = step(w, new Map(), open + 1);
    big.x = a.x + 30;
    big.y = a.y;
    ev = step(w, new Map(), open + 2);
    expect(ev).toContainEqual({ type: "cashoutCancel", blob: "a", reason: "contact" });
    expect(a.state).toBe("popped"); // and then it got eaten
  });
});
