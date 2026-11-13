import { describe, expect, it } from "vitest";
import { HERO_CUES, cuesBetween } from "./landing";

describe("hero feed cues", () => {
  it("fires each cue once as the clock passes it", () => {
    expect(cuesBetween(7.5, 7.8).map((c) => c.text)).toEqual(["You hold BOOST: a loan from the vault"]);
    expect(cuesBetween(7.8, 8.0)).toEqual([]);
  });
  it("a loop restart starts again from 0", () => {
    expect(cuesBetween(19.6, 0.2)).toEqual([]);
    expect(cuesBetween(19.6, 1).map((c) => c.at)).toEqual([0.4]);
  });
  it("every cue sits inside the 19.7 s loop", () => expect(HERO_CUES.every((c) => c.at > 0 && c.at < 19.7)).toBe(true));
});
