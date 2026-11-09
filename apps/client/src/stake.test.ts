import { describe, expect, it } from "vitest";
import { priceTag } from "./stake";

describe("priceTag", () => {
  it("shows whole dollars bare and cents with two decimals", () => {
    expect(priceTag(1_000_000n)).toBe("$1");
    expect(priceTag(100_000n)).toBe("$0.10");
    expect(priceTag(2_500_000n)).toBe("$2.50");
  });
});
