import { MICRO, R, type LogEntry } from "@margin/core";
import { describe, expect, it } from "vitest";
import { mergeLog, receiptFromLog, type Outcome } from "./receipt";

const M = (x: number): number => x * MICRO;
const log = (events: Array<Pick<LogEntry, "type" | "data">>): LogEntry[] =>
  events.map((e, seq) => ({ ...e, seq, tick: seq, prevHash: "", hash: "" }) as LogEntry);
const join = (id: string, label: string) => ({ type: "JOIN", data: { player: { id, label, kind: "human", accountId: null } } }) as never;

describe("receiptFromLog", () => {
  it("itemises a liquidation and ends at zero", () => {
    const r = receiptFromLog(
      log([
        join("me", "you"),
        join("a3", "Agent-3"),
        { type: "CHARGE", data: { blob: "me", entry: M(100) } },
        { type: "BOOST", data: { blob: "me", borrowed: M(40), fee: M(0.4) } },
        { type: "INTEREST", data: { blob: "me", amount: M(2), toFood: 0, toVault: 0, toReserve: 0 } },
        { type: "SPIKE", data: { blob: "me", spike: 1, damage: M(20) } },
        { type: "POP", data: { by: "a3", victim: "me", debtRepaid: M(40), badDebt: 0, bounty: M(3.2), fee: M(0.8), scattered: M(60) } },
        { type: "MATCH_END", data: { tick: 0, finalMasses: {}, dust: 0, toVault: 0, ranking: [] } },
      ]),
      "me",
    )!;
    expect(r.start).toBe(80);
    expect(r.end).toBe(0);
    const by = Object.fromEntries(r.lines.map((l) => [l.label, l.amount]));
    expect(by["Borrowed (BOOST)"]).toBe(40);
    expect(by["Liquidated: bounty to Agent-3"]).toBe(-3.2);
    expect(r.start + r.lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(r.end, 6);
  });

  it("splits the bell leftover from the cash-out", () => {
    const r = receiptFromLog(
      log([
        join("me", "you"),
        { type: "CHARGE", data: { blob: "me", entry: M(100) } },
        { type: "CASHOUT", data: { blob: "me", amount: M(95) } },
        { type: "CASHOUT", data: { blob: "me", amount: M(5) } },
        { type: "MATCH_END", data: { tick: 0, finalMasses: {}, dust: 0, toVault: 0, ranking: [] } },
      ]),
      "me",
    )!;
    expect(r.end).toBe(100);
    expect(r.lines).toEqual([
      { label: "Food minus zone", amount: 15 },
      { label: "Leftover food share", amount: 5 },
    ]);
  });

  it("refuses a log fetched before the bell landed (no MATCH_END), so the live receipt is kept", () => {
    const r = receiptFromLog(
      log([
        join("me", "you"),
        { type: "CHARGE", data: { blob: "me", entry: M(100) } },
        { type: "BOOST", data: { blob: "me", borrowed: M(40), fee: M(0.4) } },
      ]),
      "me",
    );
    expect(r).toBeNull();
  });

  it("title, killer, time alive and blobs eaten come from the log, even when the live receipt saw nothing", () => {
    // Vansh's run: Play again resumed the old seat after he was eaten, so the live receipt never
    // saw his blob alive (all zero, no death) while the log says Agent-6 ate him.
    const at = (tick: number, e: Pick<LogEntry, "type" | "data">) => ({ ...e, tick });
    const entries = [
      at(0, join("me", "Vansh")),
      at(0, join("a6", "Agent-6")),
      at(0, join("b2", "Agent-2")),
      at(600, { type: "CHARGE", data: { blob: "me", entry: M(100) } }),
      at(900, { type: "EAT", data: { by: "me", victim: "b2", debtRepaid: 0, badDebt: 0, gained: M(30), scattered: M(10) } }),
      at(600 + 40 * R.TICK_HZ, { type: "EAT", data: { by: "a6", victim: "me", debtRepaid: 0, badDebt: 0, gained: M(70), scattered: M(40) } }),
      at(6000, { type: "MATCH_END", data: { tick: 6000, finalMasses: {}, dust: 0, toVault: 0, ranking: [] } }),
    ].map((e, seq) => ({ ...e, seq, prevHash: "", hash: "" }) as LogEntry);
    const r = receiptFromLog(entries, "me")!;
    expect(r.kind).toBe("popped");
    expect(r.fate).toEqual({ by: "Agent-6", keeper: false, eaten: true });
    expect(r.aliveS).toBe(40);
    expect(r.blobsEaten).toBe(1);
    const live: Outcome = {
      kind: "popped", start: 80, end: 0, lines: [], rank: 9, of: 12,
      stats: { foodEaten: 0, aliveS: 0, blobsEaten: 0, saves: 0, clutches: 0, topRank: 9, peakEquity: 0 },
    };
    const o = mergeLog(live, r);
    expect(o.death).toMatchObject({ by: "Agent-6", eaten: true, keeper: false });
    expect(o.stats).toMatchObject({ aliveS: 40, blobsEaten: 1 });
    expect(o.lines.map((l) => l.label)).toContain("Eaten: to Agent-6");
  });

  it("a cash-out before the bell is CASHED OUT, the bell payout is SURVIVED", () => {
    const run = (cashTick: number) =>
      receiptFromLog(
        [
          { type: "JOIN", data: { player: { id: "me", label: "you", kind: "human", accountId: null } }, tick: 0 },
          { type: "CHARGE", data: { blob: "me", entry: M(100) }, tick: 0 },
          { type: "CASHOUT", data: { blob: "me", amount: M(90) }, tick: cashTick },
          { type: "MATCH_END", data: { tick: 5400, finalMasses: {}, dust: 0, toVault: 0, ranking: [] }, tick: 5400 },
        ].map((e, seq) => ({ ...e, seq, prevHash: "", hash: "" }) as LogEntry),
        "me",
      )!;
    expect(run(3000)).toMatchObject({ kind: "cashed", aliveS: 50 });
    expect(run(5400)).toMatchObject({ kind: "survived", aliveS: 90 });
  });
});
