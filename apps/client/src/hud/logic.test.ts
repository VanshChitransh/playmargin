import { describe, expect, it } from "vitest";
import type { BlobView, MatchView } from "@margin/core";
import { displayName, boostBlocked, boostPreview, cashoutOpen, interestPerS, phaseName, fuelGradient, ranking } from "./logic";

const me = (o: Partial<BlobView> = {}): BlobView => ({
  id: "me", kind: "human", label: "me", x: 0, y: 0, radius: 57, ring: "green", pips: 3,
  owe: 0, equity: 80, shielded: false, cashingOut: false, state: "alive", ...o,
});
const live = (timeLeftS: number): MatchView => ({
  mode: "free", phase: "LIVE", tick: 0, timeLeftS, rateTier: "LOW", zone: { cx: 0, cy: 0, r: 1 }, leaderboard: [],
});

describe("hud logic", () => {
  it("names phases by elapsed seconds", () => {
    expect([phaseName(0), phaseName(29), phaseName(30), phaseName(60)]).toEqual(["GROW", "GROW", "HUNT", "SQUEEZE"]);
  });
  it("blocks BOOST when red, shielded, out of pips, before GO or after 80 s", () => {
    expect(boostBlocked(me(), live(60))).toBe(false);
    expect(boostBlocked(me({ ring: "red" }), live(60))).toBe(true);
    expect(boostBlocked(me({ shielded: true }), live(60))).toBe(true);
    expect(boostBlocked(me({ fuel: 0 }), live(60))).toBe(true);
    expect(boostBlocked(me(), { ...live(60), phase: "WARMUP" })).toBe(true);
    expect(boostBlocked(me(), live(10))).toBe(true); // 80 s elapsed
  });
  it("opens cash-out only from 45 s to 80 s and never while red", () => {
    expect(cashoutOpen(me(), live(46))).toBe(false); // 44 s
    expect(cashoutOpen(me(), live(45))).toBe(true);
    expect(cashoutOpen(me({ ring: "red" }), live(30))).toBe(false);
    expect(cashoutOpen(me(), live(10))).toBe(false); // 80 s
  });
  it("previews 80 -> 160 after 1 s of nitro and 200 with all fuel", () => {
    const p = boostPreview(me())!;
    expect(p.next).toBeCloseTo(4 + Math.sqrt(160) * 6);
    expect(p.max).toBeCloseTo(4 + Math.sqrt(200) * 6);
    expect(boostPreview(me({ fuel: 0 }))).toBeNull();
  });
  it("charges interest only on debt", () => {
    expect(interestPerS(0, "HIGH")).toBe(0);
    expect(interestPerS(60, "LOW")).toBeCloseTo(0.06);
    expect(interestPerS(60, "LOW", 1500)).toBeCloseTo(0.15); // the server rate wins over the tier
  });
  it("ranks by equity and drops drones and the dead", () => {
    const r = ranking([me({ id: "a", equity: 5 }), me({ id: "b", equity: 9 }), me({ id: "d", kind: "drone", equity: 99 }), me({ id: "x", state: "popped", equity: 50 })]);
    expect(r.map((b) => b.id)).toEqual(["b", "a"]);
  });
  it("draws one fuel arc", () => {
    expect(fuelGradient(0.5, "red", "grey")).toBe("conic-gradient(red 0deg 180deg, grey 180deg 360deg)");
  });
  it("labels agents once with the robot", () => {
    expect(displayName({ kind: "agent", label: "Agent-1 \u{1F916}" })).toBe("\u{1F916} Agent-1");
    expect(displayName({ kind: "agent", label: "Agent-2" })).toBe("\u{1F916} Agent-2");
    expect(displayName({ kind: "human", label: "riya" })).toBe("riya");
  });
  it("keeps a stable order for equal shown equity, so ranks match rows", () => {
    const r = ranking([me({ id: "c", equity: 95.2 }), me({ id: "a", equity: 94.8 }), me({ id: "b", equity: 95.4 }), me({ id: "d", equity: 120 })]);
    expect(r.map((b) => b.id)).toEqual(["d", "a", "b", "c"]);
  });
});
