import { describe, expect, it } from "vitest";
import { spikeWouldRedden } from "./danger";

describe("spikeWouldRedden", () => {
  it("never warns without debt", () => {
    expect(spikeWouldRedden(80, 0, true)).toBe(false);
  });
  it("matches RULES: at full boost small spikes stay grey, big ones glow red", () => {
    // start 80 equity, 3 pips borrowed 120: mass 200, HF 1.33
    expect(spikeWouldRedden(80, 120, false)).toBe(false);
    expect(spikeWouldRedden(80, 120, true)).toBe(true);
  });
  it("one pip is safe from both sizes", () => {
    expect(spikeWouldRedden(80, 40, false)).toBe(false);
    expect(spikeWouldRedden(80, 40, true)).toBe(false);
  });
});
