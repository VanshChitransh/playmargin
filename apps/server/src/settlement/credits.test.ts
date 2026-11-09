// Free payouts land once, only for humans, and exactly as settle(log) says.
import type { SettleResult } from "@margin/core";
import { describe, expect, it } from "vitest";
import { creditBalance, openDb, userForGuestKey } from "../db";
import { CreditsSettlement } from "./credits";

describe("CreditsSettlement", () => {
  it("pays humans from the result, skips agents, and is idempotent", async () => {
    const db = openDb(":memory:");
    const u = userForGuestKey(db, "ed25519:settlementtest01");
    const s = new CreditsSettlement(db, new Map([["blob-u", u]]));
    const result = {
      matchId: "m1",
      payouts: [
        { id: "blob-u", accountId: null, amount: 123_456_789 },
        { id: "agent-1", accountId: null, amount: 50_000_000 },
      ],
    } as SettleResult;
    expect(await s.settle(result, "h")).toBeNull();
    await s.settle(result, "h");
    expect(creditBalance(db, u)).toBe(123_456_789);
  });
});
