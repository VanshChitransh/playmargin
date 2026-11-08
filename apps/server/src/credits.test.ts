// Credits must add up exactly: top-up once per UTC day, entry at GO, payout at settle.
import { ENTRY_FREE_MICRO } from "@margin/core";
import { describe, expect, it } from "vitest";
import { TOPUP_TO_MICRO, creditsRepo, isGuestKey, topUpDaily } from "./credits";
import { openDb, userForGuestKey } from "./db";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 9, 10);

describe("credits", () => {
  it("5 matches add up exactly to the ledger", () => {
    const db = openDb(":memory:");
    const repo = creditsRepo(db);
    const u = userForGuestKey(db, "ed25519:guestkey0000001");
    expect(topUpDaily(db, u, T0)).toBe(TOPUP_TO_MICRO);
    const payouts = [80_000_000, 0, 137_250_001, 55_123_456, 100_000_000];
    payouts.forEach((p, i) => {
      repo.append({ userId: u, delta: -ENTRY_FREE_MICRO, reason: "entry", matchId: `m${i}` });
      if (p) repo.append({ userId: u, delta: p, reason: "payout", matchId: `m${i}` });
    });
    const expected = TOPUP_TO_MICRO - 5 * ENTRY_FREE_MICRO + payouts.reduce((a, b) => a + b, 0);
    expect(repo.balance(u)).toBe(expected);
  });

  it("tops up once per UTC day, even after losing below the line", () => {
    const db = openDb(":memory:");
    const repo = creditsRepo(db);
    const u = userForGuestKey(db, "ed25519:guestkey0000002");
    topUpDaily(db, u, T0);
    repo.append({ userId: u, delta: -ENTRY_FREE_MICRO, reason: "entry" });
    expect(topUpDaily(db, u, T0 + 3_600_000)).toBe(0);
    expect(repo.balance(u)).toBe(TOPUP_TO_MICRO - ENTRY_FREE_MICRO);
    expect(topUpDaily(db, u, T0 + DAY)).toBe(ENTRY_FREE_MICRO);
    expect(repo.balance(u)).toBe(TOPUP_TO_MICRO);
  });

  it("never tops up above the line", () => {
    const db = openDb(":memory:");
    const u = userForGuestKey(db, "ed25519:guestkey0000003");
    creditsRepo(db).append({ userId: u, delta: 2 * TOPUP_TO_MICRO, reason: "payout" });
    expect(topUpDaily(db, u, T0)).toBe(0);
  });

  it("accepts only plausible guest keys", () => {
    expect(isGuestKey("ed25519:3yMApqCuCjXDWPrbjfR5mjCPTHqFG8Pux1TxQrEM35jj")).toBe(true);
    for (const bad of ["", "short", "x".repeat(200), "ed25519:abc'; DROP TABLE users;--", 42]) expect(isGuestKey(bad)).toBe(false);
  });
});
