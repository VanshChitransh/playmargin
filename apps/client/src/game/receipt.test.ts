import { describe, expect, it } from "vitest";
import type { BlobView } from "@margin/core";
import { Receipt, centLines } from "./receipt";

const b = (id: string, equity: number, o: Partial<BlobView> = {}): BlobView => ({
  id, kind: "human", label: id, x: 0, y: 0, radius: 50, ring: "green", pips: 3, owe: 0,
  equity, shielded: false, cashingOut: false, state: "alive", ...o,
});

describe("Receipt", () => {
  it("adds up exactly to the final equity", () => {
    const r = new Receipt("me", 80);
    r.frame([b("me", 80), b("x", 50)], "LOW", 0, 0);
    r.event({ type: "pop", by: "me", victim: "x", bounty: 12, keeper: false });
    r.event({ type: "spikeHit", blob: "me", big: true, damage: 5 });
    const o = r.outcome([b("me", 137, { state: "cashed" }), b("x", 0, { state: "popped" })]);
    expect(o.kind).toBe("cashed");
    expect(o.start + o.lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(o.end);
    expect(o.lines.find((l) => l.label === "Popped x")?.amount).toBe(12);
    expect(o.rank).toBe(1);
  });
  it("records who popped me, my leverage and time red", () => {
    const r = new Receipt("me", 80);
    r.frame([b("me", 40, { owe: 60, ring: "red" }), b("a", 90, { kind: "agent", label: "Agent-3" })], "LOW", 1000, 0);
    r.frame([b("me", 40, { owe: 60, ring: "red" })], "LOW", 7000, 0);
    r.event({ type: "pop", by: "a", victim: "me", bounty: 3, keeper: false });
    const o = r.outcome([b("me", 0, { state: "popped" })]);
    expect(o.kind).toBe("popped");
    expect(o.end).toBe(0);
    expect(o.death).toMatchObject({ by: "\u{1F916} Agent-3", leverage: 2.5, redS: 6 });
  });

  it("being eaten is a death too, without a certificate", () => {
    const r = new Receipt("me");
    r.event({ type: "eat", by: "big", victim: "me", gained: 60 });
    const o = r.outcome([]);
    expect(o.kind).toBe("popped");
    expect(o.death).toMatchObject({ by: "big", eaten: true, keeper: false });
    expect(o.lines[0]!.label).toBe("Eaten");
  });

  it("counts food I swallowed, blobs I ate and my best rank", () => {
    const r = new Receipt("me");
    const me = { id: "me", label: "me", kind: "human", state: "alive", x: 0, y: 0, radius: 50, equity: 90, owe: 0, ring: "green" } as never;
    const big = { id: "b", label: "Agent-1", kind: "agent", state: "alive", x: 900, y: 0, radius: 60, equity: 120, owe: 0, ring: "green" } as never;
    r.frame([me, big], "LOW", 0, 0.5, undefined, 1, [{ id: 1, x: 10, y: 0 }, { id: 2, x: 500, y: 0 }]);
    r.frame([me, big], "LOW", 500, 0.5, undefined, 2, [{ id: 2, x: 500, y: 0 }]);
    r.event({ type: "eat", by: "me", victim: "x", gained: 5 });
    const s = r.outcome([me, big]).stats;
    expect(s).toMatchObject({ foodEaten: 1, blobsEaten: 1, topRank: 2, peakEquity: 90, aliveS: 1 });
  });
  it("counts my saves and clutch saves from the server event", () => {
    const r = new Receipt("me");
    r.event({ type: "clutchSave", blob: "me", clutch: false });
    r.event({ type: "clutchSave", blob: "me", clutch: true });
    r.event({ type: "clutchSave", blob: "other", clutch: true });
    expect(r.outcome([]).stats).toMatchObject({ saves: 2, clutches: 1 });
  });

  it("receipt lines in cents always add up to the shown total (QA-E-16)", () => {
    // Three lines that each round to 0.33, but the total is 1.00: one line takes the cent.
    const c = centLines(0, [1 / 3, 1 / 3, 1 / 3], 1);
    expect(c.reduce((s, x) => s + x, 0)).toBe(100);
    expect([...c].sort()).toEqual([33, 33, 34]);
    // A receipt whose lines, each rounded on its own, missed the total by cents.
    const amounts = [105.404, 274.844, -2.754, -4.574, 67.554, -274.844, -18.774];
    const end = 80 + amounts.reduce((s, a) => s + a, 0);
    const cents = centLines(80, amounts, end);
    expect(8000 + cents.reduce((s, x) => s + x, 0)).toBe(Math.round(end * 100));
    cents.forEach((x, i) => expect(Math.abs(x - Math.round(amounts[i]! * 100))).toBeLessThanOrEqual(1));
  });
});
