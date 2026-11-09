import { describe, expect, it } from "vitest";
import { clock, greedScore } from "./certificate";

describe("certificate numbers", () => {
  it("greed is 0 with no loan and 100 at the 2.5x cap", () => {
    expect(greedScore(1)).toBe(0);
    expect(greedScore(1.75)).toBe(50);
    expect(greedScore(2.5)).toBe(100);
    expect(greedScore(3.2)).toBe(100);
  });
  it("clock reads like the HUD", () => {
    expect(clock(61)).toBe("1:01");
    expect(clock(9.7)).toBe("0:09");
  });
});
