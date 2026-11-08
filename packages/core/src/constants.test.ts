import { describe, expect, it } from "vitest";
import snapshot from "./rules.snapshot.json";
import { BOUNTY_BPS, ENTRY_PAID_MICRO, LT_BPS, MATCH_TICKS, R } from "./constants";

describe("constants", () => {
  it("match RULES.html verbatim", () => {
    expect(R).toEqual(snapshot);
  });
  it("derive the integer forms the engine uses", () => {
    expect(MATCH_TICKS).toBe(5400);
    expect(LT_BPS).toBe(8000);
    expect(BOUNTY_BPS).toBe(800);
    expect(ENTRY_PAID_MICRO).toBe(100_000_000);
  });
});
