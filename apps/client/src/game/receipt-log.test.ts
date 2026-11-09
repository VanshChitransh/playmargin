import { MICRO, type LogEntry } from "@margin/core";
import { describe, expect, it } from "vitest";
import { receiptFromLog } from "./receipt";

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
});
