// C3 done-when: a scripted 90 s match ends at exactly MATCH_TICKS, pops resolve before eats,
// and a red blob eats food only. step() runs checkInvariant every tick, so these also prove conservation.
import { describe, expect, it } from "vitest";
import { MATCH_TICKS, MICRO, sToTicks } from "./constants";
import type { InputCmd } from "./protocol";
import { rand, seedRng } from "./rng";
import { radius } from "./motion";
import { step } from "./step";
import { leak, makeBlob, makeWorld } from "./testkit";
import type { PlayerSeed, World } from "./types";
import { addPlayer, newWorld, spikeRadius, startMatch } from "./world";

const u = (x: number) => Math.round(x * MICRO);
const seeds = (n: number): PlayerSeed[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: i < 2 ? "human" : "agent", label: `P${i}`, accountId: null }));

/** Plays a whole match with seeded random steering and taps; returns the tick it ended on. */
export function playMatch(seed: number, n = 6, goTick = 600, rateBps?: number): { w: World; endTick: number } {
  const w = newWorld(seed, "free", seeds(n));
  const bot = { rngState: seedRng(seed ^ 0x9e3779b9) };
  let tick = 0;
  while (w.phase === "WARMUP") {
    tick++;
    if (tick === goTick) startMatch(w, tick, rateBps, rateBps === undefined ? undefined : "test rate");
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

  it("spawns keep SPAWN_EDGE_MARGIN_PX from every edge: GO on a small Duel map and a late join", () => {
    const edge = (w: World, x: number, y: number) => Math.min(x, y, w.arena.w - x, w.arena.h - y);
    const duel = newWorld(4, "paid", seeds(2));
    startMatch(duel, 1);
    for (const b of duel.blobs.values()) expect(edge(duel, b.x, b.y)).toBeGreaterThanOrEqual(300 - 1e-9);
    const free = newWorld(4, "free", seeds(3));
    startMatch(free, 1);
    for (let i = 0; i < 50; i++) {
      const b = addPlayer(free, { id: `late${i}`, kind: "human", label: "L", accountId: null }, 2);
      expect(edge(free, b.x, b.y)).toBeGreaterThanOrEqual(300);
    }
  });

  it("nobody spawns near a spike: blob + spike radius + 120 px at GO and on late join, 40 seeds", () => {
    const clear = (w: World, b: { x: number; y: number; mass: number }) =>
      w.spikes.every((k) => k.respawnAt !== null || Math.hypot(k.x - b.x, k.y - b.y) >= radius(b.mass) + spikeRadius(k) + 120);
    for (let seed = 1; seed <= 40; seed++) {
      const w = newWorld(seed, "free", seeds(12));
      startMatch(w, 1);
      for (const b of w.blobs.values()) expect(clear(w, b)).toBe(true);
      const late = addPlayer(w, { id: `late${seed}`, kind: "human", label: "L", accountId: null }, 2);
      expect(clear(w, late)).toBe(true);
    }
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

  describe("leftover food at the bell (Vansh, 9 Nov)", () => {
    // Two humans; food worth 10 units lies far from both, so nobody eats it on the last tick.
    const bell = (states: Array<"alive" | "popped" | "cashed">) => {
      const bs = states.map((st, i) => makeBlob({ id: `h${i}`, mass: u(50), x: 100 + i * 300, state: st }));
      const w = makeWorld(bs);
      for (const b of bs) if (b.state !== "alive") { w.pot -= b.mass; b.mass = 0; }
      w.food.push({ id: 99, x: 1900, y: 1900, mass: u(10) });
      w.pot += u(10);
      step(w, new Map(), MATCH_TICKS);
      const end = w.pendingLog.at(-1);
      return { w, bs, end: end?.type === "MATCH_END" ? end.data : null };
    };

    it("nobody survives: all of it goes to the vault, popped players get nothing more", () => {
      const { w, bs, end } = bell(["popped", "popped"]);
      expect(end?.toVault).toBe(u(10));
      expect(w.vault.interest).toBe(u(10));
      expect(bs.map((b) => b.payout)).toEqual([0, 0]);
      expect(leak(w)).toBe(0);
    });

    it("all cashed out early: nobody alive at the bell, so the vault takes it", () => {
      const { w, end } = bell(["cashed", "cashed"]);
      expect(end?.toVault).toBe(u(10));
      expect(w.vault.interest).toBe(u(10));
      expect(leak(w)).toBe(0);
    });

    it("the bonus is capped at half the survivor's bell equity, the rest goes to the vault (Vansh, 10 Nov)", () => {
      const b = makeBlob({ id: "h0", mass: u(50), x: 100 });
      const w = makeWorld([b]);
      w.food.push({ id: 99, x: 1900, y: 1900, mass: u(40) });
      w.pot += u(40);
      step(w, new Map(), MATCH_TICKS);
      const end = w.pendingLog.at(-1);
      expect(b.payout).toBe(u(50) + u(25));
      expect(end?.type === "MATCH_END" && end.data.toVault).toBe(u(15));
      expect(w.vault.interest).toBe(u(15));
      expect(leak(w)).toBe(0);
    });

    it("one survivor takes all of it, the vault nothing", () => {
      const { w, bs, end } = bell(["alive", "popped"]);
      expect(end?.toVault).toBe(0);
      expect(bs[0]?.payout).toBe(u(60));
      expect(w.vault.interest).toBe(0);
      expect(leak(w)).toBe(0);
    });
  });

  it("an agent can't eat a human in the first 30 s, then can", () => {
    const agent = makeBlob({ id: "ag", kind: "agent", mass: u(200) });
    const human = makeBlob({ id: "hu", mass: u(80), x: 510 });
    const w = makeWorld([agent, human]);
    step(w, new Map(), sToTicks(29));
    expect(human.state).toBe("alive");
    step(w, new Map(), sToTicks(30));
    expect(human.state).toBe("popped");
  });

  it("a late joiner gets the agents' 30 s no-eat window from their own join", () => {
    const agent = makeBlob({ id: "ag", kind: "agent", mass: u(200) });
    const human = makeBlob({ id: "hu", mass: u(80), x: 510, joinedAt: sToTicks(10) });
    const w = makeWorld([agent, human]);
    step(w, new Map(), sToTicks(35)); // 35 s after GO, only 25 s after the join
    expect(human.state).toBe("alive");
    step(w, new Map(), sToTicks(40));
    expect(human.state).toBe("popped");
  });

  it("a BOOST tap borrows at least 0.1 s worth, bursts once, and the burst has a cooldown", () => {
    const a = makeBlob();
    const w = makeWorld([a]);
    const tap = (t: number, boost: boolean) => step(w, new Map([["a", { seq: t, dirX: 1, dirY: 0, boost, repay: false, cashout: false }]]), t);
    tap(1, true);
    expect(a.burst).toBeGreaterThan(0);
    for (let t = 2; t <= 10; t++) tap(t, false); // released after one tick
    const borrowed = w.pendingLog.filter((e) => e.type === "BOOST").reduce((s, e) => s + (e.data as { borrowed: number }).borrowed, 0);
    expect(borrowed).toBeGreaterThanOrEqual(Math.floor(0.1 * 80 * MICRO) - 10 * 6); // ~8 units, per-tick floors aside
    tap(11, true);
    expect(a.burstReadyAt).toBe(1 + sToTicks(0.8)); // second press inside 0.8 s: no new burst
  });

  it("held REPAY escapes red, with a clutch save; release logs it", () => {
    const red = makeBlob({ id: "r", mass: u(142.5), debt: u(120), redSince: 0 });
    const w = makeWorld([red, makeBlob({ id: "big", mass: u(400), x: 700 })]);
    const press = (t: number, repay: boolean) =>
      step(w, new Map([["r", { seq: t, dirX: 0, dirY: 0, boost: false, repay, cashout: false }]]), t);
    let savedAt = 0;
    for (let t = 1; t <= 60 && !savedAt; t++) {
      const ev = press(t, true);
      const save = ev.find((e) => e.type === "clutchSave");
      if (!save) continue;
      expect(save).toEqual({ type: "clutchSave", blob: "r", clutch: true });
      savedAt = t;
    }
    // The hold clears 120 in 0.8 s (2.5 a tick): debt 90 (HF 1.0) after 12 ticks.
    expect(savedAt).toBe(12);
    expect(w.pendingLog.some((e) => e.type === "REPAY")).toBe(false); // still pending while held
    const ev = press(savedAt + 1, false);
    expect(ev.some((e) => e.type === "repay")).toBe(true);
    expect(red.pendingRepay).toBe(0);
  });

  it("a REPAY tap (one message) pays a 0.1 s chunk, 1/8 of the loan", () => {
    const a = makeBlob({ id: "a", mass: u(200), debt: u(100) });
    const w = makeWorld([a]);
    const send = (t: number, repay: boolean) =>
      step(w, new Map([["a", { seq: t, dirX: 0, dirY: 0, boost: false, repay, cashout: false }]]), t);
    send(1, true);
    for (let t = 2; t <= 1 + sToTicks(0.4); t++) send(t, false);
    expect(a.debt).toBe(u(100) - 6 * Math.ceil(u(100) / 48)); // 6 ticks of 100 / 48
    expect(w.pendingLog.filter((e) => e.type === "REPAY")).toHaveLength(1);
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
    // Red (HF 0.923) and past the 150 ms grace; the small blob sits inside it.
    const red = makeBlob({ id: "red", mass: u(300), debt: u(260), redSince: -100 });
    const small = makeBlob({ id: "small", mass: u(100), x: 520 });
    const w = makeWorld([red, small]);
    const ev = step(w, new Map(), 1);
    expect(red.state).toBe("popped");
    expect(small.state).toBe("alive");
    expect(ev).toContainEqual(expect.objectContaining({ type: "pop", by: "small", victim: "red", keeper: false }));
    expect(small.mass).toBeGreaterThan(u(100 + 20)); // bounty 8% of 260
  });

  it("a red blob eats nothing, not even food: REPAY is the only way out (balance B)", () => {
    const red = makeBlob({ id: "red", mass: u(300), debt: u(260) });
    const small = makeBlob({ id: "small", mass: u(100), x: 520 });
    const w = makeWorld([red, small]);
    w.food.push({ id: 99, x: 420, y: 500, mass: u(1) }); // inside red's reach, out of small's (64 + 23 px)
    w.pot += u(1);
    step(w, new Map(), 1);
    expect(small.state).toBe("alive");
    expect(red.state).toBe("alive");
    expect(red.redSince).toBe(1);
    expect(w.food).toHaveLength(1);
    expect(red.mass).toBe(u(300));
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
