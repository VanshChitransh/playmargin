import { describe, expect, it } from "vitest";
import { ticks } from "./obs";

describe("tick timings", () => {
  it("reports mean, p99 and max", () => {
    for (let i = 0; i < 99; i++) ticks.record(1);
    ticks.record(40);
    expect(ticks.summary()).toEqual({ count: 100, meanMs: 1.39, p99Ms: 1.1, maxMs: 40 });
  });
});
