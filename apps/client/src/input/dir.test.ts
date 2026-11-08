import { describe, expect, it } from "vitest";
import { dirFromPointer } from "./dir";

describe("dirFromPointer", () => {
  it("stops inside the dead zone", () => {
    expect(dirFromPointer(500, 400, 1000, 800)).toEqual({ x: 0, y: 0 });
  });
  it("is unit length far away and never above 1", () => {
    const v = dirFromPointer(1000, 400, 1000, 800);
    expect(v.x).toBeCloseTo(1);
    expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(1);
  });
  it("scales down close to the blob", () => {
    expect(dirFromPointer(600, 400, 1000, 800).x).toBeCloseTo(0.5);
  });
});
