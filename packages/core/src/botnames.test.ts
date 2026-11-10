import { describe, expect, it } from "vitest";
import { BOT_NAMES, botNames } from "./botnames";
import { cleanName, NAME_MAX } from "./name";

describe("botNames", () => {
  it("is seeded: same seed same names, distinct within a match", () => {
    expect(botNames(42, 11)).toEqual(botNames(42, 11));
    expect(new Set(botNames(42, 11)).size).toBe(11);
    expect(botNames(1, 11)).not.toEqual(botNames(2, 11));
  });
  it("every name fits the label cap, is plain text cleanName would keep, and is reserved from humans", () => {
    for (const n of BOT_NAMES) {
      expect(n.length).toBeLessThanOrEqual(NAME_MAX);
      expect(n).toMatch(/^[A-Za-z0-9 _.-]+$/); // the exact characters cleanName keeps, no double spaces
      expect(n).toBe(n.replace(/\s+/g, " ").trim());
      expect(cleanName(n)).toBeNull(); // QA-A-05: a human can't take a bot's name
    }
  });
  it("never runs out", () => expect(botNames(7, 30)).toHaveLength(30));
});
