// C2 done-when: the RULES "Worked check" table, reproduced exactly in Micro, plus the pop split.
import { describe, expect, it } from "vitest";
import { MICRO } from "./constants";
import {
  accrueInterest, boostRoom, boostTap, canBoost, cashOut, eat, hfBps, hitSpike, keeperCheck,
  liquidate, matchRateBps, refillPips, repayTap, ring, spikeDamage, zoneTick,
} from "./economy";
import { leak, makeBlob, makeWorld } from "./testkit";

const u = (x: number) => Math.round(x * MICRO);

describe("RULES worked check", () => {
  it("80 -> 3 taps -> spike -> 2 REPAY taps", () => {
    const a = makeBlob();
    const w = makeWorld([a]);
    expect(ring(a)).toBe("green");

    for (let i = 0; i < 3; i++) expect(boostTap(w, a, 1 + i)).toBe(u(40));
    expect(a.mass).toBe(u(198.8));
    expect(a.debt).toBe(u(120));
    expect(hfBps(a)).toBe(13253); // 1.33
    expect(ring(a)).toBe("green");
    expect(boostRoom(a)).toBe(0);
    expect(boostTap(w, a, 4)).toBe(0); // no pips, no room

    expect(hitSpike(w, a, 1, true, 10)).toBe(u(198.8 - 142.5));
    expect(a.mass).toBe(u(142.5));
    expect(hfBps(a)).toBe(9500);
    expect(ring(a)).toBe("red");
    expect(keeperCheck(w, a, 10)).toBeNull(); // red, not dead

    expect(repayTap(w, a, 20)).toBe(u(18));
    expect([a.mass, a.debt]).toEqual([u(124.5), u(102)]);
    expect(repayTap(w, a, 21)).toBe(0); // 0.4 s cooldown
    expect(repayTap(w, a, 20 + 24)).toBe(u(15.3));
    expect([a.mass, a.debt]).toEqual([u(109.2), u(86.7)]);
    expect(hfBps(a)).toBe(10076); // 1.01
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

describe("BOOST", () => {
  it("chunks are 0.5x own money: 200 -> 100, 50 -> 25", () => {
    const big = makeBlob({ mass: u(200) });
    const small = makeBlob({ id: "s", mass: u(50) });
    const w = makeWorld([big, small]);
    expect(boostTap(w, big, 1)).toBe(u(100));
    expect(boostTap(w, small, 1)).toBe(u(25));
    expect(leak(w)).toBe(0);
  });
  it("blocked when shielded, cashing out, after 80 s, outside LIVE; pips refill after 3 s", () => {
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
    boostTap(w, a, 200);
    expect(a.pips).toBe(2);
    refillPips(a, 200 + 179);
    expect(a.pips).toBe(2);
    refillPips(a, 200 + 180);
    expect(a.pips).toBe(3);
  });
  it("blocked when red; eating raises the limit again", () => {
    const a = makeBlob({ mass: u(142.5), debt: u(120), boostFees: u(1.2) });
    const w = makeWorld([a]);
    expect(canBoost(w, a, 1)).toBe(false);
    a.mass += u(60);
    expect(ring(a)).toBe("green");
    expect(boostRoom(a)).toBeGreaterThan(0);
  });
});

describe("audit: borrow/repay cycles", () => {
  it("never ratchet the cap past 2.5x or push a BOOST into red", () => {
    const a = makeBlob();
    const w = makeWorld([a]);
    let tick = 1;
    for (let cycle = 0; cycle < 120; cycle++) {
      for (let i = 0; i < 3; i++) {
        a.pips = 3;
        boostTap(w, a, tick++);
      }
      while (a.debt > 1) {
        a.repayReadyAt = 0;
        repayTap(w, a, tick++);
      }
      expect(a.mass * 10_000).toBeLessThanOrEqual(25_200 * (a.mass - a.debt) + 10_000);
    }
    w.vault.budget = 10 * a.mass;
    a.pips = 3;
    for (let i = 0; i < 3; i++) boostTap(w, a, tick++);
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
    expect(w.food[0]?.mass).toBe(u(0.096));
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
    boostTap(w, a, 1);
    expect(cashOut(w, a, 2)).toBe(u(79.6));
    expect(a.state).toBe("cashed");
    expect(a.payout).toBe(u(79.6));
    expect(w.vault.repaid).toBe(u(40));
    expect(leak(w)).toBe(0);
  });
});
