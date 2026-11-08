// Phase-0 check: migrations apply, a guest gets one stable user, balance = SUM(ledger),
// and the ledger refuses edits.
import { describe, expect, it } from "vitest";
import { appendCredit, creditBalance, openDb, userForGuestKey } from "./db";

describe("db", () => {
  it("creates a user, tops up, reads the balance", () => {
    const db = openDb(":memory:");
    const id = userForGuestKey(db, "pk-abc");
    expect(userForGuestKey(db, "pk-abc")).toBe(id);
    expect(creditBalance(db, id)).toBe(0);
    appendCredit(db, { userId: id, delta: 1_000_000_000, reason: "daily_topup" });
    appendCredit(db, { userId: id, delta: -100_000_000, reason: "entry", matchId: "m1" });
    expect(creditBalance(db, id)).toBe(900_000_000);
  });

  it("keeps the ledger append-only and rejects fractional Micro", () => {
    const db = openDb(":memory:");
    const id = userForGuestKey(db, "pk-x");
    appendCredit(db, { userId: id, delta: 5, reason: "t" });
    expect(() => db.exec("UPDATE credits_ledger SET delta = 999")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM credits_ledger")).toThrow(/append-only/);
    expect(() => appendCredit(db, { userId: id, delta: 1.5, reason: "t" })).toThrow();
  });
});
