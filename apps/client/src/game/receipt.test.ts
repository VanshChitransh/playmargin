import { describe, expect, it } from "vitest";
import type { BlobView } from "@margin/core";
import { Receipt } from "./receipt";

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
});
