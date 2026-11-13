import { describe, expect, it } from "vitest";
import { ticks } from "./obs";

describe("tick timings", () => {
  it("reports mean, p99 and max", () => {
    for (let i = 0; i < 99; i++) ticks.record(1);
    ticks.record(40);
    expect(ticks.summary()).toEqual({ count: 100, meanMs: 1.39, p99Ms: 1.1, maxMs: 40 });
  });
  it("is a rolling minute: an old spike drops out, a quiet minute reads 0 (B06)", () => {
    const t0 = ticks.start;
    ticks.record(1, t0 + 61_000); // the spike's minute is over: it becomes the last window
    expect(ticks.summary(t0 + 61_000).maxMs).toBe(40);
    for (let i = 0; i < 9; i++) ticks.record(2, t0 + 62_000);
    expect(ticks.summary(t0 + 122_000)).toEqual({ count: 10, meanMs: 1.9, p99Ms: 2.1, maxMs: 2 });
    expect(ticks.summary(t0 + 400_000)).toEqual({ count: 0, meanMs: 0, p99Ms: 0, maxMs: 0 });
  });
});
