// C2 done-when: the RULES "Worked check" table, reproduced exactly in Micro, plus the pop split.
import { describe, expect, it } from "vitest";
import { MICRO } from "./constants";
import {
  accrueInterest, boostHold, boostRoom, canBoost, cashOut, eat, flushBoost, fuel, hfBps, hitSpike, keeperCheck,
  flushRepay, liquidate, matchRateBps, repayHold, ring, spikeDamage, zoneTick,
} from "./economy";
import { leak, makeBlob, makeWorld } from "./testkit";

const u = (x: number) => Math.round(x * MICRO);

describe("RULES worked check", () => {
  it("80 -> hold BOOST to the cap -> spike -> hold REPAY out of red", () => {
    const a = makeBlob();
    const w = makeWorld([a]);
    expect(ring(a)).toBe("green");

    // 1x own money per second: 1,333,333 Micro a tick, so the 120 of room fills in 91 ticks (~1.5 s).
    let tick = 1;
    while (boostHold(w, a, tick) > 0) tick++;
    expect(tick).toBe(92);
    expect(fuel(a)).toBe(0);
    expect(a.mass).toBe(u(200));
    expect(flushBoost(w, a, tick)).toBe(u(120)); // one BOOST entry for the whole hold, fee 1.2
    expect(w.pendingLog.filter((e) => e.type === "BOOST")).toHaveLength(1);
    expect(a.mass).toBe(u(198.8));
    expect(a.debt).toBe(u(120));
    expect(hfBps(a)).toBe(13253); // 1.33
    expect(ring(a)).toBe("green");
    expect(boostRoom(a)).toBe(0);
    expect(boostHold(w, a, tick)).toBe(0); // tank empty

    expect(hitSpike(w, a, 1, true, 10)).toBe(u(198.8 - 142.5));
    expect(a.mass).toBe(u(142.5));
    expect(hfBps(a)).toBe(9500);
    expect(ring(a)).toBe("red");
    expect(keeperCheck(w, a, 10)).toBeNull(); // red, not dead

    // Held REPAY pays 1.5x own money a second, linear: (22.5 + 1.2 fees) x 1.5 / 60 = 0.5925 a tick
    // (fees shrink with the loan, so a touch less). Red ends at debt 90 (HF 1.0): 51 ticks, 0.85 s.
    let t = 20;
    while (ring(a) === "red") repayHold(w, a, t++);
    expect(t - 20).toBe(51);
    expect(a.debt).toBeLessThanOrEqual(u(90));
    expect(a.mass - a.debt).toBe(u(22.5)); // repaying never changes equity
    expect(w.pendingLog.filter((e) => e.type === "REPAY")).toHaveLength(0); // pending until release
    expect(flushRepay(w, a, t)).toBe(u(120) - a.debt);
    expect(w.pendingLog.filter((e) => e.type === "REPAY")).toHaveLength(1);
    expect(ring(a)).toBe("yellow");
    expect(leak(w)).toBe(0);
  });

  it("pop split: vault 120, popper 9.6, reserve 2.4, scatter 10.5", () => {
    const v = makeBlob({ id: "v", mass: u(142.5), debt: u(120) });
    const p = makeBlob({ id: "p", mass: u(50) });
    const w = makeWorld([v, p], { vault: { budget: u(300), lent: u(120), repaid: 0, interest: 0, badDebt: 0 }, pot: u(192.5 - 120) });
    const r = liquidate(w, v, p, 5);
    expect(r).toEqual({ debtRepaid: u(120), badDebt: 0, bounty: u(9.6), fee: u(2.4), scattered: u(10.5) });
    expect(p.mass).toBe(u(59.6));
    expect(w.reserve).toBe(u(2.4));
    expect(w.food.reduce((s, f) => s + f.mass, 0)).toBe(u(10.5));
    expect(v.state).toBe("popped");
    expect(leak(w)).toBe(0);
  });
});

describe("BOOST (hold to nitro)", () => {
  it("borrows 1x own money per second while held: 200 -> ~200 in 1 s, 50 -> ~50", () => {
    const big = makeBlob({ mass: u(200) });
    const small = makeBlob({ id: "s", mass: u(50) });
    const w = makeWorld([big, small]);
    for (let t = 1; t <= 60; t++) {
      boostHold(w, big, t);
      boostHold(w, small, t);
    }
    expect(Math.abs(big.debt - u(200))).toBeLessThanOrEqual(60);
    expect(Math.abs(small.debt - u(50))).toBeLessThanOrEqual(60);
    expect(big.boostUntil).toBe(61); // x1.5 speed only while it borrows
    expect(leak(w)).toBe(0);
    expect(flushBoost(w, big, 61)).toBe(big.debt);
    expect(flushBoost(w, big, 62)).toBe(0);
    expect(leak(w)).toBe(0);
  });
  it("blocked when shielded, cashing out, after 80 s, outside LIVE, for drones", () => {
    const a = makeBlob({ shieldUntil: 100 });
    const w = makeWorld([a]);
    expect(canBoost(w, a, 50)).toBe(false);
    expect(canBoost(w, a, 100)).toBe(true);
    expect(canBoost(w, a, 80 * 60)).toBe(false);
    a.cashout = { startedAt: 100 };
    expect(canBoost(w, a, 200)).toBe(false);
    a.cashout = null;
    w.phase = "WARMUP";
    expect(canBoost(w, a, 200)).toBe(false);
    w.phase = "LIVE";
    a.kind = "drone";
    expect(canBoost(w, a, 200)).toBe(false);
  });
  it("blocked when red; REPAY or eating refills the tank", () => {
    const a = makeBlob({ mass: u(142.5), debt: u(120), boostFees: u(1.2) });
    const w = makeWorld([a]);
    expect(canBoost(w, a, 1)).toBe(false);
    a.mass += u(60);
    expect(ring(a)).toBe("green");
    expect(fuel(a)).toBeGreaterThan(0);
  });
  it("a REPAY mid-hold logs the loan first, so settle sees the debt it repays", () => {
    const a = makeBlob();
    const w = makeWorld([a]);
    for (let t = 1; t <= 30; t++) boostHold(w, a, t);
    repayHold(w, a, 31);
    expect(w.pendingLog.map((e) => e.type)).toEqual(["BOOST"]);
    expect(a.pendingBorrow).toBe(0);
    boostHold(w, a, 32); // borrowing again logs the open repayment first
    expect(w.pendingLog.map((e) => e.type)).toEqual(["BOOST", "REPAY"]);
    expect(leak(w)).toBe(0);
  });

  it("a full-cap loan clears in 1 s of held REPAY", () => {
    const a = makeBlob({ mass: u(200), debt: u(120) }); // equity 80: 2 units a tick
    const w = makeWorld([a]);
    let t = 1;
    while (repayHold(w, a, t) > 0) t++;
    expect(t - 1).toBe(60);
    expect(a.debt).toBe(0);
    expect(leak(w)).toBe(0);
  });

  it("a held REPAY pays the debt off exactly and logs it at once", () => {
    const a = makeBlob({ mass: u(100), debt: u(3) });
    const w = makeWorld([a]);
    let t = 1;
    while (repayHold(w, a, t) > 0) t++;
    expect(a.debt).toBe(0);
    expect(a.pendingRepay).toBe(0);
    const logged = w.pendingLog.filter((e) => e.type === "REPAY").reduce((s, e) => s + (e.data as { amount: number }).amount, 0);
    expect(logged).toBe(u(3));
    expect(leak(w)).toBe(0);
  });
});

describe("audit: borrow/repay cycles", () => {
  it("never ratchet the cap past 2.5x or push a BOOST into red", () => {
    const a = makeBlob();
    const w = makeWorld([a]);
    let tick = 1;
    for (let cycle = 0; cycle < 120; cycle++) {
      while (boostHold(w, a, tick) > 0) tick++;
      flushBoost(w, a, tick++);
      while (a.debt > 1) repayHold(w, a, tick++);
      expect(a.mass * 10_000).toBeLessThanOrEqual(25_200 * (a.mass - a.debt) + 10_000);
    }
    w.vault.budget = 10 * a.mass;
    while (boostHold(w, a, tick) > 0) tick++;
    flushBoost(w, a, tick);
    expect(ring(a)).toBe("green");
    expect(leak(w)).toBe(0);
  });
});

describe("interest, zone, keeper", () => {
  it("kinked curve: 6% at 0, 15% at 80% util, 75% at 100%", () => {
    expect(matchRateBps(0)).toBe(600);
    expect(matchRateBps(8000)).toBe(1500);
    expect(matchRateBps(10_000)).toBe(7500);
    expect(matchRateBps(4000)).toBe(1050);
  });
  it("debt 120 at 6%/min drains 0.12/s from mass only, split 80/15/5", () => {
    const a = makeBlob({ mass: u(200), debt: u(120) });
    const w = makeWorld([a], { vault: { budget: u(300), lent: u(120), repaid: 0, interest: 0, badDebt: 0 }, pot: u(80) });
    expect(accrueInterest(w, a, 60)).toBe(u(0.12));
    expect(a.debt).toBe(u(120));
    expect(w.vault.interest).toBe(u(0.018));
    expect(w.reserve).toBe(u(0.006));
    expect(w.foodPool).toBe(u(0.096)); // a crumb: pooled until it makes a whole pellet
    expect(w.food).toHaveLength(0);
    expect(leak(w)).toBe(0);
  });
  it("zone takes 4%/s; keeper pops below HF 0.90 and the vault is whole", () => {
    const a = makeBlob({ mass: u(100) });
    const w = makeWorld([a]);
    expect(zoneTick(w, a)).toBe(u(4));
    expect(leak(w)).toBe(0);

    const b = makeBlob({ id: "b", mass: u(134), debt: u(120) }); // HF 0.893
    const w2 = makeWorld([b], { vault: { budget: u(300), lent: u(120), repaid: 0, interest: 0, badDebt: 0 }, pot: u(14) });
    expect(keeperCheck(w2, b, 1)?.debtRepaid).toBe(u(120));
    expect(w2.vault.repaid).toBe(u(120));
    expect(w2.reserve).toBe(u(12)); // bounty 9.6 + fee 2.4 both to reserve
    expect(leak(w2)).toBe(0);
  });
  it("bad debt is recorded, never hidden", () => {
    const v = makeBlob({ id: "v", mass: u(50), debt: u(100) });
    const w = makeWorld([v]);
    const r = liquidate(w, v, null, 1);
    expect(r).toMatchObject({ debtRepaid: u(50), badDebt: u(50), bounty: 0, fee: 0, scattered: 0 });
    expect(w.vault.badDebt).toBe(u(50));
    expect(w.vault.lent - w.vault.repaid - w.vault.badDebt).toBe(0);
    expect(leak(w)).toBe(0);
  });
  it("spike without debt is 10% / 20% and has no floor", () => {
    const a = makeBlob({ mass: u(100) });
    expect(spikeDamage(a, false)).toBe(u(10));
    expect(spikeDamage(a, true)).toBe(u(20));
  });
});

describe("eat and cash-out", () => {
  it("eater gets 70% of equity after the victim's debt is repaid", () => {
    const e = makeBlob({ id: "e", mass: u(300) });
    const v = makeBlob({ id: "v", mass: u(150), debt: u(50) });
    const w = makeWorld([e, v], { vault: { budget: u(600), lent: u(50), repaid: 0, interest: 0, badDebt: 0 }, pot: u(400) });
    expect(eat(w, e, v, 1)).toBe(u(70));
    expect(w.vault.repaid).toBe(u(50));
    expect(w.food.reduce((s, f) => s + f.mass, 0)).toBe(u(30));
    expect(leak(w)).toBe(0);
  });
  it("cash-out repays debt and pays equity", () => {
    const a = makeBlob();
    const w = makeWorld([a]);
    for (let t = 1; t <= 30; t++) boostHold(w, a, t); // half a second: 39,999,990 borrowed, fee 0.4
    expect(cashOut(w, a, 31)).toBe(u(79.6));
    expect(a.state).toBe("cashed");
    expect(a.payout).toBe(u(79.6));
    expect(w.vault.repaid).toBe(39_999_990);
    expect(leak(w)).toBe(0);
  });
});
