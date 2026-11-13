import { describe, expect, it } from "vitest";
import { HERO_CUES, cuesBetween } from "./landing";

describe("hero feed cues", () => {
  it("fires each cue once as the clock passes it", () => {
    expect(cuesBetween(13.2, 13.5).map((c) => c.text)).toEqual(["Diamond Dani 🤖 popped Nitro Nina"]);
    expect(cuesBetween(13.5, 13.7)).toEqual([]);
  });
  it("a loop restart starts again from 0", () => {
    expect(cuesBetween(21.9, 0.2)).toEqual([]);
    expect(cuesBetween(21.9, 5).map((c) => c.at)).toEqual([4.9]);
  });
  it("every cue sits inside the 22 s loop", () => expect(HERO_CUES.every((c) => c.at > 0 && c.at < 22)).toBe(true));
});
