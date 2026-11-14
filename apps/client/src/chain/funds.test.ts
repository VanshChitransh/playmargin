// A withdraw that bounced (receiver not registered on USDC) must never read as "Withdrawn" (RT L1-05).

import { describe, expect, it } from "vitest";
import { withdrawOk } from "./funds";

const value = (v: string) => ({ status: { SuccessValue: btoa(v) } });

describe("withdrawOk", () => {
  it("reads on_withdraw's return value from the tx outcome", () => {
    expect(withdrawOk(value("true"))).toBe(true);
    expect(withdrawOk(value("false"))).toBe(false); // re-credited, nothing left the contract
    expect(withdrawOk({ status: { Failure: { ActionError: {} } } })).toBe(false);
  });

  it("returns null when the wallet gave no outcome, so the caller re-reads the balance", () => {
    expect(withdrawOk(undefined)).toBeNull();
    expect(withdrawOk(null)).toBeNull();
    expect(withdrawOk({})).toBeNull();
    expect(withdrawOk({ status: "Started" })).toBeNull();
  });
});
