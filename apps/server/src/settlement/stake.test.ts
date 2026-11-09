// open_match binds whatever stake each ticket holds at that moment, so the room must settle at the
// stake the chain bound, and refuse a match whose tickets disagree.
import { describe, expect, it } from "vitest";
import type { Chain } from "./chain";
import { boundStake } from "./stake";

const chainWith = (tickets: Record<string, { stake: string; match_id: string | null } | null>) =>
  ({ view: async (_m: string, a: { account_id: string }) => tickets[a.account_id] ?? null }) as unknown as Chain;

describe("boundStake", () => {
  it("returns the stake open_match bound, even if it changed after the check", async () => {
    const chain = chainWith({ a: { stake: "100000", match_id: "m" }, b: { stake: "100000", match_id: "m" } });
    expect(await boundStake(chain, ["a", "b"], "m")).toBe(100_000);
  });
  it("refuses mixed stakes", async () => {
    const chain = chainWith({ a: { stake: "100000", match_id: "m" }, b: { stake: "1000000", match_id: "m" } });
    await expect(boundStake(chain, ["a", "b"], "m")).rejects.toThrow(/mixed stakes/);
  });
  it("refuses a ticket bound elsewhere or gone", async () => {
    await expect(boundStake(chainWith({ a: { stake: "100000", match_id: "x" } }), ["a"], "m")).rejects.toThrow(/not bound/);
    await expect(boundStake(chainWith({}), ["a"], "m")).rejects.toThrow(/not bound/);
  });
  it("refuses a stake core cannot settle", async () => {
    await expect(boundStake(chainWith({ a: { stake: "300000", match_id: "m" } }), ["a"], "m")).rejects.toThrow(/bad stake/);
  });
});
