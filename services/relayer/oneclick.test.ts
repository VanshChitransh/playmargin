// Add funds safety: only known tokens, sane amounts and accounts reach 1-Click, and every quote
// targets USDC on NEAR at our contract with the player in customRecipientMsg and a min-out.

import { describe, expect, it } from "vitest";
import { USDC_NEAR, quoteInputError, quoteRequest } from "./oneclick.ts";

const known = (id: string) => id === "nep141:base-usdc";
const ok = { accountId: "vansh.near", originAsset: "nep141:base-usdc", amount: "2000000", refundTo: "0x1111111111111111111111111111111111111111" };

describe("1-Click proxy", () => {
  it("accepts a sane request and refuses bad fields", () => {
    expect(quoteInputError(ok, known)).toBeNull();
    expect(quoteInputError({ ...ok, accountId: "Bad Account" }, known)).toMatch(/account/);
    expect(quoteInputError({ ...ok, originAsset: "nep141:evil" }, known)).toMatch(/token/);
    expect(quoteInputError({ ...ok, amount: "0" }, known)).toMatch(/amount/);
    expect(quoteInputError({ ...ok, amount: "1.5" }, known)).toMatch(/amount/);
    expect(quoteInputError({ ...ok, refundTo: "" }, known)).toMatch(/refund/);
  });

  it("always quotes USDC on NEAR into the contract for the player, dry unless live", () => {
    const q = quoteRequest(ok, "playmargin.near", false, 0) as Record<string, unknown>;
    expect(q).toMatchObject({ dry: true, destinationAsset: USDC_NEAR, recipient: "playmargin.near", slippageTolerance: 100 });
    expect(JSON.parse(String(q.customRecipientMsg))).toEqual({ for: "vansh.near" });
    expect((quoteRequest(ok, "playmargin.near", true, 0) as { dry: boolean }).dry).toBe(false);
  });
});
